export const CINEMA_LABEL = '映画館シアター（大）';
export const CINEMA_BOUNDS = { minX: -20, maxX: 20, minZ: -3.1, maxZ: 53.9 } as const;
export const CINEMA_ROOM_HEIGHT = 22;
const SCREEN_WIDTH = 30;
const SCREEN_HEIGHT = SCREEN_WIDTH * 9 / 16;
const SCREEN_CENTER = 9.8;
export const CINEMA_SCREEN = {
  width: SCREEN_WIDTH, height: SCREEN_HEIGHT, center: SCREEN_CENTER, bottom: SCREEN_CENTER - SCREEN_HEIGHT / 2, z: 0,
} as const;
export const CINEMA_DOOR_WIDTH = 1.80;
export const CINEMA_DOOR_HEIGHT = 2.42;
export const CINEMA_AISLES = [
  { x: -15.80, width: 3.40 }, { x: -6.66, width: 2.40 },
  { x: 6.66, width: 2.40 }, { x: 15.80, width: 3.40 },
] as const;

export interface CinemaRow {
  readonly number: number;
  readonly z: number;
  readonly y: number;
  readonly hasWheelchairBays: boolean;
}

// Row stations and deck elevations in metres. The cross-aisle approaches gain
// extra height to give wheelchair eyes a clear line over the far preceding row.
const ROW_DECKS = [
  [20.00, 0], [21.20, 0.33], [22.40, 0.66], [23.60, 0.99], [24.80, 1.33],
  [25.90, 1.67], [26.895, 2.02], [31.75, 2.80], [33.45, 3.25], [34.65, 3.55],
  [35.85, 3.85], [37.05, 4.15], [38.25, 4.455], [39.225, 4.755], [44.05, 5.655],
  [45.73, 6.04], [46.90, 6.37], [48.10, 6.705], [49.30, 7.045], [50.50, 7.39],
] as const;

export const CINEMA_ROWS: readonly CinemaRow[] = ROW_DECKS.map(([z, y], i) => ({
  number: i + 1, z, y, hasWheelchairBays: i === 7 || i === 14,
}));

export const CINEMA_CROSS_AISLES = [
  { row: 1, z: 18.00, width: 3 },
  { row: 8, z: 29.70, width: 2.60 },
  { row: 15, z: 42.05, width: 2.60 },
  { row: 20, z: 52.40, width: 3 },
].map(cross => ({ ...cross, y: CINEMA_ROWS[cross.row - 1].y }));

export interface CinemaExit {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly side: 'left' | 'right' | 'rear';
}

export const CINEMA_EXITS: readonly CinemaExit[] = [
  ...CINEMA_CROSS_AISLES.slice(0, 3).flatMap(({ z, y }, i): CinemaExit[] => [
    { id: 'E' + (2 * i + 1), x: CINEMA_BOUNDS.minX, z, y, side: 'left' },
    { id: 'E' + (2 * i + 2), x: CINEMA_BOUNDS.maxX, z, y, side: 'right' },
  ]),
  { id: 'E7', x: CINEMA_AISLES[1].x, z: CINEMA_BOUNDS.maxZ, y: CINEMA_CROSS_AISLES[3].y, side: 'rear' },
  { id: 'E8', x: CINEMA_AISLES[2].x, z: CINEMA_BOUNDS.maxZ, y: CINEMA_CROSS_AISLES[3].y, side: 'rear' },
];

export const CINEMA_PROJECTION_Y = CINEMA_CROSS_AISLES[3].y + 3.25;

export const CINEMA_SIDE_SURROUNDS = Array.from({ length: 10 }, (_, i) => ({
  x: 19.042, y: 7.985 + i * 4 / 9, z: 6 + i * 43 / 9,
}));

export const CINEMA_SEAT_BANKS = [
  { minX: -14.10, maxX: -7.86, count: 8 },
  { minX: -5.46, maxX: 5.46, count: 14 },
  { minX: 7.86, maxX: 14.10, count: 8 },
] as const;

export interface CinemaPlace {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly row: number;
  readonly bank: number;
  readonly kind: 'seat' | 'companion' | 'wheelchair';
}

