import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { ArrayCamera, BoxGeometry, DirectionalLight, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh,
  PerspectiveCamera, Raycaster, Scene, Vector3, Vector4 } from 'three';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { EXPLORATION_WORLDS, findDestination } = await import('../src/coast/coastDestinations.ts');
const { bindResidenceCityVisibility } = await import('../src/coast/world/residence/residenceCityVisibility.ts');
const { ResidenceShaderPreparation } = await import('../src/coast/world/residence/residenceShaderPreparation.ts');
const { createResidenceDoors } = await import('../src/coast/world/residence/residenceDoors.ts');
const { createResidenceNavigation } = await import('../src/coast/world/residence/residenceNavigation.ts');
const { RESIDENCE_BALCONY_DOOR, RESIDENCE_DOORWAYS, RESIDENCE_ROOMS, RESIDENCE_TEA_CEILING_SUSPENSION,
  RESIDENCE_TEA_HEARTH, RESIDENCE_TEA_MATS, RESIDENCE_TEA_TATAMI, RESIDENCE_WALLS } =
  await import('../src/coast/world/residence/residencePlan.ts');
const { createResidenceMaterials } = await import('../src/coast/world/residence/residenceMaterials.ts');
const { createResidenceFurniture } = await import('../src/coast/world/residence/residenceFurniture.ts');
const { createResidenceShell } = await import('../src/coast/world/residence/residenceShell.ts');
const { createResidenceReflections } = await import('../src/coast/world/residence/residenceReflections.ts');
hooks.deregister();

const materials = createResidenceMaterials();
const furniture = createResidenceFurniture(materials);
after(() => {
  furniture.dispose();
  materials.dispose();
});

const spawn = findDestination('residence', 'living-window');
const navigation = open => createResidenceNavigation(spawn, furniture.obstacles, () => open);
const blocked = (nav, e, n, foot = 0) => nav.blocksWalking(e, -n, foot);

function assertClearRoute(nav, points) {
  for (let i = 1; i < points.length; i += 1) {
    const [e, n] = points[i - 1];
    const [east, north] = points[i];
    const count = Math.ceil(Math.hypot(east - e, north - n) / 0.05);
    for (let step = 0; step <= count; step += 1) {
      const t = step / count;
      const x = e + (east - e) * t;
      const y = n + (north - n) * t;
      assert.equal(blocked(nav, x, y), false, `blocked at E${x.toFixed(2)}, N${y.toFixed(2)}`);
    }
  }
}

function reachableFrom(nav, e, n) {
  const width = 229;
  const height = 178;
  const grid = (east, north) => Math.round(north * 10) * width + Math.round(east * 10);
  const start = grid(e, n);
  assert.equal(blocked(nav, e, n), false);
  const seen = new Set([start]);
  const checked = new Set([start]);
  const queue = [start];

  for (let i = 0; i < queue.length; i += 1) {
    const x = queue[i] % width;
    const y = Math.floor(queue[i] / width);
    for (const [east, north] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (east < 0 || east >= width || north < 0 || north >= height) continue;
      const cell = north * width + east;
      if (checked.has(cell)) continue;
      checked.add(cell);
      if (blocked(nav, east / 10, north / 10)) continue;
      seen.add(cell);
      queue.push(cell);
    }
  }

  return (east, north) => seen.has(grid(east, north));
}

function cityRenderProbe(regional = new Group()) {
  const scene = new Scene();
  const city = new Group();
  city.add(regional);
  scene.add(city);
  bindResidenceCityVisibility(scene, city, regional);
  const renderer = { xr: { enabled: true, isPresenting: true } };
  function visibleDuring(camera) {
    scene.onBeforeRender(renderer, scene, camera, null);
    const visible = city.visible;
    scene.onAfterRender(renderer, scene, camera);
    return visible;
  }
  return { city, renderer, visibleDuring, scene };
}

function residenceEye(x, z, yaw, pitch, lensShift = 0) {
  const eye = new PerspectiveCamera(86, 1, .08, 43500);
  eye.viewport = new Vector4(0, 0, 1832, 1920);
  eye.position.set(x, 1.65, z);
  eye.rotation.set(pitch, yaw, 0, 'YXZ');
  eye.projectionMatrix.elements[8] += lensShift;
  eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
  eye.updateMatrixWorld();
  return eye;
}

