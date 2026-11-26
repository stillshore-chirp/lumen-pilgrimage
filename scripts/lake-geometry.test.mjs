import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Group, MeshStandardMaterial } from 'three';

const source = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(source)
      && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const [{ buildLakeStoneRing }, { LAKE_TERRAIN }] = await Promise.all([
  import('../src/coast/world/lake/lakeBasinStone.ts'),
  import('../src/coast/world/lake/lakeLayout.ts'),
]);
hooks.deregister();

test('the outer radius of the stone ring stays consistent through its lower arc', () => {
  const group = new Group();
  const material = new MeshStandardMaterial();
  buildLakeStoneRing(group, material);
  const { geometry } = group.children[0];
  try {
    const outerRadii = new Float64Array(32);
    const vertices = geometry.getAttribute('position');
    for (let index = 0; index < vertices.count; index += 1) {
      const x = vertices.getX(index);
      const y = vertices.getY(index) - LAKE_TERRAIN.ringCenterY;
      const angle = Math.atan2(y, x) + Math.PI;
      const bin = Math.floor(angle * outerRadii.length / (2 * Math.PI)) % outerRadii.length;
      outerRadii[bin] = Math.max(outerRadii[bin], Math.hypot(x, y));
    }
    const shortest = Math.min(...outerRadii);
    const longest = Math.max(...outerRadii);
    // Weathering and the slight angle to the lake change the projected radius by a few metres.
    assert.ok(shortest > 0 && longest / shortest < 1.08, `projected outer radii: ${shortest}–${longest} m`);
  } finally {
    geometry.dispose();
    material.dispose();
  }
});
