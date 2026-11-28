import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Raycaster, Scene, ShaderLib, Texture, Vector3, Vector4 } from 'three';
import { COAST_SUN_DIRECTION, createCoastAtmosphere } from '../src/coast/world/coastAtmosphere.ts';
import { PRIMARY_RAINBOW_ANGLE } from '../src/coast/world/coastSprayRainbow.ts';
import {
  COAST_BOUNDS, COAST_FALLS, COAST_WALKS, FOREST_STREAM, FOREST_WALKS, SEA_LEVEL, SPAWN,
  coastBedrock, coastPlantingDistance, coastTreadWear, forestStreamLevel, groundHeight, shoreline,
} from '../src/coast/terrain.ts';

const acousticsUrl = new URL('../src/coast/coastAcoustics.ts', import.meta.url).href;
const overlookUrl = new URL('../src/coast/world/overlook/overlookTerrain.ts', import.meta.url).href;
const trafficUrl = new URL('../src/coast/world/overlook/overlookTraffic.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === overlookUrl && specifier === '../coastNoise') return nextResolve('../coastNoise.ts', context);
    if (context.parentURL?.includes('/coast/world/') && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    const path = specifier === './terrain' && context.parentURL === acousticsUrl ? './terrain.ts' : specifier;
    return nextResolve(path, context);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url === overlookUrl) result.source = String(result.source).replaceAll('import.meta.env.BASE_URL', "''");
    return result;
  },
});
const { airCutoff, soundReach, terrainOcclusion, waterReflection } = await import(acousticsUrl);
const { createOverlookSurface, gradeOverlookSurvey, gradeBeforeLocalWorks, gradeOverlookView, loadOverlookSurvey, OVERLOOK_SURFACE_BOUNDS } = await import(overlookUrl);
const { createOverlookTraffic } = await import(trafficUrl);
const { createOverlookCorridorPlan, createOverlookRoadDatum, corridorRole, sampleCorridorRoad } =
  await import('../src/coast/world/overlook/overlookCorridorPlan.ts');
const { createOverlookEarthworks } = await import('../src/coast/world/overlook/overlookEarthworks.ts');
const { createOverlookDeck } = await import('../src/coast/world/overlook/overlookDeck.ts');
const { PAVILION_BODY, PAVILION_THRESHOLD, pavilionWing, pavilionEntrancePier } = await import('../src/coast/world/overlook/overlookPavilionPlan.ts');
const { createOverlookRoadStructures } = await import('../src/coast/world/overlook/overlookRoadStructures.ts');
const { createCoastLighting } = await import('../src/coast/world/coastLighting.ts');
hooks.deregister();

let corridorFixture;
async function fixture() {
  corridorFixture ??= (async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async path => {
      const data = await readFile(new URL(`../public/${path}`, import.meta.url));
      return { ok: true, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    };
    let native;
    try { native = await loadOverlookSurvey(); } finally { globalThis.fetch = previousFetch; }
    const height = (x, z) => gradeOverlookView(x, z, native(x, z));
    const surface = createOverlookSurface(height, { texture: new Texture(), bounds: new Vector4(-23000, -26000, 46000, 37000) }, { value: 0 });
    const required = (x, z) => { const y = surface.sampleHeight(x, z); assert.notEqual(y, undefined); return y; };
    const plan = createOverlookCorridorPlan(createOverlookRoadDatum(native), required, OVERLOOK_SURFACE_BOUNDS);
    const earthworks = createOverlookEarthworks(surface.group, surface.sampleHeight, plan, surface.material);
    return { plan, surface, earthworks, required, native };
  })();
  return corridorFixture;
}
after(async () => { if (corridorFixture) { const f = await corridorFixture; f.earthworks.dispose(); f.surface.dispose(); } });

test('the original horizontal alignment stays fixed while actual-chord grades receive only a small lift', async () => {
  const { plan } = await fixture();
  const reference = JSON.parse(await readFile(new URL('./fixtures/overlook-road-alignment.json', import.meta.url), 'utf8'));
  assert.equal(plan.roads.length, reference.rows.length);
  for (const road of plan.roads) {
    const original = road.frames.filter(p => p.station >= road.originalOffset - 1e-7);
    const packed = Int32Array.from(original.flatMap(p => [Math.round(p.x * 1000), Math.round(p.z * 1000), Math.round(p.nx * 1e6), Math.round(p.nz * 1e6)]));
    assert.equal(original.length, reference.rows[road.id].frames);
    assert.equal(createHash('sha256').update(Buffer.from(packed.buffer)).digest('hex'), reference.rows[road.id].xzNormalSha256);
    for (const anchor of reference.rows[road.id].elevationAnchors) {
      const delta = original[anchor.index].y - .42 - anchor.y;
      assert.ok(delta >= -1e-5 && delta < .018, 'old elevations change only by the bounded grade repair');
    }
    assert.ok(plan.alignment[road.id].maximumLift < .018);
    for (let i = 1; i < road.frames.length; i++) {
      const a = road.frames[i - 1], b = road.frames[i];
      assert.ok(Math.abs(a.y - b.y) / Math.hypot(a.x - b.x, a.z - b.z) < .05801);
      assert.ok(a.nx * b.nx + a.nz * b.nz > 0, 'the lateral frame does not flip');
    }
  }
});