function shaderPreparationProbe(t) {
  const previousProgram = Object.getOwnPropertyDescriptor(globalThis, 'WebGLProgram');
  const MockProgram = class {};
  Object.defineProperty(globalThis, 'WebGLProgram', { value: MockProgram, configurable: true });
  t.after(() => {
    if (previousProgram) Object.defineProperty(globalThis, 'WebGLProgram', previousProgram);
    else delete globalThis.WebGLProgram;
  });
  const probe = { now: 0, complete: false, uniformCalls: 0, compiles: 0, compileThrows: false, uniformsThrow: false };
  t.mock.method(performance, 'now', () => probe.now);
  const program = { program: new MockProgram(), getUniforms() {
    if (probe.uniformsThrow) throw new Error('Synthetic first-use failure');
    probe.uniformCalls++;
  } };
  const renderer = {
    getContext: () => ({ isContextLost: () => false, getExtension: () => ({ COMPLETION_STATUS_KHR: 0x91b1 }),
      getProgramParameter: () => probe.complete }),
    getRenderTarget: () => null, outputColorSpace: 'srgb', toneMapping: 0,
    shadowMap: { enabled: true, type: 1 }, xr: { isPresenting: false }, info: { programs: [] },
    compile() {
      probe.compiles++;
      if (probe.compileThrows) throw new Error('Synthetic compile failure');
      this.info.programs = [program];
    },
  };
  return { probe, preparation: new ResidenceShaderPreparation(renderer, new Scene()), camera: new PerspectiveCamera() };
}

test('residence shader preparation keeps a five-second unfinished program failed until a successful retry', t => {
  const { probe, preparation, camera } = shaderPreparationProbe(t);
  preparation.advance(camera);
  assert.equal(preparation.state, 'pending');
  probe.now = 5_001;
  preparation.advance(camera);
  assert.equal(preparation.state, 'failed');
  assert.equal(probe.uniformCalls, 0);
  preparation.advance(camera);
  assert.equal(probe.compiles, 1, 'Failure does not retry or unlock by itself');

  preparation.reset();
  assert.equal(preparation.state, 'pending');
  preparation.advance(camera);
  assert.equal(preparation.state, 'pending', 'A linked program still needs its completion and first-use work');
  assert.equal(probe.uniformCalls, 0);
  probe.complete = true;
  preparation.advance(camera);
  assert.equal(preparation.state, 'ready');
  assert.equal(probe.uniformCalls, 1);
});

test('residence shader preparation exposes compile and first-use exceptions and retries cached programs', t => {
  const { probe, preparation, camera } = shaderPreparationProbe(t);
  probe.compileThrows = true;
  preparation.advance(camera);
  assert.equal(preparation.state, 'failed');
  assert.equal(probe.uniformCalls, 0);

  probe.compileThrows = false;
  probe.complete = true;
  probe.uniformsThrow = true;
  preparation.reset();
  preparation.advance(camera);
  assert.equal(preparation.state, 'failed');
  assert.equal(probe.uniformCalls, 0);
  probe.uniformsThrow = false;
  preparation.reset();
  preparation.advance(camera);
  assert.equal(preparation.state, 'ready');
  assert.equal(probe.uniformCalls, 1, 'Retry reflects an existing linked program rather than treating it as ready');
});

test('immersive city draws when either eye can see an opening and restores visibility after rendering', () => {
  const { city, renderer, visibleDuring } = cityRenderProbe();
  const kitchenYaw = Math.atan2(spawn.x - 15.2, 8.45 + spawn.z);
  const left = residenceEye(spawn.x - .033, spawn.z, kitchenYaw, -.22, -.09);
  const right = residenceEye(spawn.x + .033, spawn.z, kitchenYaw, -.22);
  const headset = new ArrayCamera([left, right]);
  assert.equal(visibleDuring(headset), false, 'The fixed bedroom walls hide the far glazing');
  assert.equal(city.visible, true, 'Visibility is restored after the immersive scene render');

  const fartherRight = residenceEye(spawn.x + .033, spawn.z, kitchenYaw, -.22, .22);
  assert.equal(visibleDuring(new ArrayCamera([fartherRight])), true, 'The shifted view reaches an opening');
  assert.equal(visibleDuring(new ArrayCamera([left, fartherRight])), true, 'An opening seen by one eye keeps the city');
  assert.equal(visibleDuring(new ArrayCamera([residenceEye(spawn.x, spawn.z, 0, -.29)])),
    true, 'The east glazing stays visible beside the TV');
  assert.equal(visibleDuring(new ArrayCamera([residenceEye(spawn.x, spawn.z, spawn.yaw, spawn.pitch)])),
    true, 'The south glazing keeps its view');

  renderer.xr.isPresenting = false;
  assert.equal(visibleDuring(left), true, 'Desktop rendering keeps the existing scene');
  city.visible = false;
  assert.equal(visibleDuring(left), false, 'Desktop reflection passes may hide the city themselves');
  assert.equal(city.visible, false);
});

