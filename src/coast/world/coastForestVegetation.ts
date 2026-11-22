import { coastRandom, FOREST_WALKS, groundHeight, groundSlope, smoothstep } from '../terrain';
import type { FloorForm } from './coastPlantMeshes';
import type { TreeForm } from './coastTreeMeshes';

export type Plant = { x: number; y: number; z: number; width: number; height: number; yaw: number; tone: number };
export type Tree = Plant & { form: TreeForm };
export type FloorPlant = Plant & { form: FloorForm; detailOnly?: boolean };
export type PlantingDistance = (x: number, z: number) => number;

const FOREST_LIMITS = { minX: -190, maxX: 190, minZ: 118, maxZ: 490 };

export function isInlandForest(x: number, z: number): boolean {
  const { minX, maxX, minZ, maxZ } = FOREST_LIMITS;
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}

export function makePlant(x: number, z: number, width: number, height: number, random: () => number, lift = 0): Plant {
  return { x, y: groundHeight(x, z) + lift, z, width, height, yaw: random() * Math.PI * 2, tone: random() };
}

function cover(x: number, z: number): number {
  return 0.5 + 0.22 * Math.sin(x * 0.087 + z * 0.068) + 0.17 * Math.cos(z * 0.117 - x * 0.037)
    + 0.11 * Math.sin(z * 0.192 + x * 0.158);
}

function forestOpening(x: number, z: number, canopy: boolean): number {
  return Math.min(
    Math.hypot(x - 39, z - 262) - 5, // Ford
    Math.hypot(x - 85, z - 298) - 5, // Upper stream reveal
    Math.hypot(x + 14, z - 392) - (canopy ? 12 : 3.7), // Summit
  );
}

