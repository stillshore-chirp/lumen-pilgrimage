import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Raycaster, Texture, Vector3, Vector4 } from 'three';
import { COAST_SUN_DIRECTION } from '../src/coast/world/coastAtmosphere.ts';
import { PRIMARY_RAINBOW_ANGLE } from '../src/coast/world/coastSprayRainbow.ts';
import {
  COAST_BOUNDS, COAST_FALLS, COAST_WALKS, FOREST_STREAM, FOREST_WALKS, SEA_LEVEL, SPAWN,
  coastBedrock, coastPlantingDistance, coastTreadWear, forestStreamLevel, groundHeight, shoreline,
} from '../src/coast/terrain.ts';

const acousticsUrl = new URL('../src/coast/coastAcoustics.ts', import.meta.url).href;
const overlookUrl = new URL('../src/coast/world/overlook/overlookTerrain.ts', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === overlookUrl && specifier === '../coastNoise') return nextResolve('../coastNoise.ts', context);
    const path = specifier === './terrain' && context.parentURL === acousticsUrl ? './terrain.ts' : specifier;
    return nextResolve(path, context);
  },
});
const { airCutoff, soundReach, terrainOcclusion, waterReflection } = await import(acousticsUrl);
const { createOverlookSurface } = await import(overlookUrl);
hooks.deregister();

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
