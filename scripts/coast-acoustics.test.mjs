import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { COAST_FALLS, SPAWN, groundHeight } from '../src/coast/terrain.ts';

const acousticsUrl = new URL('../src/coast/coastAcoustics.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const path = specifier === './terrain' && context.parentURL === acousticsUrl ? './terrain.ts' : specifier;
    return nextResolve(path, context);
  },
});
const { listenerTerrain, terrainArrival, terrainOcclusion } = await import(acousticsUrl);
hooks.deregister();

function ear(x, z) {
  return { x, y: groundHeight(x, z) + 1.68, z };
}

function firstArrival(listener, source) {
  const distance = Math.hypot(listener.x - source.x, listener.y - source.y, listener.z - source.z);
  return terrainArrival(listener, source, listenerTerrain(listener), distance, terrainOcclusion(listener, source));
}

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
