import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';

const src = new URL('../src/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { CINEMA_ROOM_PROCESSOR_SOURCE } =
  await import('../src/coast/world/cinema/cinemaRoomProcessor.ts');
const { cinemaHrtfDirectionIndexForPose } =
  await import('../src/coast/world/cinema/cinemaRoomAudio.ts');
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
