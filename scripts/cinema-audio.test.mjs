import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';

const src = new URL('../src/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { CINEMA_SPEAKERS, cinemaReflections, cinemaReflectionTaper, cinemaSeatDrr, cinemaSeatTrim, createCinemaTail } =
  await import('../src/coast/world/cinema/cinemaAcoustics.ts');
const { CINEMA_DESTINATIONS, CINEMA_ROWS, cinemaGroundHeight } =
  await import('../src/coast/world/cinema/cinemaLayout.ts');
const { cinemaSourceBandLoss, cinemaSeatingClearance, cinemaPathCrossesScreen, cinemaReflectionBandGain,
  cinemaBandShelves, cinemaScreenCrossings, CINEMA_SURFACE_GAINS } = await import('../src/coast/world/cinema/cinemaPropagation.ts');
const { CINEMA_RENDER_SPEAKERS } = await import('../src/coast/world/cinema/cinemaSpeakers.ts');
const { cinemaPropagationImpulse } = await import('../src/coast/world/cinema/cinemaPropagationFilter.ts');
const { cinemaSharedFeedPlan, createCinemaSharedRouting } = await import('../src/coast/world/cinema/cinemaSharedRouting.ts');
const { createCinemaPlayback } = await import('../src/coast/world/cinema/cinemaPlayback.ts');
hook.deregister();

test('shared playback releases listening children before their routing parent', () => {
  class Param {
    value = 0;
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
    setValueCurveAtTime(values) { this.lastCurve = [...values]; this.value = values.at(-1); }
  }
  class Node {
    connections = new Set();
    gain = new Param(); frequency = new Param(); Q = new Param(); delayTime = new Param();
    positionX = new Param(); positionY = new Param(); positionZ = new Param();
    connect(target) {
      if (++connectionCalls === failConnectionAt) throw new Error('Injected connection failure');
      this.connections.add(target); return target;
    }
    disconnect(target) {
      if (!target) { this.connections.clear(); return; }
      if (!this.connections.delete(target)) throw new DOMException('No connection to target', 'InvalidAccessError');
    }
  }
  const nodes = [];
  let pannerCalls = 0;
  let failAt = 0;
  let connectionCalls = 0;
  let failConnectionAt = 0;
  let filterCalls = 0;
  let failFilterAt = 0;
  const node = () => { const value = new Node(); nodes.push(value); return value; };
  const context = {
    sampleRate: 8_000, currentTime: 0,
    listener: Object.fromEntries(['position', 'forward', 'up'].flatMap(name => ['X', 'Y', 'Z'].map(axis => [name + axis, new Param()]))),
    createGain: node, createChannelSplitter: node,
    createBiquadFilter() { if (++filterCalls === failFilterAt) throw new Error('Injected filter failure'); return node(); },
    createDelay: node, createWaveShaper: node,
    createPanner() { if (++pannerCalls === failAt) throw new Error('Injected voice failure'); return node(); },
    createConvolver: node,
    createBuffer(channels, length) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, getChannelData: channel => data[channel] };
    },
  };
  const source = node(), output = node(), unrelated = node();
  source.connect(unrelated);
  const ownedStart = nodes.length;
  const playback = createCinemaPlayback(context, source, output, 6);
  const camera = new PerspectiveCamera(); camera.position.set(0, 5, 35.85);
  playback.update(camera);
  const lightMix = [...nodes.find(node => node.panningModel === 'equalpower').connections][0].gain;
  const initialLightLevel = lightMix.value;
  assert.ok(initialLightLevel > 0 && initialLightLevel < 1, 'light mode uses an attenuated reference level');
  context.currentTime = .03;
  playback.setQuality('high');
  playback.update(camera);
  const highMix = [...nodes.find(node => node.panningModel === 'HRTF').connections][0].gain;
  assert.equal(highMix.value, 1, 'high quality retains unity reference gain');
  context.currentTime = .06;
  playback.setQuality('light');
  playback.update(camera);
  assert.equal(lightMix.value, Math.fround(initialLightLevel),
    'an interrupted crossfade restores the calibrated endpoint at Float32 curve precision');
  assert.equal(highMix.value, 0);
  assert.ok(lightMix.lastCurve.every(value => value >= 0 && value <= initialLightLevel + 1e-7),
    'the crossfade must not bypass the lightweight attenuation');
  assert.doesNotThrow(() => playback.dispose());
  assert.doesNotThrow(() => playback.dispose());
  assert.deepEqual([...source.connections], [unrelated]);
  assert.ok(nodes.slice(ownedStart).every(value => value.connections.size === 0));
  for (const target of [1, 30, 58, 60]) {
    failAt = target; pannerCalls = 0;
    const start = nodes.length;
    const partial = createCinemaPlayback(context, source, output, 6);
    assert.throws(() => partial.update(camera));
    assert.doesNotThrow(() => partial.dispose());
    assert.ok(nodes.slice(start).every(value => value.connections.size === 0), `partial voice ${target}`);
    assert.deepEqual([...source.connections], [unrelated]);
  }
  failAt = 0;
  for (const target of [4, 10]) {
    failConnectionAt = 0;
    const start = nodes.length;
    const partial = createCinemaPlayback(context, source, output, 6);
    connectionCalls = 0; failConnectionAt = target;
    assert.throws(() => partial.update(camera));
    assert.doesNotThrow(() => partial.dispose());
    assert.ok(nodes.slice(start).every(value => value.connections.size === 0), `partial connection ${target}`);
    assert.deepEqual([...source.connections], [unrelated]);
  }
  failConnectionAt = 0;
  const filterStart = nodes.length;
  const partialFilter = createCinemaPlayback(context, source, output, 6);
  filterCalls = 0; failFilterAt = 3;
  assert.throws(() => partialFilter.update(camera));
  assert.doesNotThrow(() => partialFilter.dispose());
  assert.ok(nodes.slice(filterStart).every(value => value.connections.size === 0));
  failFilterAt = 0;
  const survivingStart = nodes.length;
  const surviving = createCinemaPlayback(context, source, output, 6);
  surviving.update(camera);
  const previousEdges = nodes.slice(survivingStart).reduce((sum, value) => sum + value.connections.size, 0);
  const previousInputs = [...source.connections];
  pannerCalls = 0; failAt = 30;
  assert.throws(() => surviving.setQuality('high'));
  assert.equal(nodes.slice(survivingStart).reduce((sum, value) => sum + value.connections.size, 0), previousEdges,
    'a failed replacement keeps the previously active listening graph');
  assert.deepEqual([...source.connections], previousInputs);
  context.currentTime = .1;
  assert.doesNotThrow(() => surviving.update(camera));
  assert.doesNotThrow(() => surviving.dispose());
  assert.ok(nodes.slice(survivingStart).every(value => value.connections.size === 0));
  assert.deepEqual([...source.connections], [unrelated]);
});

