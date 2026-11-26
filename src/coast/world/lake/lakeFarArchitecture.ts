import { Color, MathUtils, Vector3 } from 'three';
import type { PlantSurface } from '../coastTreeMeshes';

type Volume = readonly [left: number, right: number, front: number, back: number, bottom: number, top: number];
type AddVolume = (volume: Volume, color: Color, shade?: number) => void;
type Vertex = readonly [x: number, y: number, z: number];

const stone = new Color(0x8c98a3);
const darkStone = new Color(0x667786);
const upright = new Color(0x8b9dad);
const glazing = new Color(0x687f95);
const roof = new Color(0x9babba);
const paleStone = new Color(0xcfb9a0);
const paleCoping = new Color(0xffdebb);
const gravelBounce = new Color(0xb3b1a5);
const terraceCourse = new Color(0xb8b4ab);

function volumeBuilder(surface: PlantSurface, pivotX = 0, pivotZ = 0, yaw = 0): AddVolume {
  const point = new Vector3();
  const tint = new Color();
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return ([left, right, front, back, bottom, top], color, shade = 1) => {
    const face = (a: Vertex, b: Vertex, c: Vertex, d: Vertex, light: number) => {
      const [ia, ib, ic, id] = [a, b, c, d].map(([x, y, z]) => {
        const across = x - pivotX;
        const along = z - pivotZ;
        point.set(pivotX + across * cos + along * sin, y, pivotZ - across * sin + along * cos);
        const bounce = 0.30 * (1 - MathUtils.smoothstep(y, 6, 24));
        return surface.point(point, tint.copy(color).lerp(gravelBounce, bounce), shade * light);
      });
      surface.triangle(ia, ib, ic);
      surface.triangle(ib, id, ic);
    };
    face([left, bottom, front], [right, bottom, front], [left, top, front], [right, top, front], 1);
    face([right, bottom, front], [right, bottom, back], [right, top, front], [right, top, back], 0.84);
    face([left, bottom, back], [left, bottom, front], [left, top, back], [left, top, front], 0.72);
    face([right, bottom, back], [left, bottom, back], [right, top, back], [left, top, back], 0.81);
    face([left, top, front], [right, top, front], [left, top, back], [right, top, back], 1.09);
    face([left, bottom, back], [right, bottom, back], [left, bottom, front], [right, bottom, front], 0.61);
  };
}

function addPlinth(add: AddVolume, volume: Volume, color: Color = stone): void {
  const [left, right, front, back, bottom, top] = volume;
  add([left, right, front, back, bottom, top - 0.92], color, 0.84);
  add([left - 0.45, right + 0.38, front + 0.36, back - 0.33, top - 0.92, top - 0.52], color, 0.69);
  add([left - 0.62, right + 0.52, front + 0.58, back - 0.52, top - 0.52, top], color, 1.13);
}

type Shaft = {
  volume: Volume;
  sill: number;
  bays: number;
  spacing: number;
  setBack: number;
  pierStops: readonly number[];
};

// The jambs turn around the corners. The window field and its mullions are set inside the shell.
function addShaft(add: AddVolume, shaft: Shaft): void {
  const { volume, sill, bays, spacing, setBack, pierStops } = shaft;
  const [left, right, front, back, bottom, top] = volume;
  const width = right - left;
  const inset = front - setBack;
  const jamb = Math.min(0.24, width * 0.023);
  add([left + jamb, right - jamb, inset, back + 0.27, bottom, top - 0.54], glazing);
  add([left, right, front + 0.12, back - 0.15, bottom, sill], darkStone);
  add([left - 0.08, right + 0.08, front + 0.12, back - 0.12, sill - 0.14, sill + 0.05], stone, 1.02);
  add([left, left + jamb, front, back, sill, top - 0.46], upright);
  add([right - jamb, right, front, front - 1.43, sill, top - 0.46], stone);
  for (let index = 1; index < bays * 2; index += 1) {
    const x = left + width * index / (bays * 2);
    const main = index % 2 === 0 && pierStops.includes(index / 2);
    const radius = main ? 0.060 : 0.025;
    const tip = main ? front + 0.01 : front - 0.36;
    add([x - radius, x + radius, tip, inset - 0.10, sill, top - 0.47], upright, main ? 1 : 0.90);
  }
  for (let level = sill + spacing * 0.27; level < top - 0.8; level += spacing * 0.27) {
    add([left + jamb, right - jamb, front - 0.39, inset - 0.07, level - 0.052, level], upright, 0.92);
  }
  // A return gallery wraps behind the front corner. Its bays expose depth as the view moves sideways.
  add([right - jamb - 0.11, right - jamb + 0.08, front - 1.45, back + 0.5, sill, top - 0.54], glazing, 0.88);
  for (const fraction of [0.24, 0.49, 0.72, 0.91]) {
    const z = front + (back - front) * fraction;
    add([right - jamb + 0.04, right + 0.07, z + 0.08, z - 0.08, sill, top - 0.44], stone);
  }
  add([left + 0.18, right - 0.16, front - 0.22, back + 0.22, top - 0.46, top], darkStone);
  add([left - 0.29, right + 0.26, front + 0.33, back - 0.24, top, top + 0.42], roof);
}