test('city culling leaves open doorways and views near the facade or on the balcony available', () => {
  const { visibleDuring } = cityRenderProbe();
  const headset = new ArrayCamera();
  const visibleAt = (x, z, yaw, pitch) => {
    headset.cameras = [residenceEye(x, z, yaw, pitch)];
    return visibleDuring(headset);
  };
  assert.equal(visibleAt(15.2, -8.45, 0, -.2), false, 'The kitchen view faces opaque walls');
  assert.equal(visibleAt(10.05, -5.85, Math.PI, 0), true, 'The study door can expose a window');
  assert.equal(visibleAt(19.7, -13.58, -Math.PI / 2, -.1), true, 'The sliding balcony door exposes the outside');
  assert.equal(visibleAt(20.66, -13.58, Math.PI / 2, -.1), true, 'The near plane can cross the balcony threshold');
  assert.equal(visibleAt(21.65, -13.58, Math.PI / 2, -.1), true, 'The balcony remains outside the culling bounds');
});

test('immersive opening bounds cull only hidden regional batches and restore their state', () => {
  const tv = findDestination('residence', 'living-theater');
  const left = residenceEye(tv.x - .033, tv.z, tv.yaw, tv.pitch);
  const right = residenceEye(tv.x + .033, tv.z, tv.yaw, tv.pitch);
  const region = new Group();
  region.scale.z = -1;
  const shape = new BoxGeometry(1, 1, 1);
  function batch(projectedX) {
    const center = new Vector3(projectedX, 0, .999).unproject(right);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', shape.getAttribute('position'));
    geometry.setAttribute('cityCenter', new InstancedBufferAttribute(
      new Float32Array([center.x, center.y, -center.z]), 3,
    ));
    geometry.setAttribute('cityScale', new InstancedBufferAttribute(new Float32Array([.1, .1, .1]), 3));
    const object = new Mesh(geometry);
    region.add(object);
    return object;
  }
  const throughGlass = batch(.66);
  const behindWall = batch(-.55);
  const shadowCaster = batch(-.6);
  shadowCaster.castShadow = true;
  const alreadyHidden = batch(-.65);
  alreadyHidden.visible = false;
  const { city, renderer, scene } = cityRenderProbe(region);
  const headset = new ArrayCamera([left, right]);
  const flags = () => [city, throughGlass, behindWall, shadowCaster, alreadyHidden].map(object => object.visible);
  const begin = () => scene.onBeforeRender(renderer, scene, headset, null);
  const end = () => scene.onAfterRender(renderer, scene, headset);
  begin();
  assert.deepEqual(flags(), [true, true, false, true, false]);
  end();
  assert.deepEqual(flags(), [true, true, true, true, false]);

  // The first eye alone faces solid interior walls. The second eye keeps its outside batch.
  const interiorEye = residenceEye(15.2, -8.45, 0, -.2);
  headset.cameras = [interiorEye, right];
  begin();
  assert.deepEqual(flags(), [true, true, false, true, false]);
  end();

  for (const otherEye of [
    residenceEye(20.66, -13.58, Math.PI / 2, -.1),
    residenceEye(21.65, -13.58, Math.PI / 2, -.1),
    residenceEye(tv.x, tv.z, tv.yaw, .3),
  ]) {
    if (otherEye.rotation.x > 0) {
      otherEye.position.y = 2.93;
      otherEye.updateMatrixWorld();
    }
    headset.cameras = [right, otherEye];
    begin();
    assert.deepEqual(flags(), [true, true, true, true, false]);
    end();
  }
  renderer.xr.isPresenting = false;
  headset.cameras = [left, right];
  begin();
  assert.deepEqual(flags(), [true, true, true, true, false]);
  end();
  for (const object of region.children) {
    object.geometry.dispose();
    object.material.dispose();
  }
  shape.dispose();
});

