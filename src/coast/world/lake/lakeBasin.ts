import { Color, MathUtils, Mesh, Vector3, type Group, type MeshStandardMaterial } from 'three';
import { coastRandom } from '../../terrain';
import { PlantSurface } from '../coastTreeMeshes';
import { addLakeBankVegetation, addLakeGroundCover, type LakePlant, type LakeGroundPatch, type LakeGroundHeight } from './lakeVegetation';
import { addRockMass, buildLakeStoneRing, lakeStoneMaterials, type RockMass } from './lakeBasinStone';
import { addLakeFarArchitecture } from './lakeFarArchitecture';
import { buildFarShoreSurface, farShoreMaterial } from './lakeFarShore';
import { LAKE_WATER_Y } from './lakeLayout';
import { LakeBankSupport } from './lakeBankSupport';

type BankSide = -1 | 1;
type BankPoint = readonly [distance: number, edge: number];
type BankSpur = readonly [
  x: number, distance: number, across: number, along: number, rise: number, drift: number, toWater?: boolean,
];

// The mouths of both coves lie outside the shallow water used by the fish.
const westEdge: readonly BankPoint[] = [
  [-40, 53], [-13, 47], [6, 42], [19, 40], [31, 33], [43, 28], [55, 29], [65, 28], [86, 36], [114, 43],
  [153, 52], [185, 52], [221, 41], [257, 54], [330, 101], [382, 147],
];
const eastEdge: readonly BankPoint[] = [
  [-40, 58], [-12, 51], [7, 45], [18, 43], [28, 35], [38, 30], [44, 32], [53, 26], [63, 28], [78, 41], [100, 61],
  [150, 103], [187, 149], [240, 183], [280, 199], [335, 214], [382, 188],
];

// The spurs grow into the same ground as the cliffs and descend between shallow gullies.
// Centres and radii are measured in metres. Drift skews the ridge sideways along the bank.
const bankSpurs: Readonly<Record<BankSide, readonly BankSpur[]>> = {
  [-1]: [[59, 29, 20, 24, 6.8, -0.23], [75, 48, 33, 34, 11.4, 0.35],
    [100, 7, 52, 57, 16.6, 0.32], [96, 80, 42, 36, 10.2, -0.37], [31.8, 42, 5.4, 7.2, 1.35, 0.19, true]],
  [1]: [[60, 37, 24, 20, 4.2, 0.43], [89, 20, 41, 41, 7.9, 0.27],
    [115, 62, 55, 51, 10.8, -0.35], [148, 104, 52, 47, 11.3, 0.29]],
};

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

function bankHeight(side: BankSide, x: number, offset: number, distance: number): number {
  const toe = MathUtils.lerp(-2.05, 1.36, MathUtils.smoothstep(offset, -8, 6));
  const runout = 18 + 4.1 * Math.sin(distance * 0.079 + side) + 3.3 * Math.sin(distance * 0.142 - side);
  const shoulder = MathUtils.smoothstep(offset, 1.5, runout) * (2.7 + 0.76 * Math.cos(distance * 0.15 + side));
  const upland = 7.2 * MathUtils.smoothstep(offset, 10, 75)
    + 3.3 * MathUtils.smoothstep(offset, 24, 104) * MathUtils.smoothstep(distance, 72, 145);
  const lowerSlope = MathUtils.smoothstep(offset, 0.5, 14);
  let spurs = 0;
  for (const [centreX, centreDistance, across, along, rise, drift, toWater] of bankSpurs[side]) {
    const run = distance - centreDistance;
    const radius = Math.hypot((x - centreX - run * drift) / across, run / along);
    const exposure = toWater ? MathUtils.smoothstep(offset, -2, 3.5) : lowerSlope;
    spurs += rise * exposure * (1 - MathUtils.smoothstep(radius, 0.03, 1));
  }
  const strike = offset * 0.40 + distance * 0.29 + 0.88 * Math.sin(distance * 0.24 + offset * 0.12);
  const exposed = MathUtils.smoothstep(Math.sin(strike), 0.14, 0.84)
    * MathUtils.smoothstep(Math.cos(distance * 0.18 - offset * 0.23 + side), -0.35, 1);
  const stones = 0.34 * Math.sin(distance * 0.45 + offset * 0.32)
    + 0.27 * Math.sin(distance * 0.17 - offset * 0.74)
    + 0.11 * Math.cos(distance * 1.38 + offset * 1.49);
  return LAKE_WATER_Y + toe + shoulder + upland + spurs + lowerSlope * (0.73 * exposed + stones);
}

