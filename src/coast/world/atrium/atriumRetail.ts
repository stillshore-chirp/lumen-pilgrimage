import {
  BoxGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Float32BufferAttribute,
  Group, InstancedMesh, LinearFilter, Mesh, MeshPhysicalMaterial, MeshStandardMaterial,
  Object3D, PlaneGeometry, PointLight, RGBAFormat, SRGBColorSpace, TorusGeometry,
} from 'three';
import type { Material } from 'three';
import { ATRIUM_BOUNDS } from './atriumLayout';

/**
 * Ground-floor shop windows for the commercial atrium.
 *
 * Display furniture, textiles and the directory graphic are authored here.
 * The storefronts are viewed at a grazing angle from the concourse, so the end
 * walls carry visible finishes and stock alongside the main window displays.
 */

const FACADE_X = ATRIUM_BOUNDS.maxX;
// The shell's dark perimeter reveal is at |x| = 14.755 m.
const RETAIL_BACK_LIMIT_X = 14.64;
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
type CylinderSpec = readonly [x: number, y: number, z: number, radius: number, height: number, yaw?: number];

interface RetailBay {
  side: Side;
  centerZ: number;
  span: number;
  frontX: number;
  backX: number;
  group: Group;
}

const WOOD_HONEY = 0xb69168;
const WOOD_LIGHT = 0xceab83;
const DARK_BRONZE = 0x34292a;
const BLACK_BRONZE = 0x17171b;
const CHAMPAGNE = 0xb99463;
const CREAM_STONE = 0xd9cdb7;
const BOTTLE_COLORS = [0xb4784f, 0xeadcc0, 0xb78379, 0xafbcc1].map(value => new Color(value));

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
  cylinders: readonly CylinderSpec[],
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

function createGlassMaterial(name: string, opacity: number): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    name,
    color: 0xf0e4d2,
    roughness: 0.24,
    metalness: 0.018,
    ior: 1.46,
    transparent: true,
    opacity,
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
  const backX = side * Math.min(RETAIL_BACK_LIMIT_X, FACADE_X + depth);
  const edge = span * 0.5;
  const interiorDepth = Math.abs(backX - frontX);
  const corridorX = frontX - side * 0.045;

  addBox(group, boxes, interior, [backX, 1.94, centerZ, 0.16, 3.88, span], `${label} recessed back wall`);
  const middleX = frontX + side * (interiorDepth * 0.5);
  addBox(group, boxes, interior, [middleX, FLOOR_Y, centerZ, interiorDepth, 0.036, span - 0.16], `${label} inset floor`);
  addBox(group, boxes, interior, [middleX, 3.80, centerZ, interiorDepth, 0.10, span], `${label} inset ceiling`);
  addInstancedBoxes(group, boxes, interior, [-1, 1].map(end =>
    [middleX, 1.92, centerZ + end * (edge - 0.075), interiorDepth - 0.16, 3.78, 0.10]), `${label} end walls`);
  addBox(group, boxes, frame, [frontX, 3.97, centerZ, 0.18, 0.16, span + 0.18], `${label} upper fascia`);
  addBox(group, boxes, frame, [frontX, 1.95, centerZ - edge, 0.20, 3.90, 0.16], `${label} near jamb`);
  addBox(group, boxes, frame, [frontX, 1.95, centerZ + edge, 0.20, 3.90, 0.16], `${label} far jamb`);
  addBox(group, boxes, frame, [frontX, 3.72, centerZ, 0.22, 0.075, span - 0.22], `${label} display head rail`);
  addBox(group, boxes, frame, [corridorX + side * 0.022, 3.70, centerZ, 0.068, 0.12, span - 0.28], `${label} recessed headlight housing`);
  addBox(group, boxes, headerGlow, [corridorX - side * 0.017, 3.70, centerZ, 0.014, 0.026, span - 0.38], `${label} continuous warm headlight`);
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

  return { side, centerZ, span, frontX, backX, group };
}

interface Garment {
  geometry: PlaneGeometry;
  material: MeshStandardMaterial;
}

interface FashionFixtures {
  boxes: BoxGeometry;
  cylinders: CylinderGeometry;
  hook: TorusGeometry;
  garments: readonly Garment[];
}