test('near road ends continue through covered curves, rather than terminate at a visible facade', async () => {
  const { plan, required } = await fixture();
  assert.equal(plan.portals.length, 7);
  for (const portal of plan.portals) {
    const road = plan.roads[portal.roadId], end = road.frames[0];
    assert.ok(required(end.x, end.z) > end.y + portal.roofAboveRoad + 2);
    assert.equal(corridorRole(plan, road.id, 0), 'tunnel');
    const radius = road.id === 4 ? 220 : 360, halfAngle = 350 / radius / 2;
    // The widest possible chord between curve entrances crosses the inner wall.
    // This proves the turn hides the end only when earth/lining closure also holds.
    for (const [lo, hi] of [[-portal.halfWidth - 1, -portal.medianHalfWidth],
      [portal.medianHalfWidth, portal.halfWidth + 1]]) {
      assert.ok((radius + lo) * Math.cos(2.5 / radius / 2) - .001 > (radius + hi + .001) * Math.cos(halfAngle));
    }
    assert.ok(plan.isRoadway(end.x, end.z));
  }
  assert.equal(plan.isRoadway(NaN, 0), false);
  assert.equal(plan.isRoadway(0, 0, -1), false);
});

test('the excavation query matches the actual formation triangles and leaves local plants unchanged', async () => {
  const { plan, surface, earthworks } = await fixture();
  surface.group.updateMatrixWorld(true); earthworks.group.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  for (const approach of plan.approaches) for (let i = 0; i < approach.frames.length; i += 19) {
    // Portal edges have native top plus an open headwall; use the explicit interior side.
    const p = sampleCorridorRoad(plan.roads[approach.roadId], Math.min(approach.frames.at(-1).station - .05, approach.frames[i].station + .05));
    for (const across of [-.8, 0, .8]) {
      const x = p.x + p.nx * approach.halfWidth * across, z = p.z + p.nz * approach.halfWidth * across;
      ray.set(new Vector3(x, 2000, z), new Vector3(0, -1, 0));
      const hit = ray.intersectObjects([...surface.group.children, ...earthworks.group.children], true)
        .find(h => h.object.name !== 'Thick retaining walls tied to original survey triangles');
      assert.ok(hit); assert.ok(Math.abs(hit.point.y - earthworks.sampleHeight(x, z)) < 1e-5);
    }
  }
  for (const [x, z] of [[-52.2466316, 19.9922581], [46.1711845, 6.2618089], [26.9566555, 102.3814316]]) {
    assert.equal(earthworks.sampleHeight(x, z), surface.sampleHeight(x, z));
  }
  assert.equal(earthworks.sampleHeight(NaN, 0), undefined);
  assert.equal(earthworks.sampleHeight(23000.01, 0), undefined);
});

test('covered traffic source length is split once between real open bores', async () => {
  const { plan, earthworks } = await fixture();
  const traffic = createOverlookTraffic((x, z) => earthworks.sampleHeight(x, z), plan);
  const structures = createOverlookRoadStructures(plan);
  structures.group.updateMatrixWorld(true);
  try {
    assert.equal(traffic.soundCorridors.length, 22);
    for (const road of plan.roads.filter(r => r.plan.soundWeight !== undefined)) {
      const sources = traffic.soundCorridors.filter(c => c.roadId === road.id), portal = plan.portals.find(p => p.roadId === road.id);
      assert.equal(sources.length, portal ? 3 : 1);
      const length = sources.flatMap(c => c.sections).reduce((sum, section) => sum + section.length, 0);
      assert.ok(Math.abs(length - road.length) < 1e-6);
      for (const source of sources) {
        assert.equal(source.weight, road.plan.soundWeight);
        assert.ok(source.playbackRate >= .923 - 1e-12 && source.playbackRate <= 1);
        assert.ok(Number.isFinite(source.offsetSeconds) && source.offsetSeconds >= 0);
        if (source.role === 'exposed') {
          assert.equal(source.playbackRate, 1 - road.id * .011);
          assert.equal(source.offsetSeconds, road.id * 23.7);
        }
        assert.ok(source.sections.every(section => section.length > 0 && section.interiorDistance >= 0));
        if (source.role === 'exposed') { assert.ok(source.sections.every(section => section.interiorDistance === 0)); continue; }
        const headwall = structures.structures.find(s => s.roadId === road.id).portal;
        const point = source.sections[0].point;
        assert.ok(source.sections.every(section => section.point === point && section.interiorDistance > 0));
        const outward = new Vector3(portal.frame.nz, 0, -portal.frame.nx), from = new Vector3(point.x, point.y, point.z).addScaledVector(outward, 3);
        const ray = new Raycaster(from, outward.negate(), 0, 4);
        assert.equal(ray.intersectObject(headwall, false).length, 0, 'arrival is inside an actual arch opening, not the median web');
      }
      if (portal) {
        const covered = sources.filter(c => c.role === 'portal').map(c => c.sections.reduce((sum, section) => sum + section.length, 0));
        assert.ok(Math.abs(covered[0] - portal.frame.station * .5) < 1e-6);
        assert.ok(Math.abs(covered[1] - portal.frame.station * .5) < 1e-6);
      }
    }
    traffic.setQuality('high');
    const cars = traffic.group.getObjectByName('Moving cars and freight vehicles');
    for (const time of [0, 17, 937]) { traffic.update(time); assert.ok(Array.from(cars.instanceMatrix.array).every(Number.isFinite)); }
  } finally { traffic.dispose(); structures.dispose(); }
});

