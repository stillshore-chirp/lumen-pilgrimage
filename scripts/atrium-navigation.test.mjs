import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';

const atriumUrl = new URL('../src/coast/world/atrium/', import.meta.url).href;
const controlsUrl = new URL('../src/coast/CoastControls.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === controlsUrl && specifier === './terrain') {
      return nextResolve('./terrain.ts', context);
    }
    if (context.parentURL?.startsWith(atriumUrl) && specifier.startsWith('./') && !specifier.endsWith('.ts')) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const {
  ATRIUM_BOUNDS, ATRIUM_DESTINATIONS, ATRIUM_GALLERY_EDGE, ATRIUM_REAR_GALLERY,
  ATRIUM_STAIR_LENGTH, ATRIUM_UPPER_STAIR, ATRIUM_UPPER_STAIR_LENGTH, ATRIUM_WALK_LEVEL,
  atriumStairDistance, atriumStairFrame, atriumStairHeight, atriumStairPoint,
  atriumUpperStairHeight, atriumUpperStairPoint,
} = await import('../src/coast/world/atrium/atriumLayout.ts');
const { atriumNavigation } = await import('../src/coast/world/atrium/atriumNavigation.ts');
const { ATRIUM_TENANT_ISLANDS } = await import('../src/coast/world/atrium/atriumTenantPlan.ts');
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

function createBrowser() {
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
    overrideGlobal('navigator', { getGamepads: () => [] }),
  ];
  return {
    canvas,
    window: fakeWindow,
    cleanup: () => restore.reverse().forEach(restoreGlobal => restoreGlobal()),
  };
}

function createControls(browser, camera) {
  const controls = new CoastControls(camera, browser.canvas, {
    onMovementChange() {}, onLockChange() {}, onLockError() {},
  }, atriumNavigation);
  return controls;
}

function stairYaw(frame, forward = true) {
  return Math.atan2(-frame.normalZ, frame.normalX) + (forward ? 0 : Math.PI);
}

test('atrium floor support keeps lower shops separate from both upper galleries and their back link', () => {
  assert.equal(ATRIUM_BOUNDS.minX, -11.4);
  assert.equal(ATRIUM_BOUNDS.maxX, 11.4);
  assert.equal(ATRIUM_DESTINATIONS[0].id, 'lounge');
  assert.equal(ATRIUM_DESTINATIONS[0].seatedEyeHeight, 1.20);
  assert.equal(atriumNavigation.spawn, ATRIUM_DESTINATIONS[0]);
  assert.equal(atriumNavigation.supportAt(0, -30, 1), 0);

  const sideGalleries = [
    { x: -9.22, z: 0, floor: ATRIUM_WALK_LEVEL, lowerFloor: 0 },
    { x: 9.22, z: 0, floor: ATRIUM_WALK_LEVEL, lowerFloor: 0 },
    { x: -9.22, z: -10, floor: 13.55, lowerFloor: ATRIUM_WALK_LEVEL },
    { x: 9.22, z: -10, floor: 13.55, lowerFloor: ATRIUM_WALK_LEVEL },
  ];
  for (const { x, z, floor, lowerFloor } of sideGalleries) {
    assert.equal(atriumNavigation.supportAt(x, z, floor + 0.04), floor);
    assert.equal(atriumNavigation.supportAt(x, z, floor - 0.26), lowerFloor,
      `a low foot limit cannot snap up at (${x}, ${z})`);
    assert.equal(atriumNavigation.blocksWalking(x, z, floor), false);
    assert.ok(atriumNavigation.ceilingHeight(x, z, floor) > floor + 1.65);
  }

  const rearLinkZ = ATRIUM_REAR_GALLERY - 1.25;
  for (let x = -10; x <= 10; x += 2) {
    assert.equal(atriumNavigation.supportAt(x, rearLinkZ, ATRIUM_WALK_LEVEL + 0.04), ATRIUM_WALK_LEVEL,
      `rear gallery links both sides at x=${x}`);
  }

  const sideEdgeX = -(ATRIUM_GALLERY_EDGE + 0.19);
  assert.equal(atriumNavigation.supportAt(sideEdgeX, -30.6, ATRIUM_WALK_LEVEL + 0.04), 0);
  assert.equal(atriumNavigation.blocksWalking(sideEdgeX, -30.6, ATRIUM_WALK_LEVEL, ATRIUM_WALK_LEVEL), true,
    'a walking step cannot cross the open inner edge of the gallery');
});

