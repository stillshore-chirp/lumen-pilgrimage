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
const [
  { buildLakeStoneRing }, { LAKE_TERRAIN, LAKE_WATER_Y }, { addLakeBank }, { PlantSurface }, { addLakeFarArchitecture },
  { buildFarShoreSurface, farShoreMaterial },
] = await Promise.all([
  import('../src/coast/world/lake/lakeBasinStone.ts'),
  import('../src/coast/world/lake/lakeLayout.ts'),
  import('../src/coast/world/lake/lakeBasin.ts'),
  import('../src/coast/world/coastTreeMeshes.ts'),
  import('../src/coast/world/lake/lakeFarArchitecture.ts'),
  import('../src/coast/world/lake/lakeFarShore.ts'),
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

test('the far shore has recessed grid bays and free roof overhangs', () => {
  const surface = new PlantSurface();
  addLakeFarArchitecture(surface);
  const material = new MeshStandardMaterial();
  const mesh = new Mesh(surface.geometry(), material);
  const ray = new Raycaster(undefined, new Vector3(0, 0, -1));
  const frontAt = (x, y, z) => {
    ray.ray.origin.set(x, y, z);
    return ray.intersectObject(mesh, false)[0]?.point.z;
  };
  try {
    const pier = frontAt(-110.4, 73.7, -275);
    const bay = frontAt(-110.18, 73.7, -275);
    assert.ok(pier - bay > 0.8, 'the western grid stands forward of the recessed bays');
    const eave = frontAt(-58.71, 29.865, -405);
    const wall = frontAt(-58.71, 22.569, -405);
    assert.ok(eave - wall > 4, 'the pale roof projects over its lower wall');
    const arcadePier = frontAt(40, 10.5, -370);
    const arcadeBack = frontAt(41.5, 10.5, -370);
    assert.ok(arcadePier - arcadeBack > 1.8, 'the lower range has standing piers in front of a deeper gallery');
  } finally {
    mesh.geometry.dispose();
    material.dispose();
  }
});

test('gravel and masonry use the same atmospheric extinction at a shared contact', () => {
  const compileFog = layer => {
    const material = farShoreMaterial(layer);
    const shader = {
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <lights_fragment_end>\n#include <fog_fragment>',
    };
    try {
      material.onBeforeCompile(shader, undefined);
      const fog = shader.fragmentShader.indexOf('#if defined(USE_FOG)');
      assert.ok(fog >= 0, 'the local air field participates in the rendered material');
      return shader.fragmentShader.slice(fog);
    } finally {
      material.dispose();
    }
  };
  assert.equal(compileFog('gravel'), compileFog('masonry'),
    'a material boundary must not change the transmittance of the same air');
});

test('west, central and east foundations intersect continuous ground along their visible fronts', () => {
  const material = new MeshStandardMaterial();
  const shore = new Mesh(buildFarShoreSurface().geometry(), material);
  const meshes = [shore];
  for (const side of [-1, 1]) {
    const surface = new PlantSurface();
    addLakeBank(surface, side);
    meshes.push(new Mesh(surface.geometry(), material));
  }
  const surface = new PlantSurface();
  addLakeFarArchitecture(surface);
  const buildings = new Mesh(surface.geometry(), material);
  const down = new Raycaster(undefined, new Vector3(0, -1, 0));
  const inland = new Raycaster(undefined, new Vector3(0, 0, -1));
  try {
    for (const [name, x, start] of [
      ['west grid', -108, -275], ['west return', -82, -275], ['detached grid', -82, -375],
      ['pale pavilion', -50.16, -405], ['central gallery', 42, -370], ['east grid', 201, -340],
    ]) {
      inland.ray.origin.set(x, LAKE_WATER_Y + 0.52, start);
      const footing = inland.intersectObject(buildings, false)[0]?.point;
      assert.ok(footing, `${name}: an opaque footing continues below the visible facade`);
      for (const offset of [-0.25, 0.25, 2, 5]) {
        down.ray.origin.set(x, 150, footing.z - offset);
        const height = down.intersectObjects(meshes, false)[0]?.point.y;
        assert.ok(height > footing.y + 0.5, `${name}: the ground meets and overlaps the footing at ${offset} m`);
      }
    }
  } finally {
    for (const mesh of [...meshes, buildings]) mesh.geometry.dispose();
    material.dispose();
  }
});

test('the far gravel connects submerged slope to the base of the pale pavilion and the east wing', () => {
  const material = new MeshStandardMaterial();
  const ground = new Mesh(buildFarShoreSurface().geometry(), material);
  const architecture = new PlantSurface();
  addLakeFarArchitecture(architecture);
  const buildings = new Mesh(architecture.geometry(), material);
  const down = new Raycaster(undefined, new Vector3(0, -1, 0));
  const inland = new Raycaster(undefined, new Vector3(0, 0, -1));
  const heightAt = (x, z) => {
    down.ray.origin.set(x, 75, z);
    return down.intersectObject(ground, false)[0]?.point.y;
  };
  try {
    for (const [name, x, start, maximumStep] of [
      ['pale pavilion', -50.16, -405, 1], ['east retaining wall', 198, -345, 1.5],
    ]) {
      assert.ok(heightAt(x, -344) < LAKE_WATER_Y, `${name}: gravel extends below the waterline`);
      inland.ray.origin.set(x, LAKE_WATER_Y + 1, start);
      const [footing] = inland.intersectObject(buildings, false);
      assert.ok(footing, `${name}: an opaque foundation reaches the base of the slope`);
      const baseHeight = heightAt(x, footing.point.z + 0.25);
      assert.ok(baseHeight > footing.point.y + 1, `${name}: the foundation intersects rising gravel`);
      // A broad, shallow crest may level off beneath the pavilion. Keep the
      // supporting ground continuous instead of requiring a steep local mound.
      const profile = Array.from({ length: 7 }, (_, i) => heightAt(x, footing.point.z - i * 2));
      assert.ok(profile.every(y => y > baseHeight - 1), `${name}: the supporting grade continues inland`);
      assert.ok(profile.every((y, i) => i === 0 || Math.abs(y - profile[i - 1]) < maximumStep),
        `${name}: the foundation meets a broad grade without an abrupt bank`);
    }
  } finally {
    ground.geometry.dispose();
    buildings.geometry.dispose();
    material.dispose();
  }
});
