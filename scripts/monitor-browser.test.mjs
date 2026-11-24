import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';

const timeout = 90_000;
const viewport = { width: 1024, height: 680 };
const screenshotDirectory = process.env.COAST_SCREENSHOTS;
const videoSelector = '[data-monitor-video]';
let server;
let browser;
let url;

before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  url = new URL(`http://127.0.0.1:${server.httpServer.address().port}/`);
  browser = await chromium.launch({
    channel: process.env.COAST_CHROME_CHANNEL || 'chromium',
    args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
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

function installSyntheticCapture() {
  // Only the browser picker is substituted. The canvas and oscillator produce native media tracks.
  const fixture = { mode: 'audio-video', streams: [] };
  window.captureFixture = fixture;
  const nativeConstraints = navigator.mediaDevices.getSupportedConstraints.bind(navigator.mediaDevices);
  Object.defineProperty(navigator.mediaDevices, 'getSupportedConstraints', {
    value: () => ({ ...nativeConstraints(), displaySurface: true, suppressLocalAudioPlayback: true }),
  });
  Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
    value: async options => {
      if (fixture.mode === 'denied') throw new DOMException('', 'NotAllowedError');
      const mode = fixture.mode;
      fixture.activeGesture = navigator.userActivation.isActive;

      const canvas = document.createElement('canvas');
      canvas.width = mode === 'video-only' ? 180 : 320;
      canvas.height = mode === 'video-only' ? 320 : 180;
      const context = canvas.getContext('2d');
      let frame = 0;
      const draw = () => {
        if (fixture.cinemaFrame) {
          const left = fixture.cinemaFrame === 'warm-left';
          const dark = fixture.cinemaFrame === 'black';
          context.fillStyle = dark ? '#000' : left ? '#e9ad73' : '#344d77';
          context.fillRect(0, 0, canvas.width / 2, canvas.height);
          context.fillStyle = dark ? '#000' : left ? '#344d77' : '#e9ad73';
          context.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
          return;
        }
        context.fillStyle = '#ff00d8';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#00e68c';
        context.fillRect((frame++ * 8) % canvas.width, 12, 18, 22);
      };
      draw();
      const stream = canvas.captureStream(15);
      const videoTrack = stream.getVideoTracks()[0];
      if (mode === 'tab-audio-video') {
        const settings = videoTrack.getSettings();
        Object.defineProperty(videoTrack, 'getSettings', { value: () => ({ ...settings, displaySurface: 'browser' }) });
      }
      const timer = setInterval(() => {
        if (videoTrack.readyState === 'ended') clearInterval(timer);
        else draw();
      }, 55);
      fixture.streams.push(stream);
      fixture.options = options;

      if (mode === 'audio-video' || mode === 'tab-audio-video') {
        const audio = new AudioContext();
        const gain = audio.createGain();
        gain.gain.value = 0.2;
        const oscillator = audio.createOscillator();
        oscillator.frequency.value = 720;
        const output = audio.createMediaStreamDestination();
        oscillator.connect(gain).connect(output);
        oscillator.start();
        await audio.resume();
        const track = output.stream.getAudioTracks()[0];
        if (mode === 'tab-audio-video') {
          const settings = track.getSettings();
          const suppressed = options.audio.suppressLocalAudioPlayback === true;
          Object.defineProperty(track, 'getSettings', { value: () => ({ ...settings, suppressLocalAudioPlayback: suppressed }) });
        }
        stream.addTrack(track);
        const cleanup = setInterval(() => {
          if (track.readyState !== 'ended') return;
          clearInterval(cleanup);
          oscillator.stop();
          void audio.close();
        }, 100);
      }
      if (mode === 'held') await new Promise(resolve => { fixture.resolveCapture = resolve; });
      return stream;
    },
  });
}

function observePeers() {
  const NativePeer = window.RTCPeerConnection;
  const peers = [];
  window.monitorPeers = peers;
  window.RTCPeerConnection = class extends NativePeer {
    constructor(...args) {
      super(...args);
      peers.push(this);
    }
  };
}

function observeAudio() {
  const NativeContext = window.AudioContext;
  const connect = AudioNode.prototype.connect;
  const contexts = [];
  window.monitorSound = {
    read() {
      return contexts.map(({ context, analyser, panners, gains, hasStream }) => {
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        return {
          hasStream,
          streamSources: context.probe.streamSources,
          state: context.state,
          peak: Math.max(...data.map(Math.abs)),
          stereo: gains.get('stereo')?.gain.value,
          spatial: gains.get('spatial')?.gain.value,
          surround: gains.get('surround')?.gain.value,
          panners: panners.map(({ positionX, positionY, positionZ, panningModel }) =>
            [positionX.value, positionY.value, positionZ.value, panningModel]),
        };
      });
    },
  };
  window.AudioContext = class extends NativeContext {
    constructor(...args) {
      super(...args);
      this.probe = {
        context: this, analyser: this.createAnalyser(), gains: new Map(), panners: [], hasStream: false, streamSources: 0,
      };
      contexts.push(this.probe);
    }
    createMediaStreamSource(stream) {
      this.probe.hasStream = stream.getAudioTracks().length > 0;
      this.probe.streamSources++;
      return super.createMediaStreamSource(stream);
    }
    createPanner() {
      const panner = super.createPanner();
      this.probe.panners.push(panner);
      return panner;
    }
  };
  AudioNode.prototype.connect = function (destination, ...args) {
    if (destination === this.context.destination) connect.call(this, this.context.probe.analyser);
    if (destination instanceof GainNode) {
      const { gains, panners, hasStream } = this.context.probe;
      if (this instanceof MediaStreamAudioSourceNode && destination.channelCount === 2) gains.set('stereo', destination);
      if (this instanceof PannerNode && hasStream) {
        gains.set(this === panners[0] ? 'spatial' : 'surround', destination);
      }
    }
    return connect.call(this, destination, ...args);
  };
}

