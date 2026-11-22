import * as THREE from 'three';
import { seededDetail } from './overlookModel';

type Point = [number, number];
type Ring = { elevation: number; outline: Point[]; ridge?: number[]; offset?: Point };
type Surface = { color: THREE.ColorRepresentation; facade?: number; glow?: number };

export type SkylineLight = { x: number; y: number; z: number; kind: number; power: number; temperature?: number };

// Commercial cores share the local metre grid with street frontage and street lighting.
export const OVERLOOK_DISTRICTS = {
  campus: [360, -2630],
  exchange: [2220, -3020],
  parkway: [4160, -3670],
  gateway: [6250, -3090],
  west: [640, -3860],
  midtown: [1660, -3890],
  central: [3000, -5440],
  east: [4890, -4900],
  south: [4100, -7350],
  westRidge: [1730, -7460],
  eastRidge: [6550, -7800],
  horizon: [7700, -10650],
} as const;

const diagonalGrid = -0.53;

function rectangle(width: number, depth: number): Point[] {
  return [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]];
}

function chamfer(width: number, depth: number, cut: number): Point[] {
  const w = width / 2, d = depth / 2;
  return [[-w + cut, -d], [w - cut, -d], [w, -d + cut], [w, d - cut],
    [w - cut, d], [-w + cut, d], [-w, d - cut], [-w, -d + cut]];
}

function oval(rx: number, rz: number, sides = 16): Point[] {
  return Array.from({ length: sides }, (_, side) => {
    const angle = (side + 0.5) * 2 * Math.PI / sides;
    return [Math.cos(angle) * rx, Math.sin(angle) * rz];
  });
}

class CityGeometry {
  private readonly positions: number[] = [];
  private readonly shades: number[] = [];
  private readonly facades: number[] = [];
  private readonly color = new THREE.Color();
  private lotGround = 0;
  private lotHeightScale = 1;

  setLotGround(ground: number, heightScale: number): void {
    this.lotGround = ground;
    this.lotHeightScale = heightScale;
  }

  triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, surface: Surface, edgeCoordinate?: [number, number, number]): void {
    this.color.set(surface.color);
    for (const [i, v] of [a, b, c].entries()) {
      const height = this.lotGround + (v.y - this.lotGround) * this.lotHeightScale;
      this.positions.push(v.x, height, v.z);
      this.shades.push(this.color.r, this.color.g, this.color.b);
      this.facades.push(edgeCoordinate?.[i] ?? 0, height, surface.facade ?? 0, surface.glow ?? 0);
    }
  }

  extrusion(x: number, y: number, z: number, yaw: number, rings: Ring[], surface: Surface,
    roofColor: THREE.ColorRepresentation = surface.color): void {
    const cosine = Math.cos(yaw), sine = Math.sin(yaw);
    const world = (ring: Ring, i: number) => {
      const [localX, localZ] = ring.outline[i];
      const u = localX + (ring.offset?.[0] ?? 0);
      const v = localZ + (ring.offset?.[1] ?? 0);
      return new THREE.Vector3(x + u * cosine + v * sine, y + ring.elevation + (ring.ridge?.[i] ?? 0),
        z - u * sine + v * cosine);
    };
    const sideCount = rings[0].outline.length;
    let u = 0;
    for (let face = 0; face < sideCount; face += 1) {
      const next = (face + 1) % sideCount;
      const top = rings[rings.length - 1];
      const left = world(rings[0], face), right = world(rings[0], next);
      const width = left.distanceTo(right);
      const from = u, to = u + width;
      for (let level = 0; level < rings.length - 1; level += 1) {
        const a = world(rings[level], face), b = world(rings[level], next);
        const c = world(rings[level + 1], next), d = world(rings[level + 1], face);
        this.triangle(a, d, c, surface, [from, from, to]);
        this.triangle(a, c, b, surface, [from, to, to]);
      }
      if (face > 0 && face < sideCount - 1) this.triangle(world(top, 0), world(top, next), world(top, face), { color: roofColor, glow: surface.glow });
      u += width;
    }
  }

  finish(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.shades, 3));
    geometry.setAttribute('cityFacade', new THREE.Float32BufferAttribute(this.facades, 4));
    geometry.computeVertexNormals();
    return geometry;
  }
}

type TowerForm = 'terraced' | 'glass' | 'residential' | 'slab' | 'ribbed' | 'split';
type Tower = [x: number, z: number, width: number, depth: number, height: number, form: TowerForm, color: number, yaw?: number];

const limestone = 0xc7bba6;
const pearl = 0xb4c1c3;
const copper = 0x697e79;
const marine = 0x437488;
const steel = 0x64869b;
const blueGray = 0x647787;
const charcoal = 0x55575f;
const sand = 0xa49685;
const oxide = 0x88766d;
const concrete = 0xb2aba1;