test('shared mono/stereo drives the common 57 equipment outputs with bounded differentiated feeds', () => {
  for (const mono of [false, true]) {
    const plan = cinemaSharedFeedPlan(mono ? 1 : 2);
    assert.equal(plan.length, 57);
    assert.deepEqual(plan.map(feed => feed.speaker.id), CINEMA_RENDER_SPEAKERS.map(speaker => speaker.id));
    assert.ok(plan.every(feed => feed.coefficients.every(Number.isFinite)
      && feed.coefficients.some(coefficient => coefficient !== 0)));
    const sum = feeds => feeds.reduce((total, feed) =>
      total + feed.coefficients.reduce((value, coefficient) => value + Math.abs(coefficient), 0), 0);
    assert.ok(Math.abs(sum(plan.filter(feed => feed.speaker.kind === 'screen')) - .66) < 1e-12);
    assert.ok(Math.abs(sum(plan.filter(feed => feed.diffuse)) - .10) < 1e-12);
    assert.ok(Math.abs(sum(plan.filter(feed => feed.bass)) - .05) < 1e-12);
    const surround = plan.filter(feed => feed.diffuse);
    assert.ok(new Set(surround.map(feed => feed.delaySeconds)).size >= 40);
    assert.ok(new Set(surround.map(feed => feed.phaseFrequency)).size >= 40);
    assert.ok(surround.every(feed => feed.delaySeconds >= .018 && feed.delaySeconds < .041));
    assert.ok(surround.every(feed => feed.coefficients[0] * feed.coefficients[1] < 0));
    assert.ok(surround.every(feed => feed.coefficients[0] + feed.coefficients[1] > 0),
      'mono retains a lower-level diffuse floor instead of disappearing');
    if (mono) {
      const front = plan.filter(feed => feed.speaker.kind === 'screen');
      assert.ok(front[2].coefficients[0] > front[0].coefficients[0] * 4);
    }
  }
});

test('known standard 5.1 keeps all six independent inputs including LFE on the common equipment', () => {
  const plan = cinemaSharedFeedPlan(6);
  assert.equal(plan.length, 57);
  assert.ok(plan.every(feed => feed.coefficients.length === 6));
  const destinations = channel => plan.filter(feed => feed.coefficients[channel] !== 0);
  assert.deepEqual(destinations(0).map(feed => feed.speaker.id), ['screen-L', 'screen-LC']);
  assert.deepEqual(destinations(1).map(feed => feed.speaker.id), ['screen-RC', 'screen-R']);
  assert.deepEqual(destinations(2).map(feed => feed.speaker.id), ['screen-C']);
  assert.equal(destinations(3).length, 4);
  assert.ok(destinations(3).every(feed => feed.bass));
  assert.ok(plan.filter(feed => !feed.bass).every(feed => feed.coefficients[3] === 0));
  assert.ok(destinations(4).every(feed => feed.speaker.position[0] < 0 && !feed.bass));
  assert.ok(destinations(5).every(feed => feed.speaker.position[0] > 0 && !feed.bass));
  assert.equal(destinations(4).length, 24);
  assert.equal(destinations(5).length, 24);
  for (const [channel, expected] of [[0, .2], [1, .2], [2, .2], [3, .2], [4, .1], [5, .1]]) {
    const sum = plan.reduce((sum, feed) => sum + Math.abs(feed.coefficients[channel]), 0);
    assert.ok(Math.abs(sum - expected) < 1e-12);
  }
  assert.ok(Math.abs(plan.reduce((sum, feed) => sum + feed.coefficients.reduce((sum, value) => sum + Math.abs(value), 0), 0) - 1) < 1e-12);
  const roomInputs = plan.filter(feed => feed.roomScale > 0);
  assert.equal(roomInputs.length, 7);
  assert.ok(roomInputs.filter(feed => feed.speaker.kind !== 'screen').every(feed =>
    Math.abs(feed.coefficients.reduce((sum, value) => sum + Math.abs(value), 0) * feed.roomScale - .08) < 1e-12));
  const node = () => ({ connections: [], gain: { value: 0 }, frequency: { value: 0 }, Q: { value: 0 }, delayTime: { value: 0 },
    connect(target, output = 0) { this.connections.push({ target, output }); return target; },
    disconnect() { this.connections = []; } });
  const context = { createGain: node, createBiquadFilter: node, createDelay: node,
    createChannelSplitter(channels) { return Object.assign(node(), { numberOfOutputs: channels }); } };
  const input = node();
  const routing = createCinemaSharedRouting(context, input, 6);
  const layout = input.connections[0].target;
  assert.deepEqual([layout.channelCount, layout.channelCountMode, layout.channelInterpretation], [6, 'explicit', 'discrete']);
  const splitter = layout.connections[0].target;
  assert.equal(splitter.numberOfOutputs, 6);
  const lfeGains = splitter.connections.filter(edge => edge.output === 3).map(edge => edge.target);
  assert.equal(lfeGains.length, 4);
  assert.ok(lfeGains.every(gain => gain.gain.value === .05));
  routing.dispose();
  assert.equal(input.connections.length, 0);
});