type Range = {
  x: number;
  front: number;
  width: number;
  depth: number;
  sill: number;
  top: number;
  divisions: number;
  openings?: number;
  raisedWing?: number;
  yaw: number;
  color?: Color;
};

function addRange(surface: PlantSurface, range: Range): void {
  const { x, front, width, depth, sill, top, divisions, openings = 3, raisedWing, yaw, color = stone } = range;
  const fine = front > -435 && x > -25 && x < 180;
  const bayCount = fine ? Math.ceil(width / 1.75) : divisions;
  const left = x - width * 0.5;
  const right = x + width * 0.5;
  const back = front - depth;
  const add = volumeBuilder(surface, x, front, yaw);
  const roofBottom = top - (fine ? 0.48 : 1.05);
  // The lower galleries descend into the alluvium. A tall, unbroken podium
  // would leave each range reading as a separate box on top of the slope.
  const floor = Math.max(2.4, Math.min(sill - 5.8, roofBottom - 4.0));
  const recess = front - 2.6;
  addPlinth(add, [left, right, front, back, -1.2, floor], color);
  add([left + 1.5, right - 1.15, front + 0.14, front - 0.20, floor - 2.85, floor - 2.54], color, 1.06);
  add([left + 0.34, right - 0.28, front + 0.10, front - 0.16, floor - 4.56, floor - 4.44], color, 0.78);
  add([left + 0.65, right - 0.65, recess, back + 1.5, floor, roofBottom], darkStone, 0.77);
  add([left, left + 0.91, front + 0.07, back, floor, roofBottom], color, 0.85);
  add([right - 1.17, right, front, back, floor, roofBottom], color);
  const openBays = Math.min(bayCount, fine ? 1 : openings);
  const firstOpen = Math.floor((bayCount - openBays) * 0.5);
  for (let index = 0; index < bayCount; index += 1) {
    const pierX = left + index * width / bayCount;
    const end = left + (index + 1) * width / bayCount;
    if (index >= firstOpen && index < firstOpen + openBays) {
      add([pierX - 0.075, pierX + 0.09, front, recess - 0.1, floor, roofBottom], color, 0.81);
    } else {
      add([pierX + 0.04, end - 0.06, front - 0.92, recess - 0.07, floor, roofBottom], color, 0.83);
      add([pierX - (fine ? 0.032 : 0.10), pierX + (fine ? 0.038 : 0.12),
        front - (fine ? 0.83 : 0.43), recess - 0.13, floor, roofBottom], color, fine ? 0.84 : 0.94);
      const middle = (pierX + end) * 0.5;
      if (!fine) add([middle - 0.065, middle + 0.065, front - 0.69, recess - 0.10, floor, roofBottom], upright, 0.87);
      for (let course = floor + 0.76; course < roofBottom - 0.25; course += 0.76) {
        add([pierX + 0.07, end - 0.09, front - 0.865, recess - 0.09,
          course - 0.023, course + 0.023], color, 0.77);
      }
    }
  }
  for (let floorBand = floor + (fine ? 0.86 : 2.1); floorBand < roofBottom - 0.25; floorBand += fine ? 0.86 : 2.1) {
    add([left + 0.3, right - 0.3, front + (fine ? 0.11 : -0.24), back,
      floorBand - (fine ? 0.17 : 0.15), floorBand], fine ? terraceCourse : color, fine ? 0.98 : 0.94);
  }
  // A narrow shadow between the upper slab and the fascia ties the opening to its roof.
  add([left - 0.36, right + 0.38, front + 0.48, back - 0.36, roofBottom, top - 0.31], darkStone, 0.83);
  add([left - 0.65, right + 0.72, front + 0.88, back - 0.6, top - 0.31, top - 0.11], color, 1.04);
  add([left - 0.48, right + 0.55, front + 0.65, back - 0.48, top - 0.11, top], roof, 1.04);
  if (raisedWing) {
    const shoulder = left + width * 0.36;
    add([shoulder, right - 2.0, front - 4.9, back + 2.1, top, top + raisedWing - 0.54], color, 0.88);
    add([shoulder - 0.36, right - 1.6, front - 4.52, back + 1.8, top + raisedWing - 0.54, top + raisedWing], roof);
  }
}

