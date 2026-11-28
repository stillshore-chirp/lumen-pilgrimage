import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Group, PerspectiveCamera, Raycaster, Vector3 } from 'three';

const source = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(source)
      && specifier.startsWith('.') && !/\.(?:ts|js|json)$/.test(specifier);
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const [{ createAtriumTenantWalking }, { createTenantArchitecture }, { createTenantFinishes },
  { furnishWestTenant }, { ATRIUM_TENANTS, tenantWorldPoint }, { buildAtriumFrontShell },
  { buildAtriumRetail }, { buildAtriumFrontCommons }, { ATRIUM_FRONT_TENANTS, atriumFrontTenantPoint },
  { createAtriumNavigation }, { CoastControls }, walkingModule] = await Promise.all([
  import('../src/coast/world/atrium/atriumTenantWalking.ts'),
  import('../src/coast/world/atrium/atriumTenantArchitecture.ts'),
  import('../src/coast/world/atrium/atriumTenantLighting.ts'),
  import('../src/coast/world/atrium/atriumTenantWest.ts'),
  import('../src/coast/world/atrium/atriumTenantPlan.ts'),
  import('../src/coast/world/atrium/atriumFrontShell.ts'),
  import('../src/coast/world/atrium/atriumRetail.ts'),
  import('../src/coast/world/atrium/atriumFrontCommons.ts'),
  import('../src/coast/world/atrium/atriumFrontPlan.ts'),
  import('../src/coast/world/atrium/atriumNavigation.ts'),
  import('../src/coast/CoastControls.ts'),
  import('../src/coast/world/atrium/atriumTenantWalking.ts'),
]);
hooks.deregister();

const bay = ATRIUM_TENANTS.find(bay => bay.id === 'L1');
const root = new Group();
const context = createTenantArchitecture(root, bay, await createTenantFinishes(null));
furnishWestTenant(context);
const walking = createAtriumTenantWalking(root);
root.updateMatrixWorld(true);
const ray = new Raycaster();

function close(actual, expected, message, tolerance = .002) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < tolerance,
    `${message}: expected ${expected}, got ${actual}`);
}

function cast(scene, position, direction, far = 100) {
  ray.set(new Vector3(...position), new Vector3(...direction));
  ray.near = 0;
  ray.far = far;
  return ray.intersectObject(scene, true);
}

test('one physical shop prototype joins floor, entrance, finite fixtures and exact solid top support', () => {
  const entrance = tenantWorldPoint(bay, 2.05, 0);
  for (const offset of [-.22, -.0001, 0, .0001, .22]) {
    assert.equal(walking.blocksWalking(entrance.x - offset, entrance.z, 0), false,
      'a joined doorway has no independently inset invisible seam');
  }
  const table = bay.fixtures.find(item => item.id === 'L1-03');
  const p = tenantWorldPoint(bay, table.rect[0] + .10, table.rect[1] + .10);
  const hit = cast(root, [p.x, 1.1, p.z], [0, -1, 0])[0];
  close(hit.point.y, table.height, 'the actual flat top exists');
  close(walking.supportAt(p.x, p.z, 1.1), hit.point.y, 'support matches the generated top');
  assert.equal(walking.blocksWalking(p.x, p.z, .4), true, 'a body cannot cross the table volume');
  assert.equal(walking.blocksWalking(p.x, p.z, table.height), false, 'there is no infinite column above its top');
  close(walking.ceilingAt(p.x, p.z, 0), table.height - .08, 'its real underside constrains a body below it');
  const curtain = tenantWorldPoint(bay, 4.205, 6.285);
  assert.ok(walking.ceilingAt(curtain.x, curtain.z, 0) < 1.15,
    'the cloth above its small floor gap blocks both standing and crouching bodies');
  assert.ok(walking.metrics.meshCount > 0 && walking.metrics.supportTriangles > 0);
});

test('front-store prototype has a real 1.63m open aperture and retained fixed panes', () => {
  const front = new Group();
  buildAtriumFrontShell(front, null);
  front.updateMatrixWorld(true);
  const x = -11.4;
  for (const z of [-2.65, -1.9, -1.15]) {
    const hits = cast(front, [x + .6, 1.4, z], [-1, 0, 0], 1.3);
    assert.equal(hits.length, 0, `open entrance at z=${z} has no fixed glass, centre frame or mark`);
  }
  assert.ok(cast(front, [x + .6, 1.4, -5], [-1, 0, 0], 1.3).length > 0, 'fixed glazing outside the entrance remains');
  const floor = cast(front, [-11.48, .4, -1.9], [0, -1, 0])[0];
  close(floor.point.y, 0, 'the opening has a flush supported floor');
});


