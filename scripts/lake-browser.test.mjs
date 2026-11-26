import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { installSimulatedXR } from './simulated-xr.mjs';

const screenshots = process.env.LAKE_SCREENSHOTS;
const viewport = { width: 1440, height: 808 };
const timeout = 110_000;
let server;
let browser;
let origin;

before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: process.env.COAST_CHROME_CHANNEL || 'chromium',
    args: ['--enable-unsafe-swiftshader'],
  });
  if (screenshots) await mkdir(screenshots, { recursive: true });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    await server?.close();
  }
});

function observeView() {
  const probe = { camera: null };
  window.lakeProbe = probe;
  const cameraUniforms = new WeakSet();
  const gl = WebGL2RenderingContext.prototype;
  const findUniform = gl.getUniformLocation;
  const setPosition = gl.uniform3f;
  gl.getUniformLocation = function (program, name) {
    const location = findUniform.call(this, program, name);
    if (location && name === 'cameraPosition') cameraUniforms.add(location);
    return location;
  };
  gl.uniform3f = function (location, x, y, z) {
    if (cameraUniforms.has(location)) probe.camera = { x, y, z };
    return setPosition.call(this, location, x, y, z);
  };
}

function observeOutput() {
  const probe = { context: null, analyser: null };
  window.lakeAudioProbe = probe;
  const NativeContext = window.AudioContext;
  const connect = AudioNode.prototype.connect;
  window.AudioContext = class extends NativeContext {
    constructor(...args) {
      super(...args);
      probe.context = this;
      probe.analyser = this.createAnalyser();
    }
  };
  AudioNode.prototype.connect = function (destination, ...args) {
    if (destination === probe.context?.destination) connect.call(this, probe.analyser);
    return connect.call(this, destination, ...args);
  };
  probe.peak = () => {
    if (!probe.analyser) return 0;
    const data = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(data);
    return Math.max(...data.map(Math.abs));
  };
}

async function newPage(t) {
  const page = await browser.newPage({ viewport });
  t.after(() => page.close());
  page.setDefaultTimeout(25_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(observeView);
  return { page, errors };
}

function action(page, name) {
  return page.getByRole('button', { name, exact: true });
}

async function goToLake(page, options = '') {
  await page.goto(`${origin}/?world=lake${options}`, { waitUntil: 'commit' });
  await page.getByRole('heading', { name: '湖畔の広間', exact: true }).waitFor();
  await page.waitForFunction(() => Boolean(window.lakeProbe.camera));
}

async function capture(page, name) {
  return page.screenshot({
    path: screenshots ? join(screenshots, `${name}.png`) : undefined,
    style: '.coast-ui { visibility: hidden !important; }',
  });
}

async function skySample(page, buffer) {
  return page.evaluate(async image => {
    const bytes = Uint8Array.from(atob(image), letter => letter.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const crop = document.createElement('canvas');
    crop.width = 64;
    crop.height = 24;
    const ctx = crop.getContext('2d');
    ctx.drawImage(bitmap, bitmap.width * 0.30, bitmap.height * 0.195, bitmap.width * 0.40,
      bitmap.height * 0.085, 0, 0, crop.width, crop.height);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, crop.width, crop.height);
    const pixelCount = data.length / 4;
    let sum = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      sum += data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    }
    return sum / pixelCount;
  }, buffer.toString('base64'));
}

async function walk(page, key, condition) {
  await action(page, 'マウス操作を開始').click();
  await page.waitForFunction(() => document.pointerLockElement?.classList.contains('coast-view'));
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(condition);
  } finally {
    await page.keyboard.up(key);
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => document.pointerLockElement === null
      && !document.querySelector('#app')?.classList.contains('coast-locked'));
  }
}

async function travel(page, world, name) {
  await action(page, 'ファストトラベル').click();
  const dialog = page.getByRole('dialog', { name: 'ファストトラベル' });
  await dialog.getByRole('region', { name: world, exact: true })
    .getByRole('button', { name: new RegExp(name) }).click();
  await dialog.waitFor({ state: 'hidden' });
}