function makeGarments(): Garment[] {
  const stock = [
    { color: 0x434b5e, length: 0.89, widths: [0.15, 0.26, 0.245, 0.201, 0.195, 0.20, 0.20], pattern: 0 },
    { color: 0xa16e4e, length: 1.20, widths: [0.175, 0.18, 0.195, 0.211, 0.23, 0.25, 0.277], pattern: 1 },
    { color: 0xd7cbba, length: 0.74, widths: [0.168, 0.223, 0.21, 0.188, 0.181, 0.198, 0.196], pattern: 0 },
    { color: 0x6d5463, length: 1.05, widths: [0.146, 0.209, 0.193, 0.162, 0.186, 0.226, 0.248], pattern: 0 },
    { color: 0x61848e, length: 1.12, widths: [0.172, 0.18, 0.195, 0.209, 0.221, 0.23, 0.24], pattern: 2 },
    { color: 0xb3a28a, length: 0.80, widths: [0.164, 0.254, 0.235, 0.195, 0.195, 0.196, 0.187], pattern: 0 },
    { color: 0x7a7969, length: 0.95, widths: [0.165, 0.263, 0.242, 0.203, 0.19, 0.19, 0.19], pattern: 0 },
  ];
  return stock.map(({ color, length, widths, pattern }) => {
    const columns = 16;
    const rows = widths.length - 1;
    const geometry = new PlaneGeometry(1, 1, columns, rows);
    const positions = geometry.getAttribute('position');
    const shade: number[] = [];
    for (let row = 0; row <= rows; row += 1) {
      const drop = row / rows;
      for (let column = 0; column <= columns; column += 1) {
        const across = 2 * column / columns - 1;
        const fold = Math.cos(across * 12.8 + drop * 1.75);
        const shoulder = 0.055 * across ** 2 * (1 - drop) ** 3;
        const hem = Math.sin(across * 7.1 + length) * 0.031 * drop ** 3;
        const drape = fold * (0.011 + 0.026 * drop) + 0.04 * (1 - across ** 2);
        positions.setXYZ(row * (columns + 1) + column, across * widths[row],
          -drop * length - shoulder + hem, drape);

        // Alternating thread colours sit under the lighting of the actual folds.
        const stripe = pattern === 1 ? Math.cos(across * 22 + drop * 5) * 0.16 : 0;
        const weave = pattern === 2 ? Math.sin(across * 16 + drop * 10) * Math.sin(drop * 16) * 0.19 : 0;
        const tone = 0.87 + 0.08 * fold + stripe + weave;
        shade.push(tone, tone, tone);
      }
    }
    geometry.setAttribute('color', new Float32BufferAttribute(shade, 3));
    geometry.computeVertexNormals();
    const material = new MeshStandardMaterial({
      name: 'Draped unbranded display textile', color, roughness: 0.90, side: DoubleSide, vertexColors: true,
    });
    return { geometry, material };
  });
}

function addGarmentRack(
  group: Group,
  { boxes, cylinders, hook, garments }: FashionFixtures,
  metal: MeshStandardMaterial,
  [x, z, length, railY]: readonly [number, number, number, number],
  assortment: readonly number[],
): void {
  const end = length * 0.5;
  for (const postZ of [z - end, z + end]) {
    addCylinder(group, cylinders, metal, x, railY * 0.5 + 0.02, postZ, 0.018, railY, 0.018, 'garment rack upright');
    addBox(group, boxes, metal, [x, 0.043, postZ, 0.50, 0.035, 0.08], 'garment rack foot');
  }
  const rail = addCylinder(group, cylinders, metal, x, railY, z, 0.019, length + 0.05, 0.019, 'garment rack rail');
  rail.rotation.x = Math.PI / 2;
  assortment.forEach((garmentIndex, index) => {
    const sleeve = new Group();
    sleeve.position.set(x, railY, z - end + (index + 0.52) * length / assortment.length);
    sleeve.rotation.y = Math.sin(index * 1.79) * 0.15;
    group.add(sleeve);

    const hanger = new Mesh(hook, metal);
    hanger.name = 'open garment hanger hook';
    hanger.position.y = -0.026;
    hanger.rotation.z = -Math.PI * 0.35;
    sleeve.add(hanger);
    addBox(sleeve, boxes, metal, [0, -0.098, 0, 0.013, 0.077, 0.013], 'garment hanger stem');
    for (const arm of [-1, 1]) {
      addBox(sleeve, boxes, metal, [arm * 0.095, -0.137, 0, 0.212, 0.016, 0.024], 'garment hanger shoulder')
        .rotation.z = -arm * 0.34;
    }

    const { geometry, material } = garments[garmentIndex];
    const garment = new Mesh(geometry, material);
    garment.name = 'empty hanging garment';
    garment.position.y = -0.159;
    garment.castShadow = true;
    garment.receiveShadow = true;
    sleeve.add(garment);
  });
}

function addHoneyFashion(
  bay: RetailBay,
  fixtures: FashionFixtures,
  wood: MeshStandardMaterial,
  woodLight: MeshStandardMaterial,
  metal: MeshStandardMaterial,
  warmGlow: MeshStandardMaterial,
): void {
  const { side, frontX, backX, centerZ, span, group } = bay;
  const { boxes } = fixtures;
  const backInset = backX - side * 0.12;
  const returnZ = centerZ - span * 0.5 + 0.149;
  const interiorDepth = Math.abs(backX - frontX);
  const joints: BoxSpec[] = [];
  const grains: BoxSpec[] = [];
  for (let offset = 0.24; offset < span - 0.20; offset += 0.23) {
    joints.push([backInset, 1.90, centerZ - span * 0.5 + offset, 0.039, 3.51, 0.024]);
  }
  for (let offset = 0.24; offset < interiorDepth - 0.10; offset += 0.21) {
    const x = frontX + side * offset;
    joints.push([x, 1.90, returnZ, 0.015, 3.51, 0.021]);
    grains.push([x + side * (0.056 + 0.013 * Math.sin(offset * 17)), 1.64,
      returnZ - 0.001, 0.008, 2.94 + 0.22 * Math.sin(offset * 11), 0.018]);
  }
  addInstancedBoxes(group, boxes, wood, joints, 'pale oak display wall board joints');
  addInstancedBoxes(group, boxes, woodLight, grains, 'pale oak board highlights');
  addBox(group, boxes, wood, [frontX + side * 0.18, 1.87, returnZ + 0.025, 0.08, 3.51, 0.065], 'oak shop window end lining');
  addBox(group, boxes, warmGlow, [frontX + side * 0.22, 1.87, returnZ + 0.040, 0.024, 3.47, 0.018], 'oak shop window end light');
  addBox(group, boxes, warmGlow, [backInset - side * 0.06, 3.53, centerZ, 0.026, 0.024, span - 0.42], 'oak wall concealed cove');

  const frontRackZ = centerZ - span * 0.23;
  addGarmentRack(group, fixtures, metal, [frontX + side * 0.67, frontRackZ, 2.64, 2.03], [6, 2, 4, 0, 5, 1, 3, 2, 1]);
  addGarmentRack(group, fixtures, metal, [frontX + side * 1.79, centerZ + span * 0.13, 2.17, 2.16], [3, 6, 5, 1, 0, 4, 2]);

  const tables: BoxSpec[] = [];
  const supports: BoxSpec[] = [];
  const foldedTextiles: BoxSpec[] = [];
  for (const [offset, z, length] of [
    [0.72, centerZ + span * 0.23, 1.36],
    [2.05, centerZ - span * 0.29, 0.94],
  ]) {
    const x = frontX + side * offset;
    tables.push([x, 0.57, z, 0.60, 0.078, length, 0.05]);
    supports.push([x, 0.28, z - length * 0.40, 0.50, 0.50, 0.045],
      [x, 0.28, z + length * 0.40, 0.50, 0.50, 0.045]);
    foldedTextiles.push([x - side * 0.09, 0.637, z + 0.11, 0.25, 0.05, 0.37, 0.08],
      [x - side * 0.08, 0.679, z + 0.13, 0.23, 0.036, 0.33, 0.04],
      [x + side * 0.12, 0.624, z - 0.28, 0.20, 0.032, 0.28, -0.05]);
  }
  addInstancedBoxes(group, boxes, wood, tables, 'oak display tables');
  addInstancedBoxes(group, boxes, metal, supports, 'fine display table supports');
  addInstancedBoxes(group, boxes, woodLight, foldedTextiles, 'folded textile stacks');
}

