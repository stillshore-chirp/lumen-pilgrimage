import type { CinemaBox } from './cinemaFinishes';
import { CINEMA_CEILING_COFFERS, CINEMA_ROOM_HEIGHT } from './cinemaLayout';

type Point = readonly [number, number, number];
type PartKind = 'coffer' | 'frame' | 'liner' | 'duct' | 'support';
interface VentilationPart {
  readonly kind: PartKind;
  readonly box: CinemaBox;
}

function boxFromBounds(min: Point, max: Point): CinemaBox {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2,
    max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/** Axis-aligned solid subtraction; generated parts never overlap one another. */
function subtract(box: CinemaBox, cut: CinemaBox): readonly CinemaBox[] {
  if ((box[6] ?? 0) !== 0 || (cut[6] ?? 0) !== 0) {
    throw new Error('Cinema ventilation cuts require axis-aligned boxes');
  }
  const dimensions = [box[3], box[4], box[5]];
  const cutDimensions = [cut[3], cut[4], cut[5]];
  const axes = [0, 1, 2] as const;
  const lower = axes.map(axis => box[axis] - dimensions[axis] / 2);
  const upper = axes.map(axis => box[axis] + dimensions[axis] / 2);
  const lo = axes.map(axis => Math.max(lower[axis], cut[axis] - cutDimensions[axis] / 2));
  const hi = axes.map(axis => Math.min(upper[axis], cut[axis] + cutDimensions[axis] / 2));
  if (lo.some((value, axis) => value >= hi[axis])) return [box];
  const result: CinemaBox[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    if (lo[axis] > lower[axis]) {
      const max = [...upper] as [number, number, number];
      max[axis] = lo[axis];
      result.push(boxFromBounds(lower as [number, number, number], max));
    }
    if (hi[axis] < upper[axis]) {
      const min = [...lower] as [number, number, number];
      min[axis] = hi[axis];
      result.push(boxFromBounds(min, upper as [number, number, number]));
    }
    lower[axis] = lo[axis];
    upper[axis] = hi[axis];
  }
  return result;
}

function subtractAll(boxes: readonly CinemaBox[], cuts: readonly CinemaBox[]): readonly CinemaBox[] {
  let result = boxes;
  for (const cut of cuts) result = result.flatMap(box => subtract(box, cut));
  return result;
}

/** The radiating outlet is distinct from the unmodeled mechanical fan upstream. */
export const CINEMA_RETURN_OUTLETS: readonly Point[] = [
  [-14, 19], [14, 19], [-14, 43], [14, 43],
].map(([x, z]): Point => {
  const coffer = CINEMA_CEILING_COFFERS.find(([cx, , cz, width, height, depth]) => height > .3 && width > 10
    && Math.abs(x - cx) < width / 2 && Math.abs(z - cz) < depth / 2);
  if (!coffer) throw new Error('Cinema return outlet must meet an existing ceiling coffer');
  return [x, coffer[1] - coffer[4] / 2 - .015, z];
});

const wallCuts: CinemaBox[] = [];
const parts: VentilationPart[] = [];
const cofferParts: CinemaBox[] = [];

for (const coffer of CINEMA_CEILING_COFFERS) {
  const [cx, cy, cz, width, height, depth] = coffer;
  const outlet = CINEMA_RETURN_OUTLETS.find(([x, , z]) => height > .3 && width > 10
    && Math.abs(x - cx) < width / 2 && Math.abs(z - cz) < depth / 2);
  if (!outlet) {
    cofferParts.push(coffer);
    continue;
  }
  const [x, sourceY, z] = outlet;
  const sign = Math.sign(x);
  const inner: CinemaBox = [cx, cy, cz, width - .04, height - .04, depth - .04];
  const slot: CinemaBox = [x, sourceY + .02, z, 2.02, .06, .20];
  const takeoff: CinemaBox = [sign * 19.095, cy, z, .06, .22, .14];
  cofferParts.push(...subtractAll([coffer], [inner, slot, takeoff]));

  for (const side of [-1, 1]) {
    parts.push({ kind: 'frame', box: [x + side * 1.025, sourceY + .01, z, .03, .03, .26] });
    parts.push({ kind: 'frame', box: [x, sourceY + .01, z + side * .115, 2.02, .03, .03] });
    parts.push({ kind: 'liner', box: [x + side * 1.005, sourceY + .055, z, .01, .08, .20] });
    parts.push({ kind: 'liner', box: [x, sourceY + .055, z + side * .095, 2, .08, .01] });
  }
  for (const offset of [-.0675, -.0225, .0225, .0675]) {
    parts.push({ kind: 'frame', box: [x, sourceY, z + offset, 2, .02, .01] });
  }

  // A lined rectangular takeoff crosses a real wall opening. The outer elbow
  // turns towards the service riser; its opaque end prevents a view outdoors
  // along the first leg. The service-network interface is outside room bounds.
  const firstOuter: CinemaBox = [sign * (19.075 + 20.46) / 2, cy, z, 20.46 - 19.075, .24, .16];
  const firstInner: CinemaBox = [sign * (19.065 + 20.45) / 2, cy, z, 20.45 - 19.065, .22, .14];
  const elbowPort: CinemaBox = [sign * 20.37, cy, z + .08, .14, .22, .04];
  for (const box of subtractAll([firstOuter], [firstInner, elbowPort])) parts.push({ kind: 'duct', box });
  const secondOuter: CinemaBox = [sign * 20.37, cy, z + .34, .16, .24, .52];
  const secondInner: CinemaBox = [sign * 20.37, cy, z + .34, .14, .22, .54];
  for (const box of subtractAll([secondOuter], [secondInner])) parts.push({ kind: 'duct', box });
  wallCuts.push([sign * 20.14, cy, z, .60, .24, .16]);

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push({ kind: 'support', box: [cx + sx * (width / 2 - .1), (cy + height / 2 + CINEMA_ROOM_HEIGHT) / 2,
      cz + sz * (depth / 2 - .1), .06, CINEMA_ROOM_HEIGHT - cy - height / 2, .06] });
  }
  for (const station of [19.3, 20.1]) for (const side of [-1, 1]) {
    parts.push({ kind: 'support', box: [sign * station, (cy + .12 + CINEMA_ROOM_HEIGHT) / 2,
      z + side * .075, .03, CINEMA_ROOM_HEIGHT - cy - .12, .01] });
  }
}

/** Rendered lining and movement volumes use the same cut coffer shells. */
export const CINEMA_RETURN_COFFER_BOXES: readonly CinemaBox[] = cofferParts;
export const CINEMA_VENTILATION_PARTS: readonly VentilationPart[] = parts;
const movementBoxes = [...cofferParts, ...parts.map(part => part.box)];

/** Cut only the solid auditorium envelope; the duct skins seal each penetration. */
export function cinemaVentilationWallBoxes(boxes: readonly CinemaBox[]): readonly CinemaBox[] {
  return subtractAll(boxes, wallCuts);
}

export function cinemaVentilationBlocked(x: number, y: number, z: number, clearance: number): boolean {
  for (const [cx, cy, cz, width, height, depth] of movementBoxes) {
    const dx = Math.max(0, Math.abs(x - cx) - width / 2);
    const dy = Math.max(0, Math.abs(y - cy) - height / 2);
    const dz = Math.max(0, Math.abs(z - cz) - depth / 2);
    if (dx * dx + dy * dy + dz * dz <= clearance * clearance) return true;
  }
  return false;
}
