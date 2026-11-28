import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, before, test } from 'node:test';
import { Box3, Group, Raycaster, Vector3 } from 'three';

const source = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(source)
      && specifier.startsWith('.') && !/\.(?:ts|js|json)$/.test(specifier);
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const [{ buildAtriumFrontShell }, { buildAtriumFrontCommons }] = await Promise.all([
  import('../src/coast/world/atrium/atriumFrontShell.ts'),
  import('../src/coast/world/atrium/atriumFrontCommons.ts'),
]);
hooks.deregister();

let shell;
let facility;
let opaqueShell;
let opaqueFacility;
const ray = new Raycaster();

function meshes(root, transparent = false) {
  const result = [];
  root.traverse(object => {
    if (object.isMesh && [].concat(object.material).some(material => material.transparent === transparent)) result.push(object);
  });
  return result;
}

function cast(objects, origin, direction, far = 100) {
  ray.set(new Vector3(...origin), new Vector3(...direction));
  ray.near = 0;
  ray.far = far;
  return ray.intersectObjects(objects, false);
}

function near(actual, expected, message, tolerance = .001) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < tolerance,
    `${message}: expected ${expected}, rendered geometry ${actual}`);
}

function dispose(root) {
  const resources = new Set();
  root.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    for (const material of [].concat(object.material ?? [])) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) resource.dispose();
}

before(async () => {
  shell = new Group();
  buildAtriumFrontShell(shell, null);
  shell.updateMatrixWorld(true);
  opaqueShell = meshes(shell);
  facility = new Group();
  await buildAtriumFrontCommons(facility, null);
  facility.updateMatrixWorld(true);
  opaqueFacility = meshes(facility);
});
after(() => { if (shell) dispose(shell); if (facility) dispose(facility); });

test('fixed glass closes the visible boundary at its real front and rear faces with recessed opaque backs', () => {
  const glass = meshes(shell, true);
  // These are independent audit positions, away from the narrow recognition marks and mullions.
  for (const [floor, y, back] of [[0, 1.20, 13.27], [4.55, 6.2, 7.58],
    [9.15, 10.8, 7.58], [13.55, 15.2, 7.58]]) {
    for (const x of [-2.7, .8, 3.7]) {
      near(cast(glass, [x, y, 2.2], [0, 0, 1])[0]?.point.z, 3.040, 'common-side glass finish');
      near(cast(glass, [x, y, 3.25], [0, 0, -1])[0]?.point.z, 3.054, '14 mm closed rear glass face');
      near(cast(opaqueShell, [x, y, 3.30], [0, 0, 1])[0]?.point.z, back,
        `${floor} floor: clear depth reaches the actual closed rear wall`);
    }
  }
  for (const side of [-1, 1]) {
    const faceX = side * 11.4;
    const backX = side * (side < 0 ? 16.4 : 16.8);
    for (const z of [-8.8, -5.1, .6]) {
      near(cast(glass, [side * 10.9, 1.65, z], [side, 0, 0])[0]?.point.x,
        faceX, 'storefront closes at the walking boundary');
      near(cast(opaqueShell, [faceX + side * .20, 1.65, z], [side, 0, 0])[0]?.point.x,
        backX, 'an opaque backing panel does not flatten the new shop');
    }
  }
  for (const x of [-10, -7.3, 7.3, 10]) for (const y of [1.20, 2.80]) {
    near(cast(glass, [x, y, 2.2], [0, 0, 1])[0]?.point.z, 3.040, 'the new document room closes at the same finish');
    near(cast(glass, [x, y, 3.35], [0, 0, -1])[0]?.point.z, 3.054, 'document-room glass has a closed rear face');
    near(cast(opaqueShell, [x, y, 3.50], [0, 0, 1])[0]?.point.z, 7.58, 'document room has real depth and a closed back');
  }
  for (const x of [-8.99, 8.99]) {
    assert.equal(cast(glass, [x, 1.20, 2.2], [0, 0, 1], 1.2).length, 0,
      'new window assemblies leave the existing support pier out of their glass');
    near(cast(opaqueShell, [x, 1.20, 2.2], [0, 0, 1])[0]?.point.z, 2.955,
      'the existing continuous support pier remains in front of the new document room');
  }
});

