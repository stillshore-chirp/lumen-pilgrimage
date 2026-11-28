import { CINEMA_ROWS, CINEMA_SCREEN, CINEMA_SEAT_BANKS, CINEMA_TREADS } from './cinemaLayout';
import type { CinemaPoint } from './cinemaProgram';

export const CINEMA_BANDS = [125, 250, 500, 1_000, 2_000, 4_000] as const;
export const CINEMA_SCREEN_BANDS = [125, 250, 500, 1_000, 2_000, 4_000, 6_000, 10_000] as const;
export const CINEMA_WOVEN_FABRIC = [0, 0, 0, 0, -.18, -.79, -1.20, -1.90] as const;
// Retained scene estimates, not measured polar data or a temperature/humidity solver.
const AIR_DB_PER_METRE = [.0004, .0013, .0027, .0047, .009, .024] as const;
const OFF_AXIS_DB = [.1, .25, .5, 1, 2.5, 5] as const;

export interface CinemaAcousticSource {
  readonly position: CinemaPoint;
  readonly aim: CinemaPoint;
  readonly subwoofer: boolean;
}

/** Source radiation uses the first path leg; absorption uses the entire path. */
export function cinemaSourceBandLoss(source: CinemaAcousticSource, launch: CinemaPoint,
  pathLength: number): number[] {
  if (source.subwoofer) return CINEMA_BANDS.map(() => 0);
  const dx = launch[0] - source.position[0];
  const dy = launch[1] - source.position[1];
  const dz = launch[2] - source.position[2];
  const distance = Math.hypot(dx, dy, dz);
  const dot = distance > 0 ? (source.aim[0] * dx + source.aim[1] * dy + source.aim[2] * dz) / distance : 0;
  const offAxis = Math.min(1, (1 - Math.max(0, dot)) / (1 - Math.cos(Math.PI / 3)));
  return AIR_DB_PER_METRE.map((loss, i) => -loss * Math.max(0, pathLength) - offAxis * OFF_AXIS_DB[i]);
}

function reflecting(absorption: readonly number[], scatter: number): readonly number[] {
  return absorption.map(value => Math.sqrt((1 - value) * (1 - scatter)));
}

function estimatedBands(low: number, high: number): readonly number[] {
  return CINEMA_BANDS.map((_, index) => low * (high / low) ** (index / (CINEMA_BANDS.length - 1)));
}

/** The four wall/ceiling materials retain the original six-band assumptions. */
export const CINEMA_SURFACE_GAINS = {
  left: reflecting([.26, .45, .65, .70, .74, .77], .35),
  right: reflecting([.26, .45, .65, .70, .74, .77], .35),
  rear: reflecting([.38, .61, .78, .81, .83, .82], .25),
  ceiling: reflecting([.21, .37, .55, .63, .66, .70], .25),
  // The original endpoint estimates are retained; intermediate values are log-amplitude interpolation.
  floor: estimatedBands(.56, .34),
  front: estimatedBands(.58, .40),
} as const;

export type CinemaReflectingSurface = keyof typeof CINEMA_SURFACE_GAINS;

export function cinemaReflectionBandGain(surfaces: readonly CinemaReflectingSurface[]): number[] {
  return CINEMA_BANDS.map((_, band) => surfaces.reduce((gain, surface) => gain * CINEMA_SURFACE_GAINS[surface][band], 1));
}

export interface CinemaSeatingClearance {
  readonly blocked: boolean;
  readonly clearance: number;
  readonly seatDepth: number;
  readonly treadDepth: number;
}

/** Finite seat banks and solid risers, shared by direct and early path inspection. */
export function cinemaSeatingClearance(from: CinemaPoint, to: CinemaPoint): CinemaSeatingClearance {
  let clearance = Infinity, seatDepth = 0, treadDepth = 0;
  if (Math.abs(to[2] - from[2]) < .01) return { blocked: false, clearance, seatDepth, treadDepth };
  const inspect = (z: number, height: number, seat: boolean): void => {
    const fraction = (z - from[2]) / (to[2] - from[2]);
    if (!(fraction > .01 && fraction < .99)) return;
    const x = from[0] + (to[0] - from[0]) * fraction;
    if (seat && !CINEMA_SEAT_BANKS.some(bank => x >= bank.minX && x <= bank.maxX)) return;
    const gap = from[1] + (to[1] - from[1]) * fraction - height;
    clearance = Math.min(clearance, gap);
    if (seat) seatDepth = Math.max(seatDepth, -gap);
    else treadDepth = Math.max(treadDepth, -gap);
  };
  for (const tread of CINEMA_TREADS) inspect(tread.z, tread.y, false);
  for (const row of CINEMA_ROWS) if (!row.hasWheelchairBays) inspect(row.z + .4, row.y + .86, true);
  return { blocked: seatDepth > 0 || treadDepth > 0, clearance, seatDepth, treadDepth };
}

/** The screen loss belongs only to a path that actually crosses the finite fabric. */
export function cinemaScreenCrossings(points: readonly CinemaPoint[]): number {
  let count = 0;
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1], to = points[i];
    const dz = to[2] - from[2];
    if (Math.abs(dz) < 1e-9) continue;
    const fraction = (CINEMA_SCREEN.z - from[2]) / dz;
    if (!(fraction > 0 && fraction < 1)) continue;
    const x = from[0] + (to[0] - from[0]) * fraction;
    const y = from[1] + (to[1] - from[1]) * fraction;
    if (Math.abs(x) <= CINEMA_SCREEN.width / 2 && y >= CINEMA_SCREEN.bottom
      && y <= CINEMA_SCREEN.bottom + CINEMA_SCREEN.height) count += 1;
  }
  return count;
}

export function cinemaPathCrossesScreen(points: readonly CinemaPoint[]): boolean {
  return cinemaScreenCrossings(points) > 0;
}

export function cinemaBandShelves(bands: readonly number[], db: readonly number[]) {
  if (bands.length !== db.length || bands.length < 2) throw new RangeError('Invalid cinema band transfer');
  return bands.slice(1).map((frequency, index) => ({
    frequency: Math.sqrt(frequency * bands[index]), gainDb: db[index + 1] - db[index],
  }));
}