test('native soil closes a recessed back crest without raising the complete headwall', async () => {
  const { plan, surface, earthworks } = await fixture();
  const portal = plan.portals.find(p => p.roadId === 1), lateral = 8.9125;
  const x = portal.frame.x + portal.frame.nx * lateral, z = portal.frame.z + portal.frame.nz * lateral;
  let i = 0; while (portal.crest[i + 1].lateral < lateral) i++;
  const a = portal.crest[i], b = portal.crest[i + 1], top = portal.frame.y + a.height + (b.height - a.height) * (lateral - a.lateral) / (b.lateral - a.lateral);
  const ground = surface.sampleHeight(x, z);
  assert.ok(ground > top + .01, 'the regression point retains its measured crest recess');
  const forward = new Vector3(portal.frame.nz, 0, -portal.frame.nx), from = new Vector3(x, (ground + top) * .5, z).addScaledVector(forward, .02);
  earthworks.group.updateMatrixWorld(true);
  const ray = new Raycaster(from, forward.negate(), 0, .04);
  const hit = ray.intersectObjects(earthworks.group.children, true).find(h => h.object.name === 'Native soil sections closing recessed portal crests');
  assert.ok(hit, 'the actual generated soil face closes the former back-edge aperture');
});

test('road construction rejects nonfinite datum and incompatible finite field bounds', async () => {
  const { native, required } = await fixture();
  assert.throws(() => createOverlookCorridorPlan(() => NaN, required, OVERLOOK_SURFACE_BOUNDS), /finite road design/);
  assert.throws(() => createOverlookCorridorPlan(createOverlookRoadDatum(native), required,
    { minX: -500, maxX: 500, minZ: -500, maxZ: 500 }), /outside the declared field/);
});

test('the overlook excavation closes locally and does not impose a basin-wide Z seam', () => {
  const survey = (x, z) => 300 + .025 * x - .04 * z;
  const height = (x, z) => gradeOverlookSurvey(x, z, survey(x, z));
  for (const x of [-750, -450, -300, 300, 450, 750]) {
    for (const z of [-200, -11, 0, 6, 200]) assert.equal(height(x, z), survey(x, z));
  }
  for (const x of [-34, 0, 34]) {
    for (const z of [-24, 0, 30]) assert.equal(height(x, z), 345.65);
  }
  // A constant survey isolates the grading derivative from survey cell edges.
  const graded = (x, z) => gradeOverlookSurvey(x, z, 350);
  const derivative = (x, z, dx, dz) => (graded(x + dx * .001, z + dz * .001)
    - graded(x - dx * .001, z - dz * .001)) / .002;
  for (const side of [0, 15, 65, 125, 235, 240, 241]) {
    const x = 35.45 + side;
    for (const z of [-11, 6 + side * 2]) {
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const before = derivative(x - dx * .002, z - dz * .002, dx, dz);
        const after = derivative(x + dx * .002, z + dz * .002, dx, dz);
        assert.ok(Math.abs(before - after) < .01, `continuous grading derivative at ${x}, ${z}`);
      }
    }
  }
});

test('foreground grading lowers the measured ridge while retaining the foundation, rear and outer basin', async () => {
  const { native, surface } = await fixture();
  for (const [x, z, minimumDrop] of [[0, -200, 40], [400, -200, 35], [-400, -200, 20]]) {
    const original = gradeBeforeLocalWorks(x, z, native(x, z));
    assert.ok(original - surface.sampleHeight(x, z) > minimumDrop, 'the actual Float32 surface opens the foreground');
  }
  for (const [x, z] of [[0, -24.45], [-34, 0], [34, 30], [-400, 0], [400, 200], [0, -650], [-650, -300], [650, -300]]) {
    const surveyed = native(x, z);
    assert.equal(gradeOverlookView(x, z, surveyed), gradeBeforeLocalWorks(x, z, surveyed));
  }
  const graded = (x, z) => gradeOverlookView(x, z, 350);
  const derivative = (x, z, dx, dz) => (graded(x + dx * .001, z + dz * .001)
    - graded(x - dx * .001, z - dz * .001)) / .002;
  for (const run of [200, 580]) {
    const x = 35.45 + run * .6, z = -24.45 - run * .8;
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      assert.ok(Math.abs(derivative(x - dx * .002, z - dz * .002, dx, dz)
        - derivative(x + dx * .002, z + dz * .002, dx, dz)) < .01);
    }
  }
});

test('foreground grading retains soil over the curved road 4 outer lining at a terrain diagonal', async () => {
  const { plan, surface } = await fixture();
  const structures = createOverlookRoadStructures(plan);
  const bore = structures.structures.find(item => item.roadId === 4).lining[0];
  surface.group.updateMatrixWorld(true); structures.group.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  try {
    // The old 600 m grading return left only 0.655 m of soil here. Its centreline
    // and first frame stayed covered, so this needs actual shell/ground faces.
    for (const [dx, dz] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      ray.set(new Vector3(-422.5941798360663 + dx, 2000, -319.4058201639337 + dz), new Vector3(0, -1, 0));
      const ground = ray.intersectObjects(surface.group.children, true)[0];
      const shell = ray.intersectObject(bore, false)[0];
      assert.ok(ground && shell, 'the ray meets the rendered soil and outer shell');
      assert.ok(ground.point.y - shell.point.y >= 2, 'the actual shell keeps at least two metres of soil');
    }
  } finally { structures.dispose(); }
});