const rearRanges: readonly Range[] = [
  // The two uphill rows leave angled cuts through to the next courtyard.
  { x: -48, front: -493, width: 44, depth: 35, sill: 22, top: 35.8, divisions: 7, openings: 2, raisedWing: 2.7, yaw: 0.19 },
  { x: 2, front: -478, width: 53, depth: 35, sill: 23, top: 35.7, divisions: 9, openings: 3, yaw: -0.06 },
  { x: 56, front: -465, width: 52, depth: 36, sill: 24, top: 32.1, divisions: 8, openings: 2, raisedWing: 2.05, yaw: 0.09 },
  { x: 104, front: -451, width: 47, depth: 33, sill: 22.5, top: 18.8, divisions: 8, yaw: -0.17 },
  { x: 151, front: -444, width: 43, depth: 28, sill: 23.6, top: 34.6, divisions: 5, openings: 1, raisedWing: 3.4, yaw: -0.28 },
  { x: 186, front: -427, width: 30, depth: 30, sill: 25, top: 33.2, divisions: 4, yaw: -0.23 },
  { x: 235, front: -403, width: 51, depth: 46, sill: 25, top: 38.5, divisions: 7, openings: 2, yaw: -0.14 },
  { x: 273, front: -429, width: 45, depth: 41, sill: 29, top: 45.4, divisions: 5, yaw: -0.25 },
  { x: -42, front: -469, width: 45, depth: 33, sill: 17.2, top: 27.1, divisions: 6, openings: 1, yaw: 0.16 },
  { x: 10, front: -432, width: 50, depth: 31, sill: 16.6, top: 27.3, divisions: 9, openings: 4, yaw: -0.10 },
  { x: 67, front: -423, width: 50, depth: 23, sill: 18.8, top: 26.8, divisions: 8, yaw: 0.1 },
  { x: 119, front: -419, width: 46, depth: 23, sill: 19.6, top: 18.1, divisions: 7, openings: 2, yaw: -0.14 },
  { x: 166, front: -407, width: 53, depth: 30, sill: 20.1, top: 28.4, divisions: 9, raisedWing: 1.5, yaw: 0.10 },
  // Low, offset foreground ranges reveal their ends from different parts of the hall.
  { x: -3, front: -402, width: 36, depth: 29, sill: 8.5, top: 16.8, divisions: 9, openings: 3, yaw: -0.23 },
  { x: 42, front: -394, width: 36, depth: 22, sill: 7.2, top: 14.5, divisions: 9, openings: 2, raisedWing: 0.65, yaw: 0.19 },
  { x: 75, front: -404, width: 28, depth: 20, sill: 7.4, top: 16.1, divisions: 7, openings: 1, yaw: -0.18 },
  { x: 127, front: -393, width: 58, depth: 26, sill: 9.1, top: 17.5, divisions: 13, openings: 3, raisedWing: 0.75, yaw: -0.06 },
];

