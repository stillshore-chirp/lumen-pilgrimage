import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Group, MathUtils, PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';

const source = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = context.parentURL?.startsWith(source) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(local ? specifier + '.ts' : specifier, context);
  },
});
const [{ buildLakeFish }, { buildLakeWater }, { createCoastAtmosphere, COAST_SUN_DIRECTION }, layout] = await Promise.all([
  import('../src/coast/world/lake/lakeWildlifeFish.ts'),
  import('../src/coast/world/lake/lakeWater.ts'),
  import('../src/coast/world/coastAtmosphere.ts'),
  import('../src/coast/world/lake/lakeLayout.ts'),
]);
hooks.deregister();

function shoal(t, seed) {
  const root = new Group();
  const swim = buildLakeFish(root, seed);
  const fish = root.children[0].children;
  t.after(() => {
    for (const geometry of new Set(fish.map(mesh => mesh.geometry))) geometry.dispose();
    fish[0].material.dispose();
  });
  swim(0, false);
  return { swim, fish };
}

function windowCamera({ x, z, yaw, pitch }) {
  const camera = new PerspectiveCamera(layout.LAKE_VIEW_FOV, 16 / 9, .1, 2400);
  camera.position.set(x, 1.65, z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  camera.setViewOffset(1, 1, 0, layout.LAKE_VIEW_VERTICAL_OFFSET, 1, 1);
  camera.aspect = 16 / 9;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

test('fish explore the visible shallows for four minutes without repeating the former circuits', t => {
  const { fish, swim } = shoal(t, 1221);
  const cameras = layout.LAKE_DESTINATIONS.slice(1).map(windowCamera);
  const scene = new Scene();
  const atmosphere = createCoastAtmosphere(COAST_SUN_DIRECTION);
  const water = buildLakeWater(scene, { value: 0 }, atmosphere);
  const bed = scene.getObjectByName('Lake shallow gravel bed');
  scene.updateMatrixWorld();
  t.after(() => {
    water.dispose();
    atmosphere.sky.value.dispose();
  });
  const downward = new Raycaster(undefined, new Vector3(0, -1, 0));
  const sample = new Vector3();
  const measurements = fish.map(mesh => ({
    last: mesh.position.clone(), yaw: mesh.rotation.y, speeds: { min: Infinity, max: 0 },
    paths: [], windowSamples: 0, joined: false, apart: false,
  }));
  const fps = 30;
  const interval = fps / 2;
  const frames = 240 * fps;
  let nearestEncounter = Infinity;

  for (let frame = 1; frame <= frames; frame++) {
    swim(frame / fps, false);
    for (const [i, mesh] of fish.entries()) {
      const data = measurements[i];
      const speed = data.last.distanceTo(mesh.position) * fps;
      const turn = Math.abs(MathUtils.euclideanModulo(mesh.rotation.y - data.yaw + Math.PI, Math.PI * 2) - Math.PI);
      assert.ok(speed < 1.02 && turn * fps < 2.17, `${mesh.name} moved or turned abruptly`);
      if (frame > 2) {
        data.speeds.min = Math.min(data.speeds.min, speed);
        data.speeds.max = Math.max(data.speeds.max, speed);
      }
      data.last.copy(mesh.position);
      data.yaw = mesh.rotation.y;
      const side = Math.floor(i / 4);
      let nearestNeighbor = Infinity;
      for (let j = side * 4; j < side * 4 + 4; j++) {
        if (i !== j) nearestNeighbor = Math.min(nearestNeighbor, mesh.position.distanceTo(fish[j].position));
      }
      nearestEncounter = Math.min(nearestEncounter, nearestNeighbor);
      data.joined ||= nearestNeighbor < 1.48;
      data.apart ||= nearestNeighbor > 2.2;

      if (frame % interval !== 0) continue;
      data.paths.push(mesh.position.clone());
      sample.copy(mesh.position).project(cameras[side]);
      if (Math.abs(sample.x) < 1 && Math.abs(sample.y) < 1 && Math.abs(sample.z) < 1) data.windowSamples++;

      downward.ray.origin.set(mesh.position.x, layout.LAKE_WATER_Y, mesh.position.z);
      const bottom = downward.intersectObject(bed)[0].point.y;
      mesh.updateMatrix();
      const vertices = mesh.geometry.getAttribute('position').count;
      for (let vertex = 0; vertex < vertices; vertex++) {
        mesh.getVertexPosition(vertex, sample).applyMatrix4(mesh.matrix);
        assert.ok(sample.y > bottom + .025 && sample.y < layout.LAKE_WATER_Y - .025,
          `${mesh.name} passed through the shallow bed or water surface`);
        assert.ok(sample.z < layout.LAKE_HALL.frontZ - 3, `${mesh.name} reached the hall foundations`);
      }
    }
  }

  for (const [i, data] of measurements.entries()) {
    const { min, max } = data.speeds;
    assert.ok(max > min + .32, `${fish[i].name} should glide and accelerate (range ${min.toFixed(2)}–${max.toFixed(2)} m/s)`);
    assert.ok(data.joined && data.apart, 'fish should sometimes draw near and sometimes separate');
    assert.ok(data.windowSamples >= data.paths.length * .97, 'fish should remain observable from the window');
    // The previous west and east circuits repeated at about 17 s and 15.5 s.
    const delay = i < 4 ? 34 : 31;
    const distances = data.paths.slice(delay).map((position, sample) => position.distanceTo(data.paths[sample]));
    assert.ok(distances.reduce((sum, distance) => sum + distance, 0) / distances.length > 1.5,
      'fish returned to the same route after one former loop');
  }
  assert.ok(nearestEncounter > .99, `closest centres only ${nearestEncounter.toFixed(3)} m apart`);
});

test('variable frames and switching to night retain continuous fish motion', t => {
  const even = shoal(t, 31);
  const irregular = shoal(t, 31);
  const steps = [.009, .017, .044, .032, .022];
  let time = 0;
  let frame = 0;
  for (let i = 1; i <= 720; i++) even.swim(i / 60, false);
  while (time < 12) {
    time = Math.min(12, time + steps[frame++ % steps.length]);
    const night = time > 2 && time < 11;
    irregular.swim(time, night);
    assert.equal(irregular.fish.filter(mesh => mesh.visible).length, night ? 4 : 8);
  }
  for (const [i, mesh] of irregular.fish.entries()) {
    assert.ok(mesh.position.distanceTo(even.fish[i].position) < 1e-8);
    assert.ok(Math.abs(mesh.rotation.y - even.fish[i].rotation.y) < 1e-8);
  }
  const beforeGap = irregular.fish.map(mesh => mesh.position.clone());
  irregular.swim(112, false);
  for (const [i, mesh] of irregular.fish.entries()) {
    assert.ok(mesh.position.distanceTo(beforeGap[i]) < .11, 'resuming after a clock gap should avoid catch-up jumps');
  }
});