test('the overlook terrain tiles preserve every face, vertex and normal', () => {
  const streets = { texture: new Texture(), bounds: new Vector4(-10, -10, 10, 10) };
  const heightAt = (x, z) => 50 + 10 * Math.sin(x / 150) * Math.cos(z / 150);
  const whole = createOverlookSurface(heightAt, streets, { value: 0 });
  const tiled = createOverlookSurface(heightAt, streets, { value: 0 }, { value: 0 });
  try {
    const base = whole.group.children[0].geometry;
    const tiles = tiled.group.children.map(child => child.geometry);
    assert.ok(tiles.length > 1);
    const faceOrder = new Map();
    for (let i = 0; i < base.index.count; i += 6) faceOrder.set(base.index.array[i], i);
    for (const tile of tiles) {
      const { start, count } = tile.drawRange;
      assert.ok(count > 0 && count % 6 === 0);
      assert.ok(tile.boundingSphere.radius > 0);
      for (let i = start; i < start + count; i += 6) {
        const cell = tile.index.array[i];
        const original = faceOrder.get(cell);
        if (original === undefined) assert.fail(`Unknown or duplicate terrain cell ${cell}`);
        for (let vertex = 0; vertex < 6; vertex += 1) {
          if (tile.index.array[i + vertex] !== base.index.array[original + vertex]) {
            assert.fail(`Terrain cell ${cell} changed topology`);
          }
        }
        faceOrder.delete(cell);
      }
    }
    assert.equal(faceOrder.size, 0);
    for (const attribute of ['position', 'normal', 'color']) {
      assert.deepEqual(tiles[0].getAttribute(attribute).array, base.getAttribute(attribute).array);
    }
  } finally {
    whole.dispose();
    tiled.dispose();
    streets.texture.dispose();
  }
});

test('overlook support samples match actual Float32 triangles on both sides of every sampled diagonal', () => {
  const streets = { texture: new Texture(), bounds: new Vector4(-10, -10, 10, 10) };
  const surface = createOverlookSurface((x, z) => 50 + .005 * x + .003 * z + 3 * Math.sin(x / 13) * Math.cos(z / 9),
    streets, { value: 0 });
  try {
    const mesh = surface.group.children[0], position = mesh.geometry.getAttribute('position');
    surface.group.updateMatrixWorld(true);
    let columns = 1;
    while (position.getZ(columns) === position.getZ(0)) columns++;
    const rows = position.count / columns;
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
    const testColumns = new Set([0, 3, Math.floor(columns / 2), columns - 2]);
    for (const edge of [-4800, -1150, -205, -50, -36.85, -35.45, 35.45, 36.85, 50, 205, 1150, 4800]) {
      for (let column = 0; column < columns - 1; column++) {
        if (position.getX(column) <= edge && position.getX(column + 1) >= edge) { testColumns.add(column); break; }
      }
    }
    for (const row of [0, 3, Math.floor(rows / 2), rows - 2]) {
      for (const column of testColumns) {
        const a = row * columns + column, b = a + columns;
        for (const [u, v] of [[0, 0], [.2, .2], [.5, .5], [.8, .8], [1, 1]]) {
          const x = position.getX(a) + u * (position.getX(a + 1) - position.getX(a));
          const z = position.getZ(a) + v * (position.getZ(b) - position.getZ(a));
          ray.ray.origin.set(x, 3000, z);
          const hit = ray.intersectObject(mesh, false)[0];
          assert.ok(hit, `actual triangle at ${x}, ${z}`);
          assert.ok(Math.abs(surface.sampleHeight(x, z) - hit.point.y) < 1e-6,
            `support and actual mesh agree at ${x}, ${z}`);
        }
      }
    }
    for (const [x, z] of [[NaN, 0], [0, Infinity], [-23000.001, 0], [23000.001, 0], [0, -26000.001], [0, 11000.001]]) {
      assert.equal(surface.sampleHeight(x, z), undefined, 'invalid or outside input is not silently clamped');
    }
  } finally {
    surface.dispose(); streets.texture.dispose();
  }
});

let supportDeck;
function pavingDeck() {
  supportDeck ??= createOverlookDeck({ value: 0 }, { value: 0 });
  supportDeck.group.updateMatrixWorld(true);
  return supportDeck;
}
after(() => {
  if (!supportDeck) return;
  supportDeck.dispose();
  const geometries = new Set(), materials = new Set(), textures = new Set();
  supportDeck.group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const key of ['map', 'bumpMap', 'alphaMap']) if (material[key]) textures.add(material[key]);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
});

test('terrace stones remain closed solids with the intended floor and underside', () => {
  const deck = pavingDeck(), mesh = deck.group.getObjectByName('Beveled terrace slabs');
  assert.ok(mesh);
  const geometry = mesh.geometry, position = geometry.getAttribute('position'), index = geometry.getIndex(), edges = new Map();
  const key = i => `${position.getX(i).toFixed(6)},${position.getY(i).toFixed(6)},${position.getZ(i).toFixed(6)}`;
  for (let i = 0; i < index.count; i += 3) {
    const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map(key);
    for (let e = 0; e < 3; e++) { const pair = [vertices[e], vertices[(e + 1) % 3]].sort().join('|'); edges.set(pair, (edges.get(pair) ?? 0) + 1); }
  }
  assert.ok([...edges.values()].every(count => count === 2), 'every stone edge has two incident faces');
  geometry.computeBoundingBox();
  assert.ok(Math.abs(geometry.boundingBox.min.y + .05) < 1e-6);
  assert.ok(geometry.boundingBox.max.y <= .001501);
  const down = new Raycaster(), up = new Raycaster(); let checked = 0;
  for (let x = -30; x <= 30; x += 5) for (let z = -20; z <= 5; z += 5) {
    down.set(new Vector3(x, 346.1, z), new Vector3(0, -1, 0));
    up.set(new Vector3(x, 345.94, z), new Vector3(0, 1, 0));
    const top = down.intersectObject(mesh, false)[0], bottom = up.intersectObject(mesh, false)[0];
    if (!top) continue;
    assert.ok(bottom); const thickness = top.point.y - bottom.point.y;
    assert.ok(thickness >= .04849 && thickness <= .05151); checked++;
  }
  assert.ok(checked > 50);
});

