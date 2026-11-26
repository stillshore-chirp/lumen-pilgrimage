import { Color, MathUtils, Mesh, MeshStandardMaterial, Vector3, type Group } from 'three';
import { coastRandom } from '../../terrain';
import { PlantSurface } from '../coastTreeMeshes';
import { addLakeBankPines, type LakePine } from './lakeBasinPines';
import { addRockMass, buildLakeStoneRing, lakeStoneMaterials, type RockMass } from './lakeBasinStone';
import { LAKE_TERRAIN, LAKE_WATER_Y } from './lakeLayout';

type BankSide = -1 | 1;
type BankPoint = readonly [distance: number, edge: number];

// The mouths of both coves lie outside the shallow water used by the fish.
const westEdge: readonly BankPoint[] = [
  [25, 38], [35, 29], [49, 28], [65, 28], [86, 36], [114, 43],
  [153, 52], [185, 52], [221, 41], [257, 54], [330, 101], [382, 147],
];
const eastEdge: readonly BankPoint[] = [
  [25, 34], [35, 29], [40, 30], [50, 26], [63, 28], [78, 41], [100, 61],
  [150, 103], [187, 149], [240, 183], [280, 199], [335, 214], [382, 188],
];

function bankEdge(side: BankSide, distance: number): number {
  const curve = side === -1 ? westEdge : eastEdge;
  for (let i = 1; i < curve.length; i += 1) {
    const [end, edge] = curve[i];
    if (distance > end) continue;
    const [start, previous] = curve[i - 1];
    const t = MathUtils.smoothstep(distance, start, end);
    return MathUtils.lerp(previous, edge, t) + Math.sin(distance * 0.53) * 0.72
      + Math.sin(distance * 0.19 + side) * 0.88 + Math.sin(distance * 1.13) * 0.34;
  }
  return curve[curve.length - 1][1];
}

function bankHeight(side: BankSide, offset: number, distance: number): number {
  const folded = offset + 1.65 * Math.sin(distance * 0.19 + side * 2) + 0.8 * Math.sin(distance * 0.53 + offset * 0.29);
  const bedding = MathUtils.smoothstep(folded, -3.8, 1.8) * 1.67
    + MathUtils.smoothstep(folded, 3.1, 5.0) * 1.22
    + MathUtils.smoothstep(folded, 9.4, 11.3) * 1.1
    + MathUtils.smoothstep(folded, 15.1, 17.4) * 1.4;
  const debris = MathUtils.smoothstep(folded, -2.5, 18) * 5.39;
  const brokenBedding = 0.30 + 0.36 * Math.sin(distance * 0.29 - offset * 0.086) ** 2;
  const exposed = MathUtils.lerp(bedding, debris, brokenBedding);
  const inland = MathUtils.smoothstep(offset, 6, 40) * (side === -1 ? 5.1 : 3.5)
    + 5.5 * MathUtils.smoothstep(offset, 22, 91) * MathUtils.smoothstep(distance, 43, 111);
  const stones = Math.sin(distance * 0.47 + offset * 0.32) * 0.28
    + Math.sin(distance * 0.17 - offset * 0.91) * 0.34
    + Math.cos(distance * 1.38 + offset * 1.49) * 0.16;
  const nearTaper = MathUtils.smoothstep(distance, 22, 36);
  return LAKE_WATER_Y - 1.76 + nearTaper * (exposed + inland + stones * MathUtils.smoothstep(offset, -4, 5));
}

