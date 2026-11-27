import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { installSimulatedXR } from './simulated-xr.mjs';

const screenshotDirectory = process.env.ATRIUM_SCREENSHOTS;
const chromeChannel = process.env.COAST_CHROME_CHANNEL || undefined;
const viewport = chromeChannel || screenshotDirectory ? { width: 1280, height: 800 } : { width: 960, height: 600 };
const timeout = 90_000;
const placePositions = {
  lounge: { x: -2.7, y: 1.20, z: -29.7 },
  concourse: { x: 0, y: 1.65, z: 0 },
  'stair-foot': { x: 2.38, y: 1.65, z: -31.7 },
  'upper-gallery': { x: -9.22, y: 10.80, z: -44.1 },
};
let server;
let browser;
let origin;

before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: chromeChannel ?? 'chromium',
    args: ['--enable-unsafe-swiftshader'],
  });
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    await server?.close();
  }
});

function observeCamera() {
  const probe = { camera: null };
  window.atriumProbe = probe;
  const gl = WebGL2RenderingContext.prototype;
  const cameraUniforms = new WeakSet();
  const getLocation = gl.getUniformLocation;
  const writePosition = gl.uniform3f;
  gl.getUniformLocation = function (program, name) {
    const location = getLocation.call(this, program, name);
    if (location && name === 'cameraPosition') cameraUniforms.add(location);
    return location;
  };
  gl.uniform3f = function (location, x, y, z) {
    if (cameraUniforms.has(location)) probe.camera = { x, y, z };
    return writePosition.call(this, location, x, y, z);
  };
}

function observeAtriumAudio() {
  const probe = {
    context: null, analyser: null, contexts: 0, panners: [], capture: null, captureTimer: 0,
  };
  window.atriumAudioProbe = probe;
  const NativeAudioContext = window.AudioContext;
  const connect = AudioNode.prototype.connect;
  const start = AudioBufferSourceNode.prototype.start;
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) {
      super(...args);
      probe.context = this;
      probe.contexts++;
      probe.analyser = this.createAnalyser();
      probe.analyser.fftSize = 2048;
    }
    createPanner() {
      const panner = super.createPanner();
      probe.panners.push(panner);
      return panner;
    }
  };
  AudioNode.prototype.connect = function (destination, ...args) {
    if (destination === probe.context?.destination) {
      connect.call(this, probe.analyser);
      return connect.call(probe.analyser, destination, ...args);
    }
    return connect.call(this, destination, ...args);
  };
  AudioBufferSourceNode.prototype.start = function (...args) {
    const buffer = this.buffer;
    if (probe.capture && !this.loop && buffer?.numberOfChannels === 1
      && buffer.duration >= 0.19 && buffer.duration <= 0.245) {
      probe.capture.footfalls++;
    }
    return start.apply(this, args);
  };
  probe.peak = () => {
    if (!probe.analyser) return 0;
    const signal = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(signal);
    return Math.max(...signal.map(Math.abs));
  };
  probe.listener = () => {
    const listener = probe.context?.listener;
    if (!listener) return null;
    return {
      x: listener.positionX.value, y: listener.positionY.value, z: listener.positionZ.value,
      fx: listener.forwardX.value, fz: listener.forwardZ.value,
    };
  };
  probe.beginFootstepWindow = () => {
    probe.capture = { peak: 0, footfalls: 0 };
    probe.captureTimer = window.setInterval(() => {
      probe.capture.peak = Math.max(probe.capture.peak, probe.peak());
    }, 8);
  };
  probe.endFootstepWindow = () => {
    window.clearInterval(probe.captureTimer);
    probe.captureTimer = 0;
    const capture = probe.capture;
    probe.capture = null;
    return capture;
  };
}

async function newPage(t) {
  const page = await browser.newPage({ viewport });
  t.after(() => page.close());
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(observeCamera);
  return { page, errors };
}

function button(page, name) {
  return page.getByRole('button', { name, exact: true });
}

async function waitForAtrium(page) {
  await page.getByRole('heading', { name: '商業アトリウム', exact: true }).waitFor();
  await page.locator('canvas.coast-view').waitFor();
  await page.waitForFunction(() => Boolean(window.atriumProbe?.camera));
}

async function camera(page) {
  return page.evaluate(() => window.atriumProbe.camera);
}

async function waitForCameraAt(page, place) {
  const expected = placePositions[place];
  const first = await camera(page);
  try {
    await page.waitForFunction(position => {
      const current = window.atriumProbe.camera;
      return current && Math.hypot(current.x - position.x, current.y - position.y, current.z - position.z) < 0.04;
    }, expected);
  } catch (error) {
    const last = await camera(page);
    const message = [
      `camera did not reach ${place}`,
      `expected=${JSON.stringify(expected)}`,
      `first=${JSON.stringify(first)}`,
      `last=${JSON.stringify(last)}`,
    ].join('; ');
    throw new Error(message, { cause: error });
  }
}