test('the distance-based main stair offers continuous support in both directions', () => {
  assert.ok(ATRIUM_STAIR_LENGTH > 20 && ATRIUM_STAIR_LENGTH < 40);
  const sampleCount = Math.ceil(ATRIUM_STAIR_LENGTH / 0.12);
  let point = atriumStairPoint(0, 0);
  let floor = atriumStairHeight(0);

  for (let i = 1; i <= sampleCount; i += 1) {
    const along = ATRIUM_STAIR_LENGTH * i / sampleCount;
    const frame = atriumStairFrame(along);
    const next = atriumStairPoint(along, 0);
    const expected = atriumStairHeight(along);
    const distance = Math.hypot(next.x - point.x, next.z - point.z);
    assert.ok(Math.abs(Math.hypot(frame.normalX, frame.normalZ) - 1) < 1e-6);
    assert.ok(Math.abs(atriumStairDistance(next.x, next.z) - along) < 0.04,
      `distance query follows the centerline at ${along.toFixed(2)} m`);
    const eligible = atriumNavigation.supportAt(next.x, next.z, floor + distance * 0.95 + 0.04);
    assert.ok(Math.abs(eligible - expected) < 1e-6, `ascending support at ${along.toFixed(2)} m`);
    assert.ok(Math.abs(expected - floor) <= distance * 0.95 + 0.04,
      `walkable rise at ${along.toFixed(2)} m`);
    assert.equal(atriumNavigation.blocksWalking(next.x, next.z, expected, floor), false);
    point = next;
    floor = expected;
  }
  assert.equal(floor, ATRIUM_WALK_LEVEL);

  for (let i = sampleCount - 1; i >= 0; i -= 1) {
    const along = ATRIUM_STAIR_LENGTH * i / sampleCount;
    const next = atriumStairPoint(along, 0);
    const expected = atriumStairHeight(along);
    assert.ok(Math.abs(atriumNavigation.supportAt(next.x, next.z, floor + 0.04) - expected) < 1e-6,
      `descending support at ${along.toFixed(2)} m`);
    assert.equal(atriumNavigation.blocksWalking(next.x, next.z, expected, floor), false);
    point = next;
    floor = expected;
  }
  assert.equal(floor, atriumStairHeight(0));
});

test('the upper connector supports its dedicated rise while ground remains on the lower layer', () => {
  assert.ok(ATRIUM_UPPER_STAIR_LENGTH > 8 && ATRIUM_UPPER_STAIR_LENGTH < 12);
  assert.equal(ATRIUM_UPPER_STAIR.start.y, ATRIUM_WALK_LEVEL);
  assert.equal(ATRIUM_UPPER_STAIR.end.y, 13.55);
  const sampleCount = Math.ceil(ATRIUM_UPPER_STAIR_LENGTH / 0.16);
  let previous = ATRIUM_UPPER_STAIR.start.y;

  for (let i = 0; i <= sampleCount; i += 1) {
    const along = ATRIUM_UPPER_STAIR_LENGTH * i / sampleCount;
    const point = atriumUpperStairPoint(along, 0);
    const floor = atriumUpperStairHeight(point.x, point.z);
    assert.ok(Math.abs(floor - point.y) < 1e-6, `upper connector height at ${along.toFixed(2)} m`);
    assert.ok(Math.abs(atriumNavigation.supportAt(point.x, point.z, floor + 0.04) - floor) < 1e-6,
      `connector support at ${along.toFixed(2)} m`);
    assert.equal(atriumNavigation.supportAt(point.x, point.z, 1.0), 0,
      `low foot limit stays at ground at ${along.toFixed(2)} m`);
    assert.equal(atriumNavigation.blocksWalking(point.x, point.z, floor, previous), false,
      `connector rise stays walkable at ${along.toFixed(2)} m`);
    assert.ok(floor >= previous - 1e-6, 'upper connector rises continuously');
    previous = floor;
  }

  const middle = atriumUpperStairPoint(ATRIUM_UPPER_STAIR_LENGTH / 2, 0);
  const middleFloor = atriumUpperStairHeight(middle.x, middle.z);
  assert.equal(atriumNavigation.supportAt(middle.x, middle.z, ATRIUM_WALK_LEVEL + 0.04), 0,
    'the stair crosses open space without a lower gallery directly underneath');
  assert.ok(Math.abs(atriumNavigation.supportAt(middle.x, middle.z, middleFloor + 0.04) - middleFloor) < 1e-6);
});

