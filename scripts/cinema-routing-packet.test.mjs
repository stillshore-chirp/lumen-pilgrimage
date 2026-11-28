import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const src = new URL('../src/', import.meta.url).href;
const hook = registerHooks({ resolve(s, c, next) {
  return next(c.parentURL?.startsWith(src) && s.startsWith('.') && !s.endsWith('.ts') ? `${s}.ts` : s, c);
} });
const { createCinemaRoutingPacket, CINEMA_ROUTING_PACKET_PROCESSOR_SOURCE } =
  await import('../src/coast/world/cinema/cinemaRoutingPacket.ts');
const { CINEMA_ROOM_PROCESSOR_SOURCE } = await import('../src/coast/world/cinema/cinemaRoomProcessor.ts');
const { createCinemaRoutingShapes, createCinemaRouting } = await import('../src/coast/world/cinema/cinemaSpeakers.ts');
const { prepareCinemaConvolution } = await import('../src/coast/world/cinema/cinemaConvolution.ts');
hook.deregister();
const decode = new Function(`${CINEMA_ROUTING_PACKET_PROCESSOR_SOURCE};return decodeCinemaRoutingPacket;`)();

function processor(inputs) {
  let Implementation; const messages = [];
  class Base { constructor() { this.port = { postMessage: value => messages.push(value) }; } }
  new Function('registerProcessor', 'AudioWorkletProcessor', 'currentFrame', 'currentTime', CINEMA_ROOM_PROCESSOR_SOURCE)(
    (_name, value) => { Implementation = value; }, Base, 0, 0);
  const value = new Implementation({ processorOptions: { speakerCount: 57, inputCount: inputs,
    kinds: [...Array(53).fill(0),1,1,2,2], lfeIndex: 3, lfeGain: 1 } });
  return { value, messages, send: data => value.port.onmessage({ data }) };
}

// Dense reference deliberately discovers all key boundaries with a sorted set.
// Production uses one binary cursor per object and two reusable matrix planes.
function denseSegments(program, start, frames) {
  const boundaries = [...new Set(program.objects.flatMap(o => o.keys.map(k => k.sample)))].sort((a,b) => a-b);
  const result = []; let offset = 0;
  while (offset < frames) {
    const sample = start + offset, nextKey = boundaries.find(key => key > sample) ?? Infinity;
    const end = Math.min(start + frames, sample + 2400, nextKey), length = end - sample;
    const firstDb = new Float64Array(program.objects.length), lastDb = new Float64Array(firstDb.length);
    const first = createCinemaRoutingShapes(program, sample, new Float32Array(57 * (program.bed.length + program.objects.length)), firstDb);
    const last = createCinemaRoutingShapes(program, end - 1, new Float32Array(first.length), lastDb);
    result.push({ offset, length, start: first, end: last, objectGainDbStart: firstDb, objectGainDbEnd: lastDb });
    offset += length;
  }
  return result;
}

const programme = () => ({ bed: ['L','R','C','LFE','Ls','Rs','Bsl','Bsr','Ltf','Rtf','Ltr','Rtr'],
  lfeGainDb: 0, objects: Array.from({ length: 32 }, (_, i) => ({ keys: [
    { sample: 0, position: [-10 + i % 15, 8 + i % 6, 10 + i % 11 * 3], gainDb: i === 0 ? -1000 : i === 1 ? -1e308 : i === 2 ? 6000 : -18 },
    { sample: 40 + i, position: [5 - i % 13, 10, 19 + i % 8 * 3], gainDb: i === 1 ? 1e308 : i === 2 ? 6000 : -3 },
    { sample: 6000 + i * 7, position: [5 - i % 9, 14, 42 - i % 7 * 3], gainDb: -12 },
  ] })) });

