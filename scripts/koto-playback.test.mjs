import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { after, before, test } from 'node:test';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !extname(specifier);
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { LakeKoto } = await import('../src/coast/world/lake/lakeKoto.ts');
const { LakeKotoAsset } = await import('../src/coast/world/lake/lakeKotoAsset.ts');
const { createLakeKotoSpeakerArray, LAKE_KOTO_SPEAKERS } =
  await import('../src/coast/world/lake/lakeKotoSpeakers.ts');
const { LAKE_DESTINATIONS, LAKE_HALL } = await import('../src/coast/world/lake/lakeLayout.ts');
hooks.deregister();

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const drain = () => new Promise(resolve => setImmediate(resolve));
const audioBuffer = id => ({ id, numberOfChannels: 1, duration: 39, sampleRate: 48_000, length: 39 * 48_000 });
const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) });
const listener = { x: 0, y: 1.65, z: 7 };

const nativePanner = globalThis.PannerNode;
before(() => {
  globalThis.PannerNode = class {
    constructor(context, options) {
      const panner = context.createPanner();
      panner.positionX.value = options.positionX;
      panner.positionY.value = options.positionY;
      panner.positionZ.value = options.positionZ;
      panner.panningModel = options.panningModel;
      panner.rolloffFactor = options.rolloffFactor;
      return panner;
    }
  };
});
after(() => {
  if (nativePanner === undefined) delete globalThis.PannerNode;
  else globalThis.PannerNode = nativePanner;
});

function fakeContext() {
  const nodes = [];
  const param = (value = 0) => ({
    value, events: [],
    cancelScheduledValues(time) { this.events.push(['cancel', time]); },
    setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); },
    setTargetAtTime(value, time, constant) { this.events.push(['target', value, time, constant]); },
    linearRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); },
  });
  function node(kind) {
    const result = {
      kind, connections: [], disconnects: 0,
      connect(target) { this.connections.push(target); return target; },
      disconnect() { this.connections.length = 0; this.disconnects += 1; },
    };
    nodes.push(result);
    return result;
  }
  return {
    currentTime: 2, sampleRate: 48_000, nodes,
    decodeCalls: 0,
    async decodeAudioData() { this.decodeCalls += 1; return audioBuffer('default'); },
    createBuffer(numberOfChannels, length, sampleRate) {
      const data = new Float32Array(length);
      return { numberOfChannels, length, sampleRate, duration: length / sampleRate,
        getChannelData: () => data, copyToChannel: samples => data.set(samples.subarray(0, length)) };
    },
    createGain() { return Object.assign(node('gain'), { gain: param(1) }); },
    createPanner() {
      return Object.assign(node('panner'), { positionX: param(), positionY: param(), positionZ: param() });
    },
    createBufferSource() {
      return Object.assign(node('source'), {
        buffer: null, starts: [], stops: [], onended: null,
        start(time) { this.starts.push(time); },
        stop(time) { this.stops.push(time); },
        end() { this.onended?.(); },
      });
    },
  };
}

test('koto loading is lazy, coalesces concurrent requests and keeps one decoded buffer until disposal', async t => {
  const context = fakeContext();
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches += 1; return response(); });
  const asset = new LakeKotoAsset(context);
  assert.equal(fetches, 0);
  assert.equal(context.decodeCalls, 0);
  const first = asset.load();
  assert.equal(asset.load(), first);
  const buffer = await first;
  assert.equal(await asset.load(), buffer);
  asset.cancel();
  assert.equal(await asset.load(), buffer);
  assert.equal(fetches, 1);
  assert.equal(context.decodeCalls, 1);
  asset.dispose();
  asset.dispose();
  await assert.rejects(asset.load(), /disposed/);
});