export function addLakeBank(surface: PlantSurface, side: BankSide): LakeBankSupport {
  const support = new LakeBankSupport();
  const point = new Vector3();
  const tint = new Color();
  const rock = new Color(0x7c8583);
  const turf = new Color(0x596b4c);
  const random = coastRandom(side < 0 ? 4932 : 8549);
  const offsets = [-10, -7.8, -5.4, -3.6, -2.35, -1.2, -0.15, 0.94, 2.05, 3.4, 4.8, 6.5, 8.4, 10.5,
    13, 16, 19, 22, 26, 31, 37, 44, 53, 63, 75, 91, 112, 142, 181, 234];
  let previous: number[] | undefined;
  // The near end runs behind the glazing so the oblique views meet the shoreline along its length.
  for (let distance = -36; distance < 392; distance += distance < 101 ? 0.95 : 3.6) {
    const edge = bankEdge(side, distance);
    const row = offsets.map(offset => {
      const perturbed = offset + (random() - 0.5) * 0.30;
      const x = edge + perturbed;
      const y = bankHeight(side, x, perturbed, distance);
      const patch = Math.sin(distance * 0.41 + offset * 0.47) * Math.sin(distance * 0.18 - offset * 0.39);
      const moss = MathUtils.smoothstep(y, LAKE_WATER_Y + 0.18, LAKE_WATER_Y + 0.81)
        * MathUtils.smoothstep(patch + random() * 0.35, 0.24, 1.08);
      tint.copy(rock).lerp(turf, moss);
      const index = surface.point(point.set(side * x, y, -distance), tint, 0.86 + random() * 0.24);
      support.addVertex(index, point.x, point.y, point.z);
      return index;
    });
    if (previous) stitchRows(surface, support, previous, row, side > 0);
    previous = row;
  }
  return support;
}

