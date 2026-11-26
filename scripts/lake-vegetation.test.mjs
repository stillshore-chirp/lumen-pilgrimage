import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Vector3 } from 'three';

const source = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(source)
      && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { buildLakePlantSurfaces, addLakeGroundCover } = await import('../src/coast/world/lake/lakeVegetation.ts');
const { PlantSurface } = await import('../src/coast/world/coastTreeMeshes.ts');
hooks.deregister();

const specimen = { x: 0, y: 0, z: -50, height: 7, spread: 7, yaw: 0.51, seed: 90 };

test('broadleaf trees and pines keep separate foliage and produce three dimensional crowns', () => {
  for (const form of ['pine', 'broadleaf', 'sapling', 'shrub']) {
    const surfaces = buildLakePlantSurfaces([{ ...specimen, form }]);
    const geometries = Object.fromEntries(Object.entries(surfaces).map(([key, surface]) => [key, surface.geometry()]));
    try {
      const canopy = form === 'pine' ? geometries.needles : geometries.leaves;
      const other = form === 'pine' ? geometries.leaves : geometries.needles;
      assert.equal(other.getAttribute('position').count, 0, `${form}: foliage identity is not shared`);
      canopy.computeBoundingBox();
      const size = canopy.boundingBox.getSize(new Vector3());
      assert.ok(size.x > 6 && size.z > 6, `${form}: the crown extends on both world axes`);
      assert.ok(size.y > 0.6, `${form}: the crown has depth from above and below`);
      const normals = canopy.getAttribute('normal');
      const orientations = new Set();
      for (let i = 0; i < normals.count; i += 1) {
        const y = Math.abs(normals.getY(i));
        orientations.add(y > 0.9 ? 'horizontal' : y < 0.75 ? 'oblique' : 'intermediate');
      }
      assert.ok(orientations.has('horizontal') && orientations.has('oblique'), `${form}: foliage occupies multiple planes`);
      for (const geometry of Object.values(geometries)) {
        assert.ok(Array.from(geometry.getAttribute('position').array).every(Number.isFinite), `${form}: finite geometry`);
        assert.ok(Array.from(geometry.getAttribute('bladeUv').array).every(Number.isFinite), `${form}: finite UVs`);
      }
    } finally {
      for (const geometry of Object.values(geometries)) geometry.dispose();
    }
  }
});

test('the spreading broadleaf crown exposes a low fork rather than a pine leader through its crown', () => {
  const { wood, leaves, needles } = buildLakePlantSurfaces([{ ...specimen, form: 'broadleaf' }]);
  const bark = wood.geometry();
  const foliage = leaves.geometry();
  const unused = needles.geometry();
  try {
    bark.computeBoundingBox();
    foliage.computeBoundingBox();
    const top = foliage.boundingBox.max.y;
    assert.ok(bark.boundingBox.max.y < top - 0.1, 'fine branch tips remain beneath the leaf boundary');
    assert.ok(foliage.boundingBox.min.y > specimen.height * 0.35, 'the low, branching trunk is visible under the crown');
    assert.ok(foliage.boundingBox.max.x - foliage.boundingBox.min.x > top * 1.2, 'the broad crown stays wider than the tree is tall');
  } finally {
    bark.dispose(); foliage.dispose(); unused.dispose();
  }
});

test('ground cover follows inclined support and omits the submerged side of a patch', () => {
  const surface = new PlantSurface();
  const support = (x, z) => x >= 0 ? 1 + x * 0.35 + z * 0.14 : undefined;
  addLakeGroundCover(surface, [{ x: 0, z: 0, radius: 2, seed: 173 }], support);
  const geometry = surface.geometry();
  try {
    const points = geometry.getAttribute('position');
    assert.ok(points.count > 100);
    for (let i = 0; i < points.count; i += 4) {
      const x = points.getX(i);
      const z = points.getZ(i);
      assert.ok(x >= 0, 'the whole blade begins over supported ground');
      assert.ok(Math.abs(points.getY(i) - support(x, z) + 0.015) < 0.00001, 'blade bases meet the slope');
      const tipX = points.getX(i + 3);
      const tipZ = points.getZ(i + 3);
      assert.ok(tipX >= 0, 'unsupported leaf endpoints are omitted');
      const clearance = points.getY(i + 3) - support(tipX, tipZ);
      assert.ok(clearance >= 0.024 && clearance <= 0.066, 'the leaf tip follows local support height');
    }
  } finally {
    geometry.dispose();
  }
});