test('koto HTTP and decode failures can be retried without retaining a failed request', async t => {
  const context = fakeContext();
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => ({ ...response(), ok: ++fetches !== 1 }));
  const asset = new LakeKotoAsset(context);
  await assert.rejects(asset.load(), /loaded/);
  context.decodeAudioData = async () => { throw new Error('decoder rejected the fixture'); };
  await assert.rejects(asset.load(), /decoder/);
  context.decodeAudioData = async () => audioBuffer('retried');
  assert.equal((await asset.load()).id, 'retried');
  assert.equal(fetches, 3);
  asset.dispose();
});

test('koto rejects unexpected channel count or duration before caching the asset', async t => {
  const context = fakeContext();
  t.mock.method(globalThis, 'fetch', async () => response());
  const asset = new LakeKotoAsset(context);
  context.decodeAudioData = async () => ({ ...audioBuffer('stereo'), numberOfChannels: 2 });
  await assert.rejects(asset.load(), /format/);
  context.decodeAudioData = async () => ({ ...audioBuffer('short'), duration: 38.5, length: 38.5 * 48_000 });
  await assert.rejects(asset.load(), /format/);
  context.decodeAudioData = async () => audioBuffer('valid');
  assert.equal((await asset.load()).id, 'valid');
  asset.dispose();
});

test('a one-frame resampler difference is normalized once while larger duration errors remain invalid', async t => {
  const context = fakeContext();
  context.sampleRate = 44_100;
  t.mock.method(globalThis, 'fetch', async () => response());
  const frames = 39 * context.sampleRate;
  for (const difference of [-1, 1]) {
    const samples = new Float32Array(frames + difference);
    samples[0] = 0.25;
    samples[frames - 2] = 0.5;
    if (difference === 1) samples[frames] = 0.75;
    context.decodeAudioData = async () => ({ sampleRate: context.sampleRate, numberOfChannels: 1,
      length: samples.length, duration: samples.length / context.sampleRate, getChannelData: () => samples });
    const asset = new LakeKotoAsset(context);
    const buffer = await asset.load();
    assert.equal(buffer.length, frames);
    assert.equal(buffer.duration, 39);
    assert.equal(buffer.getChannelData(0)[0], 0.25);
    assert.equal(buffer.getChannelData(0)[frames - 2], 0.5);
    assert.equal(buffer.getChannelData(0).at(-1), 0);
    assert.equal(await asset.load(), buffer);
    asset.dispose();
  }
  context.decodeAudioData = async () => ({ ...audioBuffer('two-frames'), sampleRate: 44_100, length: frames - 2 });
  const invalid = new LakeKotoAsset(context);
  await assert.rejects(invalid.load(), /format/);
  invalid.dispose();
});

test('a cancelled late fetch cannot replace a newer pending request or its cached buffer', async t => {
  const context = fakeContext();
  const oldFetch = deferred();
  const newDecode = deferred();
  let fetches = 0;
  context.decodeAudioData = () => newDecode.promise;
  t.mock.method(globalThis, 'fetch', () => ++fetches === 1 ? oldFetch.promise : Promise.resolve(response()));
  const asset = new LakeKotoAsset(context);
  const old = asset.load();
  const cancelled = assert.rejects(old, { name: 'AbortError' });
  await drain();
  asset.cancel();
  const next = asset.load();
  await drain();
  oldFetch.resolve(response());
  await cancelled;
  assert.equal(asset.load(), next);
  newDecode.resolve(audioBuffer('new'));
  assert.equal((await next).id, 'new');
  assert.equal((await asset.load()).id, 'new');
  asset.dispose();
});

test('stopping during native decode shares the unfinished decode with the next play', async t => {
  const context = fakeContext();
  const decode = deferred();
  let decodes = 0;
  let fetches = 0;
  context.decodeAudioData = () => { decodes += 1; return decode.promise; };
  t.mock.method(globalThis, 'fetch', async () => { fetches += 1; return response(); });
  const koto = new LakeKoto(context, context.createGain());
  const old = koto.play(listener);
  await drain();
  koto.stop();
  const next = koto.play(listener);
  decode.resolve(audioBuffer('shared-decode'));
  await Promise.all([old, next]);
  assert.equal(fetches, 1);
  assert.equal(decodes, 1);
  assert.equal(context.nodes.filter(node => node.kind === 'source').length, 1);
  assert.equal(koto.playing, true);
  koto.dispose();
});

