import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { test } from 'node:test';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !extname(specifier);
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { lakeSoundPaths, lakeSurfaceAt } = await import('../src/coast/world/lake/lakeAudioAcoustics.ts');
const { LAKE_DESTINATIONS, LAKE_GLAZING, LAKE_HALL, LAKE_TATAMI, LAKE_VERANDA, LAKE_WATER_Y } =
  await import('../src/coast/world/lake/lakeLayout.ts');
hooks.deregister();

const [hall, westVeranda, eastVeranda] = LAKE_DESTINATIONS.map(({ x, z }) => ({ x, y: 1.65, z }));
const westWater = {
  x: -(LAKE_VERANDA.insideX + LAKE_VERANDA.outsideX) / 2, y: LAKE_WATER_Y, z: LAKE_VERANDA.endZ - 1.5,
};
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('the same water source is quieter and darker through the glass than from the veranda', () => {
  const [glass, west, east] = lakeSoundPaths(hall, westWater);
  const [open, openWest, openEast] = lakeSoundPaths(westVeranda, westWater);
  const [across] = lakeSoundPaths(eastVeranda, westWater);
  assert.ok(glass.gain > 0 && glass.cutoff < open.cutoff * 0.2);
  assert.ok(open.gain > (glass.gain + west.gain + east.gain) * 3);
  assert.ok(across.gain < open.gain * 0.4);
  assert.equal(openWest.gain, 0);
  assert.equal(openEast.gain, 0);
});

test('each opening has its own direction, excess travel time and high-frequency loss', () => {
  const [direct, west, east] = lakeSoundPaths(hall, westWater);
  assert.ok(west.x < hall.x && east.x > hall.x);
  const directLength = distance(hall, westWater);
  for (const opening of [west, east]) {
    assert.equal(opening.z, LAKE_HALL.frontZ);
    assert.ok(Math.abs(opening.x) >= LAKE_GLAZING.halfWidth && Math.abs(opening.x) <= LAKE_HALL.halfWidth);
    const excess = distance(hall, opening) + distance(westWater, opening) - directLength;
    assert.ok(opening.delay > 0 && Math.abs(opening.delay - excess / 343) < 1e-9);
  }
  assert.equal(direct.delay, 0);
  assert.ok(west.delay < east.delay);
  assert.ok(west.gain > east.gain && east.gain > 0);
  assert.ok(west.cutoff > east.cutoff && east.cutoff > direct.cutoff);
});

test('the glazing edge and the veranda threshold change arrival levels continuously', () => {
  const z = LAKE_HALL.frontZ + 2;
  const fraction = (LAKE_HALL.frontZ - z) / (westWater.z - z);
  const edgeX = (-LAKE_GLAZING.halfWidth - westWater.x * fraction) / (1 - fraction);
  const doorwayX = -LAKE_GLAZING.halfWidth - 0.21;
  const centralWater = { ...westWater, x: 0 };
  const comparisons = [
    [{ x: edgeX - 0.005, y: 1.65, z }, { x: edgeX + 0.005, y: 1.65, z }, westWater],
    [
      { x: doorwayX, y: 1.65, z: LAKE_HALL.frontZ - 0.005 },
      { x: doorwayX, y: 1.65, z: LAKE_HALL.frontZ + 0.005 },
      centralWater,
    ],
  ];
  for (const [before, after, source] of comparisons) {
    const a = lakeSoundPaths(before, source);
    const b = lakeSoundPaths(after, source);
    for (const [index, arrival] of a.entries()) {
      assert.ok(Math.abs(arrival.gain - b[index].gain) < 0.01);
    }
    assert.ok(Math.abs(a[0].cutoff - b[0].cutoff) / a[0].cutoff < 0.05);
  }
});

test('the tatami edges and boardwalk select the finishes used for footsteps', () => {
  assert.equal(lakeSurfaceAt(hall.x, hall.z), 'tatami');
  assert.equal(lakeSurfaceAt(0, LAKE_TATAMI.frontZ - 0.1), 'wood');
  assert.equal(lakeSurfaceAt(LAKE_TATAMI.halfWidth + 0.1, hall.z), 'wood');
  assert.equal(lakeSurfaceAt(0, LAKE_TATAMI.rearZ + 0.1), 'wood');
  assert.equal(lakeSurfaceAt(westVeranda.x, westVeranda.z), 'wood');
  assert.equal(lakeSurfaceAt(eastVeranda.x, eastVeranda.z), 'wood');
  assert.equal(lakeSurfaceAt(0, westVeranda.z), undefined);
});
