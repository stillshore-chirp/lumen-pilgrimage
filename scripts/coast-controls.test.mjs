import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { getEventListeners } from 'node:events';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Ray, Raycaster, Scene, Triangle, Vector3 } from 'three';
import { createDesktopGrabOcclusion } from '../src/coast/desktopGrabOcclusion.ts';
import { blocksPavilionFlight, pavilionDomeProfile, PAVILION_DOME } from '../src/coast/world/overlook/overlookPavilionPlan.ts';
import {
  COAST_REST_SITES, COAST_WALKS, FOREST_WALKS, INARI_WALKS, UPLAND_LAKE, UPLAND_WALKS,
  groundHeight, restSiteYaw, SEA_LEVEL, SPAWN,
} from '../src/coast/terrain.ts';

const soundControlsUrl = new URL('../src/coast/CoastSoundControls.ts', import.meta.url).href;
const controlsUrl = new URL('../src/coast/CoastControls.ts', import.meta.url).href;
// Vite resolves the extensionless terrain import in the app. Resolve that same file in the Node test.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './explorationSound' && context.parentURL === soundControlsUrl) return nextResolve('./explorationSound.ts', context);
    const path = specifier === './terrain' && context.parentURL === controlsUrl ? './terrain.ts' : specifier;
    return nextResolve(path, context);
  },
});
const { CoastControls } = await import(controlsUrl);
const { bindCoastSoundControls } = await import(soundControlsUrl);
hooks.deregister();

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener));
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, target: this, preventDefault() {}, ...event });
    }
  }
}

class FakeElement extends FakeEventTarget {
  closest() { return null; }
  focus() { globalThis.document.activeElement = this; }
}

function overrideGlobal(name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => original
    ? Object.defineProperty(globalThis, name, original)
    : delete globalThis[name];
}

function createBrowser(gamepads = []) {
  const fakeWindow = new FakeEventTarget();
  const fakeDocument = new FakeEventTarget();
  fakeDocument.body = new FakeElement();
  fakeDocument.activeElement = fakeDocument.body;
  fakeDocument.pointerLockElement = null;
  fakeDocument.visibilityState = 'visible';
  fakeDocument.hasFocus = () => true;
  fakeDocument.exitPointerLock = () => { fakeDocument.pointerLockElement = null; };
  const canvas = new FakeElement();
  fakeDocument.activeElement = canvas;
  const restore = [
    overrideGlobal('window', fakeWindow),
    overrideGlobal('document', fakeDocument),
    overrideGlobal('Element', FakeElement),
    overrideGlobal('navigator', { getGamepads: () => gamepads })
  ];

  return {
    canvas,
    document: fakeDocument,
    window: fakeWindow,
    cleanup: () => restore.reverse().forEach(restoreGlobal => restoreGlobal())
  };
}

function createControls(browser, camera, callbacks = {}, navigation) {
  return new CoastControls(camera, browser.canvas, {
    onMovementChange: callbacks.onMovementChange ?? (() => {}),
    onLockChange: callbacks.onLockChange ?? (() => {}),
    onLockError: callbacks.onLockError ?? (() => {}),
    onGrabKey: callbacks.onGrabKey,
    diveObstacleHeight: callbacks.diveObstacleHeight
  }, navigation);
}

test('walking passes through each coastal rest bench at ground level', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    for (const site of COAST_REST_SITES) {
      const yaw = restSiteYaw(site);
      const east = Math.sin(yaw);
      const south = Math.cos(yaw);
      controls.relocate({ x: site.x - east * 0.9, z: site.z - south * 0.9, yaw: yaw + Math.PI, pitch: 0 });
      browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
      for (let frame = 0; frame < 7; frame += 1) controls.update(0.04);
      const { x, y, z } = camera.position;
      const pastBench = (x - site.x) * east + (z - site.z) * south;
      assert.ok(pastBench > 0.75, `${site.id} blocked walking after ${pastBench.toFixed(2)} m`);
      assert.equal(controls.currentMovement, 'walk');
      assert.ok(Math.abs(y - groundHeight(x, z) - 1.65) < 1e-6);
    }
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('F gives grabbing priority and preserves flight when no target accepts it', () => {
  const browser = createBrowser();
  let grabCount = 0;
  let hasTarget = true;
  const controls = createControls(browser, new PerspectiveCamera(), {
    onGrabKey: () => {
      ++grabCount;
      return hasTarget;
    },
  });
  const press = (options = {}) => {
    let prevented = false;
    browser.window.dispatch('keydown', {
      code: 'KeyF', target: browser.canvas, preventDefault: () => { prevented = true; }, ...options,
    });
    return prevented;
  };

  try {
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { defaultPrevented: true }]) {
      assert.equal(press(options), false);
    }
    assert.equal(grabCount, 0);
    assert.equal(press(), true);
    assert.equal(press({ repeat: true }), true);
    assert.equal(grabCount, 1);
    assert.equal(controls.currentMovement, 'walk');

    hasTarget = false;
    assert.equal(press(), true);
    assert.equal(grabCount, 2);
    assert.equal(controls.currentMovement, 'flight');

    controls.setDesktopInputEnabled(false);
    assert.equal(press(), false);
    assert.equal(grabCount, 2);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('only visible opaque surfaces in front of the grab target block the aim ray', () => {
  const scene = new Scene();
  const target = new Group();
  const geometry = new BoxGeometry(1, 1, 0.1);
  const material = new MeshBasicMaterial();
  const wall = new Mesh(geometry, material);
  const wallParent = new Group();
  scene.add(wallParent, target);
  wallParent.add(wall);
  target.add(new Mesh(geometry, material));
  target.position.z = -3;
  wall.position.z = -1;
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, -1));
  const isOccluded = createDesktopGrabOcclusion(scene);

  assert.equal(isOccluded(ray, target, 3), true);
  wallParent.visible = false;
  assert.equal(isOccluded(ray, target, 3), false);
  wallParent.visible = true;
  material.transparent = true;
  assert.equal(isOccluded(ray, target, 3), false);
  material.transparent = false;
  wall.position.z = -4;
  assert.equal(isOccluded(ray, target, 3), false);
});