function addPaleEave(surface: PlantSurface): void {
  // A single view fixes angular size, not distance. Put the pavilion inland so
  // its footing meets a broad grade instead of requiring a steep local mound.
  const scale = 1.14;
  const depth = (z: number) => 7 + (z - 7) * scale;
  const height = (y: number) => 1.65 + (y - 1.65) * scale
    + 1.1 * scale * MathUtils.smoothstep(y, 13, 22);
  const volume = volumeBuilder(surface, -44 * scale, depth(-374.6), 0.17);
  const add: AddVolume = ([left, right, front, back, bottom, top], color, shade) => {
    volume([left * scale, right * scale, depth(front), depth(back), height(bottom), height(top)], color, shade);
  };
  // The broader lower courses disappear into the gravel bank beside the pavilion.
  addPlinth(add, [-58.4, -30, -385.35, -402.8, -1, 6.1], paleStone);
  addPlinth(add, [-56.2, -33.2, -381, -402, -1, 8.9], paleStone);
  addPlinth(add, [-54.2, -34.5, -375.9, -384, -1, 5.3], paleStone);
  add([-50.4, -42.1, -372.05, -376.2, 5.8, 7.05], paleStone, 1.02);
  add([-50.45, -42.05, -371.26, -375.3, 4.5, 5.8], paleStone, 0.96);
  add([-53.75, -34.6, -376.25, -398.1, 13.0, 20.6], paleStone, 0.92);
  add([-53.75, -34.6, -384.2, -398.1, 5.0, 13.0], paleStone, 0.82);
  add([-54.45, -53.7, -374.56, -397.9, -1, 22.7], paleStone, 1.04);
  add([-34.58, -33.83, -374.7, -397.9, -1, 22.7], paleStone, 1.06);
  for (const x of [-49.5, -45.2, -41.0, -37.3]) {
    add([x - 0.11, x + 0.11, -375.61, -397.5, -1, 21.4], paleStone);
  }
  add([-54.45, -33.83, -375.17, -398.3, 13.3, 13.71], paleStone, 1.13);
  for (let course = 13.5; course < 20.4; course += 0.62) {
    add([-53.83, -34.48, -376.04, -398.24, course - 0.05, course + 0.05], paleStone, 0.79);
  }
  add([-54.8, -33.4, -375.1, -398.45, 20.6, 23.75], paleStone, 0.57);
  // Corbels support a deep, pale rim. The shadow under the rim turns around both sides.
  for (const x of [-53.75, -49.1, -44.5, -39.9, -35.25]) {
    add([x - 0.42, x + 0.42, -373.54, -377.17, 21.13, 23.75], paleStone, 0.86);
  }
  add([-55.25, -32.95, -373.95, -399.1, 22.6, 23.4], paleStone, 0.78);
  add([-56.3, -31.83, -372.81, -399.85, 23.4, 24.36], paleStone, 0.93);
  add([-58.42, -29.8, -370.95, -401.4, 24.36, 24.91], paleStone, 0.78);
  add([-58.3, -29.91, -371.01, -401.31, 24.91, 25.72], paleCoping, 1.09);
  add([-58.02, -30.09, -371.27, -401.02, 25.72, 26.04], paleCoping, 1.17);
  add([-53.9, -36.18, -377.92, -398.05, 26.04, 26.56], paleStone, 0.90);
}

function addCourtGalleries(surface: PlantSurface): void {
  // Long galleries bind the courts together at two depths. Their lower courses
  // remain buried in the same sloping ground as the freestanding upper ranges.
  for (const [left, right, front, bottom, top] of [
    [-24, 153, -410, 4.0, 14.6], [-10, 174, -433, 8.5, 20.5],
  ]) {
    const add = volumeBuilder(surface, (left + right) * 0.5, front, -0.025);
    add([left, right, front - 1.8, front - 8.5, -1.2, top - 0.7], darkStone, 0.73);
    for (let course = bottom + 0.67; course < top - 0.7; course += 0.67) {
      add([left, right, front - 1.75, front - 2.0, course - 0.025, course + 0.025], stone, 0.70);
    }
    for (let x = left; x < right; x += 2.8) {
      add([x, x + 0.07, front - 0.7, front - 2.1, bottom, top - 0.5], stone, 0.82);
    }
    for (let level = bottom + 1.65; level < top; level += 1.65) {
      add([left, right, front + 0.13, front - 2.1, level - 0.20, level], terraceCourse, 1.02);
    }
    add([left - 0.4, right + 0.4, front + 0.42, front - 9.1, top - 0.5, top], roof, 1.03);
  }
}

