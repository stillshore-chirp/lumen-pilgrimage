import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import {
  BoxGeometry, DoubleSide, EventDispatcher, Group, Mesh, MeshBasicMaterial, Quaternion, Scene, Vector3,
} from 'three';

const { ImmersiveSession } = await import('../src/xr/ImmersiveSession.ts');

const moduleUrl = new URL('../src/monitor/monitorXR.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const path = specifier === './monitorObject' && context.parentURL === moduleUrl ? './monitorObject.ts' : specifier;
    return nextResolve(path, context);
  },
});
const { MonitorXR } = await import(moduleUrl);
hooks.deregister();
const { MONITOR_MIN_SCALE, MONITOR_MAX_SCALE } = await import('../src/monitor/monitorObject.ts');

class Session extends EventTarget {
  inputSources = [];
  visibilityState = 'visible';

  send(type, data) {
    this.dispatchEvent(Object.assign(new Event(type), data));
  }

  add(source) {
    this.inputSources.push(source);
    this.send('inputsourceschange', { added: [source], removed: [] });
  }

  remove(source) {
    this.inputSources = this.inputSources.filter(input => input !== source);
    this.send('inputsourceschange', { added: [], removed: [source] });
  }

  squeeze(source, pressed) {
    this.send(pressed ? 'squeezestart' : 'squeezeend', { inputSource: source });
  }

  async end() { this.dispatchEvent(new Event('end')); }
}

class Manager extends EventDispatcher {
  setReferenceSpaceType(type) { assert.equal(type, 'local-floor'); }
  getReferenceSpace() { return {}; }
  async setSession(session) {
    session.addEventListener('end', () => this.dispatchEvent({ type: 'sessionend' }), { once: true });
  }
}

const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

function pose(x, y, z, orientation = new Quaternion()) {
  return { transform: { position: new Vector3(x, y, z), orientation }, emulatedPosition: false };
}

function grip(handedness, x = 0) {
  return {
    handedness, targetRayMode: 'tracked-pointer', gripSpace: { pose: pose(x, 0, 0) },
    targetRaySpace: { pose: pose(x, 0, 0) },
  };
}

function hand(handedness, x = 0, distance = 0.06) {
  const source = {
    handedness, targetRayMode: 'tracked-pointer', targetRaySpace: { pose: pose(x, 0, 0) },
    hand: new Map([['index-finger-tip', {}], ['thumb-tip', {}], ['wrist', {}]]),
  };
  setHand(source, x, distance);
  return source;
}

function setHand(source, x, distance, orientation = new Quaternion()) {
  source.hand.get('index-finger-tip').pose = pose(x + distance / 2, 0, 0);
  source.hand.get('thumb-tip').pose = pose(x - distance / 2, 0, 0);
  source.hand.get('wrist').pose = pose(x, -0.05, 0, orientation);
}

