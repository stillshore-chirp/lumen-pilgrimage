import { Color, MathUtils, Vector3 } from 'three';
import type { PlantSurface } from '../coastTreeMeshes';

type Volume = readonly [left: number, right: number, front: number, back: number, bottom: number, top: number];
type AddVolume = (volume: Volume, color: Color, shade?: number) => void;
type Vertex = readonly [x: number, y: number, z: number];
type Course = readonly [belowRoof: number, projection: number, thickness: number, shade?: number];

const blueGrey = new Color(0x91a9c0);
const weatheredGrey = new Color(0x929ea9);
const paleMasonry = new Color(0xbfb1a0);
const paleEave = new Color(0xe3c9b2);
const coolMasonry = new Color(0x929aa3);
const roofEdge = new Color(0x919caa);
const shoreBounce = new Color(0xb0c0cb);

function volumeBuilder(surface: PlantSurface, pivotX = 0, pivotZ = 0, yaw = 0, reflectedGroundLight = 0): AddVolume {
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
        // At the foot of the tall walls, the pale gravel and its skylight lessen the contrast.
        const bounce = reflectedGroundLight * (1 - MathUtils.smoothstep(y, 17, 73));
        return surface.point(point, tint.copy(color).lerp(shoreBounce, bounce), shade * light);
      });
      surface.triangle(ia, ib, ic);
      surface.triangle(ib, id, ic);
    };
    face([left, bottom, front], [right, bottom, front], [left, top, front], [right, top, front], 1);
    face([right, bottom, front], [right, bottom, back], [right, top, front], [right, top, back], 0.78);
    face([left, bottom, back], [left, bottom, front], [left, top, back], [left, top, front], 0.76);
    face([right, bottom, back], [left, bottom, back], [right, top, back], [left, top, back], 0.79);
    face([left, top, front], [right, top, front], [left, top, back], [right, top, back], 1.07);
    face([left, bottom, back], [right, bottom, back], [left, bottom, front], [right, bottom, front], 0.67);
  };
}

function addTerrace(add: AddVolume, volume: Volume, color: Color, courses: readonly [Course, ...Course[]]): void {
  const [left, right, front, back, bottom, top] = volume;
  const [, , capThickness] = courses[0];
  add([left, right, front, back, bottom, top - capThickness * 0.5], color);
  for (const [belowRoof, projection, thickness, shade = 1.15] of courses) {
    const edgeHeight = top - belowRoof;
    add([left - projection * 0.55, right + projection * 0.55, front + projection, back - 0.3,
      edgeHeight - thickness, edgeHeight], color, shade);
  }
}

type GriddedWall = {
  readonly volume: Volume;
  readonly sill: number;
  readonly pierStops: readonly number[];
  readonly strongPiers: readonly number[];
  readonly returns: readonly number[];
  readonly levelSpacing: number;
  readonly setback: number;
};

// Piers and crosspieces stand in front of a recessed field. The returns and lower sill stay solid.
function addGriddedWall(add: AddVolume, wall: GriddedWall): void {
  const { volume, sill, pierStops, strongPiers, returns, levelSpacing, setback } = wall;
  const [left, right, front, back, bottom, top] = volume;
  const width = right - left;
  const inset = front - setback;
  add([left, right, inset, back, bottom, top], blueGrey, 0.96);
  add([left, right, front - 0.05, inset, bottom, sill], weatheredGrey, 0.89);
  add([left - 0.04, left + width * 0.047, front, back, sill - 0.15, top], weatheredGrey, 1.04);
  add([right - width * 0.050, right + 0.04, front, back, sill - 0.15, top], weatheredGrey, 1.04);
  for (const stop of pierStops) {
    const x = left + width * stop;
    const strong = strongPiers.includes(stop);
    const radius = strong ? 0.21 : 0.10;
    add([x - radius, x + radius, strong ? front : front - 0.15, inset - 0.23,
      sill - 0.1, top - 0.25], weatheredGrey, strong ? 1 : 0.87);
  }
  for (let height = sill + levelSpacing; height < top - 0.5; height += levelSpacing) {
    add([left + 0.25, right - 0.25, front - 0.19, inset - 0.15, height - 0.30, height],
      weatheredGrey, 0.96);
  }
  for (const t of returns) {
    const z = front + (back - front) * t;
    add([right - 0.16, right + 0.32, z + 0.31, z - 0.31, sill - 0.1, top - 0.45], blueGrey, 0.92);
    add([left - 0.27, left + 0.13, z + 0.29, z - 0.29, sill - 0.1, top - 0.45], blueGrey, 0.92);
  }
  add([left - 0.065, right + 0.065, front - 0.07, back - 0.08, top - 0.36, top + 0.01], roofEdge);
}

