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

test('both side wings and their verandas are connected to the hall', () => {
  const { x, z } = lakeNavigation.spawn;
  for (const veranda of layout.LAKE_DESTINATIONS.slice(1)) {
    checkWalk(x, z, veranda.x, z);
    checkWalk(veranda.x, z, veranda.x, veranda.z);
  }
});

test('the pane, hall perimeter, veranda rails and tea table bound movement', () => {
  assert.ok(lakeWalkBlocked(0, layout.LAKE_HALL.frontZ));
  assert.ok(lakeWalkBlocked(layout.LAKE_GLAZING.halfWidth, layout.LAKE_HALL.frontZ));
  assert.equal(lakeWalkBlocked(17.5, layout.LAKE_HALL.frontZ), false);
  assert.ok(lakeWalkBlocked(-17.5, layout.LAKE_VERANDA.endZ));
  assert.ok(lakeWalkBlocked(17.5, layout.LAKE_VERANDA.endZ));
  assert.ok(lakeWalkBlocked(layout.LAKE_HALL.halfWidth, 7));
  assert.ok(lakeWalkBlocked(0, layout.LAKE_HALL.rearZ));
  assert.ok(lakeWalkBlocked(layout.LAKE_TABLE.x, layout.LAKE_TABLE.z));
  assert.equal(lakeNavigation.allowFlight, false);
});