async function travel(page, label, place, time) {
  await button(page, 'ファストトラベル').click();
  const dialog = page.getByRole('dialog', { name: 'ファストトラベル' });
  await dialog.getByRole('button', { name: new RegExp(label) }).click();
  await page.waitForURL(address => address.searchParams.get('world') === 'atrium'
    && address.searchParams.get('place') === place && address.searchParams.get('time') === time);
  await dialog.waitFor({ state: 'hidden' });
  await waitForCameraAt(page, place);
}

async function capture(page, name) {
  if (!screenshotDirectory) return;
  await page.screenshot({
    path: join(screenshotDirectory, `${name}.png`),
    style: '.coast-ui { visibility: hidden !important; }',
  });
}

async function renderedBrightness(page, name) {
  const screenshot = await page.screenshot({
    path: screenshotDirectory ? join(screenshotDirectory, `${name}.png`) : undefined,
    style: '.coast-ui { visibility: hidden !important; }',
  });
  return page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const sample = document.createElement('canvas');
    sample.width = 48;
    sample.height = 36;
    const context = sample.getContext('2d');
    context.drawImage(bitmap, bitmap.width * 0.12, bitmap.height * 0.12,
      bitmap.width * 0.76, bitmap.height * 0.76, 0, 0, sample.width, sample.height);
    bitmap.close();
    const { data } = context.getImageData(0, 0, sample.width, sample.height);
    const luminance = [];
    for (let index = 0; index < data.length; index += 4) {
      luminance.push((data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722));
    }
    luminance.sort((a, b) => a - b);
    const mean = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
    const upperHalf = luminance.slice(Math.floor(luminance.length / 2));
    return {
      mean: Number(mean.toFixed(2)),
      upperHalf: Number((upperHalf.reduce((sum, value) => sum + value, 0) / upperHalf.length).toFixed(2)),
    };
  }, screenshot.toString('base64'));
}

test('atrium starts seated, toggles posture, travels between levels, and walks on the concourse',
  { timeout }, async t => {
    const { page, errors } = await newPage(t);
    await page.goto(`${origin}/?world=atrium`, { waitUntil: 'commit' });
    await waitForAtrium(page);
    assert.equal(await page.locator('h1').textContent(), '商業アトリウム');
    const spawn = await camera(page);
    assert.ok(Math.abs(spawn.x + 2.7) < 0.02);
    assert.ok(Math.abs(spawn.y - 1.20) < 0.02, `default seated eye height: ${spawn.y}`);
    assert.ok(Math.abs(spawn.z + 29.7) < 0.02);
    assert.equal(await page.locator('.coast-mode').textContent(), '座位');
    await capture(page, 'atrium-lounge-seated');

    await page.keyboard.press('c');
    await page.waitForFunction(() => Math.abs(window.atriumProbe.camera.y - 1.65) < 0.02);
    assert.equal(await page.locator('.coast-mode').textContent(), '歩行');
    await page.keyboard.press('c');
    await page.waitForFunction(() => Math.abs(window.atriumProbe.camera.y - 1.20) < 0.02);
    assert.equal(await page.locator('.coast-mode').textContent(), '座位');

    await travel(page, '大階段の前', 'stair-foot', 'day');
    const stairFoot = await camera(page);
    assert.ok(Math.abs(stairFoot.y - 1.65) < 0.02);
    await travel(page, '上階の回廊', 'upper-gallery', 'day');
    const upper = await camera(page);
    assert.ok(Math.abs(upper.y - 10.80) < 0.03, `upper gallery eye height: ${upper.y}`);
    await capture(page, 'atrium-upper-gallery');
    await travel(page, 'ラウンジのソファ', 'lounge', 'day');
    const returned = await camera(page);
    assert.ok(Math.abs(returned.y - 1.20) < 0.02);
    assert.ok(Math.hypot(returned.x - spawn.x, returned.z - spawn.z) < 0.02);

    await travel(page, '正面通路', 'concourse', 'day');
    const concourse = await camera(page);
    assert.ok(Math.abs(concourse.y - 1.65) < 0.02);
    await button(page, 'マウス操作を開始').click();
    await page.waitForFunction(() => document.pointerLockElement?.classList.contains('coast-view'));
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(start => window.atriumProbe.camera.z < start - 0.55, concourse.z);
    } finally {
      await page.keyboard.up('w');
      await page.evaluate(() => document.exitPointerLock());
    }
    const walked = await camera(page);
    assert.ok(Math.abs(walked.y - concourse.y) < 0.03);
    assert.equal(await page.locator('.coast-mode').textContent(), '歩行');
    assert.deepEqual(errors, []);
  });