test('terrace bearing meets all six shared ground blocks and preserves the nonstone floor', () => {
  const deck = pavingDeck(), bearing = deck.group.getObjectByName('Recessed limestone');
  const backing = deck.group.children.filter(object => object.name === 'Terrace joints');
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  for (const [x, , z, width, , depth] of [PAVILION_BODY, pavilionWing(-1), pavilionWing(1),
    pavilionEntrancePier(-1), pavilionEntrancePier(1), PAVILION_THRESHOLD]) {
    for (const dx of [-.49, 0, .49]) for (const dz of [-.49, 0, .49]) {
      ray.set(new Vector3(x + width * dx, 346.01, z + depth * dz), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(bearing, false).find(h => Math.abs(h.point.y - 346) < 1e-6);
      assert.ok(hit, 'the actual ground block footprint has bearing at its underside');
      assert.ok(ray.intersectObjects(backing, false).some(h => Math.abs(h.point.y - 345.9645) < 1e-6));
    }
  }
  for (const [x, z] of [[16, 10.5], [23.5, 9.5], [0, 9.2]]) {
    ray.set(new Vector3(x, 345.98, z), new Vector3(0, -1, 0));
    assert.ok(ray.intersectObjects(backing, false).some(h => Math.abs(h.point.y - 345.9645) < 1e-6));
  }
});

test('the finite receiver domain covers the actual threshold front face only', () => {
  const deck = pavingDeck(), [domain] = deck.receiverPlaneShadowDomains;
  assert.equal(deck.receiverPlaneShadowDomains.length, 1);
  assert.equal(domain.material, deck.group.getObjectByName('Recessed limestone').material);
  const [x, , z, width, , depth] = PAVILION_THRESHOLD;
  assert.ok(Math.abs(domain.min.x - (x - width / 2)) < 1e-5);
  assert.ok(Math.abs(domain.max.x - (x + width / 2)) < 1e-5);
  assert.ok(Math.abs(domain.min.z - (z - depth / 2)) < 1e-5);
  assert.equal(domain.min.z, domain.max.z);
  const ray = new Raycaster(new Vector3(), new Vector3(0, 0, 1));
  for (const fx of [.01, .5, .99]) for (const fy of [.01, .5, .99]) {
    const px = domain.min.x + (domain.max.x - domain.min.x) * fx;
    const py = domain.min.y + (domain.max.y - domain.min.y) * fy;
    ray.set(new Vector3(px, py, domain.min.z - 1), new Vector3(0, 0, 1));
    const hit = ray.intersectObject(deck.group.getObjectByName('Recessed limestone'), false)[0];
    assert.ok(hit && Math.abs(hit.point.z - domain.min.z) < 1e-6, 'domain points lie on the rendered front face');
  }
});

test('finite receiver coordinates use the unbiased face projection independently of shadow comparison bias', () => {
  const deck = pavingDeck(), [domain] = deck.receiverPlaneShadowDomains;
  const world = domain.min.clone().add(domain.max).multiplyScalar(.5), normal = new Vector3(0, 0, -1);
  const atmosphere = createCoastAtmosphere(new Vector3(-.66, .51, -.55));
  const scene = new Scene();
  // Material selection is explicit; the scene needs no GPU objects for this coordinate test.
  const lighting = createCoastLighting(scene, atmosphere, () => 346);
  try {
    lighting.setQuality('high');
    const camera = new PerspectiveCamera(); camera.position.copy(world).add(new Vector3(0, .3, -1.1));
    lighting.update(0, camera); scene.updateMatrixWorld(true);
    const light = scene.children.find(object => object.isDirectionalLight && object.shadow.mapSize.x === 2048);
    light.shadow.updateMatrices(light);
    const matrix = light.shadow.matrix, e = matrix.elements;
    const p0 = world.clone().applyMatrix4(matrix), biased = world.clone().addScaledVector(normal, light.shadow.normalBias).applyMatrix4(matrix);
    const worldDx = new Vector3(.001, 0, 0), worldDy = new Vector3(0, .001, 0);
    const dx = world.clone().add(worldDx).addScaledVector(normal, light.shadow.normalBias).applyMatrix4(matrix).sub(biased);
    const dy = world.clone().add(worldDy).addScaledVector(normal, light.shadow.normalBias).applyMatrix4(matrix).sub(biased);
    const det = dx.x * dy.y - dx.y * dy.x;
    const worldU = worldDx.clone().multiplyScalar(dy.y).addScaledVector(worldDy, -dx.y).divideScalar(det);
    const worldV = worldDy.clone().multiplyScalar(dx.x).addScaledVector(worldDx, -dy.x).divideScalar(det);
    // Independent oracle: solve the two UV equations directly on the real constant-Z face.
    const solveFace = uv => {
      const a = uv[0] - e[8] * domain.min.z - e[12], b = uv[1] - e[9] * domain.min.z - e[13];
      const determinant = e[0] * e[5] - e[4] * e[1];
      return new Vector3((a * e[5] - e[4] * b) / determinant, (e[0] * b - a * e[1]) / determinant, domain.min.z);
    };
    const inside = point => point.y >= domain.min.y && point.y <= domain.max.y;
    let oldAnchorReversals = 0;
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) {
      const uv = [(Math.floor(biased.x * 2048) + x + .5) / 2048, (Math.floor(biased.y * 2048) + y + .5) / 2048];
      const actual = solveFace(uv);
      const correct = world.clone().addScaledVector(worldU, uv[0] - p0.x).addScaledVector(worldV, uv[1] - p0.y);
      const wrong = world.clone().addScaledVector(worldU, uv[0] - biased.x).addScaledVector(worldV, uv[1] - biased.y);
      assert.ok(correct.distanceTo(actual) < 1e-7);
      if (inside(wrong) !== inside(actual)) oldAnchorReversals++;
    }
    assert.ok(oldAnchorReversals > 0, 'the normalBias anchoring regression must be exercised');
  } finally { lighting.dispose(); atmosphere.sky.value.dispose(); }
});