function addBank(surface: PlantSurface, side: BankSide): void {
  const point = new Vector3();
  const tint = new Color();
  const rock = new Color(0x666c6c);
  const turf = new Color(0x58613d);
  const random = coastRandom(side < 0 ? 4932 : 8549);
  const offsets = [-8, -5, -2.8, -1.8, -0.7, 0.6, 1.8, 2.8, 3.9, 5, 6.4, 8, 9.8, 11.6,
    13.5, 15, 17, 19.3, 23.6, 28, 33.5, 42, 66, 112, 175, 234];
  let previous: number[] | undefined;
  for (let distance = 22; distance < 392; distance += distance < 101 ? 0.86 : 3.6) {
    const edge = bankEdge(side, distance);
    const row = offsets.map(offset => {
      const jitter = (random() - 0.5) * 0.49;
      const y = bankHeight(side, offset + jitter, distance);
      const patch = Math.sin(distance * 0.67 + offset * 0.69) * Math.sin(distance * 0.23 - offset * 0.51);
      const moss = MathUtils.smoothstep(y, LAKE_WATER_Y + 0.18, LAKE_WATER_Y + 0.81)
        * MathUtils.smoothstep(patch + random() * 0.55, 0.03, 0.88);
      tint.copy(rock).lerp(turf, moss);
      return surface.point(point.set(side * (edge + offset + jitter), y, -distance), tint, 0.83 + random() * 0.30);
    });
    if (previous) stitchRows(surface, previous, row, side > 0);
    previous = row;
  }
}

function stitchRows(surface: PlantSurface, first: number[], next: number[], forward: boolean): void {
  for (let index = 0; index < first.length - 1; index += 1) {
    const here = first[index];
    const right = first[index + 1];
    const ahead = next[index];
    const corner = next[index + 1];
    surface.triangle(here, forward ? right : ahead, forward ? ahead : right);
    surface.triangle(right, forward ? corner : ahead, forward ? ahead : corner);
  }
}

