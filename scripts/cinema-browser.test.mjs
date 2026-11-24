import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';

const output = process.env.CINEMA_SCREENSHOTS;
const timeout = 90_000;
let browser;
let server;
let origin;

before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: process.env.COAST_CHROME_CHANNEL || 'chromium',
    args: ['--enable-unsafe-swiftshader'],
  });
  if (output) await mkdir(output, { recursive: true });
});

after(async () => {
  try { await browser?.close(); }
  finally { await server?.close(); }
});

function observeCinema(captureScreenshots) {
  const uniforms = new WeakMap();
  const fadePrograms = new WeakMap();
  const probe = { position: null, lamps: null, live: null, darkness: 0, peakDarkness: 0 };
  window.cinemaProbe = probe;
  const gl = WebGL2RenderingContext.prototype;
  const locate = gl.getUniformLocation;
  const setVector = gl.uniform3f;
  const setFloat = gl.uniform1f;
  const setMatrix = gl.uniformMatrix4fv;
  const clear = gl.clear;
  const useProgram = gl.useProgram;
  let activeProgram = null;
  if (captureScreenshots) {
    gl.clear = function (mask) {
      // The transition plane stops drawing altogether when fully transparent.
      if ((mask & this.COLOR_BUFFER_BIT) && !this.getParameter(this.DRAW_FRAMEBUFFER_BINDING)) {
        probe.darkness = 0;
      }
      clear.call(this, mask);
    };
    gl.useProgram = function (program) {
      useProgram.call(this, program);
      activeProgram = program;
      if (fadePrograms.has(program)) probe.darkness = fadePrograms.get(program);
    };
  }
  gl.getUniformLocation = function (program, name) {
    const location = locate.call(this, program, name);
    if (location && ['viewMatrix', 'cinemaLamps', 'cinemaLive', 'darkness'].includes(name)) uniforms.set(location, name);
    return location;
  };
  gl.uniform3f = function (location, x, y, z) {
    if (uniforms.get(location) === 'cinemaLamps') probe.lamps = [x, y, z];
    setVector.call(this, location, x, y, z);
  };
  gl.uniform1f = function (location, value) {
    if (uniforms.get(location) === 'cinemaLive') probe.live = value;
    if (uniforms.get(location) === 'darkness') {
      probe.peakDarkness = Math.max(probe.peakDarkness, value);
      if (activeProgram) fadePrograms.set(activeProgram, value);
      probe.darkness = value;
    }
    setFloat.call(this, location, value);
  };
  gl.uniformMatrix4fv = function (location, transpose, matrix, ...rest) {
    if (uniforms.get(location) === 'viewMatrix') {
      const [tx, ty, tz] = matrix.subarray(12, 15);
      probe.position = [0, 4, 8].map(i => -(matrix[i] * tx + matrix[i + 1] * ty + matrix[i + 2] * tz));
    }
    setMatrix.call(this, location, transpose, matrix, ...rest);
  };
}

function button(page, name) { return page.getByRole('button', { name, exact: true }); }

async function openCinema(t, captureScreenshots = Boolean(output)) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  t.after(() => page.context().close());
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(observeCinema, captureScreenshots);
  await page.goto(`${origin}/?world=cinema&time=night`);
  await page.getByRole('heading', { name: '映画館シアター（大）' }).waitFor();
  await page.waitForFunction(() => document.hasFocus() && window.cinemaProbe.position);
  return { page, errors };
}

async function travel(page, label, place, world = 'cinema') {
  await button(page, 'ファストトラベル').click();
  const dialog = page.getByRole('dialog', { name: 'ファストトラベル' });
  await dialog.getByRole('button', { name: label }).click();
  await page.waitForURL(address => address.searchParams.get('world') === world
    && address.searchParams.get('place') === place && address.searchParams.get('time') === 'night');
}

async function holdKey(page, key, reached) {
  await page.keyboard.down(key);
  try { await page.waitForFunction(reached); }
  finally { await page.keyboard.up(key); }
}