test('walking approaches a steep cliff without crossing it or losing ground contact', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    const startX = 111;
    const steepZ = -141.9;
    assert.ok(groundHeight(startX, steepZ) > 0.08, 'slope fixture must start on dry ground');
    camera.position.set(startX, groundHeight(startX, steepZ) + 1.65, steepZ);
    camera.rotation.x = 0;
    camera.rotation.y = 0;
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW', repeat: false });
    for (let frame = 0; frame < 10; frame += 1) controls.update(0.001);
    assert.equal(camera.position.z, steepZ, 'small frame steps climbed a slope above the walk limit');

    const startZ = -140.5;
    camera.position.set(startX, groundHeight(startX, startZ) + 1.65, startZ);
    for (let frame = 0; frame < 40; frame += 1) controls.update(0.05);

    assert.ok(camera.position.z < startZ - 0.1, `player did not approach the cliff: ${camera.position.z}`);
    assert.ok(camera.position.z > steepZ, `player crossed the cliff: ${camera.position.z}`);
    assert.ok(Math.abs(camera.position.y - groundHeight(camera.position.x, camera.position.z) - 1.65) < 1e-6);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('low flight meets a cliff without snapping the camera upward', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    const x = 111;
    const z = -144.5;
    const startY = groundHeight(x, z) + 1.65;
    camera.position.set(x, startY, z);
    camera.rotation.x = 0;
    camera.rotation.y = 0;
    controls.toggleFlight();
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW', repeat: false });
    controls.update(0.05);

    assert.ok(camera.position.z <= z && camera.position.z > z - 20.5 * .05,
      'flight retains only the clear portion of the horizontal step');
    assert.ok(camera.position.y >= groundHeight(x, camera.position.z) + .25,
      'the retained sample remains above the actual cliff surface');
    assert.equal(camera.position.y, startY, 'flight was pushed vertically to the cliff top');
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('flight sweeps vertical and diagonal paths and retains the last safe height', async t => {
  for (const direction of ['up', 'down', 'diagonal']) {
    await t.test(direction, () => {
      const browser = createBrowser();
      const camera = new PerspectiveCamera();
      const samples = [];
      const controls = createControls(browser, camera, {}, {
        bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
        spawn: { x: 0, z: 0, yaw: 0, pitch: 0 }, groundHeight: () => 0, flightCeiling: 10,
        blocksFlight: (_x, _z, eyeY, clearance) => {
          samples.push({ eyeY, clearance });
          return eyeY >= 2 - clearance && eyeY <= 2.2 + clearance;
        },
      });
      try {
        if (direction === 'down') camera.position.y = 3.2;
        controls.toggleFlight();
        const key = code => browser.window.dispatch('keydown', { target: browser.canvas, code });
        key(direction === 'down' ? 'KeyC' : 'Space');
        if (direction === 'diagonal') key('KeyW');
        for (let frame = 0; frame < 5; frame++) controls.update(0.05);
        assert.ok(samples.length > 0, 'pure vertical travel must be sampled');
        assert.ok(samples.every(sample => sample.clearance === .25 && Number.isFinite(sample.eyeY)));
        if (direction === 'down') {
          assert.ok(camera.position.y > 2.45 && camera.position.y < 3.2, 'descent retains the clear sample above the volume');
        } else {
          assert.ok(camera.position.y < 1.75, 'upward movement never commits a height inside or beyond the volume');
        }
      } finally {
        controls.dispose(); browser.cleanup();
      }
    });
  }
});

test('XR flight applies the height-aware volume to the actual head and permits retreat', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera, {}, {
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    spawn: { x: 0, z: 0, yaw: 0, pitch: 0 }, groundHeight: () => 0, flightCeiling: 10,
    blocksWalking: () => true,
    blocksFlight: (_x, _z, eyeY, clearance) => eyeY >= 2.4 - clearance && eyeY <= 3 + clearance,
  });
  const motion = { forward: 0, right: 0, vertical: 0, jump: false, dive: false, flight: false };
  try {
    controls.toggleFlight();
    const view = { yaw: 0, headOffset: new Vector3(0, .45, 0) };
    controls.updateXR(.05, { ...motion, vertical: 1 }, view);
    assert.equal(camera.position.y, 1.65, 'the head, not just the locomotion origin, stops at the underside');
    const overlappedView = { yaw: 0, headOffset: new Vector3(0, .7, 0) };
    controls.updateXR(.05, { ...motion, vertical: 1 }, overlappedView);
    assert.equal(camera.position.y, 1.65, 'existing head overlap cannot advance upward');
    controls.updateXR(.05, { ...motion, vertical: -1 }, overlappedView);
    assert.ok(camera.position.y < 1.5, 'descending away from an existing head overlap remains possible');
    camera.position.y = 4;
    controls.updateXR(.05, { ...motion, forward: 1 }, view);
    assert.ok(camera.position.z < 0, 'above the roof, the walking footprint does not become an infinite head wall');
  } finally {
    controls.dispose(); browser.cleanup();
  }
});