const basinCliffs: readonly RockMass[] = [
  // Western wall and the two buttresses which frame its descending shelf.
  { x: -54, z: -44, radiusX: 18, radiusZ: 17, height: 97, yaw: 0.43, seed: 11, color: 0x929ba0, detail: 1.50 },
  { x: -49, z: -53, radiusX: 12.4, radiusZ: 12, height: 57, yaw: 0.21, seed: 27, color: 0xa19e90, detail: 1.36, taper: 0.17 },
  { x: -64, z: -70, radiusX: 20, radiusZ: 19, height: 114, yaw: -0.28, seed: 30, color: 0x86959f, detail: 1.14 },
  { x: -80, z: -84, radiusX: 24, radiusZ: 23, height: 144, yaw: -0.27, seed: 38, color: 0x798a94 },
  { x: -34.7, z: -51.2, radiusX: 8.25, radiusZ: 9.7, height: 19.8, yaw: 0.46, seed: 7.4, color: 0xa2a096, detail: 1.45, taper: 0.22 },
  { x: -40, z: -61, radiusX: 10.5, radiusZ: 10.8, height: 24, yaw: 0.27, seed: 51, color: 0x969b95, detail: 1.12 },
  { x: -36, z: -44.3, radiusX: 8.6, radiusZ: 7.9, height: 11.4, yaw: -0.57, seed: 53, color: 0x828e91, taper: 0.21 },
  { x: -53, z: -78, radiusX: 12.8, radiusZ: 14, height: 20, yaw: 0.37, seed: 68, color: 0x888d83, taper: 0.22 },
  { x: -77, z: -119, radiusX: 20, radiusZ: 22, height: 65, yaw: 0.30, seed: 81, color: 0x6e8390 },
  { x: -101, z: -115, radiusX: 24, radiusZ: 24, height: 109, yaw: 0.41, seed: 43, color: 0x7b929f },
  { x: -77, z: -145, radiusX: 15, radiusZ: 17, height: 21, yaw: -0.22, seed: 36, color: 0x687c7e },
  { x: -58, z: -184, radiusX: 14, radiusZ: 21, height: 11.1, yaw: 0.23, seed: 2, color: 0x697c74, taper: 0.34 },
  { x: -54.3, z: -215, radiusX: 15, radiusZ: 21, height: 7.1, yaw: -0.13, seed: 87, color: 0x687b77, taper: 0.41 },
  // Remnant slabs vary in thickness and terminate on separate, inclined breaks.
  { x: -39.5, z: -46.8, radiusX: 3.4, radiusZ: 3.8, height: 39, yaw: -0.39, seed: 39, color: 0xada997, taper: 0.29, lean: -0.18 },
  { x: -43.1, z: -42.5, radiusX: 2.75, radiusZ: 4.2, height: 32, yaw: 0.1, seed: 21, color: 0x82959c, taper: 0.43 },
  { x: -44.9, z: -44.5, radiusX: 2.55, radiusZ: 4.7, height: 47, yaw: 0.29, seed: 68, color: 0x9ea296, lean: 0.28 },
  { x: -43.8, z: -56.5, radiusX: 3.5, radiusZ: 4.9, height: 51, yaw: -0.37, seed: 16, color: 0x92a2a9, taper: 0.21 },
  { x: -35.6, z: -44.4, radiusX: 2.45, radiusZ: 4.15, height: 12.6, yaw: 0.51, seed: 79, color: 0x8a918b, taper: 0.41 },
  { x: -32.8, z: -48.5, radiusX: 1.85, radiusZ: 5.1, height: 17.7, yaw: -0.15, seed: 41, color: 0xb0afa2, taper: 0.16 },
  { x: -30.4, z: -53.0, radiusX: 1.7, radiusZ: 4.5, height: 13.0, yaw: 0.21, seed: 38, color: 0x8c958f, taper: 0.19, lean: 0.32 },
  { x: -30.9, z: -54.7, radiusX: 2.7, radiusZ: 3.9, height: 17.2, yaw: 0.38, seed: 52, color: 0x8c9a9b, taper: 0.30 },
  { x: -33.8, z: -42.9, radiusX: 2.8, radiusZ: 4.1, height: 6.5, yaw: 0.35, seed: 28, color: 0x7c9089, taper: 0.31 },
  // Low sheets extend down to the matching banks under the foremost pines.
  { x: -29.3, z: -42.9, bottom: -1.8, radiusX: 6, radiusZ: 8.4, height: 2.7, yaw: -0.51, seed: 128, color: 0x758083, detail: 0.73 },
  { x: -30.2, z: -50.7, bottom: -1.5, radiusX: 7.2, radiusZ: 7.5, height: 2.15, yaw: 0.13, seed: 132, color: 0x727b7e, detail: 0.72 },
  { x: -45.5, z: -177, bottom: -1.9, radiusX: 7.7, radiusZ: 13, height: 2.7, yaw: -0.67, seed: 133, color: 0x6d7979, detail: 0.70 },
  { x: 29.3, z: -51.9, bottom: -1.8, radiusX: 5.1, radiusZ: 13.2, height: 2.4, yaw: 0.63, seed: 231, color: 0x657986, detail: 0.8 },
  { x: 35.4, z: -45.8, bottom: -1.9, radiusX: 7.5, radiusZ: 11.3, height: 3.6, yaw: 0.56, seed: 357, color: 0x758588, detail: 0.89 },
  { x: 44.1, z: -56.0, bottom: -0.6, radiusX: 8.2, radiusZ: 10.6, height: 4.0, yaw: 0.58, seed: 92, color: 0x657a82, detail: 0.87 },
  // A coherent summit on the west, with smaller spires descending the same ridge.
  { x: -118, z: -333, radiusX: 17.4, radiusZ: 19.5, height: 129, yaw: 0.23, seed: 84, color: 0x687e92, taper: 0.23, lean: 0.04, detail: 1.13 },
  { x: -117, z: -316, radiusX: 4.8, radiusZ: 6.5, height: 116, yaw: 0.58, seed: 71, color: 0x71889b, taper: 0.36, detail: 0.73 },
  { x: -109, z: -325, radiusX: 8.5, radiusZ: 12, height: 104, yaw: -0.31, seed: 48, color: 0x77909f, taper: 0.36 },
  { x: -127.5, z: -343, radiusX: 10.9, radiusZ: 16, height: 124, yaw: -0.25, seed: 27, color: 0x6a8293, taper: 0.38 },
  { x: -146, z: -344, radiusX: 15, radiusZ: 23, height: 103, yaw: 0.54, seed: 71, color: 0x6c869b, taper: 0.26 },
  { x: -101, z: -337, radiusX: 8.7, radiusZ: 19, height: 75, yaw: -0.16, seed: 44, color: 0x8497a2, taper: 0.43, detail: 0.68 },
  { x: -130, z: -316, radiusX: 30, radiusZ: 17, height: 35, yaw: 0.06, seed: 12, color: 0x8498a4 },
  { x: -167, z: -342, radiusX: 32, radiusZ: 24, height: 58, yaw: -0.41, seed: 5, color: 0x8599a7 },
  // The eastern peak starts behind the cape and falls into broad ridges in the valley.
  { x: 309, z: -345, radiusX: 43, radiusZ: 43, height: 205, yaw: -0.44, seed: 58, color: 0x6d8294, taper: 0.29, lean: 0.07 },
  { x: 335, z: -362, radiusX: 36, radiusZ: 47, height: 224, yaw: -0.41, seed: 75, color: 0x6e7f90, taper: 0.42 },
  { x: 278, z: -337, radiusX: 21, radiusZ: 28, height: 132, yaw: 0.28, seed: 13, color: 0x71899a },
  { x: 254, z: -350, radiusX: 19.9, radiusZ: 24, height: 123, yaw: -0.16, seed: 73, color: 0x7893a5, taper: 0.35 },
  { x: 228, z: -361, radiusX: 20, radiusZ: 25, height: 61, yaw: 0.56, seed: 13, color: 0x8099aa },
  { x: 250, z: -317, radiusX: 29, radiusZ: 27, height: 57, yaw: -0.28, seed: 21, color: 0x7d96a4 },
  { x: 381, z: -416, radiusX: 61, radiusZ: 61, height: 168, yaw: -0.20, seed: 193, color: 0x8296a9, taper: 0.45, detail: 0.86 },
  { x: 454, z: -458, radiusX: 82, radiusZ: 72, height: 113, yaw: 0.81, seed: 259, color: 0x8a9bab, taper: 0.54, detail: 0.77 },
  { x: 123, z: -88, radiusX: 33, radiusZ: 24, height: 24, yaw: 0.42, seed: 153, color: 0x717d7d, taper: 0.49, detail: 0.82 },
  { x: 147, z: -131, radiusX: 39, radiusZ: 40, height: 45, yaw: 0.39, seed: 172, color: 0x77848a, taper: 0.43, detail: 0.80 },
  { x: -237, z: -510, radiusX: 59, radiusZ: 58, height: 91, yaw: 0.59, seed: 29, color: 0x92a6b4, taper: 0.58, detail: 0.57 },
  { x: 183, z: -556, radiusX: 72, radiusZ: 55, height: 45, yaw: 0.88, seed: 193, color: 0xa5b6c0, taper: 0.58, detail: 0.62 },
];

