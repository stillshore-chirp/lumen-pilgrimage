export const SEA_LEVEL = 0;
export const COAST_BOUNDS = { minX: -560, maxX: 570, minZ: -760, maxZ: 1240 };
export const LANDSCAPE_BOUNDS = { minX: -1670, maxX: 1670, minZ: -817, maxZ: 2210 };
export const SPAWN = { x: -12, z: 79, yaw: -0.035, pitch: 0.102 };
export type CoastPoint = { x: number; y: number; z: number };

export const UPLAND_LAKE = { x: 143, z: 754, width: 82, length: 76, level: 71 };
export const INARI_COURT = { x: 216, z: 923, y: 78.6 };
export const INARI_INNER_COURT = { x: 253, z: 1035, y: 120.8 };
const inariShrineLanding = { x: 253.9, z: 1038.15, y: 120.67 };
export type CoastRestSite = {
  id: string; name: string; kind: 'bench' | 'terrace';
  x: number; z: number; grade: number; lookX: number; lookZ: number;
};

export const COAST_REST_SITES: readonly CoastRestSite[] = [
  { id: 'beach-bench', name: '浜のベンチ', kind: 'bench', x: -25.5, z: 75.2, grade: 4.30,
    lookX: 2, lookZ: -235 },
  { id: 'shore-shelter', name: '森の入口の休憩所', kind: 'terrace', x: -27, z: 111, grade: 11.15,
    lookX: -79, lookZ: -27 },
  { id: 'lake-shelter', name: '湖畔の休憩所', kind: 'terrace', x: 84, z: 702, grade: 73.85,
    lookX: 221, lookZ: 787 },
  { id: 'ridge-bench', name: '稜線のベンチ', kind: 'bench', x: -113.5, z: 976, grade: 183.1,
    lookX: 533, lookZ: 1334 },
];

export function restSiteYaw(site: CoastRestSite): number {
  return Math.atan2(site.lookX - site.x, site.lookZ - site.z);
}

export function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function coastRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Promontory = {
  x: number;
  z: number;
  width: number;
  length: number;
  height: number;
  bearing: number;
};

// Two interlocking headlands frame the inner bay. Smaller offshore ridges
// step into the distance and leave a channel all the way out to the open sea.
const promontories: Promontory[] = [
  { x: -180, z: -143, width: 76, length: 104, height: 154, bearing: -0.25 },
  { x: -154, z: -222, width: 53, length: 78, height: 116, bearing: 0.22 },
  { x: -212, z: -164, width: 92, length: 114, height: 171, bearing: 0.24 },
  { x: -73, z: -281, width: 31, length: 54, height: 96, bearing: -0.24 },
  { x: -112, z: -336, width: 61, length: 77, height: 133, bearing: -0.33 },
  { x: -28, z: -407, width: 41, length: 69, height: 92, bearing: 0.3 },
  { x: -78, z: -503, width: 68, length: 94, height: 124, bearing: 0.42 },
  { x: -171, z: -582, width: 117, length: 83, height: 148, bearing: -0.1 },
  { x: -248, z: -476, width: 72, length: 101, height: 103, bearing: 0.64 },
  { x: 196, z: -199, width: 85, length: 109, height: 181, bearing: 0.3 },
  { x: 233, z: -152, width: 84, length: 96, height: 173, bearing: -0.55 },
  { x: 125, z: -294, width: 39, length: 57, height: 95, bearing: -0.37 },
  { x: 183, z: -323, width: 98, length: 108, height: 148, bearing: 0.22 },
  { x: 133, z: -450, width: 54, length: 83, height: 92, bearing: -0.42 },
  { x: 199, z: -577, width: 91, length: 95, height: 124, bearing: 0.2 },
  { x: 277, z: -653, width: 103, length: 95, height: 99, bearing: -0.3 },
];

const buttresses = promontories.map(rock => ({
  ...rock, cos: Math.cos(rock.bearing), sin: Math.sin(rock.bearing),
  extent: Math.max(rock.length, rock.width) * 1.55 + 12
}));

function dune(x: number, z: number, cx: number, cz: number, rx: number, rz: number): number {
  const radius = Math.hypot((x - cx) / rx, (z - cz) / rz);
  return 1 - smoothstep(0.22, 1.22, radius);
}

export function shoreline(x: number): number {
  return 72 + 13 * Math.sin(x * 0.014) + 3.2 * Math.sin(x * 0.062 + 0.6)
    - 45 * (1 - smoothstep(0, 105, Math.abs(x + 103)))
    - 33 * (1 - smoothstep(0, 88, Math.abs(x - 117)));
}

const tidalPools = [
  { x: 48.5, z: 31.7, width: 7.6, length: 9.2, floor: -0.74 },
  { x: 52.6, z: 21.4, width: 4.3, length: 5.6, floor: -0.48 },
];

const limestonePassage = [
  { x: -96, z: 103.8, width: 10.8, length: 5.7, height: 11.3 },
  { x: -95, z: 119.5, width: 8.5, length: 5.9, height: 8.6 },
  { x: -79, z: 107.3, width: 6.6, length: 4.3, height: 5.8 },
];

// Low beds left above the wash, and the heel of the limestone ridge inland.
const surfaceBeds = [
  { x: -47, z: 45, span: 9, run: 17, rise: 2.65, angle: -0.58 },
  { x: -63, z: 1, span: 6, run: 20, rise: 2.50, angle: -0.49 },
  { x: -82, z: -39, span: 10, run: 13, rise: 4.65, angle: -0.40 },
  { x: 49, z: 28, span: 11, run: 20, rise: 1.0, angle: 0.24 },
  { x: 63, z: 5, span: 10, run: 22, rise: 1.45, angle: 0.40 },
  { x: 76, z: -30, span: 8, run: 17, rise: 2.0, angle: 0.29 },
  { x: -38, z: 159, span: 12, run: 23, rise: 3.75, angle: -0.53 },
  { x: -30, z: 211, span: 12, run: 19, rise: 4.60, angle: 0.43 },
  { x: 19, z: 231, span: 7, run: 15, rise: 2.9, angle: -0.31 },
  { x: 48, z: 253, span: 10, run: 13, rise: 2.63, angle: 0.44 },
  { x: -54, z: 293, span: 6, run: 14, rise: 4.8, angle: -0.12 },
  { x: -73, z: 311, span: 9, run: 16, rise: 5.5, angle: 0.41 },
  { x: -23, z: 388, span: 9, run: 14, rise: 2.1, angle: -0.65 },
].map(bed => ({ ...bed, sin: Math.sin(bed.angle), cos: Math.cos(bed.angle) }));

