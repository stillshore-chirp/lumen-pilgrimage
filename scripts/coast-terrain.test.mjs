import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COAST_BOUNDS, POOL, SEA_LEVEL, SPAWN, WATERFALL, groundHeight, shoreline } from '../src/coast/terrain.ts';

test('the coast contains a dry approach, tidal edge, and submerged seabed', () => {
  const { x, z } = SPAWN;
  assert.ok(x > COAST_BOUNDS.minX && x < COAST_BOUNDS.maxX);
  assert.ok(z > COAST_BOUNDS.minZ && z < COAST_BOUNDS.maxZ);
  assert.ok(groundHeight(x, z) > SEA_LEVEL + 1.5);
  for (let beachX = -46; beachX <= -22; beachX += 4) {
    const edge = shoreline(beachX);
    assert.ok(groundHeight(beachX, edge - 3) < SEA_LEVEL);
    assert.ok(groundHeight(beachX, edge + 3) > SEA_LEVEL);
  }
});

test('the waterfall descends a bluff into the basin with a dry rim', () => {
  const { x, y, z } = WATERFALL;
  assert.ok(Math.abs(groundHeight(x, z) - y) < 1);
  assert.ok(groundHeight(x, z + 4) < y - 16);
  assert.ok(groundHeight(POOL.x, POOL.z) < POOL.y);
  assert.ok(groundHeight(POOL.x, POOL.z + POOL.radiusZ + 3) > POOL.y);
});
