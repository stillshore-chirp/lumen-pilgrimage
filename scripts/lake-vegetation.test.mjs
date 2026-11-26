import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Mesh, MeshStandardMaterial, Raycaster, Vector3 } from 'three';

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
const { addLakeBank } = await import('../src/coast/world/lake/lakeBasin.ts');
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
      const position = canopy.getAttribute('position');
      const indices = canopy.getIndex();
      const projectedArea = new Vector3();
      const a = new Vector3(), b = new Vector3(), c = new Vector3();
      for (let i = 0; i < indices.count; i += 3) {
        a.fromBufferAttribute(position, indices.getX(i));
        b.fromBufferAttribute(position, indices.getX(i + 1)).sub(a);
        c.fromBufferAttribute(position, indices.getX(i + 2)).sub(a);
        b.cross(c);
        projectedArea.x += Math.abs(b.x);
        projectedArea.y += Math.abs(b.y);
        projectedArea.z += Math.abs(b.z);
      }
      assert.ok(Math.min(projectedArea.x, projectedArea.z) > projectedArea.y * 0.52,
        `${form}: foliage retains leaf area from a low viewpoint instead of collapsing into horizontal lines`);
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


test('bank vegetation support agrees with independent raycasts of the actual displayed triangles', () => {
  const material = new MeshStandardMaterial();
  const ray = new Raycaster(undefined, new Vector3(0, -1, 0));
  let checkedRoots = 0;
  try {
    for (const side of [-1, 1]) {
      const bank = new PlantSurface();
      const support = addLakeBank(bank, side);
      const mesh = new Mesh(bank.geometry(), material);
      const heightAt = (x, z) => support.heightAt(x, z);
      const rayHeight = (x, z) => {
        ray.ray.origin.set(x, 100, z);
        return ray.intersectObject(mesh, false)[0]?.point.y;
      };
      const cover = new PlantSurface();
      addLakeGroundCover(cover, [
        { x: side * 58.13489, z: -64.65235, radius: 2, seed: 713 },
        { x: side * 40.2, z: -40.5, radius: 1.3, seed: 719 },
        { x: side * 75.4, z: -90.1, radius: 1.7, seed: 733 },
        { x: side * 50.3, z: -18.2, radius: 1.4, seed: 739 },
      ], heightAt);
      const grass = cover.geometry();
      try {
        // The first point previously sampled an analytic height 42 cm above the rendered east bank.
        for (const [x, z] of [[side * 58.13489, -64.65235], [side * 49.17, -53.22], [side * 82.6, -102.8]]) {
          assert.ok(Math.abs(heightAt(x, z) - rayHeight(x, z)) < 0.00003, 'triangle interpolation matches mesh support');
        }
        const points = grass.getAttribute('position');
        for (let i = 0; i < points.count; i += 4) {
          const x = points.getX(i), z = points.getZ(i);
          const actual = rayHeight(x, z);
          assert.ok(actual !== undefined, 'every accepted root lies over a rendered bank triangle');
          assert.ok(Math.abs(points.getY(i) + 0.015 - actual) < 0.00004,
            'ground cover roots meet the displayed triangle, without analytic-height floating or burial');
          checkedRoots += 1;
        }
        assert.equal(heightAt(0, 0), undefined, 'the lake does not acquire a support plane');
        assert.equal(heightAt(side * 40, -700), undefined, 'the sampler has no invisible ground beyond the bank');
      } finally {
        mesh.geometry.dispose();
        grass.dispose();
      }
    }
    assert.ok(checkedRoots > 900, `the regression covers both banks densely (${checkedRoots} independent root raycasts)`);
  } finally {
    material.dispose();
  }
});