async function screenshot(page, name) {
  if (!output) return;
  await page.waitForFunction(() => window.cinemaProbe.darkness === 0);
  await page.screenshot({ path: join(output, `cinema-${name}.png`) });
}

async function sampleRearSeatLighting(page, quality) {
  await page.waitForFunction(() => window.cinemaProbe.darkness === 0);
  const frame = await page.screenshot({
    path: output ? join(output, `cinema-rear-hidden-${quality}.png`) : undefined,
    style: '.coast-ui { visibility: hidden !important }',
  });
  return page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    function peak(x, y, width, height, measure) {
      const { data } = context.getImageData(x, y, width, height);
      let maximum = 0;
      for (let i = 0; i < data.length; i += 4) {
        maximum = Math.max(maximum, measure(data[i], data[i + 1], data[i + 2]));
      }
      return maximum;
    }
    const luma = (red, green, blue) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    return {
      ceiling: peak(35, 25, 1350, 145, luma),
      seats: peak(70, 716, 850, 170, luma),
      exitSign: peak(1190, 580, 25, 38, (red, green) => green - red),
      tread: peak(1253, 724, 38, 15, luma),
    };
  }, frame.toString('base64'));
}

test('cinema keeps its exits sealed and uses fast travel to return to the inlet', { timeout }, async t => {
  const { page, errors } = await openCinema(t);
  const initial = await page.evaluate(() => window.cinemaProbe.position);
  assert.ok(Math.abs(initial[1] - 4.400) < .01);
  assert.ok(Math.abs(initial[2] - 33.45) < .01);
  await page.getByText('座位', { exact: true }).waitFor();
  await holdKey(page, 'w', () => window.cinemaProbe.position[2] < 33.22);
  await page.keyboard.press('c');
  await page.getByText('歩行', { exact: true }).waitFor();
  await holdKey(page, 'd', () => window.cinemaProbe.position[0] > 6.42);
  await holdKey(page, 's', () => window.cinemaProbe.position[2] > 51);
  assert.ok(Math.abs((await page.evaluate(() => window.cinemaProbe.position))[1] - 9.040) < .09);
  await travel(page, '後方側席（R20）', 'rear');
  await page.waitForFunction(() => Math.abs(window.cinemaProbe.position[1] - 8.540) < .01);
  assert.equal(await page.evaluate(() => window.cinemaProbe.peakDarkness), 1);
  await screenshot(page, 'rear');
  await travel(page, '車いす席（R08）', 'accessible');
  await page.waitForFunction(() => Math.abs(window.cinemaProbe.position[1] - 3.800) < .01);
  await screenshot(page, 'accessible');
  await page.keyboard.press('c');
  await holdKey(page, 'w', () => window.cinemaProbe.position[2] < 29.82);
  await button(page, 'マウス操作を開始').click();
  await page.waitForFunction(() => document.pointerLockElement?.classList.contains('coast-view'));
  const rotation = Math.atan2(-12.715, 31.75);
  await page.locator('canvas.coast-view').evaluate((canvas, movementX) => {
    canvas.dispatchEvent(new MouseEvent('mousemove', { movementX }));
  }, (rotation - Math.PI / 2) / .0022);
  await holdKey(page, 'w', () => window.cinemaProbe.position[0] < -18.1);
  const atExit = await page.evaluate(() => window.cinemaProbe.position);
  assert.ok(Math.hypot(atExit[0] + 20, atExit[2] - 29.7) < 2.35, 'E is tested within reach of exit E3');
  assert.equal(await page.getByRole('button', { name: /出口|シアターを退出/ }).count(), 0,
    'sealed exit scenery has no E-key action');
  await screenshot(page, 'exit');
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  assert.equal(new URL(page.url()).searchParams.get('world'), 'cinema', 'E at a sealed exit does not change worlds');
  await holdKey(page, 'w', () => window.cinemaProbe.position[0] < -19.60);
  assert.ok((await page.evaluate(() => window.cinemaProbe.position))[0] >= -19.66,
    'the west auditorium boundary blocks walking through the exit');
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => !document.querySelector('.coast')?.classList.contains('coast-locked'));
  assert.equal(new URL(page.url()).searchParams.get('world'), 'cinema', 'releasing pointer lock keeps the current world');
  await travel(page, '入り江の浜', 'inlet', 'coast');
  await page.getByRole('heading', { name: '自然景観探索' }).waitFor();
  await travel(page, '中段中央（R09）', 'center');
  await page.getByRole('heading', { name: '映画館シアター（大）' }).waitFor();
  assert.deepEqual(errors, []);
});

