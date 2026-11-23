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

function observeCinema() {
  const uniforms = new WeakMap();
  const probe = { position: null, lamps: null, live: null, peakDarkness: 0 };
  window.cinemaProbe = probe;
  const gl = WebGL2RenderingContext.prototype;
  const locate = gl.getUniformLocation;
  const setVector = gl.uniform3f;
  const setFloat = gl.uniform1f;
  const setMatrix = gl.uniformMatrix4fv;
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
    if (uniforms.get(location) === 'darkness') probe.peakDarkness = Math.max(probe.peakDarkness, value);
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

async function openCinema(t) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  t.after(() => page.context().close());
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(observeCinema);
  await page.goto(`${origin}/?world=cinema&time=night`);
  await page.getByRole('heading', { name: '映画館シアター（大）' }).waitFor();
  await page.waitForFunction(() => document.hasFocus() && window.cinemaProbe.position);
  return { page, errors };
}

async function travel(page, label, place) {
  await button(page, 'ファストトラベル').click();
  const dialog = page.getByRole('dialog', { name: 'ファストトラベル' });
  await dialog.getByRole('button', { name: label }).click();
  await page.waitForURL(address => address.searchParams.get('place') === place && address.searchParams.get('time') === 'night');
}

async function holdKey(page, key, reached) {
  await page.keyboard.down(key);
  try { await page.waitForFunction(reached); }
  finally { await page.keyboard.up(key); }
}

async function screenshot(page, name) {
  if (output) await page.screenshot({ path: join(output, `cinema-${name}.png`) });
}

test('cinema boots with seated controls, walks the stepped aisle and exits through a level doorway', { timeout }, async t => {
  const { page, errors } = await openCinema(t);
  const initial = await page.evaluate(() => window.cinemaProbe.position);
  assert.ok(Math.abs(initial[1] - 2.855) < .01);
  assert.ok(Math.abs(initial[2] - 33.45) < .01);
  await page.getByText('座位', { exact: true }).waitFor();
  await holdKey(page, 'w', () => window.cinemaProbe.position[2] < 33.22);
  await page.keyboard.press('c');
  await page.getByText('歩行', { exact: true }).waitFor();
  await holdKey(page, 'd', () => window.cinemaProbe.position[0] > 6.42);
  await holdKey(page, 's', () => window.cinemaProbe.position[2] > 51);
  assert.ok(Math.abs((await page.evaluate(() => window.cinemaProbe.position))[1] - 5.585) < .09);
  await travel(page, '後方側席（R20）', 'rear');
  await page.waitForFunction(() => Math.abs(window.cinemaProbe.position[1] - 5.085) < .01);
  assert.equal(await page.evaluate(() => window.cinemaProbe.peakDarkness), 1);
  await screenshot(page, 'rear');
  await travel(page, '車いす席（R08）', 'accessible');
  await page.waitForFunction(() => Math.abs(window.cinemaProbe.position[1] - 2.53) < .01);
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
  await page.getByRole('button', { name: '出口 E3 を開く' }).waitFor();
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'E3 からシアターを退出' }).waitFor();
  await screenshot(page, 'exit');
  await page.keyboard.press('e');
  await page.waitForURL(address => address.searchParams.get('world') === 'coast'
    && address.searchParams.get('place') === 'inlet' && address.searchParams.get('time') === 'night');
  await page.getByRole('heading', { name: '自然景観探索' }).waitFor();
  assert.deepEqual(errors, []);
});

test('house light scenes, preview projection and quality change together through the normal controls', { timeout }, async t => {
  const { page, errors } = await openCinema(t);
  await page.waitForFunction(() => window.cinemaProbe.lamps?.[0] > .8 && window.cinemaProbe.live === 0);
  await screenshot(page, 'arrival');
  const dialog = page.getByRole('dialog', { name: '上映設定' });
  await button(page, '上映設定').click();
  await button(dialog, '上映').click();
  await button(dialog, '試映を再生').click();
  await page.waitForFunction(() => window.cinemaProbe.live === 1);
  await button(page, '環境音を再開').waitFor();
  await button(page, '高品質').click();
  await page.waitForFunction(() => window.cinemaProbe.lamps?.[0] < .15 && window.cinemaProbe.live === 1);
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
