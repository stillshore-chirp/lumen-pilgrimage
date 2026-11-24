import {
  CINEMA_BOUNDS, CINEMA_ROOM_HEIGHT, CINEMA_ROWS, CINEMA_SCREEN, CINEMA_SEAT_BANKS, cinemaGroundHeight,
} from './cinemaLayout';

export const CINEMA_REFERENCE_WHITE = 48;
export const CINEMA_PROJECTOR_CONTRAST = 2000;
export const CINEMA_LENS_SCATTER = 0.005;
export const CINEMA_ROOM_RETURN = 0.011;
export const CINEMA_SCREENING_SPILL = 0.010;

export type CinemaLightingQuality = 'light' | 'high';

export const cinemaLightQuality = {
  light: { columns: 16, rows: 7, probeColumns: 4, probeRows: 5, updatesPerSecond: 15 },
  high: { columns: 32, rows: 14, probeColumns: 7, probeRows: 9, updatesPerSecond: 30 },
} as const;

export const CINEMA_LIGHT_PAGES = 9;
export const CINEMA_LIGHT_META = 8;
export const CINEMA_LIGHT_BOUNCE = 7;
export const CINEMA_LIGHT_CROWN = 6;
export const CINEMA_LIGHT_NEAR = 0.35;
export const CINEMA_LIGHT_DEPTH = CINEMA_BOUNDS.maxZ - CINEMA_LIGHT_NEAR;

type Point = readonly [x: number, y: number, z: number];
type Patch = { point: Point; normal: Point; area: number; reflectance: number };

export function cinemaPictureOpening(aspect: number): readonly [width: number, height: number] {
  const screenAspect = CINEMA_SCREEN.width / CINEMA_SCREEN.height;
  const sourceAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : screenAspect;
  return [Math.min(1, sourceAspect / screenAspect), Math.min(1, screenAspect / sourceAspect)];
}

export function cinemaScreenLevels(
  picture: number, mean: number, spill = CINEMA_SCREENING_SPILL,
  scatter = CINEMA_LENS_SCATTER, roomReturn = CINEMA_ROOM_RETURN,
): number {
  const white = (CINEMA_REFERENCE_WHITE - spill) / (1 + roomReturn);
  const black = white / CINEMA_PROJECTOR_CONTRAST;
  return (1 - scatter) * (black + (white - black) * picture)
    + (scatter + roomReturn) * (black + (white - black) * mean) + spill;
}

export function cinemaProjectionFalloff(u: number, v: number): number {
  const x = 2 * u - 1;
  const y = 2 * v - 1;
  return 1 - 0.15 * x * x - 0.065 * y * y;
}

const screenPoint = (u: number, v: number): Point => [
  (u - 0.5) * CINEMA_SCREEN.width,
  CINEMA_SCREEN.bottom + v * CINEMA_SCREEN.height,
  CINEMA_SCREEN.z + 0.004,
];

function transfer(from: Patch, to: Patch): number {
  const dx = to.point[0] - from.point[0];
  const dy = to.point[1] - from.point[1];
  const dz = to.point[2] - from.point[2];
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  const cosFrom = dx * from.normal[0] + dy * from.normal[1] + dz * from.normal[2];
  const cosTo = -(dx * to.normal[0] + dy * to.normal[1] + dz * to.normal[2]);
  if (cosFrom <= 0 || cosTo <= 0) return 0;
  return from.area * cosFrom * cosTo / (distanceSquared * distanceSquared);
}

function seatsBlock(source: Point, receiver: Point): boolean {
  if (receiver[2] < CINEMA_ROWS[0].z) return false;
  for (const row of CINEMA_ROWS) {
    const back = row.z + 0.26;
    if (back >= receiver[2] - 0.13) break;
    const t = (back - source[2]) / (receiver[2] - source[2]);
    const y = source[1] + t * (receiver[1] - source[1]);
    if (y < row.y + 0.26 || y > row.y + 1.10) continue;
    const x = source[0] + t * (receiver[0] - source[0]);
    if (row.hasWheelchairBays && Math.abs(x) > 10.4) continue;
    if (CINEMA_SEAT_BANKS.some(bank => x > bank.minX + 0.08 && x < bank.maxX - 0.08)) return true;
  }
  return false;
}

