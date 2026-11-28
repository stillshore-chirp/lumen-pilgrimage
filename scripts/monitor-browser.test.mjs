import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { installSimulatedXR } from './simulated-xr.mjs';
import { runXRColorProbeBrowserTests } from './xr-color-probe-browser.mjs';
import { CINEMA_DESTINATIONS, cinemaGroundHeight } from '../src/coast/world/cinema/cinemaLayout.ts';

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
    args: [...(process.env.MONITOR_BROWSER_GPU === 'metal' ? ['--enable-gpu', '--use-angle=metal'] : ['--enable-unsafe-swiftshader']),
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
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

test('the independent XR color probe preserves measured and unavailable results', { timeout }, async t => {
  await runXRColorProbeBrowserTests(t, { browser, url, screenshotDirectory });
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
      canvas.width = fixture.width ?? (mode === 'video-only' ? 180 : 320);
      canvas.height = fixture.height ?? (mode === 'video-only' ? 320 : 180);
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
        context.fillRect((fixture.frameRate ? performance.now() * 0.12 : frame++ * 8) % canvas.width, 12, 18, 22);
      };
      draw();
      const stream = canvas.captureStream(fixture.frameRate ?? 15);
      const videoTrack = stream.getVideoTracks()[0];
      if (mode === 'tab-audio-video') {
        const settings = videoTrack.getSettings();
        Object.defineProperty(videoTrack, 'getSettings', { value: () => ({ ...settings, displaySurface: 'browser' }) });
      }
      if (fixture.frameRate) {
        let next = performance.now();
        const period = 1000 / fixture.frameRate;
        const paintTimes = [];
        fixture.paintTimes = paintTimes;
        const paint = now => {
          if (videoTrack.readyState === 'ended') return;
          if (now >= next - .5) {
            draw();
            paintTimes.push(now);
            if (paintTimes.length > 512) paintTimes.shift();
            next += period;
            if (now - next > period) next = now + period;
          }
          requestAnimationFrame(paint);
        };
        requestAnimationFrame(paint);
      } else {
        const timer = setInterval(() => {
          if (videoTrack.readyState === 'ended') clearInterval(timer);
          else draw();
        }, 55);
      }
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
  const disconnect = AudioNode.prototype.disconnect;
  const contexts = [];
  function edges(node) { return node?.context.probe.edges.get(node) ?? []; }
  function reachable(root, stop) {
    const visited = new Set();
    const queue = root ? [root] : [];
    while (queue.length) {
      const node = queue.shift();
      if (visited.has(node) || node === stop) continue;
      visited.add(node);
      queue.push(...edges(node).map(edge => edge.node));
    }
    return [...visited];
  }
  function inspect(entry) {
    const source = entry.sources.at(-1);
    const outgoing = edges(source).map(edge => edge.node);
    const stereo = outgoing.find(node => node instanceof GainNode && node.channelCount === 2
      && node.channelCountMode === 'explicit' && !(edges(node)[0]?.node instanceof ChannelSplitterNode));
    const master = edges(stereo)[0]?.node;
    const single = outgoing.filter(node => node instanceof PannerNode || node instanceof GainNode
      && node.channelCountMode === 'explicit' && (node.channelCount === 1 || node.channelCount === 2
        && edges(node)[0]?.node instanceof ChannelSplitterNode))
      .map(node => ({ node, panners: reachable(node, master).filter(value => value instanceof PannerNode).length }))
      .filter(candidate => candidate.panners > 0).sort((a, b) => a.panners - b.panners)[0]?.node;
    const surround = outgoing.find(node => node instanceof GainNode && node.channelCount === 6
      && node.channelInterpretation === 'speakers' && edges(node)[0]?.node instanceof ChannelSplitterNode);
    const singleNodes = reachable(single, master);
    const surroundNodes = reachable(surround, master);
    const modeLevel = nodes => nodes.find(node => node instanceof GainNode && edges(node).some(edge => edge.node === master));
    const splitter = edges(surround)[0]?.node;
    const channels = Array.from({ length: 6 }, (_, channel) => {
      const input = edges(splitter).find(edge => edge.output === channel)?.node;
      return reachable(input, master).filter(node => node instanceof PannerNode);
    });
    return { stereo, master, spatial: modeLevel(singleNodes), surround: modeLevel(surroundNodes),
      singlePanners: singleNodes.filter(node => node instanceof PannerNode), channels,
      active: reachable(source) };
  }
  function contributionRoutes(entry, routing) {
    // A provider keeps fixed path slots, including silent and retired panners.
    // Preserve their enumeration separately; position checks use connected dry
    // routes whose own gain and branch mode gain can currently contribute.
    const incoming = new Map();
    let truncated = entry.edges.size > 4096;
    for (const [node, links] of [...entry.edges].slice(0, 4096)) {
      if (links.length > 128) truncated = true;
      for (const edge of links.slice(0, 128)) {
        const inputs = incoming.get(edge.node) ?? [];
        inputs.push(node);
        incoming.set(edge.node, inputs);
      }
    }
    const describe = (panners, level) => {
      if (panners.length > 128) truncated = true;
      return panners.slice(0, 128).map(panner => {
        const inputs = incoming.get(panner) ?? [];
        const dryGain = Math.max(0, ...inputs.map(node => node instanceof GainNode ? Math.abs(node.gain.value) : 1));
        const modeGain = Math.abs(level?.gain.value ?? 0);
        return { pose: pannerPose(panner), dryGain, modeGain,
          contributing: inputs.length > 0 && dryGain > 1e-6 && modeGain > 1e-6 };
      });
    };
    const single = describe(routing.singlePanners, routing.spatial);
    const channels = routing.channels.map(panners => describe(panners, routing.surround));
    return { single, channels, truncated };
  }
  const pannerPose = ({ positionX, positionY, positionZ, panningModel }) =>
    [positionX.value, positionY.value, positionZ.value, panningModel];
  window.monitorSound = {
    listener() {
      const listener = contexts.find(({ context, hasStream }) => !hasStream && context.state === 'running')?.context.listener;
      return listener && [listener.positionX.value, listener.positionY.value, listener.positionZ.value,
        listener.forwardX.value, listener.forwardY.value, listener.forwardZ.value];
    },
    placement() {
      const entry = contexts.find(({ hasStream }) => hasStream);
      if (!entry) return null;
      const listener = entry.context.listener;
      const [source] = inspect(entry).singlePanners;
      if (!source) return null;
      return {
        eye: [listener.positionX.value, listener.positionY.value, listener.positionZ.value],
        source: [source.positionX.value, source.positionY.value, source.positionZ.value],
      };
    },
    monitorResume: 'native',
    heldResumeInUserGesture: false,
    rejectedResumeInUserGesture: false,
    read() {
      return contexts.map(entry => {
        const { context, analyser, hasStream } = entry;
        const routing = inspect(entry);
        const routes = contributionRoutes(entry, routing);
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        return {
          hasStream,
          streamSources: context.probe.streamSources,
          state: context.state,
          time: context.currentTime,
          peak: Math.max(...data.map(Math.abs)),
          rms: Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length),
          stereo: routing.stereo?.gain.value,
          spatial: routing.spatial?.gain.value ?? 0,
          surround: routing.surround?.gain.value ?? 0,
          master: routing.master?.gain.value,
          panners: [...routing.singlePanners, ...routing.channels.flat()].map(pannerPose),
          surroundChannels: routing.channels.map(nodes => nodes.map(pannerPose)),
          spatialRoutes: routes.single,
          surroundRouteChannels: routes.channels,
          routesTruncated: routes.truncated,
          nodeCount: routing.active.length,
          trackedNodeCount: entry.edges.size,
          convolvers: routing.active.filter(node => node instanceof ConvolverNode).length,
          filters: routing.active.filter(node => node instanceof BiquadFilterNode)
            .map(node => ({ type: node.type, hz: node.frequency.value, q: node.Q.value })),
          delays: routing.active.filter(node => node instanceof DelayNode).map(node => node.delayTime.value),
        };
      });
    },
  };
  window.AudioContext = class extends NativeContext {
    constructor(...args) {
      super(...args);
      this.probe = {
        context: this, analyser: this.createAnalyser(), edges: new Map(), sources: [], hasStream: false, streamSources: 0,
      };
      contexts.push(this.probe);
    }
    get state() {
      if (this.probe?.hasStream && window.monitorSound.monitorResume !== 'native') return 'suspended';
      return super.state;
    }
    resume() {
      const mode = this.probe?.hasStream ? window.monitorSound.monitorResume : 'native';
      if (mode === 'reject') {
        window.monitorSound.rejectedResumeInUserGesture = navigator.userActivation.isActive;
        return Promise.reject(new DOMException('', 'NotAllowedError'));
      }
      if (mode === 'hold') {
        window.monitorSound.heldResumeInUserGesture = navigator.userActivation.isActive;
        return new Promise((resolve, reject) => {
          window.monitorSound.releaseMonitorResume = () => {
            window.monitorSound.monitorResume = 'native';
            return super.resume().then(resolve, reject);
          };
        });
      }
      return super.resume();
    }
    createMediaStreamSource(stream) {
      this.probe.hasStream = stream.getAudioTracks().length > 0;
      this.probe.streamSources++;
      const source = super.createMediaStreamSource(stream);
      this.probe.sources.push(source);
      return source;
    }
  };
  AudioNode.prototype.connect = function (destination, ...args) {
    if (destination === this.context.destination) connect.call(this, this.context.probe.analyser);
    const result = connect.call(this, destination, ...args);
    if (destination instanceof AudioNode && this.context.probe) {
      const map = this.context.probe.edges;
      const connections = map.get(this) ?? [];
      const output = args[0] ?? 0;
      const input = args[1] ?? 0;
      if (!connections.some(edge => edge.node === destination && edge.output === output && edge.input === input)) {
        connections.push({ node: destination, output, input });
        map.set(this, connections);
      }
    }
    return result;
  };
  AudioNode.prototype.disconnect = function (...args) {
    const result = disconnect.call(this, ...args);
    const map = this.context.probe?.edges;
    if (!map) return result;
    const [destination, output, input] = args;
    const remaining = (map.get(this) ?? []).filter(edge => {
      if (!args.length) return false;
      if (typeof destination === 'number') return edge.output !== destination;
      return edge.node !== destination || output !== undefined && edge.output !== output
        || input !== undefined && edge.input !== input;
    });
    if (remaining.length) map.set(this, remaining);
    else map.delete(this);
    return result;
  };
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

async function waitForVideo(viewer, expectedAudioTracks, dimensions = [320, 180]) {
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
  if (dimensions) {
    assert.equal(playback.width, dimensions[0]);
    assert.equal(playback.height, dimensions[1]);
  }
  assert.equal(playback.muted, true);
  assert.equal(playback.playsInline, true);
  assert.ok(playback.frames > 1, 'Chrome decoded successive native WebRTC video frames');
}

async function assertWorldLightingKeepsPlayback(viewer) {
  const lighting = viewer.getByRole('group', { name: 'ワールド照明' });
  const video = viewer.locator(videoSelector);
  await video.evaluate(element => {
    window.lightingPlayback = { stream: element.srcObject, peer: window.monitorPeers[0] };
  });
  for (const label of ['一括点灯', '一括消灯', '既定']) {
    const before = await video.evaluate(element => element.currentTime);
    const control = button(lighting, label);
    await control.click();
    assert.equal(await control.getAttribute('aria-pressed'), 'true');
    assert.equal(await video.evaluate(element => {
      const { stream, peer } = window.lightingPlayback;
      return element.srcObject === stream && window.monitorPeers.length === 1
        && window.monitorPeers[0] === peer && peer.connectionState === 'connected';
    }), true, `the same connection and stream survive ${label}`);
    await viewer.waitForFunction(({ selector, before }) => {
      const audio = window.monitorSound.read().find(context => context.hasStream);
      return document.querySelector(selector).currentTime > before + .1 && audio?.peak > .001;
    }, { selector: videoSelector, before });
  }
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
    assert.deepEqual(captureRequest, { activeGesture: true, video: { frameRate: { ideal: 60, max: 60 } }, requestedAudio: true });
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
    const audioToggle = button(viewer, 'モニター音声');
    const audioGroup = viewer.getByRole('group', { name: 'モニター音声', exact: true });
    assert.equal(await audioGroup.getByRole('button').count(), 1);
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await audioToggle.textContent(), 'モニター音声 オフ');
    assert.equal(await viewer.evaluate(() => window.monitorSound.read().some(context => context.hasStream)), false);
    await audioToggle.click();
    await waitForMix(viewer, { natural: false, monitor: false });
    await setSliderValue(viewer, '全体音量', 100);
    await waitForMix(viewer, { natural: true, monitor: true });
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await audioToggle.textContent(), 'モニター音声 オン');
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
    await button(viewer, '仮想モニター').click();
    await button(viewer, '環境音をオフ').click();
    await waitForMix(viewer, { natural: false, monitor: true });
    await button(viewer, '環境音をオン').click();
    await waitForMix(viewer, { natural: true, monitor: true });
    const soundDetails = viewer.locator('.coast-sound-details > summary');
    await soundDetails.click();
    await button(viewer, '歩行音をオフ').click();
    await waitForMix(viewer, { natural: true, monitor: true });
    await button(viewer, '歩行音をオン').click();
    await soundDetails.click();
    await button(viewer, '仮想モニター').click();
    await audioToggle.click();
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');
    await waitForMix(viewer, { natural: true, monitor: false });
    await audioToggle.click();
    await waitForMix(viewer, { natural: true, monitor: true });
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'true');

    const volume = viewer.getByRole('slider', { name: 'モニター音量' });
    await volume.press('Home');
    await waitForMix(viewer, { natural: true, monitor: false });
    await volume.press('End');
    await waitForMix(viewer, { natural: true, monitor: true });

    const audioOutput = sender.getByRole('combobox', { name: '音声の出力先' });
    await audioOutput.selectOption('pc');
    await sender.waitForFunction(() => !window.captureFixture.streams[0].getAudioTracks()[0].enabled);
    const pcOnly = '配信元で「PC側のみ」が選ばれているため、視聴側の音声は停止中です。';
    await viewer.locator('[data-monitor-audio-status]').filter({ hasText: pcOnly }).waitFor();
    assert.equal(await audioToggle.isDisabled(), true);
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await audioToggle.textContent(), 'モニター音声 停止中');
    const description = await audioToggle.evaluate(button =>
      document.getElementById(button.getAttribute('aria-describedby')).textContent);
    assert.equal(description, pcOnly);
    await waitForMix(viewer, { natural: true, monitor: false });
    await audioOutput.selectOption('both');
    await sender.waitForFunction(() => window.captureFixture.streams[0].getAudioTracks()[0].enabled);
    await waitForMix(viewer, { natural: true, monitor: true });
    assert.equal(await audioToggle.isEnabled(), true);
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await audioToggle.textContent(), 'モニター音声 オン');
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