function fixture(t, options = {}) {
  const manager = new Manager();
  const session = new Session();
  let requestCount = 0;
  const system = new EventTarget();
  system.isSessionSupported = async mode => mode === 'immersive-vr';
  system.requestSession = async (mode, features) => {
    assert.equal(mode, 'immersive-vr');
    assert.deepEqual(features, { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
    ++requestCount;
    if (options.reject) throw new Error('start denied');
    return session;
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { xr: options.unsupported ? undefined : system } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  });
  const scene = new Scene();
  const rig = new Group();
  const group = new Group();
  scene.add(rig, group);
  const target = new Mesh(new BoxGeometry(2.7, 1.5, 0.05), new MeshBasicMaterial({ side: DoubleSide }));
  group.add(target);
  group.position.set(0, 0, -3.25);
  const monitor = {
    group,
    intersect(ray) {
      if (!group.visible) return undefined;
      target.updateWorldMatrix(true, false);
      return ray.intersectObject(target, false)[0];
    },
  };
  const statuses = [];
  const transitions = [];
  const xr = new ImmersiveSession(manager);
  const grab = new MonitorXR(manager, rig, monitor);
  let current = null;
  const unsubscribe = xr.observe((status, active) => {
    statuses.push(status);
    if (current === active) return;
    current = active;
    transitions.push(Boolean(active));
    grab.setSession(active);
  });
  const frame = { session, getPose: space => space.pose, getJointPose: space => space.pose };
  t.after(() => {
    unsubscribe();
    grab.dispose();
    xr.dispose();
    target.geometry.dispose();
    target.material.dispose();
  });
  return { xr, session, rig, group, statuses, transitions, requestCount: () => requestCount, update: () => grab.update(frame) };

}

function matchesPose(group, position, rotation, scale = 1) {
  assert.ok(group.position.distanceTo(position) < 1e-8, `position ${group.position.toArray()} should match ${position.toArray()}`);
  assert.ok(Math.abs(group.quaternion.dot(rotation)) > 1 - 1e-8);
  assert.deepEqual(group.scale.toArray(), [scale, scale, scale]);
}

test('Touch grip uses the aim ray and a world-aligned 6DoF offset until release', async t => {
  const { xr, session, rig, group, update } = fixture(t);
  const controller = grip('right');
  session.add(controller);
  rig.position.set(8, 4, 11);
  rig.quaternion.copy(turn);
  const initial = new Vector3(0, 0, -3.25).applyQuaternion(turn).add(rig.position);
  group.position.copy(initial);
  group.quaternion.copy(turn);
  await xr.toggle();

  controller.targetRaySpace.pose = pose(6, 0, 0);
  session.squeeze(controller, true);
  update();
  controller.targetRaySpace.pose = pose(0, 0, 0);
  controller.gripSpace.pose = pose(0.5, 0, 0);
  update();
  matchesPose(group, initial, turn);
  session.squeeze(controller, false);

  controller.gripSpace.pose = pose(0, 0, 0);
  session.squeeze(controller, true);
  update();
  matchesPose(group, initial, turn);
  const roll = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.65);
  controller.gripSpace.pose = pose(0.7, 0.4, 0.3, roll);
  update();
  const moved = initial.clone().add(new Vector3(0.7, 0.4, 0.3).applyQuaternion(turn));
  const rotated = turn.clone().multiply(roll);
  matchesPose(group, moved, rotated);
  session.squeeze(controller, false);
  controller.gripSpace.pose = pose(-1, -1, -1);
  update();
  matchesPose(group, moved, rotated);
});

test('hand pinch uses joint poses and wrist rotation, with a fresh open gesture after tracking is lost', async t => {
  const { xr, session, group, update } = fixture(t);
  const source = hand('left');
  await xr.toggle();
  session.add(source);
  update();
  session.squeeze(source, true);
  setHand(source, 0.4, 0.022);
  update();
  const initial = new Vector3(0, 0, -3.25);
  matchesPose(group, initial, new Quaternion());
  setHand(source, 0, 0.016);
  update();
  matchesPose(group, initial, new Quaternion());

  setHand(source, 0.6, 0.022, turn);
  update();
  const moved = new Vector3(0.6, 0, -3.25);
  matchesPose(group, moved, turn);
  source.hand.get('wrist').pose = null;
  update();
  setHand(source, 1, 0.016, turn);
  update();
  matchesPose(group, moved, turn);
  setHand(source, 1, 0.04, turn);
  update();
  matchesPose(group, moved, turn);

  // A near pinch can acquire independently of the pointing ray.
  group.position.set(0, 0, -0.05);
  group.quaternion.identity();
  source.targetRaySpace.pose = null;
  setHand(source, 0, 0.014);
  update();
  setHand(source, 0.6, 0.016);
  update();
  matchesPose(group, new Vector3(0.6, 0, -0.05), new Quaternion());
  setHand(source, 0.8, 0.04);
  update();
  matchesPose(group, new Vector3(0.6, 0, -0.05), new Quaternion());
});

