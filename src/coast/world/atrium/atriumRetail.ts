import {
  BoxGeometry, CylinderGeometry, DoubleSide, Group, InstancedMesh, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PointLight, SphereGeometry,
  TorusGeometry, Vector3, type Material,
} from 'three';
import { ATRIUM_BOUNDS } from './atriumLayout';

/**
 * Ground-floor shop windows for the commercial atrium.
 *
 * The assets in this module are authored procedural meshes.  They are deliberately
 * low-texture: the image reference is used for massing, warm reflection and the
 * alternating retail identities, while the displays remain original and contain
 * no marks or copied signage.
 */

const FACADE_X = ATRIUM_BOUNDS.maxX;
const OUTER_SHELL_X = 15.2;
const FLOOR_Y = 0.018;

type Side = -1 | 1;

type RetailLight = {
  light: PointLight;
  onIntensity: number;
  offIntensity: number;
};

type Glow = {
  material: MeshStandardMaterial;
  onIntensity: number;
  offIntensity: number;
};

type BoxSpec = readonly [x: number, y: number, z: number, width: number, height: number, depth: number, yaw?: number];

interface RetailBay {
  side: Side;
  centerZ: number;
  span: number;
  depth: number;
  frontX: number;
  backX: number;
  group: Group;
}

const WOOD_HONEY = 0xa66d3f;
const WOOD_LIGHT = 0xd7a76c;
const DARK_BRONZE = 0x34292a;
const BLACK_BRONZE = 0x17171b;
const CHAMPAGNE = 0xb99463;
const CREAM_STONE = 0xc7ad8d;
const MATTE_BLACK = 0x111217;
const MANNEQUIN = 0xd8cec1;
const CLOTHING = [0x2e3546, 0x5b2430, 0x7d6a4c, 0xb9a48c, 0x263a38] as const;

function makeStandard(name: string, color: number, roughness: number, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ name, color, roughness, metalness });
}

function makeGlow(name: string, color: number, onIntensity: number, offIntensity: number, glows: Glow[]): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    name,
    color,
    emissive: color,
    emissiveIntensity: onIntensity,
    roughness: 0.35,
    metalness: 0.08,
  });
  glows.push({ material, onIntensity, offIntensity });
  return material;
}