test('simulated WebXR follows the headset in view and sound and returns to the desktop renderer',
  { timeout }, async t => {
    const { page, errors } = await newPage(t);
    page.setDefaultTimeout(25_000);
    await page.addInitScript(installSimulatedXR);
    await page.addInitScript(observeAtriumAudio);
    await page.goto(`${origin}/?world=atrium&place=upper-gallery&time=night`, { waitUntil: 'commit' });
    await waitForAtrium(page);
    await button(page, '環境音をオン').click();
    await page.waitForFunction(() => window.atriumAudioProbe.peak() > 0.0001);
    await page.evaluate(() => { window.xrFixture.head.yaw = -2.4; });

    await button(page, 'VRを開始').click();
    await page.waitForFunction(() => Boolean(window.xrFixture.eyePoses[0])
      && Boolean(window.xrFixture.eyePoses[320]) && window.xrFixture.frames > 4);
    const session = await page.evaluate(() => ({
      requests: window.xrFixture.requests,
      activation: window.xrFixture.activations,
      features: window.xrFixture.features,
      xrDraws: window.xrFixture.xrDraws,
    }));
    assert.equal(session.requests, 1);
    assert.deepEqual(session.activation, [true]);
    assert.deepEqual(session.features, {
      mode: 'immersive-vr', requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'],
    });
    assert.ok(session.xrDraws > 0, 'the simulated XR frame rendered both views');

    const headsetPose = () => page.evaluate(() => {
      const left = window.xrFixture.eyePoses[0];
      const right = window.xrFixture.eyePoses[320];
      return {
        x: (left.x + right.x) / 2,
        y: (left.y + right.y) / 2,
        z: (left.z + right.z) / 2,
        eyeSpacing: Math.hypot(left.x - right.x, left.z - right.z),
      };
    });
    const start = await headsetPose();
    assert.ok(Math.abs(start.x + 9.22) < 0.03 && Math.abs(start.z + 44.1) < 0.03);
    assert.ok(Math.abs(start.y - 10.80) < 0.03, `XR eye height: ${start.y}`);
    assert.ok(Math.abs(start.eyeSpacing - 0.064) < 0.002);

    const listener = () => page.evaluate(() => window.atriumAudioProbe.listener());
    const originalListener = await listener();
    assert.ok(Math.hypot(originalListener.x - start.x, originalListener.y - start.y,
      originalListener.z - start.z) < 0.03, 'audio originates from the headset position');
    await page.evaluate(() => window.xrFixture.mutate({ head: { yaw: -1.55 } }));
    const turnedListener = await listener();
    const headingDot = originalListener.fx * turnedListener.fx + originalListener.fz * turnedListener.fz;
    assert.ok(Math.abs(headingDot - Math.cos(0.85)) < 0.04, 'the audio listener turns with the headset');
    await page.evaluate(() => window.xrFixture.mutate({ head: { yaw: -2.4 } }));

    await page.evaluate(() => window.xrFixture.mutate({ side: 'left', axes: [0, -1], frames: 8 }));
    await page.evaluate(() => window.xrFixture.mutate({ side: 'left', axes: [0, 0] }));
    const moved = await headsetPose();
    assert.ok(Math.hypot(moved.x - start.x, moved.z - start.z) > 0.25,
      'the left XR stick advances along the upper gallery');
    assert.ok(Math.abs(moved.y - 10.80) < 0.03, `XR movement stays on the upper support: ${moved.y}`);
    const movedListener = await listener();
    assert.ok(Math.hypot(movedListener.x - moved.x, movedListener.y - moved.y,
      movedListener.z - moved.z) < 0.03, 'the moving listener stays at the position of the headset');
    assert.equal(await page.evaluate(() => window.atriumAudioProbe.contexts), 1);

    const desktopDraws = await page.evaluate(() => window.xrFixture.desktopDraws);
    await button(page, 'VRを終了').click();
    await page.waitForFunction(draws => window.xrFixture.ends === 1 && window.xrFixture.desktopDraws > draws,
      desktopDraws);
    assert.equal(await page.evaluate(() => window.xrFixture.strayDraws), 0);
    assert.deepEqual(errors, []);
  });