const westernRecesses = [
  { x: -57, z: 13, width: 5, length: 12, grade: 3.6 },
  { x: -65, z: -8, width: 5.7, length: 13, grade: 3.9 },
  { x: -72, z: -25, width: 6.5, length: 12, grade: 4.9 },
];

function surfaceBedWeight(x: number, z: number, bed: typeof surfaceBeds[number]): number {
  const dx = x - bed.x, dz = z - bed.z;
  if (Math.abs(dx) > 28 || Math.abs(dz) > 31) return 0;
  const u = (dx * bed.cos + dz * bed.sin) / bed.span;
  const v = (-dx * bed.sin + dz * bed.cos) / bed.run;
  const erosion = 0.095 * Math.sin(13.1 * v + 5.2 * u) + 0.042 * Math.sin(37.0 * v - u * 20.0);
  const radius = Math.hypot(u, v) * 0.56 + Math.max(Math.abs(u), Math.abs(v)) * 0.44;
  const bench = 0.61 * (1 - smoothstep(0.54, 0.94, radius + erosion));
  const apron = 0.39 * (1 - smoothstep(0.61, 1.19, radius));
  return bench + apron;
}

export function coastBedrock(x: number, z: number): number {
  let exposed = 0;
  for (const bed of surfaceBeds) exposed = Math.max(exposed, surfaceBedWeight(x, z, bed));
  return Math.max(exposed, uplandSpillWetness(x, z));
}

function spillCenter(x: number): number {
  return 774 + (247 - x) * 0.182 + 0.67 * Math.sin((x - 247) * 0.12);
}

function headwaterPocket(x: number, z: number): number {
  const across = 1 - smoothstep(2.8, 6.6, Math.abs(z - spillCenter(x)));
  return across * smoothstep(251, 259, x) * (1 - smoothstep(264.5, 270.2, x));
}

export function uplandSpillWetness(x: number, z: number): number {
  if (x < 190 || x > 273 || z < 757 || z > 799) return 0;
  const channel = 1 - smoothstep(2.6, 8.4, Math.abs(z - spillCenter(x)));
  return Math.max(channel * smoothstep(192, 203, x) * (1 - smoothstep(263, 272, x)), headwaterPocket(x, z));
}

export const FOREST_STREAM = [
  { x: -30, z: 240.0, y: 18.64, halfWidth: 0 },
  { x: -24, z: 240.6, y: 18.69, halfWidth: 4.8 },
  { x: -19, z: 241.0, y: 18.72, halfWidth: 5.4 },
  { x: -5, z: 247.0, y: 18.91, halfWidth: 3.5 },
  { x: 13, z: 254.5, y: 19.14, halfWidth: 3.8 },
  { x: 28, z: 256.5, y: 19.42, halfWidth: 4.8 },
  { x: 39, z: 261.0, y: 19.60, halfWidth: 5.9 },
  { x: 53, z: 268.0, y: 19.92, halfWidth: 4.4 },
  { x: 67, z: 276.0, y: 20.89, halfWidth: 4.0 },
  { x: 77, z: 286.0, y: 22.73, halfWidth: 3.1 },
  { x: 84, z: 296.0, y: 24.40, halfWidth: 3.7 },
  { x: 85, z: 297.5, y: 24.54, halfWidth: 3.3 },
  { x: 88, z: 301.0, y: 29.20, halfWidth: 2.65 },
  { x: 97, z: 307.0, y: 31.80, halfWidth: 1.8 },
  { x: 108, z: 315.0, y: 33.20, halfWidth: 0 },
] as const;

function sampleForestStream(x: number, z: number): { y: number; halfWidth: number; side: number } | undefined {
  if (x <= FOREST_STREAM[0].x || x >= FOREST_STREAM[FOREST_STREAM.length - 1].x || z < 224 || z > 337) {
    return undefined;
  }
  for (let i = 1; i < FOREST_STREAM.length; i += 1) {
    const end = FOREST_STREAM[i];
    if (x > end.x) continue;
    const start = FOREST_STREAM[i - 1];
    const t = (x - start.x) / (end.x - start.x);
    return {
      y: start.y + (end.y - start.y) * t,
      halfWidth: start.halfWidth + (end.halfWidth - start.halfWidth) * t,
      side: z - start.z - (end.z - start.z) * t,
    };
  }
  return undefined;
}

export function forestStreamDistance(x: number, z: number): number {
  const stream = sampleForestStream(x, z);
  return stream ? Math.max(0, Math.abs(stream.side) - stream.halfWidth) : Infinity;
}

export function forestStreamLevel(x: number, z: number): number | undefined {
  const stream = sampleForestStream(x, z);
  return stream && Math.abs(stream.side) < stream.halfWidth ? stream.y : undefined;
}

export function uplandLakeRadius(x: number, z: number): number {
  const dx = (x - UPLAND_LAKE.x) / UPLAND_LAKE.width;
  const dz = (z - UPLAND_LAKE.z) / UPLAND_LAKE.length;
  const lip = 0.075 * Math.sin(dx * 6.2 + dz * 4.1) + 0.043 * Math.cos(dx * 12.1 - dz * 8.8);
  return Math.hypot(dx, dz) + lip;
}

function lakeAt(x: number, z: number): boolean {
  return z > 645 && z < 862 && Math.abs(x - UPLAND_LAKE.x) < 114 && uplandLakeRadius(x, z) < 1;
}

export function inlandWaterLevel(x: number, z: number): number | undefined {
  return lakeAt(x, z) ? UPLAND_LAKE.level : forestStreamLevel(x, z);
}

export function coastWaterLevel(x: number, z: number): number {
  return inlandWaterLevel(x, z) ?? SEA_LEVEL;
}

function inariTerraceBlend(x: number, z: number, court: CoastPoint, width: number, length: number): number {
  if (Math.abs(x - court.x) > width * 1.18 || Math.abs(z - court.z) > length * 1.18) return 0;
  const across = Math.abs(x - court.x) / width;
  const along = Math.abs(z - court.z) / length;
  const edge = 0.72 * Math.max(across, along) + 0.28 * Math.hypot(across, along);
  return 1 - smoothstep(0.62, 1.18, edge);
}

