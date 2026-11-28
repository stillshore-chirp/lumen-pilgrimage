import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const src = new URL('../src/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { CINEMA_RENDER_SPEAKERS, createCinemaRouting, createCinemaRoutingShapes } =
  await import('../src/coast/world/cinema/cinemaSpeakers.ts');
const { createCinemaObjectRouter } = await import('../src/coast/world/cinema/cinemaObjectRouting.ts');
hook.deregister();

const counts = kind => CINEMA_RENDER_SPEAKERS.filter(speaker => speaker.kind === kind).length;
const indexOf = id => CINEMA_RENDER_SPEAKERS.findIndex(speaker => speaker.id === id);

function column(matrix, inputCount, inputIndex) {
  return CINEMA_RENDER_SPEAKERS.map((_, speakerIndex) => matrix[speakerIndex * inputCount + inputIndex]);
}

function activeSpeakers(matrix, inputCount, inputIndex) {
  return CINEMA_RENDER_SPEAKERS.filter((_, speakerIndex) =>
    Math.abs(matrix[speakerIndex * inputCount + inputIndex]) > 1e-7);
}

function energy(values) {
  return values.reduce((sum, value) => sum + value * value, 0);
}

test('cinema render table has the 57 documented positions and normalized aims', () => {
  assert.deepEqual(
    ['screen', 'side', 'rear', 'top', 'screenSub', 'surroundSub'].map(counts),
    [5, 20, 12, 16, 2, 2],
  );
  assert.equal(new Set(CINEMA_RENDER_SPEAKERS.map(speaker => speaker.id)).size, 57);
  for (const speaker of CINEMA_RENDER_SPEAKERS) {
    const length = Math.hypot(...speaker.aim);
    assert.ok(Math.abs(length - 1) < 1e-12, `${speaker.id}: aim length ${length}`);
    assert.ok(Number.isSafeInteger(speaker.delaySamples) && speaker.delaySamples >= 0);
    if (speaker.kind !== 'screen') assert.equal(speaker.delaySamples, 0);
    assert.equal(speaker.gain, 1);
  }
  assert.deepEqual(CINEMA_RENDER_SPEAKERS.slice(0, 5).map(({ position }) => position), [
    [-13.31, 12.6125, -1.4], [-6.655, 12.6125, -1.4], [0, 12.6125, -1.4],
    [6.655, 12.6125, -1.4], [13.31, 12.6125, -1.4],
  ]);
  assert.deepEqual(CINEMA_RENDER_SPEAKERS.slice(-4).map(({ position }) => position), [
    [-4, 1, -1.4], [4, 1, -1.4], [-13, 11, 53], [13, 11, 53],
  ]);
});

test('screen channels reach the R11 reference at the same modeled sample', () => {
  const arrivals = CINEMA_RENDER_SPEAKERS
    .filter(({ kind }) => kind === 'screen')
    .map(({ position: [x, y, z], delaySamples }) =>
      Math.hypot(x, y - 5, z - 35.85) * 48_000 / 343 + delaySamples);
  assert.ok(Math.max(...arrivals) - Math.min(...arrivals) < 1);
  const center = CINEMA_RENDER_SPEAKERS[indexOf('screen-C')];
  assert.ok(Math.abs(center.delaySamples / 48 - 6.6) < .1);
});

test('bed routing follows mono, stereo, 5.1, 7.1, 7.1.4 and LC/RC layouts', () => {
  const mono = { bed: ['L'], lfeGainDb: 0, objects: [] };
  const monoMatrix = createCinemaRouting(mono, 0);
  assert.deepEqual(activeSpeakers(monoMatrix, 1, 0).map(({ id }) => id), ['screen-C']);
  assert.equal(energy(column(monoMatrix, 1, 0)), 1);

  const stereo = { bed: ['L', 'R'], lfeGainDb: 0, objects: [] };
  const stereoMatrix = createCinemaRouting(stereo, 0);
  assert.deepEqual(activeSpeakers(stereoMatrix, 2, 0).map(({ id }) => id), ['screen-L']);
  assert.deepEqual(activeSpeakers(stereoMatrix, 2, 1).map(({ id }) => id), ['screen-R']);

  const fiveOne = { bed: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'], lfeGainDb: 0, objects: [] };
  const fiveOneMatrix = createCinemaRouting(fiveOne, 0);
  for (let input = 0; input < fiveOne.bed.length; input += 1) {
    assert.ok(Math.abs(energy(column(fiveOneMatrix, fiveOne.bed.length, input)) - 1) < 1e-6);
  }
  assert.ok(activeSpeakers(fiveOneMatrix, 6, 3).every(({ kind }) => kind === 'screenSub'));
  assert.ok(activeSpeakers(fiveOneMatrix, 6, 4).every(({ kind, position }) =>
    (kind === 'side' || kind === 'rear') && position[0] < 0));
  assert.ok(activeSpeakers(fiveOneMatrix, 6, 5).every(({ kind, position }) =>
    (kind === 'side' || kind === 'rear') && position[0] > 0));

  const sevenOne = { bed: [...fiveOne.bed, 'Bsl', 'Bsr'], lfeGainDb: 0, objects: [] };
  const sevenOneMatrix = createCinemaRouting(sevenOne, 0);
  assert.ok(activeSpeakers(sevenOneMatrix, 8, 6).every(({ kind, position }) => kind === 'rear' && position[0] < 0));
  assert.ok(activeSpeakers(sevenOneMatrix, 8, 7).every(({ kind, position }) => kind === 'rear' && position[0] > 0));

  const sevenOneFour = { bed: [...sevenOne.bed, 'Ltf', 'Rtf', 'Ltr', 'Rtr'], lfeGainDb: 0, objects: [] };
  const sevenOneFourMatrix = createCinemaRouting(sevenOneFour, 0);
  const topInput = sevenOneFour.bed.length - 4;
  assert.ok(activeSpeakers(sevenOneFourMatrix, 12, topInput).every(({ kind, position }) =>
    kind === 'top' && position[0] < 0 && position[2] <= 32));
  assert.ok(activeSpeakers(sevenOneFourMatrix, 12, topInput + 1).every(({ kind, position }) =>
    kind === 'top' && position[0] > 0 && position[2] <= 32));
  assert.ok(activeSpeakers(sevenOneFourMatrix, 12, topInput + 2).every(({ kind, position }) =>
    kind === 'top' && position[0] < 0 && position[2] > 32));
  assert.ok(activeSpeakers(sevenOneFourMatrix, 12, topInput + 3).every(({ kind, position }) =>
    kind === 'top' && position[0] > 0 && position[2] > 32));
  const wide = { bed: ['LC', 'RC'], lfeGainDb: 0, objects: [] };
  const wideMatrix = createCinemaRouting(wide, 0);
  assert.deepEqual(activeSpeakers(wideMatrix, 2, 0).map(({ id }) => id), ['screen-LC']);
  assert.deepEqual(activeSpeakers(wideMatrix, 2, 1).map(({ id }) => id), ['screen-RC']);
});

test('LFE gain and object interpolation preserve independent input energy', () => {
  const program = {
    bed: ['LFE'],
    lfeGainDb: 10,
    objects: [{
      keys: [
        { sample: 0, position: [-13.31, 12.6125, -1.4], gainDb: 0 },
        { sample: 480, position: [13.31, 12.6125, -1.4], gainDb: 0 },
      ],
    }],
  };
  const atStart = createCinemaRouting(program, 0);
  const atMiddle = createCinemaRouting(program, 240);
  const inputCount = 2;
  assert.deepEqual(activeSpeakers(atStart, inputCount, 0).map(({ id }) => id), ['screen-sub-L', 'screen-sub-R']);
  assert.ok(Math.abs(energy(column(atStart, inputCount, 0)) - 10) < 1e-5);
  assert.deepEqual(activeSpeakers(atStart, inputCount, 1).map(({ id }) => id), ['screen-L']);
  assert.deepEqual(activeSpeakers(atMiddle, inputCount, 1).map(({ id }) => id), ['screen-C']);
  assert.ok(Math.abs(energy(column(atMiddle, inputCount, 1)) - 1) < 1e-6);
  const between = createCinemaRouting({
    bed: [], lfeGainDb: 0,
    objects: [{ keys: [{ sample: 0, position: [-9.9825, 12.6125, -1.4], gainDb: 0 }] }],
  }, 0);
  assert.deepEqual(activeSpeakers(between, 1, 0).map(({ id }) => id), ['screen-L', 'screen-LC']);
  assert.ok(Math.abs(energy(column(between, 1, 0)) - 1) < 1e-6);

  const target = new Float32Array(120);
  target.fill(1);
  const reused = createCinemaRouting({ bed: ['L'], lfeGainDb: 0, objects: [] }, 0, target);
  assert.strictEqual(reused, target);
  assert.equal(reused[indexOf('screen-C')], 1);
  assert.equal(reused[indexOf('screen-R')], 0);
  assert.equal(reused[119], 0);
});

function objectProgram(position, gainDb = 0) {
  return { bed: [], lfeGainDb: 0, objects: [{ keys: [{ sample: 0, position, gainDb }] }] };
}

function difference(a, b) {
  return Math.hypot(...a.map((value, index) => value - b[index]));
}

test('object role interiors retain their original groups and never feed LFE outputs', () => {
  for (const [position, kind] of [
    [[-7, 8, 3], 'screen'], [[5, 8, 30], 'side'],
    [[4, 8, 49], 'rear'], [[-3, 16, 30], 'top'],
  ]) {
    const matrix = createCinemaRouting(objectProgram(position), 0);
    assert.ok(activeSpeakers(matrix, 1, 0).every(speaker => speaker.kind === kind));
    assert.ok(Math.abs(energy(matrix) - 1) < 2e-7);
    assert.deepEqual([...matrix.slice(-4)], [0, 0, 0, 0]);
  }
  // The retained role rule takes priority here; it is not a universal nearest
  // physical speaker renderer at the rearmost side station (z=49).
  const lastSide = CINEMA_RENDER_SPEAKERS.find(speaker => speaker.id === 'side-L-10');
  const routed = createCinemaRouting(objectProgram(lastSide.position), 0);
  assert.ok(activeSpeakers(routed, 1, 0).every(speaker => speaker.kind === 'rear'));
});

test('object routing is continuous at category intersections, stations and the centre line', () => {
  const points = [
    [0, 14, 5], [0, 14, 47], [0, 14, 30], [0, 8, 5], [0, 8, 47],
    ...[13, 15].flatMap(y => [4, 6, 46, 48].map(z => [0, y, z])),
    ...CINEMA_RENDER_SPEAKERS.filter(speaker =>
      ['screen', 'rear', 'side', 'top'].includes(speaker.kind)).map(speaker => speaker.position),
  ];
  for (const point of points) {
    for (const axis of [0, 1, 2]) {
      for (const epsilon of [1e-3, 1e-6]) {
        const before = [...point];
        const after = [...point];
        before[axis] -= epsilon;
        after[axis] += epsilon;
        const a = createCinemaRouting(objectProgram(before), 0);
        const b = createCinemaRouting(objectProgram(after), 0);
        assert.ok(difference(a, b) < epsilon * 4,
          `${point} axis ${axis}: coefficient step ${difference(a, b)}`);
      }
    }
  }
});

test('dense auditorium and outer-envelope routing retains finite unit power and local support', () => {
  let probes = 0;
  for (let x = -22; x <= 22; x += 2) {
    for (let y = -1; y <= 25; y += 2) {
      for (let z = -5; z <= 57; z += 2) {
        const matrix = createCinemaRouting(objectProgram([x, y, z]), 0);
        assert.ok(matrix.every(Number.isFinite));
        assert.ok(Math.abs(energy(matrix) - 1) < 3e-7, `${x}/${y}/${z}`);
        assert.ok(activeSpeakers(matrix, 1, 0).length <= 10);
        assert.deepEqual([...matrix.slice(-4)], [0, 0, 0, 0]);
        probes += 1;
      }
    }
  }
  assert.equal(probes, 10304);
});

test('calibration belongs to the unit spatial shape once, including non-unity and inactive profiles', () => {
  const modified = CINEMA_RENDER_SPEAKERS.map(speaker => ({ ...speaker,
    gain: speaker.id === 'screen-LC' ? 2 : 1,
  }));
  const router = createCinemaObjectRouter(modified);
  const output = new Float64Array(57);
  assert.equal(router.write(-9.9825, 8, 0, output), true);
  assert.ok(Math.abs(output[indexOf('screen-L')] - Math.sqrt(.2)) < 1e-12);
  assert.ok(Math.abs(output[indexOf('screen-LC')] - Math.sqrt(.8)) < 1e-12);
  assert.ok(Math.abs(energy(output) - 1) < 1e-12);
  const uniform = createCinemaObjectRouter(CINEMA_RENDER_SPEAKERS.map(speaker => ({ ...speaker, gain: 2 })));
  const normal = createCinemaObjectRouter(CINEMA_RENDER_SPEAKERS);
  const a = new Float64Array(57);
  const b = new Float64Array(57);
  for (const position of [[1, 14, 5], [7, 8, 35], [-5, 16, 47]]) {
    uniform.write(...position, a);
    normal.write(...position, b);
    assert.ok(difference(a, b) < 1e-12);
  }
  const muted = createCinemaObjectRouter(CINEMA_RENDER_SPEAKERS.map(speaker => ({ ...speaker, gain: 0 })));
  assert.equal(muted.write(0, 14, 47, output), false);
  assert.ok(output.every(value => value === 0));
});

test('routing validates actual straight paired-bank geometry before use', () => {
  const copy = () => CINEMA_RENDER_SPEAKERS.map(speaker => ({ ...speaker, position: [...speaker.position] }));
  for (const mutate of [
    table => { table[indexOf('side-L-02')].position[0] -= .01; },
    table => { table[indexOf('side-L-02')].position[1] += .01; },
    table => { table[indexOf('top-R-02')].position[1] += .01; },
    table => { table[indexOf('top-R-02')].position[2] = table[indexOf('top-R-01')].position[2]; },
    table => { table.splice(indexOf('side-R-10'), 1); },
  ]) {
    const table = copy();
    mutate(table);
    assert.throws(() => createCinemaObjectRouter(table), /Cinema/);
  }
});

test('object column writes preserve adjacent inputs and fail closed for invalid coordinates', () => {
  const router = createCinemaObjectRouter(CINEMA_RENDER_SPEAKERS);
  const output = new Float64Array(57 * 3).fill(7);
  assert.equal(router.write(0, 14, 5, output, 3, 1), true);
  for (let speaker = 0; speaker < 57; speaker += 1) {
    assert.equal(output[speaker * 3], 7);
    assert.equal(output[speaker * 3 + 2], 7);
  }
  assert.equal(router.write(NaN, 14, 5, output, 3, 1), false);
  assert.ok(column(output, 3, 1).every(value => value === 0));
  assert.throws(() => router.write(0, 0, 0, output, 3, 3), RangeError);
  assert.throws(() => router.write(0, 0, 0, new Float32Array(56)), RangeError);
});

test('separate Float64 dB metadata retains extreme programme curves without changing bed/LFE', () => {
  const program = { bed: ['LFE'], lfeGainDb: 10, objects: [
    { keys: [
      { sample: 0, position: [0, 8, 0], gainDb: -1000 },
      { sample: 100, position: [0, 8, 0], gainDb: 0 },
    ] },
    { keys: [{ sample: 0, position: [0, 8, 0], gainDb: 10000 }] },
    { keys: [] },
  ] };
  const matrix = new Float32Array(57 * 4);
  const gainDb = new Float64Array(3);
  for (const sample of [0, 25, 50, 100]) {
    assert.strictEqual(createCinemaRoutingShapes(program, sample, matrix, gainDb), matrix);
    assert.deepEqual([...gainDb], [-1000 + 10 * sample, 10000, 0]);
    assert.ok(Math.abs(energy(column(matrix, 4, 0)) - 10) < 1e-5);
    assert.equal(energy(column(matrix, 4, 1)), 1);
    assert.equal(energy(column(matrix, 4, 2)), 1);
    assert.equal(energy(column(matrix, 4, 3)), 0);
    const complete = createCinemaRouting(program, sample);
    assert.equal(energy(column(complete, 4, 2)), 0); // Legacy non-finite amplitude handling.
    assert.deepEqual(column(matrix, 4, 0), column(complete, 4, 0));
    const amplitude = 10 ** (gainDb[0] / 20);
    assert.equal(complete[indexOf('screen-C') * 4 + 1], Math.fround(amplitude));
  }
  createCinemaRoutingShapes(program, NaN, matrix, gainDb);
  assert.ok(matrix.every(value => value === 0));
  assert.ok(gainDb.every(value => value === 0));
  assert.throws(() => createCinemaRoutingShapes(program, 0, matrix, new Float64Array(2)), RangeError);
});

test('binary key lookup preserves exact keys, held endpoints and interpolated dB for long tracks', () => {
  const keys = Array.from({ length: 100000 }, (_, sample) => ({
    sample: sample * 4, position: [sample % 2 ? 6.655 : -6.655, 8, 0], gainDb: -sample / 100,
  }));
  const program = { bed: [], lfeGainDb: 0, objects: [{ keys }] };
  const shape = new Float32Array(57);
  const gainDb = new Float64Array(1);
  for (const sample of [-1, 0, 1, 4, 12345, 200002, 399995, 399996, 400000]) {
    const clamped = Math.max(0, Math.min(399996, sample));
    createCinemaRoutingShapes(program, sample, shape, gainDb);
    assert.ok(Math.abs(gainDb[0] + clamped / 400) < 1e-12);
    assert.ok(Math.abs(energy(shape) - 1) < 2e-7);
    if (clamped % 4 === 0) {
      assert.deepEqual(activeSpeakers(shape, 1, 0).map(speaker => speaker.id),
        [clamped / 4 % 2 ? 'screen-RC' : 'screen-LC']);
    }
  }
});
