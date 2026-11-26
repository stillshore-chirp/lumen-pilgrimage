import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';
import {
  CINEMA_SCREENING_DURATION_SAMPLES, CINEMA_SCREENING_SAMPLE_RATE, createCinemaScreeningFixture, hasFfmpeg,
} from './cinema-screening-fixture.mjs';

const timeout = 90_000;
const ffmpegAvailable = hasFfmpeg();
const fixtureSkip = ffmpegAvailable
  ? false
  : 'ffmpeg unavailable; screening fixtures are generated per run and have no cache.';
let browser;
let server;
let origin;
let fixtureDirectory;
let fixture;

before(async () => {
  if (!ffmpegAvailable) return;
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'lumen-cinema-screening-'));
  fixture = await createCinemaScreeningFixture(fixtureDirectory);
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    channel: process.env.COAST_CHROME_CHANNEL || 'chromium',
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    try {
      await server?.close();
    } finally {
      if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
    }
  }
});

function instrumentScreening() {
  const probe = { live: 0, lamps: null, videoFrames: 0, videoTimestamp: null, outputs: [], earGains: null };
  window.cinemaScreeningTest = probe;

  const gl = WebGL2RenderingContext.prototype;
  const locate = gl.getUniformLocation;
  const uniformFloat = gl.uniform1f;
  const uniformVector = gl.uniform3f;
  const uniforms = new WeakMap();
  gl.getUniformLocation = function (program, name) {
    const location = locate.call(this, program, name);
    if (location && (name === 'cinemaLive' || name === 'cinemaLamps')) uniforms.set(location, name);
    return location;
  };
  gl.uniform1f = function (location, value) {
    if (uniforms.get(location) === 'cinemaLive') probe.live = value;
    return uniformFloat.call(this, location, value);
  };
  gl.uniform3f = function (location, x, y, z) {
    if (uniforms.get(location) === 'cinemaLamps') probe.lamps = [x, y, z];
    return uniformVector.call(this, location, x, y, z);
  };

  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
    if (typeof VideoFrame === 'function' && source instanceof VideoFrame) {
      probe.videoFrames += 1;
      probe.videoTimestamp = source.timestamp;
    }
    return drawImage.call(this, source, ...args);
  };

  const connect = AudioNode.prototype.connect;
  const tapped = new WeakSet();
  AudioNode.prototype.connect = function (destination, ...args) {
    const result = connect.call(this, destination, ...args);
    if (this instanceof GainNode && destination === this.context.destination && !tapped.has(this)) {
      try {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0;
        connect.call(this, analyser);
        probe.outputs.push({ analyser, context: this.context });
        tapped.add(this);
      } catch {
        // The test records only contexts that accept a side-chain analyser.
      }
    }
    return result;
  };
  const send = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, ...args) {
    if (message?.type === 'pose' && message.spatial instanceof Float32Array) {
      probe.earGains = [message.spatial[2], message.spatial[3]];
    }
    return send.call(this, message, ...args);
  };
  probe.readFrequency = (frequency, firstOutput = 0) => Math.max(-160, ...probe.outputs.slice(firstOutput).map(({ analyser, context }) => {
    if (context.state !== 'running') return -160;
    const values = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(values);
    const index = Math.round(frequency * analyser.fftSize / context.sampleRate);
    return values[index] ?? -160;
  }));
}