test('dwelling follows the drawing dimensions and all travel poses have continuous level support', () => {
  const dwelling = RESIDENCE_ROOMS.filter(room => room.id !== 'C0' && room.id !== 'C1');
  const area = room => room.rectangles.reduce((sum, [w, s, e, n]) => sum + (e - w) * (n - s), 0);
  assert.ok(Math.abs(dwelling.reduce((sum, room) => sum + area(room), 0) - 319.68) < 1e-8);
  assert.ok(Math.abs(area(dwelling.find(room => room.id === 'BL')) - 8.4) < 1e-8);
  assert.equal(RESIDENCE_WALLS.find(wall => wall.kind === 'guard').height, 1.18);
  assert.ok(RESIDENCE_WALLS.flatMap(wall => wall.openings ?? [])
    .filter(opening => opening.kind === 'door').every(opening => opening.to - opening.from >= 0.9));

  const nav = navigation(false);
  for (const pose of EXPLORATION_WORLDS.find(world => world.id === 'residence').places) {
    assert.equal(nav.groundHeight(pose.x, pose.z), 0, pose.id);
    assert.equal(nav.blocksWalking(pose.x, pose.z, 0), false, pose.id);
  }
});

test('the finished ceilings, recessed balcony soffit and door lintels bound aerial movement', () => {
  const nav = navigation(true);
  assert.equal(nav.ceilingHeight(20, -1.5), 3);
  assert.equal(nav.ceilingHeight(1.7, -8.4), 2.55);
  assert.equal(nav.ceilingHeight(21.7, -13.58), 3.19);
  assert.equal(nav.ceilingHeight(20.7, -13.58), 2.73);
  assert.equal(nav.ceilingHeight(6.49, -5.12), 2.2);
  assert.equal(blocked(nav, 20.7, 13.58), false);
  assert.equal(blocked(navigation(false), 20.7, 13.58), true);
  assert.equal(blocked(nav, 22.79, 13.58), true);
});

test('tea seating ceiling and exposed beams stop flight at the rendered underside', () => {
  const nav = navigation(true);
  furniture.group.updateMatrixWorld(true);
  for (const [east, north, underside] of [
    [5.5, 2.85, 2.479], // A clear panel between the transverse beams.
    [5.5, 2.073, 2.4275], // The middle transverse beam projects below the panel.
    [3.944, 2.8, 2.443], // The west longitudinal beam.
  ]) {
    const ray = new Raycaster(new Vector3(east, 2.30, -north), new Vector3(0, 1, 0), 0, .6);
    const hit = ray.intersectObject(furniture.group, true).find(({ object }) => !object.material.transparent);
    assert.ok(hit, `No rendered tea ceiling at E${east}, N${north}`);
    assert.ok(Math.abs(hit.point.y - underside) < 1e-5, `Unexpected rendered underside at E${east}, N${north}`);
    assert.equal(nav.ceilingHeight(east, -north), underside);
  }
  assert.equal(nav.ceilingHeight(6.45, -4.45), 2.85, 'The entrance keeps its higher ceiling');
});

test('interior glazing visible in captures never samples facade reflection targets', () => {
  const shell = createResidenceShell(materials);
  const reflections = createResidenceReflections(new Scene(), new Group(), shell.group, furniture.group, materials);
  try {
    let interiorPanes = 0;
    furniture.group.traverse(object => {
      if (!(object instanceof Mesh)) return;
      assert.notEqual(object.material, materials.glass, 'Interior geometry must not use the recursive facade material');
      if (object.material === materials.interiorGlass) interiorPanes++;
    });
    assert.equal(interiorPanes, 2, 'Both shower panes remain present in captures');
    for (const property of ['opacity', 'roughness', 'ior', 'side', 'forceSinglePass']) {
      assert.equal(materials.interiorGlass[property], materials.glass[property], property);
    }
    const shader = () => ({ uniforms: {}, vertexShader: '#include <common>\n#include <worldpos_vertex>',
      fragmentShader: '#include <common>\n#include <opaque_fragment>' });
    const facade = shader();
    const interior = shader();
    materials.glass.onBeforeCompile(facade);
    materials.interiorGlass.onBeforeCompile(interior);
    for (const sampler of ['windowSouthImage', 'windowEastImage', 'windowBedroomImage']) {
      assert.ok(facade.uniforms[sampler], sampler);
      assert.equal(interior.uniforms[sampler], undefined, sampler);
    }
  } finally {
    reflections.dispose();
    shell.dispose();
  }
});

test('tea suspension collars meet the diagonal rods at the main ceiling', () => {
  const { collarTop, anchor, soffit, points } = RESIDENCE_TEA_CEILING_SUSPENSION;
  const lower = collarTop - .008;
  const upper = anchor + .004;
  const t = (soffit - lower) / (upper - lower);
  furniture.group.updateMatrixWorld(true);
  for (const support of points) {
    const east = support.east + (support.braceEast - support.east) * t;
    const north = support.north + (support.braceNorth - support.north) * t;
    const ray = new Raycaster(new Vector3(east, soffit - .03, -north), new Vector3(0, 1, 0), 0, .05);
    const hits = ray.intersectObject(furniture.group, true);
    assert.ok(hits.some(hit => hit.object.material === materials.metal && Math.abs(hit.point.y - (soffit - .006)) < 1e-5),
      `No diagonal collar at ${support.id}`);
  }
});