export function inariWoodland(x: number, z: number): number {
  if (x < 177 || x > 310 || z < 886 || z > 1078) return 0;
  return smoothstep(177, 208, x) * (1 - smoothstep(259, 310, x))
    * smoothstep(886, 909, z) * (1 - smoothstep(1046, 1078, z));
}

export function inariCanopyScale(x: number, z: number): number {
  if (x < 207 || x > 264 || z < 877 || z > 958) return 1;
  const gateGlade = Math.hypot((x - 231) / 24, (z - 899) / 22);
  const stairsGlade = Math.hypot((x - 244) / 20, (z - 939) / 19);
  return 0.20 + 0.80 * smoothstep(0.48, 1, Math.min(gateGlade, stairsGlade));
}

const inlandRidges = [
  { x: -114, z: 204, width: 39, length: 68, height: 31 },
  { x: -101, z: 304, width: 29, length: 50, height: 37 },
  { x: -75, z: 294, width: 8.9, length: 17.2, height: 13 },
  { x: -53, z: 307, width: 7.2, length: 14.0, height: 15 },
  { x: 13, z: 303, width: 25, length: 32, height: 12 },
  { x: 113, z: 279, width: 27, length: 36, height: 27 },
  { x: 121, z: 342, width: 41, length: 53, height: 44 },
  { x: -77, z: 423, width: 48, length: 62, height: 55 },
  { x: -23, z: 465, width: 78, length: 65, height: 66 },
  { x: 55, z: 462, width: 51, length: 55, height: 55 },
] as const;

function inlandHeight(x: number, z: number): number {
  const grade = 12.9 + (z - 145) * 0.052;
  const foldedFloor = 3.7 * Math.sin(z * 0.031 + x * 0.043)
    + 3.2 * Math.sin(z * 0.024 - x * 0.027) + 1.32 * Math.cos(x * 0.108 - z * 0.081);
  const ridgeX = x + 2.2 * Math.sin(z * 0.14) + 0.85 * Math.sin(z * 0.54 - x * 0.13);
  const ridgeZ = z + 2.6 * Math.cos(x * 0.10) + 0.66 * Math.sin(x * 0.42 + z * 0.23);
  let ridge = 0;
  for (const rock of inlandRidges) {
    const dx = (ridgeX - rock.x) / rock.width;
    const dz = (ridgeZ - rock.z) / rock.length;
    if (Math.abs(dx) > 1.29 || Math.abs(dz) > 1.29) continue;
    const radius = Math.hypot(dx, dz) * 0.75 + Math.max(Math.abs(dx), Math.abs(dz)) * 0.25;
    const bedding = 0.04 * Math.sin(x * 0.29 + z * 0.17);
    ridge = Math.max(ridge, rock.height * (0.35 * (1 - smoothstep(0.42, 1.31, radius))
      + 0.65 * (1 - smoothstep(0.66, 0.97, radius + bedding))));
  }
  const summit = 25.0 * dune(x, z, -14, 396, 32, 40);
  const saddle = 8.7 * dune(x, z, -16, 186, 70, 67);
  const ledges = 0.63 * Math.sin(x * 0.37 + z * 0.48) + 0.25 * Math.cos(z * 0.95 - x * 0.91);
  const bank = 3.03 * dune(x, z, 26, 268, 54, 29);
  return grade + foldedFloor + ledges + Math.max(ridge, summit) + bank + saddle;
}

// Individual crests overlap in the view from the valley, with low saddles between them.
const uplandRidges = [
  [-223, 618, 125, 144, 68], [275, 628, 112, 166, 55], [-179, 805, 133, 175, 54],
  [-154, 957, 137, 198, 100], [307, 817, 121, 122, 112], [413, 962, 141, 181, 101],
  [-329, 1157, 181, 190, 140], [347, 1116, 177, 181, 132],
  [-43, 1354, 142, 179, 110], [230, 1400, 159, 205, 156], [540, 1315, 241, 260, 151],
  [-556, 1465, 250, 245, 150], [-240, 1610, 259, 245, 176], [63, 1683, 185, 192, 130],
  [431, 1751, 268, 247, 197], [769, 1740, 389, 354, 215], [-801, 1698, 322, 318, 190],
  [-502, 1954, 386, 331, 238], [77, 2025, 325, 286, 214], [746, 2095, 453, 403, 184],
  [627, 1648, 148, 167, 284], [846, 1528, 133, 187, 297], [1073, 1438, 171, 220, 306],
] as const;

function inariSaddleDepth(x: number, z: number): number {
  if (z > 795 && z < 928 && x > 240 && x < 407) {
    const radius = Math.hypot((x - 312) / 94, (z - 856) / 72);
    return 67 * (1 - smoothstep(0.23, 1, radius))
      * smoothstep(240, 256, x) * smoothstep(795, 818, z);
  }
  if (z > 975 && z < 1065 && x > 255.5 && x < 316) {
    const radius = Math.hypot((x - 280) / 36, (z - 1020) / 45);
    return 25 * (1 - smoothstep(0.21, 1, radius)) * smoothstep(255.5, 268, x);
  }
  return 0;
}