function installSimulatedXR() {
  const fixture = { requests: 0, ends: 0, frames: 0, yaw: 0 };
  window.xrFixture = fixture;
  const raf = window.requestAnimationFrame.bind(window);
  const cancelRaf = window.cancelAnimationFrame.bind(window);
  const projectionMatrix = new Float32Array([
    1.3, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1.001, -1, 0, 0, -.2, 0,
  ]);
  let presenting = false;

  WebGL2RenderingContext.prototype.makeXRCompatible = async () => {};
  Object.defineProperty(window, 'XRWebGLBinding', { value: undefined, configurable: true });
  window.XRWebGLLayer = class {
    framebuffer = null;
    framebufferWidth = 640;
    framebufferHeight = 480;
    getViewport({ eye }) {
      return { x: eye === 'left' ? 0 : 320, y: 0, width: 320, height: 480 };
    }
  };

  function viewerPose() {
    const center = new DOMMatrix().translate(0, 1.65, 0).rotate(0, fixture.yaw, 0);
    const views = ['left', 'right'].map((eye, index) => ({
      eye,
      projectionMatrix,
      transform: { matrix: center.translate(index === 0 ? -.032 : .032, 0, 0).toFloat32Array() },
    }));
    return { transform: { matrix: center.toFloat32Array() }, views };
  }

  class Session extends EventTarget {
    inputSources = [];
    visibilityState = 'visible';
    async requestReferenceSpace() { return new EventTarget(); }
    updateRenderState() {}
    requestAnimationFrame(callback) {
      return raf(time => {
        presenting = true;
        try {
          callback(time, { session: this, getViewerPose: viewerPose, getPose: () => null });
          fixture.frames += 1;
        } finally {
          presenting = false;
        }
      });
    }
    cancelAnimationFrame(id) { cancelRaf(id); }
    async end() {
      fixture.ends += 1;
      presenting = false;
      this.dispatchEvent(new Event('end'));
    }
  }

  const xr = new EventTarget();
  xr.isSessionSupported = async mode => mode === 'immersive-vr';
  xr.requestSession = async mode => {
    if (mode !== 'immersive-vr') throw new DOMException('', 'NotSupportedError');
    fixture.requests += 1;
    return fixture.session = new Session();
  };
  Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
  window.xrFixture.isPresenting = () => presenting;
}

function button(scope, name) {
  return scope.getByRole('button', { name, exact: true });
}

async function openCinema(t, xr = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(15_000);
  t.after(() => page.context().close());
  const errors = [];
  page.on('pageerror', () => errors.push('page error'));
  page.on('console', message => { if (message.type() === 'error') errors.push('console error'); });
  await page.addInitScript(instrumentScreening);
  if (xr) await page.addInitScript(installSimulatedXR);
  await page.goto(`${origin}/?world=cinema&time=night`);
  await page.getByRole('heading', { name: '映画館シアター（大）' }).waitFor();
  await page.waitForFunction(() => window.cinemaScreeningTest && window.cinemaScreeningTest.lamps);
  return { page, errors };
}

async function loadProgram(page, files, waitUntilReady = true) {
  const dialog = page.getByRole('dialog', { name: '上映設定' });
  if (!(await dialog.isVisible())) await button(page, '上映設定').click();
  await button(dialog, '上映').click();
  const input = dialog.getByLabel('上映素材', { exact: true });
  await input.setInputFiles(files);
  if (waitUntilReady) await page.waitForFunction(() => {
    const slider = document.querySelector('input[aria-label="上映位置"]');
    const message = document.querySelector('#cinema-screening-status')?.textContent ?? '';
    return slider && !slider.disabled && Number(slider.max) > 0
      && message.includes('上映素材を読み込みました');
  });
  return { dialog, slider: page.getByRole('slider', { name: '上映位置', exact: true }) };
}

