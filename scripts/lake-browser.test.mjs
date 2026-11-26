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

async function sampleBrightness(page, buffer, region) {
  return page.evaluate(async ({ image, region: [x, y, width, height] }) => {
    const bytes = Uint8Array.from(atob(image), letter => letter.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const crop = document.createElement('canvas');
    crop.width = 64;
    crop.height = 24;
    const ctx = crop.getContext('2d');
    ctx.drawImage(bitmap, bitmap.width * x, bitmap.height * y, bitmap.width * width,
      bitmap.height * height, 0, 0, crop.width, crop.height);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, crop.width, crop.height);
    const pixelCount = data.length / 4;
    let sum = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      sum += data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
    }
    return sum / pixelCount;
  }, { image: buffer.toString('base64'), region });
}

async function withPointerLock(page, inspect) {
  await action(page, 'マウス操作を開始').click();
  await page.waitForFunction(() => document.pointerLockElement?.classList.contains('coast-view'));
  try {
    await inspect();
  } finally {
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => document.pointerLockElement === null
      && !document.querySelector('#app')?.classList.contains('coast-locked'));
  }
}

async function walk(page, key, condition, holdAfterArrival = false) {
  await withPointerLock(page, async () => {
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(condition);
      if (holdAfterArrival) {
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1_000)));
      }
    } finally {
      await page.keyboard.up(key);
    }
  });
}

async function turn(page, movementX, movementY = 0) {
  await page.evaluate(([x, y]) => {
    document.pointerLockElement.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y }));
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, [movementX, movementY]);
}

async function captureHallViews(page) {
  await withPointerLock(page, async () => {
    const eighthTurn = 357;
    for (const name of ['right-oblique', 'right', 'rear-right', 'rear', 'rear-left', 'left', 'left-oblique']) {
      await turn(page, eighthTurn);
      await capture(page, `lake-hall-${name}`);
    }
    await turn(page, eighthTurn, -335);
    await capture(page, 'lake-hall-ceiling');
    await turn(page, 0, 690);
    await capture(page, 'lake-hall-floor');
    await turn(page, 0, -355);
  });
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
  const skyRegion = [0.30, 0.195, 0.40, 0.085];
  const day = await sampleBrightness(page, await capture(page, 'lake-hall-day'), skyRegion);
  if (screenshots) {
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 8_000)));
    await capture(page, 'lake-hall-day-later');
    await action(page, '高品質').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await capture(page, 'lake-hall-day-high');
    await action(page, '軽量').click();
    await captureHallViews(page);
  }
  await action(page, '夜').click();
  await page.waitForURL(url => url.searchParams.get('time') === 'night');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const night = await sampleBrightness(page, await capture(page, 'lake-hall-night'), skyRegion);
  assert.ok(day > 70 && night < day * 0.70, `sky light changed from ${day.toFixed(1)} to ${night.toFixed(1)}`);
  await action(page, '高品質').click();
  assert.equal(await action(page, '高品質').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (screenshots) await capture(page, 'lake-hall-night-high');
  assert.deepEqual(errors, []);
});

test('the night andon illuminates its paper and nearby tatami and follows the world light control', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await goToLake(page, '&time=night');
  await page.waitForLoadState('networkidle');
  const lit = await capture(page, 'lake-andon-lit');
  await action(page, '一括消灯').click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const dark = await capture(page, 'lake-andon-unlit');
  const shade = [0.678, 0.828, 0.014, 0.029];
  const tatami = [0.667, 0.888, 0.040, 0.021];
  const litShade = await sampleBrightness(page, lit, shade);
  const darkShade = await sampleBrightness(page, dark, shade);
  const litFloor = await sampleBrightness(page, lit, tatami);
  const darkFloor = await sampleBrightness(page, dark, tatami);
  assert.ok(litShade > darkShade + 20, `andon paper luminance: ${darkShade} → ${litShade}`);
  assert.ok(litFloor > darkFloor + 5, `nearby floor luminance: ${darkFloor} → ${litFloor}`);
  assert.match(page.url(), /time=night/);
  assert.deepEqual(errors, []);
});