// Dimensions are in metres, from the camera-facing edge to the rear. Floors start inside the ground,
// while the separate front and rear sections overlap in plan to form banks of terraces and courts.
export function addLakeFarArchitecture(surface: PlantSurface): void {
  const add = volumeBuilder(surface);
  // Each gridded face addresses the valley at its own angle. Narrow returns sit beside the openings.
  const westFace = volumeBuilder(surface, -108.25, -296, 0.37, 0.68);
  const westRecess = volumeBuilder(surface, -96.4, -313, 0.28, 0.38);
  const westWing = volumeBuilder(surface, -94.6, -306, 0.30, 0.55);
  const detachedFace = volumeBuilder(surface, -82.5, -394.7, 0.18, 0.36);
  const eastFace = volumeBuilder(surface, 201.8, -359, -0.40, 0.45);

  // Western face with both tall planes overlapping the rocky peak and its lower shoulder.
  addTerrace(add, [-121, -75, -294, -333, -1, 12], coolMasonry, [[0, 0.8, 0.65]]);
  addGriddedWall(westFace, {
    volume: [-112.9, -103.6, -296, -320, 9, 82.4], sill: 16.4,
    pierStops: [0.13, 0.25, 0.37, 0.51, 0.65, 0.76, 0.88], strongPiers: [0.37, 0.76],
    returns: [0.24, 0.47, 0.70], levelSpacing: 2.44, setback: 0.52,
  });
  addGriddedWall(westRecess, {
    volume: [-101, -91.8, -313, -333, 9, 73], sill: 18.4,
    pierStops: [0.19, 0.35, 0.52, 0.74, 0.88], strongPiers: [0.52],
    returns: [0.36, 0.76], levelSpacing: 2.81, setback: 0.44,
  });
  addGriddedWall(westWing, {
    volume: [-112.9, -77.2, -306, -341, 9.4, 50.8], sill: 16.6,
    pierStops: [0.08, 0.15, 0.21, 0.31, 0.37, 0.46, 0.53, 0.58, 0.68, 0.77, 0.85, 0.92],
    strongPiers: [0.15, 0.31, 0.53, 0.77, 0.92], returns: [0.27, 0.53, 0.74], levelSpacing: 2.57, setback: 0.62,
  });
  addGriddedWall(westWing, {
    volume: [-86.5, -77.9, -304.5, -329, 8, 51.75], sill: 16.4,
    pierStops: [0.23, 0.43, 0.68, 0.85], strongPiers: [0.43],
    returns: [0.36, 0.69], levelSpacing: 2.56, setback: 0.44,
  });
  addTerrace(add, [-114, -85, -373, -415, -1, 25.8], paleMasonry,
    [[0, 1.1, 0.62], [1.45, 0.64, 0.44], [2.9, 0.52, 0.33], [5.7, 0.45, 0.37]]);
  addTerrace(add, [-111.5, -86.6, -369.5, -391, 1, 16.8], paleMasonry, [[0, 0.95, 0.74]]);

  // Across the cut, the narrow silhouette has a plain end wall and a second setback at the crown.
  addTerrace(add, [-95.3, -71.5, -401, -438, -1, 12.8], coolMasonry, [[0, 0.6, 0.57]]);
  addGriddedWall(detachedFace, {
    volume: [-89.9, -75.2, -394.7, -416.3, 8, 59.6], sill: 13.5,
    pierStops: [0.14, 0.24, 0.34, 0.5, 0.65, 0.75, 0.85], strongPiers: [0.24, 0.5, 0.75],
    returns: [0.32, 0.71], levelSpacing: 2.75, setback: 1.04,
  });
  detachedFace([-89.1, -75.9, -395.2, -414.2, 59.55, 61.65], weatheredGrey);
  detachedFace([-75.7, -73.9, -397.6, -411.7, 5, 53.3], blueGrey, 0.89);

  // Along the rear of the gravel, long courses overlap at several different distances.
  addTerrace(add, [-71, -22.15, -442, -481, -1, 37.5], coolMasonry,
    [[0, 0.64, 0.41, 1.40], [1.6, 0.43, 0.44, 0.70], [3.4, 0.5, 0.31, 1.38], [5, 0.3, 0.5, 0.77], [7.1, 0.4, 0.32, 1.29]]);
  addTerrace(add, [-27, 27, -449, -492, -1, 34.8], coolMasonry,
    [[0, 0.9, 0.66, 1.35], [1.7, 0.55, 0.46, 0.76], [3.8, 0.6, 0.38, 1.37], [6.1, 0.46, 0.43, 0.77]]);
  addTerrace(add, [17, 69, -467, -512, -1, 31.3], coolMasonry, [[0, 0.65, 0.4]]);
  addTerrace(add, [61, 113, -450, -495, -1, 27], weatheredGrey, [[0, 0.46, 0.35], [4.5, 0.24, 0.45]]);
  addTerrace(add, [104, 169, -438, -480, -1, 32.2], coolMasonry, [[0, 1.0, 0.54], [3.2, 0.75, 0.36]]);
  addTerrace(add, [164, 201, -423, -464, -1, 29.1], coolMasonry, [[0, 0.88, 0.78]]);

  addTerrace(add, [-66, -22, -416, -454, -1, 26.4], weatheredGrey,
    [[0, 0.9, 0.74, 1.29], [1.7, 0.45, 0.48, 0.68], [2.8, 0.72, 0.54, 1.43], [5.5, 0.68, 0.52, 0.74]]);
  addTerrace(add, [-17, 37, -423, -461, -1, 25], coolMasonry, [[0, 1.8, 0.82], [3.2, 0.92, 0.49], [5.7, 0.5, 0.68]]);
  addTerrace(add, [26, 85, -407, -448, -1, 22.2], coolMasonry, [[0, 1.1, 0.72], [2.2, 0.76, 0.63]]);
  addTerrace(add, [77, 121, -416, -456, -1, 24.6], weatheredGrey, [[0, 1.18, 0.64], [2.9, 0.7, 0.57], [5.7, 0.63, 0.62]]);
  addTerrace(add, [110, 162, -402, -442, -1, 23.5], coolMasonry, [[0, 1.21, 0.63], [3.1, 0.75, 0.55]]);
  addTerrace(add, [150, 200, -402.2, -438, -1, 25.1], weatheredGrey, [[0, 1.05, 0.64], [5.8, 0.84, 0.66]]);

  // Lower front ranges are offset around the next low roof, leaving their end walls visible.
  addTerrace(add, [-34, 8, -391, -426, -1, 23.6], coolMasonry,
    [[0, 0.67, 0.71, 1.35], [1.8, 0.39, 0.46, 0.71], [3.2, 0.75, 0.44, 1.44], [5.2, 0.4, 0.42, 0.72]]);
  addTerrace(add, [3, 26, -399, -425, -1, 25.5], weatheredGrey,
    [[0, 0.87, 0.84, 1.40], [1.9, 0.45, 0.37, 0.70], [3.9, 0.60, 0.47, 1.37], [5.7, 0.42, 0.40, 0.75]]);
  addTerrace(add, [12, 56, -387, -416, -1, 18.9], weatheredGrey,
    [[0, 1.22, 0.81, 1.39], [1.6, 0.63, 0.40, 0.70], [3.5, 0.70, 0.48, 1.37]]);
  addTerrace(add, [47, 78, -395, -430, -1, 23.2], coolMasonry,
    [[0, 0.68, 0.62, 1.39], [1.5, 0.43, 0.42, 0.71], [3.1, 0.71, 0.60, 1.38], [5, 0.50, 0.39, 0.75]]);
  addTerrace(add, [75, 96, -404, -432, -1, 21.0], weatheredGrey, [[0, 0.68, 0.81, 1.34], [1.9, 0.44, 0.49, 0.76]]);
  addTerrace(add, [9, 22, -384, -401, -1, 17.3], paleMasonry, [[0, 0.78, 0.68]]);

  // The nearer pale roof has deep eaves over its smaller, solid base.
  addTerrace(add, [-53.7, -34.2, -373.5, -395.6, -1, 22.7], paleEave,
    [[0, 0.5, 0.7, 1.14], [1.8, 0.31, 0.33, 0.68], [3.3, 0.36, 0.34, 1.25],
      [4.6, 0.26, 0.28, 0.76], [6.2, 0.35, 0.38, 1.22], [7.8, 0.29, 0.32, 0.78], [9.1, 0.41, 0.42, 1.17]]);
  add([-54.7, -33.3, -372.65, -396.8, 22.5, 23.5], paleMasonry, 0.78);
  add([-55.6, -32.5, -372.1, -397.3, 23.5, 24.3], paleMasonry, 0.68);
  add([-57.9, -30.5, -370.3, -399.5, 24.3, 24.83], paleMasonry, 0.74);
  add([-57.8, -30.6, -370.4, -399.4, 24.83, 25.9], paleEave, 1.08);
  add([-57.5, -30.9, -370.7, -399.1, 25.9, 26.25], paleEave, 1.18);
  addTerrace(add, [-36.3, -26.2, -377.7, -399.5, -1, 19.3], coolMasonry, [[0, 0.57, 0.72], [2.8, 0.36, 0.43]]);

  // The eastern silhouette meets the upslope ranges. A lifted cap leaves a narrow shadow at the rim.
  addTerrace(add, [184, 221, -368, -410, -1, 19.8], coolMasonry, [[0, 1.25, 0.71], [3.2, 0.63, 0.53]]);
  addTerrace(eastFace, [192.4, 211.2, -358.9, -390.8, -2, 14.4], coolMasonry, [[0, 0.68, 0.75]]);
  addGriddedWall(eastFace, {
    volume: [193, 210.6, -359, -388, 7.3, 44.2], sill: 19.1,
    pierStops: [0.13, 0.21, 0.34, 0.46, 0.67, 0.74, 0.86], strongPiers: [0.21, 0.46, 0.74],
    returns: [0.20, 0.44, 0.68, 0.89], levelSpacing: 2.22, setback: 0.68,
  });
  for (const x of [193.3, 196.2, 204.1, 209.9]) {
    eastFace([x, x + 0.43, -359.5, -364, 44.18, 45.42], roofEdge);
  }
  eastFace([193.6, 210.1, -366, -387, 44.18, 45.42], blueGrey);
  eastFace([192.3, 211.3, -357.8, -388.6, 45.42, 45.95], roofEdge);
  addTerrace(add, [185.7, 190.5, -364.4, -385, 3.8, 23.3], paleMasonry, [[0, 0.3, 0.51]]);
  addTerrace(add, [207, 252, -372, -421, -1, 29.6], weatheredGrey, [[0, 0.85, 0.60], [6.2, 0.6, 0.41]]);
  addTerrace(add, [237, 283, -409, -449, -1, 38.0], coolMasonry, [[0, 0.55, 0.4], [3.8, 0.48, 0.44]]);
  addTerrace(add, [259, 306, -425, -470, -1, 43.0], coolMasonry, [[0, 0.61, 0.39]]);
}