test('reflection capture waits for main-camera shadow textures and retries unchanged poses', () => {
  const scene = new Scene();
  const sunlight = new DirectionalLight();
  sunlight.castShadow = true;
  sunlight.shadow.autoUpdate = false;
  sunlight.shadow.needsUpdate = false;
  scene.add(sunlight);
  const hidden = new Group();
  hidden.visible = false;
  const hiddenLight = new DirectionalLight();
  hiddenLight.castShadow = true;
  hidden.add(hiddenLight);
  scene.add(hidden);
  const otherLayer = new DirectionalLight();
  otherLayer.castShadow = true;
  otherLayer.layers.set(3);
  scene.add(otherLayer);
  const shell = createResidenceShell(materials);
  const reflections = createResidenceReflections(scene, new Group(), shell.group, furniture.group, materials);
  reflections.setQuality('high');
  const camera = new PerspectiveCamera(60, 1, .05, 500);
  camera.position.set(5.5, 1.65, -2);
  const renderer = {
    xr: { isPresenting: false },
    shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false },
    getDrawingBufferSize() { throw new Error('capture reached'); },
  };
  try {
    reflections.prepareRender(renderer, camera);
    assert.equal(sunlight.shadow.needsUpdate, true, 'The main pass must allocate the missing shadow');
    assert.equal(renderer.shadowMap.needsUpdate, true);
    assert.equal(renderer.shadowMap.autoUpdate, false, 'The guard must preserve the update policy');
    assert.equal(hiddenLight.shadow.needsUpdate, false);
    assert.equal(otherLayer.shadow.needsUpdate, false);
    sunlight.shadow.map = { dispose() {} };
    assert.throws(() => reflections.prepareRender(renderer, camera), { message: 'capture reached' });
    sunlight.shadow.map = null;
    renderer.shadowMap.needsUpdate = false;
    reflections.setQuality('light');
    reflections.prepareRender(renderer, camera);
    assert.equal(renderer.shadowMap.needsUpdate, true, 'A resized map must be prepared again');
    reflections.setQuality('high');
    renderer.shadowMap.enabled = false;
    assert.throws(() => reflections.prepareRender(renderer, camera), { message: 'capture reached' },
      'Disabled shadows must not cause an endless capture wait');
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.needsUpdate = false;
    renderer.xr.isPresenting = true;
    reflections.prepareRender(renderer, camera);
    assert.equal(renderer.shadowMap.needsUpdate, false, 'XR keeps its reflection-off branch');
  } finally {
    reflections.dispose();
    shell.dispose();
  }
});

test('the living-room television has twice the 65-inch screen width and height', () => {
  const { screen } = furniture.theater;
  screen.geometry.computeBoundingBox();
  const { min, max } = screen.geometry.boundingBox;
  const previousWidth = (65 * .0254 * 16) / Math.hypot(16, 9);
  const previousHeight = previousWidth * 9 / 16;
  assert.ok(Math.abs((max.x - min.x) - 2 * previousWidth) < 1e-6);
  assert.ok(Math.abs((max.y - min.y) - 2 * previousHeight) < 1e-6);
});

test('a connected route links the lobby, dwelling rooms and kitchen with furniture in place', () => {
  const nav = navigation(false);
  const connected = reachableFrom(nav, 10.96, 16.6);
  const destinations = [
    ['C0', 6.4, 13.6], ['FO', 11.8, 14.17], ['H0', 11.9, 9.9], ['LD', spawn.x, -spawn.z],
    ['H1', 5.35, 5.8], ['03', 2.85, 3.6], ['04', 6.49, 3.6], ['05', 10.05, 3.6],
    ['BA', 2.2, 8.5], ['BB', 5.37, 8.05], ['UT', 7.55, 10.5], ['ST', 9.94, 8.65],
    ['WC', 9.60, 10.9], ['K', 14.8, 8.7], ['H2', 16.6, 10.7],
    ['02', 18.80, 7.4], ['01', 19.55, 12.65], ['WI', 16.17, 13.75], ['MB', 14.67, 13.5],
  ];
  for (const [room, e, n] of destinations) {
    assert.ok(connected(e, n), `${room} inaccessible near E${e}, N${n}`);
  }
  assert.equal(connected(21.94, 12.94), false);
});

