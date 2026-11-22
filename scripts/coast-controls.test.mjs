import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { PerspectiveCamera } from 'three';
import { groundHeight } from '../src/coast/terrain.ts';

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
    onFlightChange: callbacks.onFlightChange ?? (() => {}),
    onLockChange: callbacks.onLockChange ?? (() => {}),
    onLockError: callbacks.onLockError ?? (() => {})
  });
}

test('walking approaches a steep cliff without crossing it or losing ground contact', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    const startX = 25;
    const steepZ = -31;
    assert.ok(groundHeight(startX, steepZ) > 0.08, 'slope fixture must start on dry ground');
    camera.position.set(startX, groundHeight(startX, steepZ) + 1.65, steepZ);
    camera.rotation.x = 0;
    camera.rotation.y = 0;
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW', repeat: false });
    for (let frame = 0; frame < 10; frame += 1) controls.update(0.001);
    assert.equal(camera.position.z, steepZ, 'small frame steps climbed a slope above the walk limit');

    const startZ = -29.5;
    camera.position.set(startX, groundHeight(startX, startZ) + 1.65, startZ);
    for (let frame = 0; frame < 40; frame += 1) controls.update(0.05);

    assert.ok(camera.position.z < startZ - 0.1, `player did not approach the cliff: ${camera.position.z}`);
    assert.ok(camera.position.z > -31, `player crossed the cliff: ${camera.position.z}`);
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
    const x = 25;
    const z = -32.6;
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
  const flightChanges = [];
  const controls = createControls(browser, camera, { onFlightChange: flying => flightChanges.push(flying) });
  const setY = pressed => { buttons[3] = { pressed, value: Number(pressed) }; };

  try {
    setY(true);
    controls.update(0);
    controls.update(0);
    browser.window.dispatch('blur');
    controls.update(0);
    browser.window.dispatch('focus');
    controls.update(0);
    assert.deepEqual(flightChanges, [true]);

    setY(false);
    controls.update(0);
    setY(true);
    controls.update(0);
    assert.deepEqual(flightChanges, [true, false]);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});