function installSimulatedXR() {
  const fixture = { requests: 0, ends: 0, xrDraws: 0, desktopDraws: 0, strayDraws: 0 };
  window.xrFixture = fixture;
  const raf = window.requestAnimationFrame.bind(window);
  const cancelRaf = window.cancelAnimationFrame.bind(window);
  let presenting = false;
  let inXRFrame = false;

  const drawElements = WebGL2RenderingContext.prototype.drawElements;
  WebGL2RenderingContext.prototype.drawElements = function (...args) {
    if (inXRFrame) ++fixture.xrDraws;
    else if (presenting) ++fixture.strayDraws;
    else ++fixture.desktopDraws;
    return drawElements.apply(this, args);
  };
  WebGL2RenderingContext.prototype.makeXRCompatible = async () => {};
  Object.defineProperty(window, 'XRWebGLBinding', { value: undefined, configurable: true });
  window.XRWebGLLayer = class {
    framebuffer = null;
    framebufferWidth = 640;
    framebufferHeight = 480;
    getViewport() { return { x: 0, y: 0, width: this.framebufferWidth, height: this.framebufferHeight }; }
  };

  const transform = { matrix: new DOMMatrix().translate(0, 1.65, 0).toFloat32Array() };
  const projectionMatrix = new Float32Array([
    1.3, 0, 0, 0, 0, 1.73, 0, 0, 0, 0, -1.001, -1, 0, 0, -.2, 0,
  ]);
  const viewingPose = { transform, views: [{ eye: 'left', transform, projectionMatrix }] };
  class Session extends EventTarget {
    inputSources = [];
    visibilityState = 'visible';
    async requestReferenceSpace() { return {}; }
    updateRenderState() {}
    requestAnimationFrame(callback) {
      return raf(time => {
        presenting = inXRFrame = true;
        try {
          callback(time, { session: this, getViewerPose: () => viewingPose });
        } finally {
          inXRFrame = false;
        }
      });
    }
    cancelAnimationFrame(id) { cancelRaf(id); }
    async end() {
      ++fixture.ends;
      presenting = false;
      this.dispatchEvent(new Event('end'));
    }
  }
  const xr = new EventTarget();
  xr.isSessionSupported = async () => true;
  xr.requestSession = async () => {
    ++fixture.requests;
    return new Session();
  };
  Object.defineProperty(navigator, 'xr', { value: xr });
}

async function newPage() {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(12_000);
  return page;
}