const [centerSeat, frontSeat, rearSeat, wheelchairSeat] = CINEMA_DESTINATIONS;
const seats = [frontSeat, centerSeat, rearSeat, { ...wheelchairSeat, x: 12.715, z: CINEMA_ROWS[14].z }, wheelchairSeat]
  .map(({ x, z, seatedEyeHeight }) => [x, cinemaGroundHeight(x, z) + seatedEyeHeight, z]);

test('cinema geometry follows the design distances and reflection ordering', () => {
  const [front, center, rear, accessible] = seats.map(seat => new Vector3(...seat));
  const speaker = CINEMA_SPEAKERS[2];
  const frontPaths = Object.fromEntries(cinemaReflections(speaker, front).map(path => [path.surface, path]));
  const backPaths = Object.fromEntries(cinemaReflections(speaker, rear).map(path => [path.surface, path]));
  assert.ok(Math.abs(speaker.position.distanceTo(front) / 343 - 0.0708) < 0.00025);
  assert.ok(Math.abs(frontPaths.ceiling.delay - 0.0372) < 0.00025);
  assert.ok(Math.abs(frontPaths.right.delay - 0.0647) < 0.00025);
  assert.equal(frontPaths.rear, undefined); // The raked deck occludes the rear return to R01.
  assert.equal(cinemaReflectionTaper(0.080), 0);
  assert.ok(Math.abs(backPaths.right.delay - 0.0131) < 0.00025);
  assert.ok(Math.abs(backPaths.rear.delay - 0.0192) < 0.00025);
  assert.ok(backPaths.right.amplitude[0] > backPaths.right.amplitude[5]);
  assert.ok(Math.abs(cinemaSeatTrim(front) - 1.11) < 0.015);
  assert.ok(Math.abs(cinemaSeatTrim(center)) < 1e-9);
  assert.ok(Math.abs(cinemaSeatTrim(rear) - cinemaSeatTrim(front)) < 3);
  assert.deepEqual([front, center, rear, accessible].map(cinemaSeatDrr), [16, 13, 10, 11]);
  assert.deepEqual(cinemaReflections(speaker, new Vector3(0, 7, 60)), []);
});

test('deterministic stereo room tails start after 55 ms and have independent input responses', () => {
  const sampleRate = 32_000;
  const fake = {
    sampleRate,
    createBuffer(numberOfChannels, length) {
      const data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
      return { numberOfChannels, getChannelData: i => data[i] };
    },
  };
  const first = createCinemaTail(fake, 123);
  const second = createCinemaTail(fake, 456);
  for (let channel = 0; channel < 2; channel += 1) {
    const samples = first.getChannelData(channel);
    assert.ok(samples.subarray(0, 0.055 * sampleRate).every(sample => sample === 0));
    assert.ok(samples.subarray(0.12 * sampleRate).some(sample => sample !== 0));
    assert.notDeepEqual(samples.subarray(1800, 2200), second.getChannelData(channel).subarray(1800, 2200));
    const energy = samples.reduce((sum, n) => sum + n * n, 0);
    assert.ok(Math.abs(energy - 0.5) < 1e-6);
  }
  assert.notDeepEqual(first.getChannelData(0).slice(1800, 2200), first.getChannelData(1).slice(1800, 2200));
});

