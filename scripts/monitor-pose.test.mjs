import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Raycaster, Scene, Vector2, Vector3 } from 'three';
import { MonitorObject, MONITOR_MIN_SCALE, MONITOR_MAX_SCALE } from '../src/monitor/monitorObject.ts';

const desktopUrl = new URL('../src/monitor/monitorDesktop.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const path = specifier === './monitorObject' && context.parentURL === desktopUrl ? './monitorObject.ts' : specifier;
    return nextResolve(path, context);
  },
});
const { MonitorDesktop } = await import(desktopUrl);
hooks.deregister();

function createMonitor(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const statusText = [];
  const context = {
    clearRect() {}, fillRect() {},
    fillText(text) { statusText.push(text); }
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { createElement: () => ({ getContext: () => context }) }
  });
  const scene = new Scene();
  const monitor = new MonitorObject();
  scene.add(monitor.group);
  t.after(() => {
    monitor.dispose();
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  return { monitor, scene, statusText };
}

function makeCamera() {
  const camera = new PerspectiveCamera(60, 16 / 9, 0.12, 2500);
  camera.position.set(40, 12, -55);
  camera.rotation.y = 0.71;
  return camera;
}

test('invisible stereo emitters follow the actual fitted display edges and world scale', t => {
  const { monitor } = createMonitor(t);
  const camera = makeCamera();
  monitor.reset(camera);
  monitor.group.scale.setScalar(1.7);
  monitor.group.rotation.set(.12, .83, -.14);
  monitor.group.updateMatrixWorld(true);
  const [left, right] = monitor.audioEmitters;
  assert.equal(left.type, 'Object3D');
  assert.equal(right.type, 'Object3D');
  const a = left.getWorldPosition(new Vector3());
  const b = right.getWorldPosition(new Vector3());
  assert.ok(Math.abs(a.distanceTo(b) - 2.7 * 1.7) < 1e-10);
  const surface = monitor.group.getObjectByName('monitor-surface');
  assert.equal(left.parent, surface);
  assert.equal(right.parent, surface);
  const target = new Mesh(new PlaneGeometry(6, 3), new MeshBasicMaterial());
  target.position.set(-11, 4, 8);
  monitor.setTarget(target);
  assert.ok(Math.abs(left.getWorldPosition(a).distanceTo(right.getWorldPosition(b)) - 6) < 1e-10);
  target.geometry.dispose();
  target.material.dispose();
});

function pointerAtMonitor(camera, monitor) {
  camera.updateMatrixWorld(true);
  const projection = monitor.group.getWorldPosition(new Vector3()).project(camera);
  return new Vector2(projection.x, projection.y);
}

test('one monitor resets in front of the viewer and retains its world transform when hidden', t => {
  const { monitor, scene } = createMonitor(t);
  const camera = makeCamera();
  const rig = new Group();
  rig.position.set(-4, 3, 7);
  rig.rotation.y = -0.2;
  rig.add(camera);
  scene.add(rig);

  monitor.reset(camera);
  const point = monitor.group.position.clone();
  const viewer = camera.getWorldPosition(new Vector3());
  const toViewer = viewer.clone().sub(point).normalize();
  assert.ok(monitor.group.getWorldDirection(new Vector3()).dot(toViewer) > 0.999);
  const aim = pointerAtMonitor(camera, monitor);
  assert.ok(Math.abs(aim.x) < 0.001 && Math.abs(aim.y) < 0.12);
  assert.ok(point.distanceTo(viewer) > 3 && point.distanceTo(viewer) < 4);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(aim, camera);
  assert.equal(monitor.intersect(raycaster), undefined);
  monitor.setVisible(true);
  assert.ok(monitor.intersect(raycaster));

  camera.position.add(new Vector3(16, 2, 3));
  camera.rotation.y -= 0.4;
  monitor.update();
  assert.ok(monitor.group.position.equals(point));
  monitor.setVisible(false);
  assert.equal(monitor.intersect(raycaster), undefined);
  monitor.setVisible(true);
  assert.ok(monitor.group.position.equals(point));

  monitor.group.scale.setScalar(2);
  monitor.reset(camera);
  assert.deepEqual(monitor.group.scale.toArray(), [1, 1, 1]);
  assert.ok(monitor.group.position.distanceTo(point) > 10);
  assert.equal(scene.children.filter(child => child.name === 'virtual-monitor').length, 1);
});

test('desktop drag requires a hit, accepts an updated hit after moving, and bounds scale', t => {
  const { monitor } = createMonitor(t);
  const camera = makeCamera();
  const desktop = new MonitorDesktop(monitor);
  monitor.reset(camera);
  monitor.setVisible(true);
  const aim = pointerAtMonitor(camera, monitor);
  const origin = monitor.group.position.clone();
  const startRotation = monitor.group.quaternion.clone();
  assert.equal(desktop.begin(camera, new Vector2(-0.95, 0.95), 'move', 1, 0, 0), false);
  assert.equal(desktop.begin(camera, aim, 'move', 1, 100, 100), true);
  assert.equal(desktop.begin(camera, aim, 'rotate', 2, 100, 100), false);
  const movedAim = aim.clone().add(new Vector2(0.45, 0.12));
  assert.equal(desktop.move(camera, movedAim, 2, 300, 120), false);
  assert.ok(monitor.group.position.equals(origin));
  assert.equal(desktop.move(camera, movedAim, 1, 300, 120), true);
  assert.ok(monitor.group.position.distanceTo(origin) > 1);
  desktop.end(1);
  const movedPosition = monitor.group.position.clone();
  assert.equal(desktop.move(camera, aim, 1, 100, 100), false);
  assert.ok(monitor.group.position.equals(movedPosition));

  assert.equal(desktop.begin(camera, aim, 'rotate', 1, 100, 100), false);
  assert.equal(desktop.begin(camera, movedAim, 'rotate', 1, 300, 120), true);
  desktop.move(camera, movedAim, 1, 348, 137);
  assert.ok(monitor.group.quaternion.angleTo(startRotation) > 0.2);
  assert.ok(monitor.group.position.equals(movedPosition));
  desktop.cancel();

  assert.equal(desktop.begin(camera, movedAim, 'scale', 1, 300, 120), true);
  desktop.move(camera, movedAim, 1, 1500, -1500);
  assert.deepEqual(monitor.group.scale.toArray(), [MONITOR_MAX_SCALE, MONITOR_MAX_SCALE, MONITOR_MAX_SCALE]);
  desktop.move(camera, movedAim, 1, -1500, 1500);
  assert.deepEqual(monitor.group.scale.toArray(), [MONITOR_MIN_SCALE, MONITOR_MIN_SCALE, MONITOR_MIN_SCALE]);
  monitor.setVisible(false);
  assert.equal(desktop.move(camera, movedAim, 1, 500, 130), false);
  monitor.setVisible(true);
  assert.equal(desktop.begin(camera, movedAim, 'scale', 1, 300, 120), true);
});

test('a steep downward view gets a readable screen that can be selected from behind', t => {
  const { monitor } = createMonitor(t);
  const camera = makeCamera();
  const screen = monitor.group.getObjectByName('monitor-surface');
  monitor.setVisible(true);
  for (const degrees of [40, 88]) {
    camera.rotation.x = -degrees * Math.PI / 180;
    monitor.reset(camera);
    camera.updateMatrixWorld(true);
    screen.updateWorldMatrix(true, false);
    for (const corner of [new Vector3(-0.5, -0.5, 0), new Vector3(0.5, 0.5, 0)]) {
      const projected = screen.localToWorld(corner).project(camera);
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1);
    }
  }
  const center = monitor.group.position;
  const front = monitor.group.getWorldDirection(new Vector3());
  const fromBack = center.clone().addScaledVector(front, -1);
  assert.ok(monitor.intersect(new Raycaster(fromBack, front)));
});