test('F carries a floating monitor on the desktop and leaves its video and sound at the released pose', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
  const errors = [];
  viewer.on('pageerror', () => errors.push('viewer'));
  try {
    await Promise.all([
      sender.addInitScript(installSyntheticCapture), sender.addInitScript(observePeers),
      viewer.addInitScript(observePeers), viewer.addInitScript(observeAudio), viewer.addInitScript(installSimulatedXR),
    ]);
    await sender.goto(new URL('?monitor=sender', url).href);
    await viewer.goto(url.href);
    const panel = button(viewer, '仮想モニター');
    const canvas = viewer.locator('canvas.coast-view');
    const mode = viewer.locator('.coast-mode');
    const hint = viewer.locator('.coast-grab-hint[role="status"]');
    const pickup = hint.filter({ hasText: /^F 浮遊モニターを掴む$/ });
    const release = hint.filter({ hasText: /^F 浮遊モニターを置く$/ });
    const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
    const pose = () => viewer.evaluate(() => window.monitorSound.placement());
    const moveRight = async ({ eye }) => {
      await viewer.keyboard.down('d');
      try {
        await viewer.waitForFunction(previous => {
          const position = window.monitorSound.placement()?.eye;
          return position && Math.hypot(position[0] - previous[0], position[2] - previous[2]) > 0.65;
        }, eye);
      } finally {
        await viewer.keyboard.up('d');
      }
    };

    await panel.click();
    await button(viewer, 'モニターを表示').click();
    const input = viewer.getByRole('textbox', { name: '接続コード' });
    const initialMode = await mode.textContent();
    await input.press('f');
    assert.equal(await input.inputValue(), 'f');
    assert.equal(await hint.isVisible(), false);
    assert.equal(await mode.textContent(), initialMode);
    await input.clear();

    await requestPairing(sender, viewer);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    await viewer.getByRole('combobox', { name: 'モニターの音響' }).selectOption('spatial');
    await button(viewer, 'モニター音声').click();
    await viewer.waitForFunction(() => {
      const pose = window.monitorSound.placement();
      return pose && Math.hypot(...pose.source.map((value, i) => value - pose.eye[i])) > 3;
    });

    const edit = button(viewer, '配置を編集');
    await edit.click();
    const beforeEdit = await pose();
    await canvas.focus();
    await viewer.keyboard.press('f');
    assert.equal(await edit.getAttribute('aria-pressed'), 'true');
    assert.equal(await hint.isVisible(), false);
    assert.equal(await mode.textContent(), initialMode);
    assert.ok(distance((await pose()).source, beforeEdit.source) < 0.02);
    await edit.click();
    await panel.click();
    await canvas.focus();
    await pickup.waitFor();
    assert.equal(await viewer.evaluate(() => document.pointerLockElement), null);
    const initial = await pose();
    const initialPixels = await screenPixels(viewer);
    assert.ok(initialPixels.count > 2_000);

    await viewer.keyboard.press('f');
    await release.waitFor();
    await moveRight(await pose());
    const carried = await pose();
    const carriedPixels = await screenPixels(viewer, 'monitor-desktop-carried');
    assert.ok(distance(carried.source, initial.source) > 0.5, 'the spatial source travels with the player');
    assert.ok(carriedPixels.count > 2_000 && Math.abs(carriedPixels.x - initialPixels.x) < 24,
      'the rendered video stays in front of the moving player');

    await viewer.keyboard.press('f');
    await release.waitFor({ state: 'hidden' });
    const placed = await pose();
    assert.ok(distance(placed.source, carried.source) < 0.2, 'releasing keeps the carried world position');
    await moveRight(placed);
    const walked = await pose();
    const placedPixels = await screenPixels(viewer, 'monitor-desktop-placed');
    assert.ok(distance(walked.source, placed.source) < 0.02, 'the spatial source stays at the released position');
    assert.ok(placedPixels.count > 2_000 && placedPixels.x < carriedPixels.x - 32,
      'after release, walking shifts the stationary video across the view');
    assert.equal(await mode.textContent(), initialMode);

    // Reset to the wider default distance used by portrait canvases.
    await viewer.setViewportSize({ width: 540, height: 900 });
    await panel.click();
    await button(viewer, '位置・サイズを戻す').click();
    await panel.click();
    await canvas.focus();
    await pickup.waitFor();
    const portrait = await pose();
    assert.ok(distance(portrait.source, portrait.eye) > 4.5);
    await viewer.keyboard.press('f');
    await release.waitFor();

    await button(viewer, 'VRを開始').click();
    await viewer.waitForFunction(() => window.xrFixture.frames > 3 && window.xrFixture.xrDraws > 0);
    const immersive = await pose();
    await canvas.focus();
    await viewer.keyboard.press('f');
    assert.equal(await hint.isVisible(), false);
    assert.equal(await mode.textContent(), initialMode);
    assert.ok(distance((await pose()).source, immersive.source) < 0.02);
    await button(viewer.locator('.coast-xr-entry'), 'VRを終了').click();
    await viewer.waitForFunction(() => window.xrFixture.ends === 1);
    await canvas.focus();
    await pickup.waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await Promise.all([sender.context().close(), viewer.context().close()]);
  }
});