function uplandHeight(x: number, z: number): number {
  const grade = 50 + (z - 450) * 0.054;
  const waves = 4.4 * Math.sin(x * 0.018 + z * 0.016) + 3.3 * Math.cos(x * 0.027 - z * 0.028);
  const ledges = 1.0 * Math.sin(x * 0.139 + z * 0.11) + 0.48 * Math.cos(x * 0.47 + z * 0.31);
  const wx = x + 11 * Math.sin(z * 0.051 + x * 0.015) + 3.7 * Math.sin(x * 0.16 - z * 0.19);
  const wz = z + 8 * Math.cos(x * 0.042 + z * 0.023) + 2 * Math.sin(x * 0.39 + z * 0.16);
  let slopes = 0, crests = 0;
  for (const [cx, cz, width, length, height] of uplandRidges) {
    const dx = (wx - cx) / width, dz = (wz - cz) / length;
    if (Math.abs(dx) > 1.21 || Math.abs(dz) > 1.21) continue;
    const r = Math.hypot(dx, dz) * 0.84 + Math.max(Math.abs(dx), Math.abs(dz)) * 0.16;
    slopes += height * 0.25 * (1 - smoothstep(0.41, 1.21, r));
    crests = Math.max(crests, height * 0.75 * (1 - smoothstep(0.23, 0.94, r)));
  }
  let height = grade + waves + ledges + slopes + crests - inariSaddleDepth(x, z);
  if (z > 632 && z < 886 && x > 17 && x < 268) {
    const radius = uplandLakeRadius(x, z);
    const basin = (1 - smoothstep(0.95, 1.39, radius));
    const bottom = UPLAND_LAKE.level - 14.6 + smoothstep(0.28, 0.95, radius) * 16.6
      + smoothstep(0.94, 1.22, radius) * 11.5;
    height += (bottom - height) * basin;
  }
  const spill = uplandSpillWetness(x, z);
  if (spill > 0) {
    const fed = Math.max(0, x - 247);
    const drop = smoothstep(199, 248, x);
    const apron = 69.5 + 29.8 * drop + fed * 0.32;
    height -= Math.max(0, height - apron) * spill * 0.63;
    if (x > 251) {
      const headwater = 110.9 + Math.max(0, x - 255) * 0.13;
      height -= Math.max(0, height - headwater) * headwaterPocket(x, z) * 0.96;
    }
  }
  const court = inariTerraceBlend(x, z, INARI_COURT, 22.0, 13.4);
  const innerCourt = inariTerraceBlend(x, z, INARI_INNER_COURT, 9.2, 7.4);
  height += (INARI_COURT.y - height) * court + (INARI_INNER_COURT.y - height) * innerCourt;
  return height;
}

function landscapeHeight(x: number, z: number): number {
  if (z >= 577) return uplandHeight(x, z);
  const shore = z - shoreline(x);
  const shelf = shore * (shore < 0 ? 0.177 : 0.208);
  const beachRipples = (0.1 * Math.sin(z * 0.58 + x * 0.24) + 0.13 * Math.sin(x * 0.14 - z * 0.26))
    * smoothstep(0, 4, Math.abs(shore));
  const beds = (1.16 * Math.sin(x * 0.052 - z * 0.084) + 0.63 * Math.sin(x * 0.16 + z * 0.099))
    * smoothstep(5.0, 31.0, -shore);
  const base = Math.max(-37, Math.min(shelf, 6.4)) + beachRipples + beds;
  const dunes = 18 * dune(x, z, -101, 48, 57, 48)
    + 37 * dune(x, z, -123, -29, 71, 113)
    + 45 * dune(x, z, 136, -29, 82, 128)
    + 17 * dune(x, z, 90, 61, 60, 53)
    + 29 * dune(x, z, -120, -156, 47, 62)
    + 24 * dune(x, z, 117, -143, 45, 67)
    + 7 * dune(x, z, -15, 134, 66, 39);
  const roughGround = (1.05 * Math.sin(x * 0.126 + z * 0.16)
    + 0.68 * Math.sin(z * 0.37 - x * 0.093)
    + 0.19 * Math.sin(x * 0.79 + z * 0.56)) * smoothstep(4, 27, shore + dunes * 0.6);
  const flats = 8.1 * dune(x, z, -39, 26, 13, 16) + 9.9 * dune(x, z, 39, 22, 17, 19);
  let height = base + dunes + roughGround + flats;

  const warpedX = x + 4.4 * Math.sin(z * 0.16 + x * 0.021)
    + 2.8 * Math.sin(z * 0.51 - x * 0.26) + 2.05 * Math.sin(x * 0.34 + z * 0.25);
  const warpedZ = z + 5.1 * Math.sin(x * 0.13 + z * 0.045)
    + 3.0 * Math.sin(x * 0.45 - z * 0.20);
  for (const rock of buttresses) {
    const dx = warpedX - rock.x;
    const dz = warpedZ - rock.z;
    if (Math.abs(dx) > rock.extent || Math.abs(dz) > rock.extent) continue;
    const u = Math.abs((dx * rock.cos + dz * rock.sin) / rock.width);
    const v = Math.abs((-dx * rock.sin + dz * rock.cos) / rock.length);
    const r = Math.hypot(u, v) * 0.72 + Math.max(u, v) * 0.28;
    if (r >= 1.28) continue;

    const bedding = 0.035 * Math.sin(x * 0.081 + z * 0.13)
      + 0.027 * Math.sin(x * 0.34 - z * 0.21) + 0.012 * Math.sin(x * 0.67 + z * 0.57);
    const terrace = 0.036 * Math.sin(x * 0.078 - z * 0.13);
    const face = 0.55 * (1 - smoothstep(0.732, 0.861, r + bedding + terrace));
    const shoulder = 0.25 * (1 - smoothstep(0.90, 1.043, r + bedding*0.54));
    const crest = 0.20 * (1 - smoothstep(0.16, 0.84, r));
    const foothill = 18 * (1 - smoothstep(0.99, 1.245, r));
    const cap = (6.3 * Math.sin(x * 0.103 + z * 0.069) + 4.4 * Math.cos(z * 0.14 - x * 0.18)
      + 2.1 * Math.sin(x * 0.44 + z * 0.50)) * (1 - smoothstep(0.40, 0.98, r));
    const cliff = rock.height * (face + shoulder + crest) + foothill + cap - 7;
    const skirt = 1 - smoothstep(1.08, 1.28, r);
    height = Math.max(height, base + (cliff - base) * skirt);
  }

  // Low limestone fins enclose the inland stretch between the two forest slopes.
  if (x > -112 && x < -66 && z > 93 && z < 130) {
    for (const fin of limestonePassage) {
      const dx = (x - fin.x + 0.8 * Math.sin(z * 1.08)) / fin.width;
      const dz = (z - fin.z + 0.48 * Math.sin(x * 0.83)) / fin.length;
      const radius = Math.hypot(dx, dz);
      const crest = 0.72 + 0.18 * Math.sin(x * 0.36 + z * 0.2) + 0.09 * Math.cos(z * 0.84 - x * 0.38);
      height += fin.height * crest * (1 - smoothstep(0.39, 1.13, radius));
    }
  }
  const inner = 1 - smoothstep(162, 292, Math.abs(x + 15 * Math.sin(z * 0.021)));
  const inland = smoothstep(115, 186, z) * inner;
  if (inland > 0) height += (inlandHeight(x, z) - height) * inland;
  let rockBed = 0;
  for (const bed of surfaceBeds) rockBed = Math.max(rockBed, bed.rise * surfaceBedWeight(x, z, bed));
  height += rockBed;
  if (x < -48 && x > -84 && z > -43 && z < 32) {
    for (const recess of westernRecesses) {
      const reach = dune(x, z, recess.x, recess.z, recess.width, recess.length);
      const apron = recess.grade + (recess.x - x) * 0.24 + 0.63 * Math.sin(z * 0.23 + x * 0.36);
      height -= Math.max(0, height - apron) * reach;
    }
  }
  if (x > 35 && x < 67 && z > 11 && z < 45) {
    for (const pool of tidalPools) {
      const dx = (x - pool.x + 1.03 * Math.sin(z * 0.37)) / pool.width;
      const dz = (z - pool.z + 0.79 * Math.sin(x * 0.41)) / pool.length;
      const patch = 1 - smoothstep(0.48, 1.11, Math.hypot(dx, dz));
      const floor = pool.floor + 0.15 * Math.sin(x * 0.58 + z * 0.72);
      height += (Math.min(height, floor) - height) * patch;
    }
  }
  const edgeX = smoothstep(336, 560, Math.abs(x + 13 * Math.sin(z * 0.031)));
  const inlandEdge = 222 + 32 * Math.sin(x * 0.016) + 17 * Math.sin(x * 0.061) + 315 * inner;
  const edgeZ = smoothstep(inlandEdge, inlandEdge + 107, z);
  const shelfEdge = Math.max(edgeX, edgeZ);
  const coast = height * (1 - shelfEdge) - 29 * shelfEdge;
  if (z < 382) return coast;
  return coast + (uplandHeight(x, z) - coast) * smoothstep(382, 577, z);
}

