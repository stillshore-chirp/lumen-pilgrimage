import { Color, MathUtils, Mesh, MeshStandardMaterial, Vector3, type Group } from 'three';
import { coastRandom } from '../../terrain';
import { PlantSurface } from '../coastTreeMeshes';
import { addLakeBankPines, type LakePine } from './lakeBasinPines';
import { addRockMass, buildLakeStoneRing, lakeStoneMaterial, type RockMass } from './lakeBasinStone';
import { LAKE_TERRAIN, LAKE_WATER_Y } from './lakeLayout';

type BankSide = -1 | 1;
type BankPoint = readonly [distance: number, edge: number];

// The mouths of both coves lie outside the shallow water used by the fish.
const westEdge: readonly BankPoint[] = [
  [25, 37], [35, 27], [49, 29], [65, 27], [86, 35], [114, 43],
  [153, 52], [185, 50], [228, 45], [271, 62], [330, 101], [382, 147],
];
const eastEdge: readonly BankPoint[] = [
  [25, 34], [36, 28], [48, 26], [64, 29], [78, 40], [100, 61],
  [150, 103], [187, 149], [240, 183], [280, 199], [335, 214], [382, 188],
];

function bankEdge(side: BankSide, distance: number): number {
  const curve = side === -1 ? westEdge : eastEdge;
  for (let i = 1; i < curve.length; i += 1) {
    const [end, edge] = curve[i];
    if (distance > end) continue;
    const [start, previous] = curve[i - 1];
    const t = MathUtils.smoothstep(distance, start, end);
    return MathUtils.lerp(previous, edge, t) + Math.sin(distance * 0.52) * 0.57 + Math.sin(distance * 0.17) * 0.68;
  }
  return curve[curve.length - 1][1];
}

function bankHeight(side: BankSide, offset: number, distance: number): number {
  const stripe = Math.sin(distance * 0.46 + offset * 0.32 + side) * 0.45
    + Math.sin(distance * 0.17 - offset * 0.49) * 0.55;
  const shelf = MathUtils.smoothstep(offset, -3, 9);
  const hill = MathUtils.smoothstep(offset, 5, 36);
  const inland = side === -1 ? 7.0 : 5.7;
  return LAKE_WATER_Y - 1.9 + shelf * (2.98 + 0.58 * stripe) + hill * inland
    + (Math.sin(offset * 0.92 + distance * 0.15) * 0.34 + stripe * 0.56) * shelf;
}

