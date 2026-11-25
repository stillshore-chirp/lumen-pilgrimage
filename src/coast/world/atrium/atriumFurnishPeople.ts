import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ATRIUM_CAFE, atriumStairFrame, atriumStairPoint } from './atriumLayout';

type Point3 = readonly [x: number, y: number, z: number];

interface FigureMaterials {
  readonly skin: THREE.MeshStandardMaterial;
  readonly hair: THREE.MeshStandardMaterial;
  readonly jacket: THREE.MeshStandardMaterial;
  readonly jacketLight: THREE.MeshStandardMaterial;
  readonly jacketPanel: THREE.MeshStandardMaterial;
  readonly trousers: THREE.MeshStandardMaterial;
  readonly shoe: THREE.MeshStandardMaterial;
  readonly scarf: THREE.MeshStandardMaterial;
  readonly bag: THREE.MeshStandardMaterial;
}

interface FigureGeometry {
  readonly torso: THREE.BufferGeometry;
  readonly longCoat: THREE.BufferGeometry;
  readonly head: THREE.BufferGeometry;
  readonly hair: THREE.BufferGeometry;
  readonly hand: THREE.BufferGeometry;
  readonly limb: THREE.BufferGeometry;
  readonly leg: THREE.BufferGeometry;
  readonly shoe: THREE.BufferGeometry;
  readonly panel: THREE.BufferGeometry;
  readonly scarf: THREE.BufferGeometry;
  readonly bag: THREE.BufferGeometry;
}

function createMaterials(): FigureMaterials {
  return {
    // Neutral, deliberately simplified tones keep the figures anonymous at every distance.
    skin: new THREE.MeshStandardMaterial({ name: 'Atrium patron skin', color: 0x8f725f, roughness: .93 }),
    hair: new THREE.MeshStandardMaterial({ name: 'Atrium patron hair', color: 0x2c2928, roughness: .96 }),
    jacket: new THREE.MeshStandardMaterial({ name: 'Atrium patron garment', color: 0x586266, roughness: .91 }),
    jacketLight: new THREE.MeshStandardMaterial({ name: 'Atrium patron light garment', color: 0xc3bbae, roughness: .94 }),
    jacketPanel: new THREE.MeshStandardMaterial({ name: 'Atrium patron garment panel', color: 0x737d7d, roughness: .94 }),
    trousers: new THREE.MeshStandardMaterial({ name: 'Atrium patron trousers', color: 0x303941, roughness: .96 }),
    shoe: new THREE.MeshStandardMaterial({ name: 'Atrium patron shoes', color: 0x252a2e, roughness: .82, metalness: .04 }),
    scarf: new THREE.MeshStandardMaterial({ name: 'Atrium patron scarf', color: 0xb39877, roughness: .95 }),
    bag: new THREE.MeshStandardMaterial({ name: 'Atrium patron canvas bag', color: 0x806a55, roughness: .97 }),
  };
}

function createGeometry(): FigureGeometry {
  return {
    torso: new RoundedBoxGeometry(.46, .62, .29, 3, .075),
    longCoat: new RoundedBoxGeometry(.50, .76, .31, 3, .075),
    head: new THREE.SphereGeometry(.17, 16, 10),
    hair: new THREE.SphereGeometry(.177, 16, 10),
    hand: new THREE.SphereGeometry(.071, 8, 6),
    limb: new THREE.CylinderGeometry(.047, .057, 1, 8),
    leg: new THREE.CylinderGeometry(.070, .083, 1, 8),
    shoe: new RoundedBoxGeometry(.19, .10, .34, 2, .032),
    panel: new RoundedBoxGeometry(.28, .41, .018, 2, .013),
    scarf: new RoundedBoxGeometry(.14, .17, .31, 2, .025),
    bag: new RoundedBoxGeometry(.25, .31, .11, 2, .025),
  };
}

function mesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  position: Point3,
  rotation: Point3 = [0, 0, 0],
  scale: Point3 = [1, 1, 1],
): THREE.Mesh {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  object.position.set(...position);
  object.rotation.set(...rotation);
  object.scale.set(...scale);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function limb(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  from: Point3,
  to: Point3,
): void {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  const object = mesh(parent, geometry, material, name, [0, 0, 0]);
  object.position.copy(start).add(end).multiplyScalar(.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  object.scale.set(1, length, 1);
}

function head(parent: THREE.Group, geometry: FigureGeometry, materials: FigureMaterials,
  y: number, z: number, name: string): void {
  mesh(parent, geometry.head, materials.skin, `${name} simplified head`, [0, y, z], [0, 0, 0], [.94, 1.02, .94]);
  // A quiet hair cap and no facial marks keep the figure readable without making it uncanny.
  mesh(parent, geometry.hair, materials.hair, `${name} hair cap`, [0, y + .035, z - .052], [0, 0, 0], [1.01, .72, .96]);
}

function shoePair(parent: THREE.Group, geometry: FigureGeometry, materials: FigureMaterials,
  positions: readonly Point3[], name: string): void {
  positions.forEach((position, index) => {
    mesh(parent, geometry.shoe, materials.shoe, `${name} shoe ${index + 1}`, position);
  });
}

function addSeatedCafePatron(parent: THREE.Group, geometry: FigureGeometry, materials: FigureMaterials): void {
  const figure = new THREE.Group();
  figure.name = 'Anonymous seated cafe patron';
  // Cafe chair one is at this position and faces the table toward -Z.
  figure.position.set(ATRIUM_CAFE.x - 1.05, 0, ATRIUM_CAFE.z + 1.94);
  figure.rotation.y = Math.PI;
  figure.scale.setScalar(.93);
  parent.add(figure);

  mesh(figure, geometry.torso, materials.jacket, 'Seated patron compact jacket', [0, 1.01, -.01], [0.10, 0, 0]);
  mesh(figure, geometry.panel, materials.jacketPanel, 'Seated patron jacket front panel', [0, 1.01, .145], [0.10, 0, 0]);
  mesh(figure, geometry.scarf, materials.scarf, 'Seated patron soft neck scarf', [0, 1.30, .01], [0.06, 0, 0]);
  head(figure, geometry, materials, 1.52, -.01, 'Seated patron');

  const hipY = .69;
  const kneeY = .51;
  const ankleY = .10;
  for (const side of [-1, 1] as const) {
    const hip: Point3 = [side * .13, hipY, .06];
    const knee: Point3 = [side * .14, kneeY, .27];
    const ankle: Point3 = [side * .14, ankleY, .34];
    limb(figure, geometry.leg, materials.trousers, 'Seated patron bent trouser upper', hip, knee);
    limb(figure, geometry.leg, materials.trousers, 'Seated patron bent trouser lower', knee, ankle);
    shoePair(figure, geometry, materials, [[side * .14, .055, .42]], 'Seated patron');
  }
  for (const side of [-1, 1] as const) {
    const shoulder: Point3 = [side * .20, 1.24, .02];
    const elbow: Point3 = [side * .25, 1.02, .20];
    const hand: Point3 = [side * .18, .82, .34];
    limb(figure, geometry.limb, materials.jacket, 'Seated patron sleeve upper', shoulder, elbow);
    limb(figure, geometry.limb, materials.jacketPanel, 'Seated patron sleeve lower', elbow, hand);
    mesh(figure, geometry.hand, materials.skin, 'Seated patron hand near table', hand);
  }
}

interface WalkingPatronPlacement {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly lightTop: boolean;
  readonly withBag: boolean;
  readonly name: string;
}

function addWalkingPatron(parent: THREE.Group, geometry: FigureGeometry, materials: FigureMaterials,
  placement: WalkingPatronPlacement): void {
  const figure = new THREE.Group();
  figure.name = placement.name;
  figure.position.set(placement.x, 0, placement.z);
  figure.rotation.y = placement.yaw;
  figure.scale.setScalar(placement.scale);
  parent.add(figure);

  const top = placement.lightTop ? materials.jacketLight : materials.jacket;
  const panel = placement.lightTop ? materials.jacketPanel : materials.jacketPanel;
  mesh(figure, geometry.longCoat, top, `${placement.name} long overshirt`, [0, 1.18, 0]);
  mesh(figure, geometry.panel, panel, `${placement.name} overshirt front panel`, [0, 1.21, .16]);
  mesh(figure, geometry.scarf, materials.scarf, `${placement.name} loose scarf`, [0, 1.55, .01], [0, 0, -.08]);
  if (placement.withBag) {
    mesh(figure, geometry.bag, materials.bag, `${placement.name} small shoulder bag`, [-.29, 1.02, -.03], [0.12, 0.18, -.16]);
    limb(figure, geometry.limb, materials.bag, `${placement.name} bag strap`, [-.17, 1.48, .02], [-.30, .88, -.02]);
  }
  head(figure, geometry, materials, 1.79, 0, placement.name);

  const leftHip: Point3 = [-.13, .84, 0];
  const rightHip: Point3 = [.13, .84, 0];
  const leftKnee: Point3 = [-.18, .48, .15];
  const rightKnee: Point3 = [.17, .48, -.19];
  const leftAnkle: Point3 = [-.20, .08, .36];
  const rightAnkle: Point3 = [.16, .08, -.39];
  limb(figure, geometry.leg, materials.trousers, `${placement.name} left trouser upper`, leftHip, leftKnee);
  limb(figure, geometry.leg, materials.trousers, `${placement.name} left trouser lower`, leftKnee, leftAnkle);
  limb(figure, geometry.leg, materials.trousers, `${placement.name} right trouser upper`, rightHip, rightKnee);
  limb(figure, geometry.leg, materials.trousers, `${placement.name} right trouser lower`, rightKnee, rightAnkle);
  shoePair(figure, geometry, materials, [[-.20, .055, .44], [.16, .055, -.47]], placement.name);

  const shoulderLeft: Point3 = [-.21, 1.39, .01];
  const shoulderRight: Point3 = [.21, 1.39, .01];
  const elbowLeft: Point3 = [-.31, 1.10, -.15];
  const elbowRight: Point3 = [.30, 1.11, .16];
  const handLeft: Point3 = [-.32, .83, -.29];
  const handRight: Point3 = [.31, .84, .31];
  limb(figure, geometry.limb, top, `${placement.name} left sleeve`, shoulderLeft, elbowLeft);
  limb(figure, geometry.limb, top, `${placement.name} right sleeve`, shoulderRight, elbowRight);
  limb(figure, geometry.limb, panel, `${placement.name} left forearm`, elbowLeft, handLeft);
  limb(figure, geometry.limb, panel, `${placement.name} right forearm`, elbowRight, handRight);
  mesh(figure, geometry.hand, materials.skin, `${placement.name} left hand`, handLeft);
  mesh(figure, geometry.hand, materials.skin, `${placement.name} right hand`, handRight);
}

function addStairPatron(parent: THREE.Group, geometry: FigureGeometry, materials: FigureMaterials): void {
  // This mid-flight position remains about 40 m from the entrance camera, while
  // staying visible above the balustrade instead of disappearing behind the rear landing.
  const distance = 9.65;
  const point = atriumStairPoint(distance, -.63);
  const frame = atriumStairFrame(distance);
  const figure = new THREE.Group();
  figure.name = 'Anonymous distant stair patron';
  figure.position.set(point.x, frame.y, point.z);
  figure.rotation.y = Math.atan2(frame.normalZ, frame.normalX) + Math.PI;
  figure.scale.setScalar(.76);
  parent.add(figure);

  mesh(figure, geometry.longCoat, materials.jacketPanel, 'Distant stair patron wool coat', [0, 1.18, 0]);
  mesh(figure, geometry.panel, materials.scarf, 'Distant stair patron coat panel', [0, 1.20, .16]);
  head(figure, geometry, materials, 1.79, 0, 'Distant stair patron');
  const leftHip: Point3 = [-.13, .84, 0];
  const rightHip: Point3 = [.13, .84, 0];
  const leftKnee: Point3 = [-.15, .48, .12];
  const rightKnee: Point3 = [.17, .50, -.11];
  const leftAnkle: Point3 = [-.16, .08, .24];
  const rightAnkle: Point3 = [.18, .08, -.27];
  limb(figure, geometry.leg, materials.trousers, 'Distant stair patron left trouser', leftHip, leftKnee);
  limb(figure, geometry.leg, materials.trousers, 'Distant stair patron left shin', leftKnee, leftAnkle);
  limb(figure, geometry.leg, materials.trousers, 'Distant stair patron right trouser', rightHip, rightKnee);
  limb(figure, geometry.leg, materials.trousers, 'Distant stair patron right shin', rightKnee, rightAnkle);
  shoePair(figure, geometry, materials, [[-.16, .055, .30], [.18, .055, -.34]], 'Distant stair patron');
  limb(figure, geometry.limb, materials.jacketPanel, 'Distant stair patron left arm', [-.21, 1.38, 0], [-.30, .95, .15]);
  limb(figure, geometry.limb, materials.jacketPanel, 'Distant stair patron right arm', [.21, 1.38, 0], [.29, .94, -.12]);
  mesh(figure, geometry.hand, materials.skin, 'Distant stair patron left hand', [-.30, .92, .15]);
  mesh(figure, geometry.hand, materials.skin, 'Distant stair patron right hand', [.29, .91, -.12]);
}

/** Add five anonymous static patrons as environmental scale cues.
 *
 * They have no navigation footprints: the figures are intentionally sparse decorations and
 * are placed in existing seating, a left-side rear-bound concourse flow, and a distant stair flight.
 */
export function addAtriumFurnishPeople(root: THREE.Group): void {
  const people = new THREE.Group();
  people.name = 'Atrium anonymous scale patrons';
  root.add(people);
  const geometry = createGeometry();
  const materials = createMaterials();
  addSeatedCafePatron(people, geometry, materials);
  // The reference composition carries its moving scale cues to the left of the sofa;
  // keep the central stair apron open so the architecture remains the dominant read.
  for (const placement of [
    { name: 'Anonymous left rear-bound patron one', x: -8.35, z: -25.7, yaw: Math.PI + .08, scale: .86, lightTop: true, withBag: true },
    { name: 'Anonymous left rear-bound patron two', x: -7.38, z: -27.5, yaw: Math.PI - .05, scale: .80, lightTop: false, withBag: false },
    { name: 'Anonymous left rear-bound patron three', x: -6.52, z: -29.0, yaw: Math.PI + .12, scale: .76, lightTop: true, withBag: false },
  ] as const) {
    addWalkingPatron(people, geometry, materials, placement);
  }
  addStairPatron(people, geometry, materials);
}