const towers: Tower[] = [
  // Clinics and laboratories on the wide streets between the campus and civic center.
  [-82, -3010, 76, 57, 281, 'ribbed', sand, 0.04],
  [70, -3370, 89, 62, 259, 'slab', oxide, 0.04],
  [155, -3070, 81, 57, 249, 'terraced', limestone, 0.04],
  [278, -3280, 98, 75, 340, 'glass', steel, 0.04],
  [450, -3020, 84, 61, 212, 'ribbed', concrete, 0.04],
  [532, -3300, 89, 72, 280, 'terraced', sand, 0.05],

  // Lower westward steps and the civic district.
  [-1510, -4710, 98, 78, 131, 'slab', sand, 0.02],
  [-1240, -4500, 73, 57, 180, 'residential', concrete, 0.04],
  [-1050, -4740, 69, 61, 223, 'terraced', limestone, 0.04],
  [-850, -4320, 76, 68, 141, 'slab', blueGray, 0.05],
  [-615, -4710, 83, 69, 171, 'glass', copper, 0.04],
  [-460, -4110, 74, 57, 169, 'slab', pearl, 0.04],
  [-205, -4480, 71, 61, 239, 'glass', steel, 0.04],
  [-170, -3840, 72, 46, 121, 'slab', sand, 0.03],
  [65, -4185, 98, 72, 273, 'terraced', charcoal, 0.04],
  [250, -3615, 76, 53, 146, 'ribbed', sand, 0.04],
  [355, -3920, 95, 81, 300, 'glass', marine, 0.05],
  [465, -3710, 90, 73, 258, 'slab', blueGray, 0.04],
  [568, -4340, 103, 80, 308, 'terraced', concrete, 0.04],
  [750, -3605, 114, 64, 232, 'residential', sand, 0.05],
  [868, -4060, 77, 75, 338, 'glass', steel, 0.09],
  [961, -3730, 82, 60, 273, 'slab', charcoal, 0.045],
  [1122, -4160, 98, 67, 211, 'terraced', limestone, 0.03],
  [1220, -3970, 77, 62, 281, 'slab', copper, 0.05],

  // Lower high street in front of the main core.
  [1390, -4130, 85, 73, 173, 'terraced', pearl, 0.02],
  [1430, -3550, 64, 47, 179, 'ribbed', concrete, 0.07],
  [1610, -4110, 105, 61, 227, 'slab', steel, 0.055],
  [1718, -4310, 115, 75, 232, 'terraced', charcoal, 0.04],
  [1860, -3920, 79, 53, 208, 'glass', copper, 0.06],
  [1930, -4230, 83, 67, 161, 'slab', concrete, 0.025],
  [2040, -4530, 116, 76, 238, 'ribbed', limestone, -0.12],

  // Central blocks, alternating glass curtain walls and masonry towers.
  [2140, -5300, 121, 96, 358, 'terraced', charcoal],
  [2270, -4970, 133, 86, 270, 'ribbed', limestone],
  [2315, -5770, 102, 95, 408, 'glass', steel],
  [2445, -5380, 108, 100, 405, 'terraced', sand],
  [2535, -5060, 118, 91, 306, 'slab', blueGray],
  [2600, -5915, 111, 100, 400, 'slab', copper],
  [2685, -4700, 114, 77, 248, 'slab', pearl],
  [2800, -6025, 129, 91, 529, 'terraced', charcoal],
  [2730, -5205, 101, 83, 383, 'glass', marine],
  [2970, -5780, 99, 113, 484, 'slab', concrete],
  [3010, -4890, 110, 81, 297, 'terraced', sand],
  [3185, -6105, 137, 94, 512, 'glass', steel],
  [3305, -5180, 107, 87, 330, 'split', pearl],
  [3540, -5200, 108, 73, 269, 'slab', sand],
  [3570, -5630, 106, 91, 460, 'terraced', charcoal],
  [3650, -5975, 110, 65, 350, 'slab', blueGray],
  [3885, -5395, 108, 79, 284, 'ribbed', concrete],
  [3930, -5830, 113, 81, 407, 'terraced', limestone],
  [4050, -6130, 123, 73, 369, 'glass', copper],
  [4345, -5740, 88, 67, 246, 'slab', steel],

  // The eastern terraces step down around an open valley.
  [4210, -4890, 118, 69, 216, 'terraced', concrete, -0.10],
  [4380, -5100, 109, 77, 279, 'slab', charcoal, -0.10],
  [4530, -4830, 107, 76, 321, 'glass', steel, -0.14],
  [4685, -5150, 112, 91, 401, 'terraced', limestone, -0.22],
  [4785, -4635, 123, 74, 224, 'ribbed', sand, -0.15],
  [4940, -5275, 103, 89, 391, 'slab', blueGray, -0.18],
  [5040, -4530, 91, 60, 278, 'glass', copper, -0.10],
  [5060, -5100, 116, 75, 348, 'split', pearl, -0.15],
  [5375, -5680, 100, 71, 262, 'slab', steel, -0.10],
  [5440, -5585, 109, 84, 310, 'terraced', limestone],
  [5695, -5820, 89, 76, 201, 'slab', sand],
  [6035, -5690, 93, 70, 232, 'glass', steel],
  [6245, -5570, 119, 76, 277, 'glass', blueGray],
  [6505, -5720, 96, 81, 294, 'terraced', copper],
  [6735, -5480, 106, 73, 209, 'residential', limestone],
  [6930, -5730, 132, 67, 229, 'slab', blueGray],

  // Distant office belt east of the valley, beyond the closest high-rises.
  [7270, -5450, 135, 101, 224, 'slab', sand],
  [7515, -4970, 114, 83, 276, 'ribbed', oxide, -0.24],
  [7765, -5400, 138, 98, 342, 'terraced', steel, -0.19],
  [7920, -5010, 120, 94, 322, 'glass', marine, -0.21],
  [8295, -5190, 143, 125, 414, 'terraced', concrete, -0.20],
  [8515, -4870, 134, 78, 309, 'split', pearl, -0.14],
  [8720, -5240, 132, 96, 365, 'slab', copper, -0.24],
  [8970, -5280, 102, 92, 265, 'glass', steel, -0.15],
  [9280, -5100, 112, 104, 213, 'terraced', sand, -0.12],

  // South-bank silhouettes behind the nearer cores.
  [3380, -7720, 125, 86, 292, 'terraced', concrete],
  [3655, -7200, 106, 77, 295, 'slab', steel],
  [3810, -7860, 139, 115, 345, 'ribbed', sand],
  [4005, -7350, 120, 95, 414, 'glass', blueGray],
  [4295, -7030, 107, 81, 423, 'terraced', copper],
  [4500, -7700, 123, 83, 397, 'slab', charcoal],
  [4660, -8200, 104, 77, 326, 'terraced', limestone],
  [4815, -7350, 92, 87, 293, 'glass', steel],
  [5080, -7710, 110, 72, 270, 'slab', sand],
  [5300, -7420, 102, 79, 236, 'terraced', concrete],
  [5490, -8020, 88, 75, 229, 'terraced', steel],
];