type TrailAnchor = readonly [x: number, z: number, y: number];
const junction = [-18, 85, 4.4] as const;

function sampleTrail(anchors: readonly TrailAnchor[], closed = true): CoastPoint[] {
  const points: CoastPoint[] = [];
  const count = anchors.length;
  const anchorAt = (index: number) => anchors[closed
    ? (index + count) % count : Math.max(0, Math.min(count - 1, index))];
  for (let index = 0; index < count - Number(!closed); index += 1) {
    const previous = anchorAt(index - 1);
    const start = anchorAt(index);
    const end = anchorAt(index + 1);
    const next = anchorAt(index + 2);
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const steps = Math.ceil(length / 1.01);
    const grade = (end[2] - start[2]) / length;
    const gradeIn = previous === start ? grade
      : (start[2] - previous[2]) / Math.hypot(start[0] - previous[0], start[1] - previous[1]);
    const gradeOut = next === end ? grade
      : (next[2] - end[2]) / Math.hypot(next[0] - end[0], next[1] - end[1]);
    const tangent = (slope: number) => slope * grade > 0 ? length * 2 * slope * grade / (slope + grade) : 0;
    const startTangent = tangent(gradeIn);
    const endTangent = tangent(gradeOut);
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      // Match the grade at adjoining slopes so turns in plan don't produce steps in the tread.
      const curve = (axis: 0 | 1) => {
        const before = previous[axis], a = start[axis], b = end[axis], after = next[axis];
        return a + t * (0.5 * (b - before)
          + t * (before - 2.5 * a + 2 * b - 0.5 * after
          + t * (0.5 * (after - before) + 1.5 * (a - b))));
      };
      const y = start[2] + (end[2] - start[2]) * t * t * (3 - 2 * t)
        + t * (1 - t) * ((1 - t) * startTangent - t * endTangent);
      points.push({ x: curve(0), y, z: curve(1) });
    }
  }
  const [x, z, y] = anchorAt(count - 1);
  points.push(closed ? points[0] : { x, y, z });
  return points;
}

export const COAST_WALKS = [
  {
    id: 'west',
    overlook: { x: -129, z: -7, towardX: 108, towardZ: -116 },
    points: sampleTrail([
      junction, [-29, 78, 4.9], [-36, 64, 4.8], [-40, 46, 3.9], [-49, 29, 3.8],
      [-56, 16, 3.2], [-61, 0, 2.8], [-67, -17, 3.05], [-75, -34, 4.2],
      [-81, -50, 6.7], [-94, -48, 12.0], [-103, -35, 20.2], [-111, -19, 25.8],
      [-118, -10, 29.8], [-129, -7, 32.6], [-147, 4, 26.8], [-159, 26, 18.2],
      [-158, 53, 16.6], [-142, 72, 18.2], [-127, 85, 13.6], [-104, 103, 8.5],
      [-87, 115, 8.0], [-58, 117, 8.2], [-32, 103, 8.5],
    ]),
  },
  {
    id: 'east',
    overlook: { x: 134, z: -15, towardX: -108, towardZ: -178 },
    points: sampleTrail([
      junction, [4, 89, 4.0], [22, 90, 2.8], [39, 87, 4.5], [49, 75, 6.7], [57, 61, 8.8],
      [62, 50, 10.4], [59, 42, 6.1], [57, 36, 3.4], [59, 29, 2.9], [63, 22, 2.95],
      [66, 8, 2.5], [71, -8, 2.15], [77, -26, 2.85], [86, -32, 5.4], [97, -25, 11.2],
      [101, -20, 15.3], [107, -14, 21.6], [115, -10, 28.7], [134, -15, 33.8],
      [143, 6, 35.2], [139, 27, 35.3], [129, 49, 35.9], [110, 62, 33.3],
      [93, 76, 25.5], [74, 93, 16.7], [51, 104, 8.0], [29, 107, 6.4], [12, 101, 4.6],
    ]),
  },
] as const;

const forestFork = [-5, 215, 20.7] as const;
const forestOverlook = [-14, 392, 51] as const;
const creekFork = [57, 287, 22.0] as const;
const lakeApproach = [79, 700, 74.4] as const;
const ridgeApproach = [102, 837, 76.5] as const;
const valleyApproach = [156, 846, 77.8] as const;

