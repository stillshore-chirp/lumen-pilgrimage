import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import {
  COAST_BOUNDS, COAST_FALLS, COAST_WALKS, FOREST_STREAM, FOREST_WALKS, SEA_LEVEL, SPAWN,
  coastBedrock, coastPlantingDistance, coastTreadWear, forestStreamLevel, groundHeight, shoreline,
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

test('both coast circuits now follow low limestone beside the bay before climbing to overlooks', () => {
  for (const [walk, x, z] of [[COAST_WALKS[0], -61, 0], [COAST_WALKS[1], 77, -26]]) {
    const shore = walk.points.find(point => Math.hypot(point.x - x, point.z - z) < 0.07);
    assert.ok(shore && groundHeight(shore.x, shore.z) < 3.3);
    assert.ok(coastTreadWear(shore.x, shore.z) > 0.8);
    assert.ok(groundHeight(x + (x < 0 ? 18 : -18), z) < SEA_LEVEL,
      'the low bench must face water on the bay side');
  }
  assert.ok(coastBedrock(-38, 159) > 0.9 && coastBedrock(48, 253) > 0.9);
  assert.equal(coastBedrock(SPAWN.x, SPAWN.z), 0);
});

test('the worn tread stays continuous off the center of bends in the ravine and on the ascent', () => {
  for (const [x, z] of [[-60.9333, 308.4256], [-35.36, 381.96]]) {
    assert.ok(coastTreadWear(x, z) > 0.45);
    const origin = groundHeight(x, z);
    for (let i = 0; i < 16; i += 1) {
      const angle = i * Math.PI / 8;
      const step = 0.052;
      const next = groundHeight(x + Math.cos(angle) * step, z + Math.sin(angle) * step);
      assert.ok(Math.abs(next - origin) < 0.039, `an invisible step remains at (${x}, ${z})`);
    }
  }
});

test('the inland paths connect the beach to distinct passages and a common high clearing', () => {
  const [approach, ravine, ford, headwater] = FOREST_WALKS.map(walk => walk.points);
  assert.ok(COAST_WALKS[0].points.some(point => Math.hypot(point.x - approach[0].x, point.z - approach[0].z) < 0.1));
  assert.deepEqual(approach.at(-1), ravine[0]);
  assert.deepEqual(ravine[0], ford[0]);
  assert.deepEqual(ravine.at(-1), ford.at(-1));
  assert.ok(ford.some(point => Math.hypot(point.x - headwater[0].x, point.z - headwater[0].z) < 0.1));
  assert.ok(ford.some(point => Math.hypot(point.x - headwater.at(-1).x, point.z - headwater.at(-1).z) < 0.1));
  assert.ok(groundHeight(-14, 392) > 49 && coastPlantingDistance(-14, 392) === 0);
  const slot = groundHeight(-63, 304);
  assert.ok(groundHeight(-73, 304) > slot + 5 && groundHeight(-52, 304) > slot + 5);
});

test('the stream falls to the inland pool, with a shallow crossable ford', () => {
  const elevations = FOREST_STREAM.slice(1, -1).map(({ x, z, y }) => {
    assert.equal(forestStreamLevel(x, z), y);
    assert.ok(groundHeight(x, z) < y, `water runs under ground at (${x}, ${z})`);
    return y;
  });
  assert.ok(elevations.every((y, index) => index === 0 || y > elevations[index - 1]));
  const fordDepth = forestStreamLevel(39, 261) - groundHeight(39, 261);
  assert.ok(fordDepth > 0.25 && fordDepth < 0.65);
  assert.equal(forestStreamLevel(39, 248), undefined);
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
