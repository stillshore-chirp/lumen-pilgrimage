import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Raycaster, Vector3 } from 'three';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts')
    ? `${specifier}.ts` : specifier, context);
} });
const { createResidenceAcousticPathModel } = await import('../src/coast/world/residence/residenceAcousticPaths.ts');
const { acousticPortals, acousticRooms, acousticDoorSnapshot } = await import('../src/coast/world/residence/residenceAcousticScene.ts');
const { createResidenceMaterials } = await import('../src/coast/world/residence/residenceMaterials.ts');
const { createResidenceShell } = await import('../src/coast/world/residence/residenceShell.ts');
hooks.deregister();
const point = (x, n, y = 1.65) => ({ x, y, z: -n });
const state = q => Object.fromEntries(acousticPortals.map(portal => [portal.id, q]));

test('finite opaque walls retain loss as the source approaches their face', () => {
  const model = createResidenceAcousticPathModel();
  const receiver = point(8.2, 2);
  const far = model.solve(point(7.06, 2), receiver, state(0)).paths.find(path => path.kind === 'direct-or-wall');
  const near = model.solve(point(7.29, 2), receiver, state(0)).paths.find(path => path.kind === 'direct-or-wall');
  assert.ok(far && near);
  assert.ok(near.lowGain < .10);
  assert.ok(near.highGain / near.lowGain < .13);
  assert.ok(20 * Math.log10(near.lowGain / far.lowGain) < 2);
  model.dispose();
});

test('bedroom separation removes the old open edge while retaining hall routes', () => {
  assert.equal(acousticPortals.some(portal => portal.kind === 'passage' && portal.rooms.includes('02') && portal.rooms.includes('01')), false);
  assert.ok(acousticPortals.some(portal => portal.id === 'bedroom-02' && portal.rooms.includes('H2')));
  assert.ok(acousticPortals.some(portal => portal.id === 'primary-bedroom' && portal.rooms.includes('H2')));
});

test('an open leaf blocks a secondary ray and its finite tip offers a separate route', () => {
  const materials = createResidenceMaterials();
  const shell = createResidenceShell(materials);
  const model = createResidenceAcousticPathModel();
  try {
    shell.group.updateMatrixWorld(true);
    const source = new Vector3(18.4, 1.65, -12.1);
    const listener = new Vector3(18.8, 1.65, -12.1);
    const hit = new Raycaster(source, listener.clone().sub(source).normalize(), .001, source.distanceTo(listener))
      .intersectObject(shell.group, true)[0];
    assert.ok(hit && Math.abs(hit.point.x - 18.591) < .001, 'the actual open wooden leaf intercepts this same-room ray');
    const result = model.solve(source, listener, acousticDoorSnapshot(() => 1));
    const direct = result.paths.find(path => path.kind === 'direct-or-wall');
    assert.equal(direct.lowGain, .135);
    assert.equal(direct.highGain, .022);
    const around = result.paths.find(path => path.kind === 'leaf-detour');
    assert.ok(around && around.length > .9 && around.ids.includes('leaf:primary-bedroom'));
    for (let index = 1; index < around.points.length; index += 1) {
      const a = new Vector3().copy(around.points[index - 1]);
      const b = new Vector3().copy(around.points[index]);
      const ray = new Raycaster(a, b.clone().sub(a).normalize(), .001, a.distanceTo(b) - .001);
      assert.equal(ray.intersectObject(shell.group, true).length, 0, 'the detour also clears the actual shell/leaf mesh');
    }
    const closed = model.solve(point(18.11, 11), point(18.11, 12), acousticDoorSnapshot(() => 0));
    assert.equal(closed.paths.find(path => path.kind === 'direct-or-wall').lowGain, .135,
      'wall aperture and its leaf count the same panel transmission once');
  } finally { model.dispose(); shell.dispose(); materials.dispose(); }
});

test('balcony sound follows the three-door chain to the primary bath', () => {
  const model = createResidenceAcousticPathModel();
  const source = point(21.15, 13.575, 1.47);
  const receiver = point(14, 13.5);
  const closed = model.solve(source, receiver, state(0));
  const open = model.solve(source, receiver, state(1));
  const route = open.paths.find(path => path.kind === 'open-chain');
  assert.ok(route);
  assert.ok(route.ids.includes('walk-in-closet') && route.ids.includes('primary-bath'));
  assert.ok(route.ids.some(id => id.startsWith('balcony-door')));
  assert.ok(route.length > Math.hypot(source.x - receiver.x, source.z - receiver.z));
  assert.equal(route.delay, route.length / 343);
  assert.ok(route.arrival.x > receiver.x);
  assert.ok(Math.hypot(...open.paths.map(path => path.lowGain)) > 5 * Math.hypot(...closed.paths.map(path => path.lowGain)));
  model.dispose();
});