const pines: readonly LakePine[] = [
  { x: -33.2, y: 15.6, z: -50.8, height: 7.1, spread: 7.1, yaw: 0.51, seed: 90, form: 'broad' },
  { x: -34.2, y: 7.9, z: -44.1, height: 5.4, spread: 4.98, yaw: 0.31, seed: 23 },
  { x: -51.8, y: 16.8, z: -76.4, height: 5.1, spread: 5.26, yaw: 0.55, seed: 67 },
  { x: -28.7, y: 0.1, z: -41.8, height: 5.9, spread: 5.4, yaw: 0.98, seed: 73 },
  { x: 46.9, y: 4.0, z: -54, height: 9.1, spread: 7.5, yaw: 1.91, seed: 11, form: 'broad', windYaw: 2.84 },
  { x: 41.5, y: 2.7, z: -52.5, height: 6.1, spread: 5.5, yaw: -2.80, seed: 41, windYaw: 2.65 },
  { x: 52, y: 5.1, z: -67, height: 8.4, spread: 7.45, yaw: -0.61, seed: 42 },
  { x: 250, y: 50, z: -322, height: 10.8, spread: 9.4, yaw: 3.86, seed: 9 },
  { x: -58.6, y: 8.2, z: -180.8, height: 10.4, spread: 11.8, yaw: -0.88, seed: 14 },
  { x: -62.7, y: 4.1, z: -215.8, height: 9.3, spread: 8.2, yaw: 1.09, seed: 16 },
];