function addBronzeBoutique(
  bay: RetailBay,
  fixtures: FashionFixtures,
  frame: MeshStandardMaterial,
  shelf: MeshStandardMaterial,
  backdrop: MeshStandardMaterial,
  warmGlow: MeshStandardMaterial,
): void {
  const { side, frontX, backX, centerZ, span, group } = bay;
  const { boxes } = fixtures;
  const back = backX - side * 0.13;
  const returnZ = centerZ - span * 0.5 + 0.15;
  const centers = [frontX + side * 0.69, frontX + side * 1.60, frontX + side * 2.54];
  const surround: BoxSpec[] = [];
  const ledges: BoxSpec[] = [];
  const sconces: BoxSpec[] = [];
  for (const x of centers) {
    surround.push([x, 1.91, returnZ, 0.82, 2.96, 0.049]);
    ledges.push([x, 0.44, returnZ + 0.17, 0.80, 0.057, 0.32],
      [x, 1.32, returnZ + 0.17, 0.80, 0.057, 0.32],
      [x, 2.53, returnZ + 0.17, 0.80, 0.057, 0.32]);
    sconces.push([x, 2.49, returnZ + 0.16, 0.72, 0.018, 0.038],
      [x, 3.33, returnZ + 0.065, 0.69, 0.025, 0.038]);
  }
  addInstancedBoxes(group, boxes, frame, surround, 'bronze boutique framed recesses');
  addInstancedBoxes(group, boxes, shelf, ledges, 'bronze boutique shallow oak shelves');
  addInstancedBoxes(group, boxes, warmGlow, sconces, 'bronze boutique concealed shelf lights');

  for (const offset of [-0.26, 0.04, 0.32]) {
    const z = centerZ + span * offset;
    addBox(group, boxes, backdrop, [back, 1.78, z, 0.10, 2.84, span * 0.23], 'bronze boutique warm display niche');
    addBox(group, boxes, shelf, [back - side * 0.15, 0.92, z, 0.30, 0.054, span * 0.23], 'bronze boutique low niche shelf');
    addBox(group, boxes, warmGlow, [back - side * 0.074, 3.12, z, 0.017, 0.022, span * 0.21], 'bronze boutique niche cove');
  }
  addGarmentRack(group, fixtures, frame, [frontX + side * 0.71, centerZ - span * 0.20, 1.72, 1.99], [2, 0, 6, 3, 5, 2]);
  addGarmentRack(group, fixtures, frame, [frontX + side * 1.62, centerZ + span * 0.08, 2.01, 2.16], [3, 4, 1, 6, 2]);
}

type Bottle = readonly [x: number, base: number, z: number, width: number, height: number, depth: number];

interface CounterFixtures {
  boxes: BoxGeometry;
  cylinders: CylinderGeometry;
  glass: MeshPhysicalMaterial;
  brass: MeshStandardMaterial;
  stone: MeshStandardMaterial;
  bottle: MeshStandardMaterial;
}

function addBottles(
  group: Group,
  { boxes, cylinders, brass, bottle }: CounterFixtures,
  stock: readonly Bottle[],
): void {
  const caps: BoxSpec[] = [];
  const flacons: BoxSpec[] = [];
  const flaconColors: Color[] = [];
  const atomizers: CylinderSpec[] = [];
  const atomizerColors: Color[] = [];
  stock.forEach(([x, base, z, width, height, depth], index) => {
    const y = base + height * 0.5;
    const color = BOTTLE_COLORS[index % BOTTLE_COLORS.length];
    if (index % 3 === 1) {
      atomizers.push([x, y, z, width * 0.45, height]);
      atomizerColors.push(color);
    } else {
      flacons.push([x, y, z, depth, height, width, Math.sin(index * 1.17) * 0.23]);
      flaconColors.push(color);
    }
    caps.push([x, base + height + 0.015, z, depth * 0.47, 0.032, width * 0.47]);
  });
  const glassBottles = addInstancedBoxes(group, boxes, bottle, flacons, 'squared display flacons');
  flaconColors.forEach((color, index) => glassBottles.setColorAt(index, color));
  const glassAtomizers = addInstancedCylinders(group, cylinders, bottle, atomizers, 'faceted display atomizers');
  atomizerColors.forEach((color, index) => glassAtomizers.setColorAt(index, color));
  addInstancedBoxes(group, boxes, brass, caps, 'perfume bottle caps');
}

