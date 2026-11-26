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
const gravelBounce = new Color(0x9caebd);

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
        const bounce = 0.20 * (1 - MathUtils.smoothstep(y, 11, 34));
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
  const jamb = Math.min(0.85, width * 0.067);
  add([left + jamb, right - jamb, inset, back + 0.27, bottom, top - 0.54], glazing);
  add([left, right, front + 0.12, back - 0.15, bottom, sill], darkStone);
  add([left - 0.15, right + 0.15, front + 0.19, back - 0.19, sill - 0.46, sill + 0.09], stone, 1.06);
  add([left, left + jamb, front, back, sill, top - 0.46], upright);
  add([right - jamb, right, front, front - 1.43, sill, top - 0.46], stone);
  for (let index = 1; index < bays; index += 1) {
    const x = left + width * index / bays;
    const main = pierStops.includes(index);
    const radius = main ? 0.19 : 0.081;
    const tip = main ? front + 0.04 : front - 0.46;
    add([x - radius, x + radius, tip, inset - 0.10, sill, top - 0.47], upright, main ? 1 : 0.90);
  }
  for (let level = sill + spacing; level < top - 0.8; level += spacing) {
    add([left + jamb, right - jamb, front - 0.51, inset - 0.07, level - 0.18, level], upright, 0.94);
  }
  // A return gallery wraps behind the front corner. Its bays expose depth as the view moves sideways.
  add([right - jamb - 0.11, right - jamb + 0.08, front - 1.45, back + 0.5, sill, top - 0.54], glazing, 0.88);
  for (const fraction of [0.24, 0.49, 0.72, 0.91]) {
    const z = front + (back - front) * fraction;
    add([right - jamb + 0.08, right + 0.13, z + 0.26, z - 0.26, sill, top - 0.44], stone);
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
  const left = x - width * 0.5;
  const right = x + width * 0.5;
  const back = front - depth;
  const add = volumeBuilder(surface, x, front, yaw);
  const roofBottom = top - 1.69;
  const floor = Math.min(sill, roofBottom - 1.5);
  const recess = front - 2.6;
  addPlinth(add, [left, right, front, back, -1.2, floor], color);
  add([left + 1.5, right - 1.15, front + 0.14, front - 0.20, floor - 2.85, floor - 2.54], color, 1.06);
  add([left + 0.34, right - 0.28, front + 0.10, front - 0.16, floor - 4.56, floor - 4.44], color, 0.78);
  add([left + 0.65, right - 0.65, recess, back + 1.5, floor, roofBottom], darkStone, 0.77);
  add([left, left + 0.91, front + 0.07, back, floor, roofBottom], color, 0.85);
  add([right - 1.17, right, front, back, floor, roofBottom], color);
  const openBays = Math.min(divisions, openings);
  const firstOpen = Math.floor((divisions - openBays) * 0.5);
  for (let index = 0; index < divisions; index += 1) {
    const pierX = left + index * width / divisions;
    const end = left + (index + 1) * width / divisions;
    if (index >= firstOpen && index < firstOpen + openBays) {
      add([pierX - 0.30, pierX + 0.45, front, recess - 0.1, floor, roofBottom], color, 0.81);
    } else {
      add([pierX + 0.04, end - 0.06, front - 0.92, recess - 0.07, floor, roofBottom], color, 0.83);
    }
  }
  if (roofBottom - floor > 5.5) {
    const floorBand = floor + (roofBottom - floor) * 0.49;
    add([left + 0.3, right - 0.3, front - 0.24, back, floorBand - 0.34, floorBand], color, 0.96);
    add([left + 0.27, right - 0.24, front - 0.44, back, floorBand + 0.57, floorBand + 0.75], color, 0.83);
  }
  // A narrow shadow between the upper slab and the fascia ties the opening to its roof.
  add([left - 0.66, right + 0.68, front + 0.82, back - 0.46, roofBottom, top - 0.91], darkStone, 0.78);
  add([left - 1.03, right + 1.17, front + 1.39, back - 0.9, top - 0.91, top - 0.31], color, 1.12);
  add([left - 0.77, right + 0.85, front + 0.99, back - 0.68, top - 0.31, top], roof, 1.12);
  if (raisedWing) {
    const shoulder = left + width * 0.36;
    add([shoulder, right - 2.0, front - 4.9, back + 2.1, top, top + raisedWing - 0.54], color, 0.88);
    add([shoulder - 0.36, right - 1.6, front - 4.52, back + 1.8, top + raisedWing - 0.54, top + raisedWing], roof);
  }
}