function stitchRows(surface: PlantSurface, support: LakeBankSupport, first: number[], next: number[], forward: boolean): void {
  for (let index = 0; index < first.length - 1; index += 1) {
    const here = first[index];
    const right = first[index + 1];
    const ahead = next[index];
    const corner = next[index + 1];
    const triangles = [[here, forward ? right : ahead, forward ? ahead : right],
      [right, forward ? corner : ahead, forward ? ahead : corner]];
    for (const [a, b, c] of triangles) {
      surface.triangle(a, b, c);
      support.addTriangle(a, b, c);
    }
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
  { x: -45.5, z: -177, bottom: -1.9, radiusX: 7.7, radiusZ: 13, height: 2.7, yaw: -0.67, seed: 133, color: 0x6d7979, detail: 0.70 },
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

const bankTrees: readonly (Omit<LakePlant, 'y'> & { y?: number })[] = [
  // The broad crown grows from the existing, nearly horizontal rock cap.
  { x: -33, y: 16.52, z: -52.75, height: 4.5, spread: 5.2, yaw: 0.51, seed: 90, form: 'broadleaf' },
  { x: -34.2, y: 7.9, z: -44.1, height: 5.4, spread: 4.98, yaw: 0.31, seed: 23, form: 'pine' },
  { x: -51.8, y: 16.8, z: -76.4, height: 5.1, spread: 5.26, yaw: 0.55, seed: 67, form: 'pine' },
  { x: -37, z: -30, height: 5.9, spread: 5.4, yaw: 0.98, seed: 73, form: 'broadleaf' },
  { x: 36.7, z: -40, height: 8.4, spread: 5.7, yaw: 1.91, seed: 11, form: 'pine', windYaw: 2.84 },
  { x: 36, z: -38.8, height: 2.5, spread: 2.5, yaw: -2.80, seed: 41, form: 'broadleaf', windYaw: 2.65 },
  { x: 52, z: -67, height: 8.4, spread: 7.45, yaw: -0.61, seed: 42, form: 'pine' },
  { x: 250, y: 50, z: -322, height: 10.8, spread: 9.4, yaw: 3.86, seed: 9, form: 'pine' },
  { x: -58.6, y: 8.2, z: -180.8, height: 10.4, spread: 11.8, yaw: -0.88, seed: 14, form: 'broadleaf' },
  { x: -62.7, y: 4.1, z: -215.8, height: 9.3, spread: 8.2, yaw: 1.09, seed: 16, form: 'pine' },
];

function insideCliffFootprint(x: number, z: number): boolean {
  return basinCliffs.some(mass => {
    if (mass.height < 6) return false;
    const across = x - mass.x;
    const along = z - mass.z;
    const cos = Math.cos(mass.yaw);
    const sin = Math.sin(mass.yaw);
    const localX = across * cos + along * sin;
    const localZ = along * cos - across * sin;
    // Allow for the spread of the base and the crown of a sapling planted next to it.
    return Math.hypot(localX / mass.radiusX, localZ / mass.radiusZ) < 1.22;
  });
}

function addShoreDetails(ledges: Readonly<Record<BankSide, PlantSurface>>, supportAt: LakeGroundHeight): LakePlant[] {
  const random = coastRandom(81557);
  const trees: LakePlant[] = [];
  for (const tree of bankTrees) {
    const y = tree.y ?? supportAt(tree.x, tree.z);
    if (y !== undefined) trees.push({ ...tree, y: tree.y ?? y - 0.04 });
  }
  for (const side of [-1, 1] as const) {
    for (let piece = 0; piece < 94; piece += 1) {
      const sample = random();
      const distance = piece < 17 ? 7 + sample * 31 : 34 + sample ** 1.67 * (side < 0 ? 209 : 135);
      const offset = 0.9 + random() * 25;
      const x = bankEdge(side, distance) + offset;
      const nearby = distance < 99;
      const radius = (nearby ? 0.48 : 1.08) + random() ** 1.8 * (nearby ? 4.5 : 5.7);
      const bottom = bankHeight(side, x, offset, distance) - radius * 0.28 - 0.53;
      addRockMass(ledges[side], {
        x: side * x, z: -distance, bottom, radiusX: radius,
        radiusZ: radius * (0.75 + random() * 0.72), height: radius * (0.19 + random() * 0.44),
        yaw: side * 0.52 + (random() - 0.5) * 1.89, taper: 0.32, lean: 0.14, seed: random() * 100,
        color: [0x677273, 0x727e84, 0x6e746b, 0x66705b][Math.floor(random() * 4)], detail: nearby ? 0.64 : 0.38,
      });
    }
    for (let grove = 0; grove < (side < 0 ? 27 : 12); grove += 1) {
      const sample = random();
      const distance = grove < 4 ? 10 + sample * 28 : side < 0 ? 41 + sample ** 1.4 * 169 : 55 + sample ** 1.8 * 51;
      const offset = 3 + random() * 24;
      const x = bankEdge(side, distance) + offset;
      const height = 2.2 + random() ** 1.45 * (side < 0 ? 6.2 : 4.6);
      const spread = height * (0.69 + random() * 0.47);
      const yaw = random() * 6.28;
      if (insideCliffFootprint(side * x, -distance)) continue;
      const y = supportAt(side * x, -distance);
      if (y === undefined) continue;
      trees.push({ x: side * x, y: y - 0.04,
        z: -distance, height, spread, yaw, seed: 450 + grove * 11 + side,
        form: grove % 4 === 0 ? 'pine' : height < 3.7 ? 'sapling' : 'broadleaf' });
    }
    for (let scrub = 0; scrub < 19; scrub += 1) {
      const distance = 13 + random() * 72;
      const offset = 5.5 + random() * 7.1;
      const x = bankEdge(side, distance) + offset;
      const height = 0.36 + random() * 0.92;
      const yaw = random() * 6.28;
      if (insideCliffFootprint(side * x, -distance)) continue;
      const y = supportAt(side * x, -distance);
      if (y === undefined) continue;
      trees.push({ x: side * x, y: y - 0.04,
        z: -distance, height, spread: height * 1.52, yaw, seed: 823 + scrub * 19 + side, form: 'shrub' });
    }
  }
  return trees;
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
  const banks = { [-1]: new PlantSurface(), [1]: new PlantSurface() };
  const support = { [-1]: addLakeBank(banks[-1], -1), [1]: addLakeBank(banks[1], 1) };
  const supportAt: LakeGroundHeight = (x, z) => support[x < 0 ? -1 : 1].heightAt(x, z);
  const trees = addShoreDetails(ledges, supportAt);
  const stone = lakeStoneMaterials();
  // The slopes, dense cliff faces and distant peaks cull independently on each side of the lake.
  for (const side of [-1, 1] as const) {
    const direction = side === -1 ? 'West' : 'East';
    addMesh(root, banks[side], stone.bedrock, `${direction} bank mossy slopes`);
    addMesh(root, ledges[side], stone.bedrock, `${direction} bank fractured cliffs and ledges`);
    addMesh(root, distantPeaks[side], stone.bedrock, `${direction} distant cirque summits`);
  }
  buildLakeStoneRing(root, stone.ring);
  addMesh(root, buildFarShoreSurface(), farShoreMaterial('gravel'), 'Pale alluvial terraces on the far shore');
  const architecture = new PlantSurface();
  addLakeFarArchitecture(architecture);
  addMesh(root, architecture, farShoreMaterial('masonry'), 'Far shore walls, roof ledges and terraces');
  const ground = new PlantSurface();
  const patches: LakeGroundPatch[] = [];
  const random = coastRandom(31949);
  for (const side of [-1, 1] as const) {
    for (let island = 0; island < 186; island += 1) {
      const distance = -3 + random() ** 1.28 * 128;
      const offset = 0.9 + random() ** 1.4 * 27;
      const x = side * (bankEdge(side, distance) + offset);
      if (insideCliffFootprint(x, -distance)) continue;
      patches.push({ x, z: -distance, radius: 0.45 + random() * 1.65, seed: 497 + island * 13 + side });
    }
  }
  addLakeGroundCover(ground, patches, (x, z) => {
    const side = x < 0 ? -1 : 1;
    const distance = -z;
    const offset = Math.abs(x) - bankEdge(side, distance);
    if (offset < 0.4 || insideCliffFootprint(x, z)) return undefined;
    const y = supportAt(x, z);
    return y !== undefined && y > LAKE_WATER_Y + 0.18 ? y : undefined;
  });
  await addLakeBankVegetation(root, trees, ground);
}