test('legacy planar flight blockers retain horizontal stops and allow vertical movement', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera, {}, {
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    spawn: { x: 0, z: 0, yaw: 0, pitch: 0 }, groundHeight: () => 0, flightCeiling: 10,
    blocksFlight: (_x, z) => z <= -.5,
  });
  try {
    controls.toggleFlight();
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
    controls.update(.05);
    assert.ok(camera.position.z < 0 && camera.position.z > -.5);
    const stoppedZ = camera.position.z;
    browser.window.dispatch('keyup', { code: 'KeyW' });
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'Space' });
    controls.update(.05);
    assert.equal(camera.position.z, stoppedZ);
    assert.ok(camera.position.y > 2.5);
  } finally {
    controls.dispose(); browser.cleanup();
  }
});

test('pavilion flight clearance follows the stepped roofs and dome without restricting high airspace', () => {
  assert.equal(blocksPavilionFlight(0, 20, 3, .25), true, 'main body remains closed');
  assert.equal(blocksPavilionFlight(16.8, 16, 7.6, .25), false, 'air above the low east roof remains available');
  assert.equal(blocksPavilionFlight(16.8, 27, 8, .25), true, 'raised rear east roof is solid');
  assert.equal(blocksPavilionFlight(-21.7, 21, 9.4, .25), true, 'west roof tower is solid');
  assert.equal(blocksPavilionFlight(0, 19.1, 16, .25), true, 'dome interior is solid');
  assert.equal(blocksPavilionFlight(7.5, 19.1, 16, .25), false, 'the tapered dome has no full-height cylindrical wall');
  for (const [x, z] of [[0, 20], [16.8, 27], [-21.7, 21]]) {
    assert.equal(blocksPavilionFlight(x, z, 54, .25), false, 'air at world Y400 remains open');
  }
});

test('dome clearance includes crown and sloping normals on both sides of the boundary', () => {
  assert.equal(blocksPavilionFlight(.7, 19.1, 18.11, .25), true, 'camera sphere cannot enter the dome crown');
  const profile = pavilionDomeProfile();
  const shell = Math.max(PAVILION_DOME.seamOffset + PAVILION_DOME.seamRadius,
    Math.hypot(PAVILION_DOME.raisedPanelOffset, PAVILION_DOME.raisedPanelRise));
  for (const index of [4, 10, 16]) {
    const a = profile[index], b = profile[index + 1];
    const dr = b.radius - a.radius, dy = b.height - a.height, length = Math.hypot(dr, dy);
    for (const epsilon of [-.00001, .00001]) {
      const distance = .25 + shell + epsilon;
      const x = (a.radius + b.radius) / 2 + dy / length * distance;
      const y = PAVILION_DOME.spring + (a.height + b.height) / 2 - dr / length * distance;
      assert.equal(blocksPavilionFlight(x, 19.1, y, .25), epsilon < 0,
        `dome segment ${index}, normal boundary ${epsilon}`);
    }
  }
});