const rearRanges: readonly Range[] = [
  // The two uphill rows leave angled cuts through to the next courtyard.
  { x: -48, front: -451, width: 44, depth: 35, sill: 22, top: 35.8, divisions: 7, openings: 2, raisedWing: 2.7, yaw: 0.19 },
  { x: 2, front: -478, width: 53, depth: 35, sill: 23, top: 35.7, divisions: 9, openings: 3, yaw: -0.06 },
  { x: 56, front: -465, width: 52, depth: 36, sill: 24, top: 32.1, divisions: 8, openings: 2, raisedWing: 2.05, yaw: 0.09 },
  { x: 104, front: -451, width: 47, depth: 33, sill: 22.5, top: 31.2, divisions: 8, yaw: -0.17 },
  { x: 151, front: -444, width: 43, depth: 28, sill: 23.6, top: 34.6, divisions: 5, openings: 1, raisedWing: 3.4, yaw: -0.28 },
  { x: 186, front: -427, width: 30, depth: 30, sill: 25, top: 33.2, divisions: 4, yaw: -0.23 },
  { x: 235, front: -403, width: 51, depth: 46, sill: 25, top: 38.5, divisions: 7, openings: 2, yaw: -0.14 },
  { x: 273, front: -429, width: 45, depth: 41, sill: 29, top: 45.4, divisions: 5, yaw: -0.25 },
  { x: -42, front: -417, width: 45, depth: 33, sill: 17.2, top: 27.1, divisions: 6, openings: 1, yaw: 0.16 },
  { x: 10, front: -432, width: 50, depth: 31, sill: 16.6, top: 27.3, divisions: 9, openings: 4, yaw: -0.10 },
  { x: 67, front: -423, width: 50, depth: 23, sill: 18.8, top: 26.8, divisions: 8, yaw: 0.1 },
  { x: 119, front: -419, width: 46, depth: 23, sill: 19.6, top: 27.7, divisions: 7, openings: 2, yaw: -0.14 },
  { x: 166, front: -407, width: 53, depth: 30, sill: 20.1, top: 28.4, divisions: 9, raisedWing: 1.5, yaw: 0.10 },
  // Low, offset foreground ranges reveal their ends from different parts of the hall.
  { x: -3, front: -402, width: 36, depth: 29, sill: 13.8, top: 22.7, divisions: 7, openings: 3, yaw: -0.23 },
  { x: 42, front: -394, width: 36, depth: 22, sill: 11.9, top: 20.8, divisions: 6, openings: 2, raisedWing: 1.6, yaw: 0.19 },
  { x: 75, front: -404, width: 28, depth: 20, sill: 13, top: 22.8, divisions: 5, openings: 1, yaw: -0.18 },
  { x: 127, front: -393, width: 58, depth: 26, sill: 15.8, top: 24.7, divisions: 8, openings: 3, raisedWing: 2.1, yaw: -0.06 },
];

