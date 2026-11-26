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
const { CINEMA_RENDER_SPEAKERS, createCinemaRouting } =
  await import('../src/coast/world/cinema/cinemaSpeakers.ts');
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