test('the audio toggle cancels and retries a pending start, and begins off after a new pairing', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
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
    const audioToggle = button(viewer, 'モニター音声');
    const audioStatus = viewer.locator('[data-monitor-audio-status]');
    assert.equal(await audioToggle.isDisabled(), true);

    await requestPairing(sender, viewer);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    await viewer.evaluate(() => { window.monitorSound.monitorResume = 'hold'; });
    await audioToggle.click();
    await audioStatus.filter({ hasText: '共有音声を開始しています。' }).waitFor();
    assert.equal(await audioToggle.isEnabled(), true);
    await audioStatus.filter({ hasText: '再試行してください' }).waitFor();
    assert.equal(await audioToggle.isEnabled(), true);
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await viewer.evaluate(() => window.monitorSound.heldResumeInUserGesture), true);
    await viewer.waitForFunction(() => window.monitorSound.read().find(context => context.hasStream)?.peak < .0001);

    await viewer.evaluate(() => { window.monitorSound.monitorResume = 'reject'; });
    await audioToggle.click();
    await audioStatus.filter({ hasText: '再試行してください' }).waitFor();
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await viewer.evaluate(() => window.monitorSound.rejectedResumeInUserGesture), true);

    await viewer.evaluate(() => { window.monitorSound.monitorResume = 'hold'; });
    await audioToggle.click();
    await audioStatus.filter({ hasText: 'もう一度押すと取り消せます。' }).waitFor();
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'true');
    assert.equal(await audioToggle.textContent(), 'モニター音声 開始待ち');
    await audioToggle.press('Space');
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await audioToggle.textContent(), 'モニター音声 オフ');
    const resumedAt = await viewer.evaluate(async () => {
      await window.monitorSound.releaseMonitorResume();
      return window.monitorSound.read().find(context => context.hasStream).time;
    });
    await viewer.waitForFunction(resumedAt => {
      const audio = window.monitorSound.read().find(context => context.hasStream);
      return audio.state === 'running' && audio.time > resumedAt + .15;
    }, resumedAt);
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');
    const latePeak = await viewer.evaluate(() => window.monitorSound.read().find(context => context.hasStream).peak);
    assert.ok(latePeak < .0001, 'late context resume keeps the cancelled stream silent');

    await audioToggle.click();
    const audible = () => window.monitorSound.read().some(context => context.hasStream && context.peak > .001 && context.state === 'running');
    await viewer.waitForFunction(audible);
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'true');
    await button(viewer, '切断').click();
    await viewer.waitForFunction(selector => document.querySelector(selector)?.srcObject === null, videoSelector);
    assert.equal(await audioToggle.isDisabled(), true);
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');

    await requestPairing(sender, viewer);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    assert.equal(await audioToggle.isEnabled(), true);
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await viewer.evaluate(() => window.monitorSound.read().filter(context => context.hasStream).length), 1);
    await audioToggle.click();
    await viewer.waitForFunction(audible);
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'true');
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

    await viewer.evaluate(() => {
      const prototype = window.AudioContext.prototype;
      const createSource = prototype.createMediaStreamSource;
      prototype.createMediaStreamSource = function (...args) {
        const source = createSource.apply(this, args);
        window.monitorTravelAudioSource = source;
        return source;
      };
    });
    const audioToggle = button(viewer, 'モニター音声');
    await audioToggle.click();
    await mode.selectOption('television');
    await viewer.waitForFunction(() => {
      const contexts = window.monitorSound.read().filter(context => context.hasStream);
      const audio = contexts[0];
      const video = document.querySelector('[data-monitor-video]');
      return contexts.length === 1 && audio.streamSources === 1 && audio.state === 'running'
        && video.srcObject === window.originalMonitorStream && audio.master > 0
        && audio.spatial > .98 && audio.peak > .001 && !audio.routesTruncated
        && audio.spatialRoutes.some(({ pose: source, contributing }) => contributing
          && Math.abs(source[0] - 19.99) < .02 && Math.abs(source[2] + 6.49) < .02 && source[3] === 'HRTF');
    });

    await mode.selectOption('surround');
    await viewer.waitForFunction(() => {
      const audio = window.monitorSound.read().find(context => context.hasStream);
      return audio?.surround > .98 && audio.stereo < .02 && audio.spatial < .02 && audio.peak > .001;
    });
    const routes = await viewer.evaluate(() => {
      const audio = window.monitorSound.read().find(context => context.hasStream);
      return { channels: audio.surroundRouteChannels, truncated: audio.routesTruncated };
    });
    assert.equal(routes.truncated, false);
    const speakers = routes.channels.map(channel => channel.filter(route => route.contributing).map(route => route.pose));
    assert.equal(speakers.length, 6);
    assert.ok(speakers.every(channel => channel.length >= 1), 'each speaker channel has a contributing spatial route');
    assert.ok(speakers.every(channel => channel.every(source => source[3] === 'HRTF')));
    assert.ok(speakers.slice(0, 4).every(channel => channel.some(source => source[2] < -6)));
    assert.ok(speakers.slice(4).every(channel => channel.some(source => source[2] > -2)));

    await button(viewer, '仮想モニター').click();
    await assertWorldLightingKeepsPlayback(viewer);
    await button(viewer, '仮想モニター').click();

    await audioToggle.click();
    await viewer.waitForFunction(() => window.monitorSound.read().find(context => context.hasStream)?.peak < .0001);
    await audioToggle.click();
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
      const audioSource = window.monitorTravelAudioSource;
      window.sharedMonitor = {
        video, peer: window.monitorPeers[0], canvas: document.querySelector('.coast-view'),
        stream: video.srcObject, tracks: video.srcObject.getTracks(),
        audioSource, audioContext: audioSource.context,
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

    async function assertLiveMedia(beforeTravel, muted = false) {
      assert.equal(await viewer.evaluate(selector => {
        const { video, peer, canvas, stream, tracks, audioSource, audioContext } = window.sharedMonitor;
        return video === document.querySelector(selector) && video.srcObject === stream
          && canvas === document.querySelector('.coast-view') && window.monitorPeers.length === 1
          && window.monitorPeers[0] === peer && peer.connectionState === 'connected'
          && stream.getTracks().length === tracks.length
          && stream.getTracks().every(track => tracks.includes(track) && track.readyState === 'live')
          && window.monitorTravelAudioSource === audioSource && audioSource.context === audioContext
          && audioContext.state === 'running' && audioContext.probe.sources.length === 1
          && audioContext.probe.sources[0] === audioSource;
      }, videoSelector), true, 'the receiver, tracks, media element, canvas, audio source and context are preserved');
      await viewer.waitForFunction(({ selector, beforeTravel, muted }) => {
        const video = document.querySelector(selector);
        const audio = window.monitorSound.read().filter(context => context.hasStream);
        return video.currentTime > beforeTravel + .1 && audio.length === 1 && audio[0].streamSources === 1
          && audio[0].state === 'running' && (muted ? audio[0].peak < .0001 : audio[0].peak > .001);
      }, { selector: videoSelector, beforeTravel, muted });
    }

    async function assertFloatingSound() {
      await viewer.waitForFunction(() => {
        const audio = window.monitorSound.read().find(context => context.hasStream);
        const routes = audio?.spatialRoutes.filter(route => route.contributing) ?? [];
        return audio?.spatial > .98 && audio.stereo < .02 && audio.surround < .02 && audio.peak > .001
          && audio.master > 0 && !audio.routesTruncated
          && routes.length === 2 && routes.every(route => route.pose[3] === 'HRTF'
            && route.pose.slice(0, 3).every(Number.isFinite))
          && Math.hypot(...routes[0].pose.slice(0, 3).map((value, axis) => value - routes[1].pose[axis])) > .25;
      });
      try {
        await viewer.evaluate(() => {
          const { audioSource, audioContext } = window.sharedMonitor;
          const edges = node => audioContext.probe.edges.get(node) ?? [];
          const layout = edges(audioSource).map(edge => edge.node).find(node => node instanceof GainNode
            && node.channelCount === 2 && node.channelCountMode === 'explicit'
            && edges(node).some(edge => edge.node instanceof ChannelSplitterNode));
          const splitter = edges(layout).find(edge => edge.node instanceof ChannelSplitterNode)?.node;
          const feeds = [0, 1].map(channel => edges(splitter).find(edge => edge.output === channel)?.node);
          if (feeds.some(feed => !(feed instanceof GainNode)) || feeds[0] === feeds[1]) {
            throw new Error('Floating audio must retain separate splitter outputs for L and R');
          }
          window.sharedMonitor.edgeTaps = [];
          for (const feed of feeds) {
            const analyser = audioContext.createAnalyser();
            window.sharedMonitor.edgeTaps.push({ feed, analyser });
            feed.connect(analyser);
          }
        });
        await viewer.waitForFunction(() => {
          const taps = window.sharedMonitor.edgeTaps;
          return taps.length === 2 && taps.every(({ analyser }) => {
            const samples = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(samples);
            return samples.every(Number.isFinite) && samples.some(sample => Math.abs(sample) > .001);
          });
        });
      } finally {
        await viewer.evaluate(() => {
          const { audioContext, edgeTaps = [] } = window.sharedMonitor;
          for (const { feed, analyser } of edgeTaps) {
            if ((audioContext.probe.edges.get(feed) ?? []).some(edge => edge.node === analyser)) {
              feed.disconnect(analyser);
            }
            analyser.disconnect();
          }
          window.sharedMonitor.edgeTaps = [];
        });
      }
    }

    async function assertPlaybackContinues(beforeTravel, muted = false) {
      await assertLiveMedia(beforeTravel, muted);
      if (!muted) await assertFloatingSound();
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
    assert.equal(await mode.inputValue(), 'spatial');
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
    await audioToggle.click();
    beforeTravel = await video.evaluate(element => element.currentTime);
    await travelTo('入り江の浜', 'coast', 'inlet');
    assert.equal(await viewer.locator('[data-monitor-display-target]').isVisible(), false);
    assert.equal(await mode.inputValue(), 'spatial');
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');
    await assertPlaybackContinues(beforeTravel, true);
    await audioToggle.click();
    await assertFloatingSound();
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
    const xrInput = input => viewer.evaluate(value => window.xrFixture.mutate(value), input);
    beforeTravel = await video.evaluate(element => element.currentTime);
    await xrInput({ side: 'left', axes: [0, -1], frames: 6 });
    await xrInput({ side: 'left', axes: [0, 0] });
    await assertLiveMedia(beforeTravel);

    const pressXRMenu = async () => {
      await xrInput({ side: 'left', button: 4, pressed: true });
      await xrInput({ side: 'left', button: 4, pressed: false });
    };
    const xrMenuStep = async label => {
      await xrInput({ side: 'right', axes: [0, 1] });
      await viewer.waitForFunction(expected => window.xrFixture.selection?.startsWith(expected), label);
      await xrInput({ side: 'right', axes: [0, 0] });
    };
    await pressXRMenu();
    await viewer.waitForFunction(() => window.xrFixture.menuTitle === 'ファストトラベル');
    for (const label of ['丘陵展望台', '都心の70階住戸', '映画館シアター（大）', '商業アトリウム', '湖畔の広間', '設定']) {
      await xrMenuStep(label);
    }
    await xrInput({ select: true });
    await viewer.waitForFunction(() => window.xrFixture.menuTitle === '設定');
    for (const label of ['歩行音', '昼', '夜', 'ワールド照明', '仮想モニター']) await xrMenuStep(label);
    await xrInput({ select: true });
    await viewer.waitForFunction(() => window.xrFixture.menuTitle === '仮想モニター');
    await xrMenuStep('視界の前に置き直す');
    await xrMenuStep('モニター音声 オン');
    beforeTravel = await video.evaluate(element => element.currentTime);
    await xrInput({ select: true });
    await viewer.waitForFunction(() => window.xrFixture.selection === 'モニター音声 オフ');
    await assertLiveMedia(beforeTravel, true);
    beforeTravel = await video.evaluate(element => element.currentTime);
    await xrInput({ select: true });
    await viewer.waitForFunction(() => window.xrFixture.selection === 'モニター音声 オン');
    await assertLiveMedia(beforeTravel);
    await pressXRMenu();

    beforeTravel = await video.evaluate(element => element.currentTime);
    await travelTo('中段中央（R09）', 'cinema', 'center');
    const firstXRDraws = await viewer.evaluate(() => window.xrFixture.xrDraws);
    await viewer.waitForFunction(before => window.xrFixture.xrDraws > before + 10, firstXRDraws);
    assert.deepEqual(await viewer.evaluate(() => {
      const { requests, ends, strayDraws } = window.xrFixture;
      return { requests, ends, strayDraws };
    }), { requests: 1, ends: 0, strayDraws: 0 });
    assert.equal(await target.inputValue(), 'floating');
    await assertLiveMedia(beforeTravel);
    const oldDesktopDraws = await viewer.evaluate(() => window.xrFixture.desktopDraws);
    await button(viewer.locator('.coast-xr-entry'), 'VRを終了').click();
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

function observeCinemaLighting() {
  const gl = WebGL2RenderingContext.prototype;
  const locate = gl.getUniformLocation;
  const setVector = gl.uniform3f;
  const setFloat = gl.uniform1f;
  const lampLocations = new WeakSet();
  const projectionLocations = new WeakSet();
  gl.getUniformLocation = function (program, name) {
    const location = locate.call(this, program, name);
    if (location && name === 'cinemaLamps') lampLocations.add(location);
    if (location && name === 'cinemaLive') projectionLocations.add(location);
    return location;
  };
  gl.uniform3f = function (location, arrival, service, emergency) {
    if (lampLocations.has(location)) window.cinemaArrivalLamp = arrival;
    setVector.call(this, location, arrival, service, emergency);
  };
  gl.uniform1f = function (location, value) {
    if (projectionLocations.has(location)) window.cinemaProjectionLive = value;
    setFloat.call(this, location, value);
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
  return measureCinemaCarpet(viewer);
}

async function measureCinemaCarpet(viewer, file) {
  const path = screenshotDirectory && file ? join(screenshotDirectory, `${file}.png`) : undefined;
  const screenshot = await viewer.screenshot({ path, style: '.coast-ui { visibility: hidden !important }' });
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
      viewer.addInitScript(observeCinemaLighting),
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
    const audioToggle = button(viewer, 'モニター音声');
    await audioToggle.click();
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

    await button(viewer, '投影を止める').click();
    await viewer.waitForFunction(() => window.cinemaProjectionLive === 0);
    const hidden = await measureCinemaCarpet(viewer, 'cinema-hidden-after-warm-frame');
    assert.ok(hidden.flat().every(channel => channel < 1), 'hiding the monitor clears the prior reflection');
    assert.deepEqual(await viewer.evaluate(() => window.monitorPeers.map(peer => peer.connectionState)), ['connected']);
    await button(viewer, 'スクリーンに映す').click();
    await viewer.waitForFunction(() => window.cinemaProjectionLive === 1);
    const resumed = await measureCinemaCarpet(viewer, 'cinema-restored-warm-frame');
    assert.ok(resumed[1][0] - resumed[1][2] > hidden[1][0] - hidden[1][2] + 4,
      'showing the same stream restores its reflected color');

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
    await assertWorldLightingKeepsPlayback(viewer);

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
    assert.equal(await audioToggle.isDisabled(), true);
    assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false');
    assert.equal(await audioToggle.textContent(), 'モニター音声 停止中');
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
    assert.equal(await button(viewer, 'モニター音声').isDisabled(), true);
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

test('a secure browser without immersive support labels VR as unavailable and keeps desktop controls', { timeout }, async () => {
  const page = await newPage();
  try {
    await page.addInitScript(() => {
      const xr = new EventTarget();
      xr.isSessionSupported = async () => false;
      Object.defineProperty(navigator, 'xr', { value: xr });
    });
    await page.goto(url.href);
    const vr = button(page, 'VR非対応');
    await vr.waitFor();
    assert.equal(await vr.isDisabled(), true);
    assert.match(await vr.getAttribute('title'), /没入型VRを利用できません/);
    await button(page, 'マウス操作を開始').click();
    await page.waitForFunction(() => document.pointerLockElement?.classList.contains('coast-view'));
  } finally {
    await page.close();
  }
});

test('Quest exploration enters without a monitor and keeps one stereo XR session through controller travel', { timeout }, async () => {
  const page = await newPage();
  page.setDefaultTimeout(25_000);
  const errors = [];
  page.on('pageerror', () => errors.push('page'));
  try {
    await page.addInitScript(installSimulatedXR);
    await page.addInitScript(observeAudio);
    await page.goto(new URL('?world=coast&place=inlet&time=night', url).href);
    await button(page, '環境音をオン').click();
    await page.evaluate(() => { window.xrFixture.denyNext = true; });
    await button(page, 'VRを開始').click();
    await page.locator('#coast-xr-status').filter({ hasText: 'VRを開始できませんでした' }).waitFor();
    assert.equal(await page.locator(videoSelector).count(), 0);
    await button(page, 'VRを開始').click();
    await page.waitForFunction(() => Boolean(window.xrFixture.eyePoses[320]) && window.xrFixture.frames > 4);
    const support = await page.evaluate(() => ({
      activation: window.xrFixture.activations, features: window.xrFixture.features,
    }));
    assert.deepEqual(support.activation, [true, true], 'entry and retry use the live page gesture');
    assert.deepEqual(support.features, {
      mode: 'immersive-vr', requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'],
    });

    const change = input => page.evaluate(value => window.xrFixture.mutate(value), input);
    const pose = () => page.evaluate(() => {
      const { eyePoses } = window.xrFixture;
      return {
        x: (eyePoses[0].x + eyePoses[320].x) / 2,
        y: (eyePoses[0].y + eyePoses[320].y) / 2,
        z: (eyePoses[0].z + eyePoses[320].z) / 2,
        yaw: eyePoses[0].yaw,
        eyeSpacing: Math.hypot(eyePoses[0].x - eyePoses[320].x, eyePoses[0].z - eyePoses[320].z),
      };
    });
    const clickController = async (side, index) => {
      await change({ side, button: index, pressed: true });
      await change({ side, button: index, pressed: false });
    };
    const step = async (direction, expected) => {
      await change({ side: 'right', axes: [0, direction] });
      await page.waitForFunction(label => window.xrFixture.selection === label, expected);
      await change({ side: 'right', axes: [0, 0] });
    };
    const choose = async () => { await change({ select: true }); };
    const waitForMenu = title => page.waitForFunction(label => window.xrFixture.menuTitle === label, title);

    const initial = await pose();
    assert.ok(Math.abs(initial.eyeSpacing - .064) < .002, 'both eye cameras render with distinct positions');
    assert.ok(Math.abs(initial.x + 12) < .02 && Math.abs(initial.z - 79) < .02);
    await change({ head: { yaw: Math.PI / 2 } });
    const turned = await pose();
    assert.ok(Math.abs(turned.yaw - initial.yaw - Math.PI / 2) < .002);
    await page.waitForFunction(({ x, y, z, yaw }) => {
      const listener = window.monitorSound.listener();
      return listener && Math.hypot(listener[0] - x, listener[1] - y, listener[2] - z) < .02
        && Math.abs(listener[3] + Math.sin(yaw)) < .002 && Math.abs(listener[5] + Math.cos(yaw)) < .002;
    }, turned);
    await page.evaluate(() => { window.xrFixture.session.inputSources[0].gamepad.axes[3] = -1; });
    await page.waitForFunction(x => (window.xrFixture.eyePoses[0].x + window.xrFixture.eyePoses[320].x) / 2 < x - .25, turned.x);
    await change({ side: 'left', axes: [0, 0] });
    const moved = await pose();
    assert.ok(Math.abs(moved.z - turned.z) < .08, 'left-stick forward follows the headset yaw');

    await change({ head: { x: .21, z: .19 } });
    const offset = await pose();
    await change({ side: 'right', axes: [1, 0], frames: 8 });
    const snapped = await pose();
    assert.ok(Math.abs(snapped.yaw - offset.yaw + Math.PI / 6) < .002, 'holding a stick gives a single 30 degree snap');
    assert.ok(Math.hypot(snapped.x - offset.x, snapped.z - offset.z) < .02, 'snap pivots about the tracked head');
    await change({ side: 'right', axes: [0, 0] });
    await clickController('left', 5);
    assert.equal(await page.locator('.coast-mode').textContent(), '自由飛行');
    await change({ side: 'right', button: 4, pressed: true, frames: 4 });
    const airborne = await pose();
    assert.ok(airborne.y > snapped.y + .05, 'A ascends through the shared flight path');
    await change({ side: 'right', button: 4, pressed: false });
    await clickController('left', 5);

    await clickController('left', 4);
    await waitForMenu('ファストトラベル');
    const atMenu = await pose();
    await change({ side: 'left', axes: [0, -1], frames: 5 });
    const modalPose = await pose();
    assert.ok(Math.hypot(modalPose.x - atMenu.x, modalPose.z - atMenu.z) < .02, 'menu pauses locomotion');
    await change({ side: 'left', axes: [0, 0] });
    await step(1, '丘陵展望台');
    await step(1, '都心の70階住戸');
    await choose();
    await waitForMenu('都心の70階住戸');
    await step(1, 'リビングのホームシアター');
    await step(1, '住戸の玄関');
    await step(1, '主寝室');
    await choose();
    await page.waitForURL(address => address.searchParams.get('place') === 'primary-bedroom'
      && address.searchParams.get('time') === 'night');
    await page.waitForFunction(() => window.xrFixture.hint?.includes('バルコニーの引戸を開ける'));
    const bedroom = await pose();
    await change({ head: { x: -.17 } });
    const leaning = await pose();
    assert.ok(Math.abs(leaning.x - bedroom.x - .38) < .015, 'physical head lean still moves the rendered viewpoint');
    await change({ side: 'left', axes: [0, -1], frames: 14 });
    const againstDoor = await pose();
    assert.ok(againstDoor.x <= leaning.x + .03, 'stick movement cannot push a leaning viewer into the closed door');
    await change({ side: 'left', axes: [0, 1] });
    await page.waitForFunction(x => (window.xrFixture.eyePoses[0].x + window.xrFixture.eyePoses[320].x) / 2 < x - .16, leaning.x);
    await change({ side: 'left', axes: [0, 0] });
    await page.waitForFunction(() => window.xrFixture.hint?.includes('バルコニーの引戸を開ける'));

    await choose();
    await page.waitForFunction(() => window.xrFixture.hint?.includes('バルコニーの引戸を閉める'));

    await clickController('left', 4);
    await waitForMenu('ファストトラベル');
    await step(1, '丘陵展望台');
    await step(1, '都心の70階住戸');
    await step(1, '映画館シアター（大）');
    await choose();
    await waitForMenu('映画館シアター（大）');
    await choose();
    await page.waitForURL(address => address.searchParams.get('world') === 'cinema'
      && address.searchParams.get('place') === 'center' && address.searchParams.get('time') === 'night');
    const seat = CINEMA_DESTINATIONS[0];
    await page.waitForFunction(({ z, y }) => {
      const eye = window.xrFixture.eyePoses[0];
      return eye && Math.abs(eye.z - z) < .04 && Math.abs(eye.y - y) < .02;
    }, { z: seat.z, y: cinemaGroundHeight(seat.x, seat.z) + seat.seatedEyeHeight });
    assert.equal(await page.locator('.coast-mode').textContent(), '座位');

    await clickController('left', 4);
    await waitForMenu('ファストトラベル');
    await step(1, '丘陵展望台');
    await choose();
    await waitForMenu('丘陵展望台');
    await choose();
    await page.waitForURL(address => address.searchParams.get('world') === 'overlook'
      && address.searchParams.get('place') === 'main-deck' && address.searchParams.get('time') === 'night');
    await page.waitForFunction(() => window.xrFixture.eyePoses[0]?.y > 345);
    assert.equal(await page.locator(videoSelector).count(), 0, 'travel did not require a monitor instance');
    assert.deepEqual(await page.evaluate(() => {
      const { requests, ends, strayDraws } = window.xrFixture;
      return { requests, ends, strayDraws };
    }), { requests: 2, ends: 0, strayDraws: 0 });

    await clickController('left', 4);
    await waitForMenu('ファストトラベル');
    await step(1, '丘陵展望台');
    await step(1, '都心の70階住戸');
    await step(1, '映画館シアター（大）');
    await step(1, '商業アトリウム');
    await step(1, '湖畔の広間');
    await step(1, '設定');
    await choose();
    await waitForMenu('設定');
    await step(1, '歩行音をオフ');
    await step(1, '昼');
    await step(1, '夜（選択中）');
    await step(1, 'ワールド照明');
    await choose();
    await waitForMenu('ワールド照明');
    const lights = page.getByRole('group', { name: 'ワールド照明' });
    const pressed = lights.locator('[aria-pressed="true"]');
    for (const [index, label] of ['一括点灯', '一括消灯', '既定'].entries()) {
      if (index > 0) await step(1, label);
      await choose();
      await page.waitForFunction(expected => window.xrFixture.selection === `${expected}（選択中）`, label);
      await button(lights, label).and(pressed).waitFor({ state: 'attached' });
    }
    await clickController('left', 4);
    await clickController('left', 4);
    await waitForMenu('ファストトラベル');
    await step(1, '丘陵展望台');
    await step(1, '都心の70階住戸');
    await step(1, '映画館シアター（大）');
    await step(1, '商業アトリウム');
    await step(1, '湖畔の広間');
    await step(1, '設定');
    await step(1, 'VRを終了');
    const desktopDraws = await page.evaluate(() => window.xrFixture.desktopDraws);
    await choose();
    await button(page, 'VRを開始').waitFor();
    await page.waitForFunction(draws => window.xrFixture.desktopDraws > draws && window.xrFixture.ends === 1, desktopDraws);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('XR quality adjusts both layer types and survives travel and desktop return', { timeout }, async () => {
  for (const layer of ['projection', 'base']) {
    const page = await newPage();
    try {
      await page.addInitScript(installSimulatedXR, layer);
      await page.goto(new URL('?world=residence&place=living-theater&time=night', url).href);
      await button(page, 'VRを開始').click();
      await page.waitForFunction(() => window.xrFixture.eyePoses[320] && window.xrFixture.xrDraws > 0);
      const foveation = () => page.evaluate(() => ({
        value: window.xrFixture.layer.fixedFoveation, scale: window.xrFixture.scaleFactor,
      }));
      assert.deepEqual(await foveation(), { value: .5, scale: 1 }, layer);
      const change = input => page.evaluate(value => window.xrFixture.mutate(value), input);
      await change({ side: 'left', button: 4, pressed: true });
      await change({ side: 'left', button: 4, pressed: false });
      const next = async expected => {
        await change({ side: 'right', axes: [0, 1] });
        await page.waitForFunction(label => window.xrFixture.selection?.startsWith(label), expected);
        await change({ side: 'right', axes: [0, 0] });
      };
      const seek = async expected => {
        // Drive the real menu with controller input; world-specific items may precede the target.
        for (let step = 0; step < 12; step++) {
          if (await page.evaluate(label => window.xrFixture.selection?.startsWith(label), expected)) return;
          await change({ side: 'right', axes: [0, 1] });
          await change({ side: 'right', axes: [0, 0] });
        }
        assert.fail(`XR menu item was not reached: ${expected}`);
      };
      await seek('設定');
      await change({ select: true });
      await page.waitForFunction(() => window.xrFixture.menuTitle === '設定');
      await seek('描画品質');
      await change({ select: true });
      await page.waitForFunction(() => window.xrFixture.menuTitle === '描画品質'
        && window.xrFixture.selection === '軽量（選択中）　周辺の描画負荷を抑える');
      await next('高品質');
      await change({ select: true });
      await page.waitForFunction(() => window.xrFixture.selection === '高品質（選択中）　周辺の細部を保つ');
      assert.deepEqual(await foveation(), { value: .25, scale: 1 }, layer);
      assert.equal(await button(page, '高品質').getAttribute('aria-pressed'), 'true');
      if (layer === 'projection') {
        for (let presses = 0; presses < 2; presses++) {
          await change({ side: 'left', button: 4, pressed: true });
          await change({ side: 'left', button: 4, pressed: false });
        }
        await page.waitForFunction(() => window.xrFixture.menuTitle === 'ファストトラベル'
          && window.xrFixture.selection === '入り江と山道');
        await change({ select: true });
        await page.waitForFunction(() => window.xrFixture.menuTitle === '入り江と山道');
        await change({ select: true });
        await page.waitForURL(address => address.searchParams.get('world') === 'coast');
        assert.deepEqual(await foveation(), { value: .25, scale: 1 }, 'travel preserves the projection layer quality');
        assert.equal(await button(page, '高品質').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => window.xrFixture.requests), 1, 'travel continues the current session');
      }
      const desktopDraws = await page.evaluate(() => window.xrFixture.desktopDraws);
      await button(page.locator('.coast-xr-entry'), 'VRを終了').click();
      await page.waitForFunction(draws => window.xrFixture.ends === 1 && window.xrFixture.desktopDraws > draws, desktopDraws);
      await page.waitForFunction(width => document.querySelector('canvas.coast-view').width === width, viewport.width);
      assert.equal(await button(page, '高品質').getAttribute('aria-pressed'), 'true');
      await button(page, '軽量').click();
      await page.waitForFunction(width => document.querySelector('canvas.coast-view').width === width, Math.floor(viewport.width * .8));
    } finally {
      await page.close();
    }
  }
});

function observeShaderPreparation(supportsParallel) {
  const completion = 0x91b1;
  const probe = window.shaderPreparation = { allow: false, polls: 0, links: 0, firstUses: 0, throwCompletion: false };
  const gl = WebGL2RenderingContext.prototype;
  const extension = gl.getExtension;
  const parameter = gl.getProgramParameter;
  const link = gl.linkProgram;
  const info = gl.getProgramInfoLog;
  gl.getExtension = function (name) {
    if (name === 'KHR_parallel_shader_compile') return supportsParallel ? { COMPLETION_STATUS_KHR: completion } : null;
    return extension.call(this, name);
  };
  gl.getProgramParameter = function (program, pname) {
    if (pname === completion) {
      probe.polls++;
      if (probe.throwCompletion) throw new Error('Synthetic shader completion failure');
      return probe.allow;
    }
    return parameter.call(this, program, pname);
  };
  gl.linkProgram = function (program) {
    probe.links++;
    return link.call(this, program);
  };
  gl.getProgramInfoLog = function (program) {
    probe.firstUses++;
    return info.call(this, program);
  };
}

test('the residence prepares the first interior view before starting projection XR by day and night', { timeout }, async () => {
  for (const time of ['day', 'night']) {
    const page = await newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(installSimulatedXR, 'projection');
      await page.addInitScript(observeShaderPreparation, true);
      await page.goto(new URL(`?world=residence&place=living-window&time=${time}`, url).href);
      const entry = button(page, 'VRを開始');
      await page.waitForFunction(() => window.shaderPreparation.polls > 0);
      assert.equal(await entry.isDisabled(), true);
      assert.equal(await page.locator('#coast-xr-status').textContent(), 'VRの描画を準備しています。');
      assert.equal(await page.evaluate(() => window.xrFixture.requests), 0);
      await button(page, '高品質').click();
      assert.equal(await button(page, '高品質').getAttribute('aria-pressed'), 'true');
      assert.equal(await entry.isDisabled(), true, 'Quality changes preserve the preparation gate');

      await page.evaluate(() => { window.shaderPreparation.allow = true; });
      await entry.click();
      await page.waitForFunction(() => window.xrFixture.eyePoses[320] && window.xrFixture.frames >= 5);
      const result = await page.evaluate(async () => {
        const probe = window.shaderPreparation;
        const { links, firstUses } = probe;
        const fixture = window.xrFixture;
        const before = fixture.eyePoses[0].yaw;
        await fixture.mutate({ head: { yaw: Math.PI }, frames: 5 });
        const after = fixture.eyePoses[0].yaw;
        return { links: probe.links - links, firstUses: probe.firstUses - firstUses,
          turned: Math.cos(before - after) < -.99, activation: fixture.activations };
      });
      assert.deepEqual(result, { links: 0, firstUses: 0, turned: true, activation: [true] }, time);

      if (time === 'night') {
        const travel = page.getByRole('dialog', { name: 'ファストトラベル' });
        await button(page, 'ファストトラベル').click();
        await button(travel, '入り江の浜').click();
        await page.waitForURL(address => address.searchParams.get('world') === 'coast');
        assert.equal(await button(page, 'VRを終了').isEnabled(), true);
        assert.deepEqual(await page.evaluate(() => [window.xrFixture.requests, window.xrFixture.ends]), [1, 0]);
      }

      const desktopDraws = await page.evaluate(() => window.xrFixture.desktopDraws);
      await button(page, 'VRを終了').click();
      await page.waitForFunction(draws => window.xrFixture.desktopDraws > draws && window.xrFixture.ends === 1, desktopDraws);
      assert.equal(await entry.isEnabled(), true);
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
});

test('the residence prepares the first projection XR turn without parallel shader compilation support', { timeout }, async () => {
  const page = await newPage();
  try {
    await page.addInitScript(installSimulatedXR, 'projection');
    await page.addInitScript(observeShaderPreparation, false);
    await page.goto(new URL('?world=residence&place=living-window&time=night', url).href);
    const entry = button(page, 'VRを開始');
    await page.waitForFunction(() => document.querySelector('#coast-xr-status')?.textContent === 'VRの描画を準備しています。'
      && document.querySelector('.coast-xr-entry button')?.disabled);
    await entry.click();
    await page.waitForFunction(() => window.xrFixture.frames > 4 && window.xrFixture.eyePoses[320]);
    const result = await page.evaluate(async () => {
      const probe = window.shaderPreparation;
      const { links, firstUses } = probe;
      const fixture = window.xrFixture;
      const before = fixture.eyePoses[0].yaw;
      await fixture.mutate({ head: { yaw: Math.PI }, frames: 5 });
      return {
        polls: probe.polls, links: probe.links - links, firstUses: probe.firstUses - firstUses,
        turned: Math.cos(before - fixture.eyePoses[0].yaw) < -.99, activation: fixture.activations,
      };
    });
    assert.deepEqual(result, { polls: 0, links: 0, firstUses: 0, turned: true, activation: [true] });
    await button(page, 'VRを終了').click();
    await button(page, 'VRを開始').waitFor();
  } finally {
    await page.close();
  }
});

async function exposeResidencePreparationReset(page) {
  await page.route('**/assets/CoastApp-*.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const prepare = 'this.world.prepareRender?.(';
    assert.equal(source.split(prepare).length - 1, 1, 'The preparation reset fixture needs one render hook');
    const hook = 'window.resetResidenceShaderPreparation??=(()=>{this.residenceShaders.reset();this.syncXRStatus()}),';
    await route.fulfill({ response, body: source.replace(prepare, hook + prepare) });
  });
}

test('residence shader timeout and completion errors require preparation retry before a fresh XR start', { timeout }, async () => {
  for (const failure of ['timeout', 'exception']) {
    const page = await newPage();
    try {
      await page.addInitScript(installSimulatedXR, 'projection');
      await page.addInitScript({ content: `(${observeShaderPreparation.toString()})(true);
        window.shaderPreparation.throwCompletion = ${failure === 'exception'};` });
      await page.goto(new URL('?world=residence&place=living-window&time=night', url).href);
      await button(page, '描画準備をやり直す').waitFor();
      assert.match(await page.locator('#coast-xr-status').textContent(), /描画を準備できませんでした/);
      assert.equal(await page.evaluate(() => window.xrFixture.requests), 0);
      await button(page, '高品質').click();
      assert.equal(await button(page, '高品質').getAttribute('aria-pressed'), 'true');
      assert.equal(await button(page, '描画準備をやり直す').isEnabled(), true,
        'Quality remains usable without clearing the failed preparation state');
      await page.evaluate(() => {
        window.shaderPreparation.allow = true;
        window.shaderPreparation.throwCompletion = false;
      });
      await button(page, '描画準備をやり直す').click();
      assert.equal(await page.evaluate(() => window.xrFixture.requests), 0,
        'Preparation retry must not request a session during the same click');
      await button(page, 'VRを開始').click();
      await page.waitForFunction(() => window.xrFixture.frames > 4 && window.xrFixture.eyePoses[320]);
      assert.equal(await page.evaluate(() => window.xrFixture.requests), 1);
      await button(page, 'VRを終了').click();
    } finally {
      await page.close();
    }
  }
});

test('residence preparation gates a denied XR retry while preserving the active session exit', { timeout }, async () => {
  const page = await newPage();
  try {
    await page.addInitScript(installSimulatedXR, 'projection');
    await page.addInitScript({ content: `(${observeShaderPreparation.toString()})(true);
      window.shaderPreparation.allow = true;` });
    await exposeResidencePreparationReset(page);
    await page.goto(new URL('?world=residence&place=living-window&time=day', url).href);
    await page.evaluate(() => { window.xrFixture.denyNext = true; });
    await button(page, 'VRを開始').click();
    await page.locator('#coast-xr-status').filter({ hasText: /機器の接続と許可/ }).waitFor();
    assert.equal(await page.evaluate(() => window.xrFixture.requests), 1);

    const waiting = await page.evaluate(() => {
      window.shaderPreparation.allow = false;
      window.resetResidenceShaderPreparation();
      const entry = document.querySelector('.coast-xr-entry button');
      return { disabled: entry.disabled, label: entry.textContent,
        status: document.querySelector('#coast-xr-status').textContent };
    });
    assert.deepEqual(waiting, { disabled: true, label: 'VRを開始', status: 'VRの描画を準備しています。' });
    assert.equal(await page.evaluate(() => window.xrFixture.requests), 1);
    await page.evaluate(() => { window.shaderPreparation.allow = true; });
    await page.waitForFunction(() => !document.querySelector('.coast-xr-entry button').disabled);
    assert.match(await page.locator('#coast-xr-status').textContent(), /機器の接続と許可/,
      'The session-start failure remains distinct from preparation failure');
    await button(page, 'VRを開始').click();
    await page.waitForFunction(() => window.xrFixture.frames > 4 && window.xrFixture.eyePoses[320]);

    const active = await page.evaluate(() => {
      window.shaderPreparation.allow = false;
      window.resetResidenceShaderPreparation();
      const entry = document.querySelector('.coast-xr-entry button');
      return { disabled: entry.disabled, label: entry.textContent };
    });
    assert.deepEqual(active, { disabled: false, label: 'VRを終了' });
    await button(page, 'VRを終了').click();
    await page.waitForFunction(() => window.xrFixture.ends === 1);
    assert.equal(await page.evaluate(() => window.xrFixture.requests), 2);
  } finally {
    await page.close();
  }
});

test('a diagonal stick input cannot push a leaning Quest viewer into a closed balcony door', { timeout }, async () => {
  const page = await newPage();
  try {
    await page.addInitScript(installSimulatedXR);
    await page.goto(new URL('?world=residence&place=primary-bedroom&time=night', url).href);
    await button(page, 'VRを開始').click();
    await page.waitForFunction(() => window.xrFixture.frames > 4 && window.xrFixture.eyePoses[320]);
    const change = input => page.evaluate(value => window.xrFixture.mutate(value), input);
    const pose = () => page.evaluate(() => {
      const { eyePoses } = window.xrFixture;
      return [(eyePoses[0].x + eyePoses[320].x) / 2, (eyePoses[0].z + eyePoses[320].z) / 2];
    });
    const [x, z] = await pose();
    await change({ head: { x: .45, z: -.45 } });
    const [leanX, leanZ] = await pose();
    assert.ok(Math.abs(leanX - x - .45) < .015 && Math.abs(leanZ - z - .45) < .015,
      'the tracked view follows the diagonal lean at the closed door');
    await change({ side: 'left', axes: [-.8, -.6], frames: 14 });
    const [pushedX] = await pose();
    assert.ok(pushedX <= leanX + .03, 'sliding along a wall cannot cancel an inward component');
    await change({ side: 'left', axes: [0, 1] });
    await page.waitForFunction(lean => {
      const { eyePoses } = window.xrFixture;
      return (eyePoses[0].x + eyePoses[320].x) / 2 < lean - .15;
    }, leanX);
    await change({ side: 'left', axes: [0, 0] });
  } finally {
    await page.close();
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
    await button(viewer, 'モニター音声').click();

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
    await button(viewer, 'モニター音声').click();
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

test('audio routing recovers from a lost acknowledgment and keeps screen sharing stoppable', { timeout }, async () => {
  const sender = await newPage();
  const viewer = await newPage();
  const audioPath = '**/api/virtual-monitor/audio';
  const applied = Promise.withResolvers();
  const loseResponse = Promise.withResolvers();
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
    await button(viewer, 'モニター音声').click();

    const video = viewer.locator(videoSelector);
    const before = await video.evaluate(element => {
      window.originalMonitorStream = element.srcObject;
      return element.getVideoPlaybackQuality().totalVideoFrames;
    });
    const output = sender.getByRole('combobox', { name: '音声の出力先' });
    const pending = sender.getByRole('status').filter({ hasText: '音声の設定を視聴先に反映中です。' });
    const viewerPCOnly = viewer.locator('[data-monitor-audio-status]').filter({ hasText: 'PC側のみ' });

    await sender.route(audioPath, async route => {
      applied.resolve((await route.fetch()).ok());
      await loseResponse.promise;
      await route.abort('failed');
    }, { times: 1 });
    await output.selectOption('pc');
    assert.equal(await applied.promise, true, 'the server accepted PC-only before its response was lost');
    await pending.waitFor();
    assert.equal(await sender.evaluate(() => window.captureFixture.streams[0].getAudioTracks()[0].enabled), false);
    await viewerPCOnly.waitFor();
    await output.selectOption('both');
    assert.equal(await sender.evaluate(() => window.captureFixture.streams[0].getAudioTracks()[0].enabled), true);

    loseResponse.resolve();
    await pending.waitFor({ state: 'hidden' });
    await viewerPCOnly.waitFor({ state: 'hidden' });
    assert.deepEqual(await sender.evaluate(() => window.monitorPeers.map(peer => peer.connectionState)), ['connected']);
    assert.deepEqual(await viewer.evaluate(() => window.monitorPeers.map(peer => peer.connectionState)), ['connected']);
    assert.ok(await video.evaluate((element, before) => element.srcObject === window.originalMonitorStream
      && element.srcObject.getTracks().every(track => track.readyState === 'live')
      && element.getVideoPlaybackQuality().totalVideoFrames > before, before));
    await viewer.waitForFunction(() => window.monitorSound.read().some(
      context => context.hasStream && context.state === 'running' && context.peak > .001));

    await sender.route(audioPath, route => route.fulfill({ status: 503 }));
    const rejected = sender.waitForResponse(response => response.url().endsWith('/virtual-monitor/audio')
      && response.status() === 503);
    await output.selectOption('pc');
    await rejected;
    await pending.waitFor();
    await button(sender, '共有を停止').click();
    await pending.waitFor({ state: 'hidden' });
    await viewer.waitForFunction(selector => document.querySelector(selector)?.srcObject === null, videoSelector);
    await sender.waitForFunction(() => window.captureFixture.streams[0].getTracks().every(track => track.readyState === 'ended'));
  } finally {
    loseResponse.resolve();
    await Promise.all([sender.context().close(), viewer.context().close()]);
  }
});

test('PCVR rechecks Link without opening XR, then uses one tracked desktop session across travel', { timeout }, async () => {
  const page = await newPage();
  page.setDefaultTimeout(25_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.name));
  try {
    await page.addInitScript(installSimulatedXR, { supported: false, profile: 'oculus-touch' });
    await page.goto(new URL('?vr=pc&world=coast&place=inlet&time=night', url).href);
    const recheck = button(page, 'VRの接続を再確認');
    const startVR = button(page, 'VRを開始');
    const vrStatus = page.locator('#coast-xr-status');
    const canvas = page.locator('.coast-view');
    await recheck.waitFor();
    assert.match(await vrStatus.textContent(), /Meta Horizon Link.*OpenXR/);
    assert.equal(await button(page, '高品質').getAttribute('aria-pressed'), 'true');
    await page.waitForFunction(() => window.xrFixture.desktopDraws > 0);
    const highSize = await canvas.evaluate(view => {
      window.pcViewerCanvas = view;
      return view.width;
    });
    await button(page, '軽量').click();
    assert.equal(await button(page, '軽量').getAttribute('aria-pressed'), 'true');
    assert.ok(await canvas.evaluate(view => view.width) < highSize);

    await recheck.click();
    await page.waitForFunction(() => window.xrFixture.checks === 2);
    await recheck.waitFor();
    assert.equal(await page.evaluate(() => window.xrFixture.requests), 0);
    await page.evaluate(() => { window.xrFixture.supported = true; });
    await recheck.click();
    await startVR.waitFor();
    assert.match(await vrStatus.textContent(), /Windows の Chrome でこのページの「VRを開始」/);
    assert.equal(await page.evaluate(() => window.xrFixture.requests), 0, 'rechecking never enters VR');

    await page.evaluate(() => { window.xrFixture.denyNext = true; });
    await startVR.click();
    await vrStatus.filter({ hasText: /VRを開始できませんでした.*Meta Horizon Link/ }).waitFor();
    await startVR.click();
    await page.waitForFunction(() => window.xrFixture.eyePoses[0] && window.xrFixture.eyePoses[320]);
    const entered = await page.evaluate(() => {
      const { activations, features, eyePoses, session } = window.xrFixture;
      const { width, height } = window.pcViewerCanvas;
      const { 0: left, 320: right } = eyePoses;
      return {
        activations, features, width, height, spacing: Math.hypot(left.x - right.x, left.z - right.z),
        profiles: session.inputSources.map(source => source.profiles[0]),
      };
    });
    assert.deepEqual(entered.activations, [true, true]);
    assert.deepEqual(entered.features, {
      mode: 'immersive-vr', requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'],
    });
    assert.deepEqual(entered.profiles, ['oculus-touch', 'oculus-touch']);
    assert.ok(Math.abs(entered.spacing - .064) < .002, 'both eyes use independent tracked positions');
    assert.deepEqual([entered.width, entered.height], [640, 480], 'the session provides the stereo target size');

    const change = input => page.evaluate(value => window.xrFixture.mutate(value), input);
    const press = async (side, index) => {
      await change({ side, button: index, pressed: true });
      await change({ side, button: index, pressed: false });
    };
    const firstZ = await page.evaluate(() => window.xrFixture.eyePoses[0].z);
    await change({ side: 'left', axes: [0, -1], frames: 8 });
    await change({ side: 'left', axes: [0, 0] });
    assert.ok(await page.evaluate(() => window.xrFixture.eyePoses[0].z) < firstZ - .1);
    await press('left', 5);
    assert.equal(await page.locator('.coast-mode').textContent(), '自由飛行');
    await press('left', 5);
    await press('left', 4);
    await page.waitForFunction(() => window.xrFixture.menuTitle === 'ファストトラベル');
    await change({ side: 'right', axes: [0, 1] });
    await page.waitForFunction(() => window.xrFixture.selection === '丘陵展望台');
    await change({ side: 'right', axes: [0, 0] });
    await change({ select: true });
    await page.waitForFunction(() => window.xrFixture.menuTitle === '丘陵展望台');
    await change({ select: true });
    await page.waitForURL(address => address.searchParams.get('vr') === 'pc'
      && address.searchParams.get('world') === 'overlook' && address.searchParams.get('time') === 'night');
    await page.waitForFunction(() => window.xrFixture.eyePoses[0]?.y > 345);
    assert.equal(await button(page, '軽量').getAttribute('aria-pressed'), 'true');
    assert.equal(await canvas.evaluate(view => view === window.pcViewerCanvas), true);
    assert.deepEqual(await page.evaluate(() => {
      const { requests, ends, strayDraws } = window.xrFixture;
      return { requests, ends, strayDraws };
    }), { requests: 2, ends: 0, strayDraws: 0 });

    const desktopDraws = await page.evaluate(() => window.xrFixture.desktopDraws);
    await button(page.locator('.coast-xr-entry'), 'VRを終了').click();
    await startVR.waitFor();
    await page.waitForFunction(draws => window.xrFixture.ends === 1 && window.xrFixture.desktopDraws > draws, desktopDraws);
    assert.equal(new URL(page.url()).searchParams.get('vr'), 'pc');
    await button(page, 'ファストトラベル').click();
    await button(page.getByRole('dialog', { name: 'ファストトラベル' }), '入り江の浜').click();
    await page.waitForURL(address => address.searchParams.get('vr') === 'pc'
      && address.searchParams.get('world') === 'coast');
    assert.equal(await button(page, '軽量').getAttribute('aria-pressed'), 'true');
    assert.equal(await canvas.evaluate(view => view === window.pcViewerCanvas), true);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test('PCVR reconnection retains residence shader preparation, retry, and session exit gates', { timeout }, async () => {
  const page = await newPage();
  try {
    await exposeResidencePreparationReset(page);
    await page.addInitScript(installSimulatedXR, { layerType: 'projection', supported: false, profile: 'oculus-touch' });
    await page.addInitScript(observeShaderPreparation, true);
    await page.goto(new URL('?vr=pc&world=residence&place=living-window&time=night', url).href);
    await button(page, 'VRの接続を再確認').waitFor();
    assert.equal(await button(page, '高品質').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => { window.xrFixture.supported = true; });
    await button(page, 'VRの接続を再確認').click();
    await page.waitForFunction(() => window.shaderPreparation.polls > 0);
    assert.equal(await button(page, 'VRを開始').isDisabled(), true);
    assert.equal(await page.locator('#coast-xr-status').textContent(), 'VRの描画を準備しています。');
    assert.equal(await page.evaluate(() => window.xrFixture.requests), 0);

    await page.evaluate(() => { window.shaderPreparation.throwCompletion = true; });
    await button(page, '描画準備をやり直す').waitFor();
    assert.match(await page.locator('#coast-xr-status').textContent(), /描画を準備できませんでした/);
    await page.evaluate(() => {
      window.shaderPreparation.throwCompletion = false;
      window.shaderPreparation.allow = true;
      window.xrFixture.denyNext = true;
    });
    await button(page, '描画準備をやり直す').click();
    assert.equal(await page.evaluate(() => window.xrFixture.requests), 0,
      'Reconnection and preparation retry must not start XR');
    await button(page, 'VRを開始').click();
    await page.locator('#coast-xr-status').filter({ hasText: /VRを開始できませんでした.*Meta Horizon Link/ }).waitFor();
    await button(page, 'VRを開始').click();
    await page.waitForFunction(() => window.xrFixture.eyePoses[320] && window.xrFixture.xrDraws > 0);
    assert.equal(await page.evaluate(() => window.xrFixture.layer.fixedFoveation), .25);
    await page.evaluate(() => {
      window.shaderPreparation.allow = false;
      window.resetResidenceShaderPreparation();
    });
    assert.equal(await button(page, 'VRを終了').isEnabled(), true,
      'Shader preparation cannot block an active session from ending');
    await button(page, 'VRを終了').click();
    await page.waitForFunction(() => window.xrFixture.ends === 1);
    assert.equal(await button(page, 'VRを開始').isDisabled(), true);
    assert.equal(await page.locator('#coast-xr-status').textContent(), 'VRの描画を準備しています。');
    assert.deepEqual(await page.evaluate(() => window.xrFixture.activations), [true, true]);
  } finally {
    await page.close();
  }
});

test('same-device sharing hands off one code without bypassing the chooser or sender approval', { timeout }, async () => {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(installSyntheticCapture);
  await context.addInitScript(observePeers);
  const viewer = await context.newPage();
  try {
    await viewer.goto(url.href);
    await button(viewer, '仮想モニター').click();
    const popup = viewer.waitForEvent('popup');
    await button(viewer, 'この端末から共有').click();
    const sender = await popup;
    await sender.locator('[data-share-button]').waitFor();
    assert.equal(await sender.evaluate(() => window.opener), null);
    assert.equal(await sender.evaluate(() => window.captureFixture.streams.length), 0);
    assert.equal(await viewer.locator('#monitor-join-code').inputValue(), '');
    await button(sender, '画面共有を開始').click();
    await sender.locator('[data-monitor-verification]').filter({ hasText: /^\d{6}$/ }).waitFor();
    const number = await sender.locator('[data-monitor-verification]').textContent();
    assert.equal(await viewer.evaluate(value => document.querySelector('[data-monitor-verification]').textContent === value, number), true);
    assert.equal(await viewer.locator('#monitor-join-code').inputValue(), '');
    assert.equal(await sender.evaluate(() => window.captureFixture.activeGesture), true);
    assert.equal(await sender.evaluate(() => window.monitorPeers.length), 0);
    assert.equal(await viewer.evaluate(() => window.monitorPeers.length), 0);
    assert.equal(await viewer.locator(videoSelector).evaluate(video => video.srcObject), null);
    assert.equal(new URL(sender.url()).search, '?monitor=sender');
    assert.equal(new URL(viewer.url()).searchParams.has('code'), false);
    await button(sender, '接続を許可').click();
    await waitForVideo(viewer, 1);
    await button(sender, '共有を停止').click();
    await viewer.waitForFunction(selector => document.querySelector(selector).srcObject === null, videoSelector);
    assert.equal(await sender.evaluate(() => window.captureFixture.streams[0].getTracks().every(track => track.readyState === 'ended')), true);
    if (screenshotDirectory) {
      for (const size of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
        await sender.setViewportSize(size);
        await viewer.setViewportSize(size);
        for (const [name, page] of [['sender', sender], ['viewer', viewer]]) {
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'monitor controls must not create horizontal page overflow');
          await page.screenshot({ path: join(screenshotDirectory, `monitor-${name}-${size.width}.png`) });
        }
      }
    }
  } finally {
    await context.close();
  }
});

// Exercise the production diagnostics: one three-second interval includes transport,
// video composition, the main-camera surface draw and distinct VideoTexture versions.
async function measurePipelinePage(page) {
  return page.evaluate(async () => {
    const control = document.querySelector('[data-monitor-measure-video]');
    const output = document.querySelector('[data-monitor-video-statistics]');
    const started = Date.now();
    const video = document.querySelector('[data-monitor-video]');
    const observationStarted = performance.now();
    const domQualityBefore = video?.getVideoPlaybackQuality?.();
    let firstObservation;
    let lastObservation;
    let observationCallbacks = 0;
    let observationHandle;
    const observe = (now, metadata) => {
      const frame = { now, frames: metadata.presentedFrames };
      firstObservation ??= frame;
      lastObservation = frame;
      ++observationCallbacks;
      observationHandle = video.requestVideoFrameCallback(observe);
    };
    if (video) observationHandle = video.requestVideoFrameCallback(observe);
    control.click();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Video measurement did not complete')); }, 10_000);
      const observer = new MutationObserver(() => {
        if (control.disabled) return;
        clearTimeout(timer);
        observer.disconnect();
        resolve();
      });
      observer.observe(control, { attributes: true });
    });
    const observationEnded = performance.now();
    const domQualityAfter = video?.getVideoPlaybackQuality?.();
    const domQualityObservation = domQualityBefore && domQualityAfter ? { scope: video.hidden ? 'unavailable-for-hidden-webgl-video' : 'visible-dom', totalDelta: domQualityAfter.totalVideoFrames - domQualityBefore.totalVideoFrames, droppedDelta: domQualityAfter.droppedVideoFrames - domQualityBefore.droppedVideoFrames } : undefined;
    if (observationHandle !== undefined) video.cancelVideoFrameCallback(observationHandle);
    const presentationObservation = video ? {
      elapsedMs: observationEnded - observationStarted, callbacks: observationCallbacks,
      firstDelayMs: firstObservation ? firstObservation.now - observationStarted : undefined,
      lastGapMs: lastObservation ? observationEnded - lastObservation.now : undefined,
      frameSpan: firstObservation && lastObservation ? lastObservation.frames - firstObservation.frames + 1 : 0,
    } : undefined;
    const text = output.textContent;
    const measured = JSON.parse(output.dataset.monitorVideoMeasurement ?? 'null');
    if (!measured) throw new Error('Raw video measurement is unavailable');
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : '';
    const graphicsApi = /metal/i.test(renderer) ? 'Metal' : /vulkan/i.test(renderer) ? 'Vulkan' : /opengl/i.test(renderer) ? 'OpenGL' : /d3d/i.test(renderer) ? 'D3D' : 'unknown';
    const backend = /swiftshader|software|llvmpipe/i.test(renderer) ? 'software'
      : /metal|apple|nvidia|amd|intel/i.test(renderer) ? 'hardware' : 'unknown';
    return {
      started, elapsedMs: Date.now() - started, visibility: document.visibilityState, backend, graphicsApi, presentationObservation, domQualityObservation,
      frames: measured.captureFps, framesEncoded: measured.encodedFps, framesSent: measured.sentFps,
      framesReceived: measured.receivedFps, framesDecoded: measured.decodedFps, presentedFps: measured.presentedFps,
      renderedFps: measured.renderedFps, suppliedFps: measured.suppliedFps, uploadFps: measured.uploadFps, playbackPresentedFps: measured.playbackPresentedFps, playbackDroppedFps: measured.playbackDroppedFps, raw: measured,
      surface: text.includes('（浮遊面）') ? 'floating' : text.includes('（テレビ面）') ? 'television' : 'unavailable',
    };
  });
}

test('15 30 and 60fps inputs are measured separately across the native video pipeline', { timeout: 120_000 }, async t => {
  const resolution = (process.env.MONITOR_FRAME_SIZE ?? '320x180').split('x').map(Number);
  assert.ok(resolution.length === 2 && resolution.every(value => Number.isSafeInteger(value) && value > 0 && value <= 3840), 'frame fixture dimensions must be valid');
  const results = [];
  for (const inputFps of [15, 30, 60]) {
    const sender = await newPage();
    const viewer = await newPage();
    try {
      await sender.addInitScript(installSyntheticCapture);
      await sender.addInitScript(observePeers);
      await viewer.addInitScript(observePeers);
      await sender.goto(new URL('?monitor=sender', url).href);
      await viewer.goto(url.href);
      await sender.evaluate(({ fps, resolution }) => {
        Object.assign(window.captureFixture, { frameRate: fps, width: resolution[0], height: resolution[1] });
      }, { fps: inputFps, resolution });
      await button(viewer, '仮想モニター').click();
      await button(viewer, 'モニターを表示').click();
      await requestPairing(sender, viewer);
      await button(sender, '接続を許可').click();
      await waitForVideo(viewer, 1, null);
      const captureGeometry = await sender.evaluate(() => {
        const track = window.captureFixture.streams[0].getVideoTracks()[0];
        const settings = track.getSettings();
        return {
          canvas: track.canvas instanceof HTMLCanvasElement ? [track.canvas.width, track.canvas.height] : null,
          settings: [settings.width, settings.height], frameRate: settings.frameRate,
          requestedFrameRate: window.captureFixture.options.video.frameRate,
        };
      });
      assert.deepEqual(captureGeometry.canvas, resolution, 'the actual canvas pixel dimensions must remain identical across rates');
      assert.deepEqual(captureGeometry.settings, resolution, 'native track settings must agree with the actual canvas');
      // Allow the encoder's initial ramp and ICE setup to settle before using cumulative counters.
      const warmupSeconds = Number(process.env.MONITOR_FRAME_WARMUP_SECONDS ?? 2);
      assert.ok(Number.isFinite(warmupSeconds) && warmupSeconds >= 0 && warmupSeconds <= 30);
      // Fixed warm-up is an explicit measurement condition, not a readiness substitute.
      await new Promise(resolve => setTimeout(resolve, warmupSeconds * 1000));
      const encoder = await sender.evaluate(async () => {
        const peer = window.monitorPeers[0];
        const sender = peer.getSenders().find(sender => sender.track.kind === 'video');
        const params = sender.getParameters();
        const stats = await peer.getStats();
        const report = { encodings: params.encodings.map(row => ({
          maxFramerate: row.maxFramerate, scaleResolutionDownBy: row.scaleResolutionDownBy,
          maxBitrate: row.maxBitrate, active: row.active,
        })), source: [], outbound: [] };
        stats.forEach(row => {
          if (row.kind !== 'video') return;
          if (row.type === 'media-source') report.source.push({ width: row.width, height: row.height, framesPerSecond: row.framesPerSecond });
          if (row.type === 'outbound-rtp') report.outbound.push({ codec: stats.get(row.codecId)?.mimeType, width: row.frameWidth, height: row.frameHeight,
            framesPerSecond: row.framesPerSecond, qualityLimitation: row.qualityLimitationReason,
            qualityLimitationDurations: row.qualityLimitationDurations, targetBitrate: row.targetBitrate, powerEfficientEncoder: row.powerEfficientEncoder });
        });
        const paints = window.captureFixture.paintTimes;
        const deltas = paints.slice(1).map((time, index) => time - paints[index]).sort((a, b) => a - b);
        report.paintCadence = deltas.length ? { samples: deltas.length, minMs: deltas[0], medianMs: deltas[Math.floor(deltas.length / 2)], maxMs: deltas.at(-1) } : null;
        return report;
      });
      const [sent, received] = await Promise.all([measurePipelinePage(sender), measurePipelinePage(viewer)]);
      const stages = { capture: sent.frames, encode: sent.framesEncoded, send: sent.framesSent, receive: received.framesReceived, decode: received.framesDecoded, videoComposition: received.presentedFps, surfaceSupply: received.suppliedFps };
      const frameWindowTolerance = 1000 / Math.min(sent.raw.durationMs, received.raw.durationMs, received.raw.presentationDurationMs);
      const target60Compatible = inputFps === 60 ? Object.values(stages).every(value => Number.isFinite(value) && Math.abs(value - 60) <= frameWindowTolerance) : undefined;
      const decodedResolution = await viewer.locator(videoSelector).evaluate(video => [video.videoWidth, video.videoHeight]);
      const result = { inputFps, resolution, captureGeometry, decodedResolution, encoder, warmupSeconds, durationMs: 3000, startSkewMs: Math.abs(sent.started - received.started), sent, received, stages, frameWindowTolerance, target60Compatible };
      results.push(result);
      if (screenshotDirectory) await writeFile(join(screenshotDirectory, 'monitor-frame-rates.json'), `${JSON.stringify({ browser: browser.version(), results }, null, 2)}\n`);
      t.diagnostic(JSON.stringify(result));
      assert.ok(sent.frames > inputFps * .65 && sent.frames <= inputFps * 1.2, 'source rate must identify the supplied input');
      assert.ok(sent.framesSent > 0 && received.framesReceived > 0 && received.framesDecoded > 0);
      assert.ok(received.presentedFps > 0 && received.presentedFps <= received.framesDecoded * 1.3);
      assert.equal(received.surface, 'floating');
      assert.ok(received.renderedFps > 0 && received.suppliedFps > 0);
      assert.ok(received.suppliedFps <= received.renderedFps * 1.1, 'reflections and extra passes must not be counted as displayed frames');
      if (inputFps === 60 && process.env.MONITOR_REQUIRE_60_FPS === '1') {
        assert.equal(target60Compatible, true, 'every raw measured stage must match60 within one frame per observation window;56fps is not60');
      }
      assert.ok((await screenPixels(viewer)).count > 2_000, 'the actual scene contains the received video texture');
      assert.equal(await sender.evaluate(() => window.monitorPeers[0].getSenders().find(sender => sender.track.kind === 'video').getParameters().encodings[0].maxFramerate), 60);
      assert.equal(await sender.evaluate(() => window.captureFixture.streams[0].getVideoTracks()[0].contentHint), 'motion');
    } finally {
      await sender.context().close();
      await viewer.context().close();
    }
  }
  const high = results.find(row => row.inputFps === 60);
  const low = results.find(row => row.inputFps === 15);
  assert.ok(high.sent.framesSent > low.sent.framesSent * 2, 'the transport must preserve a materially higher rate for the 60fps source');
});