test('tea room and study retain a continuous entry and their own interior layout', () => {
  const area = ([west, south, east, north]) => (east - west) * (north - south);
  assert.equal(RESIDENCE_ROOMS.find(room => room.id === '04').label, '茶室04');
  assert.equal(RESIDENCE_ROOMS.find(room => room.id === '05').label, '書斎05');
  assert.equal(furniture.group.children.filter(room => /Bedroom 0[345]$/.test(room.name)).length, 1);
  assert.ok(furniture.group.getObjectByName('Tea room 04'));
  assert.ok(furniture.group.getObjectByName('Study 05'));
  assert.equal(RESIDENCE_TEA_MATS.length, 5);
  assert.ok(Math.abs(area(RESIDENCE_TEA_TATAMI) - 4.5 * 1.91 * .955) < 1e-9);
  assert.ok(Math.abs(RESIDENCE_TEA_MATS.reduce((sum, rect) => sum + area(rect), 0)
    - area(RESIDENCE_TEA_TATAMI)) < 1e-9);
  const [west, south, east, north] = RESIDENCE_TEA_HEARTH;
  assert.ok(Math.abs(east - west - .424) < 1e-9 && Math.abs(north - south - .424) < 1e-9);
  const nav = navigation(false);
  assertClearRoute(nav, [[6.50, 5.5], [6.50, 3.79], [6.31, 2.58], [5.68, 2.43]]);
  assertClearRoute(nav, [[10.05, 5.5], [10.05, 3.83], [9.46, 2.89], [9.46, 1.08]]);
  assertClearRoute(nav, [[9.44, 2.82], [10.67, 2.82]]);
  for (const [x, n] of [[6.49, 5.00], [6.49, 3.475], [5.68, 2.43], [10.05, 5.00], [9.46, 1.69]]) {
    assert.equal(nav.groundHeight(x, -n), 0);
  }
});

test('walking crosses the indoor sofa, dining table and chairs, kitchen island and entry bench', () => {
  const nav = navigation(false);
  assertClearRoute(nav, [[19.99, .43], [19.99, 3.06]]);
  assertClearRoute(nav, [[15.98, 3.3], [15.98, 6.1]]);
  assertClearRoute(nav, [[13.35, 7.715], [16.7, 7.715]]);
  assertClearRoute(nav, [[11.65, 14.84], [12.48, 14.84]]);
});

test('both living-room sofas keep their back-to-back layout and room at the theater arrival point', () => {
  const spans = furniture.obstacles
    .filter(([west, , east]) => Math.abs(west - 18.4) < 1e-8 && Math.abs(east - 21.58) < 1e-8)
    .map(([, south, , north]) => [south.toFixed(2), north.toFixed(2)]);
  assert.deepEqual(spans, [['0.80', '1.82'], ['1.80', '2.79']]);
  const theater = findDestination('residence', 'living-theater');
  assert.ok(-theater.z - Number(spans[1][1]) >= .24);
  const nav = navigation(false);
  assertClearRoute(nav, [[theater.x, -theater.z], [22.15, -theater.z], [22.15, .55], [20, .55]]);
  assertClearRoute(nav, [[theater.x, -theater.z], [17.43, -theater.z], [17.43, .55]]);
});

function doorwayCentre({ wall, opening }, offset = 0) {
  const centre = (opening.from + opening.to) / 2;
  return wall.axis === 'e' ? { x: centre, z: -(wall.fixed + offset) } : { x: wall.fixed + offset, z: -centre };
}