test('finite receiver shader opt-in leaves the default lighting path unchanged', () => {
  const atmosphere = createCoastAtmosphere(new Vector3(-.66, .51, -.55));
  const shader = material => {
    const result = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(result, {});
    return { key: material.customProgramCacheKey(), vertex: result.vertexShader, fragment: result.fragmentShader };
  };
  const runDefault = options => {
    const scene = new Scene(), material = new MeshStandardMaterial(), geometry = new BoxGeometry();
    scene.add(new Mesh(geometry, material));
    const lighting = createCoastLighting(scene, atmosphere, () => 346, options);
    try { return shader(material); } finally { lighting.dispose(); material.dispose(); geometry.dispose(); }
  };
  try {
    const baseline = runDefault();
    assert.deepEqual(runDefault({ receiverPlaneShadowMaterials: [], receiverPlaneShadowDomains: [] }), baseline);
    const deck = pavingDeck(), [domain] = deck.receiverPlaneShadowDomains;
    const originalHooks = new Map();
    deck.group.traverse(object => {
      for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
        originalHooks.set(material, { compile: material.onBeforeCompile, key: material.customProgramCacheKey });
      }
    });
    const scene = new Scene(); scene.add(deck.group);
    const lighting = createCoastLighting(scene, atmosphere, () => 346, {
      receiverPlaneShadowMaterials: deck.receiverPlaneShadowMaterials, receiverPlaneShadowDomains: deck.receiverPlaneShadowDomains,
    });
    try {
      const selected = shader(domain.material);
      assert.ok(selected.key.endsWith('|finite-receiver-domain-v2'));
      assert.match(selected.vertex, /coastUnbiasedLocal = directionalShadowMatrix\[1\] \* worldPosition/);
      assert.match(selected.fragment, /domainDelta = center - domainAnchorUV/);
      assert.match(selected.fragment, /coastLocalWorldTangents, vCoastUnbiasedLocalShadowUV/);
      assert.match(selected.fragment, /p\.z \+ dot\(depthGradient, delta\)/);
      for (const material of deck.receiverPlaneShadowMaterials.filter(value => value !== domain.material)) {
        const other = shader(material);
        assert.ok(!other.key.includes('finite-receiver-domain'));
        assert.ok(!other.vertex.includes('vCoastUnbiasedLocalShadowUV'));
      }
    } finally {
      lighting.dispose(); scene.remove(deck.group);
      for (const [material, hooks] of originalHooks) {
        material.onBeforeCompile = hooks.compile; material.customProgramCacheKey = hooks.key;
      }
    }
  } finally { atmosphere.sky.value.dispose(); }
});

test('the coast contains a dry approach, tidal edge, and submerged seabed', () => {
  const { x, z } = SPAWN;
  assert.ok(x > COAST_BOUNDS.minX && x < COAST_BOUNDS.maxX);
  assert.ok(z > COAST_BOUNDS.minZ && z < COAST_BOUNDS.maxZ);
  assert.ok(groundHeight(x, z) > SEA_LEVEL + 1.5);
  for (let beachX = x - 8; beachX <= x + 8; beachX += 4) {
    const edge = shoreline(beachX);
    assert.ok(groundHeight(beachX, edge - 3) < SEA_LEVEL);
    assert.ok(groundHeight(beachX, edge + 3) > SEA_LEVEL);
  }
});

test('the sandy inlet opens to sea between headlands', () => {
  for (let z = -3; z >= COAST_BOUNDS.minZ; z -= 4) {
    assert.ok(groundHeight(30, z) < SEA_LEVEL);
  }
  assert.ok(groundHeight(-180, -143) > 135);
  assert.ok(groundHeight(196, -199) > 155);
  assert.ok(groundHeight(-73, -281) > 75);
});

test('the land leaves the direct sun open above the vermilion trail courts', () => {
  const sites = [
    [210, 901, 'large torii'], [215, 913, 'gate approach'], [216, 923, 'forecourt'],
    [207, 922, 'worship hall'], [231, 948, 'fork'], [235, 961, 'east steps'],
    [229, 961, 'west steps'], [253, 1035, 'upper court'], [254, 1038, 'small shrine'],
  ];
  for (const [x, z, site] of sites) {
    const y = groundHeight(x, z) + 0.35;
    for (let distance = 2; distance <= 195; distance += 1) {
      const h = groundHeight(x + COAST_SUN_DIRECTION.x * distance, z + COAST_SUN_DIRECTION.z * distance);
      assert.ok(h < y + COAST_SUN_DIRECTION.y * distance, `${site} is in the ridge's shadow at ${distance} m`);
    }
  }
});

test('both trails reach a high lookout and the east trail skirts shallow tidal pools', () => {
  for (const { points, overlook } of COAST_WALKS) {
    assert.deepEqual(points.at(0), points.at(-1));
    assert.ok(points.some(point => Math.hypot(point.x - overlook.x, point.z - overlook.z) < 0.5));
    assert.ok(groundHeight(overlook.x, overlook.z) > SEA_LEVEL + 30);
    assert.ok(points.every(p => groundHeight(p.x, p.z) > SEA_LEVEL + 1.4));
    const direction = Math.atan2(overlook.towardZ - overlook.z, overlook.towardX - overlook.x);
    for (const distance of [4, 15, 30, 54]) {
      assert.equal(coastPlantingDistance(overlook.x + distance * Math.cos(direction),
        overlook.z + distance * Math.sin(direction)), 0);
    }
  }
  for (const [x, z] of [[48.5, 31.7], [52.6, 21.4]]) {
    const floor = groundHeight(x, z);
    assert.ok(floor > SEA_LEVEL - 1 && floor < SEA_LEVEL - 0.23);
  }
});