async function setSliderValue(page, name, value) {
  await page.getByRole('slider', { name, exact: true }).evaluate((slider, nextValue) => {
    slider.value = String(nextValue);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

function button(page, name) {
  return page.getByRole('button', { name, exact: true });
}

async function requestPairing(sender, viewer) {
  const previousSenderPeers = await sender.evaluate(() => window.monitorPeers.length);
  const previousViewerPeers = await viewer.evaluate(() => window.monitorPeers.length);
  await button(sender, '画面共有を開始').click();
  await sender.waitForFunction(() => Boolean(document.querySelector('[data-monitor-pair-code]')?.textContent));
  const pairCode = await sender.evaluate(() => document.querySelector('[data-monitor-pair-code]')?.textContent);
  assert.ok(pairCode?.trim(), 'a fresh pairing code is available');

  const input = viewer.getByLabel('接続コード', { exact: true });
  await input.waitFor();
  // Keep temporary pairing credentials out of assertion output and action logs.
  await input.evaluate((node, value) => {
    node.value = value.trim();
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, pairCode);
  await button(viewer, '接続').click();
  await button(sender, '接続を許可').waitFor();

  await viewer.waitForFunction(() => Boolean(document.querySelector('[data-monitor-verification]')?.textContent));
  const verification = await sender.evaluate(() => document.querySelector('[data-monitor-verification]')?.textContent?.trim());
  const confirmed = await viewer.evaluate(value =>
    document.querySelector('[data-monitor-verification]')?.textContent?.trim() === value, verification);
  assert.ok(verification && confirmed,
    'the sender and viewer display the same verification number');
  assert.equal(await sender.evaluate(() => window.monitorPeers.length), previousSenderPeers);
  assert.equal(await viewer.evaluate(() => window.monitorPeers.length), previousViewerPeers);
  assert.equal(await viewer.locator(videoSelector).evaluate(video => video.srcObject), null);
}

async function waitForVideo(viewer, expectedAudioTracks, [width, height] = [320, 180]) {
  await viewer.waitForFunction(({ selector, expectedAudioTracks }) => {
    const video = document.querySelector(selector);
    return video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime > 0.15
      && video.getVideoPlaybackQuality().totalVideoFrames > 1
      && video.srcObject?.getAudioTracks().length === expectedAudioTracks;
  }, { selector: videoSelector, expectedAudioTracks });
  const playback = await viewer.locator(videoSelector).evaluate(video => ({
    width: video.videoWidth,
    height: video.videoHeight,
    muted: video.muted,
    playsInline: video.playsInline,
    frames: video.getVideoPlaybackQuality().totalVideoFrames,
  }));
  assert.equal(playback.width, width);
  assert.equal(playback.height, height);
  assert.equal(playback.muted, true);
  assert.equal(playback.playsInline, true);
  assert.ok(playback.frames > 1, 'Chrome decoded successive native WebRTC video frames');
}

async function screenPixels(viewer, file) {
  const path = screenshotDirectory && file ? join(screenshotDirectory, `${file}.png`) : undefined;
  // Measure only what the scene renders. Controls can overlap the projected monitor.
  const screenshot = await viewer.screenshot({ path, style: '.coast-ui { visibility: hidden !important }' });
  return viewer.evaluate(async encoded => {
    const binary = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([binary], { type: 'image/png' }));
    const { width, height } = bitmap;
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const context = sample.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = context.getImageData(0, 0, width, height);
    let count = 0;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const index = (y * width + x) * 4;
        if (data[index] < 180 || data[index + 1] > 60 || data[index + 2] < 145) continue;
        count += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    return { count, width: right - left, height: bottom - top, x: (left + right) / 2, y: (top + bottom) / 2 };
  }, screenshot.toString('base64'));
}

async function drag(viewer, point, dx, dy) {
  await viewer.mouse.move(point.x, point.y);
  await viewer.mouse.down();
  try {
    await viewer.mouse.move(point.x + dx, point.y + dy, { steps: 4 });
  } finally {
    await viewer.mouse.up();
  }
}

async function waitForMix(viewer, { natural, monitor, spatial }) {
  await viewer.waitForFunction(({ natural, monitor, spatial }) => {
    const contexts = window.monitorSound.read();
    const scenery = contexts.find(context => !context.hasStream);
    const screen = contexts.find(context => context.hasStream);
    const matches = ({ peak, state }, audible) =>
      audible ? state === 'running' && peak > 0.001 : state === 'closed' || peak < 0.0001;
    if (!scenery || !screen || !matches(scenery, natural) || !matches(screen, monitor)) return false;
    if (spatial === undefined) return true;
    // The two native branch gains settle at 1 and 0 after crossfade.
    return spatial ? screen.spatial > 0.98 && screen.stereo < 0.02 : screen.stereo > 0.98 && screen.spatial < 0.02;
  }, { natural, monitor, spatial }, { polling: 100 });
}

test('separate tabs pair with approval, render native WebRTC media and control audio and placement', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
  const errors = [];
  sender.on('pageerror', () => errors.push('sender'));
  viewer.on('pageerror', () => errors.push('viewer'));
  try {
    await Promise.all([
      sender.addInitScript(installSyntheticCapture),
      sender.addInitScript(observePeers),
      viewer.addInitScript(observePeers),
      viewer.addInitScript(observeAudio),
    ]);
    await sender.goto(new URL('?monitor=sender', url).href);
    await viewer.goto(url.href);
    // Set the shared master before the monitor view is lazily created.
    await setSliderValue(viewer, '全体音量', 0);
    await button(viewer, '仮想モニター').click();
    await viewer.getByRole('region', { name: '仮想モニターの操作' }).waitFor();
    await button(viewer, 'モニターを表示').click();

    await requestPairing(sender, viewer);
    const captureRequest = await sender.evaluate(() => {
      const { activeGesture, options } = window.captureFixture;
      return { activeGesture, video: options.video, requestedAudio: Boolean(options.audio) };
    });
    assert.deepEqual(captureRequest, { activeGesture: true, video: true, requestedAudio: true });
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    assert.deepEqual(await viewer.evaluate(() =>
      window.monitorPeers.map(peer => peer.connectionState)), ['connected']);
    assert.deepEqual(await sender.evaluate(() =>
      window.monitorPeers[0].getSenders().map(sender => sender.track.kind).sort()), ['audio', 'video']);

    const original = await screenPixels(viewer, 'monitor-video');
    assert.ok(original.count > 2_000, 'synthetic frame pixels are rendered in the scenery');
    assert.ok(Math.abs(original.width / original.height - 16 / 9) < 0.15, 'scene preserves the video aspect ratio');

    await button(viewer, '仮想モニター').click();
    await button(viewer, '環境音をオン').click();
    await button(viewer, '仮想モニター').click();
    const enableAudio = button(viewer, 'モニター音を有効にする');
    if (await enableAudio.isEnabled()) await enableAudio.click();
    await waitForMix(viewer, { natural: false, monitor: false });
    await setSliderValue(viewer, '全体音量', 100);
    await waitForMix(viewer, { natural: true, monitor: true });
    // Simulate persisted pageshow to observe the master callback on an existing monitor.
    await viewer.evaluate(() => {
      const key = 'lumen-pilgrimage:sound';
      const saved = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ ...saved, master: 0 }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await waitForMix(viewer, { natural: false, monitor: false });
    await setSliderValue(viewer, '全体音量', 100);
    await waitForMix(viewer, { natural: true, monitor: true });
    const monitorMute = button(viewer, 'モニター音をミュート');
    await button(viewer, '仮想モニター').click();
    await button(viewer, '環境音をオフ').click();
    await waitForMix(viewer, { natural: false, monitor: true });
    await button(viewer, '環境音をオン').click();
    await waitForMix(viewer, { natural: true, monitor: true });
    await button(viewer, '歩行音をオフ').click();
    await waitForMix(viewer, { natural: true, monitor: true });
    await button(viewer, '歩行音をオン').click();
    await button(viewer, '仮想モニター').click();
    await monitorMute.click();
    assert.equal(await monitorMute.getAttribute('aria-pressed'), 'true');
    await waitForMix(viewer, { natural: true, monitor: false });
    await monitorMute.click();

    const volume = viewer.getByRole('slider', { name: 'モニター音量' });
    await volume.press('Home');
    await waitForMix(viewer, { natural: true, monitor: false });
    await volume.press('End');
    await waitForMix(viewer, { natural: true, monitor: true });

    const audioOutput = sender.getByRole('combobox', { name: '音声の出力先' });
    await audioOutput.selectOption('pc');
    await sender.waitForFunction(() => !window.captureFixture.streams[0].getAudioTracks()[0].enabled);
    await waitForMix(viewer, { natural: true, monitor: false });
    await audioOutput.selectOption('both');
    await sender.waitForFunction(() => window.captureFixture.streams[0].getAudioTracks()[0].enabled);
    await waitForMix(viewer, { natural: true, monitor: true });
    await audioOutput.selectOption('viewer');
    await sender.locator('[data-monitor-capture-audio]').filter({ hasText: /現在は「両方」/ }).waitFor();
    await waitForMix(viewer, { natural: true, monitor: true });

    const audioMode = viewer.getByRole('combobox', { name: 'モニターの音響' });
    await audioMode.selectOption('spatial');
    await waitForMix(viewer, { natural: true, monitor: true, spatial: true });
    const monitorPanel = button(viewer, '仮想モニター');
    await monitorPanel.click();
    await button(viewer, '高品質').click();
    await waitForMix(viewer, { natural: true, monitor: true, spatial: true });
    assert.equal(await viewer.evaluate(() => window.monitorSound.read().length), 2);
    await button(viewer, '軽量').click();
    await monitorPanel.click();
    const spatialBeforeDrag = await viewer.evaluate(() =>
      window.monitorSound.read().find(context => context.hasStream).panners[0]);
    assert.equal(spatialBeforeDrag[3], 'HRTF');

    const edit = button(viewer, '配置を編集');
    const reset = button(viewer, '位置・サイズを戻す');
    await edit.click();
    assert.equal(await edit.getAttribute('aria-pressed'), 'true');
    await button(viewer, '移動').click();
    await drag(viewer, original, 72, -24);
    const moved = await screenPixels(viewer, 'monitor-moved');
    assert.ok(moved.x > original.x + 35 && moved.y < original.y - 10, 'the mouse drag repositions the scene object');
    await viewer.waitForFunction(previous => {
      const panner = window.monitorSound.read().find(context => context.hasStream)?.panners[0];
      return panner && Math.hypot(panner[0] - previous[0], panner[1] - previous[1], panner[2] - previous[2]) > 0.1;
    }, spatialBeforeDrag);
    await reset.click();
    await button(viewer, '回転').click();
    await drag(viewer, original, 105, -25);
    const rotated = await screenPixels(viewer, 'monitor-rotated');
    assert.ok(rotated.count > 1_000 && Math.abs(rotated.width - original.width) > 25,
      'mouse rotation changes the screen projection');
    await reset.click();
    await button(viewer, '拡大縮小').click();
    await drag(viewer, original, 65, -20);
    const resized = await screenPixels(viewer, 'monitor-resized');
    assert.ok(resized.width > original.width * 1.20, 'mouse scaling increases the projected screen size');
    await reset.click();
    const restored = await screenPixels(viewer);
    assert.ok(Math.abs(restored.width - original.width) <= 4 && Math.abs(restored.x - original.x) <= 4,
      'reset restores the display position and size');
    assert.ok(await viewer.evaluate(() => document.pointerLockElement === null));

    await audioMode.selectOption('stereo');
    await waitForMix(viewer, { natural: true, monitor: true, spatial: false });
    await button(viewer, 'モニターを隠す').click();
    assert.equal((await screenPixels(viewer)).count, 0);
    await button(viewer, 'モニターを表示').click();
    assert.ok((await screenPixels(viewer)).count > 2_000);
    if (await edit.getAttribute('aria-pressed') === 'true') await edit.click();
    assert.equal(await edit.getAttribute('aria-pressed'), 'false');
    await viewer.bringToFront();
    await button(viewer, 'マウス操作を開始').click();
    await viewer.waitForFunction(() => document.pointerLockElement?.matches('canvas.coast-view'));
    await viewer.evaluate(() => document.exitPointerLock());

    await button(sender, '共有を停止').click();
    const viewerStatus = viewer.locator('[data-monitor-status]');
    await viewerStatus.filter({ hasText: /切断|終了|停止/ }).waitFor();
    await viewer.waitForFunction(selector => document.querySelector(selector)?.srcObject === null, videoSelector);
    assert.ok(await sender.evaluate(() => window.captureFixture.streams[0].getTracks().every(track => track.readyState === 'ended')));
    assert.ok(await sender.evaluate(() => window.monitorPeers[0].signalingState === 'closed'));
    assert.ok(await viewer.evaluate(() => window.monitorPeers[0].signalingState === 'closed'));
    await waitForMix(viewer, { natural: true, monitor: false });
    assert.equal((await screenPixels(viewer)).count, 0);
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all([sender.context().close(), viewer.context().close()]);
  }
});

test('residence and cinema transfer one live WebRTC stream to a floating monitor in each destination', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
  viewer.setDefaultTimeout(25_000);
  const errors = [];
  viewer.on('pageerror', () => errors.push('viewer'));
  try {
    await Promise.all([
      sender.addInitScript(installSyntheticCapture),
      sender.addInitScript(observePeers),
      viewer.addInitScript(observePeers),
      viewer.addInitScript(observeAudio),
      viewer.addInitScript(installSimulatedXR),
    ]);
    await sender.goto(new URL('?monitor=sender', url).href);
    await viewer.goto(new URL('?world=residence&place=living-theater&time=day', url).href);
    await button(viewer, '仮想モニター').click();
    const target = viewer.getByRole('combobox', { name: '表示先' });
    const mode = viewer.getByRole('combobox', { name: 'モニターの音響' });
    await target.selectOption('television');
    assert.equal(await button(viewer, '配置を編集').isDisabled(), true);

    await requestPairing(sender, viewer);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    const active = await screenPixels(viewer, 'residence-television');
    assert.ok(active.width > viewport.width * .4 && active.width < viewport.width * .55,
      'the shared video fills the enlarged television from the theater travel position');
    assert.ok(Math.abs(active.width / active.height - 16 / 9) < .15);
    const video = viewer.locator(videoSelector);
    await video.evaluate(element => { window.originalMonitorStream = element.srcObject; });

    const enableAudio = button(viewer, 'モニター音を有効にする');
    if (await enableAudio.isEnabled()) await enableAudio.click();
    await mode.selectOption('television');
    await viewer.waitForFunction(() => {
      const audio = window.monitorSound.read().find(context => context.hasStream);
      const source = audio?.panners[0];
      return audio?.spatial > .98 && audio.peak > .001
        && Math.abs(source[0] - 19.99) < .02 && Math.abs(source[2] + 6.49) < .02 && source[3] === 'HRTF';
    });

    await mode.selectOption('surround');
    await viewer.waitForFunction(() => {
      const audio = window.monitorSound.read().find(context => context.hasStream);
      return audio?.surround > .98 && audio.stereo < .02 && audio.spatial < .02 && audio.peak > .001;
    });
    const speakers = await viewer.evaluate(() =>
      window.monitorSound.read().find(context => context.hasStream).panners.slice(1));
    assert.equal(speakers.length, 6);
    assert.ok(speakers.every(source => source[3] === 'HRTF'));
    assert.ok(speakers.slice(0, 4).every(source => source[2] < -6));
    assert.ok(speakers.slice(4).every(source => source[2] > -2));

    await button(viewer, 'モニター音をミュート').click();
    await viewer.waitForFunction(() => window.monitorSound.read().find(context => context.hasStream)?.peak < .0001);
    await button(viewer, 'モニター音をミュート').click();
    await target.selectOption('floating');
    assert.equal(await button(viewer, '配置を編集').isEnabled(), true);
    assert.equal(await mode.inputValue(), 'surround');
    const floating = await screenPixels(viewer);
    assert.ok(floating.count > 2_000 && Math.abs(floating.y - active.y) > 12,
      'the same video is visible at the floating monitor position');
    await target.selectOption('television');
    assert.ok(Math.abs((await screenPixels(viewer)).width - active.width) <= 4);
    assert.equal(await video.evaluate(element => element.srcObject === window.originalMonitorStream), true);
    assert.deepEqual(await viewer.evaluate(() => window.monitorPeers.map(peer => peer.connectionState)), ['connected']);

    await mode.selectOption('stereo');
    await viewer.waitForFunction(() => {
      const audio = window.monitorSound.read().find(context => context.hasStream);
      return audio?.stereo > .98 && audio.spatial < .02 && audio.surround < .02 && audio.peak > .001;
    });
    await button(viewer, 'テレビの表示を切る').click();
    assert.equal((await screenPixels(viewer)).count, 0);

    await button(viewer, 'テレビに表示').click();
    await mode.selectOption('surround');
    await setSliderValue(viewer, '全体音量', 125);
    await viewer.locator('[data-monitor-volume]').evaluate(input => {
      input.value = '50';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await viewer.evaluate(selector => {
      const video = document.querySelector(selector);
      window.sharedMonitor = {
        video, peer: window.monitorPeers[0], canvas: document.querySelector('.coast-view'),
        stream: video.srcObject, tracks: video.srcObject.getTracks(),
      };
    }, videoSelector);

    async function selectDestination(label) {
      await button(viewer, 'ファストトラベル').click();
      await button(viewer.getByRole('dialog', { name: 'ファストトラベル' }), label).click();
    }

    async function travelTo(label, world, place) {
      await selectDestination(label);
      await waitForArrival(world, place);
    }

    async function waitForArrival(world, place) {
      await viewer.waitForURL(address => address.searchParams.get('world') === world
        && address.searchParams.get('place') === place && address.searchParams.get('time') === 'day');
      const title = { cinema: '映画館シアター（大）', coast: '自然景観探索', residence: '都心の70階住戸' };
      await viewer.getByRole('heading', { name: title[world], exact: true }).waitFor();
      await viewer.waitForFunction(() => document.activeElement === document.querySelector('.coast-view'));
      assert.equal(await viewer.locator('.coast-view').count(), 1);
      await button(viewer, '仮想モニター').click();
    }

    async function assertPlaybackContinues(beforeTravel, muted = false) {
      assert.equal(await viewer.evaluate(selector => {
        const { video, peer, canvas, stream, tracks } = window.sharedMonitor;
        return video === document.querySelector(selector) && video.srcObject === stream
          && canvas === document.querySelector('.coast-view') && window.monitorPeers.length === 1
          && window.monitorPeers[0] === peer && peer.connectionState === 'connected'
          && stream.getTracks().every(track => tracks.includes(track) && track.readyState === 'live');
      }, videoSelector), true, 'world change preserves the receiver, tracks, media element and canvas');
      await viewer.waitForFunction(({ selector, beforeTravel, muted }) => {
        const video = document.querySelector(selector);
        const audio = window.monitorSound.read().filter(context => context.hasStream);
        return video.currentTime > beforeTravel + .1 && audio.length === 1 && audio[0].streamSources === 1
          && audio[0].state === 'running' && (muted ? audio[0].peak < .0001 : audio[0].peak > .001);
      }, { selector: videoSelector, beforeTravel, muted });
      assert.equal(await viewer.locator('[data-monitor-volume]').inputValue(), '50');
      assert.equal(await viewer.getByRole('slider', { name: '全体音量', exact: true }).inputValue(), '125');
      assert.equal(await button(viewer, 'モニターを隠す').isVisible(), true);
      assert.equal(await button(viewer, '配置を編集').isEnabled(), true);
      assert.ok((await screenPixels(viewer)).count > 2_000, 'shared video is drawn at the new viewpoint');
    }

    const beforeFailure = viewer.url();
    const terrain = '**/coast-overlook/overlook-elevation.bin';
    await viewer.route(terrain, route => route.fulfill({ contentType: 'application/octet-stream', body: 'invalid terrain' }),
      { times: 1 });
    await selectDestination('中央展望デッキ');
    await viewer.locator('.coast-travel-status').filter({ hasText: '読み込めませんでした' }).waitFor();
    assert.equal(viewer.url(), beforeFailure, 'failed target loading leaves the active world URL in place');
    await viewer.waitForFunction(selector => document.querySelector(selector)?.srcObject === window.sharedMonitor.stream
      && window.sharedMonitor.peer.connectionState === 'connected', videoSelector);

    const requestedTerrain = Promise.withResolvers();
    const resumeTerrain = Promise.withResolvers();
    await viewer.route(terrain, async route => {
      requestedTerrain.resolve();
      await resumeTerrain.promise;
      await route.continue();
    }, { times: 1 });
    await selectDestination('中央展望デッキ');
    await requestedTerrain.promise;
    let beforeTravel = await video.evaluate(element => element.currentTime);
    try {
      await travelTo('中段中央（R09）', 'cinema', 'center');
    } finally {
      resumeTerrain.resolve();
    }
    assert.equal(await target.inputValue(), 'floating');
    assert.equal(await mode.inputValue(), 'stereo');
    await assertPlaybackContinues(beforeTravel);

    const cinemaUrl = viewer.url();
    await viewer.route(terrain, route => route.fulfill({ contentType: 'application/octet-stream', body: 'invalid terrain' }),
      { times: 1 });
    await viewer.evaluate(() => history.back());
    await viewer.locator('.coast-travel-status').filter({ hasText: '読み込めませんでした' }).waitFor();
    await viewer.waitForURL(cinemaUrl);
    await viewer.evaluate(() => history.back());
    await waitForArrival('residence', 'living-theater');
    assert.equal(viewer.url(), beforeFailure, 'a failed Back preserves the destination for retry');
    assert.equal(await target.inputValue(), 'floating');
    await viewer.evaluate(() => history.forward());
    await waitForArrival('cinema', 'center');
    assert.equal(viewer.url(), cinemaUrl);

    // Assign the transferred stream to the cinema screen and leave with that room's audio path active.
    await target.selectOption('television');
    await mode.selectOption('cinema');
    assert.ok((await screenPixels(viewer)).count > 8_000);
    await button(viewer, 'モニター音をミュート').click();
    beforeTravel = await video.evaluate(element => element.currentTime);
    await travelTo('入り江の浜', 'coast', 'inlet');
    assert.equal(await viewer.locator('[data-monitor-display-target]').isVisible(), false);
    assert.equal(await mode.inputValue(), 'stereo');
    assert.equal(await button(viewer, 'モニター音をミュート').getAttribute('aria-pressed'), 'true');
    await assertPlaybackContinues(beforeTravel, true);
    await button(viewer, 'モニター音をミュート').click();
    await viewer.waitForFunction(() => window.monitorSound.read().find(context => context.hasStream)?.peak > .001);
    await setSliderValue(viewer, '全体音量', 0);
    await viewer.waitForFunction(() => window.monitorSound.read().find(context => context.hasStream)?.peak < .0001);
    await setSliderValue(viewer, '全体音量', 125);
    await viewer.waitForFunction(() => window.monitorSound.read().find(context => context.hasStream)?.peak > .001);

    beforeTravel = await video.evaluate(element => element.currentTime);
    await viewer.evaluate(() => history.back());
    await waitForArrival('cinema', 'center');
    assert.equal(await target.inputValue(), 'floating');
    await assertPlaybackContinues(beforeTravel);

    beforeTravel = await video.evaluate(element => element.currentTime);
    await viewer.evaluate(() => history.forward());
    await waitForArrival('coast', 'inlet');
    await assertPlaybackContinues(beforeTravel);

    await button(viewer, 'VRで見る').click();
    await viewer.waitForFunction(() => window.xrFixture.xrDraws > 10);
    beforeTravel = await video.evaluate(element => element.currentTime);
    await travelTo('中段中央（R09）', 'cinema', 'center');
    const firstXRDraws = await viewer.evaluate(() => window.xrFixture.xrDraws);
    await viewer.waitForFunction(before => window.xrFixture.xrDraws > before + 10, firstXRDraws);
    assert.deepEqual(await viewer.evaluate(() => {
      const { requests, ends, strayDraws } = window.xrFixture;
      return { requests, ends, strayDraws };
    }), { requests: 1, ends: 0, strayDraws: 0 });
    assert.equal(await target.inputValue(), 'floating');
    const oldDesktopDraws = await viewer.evaluate(() => window.xrFixture.desktopDraws);
    await button(viewer, 'VRを終了').click();
    await viewer.waitForFunction(before => window.xrFixture.ends === 1 && window.xrFixture.desktopDraws > before,
      oldDesktopDraws);
    await assertPlaybackContinues(beforeTravel);

    await button(sender, '共有を停止').click();
    await viewer.waitForFunction(selector => document.querySelector(selector)?.srcObject === null, videoSelector);
    await viewer.waitForFunction(() => window.sharedMonitor.peer.connectionState === 'closed'
      && window.sharedMonitor.tracks.every(track => track.readyState === 'ended')
      && window.monitorSound.read().some(context => context.hasStream && context.state === 'closed'));

    await viewer.evaluate(() => history.back());
    await waitForArrival('coast', 'inlet');
    assert.equal(await video.evaluate(element => element.srcObject), null);
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all([sender.context().close(), viewer.context().close()]);
  }
});

function observeCinemaArrivalLamp() {
  const gl = WebGL2RenderingContext.prototype;
  const locate = gl.getUniformLocation;
  const setVector = gl.uniform3f;
  const lampLocations = new WeakSet();
  gl.getUniformLocation = function (program, name) {
    const location = locate.call(this, program, name);
    if (location && name === 'cinemaLamps') lampLocations.add(location);
    return location;
  };
  gl.uniform3f = function (location, arrival, service, emergency) {
    if (lampLocations.has(location)) window.cinemaArrivalLamp = arrival;
    setVector.call(this, location, arrival, service, emergency);
  };
}

async function sampleCinemaCarpet(sender, viewer, frame) {
  await sender.evaluate(value => { window.captureFixture.cinemaFrame = value; }, frame);
  await viewer.waitForFunction(({ selector, frame }) => {
    const video = document.querySelector(selector);
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(video, 0, 0, 2, 1);
    const colors = context.getImageData(0, 0, 2, 1).data;
    const red = [colors[0], colors[4]];
    if (frame === 'black') return red.every(value => value < 8);
    const warm = frame === 'warm-left' ? 0 : 1;
    return red[warm] > 175 && red[1 - warm] < 100;
  }, { selector: videoSelector, frame });
  // Wait past one 15 Hz light sample and its 33 ms interpolation window.
  await viewer.waitForTimeout(140);
  const screenshot = await viewer.screenshot({ style: '.coast-ui { visibility: hidden !important }' });
  return viewer.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    // The two carpet patches are between the bottom of the screen and the first seat row.
    return [-1, 1].map(side => {
      const x = Math.round(canvas.width / 2 + canvas.height * (0.22 * side - 0.04));
      const y = Math.round(canvas.height * 0.771);
      const { data } = context.getImageData(x, y, Math.round(canvas.height * 0.08), Math.round(canvas.height * 0.026));
      const rgb = [0, 0, 0];
      for (let index = 0; index < data.length; index += 4) {
        for (let channel = 0; channel < rgb.length; channel++) rgb[channel] += data[index + channel];
      }
      return rgb.map(sum => sum / (data.length / 4));
    });
  }, screenshot.toString('base64'));
}

test('cinema projects one native WebRTC stream and pauses its own output during an emergency check', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
  const errors = [];
  viewer.on('pageerror', () => errors.push('viewer'));
  viewer.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await Promise.all([
      sender.addInitScript(installSyntheticCapture),
      sender.addInitScript(observePeers),
      viewer.addInitScript(observePeers),
      viewer.addInitScript(observeAudio),
      viewer.addInitScript(observeCinemaArrivalLamp),
    ]);
    await sender.goto(new URL('?monitor=sender', url).href);
    await viewer.goto(new URL('?world=cinema', url).href);
    await button(viewer, '上映設定').click();
    const panel = viewer.getByRole('dialog', { name: '上映設定' });
    await button(panel, '上映').click();
    await button(panel, '閉じる').click();
    await button(viewer, '仮想モニター').click();
    const target = viewer.getByRole('combobox', { name: '表示先' });
    const mode = viewer.getByRole('combobox', { name: 'モニターの音響' });
    assert.equal(await target.inputValue(), 'television');
    assert.equal(await target.locator('option:checked').textContent(), '映画館のスクリーン');
    assert.equal(await mode.inputValue(), 'cinema');
    assert.equal(await button(viewer, '配置を編集').isDisabled(), true);

    await requestPairing(sender, viewer);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    const picture = await screenPixels(viewer, 'cinema-shared');
    assert.ok(picture.count > 8_000, 'the source is visible on the cinema screen');
    assert.ok(Math.abs(picture.width / picture.height - 16 / 9) < .25, 'video retains its aspect');

    const audible = () => window.monitorSound.read().find(context => context.hasStream)?.peak > .001;
    const silent = () => window.monitorSound.read().find(context => context.hasStream)?.peak < .0001;
    const enable = button(viewer, 'モニター音を有効にする');
    if (await enable.isEnabled()) await enable.click();
    await viewer.waitForFunction(audible);
    await mode.selectOption('stereo');
    await viewer.waitForFunction(() => {
      const audio = window.monitorSound.read().find(context => context.hasStream);
      return audio?.stereo > .98 && audio.peak > .001;
    });
    await mode.selectOption('cinema');

    await viewer.waitForFunction(() => window.cinemaArrivalLamp === 0);
    const warmLeft = await sampleCinemaCarpet(sender, viewer, 'warm-left');
    const warmRight = await sampleCinemaCarpet(sender, viewer, 'warm-right');
    const black = await sampleCinemaCarpet(sender, viewer, 'black');
    for (const side of [0, 1]) {
      const warm = side === 0 ? warmLeft[side] : warmRight[side];
      const cool = side === 0 ? warmRight[side] : warmLeft[side];
      assert.ok(warm[0] - warm[2] > cool[0] - cool[2] + 4, 'the reflected warm color moves across the carpet');
      assert.ok(black[side][0] + 6 < warm[0] && black[side][0] < 4, 'a black frame removes that reflected color');
    }
    await sender.evaluate(() => { window.captureFixture.cinemaFrame = null; });
    await button(viewer, '上映設定').click();
    await button(panel, '非常点検').click();
    await button(panel, '閉じる').click();
    await viewer.waitForFunction(silent);
    assert.equal((await screenPixels(viewer)).count, 0);
    assert.deepEqual(await viewer.evaluate(() => window.monitorPeers.map(peer => peer.connectionState)), ['connected']);
    await button(viewer, '上映設定').click();
    await button(panel, '上映').click();
    await button(panel, '閉じる').click();
    await viewer.waitForFunction(audible);
    assert.ok((await screenPixels(viewer)).count > 8_000);

    await button(sender, '共有を停止').click();
    await viewer.waitForFunction(selector => document.querySelector(selector)?.srcObject === null, videoSelector);
    await button(viewer, '仮想モニター').click();
    await sender.evaluate(() => { window.captureFixture.mode = 'video-only'; });
    await requestPairing(sender, viewer);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 0, [180, 320]);
    const silentPicture = await screenPixels(viewer, 'cinema-silent-portrait');
    assert.ok(silentPicture.count > 2_000);
    assert.ok(Math.abs(silentPicture.width / silentPicture.height - 9 / 16) < .12);
    await viewer.locator('[data-monitor-audio-status]').filter({ hasText: '共有音声が取得されていません' }).waitFor();
    await button(sender, '共有を停止').click();
    await viewer.waitForFunction(selector => document.querySelector(selector)?.srcObject === null, videoSelector);
    assert.equal((await screenPixels(viewer)).count, 0);
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all([sender.context().close(), viewer.context().close()]);
  }
});

