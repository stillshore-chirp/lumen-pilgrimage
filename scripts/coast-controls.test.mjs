import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { PerspectiveCamera, Ray, Triangle, Vector3 } from 'three';
import { COAST_WALKS, FOREST_WALKS, groundHeight, SEA_LEVEL, SPAWN } from '../src/coast/terrain.ts';

const controlsUrl = new URL('../src/coast/CoastControls.ts', import.meta.url).href;
// Vite resolves the extensionless terrain import in the app. Resolve that same file in the Node test.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const path = specifier === './terrain' && context.parentURL === controlsUrl ? './terrain.ts' : specifier;
    return nextResolve(path, context);
  },
});
const { CoastControls } = await import(controlsUrl);
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
    window: fakeWindow,
    cleanup: () => restore.reverse().forEach(restoreGlobal => restoreGlobal())
  };
}

function createControls(browser, camera, callbacks = {}) {
  return new CoastControls(camera, browser.canvas, {
    onMovementChange: callbacks.onMovementChange ?? (() => {}),
    onLockChange: callbacks.onLockChange ?? (() => {}),
    onLockError: callbacks.onLockError ?? (() => {}),
    diveObstacleHeight: callbacks.diveObstacleHeight
  });
}

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

    assert.equal(camera.position.z, z, 'flight crossed the cliff face');
    assert.equal(camera.position.y, startY, 'flight was pushed vertically to the cliff top');
  } finally {
    controls.dispose();
    browser.cleanup();
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
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'Space' });
    let apex = startY;
    for (let frame = 0; frame < 120; frame += 1) {
      browser.window.dispatch('keydown', { target: browser.canvas, code: 'Space', repeat: true });
      controls.update(1 / 60);
      apex = Math.max(apex, camera.position.y);
      if (frame > 55) assert.ok(Math.abs(camera.position.y - startY) < 1e-6, 'held Space triggered another jump');
    }
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
    browser.window.dispatch('blur');
    controls.update(0);
    browser.window.dispatch('focus');
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

test('walking wades and swims across the beach, then returns to land', () => {
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
    move('KeyW', 133);
    assert.deepEqual(modes, ['wade', 'swim']);
    assert.ok(groundHeight(camera.position.x, camera.position.z) < SEA_LEVEL - 1.1);
    assert.ok(camera.position.y > SEA_LEVEL + 0.4 && camera.position.y < SEA_LEVEL + 1);
    move('KeyS', 152);
    assert.deepEqual(modes, ['wade', 'swim', 'wade', 'walk']);
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

test('the main walking controls complete the coastal and forest paths without flying', () => {
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
