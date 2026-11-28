import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const atriumUrl = new URL('../src/coast/world/atrium/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return context.parentURL?.startsWith(atriumUrl) && specifier.startsWith('./') && !specifier.endsWith('.ts')
      ? nextResolve(`${specifier}.ts`, context) : nextResolve(specifier, context);
  },
});
const { ATRIUM_CAFE_BAY: bay, ATRIUM_CAFE_PLAN: plan, ATRIUM_CAFE_SPEAKERS: speakers,
  atriumCafeWorldPoint, atriumCafeLocalPoint } = await import('../src/coast/world/atrium/atriumCafePlan.ts');
const { atriumNavigation: nav } = await import('../src/coast/world/atrium/atriumNavigation.ts');
hooks.deregister();
const blocked = (u, d, foot = 0) => {
  const [x, , z] = atriumCafeWorldPoint(u, d);
  return nav.blocksWalking(x, z, foot);
};

test('R2 preserves frontage and opens only the cafe entrance to a fully supported deep room', () => {
  assert.deepEqual(bay.span, [33.45, 43.55]);
  assert.deepEqual(bay.entry, [2.05, 6.25, .65]);
  assert.equal(plan.depth, 18.4);
  for (const u of [1, 7, 9]) assert.equal(blocked(u, .05), true, 'fixed glass and wings close the frontage');
  assert.equal(blocked(4.15, .05), false);
  for (let d = .9; d <= 17.7; d += .12) {
    const [x, , z] = atriumCafeWorldPoint(6.4, d);
    assert.equal(nav.supportAt(x, z, 10), 0, 'no phantom upper gallery in the extended cafe');
    const underBeam = plan.frameStations.some(station => Math.abs(d - station) <= plan.beamDepth / 2);
    assert.equal(nav.ceilingHeight(x, z), underBeam ? plan.beamBottom : plan.ceiling);
  }
  for (const u of [-1, 11.1]) assert.equal(blocked(u, 2), true, 'adjacent tenancies remain closed');
  assert.equal(blocked(6.4, 18.2), true, 'back wall matches the walk limit');
  assert.equal(blocked(6.4, 5, 4.55), true, 'upper galleries cannot continue above the cafe');
});

test('entrance dogleg and the full 1.80 m customer aisle remain clear after furniture margins', () => {
  for (let d = 0; d <= 1.55; d += .05) assert.equal(blocked(4.15, d), false);
  for (let u = 4.15; u <= 6.4; u += .05) assert.equal(blocked(u, 1.55), false);
  for (let d = 2.5; d <= 17.7; d += .06) {
    for (const u of [5.5, 6.4, 7.3]) assert.equal(blocked(u, d), false, `aisle at (${u},${d})`);
  }
  assert.equal(blocked(2, 4), true, 'service work band is visibly separated from the customer route');
  assert.equal(blocked(2, 17), true, 'closed stock room is not customer space');
  for (const item of bay.fixtures.filter(item => item.type === 'table' || item.type === 'seat')) {
    const [u, d, w, l] = item.rect;
    assert.equal(blocked(u + w / 2, d + l / 2), true, `${item.id} collision follows its footprint`);
  }
});

test('six shared speakers face the occupied room and stay outside the closed stock room', () => {
  assert.equal(speakers.length, 6);
  const stock = bay.fixtures.find(item => item.id === 'R2-04').rect;
  for (const speaker of speakers) {
    const [x, y, z] = speaker.position;
    const { u, d } = atriumCafeLocalPoint(x, z);
    assert.ok(d > 0 && d < plan.depth && y < plan.ceiling);
    assert.ok(u < stock[0] || u > stock[0] + stock[2] || d < stock[1] || d > stock[1] + stock[3]);
    assert.ok(Math.abs(Math.hypot(...speaker.aim) - 1) < 1e-8);
    assert.ok(speaker.aim[1] < 0);
    assert.equal(Math.sign(speaker.aim[2]), u < plan.width / 2 ? -1 : 1);
  }
});

test('entry head clearance uses the unchanged finite soffit and lintel construction', () => {
  const { entryGeometry: entry } = plan;
  assert.equal(entry.soffitDepth, bay.entry[2] + .035);
  assert.equal(entry.soffitBottom, bay.elevation.portalHead);
  assert.equal(entry.lintelDepth, .15);
  assert.equal(entry.lintelBottom, bay.entryHeight);
  for (const [d, expected] of [[.05, 3.32], [.54, 3.32], [.60, 2.86], [.65, 2.86], [.70, 2.86], [.76, 3.45]]) {
    const [x, , z] = atriumCafeWorldPoint(4.15, d);
    assert.equal(nav.ceilingHeight(x, z), expected, `finished underside at d${d}`);
  }
});

test('fixed acoustic finishes and luminaire apertures have finite head clearances', () => {
  for (const [u, d, expected] of [[4, 5, 3.415], [4, 8.1, 3.18], [5.1, 4.2, 3.30], [5.8, 4.2, 3.45]]) {
    const [x, , z] = atriumCafeWorldPoint(u, d);
    assert.equal(nav.ceilingHeight(x, z), expected, `finite detailed ceiling at u${u}/d${d}`);
  }
});

test('seat accounting and wheelchair turning/parallel approach reserves match the actual plan', () => {
  assert.deepEqual(plan.seating, { movableSeats: 19, pairedBenchPlaces: 7, total: 26 });
  for (const [name, [u, d, w, l]] of Object.entries(plan.clearAreas)) {
    for (let a = 0; a <= 1; a += .2) for (let b = 0; b <= 1; b += .2) {
      assert.equal(blocked(u + w * a, d + l * b), false, `${name} is a clear floor reserve`);
    }
  }
});

test('finite side posts, side heads and tilted speaker envelopes constrain their occupied area', () => {
  assert.equal(blocked(.36, 8.1), true, 'the timber side post has a ground footprint');
  assert.equal(blocked(.60, 8.1), false, 'the post margin ends before the side passage');
  for (const [u, d, expected] of [[.36, 10, 3.18], [.36, 10.5,
    plan.speakerHeight - Math.sin(plan.speakerCabinet.tilt) * plan.speakerCabinet.depth / 2
      - Math.cos(plan.speakerCabinet.tilt) * plan.speakerCabinet.height / 2], [.80, 10.5, 3.415]]) {
    const [x, , z] = atriumCafeWorldPoint(u, d);
    assert.ok(Math.abs(nav.ceilingHeight(x, z, 0) - expected) < 1e-8, `local head limit at (${u},${d})`);
    assert.equal(blocked(u, d), false, 'high mounted equipment leaves the floor passable');
  }
});
