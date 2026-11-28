import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { PerspectiveCamera } from 'three';
import { runInNewContext } from 'node:vm';

const src = new URL('../src/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { CINEMA_ROOM_PROCESSOR_SOURCE } =
  await import('../src/coast/world/cinema/cinemaRoomProcessor.ts');
const { cinemaHrtfDirectionIndexForPose, createCinemaRoomAudio } =
  await import('../src/coast/world/cinema/cinemaRoomAudio.ts');
const { CINEMA_CONVOLUTION_PROCESSOR_SOURCE, prepareCinemaConvolution, createCinemaConvolutionPreparer, decodeCinemaHrir } =
  await import('../src/coast/world/cinema/cinemaConvolution.ts');
const { createCinemaKernelBankPreparer } = await import('../src/coast/world/cinema/cinemaKernelBanks.ts');
const { cinemaPropagationImpulse } = await import('../src/coast/world/cinema/cinemaPropagationFilter.ts');
const { cinemaSourceBandLoss } = await import('../src/coast/world/cinema/cinemaPropagation.ts');
const { CINEMA_RENDER_SPEAKERS, createCinemaRoutingShapes } = await import('../src/coast/world/cinema/cinemaSpeakers.ts');
hook.deregister();

function createProcessor(speakerCount = 1, inputCount = 1, kinds = Array(speakerCount).fill(0)) {
  let Processor;
  const statuses = [];
  class WorkletBase {
    constructor() {
      this.port = {
        onmessage: null,
        postMessage: message => statuses.push(message),
      };
    }
  }
  const registerProcessor = (_name, implementation) => { Processor = implementation; };
  const install = new Function(
    'registerProcessor', 'AudioWorkletProcessor', 'currentFrame', 'currentTime',
    CINEMA_ROOM_PROCESSOR_SOURCE,
  );
  install(registerProcessor, WorkletBase, 0, 0);
  const processor = new Processor({
    processorOptions: {
      speakerCount,
      inputCount,
      kinds,
      lfeIndex: -1,
      lfeGain: 1,
    },
  });
  return { processor, statuses };
}

function send(processor, data) {
  processor.port.onmessage({ data });
}

test('cinema room processor holds the playback sample during an underrun', () => {
  const { processor, statuses } = createProcessor();
  send(processor, { type: 'pose', spatial: new Float32Array([0, 0, 1, 1, 0]) });
  send(processor, { type: 'seek', sample: 10 });
  send(processor, { type: 'playing', active: true });
  const output = [new Float32Array(1024), new Float32Array(1024)];
  processor.process([], [output]);
  const missing = statuses.at(-1);
  assert.equal(missing.type, 'status');
  assert.equal(missing.sample, 10);
  assert.equal(missing.playing, false);
  assert.equal(missing.underruns, 1);

  send(processor, {
    type: 'enqueue',
    startSample: 10,
    channels: [new Float32Array([1, 1])],
    routingSegments: [{
      offset: 0,
      length: 2,
      start: new Float32Array([1]),
      end: new Float32Array([1]),
    }],
  });
  processor.process([], [output]);
  const resumed = statuses.at(-1);
  assert.equal(resumed.sample, 12);
  assert.equal(resumed.playing, true);
  assert.equal(resumed.underruns, 1);
});

test('KEMAR direction bins preserve front, rear, left/right, elevation and head rotation', () => {
  const listener = [0, 0, 0];
  const forward = [0, 0, -1];
  const up = [0, 1, 0];
  assert.equal(cinemaHrtfDirectionIndexForPose([0, 0, -1], listener, forward, up), 12);
  assert.equal(cinemaHrtfDirectionIndexForPose([1, 0, 0], listener, forward, up), 15);
  assert.equal(cinemaHrtfDirectionIndexForPose([-1, 0, 0], listener, forward, up), 21);
  assert.equal(cinemaHrtfDirectionIndexForPose([0, 0, 1], listener, forward, up), 18);
  assert.equal(cinemaHrtfDirectionIndexForPose([0, 1, -1], listener, forward, up), 36);
  assert.equal(cinemaHrtfDirectionIndexForPose([0, -1, -1], listener, forward, up), 0);
  assert.equal(cinemaHrtfDirectionIndexForPose([1, 0, 0], listener, [1, 0, 0], up), 12);
});

test('compact KEMAR runtime asset matches the 60 x 144 x stereo little-endian format', () => {
  const bytes = readFileSync(new URL(
    '../public/cinema-audio/cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin', import.meta.url));
  assert.equal(bytes.byteLength, 60 * 144 * 2 * 2);
  const frontOffset = 12 * 144 * 4;
  const rearOffset = 18 * 144 * 4;
  assert.notEqual(bytes.readInt16LE(frontOffset), 0);
  assert.notEqual(bytes.readInt16LE(rearOffset), 0);
  assert.ok(Math.abs(bytes.readInt16LE(frontOffset + 2))
    + Math.abs(bytes.readInt16LE(rearOffset + 2)) > 0);
});

test('worklet consumes seat-dependent early reflection paths separately from direct routing', () => {
  const { processor } = createProcessor();
  send(processor, {
    type: 'pose',
    spatial: new Float32Array([0, 0, 0, 0, 0, 1, 12]),
    reflections: [{
      speaker: 0,
      delaySamples: 0,
      gain: 1,
      highGain: 1,
      leftGain: 1,
      rightGain: 1,
      direction: 12,
    }],
  });
  send(processor, {
    type: 'enqueue',
    startSample: 0,
    channels: [new Float32Array([1])],
    routingSegments: [{
      offset: 0,
      length: 1,
      start: new Float32Array([1]),
      end: new Float32Array([1]),
    }],
  });
  send(processor, { type: 'playing', active: true });
  const output = [new Float32Array(128), new Float32Array(128)];
  processor.process([], [output]);
  assert.ok(output[0].some(value => value > 0));
  assert.ok(output[1].some(value => value > 0));
});

test('bass management activates sub groups for a full-range bed without an explicit LFE plane', () => {
  const { processor } = createProcessor(2, 1, [0, 1]);
  send(processor, {
    type: 'pose',
    spatial: new Float32Array([
      0, 0, 0, 0, 0, 1, 12,
      0, 0, 1, 1, 0, 1, 12,
    ]),
    reflections: [],
  });
  send(processor, {
    type: 'enqueue',
    startSample: 0,
    channels: [new Float32Array(128).fill(1)],
    routingSegments: [{
      offset: 0,
      length: 128,
      start: new Float32Array([1, 0]),
      end: new Float32Array([1, 0]),
    }],
  });
  send(processor, { type: 'playing', active: true });
  const output = [new Float32Array(128), new Float32Array(128)];
  processor.process([], [output]);
  assert.ok(output[0].some(value => value > 0));
});

test('dense 48 kHz KEMAR processing keeps its output finite', t => {
  const speakerCount = 57;
  const inputCount = 12 + 32;
  const warmUpBlocks = 32;
  const blocks = 128;
  const quantum = 128;
  const frames = (warmUpBlocks + blocks) * quantum;
  const { processor } = createProcessor(speakerCount, inputCount, [...Array(53).fill(0), 1, 1, 2, 2]);
  const bytes = readFileSync(new URL(
    '../public/cinema-audio/cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin', import.meta.url));
  send(processor, {
    type: 'hrtf',
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  const spatial = new Float32Array(speakerCount * 7);
  for (let speaker = 0; speaker < speakerCount; speaker += 1) {
    const base = speaker * 7;
    spatial[base] = 32;
    spatial[base + 1] = 32;
    spatial[base + 2] = 0.7;
    spatial[base + 3] = 0.7;
    spatial[base + 4] = 0.02;
    spatial[base + 5] = 1;
    spatial[base + 6] = 12;
  }
  const reflections = Array.from({ length: 48 }, (_, speaker) => ({
    speaker, delaySamples: 2000 + speaker * 111, gain: .3, highGain: .4,
    leftGain: .7, rightGain: .7, direction: (speaker + 3) % 60,
  }));
  send(processor, { type: 'pose', spatial, reflections });
  const hrir = decodeCinemaHrir(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const paths = Array.from({ length: speakerCount }, (_, speaker) =>
    ({ speaker, delaySamples: 32, direction: 12, gain: 1, send: .02 }));
  for (const path of reflections) {
    const gain = path.gain * (.12 + .18 * path.highGain);
    paths.push({ speaker: path.speaker, delaySamples: path.delaySamples,
      direction: path.direction, gain, send: gain });
  }
  send(processor, { type: 'filters', packet: prepareCinemaConvolution(hrir, paths) });
  const channels = Array.from({ length: inputCount }, () => new Float32Array(frames).fill(0.01));
  const routing = new Float32Array(speakerCount * inputCount);
  for (let speaker = 0; speaker < speakerCount; speaker += 1) {
    routing[speaker * inputCount + speaker % 12] = .3;
    routing[speaker * inputCount + 12 + speaker % 32] = .3;
  }
  send(processor, {
    type: 'enqueue',
    startSample: 0,
    channels,
    routingSegments: [{ offset: 0, length: frames, start: routing, end: routing }],
  });
  send(processor, { type: 'playing', active: true });
  const output = [new Float32Array(quantum), new Float32Array(quantum)];
  for (let block = 0; block < warmUpBlocks; block += 1) processor.process([], [output]);
  const times = [];
  for (let block = 0; block < blocks; block += 1) {
    const started = performance.now();
    processor.process([], [output]);
    times.push(performance.now() - started);
    assert.ok(output.every(ear => ear.every(value => Number.isFinite(value) && Math.abs(value) <= 1)));
  }
  assert.ok(output.some(ear => ear.some(value => value !== 0)));
  times.sort((a, b) => a - b);
  const p99 = times[Math.ceil(times.length * .99) - 1];
  t.diagnostic(`Synthetic Node render cost per 128 samples: p99 ${p99.toFixed(2)} ms`);
});


function flattenKernelBanks(banks, gains) {
  const count = banks.reduce((sum, bank) => sum + bank.lags.length, 0);
  const packet = { speakers: new Uint16Array(count), lags: new Uint16Array(count), gains: new Float32Array(count * 2),
    kernels: new Float32Array(count * 516), timeKernels: new Float32Array(count * 256) };
  let at = 0;
  banks.forEach((bank, index) => {
    packet.speakers.fill(bank.speaker, at, at + bank.lags.length); packet.lags.set(bank.lags, at);
    packet.kernels.set(bank.kernels, at * 516); packet.timeKernels.set(bank.timeKernels, at * 256);
    for (let part = 0; part < bank.lags.length; part++) {
      packet.gains[at * 2] = gains[index * 2]; packet.gains[at * 2 + 1] = gains[index * 2 + 1]; at++;
    }
  });
  return packet;
}

function convolutionFixture() {
  const Constructor = new Function(`${CINEMA_CONVOLUTION_PROCESSOR_SOURCE}; return CinemaPartitionedConvolver;`)();
  const bytes = readFileSync(new URL(
    '../public/cinema-audio/cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin', import.meta.url));
  return { Constructor, hrir: decodeCinemaHrir(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
}

test('partitioned convolution preserves every tap, ear and fractional arrival for all 60 measured directions', () => {
  const { Constructor, hrir } = convolutionFixture();
  let largestError = 0;
  for (let direction = 0; direction < 60; direction++) {
    const convolver = new Constructor(1);
    convolver.setPacket(prepareCinemaConvolution(hrir,
      [{ speaker: 0, delaySamples: 37.25, direction, gain: .6, send: .2 }]));
    const rings = [new Float32Array(32768)];
    rings[0][0] = .25;
    for (let block = 0; block < 4; block++) {
      const output = convolver.render(rings, (block + 1) * 128, (block + 1) * 128);
      for (let frame = 0; frame < 128; frame++) {
        const sample = block * 128 + frame;
        let sum = 0;
        for (let ear = 0; ear < 2; ear++) {
          const tap = sample - 37;
          const at = index => index >= 0 && index < 144 ? hrir[(direction * 144 + index) * 2 + ear] : 0;
          const expected = .25 * (.75 * at(tap) + .25 * at(tap - 1));
          largestError = Math.max(largestError, Math.abs(output[ear][frame] - expected * .6));
          sum += expected;
        }
        largestError = Math.max(largestError, Math.abs(output[2][frame] - sum * .1));
      }
    }
  }
  assert.ok(largestError < 1e-7, `Maximum full-HRIR waveform error ${largestError}`);
});

test('maximum propagation delay, source-ring wrap and reset retain the same absolute sample arrival', () => {
  const { Constructor, hrir } = convolutionFixture();
  const convolver = new Constructor(1);
  convolver.setPacket(prepareCinemaConvolution(hrir,
    [{ speaker: 0, delaySamples: 23999.5, direction: 15, gain: 1, send: 0 }]));
  const rings = [new Float32Array(32768)];
  const impulse = 32690;
  let largestError = 0, energy = 0;
  for (let block = 0; block < 480; block++) {
    for (let i = 0; i < 128; i++) {
      const sample = block * 128 + i;
      rings[0][sample & 32767] = sample === impulse ? .2 : 0;
    }
    const end = (block + 1) * 128;
    const output = convolver.render(rings, end & 32767, end);
    for (let i = 0; i < 128; i++) {
      const tap = block * 128 + i - impulse - 23999;
      for (let ear = 0; ear < 2; ear++) {
        const at = index => index >= 0 && index < 144 ? hrir[(15 * 144 + index) * 2 + ear] : 0;
        const expected = .1 * (at(tap) + at(tap - 1));
        largestError = Math.max(largestError, Math.abs(output[ear][i] - expected));
        energy += output[ear][i] ** 2;
      }
    }
  }
  assert.ok(energy > 1e-5);
  assert.ok(largestError < 1e-7, `Wrapped path error ${largestError}`);
  convolver.reset();
  rings[0].fill(0);
  const silence = convolver.render(rings, 128, 128);
  assert.ok(silence.every(channel => channel.every(value => value === 0)));
  assert.throws(() => prepareCinemaConvolution(hrir,
    [{ speaker: 0, delaySamples: 24001, direction: 0, gain: 1, send: 0 }]), /Invalid cinema propagation path/);
});

test('filter changes crossfade old/new kernels on one input history and coalesce a pending pose', () => {
  const { Constructor, hrir } = convolutionFixture();
  const convolver = new Constructor(1);
  const rings = [new Float32Array(32768)];
  const packets = [12, 15, 18].map(direction => prepareCinemaConvolution(hrir,
    [{ speaker: 0, delaySamples: 10, direction, gain: .4, send: 0 }]));
  convolver.setPacket(packets[0]);
  let largestError = 0;
  const inputAt = sample => sample < 0 ? 0 : .05 * Math.sin(sample * .133);
  const expected = (sample, direction) => {
    let value = 0;
    for (let tap = 0; tap < 144; tap++) value += inputAt(sample - 10 - tap) * hrir[(direction * 144 + tap) * 2];
    return value * .4;
  };
  for (let block = 0; block < 24; block++) {
    if (block === 8) convolver.setPacket(packets[1]);
    if (block === 9) convolver.setPacket(packets[2]);
    for (let i = 0; i < 128; i++) rings[0][(block * 128 + i) & 32767] = inputAt(block * 128 + i);
    const output = convolver.render(rings, (block + 1) * 128, (block + 1) * 128);
    for (let i = 0; i < 128; i++) {
      const sample = block * 128 + i;
      let value;
      if (block < 8) value = expected(sample, 12);
      else if (block < 14) {
        const amount = Math.min(1, (sample - 8 * 128) / 720);
        value = expected(sample, 12) * (1 - amount) + expected(sample, 15) * amount;
      } else {
        const amount = Math.min(1, (sample - 14 * 128) / 720);
        value = expected(sample, 15) * (1 - amount) + expected(sample, 18) * amount;
      }
      largestError = Math.max(largestError, Math.abs(value - output[0][i]));
    }
  }
  assert.ok(largestError < 1e-7, `Time-varying same-history error ${largestError}`);
  assert.equal(convolver.pending, null);
  assert.equal(convolver.previous, null);
});

test('production partitioned routing, diffuse bands and FDN match the full-HRIR reference without added delay', () => {
  const { hrir } = convolutionFixture();
  const raw = readFileSync(new URL(
    '../public/cinema-audio/cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin', import.meta.url));
  const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const reference = createProcessor().processor;
  const candidate = createProcessor().processor;
  const spatial = new Float32Array([37.25, 37.25, .7, .7, .02, .6, 15]);
  const reflections = [{ speaker: 0, delaySamples: 511.75, gain: .3, highGain: .4,
    leftGain: .7, rightGain: .7, direction: 18 }];
  const samples = new Float32Array(32768);
  samples[12017] = .2;
  for (let i = 16000; i < 20000; i++) samples[i] = .01 * Math.sin(i * .17);
  for (const processor of [reference, candidate]) {
    send(processor, { type: 'hrtf', buffer: bytes });
    send(processor, { type: 'pose', spatial, reflections });
    send(processor, { type: 'enqueue', startSample: 0, channels: [samples], routing: new Float32Array([1]) });
    send(processor, { type: 'playing', active: true });
  }
  const gain = .3 * (.12 + .18 * .4);
  send(candidate, { type: 'filters', packet: prepareCinemaConvolution(hrir, [
    { speaker: 0, delaySamples: 37.25, direction: 15, gain: .6, send: .02 },
    { speaker: 0, delaySamples: 511.75, direction: 18, gain, send: gain },
  ]) });
  const referenceOutput = [new Float32Array(128), new Float32Array(128)];
  const candidateOutput = [new Float32Array(128), new Float32Array(128)];
  let difference = 0, energy = 0, firstReference = -1, firstCandidate = -1;
  for (let block = 0; block < 256; block++) {
    reference.process([], [referenceOutput]);
    candidate.process([], [candidateOutput]);
    for (let ear = 0; ear < 2; ear++) {
      for (let frame = 0; frame < 128; frame++) {
        const expected = referenceOutput[ear][frame], actual = candidateOutput[ear][frame];
        if (Math.abs(expected) > 1e-6 && firstReference === -1) firstReference = block * 128 + frame;
        if (Math.abs(actual) > 1e-6 && firstCandidate === -1) firstCandidate = block * 128 + frame;
        difference += (expected - actual) ** 2;
        energy += expected ** 2;
      }
    }
  }
  assert.equal(firstCandidate, firstReference);
  assert.equal(candidate.playhead, reference.playhead);
  assert.equal(candidate.underruns, 0);
  assert.ok(10 * Math.log10(difference / energy) < -105,
    `Production response difference ${10 * Math.log10(difference / energy)} dB`);
});

test('short render quanta, queue gaps and seek keep the clock and discard convolution history', () => {
  const { hrir } = convolutionFixture();
  const raw = readFileSync(new URL(
    '../public/cinema-audio/cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin', import.meta.url));
  const processor = createProcessor().processor;
  send(processor, { type: 'hrtf', buffer: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) });
  send(processor, { type: 'pose', spatial: new Float32Array([0, 0, .7, .7, 0, 1, 12]) });
  send(processor, { type: 'filters', packet: prepareCinemaConvolution(hrir,
    [{ speaker: 0, delaySamples: 0, direction: 12, gain: 1, send: 0 }]) });
  send(processor, { type: 'enqueue', startSample: 0, channels: [new Float32Array(192).fill(.01)], routing: new Float32Array([1]) });
  send(processor, { type: 'playing', active: true });
  const short = [new Float32Array(64), new Float32Array(64)];
  processor.process([], [short]);
  assert.equal(processor.playhead, 64);
  const normal = [new Float32Array(128), new Float32Array(128)];
  processor.process([], [normal]);
  assert.equal(processor.playhead, 192);
  processor.process([], [normal]);
  assert.equal(processor.playhead, 192);
  assert.equal(processor.underruns, 1);
  send(processor, { type: 'seek', sample: 5000, generation: 7 });
  send(processor, { type: 'enqueue', startSample: 5000, channels: [new Float32Array(256)], routing: new Float32Array([1]) });
  send(processor, { type: 'playing', active: true });
  processor.process([], [normal]);
  assert.equal(processor.playhead, 5128);
  assert.ok(normal.every(ear => ear.every(value => value === 0)));
});

test('mixed short/normal rendering uses the same full-HRIR timeline across quantum-size changes', () => {
  const { Constructor, hrir } = convolutionFixture();
  const convolver = new Constructor(1);
  convolver.setPacket(prepareCinemaConvolution(hrir,
    [{ speaker: 0, delaySamples: 19.375, direction: 15, gain: .8, send: 0 }]));
  const rings = [new Float32Array(32768)];
  const source = sample => sample < 0 ? 0 : .03 * Math.sin(sample * .27);
  let end = 0, largestError = 0;
  for (const count of [64, 128, 17, 111, 64, 128, 128, 31, 97]) {
    const first = end;
    for (let i = 0; i < count; i++) rings[0][(end + i) & 32767] = source(end + i);
    end += count;
    const output = convolver.render(rings, end & 32767, end, count);
    for (let ear = 0; ear < 2; ear++) {
      for (let frame = 0; frame < count; frame++) {
        let expected = 0;
        for (let tap = 0; tap < 144; tap++) {
          const sample = first + frame - 19 - tap;
          expected += (.625 * source(sample) + .375 * source(sample - 1)) * hrir[(15 * 144 + tap) * 2 + ear] * .8;
        }
        largestError = Math.max(largestError, Math.abs(output[ear][frame] - expected));
      }
    }
  }
  assert.ok(largestError < 1e-7, `Variable-quantum waveform error ${largestError}`);
});

test('dispose stops the worklet and ignores queued filter/input messages', () => {
  const { processor } = createProcessor();
  const { hrir } = convolutionFixture();
  const packet = prepareCinemaConvolution(hrir,
    [{ speaker: 0, delaySamples: 0, direction: 12, gain: 1, send: 0 }]);
  send(processor, { type: 'filters', packet });
  send(processor, { type: 'dispose' });
  send(processor, { type: 'filters', packet });
  send(processor, { type: 'enqueue', startSample: 0, channels: [new Float32Array(128).fill(1)], routing: new Float32Array([1]) });
  const output = [new Float32Array(128).fill(1), new Float32Array(128).fill(1)];
  assert.equal(processor.process([], [output]), false);
  assert.ok(output.every(ear => ear.every(value => value === 0)));
  assert.equal(processor.convolver.current, null);
  assert.equal(processor.queue.length, 0);
});


test('propagation FIR before full HRIR preserves complex waveform and fractional arrival in all directions', () => {
  const { Constructor, hrir } = convolutionFixture();
  const filter = cinemaPropagationImpulse({ bandDb: [-.116, -.302, -.608, -1.188, -2.86, -5.96],
    screenCrossings: 1 }, 256);
  let largestError = 0;
  for (let direction = 0; direction < 60; direction++) {
    const convolver = new Constructor(1);
    convolver.setPacket(prepareCinemaConvolution(hrir,
      [{ speaker: 0, delaySamples: 37.25, direction, gain: .6, send: .2, filter }]));
    const expected = [new Float64Array(399), new Float64Array(399)];
    for (let ear = 0; ear < 2; ear++) for (let h = 0; h < 144; h++) for (let f = 0; f < filter.length; f++) {
      expected[ear][h + f] += hrir[(direction * 144 + h) * 2 + ear] * filter[f];
    }
    const rings = [new Float32Array(32768)]; rings[0][0] = .25;
    let end = 0;
    for (const count of [64, 128, 17, 111, 31, 97, 128]) {
      const start = end; end += count;
      const output = convolver.render(rings, end & 32767, end, count);
      for (let frame = 0; frame < count; frame++) {
        const tap = start + frame - 37;
        let sum = 0;
        for (let ear = 0; ear < 2; ear++) {
          const at = i => i >= 0 && i < expected[ear].length ? expected[ear][i] : 0;
          const value = .25 * (.75 * at(tap) + .25 * at(tap - 1));
          largestError = Math.max(largestError, Math.abs(output[ear][frame] - value * .6)); sum += value;
        }
        largestError = Math.max(largestError, Math.abs(output[2][frame] - sum * .1));
      }
    }
  }
  assert.ok(largestError < 1e-7, `Complete FIR+HRIR error ${largestError}`);
});

test('long propagation FIR retains the maximum delay through ring wrap and preparer reset', () => {
  const { Constructor, hrir } = convolutionFixture();
  const filter = cinemaPropagationImpulse({ bandDb: [-.1, -.2, -.4, -.8, -1.6, -3.2],
    screenCrossings: 1 }, 512);
  const prepare = createCinemaConvolutionPreparer(hrir);
  const path = { speaker: 0, delaySamples: 23999.5, direction: 15, gain: 1, send: 0, filter };
  const first = prepare([path]); prepare.clear(); const second = prepare([path]);
  assert.deepEqual(first.kernels, second.kernels);
  const convolver = new Constructor(1); convolver.setPacket(second);
  const expected = [new Float64Array(655), new Float64Array(655)];
  for (let ear = 0; ear < 2; ear++) for (let h = 0; h < 144; h++) for (let f = 0; f < filter.length; f++) {
    expected[ear][h + f] += hrir[(15 * 144 + h) * 2 + ear] * filter[f];
  }
  const rings = [new Float32Array(32768)]; let largestError = 0;
  for (let start = 0; start < 60000; start += 128) {
    const end = start + 128;
    for (let sample = start; sample < end; sample++) rings[0][sample & 32767] = sample === 32760 ? .25 : 0;
    const output = convolver.render(rings, end & 32767, end);
    for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < 128; frame++) {
      const tap = start + frame - 32760 - 23999;
      const at = i => i >= 0 && i < 655 ? expected[ear][i] : 0;
      const value = .125 * (at(tap) + at(tap - 1));
      largestError = Math.max(largestError, Math.abs(output[ear][frame] - value));
    }
  }
  assert.ok(largestError < 1e-7, `Extended delay/ring error ${largestError}`);
  convolver.reset(); rings[0].fill(0);
  assert.ok(convolver.render(rings, 128, 128).every(channel => channel.every(value => value === 0)));
  assert.throws(() => prepare([{ ...path, filter: new Float32Array(513) }]), RangeError);
});


test('production RoomAudio packet applies screen and source propagation before the complete direct HRIR', async t => {
  const originalFetch = globalThis.fetch, originalNode = globalThis.AudioWorkletNode;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.AudioWorkletNode = originalNode; });
  const bytes = readFileSync(new URL('../public/cinema-audio/cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin', import.meta.url));
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const messages = []; let mockNode;
  globalThis.AudioWorkletNode = class {
    constructor() { mockNode = this; this.failNext = false; this.port = { postMessage: message => {
      if (message.type === 'bank-state' && this.failNext) { this.failNext = false; throw new Error('Fixture send failure'); }
      messages.push(message);
    }, close() {} }; }
    connect() {} disconnect() {}
  };
  const context = { currentTime: 0, sampleRate: 48000, audioWorklet: { addModule: async () => {} } };
  const room = await createCinemaRoomAudio(context, {}, { bed: ['C'], objects: [], lfeGainDb: 0 });
  const initial = messages.find(message => message.type === 'bank-state');
  const banks = new Array(initial.pathCount); initial.updates.forEach(({ index, bank }) => { banks[index] = bank; });
  const packet = flattenKernelBanks(banks, initial.gains);
  const spatial = messages.find(message => message.type === 'pose').spatial;
  const center = CINEMA_RENDER_SPEAKERS.findIndex(s => s.id === 'screen-C');
  const source = CINEMA_RENDER_SPEAKERS[center], listener = [0, 5, 35.85];
  const distance = Math.hypot(...source.position.map((v, i) => v - listener[i]));
  const bandDb = cinemaSourceBandLoss({ ...source, subwoofer: false }, listener, distance);
  const filter = cinemaPropagationImpulse({ bandDb, screenCrossings: 1 }, 256);
  const hrir = decodeCinemaHrir(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const direction = spatial[center * 7 + 6];
  const delay = Math.min(spatial[center * 7], spatial[center * 7 + 1]);
  const start = packet.speakers.findIndex(speaker => speaker === center);
  let stop = start; while (packet.speakers[stop] === center) stop++;
  assert.ok(stop - start >= 4, 'Direct propagation FIR must be connected, not only generated');
  const direct = { speakers: packet.speakers.slice(start, stop), lags: packet.lags.slice(start, stop),
    gains: packet.gains.slice(start * 2, stop * 2), kernels: packet.kernels.slice(start * 516, stop * 516),
    timeKernels: packet.timeKernels.slice(start * 256, stop * 256) };
  const { Constructor } = convolutionFixture(); const convolver = new Constructor(57); convolver.setPacket(direct);
  const expected = [new Float64Array(399), new Float64Array(399)];
  for (let ear = 0; ear < 2; ear++) for (let h = 0; h < 144; h++) for (let f = 0; f < filter.length; f++) {
    expected[ear][h + f] += hrir[(direction * 144 + h) * 2 + ear] * filter[f];
  }
  const rings = Array.from({ length: 57 }, () => new Float32Array(32768)); rings[center][0] = .25;
  const integer = Math.floor(delay), fraction = delay - integer; let error = 0;
  for (let startFrame = 0; startFrame < delay + 512; startFrame += 128) {
    const end = startFrame + 128, output = convolver.render(rings, end & 32767, end);
    for (let ear = 0; ear < 2; ear++) for (let frame = 0; frame < 128; frame++) {
      const tap = startFrame + frame - integer, at = i => i >= 0 && i < 399 ? expected[ear][i] : 0;
      const value = .25 * spatial[center * 7 + 5] * ((1 - fraction) * at(tap) + fraction * at(tap - 1));
      error = Math.max(error, Math.abs(output[ear][frame] - value));
    }
  }
  assert.ok(error < 1e-7, `Production direct packet propagation error ${error}`);
  assert.ok(Math.abs(room.centerDelaySamples() - Math.round(delay) - 128) < 1);
  const camera = new PerspectiveCamera(); camera.position.set(...listener); camera.updateMatrixWorld(true);
  room.update(camera); camera.rotateZ(.000001); camera.updateMatrixWorld(true); room.update(camera);
  assert.ok(messages.some(message => message.type === 'bank-state' && message.baseStateId !== null
    && message.updates.length < message.pathCount), 'A pure small head update must reuse unchanged banks');
  assert.ok(messages.filter(message => message.type === 'pose').every(message =>
    message.reflections.every(path => !('filter' in path))), 'Control-only FIR arrays must not be cloned into fallback pose packets');
  mockNode.port.onmessage({ data: { type: 'bank-resync', expectedStateId: 0 } });
  room.update(camera);
  const resynced = messages.filter(message => message.type === 'bank-state').at(-1);
  assert.equal(resynced.baseStateId, null); assert.equal(resynced.updates.length, resynced.pathCount);
  mockNode.failNext = true; camera.rotateZ(.000001); camera.updateMatrixWorld(true);
  assert.throws(() => room.update(camera), /Fixture send failure/); room.update(camera);
  assert.equal(messages.filter(message => message.type === 'bank-state').at(-1).baseStateId, null);
  room.dispose();
});


test('small gain states preserve full-packet fades, pending replacement, seek clocks and final PCM', () => {
  const { hrir } = convolutionFixture();
  const filterA = cinemaPropagationImpulse({ bandDb: [-.1, -.2, -.4, -.8, -1.6, -3.2], screenCrossings: 1 }, 256);
  const filterB = cinemaPropagationImpulse({ bandDb: [-.2, -.3, -.5, -.9, -1.7, -3.3], screenCrossings: 2 }, 256);
  const states = [
    [0, 1, 12, 37.25, .6, .2, filterA], [3, 1, 12, 37.25, .8, .1, filterA],
    [4, 1, 12, 37.25, .55, .3, filterA], [5, 2, 15, 37.25, .55, .3, filterA],
    [9, 2, 15, 37.25, .2, .02, filterA], [10, 3, 15, 38.75, .2, .02, filterB],
    [11, 3, 15, 38.75, .4, .12, filterB], [12, 4, 12, 37.25, .7, .2, filterA],
    [18, 4, 12, 37.25, .5, .05, filterA], [19, 4, 12, 37.25, .8, .3, filterA],
  ];
  const allFull = createProcessor(), optimized = createProcessor();
  const bytes = readFileSync(new URL('../public/cinema-audio/cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin', import.meta.url));
  const hrirBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const enqueue = (target, start) => send(target.processor, { type: 'enqueue', startSample: start,
    channels: [Float32Array.from({ length: 8192 }, (_, n) => .04 * Math.sin(n * .173) + .01 * Math.cos(n * .317))],
    routing: new Float32Array([1]) });
  for (const target of [allFull, optimized]) {
    send(target.processor, { type: 'hrtf', buffer: hrirBuffer });
    send(target.processor, { type: 'pose', spatial: new Float32Array([37.25, 37.25, .7, .7, .2, 1, 12]), reflections: [] });
    enqueue(target, 0); send(target.processor, { type: 'playing', active: true });
  }
  let previousId = -1;
  for (let block = 0; block < 40; block++) {
    if (block === 16) for (const target of [allFull, optimized]) {
      send(target.processor, { type: 'seek', sample: 5000, generation: 7 });
      enqueue(target, 5000); send(target.processor, { type: 'playing', active: true });
    }
    const state = states.find(event => event[0] === block);
    if (state) {
      const [, kernelId, direction, delaySamples, gain, wet, filter] = state;
      const packet = { ...prepareCinemaConvolution(hrir, [{ speaker: 0, direction, delaySamples, gain, send: wet, filter }]), kernelId };
      send(allFull.processor, { type: 'filters', packet });
      if (kernelId === previousId) send(optimized.processor, { type: 'filter-gains', kernelId, gains: packet.gains.slice() });
      else send(optimized.processor, { type: 'filters', packet });
      previousId = kernelId;
    }
    const count = [128, 64, 17, 111][block % 4];
    const a = [new Float32Array(count), new Float32Array(count)], b = [new Float32Array(count), new Float32Array(count)];
    allFull.processor.process([], [a]); optimized.processor.process([], [b]);
    assert.deepEqual(b, a); assert.equal(optimized.processor.playhead, allFull.processor.playhead);
    assert.equal(optimized.processor.convolver.fade, allFull.processor.convolver.fade);
    assert.equal(optimized.processor.convolver.pending?.kernelId, allFull.processor.convolver.pending?.kernelId);
  }
  assert.deepEqual(optimized.statuses, allFull.statuses);
  const before = optimized.processor.convolver.current;
  send(optimized.processor, { type: 'filter-gains', kernelId: 99999, gains: new Float32Array(8) });
  assert.equal(optimized.processor.convolver.current, before);
  const pendingBefore = optimized.processor.convolver.pending;
  send(optimized.processor, { type: 'filter-gains', kernelId: 1, gains: new Float32Array(8) });
  assert.equal(optimized.processor.convolver.current, before);
  assert.equal(optimized.processor.convolver.pending, pendingBefore);
  send(optimized.processor, { type: 'dispose' });
  send(optimized.processor, { type: 'filter-gains', kernelId: previousId, gains: new Float32Array(8) });
  assert.equal(optimized.processor.convolver.current, null);
});

test('partitioned rendering omits only unused legacy kernels and keeps the no-packet fallback', () => {
  const { hrir } = convolutionFixture(), { processor } = createProcessor();
  const buffer = new ArrayBuffer(60 * 144 * 4); new Int16Array(buffer).fill(100);
  send(processor, { type: 'hrtf', buffer });
  let calls = 0; const original = processor.updateKernels.bind(processor);
  processor.updateKernels = count => { calls++; original(count); };
  send(processor, { type: 'playing', active: true });
  processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  assert.equal(calls, 1, 'Fallback requires its original kernel update');
  send(processor, { type: 'filters', packet: prepareCinemaConvolution(hrir,
    [{ speaker: 0, delaySamples: 37, direction: 12, gain: 1, send: .02 }]) });
  send(processor, { type: 'enqueue', startSample: 0, channels: [new Float32Array(512).fill(.01)], routing: new Float32Array([1]) });
  for (const count of [17, 111, 128]) processor.process([], [[new Float32Array(count), new Float32Array(count)]]);
  assert.equal(calls, 1, 'Valid partitioned processing must not update unused legacy kernels');
});


test('a cached propagation identity rejects mutated coefficients and accepts a new immutable version', () => {
  const { hrir } = convolutionFixture(), prepare = createCinemaConvolutionPreparer(hrir);
  const filter = new Float32Array([1, -.1]);
  const path = { speaker: 0, delaySamples: 1.25, direction: 12, gain: 1, send: 0, filter };
  const before = prepare([path]); filter[1] = -.2;
  assert.throws(() => prepare([path]), /mutated/);
  const after = prepare([{ ...path, filter: filter.slice() }]);
  assert.notDeepEqual(after.kernels, before.kernels);
});


test('path bank preparation transfers owned outputs, preserves its cache and commits only successful submissions', () => {
  const { hrir } = convolutionFixture(), prepare = createCinemaKernelBankPreparer(hrir);
  const filter = cinemaPropagationImpulse({ bandDb: [-.1, -.2, -.4, -.8, -1.6, -3.2], screenCrossings: 1 }, 256);
  const paths = [0, 1, 2].map((speaker, i) => ({ speaker, delaySamples: 37.25 + i, direction: 12 + i, gain: .5, send: .1, filter }));
  const first = prepare.prepare(paths);
  assert.throws(() => prepare.prepare(paths), /pending/);
  const received = structuredClone(first.message, { transfer: first.transfer }); first.commit();
  assert.equal(first.message.updates[0].bank.kernels.byteLength, 0);
  assert.ok(received.updates[0].bank.kernels.byteLength > 0);
  const gainOnly = prepare.prepare(paths.map(path => ({ ...path, gain: .6 })));
  assert.equal(gainOnly.message.updates.length, 0); assert.equal(gainOnly.message.baseStateId, 1);
  structuredClone(gainOnly.message, { transfer: gainOnly.transfer }); gainOnly.commit();
  const changed = prepare.prepare(paths.map((path, i) => ({ ...path, direction: i === 1 ? 20 : path.direction })));
  assert.deepEqual(changed.message.updates.map(x => x.index), [1]);
  changed.cancel();
  const retry = prepare.prepare(paths);
  assert.equal(retry.message.baseStateId, null); assert.equal(retry.message.stateId, 3);
  assert.deepEqual(retry.message.updates[0].bank.kernels, received.updates[0].bank.kernels);
  prepare.requestFull(); retry.commit();
  const afterRequest = prepare.prepare(paths); assert.equal(afterRequest.message.baseStateId, null);
  afterRequest.cancel(); prepare.clear();
});

test('sparse immutable banks equal the all-flat final PCM through layout changes, fades, seek and resync', () => {
  const { hrir } = convolutionFixture(), bankControl = createCinemaKernelBankPreparer(hrir);
  const oracle = createProcessor(3, 1), actual = createProcessor(3, 1);
  const bytes = readFileSync(new URL('../public/cinema-audio/cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin', import.meta.url));
  const hrirBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const filterA = cinemaPropagationImpulse({ bandDb: [-.1, -.2, -.4, -.8, -1.6, -3.2], screenCrossings: 1 }, 256);
  const filterB = cinemaPropagationImpulse({ bandDb: [-.2, -.4, -.8, -1.6, -3.2, -6.4], screenCrossings: 2 }, 256);
  const feed = (target, start) => send(target.processor, { type: 'enqueue', startSample: start,
    channels: [Float32Array.from({ length: 8192 }, (_, n) => .03 * Math.sin(n * .137) + .02 * Math.cos(n * .23))],
    routing: new Float32Array([.6, .5, .4]) });
  for (const target of [oracle, actual]) {
    send(target.processor, { type: 'hrtf', buffer: hrirBuffer });
    send(target.processor, { type: 'pose', spatial: new Float32Array([37,37,.7,.7,.1,1,12,38,38,.7,.7,.1,1,13,39,39,.7,.7,.1,1,14]), reflections: [] });
    feed(target, 0); send(target.processor, { type: 'playing', active: true });
  }
  let paths = [0, 1, 2].map((speaker, i) => ({ speaker, delaySamples: 37.25 + i, direction: 12 + i, gain: .5, send: .1, filter: filterA }));
  for (let block = 0; block < 48; block++) {
    if ([0,3,4,5,9,10,11,12,18,19,24,25,30].includes(block)) {
      if (block === 3) paths = paths.map((path, i) => ({ ...path, direction: i === 1 ? 20 : path.direction }));
      if (block === 4 || block === 19) paths = paths.map(path => ({ ...path, gain: .2 + block / 100 }));
      if (block === 5) paths = paths.slice().reverse();
      if (block === 9) paths = paths.slice(0, 2);
      if (block === 10) paths = paths.map(path => ({ ...path, delaySamples: 23999.5, filter: filterB }));
      if (block === 11) paths = paths.map(path => ({ ...path, direction: 15, send: .02 }));
      if (block === 12) paths = [{ speaker: 0, delaySamples: 37.25, direction: 12, gain: .7, send: .2, filter: filterA }];
      if (block === 24) bankControl.requestFull();
      const submission = bankControl.prepare(paths), message = structuredClone(submission.message, { transfer: submission.transfer });
      send(actual.processor, message); submission.commit();
      const latest = actual.processor.convolver.latestBankState;
      send(oracle.processor, { type: 'filters', packet: { ...flattenKernelBanks(latest.banks, latest.gains), kernelId: message.stateId } });
    }
    if (block === 16) for (const target of [oracle, actual]) {
      send(target.processor, { type: 'seek', sample: 5000, generation: 7 }); feed(target, 5000);
      send(target.processor, { type: 'playing', active: true });
    }
    if (block === 22) {
      const before = actual.processor.convolver.latestBankState;
      send(actual.processor, { type: 'bank-state', stateId: 999, baseStateId: -1, pathCount: 1, gains: new Float32Array([1,0]), updates: [] });
      send(actual.processor, { type: 'bank-state', stateId: 1000, baseStateId: -1, pathCount: 1, gains: new Float32Array([1,0]), updates: [] });
      assert.equal(actual.processor.convolver.latestBankState, before);
      assert.equal(actual.statuses.filter(x => x.type === 'bank-resync').length, 1);
    }
    const count = [128, 64, 17, 111][block % 4];
    const a = [new Float32Array(count), new Float32Array(count)], b = [new Float32Array(count), new Float32Array(count)];
    oracle.processor.process([], [a]); actual.processor.process([], [b]);
    assert.deepEqual(b, a);
    for (let bus = 0; bus < 3; bus++) assert.deepEqual(actual.processor.convolver.currentOutput[bus], oracle.processor.convolver.currentOutput[bus]);
    assert.equal(actual.processor.playhead, oracle.processor.playhead);
    assert.equal(actual.processor.convolver.fade, oracle.processor.convolver.fade);
    assert.equal(actual.processor.convolver.pending?.kernelId, oracle.processor.convolver.pending?.kernelId);
  }
  assert.deepEqual(actual.statuses.filter(x => x.type === 'status'), oracle.statuses.filter(x => x.type === 'status'));
  send(actual.processor, { type: 'dispose' });
  assert.equal(actual.processor.convolver.latestBankState, null);
  send(actual.processor, { type: 'bank-state', stateId: 9999, baseStateId: null, pathCount: 0, gains: new Float32Array(), updates: [] });
  assert.equal(actual.processor.convolver.current, null);
});


test('banked maximum-delay FIR survives source wrap and rejects incomplete or invalid state updates', () => {
  const { Constructor, hrir } = convolutionFixture(), builder = createCinemaKernelBankPreparer(hrir);
  const filter = cinemaPropagationImpulse({ bandDb: [-.1, -.2, -.4, -.8, -1.6, -3.2], screenCrossings: 2 }, 512);
  const submission = builder.prepare([{ speaker: 0, delaySamples: 23999.5, direction: 15, gain: .6, send: .2, filter }]);
  const message = structuredClone(submission.message, { transfer: submission.transfer }); submission.commit();
  const banked = new Constructor(1), flat = new Constructor(1);
  assert.equal(banked.setBankState(message), true);
  flat.setPacket(flattenKernelBanks(banked.latestBankState.banks, banked.latestBankState.gains));
  const rings = [new Float32Array(32768)];
  for (let start = 0; start < 60000; start += 128) {
    const end = start + 128;
    for (let n = start; n < end; n++) rings[0][n & 32767] = n === 32760 ? .25 : 0;
    const a = banked.render(rings, end & 32767, end), b = flat.render(rings, end & 32767, end);
    assert.deepEqual(a, b);
  }
  const before = banked.latestBankState, active = banked.current, fade = banked.fade;
  banked.setGains(banked.latestKernelId, new Float32Array(banked.current.gains.length).fill(1));
  assert.equal(banked.current, active); assert.equal(banked.latestBankState, before); assert.equal(banked.fade, fade);
  const bad = { type: 'bank-state', stateId: 2, baseStateId: null, pathCount: 1, gains: new Float32Array([1,0]), updates: [] };
  assert.equal(banked.setBankState(bad), false);
  assert.equal(banked.setBankState({ ...bad, updates: [{ index: 0, bank: { ...message.updates[0].bank, lags: new Uint16Array([255]) } }] }), false);
  assert.equal(banked.setBankState({ ...bad, gains: new Float32Array([NaN,0]), updates: message.updates }), false);
  assert.equal(banked.latestBankState, before);
  banked.reset(); rings[0].fill(0); assert.ok(banked.render(rings, 128, 128).every(bus => bus.every(v => v === 0)));
});


test('paired real input spectra preserve DFT values, silent mates, unequal amplitudes and wrapped windows', () => {
  const { Constructor } = convolutionFixture(), convolver = new Constructor(3);
  const rings = Array.from({ length: 3 }, () => new Float32Array(32768));
  for (const end of [1024, 40000]) {
    for (let n = Math.max(0, end - 32768); n < end; n++) {
      rings[0][n & 32767] = .1 * Math.sin(n * .173) + .03 * Math.cos(n * .319);
      rings[1][n & 32767] = end === 1024 ? 0 : 1e-9 * Math.sin(n * .217);
      rings[2][n & 32767] = .07 * Math.cos(n * .117);
    }
    convolver.reset();
    for (const [speaker, lag] of [[0,2],[1,3],[2,2]]) {
      const at = end - lag * 128, offset = convolver.analyze(speaker, lag, rings, end & 32767, end);
      const history = convolver.history[speaker];
      for (let bin = 0; bin <= 128; bin++) {
        let re = 0, im = 0;
        for (let i = 0; i < 256; i++) {
          const sample = rings[speaker][(at - 256 + i) & 32767], phase = 2 * Math.PI * bin * i / 256;
          re += sample * Math.cos(phase); im -= sample * Math.sin(phase);
        }
        assert.ok(Math.abs(history[offset + bin * 2] - re) < 1e-6);
        assert.ok(Math.abs(history[offset + bin * 2 + 1] - im) < 1e-6);
        if (speaker === 1 && end === 1024) assert.ok(Math.hypot(history[offset + bin * 2], history[offset + bin * 2 + 1]) < 1e-13);
      }
      if (speaker < 2) {
        const slot = ((Math.floor(at / 128) % 256) + 256) % 256;
        assert.equal(convolver.tags[0][slot], at); assert.equal(convolver.tags[1][slot], at);
      }
    }
  }
});


test('32 unit object shapes keep per-sample power while programme dB follows its own PCM clock', () => {
  const objectCount = 32, inputs = objectCount + 1, speakers = 4, frames = 129;
  const { processor } = createProcessor(speakers, inputs);
  const start = new Float32Array(speakers * inputs), end = new Float32Array(start.length);
  const dbStart = new Float64Array(objectCount), dbEnd = new Float64Array(objectCount);
  for (let object = 0; object < objectCount; object++) {
    const a = .1 + object * .01, b = .2 + object * .007, input = object + 1;
    start[input] = Math.cos(a); start[inputs + input] = Math.sin(a);
    end[2 * inputs + input] = Math.cos(b); end[3 * inputs + input] = Math.sin(b);
    dbStart[object] = object === 0 ? -1000 : -12; dbEnd[object] = object === 0 ? 0 : -3;
  }
  const channels = Array.from({ length: inputs }, () => new Float32Array(frames));
  send(processor, { type: 'enqueue', startSample: 1000, channels, objectInputStart: 1,
    routingSegments: [{ length: frames, start, end, objectGainDbStart: dbStart, objectGainDbEnd: dbEnd }] });
  const chunk = processor.queue[0], scratch = processor.objectScales;
  for (let object = 0; object < objectCount; object++) {
    channels[object + 1].fill(1);
    for (const frame of [0, 32, 64, 96, 128]) {
      processor.playhead = 1000 + frame; processor.sampleFromChunk(chunk);
      const fraction = frame / 128, linear = Array.from({ length: speakers }, (_, speaker) =>
        start[speaker * inputs + object + 1] * (1 - fraction) + end[speaker * inputs + object + 1] * fraction);
      const energy = linear.reduce((sum, value) => sum + value * value, 0);
      const amplitude = 10 ** ((dbStart[object] * (1 - fraction) + dbEnd[object] * fraction) / 20);
      for (let speaker = 0; speaker < speakers; speaker++) {
        const expected = Math.fround(linear[speaker] / Math.sqrt(energy) * amplitude);
        assert.ok(Math.abs(processor.speakerValues[speaker] - expected) < 1e-7);
      }
      assert.equal(processor.objectScales, scratch, 'Per-sample normalization reuses constructor scratch');
      if (amplitude > 1e-20) {
        const actualPower = processor.speakerValues.reduce((sum, value) => sum + value * value, 0);
        assert.ok(Math.abs(actualPower / (amplitude * amplitude) - 1) < 2e-6);
      }
    }
    channels[object + 1].fill(0);
  }
});

test('legacy absent metadata, inactive objects, overflow and bed/LFE retain separate ownership', () => {
  const create = metadata => {
    const target = createProcessor(3, 2), p = target.processor; p.lfeIndex = 0;
    const start = new Float32Array([0,1,0,0,Math.sqrt(10),0]);
    const end = new Float32Array([0,0,0,1,Math.sqrt(10),0]);
    const segment = { length: 5, start, end, ...metadata };
    send(p, { type: 'enqueue', startSample: 0, channels: [new Float32Array(5).fill(.1), new Float32Array(5).fill(1)],
      routingSegments: [segment], ...(metadata ? { objectInputStart: 1 } : {}) });
    return target;
  };
  const legacy = create(), normalized = create({ objectGainDbStart: new Float64Array([0]), objectGainDbEnd: new Float64Array([0]) });
  for (let sample = 0; sample < 5; sample++) {
    for (const x of [legacy, normalized]) { x.processor.playhead = sample; x.processor.sampleFromChunk(x.processor.queue[0]); }
    assert.equal(normalized.processor.speakerValues[2], legacy.processor.speakerValues[2], 'Bed LFE complete gain is unchanged');
  }
  legacy.processor.playhead = 2; legacy.processor.sampleFromChunk(legacy.processor.queue[0]);
  assert.equal(legacy.processor.speakerValues[0], .5); assert.equal(legacy.processor.speakerValues[1], .5);
  normalized.processor.playhead = 2; normalized.processor.sampleFromChunk(normalized.processor.queue[0]);
  assert.ok(Math.abs(normalized.processor.speakerValues[0] - Math.SQRT1_2) < 1e-7);
  for (const db of [10000, 6000]) {
    const overflowing = create({ objectGainDbStart: new Float64Array([db]), objectGainDbEnd: new Float64Array([db]) });
    overflowing.processor.sampleFromChunk(overflowing.processor.queue[0]);
    assert.equal(overflowing.processor.speakerValues[0], 0); assert.equal(overflowing.processor.speakerValues[1], 0);
    assert.ok(overflowing.processor.speakerValues[2] > 0, 'Double/Float32 overflow silences the object without muting the bed');
    send(overflowing.processor, { type: 'playing', active: true });
    const output = [new Float32Array(128), new Float32Array(128)];
    overflowing.processor.process([], [output]);
    assert.ok(output.every(ear => ear.every(Number.isFinite)));
    assert.ok(overflowing.processor.speakerRings.every(ring => ring.every(Number.isFinite)));
  }
  const extreme = create({ objectGainDbStart: new Float64Array([-1e308]), objectGainDbEnd: new Float64Array([1e308]) });
  extreme.processor.playhead = 2; extreme.processor.sampleFromChunk(extreme.processor.queue[0]);
  assert.ok(Math.abs(extreme.processor.speakerValues[0] - Math.SQRT1_2) < 1e-7);
  assert.ok(extreme.processor.speakerValues.every(Number.isFinite), 'Finite raw dB endpoints can have an overflowing difference');
  const inactive = createProcessor(3, 1).processor;
  send(inactive, { type: 'enqueue', startSample: 0, channels: [new Float32Array(5).fill(1)], objectInputStart: 0,
    routingSegments: [{ length: 5, start: new Float32Array(3), end: new Float32Array(3),
      objectGainDbStart: new Float64Array([0]), objectGainDbEnd: new Float64Array([0]) }] });
  inactive.playhead = 2; inactive.sampleFromChunk(inactive.queue[0]); assert.ok(inactive.speakerValues.every(value => value === 0));
  const activation = createProcessor(2, 1).processor;
  send(activation, { type: 'enqueue', startSample: 0, channels: [new Float32Array(5).fill(1)], objectInputStart: 0,
    routingSegments: [{ length: 5, start: new Float32Array([0,0]), end: new Float32Array([1,0]),
      objectGainDbStart: new Float64Array([0]), objectGainDbEnd: new Float64Array([0]) }] });
  activation.playhead = 1; activation.sampleFromChunk(activation.queue[0]); assert.equal(activation.speakerValues[0], .25);
  const invalid = createProcessor().processor;
  send(invalid, { type: 'enqueue', startSample: 0, channels: [new Float32Array(5)], objectInputStart: 0,
    routingSegments: [{ length: 5, start: new Float32Array([1]), end: new Float32Array([1]),
      objectGainDbStart: new Float64Array([NaN]), objectGainDbEnd: new Float64Array([0]) }] });
  assert.equal(invalid.queue.length, 0);
});


async function moduleParityRoom(program, t) {
  const nativeFetch = globalThis.fetch, NativeNode = globalThis.AudioWorkletNode;
  t.after(() => { globalThis.fetch = nativeFetch; globalThis.AudioWorkletNode = NativeNode; });
  const bytes = readFileSync(new URL('../public/cinema-audio/cinema-hrtf-kemar-48k-144tap-symmetric.i16le.bin', import.meta.url));
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const messages = [], outgoing = [], statuses = [];
  let Implementation, scope, node, moduleSource;
  class WorkletBase { constructor() { this.port = { onmessage: null, postMessage: message => outgoing.push(message) }; } }
  const context = { sampleRate: 48000, currentTime: 0, audioWorklet: { async addModule(url) {
    moduleSource = await (await nativeFetch(url)).text();
    scope = { currentFrame: 0, currentTime: 0, sampleRate: 48000, Float32Array, Float64Array, Uint16Array,
      Uint8Array, Uint32Array, ArrayBuffer, DataView, AudioWorkletProcessor: WorkletBase,
      registerProcessor(_name, value) { Implementation = value; } };
    runInNewContext(moduleSource, scope, { filename: 'generated-cinema-module.js' });
  } } };
  globalThis.AudioWorkletNode = class {
    constructor(_context, _name, options) {
      node = this; this.processor = new Implementation(options); this.closed = false;
      this.port = { onmessage: null, close: () => { this.closed = true; }, postMessage: (message, transfer = []) => {
        const received = structuredClone(message, { transfer }); messages.push(received); this.processor.port.onmessage({ data: received });
      } };
    }
    connect() {} disconnect() {}
  };
  const room = await createCinemaRoomAudio(context, {}, program);
  function flush() { while (outgoing.length) { const data = outgoing.shift(); statuses.push(data);
    if (!node.closed) node.port.onmessage?.({ data }); } }
  function step(count = 128) { scope.currentTime = context.currentTime; scope.currentFrame = Math.round(context.currentTime * 48000);
    const output = [new Float32Array(count), new Float32Array(count)], alive = node.processor.process([], [output]);
    context.currentTime += count / 48000; flush(); return { output, alive }; }
  return { room, context, messages, statuses, flush, step, get processor() { return node.processor; }, moduleSource };
}

function expandPackedRouting(packet, inputs, speakers) {
  const segments = []; let offset = 0;
  for (let index = 0; index < packet.segmentCount; index++) {
    const start = new Float32Array(inputs * speakers), end = new Float32Array(start.length);
    for (let speaker = 0; speaker < speakers; speaker++) {
      const base = index * (speakers + 1) + speaker;
      for (let route = packet.offsets[base]; route < packet.offsets[base + 1]; route++) {
        const at = speaker * inputs + packet.indices[route]; start[at] = packet.startValues[route]; end[at] = packet.endValues[route];
      }
    }
    const objects = inputs - packet.objectInputStart, at = index * objects, length = packet.lengths[index];
    segments.push({ offset, length, start, end,
      objectGainDbStart: packet.objectGainDbStart.subarray(at, at + objects),
      objectGainDbEnd: packet.objectGainDbEnd.subarray(at, at + objects) });
    offset += length;
  }
  return segments;
}

function keyDb(keys, sample) {
  if (sample <= keys[0].sample) return keys[0].gainDb;
  for (let i = 1; i < keys.length; i++) if (sample <= keys[i].sample) {
    const fraction = (sample - keys[i - 1].sample) / (keys[i].sample - keys[i - 1].sample);
    return keys[i - 1].gainDb * (1 - fraction) + keys[i].gainDb * fraction;
  }
  return keys.at(-1).gainDb;
}

test('RoomAudio splits routing at object keys and transfers raw dB on the absolute PCM timeline', async t => {
  const program = { bed: ['L', 'LFE'], lfeGainDb: 10, objects: Array.from({ length: 32 }, (_, i) => ({ keys: [
    { sample: 0, position: [-8 + i % 8, 8, 10 + i % 4], gainDb: i === 0 ? -1000 : -12 },
    { sample: 37 + i, position: [-4 + i % 8, 10, 18 + i % 4], gainDb: -3 },
    { sample: 95 + i * 2, position: [3 + i % 8, 12, 25 + i % 4], gainDb: -18 },
    { sample: 3000 + i, position: [5 + i % 8, 9, 35 + i % 4], gainDb: -6 },
  ] })) };
  const h = await moduleParityRoom(program, t), start = -16, frames = 4096;
  const channels = Array.from({ length: 34 }, (_, i) => new Float32Array(frames).fill(i < 2 ? 0 : .001 * (i - 1)));
  const invalid = Array.from({ length: 34 }, () => new Float32Array(1));
  assert.throws(() => h.room.enqueue(1e20, invalid), /safe integers/);
  assert.ok(invalid.every(channel => channel.byteLength > 0));
  h.room.enqueue(start, channels); assert.ok(channels.every(channel => channel.byteLength === 0));
  const message = h.messages.find(message => message.type === 'enqueue');
  assert.ok(message.packedRouting instanceof ArrayBuffer);
  const packet = { ...message, routingSegments: expandPackedRouting(h.processor.queue[0].packed, 34, 57) };
  assert.equal(h.processor.queue[0].packed.objectInputStart, 2);
  let offset = 0; const boundaries = new Set();
  for (const segment of packet.routingSegments) {
    assert.equal(segment.offset, offset); assert.ok(segment.length >= 1 && segment.length <= 2400);
    boundaries.add(start + offset);
    for (let object = 0; object < 32; object++) {
      assert.ok(Math.abs(segment.objectGainDbStart[object] - keyDb(program.objects[object].keys, start + offset)) < 1e-10);
      assert.ok(Math.abs(segment.objectGainDbEnd[object] - keyDb(program.objects[object].keys, start + offset + segment.length - 1)) < 1e-10);
    }
    offset += segment.length;
  }
  assert.equal(offset, frames); assert.equal(packet.routingSegments[0].objectGainDbStart[0], -1000);
  for (const object of program.objects) for (const key of object.keys) if (key.sample > start && key.sample < start + frames) assert.ok(boundaries.has(key.sample));
  const chunk = h.processor.queue[0];
  for (const sample of [0, 15, 16, 52, 100, 190, 2500, 4095, 0]) {
    h.processor.playhead = start + sample; h.processor.sampleFromChunk(chunk);
    const segment = packet.routingSegments.find(s => sample >= s.offset && sample < s.offset + s.length);
    const fraction = segment.length > 1 ? (sample - segment.offset) / (segment.length - 1) : 0;
    const expected = new Float64Array(57);
    for (let object = 0; object < 32; object++) {
      const vector = Array.from({ length: 57 }, (_, speaker) => segment.start[speaker * 34 + object + 2] * (1 - fraction)
        + segment.end[speaker * 34 + object + 2] * fraction);
      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      const gain = 10 ** (keyDb(program.objects[object].keys, start + sample) / 20);
      for (let speaker = 0; speaker < 57; speaker++) expected[speaker] += Math.fround(norm > 0 ? vector[speaker] / norm * gain : 0) * packet.channels[object + 2][sample];
    }
    for (let speaker = 0; speaker < 57; speaker++) assert.ok(Math.abs(h.processor.speakerValues[speaker] - Math.fround(expected[speaker])) < 1e-7);
  }
  h.room.dispose();
});

test('generated module consumes C05 envelopes with C06 banks and preserves playback lifecycle', async t => {
  const program = { bed: ['L','R','C','LFE','Ls','Rs','Bsl','Bsr','Ltf','Rtf','Ltr','Rtr'], lfeGainDb: 0,
    objects: Array.from({ length: 32 }, (_, i) => ({ keys: [
      { sample: 0, position: [-10 + i % 15, 7 + i % 3, 8 + i % 12 * 3], gainDb: i === 0 ? -1000 : -18 },
      { sample: 60 + i * 7, position: [-5 + i % 13, 12, 18 + i % 8 * 3], gainDb: -6 },
      { sample: 3500 + i, position: [5 - i % 13, 15, 44 - i % 7 * 3], gainDb: -12 },
    ] })) };
  const h = await moduleParityRoom(program, t);
  assert.ok(h.moduleSource.includes('setBankState') && h.moduleSource.includes('objectGainDbStart'));
  const pcm = () => Array.from({ length: 44 }, (_, channel) => Float32Array.from({ length: 8192 }, (_, n) => .003 * Math.sin((173 + channel * 37) * 2 * Math.PI * n / 48000)));
  h.room.enqueue(0, pcm()); h.room.setPlaying(true); h.flush(); let peak = 0;
  for (let i = 0; i < 44; i++) { const result = h.step(); assert.equal(result.alive, true);
    for (const ear of result.output) for (const value of ear) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); } }
  assert.ok(peak > 1e-8); assert.equal(h.processor.playhead, 44 * 128);
  h.room.setPlaying(false); h.flush(); const paused = h.processor.playhead;
  for (let i = 0; i < 4; i++) assert.ok(h.step().output.every(ear => ear.every(value => value === 0)));
  assert.equal(h.processor.playhead, paused); assert.equal(h.room.status().sample, paused);
  h.room.seek(1000); h.flush(); assert.equal(h.room.status().sample, 1000);
  h.room.enqueue(1000, pcm()); h.room.setPlaying(true); h.flush();
  assert.ok(h.step().output.every(ear => ear.every(value => value === 0)), 'Seek clears delay, room and gain state before new arrivals');
  assert.equal(h.processor.playhead, 1128);
  for (let i = 0; i < 24; i++) h.step();
  assert.ok(!h.messages.some(message => message.type === 'filter-gains'), 'Programme dB never uses spatial/legacy gain messages');
  assert.equal(h.processor.underruns, 0);
  h.room.dispose(); assert.equal(h.step().alive, false);
  const count = h.messages.length, after = pcm(); h.room.enqueue(0, after); h.room.setPlaying(true); h.room.seek(0);
  assert.equal(h.messages.length, count); assert.ok(after.every(channel => channel.byteLength > 0));
});

test('calibration is applied once by the routing shape and never again by the processor', async t => {
  const original = CINEMA_RENDER_SPEAKERS.map(speaker => speaker.gain);
  t.after(() => CINEMA_RENDER_SPEAKERS.forEach((speaker, i) => { speaker.gain = original[i]; }));
  const program = { bed: [], lfeGainDb: 0, objects: [{ keys: [{ sample: 0, position: [-7,8,4], gainDb: -6 }] }] };
  const baseline = createCinemaRoutingShapes(program, 0, new Float32Array(57), new Float64Array(1));
  CINEMA_RENDER_SPEAKERS.forEach((speaker, i) => { speaker.gain = 1 + i % 5 * .5; });
  const expected = Array.from(baseline, (value, i) => value * CINEMA_RENDER_SPEAKERS[i].gain);
  const norm = Math.sqrt(expected.reduce((sum, value) => sum + value * value, 0));
  const h = await moduleParityRoom(program, t); h.room.enqueue(0, [new Float32Array(8).fill(1)]);
  h.processor.sampleFromChunk(h.processor.queue[0]);
  for (let speaker = 0; speaker < 57; speaker++) assert.ok(Math.abs(h.processor.speakerValues[speaker]
    - expected[speaker] / norm * 10 ** (-6 / 20)) < 1e-6);
  h.room.dispose();
});