function addBox(
  parent: Object3D,
  geometry: BoxGeometry,
  material: Material,
  [x, y, z, width, height, depth, yaw = 0]: BoxSpec,
  name: string,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.scale.set(width, height, depth);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCylinder(
  parent: Object3D,
  geometry: CylinderGeometry,
  material: Material,
  x: number,
  y: number,
  z: number,
  radiusX: number,
  height: number,
  radiusZ: number,
  name: string,
  yaw = 0,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  mesh.scale.set(radiusX, height, radiusZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addSphere(
  parent: Object3D,
  geometry: SphereGeometry,
  material: Material,
  x: number,
  y: number,
  z: number,
  radiusX: number,
  radiusY: number,
  radiusZ: number,
  name: string,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.scale.set(radiusX, radiusY, radiusZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addInstancedBoxes(
  parent: Object3D,
  geometry: BoxGeometry,
  material: Material,
  boxes: readonly BoxSpec[],
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, boxes.length);
  mesh.name = name;
  const transform = new Object3D();
  boxes.forEach(([x, y, z, width, height, depth, yaw = 0], index) => {
    transform.position.set(x, y, z);
    transform.rotation.set(0, yaw, 0);
    transform.scale.set(width, height, depth);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addInstancedCylinders(
  parent: Object3D,
  geometry: CylinderGeometry,
  material: Material,
  cylinders: readonly (readonly [x: number, y: number, z: number, radius: number, height: number, yaw?: number])[],
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, cylinders.length);
  mesh.name = name;
  const transform = new Object3D();
  cylinders.forEach(([x, y, z, radius, height, yaw = 0], index) => {
    transform.position.set(x, y, z);
    transform.rotation.set(0, yaw, 0);
    transform.scale.set(radius, height, radius);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCylinderBetween(
  parent: Object3D,
  geometry: CylinderGeometry,
  material: Material,
  start: Vector3,
  end: Vector3,
  radius: number,
  name: string,
): Mesh {
  const direction = new Vector3().subVectors(end, start);
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.set(radius, direction.length(), radius);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createGlassMaterial(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    name: 'Bounded low-reflection shopfront glass',
    color: 0xf0e4d2,
    roughness: 0.24,
    metalness: 0.018,
    ior: 1.46,
    transparent: true,
    opacity: 0.028,
    depthWrite: false,
    side: DoubleSide,
    forceSinglePass: true,
  });
}

function createBay(
  root: Group,
  side: Side,
  centerZ: number,
  span: number,
  depth: number,
  frame: MeshStandardMaterial,
  interior: MeshStandardMaterial,
  headerGlow: MeshStandardMaterial,
  glass: MeshPhysicalMaterial,
  boxes: BoxGeometry,
  label: string,
): RetailBay {
  const group = new Group();
  group.name = `Atrium ${label} storefront`;
  root.add(group);

  const frontX = side * FACADE_X;
  const backX = side * Math.min(OUTER_SHELL_X - 0.22, FACADE_X + depth);
  const edge = span * 0.5;
  const interiorDepth = Math.abs(backX - frontX);
  const corridorX = frontX - side * 0.045;

  addBox(group, boxes, interior, [backX, 1.94, centerZ, 0.16, 3.88, span], `${label} recessed back wall`);
  addBox(group, boxes, interior, [frontX + side * (interiorDepth * 0.5), FLOOR_Y, centerZ, interiorDepth, 0.036, span - 0.16], `${label} inset floor`);
  addBox(group, boxes, frame, [frontX, 3.97, centerZ, 0.18, 0.16, span + 0.18], `${label} upper fascia`);
  addBox(group, boxes, frame, [frontX, 1.95, centerZ - edge, 0.20, 3.90, 0.16], `${label} near jamb`);
  addBox(group, boxes, frame, [frontX, 1.95, centerZ + edge, 0.20, 3.90, 0.16], `${label} far jamb`);
  addBox(group, boxes, frame, [frontX, 3.72, centerZ, 0.22, 0.075, span - 0.22], `${label} display head rail`);
  addBox(group, boxes, frame, [corridorX + side * 0.022, 3.70, centerZ, 0.068, 0.12, span - 0.28], `${label} recessed headlight housing`);
  addBox(group, boxes, headerGlow, [corridorX + side * 0.060, 3.70, centerZ, 0.018, 0.026, span - 0.38], `${label} continuous warm headlight`);
  addBox(group, boxes, frame, [corridorX, 0.075, centerZ, 0.08, 0.10, span - 0.22], `${label} threshold`);
  addBox(group, boxes, glass, [corridorX, 1.86, centerZ, 0.018, 3.51, span - 0.25], `${label} full height glazing`);

  const streak = new MeshStandardMaterial({
    name: `${label} bounded glass reflection streaks`,
    color: 0xe8f2ed,
    emissive: 0xa6c2ba,
    emissiveIntensity: 0.24,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const streaks: BoxSpec[] = [];
  for (let index = 0; index < 5; index += 1) {
    const z = centerZ - edge + 0.68 + index * ((span - 1.35) / 4);
    const height = 1.15 + (index % 2) * 0.75;
    streaks.push([corridorX - side * 0.012, 1.58 + (index % 3) * 0.22, z, 0.010, height, 0.025]);
  }
  addInstancedBoxes(group, boxes, streak, streaks, `${label} bounded glazing highlights`);

  return { side, centerZ, span, depth, frontX, backX, group };
}

function addMannequin(
  bay: RetailBay,
  boxes: BoxGeometry,
  cylinders: CylinderGeometry,
  spheres: SphereGeometry,
  skin: MeshStandardMaterial,
  garment: MeshStandardMaterial,
  xOffset: number,
  z: number,
  scale = 1,
): void {
  const x = bay.frontX + bay.side * xOffset;
  const torso = addCylinder(bay.group, cylinders, garment, x, 1.20 * scale, z, 0.17 * scale, 0.72 * scale, 0.13 * scale,
    'original faceless mannequin garment torso', (z - bay.centerZ) * 0.06);
  torso.rotation.z = bay.side * 0.025;
  addCylinder(bay.group, cylinders, skin, x - bay.side * 0.072 * scale, 0.49 * scale, z, 0.052 * scale, 0.74 * scale,
    0.052 * scale, 'mannequin left leg');
  addCylinder(bay.group, cylinders, skin, x + bay.side * 0.072 * scale, 0.49 * scale, z, 0.052 * scale, 0.74 * scale,
    0.052 * scale, 'mannequin right leg');
  addSphere(bay.group, spheres, skin, x, 1.79 * scale, z, 0.13 * scale, 0.15 * scale, 0.12 * scale,
    'original faceless mannequin head');
  addBox(bay.group, boxes, skin, [x, 0.075 * scale, z, 0.34 * scale, 0.15 * scale, 0.34 * scale], 'mannequin display plinth');
  const shoulder = new Vector3(x - bay.side * 0.12 * scale, 1.47 * scale, z);
  addCylinderBetween(bay.group, cylinders, skin, shoulder, new Vector3(x - bay.side * 0.23 * scale, 1.11 * scale, z + 0.025 * scale),
    0.024 * scale, 'mannequin articulated arm');
}

function addHanger(
  bay: RetailBay,
  torus: TorusGeometry,
  boxes: BoxGeometry,
  metal: MeshStandardMaterial,
  x: number,
  y: number,
  z: number,
): void {
  const hanger = new Mesh(torus, metal);
  hanger.name = 'slim metal garment hanger';
  hanger.position.set(x, y, z);
  hanger.rotation.set(0, Math.PI / 2, 0);
  hanger.scale.set(0.72, 0.72, 0.72);
  bay.group.add(hanger);
  addBox(bay.group, boxes, metal, [x, y + 0.075, z, 0.018, 0.13, 0.018], 'hanger neck');
}

function addHoneyFashion(
  bay: RetailBay,
  boxes: BoxGeometry,
  cylinders: CylinderGeometry,
  spheres: SphereGeometry,
  torus: TorusGeometry,
  wood: MeshStandardMaterial,
  woodLight: MeshStandardMaterial,
  metal: MeshStandardMaterial,
  warmGlow: MeshStandardMaterial,
  clothingMaterials: readonly MeshStandardMaterial[],
): void {
  const { side, frontX, backX, centerZ, span, group } = bay;
  const backInset = backX - side * 0.11;
  const slats: BoxSpec[] = [];
  const slatCount = Math.floor(span / 0.19);
  for (let i = 0; i < slatCount; i += 1) {
    const z = centerZ - span * 0.5 + 0.18 + i * (span - 0.36) / Math.max(1, slatCount - 1);
    slats.push([backInset, 1.88, z, 0.07, 3.48, 0.042]);
  }
  addInstancedBoxes(group, boxes, woodLight, slats, 'honey oak vertical back slats');
  addBox(group, boxes, warmGlow, [backInset - side * 0.055, 2.78, centerZ, 0.026, 0.31, span - 0.42], 'honey fashion warm back wash');

  const displayXs = [0.62, 1.67, 2.68];
  displayXs.forEach((offset, index) => {
    const x = frontX + side * offset;
    const tableZ = centerZ + (index - 1) * 0.64;
    addBox(group, boxes, wood, [x, 0.49, tableZ, 0.46, 0.92, 1.20], 'honey oak folded garment table');
    addBox(group, boxes, woodLight, [x + side * 0.025, 0.97, tableZ, 0.42, 0.038, 1.15], 'honey oak table top');
    addBox(group, boxes, warmGlow, [x - side * 0.23, 0.95, tableZ, 0.018, 0.026, 0.98], 'honey oak table recessed sconce');
  });

  const rackOffsets = [0.92, 2.08];
  rackOffsets.forEach((offset, rackIndex) => {
    const x = frontX + side * offset;
    const z = centerZ + (rackIndex === 0 ? -1.08 : 1.04);
    addCylinder(group, cylinders, metal, x, 1.67, z - 0.95, 0.024, 1.90, 0.024, 'fashion rack upright');
    addCylinder(group, cylinders, metal, x, 1.67, z + 0.95, 0.024, 1.90, 0.024, 'fashion rack upright');
    const rail = addCylinder(group, cylinders, metal, x, 2.42, z, 0.026, 1.92, 0.026, 'fashion rack garment rail');
    rail.rotation.x = Math.PI / 2;
    const garments: Array<{ x: number; y: number; z: number; material: MeshStandardMaterial }> = [];
    for (let index = 0; index < 7; index += 1) {
      const garmentZ = z - 0.76 + index * 0.25;
      garments.push({ x: x + side * ((index % 3) - 1) * 0.026, y: 1.83 + (index % 2) * 0.022, z: garmentZ,
        material: clothingMaterials[index % clothingMaterials.length] });
      addHanger(bay, torus, boxes, metal, x + side * 0.012, 2.22, garmentZ);
    }
    clothingMaterials.forEach((material, materialIndex) => {
      const chosen = garments.filter(({ material: candidate }) => candidate === material);
      addInstancedCylinders(group, cylinders, material,
        chosen.map(({ x: garmentX, y, z: garmentZ }, index) => [garmentX, y, garmentZ, 0.14 + ((index + materialIndex) % 2) * 0.018,
          0.70 + ((index + materialIndex) % 3) * 0.06, (index % 2 ? 1 : -1) * 0.03] as const),
        'honey fashion hanging garments');
    });
  });

  addMannequin(bay, boxes, cylinders, spheres, makeStandard('soft mannequin neutral finish', MANNEQUIN, 0.64), clothingMaterials[3], 2.95, centerZ - 1.72, 1.02);
  addMannequin(bay, boxes, cylinders, spheres, makeStandard('warm mannequin neutral finish', 0xc1b7ac, 0.67), clothingMaterials[3], 2.86, centerZ + 1.71, 0.96);
}

function addBronzeBoutique(
  bay: RetailBay,
  boxes: BoxGeometry,
  cylinders: CylinderGeometry,
  spheres: SphereGeometry,
  frame: MeshStandardMaterial,
  shelf: MeshStandardMaterial,
  backdrop: MeshStandardMaterial,
  warmGlow: MeshStandardMaterial,
): void {
  const { side, frontX, backX, centerZ, span, group } = bay;
  const back = backX - side * 0.12;
  addBox(group, boxes, backdrop, [back, 1.92, centerZ, 0.11, 3.62, span - 0.22], 'black bronze ribbed rear wall');
  for (let row = 0; row < 4; row += 1) {
    addBox(group, boxes, shelf, [back - side * 0.12, 1.10 + row * 0.57, centerZ, 0.24, 0.045, span - 0.72],
      'black bronze floating shelf');
  }
  const shelfSconces: BoxSpec[] = [];
  for (let row = 0; row < 4; row += 1) {
    shelfSconces.push([back - side * 0.17, 1.15 + row * 0.57, centerZ, 0.022, 0.026, span - 0.90]);
  }
  addInstancedBoxes(group, boxes, warmGlow, shelfSconces, 'black bronze shelf underlighting');
  addBox(group, boxes, warmGlow, [back - side * 0.12, 2.92, centerZ, 0.026, 0.18, span - 0.44], 'black bronze concealed back wash');
  addBox(group, boxes, frame, [frontX + side * 0.72, 0.60, centerZ, 0.84, 1.10, span - 1.30], 'black bronze low display island');
  addBox(group, boxes, warmGlow, [frontX + side * 0.72, 1.16, centerZ, 0.026, 0.045, span - 1.48], 'black bronze island edge light');
  addMannequin(bay, boxes, cylinders, spheres, makeStandard('bronze boutique mannequin ivory', 0xd9d1c8, 0.59),
    makeStandard('bronze boutique mannequin charcoal garment', 0x1b1d23, 0.69), 1.50, centerZ - 1.12, 1.12);
  addMannequin(bay, boxes, cylinders, spheres, makeStandard('bronze boutique mannequin stone', 0xb4a89e, 0.63),
    makeStandard('bronze boutique mannequin deep green garment', 0x233c37, 0.69), 2.16, centerZ + 1.26, 0.98);
  const sculpture = new CylinderGeometry(1, 1, 1, 10);
  addCylinder(group, sculpture, warmGlow, frontX + side * 1.14, 1.63, centerZ - 0.02, 0.10, 0.16, 0.10, 'small abstract bronze display object');
}

function addPerfumeCounter(
  bay: RetailBay,
  boxes: BoxGeometry,
  cylinders: CylinderGeometry,
  glass: MeshPhysicalMaterial,
  brass: MeshStandardMaterial,
  stone: MeshStandardMaterial,
  backdrop: MeshStandardMaterial,
  glow: MeshStandardMaterial,
  glows: Glow[],
): void {
  const { side, frontX, backX, centerZ, span, group } = bay;
  const back = backX - side * 0.11;
  addBox(group, boxes, backdrop, [back, 1.91, centerZ, 0.12, 3.58, span - 0.26], 'perfume warm stone rear wall');
  addBox(group, boxes, glow, [back - side * 0.066, 2.92, centerZ, 0.026, 0.27, span - 0.44], 'perfume rear shelf wash');

  const shelfBoxes: BoxSpec[] = [];
  for (let row = 0; row < 4; row += 1) {
    shelfBoxes.push([back - side * (0.13 + row * 0.025), 1.12 + row * 0.55, centerZ, 0.13, 0.032, span - 0.58]);
  }
  addInstancedBoxes(group, boxes, brass, shelfBoxes, 'perfume brass wall shelves');
  addInstancedBoxes(group, boxes, glow, shelfBoxes.map(([x, y, z, , , depth]) =>
    [x - side * 0.055, y - 0.035, z, 0.020, 0.024, depth - 0.16]), 'perfume articulated shelf sconces');

  const bottleMats = [
    makeGlow('perfume amber bottle glow', 0xd09658, 0.66, 0.08, glows),
    makeGlow('perfume pearl bottle glow', 0xf0d9ad, 0.72, 0.08, glows),
    makeGlow('perfume rose bottle glow', 0xb87873, 0.55, 0.07, glows),
  ];
  // The compact bottles and case lighting keep this window detailed at distance.
  const bottlePositions: Array<readonly [number, number, number, number, number]> = [];
  for (let row = 0; row < 4; row += 1) {
    const y = 1.23 + row * 0.55;
    for (let index = 0; index < 12; index += 1) {
      const z = centerZ - (span - 0.94) * 0.5 + 0.22 + index * (span - 0.94) / 11;
      bottlePositions.push([back - side * (0.23 + (index % 2) * 0.03), y + (index % 3) * 0.025, z, 0.032 + (index % 3) * 0.008, 0.13 + (index % 4) * 0.023]);
    }
  }
  bottleMats.forEach((material, materialIndex) => {
    const selected = bottlePositions.filter((_, index) => index % bottleMats.length === materialIndex);
    addInstancedCylinders(group, cylinders, material, selected.map(([x, y, z, radius, height]) => [x, y, z, radius, height] as const),
      'small faceted perfume bottle bodies');
    const caps = selected.map(([x, y, z, radius, height]) => [x, y + height + 0.018, z, radius * 0.8, 0.035] as const);
    addInstancedCylinders(group, cylinders, brass, caps, 'small perfume bottle caps');
  });

  const caseCenters = [centerZ - 1.72, centerZ + 0.08, centerZ + 1.86];
  caseCenters.forEach((z, index) => {
    const x = frontX + side * (0.78 + (index % 2) * 0.35);
    addBox(group, boxes, stone, [x, 0.76, z, 0.62, 1.46, 1.13], 'perfume low stone display case');
    addBox(group, boxes, glass, [x + side * 0.012, 1.52, z, 0.49, 0.92, 0.97], 'perfume case glass hood');
    addBox(group, boxes, glow, [x - side * 0.28, 1.20, z, 0.018, 0.04, 0.87], 'perfume case under-shelf glow');
    addBox(group, boxes, brass, [x - side * 0.32, 0.085, z, 0.06, 0.09, 1.20], 'perfume case brass plinth');
  });

  const fringe: BoxSpec[] = [];
  const fringeCount = Math.floor((span - 0.42) / 0.115);
  for (let index = 0; index < fringeCount; index += 1) {
    const z = centerZ - (span - 0.42) * 0.5 + index * (span - 0.42) / Math.max(1, fringeCount - 1);
    const height = 0.95 + (index % 5) * 0.19;
    fringe.push([frontX + side * 0.14, 3.31 - height * 0.5, z, 0.017, height, 0.017]);
  }
  addInstancedBoxes(group, boxes, glow, fringe, 'perfume crystal fringe curtain');
  addBox(group, boxes, brass, [frontX + side * 0.14, 3.74, centerZ, 0.06, 0.055, span - 0.32], 'perfume crystal curtain head rail');
}

function addWarmSecondary(
  bay: RetailBay,
  boxes: BoxGeometry,
  cylinders: CylinderGeometry,
  frame: MeshStandardMaterial,
  backing: MeshStandardMaterial,
  glow: MeshStandardMaterial,
  variant: 'far' | 'back',
): void {
  const { side, frontX, backX, centerZ, span, group } = bay;
  const back = backX - side * 0.10;
  addBox(group, boxes, backing, [back, 1.88, centerZ, 0.10, 3.54, span - 0.30], 'secondary warm plaster rear wall');
  addBox(group, boxes, glow, [back - side * 0.06, 2.82, centerZ, 0.026, 0.26, span - 0.46], 'secondary amber back area wash');
  const cabinetDepth = variant === 'far' ? 0.72 : 0.93;
  addBox(group, boxes, frame, [frontX + side * cabinetDepth, 0.67, centerZ - 0.82, 0.64, 1.25, 1.20], 'secondary glass cabinet near');
  addBox(group, boxes, frame, [frontX + side * (cabinetDepth + 0.12), 0.64, centerZ + 0.83, 0.64, 1.18, 1.10], 'secondary glass cabinet far');
  addBox(group, boxes, glow, [frontX + side * (cabinetDepth - 0.31), 1.25, centerZ - 0.82, 0.02, 0.034, 1.02], 'secondary cabinet warm edge');
  const objects: Array<readonly [number, number, number, number, number, number]> = [];
  for (let index = 0; index < 6; index += 1) {
    objects.push([back - side * 0.14, 1.02 + (index % 2) * 0.43, centerZ - span * 0.32 + index * 0.13,
      0.065, 0.18 + (index % 3) * 0.05, 0.065]);
  }
  addInstancedCylinders(group, cylinders, frame, objects.map(([x, y, z, radius, height]) => [x, y, z, radius, height] as const),
    'secondary warm display objects');
}

function addStoreReflectionStreaks(
  bay: RetailBay,
  boxes: BoxGeometry,
  material: MeshStandardMaterial,
): void {
  const streaks: BoxSpec[] = [];
  for (let index = 0; index < 3; index += 1) {
    const z = bay.centerZ - bay.span * 0.34 + index * bay.span * 0.34;
    streaks.push([bay.frontX - bay.side * 0.083, 2.11 - index * 0.29, z, 0.012, 0.76 + index * 0.25, 0.018]);
  }
  addInstancedBoxes(bay.group, boxes, material, streaks, 'bounded shop glass key reflection');
}

function addGapFillers(
  root: Group,
  bays: readonly RetailBay[],
  boxes: BoxGeometry,
  stone: MeshStandardMaterial,
  stoneLight: MeshStandardMaterial,
  metal: MeshStandardMaterial,
  backdrop: MeshStandardMaterial,
  glow: MeshStandardMaterial,
): void {
  const { maxZ: worldHigh, minZ: worldLow } = ATRIUM_BOUNDS;
  ([-1, 1] as const).forEach(side => {
    const ordered = bays
      .filter(bay => bay.side === side)
      .sort((first, second) => second.centerZ - first.centerZ);
    let cursor = worldHigh;
    ordered.forEach((bay, index) => {
      const bayHigh = bay.centerZ + bay.span * 0.5;
      const bayLow = bay.centerZ - bay.span * 0.5;
      if (cursor - bayHigh > 0.24) {
        addWarmStoneFiller(root, side, (cursor + bayHigh) * 0.5, cursor - bayHigh, boxes,
          stone, stoneLight, metal, backdrop, glow, `ground filler ${side < 0 ? 'left' : 'right'} ${index}`);
      }
      cursor = bayLow;
    });
    if (cursor - worldLow > 0.24) {
      addWarmStoneFiller(root, side, (cursor + worldLow) * 0.5, cursor - worldLow, boxes,
        stone, stoneLight, metal, backdrop, glow, `ground filler ${side < 0 ? 'left' : 'right'} rear`);
    }
  });
}

function addWarmStoneFiller(
  root: Group,
  side: Side,
  centerZ: number,
  span: number,
  boxes: BoxGeometry,
  stone: MeshStandardMaterial,
  stoneLight: MeshStandardMaterial,
  metal: MeshStandardMaterial,
  backdrop: MeshStandardMaterial,
  glow: MeshStandardMaterial,
  label: string,
): void {
  const group = new Group();
  group.name = `Atrium ${label} warm stone filler bay`;
  root.add(group);
  const frontX = side * FACADE_X;
  // These filler faces stay behind the facade plane.  At +/-11.56 they leave the
  // concourse clear while preventing the large unlit gaps from reading outside.
  const surfaceX = frontX + side * 0.16;
  const panelX = frontX + side * 0.40;
  addBox(group, boxes, backdrop, [panelX, 1.90, centerZ, 0.14, 3.64, span], `${label} warm inset wall`);
  addBox(group, boxes, stone, [surfaceX, 1.94, centerZ, 0.08, 3.82, span + 0.05], `${label} honed stone face`);

  const count = Math.max(2, Math.ceil(span / 1.85));
  const step = span / count;
  const pilasters: BoxSpec[] = [];
  const seams: BoxSpec[] = [];
  const reveals: BoxSpec[] = [];
  for (let index = 0; index <= count; index += 1) {
    const z = centerZ - span * 0.5 + step * index;
    pilasters.push([surfaceX - side * 0.006, 1.98, z, 0.24, 3.86, 0.20]);
    if (index < count) {
      const panelZ = z + step * 0.5;
      const panelDepth = Math.max(0.28, step - 0.30);
      reveals.push([surfaceX - side * 0.040, 2.36, panelZ, 0.024, 2.46, 0.022]);
      for (let row = 1; row < 4; row += 1) {
        seams.push([surfaceX - side * 0.046, 0.64 + row * 0.76, panelZ, 0.026, 0.018, panelDepth]);
      }
      addBox(group, boxes, metal, [surfaceX - side * 0.055, 0.58, panelZ, 0.06, 0.09, panelDepth * 0.76], `${label} shallow display sill`);
      addBox(group, boxes, glow, [surfaceX - side * 0.087, 0.66, panelZ, 0.018, 0.024, panelDepth * 0.64], `${label} concealed sill wash`);
    }
  }
  addInstancedBoxes(group, boxes, stoneLight, pilasters, `${label} repeated warm stone pilasters`);
  addInstancedBoxes(group, boxes, metal, seams, `${label} honed stone horizontal joints`);
  addInstancedBoxes(group, boxes, glow, reveals, `${label} narrow wall light reveals`);
  addBox(group, boxes, stoneLight, [surfaceX, 3.88, centerZ, 0.16, 0.12, span + 0.08], `${label} upper stone coping`);
}

function addRearBridgeDisplays(
  root: Group,
  boxes: BoxGeometry,
  cylinders: CylinderGeometry,
  spheres: SphereGeometry,
  glass: MeshPhysicalMaterial,
  frame: MeshStandardMaterial,
  backdrop: MeshStandardMaterial,
  trim: MeshStandardMaterial,
  glow: MeshStandardMaterial,
): void {
  const group = new Group();
  group.name = 'Atrium display windows beyond the rear vestibule';
  root.add(group);
  const frontZ = ATRIUM_BOUNDS.minZ - 0.68;
  const backZ = frontZ - 0.20;
  const centers = [-2.16, 2.16];
  centers.forEach((centerX, bayIndex) => {
    const width = 3.34;
    const label = `rear bridge display ${bayIndex + 1}`;
    addBox(group, boxes, backdrop, [centerX, 1.86, backZ, width, 3.58, 0.14], `${label} warm display wall`);
    addBox(group, boxes, frame, [centerX, 3.78, frontZ, width + 0.18, 0.13, 0.18], `${label} pale crown reveal`);
    addBox(group, boxes, frame, [centerX - width * 0.5, 1.92, frontZ, 0.18, 3.72, 0.18], `${label} left pale pier`);
    addBox(group, boxes, frame, [centerX + width * 0.5, 1.92, frontZ, 0.18, 3.72, 0.18], `${label} right pale pier`);
    addBox(group, boxes, glass, [centerX, 1.90, frontZ - 0.035, width - 0.27, 3.48, 0.018], `${label} acrylic front glint`);

    const shelves: BoxSpec[] = [];
    const shelfLights: BoxSpec[] = [];
    for (let row = 0; row < 3; row += 1) {
      const y = 0.92 + row * 0.66;
      shelves.push([centerX, y, frontZ + 0.10, width - 0.54, 0.055, 0.52]);
      shelfLights.push([centerX, y + 0.048, frontZ + 0.075, width - 0.74, 0.022, 0.030]);
    }
    addInstancedBoxes(group, boxes, trim, shelves, `${label} layered display shelves`);
    addInstancedBoxes(group, boxes, glow, shelfLights, `${label} under-shelf warm sconces`);

    const objects: Array<readonly [number, number, number, number, number]> = [];
    for (let row = 0; row < 3; row += 1) {
      for (let index = 0; index < 7; index += 1) {
        const x = centerX - 1.18 + index * 0.39;
        objects.push([x, 1.04 + row * 0.66, frontZ + 0.08, 0.048 + (index % 2) * 0.012,
          0.17 + (index % 3) * 0.045]);
      }
    }
    addInstancedCylinders(group, cylinders, trim, objects, `${label} small display vessels`);

    for (const offset of [-0.74, 0.74]) {
      const mannequinX = centerX + offset;
      addCylinder(group, cylinders, trim, mannequinX, 1.72, frontZ + 0.16, 0.14, 0.70, 0.12,
        `${label} mannequin torso`);
      addSphere(group, spheres, frame, mannequinX, 2.30, frontZ + 0.16, 0.115, 0.13, 0.105,
        `${label} mannequin head`);
      addBox(group, boxes, trim, [mannequinX, 0.11, frontZ + 0.16, 0.28, 0.18, 0.28], `${label} mannequin plinth`);
    }
  });
}

/**
 * Build the ground-floor retail displays surrounding the atrium common area.
 * Store rooms are intentionally sealed visual bays; navigation and collision stay
 * with the parent atrium world.
 */
export function buildAtriumRetail(root: Group): { setLighting(artificialOn: boolean): void } {
  const group = new Group();
  group.name = 'Commercial atrium ground-floor retail displays';
  root.add(group);

  const boxes = new BoxGeometry(1, 1, 1);
  const cylinders = new CylinderGeometry(1, 1, 1, 12);
  const smallCylinder = new CylinderGeometry(1, 1, 1, 8);
  const spheres = new SphereGeometry(1, 20, 12);
  const hangerTorus = new TorusGeometry(0.14, 0.012, 6, 16, Math.PI * 1.55);

  const wood = makeStandard('honey oak display timber', WOOD_HONEY, 0.66);
  const woodLight = makeStandard('light honey oak slat timber', WOOD_LIGHT, 0.63);
  const blackBronze = makeStandard('black bronze storefront metal', BLACK_BRONZE, 0.34, 0.62);
  const darkBronze = makeStandard('dark bronze boutique interior', DARK_BRONZE, 0.39, 0.46);
  const champagne = makeStandard('champagne perfume trim', CHAMPAGNE, 0.27, 0.72);
  const creamStone = makeStandard('light cream display stone', CREAM_STONE, 0.58);
  const matteBlack = makeStandard('matte charcoal display backing', MATTE_BLACK, 0.84);
  const fillerStone = makeStandard('warm honed stone filler pilaster', 0xb28c6d, 0.72);
  const fillerStoneLight = makeStandard('light warm stone filler reveal', 0xd0b18f, 0.66);
  const fillerMetal = makeStandard('filler bay bronze trim', 0x6d513d, 0.42, 0.42);
  const paleFrame = makeStandard('pale limestone storefront piers', 0xe0ceb7, 0.72);
  const glass = createGlassMaterial();
  const glows: Glow[] = [];
  const lights: RetailLight[] = [];
  const warmLine = makeGlow('continuous warm retail cove', 0xffd4ad, 0.95, 0.10, glows);
  const honeyWash = makeGlow('honey oak reflected light', 0xffb06f, 0.82, 0.07, glows);
  const bronzeWash = makeGlow('black bronze reflected light', 0xffa46e, 0.72, 0.06, glows);
  const perfumeWash = makeGlow('perfume case champagne light', 0xffd39a, 1.18, 0.09, glows);
  const crystalWash = makeGlow('perfume crystal fringe light', 0xffe0ad, 1.00, 0.08, glows);
  const amberWash = makeGlow('far warm retail back wash', 0xffa16b, 0.94, 0.08, glows);
  const bronzeBackdrop = makeGlow('black bronze softly lit rear backdrop', 0xb47f58, 0.70, 0.48, glows);
  const honeyBackdrop = makeGlow('honey oak softly lit rear backdrop', 0xe0b27d, 0.68, 0.50, glows);
  const perfumeBackdrop = makeGlow('perfume softly lit stone rear backdrop', 0xf0cf9f, 0.80, 0.55, glows);
  const warmBackdrop = makeGlow('secondary warm stone rear backdrop', 0xe0b487, 0.64, 0.45, glows);
  const fillerBackdrop = makeGlow('warm stone filler inset wash', 0xdcb083, 0.46, 0.36, glows);

  const clothingMaterials = CLOTHING.map((color, index) => makeStandard(`unbranded garment colour ${index + 1}`, color, 0.81));

  const leftFar = createBay(group, -1, -3.9, 5.80, 3.12, blackBronze, bronzeBackdrop, warmLine, glass, boxes, 'left black bronze boutique');
  addBronzeBoutique(leftFar, boxes, cylinders, spheres, darkBronze, matteBlack, bronzeBackdrop, bronzeWash);
  addStoreReflectionStreaks(leftFar, boxes, warmLine);

  const leftNear = createBay(group, -1, -10.10, 5.45, 3.38, paleFrame, honeyBackdrop, warmLine, glass, boxes, 'left near honey continuation');
  addHoneyFashion(leftNear, boxes, cylinders, spheres, hangerTorus, wood, woodLight, darkBronze, honeyWash, clothingMaterials);
  addStoreReflectionStreaks(leftNear, boxes, warmLine);

  const leftHoney = createBay(group, -1, -17.50, 9.00, 3.62, paleFrame, honeyBackdrop, warmLine, glass, boxes, 'left honey oak fashion');
  addHoneyFashion(leftHoney, boxes, cylinders, spheres, hangerTorus, wood, woodLight, darkBronze, honeyWash, clothingMaterials);
  addStoreReflectionStreaks(leftHoney, boxes, warmLine);

  const leftBoutique = createBay(group, -1, -26.30, 6.55, 3.48, blackBronze, bronzeBackdrop, warmLine, glass, boxes, 'left dark frame boutique');
  addBronzeBoutique(leftBoutique, boxes, cylinders, spheres, darkBronze, matteBlack, bronzeBackdrop, bronzeWash);
  addStoreReflectionStreaks(leftBoutique, boxes, warmLine);

  const leftFarBack = createBay(group, -1, -40.80, 5.65, 3.22, darkBronze, warmBackdrop, warmLine, glass, boxes, 'left far bronze unit');
  addWarmSecondary(leftFarBack, boxes, smallCylinder, champagne, warmBackdrop, amberWash, 'far');

  const rightFar = createBay(group, 1, -3.85, 5.70, 3.08, darkBronze, warmBackdrop, warmLine, glass, boxes, 'right warm perspective unit');
  addWarmSecondary(rightFar, boxes, smallCylinder, champagne, warmBackdrop, amberWash, 'far');
  addStoreReflectionStreaks(rightFar, boxes, amberWash);

  const rightNear = createBay(group, 1, -10.10, 5.45, 3.38, paleFrame, perfumeBackdrop, warmLine, glass, boxes, 'right near crystal continuation');
  addPerfumeCounter(rightNear, boxes, cylinders, glass, champagne, creamStone, perfumeBackdrop, perfumeWash, glows);
  addStoreReflectionStreaks(rightNear, boxes, crystalWash);

  const rightPerfume = createBay(group, 1, -22.0, 10.00, 3.68, paleFrame, perfumeBackdrop, warmLine, glass, boxes, 'right crystal perfume counter');
  addPerfumeCounter(rightPerfume, boxes, cylinders, glass, champagne, creamStone, perfumeBackdrop, perfumeWash, glows);
  // Crystal rods use the same bounded warm material as the cases, so the curtain
  // remains readable in the common area while artificial light is switched off.
  addStoreReflectionStreaks(rightPerfume, boxes, crystalWash);

  const rightBack = createBay(group, 1, -31.20, 7.35, 3.42, champagne, warmBackdrop, warmLine, glass, boxes, 'right warm glass unit');
  addWarmSecondary(rightBack, boxes, smallCylinder, champagne, warmBackdrop, amberWash, 'back');
  addStoreReflectionStreaks(rightBack, boxes, amberWash);

  const rightFarBack = createBay(group, 1, -43.20, 6.30, 3.24, blackBronze, bronzeBackdrop, warmLine, glass, boxes, 'right far layered unit');
  addWarmSecondary(rightFarBack, boxes, smallCylinder, champagne, bronzeBackdrop, amberWash, 'far');

  const allBays = [leftFar, leftNear, leftHoney, leftBoutique, leftFarBack, rightFar, rightNear, rightPerfume, rightBack, rightFarBack];
  addGapFillers(group, allBays, boxes, fillerStone, fillerStoneLight, fillerMetal, fillerBackdrop, amberWash);
  addRearBridgeDisplays(group, boxes, cylinders, spheres, glass, paleFrame, warmBackdrop, champagne, amberWash);

  // A single extra restrained point at each prominent window gives the cases a
  // believable local bounce without competing with the atrium's own room light.
  [leftNear, rightNear].forEach((bay, index) => {
    const light = new PointLight(index === 0 ? 0xffad73 : 0xffcf9b, 0.88, 4.2, 2);
    light.name = `${index === 0 ? 'honey fashion' : 'perfume counter'} secondary local bounce`;
    light.position.set(bay.frontX + bay.side * 1.38, 1.36, bay.centerZ + bay.side * 0.65);
    light.userData.atriumRetailLight = true;
    bay.group.add(light);
    lights.push({ light, onIntensity: 0.88, offIntensity: 0.18 });
  });

  let artificialOn = true;
  function setLighting(next: boolean): void {
    artificialOn = next;
    glows.forEach(({ material, onIntensity, offIntensity }) => {
      material.emissiveIntensity = next ? onIntensity : offIntensity;
      material.needsUpdate = true;
    });
    lights.forEach(({ light, onIntensity, offIntensity }) => {
      light.intensity = next ? onIntensity : offIntensity;
    });
  }

  // Keep the initial state explicit for parent worlds that construct the retail
  // group before their global artificial-lighting mode is known.
  setLighting(artificialOn);

  return { setLighting };
}
