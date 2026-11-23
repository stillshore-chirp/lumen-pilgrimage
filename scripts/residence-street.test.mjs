import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(src) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(src) || !url.endsWith('.ts')) return nextLoad(url, context);
    // Supply Vite's static base without starting a dev server or generating a distribution build.
    const source = readFileSync(new URL(url), 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'");
    return { format: 'module', source: stripTypeScriptTypes(source, { mode: 'transform' }), shortCircuit: true };
  },
});
const {
  RESIDENCE_AXIAL_CORRIDORS: sightCorridors, RESIDENCE_DISTRICT_ROADS: roads,
  RESIDENCE_STREET_LEVEL: streetLevel, RESIDENCE_TOWER: tower,
} = await import('../src/coast/world/residence/residenceCityPlan.ts');
const { createResidenceCity } = await import('../src/coast/world/residence/residenceCity.ts');
const { createResidenceContactMap } = await import('../src/coast/world/residence/residenceContactMap.ts');
hooks.deregister();
const tolerance = 0.04;
const extendedAxes = [
  { roadIds: ['southern-boulevard', 'east-return'], oldEnd: 1058, alongZ: false },
  { roadIds: ['south-avenue'], oldEnd: 1454, alongZ: true },
];

function intersection(first, second) {
  if (first.alongZ === second.alongZ) return null;
  const [vertical, horizontal] = first.alongZ ? [first, second] : [second, first];
  if (vertical.center < horizontal.from - tolerance || vertical.center > horizontal.to + tolerance
    || horizontal.center < vertical.from - tolerance || horizontal.center > vertical.to + tolerance) return null;
  return [vertical.center, horizontal.center];
}

function corridorAt(edge, alongZ, end = 'to') {
  const boundary = `${end === 'to' ? 'min' : 'max'}${alongZ ? 'Z' : 'X'}`;
  return sightCorridors.find(rect => rect[boundary] === edge);
}

test('the street network reaches the avenue from every segment, with both ends linked to junctions', () => {
  const avenue = roads.find(road => road.id === 'south-avenue');
  assert.ok(avenue, 'The main south avenue is missing');
  const connected = new Set([avenue]);
  const queue = [avenue];
  for (const current of queue) {
    for (const next of roads) {
      if (connected.has(next) || !intersection(current, next)) continue;
      queue.push(next);
      connected.add(next);
    }
  }
  assert.deepEqual(roads.filter(road => !connected.has(road)).map(({ id }) => id), []);
  for (const road of roads) {
    const points = roads.map(other => intersection(road, other)).filter(Boolean);
    const coordinates = points.map(point => point[Number(road.alongZ)]);
    for (const endpoint of [road.from, road.to]) {
      assert.ok(coordinates.some(coordinate => Math.abs(coordinate - endpoint) <= tolerance),
        `${road.id} ends without a junction at ${endpoint}`);
    }
  }
});

test('the east and south roads continue through multiple junctions beyond the former edge', () => {
  for (const { roadIds, oldEnd, alongZ } of extendedAxes) {
    const corridor = corridorAt(oldEnd, alongZ);
    assert.ok(corridor, `No sight corridor from the former ${alongZ ? 'south' : 'east'} edge`);
    for (const id of roadIds) {
      const road = roads.find(candidate => candidate.id === id);
      assert.ok(road && road.alongZ === alongZ && road.from < oldEnd && road.to > oldEnd,
        `${id} does not extend past the old district edge`);
      const crossingCoordinates = [...new Set(roads.map(other => intersection(road, other))
        .filter(Boolean).map(point => point[Number(alongZ)]))];
      assert.ok(crossingCoordinates.some(coordinate => Math.abs(coordinate - oldEnd) <= tolerance),
        `${id} has lost the crossing at its old end`);
      assert.ok(crossingCoordinates.filter(coordinate => coordinate > oldEnd + tolerance && coordinate < road.to - tolerance).length >= 2,
        `${id} needs at least two new crossings before its outer junction`);
      assert.ok(crossingCoordinates.some(coordinate => Math.abs(coordinate - road.to) <= tolerance),
        `${id} is missing the outer junction`);
      assert.ok((alongZ ? corridor.maxZ : corridor.maxX) > road.to,
        `${id} lacks a clear sight corridor beyond its paved end`);
      const fits = alongZ ? corridor.minX <= road.carriageway.minX && corridor.maxX >= road.carriageway.maxX
        : corridor.minZ <= road.carriageway.minZ && corridor.maxZ >= road.carriageway.maxZ;
      assert.ok(fits, `${id} is wider than its reserved sight corridor`);
    }
  }
});