function addShoreDetails(ledges: Readonly<Record<BankSide, PlantSurface>>): LakePine[] {
  const random = coastRandom(81557);
  const trees = [...pines];
  for (const side of [-1, 1] as const) {
    for (let piece = 0; piece < 94; piece += 1) {
      const distance = 34 + random() ** 1.67 * (side < 0 ? 209 : 135);
      const offset = 0.9 + random() * 25;
      const nearby = distance < 99;
      const radius = (nearby ? 0.48 : 1.08) + random() ** 1.8 * (nearby ? 4.5 : 5.7);
      const bottom = bankHeight(side, offset, distance) - radius * 0.28 - 0.53;
      addRockMass(ledges[side], {
        x: side * (bankEdge(side, distance) + offset), z: -distance, bottom, radiusX: radius,
        radiusZ: radius * (0.75 + random() * 0.72), height: radius * (0.19 + random() * 0.44),
        yaw: side * 0.52 + (random() - 0.5) * 1.89, taper: 0.32, lean: 0.14, seed: random() * 100,
        color: [0x677273, 0x727e84, 0x6e746b, 0x66705b][Math.floor(random() * 4)], detail: nearby ? 0.64 : 0.38,
      });
    }
    for (let grove = 0; grove < (side < 0 ? 27 : 12); grove += 1) {
      const distance = side < 0 ? 41 + random() ** 1.4 * 169 : 55 + random() ** 1.8 * 51;
      const offset = 3 + random() * 24;
      const height = 2.2 + random() ** 1.45 * (side < 0 ? 6.2 : 4.6);
      trees.push({ x: side * (bankEdge(side, distance) + offset), y: bankHeight(side, offset, distance) - 0.06,
        z: -distance, height, spread: height * (0.69 + random() * 0.47), yaw: random() * 6.28, seed: 450 + grove * 11 + side });
    }
    for (let scrub = 0; scrub < 9; scrub += 1) {
      const distance = 37 + random() * 48;
      const offset = 5.5 + random() * 7.1;
      const height = 0.62 + random() * 1.4;
      trees.push({ x: side * (bankEdge(side, distance) + offset), y: bankHeight(side, offset, distance) - 0.09,
        z: -distance, height, spread: height * 1.31, yaw: random() * 6.28, seed: 823 + scrub * 19 + side });
    }
  }
  return trees;
}