export const FOREST_WALKS = [
  { id: 'approach', points: sampleTrail([
    [-32, 103, 8.5], [-40, 123, 10.6], [-37, 139, 12.4], [-25, 152, 14.0], [-21, 168, 15.4],
    [-10, 182, 17.8], [-5, 193, 19.4], [-12, 204, 20.1], forestFork,
  ], false) },
  { id: 'ravine', points: sampleTrail([
    forestFork, [-21, 226, 21.6], [-40, 238, 22.65], [-49, 251, 23.15], [-51, 265, 23.75], [-63, 282, 25.0],
    [-63, 304, 27.9], [-55, 323, 30.5], [-43, 343, 34.8], [-48, 361, 40.5],
    [-38, 381, 47.2], forestOverlook,
  ], false) },
  { id: 'ford', points: sampleTrail([
    forestFork, [13, 221, 20.4], [27, 232, 20.65], [32, 244, 19.95],
    [36, 253, 19.7], [39, 261, 19.13], [38, 276, 20.6],
    creekFork, [68, 307, 26.0], [63, 328, 30.2], [48, 345, 34.8], [32, 360, 39.2],
    [14, 378, 45.0], forestOverlook,
  ], false) },
  { id: 'headwater', points: sampleTrail([
    creekFork, [68, 284, 22.5], [77, 290, 24.05], [82, 301, 25.55], [83, 313, 28.35], [68, 307, 26.0],
  ], false) },
] as const;

export const UPLAND_WALKS = [
  { id: 'saddle', points: sampleTrail([
    forestOverlook, [3, 388, 46.9], [25, 394, 37.9], [47, 402, 34.5], [69, 406, 33.5],
    [93, 416, 32.0], [103, 435, 36.2], [108, 461, 42.2], [111, 486, 45.5], [102, 509, 48.6],
    [82, 527, 51.4], [48, 547, 53.2], [26, 579, 52.7], [22, 619, 55.1], [36, 654, 58.9],
    [57, 677, 64.2], [70, 689, 71.7], lakeApproach,
  ], false) },
  { id: 'lake', points: sampleTrail([
    lakeApproach, [91, 681, 75.2], [121, 671, 72.8], [153, 672, 73.3], [182, 686, 74.3],
    [207, 709, 74.2], [221, 736, 74.7], [234, 762, 78.4], [240, 784, 91.3], [232, 808, 89.4],
    [210, 827, 82.2], [184, 838, 79.0], valleyApproach, [130, 843, 77.6], ridgeApproach,
    [72, 826, 76.2], [52, 797, 76.2], [45, 763, 76.6], [51, 734, 75.8], [63, 712, 75.0],
  ]) },
  { id: 'ridge', points: sampleTrail([
    ridgeApproach, [66, 857, 73.6], [35, 879, 77.2], [6, 897, 81.8], [-26, 910, 87.1],
    [-52, 915, 99.0], [-65, 892, 110.1], [-84, 875, 122.0], [-100, 898, 134.2],
    [-114, 917, 148.0], [-111, 940, 164.2], [-125, 963, 177.4], [-120.5, 975, 181.8], [-122, 987, 175.5],
    [-104, 1008, 160.3], [-92, 1035, 143.8], [-83, 1064, 127.0], [-57, 1082, 109.5],
    [-21, 1094, 95.4], [25, 1081, 86.5], [70, 1057, 80.3], [111, 1019, 80.3],
    [140, 971, 76.3], [172, 917, 70.7], [166, 869, 71.7], valleyApproach,
  ], false) },
] as const;

const inariFork = [231, 948, 83.9] as const;
const inariJoin = [251.2, 1030, 118.1] as const;
const inariEnd = [INARI_INNER_COURT.x, INARI_INNER_COURT.z, INARI_INNER_COURT.y] as const;

/** Two independently walkable stairways climb from the fork to the small hill shrine. */
export const INARI_WALKS = [
  { id: 'inari-entrance', points: sampleTrail([
    valleyApproach, [174, 861, 72.9], [191, 880, 73.2], [202, 893, 75.5], [209, 902, 76.8],
    [215, 913, 78.5], [217.5, 926, 79.0], [222.1, 937, 81.0], inariFork,
  ], false) },
  { id: 'inari-west', points: sampleTrail([
    inariFork, [228.4, 954.5, 84.2], [230.4, 967, 85.0], [234.0, 981, 88.0],
    [237.4, 994, 92.0], [241.1, 1008, 99.8], [244, 1020, 109.4], inariJoin, inariEnd,
  ], false) },
  { id: 'inari-east', points: sampleTrail([
    inariFork, [234.2, 953.7, 84.4], [236.3, 966.3, 86.1], [240.0, 979.5, 89.7],
    [243.8, 993.3, 94.0], [246.7, 1007.7, 101.2], [249.5, 1019.2, 110.9], inariJoin, inariEnd,
  ], false) },
  { id: 'inari-return', points: sampleTrail([
    inariEnd, [246, 1039.3, 119.3], [235, 1037, 112.2], [223, 1031, 104.0], [210, 1026, 97.0],
    [191, 1015, 88.6], [176, 1001, 84.1], [159, 987, 80.5], [140, 971, 76.3],
  ], false) },
] as const;

const TRAIL_CELL = 14;
const TRAIL_SHOULDER = 7.2;
const FOREST_TRAIL_SHOULDER = 16;
type TrailSegment = {
  start: CoastPoint;
  end: CoastPoint;
  inverseLength: number;
  shoulder: number;
  halfTread: number;
  crossfall: number;
};

function trailCellKey(col: number, row: number): number {
  return col * 65_536 + row;
}

