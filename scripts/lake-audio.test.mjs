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
const { LAKE_DESTINATIONS, LAKE_GLAZING, LAKE_HALL, LAKE_SIDE_VENTS, LAKE_TATAMI, LAKE_WATER_Y } =
  await import('../src/coast/world/lake/lakeLayout.ts');
hooks.deregister();

const [hall, westWindow, eastWindow] = LAKE_DESTINATIONS.map(({ x, z }) => ({ x, y: 1.65, z }));
const westWater = { x: westWindow.x, y: LAKE_WATER_Y, z: LAKE_HALL.frontZ - 9.2 };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const totalGain = paths => paths.reduce((gain, path) => gain + path.gain, 0);

test('the nearest water remains directional and quiet through the closed facade', () => {
  const [glass, nearestVent] = lakeSoundPaths(westWindow, westWater);
  const near = totalGain(lakeSoundPaths(westWindow, westWater));
  const center = totalGain(lakeSoundPaths(hall, westWater));
  const across = totalGain(lakeSoundPaths(eastWindow, westWater));
  const unobstructedGain = 4 / (4 + distance(westWindow, westWater));
  assert.deepEqual({ x: glass.x, y: glass.y, z: glass.z }, westWater);
  assert.ok(glass.gain > nearestVent.gain && glass.cutoff < nearestVent.cutoff);
  assert.ok(near < unobstructedGain * 0.2);
  assert.ok(near > center * 2 && center > across);
});

test('each narrow louver has a fixed direction and a delay from its own detour', () => {
  const [direct, west, east] = lakeSoundPaths(hall, westWater);
  assert.equal(west.x, -LAKE_SIDE_VENTS.x);
  assert.equal(east.x, LAKE_SIDE_VENTS.x);
  const directLength = distance(hall, westWater);
  for (const vent of [west, east]) {
    assert.equal(vent.y, LAKE_SIDE_VENTS.y);
    assert.equal(vent.z, LAKE_SIDE_VENTS.z);
    const excess = distance(hall, vent) + distance(westWater, vent) - directLength;
    assert.ok(vent.delay > 0 && Math.abs(vent.delay - excess / 343) < 1e-9);
  }
  assert.equal(direct.delay, 0);
  assert.ok(west.delay < east.delay);
  assert.ok(west.gain > east.gain && east.gain > 0);
  assert.ok(west.cutoff > east.cutoff);
});

test('the glazing edge fades to a solid facade with no increase at the old threshold', () => {
  const z = LAKE_HALL.frontZ + 1;
  const fraction = (LAKE_HALL.frontZ - z) / (westWater.z - z);
  const edgeX = (-LAKE_GLAZING.halfWidth - westWater.x * fraction) / (1 - fraction);
  const left = lakeSoundPaths({ x: edgeX - 0.005, y: 1.65, z }, westWater);
  const right = lakeSoundPaths({ x: edgeX + 0.005, y: 1.65, z }, westWater);
  assert.ok(Math.abs(left[0].gain - right[0].gain) < 0.002);
  assert.ok(Math.abs(left[0].cutoff - right[0].cutoff) / left[0].cutoff < 0.05);

  const [throughWall] = lakeSoundPaths({ x: -LAKE_SIDE_VENTS.x, y: 1.65, z: LAKE_HALL.frontZ + 0.015 }, westWater);
  const [throughGlass] = lakeSoundPaths(westWindow, westWater);
  assert.ok(throughWall.gain < throughGlass.gain * 0.35 && throughWall.cutoff < throughGlass.cutoff * 0.55);

  const atFacade = dz => lakeSoundPaths({ ...westWindow, z: LAKE_HALL.frontZ + dz }, westWater);
  assert.ok(Math.abs(totalGain(atFacade(-0.005)) - totalGain(atFacade(0.005))) < 0.002);
});

test('the tatami and indoor wood border select the finishes used for footsteps', () => {
  assert.equal(lakeSurfaceAt(hall.x, hall.z), 'tatami');
  assert.equal(lakeSurfaceAt(0, LAKE_TATAMI.frontZ - 0.1), 'wood');
  assert.equal(lakeSurfaceAt(LAKE_TATAMI.halfWidth + 0.1, hall.z), 'wood');
  assert.equal(lakeSurfaceAt(0, LAKE_TATAMI.rearZ + 0.1), 'wood');
  for (const { x, z } of [westWindow, eastWindow]) {
    assert.equal(lakeSurfaceAt(x, z), 'wood');
    assert.equal(lakeSurfaceAt(x, LAKE_HALL.frontZ - 0.01), undefined);
  }
});