test('two different hands clamp scale, rebase on disconnect, and drop on session end', async t => {
  const { xr, session, rig, group, statuses, transitions, update } = fixture(t);
  const right = grip('right', 0.2);
  const duplicate = grip('right', -0.4);
  const left = hand('left', -0.2);
  session.add(right);
  session.add(duplicate);
  session.add(left);
  await xr.toggle();
  update();
  session.squeeze(right, true);
  session.squeeze(duplicate, true);
  setHand(left, -0.2, 0.016);
  update();
  matchesPose(group, new Vector3(0, 0, -3.25), new Quaternion());
  right.gripSpace.pose = pose(3, 0, 0);
  setHand(left, -3, 0.016);
  update();
  const center = new Vector3(0, 0, -3.25);
  matchesPose(group, center, new Quaternion(), MONITOR_MAX_SCALE);
  right.gripSpace.pose = pose(0.01, 0, 0);
  setHand(left, -0.01, 0.016);
  update();
  matchesPose(group, center, new Quaternion(), MONITOR_MIN_SCALE);
  assert.match(update(), /両手/);

  session.remove(left);
  update();
  matchesPose(group, center, new Quaternion(), MONITOR_MIN_SCALE);
  right.gripSpace.pose = pose(0.01, 0.2, 0);
  update();
  const moved = center.clone().add(new Vector3(0, 0.2, 0));
  matchesPose(group, moved, new Quaternion(), MONITOR_MIN_SCALE);
  await session.end();
  right.gripSpace.pose = pose(1, 0, 0);
  update();
  matchesPose(group, moved, new Quaternion(), MONITOR_MIN_SCALE);
  assert.equal(rig.children.length, 0);
  assert.deepEqual(transitions, [true, false]);
  assert.equal(statuses.at(-1).state, 'available');
});

test('hiding the monitor drops the grab and showing it requires a new gesture', async t => {
  const { xr, session, group, update } = fixture(t);
  const controller = grip('right');
  session.add(controller);
  await xr.toggle();
  session.squeeze(controller, true);
  update();
  group.visible = false;
  update();
  matchesPose(group, new Vector3(0, 0, -3.25), new Quaternion());
  group.visible = true;
  controller.gripSpace.pose = pose(0.4, 0, 0);
  update();
  matchesPose(group, new Vector3(0, 0, -3.25), new Quaternion());
  session.squeeze(controller, false);
  session.squeeze(controller, true);
  update();
  controller.gripSpace.pose = pose(0.8, 0, 0);
  update();
  matchesPose(group, new Vector3(0.4, 0, -3.25), new Quaternion());
});

test('unsupported devices and denied sessions expose status without changing the desktop lifecycle', async t => {
  await t.test('no WebXR', async t => {
    const { xr, statuses, transitions, requestCount } = fixture(t, { unsupported: true });
    await xr.checkSupport();
    await xr.toggle();
    assert.equal(statuses.at(-1).state, 'unavailable');
    assert.deepEqual(transitions, []);
    assert.equal(requestCount(), 0);
  });
  await t.test('session request denied', async t => {
    const { xr, statuses, transitions, requestCount } = fixture(t, { reject: true });
    await xr.checkSupport();
    assert.equal(statuses.at(-1).state, 'available');
    await xr.toggle();
    assert.equal(statuses.at(-1).state, 'error');
    assert.deepEqual(transitions, []);
    assert.equal(requestCount(), 1);
  });
  await t.test('gaze and trigger-only controller have no grab tracking', async t => {
    const { xr, session, update } = fixture(t);
    session.add({ handedness: 'none', targetRayMode: 'gaze', targetRaySpace: { pose: pose(0, 0, 0) } });
    const triggerOnly = { ...grip('right'), gamepad: { mapping: 'xr-standard', buttons: [{}] } };
    session.add(triggerOnly);
    await xr.toggle();
    assert.match(update(), /追跡できません/);
  });
});