async function setPosition(slider, sample) {
  await slider.evaluate((element, value) => {
    element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, sample);
}

async function ensureDialogOpen(page, dialog) {
  if (!(await dialog.isVisible())) await button(page, '上映設定').click();
}

async function ensureDialogClosed(dialog) {
  if (await dialog.isVisible()) await button(dialog, '閉じる').click();
}

async function travel(page, label, world, place) {
  await button(page, 'ファストトラベル').click();
  const dialog = page.getByRole('dialog', { name: 'ファストトラベル' });
  await button(dialog, label).click();
  await page.waitForURL(url => url.searchParams.get('world') === world && url.searchParams.get('place') === place);
}

async function audioFrequency(page, frequency = 997, firstOutput = 0) {
  return page.evaluate(([value, start]) => window.cinemaScreeningTest.readFrequency(value, start), [frequency, firstOutput]);
}

test('main screening loads PCM and AVC files, renders and plays them, seeks, pauses and continues through simulated XR', {
  timeout, skip: fixtureSkip,
}, async t => {
  const { page, errors } = await openCinema(t, true);
  await button(page, '上映設定').click();
  const previewDialog = page.getByRole('dialog', { name: '上映設定' });
  await button(previewDialog, '試映を再生').click();
  await page.waitForFunction(() => window.cinemaScreeningTest.live === 1
    && window.cinemaScreeningTest.readFrequency(403) > -70);
  await ensureDialogOpen(page, previewDialog);
  await button(previewDialog, '試映を停止').click();
  const { dialog, slider } = await loadProgram(page, fixture.files);
  const maximum = Number(await slider.getAttribute('max'));
  assert.equal(maximum, CINEMA_SCREENING_DURATION_SAMPLES / CINEMA_SCREENING_SAMPLE_RATE,
    'the timeline exposes the manifest duration in seconds');

  const seekSeconds = Math.min(1, Math.floor(maximum / 2));
  await setPosition(slider, seekSeconds);
  assert.equal(Number(await slider.inputValue()), seekSeconds, 'the timeline seeks to the requested second');
  const framesBeforePlay = await page.evaluate(() => window.cinemaScreeningTest.videoFrames);
  const audioOutputOffset = await page.evaluate(() => window.cinemaScreeningTest.outputs.length);
  await button(dialog, '本編を再生').click();
  await page.waitForFunction(() => window.cinemaScreeningTest.live === 1);
  await page.waitForFunction(seconds => Number(document.querySelector('input[aria-label="上映位置"]').value) > seconds + .08,
    seekSeconds);
  await page.waitForFunction(frames => window.cinemaScreeningTest.videoFrames > frames,
    framesBeforePlay);
  await page.waitForFunction(offset => window.cinemaScreeningTest.outputs.length > offset,
    audioOutputOffset);
  await page.waitForFunction(offset => window.cinemaScreeningTest.readFrequency(997, offset) > -70,
    audioOutputOffset);
  assert.equal(await page.locator('[data-monitor-video]').count(), 0,
    'the feature film uses its own media source, without a monitor capture');

  await ensureDialogClosed(dialog);
  const beforeXR = await page.evaluate(() => window.cinemaScreeningTest.videoTimestamp);
  await button(page, 'VRを開始').click();
  await page.waitForFunction(() => window.xrFixture.frames > 4);
  await page.waitForFunction(timestamp => window.cinemaScreeningTest.videoTimestamp > timestamp + 80_000,
    beforeXR);
  assert.equal(await page.evaluate(() => window.cinemaScreeningTest.live), 1,
    'the feature film remains projected during simulated XR');
  assert.ok(await audioFrequency(page, 997, audioOutputOffset) > -70,
    'the feature film remains audible during simulated XR');
  const straightGains = await page.evaluate(() => {
    window.xrFixture.yaw = 80;
    return window.cinemaScreeningTest.earGains;
  });
  assert.ok(straightGains?.every(Number.isFinite));
  await page.waitForFunction(gains => window.cinemaScreeningTest.earGains?.some(
    (gain, index) => Math.abs(gain - gains[index]) > .05), straightGains);
  await button(page, 'VRを終了').click();
  await page.waitForFunction(() => window.xrFixture.ends === 1);

  await ensureDialogOpen(page, dialog);
  const toneBeforePause = await audioFrequency(page, 997, audioOutputOffset);
  await button(dialog, '本編を一時停止').click();
  const manuallyPaused = Number(await slider.inputValue());
  await page.waitForTimeout(900);
  assert.equal(Number(await slider.inputValue()), manuallyPaused, 'manual pause holds the sample clock');
  assert.ok(await audioFrequency(page, 997, audioOutputOffset) < toneBeforePause - 8,
    'manual pause stops the distinctive object tone');
  const pausedVideoTimestamp = await page.evaluate(() => window.cinemaScreeningTest.videoTimestamp);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.cinemaScreeningTest.videoTimestamp), pausedVideoTimestamp,
    'manual pause freezes the latest decoded video frame');
  await button(dialog, '本編を再生').click();
  await page.waitForFunction(seconds => Number(document.querySelector('input[aria-label="上映位置"]').value) > seconds + .08,
    manuallyPaused);
  await page.waitForFunction(() => window.cinemaScreeningTest.live === 1);
  await ensureDialogOpen(page, dialog);
  const toneBeforeEmergency = await audioFrequency(page, 997, audioOutputOffset);
  await button(dialog, '非常点検').click();
  const emergencyAt = Number(await slider.inputValue());
  await page.waitForFunction(() => window.cinemaScreeningTest.live === 0);
  await page.waitForTimeout(450);
  assert.equal(Number(await slider.inputValue()), emergencyAt, 'emergency inspection pauses the sample clock');
  assert.ok(await audioFrequency(page, 997, audioOutputOffset) < toneBeforeEmergency - 8,
    'emergency inspection stops the distinctive object tone');

  await button(dialog, '上映').click();
  await page.waitForFunction(() => window.cinemaScreeningTest.live === 1);
  await page.waitForFunction(seconds => Number(document.querySelector('input[aria-label="上映位置"]').value) > seconds + .08,
    emergencyAt);
  await page.waitForFunction(offset => window.cinemaScreeningTest.readFrequency(997, offset) > -70,
    audioOutputOffset);

  await button(dialog, '本編を一時停止').click();
  const explicitPauseAt = Number(await slider.inputValue());
  await ensureDialogOpen(page, dialog);
  await button(dialog, '非常点検').click();
  await page.waitForFunction(() => window.cinemaScreeningTest.live === 0);
  await button(dialog, '上映').click();
  await page.waitForFunction(() => window.cinemaScreeningTest.live === 1);
  await page.waitForTimeout(450);
  assert.equal(Number(await slider.inputValue()), explicitPauseAt,
    'restoring the screening mode preserves an explicit user pause');

  await ensureDialogClosed(dialog);
  await travel(page, '後方側席（R20）', 'cinema', 'rear');
  await ensureDialogOpen(page, dialog);
  assert.equal(Number(await slider.inputValue()), explicitPauseAt, 'a seat change retains the playback cursor');
  await ensureDialogClosed(dialog);
  await travel(page, '入り江の浜', 'coast', 'inlet');
  await page.getByRole('heading', { name: '自然景観探索' }).waitFor();
  await travel(page, '中段中央（R09）', 'cinema', 'center');
  await page.getByRole('heading', { name: '映画館シアター（大）' }).waitFor();
  await ensureDialogOpen(page, dialog);
  assert.equal(Number(await slider.inputValue()), explicitPauseAt, 'world travel restores the selected files and cursor');
  const restoredOutputOffset = await page.evaluate(() => window.cinemaScreeningTest.outputs.length);
  await button(dialog, '本編を再生').click();
  await page.waitForFunction(seconds => Number(document.querySelector('input[aria-label="上映位置"]').value) > seconds + .08,
    explicitPauseAt);
  await page.waitForFunction(offset => window.cinemaScreeningTest.readFrequency(997, offset) > -70,
    restoredOutputOffset);

  await button(dialog, '上映素材を閉じる').click();
  await page.waitForFunction(() => window.cinemaScreeningTest.live === 0);
  await page.waitForFunction(() => document.querySelector('#cinema-screening-status')?.textContent.includes('未準備'));
  assert.equal(await slider.isDisabled(), true, 'closing the screening releases the playback controls');
  await ensureDialogClosed(dialog);
  assert.equal(await page.evaluate(() => window.xrFixture.requests), 1);
  assert.deepEqual(errors, []);
});

test('invalid manifests report an accessible error and do not start projection', {
  timeout, skip: fixtureSkip,
}, async t => {
  const { page, errors } = await openCinema(t);
  const { dialog } = await loadProgram(page, [fixture.invalidProgramPath], false);
  const status = dialog.getByRole('status');
  await page.waitForFunction(() => {
    const message = document.querySelector('#cinema-screening-status')?.textContent?.trim() ?? '';
    return message !== '' && !message.includes('読み込んでいます');
  });
  assert.notEqual((await status.textContent()).trim(), '', 'the invalid manifest produces a visible status');
  assert.equal(await button(dialog, '本編を再生').isEnabled(), false, 'invalid media cannot start');
  assert.equal(await page.evaluate(() => window.cinemaScreeningTest.live), 0);
  assert.deepEqual(errors, []);
});