type CommercialGrid = {
  center: readonly [number, number];
  spacing: number;
  yaw: number;
  roofHeights: readonly number[][];
  styles: readonly (readonly [TowerForm, number])[];
};

// Each row follows a local street. Empty lots leave plazas, junctions and gaps in the roofline.
const commercialGrids: CommercialGrid[] = [
  {
    // University offices, clinics and a hotel around the near western square.
    center: OVERLOOK_DISTRICTS.campus, spacing: 157, yaw: 0.04,
    roofHeights: [
      [160, 205, 286, 0, 231, 330, 186],
      [234, 314, 0, 397, 287, 372, 258],
      [190, 270, 321, 243, 443, 328, 0],
      [0, 218, 185, 218, 0, 197, 173],
    ],
    styles: [['ribbed', limestone], ['terraced', pearl], ['glass', steel], ['ribbed', copper], ['slab', oxide]],
  }, {
    // Trading floors and hotel wings gather around the principal interchange.
    center: OVERLOOK_DISTRICTS.exchange, spacing: 179, yaw: -0.36,
    roofHeights: [
      [214, 0, 286, 0, 367, 298, 191],
      [288, 370, 454, 381, 546, 0, 303],
      [223, 329, 416, 0, 367, 480, 278],
      [0, 185, 264, 230, 0, 304, 221],
    ],
    styles: [['glass', marine], ['terraced', concrete], ['split', steel], ['slab', charcoal], ['ribbed', limestone]],
  }, {
    // Offices and hotels on either side of an open parkway below the eastern shoulder.
    center: OVERLOOK_DISTRICTS.parkway, spacing: 169, yaw: -0.24,
    roofHeights: [
      [215, 310, 0, 344, 190, 240],
      [285, 379, 0, 327, 405, 0],
      [275, 0, 0, 268, 365, 287],
      [211, 295, 223, 0, 225, 0],
    ],
    styles: [['ribbed', limestone], ['glass', marine], ['terraced', sand], ['split', steel], ['slab', blueGray]],
  }, {
    // The long easterly grid faces the arterial with research and corporate campuses.
    center: OVERLOOK_DISTRICTS.gateway, spacing: 196, yaw: -0.19,
    roofHeights: [
      [193, 303, 366, 0, 270, 351, 206, 0, 291],
      [0, 362, 490, 342, 558, 423, 330, 0, 350],
      [242, 423, 0, 374, 469, 0, 298, 311, 261],
      [191, 0, 264, 321, 0, 352, 240, 0, 0],
    ],
    styles: [['split', blueGray], ['glass', steel], ['slab', copper], ['glass', marine], ['terraced', sand]],
  }, {
    // Pale stone archive and municipal towers behind the civic district.
    center: OVERLOOK_DISTRICTS.westRidge, spacing: 213, yaw: 0.12,
    roofHeights: [
      [240, 288, 0, 344, 275, 237, 0],
      [252, 372, 451, 375, 433, 291, 259],
      [320, 0, 323, 298, 0, 353, 255],
      [0, 276, 237, 0, 226, 240, 210],
    ],
    styles: [['ribbed', limestone], ['terraced', sand], ['slab', oxide], ['ribbed', concrete], ['glass', copper]],
  }, {
    // Tall office plates, rotated on the other side of the cross-town viaduct.
    center: OVERLOOK_DISTRICTS.eastRidge, spacing: 221, yaw: -0.56,
    roofHeights: [
      [293, 354, 0, 418, 303, 422, 259],
      [321, 468, 527, 376, 477, 0, 308],
      [0, 329, 413, 0, 379, 520, 373],
      [240, 0, 289, 356, 0, 274, 245],
    ],
    styles: [['slab', charcoal], ['glass', marine], ['split', steel], ['terraced', blueGray], ['ribbed', concrete]],
  }, {
    // Distant commercial roofs continue as separated clusters against the basin rim.
    center: OVERLOOK_DISTRICTS.horizon, spacing: 278, yaw: -0.24,
    roofHeights: [
      [280, 332, 412, 0, 354, 430, 377, 292],
      [333, 461, 0, 0, 440, 563, 420, 330],
      [268, 415, 330, 308, 0, 388, 354, 295],
    ],
    styles: [['terraced', marine], ['glass', blueGray], ['slab', concrete], ['ribbed', steel], ['split', copper]],
  },
];

