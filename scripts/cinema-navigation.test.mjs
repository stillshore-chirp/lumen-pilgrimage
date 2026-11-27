import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { Box2, Box3, Group, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Scene, Vector2, Vector3 } from 'three';
import { OBB } from 'three/addons/math/OBB.js';

const source = new URL('../src/coast/world/cinema/', import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(source) && specifier.startsWith('./') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const {
  CINEMA_AISLES, CINEMA_BOUNDS, CINEMA_CEILING_BAFFLES, CINEMA_CEILING_COFFERS, CINEMA_CROSS_AISLES, CINEMA_DESTINATIONS, CINEMA_DOOR_WIDTH,
  CINEMA_EXITS, CINEMA_PLACES, CINEMA_ROOM_HEIGHT, CINEMA_ROWS, CINEMA_SCREEN, CINEMA_TREADS,
  CINEMA_WHEELCHAIR_BAY, cinemaGroundHeight,
} = await import('../src/coast/world/cinema/cinemaLayout.ts');
const { cinemaNavigation } = await import('../src/coast/world/cinema/cinemaNavigation.ts');
const { createCinemaFloor } = await import('../src/coast/world/cinema/cinemaFloor.ts');
const { cinemaFinishes } = await import('../src/coast/world/cinema/cinemaFinishes.ts');
const { createCinemaSeatTransition } = await import('../src/coast/world/cinema/cinemaSeatTransition.ts');
const { CINEMA_SPEAKER_EQUIPMENT, cinemaSpeakerEquipmentBlocked } =
  await import('../src/coast/world/cinema/cinemaSpeakerGeometry.ts');
const { CINEMA_RENDER_SPEAKERS } = await import('../src/coast/world/cinema/cinemaSpeakers.ts');
const { createCinemaSpeakerEquipment, CINEMA_SPEAKER_DETAIL } =
  await import('../src/coast/world/cinema/cinemaSpeakerEquipment.ts');
hooks.deregister();

test('speaker grilles follow the acoustic center and aim, with connected supports clear of ceiling linings', () => {
  const finish = cinemaFinishes();
  const material = new MeshBasicMaterial();
  const unitBox = new Box3(new Vector3(-.5, -.5, -.5), new Vector3(.5, .5, .5));
  const linings = [...CINEMA_CEILING_BAFFLES, ...CINEMA_CEILING_COFFERS].map(([x, y, z, w, h, d]) =>
    new OBB(new Vector3(x, y, z), new Vector3(w / 2, h / 2, d / 2)));
  assert.equal(CINEMA_SPEAKER_EQUIPMENT.length, 48);
  for (const equipment of CINEMA_SPEAKER_EQUIPMENT) {
    const source = CINEMA_RENDER_SPEAKERS.find(({ id }) => id === equipment.id);
    const grille = equipment.boxes.find(({ part }) => part === 'grille');
    const center = new Vector3().setFromMatrixPosition(grille.matrix);
    const normal = new Vector3(0, 0, 1).transformDirection(grille.matrix);
    assert.ok(center.distanceTo(new Vector3(...source.position)) < 1e-6, equipment.id);
    assert.ok(normal.dot(new Vector3(...source.aim)) > 1 - 1e-6, equipment.id);
    const mounts = equipment.boxes.filter(({ part }) => part === 'mount').map(box => {
      const mesh = new Mesh(finish.box, material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(box.matrix);
      mesh.updateMatrixWorld(true);
      return mesh;
    });
    for (const part of equipment.boxes) {
      assert.ok(cinemaSpeakerEquipmentBlocked(part.center.x, part.center.y, part.center.z), equipment.id);
      if (part.part === 'mount') continue;
      const volume = new OBB().fromBox3(unitBox).applyMatrix4(part.matrix);
      assert.ok(linings.every(lining => !volume.intersectsOBB(lining)), `${equipment.id}: lining overlap`);
      if (part.part !== 'support') continue;
      const axis = new Vector3(0, 1, 0).applyQuaternion(part.rotation);
      for (const sign of [-1, 1]) {
        const ray = new Raycaster(part.center, axis.clone().multiplyScalar(sign), 0, part.size.y / 2 + .03);
        assert.ok(ray.intersectObjects(mounts, false).length > 0, `${equipment.id}: disconnected support`);
      }
    }
  }
  assert.equal(cinemaSpeakerEquipmentBlocked(.39, 4.4, 33.45), false);
  finish.box.dispose();
  material.dispose();
});

test('finished cabinets, grille frames and fixings stay inside their shared collision envelopes', () => {
  const group = new Group();
  createCinemaSpeakerEquipment(group);
  group.updateMatrixWorld(true);
  const matrix = new Matrix4();
  const vertex = new Vector3();
  const normal = new Vector3(1, 1, 1).normalize();
  const geometries = new Set();
  const materials = new Set();
  let maximumCabinetCornerGap = 0;
  let inspectedInstances = 0;
  for (const mesh of group.children) {
    const envelopes = mesh.userData.cinemaEquipmentEnvelopes;
    assert.equal(envelopes.length, mesh.count);
    const positions = mesh.geometry.attributes.position;
    geometries.add(mesh.geometry);
    materials.add(mesh.material);
    for (let instance = 0; instance < mesh.count; instance += 1) {
      mesh.getMatrixAt(instance, matrix);
      const envelope = envelopes[instance];
      for (let i = 0; i < positions.count; i += 1) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix).applyMatrix4(envelope.inverse);
        // Instance transforms use Float32 matrices: compare the residual in metres,
        // rather than magnifying it by the inverse of a 30 mm mounting plate.
        const excess = Math.max((Math.abs(vertex.x) - .5) * envelope.size.x,
          (Math.abs(vertex.y) - .5) * envelope.size.y, (Math.abs(vertex.z) - .5) * envelope.size.z);
        assert.ok(excess <= .00001,
          `${mesh.name}: finished surface exceeds collision envelope`);
      }
      if (mesh.name === 'Rounded cinema speaker enclosures') {
        const corner = new Vector3(.5, .5, .5).applyMatrix4(envelope.matrix);
        const direction = normal.clone().applyQuaternion(envelope.rotation);
        const single = new Mesh(mesh.geometry, mesh.material);
        single.matrixAutoUpdate = false;
        single.matrix.copy(matrix);
        single.updateMatrixWorld(true);
        const ray = new Raycaster(corner.clone().addScaledVector(direction, .05), direction.clone().negate(), 0, .10);
        const hit = ray.intersectObject(single, false)[0];
        assert.ok(hit);
        maximumCabinetCornerGap = Math.max(maximumCabinetCornerGap, hit.distance - .05);
      }
      inspectedInstances += 1;
    }
    mesh.dispose();
  }
  assert.ok(inspectedInstances > 48 * 7);
  assert.ok(maximumCabinetCornerGap <= CINEMA_SPEAKER_DETAIL.cabinetRadius * (Math.sqrt(3) - 1) + .00001);
  assert.ok(maximumCabinetCornerGap > .008);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  group.clear();
});

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
  assert.equal(CINEMA_SCREEN.height, 16.875);
  assert.equal(CINEMA_SCREEN.center, 9.8);
  assert.ok(Math.abs(CINEMA_SCREEN.bottom - 1.3625) < 1e-12);
  assert.ok(CINEMA_SCREEN.bottom + CINEMA_SCREEN.height < CINEMA_ROOM_HEIGHT);
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
    const cross = CINEMA_CROSS_AISLES.find(({ row }) => row === bay.row);
    const { centerOffsetZ, depth } = CINEMA_WHEELCHAIR_BAY;
    const back = bay.z + centerOffsetZ + depth / 2;
    clearRoute({ x: bay.x, z: back }, { x: bay.x, z: cross.z });
    assert.equal(cinemaGroundHeight(bay.x, cross.z), bay.y);
    assert.ok(Math.abs(cinemaGroundHeight(bay.x, back) - bay.y) < 1e-8);
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