test('picker denial, rejected pairing, video-only restart and viewer disconnect release capture', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
  try {
    await Promise.all([
      sender.addInitScript(installSyntheticCapture),
      sender.addInitScript(observePeers),
      viewer.addInitScript(observePeers),
    ]);
    await sender.goto(new URL('?monitor=sender', url).href);
    await sender.evaluate(() => { window.captureFixture.mode = 'denied'; });
    await button(sender, '画面共有を開始').click();
    const senderStatus = sender.locator('[data-monitor-sender]').getByRole('status');
    await senderStatus.filter({ hasText: /キャンセル|許可されません/ }).waitFor();
    await sender.waitForFunction(() => !document.querySelector('[data-monitor-pair-code]')?.textContent);

    await viewer.goto(url.href);
    await button(viewer, '仮想モニター').click();
    await button(viewer, 'モニターを表示').click();
    await sender.evaluate(() => { window.captureFixture.mode = 'audio-video'; });
    await requestPairing(sender, viewer);
    await button(sender, '接続を拒否').click();
    const viewerStatus = viewer.locator('[data-monitor-status]');
    await viewerStatus.filter({ hasText: /拒否|終了|切断/ }).waitFor();
    await sender.waitForFunction(() => window.captureFixture.streams[0].getTracks().every(track => track.readyState === 'ended'));
    await sender.waitForFunction(() => !document.querySelector('[data-monitor-pair-code]')?.textContent);
    assert.equal(await viewer.evaluate(() => window.monitorPeers.length), 0);

    await sender.evaluate(() => { window.captureFixture.mode = 'video-only'; });
    await requestPairing(sender, viewer);
    await sender.locator('[data-monitor-capture-audio]').filter({ hasText: /映像のみ共有中/ }).waitFor();
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 0, [180, 320]);
    const portrait = await screenPixels(viewer);
    assert.ok(portrait.count > 1_000 && Math.abs(portrait.width / portrait.height - 9 / 16) < 0.1,
      'portrait video fits the monitor without stretching');
    await button(viewer, '切断').click();
    await viewer.waitForFunction(selector => document.querySelector(selector)?.srcObject === null, videoSelector);
    await sender.waitForFunction(() => window.captureFixture.streams[1].getTracks().every(track => track.readyState === 'ended'));
    assert.ok(await viewer.evaluate(() => window.monitorPeers[0].signalingState === 'closed'));
    assert.ok(await sender.evaluate(() => window.monitorPeers[0].signalingState === 'closed'));
  } finally {
    await Promise.all([sender.context().close(), viewer.context().close()]);
  }
});

