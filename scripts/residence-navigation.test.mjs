import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { EXPLORATION_WORLDS, findDestination } = await import('../src/coast/coastDestinations.ts');
const { createResidenceDoors } = await import('../src/coast/world/residence/residenceDoors.ts');
const { createResidenceNavigation } = await import('../src/coast/world/residence/residenceNavigation.ts');
const { RESIDENCE_BALCONY_DOOR, RESIDENCE_DOORWAYS, RESIDENCE_ROOMS, RESIDENCE_TEA_HEARTH, RESIDENCE_TEA_MATS,
  RESIDENCE_TEA_TATAMI, RESIDENCE_WALLS } =
  await import('../src/coast/world/residence/residencePlan.ts');
const { createResidenceMaterials } = await import('../src/coast/world/residence/residenceMaterials.ts');
const { createResidenceFurniture } = await import('../src/coast/world/residence/residenceFurniture.ts');
const { createResidenceShell } = await import('../src/coast/world/residence/residenceShell.ts');
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

test('dwelling follows the drawing dimensions and all travel poses have continuous level support', () => {
  const dwelling = RESIDENCE_ROOMS.filter(room => room.id !== 'C0' && room.id !== 'C1');
  const area = room => room.rectangles.reduce((sum, [w, s, e, n]) => sum + (e - w) * (n - s), 0);
  assert.ok(Math.abs(dwelling.reduce((sum, room) => sum + area(room), 0) - 319.68) < 1e-8);
  assert.ok(Math.abs(area(dwelling.find(room => room.id === 'BL')) - 8.4) < 1e-8);
  assert.equal(RESIDENCE_WALLS.find(wall => wall.kind === 'guard').height, 1.18);
  assert.ok(RESIDENCE_WALLS.flatMap(wall => wall.openings ?? [])
    .filter(opening => opening.kind === 'door').every(opening => opening.to - opening.from >= 0.9));

  const nav = navigation(false);
  assert.equal(nav.flightEnabled, false);
  assert.equal(nav.jumpEnabled, false);
  for (const pose of EXPLORATION_WORLDS.find(world => world.id === 'residence').places) {
    assert.equal(nav.groundHeight(pose.x, pose.z), 0, pose.id);
    assert.equal(nav.blocksWalking(pose.x, pose.z, 0), false, pose.id);
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

test('the gallery pocket door clears the entry route and protects the threshold during travel', () => {
  const shell = createResidenceShell(materials);
  try {
    const { doors } = shell;
    const gallery = RESIDENCE_DOORWAYS.find(({ id }) => id === 'gallery-living');
    const { wall, opening } = gallery;
    const nav = createResidenceNavigation(spawn, furniture.obstacles, () => false, doors);
    const leaf = shell.group.getObjectByName('Gallery pocket door');
    assert.ok(leaf);
    assert.ok(leaf.children.some(mesh => mesh.castShadow && mesh.material === materials.cabinetry
      && !mesh.material.transparent && mesh.material.transmission === 0));
    const retracted = leaf.position.x;
    assert.ok(retracted > opening.to);
    for (const mesh of leaf.children) {
      mesh.geometry.computeBoundingBox();
      assert.ok(retracted + mesh.geometry.boundingBox.max.x < wall.to - .044);
    }
    for (const centre of [opening.from + .27, opening.to - .27]) {
      assertClearRoute(nav, [[centre, 7.35], [centre, 6.05]]);
      assert.equal(nav.groundHeight(centre, -wall.fixed), 0);
    }
    const hallway = doorwayCentre(gallery, .60);
    const threshold = doorwayCentre(gallery);
    assert.equal(doors.nearby(hallway)?.label, 'リビングの引戸を閉める');
    doors.nearby(hallway).invoke();
    assert.equal(doors.update(.55, threshold), false);
    assert.equal(doors.opennessFor(wall, opening), 1);
    assert.ok(doors.update(.275, hallway));
    assert.equal(doors.opennessFor(wall, opening), .5);
    assert.ok(!blocked(nav, opening.from + .29, wall.fixed));
    assert.ok(blocked(nav, opening.to - .29, wall.fixed));
    assert.ok(doors.update(.275, hallway));
    assert.equal(doors.opennessFor(wall, opening), 0);
    assert.ok(blocked(nav, threshold.x, -threshold.z));
    assert.ok(blocked(nav, 13.20, 6.65));
    assertClearRoute(nav, [[11.85, 7.7], [13.45, 7.7]]);
    assertClearRoute(nav, [[16.8, 7.30], [16.8, 6.05], [11.55, 5.63], [10.70, 5.63]]);
    const living = doorwayCentre(gallery, -.60);
    assert.equal(doors.nearby(living)?.label, 'リビングの引戸を開ける');
    doors.nearby(living).invoke();
    assert.ok(doors.update(.55, living));
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
