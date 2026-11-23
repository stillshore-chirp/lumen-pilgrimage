import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import * as THREE from 'three';

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
const { RESIDENCE_DISTRICT_ROADS: roads, RESIDENCE_STREET_LEVEL: streetLevel } =
  await import('../src/coast/world/residence/residenceCityPlan.ts');
const { createResidenceCity } = await import('../src/coast/world/residence/residenceCity.ts');
hooks.deregister();
const tolerance = 0.04;

function intersection(first, second) {
  if (first.alongZ === second.alongZ) return null;
  const [vertical, horizontal] = first.alongZ ? [first, second] : [second, first];
  if (vertical.center < horizontal.from - tolerance || vertical.center > horizontal.to + tolerance
    || horizontal.center < vertical.from - tolerance || horizontal.center > vertical.to + tolerance) return null;
  return [vertical.center, horizontal.center];
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

test('the rendered carriageways connect at every junction and stay clear of buildings', async context => {
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
  city.setQuality('high');
  city.group.updateMatrixWorld(true);

  const points = roads.flatMap(road => corners(road.carriageway));
  const district = boundsFor(points);
  const obstacles = [];
  const asphalt = [];
  let obstructionCount = 0;
  const seen = { facade: 0, sharedBlock: 0, landmark: 0 };
  const matrix = new THREE.Matrix4();
  const transformed = new THREE.Vector3();
  function check(points, name, part, median = false) {
    const extent = boundsFor(points);
    if (!overlaps(extent, district)) return;
    const hit = roads.find(({ id, carriageway }) => (!median || id !== 'south-avenue')
      && overlaps(extent, carriageway) && intersectsPolygon(carriageway, points));
    if (!hit) return;
    obstructionCount += 1;
    if (obstacles.length < 12) {
      const coordinate = value => Number(value.toFixed(2));
      obstacles.push({ road: hit.id, name, part, extents: Object.fromEntries(
        Object.entries(extent).map(([key, value]) => [key, coordinate(value)]),
      ) });
    }
  }

  city.group.traverseVisible(object => {
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
      if (object.name.startsWith('Original stone')) seen.facade += object.count;
      for (let i = 0; i < object.count; i += 1) {
        object.getMatrixAt(i, matrix);
        matrix.premultiply(object.matrixWorld);
        const bottom = transformed.set(0, min.y, 0).applyMatrix4(matrix).y;
        const top = transformed.set(0, max.y, 0).applyMatrix4(matrix).y;
        const median = object.name === 'South avenue median islands';
        if (!median && (bottom > streetLevel + 4.5 || top < streetLevel + 0.45)) continue;
        const footprint = corners({ minX: min.x, minZ: min.z, maxX: max.x, maxZ: max.z });
        check(footprint.map(([x, z]) => {
          transformed.set(x, min.y, z).applyMatrix4(matrix);
          return [transformed.x, transformed.z];
        }), object.name, i, median);
      }
    }
  });
  for (const [geometry, count] of Object.entries(seen)) assert.ok(count > 0, `${geometry} geometry is absent`);
  assert.equal(obstructionCount, 0, `Rendered street obstructions: ${JSON.stringify(obstacles)}`);
  assert.ok(asphalt.length > 0, 'The carriageway mesh is absent');
  for (const road of roads) {
    // The divided south avenue carries traffic on both sides of its median.
    const halfWidth = road.alongZ ? (road.carriageway.maxX - road.center) : (road.carriageway.maxZ - road.center);
    const offsets = [-halfWidth * 0.6, 0, halfWidth * 0.6];
    for (const offset of offsets) {
      const lateral = road.center + offset;
      const spans = asphalt.flatMap(({ minX, maxX, minZ, maxZ }) => {
        const [left, right, from, to] = road.alongZ ? [minX, maxX, minZ, maxZ] : [minZ, maxZ, minX, maxX];
        return lateral >= left - tolerance && lateral <= right + tolerance ? [[from, to]] : [];
      }).sort(([a], [b]) => a - b);
      let coveredTo = road.from;
      for (const [from, to] of spans) {
        if (from > coveredTo + tolerance) break;
        coveredTo = Math.max(coveredTo, to);
      }
      assert.ok(coveredTo >= road.to - tolerance,
        `${road.id} is missing paved carriageway after ${coveredTo.toFixed(2)} m at lane coordinate ${lateral.toFixed(2)} m`);
    }
  }
});