const trailCells = new Map<number, TrailSegment[]>();
for (const walk of [...COAST_WALKS, ...FOREST_WALKS, ...UPLAND_WALKS, ...INARI_WALKS]) {
  const forest = walk.id !== 'west' && walk.id !== 'east';
  for (let i = 1; i < walk.points.length; i += 1) {
    const start = walk.points[i - 1];
    const end = walk.points[i];
    const centerX = (start.x + end.x) * 0.5;
    const centerZ = (start.z + end.z) * 0.5;
    const slot = walk.id === 'ravine' ? 1 - smoothstep(26, 47, Math.abs(centerZ - 303)) : 0;
    const broadShoulder = smoothstep(111, 159, centerZ) * (1 - slot);
    const coastCut = forest ? 0 : smoothstep(28, 63, Math.abs(centerX)) * smoothstep(3, 24, start.y);
    const narrowTorii = (walk.id === 'inari-west' || walk.id === 'inari-east') && centerZ > 952 && centerZ < 1028;
    const shoulder = narrowTorii ? 6.8 : TRAIL_SHOULDER
      + (forest ? (FOREST_TRAIL_SHOULDER - TRAIL_SHOULDER) * broadShoulder : 5.4 * coastCut);
    const dx = end.x - start.x, dz = end.z - start.z;
    const inverseLength = 1 / Math.hypot(dx, dz);
    const sideX = -dz * inverseLength, sideZ = dx * inverseLength;
    const lower = landscapeHeight(centerX - sideX * 4.0, centerZ - sideZ * 4.0);
    const higher = landscapeHeight(centerX + sideX * 4.0, centerZ + sideZ * 4.0);
    const crossfall = Math.max(-0.19, Math.min(0.19, (higher - lower) / 8));
    const footing = Math.sin(centerX * 0.12 + centerZ * 0.13) * Math.cos(centerZ * 0.31 - centerX * 0.057);
    const halfTread = 1.46 + footing * 0.30 - slot * 0.21;
    const segment = { start, end, shoulder, inverseLength, halfTread, crossfall };
    const left = Math.floor((Math.min(start.x, end.x) - shoulder) / TRAIL_CELL);
    const right = Math.floor((Math.max(start.x, end.x) + shoulder) / TRAIL_CELL);
    const top = Math.floor((Math.min(start.z, end.z) - shoulder) / TRAIL_CELL);
    const bottom = Math.floor((Math.max(start.z, end.z) + shoulder) / TRAIL_CELL);
    for (let col = left; col <= right; col += 1) {
      for (let row = top; row <= bottom; row += 1) {
        const cell = trailCellKey(col, row);
        const bucket = trailCells.get(cell);
        if (bucket) bucket.push(segment);
        else trailCells.set(cell, [segment]);
      }
    }
  }
}

function trailProjection(segment: TrailSegment, x: number, z: number): number {
  const { start, end, inverseLength } = segment;
  return ((x - start.x) * (end.x - start.x) + (z - start.z) * (end.z - start.z)) * inverseLength ** 2;
}

function sampleNearestTrail(
  x: number, z: number, gradeSurface = true
): { distance: number; grade: number; shoulder: number; halfTread: number } | undefined {
  const key = trailCellKey(Math.floor(x / TRAIL_CELL), Math.floor(z / TRAIL_CELL));
  const segments = trailCells.get(key);
  if (!segments) return undefined;
  let distanceSquared = Infinity;
  let nearest: TrailSegment | undefined;
  for (const segment of segments) {
    const { start, end, shoulder } = segment;
    const t = Math.max(0, Math.min(1, trailProjection(segment, x, z)));
    const candidate = (x - start.x - (end.x - start.x) * t) ** 2 + (z - start.z - (end.z - start.z) * t) ** 2;
    if (candidate >= distanceSquared || candidate >= shoulder * shoulder) continue;
    distanceSquared = candidate;
    nearest = segment;
  }
  if (!nearest) return undefined;
  const distance = Math.sqrt(distanceSquared);
  if (!gradeSurface) return { distance, grade: 0, shoulder: nearest.shoulder, halfTread: nearest.halfTread };

  // Blend adjoining grade planes so the closest segment can change smoothly.
  // Extending those planes past each joint preserves the slope along the tread.
  const gradeBlend = 0.78;
  const edge = distance + gradeBlend;
  let weightTotal = 0, grade = 0, bank = 0, tread = 0;
  for (const segment of segments) {
    const { start, end, inverseLength, shoulder, halfTread, crossfall } = segment;
    const dx = end.x - start.x, dz = end.z - start.z;
    const px = x - start.x, pz = z - start.z;
    const projection = trailProjection(segment, x, z);
    const t = Math.max(0, Math.min(1, projection));
    const segmentDistance = Math.hypot(px - dx * t, pz - dz * t);
    if (segmentDistance > edge || segmentDistance >= shoulder) continue;
    const weight = (1 - smoothstep(distance, edge, segmentDistance))
      * (1 - smoothstep(shoulder - 0.65, shoulder, segmentDistance));
    const side = (pz * dx - px * dz) * inverseLength;
    const extension = gradeBlend * inverseLength;
    const gradeT = Math.max(-extension, Math.min(1 + extension, projection));
    const gradeAtSide = start.y + (end.y - start.y) * gradeT
      + crossfall * side * (1 - smoothstep(1.2, shoulder, Math.abs(side)));
    weightTotal += weight;
    grade += gradeAtSide * weight;
    bank += shoulder * weight;
    tread += halfTread * weight;
  }
  return weightTotal > 0 ? { distance, grade: grade / weightTotal, shoulder: bank / weightTotal,
    halfTread: tread / weightTotal } : undefined;
}

export function coastTrailDistance(x: number, z: number): number {
  return sampleNearestTrail(x, z, false)?.distance ?? Number.POSITIVE_INFINITY;
}

export function coastTreadWear(x: number, z: number): number {
  const trail = sampleNearestTrail(x, z);
  if (!trail) return 0;
  const margins = 0.24 * Math.sin(x * 0.68 + z * 0.37) + 0.21 * Math.cos(x * 0.43 - z * 0.77);
  return 1 - smoothstep(0.5, trail.halfTread + 0.36, trail.distance + margins);
}

export function groundHeight(x: number, z: number): number {
  const terrain = landscapeHeight(x, z);
  const trail = sampleNearestTrail(x, z);
  const fromStart = Math.hypot(x - SPAWN.x, z - SPAWN.z);
  let height = terrain;
  if (trail) {
    const blend = (1 - smoothstep(trail.halfTread, trail.shoulder, trail.distance)) * smoothstep(2.25, 5.2, fromStart);
    const erosion = 0.065 * Math.sin(x * 0.68 + z * 0.81) * Math.cos(0.96 * z - 0.21 * x);
    const footfall = Math.sin(x * 1.19 + z * 0.68) * 0.040 + Math.cos(z * 1.72 - x * 0.63) * 0.028 + erosion;
    height += (trail.grade + footfall - terrain) * blend;
  }
  // The stairs meet a level stone landing at the small shrine's foundation.
  const landing = inariTerraceBlend(x, z, inariShrineLanding, 4.5, 4.6);
  height += (inariShrineLanding.y - height) * landing;
  for (const site of COAST_REST_SITES) {
    const dx = x - site.x, dz = z - site.z;
    if (Math.abs(dx) > 7.6 || Math.abs(dz) > 7.6) continue;
    const radius = Math.hypot(dx, dz);
    const clear = site.kind === 'terrace' ? 2.9 : 1.7;
    height += (site.grade - height) * (1 - smoothstep(clear, clear + 4.6, radius));
  }
  const stream = sampleForestStream(x, z);
  if (stream) {
    const side = Math.abs(stream.side);
    const profile = smoothstep(0.2, 0.9, side / Math.max(stream.halfWidth, 0.4));
    const ford = 1 - smoothstep(2.5, 10, Math.abs(x - 39));
    const pool = 1 - smoothstep(2, 9, Math.abs(x + 20));
    const depth = (0.61 + pool * 0.65 - ford * 0.23) * (1 - 0.90 * profile);
    const bed = stream.y - depth - 0.045 * (1 + Math.sin(x * 0.89 + z * 0.54));
    const bank = stream.y + 0.34 + 0.29 * Math.sin(x * 0.37 + z * 0.31);
    const channel = bed + (bank - bed) * smoothstep(stream.halfWidth * 0.85, stream.halfWidth + 0.25, side);
    const weight = smoothstep(0, 1.1, stream.halfWidth) * (1 - smoothstep(stream.halfWidth + 0.4, stream.halfWidth + 7, side));
    height += (channel - height) * weight;
  }
  return height;
}