test('packed main routing is bit exact with dense sparse conversion at all samples and key boundaries', () => {
  const program = programme(), inputs = 44, start = -16, frames = 8193;
  const dense = processor(inputs), packed = processor(inputs);
  const channels = Array.from({ length: inputs }, (_, input) => Float32Array.from({ length: frames }, (_, n) =>
    .003 * Math.sin(n * (.019 + input * .002))));
  dense.send({ type: 'enqueue', startSample: start, channels, routingSegments: denseSegments(program, start, frames), objectInputStart: 12 });
  const buffer = createCinemaRoutingPacket(program, start, frames), original = new Uint8Array(buffer).slice();
  const packet = structuredClone({ type: 'enqueue', startSample: start, channels, packedRouting: buffer }, { transfer: [buffer] });
  assert.equal(buffer.byteLength, 0); assert.ok(channels.every(c => c.byteLength > 0));
  packed.send(packet); const a = dense.value.queue[0], b = packed.value.queue[0];
  assert.equal(b.packed.segmentCount, a.segments.length);
  assert.deepEqual(new Uint8Array(b.packed.buffer), original);
  for (let n = 0; n < frames; n++) {
    dense.value.playhead = packed.value.playhead = start + n;
    dense.value.sampleFromChunk(a); packed.value.sampleFromChunk(b);
    assert.deepEqual(packed.value.speakerValues, dense.value.speakerValues);
  }
  for (const n of [0, 500, frames - 1, 30]) {
    dense.value.playhead = packed.value.playhead = start + n;
    dense.value.sampleFromChunk(a); packed.value.sampleFromChunk(b);
    assert.deepEqual(packed.value.speakerValues, dense.value.speakerValues);
  }
  assert.ok(packed.value.speakerValues.every(Number.isFinite));
});

test('packed views validate bounds and cache sentinels before mutating a valid queue', () => {
  const program = programme(), inputs = 44, frames = 240;
  const good = createCinemaRoutingPacket(program, 0, frames), views = decode(good, 57, inputs, frames);
  assert.ok(views); const target = processor(inputs), channels = Array.from({ length: inputs }, () => new Float32Array(frames));
  target.send({ type: 'enqueue', startSample: 0, channels, packedRouting: good });
  const initial = target.value.queue[0];
  const corruptions = [
    h => h.setUint32(4, 2, true), h => h.setUint32(8, frames + 1, true),
    h => h.setUint32(12, 0xffffffff, true), h => h.setUint32(16, inputs + 1, true),
    h => h.setUint32(20, 56, true), h => h.setUint32(24, 0xffffffff, true),
    h => h.setFloat64(32, frames + 1, true), h => h.setFloat64(40, Infinity, true),
    h => h.setUint32(views.lengths.byteOffset, 0, true), h => h.setUint32(views.lengths.byteOffset, 2401, true),
    h => h.setUint32(views.offsets.byteOffset, 1, true),
    h => h.setUint32(views.offsets.byteOffset + 4, 0xffffffff, true),
    h => h.setUint16(views.indices.byteOffset, inputs, true),
    h => h.setFloat32(views.startValues.byteOffset, NaN, true),
    h => h.setFloat64(views.objectGainDbStart.byteOffset, Infinity, true),
    h => h.setFloat64(views.normStart.byteOffset, -1, true),
    h => h.setFloat64(views.constantAmplitude.byteOffset, -2, true),
    h => h.setFloat64(views.inverseNorm.byteOffset, -2, true),
  ];
  for (const change of corruptions) {
    const bad = good.slice(0); change(new DataView(bad));
    assert.equal(decode(bad, 57, inputs, frames), null);
    target.send({ type: 'enqueue', startSample: 0, channels, packedRouting: bad });
    assert.equal(target.value.queue.length, 1); assert.equal(target.value.queue[0], initial);
    assert.equal(target.messages.at(-1).type, 'error');
  }
  for (const bad of [new ArrayBuffer(0), good.slice(0, 47), good.slice(0, -1)]) assert.equal(decode(bad, 57, inputs, frames), null);
  for (const mixed of [{ routingSegments: [] }, { objectInputStart: 12 }, { routing: new Float32Array(57 * inputs) }]) {
    const clock = target.value.playhead, errors = target.messages.length;
    target.send({ type: 'enqueue', startSample: 0, channels, packedRouting: good, ...mixed });
    assert.equal(target.value.queue.length, 1); assert.equal(target.value.queue[0], initial);
    assert.equal(target.value.playhead, clock); assert.equal(target.messages.length, errors + 1);
    assert.equal(target.messages.at(-1).type, 'error');
  }
});

test('packet storage is independent of later scratch use, with one-sample, inactive and bed-only frames', () => {
  for (const program of [programme(), { bed: ['L'], objects: [], lfeGainDb: 0 },
    { bed: [], objects: [{ keys: [] }], lfeGainDb: 0 }]) {
    const inputs = program.bed.length + program.objects.length;
    for (const frames of [1, 3, 2401]) {
      const first = createCinemaRoutingPacket(program, -1, frames), saved = new Uint8Array(first).slice();
      createCinemaRoutingPacket(program, 10000, frames);
      assert.deepEqual(new Uint8Array(first), saved);
      const decoded = decode(first, 57, inputs, frames); assert.ok(decoded);
      assert.equal(decoded.lengths.reduce((sum, length) => sum + length, 0), frames);
    }
  }
  assert.throws(() => createCinemaRoutingPacket(programme(), 1e20, 1), RangeError);
});