function addPaleEave(surface: PlantSurface): void {
  const add = volumeBuilder(surface, -44, -374.6, 0.17);
  // The broader lower courses disappear into the gravel bank beside the pavilion.
  addPlinth(add, [-61.4, -27, -375.35, -402.8, -1, 6.1], paleStone);
  addPlinth(add, [-58.2, -31.2, -374, -402, -1, 8.9], paleStone);
  add([-50.4, -42.1, -372.05, -376.2, 5.8, 7.05], paleStone, 1.02);
  add([-50.45, -42.05, -371.26, -375.3, 4.5, 5.8], paleStone, 0.96);
  add([-53.75, -34.6, -376.25, -398.1, 7.7, 20.6], paleStone, 0.92);
  add([-54.45, -52.05, -374.56, -397.9, 10.14, 22.7], paleStone, 1.04);
  add([-36.2, -33.83, -374.7, -397.9, 10.14, 22.7], paleStone, 1.06);
  for (const x of [-49.5, -45.2, -41.0, -37.3]) {
    add([x - 0.25, x + 0.25, -375.61, -397.5, 11.15, 21.4], paleStone);
  }
  add([-54.45, -33.83, -375.17, -398.3, 13.3, 13.71], paleStone, 1.13);
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

// All ranges and the plinths share the same ground datum. Their lower courses
// extend into the slope, and the narrower upper volumes leave exposed returns.
export function addLakeFarArchitecture(surface: PlantSurface): void {
  const westFace = volumeBuilder(surface, -108.25, -296, 0.37);
  const westRecess = volumeBuilder(surface, -96.4, -313, 0.28);
  const westWing = volumeBuilder(surface, -94.6, -306, 0.30);
  const detachedFace = volumeBuilder(surface, -82.5, -394.7, 0.18);
  const eastFace = volumeBuilder(surface, 201.8, -359, -0.40);
  const add = volumeBuilder(surface);
  addPlinth(westWing, [-124, -75.2, -296, -343, -1.5, 13.2]);
  addPlinth(westWing, [-123, -101, -293, -319, -1.6, 9.4]);
  addPlinth(westFace, [-117, -102.2, -295.2, -328, 8.5, 17.4]);
  addPlinth(westWing, [-104, -77.4, -301, -342, 6.2, 16.7]);
  addShaft(westFace, {
    volume: [-112.9, -103.6, -296, -320, 16.4, 82.1], sill: 20.1, bays: 8, spacing: 2.43, setBack: 1.0,
    pierStops: [2, 5, 7],
  });
  addShaft(westRecess, {
    volume: [-101, -91.8, -313, -333, 12.9, 72.3], sill: 18.1, bays: 7, spacing: 2.72, setBack: 0.93,
    pierStops: [2, 5],
  });
  addShaft(westWing, {
    volume: [-113.2, -99.8, -305.6, -338, 13.1, 47.8], sill: 18.7, bays: 8, spacing: 2.48, setBack: 1.19,
    pierStops: [2, 4, 7],
  });
  addShaft(westWing, {
    volume: [-100.5, -85.45, -309, -341.6, 12.1, 49.4], sill: 18.9, bays: 10, spacing: 2.54, setBack: 1.14,
    pierStops: [2, 5, 8],
  });
  addShaft(westWing, {
    volume: [-85.8, -77.9, -303.4, -329, 14.7, 51.1], sill: 17.1, bays: 5, spacing: 2.62, setBack: 1.16,
    pierStops: [1, 3],
  });
  addRange(surface, { x: -105, front: -367.8, width: 37, depth: 28, sill: 10.8, top: 17.5,
    divisions: 5, yaw: 0.12, color: paleStone });
  addRange(surface, { x: -101, front: -382.4, width: 31, depth: 26, sill: 16.2, top: 23.7,
    divisions: 5, yaw: 0.15, color: paleStone });
  addPlinth(add, [-113, -95.8, -358, -378.3, -1.2, 11.1], paleStone);

  addPlinth(detachedFace, [-94, -72.9, -392.1, -422, -1.3, 13.9]);
  addShaft(detachedFace, {
    volume: [-89.9, -75.2, -394.7, -416.3, 12.2, 59.8], sill: 16.1, bays: 8, spacing: 2.5, setBack: 1.2,
    pierStops: [1, 4, 6],
  });
  detachedFace([-87.8, -76.2, -396.1, -414.2, 60.22, 61.55], stone);
  detachedFace([-75.7, -73.0, -398.7, -412.2, 12.8, 53.6], darkStone);
  addRange(surface, { x: -66.5, front: -408.4, width: 14.2, depth: 28, sill: 13.1, top: 24,
    divisions: 3, yaw: 0.19 });

  rearRanges.forEach(range => addRange(surface, range));
  addPaleEave(surface);
  addRange(surface, { x: -23.6, front: -387.1, width: 16, depth: 25, sill: 10.3, top: 16.1,
    divisions: 3, openings: 2, yaw: -0.18 });

  addPlinth(eastFace, [187.6, 218.8, -363.1, -391, -1.2, 14.2]);
  addPlinth(eastFace, [190.7, 213.9, -360.5, -390, 10.7, 18.9]);
  addShaft(eastFace, {
    volume: [193, 210.6, -359, -388, 17.3, 44.4], sill: 21.4, bays: 12, spacing: 2.27, setBack: 1.14,
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
