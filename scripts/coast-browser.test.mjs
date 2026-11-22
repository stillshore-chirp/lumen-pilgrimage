import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';

const screenshotDirectory = process.env.COAST_SCREENSHOTS;
const chromeChannel = process.env.COAST_CHROME_CHANNEL || undefined;
const viewport = chromeChannel || screenshotDirectory ? { width: 1280, height: 800 } : { width: 768, height: 480 };
const lightWidth = Math.floor(viewport.width * 0.8);
const timeout = 65_000;
let server;
let browser;
let url;

before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  url = `http://127.0.0.1:${server.httpServer.address().port}/`;
  browser = await chromium.launch({
    channel: chromeChannel ?? 'chromium',
    args: ['--enable-unsafe-swiftshader'],
  });
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
});

async function newPage() {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(15_000);
  return page;
}

after(async () => {
  try {
    await browser?.close();
  } finally {
    await server?.close();
  }
});

async function capture(page, name) {
  if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, `${name}.png`) });
}

async function sampleRendering(page, quality) {
  if (!screenshotDirectory) return;
  const result = await page.locator('canvas.coast-view').evaluate(async canvas => {
    const gl = canvas.getContext('webgl2');
    const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const frameTimes = [];
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await nextFrame();
    const start = await nextFrame();
    let previous = start;
    while (previous - start < 1800) {
      const now = await nextFrame();
      frameTimes.push(now - previous);
      previous = now;
    }
    const frameRate = frameTimes.length * 1000 / (previous - start);
    const slowFrameTime = frameTimes.slice().sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.95)];
    return {
      renderer: rendererInfo && gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL),
      size: [canvas.width, canvas.height],
      frames: frameTimes.length,
      fps: Number(frameRate.toFixed(1)),
      p95FrameMs: Number(slowFrameTime.toFixed(1)),
    };
  });
  await writeFile(join(screenshotDirectory, `coast-${quality}-rendering.json`), JSON.stringify(result, null, 2) + '\n');
}

function installBrowserProbes() {
  const probe = { context: null, analyser: null, panners: [], delays: [], pad: null, decoded: 0, contexts: 0 };
  window.coastProbe = probe;
  probe.peak = () => {
    const signal = new Float32Array(probe.analyser.fftSize);
    probe.analyser.getFloatTimeDomainData(signal);
    return Math.max(...signal.map(Math.abs));
  };
  const NativeAudioContext = window.AudioContext;
  const connect = AudioNode.prototype.connect;
  window.AudioContext = class extends NativeAudioContext {
    constructor(...args) {
      super(...args);
      probe.contexts++;
      probe.context = this;
      probe.analyser = this.createAnalyser();
      probe.analyser.fftSize = 1024;
    }
    createPanner() {
      const panner = super.createPanner();
      probe.panners.push(panner);
      return panner;
    }
    createDelay(...args) {
      const delay = super.createDelay(...args);
      probe.delays.push(delay);
      return delay;
    }
    async decodeAudioData(buffer, success, failure) {
      const decoded = await super.decodeAudioData(buffer, success, failure);
      probe.decoded++;
      return decoded;
    }
  };
  AudioNode.prototype.connect = function (destination, ...args) {
    if (destination === probe.context?.destination) connect.call(this, probe.analyser);
    return connect.call(this, destination, ...args);
  };
  Object.defineProperty(navigator, 'getGamepads', {
    value: () => [probe.pad, null, null, null],
  });
}

function setPad({ axes = [0, 0, 0, 0], pressed = [], connected = true } = {}) {
  window.coastProbe.pad = connected ? {
    connected,
    id: 'Standard pad (test)',
    index: 0,
    mapping: 'standard',
    timestamp: performance.now(),
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => {
      const down = pressed.includes(index);
      return { pressed: down, touched: down, value: Number(down) };
    }),
  } : null;
}

function audioPosition() {
  const { positionX, positionY, positionZ, forwardX, forwardZ } = window.coastProbe.context.listener;
  return { x: positionX.value, y: positionY.value, z: positionZ.value, fx: forwardX.value, fz: forwardZ.value };
}

function signalLevel() {
  const peak = window.coastProbe.peak();
  return peak > 0.001 && peak < 0.98 ? peak : 0;
}

