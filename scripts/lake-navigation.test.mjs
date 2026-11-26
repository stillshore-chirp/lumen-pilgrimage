import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const sourceFolder = new URL('../src/coast/world/lake/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(sourceFolder) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const [{ lakeNavigation, lakeWalkBlocked }, layout] = await Promise.all([
  import('../src/coast/world/lake/lakeNavigation.ts'),
  import('../src/coast/world/lake/lakeLayout.ts'),
]);
hooks.deregister();

function checkWalk(x0, z0, x1, z1) {
  for (let step = 0; step <= 100; step += 1) {
    const t = step / 100;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    assert.equal(lakeWalkBlocked(x, z), false, `support should be reachable at (${x}, ${z})`);
    assert.equal(lakeNavigation.groundHeight(x, z), 0);
  }
}

test('the indoor floor is continuous to both windows, under the table, and toward the rear wall', () => {
  const { x, z } = lakeNavigation.spawn;
  for (const window of layout.LAKE_DESTINATIONS.slice(1)) {
    checkWalk(x, z, window.x, z);
    checkWalk(window.x, z, window.x, window.z);
  }
  checkWalk(x, z, x, layout.LAKE_HALL.rearZ - 0.3);
  checkWalk(x, z, layout.LAKE_TABLE.x, layout.LAKE_TABLE.z - layout.LAKE_TABLE.depth);
});

test('all window bays and solid walls enclose the supported floor', () => {
  const { halfWidth, frontZ, rearZ } = layout.LAKE_HALL;
  for (let x = -halfWidth + 0.3; x < halfWidth - 0.2; x += 0.1) {
    assert.ok(lakeWalkBlocked(x, frontZ));
    assert.ok(lakeWalkBlocked(x, frontZ - 1));
    assert.ok(lakeWalkBlocked(x, rearZ));
  }
  for (const x of [-halfWidth, halfWidth]) {
    assert.ok(lakeWalkBlocked(x, 7));
  }
  assert.equal(lakeNavigation.bounds.minZ, frontZ);
  assert.equal(lakeNavigation.allowFlight, false);
});