test('Float32 mix overflow stops and resets before state writes for packed and legacy routing', () => {
  const make = db => ({ bed: [], lfeGainDb: 0, objects: Array.from({ length: 32 }, () => ({
    keys: [{ sample: 0, position: [0,8,0], gainDb: db }],
  })) });
  const enqueue = (target, packed, db, start = 0, amplitude = 0x7fffff / 0x800000) => {
    const program = make(db), channels = Array.from({ length: 32 }, () => new Float32Array(2).fill(amplitude));
    target.send({ type: 'enqueue', startSample: start, channels, ...(packed
      ? { packedRouting: createCinemaRoutingPacket(program, start, 2) }
      : { routing: createCinemaRouting(program, start) }) });
  };
  for (const packed of [false, true]) for (const banked of [false, true]) {
    const target = processor(32), p = target.value; p.lfeIndex = -1;
    if (banked) {
      const hrir = new Float32Array(60 * 144 * 2); hrir[12 * 288] = hrir[12 * 288 + 1] = 1;
      p.hrtf = hrir;
      p.convolver.setPacket(prepareCinemaConvolution(hrir, [{ speaker: 2, delaySamples: 0, direction: 12, gain: 1, send: 0 }]));
    }
    enqueue(target, packed, 760); target.send({ type: 'playing', active: true });
    const output = [new Float32Array(2), new Float32Array(2)];
    assert.equal(p.process([], [output]), true);
    assert.ok(output.every(ear => ear.every(value => value === 0)));
    assert.equal(p.mixRangeError, true); assert.equal(p.playing, false); assert.equal(p.playhead, 0);
    assert.equal(p.queue.length, 0); assert.equal(p.underruns, 0);
    assert.ok(p.speakerValues.every(value => value === 0) && p.lowpass.every(value => value === 0));
    assert.ok(p.speakerRings.every(ring => ring.every(value => value === 0)));
    assert.equal(target.messages.filter(message => message.type === 'error').length, 1);
    enqueue(target, packed, -18, 0, .001); target.send({ type: 'playing', active: true });
    p.process([], [output]); assert.equal(p.playing, false); assert.equal(p.queue.length, 0);
    assert.equal(target.messages.filter(message => message.type === 'error').length, 1);
    target.send({ type: 'seek', sample: 16, generation: 1 });
    assert.equal(p.mixRangeError, false); enqueue(target, packed, -18, 16, .001);
    target.send({ type: 'playing', active: true }); p.process([], [output]);
    assert.equal(p.playhead, 18); assert.equal(p.playing, true);
    assert.ok(output.every(ear => ear.every(Number.isFinite)));
    target.send({ type: 'dispose' }); assert.equal(p.process([], [output]), false);
    target.send({ type: 'seek', sample: 0 }); assert.equal(p.disposed, true);
  }
});


test('finite distributed bass values cannot overflow a subwoofer Float32 ring', () => {
  const target = processor(32), p = target.value;
  // A finite steady low-pass state is reachable from a sustained finite input.
  // No individual speaker exceeds Float32; only the common bass sum does.
  p.speakerValues.fill(1e38, 0, 32); p.lowpass.fill(1e38, 0, 32);
  assert.ok(p.speakerValues.every(Number.isFinite) && p.lowpass.every(Number.isFinite));
  p.playing = true; p.writeSpeakerRings();
  assert.equal(p.mixRangeError, true); assert.equal(p.playing, false);
  assert.ok(p.speakerValues.every(v => v === 0) && p.lowpass.every(v => v === 0));
  assert.ok(p.speakerRings.every(ring => ring.every(v => v === 0)));
  assert.equal(target.messages.filter(message => message.type === 'error').length, 1);
  target.send({ type: 'seek', sample: 0 }); p.speakerValues[0] = .01;
  p.writeSpeakerRings(); assert.equal(p.mixRangeError, false);
  assert.ok(p.speakerRings.every(ring => Number.isFinite(ring[p.writeIndex])));
});
