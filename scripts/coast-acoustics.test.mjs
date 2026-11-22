import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { COAST_FALLS, COAST_WALKS, SEA_LEVEL, SPAWN, groundHeight } from '../src/coast/terrain.ts';

const acousticsUrl = new URL('../src/coast/coastAcoustics.ts', import.meta.url).href;
const shoreUrl = new URL('../src/coast/coastShore.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = (context.parentURL === acousticsUrl || context.parentURL === shoreUrl) && specifier.startsWith('./');
    const path = internal ? `${specifier}.ts` : specifier;
    return nextResolve(path, context);
  },
});
const { listenerTerrain, terrainArrival, terrainOcclusion } = await import(acousticsUrl);
const {
  buildShorePatches, selectShorePatches, shoreTransmission, shoreWavePoint,
  SHORE_VOICE_COUNT, SHORE_REF_DISTANCE, SHORE_ROLLOFF,
} = await import(shoreUrl);
hooks.deregister();

const shore = buildShorePatches();

function ear(x, z) {
  return { x, y: groundHeight(x, z) + 1.68, z };
}

function separation(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function firstArrival(listener, source) {
  const distance = separation(listener, source);
  return terrainArrival(listener, source, listenerTerrain(listener), distance, terrainOcclusion(listener, source));
}

test('anchored surf covers the outer coast and the west and east paths with a bounded mix', () => {
  const sites = [SPAWN, ...COAST_WALKS.map(walk => walk.overlook),
    { x: -61, z: 0 }, { x: -75, z: -34 }, { x: 71, z: -8 }, { x: 77, z: -26 }];
  const selections = sites.map(({ x, z }) => {
    const listener = ear(x, z);
    const selected = selectShorePatches(shore, listener, new Set());
    assert.equal(selected.length, SHORE_VOICE_COUNT);
    const powers = selected.map(({ crest, wash }) => {
      assert.ok(groundHeight(crest.x, crest.z) < SEA_LEVEL - 0.5);
      assert.ok(groundHeight(wash.x, wash.z) < SEA_LEVEL - 0.5);
      const distance = separation(listener, crest);
      const direct = shoreTransmission(distance, terrainOcclusion(listener, crest));
      const spread = SHORE_REF_DISTANCE / (SHORE_REF_DISTANCE + SHORE_ROLLOFF * Math.max(0, distance - SHORE_REF_DISTANCE));
      return (direct.gain * spread) ** 2;
    });
    assert.ok(Math.sqrt(powers.reduce((sum, power) => sum + power, 0)) > 0.36, `weak shore at ${x}, ${z}`);
    return selected;
  });
  assert.ok(selections[1].some(patch => patch.wash.x < -175));
  assert.ok(selections[2].some(patch => patch.wash.x > 195));
  assert.ok(!selections[4].some(patch => selections[6].includes(patch)));

  const sideways = selections[1].find(patch => Math.abs(patch.crest.x - patch.wash.x) > 3);
  assert.ok(sideways);
  assert.deepEqual(shoreWavePoint(sideways, 0.1), sideways.crest);
  assert.deepEqual(shoreWavePoint(sideways, 0.57), sideways.wash);
  assert.deepEqual(shoreWavePoint(sideways, 0.99), sideways.crest);
});

test('a passage and open sand at the same surf distance have different tone and direction', () => {
  const open = ear(43, 32);
  const sheltered = ear(92, -28);
  const patch = shore.find(({ crest }) => Math.hypot(57.37 - crest.x, -7 - crest.z) < 1.2);
  assert.ok(patch);
  const source = patch.crest;
  assert.ok(selectShorePatches(shore, sheltered, new Set()).includes(patch));
  const openDistance = separation(open, source);
  const shelteredDistance = separation(sheltered, source);
  assert.ok(Math.abs(openDistance - shelteredDistance) < 0.15);
  const bright = shoreTransmission(openDistance, terrainOcclusion(open, source));
  const shaded = shoreTransmission(shelteredDistance, terrainOcclusion(sheltered, source));
  assert.ok(shaded.cutoff < bright.cutoff * 0.22);
  assert.ok(shaded.gain > 0.38 && shaded.gain < bright.gain * 0.66);

  assert.ok((firstArrival(open, source)?.gain ?? 0) < 0.035);
  const reflection = firstArrival(sheltered, source);
  assert.ok(reflection && reflection.gain > 0.16 && reflection.delay > 0.035 && reflection.delay < 0.063);
  const sourceBearing = Math.atan2(source.z - sheltered.z, source.x - sheltered.x);
  const reflectionBearing = Math.atan2(reflection.point.z - sheltered.z, reflection.point.x - sheltered.x);
  assert.ok(Math.cos(sourceBearing - reflectionBearing) < 0, 'the reflection arrives from the opposite side of the path');
});

test('coastal rock produces a delayed directional arrival where the open shore has none', () => {
  const beach = ear(SPAWN.x, SPAWN.z);
  const passage = ear(-92, 112);
  const mainFall = COAST_FALLS[0].path;
  const source = mainFall[Math.round((mainFall.length - 1) * 0.65)];
  assert.equal(firstArrival(beach, source), undefined);
  assert.ok(listenerTerrain(passage).enclosure > 0.7);

  const arrival = firstArrival(passage, source);
  assert.ok(arrival.gain > 0.1);
  assert.ok(arrival.delay > 0.018 && arrival.delay < 0.1);
  assert.ok(Math.hypot(arrival.point.x - passage.x, arrival.point.z - passage.z) < 16);
});

test('an occluded forest call can reach the slot through its north opening', () => {
  const listener = ear(-63, 298);
  const source = { x: -45, y: groundHeight(-45, 329) + 7, z: 329 };
  assert.ok(terrainOcclusion(listener, source) > 0.45);
  assert.ok(listenerTerrain(listener).enclosure > 0.8);

  const arrival = firstArrival(listener, source);
  assert.deepEqual([arrival.point.x, arrival.point.z], [-52, 323]);
  assert.ok(arrival.gain > 0.22);
  assert.ok(arrival.cutoff <= 3_650);
  assert.ok(arrival.distance > Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z));
});

test('the canopy shades a listener under it and opens up at the vista or above the trees', () => {
  const grove = ear(-45, 246);
  assert.ok(listenerTerrain(grove).canopy > 0.9);
  assert.equal(listenerTerrain(ear(-14, 392)).canopy, 0);
  assert.equal(listenerTerrain({ ...grove, y: grove.y + 30 }).canopy, 0);
});
