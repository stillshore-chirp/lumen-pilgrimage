import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { cpus, totalmem, tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BANDS = [[80, 500], [500, 2000], [2000, 6000], [6000, 12000], [12000, 20000]];
const FFT_SIZE = 16_384;

// The complete impulse response is zero-padded, without a music-analysis window that would color it.
function impulsePower(samples) {
  const real = new Float64Array(FFT_SIZE);
  const imaginary = new Float64Array(FFT_SIZE);
  real.set(samples);
  for (let i = 1, j = 0; i < FFT_SIZE; i += 1) {
    let bit = FFT_SIZE >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let length = 2; length <= FFT_SIZE; length *= 2) {
    const angle = -2 * Math.PI / length;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let start = 0; start < FFT_SIZE; start += length) {
      let wr = 1;
      let wi = 0;
      for (let i = 0; i < length / 2; i += 1) {
        const a = start + i;
        const b = a + length / 2;
        const tr = wr * real[b] - wi * imaginary[b];
        const ti = wr * imaginary[b] + wi * real[b];
        real[b] = real[a] - tr;
        imaginary[b] = imaginary[a] - ti;
        real[a] += tr;
        imaginary[a] += ti;
        const next = wr * cosine - wi * sine;
        wi = wr * sine + wi * cosine;
        wr = next;
      }
    }
  }
  return Float64Array.from({ length: FFT_SIZE / 2 + 1 }, (_, i) => real[i] ** 2 + imaginary[i] ** 2);
}

const dbPower = value => 10 * Math.log10(Math.max(value, 1e-30));
const rounded = (value, places = 4) => Number(value.toFixed(places));
function bandPower(power, rate, low, high) {
  let sum = 0;
  for (let i = 0; i < power.length; i += 1) {
    const frequency = i * rate / FFT_SIZE;
    if (frequency >= low && frequency < high) sum += power[i];
  }
  return sum;
}

export function analyzeSpatialStudy(source) {
  const spectra = new Map();
  for (const response of source.responses) {
    const channels = response.channels.map(impulsePower);
    const power = Float64Array.from(channels[0], (value, i) =>
      (value + channels[1][i]) / (2 * source.impulseAmplitude ** 2));
    const nonFinite = response.channels.some(channel => channel.some(value => !Number.isFinite(value)));
    assert.equal(nonFinite, false, 'the impulse output must remain finite');
    const first = response.channels[0].findIndex((value, i) =>
      Math.max(Math.abs(value), Math.abs(response.channels[1][i])) > 1e-12);
    assert.ok(first >= 0, 'the impulse output must be non-silent');
    spectra.set(`${response.position.name}/${response.heading}/${response.route}`, {
      power, firstNonzeroSeconds: source.windowSeconds[0] + first / source.rate,
      gainSum: response.gainSum, nearest: response.nearest,
    });
  }
  const comparisons = [];
  const positions = [...new Set(source.responses.map(response => response.position.name))];
  for (const position of positions) {
    for (const heading of ['forward', 'reverse']) {
      const array = spectra.get(`${position}/${heading}/array-final`);
      const single = spectra.get(`${position}/${heading}/nearest-final`);
      const pre = spectra.get(`${position}/${heading}/array-only`);
      const dry = spectra.get(`${position}/${heading}/dry-final`);
      const matchingGainDb = dbPower(bandPower(single.power, source.rate, 80, 12_000)
        / bandPower(array.power, source.rate, 80, 12_000));
      const ratios = (a, b) => BANDS.map(([low, high]) =>
        dbPower(bandPower(a.power, source.rate, low, high) / bandPower(b.power, source.rate, low, high)));
      const raw = ratios(array, single);
      comparisons.push({
        position, heading, preHrtfGainSum: array.gainSum, nearest: array.nearest,
        arrayVsNearestBandDb: raw.map(value => rounded(value, 3)),
        arrayMatchingGainDb80to12000: rounded(matchingGainDb, 3),
        matchedArrayVsNearestBandDb: raw.map(value => rounded(value + matchingGainDb, 3)),
        arrayVsDryFinalBandDb: ratios(array, dry).map(value => rounded(value, 3)),
        nearestVsDryFinalBandDb: ratios(single, dry).map(value => rounded(value, 3)),
        outputStageBandDb: ratios(array, pre).map(value => rounded(value)),
        outputStageAddedLatencyMs: rounded(1000 * (array.firstNonzeroSeconds - pre.firstNonzeroSeconds)),
      });
    }
  }
  return {
    input: `${source.impulseAmplitude} FS impulse at ${source.impulseSeconds} seconds`, rate: source.rate,
    browser: source.browser, bandsHz: BANDS, sourceHashes: source.sourceHashes ?? null,
    methods: [
      `${FFT_SIZE}-point unwindowed FFT of complete ${source.windowSeconds.join('–')} s response; stereo-mean squared magnitude`,
      'Array and nearest speaker use identical pre-HRTF amplitude sum and master/output stages.',
      'Matched ratios remove one broad-band energy difference over 80–12000 Hz; they do not invert a directional HRTF.',
      'Latency is the change in first sample whose magnitude exceeds 1e-12 at either ear; hardware latency is excluded.',
    ],
    limitation: 'Nearest and array directions differ. These are consequences of multiple-source rendering, not a perceptual quality ranking. No propagation delay, measured room response, hardware playback or human listening is represented.',
    comparisons,
  };
}

