import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { PerspectiveCamera } from 'three';
import { COAST_WALKS, groundHeight, SEA_LEVEL, SPAWN } from '../src/coast/terrain.ts';

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
    onLockError: callbacks.onLockError ?? (() => {})
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

test('the main walking controls can complete both coastal circuits without flying', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const modes = [];
  const controls = createControls(browser, camera, { onMovementChange: mode => modes.push(mode) });
  try {
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
    for (const { id, points } of COAST_WALKS) {
      const start = points[0];
      camera.position.set(start.x, groundHeight(start.x, start.z) + 1.65, start.z);
      for (const point of points.slice(1)) {
        for (let frame = 0; frame < 16; frame += 1) {
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
    }
    assert.deepEqual(modes, []);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});