function receiverPatch(page: number, column: number, row: number, columns: number, rows: number): Patch {
  const u = (column + 0.5) / columns;
  const v = (row + 0.5) / rows;
  const x = (u - 0.5) * 39.6;
  const zAt = (fraction: number) => CINEMA_LIGHT_NEAR + CINEMA_LIGHT_DEPTH * fraction * fraction;
  const z = zAt(v);
  const zSpan = zAt((row + 1) / rows) - zAt(row / rows);
  const floorY = cinemaGroundHeight(x, z);
  const horizontalArea = 39.6 * zSpan / columns;
  const seatArea = z >= CINEMA_ROWS[0].z - 1 && z <= CINEMA_ROWS[CINEMA_ROWS.length - 1].z + 1 ? horizontalArea : 0;
  switch (page) {
    case 0: return { point: [x, floorY + 0.015, z], normal: [0, 1, 0], area: horizontalArea, reflectance: 0.10 };
    case 1: return {
      point: [x, floorY + 0.64, z], normal: [0, 0, -1], area: seatArea * 0.36, reflectance: 0.06,
    };
    case 2:
    case 3: {
      const sign = page === 2 ? -1 : 1;
      const wallArea = (zAt((column + 1) / columns) - zAt(column / columns)) * CINEMA_ROOM_HEIGHT / rows;
      return {
        point: [sign * 19.92, v * CINEMA_ROOM_HEIGHT, zAt(u)], normal: [-sign, 0, 0],
        area: wallArea, reflectance: 0.085,
      };
    }
    case 4: return { point: [x, 21.94, z], normal: [0, -1, 0], area: horizontalArea, reflectance: 0.065 };
    case CINEMA_LIGHT_CROWN: return {
      point: [x, floorY + 1.02, z], normal: [0, 1, 0], area: seatArea * 0.08, reflectance: 0.06,
    };
    default: return {
      point: [x, v * CINEMA_ROOM_HEIGHT, 53.86], normal: [0, 0, -1],
      area: 39.6 * CINEMA_ROOM_HEIGHT / (columns * rows), reflectance: 0.09,
    };
  }
}

export function bakeCinemaLightTransport(quality: CinemaLightingQuality) {
  const { columns, rows, probeColumns, probeRows } = cinemaLightQuality[quality];
  const width = probeColumns * CINEMA_LIGHT_PAGES;
  const count = columns * rows;
  const weights = new Float32Array(width * probeRows * count);
  const physicalPatches: { patch: Patch; offset: number }[] = [];
  const screenCells = Array.from({ length: count }, (_, index) => {
    const x = index % columns;
    const y = Math.floor(index / columns);
    const area = CINEMA_SCREEN.width * CINEMA_SCREEN.height / count;
    const makePatch = (u: number, v: number, subdivision = 1): Patch => ({
      point: screenPoint((x + u) / columns, (y + v) / rows),
      normal: [0, 0, 1], area: area / subdivision, reflectance: 1,
    });
    return quality === 'high'
      ? [makePatch(0.25, 0.25, 4), makePatch(0.75, 0.25, 4), makePatch(0.25, 0.75, 4), makePatch(0.75, 0.75, 4)]
      : [makePatch(0.5, 0.5)];
  });
  const probeOffset = (page: number, column: number, row: number) => (
    (row * width + page * probeColumns + column) * count
  );
  for (let page = 0; page < CINEMA_LIGHT_BOUNCE; page += 1) {
    for (let row = 0; row < probeRows; row += 1) {
      for (let column = 0; column < probeColumns; column += 1) {
        const patch = receiverPatch(page, column, row, probeColumns, probeRows);
        const offset = probeOffset(page, column, row);
        physicalPatches.push({ patch, offset });
        screenCells.forEach((cell, index) => {
          let sum = 0;
          for (const part of cell) {
            const visible = quality === 'high' && seatsBlock(part.point, patch.point) ? 0.08 : 1;
            sum += visible * transfer(part, patch);
          }
          weights[offset + index] = sum / Math.PI;
        });
      }
    }
  }
  if (quality === 'high') {
    // Follow screen-to-room weights with one diffuse room-to-screen bounce.
    // Normalize across the center white field to the observed whole-room return.
    for (let row = 0; row < probeRows; row += 1) {
      for (let column = 0; column < probeColumns; column += 1) {
        const patch: Patch = {
          point: screenPoint((column + 0.5) / probeColumns, (row + 0.5) / probeRows),
          normal: [0, 0, 1], area: 0, reflectance: 1,
        };
        const offset = probeOffset(CINEMA_LIGHT_BOUNCE, column, row);
        for (const { patch: from, offset: source } of physicalPatches) {
          const fraction = from.reflectance * transfer(from, patch) / Math.PI;
          for (let index = 0; index < count; index += 1) {
            weights[offset + index] += fraction * weights[source + index];
          }
        }
      }
    }
    const center = probeOffset(CINEMA_LIGHT_BOUNCE, Math.floor(probeColumns / 2), Math.floor(probeRows / 2));
    const whiteIllumination = (index: number) => cinemaProjectionFalloff(
      (index % columns + 0.5) / columns, (Math.floor(index / columns) + 0.5) / rows,
    );
    let fullWhiteReturn = 0;
    for (let index = 0; index < count; index += 1) {
      fullWhiteReturn += weights[center + index] * whiteIllumination(index);
    }
    const scale = CINEMA_ROOM_RETURN / fullWhiteReturn;
    for (let row = 0; row < probeRows; row += 1) {
      for (let column = 0; column < probeColumns; column += 1) {
        const offset = probeOffset(CINEMA_LIGHT_BOUNCE, column, row);
        for (let index = 0; index < count; index += 1) weights[offset + index] *= scale;
      }
    }
  }
  return { width, height: probeRows, count, weights };
}