// All ranges and the plinths share the same ground datum. Their lower courses
// extend into the slope, and the narrower upper volumes leave exposed returns.
export function addLakeFarArchitecture(surface: PlantSurface): void {
  const westFace = volumeBuilder(surface, -108.25, -296, 0.37);
  const westRecess = volumeBuilder(surface, -96.4, -313, 0.28);
  const westWing = volumeBuilder(surface, -94.6, -306, 0.30);
  const detachedFace = volumeBuilder(surface, -82.5, -394.7, 0.18);
  const eastFace = volumeBuilder(surface, 201.8, -359, -0.40);
  const add = volumeBuilder(surface);
  addPlinth(westWing, [-121, -78.5, -301, -343, -1.5, 5.8]);
  addPlinth(westWing, [-120, -103.5, -297, -319, -1.6, 4.7]);
  addPlinth(westFace, [-115.4, -102.8, -296.8, -328, -1.4, 7.2]);
  addPlinth(westWing, [-102.7, -79.1, -305, -342, -1.3, 6.5]);
  addShaft(westFace, {
    volume: [-112.9, -103.6, -296, -320, 5.6, 82.1], sill: 8.0, bays: 8, spacing: 2.43, setBack: 1.0,
    pierStops: [2, 5, 7],
  });
  addShaft(westRecess, {
    volume: [-101, -91.8, -313, -333, 3.6, 72.3], sill: 6.8, bays: 7, spacing: 2.72, setBack: 0.93,
    pierStops: [2, 5],
  });
  addShaft(westWing, {
    volume: [-113.2, -99.8, -305.6, -338, 4.7, 47.8], sill: 7.3, bays: 8, spacing: 2.48, setBack: 1.19,
    pierStops: [2, 4, 7],
  });
  addShaft(westWing, {
    volume: [-100.5, -85.45, -309, -341.6, 4.1, 49.4], sill: 6.9, bays: 10, spacing: 2.54, setBack: 1.14,
    pierStops: [2, 5, 8],
  });
  addShaft(westWing, {
    volume: [-85.8, -77.9, -303.4, -329, 3.8, 51.1], sill: 6.4, bays: 5, spacing: 2.62, setBack: 1.16,
    pierStops: [1, 3],
  });
  addRange(surface, { x: -105, front: -367.8, width: 37, depth: 28, sill: 10.8, top: 17.5,
    divisions: 5, yaw: 0.12, color: paleStone });
  addRange(surface, { x: -101, front: -382.4, width: 31, depth: 26, sill: 16.2, top: 23.7,
    divisions: 5, yaw: 0.15, color: paleStone });
  addPlinth(add, [-113, -95.8, -358, -378.3, -1.2, 11.1], paleStone);

  // The lower footing turns into the court while the shaft stands apart above it.
  addPlinth(detachedFace, [-92.1, -73.8, -395.4, -422, -1.3, 5.1]);
  addPlinth(detachedFace, [-83.2, -67.2, -399.3, -424.7, -1.3, 4.4], darkStone);
  addShaft(detachedFace, {
    volume: [-89.9, -75.2, -394.7, -416.3, 3.4, 59.8], sill: 5.5, bays: 8, spacing: 2.5, setBack: 1.2,
    pierStops: [1, 4, 6],
  });
  detachedFace([-87.8, -76.2, -396.1, -414.2, 60.22, 61.55], stone);
  detachedFace([-75.7, -73.0, -398.7, -412.2, 12.8, 53.6], darkStone);
  addRange(surface, { x: -66.5, front: -408.4, width: 14.2, depth: 28, sill: 13.1, top: 24,
    divisions: 3, yaw: 0.19 });

  addCourtGalleries(surface);
  rearRanges.forEach(range => addRange(surface, range));
  addPaleEave(surface);
  addRange(surface, { x: -23.6, front: -387.1, width: 16, depth: 25, sill: 10.3, top: 16.1,
    divisions: 3, openings: 2, yaw: -0.18 });

  addPlinth(eastFace, [190.1, 215.8, -365.4, -391, -1.2, 5.5]);
  addPlinth(eastFace, [192.1, 212.5, -361.5, -390, 3.8, 8.5]);
  addShaft(eastFace, {
    volume: [193, 210.6, -359, -388, 6.3, 44.4], sill: 9.3, bays: 12, spacing: 2.27, setBack: 1.14,
    pierStops: [1, 4, 7, 10],
  });
  for (const x of [193.45, 197.55, 202.1, 209.85]) {
    eastFace([x, x + 0.45, -359.39, -365.6, 44.82, 45.85], upright);
  }
  eastFace([193.65, 209.9, -365.5, -387.4, 44.82, 45.85], darkStone);
  eastFace([191.95, 211.5, -357.68, -388.9, 45.85, 46.31], roof);
  addRange(surface, { x: 184.8, front: -366.2, width: 11.3, depth: 23, sill: 11.6, top: 23.6,
    divisions: 3, openings: 1, yaw: -0.19, color: paleStone });
  const eastRetaining = volumeBuilder(surface, 222, -379.6, -0.18);
  addPlinth(eastRetaining, [207.3, 241.5, -372.4, -419.2, -1.4, 12.1]);
  addPlinth(eastRetaining, [216.6, 252.7, -377.7, -429.4, 8.9, 16.0]);
  add([227, 251, -382.6, -398, 14.91, 17.3], darkStone);
  addRange(surface, { x: 224.5, front: -375.4, width: 39, depth: 32, sill: 17.1, top: 28.1,
    divisions: 6, raisedWing: 2.7, yaw: -0.18 });
  addRange(surface, { x: 255, front: -390, width: 45, depth: 29, sill: 20.9, top: 31,
    divisions: 7, yaw: -0.12 });
}