const whole = new Group();
await buildAtriumRetail(whole, null);
await buildAtriumFrontCommons(whole, null);
const allWalking = createAtriumTenantWalking(whole);

const genericRoutes = ATRIUM_TENANTS.filter(store => store.id !== 'R2').map(store => {
  const approach = store.side === 'rear' ? -(store.plane - 60) - .5 : -.5;
  return { id: store.id, points: [tenantWorldPoint(store, store.route[0][0], approach),
    ...store.route.map(([u, d]) => tenantWorldPoint(store, u, d))] };
});
for (const store of ATRIUM_FRONT_TENANTS) {
  const u = (store.entryU[0] + store.entryU[1]) / 2;
  genericRoutes.push({ id: `front-${store.id}`, points: [-.5, 0, store.entryRecess, 2.8, store.depth - .45]
    .map(d => atriumFrontTenantPoint(store, u, d)) });
}

test('all 12 generic stores retain continuous standing and crouching main routes and return paths', () => {
  assert.equal(genericRoutes.length, 12);
  for (const route of genericRoutes) {
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .06);
      for (let sample = 0; sample <= steps; sample++) {
        const t = sample / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        assert.equal(allWalking.blocksWalking(x, z, 0), false,
          `${route.id} main route finite solid at (${x.toFixed(3)},${z.toFixed(3)})`);
        assert.ok((allWalking.ceilingAt(x, z, 0) ?? 17.1) >= 1.90 - 1e-6,
          `${route.id} standing body intersects the actual ceiling/fixture underside at (${x.toFixed(3)},${z.toFixed(3)})`);
        close(allWalking.supportAt(x, z, .025), 0, `${route.id} floor support`);
      }
    }
  }
});

class Target {
  listeners = new Map();
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(x => x !== listener)); }
  dispatch(type, event = {}) { for (const listener of this.listeners.get(type) ?? []) listener({ target: this, preventDefault() {}, ...event }); }
  closest() { return null; }
  focus() { globalThis.document.activeElement = this; }
}
function controlsBrowser() {
  const window = new Target(), document = new Target(), canvas = new Target();
  document.body = canvas; document.activeElement = canvas; document.visibilityState = 'visible';
  document.pointerLockElement = null; document.hasFocus = () => true; document.exitPointerLock = () => {};
  const replacements = { window, document, Element: Target, navigator: { getGamepads: () => [] } };
  const restore = Object.entries(replacements).map(([key, value]) => {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    return () => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key];
  });
  return { window, canvas, restore: () => restore.reverse().forEach(fn => fn()) };
}
const navigation = createAtriumNavigation(allWalking);

test('CoastControls physically walks every generic entrance to its rear and back with no relocation inside a store', () => {
  const browser = controlsBrowser(), camera = new PerspectiveCamera();
  const controls = new CoastControls(camera, browser.canvas, {
    onMovementChange() {}, onLockChange() {}, onLockError() {},
  }, navigation);
  try {
    for (const route of genericRoutes) {
      controls.relocate({ ...route.points[0], yaw: 0, pitch: 0 });
      const points = [...route.points.slice(1), ...route.points.slice(0, -1).reverse()];
      for (const point of points) {
        const dx = point.x - camera.position.x, dz = point.z - camera.position.z;
        camera.rotation.y = Math.atan2(-dx, -dz);
        browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
        const frames = Math.round(Math.hypot(dx, dz) / navigation.walkSpeed * 60);
        for (let frame = 0; frame < frames; frame++) controls.update(1 / 60);
        browser.window.dispatch('keyup', { code: 'KeyW' });
        assert.ok(Math.hypot(point.x - camera.position.x, point.z - camera.position.z) < .09,
          `${route.id}: requested (${point.x.toFixed(2)},${point.z.toFixed(2)}), reached (${camera.position.x.toFixed(2)},${camera.position.z.toFixed(2)})`);
        close(camera.position.y, 1.65, `${route.id} standing FL0 eye`);
      }
    }
  } finally { controls.dispose(); browser.restore(); }
});