test('every dwelling door stays level, blocks walking when closed and reopens from both sides', () => {
  const poses = new Map();
  const doors = createResidenceDoors(({ id }, pose) => poses.set(id, pose));
  const nav = createResidenceNavigation(spawn, furniture.obstacles, () => false, doors);
  assert.equal(RESIDENCE_DOORWAYS.length, 14);
  assert.equal(new Set(RESIDENCE_DOORWAYS.map(({ id }) => id)).size, RESIDENCE_DOORWAYS.length);
  for (const doorway of RESIDENCE_DOORWAYS) {
    const { id, label, opening, wall } = doorway;
    const side = opening.kind === 'door' ? opening.swing.side : -1;
    const threshold = doorwayCentre(doorway);
    const approach = doorwayCentre(doorway, -.61 * side);
    const opposite = doorwayCentre(doorway, .41 * side);
    const isBlocked = ({ x, z }) => nav.blocksWalking(x, z, 0);
    const route = [approach, opposite].map(({ x, z }) => [x, -z]);
    assertClearRoute(nav, route);
    assert.equal(nav.groundHeight(threshold.x, threshold.z), 0, id);
    assert.equal(doors.nearby(approach)?.label, `${label}を閉める`);
    doors.nearby(approach).invoke();
    assert.ok(doors.update(.275, approach), id);
    assert.equal(doors.opennessFor(wall, opening), .5, id);
    const pose = poses.get(id);
    assert.ok(nav.blocksWalking(pose.east + Math.cos(pose.angle) * pose.width / 2,
      -pose.north - Math.sin(pose.angle) * pose.width / 2, 0), id);
    doors.update(.275, approach);
    assert.equal(doors.openness(id), 0, id);
    assert.equal(isBlocked(threshold), true, id);
    assert.equal(isBlocked(approach), false, id);
    assert.equal(isBlocked(opposite), false, id);
    assert.equal(doors.nearby(opposite)?.label, `${label}を開ける`);
    doors.nearby(opposite).invoke();
    const clearOfSwing = doorwayCentre(doorway, 1.45 * side);
    assertClearRoute(nav, [[opposite.x, -opposite.z], [clearOfSwing.x, -clearOfSwing.z]]);
    doors.update(.55, clearOfSwing);
    assert.equal(doors.openness(id), 1, id);
    assertClearRoute(nav, route);
  }
});

test('the foyer pocket door protects its threshold while the living and kitchen boundaries stay open', () => {
  const shell = createResidenceShell(materials);
  try {
    const { doors } = shell;
    const gallery = RESIDENCE_DOORWAYS.find(({ id }) => id === 'foyer-gallery');
    const { wall, opening } = gallery;
    const nav = createResidenceNavigation(spawn, furniture.obstacles, () => false, doors);
    const frame = shell.group.getObjectByName('Foyer pocket frame');
    const leaf = shell.group.getObjectByName('Foyer pocket door');
    assert.ok(frame && leaf);
    assert.equal(wall.fixed, 12.1);
    assert.ok(leaf.children.some(mesh => mesh.castShadow && mesh.material === materials.cabinetry
      && !mesh.material.transparent && mesh.material.transmission === 0));
    const maxMeshEast = Math.max(...leaf.children.map(mesh => {
      mesh.geometry.computeBoundingBox();
      return leaf.position.x + mesh.geometry.boundingBox.max.x;
    }));
    const retracted = leaf.position.x;
    assert.ok(retracted > 9.284 && maxMeshEast < 11, 'the leaf fits in the pre-existing foyer/WC wall');
    for (const centre of [opening.from + .27, opening.to - .27]) {
      assertClearRoute(nav, [[centre, 13.1], [centre, 11.45]]);
      assert.equal(nav.groundHeight(centre, -wall.fixed), 0);
    }
    const assertLivingBoundaryOpen = () => {
      assert.ok(!RESIDENCE_WALLS.some(wall => wall.axis === 'e' && wall.fixed === 6.65
        && wall.to > 11 && wall.from < 17.35));
      shell.group.updateMatrixWorld(true);
      for (const e of [11.36, 11.9, 12.43, 12.72, 13.25, 14.3, 15.5, 16.9]) {
        assertClearRoute(nav, [[e, 7.1], [e, 6.05]]);
        for (const y of [.85, 1.65, 2.3]) {
          const ray = new Raycaster(new Vector3(e, y, -7.1), new Vector3(0, 0, 1), 0, 1.05);
          assert.equal(ray.intersectObject(shell.group).length, 0, `mesh blocks E${e} at Y${y}`);
        }
      }
    };
    assertLivingBoundaryOpen();
    const foyer = doorwayCentre(gallery, .60);
    const threshold = doorwayCentre(gallery);
    assert.equal(doors.nearby(foyer)?.label, '玄関前室の引戸を閉める');
    doors.nearby(foyer).invoke();
    assert.equal(doors.update(.55, threshold), false);
    assert.equal(doors.opennessFor(wall, opening), 1);
    assert.ok(doors.update(.275, foyer));
    assert.equal(doors.opennessFor(wall, opening), .5);
    assert.ok(blocked(nav, opening.from + .27, wall.fixed));
    assert.ok(!blocked(nav, opening.to - .29, wall.fixed));
    assert.ok(doors.update(.275, foyer));
    assert.equal(doors.opennessFor(wall, opening), 0);
    assert.ok(blocked(nav, threshold.x, -threshold.z));
    assert.ok(blocked(nav, 10.43, 12.1));
    assertLivingBoundaryOpen();
    assertClearRoute(nav, [[11.85, 7.7], [13.45, 7.7]]);
    assertClearRoute(nav, [[16.8, 7.30], [16.8, 6.05], [11.55, 5.63], [9.94, 5.63], [9.94, 7.35]]);
    const hallway = doorwayCentre(gallery, -.60);
    assert.equal(doors.nearby(hallway)?.label, '玄関前室の引戸を開ける');
    doors.nearby(hallway).invoke();
    assert.ok(doors.update(.55, hallway));
    assert.equal(leaf.position.x, retracted);
    assert.ok(!blocked(nav, threshold.x, -threshold.z));
  } finally {
    shell.dispose();
  }
});