test('each waterfall visibly descends from its rock face to the sea', () => {
  assert.equal(COAST_FALLS.length, 6);
  for (const { id, path, impact } of COAST_FALLS) {
    assert.ok(path[0].y > (id === 'shore-ledge' ? 9 : 65));
    assert.ok(impact.y < SEA_LEVEL + 1);
    for (const point of path) {
      assert.ok(point.y > groundHeight(point.x, point.z), 'the waterfall clips through terrain');
    }
    assert.ok(groundHeight(impact.x, impact.z) < SEA_LEVEL);
  }
});

test('the shore walk can see the full primary bow angle range in sunlit impact spray', () => {
  const ledge = COAST_FALLS.find(fall => fall.id === 'shore-ledge');
  const trail = COAST_WALKS[1].points.find(point => Math.hypot(point.x - 61.87, point.z - 50.80) < 0.02);
  assert.ok(ledge && trail);
  const eyeY = groundHeight(trail.x, trail.z) + 1.65;
  const angleAt = (height) => {
    const x = ledge.impact.x + 3 * ledge.direction.x + 2.5 * ledge.direction.z;
    const z = ledge.impact.z + 3 * ledge.direction.z - 2.5 * ledge.direction.x;
    const dx = trail.x - x, dy = eyeY - height, dz = trail.z - z;
    for (let t = 0.08; t < 1; t += 0.08) {
      assert.ok(groundHeight(x + t * dx, z + t * dz) < height + t * dy, 'terrain hides the spray');
    }
    for (let distance = 2; distance <= 430; distance += 2) {
      const sun = COAST_SUN_DIRECTION;
      assert.ok(groundHeight(x + sun.x * distance, z + sun.z * distance) < height + sun.y * distance,
        'the spray is in shadow');
    }
    return Math.acos(COAST_SUN_DIRECTION.dot({ x: dx, y: dy, z: dz }) / Math.hypot(dx, dy, dz)) * 180 / Math.PI;
  };
  assert.ok(angleAt(5.9) < PRIMARY_RAINBOW_ANGLE.violet);
  assert.ok(angleAt(7.6) > PRIMARY_RAINBOW_ANGLE.red);
});

test('both coast circuits now follow low limestone beside the bay before climbing to overlooks', () => {
  for (const [walk, x, z] of [[COAST_WALKS[0], -61, 0], [COAST_WALKS[1], 77, -26]]) {
    const shore = walk.points.find(point => Math.hypot(point.x - x, point.z - z) < 0.07);
    assert.ok(shore && groundHeight(shore.x, shore.z) < 3.3);
    assert.ok(coastTreadWear(shore.x, shore.z) > 0.8);
    assert.ok(groundHeight(x + (x < 0 ? 18 : -18), z) < SEA_LEVEL,
      'the low bench must face water on the bay side');
  }
  assert.ok(coastBedrock(-38, 159) > 0.9 && coastBedrock(48, 253) > 0.9);
  assert.equal(coastBedrock(SPAWN.x, SPAWN.z), 0);
});

test('the worn tread stays continuous off the center of bends in the ravine and on the ascent', () => {
  for (const [x, z] of [[-60.9333, 308.4256], [-35.36, 381.96]]) {
    assert.ok(coastTreadWear(x, z) > 0.45);
    const origin = groundHeight(x, z);
    for (let i = 0; i < 16; i += 1) {
      const angle = i * Math.PI / 8;
      const step = 0.052;
      const next = groundHeight(x + Math.cos(angle) * step, z + Math.sin(angle) * step);
      assert.ok(Math.abs(next - origin) < 0.039, `an invisible step remains at (${x}, ${z})`);
    }
  }
});

test('the inland paths connect the beach to distinct passages and a common high clearing', () => {
  const [approach, ravine, ford, headwater] = FOREST_WALKS.map(walk => walk.points);
  assert.ok(COAST_WALKS[0].points.some(point => Math.hypot(point.x - approach[0].x, point.z - approach[0].z) < 0.1));
  assert.deepEqual(approach.at(-1), ravine[0]);
  assert.deepEqual(ravine[0], ford[0]);
  assert.deepEqual(ravine.at(-1), ford.at(-1));
  assert.ok(ford.some(point => Math.hypot(point.x - headwater[0].x, point.z - headwater[0].z) < 0.1));
  assert.ok(ford.some(point => Math.hypot(point.x - headwater.at(-1).x, point.z - headwater.at(-1).z) < 0.1));
  assert.ok(groundHeight(-14, 392) > 49 && coastPlantingDistance(-14, 392) === 0);
  const slot = groundHeight(-63, 304);
  assert.ok(groundHeight(-73, 304) > slot + 5 && groundHeight(-52, 304) > slot + 5);
});

test('the stream falls to the inland pool, with a shallow crossable ford', () => {
  const elevations = FOREST_STREAM.slice(1, -1).map(({ x, z, y }) => {
    assert.equal(forestStreamLevel(x, z), y);
    assert.ok(groundHeight(x, z) < y, `water runs under ground at (${x}, ${z})`);
    return y;
  });
  assert.ok(elevations.every((y, index) => index === 0 || y > elevations[index - 1]));
  const fordDepth = forestStreamLevel(39, 261) - groundHeight(39, 261);
  assert.ok(fordDepth > 0.25 && fordDepth < 0.65);
  assert.equal(forestStreamLevel(39, 248), undefined);
});