test('fixed glazing, side/back walls, closed rooms, rear connector heads and wrong upper layers remain closed', () => {
  for (const store of ATRIUM_TENANTS.filter(store => store.id !== 'R2')) {
    const glass = store.frontage.find(segment => segment.kind === 'glass');
    const pane = tenantWorldPoint(store, (glass.u[0] + glass.u[1]) / 2, .055);
    assert.equal(allWalking.blocksWalking(pane.x, pane.z, 0), true, `${store.id} fixed pane`);
    const rear = tenantWorldPoint(store, store.route.at(-1)[0], store.depth - .08);
    assert.equal(allWalking.blocksWalking(rear.x, rear.z, 0), true, `${store.id} finished back closure`);
    const side = tenantWorldPoint(store, .10, store.depth * .5);
    assert.equal(allWalking.blocksWalking(side.x, side.z, 0), true, `${store.id} side closure`);
    const middle = tenantWorldPoint(store, store.route.at(-1)[0], store.depth * .5);
    assert.equal(allWalking.blocksWalking(middle.x, middle.z, 4.55), true, `${store.id} no phantom upper floor`);
  }
  for (const point of [[0, 6], [-7, 5], [7, 5], [0, 5], [23, -30], [-21, -30]]) {
    for (const foot of [0, 4.55, 9.15, 13.55]) {
      assert.equal(allWalking.blocksWalking(...point, foot), true, `closed/nonbuilt room (${point}) at foot ${foot}`);
    }
  }
  for (const point of [[-6, -60.7], [3, -61.2]]) {
    assert.equal(allWalking.blocksWalking(...point, 0), false, 'rear connector is real ground floor');
    assert.equal(allWalking.blocksWalking(...point, 4.55), true, 'rear connector never gains a gallery');
    assert.ok(allWalking.ceilingAt(...point, 0) < 3.7, 'connector preserves its actual low head');
  }
  assert.equal(allWalking.blocksWalking(12.5, -37.6, 0), true,
    'R2 is deliberately left for the expanded cafe custom domain, not the obsolete generic depth');
});

test('actual horizontal mesh faces, including goods, agree with support without filling shelf gaps', () => {
  whole.updateMatrixWorld(true);
  const solidTops = [];
  whole.traverse(object => {
    if (object.isMesh && object.userData.atriumTenantWalkFixture?.kind === 'rigid'
      && ['BoxGeometry', 'RoundedBoxGeometry'].includes(object.geometry.type)) solidTops.push(object);
  });
  let checked = 0;
  for (const store of ATRIUM_TENANTS.filter(store => store.id !== 'R2')) {
    for (const fixture of store.fixtures.filter(item => ['table', 'case', 'counter', 'seat'].includes(item.type))) {
      const [u, d, w, l] = fixture.rect;
      const p = tenantWorldPoint(store, u + w * .28, d + l * .28);
      ray.set(new Vector3(p.x, 1.55, p.z), new Vector3(0, -1, 0)); ray.far = 1.55;
      const hit = ray.intersectObjects(solidTops, false).find(hit => hit.face.normal.clone()
        .transformDirection(hit.object.matrixWorld).y > .9999);
      if (!hit) continue;
      close(allWalking.supportAt(p.x, p.z, 1.55), hit.point.y, `${fixture.id} actual horizontal top`);
      checked++;
    }
  }
  assert.ok(checked >= 30, `actual rendered support faces checked: ${checked}`);
});

test('a normal jump lands on an actual low table and returns to the sales floor without a vertical tunnel', () => {
  const browser = controlsBrowser(), camera = new PerspectiveCamera();
  const controls = new CoastControls(camera, browser.canvas, { onMovementChange() {}, onLockChange() {}, onLockError() {} }, navigation);
  try {
    const start = tenantWorldPoint(bay, 4.30, 3.25);
    controls.relocate({ ...start, yaw: 0, pitch: 0 });
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'Space' });
    controls.update(1 / 60);
    browser.window.dispatch('keyup', { code: 'Space' });
    for (let frame = 0; frame < 12; frame++) controls.update(1 / 60);
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
    for (let frame = 0; frame < 10; frame++) controls.update(1 / 60);
    browser.window.dispatch('keyup', { code: 'KeyW' });
    for (let frame = 0; frame < 80; frame++) controls.update(1 / 60);
    assert.ok(camera.position.z < start.z - .20, `the jump advances above the finite table edge: from ${start.z} to ${camera.position.z}, y=${camera.position.y}`);
    close(camera.position.y, .85 + 1.65, 'the foot rests on the real tabletop');
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyS' });
    for (let frame = 0; frame < 32; frame++) controls.update(1 / 60);
    browser.window.dispatch('keyup', { code: 'KeyS' });
    for (let frame = 0; frame < 50; frame++) controls.update(1 / 60);
    close(camera.position.y, 1.65, 'walking back returns to the supported sales floor');
  } finally { controls.dispose(); browser.restore(); }
});