test('atrium audio reaches the output at the seated listener and keeps footsteps independent',
  { timeout }, async t => {
    const { page, errors } = await newPage(t);
    await page.addInitScript(observeAtriumAudio);
    await page.addInitScript(() => localStorage.removeItem('lumen-pilgrimage:sound'));
    await page.goto(`${origin}/?world=atrium&place=lounge&time=night`, { waitUntil: 'commit' });
    await waitForAtrium(page);
    const seat = await camera(page);
    assert.ok(Math.abs(seat.y - 1.20) < 0.02);

    await button(page, '環境音をオン').click();
    await button(page, '環境音をオフ').waitFor();
    await page.waitForFunction(() => window.atriumAudioProbe.context?.state === 'running'
      && window.atriumAudioProbe.peak() > 0.0001);
    const listener = await page.evaluate(() => window.atriumAudioProbe.listener());
    assert.ok(Math.abs(listener.x + 2.7) < 0.02 && Math.abs(listener.y - 1.20) < 0.02
      && Math.abs(listener.z + 29.7) < 0.02, `seated audio listener: ${JSON.stringify(listener)}`);
    assert.ok(listener.fz > 0.98, 'the seated listener faces the lounge view');
    assert.equal(await page.evaluate(() => window.atriumAudioProbe.contexts), 1);

    await page.locator('.coast-sound-details > summary').click();
    assert.equal(await page.getByRole('slider', { name: '店舗の設備音', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('slider', { name: '共用部の換気音', exact: true }).isVisible(), true);
    await button(page, '歩行音をオフ').click();
    await page.waitForFunction(() => window.atriumAudioProbe.peak() > 0.0001);
    await button(page, '環境音をオフ').click();
    await button(page, '環境音をオン').waitFor();
    await page.waitForFunction(() => window.atriumAudioProbe.peak() < 0.00002, undefined, { timeout: 12_000 });

    await button(page, '歩行音をオン').click();
    await button(page, '歩行音をオフ').waitFor();
    assert.equal(await button(page, '環境音をオン').isVisible(), true);
    await page.keyboard.press('c');
    await page.waitForFunction(() => Math.abs(window.atriumProbe.camera.y - 1.65) < 0.02);
    await button(page, 'マウス操作を開始').click();
    await page.waitForFunction(() => document.pointerLockElement?.classList.contains('coast-view'));
    const start = await camera(page);
    await page.evaluate(() => window.atriumAudioProbe.beginFootstepWindow());
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(z => window.atriumProbe.camera.z > z + 1.0, start.z);
    } finally {
      await page.keyboard.up('w');
      await page.evaluate(() => document.exitPointerLock());
    }
    await page.waitForFunction(() => document.pointerLockElement === null
      && !document.querySelector('#app')?.classList.contains('coast-locked'));
    const footstepCapture = await page.evaluate(() => window.atriumAudioProbe.endFootstepWindow());
    assert.ok(footstepCapture.footfalls > 0, 'walking started a generated footfall sample');
    assert.ok(footstepCapture.peak > 0.00005, `footstep reached the output analyser: ${footstepCapture.peak}`);
    await button(page, '環境音をオン').waitFor();
    assert.deepEqual(errors, []);
    t.diagnostic(`seated listener y=${listener.y}, footfall sources=${footstepCapture.footfalls}, peak=${footstepCapture.peak}`);
  });

test('night lighting changes the rendered atrium from lower and upper viewpoints', { timeout }, async t => {
  const { page, errors } = await newPage(t);
  for (const [place, expectedY] of [['concourse', 1.65], ['upper-gallery', 10.80]]) {
    await page.goto(`${origin}/?world=atrium&place=${place}&time=night`, { waitUntil: 'commit' });
    await waitForAtrium(page);
    await page.waitForFunction(expected => Math.abs(window.atriumProbe.camera.y - expected) < 0.03, expectedY);
    const originalUrl = page.url();
    const automatic = page.getByRole('button', { name: '既定', exact: true });
    const off = page.getByRole('button', { name: '一括消灯', exact: true });
    const on = page.getByRole('button', { name: '一括点灯', exact: true });
    assert.equal(await automatic.getAttribute('aria-pressed'), 'true');

    await off.click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const dark = await renderedBrightness(page, `atrium-${place}-lights-off`);
    await on.click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const lit = await renderedBrightness(page, `atrium-${place}-lights-on`);
    assert.ok(lit.upperHalf - dark.upperHalf > 2.5,
      `${place} lit-scene brightness should rise: ${dark.upperHalf} → ${lit.upperHalf}`);
    assert.equal(await on.getAttribute('aria-pressed'), 'true');
    assert.equal(page.url(), originalUrl);
    t.diagnostic(`${place} upper-half luminance ${dark.upperHalf} → ${lit.upperHalf}; mean ${dark.mean} → ${lit.mean}`);
  }
  assert.deepEqual(errors, []);
});