test('leaving the sender while capture is pending releases late tracks', { timeout }, async () => {
  const sender = await newPage();
  try {
    await sender.addInitScript(installSyntheticCapture);
    await sender.goto(new URL('?monitor=sender', url).href);
    await sender.evaluate(() => { window.captureFixture.mode = 'held'; });
    await button(sender, '画面共有を開始').click();
    await sender.waitForFunction(() => typeof window.captureFixture.resolveCapture === 'function');
    await sender.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      window.captureFixture.resolveCapture();
    });
    await sender.waitForFunction(() =>
      window.captureFixture.streams[0].getVideoTracks()[0].readyState === 'ended');
    await button(sender, '画面共有を開始').waitFor();
    await sender.waitForFunction(() => !document.querySelector('[data-monitor-pair-code]')?.textContent);
  } finally {
    await sender.context().close();
  }
});

test('switching from a locally suppressed tab to PC only stops sending and reports pending playback', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
  try {
    await Promise.all([
      sender.addInitScript(installSyntheticCapture),
      sender.addInitScript(observePeers),
      viewer.addInitScript(observePeers),
    ]);
    await Promise.all([sender.goto(new URL('?monitor=sender', url).href), viewer.goto(url.href)]);
    await sender.evaluate(() => { window.captureFixture.mode = 'tab-audio-video'; });
    const output = sender.getByRole('combobox', { name: '音声の出力先' });
    await output.selectOption('viewer');
    await button(viewer, '仮想モニター').click();
    await requestPairing(sender, viewer);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    await output.selectOption('pc');
    await sender.waitForFunction(() => !window.captureFixture.streams[0].getAudioTracks()[0].enabled);
    await viewer.locator('[data-monitor-audio-status]').filter({ hasText: /停止中.*選び直す/ }).waitFor();
    await sender.locator('[data-monitor-capture-audio]').filter({ hasText: /PC側の再生を戻すには/ }).waitFor();
    await waitForVideo(viewer, 1);
  } finally {
    await Promise.all([sender.context().close(), viewer.context().close()]);
  }
});