test('snapshot is value-owned and rounded bevel corners never become rectangular phantom support', async () => {
  const [{ BoxGeometry, Mesh, MeshStandardMaterial }, { RoundedBoxGeometry }] = await Promise.all([
    import('three'), import('three/addons/geometries/RoundedBoxGeometry.js'),
  ]);
  const fixtureRoot = new Group();
  const geometry = new RoundedBoxGeometry(1, .8, 1, 3, .18);
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  mesh.position.set(-13, .4, -3);
  fixtureRoot.add(mesh);
  walkingModule.registerTenantWalkFixture(fixtureRoot, 0, { tenantId: 'front-W', fixtureId: 'rounded-prototype', kind: 'rigid' });
  const snapshot = createAtriumTenantWalking(fixtureRoot);
  close(snapshot.supportAt(-13, -3, 1), .8, 'rounded top centre is a real horizontal face');
  close(snapshot.supportAt(-12.51, -2.51, 1), 0, 'rounded outer corner does not invent a flat top');
  mesh.position.x = 100;
  geometry.dispose(); mesh.removeFromParent();
  close(snapshot.supportAt(-13, -3, 1), .8, 'snapshot has no dependency on detached scene resources');
  const rack = new Mesh(new BoxGeometry(.02, .8, .02), new MeshStandardMaterial());
  rack.position.set(-13, .4, -3); fixtureRoot.add(rack);
  walkingModule.registerTenantWalkFixture(fixtureRoot, 0, { tenantId: 'front-W', fixtureId: 'rack-prototype', kind: 'rack' });
  close(createAtriumTenantWalking(fixtureRoot).supportAt(-13, -3, 1), 0, 'rack registration does not turn a frame into a support slab');
});

test('registered geometry construction and per-store queries have bounded measured CPU cost', t => {
  const samples = genericRoutes.flatMap(route => route.points);
  const started = performance.now();
  const count = 5000;
  for (let index = 0; index < count; index++) {
    const p = samples[index % samples.length];
    allWalking.blocksWalking(p.x, p.z, 0);
    allWalking.ceilingAt(p.x, p.z, 0);
    allWalking.supportAt(p.x, p.z, 1.4);
  }
  t.diagnostic(JSON.stringify({ ...allWalking.metrics, queryTriples: count,
    meanQueryTripleMs: (performance.now() - started) / count }));
  assert.ok(allWalking.metrics.meshCount > 500, 'actual fixtures, goods and mounted primitives were registered');
});

test('a real floating underside distinguishes crouching, safe posture change and jumping from below', async () => {
  const { BoxGeometry, Mesh, MeshStandardMaterial } = await import('three');
  const prototype = new Group();
  const floating = new Mesh(new BoxGeometry(.8, .25, .8), new MeshStandardMaterial());
  floating.position.set(-13, 1.65, -3); prototype.add(floating);
  walkingModule.registerTenantWalkFixture(prototype, 0, { tenantId: 'front-W', fixtureId: 'floating-prototype', kind: 'rigid' });
  const physical = createAtriumTenantWalking(prototype);
  const browser = controlsBrowser(), camera = new PerspectiveCamera();
  const controls = new CoastControls(camera, browser.canvas, { onMovementChange() {}, onLockChange() {}, onLockError() {} }, createAtriumNavigation(physical));
  const key = (type, code) => browser.window.dispatch(type, { target: browser.canvas, code });
  try {
    controls.relocate({ x: -13, z: -4, yaw: Math.PI, pitch: 0 });
    key('keydown', 'KeyW');
    for (let i = 0; i < 35; i++) controls.update(1 / 60);
    key('keyup', 'KeyW');
    assert.ok(camera.position.z < -3.59, 'standing body stops at the real elevated underside');
    key('keydown', 'KeyC'); controls.update(1 / 60); key('keyup', 'KeyC');
    close(controls.eyeHeight, 1.15, 'current posture really is crouched');
    key('keydown', 'KeyW');
    for (let i = 0; i < 16; i++) controls.update(1 / 60);
    key('keyup', 'KeyW');
    assert.ok(camera.position.z > -3.30 && camera.position.z < -2.70, `crouching passes beneath the same real underside: z=${camera.position.z}, y=${camera.position.y}`);
    key('keydown', 'KeyC'); controls.update(1 / 60); key('keyup', 'KeyC');
    close(controls.eyeHeight, 1.15, 'a blocked stand-up request preserves crouching and floor contact');
    close(camera.position.y, 1.15, 'blocked posture change cannot move feet below FL0');
    key('keydown', 'Space'); controls.update(1 / 60); key('keyup', 'Space');
    let highest = camera.position.y;
    for (let i = 0; i < 60; i++) { controls.update(1 / 60); highest = Math.max(highest, camera.position.y); }
    assert.ok(highest <= 1.525 - .25 + 1e-6, 'jumping below cannot pass upward through the floating solid');
    close(camera.position.y, 1.15, 'the crouching body returns to FL0');
  } finally { controls.dispose(); browser.restore(); }
});