test('chair backs support landing and the ceiling follows the baffles and side coffers', () => {
  const { x, z } = CINEMA_DESTINATIONS[0];
  const floor = cinemaGroundHeight(x, z);
  const chairTop = cinemaNavigation.groundHeight(x, z + .29);
  assert.ok(chairTop > floor + 1 && chairTop < floor + 1.12);
  assert.equal(cinemaNavigation.blocksWalking(x, z + .29, floor), true);
  assert.equal(cinemaNavigation.blocksWalking(x, z + .29, chairTop), false);
  assert.equal(cinemaNavigation.blocksWalking(x, z, floor), false);
  assert.equal(cinemaNavigation.ceilingHeight(x, z), CINEMA_ROOM_HEIGHT);
  for (const [cx, cy, cz, , height] of CINEMA_CEILING_COFFERS) {
    assert.ok(cinemaNavigation.ceilingHeight(cx, cz) <= cy - height / 2);
  }
});

test('each deck has walkable risers and flat seat landings', () => {
  for (let i = 2; i < CINEMA_TREADS.length; i += 1) {
    assert.ok(CINEMA_TREADS[i].z - CINEMA_TREADS[i - 1].z >= .26 - 1e-8);
  }
  for (const row of CINEMA_ROWS.slice(1)) {
    const previous = CINEMA_ROWS[row.number - 2];
    const steps = CINEMA_TREADS.filter(tread => tread.row === row.number);
    assert.equal(steps.length, row.hasWheelchairBays ? 5 : previous.hasWheelchairBays ? 3 : 2);
    let previousStepY = previous.y;
    for (const { y, rise } of steps) {
      assert.ok(rise >= .08 && rise <= .18 + 1e-8);
      assert.ok(Math.abs(y - previousStepY - rise) < 1e-8);
      previousStepY = y;
    }
    assert.equal(cinemaGroundHeight(0, row.z - .207), row.y);
    assert.equal(cinemaGroundHeight(0, previous.z + .28), previous.y);
  }
});