test('a browser without screen capture presents an unsupported state', { timeout }, async () => {
  const sender = await newPage();
  try {
    await sender.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined });
    });
    await sender.goto(new URL('?monitor=sender', url).href);
    await sender.locator('[data-monitor-sender]').getByRole('status').filter({ hasText: /利用できません|対応していません/ }).waitFor();
    assert.equal(await button(sender, '画面共有を開始').isDisabled(), true);
    await sender.waitForFunction(() => !document.querySelector('[data-monitor-pair-code]')?.textContent);
  } finally {
    await sender.context().close();
  }
});

test('residence lighting, display and page state changes preserve the monitor connection', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
  viewer.setDefaultTimeout(25_000);
  try {
    await Promise.all([
      sender.addInitScript(installSyntheticCapture),
      sender.addInitScript(observePeers),
      viewer.addInitScript(observePeers),
      viewer.addInitScript(observeAudio),
    ]);
    await sender.goto(new URL('?monitor=sender', url).href);
    // Set the visitor's position only. The wall switch is operated by the real scene controls.
    await viewer.route('**/assets/CoastApp-*.js', async route => {
      const response = await route.fetch();
      const source = await response.text();
      const prepare = 'this.world.prepareRender?.(';
      assert.ok(source.includes(prepare), 'the wall switch test requires access to the scene position');
      const hook = 'window.relocateMonitorViewer??=(pose=>this.controls.relocate(pose)),';
      await route.fulfill({ response, body: source.replace(prepare, hook + prepare) });
    });
    await viewer.goto(new URL('?world=residence&place=living-theater&time=night', url).href);
    const panel = viewer.getByRole('region', { name: '仮想モニターの操作' });
    await button(viewer, '仮想モニター').click();
    const target = viewer.getByRole('combobox', { name: '表示先' });
    await target.selectOption('television');
    await requestPairing(sender, viewer);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    await viewer.evaluate(selector => {
      const video = document.querySelector(selector);
      const [peer] = window.monitorPeers;
      const stream = video.srcObject;
      window.sharedMonitor = { video, peer, stream, tracks: stream.getTracks() };
    }, videoSelector);
    await sender.evaluate(() => {
      const [peer] = window.monitorPeers;
      const [stream] = window.captureFixture.streams;
      window.sharedMonitor = { peer, stream, tracks: stream.getTracks() };
    });
    const enableAudio = button(viewer, 'モニター音を有効にする');
    if (await enableAudio.isEnabled()) await enableAudio.click();

    async function assertPlaybackSince(frames) {
      await viewer.waitForFunction(before =>
        window.sharedMonitor.video.getVideoPlaybackQuality().totalVideoFrames > before + 1, frames);
      assert.equal(await viewer.evaluate(selector => {
        const { peer, stream, video, tracks } = window.sharedMonitor;
        return window.monitorPeers.length === 1 && window.monitorPeers[0] === peer && peer.connectionState === 'connected'
          && document.querySelector(selector) === video && video.srcObject === stream
          && tracks.length === stream.getTracks().length
          && stream.getTracks().every(track => tracks.includes(track) && track.readyState === 'live');
      }, videoSelector), true, 'viewer retains the original peer, element, stream and tracks');
      assert.equal(await sender.evaluate(() => {
        const { peer, stream, tracks } = window.sharedMonitor;
        return window.monitorPeers.length === 1 && window.monitorPeers[0] === peer && peer.connectionState === 'connected'
          && window.captureFixture.streams.length === 1 && window.captureFixture.streams[0] === stream
          && tracks.every(track => track.readyState === 'live');
      }), true, 'sender retains the original peer and capture tracks');
      await viewer.waitForFunction(() => window.monitorSound.read().some(
        context => context.hasStream && context.state === 'running' && context.peak > .001));
    }

    const frameCount = () => viewer.locator(videoSelector).evaluate(video => video.getVideoPlaybackQuality().totalVideoFrames);
    for (const display of ['television', 'floating']) {
      await target.selectOption(display);
      const beforeSwitching = await frameCount();
      await button(viewer, 'メニュー').click();
      await panel.waitFor({ state: 'hidden' });
      await button(viewer.getByRole('dialog', { name: 'メニュー' }), '住戸の遠隔操作').click();
      await button(viewer.getByRole('dialog', { name: '住戸の遠隔操作' }), 'リビング・ダイニング').click();
      const lights = viewer.getByRole('dialog', { name: 'リビング・ダイニング' });
      const pendant = button(lights, 'ペンダント灯（東）');
      await button(lights, '一括消灯').click();
      assert.equal(await pendant.getAttribute('aria-pressed'), 'false');
      await assertPlaybackSince(beforeSwitching);
      const lightOff = await frameCount();
      await button(lights, '一括点灯').click();
      assert.equal(await pendant.getAttribute('aria-pressed'), 'true');
      await viewer.keyboard.press('Escape');
      await lights.waitFor({ state: 'hidden' });
      await assertPlaybackSince(lightOff);
      assert.ok((await screenPixels(viewer)).count > 2_000, 'scene still renders the shared image');

      const atWall = await frameCount();
      await viewer.evaluate(() => window.relocateMonitorViewer({ x: 11.65, z: -4.78, yaw: Math.PI / 2, pitch: -.35 }));
      const wallOff = button(viewer, 'リビング・ダイニングの照明を一括消灯');
      const wallOn = button(viewer, 'リビング・ダイニングの照明を一括点灯');
      await wallOff.waitFor();
      await viewer.keyboard.press('e');
      await wallOn.waitFor();
      await assertPlaybackSince(atWall);
      const beforeTurningOn = await frameCount();
      await wallOn.click();
      await wallOff.waitFor();
      await assertPlaybackSince(beforeTurningOn);
      await viewer.evaluate(() => window.relocateMonitorViewer({ x: 19.99, z: -3.06, yaw: 0, pitch: -.115 }));
      assert.ok((await screenPixels(viewer)).count > 2_000, 'the image is visible after using the wall switch');

      await button(viewer, '仮想モニター').click();
      await panel.waitFor();
    }
    const beforeDisplay = await frameCount();
    await button(viewer, 'モニターを隠す').click();
    assert.equal((await screenPixels(viewer)).count, 0);
    await assertPlaybackSince(beforeDisplay);
    await button(viewer, 'モニターを表示').click();
    await button(viewer, '仮想モニター').click();
    const beforeSettings = await frameCount();
    await button(viewer, '昼').press('Enter');
    await viewer.waitForURL(address => address.searchParams.get('time') === 'day');
    await button(viewer, '高品質').click();
    assert.equal(await button(viewer, '高品質').getAttribute('aria-pressed'), 'true');
    await assertPlaybackSince(beforeSettings);
    assert.ok((await screenPixels(viewer)).count > 2_000, 'the new scene quality still displays the video');

    await button(viewer, '軽量').click();
    // Exercise the app's persisted events with native WebRTC; the browser's cache eligibility is independent.
    const beforeHide = await frameCount();
    await viewer.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await assertPlaybackSince(beforeHide);
  } finally {
    await Promise.all([sender.context().close(), viewer.context().close()]);
  }
});