const browserChannel = process.env.COAST_CHROME_CHANNEL;
const runBrowser = browserChannel || process.env.CINEMA_AUDIO_BROWSER || process.env.npm_lifecycle_event === 'test:cinema:browser';
test('Chromium OfflineAudioContext verifies cinema signals at representative seats and playback quality', {
  skip: !runBrowser,
  timeout: 180_000,
}, async t => {
  const testStarted = performance.now();
  const mark = stage => t.diagnostic(JSON.stringify({ stage, elapsedMs: performance.now() - testStarted }));
  t.after(() => mark('teardown'));
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const server = await createServer({
    configFile: false, logLevel: 'error', optimizeDeps: { include: ['three'], noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, watch: null },
  });
  await server.listen();
  t.after(() => server.close());
  const browser = await chromium.launch({ channel: browserChannel || undefined });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const address = server.httpServer.address();
  await page.goto(`http://127.0.0.1:${address.port}/@vite/client`);
  mark('browser-ready');
  // Initialize Playwright's main-world observer separately from AudioParam convergence.
  await page.waitForFunction(() => true, undefined, { timeout: 15000, polling: 50 });
  mark('audio-observer-ready');
  const metrics = await page.evaluate(async seats => {
    const evaluationStarted = performance.now();
    const responseTimings = [];
    const clarityTimings = [];
    const { PerspectiveCamera } = await import('/node_modules/three/build/three.module.js');
    const { createCinemaPlayback } = await import('/src/coast/world/cinema/cinemaPlayback.ts');
    const importMs = performance.now() - evaluationStarted;
    const rate = 48_000;
    const time = 0.16;
    const first = Math.round(rate * time);
    const energy = (buffer, start, end) => {
      let sum = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = start; i < end; i += 1) sum += data[i] ** 2;
      }
      return sum;
    };
    async function response(mode, seat, input, yaw = 0, options = {}) {
      const started = performance.now();
      const suspensions = [];
      const context = new OfflineAudioContext(2, rate, rate);
      const buffer = context.createBuffer(input.length, rate / 3, rate);
      input.forEach((level, channel) => {
        const data = buffer.getChannelData(channel);
        data[0] = level;
        if (options.transition) for (let i = 0; i < data.length; i += 1) {
          const phase = i * 2 * Math.PI / rate;
          data[i] = level * (0.42 * Math.sin(503 * phase) + 0.36 * Math.sin(1_117 * phase) + 0.22 * Math.sin(1_853 * phase));
        }
      });
      const source = context.createBufferSource();
      source.buffer = buffer;
      const playback = createCinemaPlayback(context, source, context.destination, options.channelCount ?? input.length);
      const camera = new PerspectiveCamera();
      camera.position.set(...seat);
      camera.rotation.y = yaw;
      playback.setQuality(mode);
      playback.update(camera);
      if (options.transition) {
        for (const [at, next] of [[0.21, 'high'], [0.25, 'light'], [0.27, 'high']]) {
          void context.suspend(at).then(() => {
            const configurationStarted = performance.now();
            playback.setQuality(next);
            playback.update(camera);
            suspensions.push({ at, contextTime: context.currentTime, configurationMs: performance.now() - configurationStarted });
            return context.resume();
          });
        }
      }
      if (options.disposed) {
        // The caller's other connection must survive disposing the cinema graph.
        source.connect(context.destination);
        playback.dispose();
        playback.dispose();
      }
      source.start(time);
      const renderStarted = performance.now();
      const result = await context.startRendering();
      const rendered = performance.now();
      playback.dispose();
      responseTimings.push({ mode, seat, input, yaw, options,
        initializationMs: renderStarted - started, renderMs: rendered - renderStarted,
        disposalMs: performance.now() - rendered, totalMs: performance.now() - started,
        terminalState: context.state, suspensions });
      return result;
    }
    async function clarity(buffer, band, onset) {
      const started = performance.now();
      const context = new OfflineAudioContext(2, buffer.length, rate);
      const source = context.createBufferSource();
      source.buffer = buffer;
      const highPass = context.createBiquadFilter();
      highPass.type = 'highpass';
      highPass.Q.value = Math.SQRT1_2;
      highPass.frequency.value = band / Math.SQRT2;
      const lowPass = context.createBiquadFilter();
      lowPass.type = 'lowpass';
      lowPass.Q.value = Math.SQRT1_2;
      lowPass.frequency.value = band * Math.SQRT2;
      source.connect(highPass).connect(lowPass).connect(context.destination);
      source.start();
      const result = await context.startRendering();
      clarityTimings.push({ band, totalMs: performance.now() - started, terminalState: context.state });
      return 10 * Math.log10(energy(result, first, onset + 0.05 * rate) / energy(result, onset + 0.05 * rate, result.length));
    }
    const responseStats = [];
    for (const quality of ['light', 'high']) for (const seat of seats) {
      const impulse = await response(quality, seat, [0.25]);
      const left = impulse.getChannelData(0);
      const right = impulse.getChannelData(1);
      const onset = left.findIndex((sample, i) => Math.abs(sample) + Math.abs(right[i]) > 0.0001);
      responseStats.push({
        quality,
        direct: 10 * Math.log10(energy(impulse, first, first + 0.012 * rate)),
        onset: onset - first,
        c50: await Promise.all([500, 1000, 2000].map(band => clarity(impulse, band, onset))),
      });
    }
    // These stereo markers and this pose are held out from the five mono calibration seats.
    const qualityHoldoutStats = [];
    for (const quality of ['light', 'high']) for (const [name, input] of [['L', [.25, 0]], ['R', [0, .25]]]) {
      const impulse = await response(quality, [0, 5, 35.85], input);
      qualityHoldoutStats.push({ quality, name,
        direct: 10 * Math.log10(energy(impulse, first, first + .012 * rate)) });
    }
    const [left, right, unknown, aligned, inverted, surround, facing, turned, silent, bypass, switching, lfe] = await Promise.all([
      response('light', seats[1], [0.4, 0]), response('light', seats[1], [0, 0.4]),
      response('light', seats[1], [0.4, 0], 0, { channelCount: 0 }),
      response('high', seats[2], [0.25, 0.25]), response('high', seats[2], [0.25, -0.25]),
      response('light', seats[1], [0, 0, 0, 0, 0, 0.4]),
      response('high', seats[1], [0.25]), response('high', seats[1], [0.25], Math.PI / 2),
      response('light', seats[1], [0, 0]), response('light', seats[1], [0.4, 0], 0, { disposed: true }),
      response('light', seats[2], [0.3], 0, { transition: true }),
      response('high', seats[1], [0, 0, 0, .4, 0, 0]),
    ]);
    const balance = buffer => {
      const [l, r] = [0, 1].map(ch => buffer.getChannelData(ch).slice(first, first + rate * 0.012)
        .reduce((sum, sample) => sum + sample * sample, 0));
      return 10 * Math.log10(l / r);
    };
    return {
      responseStats, qualityHoldoutStats,
      timing: { evaluationMs: performance.now() - evaluationStarted, importMs, responseTimings, clarityTimings },
      l: balance(left), r: balance(right), unknown: balance(unknown), c: balance(facing), turned: balance(turned),
      surround: balance(surround),
      monoAfterDispose: bypass.getChannelData(0)[first], bypassRight: bypass.getChannelData(1)[first],
      silentEnergy: energy(silent, 0, silent.length),
      lfeEnergy: energy(lfe, 0, lfe.length),
      wetRatio: energy(inverted, first + rate * 0.08, rate) / energy(aligned, first + rate * 0.08, rate),
      switchingEnergy: [0.20, 0.24, 0.28, 0.38].map(time => energy(switching, Math.round(rate * time), Math.round(rate * (time + 0.02)))),
    };
  }, seats);
  mark('offline-evaluation-complete');
  t.diagnostic(JSON.stringify(metrics));
  for (const quality of ['light', 'high']) {
    const records = metrics.responseStats.filter(stats => stats.quality === quality);
    const levels = records.map(record => record.direct);
    assert.ok(Math.max(...levels) - Math.min(...levels) <= 3, `${quality}: seat spread ${levels}`);
    records.forEach(record => {
      assert.ok(record.onset >= 0 && record.onset / 48 <= 20, `onset ${record.onset / 48}ms`);
      assert.ok(record.c50.every(c50 => c50 >= 8), `clarity ${record.c50}`);
    });
  }
  for (let i = 0; i < seats.length; i += 1) {
    assert.ok(Math.abs(metrics.responseStats[i].direct - metrics.responseStats[i + seats.length].direct) <= 2,
      `quality level at seat ${i}: ${metrics.responseStats[i].direct} vs ${metrics.responseStats[i + seats.length].direct}`);
  }
  for (const name of ['L', 'R']) {
    const pair = metrics.qualityHoldoutStats.filter(record => record.name === name);
    assert.ok(Math.abs(pair[0].direct - pair[1].direct) <= 2,
      `held-out quality level for ${name}: ${pair[0].direct} vs ${pair[1].direct}`);
  }
  assert.ok(metrics.l > 2 && metrics.r < -2);
  assert.ok(Math.abs(metrics.l - metrics.unknown) < 0.01);
  assert.ok(metrics.surround < -2);
  assert.ok(Math.abs(metrics.turned - metrics.c) > 3);
  assert.ok(metrics.wetRatio > 0.35 && metrics.wetRatio < 2.5);
  assert.equal(metrics.silentEnergy, 0);
  assert.ok(metrics.lfeEnergy > 1e-10, 'known-5.1 LFE survives the shared renderer');
  assert.ok(Math.abs(metrics.monoAfterDispose - 0.4) < 1e-6);
  assert.equal(metrics.bypassRight, 0);
  assert.ok(Math.min(...metrics.switchingEnergy) / Math.max(...metrics.switchingEnergy) > 0.25);
  mark('offline-signal-assertions-complete');

  const silentBeforeGesture = await page.evaluate(async () => {
    const { CinemaAmbience } = await import('/src/coast/world/cinema/cinemaAmbience.ts');
    const { DEFAULT_EXPLORATION_MIX } = await import('/src/coast/explorationSound.ts');
    const NativeAudioContext = window.AudioContext;
    const contexts = [];
    window.AudioContext = class extends NativeAudioContext {
      panners = [];
      tails = [];
      routes = new WeakMap();
      constructor(options) {
        super(options);
        const sink = this.createMediaStreamDestination();
        Object.defineProperty(this, 'destination', { value: sink });
        contexts.push(this);
      }
      trackRoute(node) {
        const connect = node.connect.bind(node);
        node.connect = (target, ...args) => {
          this.routes.set(node, target);
          return connect(target, ...args);
        };
        return node;
      }
      createGain() {
        return this.trackRoute(super.createGain());
      }
      createPanner() {
        const panner = this.trackRoute(super.createPanner());
        this.panners.push(panner);
        return panner;
      }
      createConvolver() {
        const node = this.trackRoute(super.createConvolver());
        const entry = { node, disconnected: false };
        const disconnect = node.disconnect.bind(node);
        node.disconnect = (...args) => { entry.disconnected = true; return disconnect(...args); };
        this.tails.push(entry);
        return node;
      }
    };
    const ambience = new CinemaAmbience();
    ambience.playDemoCue('overhead');
    ambience.stopDemoCue();
    const start = document.createElement('button');
    start.textContent = 'Start ambient audio';
    start.onclick = () => { window.cinemaAmbienceStarted = ambience.start(); };
    document.body.append(start);
    const mix = {
      ...DEFAULT_EXPLORATION_MIX,
      master: 3,
      levels: { ...DEFAULT_EXPLORATION_MIX.levels, wind: .21, preview: .35, footsteps: .62 },
    };
    ambience.setMix(mix);
    window.cinemaAmbienceFixture = { ambience, contexts, mix };
    return contexts.length === 0;
  });
  assert.ok(silentBeforeGesture);
  await page.getByRole('button', { name: 'Start ambient audio' }).click();
  const sceneAudio = await page.evaluate(async () => {
    await window.cinemaAmbienceStarted;
    const { Vector3 } = await import('/node_modules/three/build/three.module.js');
    const fixture = window.cinemaAmbienceFixture;
    const { ambience, contexts: [context] } = fixture;
    const fanPanners = context.panners.slice();
    ambience.playDemoCue('overhead');
    const point = context.panners.at(-1);
    const forward = new Vector3(0, 0, -1);
    const up = new Vector3(0, 1, 0);
    [0, .4, .8, 1.2].forEach((x, i) => ambience.update(new Vector3(x, 20, 20), forward, up, i * .13, 'walk'));
    const { routes } = context;
    const wind = routes.get(fanPanners[0]);
    const previewOutput = routes.get(point);
    const preview = routes.get(previewOutput);
    const footsteps = routes.get(context.panners.at(-1));
    fixture.gains = [routes.get(wind), wind, preview, footsteps].map(node => node.gain);
    // Ended sources can leave an unpulled bus's AudioParam getter at its last rendered value.
    // Keep the three actual audio inputs active and verify their output, not just automation commands.
    // Oscillators leave the BufferSource-based footfall event counter unchanged.
    const buses = [wind, preview, footsteps];
    const analysisFrames = 8192;
    const frequencies = [2001, 2201, 2401].map(bin => context.sampleRate * bin / analysisFrames);
    const carrierLevel = .01;
    const nativeConnect = AudioNode.prototype.connect;
    const probes = buses.map((bus, i) => {
      const source = context.createOscillator();
      source.frequency.value = frequencies[i];
      const gain = context.createGain();
      gain.gain.value = carrierLevel;
      source.connect(gain).connect(bus);
      source.start();
      return { source, gain };
    });
    // Tap the master before the shared trim/limiter, so compression cannot alter the measured gain.
    // Integer analysis-bin carriers separate all three paths without normalizing their raw output.
    const taps = [routes.get(wind), ...buses].map(bus => {
      const analyser = context.createAnalyser();
      analyser.fftSize = analysisFrames;
      const sink = context.createGain();
      sink.gain.value = 0;
      nativeConnect.call(bus, analyser);
      analyser.connect(sink).connect(context.destination);
      return { analyser, sink };
    });
    fixture.gainProbes = { probes, taps, frequencies, carrierLevel };

    return {
      fans: fanPanners.length, elevation: point.positionY.value, roomTails: context.tails.length,
      sharedWind: fanPanners.every(pan => routes.get(pan) === wind),
      isolatedFootstepTail: routes.get(context.tails[0].node) === footsteps && footsteps !== preview,
      isolatedPreviewTail: routes.get(context.tails[1].node) === previewOutput,
    };
  });
  assert.deepEqual(sceneAudio, {
    fans: 4, elevation: Math.fround(20.381), roomTails: 2, sharedWind: true,
    isolatedFootstepTail: true, isolatedPreviewTail: true,
  });

  await page.waitForFunction(() => {
    const { ambience, contexts: [context] } = window.cinemaAmbienceFixture;
    return context.state === 'running' && ambience.isRunning();
  }, undefined, { timeout: 15000, polling: 50 });
  mark('ambient-graph-context-ready');

  const gainObservations = [];
  const expectGains = async targets => {
    let failure = false;
    let analysisWindowReady = false;
    const started = Date.now();
    try {
      await page.waitForFunction(expected => {
        const fixture = window.cinemaAmbienceFixture;
        const { ambience, gains, contexts: [context] } = fixture;
        const matched = ambience.isRunning() && expected.every((value, i) => Math.abs(gains[i].value - value) < .002);
        if (matched) fixture.gainSettledAt = context.currentTime;
        return matched;
      }, targets, { timeout: 4000, polling: 50 });
      // A retrospective analyser window must contain only samples after the gain predicate succeeded.
      // Two 128-sample quanta cover the render/readback boundary without using a frame or wall sleep.
      await page.waitForFunction(() => {
        const { contexts: [context], gainSettledAt, gainProbes } = window.cinemaAmbienceFixture;
        return context.state === 'running'
          && context.currentTime >= gainSettledAt + (gainProbes.taps[0].analyser.fftSize + 256) / context.sampleRate;
      }, undefined, { timeout: 4000, polling: 50 });
      analysisWindowReady = true;
    } catch { failure = true; }
    const record = await page.evaluate(expected => {
      const { ambience, gains, contexts: [context], gainProbes, gainSettledAt } = window.cinemaAmbienceFixture;
      const { taps, frequencies, carrierLevel } = gainProbes;
      const readAudioTime = context.currentTime;
      const data = taps.map(({ analyser }) => {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        return samples;
      });
      function amplitude(samples, frequency) {
        let ss=0, cc=0, sc=0, ys=0, yc=0;
        for (let i=0; i<samples.length; i++) {
          const phase=2*Math.PI*frequency*i/context.sampleRate, s=Math.sin(phase), c=Math.cos(phase);
          ss+=s*s; cc+=c*c; sc+=s*c; ys+=samples[i]*s; yc+=samples[i]*c;
        }
        const det=ss*cc-sc*sc;
        return Math.hypot((ys*cc-yc*sc)/det,(yc*ss-ys*sc)/det);
      }
      const busOutputGains = frequencies.map((f,i)=>amplitude(data[i+1],f)/carrierLevel);
      const masterOutputGains = frequencies.map(f=>amplitude(data[0],f)/carrierLevel);
      return { expected, state:context.state, time:readAudioTime, readEndAudioTime:context.currentTime, gainSettledAt,
        analysisFrames:data[0].length, conservativeWindowStart:readAudioTime-(data[0].length+256)/context.sampleRate,
        isRunning:ambience.isRunning(),
        values:gains.map(g=>g.value), busOutputGains, masterOutputGains,
        nonFinite:data.map(a=>a.reduce((n,x)=>n+(!Number.isFinite(x)?1:0),0)),
        raw:data.map(a=>Array.from(a)), frequencies, carrierLevel,
        voices:Array.from(ambience.voices,v=>({loop:v.source.loop,duration:v.source.buffer?.duration})),
        previewCount:ambience.previews.size };
    }, targets);
    record.waitFailed=failure; record.analysisWindowReady=analysisWindowReady; record.elapsedMs=Date.now()-started;
    record.busOutputWithinOriginalTolerance=record.busOutputGains.every((v,i)=>Math.abs(v-targets[i+1])<.002);
    record.masterOutputWithinOriginalTolerance=record.masterOutputGains.every((v,i)=>Math.abs(v-targets[0]*targets[i+1])<.002);
    gainObservations.push(record);
    const {raw, ...summary} = record;
    console.log(JSON.stringify({gainObservation:summary}));
  };
  await expectGains([2.1, .21, .35, .62]);
  await page.evaluate(() => {
    const { ambience, mix } = window.cinemaAmbienceFixture;
    ambience.setMix({ ...mix, master: 1, environmentOn: false });
  });
  await expectGains([.7, 0, 0, .62]);
  await page.evaluate(() => {
    const { ambience, mix } = window.cinemaAmbienceFixture;
    ambience.setMix({ ...mix, master: 1, footstepsOn: false });
    ambience.playDemoCue('rear');
  });
  await expectGains([.7, .21, .35, 0]);
  await page.evaluate(() => {
    const { ambience, mix } = window.cinemaAmbienceFixture;
    ambience.stopDemoCue();
    ambience.setMix({ ...mix, master: 1 });
  });
  await expectGains([.7, .21, .35, .62]);

  const footfalls = await page.evaluate(async () => {
    const { Vector3 } = await import('/node_modules/three/build/three.module.js');
    const { cinemaNavigation } = await import('/src/coast/world/cinema/cinemaNavigation.ts');
    const { CINEMA_AISLES, CINEMA_TREADS, cinemaGroundHeight } = await import('/src/coast/world/cinema/cinemaLayout.ts');
    const { ambience, contexts: [context] } = window.cinemaAmbienceFixture;
    const steps = [];
    let elapsed = 1;
    const createSource = context.createBufferSource.bind(context);
    context.createBufferSource = () => {
      const source = createSource();
      const start = source.start.bind(source);
      source.start = (...args) => {
        const samples = source.buffer.getChannelData(0);
        const energy = samples.reduce((sum, n) => sum + n * n, 0);
        const differences = samples.slice(1).reduce((sum, n, i) => sum + (n - samples[i]) ** 2, 0);
        steps.push({ time: elapsed, texture: differences / energy });
        start(...args);
      };
      return source;
    };
    const up = new Vector3(0, 1, 0);
    const dt = 0.02;
    const frame = (x, z, movement, forward, grounded = true, cameraX = x) => {
      elapsed += dt;
      const eyeHeight = movement === 'crouch' ? 1.15 : 1.65;
      const y = cinemaGroundHeight(x, z) + eyeHeight + (grounded ? 0 : 1);
      ambience.update(new Vector3(cameraX, y + 0.28, z), forward, up, elapsed, movement, [], grounded,
        new Vector3(x, y, z));
    };
    const dx = cinemaNavigation.walkSpeed * dt;
    const east = new Vector3(1, 0, 0);
    for (let i = 0; i <= 30; i += 1) frame(-8, 52.4, 'walk', east, true, -8 + dx * i);
    const headMotion = steps.splice(0);
    for (let i = 0; i <= 80; i += 1) frame(-8 + dx * i, 52.4, 'walk', east, true, -8);
    const carpet = steps.splice(0);
    for (let i = 0; i < 30; i += 1) frame(-8 + dx * 80, 52.4, 'walk', east);
    let x = -8 + dx * 80;
    for (const movement of ['flight', 'walk', 'crouch']) {
      for (let i = 0; i < 30; i += 1) {
        x += dx;
        frame(x, 52.4, movement, east, false);
      }
    }
    for (let i = 0; i <= 10; i += 1) frame(x + dx * i, 52.4, 'walk', east);
    const stopped = steps.splice(0);
    frame(x + dx * 11, 52.4, 'walk', east);
    const landed = steps.splice(0);
    for (let i = 0; i < 25; i += 1) frame(x + dx * 11, 52.4, 'walk', east);
    const stairX = CINEMA_AISLES[1].x;
    const tread = CINEMA_TREADS.find(tread => tread.row === 10);
    const back = new Vector3(0, 0, 1);
    for (let i = 0; i <= 11; i += 1) frame(stairX, tread.z + dx * (i - 11), 'walk', back);
    return { headMotion, carpet, stopped, landed, stair: steps };
  });
  assert.deepEqual(footfalls.headMotion, []);
  assert.equal(footfalls.carpet.length, 3);
  for (let i = 1; i < footfalls.carpet.length; i += 1) {
    const interval = footfalls.carpet[i].time - footfalls.carpet[i - 1].time;
    assert.ok(interval >= 0.47 && interval <= 0.52, `walking step interval ${interval}s`);
  }
  assert.deepEqual(footfalls.stopped, []);
  assert.equal(footfalls.landed.length, 1);
  assert.equal(footfalls.stair.length, 1);
  assert.ok(footfalls.stair[0].texture > Math.max(...footfalls.carpet.map(step => step.texture)) * 2);

  await page.waitForFunction(() => window.cinemaAmbienceFixture.contexts[0].tails[1].disconnected);
  await page.evaluate(() => {
    const {ambience,gainProbes} = window.cinemaAmbienceFixture;
    gainProbes.probes.forEach(({source,gain})=>{source.stop();source.disconnect();gain.disconnect();});
    gainProbes.taps.forEach(({analyser,sink})=>{analyser.disconnect();sink.disconnect();});
    ambience.dispose();
  });
  await page.waitForFunction(() => window.cinemaAmbienceFixture.contexts[0].state === 'closed');
  mark('ambient-final-assertions-complete');
  assert.ok(gainObservations.length===4 && gainObservations.every(r=>!r.waitFailed && r.analysisWindowReady && r.conservativeWindowStart>=r.gainSettledAt && r.nonFinite.every(n=>n===0) && r.busOutputWithinOriginalTolerance && r.masterOutputWithinOriginalTolerance), 'Every original gain state must also match measured native bus/master carrier output');
});