test('upper rooms have supported floor plates, closed soffits, sides, ceilings and continuous piers', () => {
  for (const [floor, ceiling] of [[4.55, 8.40], [9.15, 12.95], [13.55, 16.95]]) {
    for (const x of [-8.60, -2.7, .8, 8.60]) for (const z of [3.35, 4.65, 7.35]) {
      near(cast(opaqueShell, [x, floor + .3, z], [0, -1, 0])[0]?.point.y, floor, 'finished room floor');
      // Start in the gap immediately below the soffit: on 4F, the lower room's
      // independent ceiling closes at 13.07, just below this soffit at 13.085.
      near(cast(opaqueShell, [x, floor - .475, z], [0, 1, 0])[0]?.point.y, floor - .465,
        'the 25 mm soffit closes beneath the 440 mm structural plate');
      near(cast(opaqueShell, [x, ceiling - .3, z], [0, 1, 0])[0]?.point.y, ceiling, 'closed ceiling');
    }
    for (const side of [-1, 1]) {
      near(cast(opaqueShell, [side * 8.5, floor + 2, 5.4], [side, 0, 0])[0]?.point.x,
        side * 8.85, 'a side return closes the view from inside the room');
    }
    for (const x of [-8.99, -4.72, 4.72, 8.99]) for (const z of [3.18, 7.78]) {
      const piers = opaqueShell.filter(mesh => mesh.name === 'Front commons continuous load path pier');
      near(cast(piers, [x + .6, floor - .7, z], [-1, 0, 0])[0]?.point.x,
        x + .14, 'a pier continues below the floor junction');
    }
  }
  for (const [origin, direction, axis, expected] of [
    [[-2.7, 1.2, 5.5], [0, -1, 0], 'y', 0],
    [[-2.7, 1.2, 5.5], [0, 1, 0], 'y', 4.085],
    [[0, 1.2, 10.8], [-1, 0, 0], 'x', -4.72],
    [[0, 1.2, 10.8], [1, 0, 0], 'x', 4.72],
  ]) near(cast(opaqueShell, origin, direction)[0]?.point[axis], expected, 'closed garden floor/ceiling/side');
  for (const side of [-1, 1]) {
    for (const x of [side * 6.0, side * 7.5, side * 10.3]) for (const z of [3.60, 5.0, 7.40]) {
      near(cast(opaqueShell, [x, 1.20, z], [0, -1, 0])[0]?.point.y, 0, 'new document room has a continuous finished floor');
      near(cast(opaqueShell, [x, 1.20, z], [0, 1, 0])[0]?.point.y, 3.60, 'new document room has a closed ceiling');
    }
    for (const [direction, boundary] of [[-1, side < 0 ? -10.8 : 5.4], [1, side < 0 ? -5.4 : 10.8]]) {
      near(cast(opaqueShell, [side * 8.2, 1.20, 4.60], [direction, 0, 0])[0]?.point.x,
        boundary, 'document room side returns close the display depth');
    }
  }
});

test('actual fittings leave the public cross route, shop aisles and upper front routes empty', () => {
  for (const y of [.18, .70, 1.20, 1.80]) for (const z of [.80, 1.40, 2.10, 2.60]) {
    assert.equal(cast(opaqueFacility, [-11.05, y, z], [1, 0, 0], 22.1).length, 0,
      `public cross route has no new object at y${y}, z${z}`);
  }
  // Sample the interior of each reserved 1.8 m shop aisle, excluding the closed outer glass and frames.
  for (const [side, minZ, depth] of [[-1, -2.8, 4.4], [1, -8.2, 4.8]]) {
    for (const fraction of [.1, .3, .5, .7, .9]) for (const y of [.18, .70, 1.20, 1.80]) {
      assert.equal(cast(opaqueFacility, [side * 12.35, y, minZ + 1.8 * fraction],
        [side, 0, 0], depth - .95).length, 0, `shop ${side}: no fitting obstructs the main aisle`);
    }
  }
  for (const floor of [4.55, 9.15, 13.55]) for (const x of [-7.5, -2.7, .8, 7.5]) {
    for (const y of [.18, 1.20, 1.80]) assert.equal(cast(opaqueFacility,
      [x, floor + y, 3.25], [0, 0, 1], 1.65).length, 0, 'upper front passage remains clear');
  }
  for (const x of [-10.3, -7.5, -6.0, 6.0, 7.5, 10.3]) for (const y of [.18, 1.20, 1.80]) {
    assert.equal(cast(opaqueFacility, [x, y, 3.50], [0, 0, 1], 1.65).length, 0,
      'new document rooms keep their 1.8 m front reservation free of fittings');
  }
  // The seated main sightline must pass the planting and reach the distant garden wall.
  near(cast(opaqueFacility, [-2.7, 1.20, 3.30], [0, 0, 1])[0]?.point.z, 13.27,
    'the garden leaves the seated sightline open');
});