function commercialTowers(): Tower[] {
  const lots: Tower[] = [];
  for (const { center: [x, z], spacing, yaw, roofHeights, styles } of commercialGrids) {
    const random = seededDetail(Math.imul(x, 27173) + Math.imul(z, 65539));
    const cosine = Math.cos(yaw), sine = Math.sin(yaw);
    for (const [row, heights] of roofHeights.entries()) {
      for (const [column, height] of heights.entries()) {
        if (height === 0) continue;
        const u = (column - (heights.length - 1) / 2) * spacing + (random() - 0.5) * 29;
        const v = (row - (roofHeights.length - 1) / 2) * spacing * 0.88 + (random() - 0.5) * 22;
        const [form, color] = styles[Math.floor(random() * styles.length)];
        const width = 60 + height * 0.071 + random() * 29;
        const depth = width * (0.61 + random() * 0.26);
        lots.push([x + u * cosine + v * sine, z - u * sine + v * cosine, width, depth, height, form, color, yaw]);
      }
    }
  }
  return lots;
}

export function createOverlookSkyline(
  heightAt: (x: number, z: number) => number,
  blocksFootprint?: (x: number, z: number, padding: number) => boolean,
) {
  const builder = new CityGeometry();
  const lights: SkylineLight[] = [];
  const exclusions: Array<{ x: number; z: number; radius: number }> = [];

  const building = (x: number, z: number, radius: number, shape: (x: number, y: number, z: number) => void) => {
    const step = radius + 31;
    const candidateOffsets: Point[] = [[0, 0],
      [-step, 0], [step, 0], [0, -step], [0, step],
      [-step * 0.86, -step * 0.86], [step * 0.86, -step * 0.86], [-step * 0.86, step * 0.86], [step * 0.86, step * 0.86]];
    const clear = (cx: number, cz: number) => !blocksFootprint?.(cx, cz, radius)
      && !exclusions.some(existing =>
        (cx - existing.x) ** 2 + (cz - existing.z) ** 2 < ((radius + existing.radius) * 0.90) ** 2);
    const offset = candidateOffsets.find(([dx, dz]) => clear(x + dx, z + dz));
    if (!offset) return;
    x += offset[0];
    z += offset[1];
    exclusions.push({ x, z, radius });
    const sample = radius * 0.65;
    const ground = Math.min(heightAt(x, z), heightAt(x - sample, z), heightAt(x + sample, z),
      heightAt(x, z + sample), heightAt(x, z - sample));
    // Bring out the nearest commercial blocks while preserving a second skyline in the basin beyond.
    const heightScale = THREE.MathUtils.lerp(0.79, 0.94, THREE.MathUtils.smoothstep(Math.hypot(x, z), 3950, 9900));
    const firstLight = lights.length;
    builder.setLotGround(ground, heightScale);
    shape(x, ground - 3, z);
    for (let i = firstLight; i < lights.length; i++) {
      lights[i].y = ground + (lights[i].y - ground) * heightScale;
    }
  };
  const floor = (x: number, y: number, z: number, w: number, d: number, h: number, surface: Surface,
    yaw = diagonalGrid, cut = 0) => {
    const outline = cut > 0 ? chamfer(w, d, cut) : rectangle(w, d);
    builder.extrusion(x, y, z, yaw, [{ elevation: 0, outline }, { elevation: h, outline }], surface, 0x929293);
  };
  const beacon = (x: number, y: number, z: number, power = 0.75) => lights.push({ x, y, z, kind: 4, power });

  // A pale civic tower, with deep shoulders and a cupola on an octagonal drum.
  building(635, -3880, 110, (x, y, z) => {
    floor(x, y, z, 175, 124, 28, { color: sand, facade: 0.71 }, 0.04, 7);
    const shaft = chamfer(119, 93, 12);
    const shoulder = chamfer(92, 73, 10);
    const crown = chamfer(72, 61, 10);
    builder.extrusion(x, y, z, 0.04, [
      { elevation: 23, outline: shaft },
      { elevation: 180, outline: shaft },
      { elevation: 195, outline: shoulder },
      { elevation: 285, outline: shoulder },
      { elevation: 303, outline: crown },
      { elevation: 340, outline: crown },
    ], { color: limestone, facade: 0.75 });
    floor(x, y + 338, z, 78, 66, 7, { color: pearl, glow: 0.15 }, 0.04, 9);
    builder.extrusion(x, y, z, 0.04, [
      { elevation: 345, outline: oval(33, 27, 8) },
      { elevation: 363, outline: oval(30, 25, 8) },
      { elevation: 386, outline: oval(17, 14, 8) },
      { elevation: 391, outline: oval(7, 6, 8) },
    ], { color: copper, glow: 0.16 }, pearl);
    beacon(x, y + 393, z, 0.70);
  });

  // Wide split top over the shorter midtown ridge.
  building(1640, -3740, 113, (x, y, z) => {
    floor(x, y, z, 178, 131, 24, { color: concrete, facade: 0.76 }, 0.08, 8);
    floor(x - 32, y + 20, z - 5, 76, 92, 323, { color: steel, facade: 0.69 }, 0.08, 11);
    floor(x + 40, y + 20, z + 6, 73, 76, 268, { color: marine, facade: 0.58 }, 0.08, 8);
    floor(x + 3, y + 208, z, 130, 66, 19, { color: charcoal, glow: 0.24 }, 0.08, 7);
    floor(x - 32, y + 342, z - 5, 78, 87, 9, { color: pearl, glow: 0.27 }, 0.08, 10);
    beacon(x - 32, y + 352, z - 5, 0.85);
  });

  // The main crown rises off centre. A stone fin and two shorter glass wings frame it.
  building(2975, -5515, 138, (x, y, z) => {
    floor(x, y, z, 215, 162, 39, { color: limestone, facade: 0.77 }, diagonalGrid, 13);
    const lower = chamfer(149, 125, 20);
    const upper = chamfer(128, 107, 20);
    const crown = chamfer(92, 90, 17);
    const crownOffset: Point = [14, 6];
    const crownRidge = [24, 30, -2, -12, -18, -17, 7, 16];
    builder.extrusion(x, y, z, diagonalGrid, [
      { elevation: 34, outline: lower },
      { elevation: 436, outline: lower },
      { elevation: 568, outline: upper, offset: [5, 0] },
      { elevation: 670, outline: crown, offset: crownOffset, ridge: crownRidge },
    ], { color: marine, facade: 0.62 }, 0x8ca7b2);
    builder.extrusion(x, y, z, diagonalGrid, [
      { elevation: 670, outline: crown, offset: crownOffset, ridge: crownRidge },
      { elevation: 681, outline: chamfer(93, 91, 17), offset: crownOffset, ridge: crownRidge },
    ], { color: 0x9eafb5, glow: 0.42 }, 0x879ea7);
    const wing = chamfer(78, 115, 14);
    const upperWing = chamfer(62, 84, 12);
    const [westWingX, westWingZ] = [x - 60, z - 32];
    builder.extrusion(westWingX, y, westWingZ, diagonalGrid, [
      { elevation: 37, outline: wing },
      { elevation: 355, outline: wing },
      { elevation: 457, outline: upperWing, ridge: [10, 18, 10, 5, -6, -6, -4, 0] },
    ], { color: 0x638496, facade: 0.77 }, pearl);
    floor(x + 62, y + 37, z + 25, 62, 88, 398, { color: steel, facade: 0.73 }, diagonalGrid, 8);
    floor(x + 62, y + 435, z + 25, 61, 87, 8, { color: pearl, glow: 0.21 }, diagonalGrid, 8);
    const fin = chamfer(19, 63, 5);
    builder.extrusion(x - 53, y, z + 38, diagonalGrid, [
      { elevation: 181, outline: fin },
      { elevation: 450, outline: fin },
      { elevation: 560, outline: chamfer(16, 54, 5), offset: [3, 3] },
      { elevation: 650, outline: chamfer(14, 45, 4), offset: [10, -1] },
    ], { color: 0xa0b5b6, glow: 0.11 });
    builder.extrusion(x - 53, y, z + 38, diagonalGrid, [
      { elevation: 649, outline: chamfer(14, 45, 4), offset: [10, -1] },
      { elevation: 730, outline: chamfer(11, 32, 4), offset: [22, -12], ridge: [5, 9, 4, 6, -6, -6, -8, -5] },
    ], { color: pearl, glow: 0.26 });
    beacon(x - 41, y + 740, z + 37, 1.05);
  });

  // A tapered oval capped by a broad mechanical ring.
  building(2600, -5540, 108, (x, y, z) => {
    floor(x, y, z, 163, 127, 32, { color: sand, facade: 0.71 }, diagonalGrid, 11);
    const base = oval(60, 52);
    const middle = oval(61, 54);
    const upper = oval(48, 45);
    builder.extrusion(x, y, z, -0.24, [
      { elevation: 30, outline: base },
      { elevation: 292, outline: middle },
      { elevation: 496, outline: upper },
    ], { color: 0x647e85, facade: 0.60 }, pearl);
    builder.extrusion(x, y, z, -0.24, [
      { elevation: 496, outline: upper },
      { elevation: 503, outline: oval(49, 46) },
      { elevation: 513, outline: oval(49, 46) },
    ], { color: 0x9cb4bb, glow: 0.39 }, pearl);
    const cap = oval(41, 37);
    builder.extrusion(x, y, z, -0.24, [
      { elevation: 512, outline: cap },
      { elevation: 539, outline: oval(35, 32) },
      { elevation: 544, outline: oval(28, 27) },
    ], { color: 0x516d77, facade: 0.85 }, pearl);
    beacon(x, y + 546, z, 0.90);
  });

  // Offset blue volumes leave a sky lobby between two tiers of roof terraces.
  building(3400, -5720, 129, (x, y, z) => {
    floor(x, y, z, 196, 158, 32, { color: concrete, facade: 0.77 }, diagonalGrid, 12);
    floor(x, y + 25, z, 155, 119, 224, { color: marine, facade: 0.60 }, diagonalGrid, 11);
    floor(x, y + 249, z, 143, 108, 12, { color: pearl, glow: 0.18 }, diagonalGrid, 9);
    floor(x + 22, y + 255, z - 21, 89, 87, 45, { color: charcoal, facade: 0.55 }, diagonalGrid, 7);
    floor(x + 17, y + 294, z - 19, 123, 99, 191, { color: 0x718faa, facade: 0.76 }, diagonalGrid, 12);
    floor(x + 17, y + 485, z - 19, 128, 101, 10, { color: pearl, glow: 0.21 }, diagonalGrid, 13);
    floor(x + 24, y + 495, z - 40, 74, 64, 51, { color: blueGray, facade: 0.55 }, diagonalGrid, 6);
    floor(x + 26, y + 546, z - 43, 52, 53, 9, { color: pearl, glow: 0.24 }, diagonalGrid, 6);
    beacon(x + 26, y + 557, z - 43, 0.80);
  });

  // Eastern pair with staggered crowns and contrasting terrace edges.
  building(4870, -4910, 148, (x, y, z) => {
    floor(x, y, z, 226, 167, 26, { color: concrete, facade: 0.71 }, -0.20, 10);
    const pairs = [[-53, -21, 520, 104], [48, 27, 426, 84]];
    for (const [dx, dz, height, width] of pairs) {
      const base = chamfer(width, 93, 11);
      const upper = chamfer(width * 0.80, 78, 10);
      builder.extrusion(x + dx, y, z + dz, -0.20, [
        { elevation: 22, outline: base },
        { elevation: height * 0.60, outline: base },
        { elevation: height * 0.62, outline: upper },
        { elevation: height - 14, outline: upper },
      ], { color: copper, facade: 0.63 }, pearl);
      for (const band of [0.24, 0.32, 0.40, 0.48, 0.57, 0.74, 0.84, 0.93]) {
        const setback = band > 0.60 ? 0.82 : 1.02;
        floor(x + dx, y + height * band, z + dz, width * setback, 93 * setback, 3.1, { color: pearl }, -0.20, 11);
      }
      floor(x + dx, y + height - 14, z + dz, width * 0.80, 78, 11, { color: pearl, glow: 0.25 }, -0.20, 10);
      floor(x + dx + 4, y + height - 3, z + dz - 7, width * 0.58, 52, 14, { color: blueGray, facade: 0.61 }, -0.20, 7);
      beacon(x + dx + 4, y + height + 12, z + dz - 7, 0.80);
    }
  });

  // Sunken ballpark with interrupted seating tiers and an open outfield.
  building(5565, -4944, 127, (x, y, z) => {
    const seatColor = [0x738798, 0xa4a194, 0x8c9eaa, 0x9aa492, 0x93a2a3];
    for (let band = 0; band < seatColor.length; band += 1) {
      const radius = 76 + band * 11;
      for (let section = 0; section < 26; section += 1) {
        const a = 0.72 + section * 0.187;
        const b = a + 0.181;
        const outline: Point[] = [[Math.cos(a) * radius, Math.sin(a) * radius * 0.87],
          [Math.cos(b) * radius, Math.sin(b) * radius * 0.87],
          [Math.cos(b) * (radius + 12), Math.sin(b) * (radius + 12) * 0.87],
          [Math.cos(a) * (radius + 12), Math.sin(a) * (radius + 12) * 0.87]].reverse() as Point[];
        builder.extrusion(x, y - 15, z, -0.79, [
          { elevation: 0, outline }, { elevation: 16 + band * 5.2, outline },
        ], { color: seatColor[band], glow: band === 0 ? 0.04 : 0 });
      }
    }
    const field = oval(81, 72, 22);
    builder.extrusion(x, y - 15, z, -0.79, [{ elevation: 1, outline: field }, { elevation: 13, outline: field }],
      { color: 0x4f6a45 }, 0x597648);
    for (const offset of [-96, 96]) {
      floor(x + offset, y, z + 38, 3.1, 3.1, 43, { color: 0xa8a59d }, 0);
      floor(x + offset, y + 41, z + 38, 13, 2.7, 5, { color: 0x9ea6af, glow: 0.44 }, 0);
      lights.push({ x: x + offset, y: y + 43, z: z + 38, kind: 2, power: 1.15 });
    }
  });

  for (const [x, z, w, d, h, form, color, yaw = diagonalGrid] of [...towers, ...commercialTowers()]) {
    const podiumHeight = 10 + Math.min(h * 0.075, 25);
    building(x, z, Math.hypot(w * 0.64, d * 0.65) + 3, (x, y, z) => {
      floor(x, y, z, w * 1.28, d * 1.30, podiumHeight, { color: concrete, facade: 0.66 }, yaw, 6);
      const elevation = podiumHeight - 2;
      const footprint = chamfer(w, d, Math.min(11, d * 0.18));
      if (form === 'terraced') {
        const shoulder = chamfer(w * 0.82, d * 0.85, 8);
        const upper = chamfer(w * 0.67, d * 0.70, 7);
        builder.extrusion(x, y, z, yaw, [
          { elevation, outline: footprint },
          { elevation: h * 0.62, outline: footprint },
          { elevation: h * 0.62, outline: shoulder },
          { elevation: h * 0.83, outline: shoulder },
          { elevation: h * 0.83, outline: upper },
          { elevation: h - 11, outline: upper },
        ], { color, facade: 0.77 });
        floor(x, y + h - 11, z, w * 0.67, d * 0.70, 7, { color: pearl }, yaw, 7);
        floor(x, y + h - 4, z, w * 0.48, d * 0.48, 6, { color: color, glow: 0.17 }, yaw, 5);
      } else if (form === 'glass') {
        const crown = chamfer(w * 0.76, d * 0.83, 12);
        const offset: Point = [w * 0.075, -d * 0.06];
        builder.extrusion(x, y, z, yaw, [
          { elevation, outline: footprint },
          { elevation: h * 0.38, outline: footprint },
          { elevation: h - 14, outline: crown, offset },
        ], { color, facade: 0.62 }, pearl);
        builder.extrusion(x, y, z, yaw, [
          { elevation: h - 14, outline: crown, offset },
          { elevation: h + 2, outline: crown, offset, ridge: [5, 4, 12, 11, -3, -4, -5, 3] },
        ], { color: 0x7193a5, glow: 0.24 }, pearl);
      } else if (form === 'ribbed') {
        // Light stone mullions in front of the continuous office glazing.
        floor(x, y + elevation, z, w * 0.96, d * 0.88, h - elevation - 10, { color, facade: 0.64 }, yaw, 8);
        const cosine = Math.cos(yaw), sine = Math.sin(yaw);
        for (const along of [-0.40, -0.20, 0, 0.20, 0.40]) {
          floor(x + along * w * cosine + d * 0.44 * sine, y + elevation, z - along * w * sine + d * 0.44 * cosine,
            3.3, 3.9, h - elevation - 8, { color: pearl }, yaw);
        }
        const ledge = h * 0.64;
        floor(x, y + ledge, z, w, d * 0.95, 4, { color: limestone, glow: -0.22 }, yaw, 8);
        floor(x, y + h - 10, z, w, d * 0.94, 7, { color: limestone, glow: -0.21 }, yaw, 8);
        floor(x, y + h - 3, z, w * 0.75, d * 0.69, 12, { color: charcoal, facade: 0.55 }, yaw, 5);
      } else if (form === 'split') {
        // A sky lobby connects the double core beneath the staggered office floors.
        const cosine = Math.cos(yaw), sine = Math.sin(yaw);
        const lobby = h * 0.45;
        floor(x, y + elevation, z, w * 0.96, d, lobby - elevation, { color, facade: 0.58 }, yaw, 7);
        floor(x, y + lobby, z, w, d * 0.94, 8, { color: pearl, glow: -0.30 }, yaw, 7);
        for (const [offset, height, width, depth] of [[-0.24, h, w * 0.48, d * 0.88], [0.28, h * 0.82, w * 0.42, d * 0.78]]) {
          const wingX = x + offset * w * cosine, wingZ = z - offset * w * sine;
          floor(wingX, y + lobby + 8, wingZ, width, depth, height - lobby - 15, { color, facade: 0.71 }, yaw, 6);
          floor(wingX, y + height - 7, wingZ, width, depth, 6, { color: pearl, glow: 0.26 }, yaw, 6);
          floor(wingX, y + height - 1, wingZ, width * 0.86, depth * 0.69, 11, { color: blueGray }, yaw, 5);
          if (h >= 390) lights.push({ x: wingX, y: y + height - 1, z: wingZ + depth * 0.51, kind: 3,
            power: 0.43, temperature: offset < 0 ? 0.92 : 0.45 });
        }
      } else if (form === 'residential') {
        floor(x, y + elevation, z, w * 0.91, d * 0.88, h - elevation, { color, facade: 0.94 }, yaw, 8);
        // Slabs project past the blue-gray recessed windows and read as paired terraces from the deck.
        for (let band = 1; band <= 8; band += 1) {
          const level = elevation + (h - elevation - 5) * band / 9;
          floor(x, y + level, z, w, d, 2.7, { color: pearl }, yaw, 9);
        }
        floor(x, y + h - 4, z, w * 0.97, d * 0.95, 9, { color: pearl, glow: 0.10 }, yaw, 9);
        floor(x, y + h + 5, z, w * 0.52, d * 0.55, 13, { color, facade: 0.86 }, yaw, 5);
      } else {
        floor(x, y + elevation, z, w, d, h - elevation - 14, { color, facade: 0.65 }, yaw, 3);
        floor(x, y + h - 14, z, w, d, 8, { color: charcoal, glow: 0.16 }, yaw, 3);
        floor(x, y + h - 6, z, w * 0.77, d * 0.79, 15, { color: pearl }, yaw, 3);
      }
      const beaconHeight = { terraced: 3, glass: 15, residential: 19, slab: 10, ribbed: 10, split: 11 };
      if (h >= 310) beacon(x, y + h + beaconHeight[form], z, 0.55);
    });
  }

  // Broad office and station blocks create a second roofline around the taller towers.
  const frontage = [
    [185, -4200, 143, 85, 92, sand, 0.03],
    [510, -3960, 126, 80, 132, pearl, 0.06],
    [842, -3838, 133, 79, 115, oxide, 0.04],
    [1050, -3860, 121, 78, 110, limestone, 0.02],
    [1185, -3680, 133, 72, 83, blueGray, 0.03],
    [1460, -3850, 136, 78, 108, concrete, 0.02],
    [1855, -4285, 159, 90, 100, limestone, 0.04],
    [2150, -4790, 171, 98, 106, oxide, diagonalGrid],
    [2460, -4720, 154, 106, 113, concrete, diagonalGrid],
    [2710, -4850, 162, 103, 142, steel, diagonalGrid],
    [2900, -4920, 149, 112, 161, pearl, diagonalGrid],
    [3135, -5030, 167, 113, 143, oxide, diagonalGrid],
    [3330, -4870, 137, 101, 86, limestone, diagonalGrid],
    [3775, -5490, 144, 90, 133, sand, diagonalGrid],
    [4570, -4970, 161, 94, 139, pearl, -0.16],
    [4650, -4660, 172, 106, 106, oxide, -0.18],
    [5180, -4740, 139, 93, 78, sand, -0.15],
    [8020, -5210, 144, 104, 101, concrete, -0.21],
    [8665, -4910, 150, 98, 116, sand, -0.17],
  ];
  for (const [x, z, width, depth, height, color, yaw] of frontage) {
    building(x, z, Math.hypot(width * 0.5, depth * 0.5) + 3, (x, y, z) => {
      floor(x, y, z, width, depth, height, { color, facade: 0.78 }, yaw, 6);
      floor(x, y + height, z, width * 0.93, depth * 0.88, 5, { color: pearl }, yaw, 5);
    });
  }

  return { geometry: builder.finish(), lights, exclusions };
}