export function plantForest(trailDistance: PlantingDistance, streamDistance: PlantingDistance):
  { trees: Tree[]; understory: FloorPlant[] } {
  const trees: Tree[] = [];
  const understory: FloorPlant[] = [];
  const treeRandom = coastRandom(2805473);
  const floorRandom = coastRandom(7789483);
  const patchRandom = coastRandom(4159523);
  const { minX, maxX, minZ, maxZ } = FOREST_LIMITS;

  function addTree(x: number, z: number, width: number, height: number, form: TreeForm): void {
    const pathClearance = trailDistance(x, z);
    const clearance = Math.min(pathClearance, streamDistance(x, z));
    const rootedWidth = form === 'buttressed' ? width * 0.63 : width * 0.36;
    if (clearance < 2.1 + rootedWidth || forestOpening(x, z, true) < width * 0.83) return;
    if (form === 'sapling' && width > 2.2 && pathClearance < 6.35 && z > 162 && z < 250) return;
    if (groundHeight(x, z) < 3.8) return;
    const slope = groundSlope(x, z, 1.54);
    if (slope > (form === 'windPruned' ? 1.70 : 1.24)) return;
    const canopy = clearance < width + 2.3 ? Math.max(height, form === 'sapling' ? 4.4 : 8.9) : height;
    trees.push({ ...makePlant(x, z, width, canopy, treeRandom, -0.16 - slope * 0.14), form });
  }

  // Taller trunks and low forks give the first two clearings a distinct silhouette.
  for (const [x, z, width, height] of [
    [-19, 187, 5.3, 17.9], [3, 203, 6.5, 20.8], [-21, 222, 6.8, 19.2], [-5.1, 230.3, 12.0, 31.5],
    [-9.2, 236.8, 7.1, 21.3], [11, 224, 5.9, 16.2],
    [26, 252, 6.5, 16.5], [58, 272, 6.9, 21.1], [-51, 284, 6.4, 16.5], [-70, 331, 6.7, 20.1],
  ]) addTree(x, z, width, height, 'buttressed');
  addTree(-13.6, 199, 6.1, 19.4, 'spreading');
  addTree(-1, 200, 6.5, 19.6, 'emergent');

  const landmarks = trees.slice();
  const treeSpacing = 5.7;
  for (let row = minZ; row < maxZ; row += treeSpacing) {
    for (let column = minX; column < maxX; column += treeSpacing) {
      const x = column + treeRandom() * treeSpacing;
      const z = row + treeRandom() * treeSpacing;
      if (!isInlandForest(x, z)) continue;
      const growth = cover(x, z);
      if (treeRandom() > 0.68 + growth * 0.35) continue;
      if (landmarks.some(tree => (x - tree.x) ** 2 + (z - tree.z) ** 2 < 25)) continue;
      const age = treeRandom();
      const sheltered = streamDistance(x, z) < 22 || growth > 0.41;
      const form = age < 0.28 ? 'sapling' : age > 0.90 && sheltered ? 'buttressed'
        : age > 0.57 ? 'emergent' : age < 0.35 && !sheltered ? 'windPruned' : 'spreading';
      const width = form === 'sapling' ? 1.45 + treeRandom() * 1.95
        : form === 'buttressed' ? 4.7 + treeRandom() * 2.6 : 2.8 + treeRandom() * 3.6;
      const height = width * (form === 'buttressed' || form === 'emergent' ? 2.05 + treeRandom() * 1.24
        : form === 'sapling' ? 2.35 + treeRandom() * 1.33 : 1.27 + treeRandom() * 0.91);
      addTree(x, z, width, height, form);
    }
  }

  function plantFloor(x: number, z: number, form: FloorForm, width: number, height: number, detailOnly = false): void {
    const grass = form === 'sedge' || form === 'grass';
    if (trailDistance(x, z) < (grass ? 1.96 + width * 0.26 : 2.05 + width * 0.87)
      || streamDistance(x, z) < (grass ? 0.28 : 1.1 + width * 0.60)
      || forestOpening(x, z, false) < width * 0.55) return;
    const lowCover = width < 0.64 && height < 0.51;
    if (groundHeight(x, z) < 3.6 || groundSlope(x, z, 0.83) > (grass ? 2.04 : lowCover ? 1.78 : 1.36)) return;
    understory.push({ ...makePlant(x, z, width, height, floorRandom, -0.05), form, detailOnly });
  }

  for (const [x, z, form, size] of [
    [-13.5, 185.4, 'heliconia', 2.2], [-2.3, 188.5, 'shieldLeaf', 2.5], [-14.8, 198.5, 'swordFern', 2.25],
    [-8.8, 210, 'birdnest', 1.8], [6.3, 214.2, 'heliconia', 2.35], [1.9, 215, 'birdnest', 1.32],
    [4.8, 224.8, 'swordFern', 1.92], [7.5, 227.5, 'heliconia', 2.12], [-.7, 224.2, 'shieldLeaf', 1.82],
    [22.6, 247.6, 'shieldLeaf', 2.1], [46.8, 258.2, 'sedge', 1.1], [45.8, 264.2, 'swordFern', 1.75],
    [-54.7, 293, 'birdnest', 1.45], [-58.1, 305.2, 'swordFern', 1.85], [-48.5, 321, 'heliconia', 2.2],
  ] as const) plantFloor(x, z, form, size, size * 1.13);

  // Stagger the close silhouettes along both banks of the route so bends reveal new fronds.
  for (const walk of FOREST_WALKS) {
    const points = walk.points;
    for (let i = 2; i < points.length - 1; i += 2 + Math.floor(floorRandom() * 1.7)) {
      const point = points[i];
      if (point.z < minZ + 1) continue;
      const dx = points[i + 1].x - points[i - 1].x;
      const dz = points[i + 1].z - points[i - 1].z;
      const sideLength = Math.hypot(dx, dz);
      for (const side of [-1, 1]) {
        const offset = side * (2.5 + floorRandom() ** 1.4 * 3.1);
        const x = point.x + dz / sideLength * offset + (floorRandom() - 0.5) * 0.82;
        const z = point.z - dx / sideLength * offset + (floorRandom() - 0.5) * 0.82;
        const width = 0.46 + floorRandom() ** 1.28 * 1.68;
        const blueprints = ['swordFern', 'shieldLeaf', 'birdnest', 'swordFern', 'heliconia', 'sedge'] as const;
        if (floorRandom() < 0.85) {
          plantFloor(x, z, blueprints[Math.floor(floorRandom() * blueprints.length)], width, width * (0.87 + floorRandom() * 0.29));
        }
        for (let clump = 0; clump < 4; clump += 1) {
          const px = x + (floorRandom() - 0.5) * 2.67;
          const pz = z + (floorRandom() - 0.5) * 2.67;
          const size = 0.31 + floorRandom() * 0.77;
          plantFloor(px, pz, floorRandom() < 0.60 ? 'grass' : 'sedge', size, size * (0.64 + floorRandom() * 0.44), clump > 1);
        }
      }
    }
  }

  const floorSpacing = 3.15;
  for (let row = minZ; row < maxZ; row += floorSpacing) {
    for (let column = minX; column < maxX; column += floorSpacing) {
      const x = column + floorRandom() * floorSpacing;
      const z = row + floorRandom() * floorSpacing;
      if (!isInlandForest(x, z)) continue;
      const clump = cover(x + 24, z - 13);
      const bank = 1 - smoothstep(2, 16, streamDistance(x, z));
      const bankCover = Math.max(clump, bank);
      if (floorRandom() > 0.59 + 0.39 * bankCover) continue;
      const chooser = floorRandom();
      const form = bank > 0.62 && chooser < 0.44 ? 'sedge' : chooser < 0.24 ? 'swordFern'
        : chooser < 0.39 ? 'birdnest' : chooser < 0.51 ? 'shieldLeaf'
          : chooser < 0.63 && bankCover > 0.37 ? 'heliconia' : 'grass';
      const size = 0.38 + floorRandom() ** 1.55 * (0.60 + bankCover * 1.35);
      plantFloor(x, z, form, size, size * (0.71 + floorRandom() * 0.49));
      if (bankCover > 0.37 || trailDistance(x, z) < 5.9) {
        const small = 0.22 + floorRandom() * 0.63;
        plantFloor(x + (floorRandom() - 0.5) * 2.3, z + (floorRandom() - 0.5) * 2.3,
          bank > 0.35 ? 'sedge' : 'grass', small, small * 0.82, true);
      }
    }
  }

  // Small plants gather under shade along the entrance and the first fork. The ford opens up again.
  for (const walk of FOREST_WALKS) {
    const points = walk.points;
    for (let i = 1; i < points.length - 1; i += 1) {
      const point = points[i];
      const byEntry = walk.id === 'approach' && point.z >= 170;
      const byFork = (walk.id === 'ford' || walk.id === 'ravine') && point.z < 239;
      if (!byEntry && !byFork) continue;
      const dx = points[i + 1].x - points[i - 1].x;
      const dz = points[i + 1].z - points[i - 1].z;
      const length = Math.hypot(dx, dz);
      for (const side of [-1, 1]) {
        const shade = cover(point.x + side * 4.5, point.z - 7.0);
        if (patchRandom() < 0.10 + (1 - shade) * 0.20) continue;
        const offset = side * (2.53 + patchRandom() ** 1.45 * 2.19);
        const centerX = point.x + dz / length * offset;
        const centerZ = point.z - dx / length * offset;
        for (let group = 0; group < 4; group += 1) {
          const x = centerX + (patchRandom() - 0.5) * 1.83;
          const z = centerZ + (patchRandom() - 0.5) * 1.97;
          const width = 0.27 + patchRandom() * 0.56;
          const form = group === 0 ? 'swordFern' : group === 1 ? 'shieldLeaf' : group === 2 ? 'birdnest' : 'grass';
          const height = width * (form === 'shieldLeaf' ? 0.44 : 0.58 + patchRandom() * 0.24);
          plantFloor(x, z, form, width, height, group === 3);
        }
      }
    }
  }

  return { trees, understory };
}