test('all room representatives retain a bounded valid open route and caches', () => {
  const model = createResidenceAcousticPathModel();
  const doors = acousticDoorSnapshot(() => 1);
  for (const a of acousticRooms) for (const b of acousticRooms) {
    const center = room => {
      if (room.id === 'C0') return point(6.4, 13.6);
      const [west, south, east, north] = room.rectangles[0];
      return point((west + east) / 2, (south + north) / 2);
    };
    const result = model.solve(center(a), center(b), doors);
    assert.equal(result.invalidRoom, false);
    assert.equal(result.capped, false);
    assert.ok(result.paths.length > 0 && result.paths.length <= 3);
    assert.ok(result.paths.every(path => Number.isFinite(path.delay) && path.delay >= 0));
    if (result.paths[0].kind === 'direct-or-wall' && result.paths[0].lowGain < .09) {
      assert.ok(result.paths.some(path => path.kind === 'open-chain'), `${a.id} to ${b.id}`);
    }
  }
  assert.ok(model.cacheSizes.topology <= acousticRooms.length ** 2);
  assert.ok(model.cacheSizes.leafStates <= 8);
  model.dispose();
  assert.deepEqual(model.cacheSizes, { topology: 0, leafStates: 0 });
});


test('the concave primary room keeps a finite route around its joined exterior corner', () => {
  const model = createResidenceAcousticPathModel();
  const materials = createResidenceMaterials();
  const shell = createResidenceShell(materials);
  try {
    shell.group.updateMatrixWorld(true);
    const source = point(22, 10.5);
    const listener = point(18, 14);
    const doors = acousticDoorSnapshot(() => 1);
    const result = model.solve(source, listener, doors);
    const direct = result.paths.find(path => path.kind === 'direct-or-wall');
    const route = result.paths.find(path => path.kind === 'room-detour');
    assert.ok(direct && direct.lowGain < .001 && direct.ids.includes('wall:7') && direct.ids.includes('wall:8'));
    assert.ok(route && route.ids.some(id => id.startsWith('wall:7:') || id.startsWith('joint:7:8:')));
    assert.ok(route.length > Math.hypot(source.x - listener.x, source.z - listener.z));
    assert.equal(route.delay, route.length / 343);
    assert.ok(route.lowGain > .1 && route.lowGain < .95 / Math.hypot(source.x - listener.x, source.z - listener.z));
    assert.ok(route.arrival.x < 20.7 && route.arrival.z > -11.48);
    for (let index = 1; index < route.points.length; index += 1) {
      const a = new Vector3().copy(route.points[index - 1]);
      const b = new Vector3().copy(route.points[index]);
      const ray = new Raycaster(a, b.clone().sub(a).normalize(), .0001, a.distanceTo(b) - .0001);
      assert.equal(ray.intersectObject(shell.group, true).length, 0, 'every detour segment clears actual rendered shell geometry');
    }
    const reverse = model.solve(listener, source, doors).paths.find(path => path.kind === 'room-detour');
    assert.ok(reverse && Math.abs(reverse.length - route.length) < 1e-9);
    const nearWindow = model.solve(point(22, 11.4), point(20.5, 14), doors).paths.find(path => path.kind === 'room-detour');
    assert.ok(nearWindow && nearWindow.ids.some(id => id.startsWith('joint:7:8:')),
      'the joined wall thickness is also cleared when both endpoints approach the inner corner faces');
    for (let index = 1; index < nearWindow.points.length; index += 1) {
      const a = new Vector3().copy(nearWindow.points[index - 1]);
      const b = new Vector3().copy(nearWindow.points[index]);
      assert.equal(new Raycaster(a, b.clone().sub(a).normalize(), .0001, a.distanceTo(b) - .0001)
        .intersectObject(shell.group, true).length, 0);
    }
    const nearReverse = model.solve(point(20.5, 14), point(22, 11.4), doors).paths.find(path => path.kind === 'room-detour');
    assert.ok(nearReverse && Math.abs(nearReverse.length - nearWindow.length) < 1e-9);
    const before = model.solve(point(20, 10.5), listener, doors);
    assert.equal(before.paths.length, 1, 'unobstructed source uses its existing direct route');
    const near = model.solve(point(7.29, 2), point(8.2, 2), acousticDoorSnapshot(() => 0));
    assert.ok(near.paths.find(path => path.kind === 'direct-or-wall').lowGain < .1);
  } finally { model.dispose(); shell.dispose(); materials.dispose(); }
});
