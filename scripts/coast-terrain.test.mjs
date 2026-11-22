import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { COAST_BOUNDS, COAST_FALLS, SEA_LEVEL, SPAWN, groundHeight, shoreline } from '../src/coast/terrain.ts';

const acousticsUrl = new URL('../src/coast/coastAcoustics.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const path = specifier === './terrain' && context.parentURL === acousticsUrl ? './terrain.ts' : specifier;
    return nextResolve(path, context);
  },
});
const { terrainOcclusion, waterReflection } = await import(acousticsUrl);
hooks.deregister();

test('the coast contains a dry approach, tidal edge, and submerged seabed', () => {
  const { x, z } = SPAWN;
  assert.ok(x > COAST_BOUNDS.minX && x < COAST_BOUNDS.maxX);
  assert.ok(z > COAST_BOUNDS.minZ && z < COAST_BOUNDS.maxZ);
  assert.ok(groundHeight(x, z) > SEA_LEVEL + 1.5);
  for (let beachX = x - 8; beachX <= x + 8; beachX += 4) {
    const edge = shoreline(beachX);
    assert.ok(groundHeight(beachX, edge - 3) < SEA_LEVEL);
    assert.ok(groundHeight(beachX, edge + 3) > SEA_LEVEL);
  }
});

test('the sandy inlet opens to sea between headlands', () => {
  for (let z = -3; z >= COAST_BOUNDS.minZ; z -= 4) {
    assert.ok(groundHeight(30, z) < SEA_LEVEL);
  }
  assert.ok(groundHeight(-180, -143) > 135);
  assert.ok(groundHeight(196, -199) > 155);
  assert.ok(groundHeight(-73, -281) > 75);
});

test('each waterfall visibly descends from its rock face to the sea', () => {
  for (const { path, impact } of COAST_FALLS) {
    assert.ok(path[0].y > 65);
    assert.ok(impact.y < SEA_LEVEL + 1);
    for (const point of path) {
      assert.ok(point.y > groundHeight(point.x, point.z), 'the waterfall clips through terrain');
    }
    assert.ok(groundHeight(impact.x, impact.z) < SEA_LEVEL);
  }
});

test('a headland occludes a low source while the open channel preserves the direct path', () => {
  assert.ok(terrainOcclusion({ x: -218, y: 10, z: -140 }, { x: -68, y: 10, z: -141 }) > 0.9);
  assert.equal(terrainOcclusion({ x: 30, y: 3, z: -15 }, { x: 30, y: 20, z: -171 }), 0);
});

test('a reflected arrival is audible over water and disappears over the dry beach', () => {
  const source = { x: -15, y: 25, z: 35 };
  const wet = waterReflection({ x: -15, y: 1, z: 55 }, source);
  const dry = waterReflection({ x: -15, y: 3.5, z: 84 }, source);
  assert.ok(wet.gain > 0.9);
  assert.ok(wet.delay > 0.009 && wet.delay < 0.15);
  assert.equal(dry.gain, 0);
});