function buildFarShore(root: Group, material: MeshStandardMaterial): void {
  const ground = new PlantSurface();
  const point = new Vector3();
  const tint = new Color();
  const dryGravel = new Color(0xffe9c7);
  const wetGravel = new Color(0xb7a68f);
  const shadedGravel = new Color(0xa5afb8);
  const upland = new Color(0x9fa8aa);
  let previous: number[] | undefined;
  const distances = [-27, -22, -18, -15, -12, -8, -3, 2, 7, 13, 21, 30, 43, 55, 75, 102, 140, 200, 305];
  for (const distance of distances) {
    const row: number[] = [];
    for (let x = -480; x <= 480; x += 4.8) {
      const inlet = 4.3 * Math.sin(x * 0.024 + 0.21) + 1.35 * Math.sin(x * 0.067 + 0.5);
      const bar = distance + 3.1 * Math.sin(x * 0.023 + 0.7) + 1.7 * Math.sin(x * 0.047);
      const relief = 0.38 + 0.62 * Math.sin(x * 0.013 + 0.71) ** 2;
      const wave = Math.sin(bar * 0.49 + 0.79 * Math.sin(x * 0.032));
      // The gravel apron enters the water ahead of the mist plane and rises into low bars.
      const apron = MathUtils.lerp(-2.1, 2.15, MathUtils.smoothstep(bar, -22, -10));
      const bars = MathUtils.smoothstep(bar, -7, 12) * (1.45 + 1.25 * relief + 0.49 * wave);
      const plain = MathUtils.smoothstep(bar, 8, 73) * (2.1 + 4.6 * relief);
      const y = LAKE_WATER_Y + apron + bars + plain;
      const dry = MathUtils.smoothstep(y, LAKE_WATER_Y, LAKE_WATER_Y + 0.48);
      const lee = MathUtils.smoothstep(bar, -4, 6) * MathUtils.smoothstep(wave, 0.05, 0.97);
      const exposedApron = dry * (1.0 - MathUtils.smoothstep(bar, -6, 10));
      tint.copy(wetGravel).lerp(dryGravel, dry).lerp(shadedGravel, lee * 0.43)
        .lerp(upland, MathUtils.smoothstep(bar, 6, 89) * (0.68 + 0.30 * relief));
      row.push(ground.point(point.set(x, y, LAKE_TERRAIN.shoreZ - distance + inlet), tint,
        0.95 + 0.27 * exposedApron - 0.09 * lee));
    }
    if (previous) stitchRows(ground, previous, row, true);
    previous = row;
  }
  addMesh(root, ground, material, 'Pale alluvial terraces on the far shore');
}

type ShoreBuilding = readonly [x: number, z: number, width: number, depth: number, height: number, form: 'tower' | 'hall'];

const distantBuildings: readonly ShoreBuilding[] = [
  [-133, -411, 16.7, 21, 55, 'tower'],
  [-117.2, -403, 16, 19, 67, 'tower'],
  [-92, -415, 16.7, 20, 56, 'tower'],
  [-66, -405, 32, 28, 13, 'hall'],
  [-53, -431, 29, 19, 16, 'hall'],
  [-27, -422, 27, 24, 10, 'hall'],
  [14, -448, 42, 33, 17, 'hall'],
  [62, -421, 31, 21, 13, 'hall'],
  [103, -410, 27, 16, 13, 'hall'],
  [132, -424, 35, 24, 16, 'hall'],
  [221, -407, 19, 22, 47, 'tower'],
  [242, -429, 35, 36, 22, 'hall'],
  [274, -445, 31, 24, 24, 'hall'],
];