async function skyBrightness(canvas) {
  return canvas.evaluate(source => new Promise(resolve => requestAnimationFrame(() => {
    const sample = document.createElement('canvas');
    sample.width = 16;
    sample.height = 8;
    const context = sample.getContext('2d');
    context.drawImage(source, source.width * 0.35, source.height * 0.16,
      source.width * 0.30, source.height * 0.15, 0, 0, sample.width, sample.height);
    const { data } = context.getImageData(0, 0, sample.width, sample.height);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
    resolve(total / (sample.width * sample.height * 3));
  })));
}

test('the coast renders, wades, dives, flies, spatializes audio, and resets rendering quality', { timeout }, async () => {
  const page = await newPage();
  const errors = [];
  const recordings = new Set();
  const externalRequests = new Set();
  const appOrigin = new URL(url).origin;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`${message.location().url}: ${message.text()}`);
  });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.includes('/coast-audio/') && response.ok()) recordings.add(path.split('/').at(-1));
  });
  page.on('request', request => {
    const target = new URL(request.url());
    if ((target.protocol === 'http:' || target.protocol === 'https:') && target.origin !== appOrigin) {
      externalRequests.add(target.origin);
    }
  });
  await page.addInitScript(installBrowserProbes);
  try {
    const sceneryAssets = Promise.all([
      'limestone.webp', 'sand.webp', 'cumulus.webp',
      'forest-litter.webp', 'forest-rock.webp', 'forest-mud.webp', 'forest-relief.webp',
      'forest-bark.webp', 'forest-bark-height.webp',
      'scenery/boulder.glb', 'scenery/ferns.glb', 'scenery/moss.glb', 'scenery/shelf.glb',
    ].map(file =>
      page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/coast-materials/${file}`))));
    const [, loadedAssets] = await Promise.all([page.goto(url, { waitUntil: 'commit' }), sceneryAssets]);
    const light = page.getByRole('button', { name: '軽量' });
    const high = page.getByRole('button', { name: '高品質' });
    const flight = page.getByRole('button', { name: '自由飛行' });
    const canvas = page.locator('canvas.coast-view');
    await page.waitForFunction(width => document.querySelector('canvas.coast-view')?.width === width, lightWidth);
    for (const response of loadedAssets) {
      assert.ok(response.ok(), `Scenery asset request failed: ${response.url()}`);
      assert.equal(await response.finished(), null);
    }
    assert.equal(await light.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.coastProbe.context), null);
    const fonts = await page.evaluate(() =>
      ['.coast-title h1', '.coast-mode', '.coast-panel button', '.coast-panel kbd']
        .map(selector => getComputedStyle(document.querySelector(selector)).fontSize));
    assert.deepEqual(fonts, ['38px', '24px', '24px', '22px']);
    await capture(page, 'lagoon-light');

    await page.getByRole('button', { name: '環境音を開始' }).click();
    await page.getByRole('button', { name: '環境音を再開' }).waitFor();
    await page.waitForFunction(signalLevel, undefined, { polling: 100 });
    const graph = () => ({
      contexts: window.coastProbe.contexts,
      contextState: window.coastProbe.context.state,
      decoded: window.coastProbe.decoded,
      delays: window.coastProbe.delays.length,
      panners: window.coastProbe.panners.map(node => [
        node.panningModel, node.distanceModel, node.rolloffFactor,
        node.positionX.value, node.positionY.value,
      ]),
    });
    const initialZ = await page.evaluate(() => {
      window.coastProbe.originalPanners = window.coastProbe.panners.slice();
      return window.coastProbe.panners.map(node => node.positionZ.value);
    });
    const beforeSwitch = await page.evaluate(graph);
    const start = await page.evaluate(audioPosition);
    assert.equal(beforeSwitch.contexts, 1);
    assert.equal(beforeSwitch.contextState, 'running');
    assert.deepEqual([...recordings].sort(), [
      'bush-warbler-calls.ogg', 'forest-birds.ogg', 'gull-calls.ogg', 'insects.ogg', 'rivulet.ogg',
      'shelter-birds.ogg', 'surf.ogg', 'thrush-calls.ogg', 'waterfall.ogg', 'waves.ogg', 'white-eye-calls.ogg',
    ]);
    assert.equal(beforeSwitch.decoded, recordings.size);
    assert.ok(await page.evaluate(() => window.coastProbe.panners.filter(node =>
      node.positionY.value > 18 && node.maxDistance >= 700 && node.panningModel === 'HRTF').length >= 3));
    const positions = beforeSwitch.panners.map((panner, i) => [...panner, initialZ[i]]);
    const reflected = positions.filter(([model, , rolloff, , y]) => model === 'HRTF' && rolloff > 0 && y < 0);
    assert.ok(reflected.length >= 2);
    assert.ok(beforeSwitch.delays > reflected.length, 'rock returns add delays beyond the water reflections');
    assert.ok(reflected.every(([, , , x, y, z]) => positions.some(([, , , dryX, dryY, dryZ]) =>
      x === dryX && -y === dryY && z === dryZ)), 'reflected sources mirror dry sources across the water');
    await page.waitForFunction(z => window.coastProbe.panners.some((node, i) =>
      Math.abs(node.positionZ.value - z[i]) > 0.4), initialZ);
    await sampleRendering(page, 'light');

    await high.click();
    assert.equal(await high.getAttribute('aria-pressed'), 'true');
    assert.equal(await canvas.evaluate(node => node.width), viewport.width);
    const afterGraph = await page.evaluate(graph);
    assert.deepEqual({ ...afterGraph, panners: afterGraph.panners.map(voice => voice.slice(0, 3)) },
      { ...beforeSwitch, panners: beforeSwitch.panners.map(voice => voice.slice(0, 3)) });
    assert.ok(await page.evaluate(() => window.coastProbe.panners.every((node, i) =>
      node === window.coastProbe.originalPanners[i])));
    const afterSwitch = await page.evaluate(audioPosition);
    assert.ok(Math.hypot(start.x - afterSwitch.x, start.y - afterSwitch.y, start.z - afterSwitch.z) < 0.05);
    await capture(page, 'lagoon-high');
    await sampleRendering(page, 'high');
    await light.click();

    const mute = page.getByRole('button', { name: 'ミュート' });
    await mute.click();
    assert.equal(await mute.getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => window.coastProbe.peak() < 0.00001);
    await mute.click();
    await page.waitForFunction(signalLevel, undefined, { polling: 100 });
    const volume = page.getByRole('slider', { name: '音量' });
    await volume.press('Home');
    assert.equal(await volume.inputValue(), '0');
    await page.waitForFunction(() => window.coastProbe.peak() < 0.00001);
    await volume.press('End');
    await page.waitForFunction(signalLevel, undefined, { polling: 100 });
    await page.evaluate(() => window.coastProbe.context.suspend());
    await page.getByRole('button', { name: '環境音を再開' }).click();
    await page.waitForFunction(() => window.coastProbe.context.state === 'running');
    assert.equal(await page.evaluate(() => window.coastProbe.decoded), beforeSwitch.decoded);

    await page.getByRole('button', { name: 'マウス操作を開始' }).click();
    await page.waitForFunction(() => document.pointerLockElement?.classList.contains('coast-view'));
    await page.keyboard.press('Space');
    await page.waitForFunction(y => window.coastProbe.context.listener.positionY.value > y + 0.45, start.y);
    await page.waitForFunction(y => Math.abs(window.coastProbe.context.listener.positionY.value - y) < 0.03, start.y);
    await page.keyboard.down('w');
    await page.waitForFunction(({ x, z }) => {
      const listener = window.coastProbe.context.listener;
      return Math.hypot(listener.positionX.value - x, listener.positionZ.value - z) > 0.8;
    }, start);
    await page.waitForFunction(() => document.querySelector('.coast-mode')?.textContent === '浅瀬');
    await page.waitForFunction(() => document.querySelector('.coast-mode')?.textContent === '遊泳');
    const firstWater = await page.evaluate(audioPosition);
    await page.waitForFunction(z => window.coastProbe.context.listener.positionZ.value < z - 8.0, firstWater.z);
    await page.keyboard.up('w');
    await page.waitForFunction(() => window.coastProbe.context.listener.positionY.value < 0.75);
    const swimming = await page.evaluate(audioPosition);
    assert.ok(swimming.y > 0.4 && swimming.z < start.z - 10);
    await capture(page, 'lagoon-swim');
    await page.keyboard.down('c');
    await page.waitForFunction(() => document.querySelector('.coast-mode')?.textContent === '潜水'
      && window.coastProbe.context.listener.positionY.value < -1.05);
    await page.keyboard.up('c');
    const submerged = await page.evaluate(audioPosition);
    await capture(page, 'lagoon-submerged');
    await page.keyboard.down('w');
    await page.waitForFunction(z => window.coastProbe.context.listener.positionZ.value < z - 2.1, submerged.z);
    await page.keyboard.up('w');
    assert.ok(await page.evaluate(() => window.coastProbe.context.listener.positionY.value < -0.8));
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('.coast-mode')?.textContent === '遊泳'
      && window.coastProbe.context.listener.positionY.value > 0.57);

    await page.evaluate(setPad, { pressed: [1] });
    await page.waitForFunction(() => document.querySelector('.coast-mode')?.textContent === '潜水'
      && window.coastProbe.context.listener.positionY.value < -0.53);
    await page.evaluate(setPad, { pressed: [0] });
    await page.waitForFunction(() => document.querySelector('.coast-mode')?.textContent === '遊泳'
      && window.coastProbe.context.listener.positionY.value > 0.57);
    await page.evaluate(setPad, { connected: false });
    const waterAfterDiving = await page.evaluate(audioPosition);
    await page.keyboard.press('f');
    await page.keyboard.down('Space');
    await page.waitForFunction(y => window.coastProbe.context.listener.positionY.value > y + 4, waterAfterDiving.y);
    await page.keyboard.up('Space');
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.querySelector('.coast-mode')?.textContent === '遊泳');
    const afterSplash = await page.evaluate(audioPosition);
    assert.ok(Math.hypot(afterSplash.x - waterAfterDiving.x, afterSplash.z - waterAfterDiving.z) < 0.1);

    await page.keyboard.down('s');
    await page.waitForFunction(() => document.querySelector('.coast-mode')?.textContent === '歩行');
    await page.keyboard.up('s');
    await canvas.evaluate(node => node.dispatchEvent(new MouseEvent('mousemove', { movementX: 220 })));
    await page.waitForFunction(fx => Math.abs(window.coastProbe.context.listener.forwardX.value - fx) > 0.15, start.fx);
    const walked = await page.evaluate(audioPosition);
    assert.ok(walked.y >= 1.55, 'returning to the beach restores walking height');

    await page.keyboard.press('f');
    await page.waitForFunction(() => document.querySelector('.coast-flight')?.getAttribute('aria-pressed') === 'true');
    await page.keyboard.down('Space');
    const flightHeight = walked.y + (screenshotDirectory ? 9 : 3);
    await page.waitForFunction(y => window.coastProbe.context.listener.positionY.value > y, flightHeight);
    await page.keyboard.up('Space');
    await page.evaluate(() => document.exitPointerLock());
    await flight.waitFor();
    await capture(page, 'lagoon-flight');

    const flown = await page.evaluate(audioPosition);
    await page.evaluate(setPad, { axes: [0.55, -0.6, -0.5, 0], pressed: [1] });
    await page.waitForFunction(({ x, z, fx, y }) => {
      const listener = window.coastProbe.context.listener;
      return Math.hypot(listener.positionX.value - x, listener.positionZ.value - z) > 0.6
        && Math.abs(listener.forwardX.value - fx) > 0.12 && listener.positionY.value < y - 0.5;
    }, flown);
    await page.evaluate(setPad, { pressed: [3] });
    await page.waitForFunction(() => document.querySelector('.coast-flight')?.getAttribute('aria-pressed') === 'false');
    await page.evaluate(setPad, { connected: false });

    await high.click();
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(width => document.querySelector('canvas.coast-view')?.width === width, lightWidth);
    assert.equal(await light.getAttribute('aria-pressed'), 'true');
    assert.equal(await flight.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => window.coastProbe.context), null);
    assert.deepEqual([...externalRequests], []);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('fast travel resets movement, connects the coast and overlook, and preserves rendered time of day', { timeout }, async () => {
  const page = await newPage();
  const travel = page.getByRole('button', { name: 'ファストトラベル' });
  const dialog = page.getByRole('dialog', { name: 'ファストトラベル' });
  const day = page.getByRole('button', { name: '昼', exact: true });
  const night = page.getByRole('button', { name: '夜', exact: true });
  const flight = page.getByRole('button', { name: '自由飛行' });
  const canvas = page.locator('canvas.coast-view');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(installBrowserProbes);

  async function arrive(label, world, place, time) {
    await travel.click();
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await page.waitForURL(address => address.searchParams.get('world') === world
      && address.searchParams.get('place') === place && address.searchParams.get('time') === time,
    { waitUntil: 'commit' });
    await dialog.waitFor({ state: 'hidden' });
    await canvas.waitFor();
  }

  async function walkWithFocus(key, focused) {
    const start = await page.evaluate(audioPosition);
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(({ x, z }) => {
        const listener = window.coastProbe.context.listener;
        return Math.hypot(listener.positionX.value - x, listener.positionZ.value - z) > 0.2;
      }, start);
    } finally {
      await page.keyboard.up(key);
    }
    assert.equal(await focused.evaluate(node => document.activeElement === node
      && document.pointerLockElement === null), true);
  }

  try {
    await page.goto(url, { waitUntil: 'commit' });
    const coastDay = await skyBrightness(canvas);
    assert.equal(await day.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '環境音を開始' }).click();
    await page.getByRole('button', { name: '環境音を再開' }).waitFor();
    await walkWithFocus('w', page.locator('body'));

    const high = page.getByRole('button', { name: '高品質' });
    const light = page.getByRole('button', { name: '軽量' });
    await high.click();
    assert.equal(await high.getAttribute('aria-pressed'), 'true');
    await walkWithFocus('s', high);
    await light.press('Space');
    assert.equal(await light.getAttribute('aria-pressed'), 'true');

    const guide = page.locator('summary').filter({ hasText: '操作方法' });
    const guideDescription = page.locator('.coast-guide-description');
    await guide.press('Space');
    await guideDescription.waitFor({ state: 'visible' });
    await walkWithFocus('w', guide);
    await guide.press('Space');
    await guideDescription.waitFor({ state: 'hidden' });

    await night.click();
    await walkWithFocus('d', night);
    const coastNight = await skyBrightness(canvas);
    assert.ok(coastNight > 5 && coastDay - coastNight > 65, `${coastDay} → ${coastNight}`);
    await capture(page, 'lagoon-night');

    await page.getByRole('button', { name: 'マウス操作を開始' }).click();
    await page.waitForFunction(() => document.pointerLockElement?.matches('canvas.coast-view'));
    await page.keyboard.press('t');
    await dialog.waitFor();
    await page.waitForFunction(() => document.pointerLockElement === null);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });

    await travel.click();
    await dialog.waitFor();
    const paused = await page.evaluate(audioPosition);
    await page.keyboard.down('w');
    try {
      await dialog.getByRole('button', { name: '閉じる' }).press('Space');
      await dialog.waitFor({ state: 'hidden' });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const resumed = await page.evaluate(audioPosition);
      assert.deepEqual([resumed.x, resumed.z], [paused.x, paused.z]);
    } finally {
      await page.keyboard.up('w');
    }
    await walkWithFocus('a', travel);

    await flight.click();
    assert.equal(await flight.getAttribute('aria-pressed'), 'true');
    for (const [label, id, x, z] of [
      ['密林の休憩所', 'forest', -28.05, 108.65],
      ['稜線', 'ridge', -109.9, 973.7],
      ['朱の参道', 'vermilion', 209, 904],
      ['湖畔', 'lake', 86.8, 701.5],
    ]) {
      await arrive(label, 'coast', id, 'night');
      await page.waitForFunction(([expectedX, expectedZ]) => {
        const { positionX, positionZ } = window.coastProbe.context.listener;
        return Math.hypot(positionX.value - expectedX, positionZ.value - expectedZ) < 0.10;
      }, [x, z]);
      assert.equal(await flight.getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('.coast-mode').textContent(), '歩行');
      if (id === 'forest') await walkWithFocus('w', travel);
    }

    await arrive('中央展望デッキ', 'overlook', 'main-deck', 'night');
    await page.getByRole('heading', { name: '丘陵展望台', exact: true }).waitFor();
    assert.equal(await night.getAttribute('aria-pressed'), 'true');
    const townNight = await skyBrightness(canvas);
    await capture(page, 'overlook-night');
    await arrive('西テラス', 'overlook', 'west-terrace', 'night');
    await arrive('東テラス', 'overlook', 'east-terrace', 'night');
    await travel.click();
    assert.equal(await dialog.getByRole('button', { name: /東テラス/ }).getAttribute('aria-current'), 'true');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await day.click();
    const townDay = await skyBrightness(canvas);
    assert.ok(townNight > 6 && townNight < 28, `Overlook night sky: ${townNight}`);
    assert.ok(townDay > 129, `Overlook daylight sky: ${townDay}`);
    await capture(page, 'overlook-east-day');

    await arrive('入り江の浜', 'coast', 'inlet', 'day');
    await page.getByRole('heading', { name: '自然景観探索' }).waitFor();
    assert.equal(await day.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('the overlook plays quiet spatial audio and its upper deck can be reached and left on foot', { timeout }, async () => {
  const page = await newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(installBrowserProbes);
  const button = name => page.getByRole('button', { name, exact: true });

  async function pointStickAt(x, z) {
    const pose = await page.evaluate(audioPosition);
    const distance = Math.hypot(x - pose.x, z - pose.z);
    const horizontal = Math.hypot(pose.fx, pose.fz);
    const dx = (x - pose.x) / distance, dz = (z - pose.z) / distance;
    const fx = pose.fx / horizontal, fz = pose.fz / horizontal;
    // Feed the intended walking vector through the controller's axial deadzone.
    const stick = axis => Math.sign(axis) * (0.16 + Math.abs(axis) * 0.84);
    await page.evaluate(setPad, { axes: [stick(-fz * dx + fx * dz), stick(-(fx * dx + fz * dz)), 0, 0] });
  }

  async function walkTo(x, z) {
    await pointStickAt(x, z);
    try {
      await page.waitForFunction(([x, z]) => {
        const listener = window.coastProbe.context.listener;
        return Math.hypot(listener.positionX.value - x, listener.positionZ.value - z) < 0.27;
      }, [x, z]);
    } finally {
      await page.evaluate(setPad, { connected: false });
    }
  }

  try {
    await page.goto(`${url}?world=overlook&place=east-terrace&time=night`, { waitUntil: 'commit' });
    await button('環境音を開始').waitFor();
    assert.equal(await page.evaluate(() => window.coastProbe.contexts), 0);
    await button('環境音を開始').click();
    await button('環境音を再開').waitFor();
    await page.waitForFunction(() => window.coastProbe.decoded === 3
      && window.coastProbe.panners.filter(panner => panner.panningModel === 'HRTF').length >= 6
      && window.coastProbe.peak() > 0.001 && window.coastProbe.peak() < 0.24);

    const mute = button('ミュート');
    await mute.click();
    assert.equal(await mute.getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => window.coastProbe.peak() < 0.0001);
    await mute.click();
    await button('昼').click();
    await page.waitForFunction(() => window.coastProbe.peak() > 0.001);

    const lower = (await page.evaluate(audioPosition)).y;
    await walkTo(25.85, -4);
    await walkTo(25.85, 4.2);
    assert.ok(Math.abs((await page.evaluate(audioPosition)).y - lower - 3.6) < 0.12);
    await walkTo(25.85, 13.5);
    await walkTo(21, 13.5);
    const upper = await page.evaluate(audioPosition);
    assert.ok(Math.abs(upper.y - lower - 7.2) < 0.12);
    await pointStickAt(upper.x, 9.5);
    await page.waitForFunction(() => window.coastProbe.context.listener.positionZ.value < 12.65);
    await page.waitForTimeout(360);
    await page.evaluate(setPad, { connected: false });
    const rail = await page.evaluate(audioPosition);
    assert.ok(rail.z > 12.30 && Math.abs(rail.y - upper.y) < 0.10);
    await walkTo(21, 13.5);
    await walkTo(25.85, 13.5);
    await walkTo(25.85, -4);
    assert.ok(Math.abs((await page.evaluate(audioPosition)).y - lower) < 0.12);

    await button('夜').click();
    await button('ファストトラベル').click();
    await page.getByRole('dialog').getByRole('button', { name: '2階展望デッキ', exact: true }).click();
    await page.waitForURL(address => address.searchParams.get('place') === 'upper-deck'
      && address.searchParams.get('time') === 'night');
    await page.waitForFunction(expectedHeight => {
      const listener = window.coastProbe.context.listener;
      return Math.hypot(listener.positionX.value - 17.4, listener.positionZ.value - 13.35) < 0.10
        && Math.abs(listener.positionY.value - expectedHeight) < 0.10;
    }, upper.y);
    assert.equal(await page.evaluate(() => window.coastProbe.contexts), 1);
    await capture(page, 'overlook-upper-deck-night');
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('retired expedition URLs open exploration without exposing the old entry', { timeout }, async () => {
  const page = await newPage();
  try {
    await page.goto(`${url}?scene=expedition`, { waitUntil: 'commit' });
    await page.getByRole('heading', { name: '自然景観探索', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: '従来のゲームへ' }).count(), 0);

    await page.goto(`${url}?scene=expedition&world=overlook`, { waitUntil: 'commit' });
    await page.getByRole('heading', { name: '丘陵展望台', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: '従来のゲームへ' }).count(), 0);
  } finally {
    await page.close();
  }
});