test('a failed lake scene load has a world-specific message and a recovery link', { timeout }, async t => {
  const { page } = await newPage(t);
  await page.route('**/assets/LakeWorld-*.js', route => route.abort());
  await page.goto(`${origin}/?world=lake`);
  await page.getByText('湖畔の広間を読み込めませんでした。ページを再読み込みしてください。', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: '入り江と山道へ' }).getAttribute('href'), '?world=coast');
});

test('the indoor window bays and back wall bound walking, with time retained across worlds',
  { timeout }, async t => {
    const { page, errors } = await newPage(t);
    await goToLake(page);
    await walk(page, 'w', () => window.lakeProbe.camera.z < -1.1);
    assert.ok(Math.abs((await page.evaluate(() => window.lakeProbe.camera)).y - 1.65) < 0.04);
    for (const side of [
      { label: '西の窓辺', id: 'west-window', x: -18.7, key: 'a', wall: () => window.lakeProbe.camera.x < -21.2 },
      { label: '東の窓辺', id: 'east-window', x: 18.7, key: 'd', wall: () => window.lakeProbe.camera.x > 21.2 },
    ]) {
      await travel(page, '湖畔の広間', '広間の中央');
      await walk(page, side.key, side.wall, true);
      assert.ok(Math.abs(await page.evaluate(() => window.lakeProbe.camera.x)) <= 21.401);
      await travel(page, '湖畔の広間', side.label);
      await page.waitForURL(url => url.searchParams.get('place') === side.id);
      await page.waitForFunction(x => {
        const p = window.lakeProbe.camera;
        return Math.hypot(p.x - x, p.y - 1.65, p.z + 5.1) < 0.05;
      }, side.x);
      if (screenshots) await capture(page, `lake-${side.id}-day`);
      await walk(page, 'w', () => window.lakeProbe.camera.z < -5.83, true);
      assert.ok((await page.evaluate(() => window.lakeProbe.camera.z)) >= -6.001);
      if (screenshots) {
        await withPointerLock(page, async () => {
          await turn(page, 1428, -186);
          await capture(page, `lake-${side.id}-looking-back`);
          await turn(page, -1428, 186);
        });
      }
      await walk(page, 's', () => window.lakeProbe.camera.z > -3.9);
      const inside = await page.evaluate(() => window.lakeProbe.camera);
      assert.ok(Math.abs(inside.y - 1.65) < 0.04);
    }

    await travel(page, '湖畔の広間', '広間の中央');
    await walk(page, 's', () => window.lakeProbe.camera.z > 15.92, true);
    assert.ok((await page.evaluate(() => window.lakeProbe.camera.z)) <= 16.201);
    if (screenshots) {
      await capture(page, 'lake-hall-from-rear');
      await withPointerLock(page, async () => {
        await turn(page, 1071);
        await capture(page, 'lake-hall-rear-corner');
        await turn(page, -1071);
      });
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

test('a simulated XR viewer crosses the table footprint at standing height', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await page.addInitScript(installSimulatedXR);
  await goToLake(page);
  await action(page, 'VRを開始').click();
  await page.waitForFunction(() => window.xrFixture.eyePoses[0] && window.xrFixture.eyePoses[320]);
  await page.evaluate(() => window.xrFixture.mutate({ side: 'left', axes: [0, -1] }));
  try {
    await page.waitForFunction(() => {
      const { eyePoses } = window.xrFixture;
      return (eyePoses[0].z + eyePoses[320].z) / 2 < -1.1;
    });
  } finally {
    await page.evaluate(() => window.xrFixture.mutate({ side: 'left', axes: [0, 0] }));
  }
  const height = await page.evaluate(() => {
    const { eyePoses } = window.xrFixture;
    return (eyePoses[0].y + eyePoses[320].y) / 2;
  });
  assert.ok(Math.abs(height - 1.65) < 0.05);
  await action(page, 'VRを終了').click();
  await page.waitForFunction(() => window.xrFixture.ends === 1);
  assert.deepEqual(errors, []);
});

test('lake ambience reaches the output and follows the simulated XR listener', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  await page.addInitScript(installSimulatedXR);
  await page.addInitScript(observeOutput);
  await goToLake(page, '&place=west-window');
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
  assert.ok(Math.hypot(start.x + 18.7, start.y - 1.65, start.z + 5.1) < 0.06);
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
