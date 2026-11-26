import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';

const source = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(source)
      && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const [{ buildLakeStoneRing }, { LAKE_TERRAIN, LAKE_WATER_Y }, { addLakeBank }, { PlantSurface }] = await Promise.all([
  import('../src/coast/world/lake/lakeBasinStone.ts'),
  import('../src/coast/world/lake/lakeLayout.ts'),
  import('../src/coast/world/lake/lakeBasin.ts'),
  import('../src/coast/world/coastTreeMeshes.ts'),
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

test('both banks carry a continuous profile from submerged toe into the inland slope beside the hall', () => {
  const material = new MeshStandardMaterial();
  const ray = new Raycaster(undefined, new Vector3(0, -1, 0));
  try {
    for (const side of [-1, 1]) {
      const surface = new PlantSurface();
      addLakeBank(surface, side);
      const mesh = new Mesh(surface.geometry(), material);
      try {
        for (const distance of [8, 14, 20, 26, 32, 39, 48, 63]) {
          const heightAt = x => {
            ray.ray.origin.set(side * x, 50, -distance);
            return ray.intersectObject(mesh, false)[0]?.point.y;
          };
          const profile = Array.from({ length: 55 }, (_, index) => heightAt(20 + index));
          const waterline = profile.findIndex(y => y > LAKE_WATER_Y);
          const location = `bank ${side}, ${distance} m down the lake`;
          assert.ok(waterline >= 4 && waterline <= 27, `${location}: the shore leaves the cove open`);
          assert.ok(profile[waterline - 4] < LAKE_WATER_Y - 0.5, `${location}: the toe continues underwater`);
          const exposed = profile.slice(waterline, waterline + 12);
          assert.ok(exposed.every(y => y > LAKE_WATER_Y), `${location}: the ground rises without gaps`);
          const toe = profile.slice(waterline - 4, waterline + 4);
          assert.ok(toe.every((y, i) => i === 0 || (y > toe[i - 1] && y - toe[i - 1] < 0.65)),
            `${location}: the grade stays shallow through the waterline`);
          assert.ok(profile.at(-1) > LAKE_WATER_Y + 6, `${location}: the shoreline connects to higher ground`);
        }
      } finally {
        mesh.geometry.dispose();
      }
    }
  } finally {
    material.dispose();
  }
});