function addDisplayCase(
  group: Group,
  { boxes, glass, brass, stone }: CounterFixtures,
  glow: MeshStandardMaterial,
  [x, z, depth, length, height]: readonly [number, number, number, number, number],
  stock: Bottle[],
): void {
  const deckY = height + 0.04;
  const hoodHeight = 0.39;
  addBox(group, boxes, brass, [x, 0.092, z, depth * 0.88, 0.12, length - 0.09], 'inset display case toe kick');
  addBox(group, boxes, stone, [x, (height + 0.15) * 0.5, z, depth - 0.08, height - 0.15, length - 0.08], 'cream stone display case base');
  addBox(group, boxes, brass, [x, height, z, depth, 0.045, length], 'brushed metal display case rim');
  addBox(group, boxes, glow, [x, deckY, z, depth - 0.08, 0.025, length - 0.12], 'warm lit display tray');
  addBox(group, boxes, glass, [x, deckY + hoodHeight * 0.5, z, depth - 0.05, hoodHeight, length - 0.06], 'clear presentation case hood');

  // Narrow frame members give the clear panels a highlight at oblique angles.
  for (const dx of [-1, 1]) {
    const edgeX = x + dx * (depth * 0.5 - 0.027);
    addBox(group, boxes, brass, [edgeX, deckY + hoodHeight, z, 0.022, 0.02, length - 0.055], 'display case top edge');
    for (const dz of [-1, 1]) {
      const edgeZ = z + dz * (length * 0.5 - 0.032);
      addBox(group, boxes, brass, [edgeX, deckY + hoodHeight * 0.5, edgeZ, 0.023, hoodHeight, 0.023], 'display case corner post');
    }
  }
  for (const dz of [-1, 1]) {
    addBox(group, boxes, brass, [x, deckY + hoodHeight, z + dz * (length * 0.5 - 0.032),
      depth - 0.056, 0.02, 0.022], 'display case short edge');
  }

  const count = Math.ceil(length * 5);
  for (let index = 0; index < count; index += 1) {
    const bottleZ = z + length * ((index + 0.8) / (count + 0.6) - 0.5);
    const xOffset = 0.12 * Math.sin(index * 2.23);
    stock.push([x + xOffset, deckY + 0.014, bottleZ, 0.072 + (index % 3) * 0.024,
      0.095 + (index % 4) * 0.039, 0.064 + (index % 2) * 0.032]);
  }
}

