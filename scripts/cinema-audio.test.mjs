import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Vector3 } from 'three';

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
hook.deregister();

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
test('Chromium OfflineAudioContext verifies cinema signals at every seat and playback quality', {
  skip: !browserChannel && !process.env.CINEMA_AUDIO_BROWSER,
  timeout: 90_000,
}, async t => {
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
  const metrics = await page.evaluate(async seats => {
    const { PerspectiveCamera } = await import('/node_modules/three/build/three.module.js');
    const { createCinemaPlayback } = await import('/src/coast/world/cinema/cinemaPlayback.ts');
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
          void context.suspend(at).then(() => { playback.setQuality(next); playback.update(camera); return context.resume(); });
        }
      }
      if (options.disposed) {
        // The caller's other connection must survive disposing the cinema graph.
        source.connect(context.destination);
        playback.dispose();
        playback.dispose();
      }
      source.start(time);
      const result = await context.startRendering();
      playback.dispose();
      return result;
    }
    async function clarity(buffer, band, onset) {
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
    const [left, right, unknown, aligned, inverted, surround, facing, turned, silent, bypass, switching] = await Promise.all([
      response('light', seats[1], [0.4, 0]), response('light', seats[1], [0, 0.4]),
      response('light', seats[1], [0.4, 0], 0, { channelCount: 0 }),
      response('high', seats[2], [0.25, 0.25]), response('high', seats[2], [0.25, -0.25]),
      response('light', seats[1], [0, 0, 0, 0, 0, 0.4]),
      response('high', seats[1], [0.25]), response('high', seats[1], [0.25], Math.PI / 2),
      response('light', seats[1], [0, 0]), response('light', seats[1], [0.4, 0], 0, { disposed: true }),
      response('light', seats[2], [0.3], 0, { transition: true }),
    ]);
    const balance = buffer => {
      const [l, r] = [0, 1].map(ch => buffer.getChannelData(ch).slice(first, first + rate * 0.012)
        .reduce((sum, sample) => sum + sample * sample, 0));
      return 10 * Math.log10(l / r);
    };
    return {
      responseStats,
      l: balance(left), r: balance(right), unknown: balance(unknown), c: balance(facing), turned: balance(turned),
      surround: balance(surround),
      monoAfterDispose: bypass.getChannelData(0)[first], bypassRight: bypass.getChannelData(1)[first],
      silentEnergy: energy(silent, 0, silent.length),
      wetRatio: energy(inverted, first + rate * 0.08, rate) / energy(aligned, first + rate * 0.08, rate),
      switchingEnergy: [0.20, 0.24, 0.28, 0.38].map(time => energy(switching, Math.round(rate * time), Math.round(rate * (time + 0.02)))),
    };
  }, seats);
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
  assert.ok(metrics.l > 2 && metrics.r < -2);
  assert.ok(Math.abs(metrics.l - metrics.unknown) < 0.01);
  assert.ok(metrics.surround < -2);
  assert.ok(Math.abs(metrics.turned - metrics.c) > 3);
  assert.ok(metrics.wetRatio > 0.35 && metrics.wetRatio < 2.5);
  assert.equal(metrics.silentEnergy, 0);
  assert.ok(Math.abs(metrics.monoAfterDispose - 0.4) < 1e-6);
  assert.equal(metrics.bypassRight, 0);
  assert.ok(Math.min(...metrics.switchingEnergy) / Math.max(...metrics.switchingEnergy) > 0.25);

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

  const expectGains = targets => page.waitForFunction(expected => {
    const { ambience, gains } = window.cinemaAmbienceFixture;
    return ambience.isRunning() && expected.every((value, i) => Math.abs(gains[i].value - value) < .002);
  }, targets, { timeout: 4000 });
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
  await page.evaluate(() => window.cinemaAmbienceFixture.ambience.stopDemoCue());
  await page.waitForFunction(() => window.cinemaAmbienceFixture.contexts[0].tails[1].disconnected);
  await page.evaluate(() => window.cinemaAmbienceFixture.ambience.dispose());
  await page.waitForFunction(() => window.cinemaAmbienceFixture.contexts[0].state === 'closed');
});