test('a transient signaling poll failure leaves one established WebRTC session running', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
  const pollPath = '**/api/virtual-monitor/poll';
  try {
    await Promise.all([
      sender.addInitScript(installSyntheticCapture),
      sender.addInitScript(observePeers),
      viewer.addInitScript(observePeers),
      viewer.addInitScript(observeAudio),
    ]);
    await sender.goto(new URL('?monitor=sender', url).href);
    await viewer.goto(url.href);
    await button(viewer, '仮想モニター').click();
    await button(viewer, 'モニターを表示').click();
    await requestPairing(sender, viewer);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    const enableAudio = button(viewer, 'モニター音を有効にする');
    if (await enableAudio.isEnabled()) await enableAudio.click();
    const video = viewer.locator(videoSelector);
    const beforePoll = await video.evaluate(element => {
      window.originalMonitorStream = element.srcObject;
      return element.getVideoPlaybackQuality().totalVideoFrames;
    });

    const isPoll = message => message.url().endsWith('/virtual-monitor/poll');
    const pollRecovered = (page, interrupted) => interrupted.then(() =>
      page.waitForResponse(response => isPoll(response) && response.ok(), { timeout: 25_000 }));

    const viewerRecovered = pollRecovered(viewer, viewer.waitForEvent('requestfailed', isPoll));
    const senderRecovered = pollRecovered(sender,
      sender.waitForResponse(response => isPoll(response) && response.status() === 503));
    await Promise.all([
      viewer.route(pollPath, route => route.abort('failed'), { times: 1 }),
      sender.route(pollPath, route => route.fulfill({ status: 503 }), { times: 1 }),
    ]);
    await Promise.all([viewerRecovered, senderRecovered]);
    assert.equal(await video.evaluate(element => element.srcObject === window.originalMonitorStream
      && element.srcObject.getTracks().every(track => track.readyState === 'live')), true);
    assert.ok(await sender.evaluate(() => window.captureFixture.streams.length === 1
      && window.captureFixture.streams[0].getTracks().every(track => track.readyState === 'live')));
    assert.deepEqual(await viewer.evaluate(() => window.monitorPeers.map(peer => peer.connectionState)), ['connected']);
    assert.deepEqual(await sender.evaluate(() => window.monitorPeers.map(peer => peer.connectionState)), ['connected']);
    assert.ok(await video.evaluate((element, before) =>
      element.getVideoPlaybackQuality().totalVideoFrames > before, beforePoll));
    await viewer.waitForFunction(() => window.monitorSound.read().some(
      context => context.hasStream && context.state === 'running' && context.peak > .001));

    await button(sender, '共有を停止').click();
    await viewer.waitForFunction(selector => document.querySelector(selector)?.srcObject === null, videoSelector);
    await sender.waitForFunction(() => window.captureFixture.streams[0].getTracks().every(track => track.readyState === 'ended'));
    await requestPairing(sender, viewer);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    assert.deepEqual(await viewer.evaluate(() => window.monitorPeers.map(peer => peer.connectionState)), ['closed', 'connected']);
    assert.deepEqual(await sender.evaluate(() => window.monitorPeers.map(peer => peer.connectionState)), ['closed', 'connected']);
    await button(viewer, '切断').click();
    await viewer.waitForFunction(selector => document.querySelector(selector)?.srcObject === null, videoSelector);
    await sender.waitForFunction(() => window.captureFixture.streams[1].getTracks().every(track => track.readyState === 'ended'));
  } finally {
    await Promise.all([sender.context().close(), viewer.context().close()]);
  }
});