function addPerfumeCounter(
  bay: RetailBay,
  fixtures: CounterFixtures,
  backdrop: MeshStandardMaterial,
  glow: MeshStandardMaterial,
  crystal: MeshStandardMaterial,
): void {
  const { side, frontX, backX, centerZ, span, group } = bay;
  const { boxes, brass, glass } = fixtures;
  const back = backX - side * 0.14;
  const returnZ = centerZ - span * 0.5 + 0.153;
  const shelfLips: BoxSpec[] = [];
  const shelves: BoxSpec[] = [];
  const shelfLights: BoxSpec[] = [];
  const casings: BoxSpec[] = [];
  const rearInsets: BoxSpec[] = [];
  const stock: Bottle[] = [];

  const sectionPitch = (Math.abs(backX - frontX) - 0.30) / 4;
  const sectionWidth = sectionPitch - 0.07;
  for (let section = 0; section < 4; section += 1) {
    const x = frontX + side * (0.14 + (section + 0.5) * sectionPitch);
    rearInsets.push([x, 1.89, returnZ, sectionWidth, 2.96, 0.055]);
    const edge = (sectionWidth + 0.034) * 0.5;
    for (const xOffset of [-edge, edge]) {
      casings.push([x + xOffset, 1.88, returnZ + 0.105, 0.033, 3.03, 0.20]);
    }
    for (let row = 0; row < 4; row += 1) {
      const y = 0.82 + row * 0.62;
      shelves.push([x, y, returnZ + 0.165, sectionWidth - 0.01, 0.025, 0.29]);
      shelfLips.push([x, y, returnZ + 0.316, sectionWidth, 0.028, 0.023]);
      shelfLights.push([x, y - 0.026, returnZ + 0.285, sectionWidth - 0.05, 0.019, 0.026]);
      for (let item = 0; item < 4; item += 1) {
        if ((item + row) % 5 === 3) continue;
        const bottleX = x + (item - 1.46) * sectionWidth * 0.22;
        stock.push([bottleX, y + 0.014, returnZ + 0.168 + (item % 2) * 0.06,
          0.076 + (item % 3) * 0.029, 0.113 + ((row + item) % 4) * 0.052, 0.078]);
      }
    }
    shelfLights.push([x, 3.32, returnZ + 0.167, sectionWidth - 0.07, 0.027, 0.040]);
  }

  for (const [index, offset] of [-0.30, -0.08, 0.16, 0.37].entries()) {
    const z = centerZ + span * offset;
    const width = span * (index % 2 === 0 ? 0.18 : 0.16);
    rearInsets.push([back, 1.89, z, 0.07, 2.96, width]);
    casings.push([back - side * 0.10, 1.88, z + width * 0.5 + 0.025, 0.18, 3.02, 0.044]);
    for (let row = 0; row < 4; row += 1) {
      const y = 0.83 + row * 0.62;
      shelves.push([back - side * 0.18, y, z, 0.31, 0.024, width]);
      shelfLips.push([back - side * 0.345, y, z, 0.023, 0.027, width]);
      shelfLights.push([back - side * 0.316, y - 0.026, z, 0.024, 0.019, width - 0.07]);
      for (let item = 0; item < 5; item += 1) {
        if ((item + row + index) % 6 === 3) continue;
        stock.push([back - side * (0.194 + (item % 2) * 0.055), y + 0.013,
          z + width * ((item + 0.49) / 5 - 0.5), 0.068 + (item % 2) * 0.037,
          0.105 + ((item + row) % 4) * 0.042, 0.058 + (item % 3) * 0.023]);
      }
    }
    shelfLights.push([back - side * 0.20, 3.32, z, 0.042, 0.027, width - 0.08]);
  }
  addInstancedBoxes(group, boxes, backdrop, rearInsets, 'warm inset perfume display bays');
  addInstancedBoxes(group, boxes, brass, casings, 'narrow metal display shelf uprights');
  addInstancedBoxes(group, boxes, brass, shelfLips, 'polished glass shelf edges');
  addInstancedBoxes(group, boxes, glass, shelves, 'stacked clear glass shelves');
  addInstancedBoxes(group, boxes, glow, shelfLights, 'individual warm shelf diffusers');

  for (const [offset, center, depth, length, height] of [
    [0.58, -0.325, 0.70, 1.38, 0.86],
    [0.82, -0.055, 0.72, 1.55, 0.97],
    [1.21, 0.245, 0.74, 1.41, 0.89],
  ]) {
    addDisplayCase(group, fixtures, glow, [frontX + side * offset, centerZ + span * center, depth, length, height], stock);
  }
  addBottles(group, fixtures, stock);

  const strands: BoxSpec[] = [];
  const prisms: BoxSpec[] = [];
  const strandCount = Math.floor((span - 0.38) / 0.069);
  const railY = 3.67;
  for (let index = 0; index < strandCount; index += 1) {
    const fraction = index / (strandCount - 1);
    const z = centerZ + (fraction - 0.5) * (span - 0.38);
    const x = frontX + side * (0.18 + (index % 3) * 0.073);
    const edgeDrop = 0.94 * Math.max(0, Math.cos(fraction * Math.PI * 4.1)) ** 2;
    const height = 0.55 + edgeDrop + (index % 7) * 0.095 + 0.16 * Math.sin(index * 1.57);
    strands.push([x, railY - height * 0.5, z, 0.010, height, 0.011, index * 0.21]);
    if (index % 3 !== 1) {
      prisms.push([x, railY - height + 0.025, z, 0.019, 0.125, 0.018, index * 0.36]);
      prisms.push([x, railY - height * 0.57, z, 0.017, 0.068, 0.016, index * 0.22]);
    }
  }
  addInstancedBoxes(group, boxes, glow, strands, 'fine suspended crystal strands');
  addInstancedBoxes(group, boxes, crystal, prisms, 'warm crystal catches');
  addBox(group, boxes, brass, [frontX + side * 0.258, railY + 0.026, centerZ, 0.21, 0.052, span - 0.32], 'crystal curtain suspension rail');
}

function addWarmSecondary(
  bay: RetailBay,
  fixtures: CounterFixtures,
  backing: MeshStandardMaterial,
  glow: MeshStandardMaterial,
  variant: 'far' | 'back',
): void {
  const { side, frontX, backX, centerZ, span, group } = bay;
  const { boxes, brass } = fixtures;
  const back = backX - side * 0.13;
  const returnZ = centerZ - span * 0.5 + 0.143;
  const midX = frontX + side * Math.abs(backX - frontX) * 0.54;
  addBox(group, boxes, backing, [midX, 1.84, returnZ, 2.58, 3.40, 0.050], 'secondary warm plaster side display');
  addBox(group, boxes, glow, [midX, 3.37, returnZ + 0.065, 2.36, 0.029, 0.038], 'secondary display cove');

  const stock: Bottle[] = [];
  const cabinetDepth = variant === 'far' ? 0.69 : 0.94;
  addDisplayCase(group, fixtures, glow, [frontX + side * cabinetDepth, centerZ - span * 0.23, 0.68, 1.32, 0.88], stock);
  addDisplayCase(group, fixtures, glow, [frontX + side * (cabinetDepth + 0.13), centerZ + span * 0.14, 0.71, 1.57, 0.93], stock);
  for (let row = 0; row < 3; row += 1) {
    const y = 0.83 + row * 0.63;
    addBox(group, boxes, brass, [midX, y, returnZ + 0.17, 2.39, 0.039, 0.33], 'secondary warm side shelf');
    addBox(group, boxes, glow, [midX, y - 0.035, returnZ + 0.30, 2.17, 0.020, 0.026], 'secondary warm side shelf diffuser');
    addBox(group, boxes, brass, [back - side * 0.14, y, centerZ + 0.16, 0.29, 0.047, span - 0.68], 'secondary back display shelf');
    for (let item = 0; item < 8; item += 1) {
      if ((item + row) % 5 === 2) continue;
      stock.push([midX + (item - 3.55) * 0.28, y + 0.021, returnZ + 0.17 + (item % 2) * 0.057,
        0.084 + (item % 3) * 0.036, 0.12 + (item % 4) * 0.047, 0.079]);
    }
  }
  addBottles(group, fixtures, stock);
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

  const count = Math.ceil(span / 2.85);
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
      if (span > 1.8) {
        reveals.push([surfaceX - side * 0.040, 2.36, z + step - 0.16, 0.012, 2.46, 0.016]);
      }
      for (let row = 1; row < 4; row += 1) {
        seams.push([surfaceX - side * 0.042, 0.59 + row * 0.79, panelZ, 0.015, 0.010, panelDepth]);
      }
    }
  }
  addInstancedBoxes(group, boxes, stoneLight, pilasters, `${label} repeated warm stone pilasters`);
  addInstancedBoxes(group, boxes, metal, seams, `${label} honed stone horizontal joints`);
  if (reveals.length > 0) addInstancedBoxes(group, boxes, glow, reveals, `${label} narrow wall light reveals`);
  addBox(group, boxes, stoneLight, [surfaceX, 3.88, centerZ, 0.16, 0.12, span + 0.08], `${label} upper stone coping`);
}