export const CINEMA_PLACES: readonly CinemaPlace[] = CINEMA_ROWS.flatMap((row) =>
  CINEMA_SEAT_BANKS.flatMap(({ minX, count }, bank) => {
    const places: CinemaPlace[] = [];
    for (let i = 0; i < count; i += 1) {
      if (row.hasWheelchairBays && ((bank === 0 && i < 5) || (bank === 2 && i >= 3))) continue;
      places.push({ x: minX + (i + 0.5) * 0.78, y: row.y, z: row.z, row: row.number, bank, kind: 'seat' });
    }
    if (row.hasWheelchairBays && bank !== 1) {
      const sign = bank === 0 ? -1 : 1;
      const offsets = [0.49, 1.385, 2.28, 3.175];
      offsets.forEach((offset, i) => places.push({
        x: sign * (14.10 - offset), y: row.y, z: row.z, row: row.number, bank,
        kind: i % 2 === 0 ? 'companion' : 'wheelchair',
      }));
    }
    return places;
  })
);

export const CINEMA_WHEELCHAIR_BAY = { width: 1.05, depth: 1.55, centerOffsetZ: 0.025 } as const;

export interface CinemaTread {
  readonly row: number;
  readonly z: number;
  readonly y: number;
  readonly rise: number;
}

const SUPPORT_GRADE = 0.88;
export const CINEMA_TREADS: readonly CinemaTread[] = [
  { row: 1, z: CINEMA_BOUNDS.minZ, y: 0, rise: 0 },
  ...CINEMA_ROWS.slice(1).flatMap((row, i): CinemaTread[] => {
    const previous = CINEMA_ROWS[i];
    const cross = row.hasWheelchairBays ? CINEMA_CROSS_AISLES.find(aisle => aisle.row === row.number) : undefined;
    const count = cross ? 5 : previous.hasWheelchairBays ? 3 : 2;
    const rise = (row.y - previous.y) / count;
    const run = count === 2 ? 0.28 : 0.26;
    const halfRun = rise / (2 * SUPPORT_GRADE);
    let end = row.z - 0.32;
    if (cross) {
      // Finish the walking transition before the level cross aisle.
      end = cross.z - cross.width / 2 - halfRun;
    } else if (previous.hasWheelchairBays) {
      // Keep the departure flight entirely beyond the level wheelchair bay.
      const bayBack = previous.z + CINEMA_WHEELCHAIR_BAY.centerOffsetZ + CINEMA_WHEELCHAIR_BAY.depth / 2;
      end = bayBack + halfRun + run * (count - 1);
    }
    return Array.from({ length: count }, (_, step) => {
      const remaining = count - step - 1;
      return { row: row.number, z: end - run * remaining, y: row.y - rise * remaining, rise };
    });
  }),
];

export function cinemaGroundHeight(_x: number, z: number): number {
  for (let i = 1; i < CINEMA_TREADS.length; i += 1) {
    const { z: nose, y, rise } = CINEMA_TREADS[i];
    const halfRun = rise / (2 * SUPPORT_GRADE);
    if (z <= nose + halfRun) {
      // Round each step for walking. The rendered riser and support share the
      // same center line, with a height difference of at most half a riser.
      const floor = CINEMA_TREADS[i - 1].y;
      return floor + (y - floor) * Math.max(0, (z - nose + halfRun) / (2 * halfRun));
    }
  }
  return CINEMA_TREADS[CINEMA_TREADS.length - 1].y;
}

function destination(id: 'center' | 'front' | 'rear' | 'accessible', label: string, x: number, row: number, seatedEyeHeight = 1.15) {
  const { z, y } = CINEMA_ROWS[row - 1];
  return {
    id, label, x, z, seatedEyeHeight,
    yaw: Math.atan2(x, z),
    pitch: Math.atan2(CINEMA_SCREEN.center - y - seatedEyeHeight, Math.hypot(x, z)),
  } as const;
}

export const CINEMA_DESTINATIONS = [
  destination('center', '中段中央（R09）', 0.39, 9),
  destination('front', '前方中央（R01）', 0.39, 1),
  destination('rear', '後方側席（R20）', 13.71, 20),
  destination('accessible', '車いす席（R08）', -12.715, 8, 1.00),
] as const;