test('lake hall starts at its photo comparison view and switches the sky to night', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await goToLake(page);
  const position = await page.evaluate(() => window.lakeProbe.camera);
  assert.ok(Math.hypot(position.x, position.y - 1.65, position.z - 7) < 0.04);
  assert.equal(await page.locator('#coast-fov').inputValue(), '52');
  await page.waitForLoadState('networkidle');
  const day = await skySample(page, await capture(page, 'lake-hall-day'));
  if (screenshots) {
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 8_000)));
    await capture(page, 'lake-hall-day-later');
  }
  await action(page, '夜').click();
  await page.waitForURL(url => url.searchParams.get('time') === 'night');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const night = await skySample(page, await capture(page, 'lake-hall-night'));
  assert.ok(day > 70 && night < day * 0.70, `sky light changed from ${day.toFixed(1)} to ${night.toFixed(1)}`);
  await action(page, '高品質').click();
  assert.equal(await action(page, '高品質').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (screenshots) await capture(page, 'lake-hall-night-high');
  assert.deepEqual(errors, []);
});

test('a failed lake scene load has a world-specific message and a recovery link', { timeout }, async t => {
  const { page } = await newPage(t);
  await page.route('**/assets/LakeWorld-*.js', route => route.abort());
  await page.goto(`${origin}/?world=lake`);
  await page.getByText('湖畔の広間を読み込めませんでした。ページを再読み込みしてください。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '入り江と山道へ' }).getAttribute('href'), '?world=coast');
});

test('the two verandas can be reached and walked back into the hall, with time retained across worlds',
  { timeout }, async t => {
    const { page, errors } = await newPage(t);
    await goToLake(page);
    for (const side of [
      { label: '西の縁側', id: 'west-veranda', x: -19.3 },
      { label: '東の縁側', id: 'east-veranda', x: 19.3 },
    ]) {
      await travel(page, '湖畔の広間', side.label);
      await page.waitForURL(url => url.searchParams.get('place') === side.id);
      await page.waitForFunction(x => {
        const p = window.lakeProbe.camera;
        return Math.hypot(p.x - x, p.y - 1.65, p.z + 9.1) < 0.05;
      }, side.x);
      if (screenshots) await capture(page, `lake-${side.id}-day`);
      await walk(page, 's', () => window.lakeProbe.camera.z > -5.8);
      const inside = await page.evaluate(() => window.lakeProbe.camera);
      assert.ok(Math.abs(inside.y - 1.65) < 0.04);
    }

    await action(page, '夜').click();
    await travel(page, '丘陵展望台', '中央展望デッキ');
    await page.getByRole('heading', { name: '丘陵展望台', exact: true }).waitFor();
    assert.match(page.url(), /time=night/);
    await travel(page, '湖畔の広間', '広間の中央');
    await page.getByRole('heading', { name: '湖畔の広間', exact: true }).waitFor();
    assert.match(page.url(), /time=night/);
    assert.deepEqual(errors, []);
  });

test('lake ambience reaches the output and follows the simulated XR listener', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await page.addInitScript(installSimulatedXR);
  await page.addInitScript(observeOutput);
  await goToLake(page, '&place=west-veranda');
  await action(page, '環境音をオン').click();
  await page.waitForFunction(() => window.lakeAudioProbe.peak() > 0.00005);
  await page.locator('.coast-sound-details > summary').click();
  assert.ok(await page.getByRole('slider', { name: '水音', exact: true }).isVisible());
  assert.ok(await page.getByRole('slider', { name: '鳥の声', exact: true }).isVisible());
  await page.locator('.coast-sound-details > summary').click();
  await action(page, 'VRを開始').click();
  await page.waitForFunction(() => window.xrFixture.xrDraws > 0
    && Boolean(window.xrFixture.eyePoses[0]) && Boolean(window.xrFixture.eyePoses[320]));
  const start = await page.evaluate(() => {
    const left = window.xrFixture.eyePoses[0];
    const right = window.xrFixture.eyePoses[320];
    return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2, z: (left.z + right.z) / 2 };
  });
  assert.ok(Math.hypot(start.x + 19.3, start.y - 1.65, start.z + 9.1) < 0.06);
  await page.evaluate(() => window.xrFixture.mutate({ head: { yaw: 0.65 }, frames: 6 }));
  await page.waitForFunction(() => Math.abs(window.lakeAudioProbe.context.listener.forwardX.value) > 0.30);
  const desktopDraws = await page.evaluate(() => window.xrFixture.desktopDraws);
  await action(page, 'VRを終了').click();
  await page.waitForFunction(previous => window.xrFixture.ends === 1
    && window.xrFixture.desktopDraws > previous, desktopDraws);
  assert.equal(await page.evaluate(() => window.xrFixture.strayDraws), 0);
  await action(page, '環境音をオフ').click();
  await page.waitForFunction(() => window.lakeAudioProbe.peak() < 0.00002);
  assert.deepEqual(errors, []);
});