test('seated views preserve the intended angles and clear preceding rows to the lower edge', () => {
  const [center, , rear] = CINEMA_DESTINATIONS;
  const screen = CINEMA_SCREEN;
  const degrees = radians => radians * 180 / Math.PI;
  const rightEdge = Math.atan2(screen.width / 2 - center.x, center.z - screen.z);
  const leftEdge = Math.atan2(-screen.width / 2 - center.x, center.z - screen.z);
  assert.ok(Math.abs(degrees(rightEdge - leftEdge) - 48) < .5);
  assert.ok(Math.abs(degrees(center.pitch) - 9) < .35);
  assert.ok(degrees(rear.pitch) > 0 && degrees(rear.pitch) < 2);
  const eye = place => cinemaGroundHeight(place.x, place.z) + place.seatedEyeHeight;
  const fromRearToCenter = Math.atan2(eye(center) - eye(rear), Math.hypot(center.x - rear.x, center.z - rear.z));
  assert.ok(degrees(fromRearToCenter) > -11 && degrees(fromRearToCenter) < -9);

  for (const row of CINEMA_ROWS.slice(1)) {
    const seatedEyeHeight = row.hasWheelchairBays ? 1 : 1.15;
    const sightline = z => screen.bottom
      + (row.y + seatedEyeHeight - screen.bottom) * (z - screen.z) / (row.z - screen.z);
    for (const front of CINEMA_ROWS.slice(0, row.number - 1)) {
      // A full-width head-height plane checks every horizontal ray without relying on side-to-side gaps.
      const label = `R${row.number} over R${front.number}`;
      assert.ok(sightline(front.z) - front.y - 1.30 >= .02, label);
      assert.ok(sightline(front.z + .26) - front.y - 1.10 >= .20, label);
    }
    for (const { y, z } of CINEMA_TREADS) {
      if (z > screen.z && z < row.z) assert.ok(sightline(z) > y);
    }
  }
});

test('the rendered handrails and posts leave the screen clear from every seated position', () => {
  const floor = new Group();
  createCinemaFloor(floor, cinemaFinishes());
  floor.updateMatrixWorld(true);
  const halfWidth = CINEMA_SCREEN.width / 2;
  const screen = new Box2(new Vector2(-halfWidth, CINEMA_SCREEN.bottom),
    new Vector2(halfWidth, CINEMA_SCREEN.bottom + CINEMA_SCREEN.height));
  const signs = [-0.5, 0.5];
  const corners = signs.flatMap(x => signs.flatMap(y => signs.map(z => new Vector3(x, y, z))));
  const fixtures = floor.children.filter(({ name }) => name.startsWith('Handrail'));
  const posts = fixtures.find(mesh => mesh.isInstancedMesh);
  const transforms = fixtures.filter(mesh => mesh !== posts).map(mesh => mesh.matrixWorld);
  for (let i = 0; i < posts.count; i += 1) {
    const transform = new Matrix4();
    posts.getMatrixAt(i, transform);
    transforms.push(transform.premultiply(posts.matrixWorld));
  }
  const cornerSets = transforms.map(matrix => corners.map(corner => corner.clone().applyMatrix4(matrix)));
  for (const place of CINEMA_PLACES) {
    const eyeY = place.y + (place.kind === 'wheelchair' ? 1 : 1.15);
    for (const points of cornerSets) {
      if (points.every(point => point.z >= place.z)) continue;
      const bounds = new Box2();
      for (const point of points) {
        const t = (place.z - CINEMA_SCREEN.z) / (place.z - point.z);
        bounds.expandByPoint(new Vector2(place.x + (point.x - place.x) * t, eyeY + (point.y - eyeY) * t));
      }
      assert.ok(!bounds.intersectsBox(screen), `handrail obscures the screen from R${place.row} x=${place.x}`);
    }
  }
});

test('seat travel replaces a pending destination and relocates in a fully covered frame', () => {
  const scene = new Scene();
  const transition = createCinemaSeatTransition(scene);
  const cover = scene.getObjectByName('Cinema seat transition');
  let seat = 'center';
  transition.start(() => { seat = 'front'; });
  transition.update(0);
  assert.equal(transition.active, true);
  transition.update(.06);
  transition.start(() => { seat = 'rear'; });
  assert.equal(seat, 'center');
  transition.update(.06);
  assert.equal(seat, 'rear');
  assert.equal(cover.material.uniforms.darkness.value, 1);
  transition.update(.15);
  assert.equal(transition.active, false);
  transition.dispose();
  assert.equal(scene.children.length, 0);
});