test('one frameless plane follows video aspect and yields to status after playback is lost', t => {
  const { monitor, statusText } = createMonitor(t);
  const screen = monitor.group.getObjectByName('monitor-surface');
  assert.deepEqual(monitor.group.children, [screen]);
  assert.equal(screen.geometry.type, 'PlaneGeometry');
  const statusTexture = screen.material.map;
  const track = { readyState: 'live', enabled: true, muted: false };
  const video = {
    srcObject: { getVideoTracks: () => [track] }, paused: false, ended: false,
    readyState: 1, HAVE_CURRENT_DATA: 2, videoWidth: 0, videoHeight: 0
  };

  monitor.setVisible(true);
  monitor.setVideo(video);
  assert.equal(screen.material.map, statusTexture);
  assert.equal(screen.material.transparent, true);
  assert.ok(statusText.includes('映像は未接続です'));

  Object.assign(video, { readyState: 2, videoWidth: 1920, videoHeight: 1080 });
  monitor.update();
  assert.ok(screen.material.map.isVideoTexture);
  assert.ok(Math.abs(screen.scale.x / screen.scale.y - 16 / 9) < 1e-8);
  assert.equal(screen.material.transparent, false);
  const firstTexture = screen.material.map;
  let firstTextureDisposed = false;
  firstTexture.addEventListener('dispose', () => { firstTextureDisposed = true; });

  Object.assign(video, { videoWidth: 720, videoHeight: 1280 });
  monitor.update();
  assert.ok(firstTextureDisposed);
  assert.notEqual(screen.material.map, firstTexture);
  assert.ok(Math.abs(screen.scale.x / screen.scale.y - 9 / 16) < 1e-8);
  assert.ok(screen.scale.x < screen.scale.y);

  track.muted = true;
  monitor.setStatus('共有が停止されました');
  monitor.update();
  assert.equal(screen.material.map, statusTexture);
  assert.equal(screen.material.transparent, true);
  assert.ok(statusText.includes('共有が停止されました'));

  track.muted = false;
  monitor.update();
  assert.ok(screen.material.map.isVideoTexture);
  monitor.setVideo(null);
  assert.equal(screen.material.map, statusTexture);
});