function makeDirectoryScreen(glows: Glow[]): MeshStandardMaterial {
  const width = 44;
  const height = 108;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const v = row / (height - 1);
    for (let column = 0; column < width; column += 1) {
      const u = column / (width - 1);
      const light = 24 * Math.sin(v * Math.PI);
      const band = 31 * Math.exp(-((u - 0.24 - v * 0.48) ** 2) * 255 - ((v - 0.54) ** 2) * 44);
      const crease = 16 * Math.exp(-((u + v * 0.8 - 0.97) ** 2) * 540 - ((v - 0.48) ** 2) * 26);
      const index = (row * width + column) * 4;
      pixels[index] = 175 + light - band + crease;
      pixels[index + 1] = 195 + light - band * 0.62 + crease;
      pixels[index + 2] = 224 + light * 0.65 - band * 0.31 + crease;
      pixels[index + 3] = 255;
    }
  }
  const graphic = new DataTexture(pixels, width, height, RGBAFormat);
  graphic.name = 'Original blue abstract directory artwork';
  graphic.colorSpace = SRGBColorSpace;
  graphic.minFilter = LinearFilter;
  graphic.magFilter = LinearFilter;
  graphic.needsUpdate = true;

  const material = makeGlow('cool inset display face', 0xffffff, 0.94, 0.04, glows);
  material.map = graphic;
  material.emissiveMap = graphic;
  return material;
}

function addDirectoryPanel(
  parent: Group,
  first: RetailBay,
  next: RetailBay,
  boxes: BoxGeometry,
  frame: MeshStandardMaterial,
  screen: MeshStandardMaterial,
): void {
  const nearestZ = first.centerZ - first.span * 0.5;
  const farthestZ = next.centerZ + next.span * 0.5;
  const width = Math.min(0.68, nearestZ - farthestZ - 0.13);
  const z = (nearestZ + farthestZ) * 0.5;
  const { side, frontX } = first;
  addBox(parent, boxes, frame, [frontX + side * 0.133, 1.13, z, 0.057, 1.88, width], 'black bezel in the stone pier');
  addBox(parent, boxes, screen, [frontX + side * 0.101, 1.13, z, 0.012, 1.76, width - 0.105], 'blue-lit inset display graphic');
}

function addRearWallShowcase(
  parent: Group,
  { boxes, glass, brass, bottle }: CounterFixtures,
  frame: MeshStandardMaterial,
  lining: MeshStandardMaterial,
  glow: MeshStandardMaterial,
): void {
  // The thin display fits between the vestibule wall face and the end of the walkable floor.
  const boundaryZ = ATRIUM_BOUNDS.minZ;
  const x = -8.18;
  const width = 4.56;
  addBox(parent, boxes, frame, [x, 2.16, boundaryZ - 0.043, width, 3.80, 0.013], 'dark west rear showcase surround');
  addBox(parent, boxes, lining, [x, 1.89, boundaryZ - 0.034, width - 0.25, 3.15, 0.009], 'west rear showcase lining');
  addBox(parent, boxes, glow, [x, 3.43, boundaryZ - 0.020, width - 0.48, 0.044, 0.010], 'lit west rear showcase head');
  addBox(parent, boxes, glass, [x, 1.90, boundaryZ - 0.008, width - 0.17, 3.16, 0.007], 'west rear showcase glazing');

  const ledges: BoxSpec[] = [];
  const sconces: BoxSpec[] = [];
  const goods: BoxSpec[] = [];
  for (const [section, offset] of [-1.34, 0.11, 1.46].entries()) {
    const centerX = x + offset;
    for (let row = 0; row < 3; row += 1) {
      const y = 0.66 + row * 0.73 + Math.abs(section - 1) * 0.08;
      ledges.push([centerX, y, boundaryZ - 0.019, 1.23, 0.046, 0.019]);
      sconces.push([centerX, y - 0.033, boundaryZ - 0.017, 1.16, 0.023, 0.011]);
      for (let item = 0; item < 5; item += 1) {
        if ((item + row + section) % 5 === 2) continue;
        const height = 0.14 + ((item + section * 2 + row) % 4) * 0.078;
        goods.push([centerX + (item - 2) * 0.23, y + 0.024 + height * 0.5, boundaryZ - 0.020,
          0.096 + (item % 3) * 0.042, height, 0.014]);
      }
    }
  }
  addInstancedBoxes(parent, boxes, brass, ledges, 'champagne west rear showcase shelves');
  addInstancedBoxes(parent, boxes, glow, sconces, 'warm west rear showcase shelf lighting');
  const merchandise = addInstancedBoxes(parent, boxes, bottle, goods, 'assorted west rear showcase goods');
  goods.forEach((_, index) => merchandise.setColorAt(index, BOTTLE_COLORS[index % BOTTLE_COLORS.length]));
}

