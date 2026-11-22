import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import {
  COAST_BOUNDS, COAST_FALLS, COAST_WALKS, SEA_LEVEL, SPAWN, coastPlantingDistance, groundHeight, shoreline,
} from '../src/coast/terrain.ts';

const acousticsUrl = new URL('../src/coast/coastAcoustics.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const path = specifier === './terrain' && context.parentURL === acousticsUrl ? './terrain.ts' : specifier;
    return nextResolve(path, context);
  },
});
const { airCutoff, soundReach, terrainOcclusion, waterReflection } = await import(acousticsUrl);
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

test('both trails reach a high lookout and the east trail skirts shallow tidal pools', () => {
  for (const { points, overlook } of COAST_WALKS) {
    assert.deepEqual(points.at(0), points.at(-1));
    assert.ok(points.some(point => Math.hypot(point.x - overlook.x, point.z - overlook.z) < 0.5));
    assert.ok(groundHeight(overlook.x, overlook.z) > SEA_LEVEL + 30);
    assert.ok(points.every(p => groundHeight(p.x, p.z) > SEA_LEVEL + 1.4));
    const direction = Math.atan2(overlook.towardZ - overlook.z, overlook.towardX - overlook.x);
    for (const distance of [4, 15, 30, 54]) {
      assert.equal(coastPlantingDistance(overlook.x + distance * Math.cos(direction),
        overlook.z + distance * Math.sin(direction)), 0);
    }
  }
  for (const [x, z] of [[48.5, 31.7], [52.6, 21.4]]) {
    const floor = groundHeight(x, z);
    assert.ok(floor > SEA_LEVEL - 1 && floor < SEA_LEVEL - 0.23);
  }
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

test('the waterfall range reaches the beach and air removes more treble with distance', () => {
  const main = COAST_FALLS[0];
  const source = main.path[Math.round((main.path.length - 1) * 0.65)];
  const fromBeach = Math.hypot(source.x - SPAWN.x, source.y - 3.6, source.z - SPAWN.z);
  assert.ok(fromBeach > 240 && soundReach(fromBeach, 840) > 0.9);
  assert.ok(airCutoff(fromBeach) < airCutoff(70));
  assert.equal(soundReach(840, 840), 0);
});
