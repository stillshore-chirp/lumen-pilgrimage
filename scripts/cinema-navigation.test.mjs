import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const source = new URL('../src/coast/world/cinema/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(source) && specifier.startsWith('./') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const {
  CINEMA_AISLES, CINEMA_BOUNDS, CINEMA_CROSS_AISLES, CINEMA_DESTINATIONS, CINEMA_DOOR_WIDTH,
  CINEMA_EXITS, CINEMA_PLACES, CINEMA_ROOM_HEIGHT, CINEMA_ROWS, CINEMA_SCREEN, cinemaGroundHeight,
} = await import('../src/coast/world/cinema/cinemaLayout.ts');
const { cinemaNavigation } = await import('../src/coast/world/cinema/cinemaNavigation.ts');
hooks.deregister();

function clearRoute(a, b) {
  const samples = Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / .04);
  let previousY = cinemaGroundHeight(a.x, a.z);
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const y = cinemaGroundHeight(x, z);
    assert.equal(cinemaNavigation.blocksWalking(x, z, y), false, `route blocked at ${x}, ${z}`);
    assert.ok(Math.abs(y - previousY) <= .04 * .91);
    previousY = y;
  }
}

test('cinema room follows the drawing and each seat can reach the longitudinal aisles', () => {
  assert.equal(CINEMA_BOUNDS.maxX - CINEMA_BOUNDS.minX, 40);
  assert.equal(CINEMA_BOUNDS.maxZ - CINEMA_BOUNDS.minZ, 57);
  assert.equal(CINEMA_ROOM_HEIGHT, 22);
  assert.equal(CINEMA_SCREEN.width, 30);
  assert.equal(CINEMA_SCREEN.bottom, 4.1);
  assert.equal(CINEMA_ROWS.length, 20);
  assert.equal(CINEMA_PLACES.filter(place => place.kind === 'seat').length, 580);
  assert.equal(CINEMA_PLACES.filter(place => place.kind === 'companion').length, 8);
  assert.equal(CINEMA_PLACES.filter(place => place.kind === 'wheelchair').length, 8);

  for (const place of CINEMA_PLACES) {
    const a = CINEMA_AISLES[place.bank].x;
    const b = CINEMA_AISLES[place.bank + 1].x;
    const aisle = Math.abs(a - place.x) < Math.abs(b - place.x) ? a : b;
    clearRoute(place, { x: aisle, z: place.z });
    if (place.kind === 'seat') assert.ok(cinemaNavigation.blocksWalking(place.x, place.z + .29, place.y));
  }
});

test('all main aisles, level wheelchair connections and eight exits remain walkable', () => {
  assert.equal(CINEMA_EXITS.length, 8);
  assert.equal(CINEMA_DOOR_WIDTH, 1.8);
  for (const { x } of CINEMA_AISLES) clearRoute({ x, z: 17 }, { x, z: 52.9 });
  for (const { z, width, y } of CINEMA_CROSS_AISLES) {
    assert.ok(width >= 2.6);
    clearRoute({ x: -19.6, z }, { x: 19.6, z });
    for (const dz of [-width / 2, 0, width / 2]) {
      assert.ok(Math.abs(cinemaGroundHeight(0, z + dz) - y) < .0001);
    }
  }
  for (const exit of CINEMA_EXITS) {
    const x = exit.x - (exit.side === 'left' ? -.4 : exit.side === 'right' ? .4 : 0);
    const z = exit.z - (exit.side === 'rear' ? .4 : 0);
    assert.equal(cinemaNavigation.blocksWalking(x, z, exit.y), false);
    assert.equal(cinemaGroundHeight(x, z), exit.y);
  }
  for (const bay of CINEMA_PLACES.filter(place => place.kind === 'wheelchair')) {
    const z = CINEMA_CROSS_AISLES[bay.row === 8 ? 1 : 2].z;
    clearRoute(bay, { x: bay.x, z });
    assert.equal(cinemaGroundHeight(bay.x, z), bay.y);
  }
});

test('cinema destinations start on the corresponding deck and face the center of the screen', () => {
  assert.deepEqual(CINEMA_DESTINATIONS.map(place => place.seatedEyeHeight), [1.15, 1.15, 1.15, 1]);
  assert.equal(cinemaNavigation.spawn, CINEMA_DESTINATIONS[0]);
  for (const place of CINEMA_DESTINATIONS) {
    const y = cinemaGroundHeight(place.x, place.z);
    assert.equal(cinemaNavigation.blocksWalking(place.x, place.z, y), false);
    assert.ok(Math.abs(place.x - Math.tan(place.yaw) * place.z) < 1e-8);
    const target = y + place.seatedEyeHeight + Math.tan(place.pitch) * Math.hypot(place.x, place.z);
    assert.ok(Math.abs(target - (CINEMA_SCREEN.bottom + CINEMA_SCREEN.height / 2)) < 1e-8);
  }
});