test('the avenue continues past the residence tower to the northern cross streets', () => {
  const avenue = roads.find(({ id }) => id === 'south-avenue');
  const boulevard = roads.find(({ id }) => id === 'southern-boulevard');
  assert.ok(avenue?.alongZ && avenue.from < tower.minZ && avenue.to > tower.maxZ,
    'The avenue stops alongside the tower');
  assert.ok([0, -30].every(z => avenue.from < z && avenue.to > z),
    'The avenue does not extend through both ends of the residence block');
  assert.ok(boulevard && intersection(avenue, boulevard),
    'The avenue does not cross the east–west boulevard');
  assert.ok(!overlaps(avenue.rect, tower), 'The avenue right-of-way occupies the residence tower parcel');
  const northernCrossings = roads.map(road => intersection(avenue, road))
    .filter(point => point && point[1] < tower.minZ && point[1] > avenue.from);
  assert.ok(northernCrossings.length >= 2, 'The avenue does not connect to the north side of the tower');
  assert.ok(corridorAt(avenue.from, true, 'from'), 'The north end of the avenue has no clear continuation of its view');
});

function boundsFor(points) {
  return {
    minX: Math.min(...points.map(([x]) => x)), maxX: Math.max(...points.map(([x]) => x)),
    minZ: Math.min(...points.map(([, z]) => z)), maxZ: Math.max(...points.map(([, z]) => z)),
  };
}

function overlaps(first, second) {
  return first.minX < second.maxX - tolerance && first.maxX > second.minX + tolerance
    && first.minZ < second.maxZ - tolerance && first.maxZ > second.minZ + tolerance;
}