function buildFarSettlement(root: Group, material: MeshStandardMaterial): void {
  const surface = new PlantSurface();
  const point = new Vector3();
  const random = coastRandom(27491);
  const masonry = new Color(0x8e9699);
  const glass = new Color(0x697e90);
  const cap = new Color(0xa3a49e);
  const frame = new Color(0xa0a8ab);
  type Vertex = readonly [x: number, y: number, z: number];
  const facet = (corners: readonly Vertex[], color: Color, shade = 1) => {
    const [a, b, c, d] = corners.map(corner => surface.point(point.set(...corner), color, shade));
    surface.triangle(a, b, c);
    surface.triangle(b, d, c);
  };
  const face = (x: number, z: number, width: number, y: number, height: number, color: Color, shade = 1) =>
    facet([[x, y, z], [x + width, y, z], [x, y + height, z], [x + width, y + height, z]], color, shade);
  const block = (x: number, z: number, width: number, depth: number, y: number, height: number, color: Color, shade: number) => {
    const east = x + width;
    const back = z - depth;
    const top = y + height;
    face(x, z, width, y, height, color, shade);
    facet([[east, y, z], [east, y, back], [east, top, z], [east, top, back]], color, shade * 0.83);
    facet([[x, y, back], [x, y, z], [x, top, back], [x, top, z]], color, shade * 0.77);
    facet([[east, y, back], [x, y, back], [east, top, back], [x, top, back]], color, shade * 0.73);
    facet([[x, top, z], [east, top, z], [x, top, back], [east, top, back]], color, shade * 1.12);
  };
  for (const [x, z, width, depth, height, form] of distantBuildings) {
    const tower = form === 'tower';
    const shade = 0.8 + random() * 0.29;
    const podium = tower ? 15.5 : 12.4;
    const top = height + (tower ? 1 : 7);
    block(x - 2.3, z + 2.7, width + 4.6, depth + 4.7, 2, podium - 2, masonry, shade);
    block(x, z, width, depth, podium - 1, top - podium + 1, masonry, shade);
    block(x - 0.18, z + 0.25, width + 0.36, depth + 0.45, top, tower ? 0.73 : 1.19, cap, shade);
    block(x + width * 0.14, z - depth * 0.3, width * 0.65, depth * 0.46, top + 0.5,
      tower ? 1.88 : 1.35, frame, shade * 0.93);
    const columns = Math.round(width / (tower ? 2.6 : 5.5));
    const bay = width / columns;
    for (let column = 0; column < columns; column += 1) {
      const jamb = x + bay * (column + 0.19);
      face(jamb, z + 0.016, bay * 0.57, podium + 0.8, top - podium - 1.5,
        glass, shade * (0.88 + random() * 0.25));
      if (!tower) continue;
      for (let level = podium + 2.6; level < top - 1.2; level += 3.45) {
        face(jamb, z + 0.025, bay * 0.57, level, 0.49, frame, shade * (0.72 + random() * 0.20));
      }
    }
    if (!tower) continue;
    block(x + width - 0.24, z + 0.18, 0.46, depth + 0.34, podium, top - podium, frame, shade * 1.10);
    for (let bay = 2.1; bay < depth - 0.9; bay += 2.78) {
      const near = z - bay;
      const far = near - 1.40;
      const east = x + width + 0.013;
      const west = x - 0.013;
      facet([[east, podium, near], [east, podium, far], [east, top - 1, near], [east, top - 1, far]], glass, shade * 0.91);
      facet([[west, podium, far], [west, podium, near], [west, top - 1, far], [west, top - 1, near]], glass, shade * 0.79);
    }
  }
  addMesh(root, surface, material, 'Distant valley buildings and inset facades');
}

function addMesh(root: Group, surface: PlantSurface, material: MeshStandardMaterial, name: string): void {
  const mesh = new Mesh(surface.geometry(), material);
  mesh.name = name;
  root.add(mesh);
}

export async function buildLakeBasin(root: Group): Promise<void> {
  root.name = 'Rock basin and stone ring';
  const ledges = { [-1]: new PlantSurface(), [1]: new PlantSurface() };
  const distantPeaks = { [-1]: new PlantSurface(), [1]: new PlantSurface() };
  for (const mass of basinCliffs) {
    const region = mass.z < -280 ? distantPeaks : ledges;
    addRockMass(region[mass.x < 0 ? -1 : 1], mass);
  }
  const trees = addShoreDetails(ledges);
  const stone = lakeStoneMaterials();
  // The slopes, dense cliff faces and distant peaks cull independently on each side of the lake.
  for (const side of [-1, 1] as const) {
    const direction = side === -1 ? 'West' : 'East';
    const slope = new PlantSurface();
    addBank(slope, side);
    addMesh(root, slope, stone.bedrock, `${direction} bank mossy slopes`);
    addMesh(root, ledges[side], stone.bedrock, `${direction} bank fractured cliffs and ledges`);
    addMesh(root, distantPeaks[side], stone.bedrock, `${direction} distant cirque summits`);
  }
  buildLakeStoneRing(root, stone.ring);
  const far = new MeshStandardMaterial({ vertexColors: true, roughness: 0.89 });
  const sand = new MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, emissive: 0x756e60, emissiveIntensity: 0.055,
  });
  buildFarShore(root, sand);
  buildFarSettlement(root, far);
  await addLakeBankPines(root, trees);
}
