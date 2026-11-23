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
const { createResidenceNavigation } = await import('../src/coast/world/residence/residenceNavigation.ts');
const { RESIDENCE_BALCONY_DOOR, RESIDENCE_ROOMS, RESIDENCE_WALLS } =
  await import('../src/coast/world/residence/residencePlan.ts');
const { createResidenceMaterials } = await import('../src/coast/world/residence/residenceMaterials.ts');
const { createResidenceFurniture } = await import('../src/coast/world/residence/residenceFurniture.ts');
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

test('a connected route links the common lobby, all five bedrooms, water rooms and kitchen with furniture in place', () => {
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

test('walking crosses the indoor sofa, dining table and chairs, kitchen island and entry bench', () => {
  const nav = navigation(false);
  assertClearRoute(nav, [[19.99, .43], [19.99, 1.85]]);
  assertClearRoute(nav, [[15.98, 3.3], [15.98, 6.1]]);
  assertClearRoute(nav, [[13.35, 7.715], [16.7, 7.715]]);
  assertClearRoute(nav, [[11.65, 14.84], [12.48, 14.84]]);
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