test('glass clear panes stop at the actual opaque frame faces instead of overlapping coplanar metal', () => {
  const glass = meshes(shell, true);
  let audited = 0;
  for (const frame of opaqueShell) {
    if (!/glass (?:jamb|mullion|head and sill)|shopfront (?:supported head and sill|closed glazing mullion)/.test(frame.name)) continue;
    const position = frame.getWorldPosition(new Vector3());
    // The ray crosses the actual metal centre, rather than recomputing its location
    // with the same helper that created the panes and potentially repeating its bug.
    const shop = frame.name.includes('shopfront');
    const origin = shop ? [position.x > 0 ? 10.9 : -10.9, position.y, position.z]
      : [position.x, position.y, 2.2];
    const direction = shop ? [position.x > 0 ? 1 : -1, 0, 0] : [0, 0, 1];
    // Open entrance leaves park behind fixed glazing. Check physical overlap,
    // rather than rejecting a second pane farther along the same viewing ray.
    const frameBounds = new Box3().setFromObject(frame);
    assert.equal(cast(glass, origin, direction, 1.2).filter(hit => frameBounds.containsPoint(hit.point)).length, 0,
      `${frame.name}: transparent pane does not cross the metal's actual projected face`);
    assert.ok(cast([frame], origin, direction, 1.2).length > 0, 'the audit ray actually crosses its opaque frame');
    audited++;
  }
  assert.ok(audited > 50, `audited ${audited} real frame faces across the garden, shops, document rooms and upper rooms`);
});

test('continuous ceiling subdivision edges stay neutral while real perimeter and fixture openings retain weak contact AO', t => {
  const sample = (x, z) => {
    const hit = cast(opaqueFacility, [x, 4.0, z], [0, 1, 0], .20)[0];
    assert.ok(hit?.uv1, `the actual ceiling at (${x}, ${z}) supplies interpolated atlas UVs`);
    near(hit.point.y, 4.085, 'the audit ray reaches the garden ceiling receiving face');
    const material = Array.isArray(hit.object.material)
      ? hit.object.material[hit.face.materialIndex] : hit.object.material;
    const map = material.aoMap;
    assert.ok(map?.image?.data, 'the factory attaches its actual contact atlas');
    assert.equal(material.aoMapIntensity, 1, 'native AO intensity preserves the atlas loss');
    assert.equal(map.channel, 1, 'the receiver uses the ray-interpolated uv1 channel');
    const { data, width, height } = map.image;
    // Match the atlas' linear magnification from the real raycast UV. No design
    // contact coordinates or private receiver function participate in this lookup.
    const u = hit.uv1.x * width - .5, v = hit.uv1.y * height - .5;
    const x0 = Math.floor(u), y0 = Math.floor(v), tx = u - x0, ty = v - y0;
    const red = (column, row) => data[Math.max(0, Math.min(height - 1, row)) * width
      + Math.max(0, Math.min(width - 1, column))];
    const a = red(x0, y0) * (1 - tx) + red(x0 + 1, y0) * tx;
    const b = red(x0, y0 + 1) * (1 - tx) + red(x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
  const observations = [];
  for (const [name, x, z] of [
    ['internal wallwasher subdivision', 3.225, 9.60],
    ['internal growing-fixture subdivision', .70, 10.30],
    ['coplanar ceiling assembly join', -2.70, 7.59],
  ]) {
    const red = sample(x, z);
    assert.ok(red >= 254.5, `${name}: a continuous ceiling cannot invent a dark contact (R=${red.toFixed(2)})`);
    observations.push(`${name} R=${red.toFixed(2)}`);
  }
  for (const [name, x, z] of [
    ['real garden perimeter', -4.70, 10.00],
    ['G1 fixture opening edge', 0, 11.855],
  ]) {
    const red = sample(x, z);
    assert.ok(red >= 204 && red < 252.45, `${name}: real contact retains weak AO (R=${red.toFixed(2)})`);
    observations.push(`${name} R=${red.toFixed(2)}`);
  }
  t.diagnostic(observations.join('; '));
});