test('fixed television reuses the live texture and preserves the floating placement', t => {
  const { monitor, scene } = createMonitor(t);
  const tv = new Mesh(new PlaneGeometry(1.44, .81), new MeshBasicMaterial());
  scene.add(tv);
  t.after(() => {
    tv.geometry.dispose();
    tv.material.dispose();
  });
  const camera = makeCamera();
  monitor.reset(camera);
  monitor.group.scale.setScalar(2);
  monitor.setVisible(true);
  const position = monitor.group.position.clone();
  const screen = monitor.group.children[0];
  const track = { readyState: 'live', enabled: true, muted: false };
  monitor.setVideo({
    srcObject: { getVideoTracks: () => [track] }, paused: false, ended: false,
    readyState: 2, HAVE_CURRENT_DATA: 2, videoWidth: 720, videoHeight: 1280,
  });
  const texture = screen.material.map;
  assert.ok(texture.isVideoTexture);
  monitor.setTarget(tv);
  assert.equal(monitor.isVisible, true);
  assert.equal(monitor.group.visible, false);
  assert.equal(screen.parent, tv);
  assert.equal(screen.material.map, texture);
  assert.equal(screen.scale.y, .81);
  assert.ok(Math.abs(screen.scale.x / screen.scale.y - 9 / 16) < 1e-8);
  assert.equal(monitor.intersect(new Raycaster(new Vector3(0, 0, 1), new Vector3(0, 0, -1))), undefined);

  monitor.setTarget(null);
  assert.equal(monitor.group.visible, true);
  assert.ok(monitor.group.position.equals(position));
  assert.equal(screen.parent, monitor.group);
  assert.equal(screen.material.map, texture);
  assert.equal(screen.scale.y, 2.7 * 9 / 16);

  monitor.setTarget(tv);
  monitor.setVisible(false);
  assert.equal(monitor.isVisible, false);
  assert.equal(tv.visible, true);
  assert.equal(screen.visible, false);
  assert.equal(screen.material.map.isVideoTexture, undefined);
});