export async function runSpatialStudy(directory) {
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const sourceHashes = {};
  for (const path of ['src/coast/world/lake/lakeKotoSpeakers.ts', 'src/coast/world/lake/lakeAudio.ts',
    'src/coast/world/lake/lakeLayout.ts', 'src/coast/explorationOutput.ts', 'scripts/koto-spatial-study.mjs']) {
    sourceHashes[path] = createHash('sha256').update(await readFile(join(ROOT, path))).digest('hex');
  }
  await mkdir(directory, { recursive: true });
  const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error',
    optimizeDeps: { include: ['three'], noDiscovery: true }, server: { host: '127.0.0.1', port: 0, watch: null },
    plugins: [{
      name: 'koto-spatial-bootstrap',
      configureServer(server) {
        server.middlewares.use('/__koto-spatial-study.html', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><title>Koto spatial study</title>');
        });
      },
    }],
  });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.COAST_CHROME_CHANNEL || undefined });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__koto-spatial-study.html`);
    const result = await page.evaluate(async () => {
      const { createLakeKotoSpeakerArray, LAKE_KOTO_SPEAKERS, lakeKotoSpeakerGains } =
        await import('/src/coast/world/lake/lakeKotoSpeakers.ts');
      const { LAKE_AUDIO_MASTER_GAIN } = await import('/src/coast/world/lake/lakeAudio.ts');
      const { LAKE_DESTINATIONS, LAKE_HALL } = await import('/src/coast/world/lake/lakeLayout.ts');
      const { connectExplorationOutput } = await import('/src/coast/explorationOutput.ts');
      const rate = 48_000;
      const result = { rate, impulseAmplitude: 0.1, impulseSeconds: 0.1, windowSeconds: [0.09, 0.2],
        master: LAKE_AUDIO_MASTER_GAIN, responses: [] };
      const positions = [
        ...LAKE_DESTINATIONS.map(({ id, x, z }) => ({ name: id === 'hall' ? 'center' : id, x, y: 1.65, z })),
        { name: 'rear', x: 0, y: 1.65, z: LAKE_HALL.rearZ - 2 },
      ];
      for (const position of positions) {
        for (const heading of ['forward', 'reverse']) {
          for (const route of ['array-final', 'nearest-final', 'array-only', 'dry-final']) {
            const context = new OfflineAudioContext(2, rate / 4, rate);
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
            let output = [];
            if (route === 'array-only') master.connect(context.destination);
            else output = connectExplorationOutput(context, master);
            const gainSum = lakeKotoSpeakerGains(position).reduce((a, b) => a + b, 0);
            let nearest = LAKE_KOTO_SPEAKERS[0];
            let distance = Infinity;
            for (const speaker of LAKE_KOTO_SPEAKERS) {
              const d = Math.hypot(speaker.x - position.x, speaker.y - position.y, speaker.z - position.z);
              if (d < distance) { nearest = speaker; distance = d; }
            }
            let graph;
            let input = master;
            let level;
            let panner;
            if (route.startsWith('array')) {
              graph = createLakeKotoSpeakerArray(context, master);
              graph.update(position, 0, true);
              input = graph.input;
            } else {
              level = context.createGain();
              level.gain.value = gainSum;
              input = level;
              if (route === 'nearest-final') {
                panner = new PannerNode(context, { panningModel: 'HRTF', rolloffFactor: 0,
                  positionX: nearest.x, positionY: nearest.y, positionZ: nearest.z });
                level.connect(panner).connect(master);
              } else level.connect(master);
            }
            const source = context.createBufferSource();
            const buffer = context.createBuffer(1, rate / 4, rate);
            buffer.getChannelData(0)[rate / 10] = result.impulseAmplitude;
            source.buffer = buffer;
            source.connect(input);
            source.start();
            const started = performance.now();
            const rendered = await context.startRendering();
            const renderMs = performance.now() - started;
            const channels = [];
            for (let channel = 0; channel < 2; channel += 1) {
              channels.push(Array.from(rendered.getChannelData(channel)
                .subarray(Math.round(rate * 0.09), Math.round(rate * 0.2))));
            }
            result.responses.push({ position, heading, route, gainSum, nearest, distance, renderMs, channels });
            source.disconnect();
            source.buffer = null;
            graph?.dispose();
            level?.disconnect();
            panner?.disconnect();
            master.disconnect();
            for (const node of output) node.disconnect();
          }
        }
      }
      return result;
    });
    result.browser = browser.version();
    result.sourceHashes = sourceHashes;
    await writeFile(join(directory, 'impulse-responses.json'), `${JSON.stringify(result)}\n`);
    const metrics = analyzeSpatialStudy(result);
    await writeFile(join(directory, 'transfer-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
    return { responses: result.responses.length, directory };
  } finally {
    await browser?.close();
    await server.close();
  }
}

// This isolates real HTTP and native decoding from graph rendering, capture and a development document.
export async function runDecodeStudy(origin, directory) {
  const { chromium } = await import('playwright');
  const base = origin.replace(/\/?$/, '/');
  await mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.COAST_CHROME_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.goto(new URL('lake-audio/ATTRIBUTION.md', base).href);
    const started = performance.now();
    const result = await page.evaluate(async base => {
      const start = performance.now();
      const response = await fetch(new URL('lake-audio/koto-performance.wav', base), { cache: 'no-store' });
      const headersAt = performance.now();
      if (!response.ok) throw new Error('The audio timing asset is unavailable.');
      const encoded = await response.arrayBuffer();
      const bodyAt = performance.now();
      const inputSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)),
        value => value.toString(16).padStart(2, '0')).join('');
      const result = { origin: base, inputBytes: encoded.byteLength, inputSha256,
        headersMs: headersAt - start, bodyMs: bodyAt - headersAt, totalFetchMs: bodyAt - start, decoders: [] };
      for (const kind of ['realtime', 'offline']) {
        for (const rate of [48_000, 44_100]) {
          const context = kind === 'realtime' ? new AudioContext({ sampleRate: rate })
            : new OfflineAudioContext(1, 1, rate);
          const bytes = encoded.slice(0);
          const decodeAt = performance.now();
          const buffer = await context.decodeAudioData(bytes);
          result.decoders.push({ kind, rate, nativeDecodeMs: performance.now() - decodeAt,
            frames: buffer.length, duration: buffer.duration, channels: buffer.numberOfChannels, state: context.state });
          if (kind === 'realtime') await context.close();
          else await context.startRendering();
        }
      }
      return result;
    }, base);
    result.hostWallMs = performance.now() - started;
    result.browser = browser.version();
    result.method = 'Native decode only; no playback, speaker graph or real-time audio-thread CPU measurement.';
    result.scriptSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
    await writeFile(join(directory, 'native-wav-timings.json'), `${JSON.stringify(result, null, 2)}\n`);
    return { measured: true, directory };
  } finally {
    await browser.close();
  }
}

export async function runRealtimeStudy(directory) {
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const paths = ['src/coast/world/lake/lakeKoto.ts', 'src/coast/world/lake/lakeKotoAsset.ts',
    'src/coast/world/lake/lakeKotoSpeakers.ts', 'src/coast/world/lake/lakeAudio.ts',
    'src/coast/world/lake/lakeLayout.ts', 'src/coast/explorationOutput.ts',
    'public/lake-audio/koto-performance.wav', 'scripts/koto-spatial-study.mjs'];
  const hashes = async () => {
    const result = {};
    for (const path of paths) result[path] = createHash('sha256').update(await readFile(join(ROOT, path))).digest('hex');
    return result;
  };
  await mkdir(directory, { recursive: true });
  const metrics = { kind: '156-second native AudioContext study', startedAt: new Date().toISOString(),
    sourceHashes: await hashes(), checkpoints: [], complete: false,
    environment: { node: process.version, platform: process.platform, architecture: process.arch,
      cpuModel: cpus()[0]?.model, logicalCpuCount: cpus().length, physicalMemoryBytes: totalmem() },
    limits: ['Approximately156seconds/four loops, not hours of stability evidence.',
      'Fixed listener and audio-only HTML document; application/WebGL rendering is excluded.',
      'Final output is muted; analyser is upstream. This is not human or hardware listening.',
      'Process CPU includes all threads. JS heap/DOM/logicalPCM do not measure total native memory.'],
  };
  const save = () => writeFile(join(directory, 'realtime-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  await save();
  const server = await createServer({ root: ROOT, configFile: false, logLevel: 'error',
    optimizeDeps: { include: ['three'], noDiscovery: true }, server: { host: '127.0.0.1', port: 0, watch: null },
    plugins: [{ name: 'koto-realtime-bootstrap', configureServer(server) {
      server.middlewares.use('/__koto-realtime-study.html', (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Koto realtime study</title>');
      });
    } }],
  });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.COAST_CHROME_CHANNEL || undefined,
      args: ['--autoplay-policy=no-user-gesture-required'] });
    metrics.browser = browser.version();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__koto-realtime-study.html`);
    const browserCdp = await browser.newBrowserCDPSession();
    const pageCdp = await page.context().newCDPSession(page);
    const processes = async () => (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
    const beforeCpu = await processes();
    metrics.baseline = { jsHeap: await pageCdp.send('Runtime.getHeapUsage'),
      dom: await pageCdp.send('Memory.getDOMCounters') };
    const startedWall = performance.now();
    const startedNodeCpu = process.cpuUsage();
    await page.exposeFunction('kotoRealtimeCheckpoint', async snapshot => {
      const [cpu, heap, dom] = await Promise.all([
        processes(), pageCdp.send('Runtime.getHeapUsage'), pageCdp.send('Memory.getDOMCounters'),
      ]);
      metrics.checkpoints.push({ ...snapshot, hostElapsedMs: performance.now() - startedWall,
        processCpu: cpu, jsHeap: heap, dom, nodeMemory: process.memoryUsage() });
      await save();
      console.log(JSON.stringify({ event: snapshot.phase === 'started' ? 'realtime-started' : 'realtime-checkpoint',
        phase: snapshot.phase, audioSeconds: snapshot.audioSeconds, peak: snapshot.peak, counts: snapshot.counts }));
    });
    metrics.playback = await page.evaluate(async () => {
      const { LakeKoto } = await import('/src/coast/world/lake/lakeKoto.ts');
      const { LAKE_AUDIO_MASTER_GAIN } = await import('/src/coast/world/lake/lakeAudio.ts');
      const { LAKE_SPAWN } = await import('/src/coast/world/lake/lakeLayout.ts');
      const { connectExplorationOutput } = await import('/src/coast/explorationOutput.ts');
      const context = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' });
      const counts = { fetch: 0, decode: 0, source: 0, panner: 0, sourceStart: 0, sourceEnded: 0 };
      const owned = new Set();
      const edges = new Map();
      const sources = [];
      const ended = [];
      const violations = [];
      let decoded;
      let startedAt;
      const originalFetch = window.fetch;
      const originalPanner = window.PannerNode;
      const originalConnect = AudioNode.prototype.connect;
      const originalDisconnect = AudioNode.prototype.disconnect;
      const nativeDecode = context.decodeAudioData.bind(context);
      window.fetch = (...args) => { counts.fetch += 1; return originalFetch(...args); };
      context.decodeAudioData = async bytes => {
        counts.decode += 1;
        const buffer = await nativeDecode(bytes);
        decoded = { sampleRate: buffer.sampleRate, frames: buffer.length, channels: buffer.numberOfChannels,
          logicalPcmBytes: buffer.length * buffer.numberOfChannels * 4 };
        return buffer;
      };
      for (const name of ['createGain', 'createDynamicsCompressor', 'createWaveShaper', 'createAnalyser', 'createBufferSource']) {
        const native = context[name].bind(context);
        context[name] = (...args) => {
          const node = native(...args);
          owned.add(node);
          if (name === 'createBufferSource') {
            counts.source += 1;
            sources.push(node);
            ended.push(new Promise(resolve => node.addEventListener('ended', () => {
              counts.sourceEnded += 1;
              resolve();
            }, { once: true })));
            const start = node.start.bind(node);
            node.start = (...args) => { counts.sourceStart += 1; startedAt = args[0] ?? context.currentTime; return start(...args); };
          }
          return node;
        };
      }
      window.PannerNode = class extends originalPanner {
        constructor(audioContext, options) {
          super(audioContext, options);
          if (audioContext === context) { counts.panner += 1; owned.add(this); }
        }
      };
      AudioNode.prototype.connect = function (destination, ...args) {
        const result = originalConnect.call(this, destination, ...args);
        if (this.context === context) {
          const destinations = edges.get(this) ?? new Set();
          destinations.add(destination);
          edges.set(this, destinations);
        }
        return result;
      };
      AudioNode.prototype.disconnect = function (...args) {
        const result = originalDisconnect.apply(this, args);
        if (this.context === context) {
          if (args.length === 0) edges.delete(this);
          else edges.get(this)?.delete(args[0]);
        }
        return result;
      };
      let koto;
      let master;
      let output = [];
      let analyser;
      let mute;
      const delay = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
      try {
        await context.resume();
        const position = { x: LAKE_SPAWN.x, y: 1.65, z: LAKE_SPAWN.z };
        context.listener.positionX.value = position.x;
        context.listener.positionY.value = position.y;
        context.listener.positionZ.value = position.z;
        context.listener.forwardZ.value = -1;
        context.listener.upY.value = 1;
        master = context.createGain();
        master.gain.value = LAKE_AUDIO_MASTER_GAIN;
        output = connectExplorationOutput(context, master);
        analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        mute = context.createGain();
        mute.gain.value = 0;
        // Insert the mute before any source starts, downstream of the actual production output stages.
        output.at(-1).disconnect();
        output.at(-1).connect(analyser).connect(mute).connect(context.destination);
        koto = new LakeKoto(context, master);
        const initializeAt = performance.now();
        await koto.play(position);
        const initializedMs = performance.now() - initializeAt;
        const wallOrigin = performance.now();
        const samples = new Float32Array(analyser.fftSize);
        async function capture(phase, active = false) {
          analyser.getFloatTimeDomainData(samples);
          let peak = 0;
          let energy = 0;
          let nonFinite = 0;
          for (const sample of samples) {
            if (!Number.isFinite(sample)) nonFinite += 1;
            peak = Math.max(peak, Math.abs(sample));
            energy += sample ** 2;
          }
          const snapshot = { phase, audioSeconds: context.currentTime - startedAt,
            wallSeconds: (performance.now() - wallOrigin) / 1000, state: context.state,
            peak, rms: Math.sqrt(energy / samples.length), nonFinite, playing: koto.playing,
            counts: { ...counts }, muteGain: mute.gain.value,
            connectedEdges: [...edges.values()].reduce((sum, destinations) => sum + destinations.size, 0) };
          if (nonFinite) violations.push(`${phase}:non-finite-output`);
          if (active && (context.state !== 'running' || peak <= 1e-5 || !koto.playing)) violations.push(`${phase}:inactive-output`);
          if (active && (counts.fetch !== 1 || counts.decode !== 1 || counts.source !== 1 || counts.panner !== 12
            || counts.sourceStart !== 1 || counts.sourceEnded !== 0)) violations.push(`${phase}:resource-count-drift`);
          if (mute.gain.value !== 0) violations.push(`${phase}:output-not-muted`);
          await window.kotoRealtimeCheckpoint(snapshot);
          return snapshot;
        }
        await capture('started');
        for (const seconds of [0.45, 39.45, 78.45, 117.45, 156.45]) {
          await delay(wallOrigin + seconds * 1000 - performance.now());
          await capture(`active-${seconds}`, true);
        }
        const playedSeconds = context.currentTime - startedAt;
        if (playedSeconds < 156) violations.push('four-complete-loops-not-reached');
        koto.stop();
        await Promise.all(ended);
        await delay(250);
        const stopped = await capture('stopped');
        if (stopped.peak > 1e-6 || koto.playing || counts.sourceEnded !== 1) violations.push('stop-not-silent');
        koto.dispose();
        koto.dispose();
        master.disconnect();
        for (const node of output) node.disconnect();
        analyser.disconnect();
        mute.disconnect();
        const disposed = await capture('disposed');
        const sourceBuffersReleased = sources.every(source => source.buffer === null);
        if (disposed.connectedEdges !== 0 || !sourceBuffersReleased) violations.push('owned-resources-still-connected');
        await context.close();
        return { initializedMs, playedSeconds, completedLoops: Math.floor(playedSeconds / 39),
          counts, decoded, stopped, disposed, sourceBuffersReleased, ownedNodeCount: owned.size,
          closedState: context.state, violations };
      } finally {
        koto?.dispose();
        master?.disconnect();
        for (const node of output) node.disconnect();
        analyser?.disconnect();
        mute?.disconnect();
        if (context.state !== 'closed') await context.close();
        window.fetch = originalFetch;
        window.PannerNode = originalPanner;
        AudioNode.prototype.connect = originalConnect;
        AudioNode.prototype.disconnect = originalDisconnect;
        owned.clear();
        edges.clear();
        sources.length = 0;
      }
    });
    const afterCpu = await processes();
    const elapsedMs = performance.now() - startedWall;
    metrics.processWorkload = { elapsedMs,
      nodeCpu: process.cpuUsage(startedNodeCpu),
      browserCpu: afterCpu.map(process => ({ pid: process.id, type: process.type,
        deltaSeconds: process.cpuTime - (beforeCpu.find(before => before.id === process.id)?.cpuTime ?? 0) })),
    };
    metrics.sourceHashesAfter = await hashes();
    metrics.inputClosureUnchanged = paths.every(path => metrics.sourceHashes[path] === metrics.sourceHashesAfter[path]);
    metrics.complete = true;
    metrics.finishedAt = new Date().toISOString();
    metrics.acceptance = metrics.inputClosureUnchanged && metrics.playback.violations.length === 0 ? 'passed' : 'failed';
    await save();
    assert.equal(metrics.acceptance, 'passed', 'the four-loop native study must preserve output and resource ownership');
    return { measured: true, acceptance: metrics.acceptance, directory };
  } finally {
    await browser?.close();
    await server.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === '--realtime') {
      const directory = resolve(process.argv[3] || join(tmpdir(), 'lumen-koto-realtime-study'));
      console.log(JSON.stringify(await runRealtimeStudy(directory)));
    } else if (process.argv[2] === '--decode') {
      const directory = resolve(process.argv[4] || join(tmpdir(), 'lumen-koto-codec-study'));
      console.log(JSON.stringify(await runDecodeStudy(process.argv[3], directory)));
    } else if (process.argv[2] === '--analyze') {
      const input = resolve(process.argv[3]);
      const directory = resolve(process.argv[4] || dirname(input));
      const source = JSON.parse(await readFile(input, 'utf8'));
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'transfer-metrics.json'), `${JSON.stringify(analyzeSpatialStudy(source), null, 2)}\n`);
      console.log(JSON.stringify({ analyzed: true, directory }));
    } else {
      const directory = resolve(process.argv[2] || process.env.KOTO_SPATIAL_ARTIFACTS || join(tmpdir(), 'lumen-koto-spatial-probe'));
      console.log(JSON.stringify(await runSpatialStudy(directory)));
    }
  } catch {
    console.error('Koto spatial study failed. Check the input artifact and local browser setup.');
    process.exitCode = 1;
  }
}