test('stopping a pending fetch aborts it and never starts playback when it finishes late', async t => {
  const context = fakeContext();
  const pendingFetch = deferred();
  let signal;
  t.mock.method(globalThis, 'fetch', (_url, options) => { signal = options.signal; return pendingFetch.promise; });
  const koto = new LakeKoto(context, context.createGain());
  const playing = koto.play(listener);
  assert.equal(koto.playing, false);
  koto.stop();
  assert.equal(signal.aborted, true);
  pendingFetch.resolve(response());
  await playing;
  assert.equal(context.decodeCalls, 0);
  assert.equal(context.nodes.filter(node => node.kind === 'source').length, 0);
  koto.dispose();
});

test('rapid play requests share a load, play once, then stop and restart with the same buffer', async t => {
  const context = fakeContext();
  const decode = deferred();
  context.decodeAudioData = () => decode.promise;
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetches += 1; return response(); });
  const output = context.createGain();
  const koto = new LakeKoto(context, output);
  const first = koto.play(listener);
  const second = koto.play(listener);
  await drain();
  decode.resolve(audioBuffer('shared'));
  await Promise.all([first, second]);
  const sources = () => context.nodes.filter(node => node.kind === 'source');
  assert.equal(sources().length, 1);
  assert.equal(sources()[0].loop, true);
  assert.equal(sources()[0].loopStart, 0);
  assert.equal(sources()[0].loopEnd, 39);
  assert.equal(koto.playing, true);
  await koto.play(listener);
  assert.equal(sources().length, 1);
  context.currentTime += 0.025;
  koto.stop();
  assert.equal(koto.playing, false);
  assert.deepEqual(sources()[0].stops, [context.currentTime + 0.065]);
  const fade = sources()[0].connections[0].gain.events;
  assert.ok(Math.abs(fade.at(-2)[1] - 0.025 / 0.065) < 1e-10);
  assert.deepEqual(fade.at(-1), ['ramp', 0, context.currentTime + 0.065]);
  await koto.play(listener);
  assert.equal(sources().length, 2);
  assert.equal(fetches, 1);
  assert.equal(sources()[1].buffer, sources()[0].buffer);
  sources()[0].end();
  assert.equal(sources()[0].buffer, null);
  assert.equal(koto.playing, true);
  koto.dispose();
  koto.dispose();
  assert.equal(koto.playing, false);
  assert.equal(sources()[1].buffer, null);
  assert.ok(context.nodes.filter(node => node !== output).every(node => node.connections.length === 0));
  await koto.play(listener);
  assert.equal(sources().length, 2);
});

test('disposing during decode prevents late playback and releases the whole speaker graph', async t => {
  const context = fakeContext();
  const decode = deferred();
  context.decodeAudioData = () => decode.promise;
  t.mock.method(globalThis, 'fetch', async () => response());
  const output = context.createGain();
  const koto = new LakeKoto(context, output);
  const playing = koto.play(listener);
  await drain();
  koto.dispose();
  decode.resolve(audioBuffer('late'));
  await playing;
  assert.equal(koto.playing, false);
  assert.ok(context.nodes.filter(node => node !== output).every(node => node.connections.length === 0));
  assert.equal(context.nodes.filter(node => node.kind === 'source').length, 0);
});

test('playback uses the latest listener position when loading finishes', async t => {
  const context = fakeContext();
  const decode = deferred();
  context.decodeAudioData = () => decode.promise;
  t.mock.method(globalThis, 'fetch', async () => response());
  const koto = new LakeKoto(context, context.createGain());
  const playing = koto.play(listener);
  const outside = { ...listener, x: 22 };
  koto.update(outside, context.currentTime);
  decode.resolve(audioBuffer('moved'));
  await playing;
  const input = context.nodes.find(node => node.channelCountMode === 'explicit');
  assert.ok(input.connections.every(node => node.gain.value === 0));
  koto.update(listener, context.currentTime, true);
  assert.ok(input.connections.every(node => node.gain.value > 0));
  koto.dispose();
});