function addBank(surface: PlantSurface, side: BankSide): void {
  const point = new Vector3();
  const tint = new Color();
  const rock = new Color(0x555c59);
  const turf = new Color(0x485a35);
  const random = coastRandom(side < 0 ? 4932 : 8549);
  const offsets = [-8, -4.5, -2, -0.6, 0.7, 2.1, 4.4, 7, 10, 15, 21, 29, 42, 66, 112, 175, 234];
  let previous: number[] | undefined;
  for (let distance = 25; distance < 386; distance += distance < 108 ? 1.7 : 3.8) {
    const edge = bankEdge(side, distance);
    const row = offsets.map(offset => {
      const jitter = (random() - 0.5) * 0.48;
      const y = bankHeight(side, offset + jitter, distance);
      const patch = Math.sin(distance * 0.67 + offset * 0.69) * Math.sin(distance * 0.23 - offset * 0.51);
      const moss = MathUtils.smoothstep(y, LAKE_WATER_Y - 0.22, LAKE_WATER_Y + 0.62)
        * MathUtils.smoothstep(patch + random() * 0.57, -0.28, 0.78);
      tint.copy(rock).lerp(turf, moss);
      return surface.point(point.set(side * (edge + offset + jitter), y, -distance), tint, 0.81 + random() * 0.34);
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
  // The front wall of the western basin extends through the left edge of the glazing.
  { x: -52, z: -48, radiusX: 17, radiusZ: 15, height: 91, yaw: 0.53, seed: 11, color: 0x737577, detail: 1.45 },
  { x: -46.5, z: -55, radiusX: 11.9, radiusZ: 12, height: 55, yaw: 0.39, seed: 27, color: 0x8d918e, detail: 1.35 },
  { x: -59, z: -66, radiusX: 16, radiusZ: 14, height: 101, yaw: -0.32, seed: 30, color: 0x7d8990, detail: 1.16 },
  { x: -80, z: -84, radiusX: 24, radiusZ: 23, height: 144, yaw: -0.27, seed: 38, color: 0x758189 },
  { x: -34.1, z: -51.7, radiusX: 7.6, radiusZ: 8.7, height: 18.7, yaw: 0.67, seed: 7.4, color: 0x8c9090, detail: 1.43 },
  { x: -37, z: -57, radiusX: 9.1, radiusZ: 9.4, height: 20, yaw: 0.27, seed: 51, color: 0x8c9090, detail: 1.25 },
  { x: -36, z: -44.3, radiusX: 8.1, radiusZ: 7.4, height: 10.8, yaw: -0.57, seed: 53, color: 0x6f7778 },
  { x: -53, z: -78, radiusX: 12, radiusZ: 14, height: 20, yaw: 0.37, seed: 68, color: 0x8e8b80 },
  { x: -83, z: -117, radiusX: 23, radiusZ: 22, height: 63, yaw: 0.32, seed: 81, color: 0x6a7779 },
  { x: -97, z: -112, radiusX: 21, radiusZ: 24, height: 107, yaw: 0.41, seed: 43, color: 0x768085 },
  { x: -77, z: -145, radiusX: 15, radiusZ: 17, height: 21, yaw: -0.22, seed: 36, color: 0x6a756f },
  { x: -58, z: -184, radiusX: 14, radiusZ: 21, height: 11.1, yaw: 0.23, seed: 2, color: 0x6b7467 },
  { x: -62, z: -220, radiusX: 17, radiusZ: 19, height: 7.3, yaw: -0.13, seed: 87, color: 0x6e786d },
  // Thin detached ribs sit in front of the wider bedrock surfaces.
  { x: -37.7, z: -48.3, radiusX: 2.0, radiusZ: 3.3, height: 37, yaw: -0.35, seed: 39, color: 0x9a9f98, taper: 0.4 },
  { x: -40.5, z: -44.7, radiusX: 2.45, radiusZ: 2.7, height: 30, yaw: 0.32, seed: 21, color: 0x8d989c, taper: 0.55 },
  { x: -44.6, z: -45.5, radiusX: 2.4, radiusZ: 4.1, height: 43, yaw: 0.45, seed: 68, color: 0x88958f },
  { x: -39.1, z: -53.2, radiusX: 2.8, radiusZ: 4.9, height: 49, yaw: -0.37, seed: 16, color: 0x848f93, taper: 0.31 },
  { x: -34.7, z: -45.7, radiusX: 2.3, radiusZ: 2.5, height: 13.6, yaw: 0.51, seed: 79, color: 0x989d97, taper: 0.54 },
  { x: -32.6, z: -47.1, radiusX: 1.5, radiusZ: 2.9, height: 16.0, yaw: -0.15, seed: 41, color: 0x929d9a, taper: 0.31 },
  { x: -30.6, z: -51.2, radiusX: 1.4, radiusZ: 4.2, height: 11.7, yaw: 0.21, seed: 38, color: 0xa4aaa0, taper: 0.40 },
  { x: -30.7, z: -53.5, radiusX: 2.1, radiusZ: 2.5, height: 15.6, yaw: 0.38, seed: 52, color: 0x858d8d, taper: 0.56 },
  { x: -35.1, z: -42.9, radiusX: 2.15, radiusZ: 2.9, height: 6.4, yaw: 0.35, seed: 28, color: 0x7f8a86, taper: 0.36 },
  // An isolated castellated summit is framed between the western wall and the ring.
  { x: -118, z: -329, radiusX: 17, radiusZ: 19, height: 138, yaw: 0.24, seed: 84, color: 0x647e90, taper: 0.41, lean: -0.02, detail: 1.06 },
  { x: -107, z: -326, radiusX: 8.5, radiusZ: 9, height: 112, yaw: -0.31, seed: 48, color: 0x718b9a, taper: 0.46 },
  { x: -130, z: -337, radiusX: 11.5, radiusZ: 14, height: 130, yaw: -0.25, seed: 27, color: 0x738a98, taper: 0.56 },
  { x: -145, z: -344, radiusX: 17, radiusZ: 22, height: 109, yaw: 0.54, seed: 71, color: 0x6e8799, taper: 0.49 },
  { x: -121, z: -314, radiusX: 4.7, radiusZ: 5.5, height: 101, yaw: -0.16, seed: 44, color: 0x80939f, taper: 0.58, detail: 0.66 },
  { x: -115.8, z: -315, radiusX: 3.7, radiusZ: 7.3, height: 118, yaw: 0.28, seed: 71, color: 0x738994, taper: 0.45, detail: 0.75 },
  { x: -126, z: -316, radiusX: 26, radiusZ: 17, height: 31, yaw: 0.06, seed: 12, color: 0x7b8d96 },
  { x: -163, z: -342, radiusX: 28, radiusZ: 26, height: 56, yaw: -0.41, seed: 5, color: 0x80939d },
  // The eastern ridge reads through the cloud bank behind the much lower pine cape.
  { x: 287, z: -345, radiusX: 29, radiusZ: 39, height: 184, yaw: -0.44, seed: 58, color: 0x6d8290, taper: 0.37, lean: 0.07 },
  { x: 317, z: -362, radiusX: 33, radiusZ: 42, height: 206, yaw: -0.41, seed: 75, color: 0x6e7f90, taper: 0.47 },
  { x: 254, z: -335, radiusX: 22, radiusZ: 30, height: 124, yaw: 0.28, seed: 13, color: 0x71899a },
  { x: 230, z: -350, radiusX: 20, radiusZ: 21, height: 113, yaw: -0.16, seed: 73, color: 0x7994a3, taper: 0.38 },
  { x: 216, z: -331, radiusX: 13, radiusZ: 21, height: 57, yaw: 0.56, seed: 13, color: 0x7b91a0 },
  { x: 257, z: -317, radiusX: 32, radiusZ: 27, height: 55, yaw: -0.28, seed: 21, color: 0x7d96a1 },
];

const pines: readonly LakePine[] = [
  { x: -33.2, y: 15.6, z: -50.8, height: 7.1, spread: 7.1, yaw: 0.51, seed: 90 },
  { x: -34.2, y: 7.9, z: -44.1, height: 5.4, spread: 4.98, yaw: 0.31, seed: 23 },
  { x: -51.8, y: 16.8, z: -76.4, height: 5.1, spread: 5.26, yaw: 0.55, seed: 67 },
  { x: -28.7, y: 0.1, z: -41.8, height: 5.9, spread: 5.4, yaw: 0.98, seed: 73 },
  { x: 46.9, y: 4.0, z: -54, height: 9.1, spread: 7.5, yaw: 1.91, seed: 11 },
  { x: 41.5, y: 2.7, z: -52.5, height: 6.1, spread: 5.5, yaw: -2.80, seed: 41 },
  { x: 52, y: 5.1, z: -67, height: 8.4, spread: 7.45, yaw: -0.61, seed: 42 },
  { x: 250, y: 50, z: -322, height: 10.8, spread: 9.4, yaw: 3.86, seed: 9 },
  { x: -58.6, y: 8.2, z: -180.8, height: 10.4, spread: 11.8, yaw: -0.88, seed: 14 },
  { x: -62.7, y: 4.1, z: -215.8, height: 9.3, spread: 8.2, yaw: 1.09, seed: 16 },
];

function addShoreDetails(ledges: Readonly<Record<BankSide, PlantSurface>>): LakePine[] {
  const random = coastRandom(81557);
  const trees = [...pines];
  for (const side of [-1, 1] as const) {
    for (let piece = 0; piece < 84; piece += 1) {
      const distance = 34 + random() ** 1.67 * (side < 0 ? 209 : 135);
      const offset = 0.9 + random() * 25;
      const nearby = distance < 99;
      const radius = (nearby ? 0.48 : 1.08) + random() ** 1.8 * (nearby ? 4.5 : 5.7);
      const bottom = bankHeight(side, offset, distance) - radius * 0.28 - 0.53;
      addRockMass(ledges[side], {
        x: side * (bankEdge(side, distance) + offset), z: -distance, bottom, radiusX: radius,
        radiusZ: radius * (0.58 + random() * 0.57), height: radius * (0.24 + random() * 0.56),
        yaw: random() * Math.PI, taper: 0.64, lean: 0.25, seed: random() * 100,
        color: [0x596160, 0x636f6f, 0x67695e, 0x5e6856][Math.floor(random() * 4)], detail: nearby ? 0.47 : 0.32,
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

function buildFarShore(root: Group): void {
  const ground = new PlantSurface();
  const stone = new PlantSurface();
  const windows = new PlantSurface();
  const point = new Vector3();
  const tint = new Color();
  const sand = new Color(0xd2c4a9);
  const meadow = new Color(0x92968d);
  let previous: number[] | undefined;
  const distances = [-6, 0, 5, 11, 19, 31, 48, 69, 105, 152, 230];
  for (const distance of distances) {
    const row: number[] = [];
    for (let x = -418; x <= 418; x += 5.5) {
      const shore = 6.7 * Math.sin(x * 0.021) + 3.4 * Math.sin(x * 0.058 + 0.5);
      const relief = 0.45 + 0.55 * Math.sin(x * 0.018 + 0.75) ** 2;
      const y = LAKE_WATER_Y + MathUtils.lerp(-2.2, 2.1, MathUtils.smoothstep(distance, -6, 11))
        + MathUtils.smoothstep(distance, 4, 58) * (4.4 + 11 * relief) * (0.85 + 0.15 * Math.sin(distance * 0.26 + x * 0.036));
      tint.copy(sand).lerp(meadow, MathUtils.smoothstep(distance, 9, 45) * relief);
      row.push(ground.point(point.set(x, y, LAKE_TERRAIN.shoreZ - distance + shore), tint,
        0.94 + 0.07 * Math.sin(x * 0.17 + distance * 0.20)));
    }
    if (previous) stitchRows(ground, previous, row, true);
    previous = row;
  }

  const random = coastRandom(27491);
  const blocks: readonly (readonly [x: number, z: number, width: number, depth: number, height: number])[] = [
    [-108, -395, 17, 13, 49], [-82, -403, 12.8, 10, 35], [-58, -409, 16, 21, 14],
    [-37, -415, 23, 14, 11], [32, -412, 31, 16, 10], [73, -422, 24, 19, 14],
    [110, -405, 23, 16, 13], [134, -408, 27, 13, 9], [180, -403, 19, 22, 30],
    [204, -417, 19, 14, 13],
  ];
  const concrete = new Color(0x879091);
  const glass = new Color(0x5a6e7a);
  const quad = (surface: PlantSurface, x: number, z: number, w: number, y: number, h: number, color: Color, shade: number) => {
    const a = surface.point(point.set(x, y, z), color, shade);
    const b = surface.point(point.set(x + w, y, z), color, shade);
    const c = surface.point(point.set(x, y + h, z), color, shade);
    const d = surface.point(point.set(x + w, y + h, z), color, shade);
    surface.triangle(a, b, c);
    surface.triangle(b, d, c);
  };
  for (const [x, z, width, depth, height] of blocks) {
    const base = 0.5;
    const shade = 0.84 + random() * 0.25;
    quad(stone, x, z, width, base, height, concrete, shade);
    const side = [point.set(x + width, base, z).clone(), point.set(x + width, base, z - depth).clone(),
      point.set(x + width, base + height, z).clone(), point.set(x + width, base + height, z - depth).clone()]
      .map(vertex => stone.point(vertex, concrete, shade * 0.79));
    stone.triangle(side[0], side[1], side[2]);
    stone.triangle(side[1], side[3], side[2]);
    const west = [point.set(x, base, z - depth).clone(), point.set(x, base, z).clone(),
      point.set(x, base + height, z - depth).clone(), point.set(x, base + height, z).clone()]
      .map(vertex => stone.point(vertex, concrete, shade * 0.73));
    stone.triangle(west[0], west[1], west[2]);
    stone.triangle(west[1], west[3], west[2]);
    const roof = [point.set(x, base + height, z).clone(), point.set(x + width, base + height, z).clone(),
      point.set(x, base + height, z - depth).clone(), point.set(x + width, base + height, z - depth).clone()]
      .map(vertex => stone.point(vertex, concrete, shade * 1.12));
    stone.triangle(roof[0], roof[1], roof[2]);
    stone.triangle(roof[1], roof[3], roof[2]);
    const columns = Math.floor(width / 2.5);
    const rows = Math.floor(height / 4.2);
    for (let column = 0; column < columns; column += 1) {
      const bay = width / columns;
      for (let story = 1; story < rows; story += 1) {
        quad(windows, x + bay * (column + 0.20), z + 0.015, bay * 0.53,
          base + story * 4.2, 1.48, glass, 0.87 + random() * 0.35);
      }
    }
  }
  const patch = new MeshStandardMaterial({ vertexColors: true, roughness: 0.93 });
  addMesh(root, ground, patch, 'Pale, low terraces on the far shore');
  addMesh(root, stone, patch, 'Distant stone and concrete buildings');
  addMesh(root, windows, patch, 'Narrow window bays in the far settlement');
}

function addMesh(root: Group, surface: PlantSurface, material: MeshStandardMaterial, name: string): void {
  const mesh = new Mesh(surface.geometry(), material);
  mesh.name = name;
  root.add(mesh);
}

export function buildLakeBasin(root: Group): void {
  root.name = 'Rock basin and stone ring';
  const ledges = { [-1]: new PlantSurface(), [1]: new PlantSurface() };
  const distantPeaks = new PlantSurface();
  for (const mass of basinCliffs) {
    const surface = mass.z < -280 ? distantPeaks : ledges[mass.x < 0 ? -1 : 1];
    addRockMass(surface, mass);
  }
  const trees = addShoreDetails(ledges);
  const stone = lakeStoneMaterial();
  // Keep the broad slopes apart from the ledges so their bounding spheres
  // cannot pull dense cliff geometry into a view facing back into the room.
  for (const side of [-1, 1] as const) {
    const direction = side === -1 ? 'West' : 'East';
    const slope = new PlantSurface();
    addBank(slope, side);
    addMesh(root, slope, stone, `${direction} bank mossy slopes`);
    addMesh(root, ledges[side], stone, `${direction} bank fractured cliffs and ledges`);
  }
  addMesh(root, distantPeaks, stone, 'Distant cirque summits');
  buildLakeStoneRing(root, stone);
  buildFarShore(root);
  addLakeBankPines(root, trees);
}