test('shared source spectrum retains legacy air/aim values and keeps subwoofer handling separate', () => {
  const source = { position: [0, 2, 0], aim: [0, 0, 1], subwoofer: false };
  const onAxis = cinemaSourceBandLoss(source, [0, 2, 40], 40);
  assert.deepEqual(onAxis, [.0004, .0013, .0027, .0047, .009, .024].map(value => -40 * value));
  const offAxis = cinemaSourceBandLoss(source, [40, 2, 0], 40);
  assert.ok(offAxis[5] < onAxis[5] - 4.99);
  assert.deepEqual(cinemaSourceBandLoss({ ...source, subwoofer: true }, [40, 2, 0], 40), [0, 0, 0, 0, 0, 0]);
  const early = cinemaSourceBandLoss(source, [0, 2, 10], 80);
  assert.equal(early[5], -80 * .024); // Launch direction stays axial; the whole reflected path absorbs air.
});

test('finite screen crossing, shared reflection bands and shelf sections preserve separate transfer causes', () => {
  assert.equal(cinemaPathCrossesScreen([[0, 12, -1.4], [0, 5, 35.85]]), true);
  assert.equal(cinemaPathCrossesScreen([[19, 12, -1.4], [19, 5, 35.85]]), false);
  assert.equal(cinemaPathCrossesScreen([[0, 1, -1.4], [0, 1, 35.85]]), false);
  assert.equal(cinemaPathCrossesScreen([[0, 12, 1], [0, 5, 35.85]]), false);
  const gain = cinemaReflectionBandGain(['left', 'ceiling']);
  assert.equal(gain.length, 6);
  for (let band = 0; band < gain.length; band++) {
    assert.equal(gain[band], CINEMA_SURFACE_GAINS.left[band] * CINEMA_SURFACE_GAINS.ceiling[band]);
  }
  const sections = cinemaBandShelves([125, 250, 500], [-.1, -.3, -1]);
  assert.equal(sections[0].frequency, Math.sqrt(125 * 250));
  assert.ok(Math.abs(sections[0].gainDb + .2) < 1e-12);
  assert.ok(Math.abs(sections[1].gainDb + .7) < 1e-12);
});