test('walkable storefront frontage stays within the atrium width near eleven metres', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  try {
    for (const [yaw, limit] of [[-Math.PI / 2, ATRIUM_BOUNDS.maxX], [Math.PI / 2, ATRIUM_BOUNDS.minX]]) {
      controls.relocate({ x: 0, z: -10, yaw, pitch: 0 });
      browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
      for (let frame = 0; frame < 140; frame += 1) controls.update(0.05);
      browser.window.dispatch('keyup', { code: 'KeyW' });
      assert.ok(Math.abs(camera.position.x - (limit > 0 ? limit - 0.35 : limit + 0.35)) < 1e-6,
        `walkable edge is at x=${camera.position.x}`);
    }
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('display island footprints leave usable ground routes around the lounge and café', () => {
  for (const { id, center: [x, s], size: [width, depth] } of ATRIUM_TENANT_ISLANDS) {
    for (const [atX, atZ] of [[x, -s], [x + width * 0.45, -s], [x, -s - depth * 0.45]]) {
      assert.equal(atriumNavigation.blocksWalking(atX, atZ, 0), true, `${id} blocks its entire footprint`);
    }
    assert.equal(atriumNavigation.blocksWalking(x - width / 2 - 0.25, -s, 0), false);
    assert.equal(atriumNavigation.blocksWalking(x, -s, ATRIUM_WALK_LEVEL), false);
  }

  for (const [i, { center: [, s], size: [, depth] }] of ATRIUM_TENANT_ISLANDS.slice(1).entries()) {
    const previous = ATRIUM_TENANT_ISLANDS[i];
    const aisleZ = -(s - depth / 2 + previous.center[1] + previous.size[1] / 2) / 2;
    for (let x = -8.5; x < -3.4; x += 0.15) {
      assert.equal(atriumNavigation.blocksWalking(x, aisleZ, 0), false, `cross-aisle at (${x}, ${aisleZ})`);
    }
  }
  for (let s = 28; s <= 38; s += 0.15) {
    assert.equal(atriumNavigation.blocksWalking(-8.5, -s, 0), false, 'west corridor stays clear');
    assert.equal(atriumNavigation.blocksWalking(10.9, -s, 0), false, 'east approach retains its café passage');
  }
  const { x, z } = atriumNavigation.spawn;
  assert.equal(atriumNavigation.blocksWalking(x, z + 0.6, 0), false, 'the sofa can still be approached');
});

test('keyboard walking and jumping stop at the display case edge', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  const { center: [x, s], size: [width] } = ATRIUM_TENANT_ISLANDS[0];
  const edgeX = x - width / 2;
  try {
    controls.relocate({ x: edgeX - 1.5, z: -s, yaw: -Math.PI / 2, pitch: 0 });
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
    for (let frame = 0; frame < 120; frame += 1) controls.update(0.01);
    const stopX = camera.position.x;
    assert.ok(stopX > edgeX - 0.24 && stopX < edgeX);
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'Space' });
    let highestFoot = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      controls.update(0.01);
      highestFoot = Math.max(highestFoot, camera.position.y - controls.eyeHeight);
      assert.ok(camera.position.x <= stopX + 0.001, 'jumping cannot land in the case');
    }
    assert.ok(highestFoot > ATRIUM_TENANT_ISLANDS[0].height);
  } finally {
    controls.dispose();
    browser.cleanup();
  }
});

test('keyboard and XR follow the main stair with heading feedback for at least 650 frames', () => {
  const browser = createBrowser();
  const camera = new PerspectiveCamera();
  const controls = createControls(browser, camera);
  const start = atriumStairPoint(0, 0);
  controls.relocate({
    x: start.x, z: start.z, yaw: stairYaw(atriumStairFrame(0)), pitch: 0, floorY: atriumStairHeight(0),
  });
  const frameCount = 700;
  let ascending = true;
  let sawUpper = false;
  let sawLower = false;
  let xrMode = false;
  let travelled = 0;
  let previousAlong = 0;

  try {
    browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
    let step = 0;
    for (; step < 1100; step += 1) {
      const along = atriumStairDistance(camera.position.x, camera.position.z);
      assert.notEqual(along, undefined, `camera remains on the stair route at frame ${step}`);
      if (!ascending && along <= 0.13 && step >= frameCount && sawUpper) {
        sawLower = true;
        break;
      }
      if (ascending && along >= ATRIUM_STAIR_LENGTH - 0.13) {
        ascending = false;
        sawUpper = true;
        xrMode = true;
        browser.window.dispatch('keyup', { code: 'KeyW' });
      } else if (!ascending && along <= 0.13) {
        ascending = true;
        sawLower = true;
        xrMode = false;
        browser.window.dispatch('keydown', { target: browser.canvas, code: 'KeyW' });
      }

      const frame = atriumStairFrame(along);
      const yaw = stairYaw(frame, ascending);
      camera.rotation.set(0, yaw, 0);
      const before = camera.position.clone();
      if (xrMode) {
        controls.updateXR(0.05,
          { forward: 1, right: 0, vertical: 0, jump: false, dive: false, flight: false },
          { yaw, headOffset: new Vector3() });
      } else {
        controls.update(0.05);
      }
      const nextAlong = atriumStairDistance(camera.position.x, camera.position.z);
      assert.notEqual(nextAlong, undefined, `movement remains on the stair route at frame ${step}`);
      const foot = camera.position.y - controls.eyeHeight;
      const support = atriumNavigation.supportAt(camera.position.x, camera.position.z, foot + 0.04);
      assert.ok(Math.abs(support - foot) < 0.04, `camera stays supported at frame ${step}`);
      travelled += Math.hypot(camera.position.x - before.x, camera.position.z - before.z);
      previousAlong = nextAlong;
    }
    browser.window.dispatch('keyup', { code: 'KeyW' });
    assert.ok(step >= frameCount, `followed the path for at least ${frameCount} frames (ran ${step})`);
    assert.ok(sawUpper && sawLower, `heading feedback reaches both landings; final along ${previousAlong}`);
    assert.ok(travelled > ATRIUM_STAIR_LENGTH * 2, `walked ${travelled.toFixed(2)} m on the stair route`);
    assert.ok(Math.abs(camera.position.y - 1.65) < 0.04,
      'after repeated ascent and descent the camera returns to the lower floor');
  } finally {
    browser.window.dispatch('keyup', { code: 'KeyW' });
    controls.dispose();
    browser.cleanup();
  }
});