function addRearBridgeDisplays(
  root: Group,
  fixtures: CounterFixtures,
  glass: MeshPhysicalMaterial,
  frame: MeshStandardMaterial,
  backdrop: MeshStandardMaterial,
  glow: MeshStandardMaterial,
): void {
  const group = new Group();
  group.name = 'Atrium display windows beyond the rear vestibule';
  root.add(group);
  const { boxes, brass } = fixtures;
  const frontZ = ATRIUM_BOUNDS.minZ - 0.68;
  const backZ = frontZ - 0.91;
  const width = 3.75;
  const stock: Bottle[] = [];
  const jambs: BoxSpec[] = [];
  const shelves: BoxSpec[] = [];
  const shelfLights: BoxSpec[] = [];

  addBox(group, boxes, frame, [0, 3.51, frontZ, 8.25, 0.48, 0.23], 'dark far storefront fascia');
  addBox(group, boxes, glow, [0, 3.255, frontZ - 0.06, 7.35, 0.036, 0.042], 'warm cove beneath the far storefront fascia');
  for (const centerX of [-2.12, 2.12]) {
    addBox(group, boxes, backdrop, [centerX, 1.70, backZ, width, 3.21, 0.12], 'far recessed warm display wall');
    addBox(group, boxes, glass, [centerX, 1.65, frontZ + 0.031, width - 0.11, 3.12, 0.018], 'far shop glazing');
    for (const x of [centerX - width * 0.5, centerX + width * 0.5]) {
      jambs.push([x, 1.63, frontZ - 0.31, 0.16, 3.26, 0.76]);
    }
    const tray = new Group();
    tray.position.set(centerX + 0.38, 0, frontZ - 0.15);
    tray.rotation.y = Math.PI / 2;
    group.add(tray);
    const trayStock: Bottle[] = [];
    addDisplayCase(tray, fixtures, glow, [0, 0, 0.53, 1.58, 0.71], trayStock);
    addBottles(tray, fixtures, trayStock);

    for (let row = 0; row < 3; row += 1) {
      const y = 0.93 + row * 0.63;
      const x = centerX + (row % 2 === 0 ? -0.23 : 0.18);
      shelves.push([x, y, backZ + 0.24, width - 0.72, 0.044, 0.31]);
      shelfLights.push([x, y - 0.038, backZ + 0.39, width - 0.87, 0.019, 0.023]);
      for (let index = 0; index < 7; index += 1) {
        if ((row + index) % 4 === 2) continue;
        stock.push([x + (index - 3) * 0.39, y + 0.023, backZ + 0.245 + (index % 2) * 0.066,
          0.092 + (index % 2) * 0.014, 0.14 + (index % 3) * 0.055, 0.060 + (index % 3) * 0.018]);
      }
    }
  }
  addInstancedBoxes(group, boxes, frame, jambs, 'dark far storefront jambs');
  addInstancedBoxes(group, boxes, brass, shelves, 'far storefront layered shelves');
  addInstancedBoxes(group, boxes, glow, shelfLights, 'far storefront shelf fixtures');
  addBottles(group, fixtures, stock);
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
  const cylinders = new CylinderGeometry(1, 1, 1, 10);
  const hook = new TorusGeometry(0.041, 0.005, 5, 8, Math.PI * 1.55);

  const wood = makeStandard('honey oak display timber', WOOD_HONEY, 0.66);
  const woodLight = makeStandard('light honey oak slat timber', WOOD_LIGHT, 0.63);
  const blackBronze = makeStandard('black bronze storefront metal', BLACK_BRONZE, 0.34, 0.62);
  const darkBronze = makeStandard('dark bronze boutique interior', DARK_BRONZE, 0.39, 0.46);
  const champagne = makeStandard('brushed champagne display hardware', CHAMPAGNE, 0.28, 0.52);
  const creamStone = makeStandard('light cream display stone', CREAM_STONE, 0.58);
  const fillerStone = makeStandard('warm honed stone filler pilaster', 0xb28c6d, 0.72);
  const fillerStoneLight = makeStandard('light warm stone filler reveal', 0xd0b18f, 0.66);
  const fillerMetal = makeStandard('filler bay bronze trim', 0x6d513d, 0.42, 0.42);
  const paleFrame = makeStandard('pale limestone storefront piers', 0xe0ceb7, 0.72);
  const glass = createGlassMaterial('clear shopfront glazing', 0.034);
  const caseGlass = createGlassMaterial('thin clear presentation glass', 0.072);
  const glows: Glow[] = [];
  const lights: RetailLight[] = [];
  const warmLine = makeGlow('continuous warm retail cove', 0xffdfbd, 0.98, 0.07, glows);
  const honeyWash = makeGlow('honey oak wall concealed cove', 0xffdcad, 1.32, 0.05, glows);
  const bronzeWash = makeGlow('bronze boutique concealed shelf light', 0xffcb9b, 1.26, 0.05, glows);
  const perfumeWash = makeGlow('champagne shelf and tray diffuser', 0xffe4bf, 1.21, 0.07, glows);
  const crystalWash = makeGlow('warm white crystal catches', 0xfff1dc, 1.58, 0.08, glows);
  const amberWash = makeGlow('far warm shelf and tray diffuser', 0xffd5a2, 1.27, 0.06, glows);
  const bronzeBackdrop = makeGlow('deep brown boutique walls', 0x685446, 0.19, 0.08, glows);
  const bronzePanel = makeGlow('warm boutique niche lining', 0xb79776, 0.38, 0.11, glows);
  const honeyBackdrop = makeGlow('pale oak interior lining', 0xc1a480, 0.30, 0.10, glows);
  const perfumeBackdrop = makeGlow('perfume wall around the recesses', 0xb19c81, 0.23, 0.11, glows);
  const perfumePanel = makeGlow('satin ivory perfume shelf lining', 0xe0cfb3, 0.47, 0.14, glows);
  const warmBackdrop = makeGlow('warm secondary display wall', 0x9c8069, 0.26, 0.11, glows);
  const warmPanel = makeGlow('lit cream secondary display niche', 0xd1b397, 0.45, 0.15, glows);
  const fillerBackdrop = makeGlow('warm stone filler inset wash', 0xdcb083, 0.32, 0.20, glows);
  for (const lining of [bronzeBackdrop, bronzePanel, honeyBackdrop, perfumeBackdrop, perfumePanel, warmBackdrop, warmPanel]) {
    lining.roughness = 0.70;
    lining.metalness = 0;
  }
  const directory = makeDirectoryScreen(glows);
  const fashion = { boxes, cylinders, hook, garments: makeGarments() };
  const counters = {
    boxes, cylinders, glass: caseGlass, brass: champagne, stone: creamStone,
    bottle: makeGlow('coloured glass display bottles', 0xffffff, 0.06, 0.01, glows),
  };

  const leftFar = createBay(group, -1, -3.9, 5.80, 3.12, blackBronze, bronzeBackdrop, warmLine, glass, boxes, 'left black bronze boutique');
  addBronzeBoutique(leftFar, fashion, darkBronze, woodLight, bronzePanel, bronzeWash);

  const leftNear = createBay(group, -1, -10.10, 5.45, 3.38, paleFrame, honeyBackdrop, warmLine, glass, boxes, 'left near honey continuation');
  addHoneyFashion(leftNear, fashion, wood, woodLight, darkBronze, honeyWash);

  const leftHoney = createBay(group, -1, -17.50, 9.00, 3.62, paleFrame, honeyBackdrop, warmLine, glass, boxes, 'left honey oak fashion');
  addHoneyFashion(leftHoney, fashion, wood, woodLight, darkBronze, honeyWash);

  const leftBoutique = createBay(group, -1, -26.30, 6.55, 3.48, blackBronze, bronzeBackdrop, warmLine, glass, boxes, 'left dark frame boutique');
  addBronzeBoutique(leftBoutique, fashion, darkBronze, woodLight, bronzePanel, bronzeWash);

  const leftFarBack = createBay(group, -1, -40.80, 5.65, 3.22, darkBronze, warmBackdrop, warmLine, glass, boxes, 'left far bronze unit');
  addWarmSecondary(leftFarBack, counters, warmPanel, amberWash, 'far');

  const rightFar = createBay(group, 1, -3.85, 5.70, 3.08, darkBronze, warmBackdrop, warmLine, glass, boxes, 'right warm perspective unit');
  addWarmSecondary(rightFar, counters, warmPanel, amberWash, 'far');

  const rightNear = createBay(group, 1, -10.10, 5.45, 3.38, paleFrame, perfumeBackdrop, warmLine, glass, boxes, 'right near crystal continuation');
  addPerfumeCounter(rightNear, counters, perfumePanel, perfumeWash, crystalWash);

  const rightPerfume = createBay(group, 1, -22.0, 10.00, 3.68, paleFrame, perfumeBackdrop, warmLine, glass, boxes, 'right crystal perfume counter');
  addPerfumeCounter(rightPerfume, counters, perfumePanel, perfumeWash, crystalWash);

  const rightBack = createBay(group, 1, -31.20, 7.35, 3.42, champagne, warmBackdrop, warmLine, glass, boxes, 'right warm glass unit');
  addWarmSecondary(rightBack, counters, warmPanel, amberWash, 'back');

  const rightFarBack = createBay(group, 1, -43.20, 6.30, 3.24, blackBronze, bronzeBackdrop, warmLine, glass, boxes, 'right far layered unit');
  addWarmSecondary(rightFarBack, counters, bronzePanel, amberWash, 'far');

  const allBays = [leftFar, leftNear, leftHoney, leftBoutique, leftFarBack, rightFar, rightNear, rightPerfume, rightBack, rightFarBack];
  addGapFillers(group, allBays, boxes, fillerStone, fillerStoneLight, fillerMetal, fillerBackdrop, amberWash);
  addDirectoryPanel(group, leftHoney, leftBoutique, boxes, blackBronze, directory);
  addDirectoryPanel(group, rightPerfume, rightBack, boxes, blackBronze, directory);
  addRearWallShowcase(group, counters, blackBronze, warmPanel, amberWash);
  addRearBridgeDisplays(group, counters, glass, blackBronze, bronzePanel, amberWash);

  // Local fixtures light the end displays that face the concourse sightline.
  for (const [bay, color, intensity, offset] of [
    [leftHoney, 0xffdfb3, 4.3, 0.29],
    [rightPerfume, 0xffecce, 5.6, 0.37],
  ] as const) {
    const light = new PointLight(color, intensity, 4.7, 2);
    light.name = `${bay.group.name} spot bounce`;
    light.position.set(bay.frontX + bay.side * 1.29, 2.46, bay.centerZ - bay.span * offset);
    light.userData.atriumRetailLight = true;
    bay.group.add(light);
    lights.push({ light, onIntensity: intensity, offIntensity: 0.07 });
  }

  function setLighting(next: boolean): void {
    glows.forEach(({ material, onIntensity, offIntensity }) => {
      material.emissiveIntensity = next ? onIntensity : offIntensity;
      material.needsUpdate = true;
    });
    lights.forEach(({ light, onIntensity, offIntensity }) => {
      light.intensity = next ? onIntensity : offIntensity;
    });
  }

  setLighting(true);

  return { setLighting };
}