test('cinema can jump, fly over seat backs and land below the auditorium ceiling', { timeout }, async t => {
  const { page, errors } = await openCinema(t);
  const flight = button(page, '自由飛行');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.cinemaProbe.position[1] > 4.8);
  await page.waitForFunction(() => Math.abs(window.cinemaProbe.position[1] - 4.4) < .01);

  await flight.click();
  assert.equal(await flight.getAttribute('aria-pressed'), 'true');
  await holdKey(page, 'Space', () => window.cinemaProbe.position[1] > 21.74);
  const top = await page.evaluate(() => window.cinemaProbe.position);
  assert.ok(top[1] < 21.76);

  await holdKey(page, 's', () => window.cinemaProbe.position[2] > 34.05);
  await page.keyboard.press('f');
  assert.equal(await flight.getAttribute('aria-pressed'), 'false');
  await page.waitForFunction(() => window.cinemaProbe.position[1] < 6);
  await page.getByText('歩行', { exact: true }).waitFor();
  await holdKey(page, 'w', () => window.cinemaProbe.position[2] < 33.98);
  assert.deepEqual(errors, []);
});

test('house light scenes, preview projection and quality change together through the normal controls', { timeout }, async t => {
  const { page, errors } = await openCinema(t, true);
  await page.waitForFunction(() => window.cinemaProbe.lamps?.[0] > .8 && window.cinemaProbe.live === 0);
  await screenshot(page, 'arrival');
  await button(page, '仮想モニター').click();
  await button(page, '投影を止める').click();
  await button(page, 'スクリーンに映す').waitFor();
  await button(page, '仮想モニター').click();
  const dialog = page.getByRole('dialog', { name: '上映設定' });
  await button(page, '上映設定').click();
  await button(dialog, '上映').click();
  assert.equal(await button(dialog, '試映を再生').isEnabled(), true);
  await button(dialog, '閉じる').click();
  await travel(page, '後方側席（R20）', 'rear');
  await page.waitForFunction(() => Math.abs(window.cinemaProbe.position?.[1] - 8.540) < .01
    && window.cinemaProbe.lamps?.every(level => level === 0) && window.cinemaProbe.live === 0);
  for (const quality of ['軽量', '高品質']) {
    if (quality === '高品質') await button(page, quality).click();
    const room = await sampleRearSeatLighting(page, quality === '軽量' ? 'light' : 'high');
    assert.ok(room.ceiling < 1 && room.seats < 1, `${quality}: the upper room receives no unpowered fill`);
    assert.ok(room.exitSign > 40 && room.tread > 20, `${quality}: the exit sign and tread are visible`);
  }

  await button(page, '上映設定').click();
  await button(dialog, '試映を再生').click();
  await page.waitForFunction(() => window.cinemaProbe.live === 1);
  await button(page, '環境音をオフ').waitFor();
  await button(page, '環境音をオフ').click();
  await button(page, '環境音をオン').waitFor();
  await button(page, '環境音をオン').click();
  await button(page, '環境音をオフ').waitFor();
  await screenshot(page, 'screening');
  await button(page, '上映設定').click();
  await button(dialog, '非常点検').click();
  await page.waitForFunction(() => window.cinemaProbe.live === 0 && window.cinemaProbe.lamps?.[2] > .8);
  assert.equal(await button(dialog, '試映を再生').isDisabled(), true);
  await button(dialog, '清掃').click();
  await button(dialog, '閉じる').click();
  await page.waitForFunction(() => window.cinemaProbe.lamps?.[1] > 1 && window.cinemaProbe.live === 0);
  await screenshot(page, 'service');
  assert.deepEqual(errors, []);
});