test('every speaker has direct seat clearance at all row standing/crouching and aisle inspection poses', t => {
  let tested = 0;
  const blocked = [];
  for (const row of CINEMA_ROWS) {
    for (const x of [-18.4, -14, -7, -6.66, 0, 6.66, 7, 14, 18.4]) {
      for (const eye of [1.15, 1.65]) {
        const listener = [x, cinemaGroundHeight(x, row.z) + eye, row.z];
        for (const source of CINEMA_RENDER_SPEAKERS) {
          tested++;
          const path = cinemaSeatingClearance(source.position, listener);
          if (path.blocked) blocked.push({ speaker: source.id, row: row.number, x, eye,
            seatDepth: path.seatDepth, treadDepth: path.treadDepth });
        }
      }
    }
  }
  t.diagnostic(`Direct finite seat/tread rays: ${tested}; blocked: ${blocked.length}`);
  assert.deepEqual(blocked, []);
});


test('causal propagation FIR preserves the analytic shelf transfer without level normalization', () => {
  const unity = cinemaPropagationImpulse({ bandDb: [0, 0, 0, 0, 0, 0], screenCrossings: 0 }, 256);
  assert.equal(unity[0], 1); assert.ok(unity.subarray(1).every(value => value === 0));
  const constant = cinemaPropagationImpulse({ bandDb: [-6, -6, -6, -6, -6, -6], screenCrossings: 0 }, 256);
  assert.ok(Math.abs(constant[0] - 10 ** (-6 / 20)) < 1e-7);
  assert.ok(constant.subarray(1).every(value => value === 0));
  // Independent analytic W3C S=1 reference, generated without the FIR implementation.
  const oracle = [[63,.985943423661866,-.02860825512326161],[125,.980169727822701,-.058378819586121344],
    [250,.9561598387198946,-.10541610410767717],[500,.9073173742670725,-.17181126924879758],
    [1000,.8016164007478866,-.2576817446966986],[2000,.6122296616554151,-.28502747008932267],
    [4000,.45587778766590137,-.1851171958311123],[8000,.41398189748603736,-.09132091817222615],
    [16000,.40399198567895983,-.028100149665358332]];
  const impulse = cinemaPropagationImpulse({ bandDb: [-.116, -.302, -.608, -1.188, -2.86, -5.96],
    screenCrossings: 1 }, 256);
  for (const [frequency, real, imaginary] of oracle) {
    let re = 0, im = 0;
    impulse.forEach((value, n) => { re += value * Math.cos(2 * Math.PI * frequency * n / 48000);
      im -= value * Math.sin(2 * Math.PI * frequency * n / 48000); });
    assert.ok(Math.abs(20 * Math.log10(Math.hypot(re, im) / Math.hypot(real, imaginary))) < .1);
    assert.ok(Math.abs(Math.atan2(im * real - re * imaginary, re * real + im * imaginary)) < Math.PI / 180);
  }
});


test('each finite fabric crossing contributes one causal screen transfer', () => {
  assert.equal(cinemaScreenCrossings([[-12, 14, 10], [-13, 7, -3.1], [-15, 2, 1]]), 2);
  assert.equal(cinemaScreenCrossings([[16, 14, 10], [16, 7, -3.1], [16, 2, 1]]), 0);
  const bandDb = [0, 0, 0, 0, 0, 0];
  const once = cinemaPropagationImpulse({ bandDb, screenCrossings: 1 }, 512);
  const twice = cinemaPropagationImpulse({ bandDb, screenCrossings: 2 }, 512);
  let error = 0;
  for (let n = 0; n < twice.length; n++) {
    let expected = 0;
    for (let tap = 0; tap <= n; tap++) expected += once[tap] * once[n - tap];
    error = Math.max(error, Math.abs(twice[n] - expected));
  }
  assert.ok(error < 2e-7, `Two actual traversals must equal two transfers, error ${error}`);
});