test('the shared graph uses the twelve ceiling coordinates without a second distance rolloff', () => {
  const context = fakeContext();
  const output = context.createGain();
  const graph = createLakeKotoSpeakerArray(context, output);
  const panners = context.nodes.filter(node => node.kind === 'panner');
  assert.equal(panners.length, 12);
  assert.equal(graph.input.connections.length, 12);
  for (const [index, panner] of panners.entries()) {
    const point = LAKE_KOTO_SPEAKERS[index];
    assert.deepEqual([panner.positionX.value, panner.positionY.value, panner.positionZ.value],
      [point.x, point.y, point.z]);
    assert.equal(panner.panningModel, 'HRTF');
    assert.equal(panner.rolloffFactor, 0);
    assert.deepEqual(panner.connections, [output]);
  }
  graph.update(listener, context.currentTime, true);
  assert.ok(graph.input.connections.every(node => node.gain.value > 0));
  graph.update({ ...listener, x: 22 }, context.currentTime, true);
  assert.ok(graph.input.connections.every(node => node.gain.value === 0));
  graph.dispose();
  graph.dispose();
  graph.update(listener, context.currentTime, true);
  assert.ok(context.nodes.filter(node => node !== output).every(node => node.connections.length === 0));
});

const runBrowser = Boolean(process.env.KOTO_AUDIO_BROWSER);
test('Chromium renders the performance excerpt at each reference position and two complete production loops', {
  skip: !runBrowser, timeout: 180_000,
}, async t => {
  const { mkdir, readFile, writeFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const { cpus, totalmem } = await import('node:os');
  const { resolve } = await import('node:path');
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const directory = resolve(process.env.KOTO_SPATIAL_ARTIFACTS || '/private/tmp/lumen-koto-spatial');
  await mkdir(directory, { recursive: true });
  const fixture = process.env.KOTO_AUDIO_ASSET;
  const fixtureBytes = fixture ? await readFile(fixture) : undefined;
  const inputBytes = fixtureBytes || await readFile(new URL('../public/lake-audio/koto-performance.wav', import.meta.url));
  const sourceHashes = {};
  for (const path of ['src/coast/world/lake/lakeKoto.ts', 'src/coast/world/lake/lakeKotoAsset.ts',
    'src/coast/world/lake/lakeKotoSpeakers.ts', 'src/coast/world/lake/lakeAudio.ts',
    'src/coast/world/lake/lakeLayout.ts', 'src/coast/explorationOutput.ts']) {
    sourceHashes[path] = createHash('sha256').update(await readFile(new URL(`../${path}`, import.meta.url))).digest('hex');
  }
  const server = await createServer({
    configFile: false, logLevel: 'error', optimizeDeps: { include: ['three'], noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, watch: null },
    plugins: [{
      name: 'koto-measurement-bootstrap',
      configureServer(server) {
        server.middlewares.use('/__koto-playback-study.html', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><title>Koto playback study</title>');
        });
        if (fixtureBytes) server.middlewares.use('/lake-audio/koto-performance.wav', (_request, response) => {
          response.setHeader('Content-Type', 'audio/wav');
          response.end(fixtureBytes);
        });
      },
    }],
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch({ channel: process.env.COAST_CHROME_CHANNEL || undefined });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const address = server.httpServer.address();
  // Cold source-document navigation slowed the probe; use a minimal HTML bootstrap.
  await page.goto(`http://127.0.0.1:${address.port}/__koto-playback-study.html`);
  const startedWall = performance.now();
  const startedCpu = process.cpuUsage();
  const startedRss = process.memoryUsage().rss;
  const cdp = await browser.newBrowserCDPSession();
  const processInfo = async () => {
    try { return (await cdp.send('SystemInfo.getProcessInfo')).processInfo; }
    catch { return []; }
  };
  const beforeProcesses = await processInfo();
  async function processSnapshot(label) {
    const processes = await processInfo();
    if (!processes.length) return { label, status: 'unavailable' };
    try {
      const ids = processes.map(process => process.id).filter(Number.isSafeInteger);
      const raw = execFileSync('ps', ['-o', 'pid=,ppid=,%cpu=,rss=', '-p', ids.join(',')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const snapshots = raw.trim().split('\n').map(line => {
        const [pid, ppid, cpuPercent, rssKiB] = line.trim().split(/\s+/).map(Number);
        return { pid, ppid, cpuPercent, rssKiB, type: processes.find(process => process.id === pid)?.type };
      });
      return { label, processes: snapshots };
    } catch { return { label, status: 'unavailable' }; }
  }
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const positions = [
    ...LAKE_DESTINATIONS.map(({ id, x, z }) => ({ name: id === 'hall' ? 'center' : id, x, y: 1.65, z })),
    { name: 'rear', x: 0, y: 1.65, z: LAKE_HALL.rearZ - 2 },
  ];
  const metrics = { input: fixture || 'public/lake-audio/koto-performance.wav', sampleRate: 48_000,
    inputSha256: createHash('sha256').update(inputBytes).digest('hex'), sourceHashes, complete: false,
    spatialExcerptSeconds: [0, 3], loopRenderSeconds: 79,
    bootstrap: 'Minimal HTML document; application/WebGL rendering is excluded.',
    browser: browser.version(), outputStage: 'LakeKoto → LakeAudio master → connectExplorationOutput',
    environment: { node: process.version, platform: process.platform, architecture: process.arch,
      cpuModel: cpus()[0]?.model, logicalCpuCount: cpus().length, physicalMemoryBytes: totalmem() },
    evidence: 'Chromium OfflineAudioContext output; not hardware sound pressure, real-time CPU or human listening',
    renders: [] };
  metrics.processSnapshots = [await processSnapshot('before')];
  metrics.decoding = await page.evaluate(async () => {
    const { LakeKotoAsset } = await import('/src/coast/world/lake/lakeKotoAsset.ts');
    const decoded = [];
    for (const rate of [44_100, 48_000]) {
      const context = new OfflineAudioContext(1, 1, rate);
      const nativeDecode = context.decodeAudioData.bind(context);
      let nativeFrames;
      context.decodeAudioData = async encoded => {
        const decoded = await nativeDecode(encoded);
        nativeFrames = decoded.length;
        return decoded;
      };
      const asset = new LakeKotoAsset(context);
      const started = performance.now();
      const buffer = await asset.load();
      const fetchDecodeMs = performance.now() - started;
      let samplePeak = 0;
      let energy = 0;
      let nonFiniteCount = 0;
      for (const sample of buffer.getChannelData(0)) {
        if (!Number.isFinite(sample)) nonFiniteCount += 1;
        samplePeak = Math.max(samplePeak, Math.abs(sample));
        energy += sample ** 2;
      }
      decoded.push({ contextRate: rate, bufferRate: buffer.sampleRate, frames: buffer.length,
        duration: buffer.duration, channels: buffer.numberOfChannels,
        decodedBytes: buffer.length * buffer.numberOfChannels * 4, fetchDecodeMs,
        nativeFrames, normalizedFrameDifference: buffer.length - nativeFrames,
        logicalPcmBytesDuringNormalization: (buffer.length === nativeFrames ? buffer.length : buffer.length + nativeFrames) * 4,
        samplePeak, rms: Math.sqrt(energy / buffer.length), nonFiniteCount });
      asset.dispose();
    }
    return decoded;
  });
  for (const decoded of metrics.decoding) {
    assert.equal(decoded.bufferRate, decoded.contextRate);
    assert.equal(decoded.frames, decoded.contextRate * 39);
    assert.equal(decoded.channels, 1);
    assert.equal(decoded.duration, 39);
    assert.equal(decoded.nonFiniteCount, 0);
    assert.ok(decoded.samplePeak > 0 && decoded.samplePeak < 1);
  }
  for (const position of positions) {
    for (const heading of ['forward', 'reverse']) {
      const result = await page.evaluate(async ({ position, heading }) => {
        const { LakeKoto } = await import('/src/coast/world/lake/lakeKoto.ts');
        const { LAKE_AUDIO_MASTER_GAIN } = await import('/src/coast/world/lake/lakeAudio.ts');
        const { connectExplorationOutput } = await import('/src/coast/explorationOutput.ts');
        const { lakeKotoSpeakerGains } = await import('/src/coast/world/lake/lakeKotoSpeakers.ts');
        const context = new OfflineAudioContext(2, 3 * 48_000, 48_000);
        const listener = context.listener;
        listener.positionX.value = position.x;
        listener.positionY.value = position.y;
        listener.positionZ.value = position.z;
        listener.forwardX.value = 0;
        listener.forwardY.value = 0;
        listener.forwardZ.value = heading === 'forward' ? -1 : 1;
        listener.upX.value = 0;
        listener.upY.value = 1;
        listener.upZ.value = 0;
        const master = context.createGain();
        master.gain.value = LAKE_AUDIO_MASTER_GAIN;
        const output = connectExplorationOutput(context, master);
        const initializeAt = performance.now();
        const koto = new LakeKoto(context, master);
        const loadingAt = performance.now();
        await koto.play(position);
        const loadedAt = performance.now();
        const rendered = await context.startRendering();
        const renderedAt = performance.now();
        const left = rendered.getChannelData(0);
        const right = rendered.getChannelData(1);
        let peak = 0;
        let leftEnergy = 0;
        let rightEnergy = 0;
        let cross = 0;
        let nonFinite = 0;
        for (let i = 0; i < left.length; i += 1) {
          if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) nonFinite += 1;
          peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
          leftEnergy += left[i] ** 2;
          rightEnergy += right[i] ** 2;
          cross += left[i] * right[i];
        }
        const wav = new Uint8Array(44 + left.length * 4);
        const view = new DataView(wav.buffer);
        const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
        text(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
        view.setUint32(24, 48_000, true); view.setUint32(28, 48_000 * 4, true);
        view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data');
        view.setUint32(40, left.length * 4, true);
        for (let i = 0; i < left.length; i += 1) {
          view.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
          view.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
        }
        const chunks = [];
        for (let offset = 0; offset < wav.length; offset += 32_768) {
          chunks.push(String.fromCharCode(...wav.subarray(offset, offset + 32_768)));
        }
        const coherentGain = lakeKotoSpeakerGains(position).reduce((sum, gain) => sum + gain, 0);
        const disposeAt = performance.now();
        koto.dispose();
        master.disconnect();
        for (const node of output) node.disconnect();
        const disposeMs = performance.now() - disposeAt;
        return { audio: btoa(chunks.join('')), metrics: {
          position, heading, peak, rms: Math.sqrt((leftEnergy + rightEnergy) / (2 * left.length)),
          leftRms: Math.sqrt(leftEnergy / left.length), rightRms: Math.sqrt(rightEnergy / right.length),
          rightMinusLeftDb: 10 * Math.log10(rightEnergy / leftEnergy),
          correlation: cross / Math.sqrt(leftEnergy * rightEnergy), nonFinite,
          coherentGain, masterGain: LAKE_AUDIO_MASTER_GAIN,
          initializeMs: loadingAt - initializeAt, disposeMs,
          loadDecodeMs: loadedAt - loadingAt, renderMs: renderedAt - loadedAt,
          renderedSeconds: rendered.duration, decodedMonoBytes: 39 * 48_000 * 4,
        } };
      }, { position, heading });
      const name = `${position.name}-${heading}.wav`;
      await writeFile(resolve(directory, name), Buffer.from(result.audio, 'base64'));
      metrics.renders.push({ ...result.metrics, artifact: name });
      metrics.processSnapshots.push(await processSnapshot(name));
      await writeFile(resolve(directory, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
      assert.equal(result.metrics.nonFinite, 0);
      assert.ok(result.metrics.peak > 0.001 && result.metrics.peak < 1, `${name}: bounded audible output`);
      assert.equal(result.metrics.renderedSeconds, 3);
    }
  }
  const westForward = metrics.renders.find(render => render.position.name === 'west-window' && render.heading === 'forward');
  const westReverse = metrics.renders.find(render => render.position.name === 'west-window' && render.heading === 'reverse');
  assert.ok(westForward.rightMinusLeftDb * westReverse.rightMinusLeftDb < 0,
    'turning around reverses the ear-level difference beside the western window');
  metrics.loop = await page.evaluate(async () => {
    const { LakeKoto } = await import('/src/coast/world/lake/lakeKoto.ts');
    const { LAKE_AUDIO_MASTER_GAIN } = await import('/src/coast/world/lake/lakeAudio.ts');
    const { connectExplorationOutput } = await import('/src/coast/explorationOutput.ts');
    const context = new OfflineAudioContext(2, 79 * 48_000, 48_000);
    context.listener.positionY.value = 1.65;
    context.listener.positionZ.value = 7;
    const master = context.createGain();
    master.gain.value = LAKE_AUDIO_MASTER_GAIN;
    const output = connectExplorationOutput(context, master);
    const koto = new LakeKoto(context, master);
    await koto.play({ x: 0, y: 1.65, z: 7 });
    let stoppedAt;
    const stopping = context.suspend(78.1).then(async () => {
      stoppedAt = context.currentTime;
      koto.stop();
      await context.resume();
    });
    const rendered = await context.startRendering();
    await stopping;
    let seam = 0;
    let stoppedPeak = 0;
    let firstEnergy = 0;
    let secondEnergy = 0;
    for (let channel = 0; channel < 2; channel += 1) {
      const data = rendered.getChannelData(channel);
      seam = Math.max(seam, Math.abs(data[39 * 48_000] - data[39 * 48_000 - 1]));
      for (let i = Math.round(78.4 * 48_000); i < data.length; i += 1) stoppedPeak = Math.max(stoppedPeak, Math.abs(data[i]));
      for (let i = 48_000; i < 38 * 48_000; i += 1) {
        firstEnergy += data[i] ** 2;
        secondEnergy += data[i + 39 * 48_000] ** 2;
      }
    }
    koto.dispose();
    master.disconnect();
    for (const node of output) node.disconnect();
    return { duration: rendered.duration, seamDelta: seam, stoppedPeak,
      secondToFirstEnergyDb: 10 * Math.log10(secondEnergy / firstEnergy),
      stopRequestedSeconds: 78.1, stopActualSeconds: stoppedAt, silenceMeasuredFromSeconds: 78.4 };
  });
  metrics.complete = true;
  const endedCpu = process.cpuUsage(startedCpu);
  const afterProcesses = await processInfo();
  metrics.processWorkload = { wallMs: performance.now() - startedWall,
    nodeUserCpuMs: endedCpu.user / 1000, nodeSystemCpuMs: endedCpu.system / 1000,
    nodeRssBeforeBytes: startedRss, nodeRssAfterBytes: process.memoryUsage().rss,
    browserCpu: afterProcesses.map(process => ({ pid: process.id, type: process.type,
      deltaSeconds: process.cpuTime - (beforeProcesses.find(before => before.id === process.id)?.cpuTime ?? 0) })),
    limit: 'Whole offline test workload including fetch, rendering, JavaScript and capture; not real-time audio-thread CPU.' };
  metrics.processSnapshots.push(await processSnapshot('after-loop'));
  await writeFile(resolve(directory, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  assert.ok(metrics.loop.seamDelta < 1e-4, 'the rendered loop seam remains below -80dBFS');
  assert.ok(metrics.loop.stoppedPeak < 1e-6, 'stop becomes silent after fade and output tail');
  assert.ok(Math.abs(metrics.loop.secondToFirstEnergyDb) < 0.05, 'the second loop preserves its level');
  assert.deepEqual(errors, []);
});