test('a headland occludes a low source while the open channel preserves the direct path', () => {
  assert.ok(terrainOcclusion({ x: -218, y: 10, z: -140 }, { x: -68, y: 10, z: -141 }) > 0.9);
  assert.equal(terrainOcclusion({ x: 30, y: 3, z: -15 }, { x: 30, y: 20, z: -171 }), 0);
});

test('a reflected arrival is audible over water and disappears over the dry beach', () => {
  const source = { x: -15, y: 25, z: 35 };
  const wet = waterReflection({ x: -15, y: 1, z: 55 }, source);
  const dry = waterReflection({ x: -15, y: 3.5, z: 84 }, source);
  assert.ok(wet.gain > 0.9);
  assert.ok(wet.delay > 0.009 && wet.delay < 0.15);
  assert.equal(dry.gain, 0);
});

test('the waterfall range reaches the beach and air removes more treble with distance', () => {
  const main = COAST_FALLS[0];
  const source = main.path[Math.round((main.path.length - 1) * 0.65)];
  const fromBeach = Math.hypot(source.x - SPAWN.x, source.y - 3.6, source.z - SPAWN.z);
  assert.ok(fromBeach > 240 && soundReach(fromBeach, 840) > 0.9);
  assert.ok(airCutoff(fromBeach) < airCutoff(70));
  assert.equal(soundReach(840, 840), 0);
});


test('road slabs keep closed support solids behind a single asphalt and fascia envelope', async () => {
  const { plan, earthworks } = await fixture();
  const traffic = createOverlookTraffic((x, z) => earthworks.sampleHeight(x, z), plan);
  const structures = createOverlookRoadStructures(plan);
  const pointKey = p => p.map(v => Object.is(v, -0) ? 0 : v).join(',');
  const faceKey = points => points.map(pointKey).sort().join('|');
  const surface = traffic.group.getObjectByName('Asphalt, lane markings, and streetlight reflections');
  const position = surface.geometry.attributes.position, index = surface.geometry.index;
  const upper = new Set();
  for (let i = 0; i < index.count; i += 3) {
    upper.add(faceKey([0, 1, 2].map(j => Array.from(position.array.slice(index.getX(i + j) * 3, index.getX(i + j) * 3 + 3)))));
  }
  const fasciaPosition = traffic.group.getObjectByName('Concrete viaduct fascias').geometry.attributes.position;
  const fasciaRings = new Map();
  for (let i = 0; i < fasciaPosition.count; i += 1) {
    const x = fasciaPosition.getX(i), y = fasciaPosition.getY(i), z = fasciaPosition.getZ(i), key = `${x},${z}`;
    const ring = fasciaRings.get(key) ?? { min: Infinity, max: -Infinity };
    ring.min = Math.min(ring.min, y); ring.max = Math.max(ring.max, y); fasciaRings.set(key, ring);
  }
  let upperMatches = 0, visibleGroups = 0, internalMaterial, released = false;
  try {
    for (const road of plan.roads) {
      const mesh = structures.group.getObjectByName(`Road ${road.id} closed slab contacting pier tops`);
      const geometry = mesh.geometry, p = geometry.attributes.position, materials = mesh.material;
      assert.ok(Array.isArray(materials));
      assert.equal(geometry.groups.length, 2);
      const [external, internal] = geometry.groups;
      assert.equal(external.start, 0);
      assert.equal(internal.start, external.count);
      assert.equal(external.count + internal.count, p.count);
      assert.equal(materials[external.materialIndex].visible, true);
      assert.equal(materials[internal.materialIndex].visible, false);
      internalMaterial ??= materials[internal.materialIndex];
      assert.equal(materials[internal.materialIndex], internalMaterial);
      visibleGroups += geometry.groups.filter(g => materials[g.materialIndex].visible).length;
      const edges = new Map();
      let bottomTriangles = 0;
      for (let i = 0; i < p.count; i += 3) {
        const points = [0, 1, 2].map(j => Array.from(p.array.slice((i + j) * 3, (i + j) * 3 + 3)));
        const a = new Vector3().fromArray(points[0]), b = new Vector3().fromArray(points[1]), c = new Vector3().fromArray(points[2]);
        const normal = b.sub(a).cross(c.sub(a)).normalize();
        for (let j = 0; j < 3; j += 1) {
          const key = [pointKey(points[j]), pointKey(points[(j + 1) % 3])].sort().join('|');
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
        if (normal.y > .5) {
          assert.ok(i >= internal.start, 'no competing concrete upper face is drawn');
          assert.ok(upper.has(faceKey(points)), 'support volume meets the actual asphalt triangles');
          upperMatches += 1;
        }
        if (normal.y < -.5) {
          assert.ok(i < internal.start, 'the exterior underside is retained');
          bottomTriangles += 1;
        }
        if (i >= internal.start && Math.abs(normal.y) < .5) {
          for (const [x, y, z] of points) {
            const fascia = fasciaRings.get(`${x},${z}`);
            assert.ok(fascia && y >= fascia.min && y <= fascia.max, 'a real fascia covers every suppressed side ring');
          }
        }
      }
      assert.ok([...edges.values()].every(count => count === 2), 'the full support geometry is closed, including both end faces');
      assert.equal(bottomTriangles, (road.frames.length - 1) * 2);
    }
    assert.equal(upperMatches, index.count / 3);
    assert.equal(visibleGroups, plan.roads.length, 'one slab draw per road; no station-sized material groups');
    let disposed = 0;
    internalMaterial.addEventListener('dispose', () => { disposed += 1; });
    structures.dispose(); released = true;
    assert.equal(disposed, 1);
  } finally {
    traffic.dispose();
    if (!released) structures.dispose();
  }
});
