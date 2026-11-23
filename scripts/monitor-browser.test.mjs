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
      this.probe = { context: this, analyser: this.createAnalyser(), gains: new Map(), panners: [], hasStream: false };
      contexts.push(this.probe);
    }
    createMediaStreamSource(stream) {
      this.probe.hasStream = stream.getAudioTracks().length > 0;
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

async function newPage() {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(12_000);
  return page;
}

function button(page, name) {
  return page.getByRole('button', { name, exact: true });
}

async function requestPairing(sender, viewer) {
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
  assert.equal(await sender.evaluate(() => window.monitorPeers.length), 0);
  assert.equal(await viewer.evaluate(() => window.monitorPeers.length), 0);
  assert.equal(await viewer.locator(videoSelector).evaluate(video => video.srcObject), null);
}

async function waitForVideo(viewer, expectedAudioTracks, [width, height] = [320, 180]) {
  await viewer.waitForFunction(({ selector, expectedAudioTracks }) => {
    const video = document.querySelector(selector);
    return video?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime > 0.15
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

    await button(viewer, '環境音を開始').click();
    const enableAudio = button(viewer, 'モニター音を有効にする');
    if (await enableAudio.isEnabled()) await enableAudio.click();
    await waitForMix(viewer, { natural: true, monitor: true });
    const naturalMute = button(viewer, 'ミュート');
    const monitorMute = button(viewer, 'モニター音をミュート');
    await naturalMute.click();
    await waitForMix(viewer, { natural: false, monitor: true });
    await naturalMute.click();
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

test('the residence plays one WebRTC stream on the television and switches the audio output separately', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
  const errors = [];
  viewer.on('pageerror', () => errors.push('viewer'));
  try {
    await Promise.all([
      sender.addInitScript(installSyntheticCapture),
      sender.addInitScript(observePeers),
      viewer.addInitScript(observePeers),
      viewer.addInitScript(observeAudio),
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

    await button(viewer, 'ファストトラベル').click();
    await viewer.getByRole('dialog', { name: 'ファストトラベル' }).getByRole('button', { name: '入り江の浜' }).click();
    await viewer.waitForURL(address => address.searchParams.get('world') === 'coast');
    await sender.waitForFunction(() => window.monitorPeers[0]?.signalingState === 'closed');
    await button(viewer, '仮想モニター').click();
    assert.equal(await viewer.locator('[data-monitor-display-target]').isVisible(), false);
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