export function groundSlope(x: number, z: number, span = 1.35): number {
  return Math.hypot(groundHeight(x + span, z) - groundHeight(x - span, z),
    groundHeight(x, z + span) - groundHeight(x, z - span)) / (2 * span);
}

export type CoastWaterfall = {
  path: CoastPoint[];
  width: number;
  direction: { x: number; z: number };
  impact: CoastPoint;
};

function traceWaterfall(x: number, z: number, angle: number, width: number, level = SEA_LEVEL): CoastWaterfall {
  const direction = { x: Math.cos(angle), z: Math.sin(angle) };
  // Start above the crown and march towards the bay until each elevation
  // clears the face, including the two edges of the sheet.
  const lip = groundHeight(x, z) + 1.3;
  const path: CoastPoint[] = [];
  let run = 0;
  for (let row = 0; row <= 28; row += 1) {
    const drop = row / 28;
    const y = level + (lip - level) * (1 - drop) + 0.2;
    const halfSpan = width * (0.47 + 0.17 * drop);
    let px = x + run * direction.x;
    let pz = z + run * direction.z;
    while (run < 148) {
      const left = groundHeight(px - direction.z * halfSpan, pz + direction.x * halfSpan);
      const right = groundHeight(px + direction.z * halfSpan, pz - direction.x * halfSpan);
      if (Math.max(left, right, groundHeight(px, pz)) < y - 0.44) break;
      run += 0.38;
      px = x + run * direction.x;
      pz = z + run * direction.z;
    }
    path.push({ x: px + direction.x * 0.7, y, z: pz + direction.z * 0.7 });
  }
  return { path, width, direction, impact: path[path.length - 1] };
}

export const COAST_FALLS = [
  traceWaterfall(150, -186, 2.13, 8.6),
  traceWaterfall(-127, -192, 0.57, 7.7),
  traceWaterfall(-48, -383, 0.92, 5.5),
];

export const UPLAND_FALL = traceWaterfall(247, 774, Math.PI - 0.18, 5.4, UPLAND_LAKE.level);

const overlookViews = COAST_WALKS.map(({ overlook }) => {
  const dx = overlook.towardX - overlook.x;
  const dz = overlook.towardZ - overlook.z;
  const length = Math.hypot(dx, dz);
  return { ...overlook, dx: dx / length, dz: dz / length };
});

const waterfallClearings = [...COAST_FALLS, UPLAND_FALL].map(fall => {
  const first = fall.path[0];
  const length = Math.hypot(fall.impact.x - first.x, fall.impact.z - first.z);
  return { ...first, dx: fall.direction.x, dz: fall.direction.z, length, width: fall.width };
});

export function coastPlantingDistance(x: number, z: number): number {
  let distance = coastTrailDistance(x, z);
  if (z >= 900 && z <= 1060 && x >= 179 && x <= 281) {
    const court = Math.hypot((x - INARI_COURT.x) * 0.7, z - INARI_COURT.z);
    const inner = Math.hypot(x - INARI_INNER_COURT.x, z - INARI_INNER_COURT.z);
    distance = Math.min(distance, Math.max(0, court - 12.8), Math.max(0, inner - 7.1));
  }
  if (uplandSpillWetness(x, z) > 0.15) distance = 0;
  for (const site of COAST_REST_SITES) {
    const radius = site.kind === 'terrace' ? 4.5 : 2.7;
    distance = Math.min(distance, Math.max(0, Math.hypot(x - site.x, z - site.z) - radius));
    if (site.id === 'shore-shelter') continue;
    const yaw = restSiteYaw(site);
    const dx = x - site.x, dz = z - site.z;
    const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    const side = Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw));
    const nearView = site.id === 'beach-bench' ? 28 : site.id === 'ridge-bench' ? 94 : 43;
    const cone = site.id === 'ridge-bench' ? 0.61 : 0.22;
    distance = Math.min(distance, Math.max(0, side - cone * along - 2.1, -along, along - nearView));
  }
  if (z > 650 && z < 855 && Math.abs(x - UPLAND_LAKE.x) < 113) {
    distance = Math.min(distance, Math.max(0, (uplandLakeRadius(x, z) - 0.91) * UPLAND_LAKE.width));
  }
  if (z > 219) {
    const vista = Math.hypot((x + 14) * 0.88, (z - 391) * 0.65);
    distance = Math.min(distance, forestStreamDistance(x, z), Math.max(0, vista - 9));
  }
  for (const view of overlookViews) {
    const along = (x - view.x) * view.dx + (z - view.z) * view.dz;
    const side = Math.abs((z - view.z) * view.dx - (x - view.x) * view.dz);
    const width = 4.1 + Math.max(0, along) * 0.32;
    distance = Math.min(distance, Math.max(0, side - width, -along - 4.2, along - 69));
  }
  for (const fall of waterfallClearings) {
    const along = (x - fall.x) * fall.dx + (z - fall.z) * fall.dz;
    const side = Math.abs((z - fall.z) * fall.dx - (x - fall.x) * fall.dz);
    distance = Math.min(distance, Math.max(0, side - fall.width * 0.66, -along - 14, along - fall.length - 6));
  }
  return distance;
}

export const COAST_GROVES = {
  west: { x: -64, z: 67 },
  east: { x: 50, z: 79 },
  shore: { x: -25, z: 91 },
};