function corners({ minX, minZ, maxX, maxZ }) {
  return [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
}

function intersectsPolygon(rect, points) {
  const street = corners(rect);
  // The AABB test covers the street axes. Check the remaining separating axes of the real projected shape.
  return points.every(([x, z], index) => {
    const next = points[(index + 1) % points.length];
    const dx = z - next[1];
    const dz = next[0] - x;
    const length = Math.hypot(dx, dz);
    if (length < tolerance) return true;
    const project = ([east, south]) => (east * dx + south * dz) / length;
    const roadProjections = street.map(project);
    const solidProjections = points.map(project);
    return Math.max(...roadProjections) > Math.min(...solidProjections) + tolerance
      && Math.max(...solidProjections) > Math.min(...roadProjections) + tolerance;
  });
}

test('both drawing qualities preserve the paved network and the view beyond it by day and night', async context => {
  const publicRoot = new URL('../public/', import.meta.url);
  function asset(url) {
    assert.match(url, /^\/coast-(?:overlook|materials)\/[a-z0-9.-]+$/);
    return new URL(url.slice(1), publicRoot);
  }
  context.mock.method(globalThis, 'fetch', async url => new Response(await readFile(asset(String(url)))));
  context.mock.method(THREE.ImageLoader.prototype, 'load', (url, loaded) => {
    readFileSync(asset(url));
    // The source image is verified on disk. Image decoding has no effect on building geometry.
    const image = { width: 1, height: 1 };
    queueMicrotask(() => loaded?.(image));
    return image;
  });
  const city = await createResidenceCity();
  context.after(() => city.dispose());
  city.group.updateMatrixWorld(true);
  for (const quality of ['light', 'high']) {
    city.setQuality(quality);
    for (const time of ['day', 'night']) {
      city.setTimeOfDay(time);
      verifyRenderedRoads(city.group, `${quality} quality, ${time}`);
    }
  }
});

function verifyRenderedRoads(group, mode) {
  const avenue = roads.find(({ id }) => id === 'south-avenue');
  const lanes = roads.map(({ id, carriageway }) => ({ id, rect: carriageway }));
  const sightEnds = [
    ...extendedAxes.map(axis => ({ ...axis, end: 'to', label: axis.alongZ ? 'south' : 'east' })),
    { roadIds: [avenue.id], oldEnd: avenue.from, alongZ: true, end: 'from', label: 'north' },
  ];
  const views = sightEnds.map(({ oldEnd, alongZ, end, label }) => {
    const rect = corridorAt(oldEnd, alongZ, end);
    assert.ok(rect, `The ${label} sight corridor is missing`);
    return { id: `${label} sight corridor`, rect };
  });
  const clearBeyondPaving = sightEnds.map(({ roadIds, alongZ, end }, index) => {
    const extensions = roads.filter(({ id }) => roadIds.includes(id));
    const outward = end === 'to';
    const axis = alongZ ? 'Z' : 'X';
    const curbs = extensions.flatMap(road =>
      roads.filter(other => {
        const crossing = intersection(road, other);
        return crossing && Math.abs(crossing[Number(alongZ)] - road[end]) <= tolerance;
      }).map(other => other.rect[`${outward ? 'max' : 'min'}${axis}`]),
    );
    const farCurb = outward ? Math.max(...curbs) : Math.min(...curbs);
    const { id, rect } = views[index];
    assert.ok(Number.isFinite(farCurb) && (outward ? farCurb < rect[`max${axis}`] : farCurb > rect[`min${axis}`]),
      `${id} needs clear space beyond the outer junction's curb`);
    return { id, rect: { ...rect, [`${outward ? 'min' : 'max'}${axis}`]: farCurb } };
  });
  const buildingZones = [...lanes, ...views];
  const roadsideZones = [...lanes, ...clearBeyondPaving];
  const medianZones = lanes.filter(({ id }) => id !== 'south-avenue');
  const towerRightOfWay = roads.map(({ id, rect }) => ({ id: `${id} right-of-way by the residence tower`, rect }));
  const district = boundsFor([...buildingZones, ...towerRightOfWay].flatMap(({ rect }) => corners(rect)));
  const obstacles = [];
  const asphalt = [];
  let obstructionCount = 0;
  const seen = { facade: 0, sharedBlock: 0, landmark: 0 };
  let towerBase = false;
  let towerShaft = false;
  const matrix = new THREE.Matrix4();
  const transformed = new THREE.Vector3();
  function check(points, name, part, candidates = buildingZones) {
    const extent = boundsFor(points);
    if (!overlaps(extent, district)) return;
    const hit = candidates.find(({ rect }) => overlaps(extent, rect) && intersectsPolygon(rect, points));
    if (!hit) return;
    obstructionCount += 1;
    if (obstacles.length < 12) {
      const coordinate = value => Number(value.toFixed(2));
      obstacles.push({ zone: hit.id, name, part, extents: Object.fromEntries(
        Object.entries(extent).map(([key, value]) => [key, coordinate(value)]),
      ) });
    }
  }

  group.traverseVisible(object => {
    if (object.name === 'Inferred buildings on street frontages') {
      const centers = object.geometry.getAttribute('cityCenter');
      const dimensions = object.geometry.getAttribute('cityScale');
      const bearings = object.geometry.getAttribute('cityHeading');
      seen.sharedBlock += centers.count;
      for (let i = 0; i < centers.count; i += 1) {
        const width = dimensions.getX(i), depth = dimensions.getZ(i);
        const padding = Math.hypot(width, depth) / 2;
        const center = transformed.fromBufferAttribute(centers, i).applyMatrix4(object.matrixWorld);
        if (!overlaps({
          minX: center.x - padding, maxX: center.x + padding,
          minZ: center.z - padding, maxZ: center.z + padding,
        }, district)) continue;
        const c = bearings.getX(i), s = bearings.getY(i);
        const x = centers.getX(i), y = centers.getY(i), z = centers.getZ(i);
        const footprint = corners({ minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 });
        // This matches blocksVertex, which applies scale and rotation on the GPU.
        check(footprint.map(([east, north]) => {
          transformed.set(x + east * c + north * s, y, z + north * c - east * s).applyMatrix4(object.matrixWorld);
          return [transformed.x, transformed.z];
        }), object.name, i);
      }
    } else if (object.name === 'Skyline landmarks') {
      const positions = object.geometry.getAttribute('position');
      const seeds = object.geometry.getAttribute('cityLightSeed');
      const index = object.geometry.getIndex();
      const count = index?.count ?? positions.count;
      seen.landmark += count / 3;
      for (let i = 0; i < count; i += 3) {
        const triangle = [0, 1, 2].map(offset => {
          const vertex = index ? index.getX(i + offset) : i + offset;
          transformed.fromBufferAttribute(positions, vertex).applyMatrix4(object.matrixWorld);
          return [transformed.x, transformed.z];
        });
        check(triangle, object.name, Number(seeds.getX(index ? index.getX(i) : i).toFixed(5)));
      }
    } else if (object.name === 'Authored district asphalt lanes and junctions') {
      object.geometry.computeBoundingBox();
      const worldBox = new THREE.Box3();
      for (let i = 0; i < object.count; i += 1) {
        object.getMatrixAt(i, matrix);
        worldBox.copy(object.geometry.boundingBox).applyMatrix4(matrix.premultiply(object.matrixWorld));
        assert.ok(Math.abs(worldBox.max.y - streetLevel) < 0.45, `Carriageway slab ${i} is not at street level`);
        asphalt.push({ minX: worldBox.min.x, maxX: worldBox.max.x, minZ: worldBox.min.z, maxZ: worldBox.max.z });
      }
    } else if (object.isInstancedMesh && [
      'Original stone, curtain-wall, ribbon and balcony facades',
      'Roof terraces, curb stones and paving',
      'Roof equipment and entrance fittings',
      'South avenue median islands',
    ].includes(object.name)) {
      object.geometry.computeBoundingBox();
      const { min, max } = object.geometry.boundingBox;
      const facade = object.name.startsWith('Original stone');
      const median = object.name === 'South avenue median islands';
      if (facade) seen.facade += object.count;
      for (let i = 0; i < object.count; i += 1) {
        object.getMatrixAt(i, matrix);
        matrix.premultiply(object.matrixWorld);
        const bottom = transformed.set(0, min.y, 0).applyMatrix4(matrix).y;
        const top = transformed.set(0, max.y, 0).applyMatrix4(matrix).y;
        if (!median && top < streetLevel + 0.45) continue;
        const footprint = corners({ minX: min.x, minZ: min.z, maxX: max.x, maxZ: max.z });
        const renderedFootprint = footprint.map(([x, z]) => {
          transformed.set(x, min.y, z).applyMatrix4(matrix);
          return [transformed.x, transformed.z];
        });
        if (facade && overlaps(boundsFor(renderedFootprint), tower) && intersectsPolygon(tower, renderedFootprint)) {
          towerBase ||= Math.abs(bottom - streetLevel) < tolerance;
          towerShaft ||= top > streetLevel + tower.height * 0.75;
          check(renderedFootprint, 'Residence tower', i, towerRightOfWay);
        }
        const zones = facade ? buildingZones : median ? medianZones
          : bottom > streetLevel + 4.5 ? clearBeyondPaving : roadsideZones;
        check(renderedFootprint, object.name, i, zones);
      }
    }
  });
  for (const [geometry, count] of Object.entries(seen)) assert.ok(count > 0, `${geometry} geometry is absent`);
  assert.ok(towerBase && towerShaft, `The rendered residence tower podium or shaft is absent in ${mode}`);
  assert.equal(obstructionCount, 0, `Obstructions in ${mode}: ${JSON.stringify(obstacles)}`);
  assert.ok(asphalt.length > 0, 'The carriageway mesh is absent');
  for (const road of roads) {
    verifyPaving(road, asphalt, mode);
  }
}

function verifyPaving(road, asphalt, mode) {
  const across = road.alongZ ? 'X' : 'Z';
  const along = road.alongZ ? 'Z' : 'X';
  const left = road.carriageway[`min${across}`], right = road.carriageway[`max${across}`];
  const slabs = asphalt.map(rect => ({
    left: rect[`min${across}`], right: rect[`max${across}`], from: rect[`min${along}`], to: rect[`max${along}`],
  })).filter(slab => slab.right >= left - tolerance && slab.left <= right + tolerance
    && slab.to >= road.from - tolerance && slab.from <= road.to + tolerance);
  // Slabs are rectangular. Their lateral edges are the only places longitudinal coverage can change.
  const edges = [...new Set([left, right, ...slabs.flatMap(slab => [slab.left, slab.right])
    .filter(edge => edge > left + tolerance && edge < right - tolerance)])].sort((a, b) => a - b);
  const probes = [left, ...edges.slice(1).map((edge, i) => (edge + edges[i]) / 2), right];
  for (const lateral of probes) {
    const spans = slabs.filter(slab => lateral >= slab.left - tolerance && lateral <= slab.right + tolerance)
      .sort((a, b) => a.from - b.from);
    let coveredTo = road.from;
    for (const { from, to } of spans) {
      if (from > coveredTo + tolerance) break;
      coveredTo = Math.max(coveredTo, to);
    }
    assert.ok(coveredTo >= road.to - tolerance,
      `${road.id} lacks pavement after ${coveredTo.toFixed(2)} m at lane ${lateral.toFixed(2)} m in ${mode}`);
  }
}


test('static contact shadows retain furniture feet while excluding flush finishes and moving cloth', () => {
  const furniture = new THREE.Group();
  const finish = new THREE.MeshStandardMaterial({ name: 'Test furniture finish' });
  const rug = new THREE.MeshStandardMaterial({ name: 'Test rug finish' });
  const foot = new THREE.BoxGeometry(.12, .066, .12).translate(9, .033, -4);
  const tile = new THREE.BoxGeometry(1.4, .036, 1.4).translate(11, -.018, -4);
  const moving = new THREE.PlaneGeometry(1.6, 2, 8, 8).rotateX(.30).translate(7, .98, -4);
  moving.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
  furniture.add(new THREE.Mesh(foot, finish));
  const baseline = createResidenceContactMap(furniture, rug);
  furniture.clear();
  const mixed = mergeGeometries([foot, tile]);
  furniture.add(new THREE.Mesh(mixed, finish), new THREE.Mesh(moving, finish));
  const withRoomFinishes = createResidenceContactMap(furniture, rug);
  assert.ok(baseline.image.data.some(strength => strength > 180));
  assert.deepEqual(withRoomFinishes.image.data, baseline.image.data);
  for (const resource of [finish, rug, foot, tile, moving, mixed, baseline, withRoomFinishes]) resource.dispose();
});