test('a diagonal at the edge of the east trail slides along the traversable axis', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    const x = 133;
    const z = -13;
    camera.position.set(x, groundHeight(x, z) + 1.65, z);
    camera.rotation.set(0, 0, 0);
    for (const code of ['KeyW', 'KeyA']) browser.window.dispatch('keydown', { target: browser.canvas, code });
    controls.update(0.015);
    assert.ok(Math.hypot(camera.position.x - x, camera.position.z - z) > 0.04,
      'a diagonal input stalled even though part of the movement was walkable');
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('a steep descent can be entered and lands at the surface', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    const x = 115;
    const z = -6;
    camera.position.set(x, groundHeight(x, z) + 1.65, z);
    camera.rotation.set(0, 0, 0);
    for (const code of ['KeyW', 'KeyA']) browser.window.dispatch('keydown', { target: browser.canvas, code });
    controls.update(0.015);
    assert.ok(camera.position.x < x - 0.04 && camera.position.z < z - 0.04);
    for (const code of ['KeyW', 'KeyA']) browser.window.dispatch('keyup', { code });
    for (let frame = 0; frame < 30; frame += 1) controls.update(0.05);
    assert.ok(Math.abs(camera.position.y - groundHeight(camera.position.x, camera.position.z) - 1.65) < 1e-6);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('Space jumps once per press, lands, and works again after releasing', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    const startY = camera.position.y;
    assert.equal(controls.isGrounded, true);
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'Space' });
    let apex = startY;
    for (let frame = 0; frame < 120; frame += 1) {
      browser.window.dispatch('keydown', { target: browser.canvas, code: 'Space', repeat: true });
      controls.update(1 / 60);
      apex = Math.max(apex, camera.position.y);
      if (camera.position.y > startY + 0.08) assert.equal(controls.isGrounded, false);
      if (frame > 55) assert.ok(Math.abs(camera.position.y - startY) < 1e-6, 'held Space triggered another jump');
    }
    assert.equal(controls.isGrounded, true);
    assert.ok(apex - startY > 1.0 && apex - startY < 1.5, `jump height: ${apex - startY}`);
    browser.window.dispatch('keyup', { code: 'Space' });
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'Space' });
    controls.update(1 / 60);
    assert.ok(camera.position.y > startY + 0.08);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('indoor jumps settle after hitting the ceiling and flying respects lower adjacent ceilings', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera, {}, {
    bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    spawn: { x: 0, z: 0, yaw: 0, pitch: 0 },
    groundHeight: () => 0,
    flightCeiling: 3,
    ceilingHeight: (_x, z) => z < -.7 ? 2.2 : 3,
  });
  try {
    const key = (type, code) => browser.window.dispatch(type, { code, target: browser.canvas });
    const advance = frames => {
      for (let frame = 0; frame < frames; frame++) controls.update(0.05);
    };

    key('keydown', 'Space');
    let apex = camera.position.y;
    for (let frame = 0; frame < 24; frame++) {
      advance(1);
      apex = Math.max(apex, camera.position.y);
    }
    assert.equal(apex, 2.75);
    assert.equal(camera.position.y, 1.65);
    key('keyup', 'Space');

    key('keydown', 'KeyF');
    key('keydown', 'Space');
    advance(4);
    assert.equal(controls.currentMovement, 'flight');
    assert.equal(camera.position.y, 2.75);
    key('keyup', 'Space');
    key('keydown', 'KeyW');
    key('keydown', 'ShiftLeft');
    advance(2);
    assert.ok(camera.position.z >= -.7);
    key('keyup', 'KeyW');
    key('keyup', 'ShiftLeft');

    key('keydown', 'KeyC');
    advance(5);
    assert.equal(camera.position.y, .25);
    key('keyup', 'KeyC');
    key('keydown', 'KeyW');
    advance(2);
    assert.ok(camera.position.z < -1);
    key('keyup', 'KeyW');
    key('keyup', 'KeyF');
    key('keydown', 'KeyF');
    assert.equal(controls.currentMovement, 'walk');
    assert.equal(camera.position.y, 1.65);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('ending flight aloft reports ground contact only after reaching the floor', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    controls.toggleFlight();
    assert.equal(controls.isGrounded, false);
    camera.position.y += 2;
    controls.toggleFlight();
    assert.equal(controls.currentMovement, 'walk');
    assert.equal(controls.isGrounded, false);
    for (let i = 0; i < 40; i += 1) controls.update(1 / 60);
    assert.equal(controls.isGrounded, true);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('C changes eye height only and preserves walking, sprinting and jumping', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  const down = (code, options = {}) => browser.window.dispatch('keydown', { target: browser.canvas, code, ...options });
  const up = code => browser.window.dispatch('keyup', { code });
  const tap = code => { down(code); up(code); };
  const move = sprint => {
    if (sprint) down('ShiftLeft');
    down('KeyW');
    for (let frame = 0; frame < 5; frame += 1) controls.update(0.05);
    up('KeyW');
    up('ShiftLeft');
    return camera.position.z;
  };

  try {
    const start = camera.position.clone();
    down('KeyC');
    controls.update(0.05);
    down('KeyC', { repeat: true });
    controls.update(0.05);
    up('KeyC');
    assert.equal(controls.currentMovement, 'crouch');
    assert.equal(controls.eyeHeight, 1.15);
    assert.deepEqual(camera.position.toArray(), [start.x, start.y - 0.5, start.z]);

    tap('KeyC');
    controls.update(0.05);
    assert.equal(controls.currentMovement, 'walk');
    assert.deepEqual(camera.position.toArray(), start.toArray());

    tap('KeyC');
    tap('KeyC');
    controls.update(0.05);
    assert.equal(controls.currentMovement, 'walk');

    for (const sprint of [false, true]) {
      const standing = move(sprint);
      controls.relocate(SPAWN);
      tap('KeyC');
      controls.update(0.05);
      assert.equal(move(sprint), standing);
      const { x, y, z } = camera.position;
      assert.ok(Math.abs(y - groundHeight(x, z) - 1.15) < 1e-6);
      controls.relocate(SPAWN);
      assert.equal(controls.currentMovement, 'walk');
      assert.deepEqual(camera.position.toArray(), start.toArray());
    }

    tap('KeyC');
    controls.update(0.05);
    tap('Space');
    controls.update(0.05);
    assert.ok(camera.position.y > start.y - 0.5 + 0.3);
    tap('KeyC');
    for (let frame = 0; frame < 20; frame += 1) controls.update(0.05);
    assert.equal(controls.currentMovement, 'crouch');
    assert.deepEqual(camera.position.toArray(), [start.x, start.y - 0.5, start.z]);

    tap('KeyF');
    assert.equal(controls.currentMovement, 'flight');
    assert.equal(camera.position.y, start.y);
    down('Space');
    controls.update(0.05);
    up('Space');
    const airborne = camera.position.y;
    down('KeyC');
    controls.update(0.05);
    up('KeyC');
    assert.ok(camera.position.y < airborne - 0.9);
    assert.equal(controls.currentMovement, 'flight');
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('a queued crouch is cleared by blur and key repeat does not toggle after refocus', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  const press = options => browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyC', ...options });
  try {
    press({ metaKey: true });
    controls.update(0.05);
    assert.equal(controls.currentMovement, 'walk');
    press();
    browser.window.dispatch('blur');
    browser.window.dispatch('focus');
    press({ repeat: true });
    controls.update(0.05);
    assert.equal(controls.currentMovement, 'walk');
    browser.window.dispatch('keyup', { code: 'KeyC' });
    press();
    controls.update(0.05);
    assert.equal(controls.currentMovement, 'crouch');
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('gamepad A jumps on land and Space does not lift a swimmer out of deep water', () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const browser = createBrowser([{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }]);
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    const startY = camera.position.y;
    buttons[0] = { pressed: true, value: 1 };
    controls.update(1 / 60);
    assert.ok(camera.position.y > startY + 0.08);
    buttons[0] = { pressed: false, value: 0 };
    camera.position.set(30, 0.63, -10);
    for (let frame = 0; frame < 25; frame += 1) controls.update(0.05);
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'Space' });
    controls.update(0.05);
    assert.ok(Math.abs(camera.position.y - 0.63) < 1e-6);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('walking starts when document focus returns after the focus notification', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  const move = () => browser.window.dispatch('keydown', { target: browser.document.body, code: 'KeyW' });
  let focused = false;
  browser.document.hasFocus = () => focused;
  browser.document.activeElement = browser.document.body;

  try {
    browser.window.dispatch('focus');
    move();
    controls.update(0.05);
    assert.equal(camera.position.z, SPAWN.z);

    focused = true;
    controls.update(0.05);
    assert.equal(camera.position.z, SPAWN.z);
    move();
    controls.update(0.05);
    assert.ok(camera.position.z < SPAWN.z - 0.25);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('gamepad Y toggles on press edges and does not trigger while focus is lost', () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const gamepad = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons };
  const browser = createBrowser([gamepad]);
  const camera = new PerspectiveCamera();
  const modes = [];
  const controls = createControls(browser, camera, { onMovementChange: mode => modes.push(mode) });
  const setY = pressed => { buttons[3] = { pressed, value: Number(pressed) }; };

  try {
    setY(true);
    controls.update(0);
    controls.update(0);
    setY(false);
    controls.update(0);
    let focused = false;
    browser.document.hasFocus = () => focused;
    browser.window.dispatch('blur');
    setY(true);
    controls.update(0);
    browser.window.dispatch('focus');
    focused = true;
    controls.update(0);
    assert.deepEqual(modes, ['flight']);

    setY(false);
    controls.update(0);
    setY(true);
    controls.update(0);
    assert.deepEqual(modes, ['flight', 'walk']);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('crouch ends when walking into the water, and swimming again leads to standing on land', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const modes = [];
  const controls = createControls(browser, camera, { onMovementChange: mode => modes.push(mode) });
  const move = (key, frames) => {
    browser.window.dispatch('keydown', { target: browser.canvas, code: key });
    for (let i = 0; i < frames; i += 1) controls.update(0.05);
    browser.window.dispatch('keyup', { target: browser.canvas, code: key });
  };
  try {
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyC' });
    controls.update(0.05);
    assert.equal(controls.currentMovement, 'crouch');
    move('KeyW', 133);
    browser.window.dispatch('keyup', { code: 'KeyC' });
    assert.deepEqual(modes, ['crouch', 'wade', 'swim']);
    assert.ok(groundHeight(camera.position.x, camera.position.z) < SEA_LEVEL - 1.1);
    assert.ok(camera.position.y > SEA_LEVEL + 0.4 && camera.position.y < SEA_LEVEL + 1);
    move('KeyS', 152);
    assert.deepEqual(modes, ['crouch', 'wade', 'swim', 'wade', 'walk']);
    assert.ok(camera.position.z >= SPAWN.z - 1.0);
    assert.ok(Math.abs(camera.position.y - groundHeight(camera.position.x, camera.position.z) - 1.65) < 1e-6);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('C starts a dive, release holds depth, and Space resurfaces for travel onto land', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const modes = [];
  const controls = createControls(browser, camera, { onMovementChange: mode => modes.push(mode) });
  const hold = code => browser.window.dispatch('keydown', { target: browser.canvas, code });
  const release = code => browser.window.dispatch('keyup', { code });
  const update = frames => {
    for (let i = 0; i < frames; i += 1) {
      controls.update(0.05);
      assert.ok(camera.position.y > groundHeight(camera.position.x, camera.position.z));
    }
  };
  try {
    camera.position.set(-12, SEA_LEVEL + 0.63, 49);
    camera.rotation.set(0, 0, 0);
    update(2);
    hold('KeyC');
    release('KeyC');
    update(12);
    assert.equal(controls.currentMovement, 'dive');
    const diveY = camera.position.y;
    assert.ok(diveY < SEA_LEVEL - 0.5);
    update(20);
    assert.equal(camera.position.y, diveY);

    hold('KeyW');
    update(10);
    release('KeyW');
    assert.ok(camera.position.z < 47.3);
    assert.equal(camera.position.y, diveY);

    hold('Space');
    release('Space');
    update(20);
    assert.equal(controls.currentMovement, 'swim');
    assert.ok(Math.abs(camera.position.y - SEA_LEVEL - 0.63) < 1e-6);
    hold('KeyS');
    update(140);
    assert.deepEqual(modes, ['swim', 'dive', 'swim', 'wade', 'walk']);
    assert.ok(camera.position.z > 68);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('gamepad B descends to the seabed and A surfaces without a jump', () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  const browser = createBrowser([{ connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons }]);
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  const setButton = (index, pressed) => { buttons[index] = { pressed, value: Number(pressed) }; };
  try {
    camera.position.set(30, SEA_LEVEL + 0.63, 58);
    setButton(1, true);
    for (let i = 0; i < 40; i += 1) controls.update(0.05);
    assert.equal(controls.currentMovement, 'dive');
    assert.ok(camera.position.y - groundHeight(30, 58) > 0.5);
    assert.ok(camera.position.y - groundHeight(30, 58) < 0.8);
    const bottomY = camera.position.y;
    setButton(1, false);
    for (let i = 0; i < 20; i += 1) controls.update(0.05);
    assert.equal(camera.position.y, bottomY);
    setButton(0, true);
    for (let i = 0; i < 40; i += 1) controls.update(0.05);
    assert.equal(controls.currentMovement, 'swim');
    assert.ok(Math.abs(camera.position.y - SEA_LEVEL - 0.63) < 1e-6);
    setButton(0, false);
    controls.update(0.05);
    setButton(1, true);
    for (let i = 0; i < 40; i += 1) controls.update(0.05);
    assert.equal(camera.position.y, bottomY);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('a shelving seabed brings a diver back to the surface before reaching the beach', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const modes = [];
  const controls = createControls(browser, camera, { onMovementChange: mode => modes.push(mode) });
  try {
    camera.position.set(-12, SEA_LEVEL + 0.63, 55);
    camera.rotation.set(0, 0, 0);
    controls.update(0.05);
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyC' });
    for (let i = 0; i < 15; i += 1) controls.update(0.05);
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyS' });
    for (let i = 0; i < 110; i += 1) controls.update(0.05);
    assert.deepEqual(modes, ['swim', 'dive', 'wade', 'walk']);
    assert.ok(camera.position.z > 68);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('an underwater cliff blocks horizontal travel at the bottom', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    camera.position.set(99, SEA_LEVEL + 0.63, -133.5);
    camera.rotation.set(0, 0, 0);
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyC' });
    for (let i = 0; i < 80; i += 1) controls.update(0.05);
    const startY = camera.position.y;
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyS' });
    for (let i = 0; i < 40; i += 1) controls.update(0.05);
    assert.equal(controls.currentMovement, 'dive');
    assert.ok(camera.position.z < -132.5);
    assert.ok(camera.position.y - startY < 0.2);
    assert.ok(camera.position.y > groundHeight(camera.position.x, camera.position.z));
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('a submerged rock blocks a deep dive and leaves room to swim over it', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const rockHeight = SEA_LEVEL - 1.65;
  const rock = new Triangle(new Vector3(-12.8, rockHeight, 49.5), new Vector3(-11.2, rockHeight, 49.5),
    new Vector3(-12, rockHeight, 48.5));
  const down = new Ray(new Vector3(), new Vector3(0, -1, 0));
  const hit = new Vector3();
  const controls = createControls(browser, camera, {
    diveObstacleHeight(x, z) {
      down.origin.set(x, SEA_LEVEL, z);
      return down.intersectTriangle(rock.a, rock.b, rock.c, false, hit)?.y;
    },
  });
  const hold = code => browser.window.dispatch('keydown', { target: browser.canvas, code });
  const release = code => browser.window.dispatch('keyup', { code });
  const update = frames => { for (let i = 0; i < frames; i += 1) controls.update(0.05); };
  try {
    camera.position.set(-12, SEA_LEVEL + 0.63, 50.3);
    camera.rotation.set(0, 0, 0);
    hold('KeyC');
    update(25);
    hold('KeyW');
    update(15);
    assert.equal(controls.currentMovement, 'dive');
    assert.ok(camera.position.y < rockHeight && camera.position.z >= 49.5 && camera.position.z < 49.7);

    release('KeyW');
    release('KeyC');
    hold('Space');
    release('Space');
    update(25);
    assert.equal(controls.currentMovement, 'swim');
    hold('KeyC');
    release('KeyC');
    update(15);
    hold('KeyW');
    update(3);
    release('KeyW');
    assert.ok(camera.position.z < 49.5 && camera.position.z > 48.5);
    assert.ok(camera.position.y > rockHeight);

    hold('KeyC');
    update(15);
    assert.ok(camera.position.y - rockHeight > 0.5 && camera.position.y - rockHeight < 0.8);
    hold('KeyW');
    update(8);
    assert.ok(camera.position.z < 48.5);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('ending flight above deep water settles into swimming at the same horizontal position', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const modes = [];
  const controls = createControls(browser, camera, { onMovementChange: mode => modes.push(mode) });
  try {
    controls.toggleFlight();
    camera.position.set(30, 12, -10);
    controls.toggleFlight();
    for (let i = 0; i < 60; i += 1) controls.update(0.05);
    assert.equal(modes.at(-1), 'swim');
    assert.equal(camera.position.x, 30);
    assert.equal(camera.position.z, -10);
    assert.ok(camera.position.y > SEA_LEVEL && camera.position.y < SEA_LEVEL + 1);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('dry land, open water and free flight use the faster travel speeds', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  const travelForHalfSecond = () => {
    const start = camera.position.z;
    for (let frame = 0; frame < 10; frame += 1) controls.update(0.05);
    return start - camera.position.z;
  };
  try {
    camera.rotation.set(0, 0, 0);
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
    assert.ok(Math.abs(travelForHalfSecond() - 3.2) < 1e-6);
    camera.position.set(30, 0.63, -10);
    assert.ok(Math.abs(travelForHalfSecond() - 2.05) < 1e-6);
    camera.position.set(30, 100, -10);
    controls.toggleFlight();
    assert.ok(Math.abs(travelForHalfSecond() - 10.25) < 1e-6);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('walking near the edge of the ravine tread passes the inside of its bend', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    const x = -60.9333, z = 308.4256;
    camera.position.set(x, groundHeight(x, z) + 1.65, z);
    camera.rotation.set(0, Math.atan2(-0.3327, -0.9430), 0);
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
    for (let frame = 0; frame < 24; frame += 1) controls.update(1 / 60);
    assert.ok(camera.position.z > z + 2, 'walking stopped on the worn part of the bend');
    assert.equal(controls.currentMovement, 'walk');
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('the upland lake uses its own water level for floating, diving, and surfacing', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  const { x, z, level } = UPLAND_LAKE;
  const press = code => browser.window.dispatch('keydown', { target: browser.canvas, code });
  const release = code => browser.window.dispatch('keyup', { code });
  const advance = frames => { for (let frame = 0; frame < frames; frame++) controls.update(0.05); };
  try {
    camera.position.set(x, level + 0.63, z);
    advance(1);
    assert.equal(controls.currentMovement, 'swim');
    press('KeyC');
    advance(18);
    release('KeyC');
    assert.equal(controls.currentMovement, 'dive');
    assert.ok(camera.position.y < level - 1 && camera.position.y > groundHeight(x, z));
    press('Space');
    advance(26);
    assert.equal(controls.currentMovement, 'swim');
    assert.ok(Math.abs(camera.position.y - level - 0.63) < 0.0001);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('walking connects the beach, forest, lake, ridge and both vermilion stairs', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const modes = [];
  const controls = createControls(browser, camera, { onMovementChange: mode => modes.push(mode) });
  const walkThrough = (id, points) => {
    for (const point of points) {
      for (let frame = 0; frame < 48; frame += 1) {
        const dx = point.x - camera.position.x;
        const dz = point.z - camera.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.035) break;
        camera.rotation.set(0, Math.atan2(-dx, -dz), 0);
        controls.update(Math.min(0.05, distance / 6.4));
      }
      assert.ok(Math.hypot(point.x-camera.position.x, point.z-camera.position.z) < 0.08,
        `${id} trail is blocked near (${Math.round(point.x)}, ${Math.round(point.z)})`);
    }
  };
  try {
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
    const [approach, ravine, ford, headwater] = FOREST_WALKS;
    const entrance = approach.points[0];
    const coastAccess = [...COAST_WALKS[0].points].reverse();
    const startOfForest = coastAccess.findIndex(point => Math.hypot(point.x - entrance.x, point.z - entrance.z) < 0.08);
    assert.ok(startOfForest > 0);
    walkThrough('beach to forest', coastAccess.slice(0, startOfForest + 1));
    walkThrough(approach.id, approach.points);
    walkThrough(ravine.id, ravine.points);
    const [saddle, lake, ridge] = UPLAND_WALKS;
    walkThrough(saddle.id, saddle.points);
    walkThrough(lake.id, lake.points);
    const ridgeStart = ridge.points[0];
    const lakeToRidge = lake.points.findIndex(point => Math.hypot(point.x - ridgeStart.x, point.z - ridgeStart.z) < 0.06);
    assert.ok(lakeToRidge > 0);
    walkThrough('lake to ridge', lake.points.slice(1, lakeToRidge + 1));
    walkThrough(ridge.id, ridge.points);
    const [vermilionApproach, westSteps, eastSteps, hillsideReturn] = INARI_WALKS;
    walkThrough(vermilionApproach.id, vermilionApproach.points);
    walkThrough(westSteps.id, westSteps.points);
    walkThrough('west stairs downhill', [...westSteps.points].reverse());
    walkThrough(eastSteps.id, eastSteps.points);
    walkThrough(hillsideReturn.id, hillsideReturn.points);
    const oldOverlook = ford.points.at(-1);
    camera.position.set(oldOverlook.x, groundHeight(oldOverlook.x, oldOverlook.z) + 1.65, oldOverlook.z);
    walkThrough(ford.id, [...ford.points].reverse());
    const creekFork = headwater.points[0];
    walkThrough('fork to headwater', ford.points.slice(0,
      ford.points.findIndex(point => Math.hypot(point.x - creekFork.x, point.z - creekFork.z) < 0.08) + 1));
    walkThrough(headwater.id, headwater.points);

    for (const { id, points } of COAST_WALKS) {
      const start = points[0];
      camera.position.set(start.x, groundHeight(start.x, start.z) + 1.65, start.z);
      walkThrough(id, points.slice(1));
    }
    assert.ok(modes.includes('wade'), 'the forest ford did not enter shallow water');
    assert.equal(modes.at(-1), 'walk');
    assert.ok(modes.every(mode => mode === 'walk' || mode === 'wade'));
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('XR walking, flying and diving can retreat from head clearance without diagonal motion advancing into it', async t => {
  for (const mode of ['walk', 'flight', 'dive']) {
    await t.test(mode, () => {
      const browser = createBrowser();
      const camera = new PerspectiveCamera();
      const controls = createControls(browser, camera, {}, {
        bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
        spawn: { x: 0, z: 0, yaw: -Math.PI / 2, pitch: 0 },
        groundHeight: () => mode === 'dive' ? -3 : 0,
        waterLevel: () => mode === 'dive' ? 2 : -Infinity,
        blocksWalking: x => x >= .35,
        flightCeiling: 10,
      });
      try {
        const view = { yaw: -Math.PI / 2, headOffset: new Vector3(.45, 0, .45) };
        const motion = { forward: 0, right: 0, vertical: 0, jump: false, dive: false, flight: false };
        controls.updateXR(.025, { ...motion, flight: mode === 'flight', dive: mode === 'dive' }, view);
        assert.equal(controls.currentMovement, mode);
        for (let frame = 0; frame < 15; frame += 1) {
          controls.updateXR(.025, { ...motion, forward: .6, right: -.8 }, view);
        }
        assert.ok(camera.position.x <= .001, 'diagonal input never advances toward the wall on X');
        for (let frame = 0; frame < 7; frame += 1) {
          controls.updateXR(.025, { ...motion, forward: -1 }, view);
        }
        assert.ok(camera.position.x < -.2, 'movement directly away from the wall is retained');
      } finally {
        controls.dispose();
        browser.cleanup();
      }
    });
  }
});


class SoundFixtureElement extends EventTarget {
  textContent = '';
  hidden = false;
  valueAsNumber = 100;
  attributes = new Map();
  nextElementSibling;
  setAttribute(name, value) { this.attributes.set(name, value); }
  closest() { return null; }
}

function createSoundControlsFixture({ initialOn = false, rejectStart = false } = {}) {
  const windowTarget = new EventTarget(), panel = new SoundFixtureElement();
  const controls = new Map();
  panel.insertAdjacentHTML = () => {};
  panel.querySelector = selector => {
    if (!controls.has(selector)) {
      const element = new SoundFixtureElement();
      element.nextElementSibling = new SoundFixtureElement();
      controls.set(selector, element);
    }
    return controls.get(selector);
  };
  const controllers = [], NativeController = globalThis.AbortController;
  const saved = { master: 1, environmentOn: initialOn, footstepsOn: false, levels: {} };
  let finish, running = false;
  const pending = new Promise((resolve, reject) => { finish = () => {
    if (rejectStart) reject(new Error('fixture start failure')); else { running = true; resolve(); }
  }; });
  const audio = { starts: 0, mixes: [],
    start() { this.starts++; return pending; }, isRunning: () => running,
    setMix(mix) { this.mixes.push(mix); } };
  const restore = [
    overrideGlobal('window', windowTarget),
    overrideGlobal('localStorage', { getItem: () => JSON.stringify(saved), setItem() {} }),
    overrideGlobal('AbortController', class extends NativeController {
      constructor() { super(); controllers.push(this); }
    }),
  ];
  const sound = bindCoastSoundControls(panel, 'cinema', audio, () => {});
  const events = () => ['pageshow', 'click', 'keydown'].reduce((sum, type) => sum + getEventListeners(windowTarget, type).length, 0)
    + [...controls.values()].reduce((sum, element) => sum
      + getEventListeners(element, 'click').length + getEventListeners(element, 'input').length, 0);
  const snapshot = () => [...controls].map(([selector, element]) => ({ selector,
    text: element.textContent, hidden: element.hidden, attributes: [...element.attributes] }));
  return { sound, audio, controls, controllers, finish, pending, events, snapshot,
    cleanup() { sound.dispose(); restore.reverse().forEach(restoreGlobal => restoreGlobal()); } };
}

for (const rejectStart of [false, true]) {
  test(`sound controls retire UI subscriptions without a stack reason and ignore late ${rejectStart ? 'rejection' : 'resolution'}`, async () => {
    const f = createSoundControlsFixture({ rejectStart });
    try {
      assert.equal(f.events(), 8, 'same sound input/button/pageshow registrations');
      f.controls.get('.coast-audio').dispatchEvent(new Event('click'));
      assert.equal(f.audio.starts, 1);
      const signal = f.controllers[0].signal;
      let aborted = 0;
      signal.addEventListener('abort', () => aborted++);
      f.sound.dispose(); f.sound.dispose();
      assert.equal(signal.aborted, true);
      assert.equal(signal.reason, null, 'private UI cancellation does not retain an exception stack');
      assert.equal(aborted, 1);
      assert.equal(f.events(), 0, 'input, button and global subscriptions are removed');
      const snapshot = f.snapshot(), mixes = f.audio.mixes.length;
      f.controls.get('.coast-audio').dispatchEvent(new Event('click'));
      f.controls.get('#coast-volume').dispatchEvent(new Event('input'));
      assert.equal(f.audio.starts, 1); assert.equal(f.audio.mixes.length, mixes);
      f.finish(); await f.pending.catch(() => {}); await Promise.resolve();
      assert.deepEqual(f.snapshot(), snapshot, 'late start does not update retired UI');
    } finally { f.cleanup(); }
  });
}

test('sound control retirement preserves the distinct restore-retry cancellation contract', async () => {
  const f = createSoundControlsFixture({ initialOn: true });
  try {
    assert.equal(f.controllers.length, 2);
    assert.equal(f.events(), 10, 'restore retry adds its two global subscriptions');
    f.sound.dispose();
    assert.equal(f.controllers[0].signal.reason, null);
    assert.equal(f.controllers[1].signal.aborted, true);
    assert.equal(f.controllers[1].signal.reason.name, 'AbortError', 'other cancellation reasons are unchanged');
    assert.equal(f.events(), 0);
    f.finish(); await f.pending;
  } finally { f.cleanup(); }
});