test('a hinged leaf and the fusuma cannot sweep through someone while closing', () => {
  const doors = createResidenceDoors();
  const entrance = RESIDENCE_DOORWAYS.find(({ id }) => id === 'entrance');
  const outside = doorwayCentre(entrance, .66);
  const insideSwing = { x: 10.91, z: -15.13 };
  doors.nearby(outside).invoke();
  assert.equal(doors.blocksWalking(insideSwing.x, insideSwing.z), false);
  assert.equal(doors.update(.55, insideSwing), false);
  assert.equal(doors.openness('entrance'), 1);
  doors.update(.55, outside);
  assert.equal(doors.openness('entrance'), 0);
  assert.equal(doors.blocksWalking(insideSwing.x, insideSwing.z), false);

  const tea = RESIDENCE_DOORWAYS.find(({ id }) => id === 'tea-room');
  const hallway = doorwayCentre(tea, .60);
  doors.nearby(hallway).invoke();
  assert.equal(doors.update(.55, doorwayCentre(tea)), false);
  assert.equal(doors.openness('tea-room'), 1);
  assert.ok(doors.update(.55, hallway));
  assert.equal(doors.openness('tea-room'), 0);
  assert.equal(doors.openness('bedroom-03'), 1);
});

test('the tea-room fusuma moves an opaque shadow-casting leaf in the shell', () => {
  const shell = createResidenceShell(materials);
  try {
    const leaf = shell.group.getObjectByName('Tea room fusuma');
    assert.ok(leaf);
    assert.ok(leaf.children.some(mesh => mesh.castShadow && mesh.material === materials.washi
      && !mesh.material.transparent && mesh.material.transmission === 0));
    const openEast = leaf.position.x;
    const tea = RESIDENCE_DOORWAYS.find(({ id }) => id === 'tea-room');
    const hallway = doorwayCentre(tea, .60);
    shell.doors.nearby(hallway).invoke();
    shell.doors.update(.55, hallway);
    assert.ok(leaf.position.x - openEast > .96);
    assert.equal(shell.doors.openness('tea-room'), 0);
    const southWindowWall = RESIDENCE_WALLS.find(wall => wall.axis === 'e' && wall.fixed === 0);
    assert.equal(shell.doors.opennessFor(southWindowWall, southWindowWall.openings[1]), 1);
  } finally {
    shell.dispose();
  }
});

test('only the sliding door opens onto the balcony and its furniture still blocks walking', () => {
  let doorOpen = false;
  const nav = createResidenceNavigation(spawn, furniture.obstacles, () => doorOpen);
  const { e, nFrom, nTo } = RESIDENCE_BALCONY_DOOR;
  const centre = (nFrom + nTo) / 2;
  assert.equal(blocked(nav, e, centre), true);
  doorOpen = true;
  assertClearRoute(nav, [[19.55, 12.65], [20.07, 12.65], [20.07, centre], [21.94, centre], [21.94, 12.94]]);
  assert.equal(blocked(nav, e, nFrom - 0.18), true);
  assert.equal(blocked(nav, e, nTo + 0.18), true);
  assert.equal(blocked(nav, e, nFrom + 0.11), true);
  assert.equal(blocked(nav, 21.36, 15), true);
  assert.equal(blocked(nav, 21.725, 12.08), true);
});

test('facade glazing, guards, wall corners and service shafts are solid at every foot height', () => {
  const nav = navigation(true);
  const barriers = [
    [20, 0.1], [22.66, 4], [22.72, 13.5], [22.76, 11.71], [22.76, 15.49],
    [22.79, 11.71], [23, 13.5], [6, 17.64], [13.4, 15.63], [3.65, 3.5],
    [6.0, 10.8], [13.3, 11.88], [2.5, 13.3], [18, 16],
  ];
  for (const [e, n] of barriers) {
    for (const foot of [0, 1.18, 3.12]) {
      assert.equal(blocked(nav, e, n, foot), true, `unblocked E${e}, N${n}, height ${foot}`);
    }
  }
});
