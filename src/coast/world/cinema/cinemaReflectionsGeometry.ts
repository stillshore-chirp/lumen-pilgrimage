import {
  CINEMA_BOUNDS, CINEMA_ROOM_HEIGHT, CINEMA_ROWS, CINEMA_SEAT_BANKS,
  CINEMA_TREADS, cinemaGroundHeight,
} from './cinemaLayout';
import type { CinemaPoint } from './cinemaProgram';
import { CINEMA_RENDER_SPEAKERS as RENDER_SPEAKERS } from './cinemaSpeakers';

const SAMPLE_RATE = 48_000;
const SOUND_SPEED_METRES_PER_SECOND = 343;
const MAX_DELAY_SAMPLES = 0.250 * SAMPLE_RATE;
const REFERENCE_DISTANCE = 38.02;
const MAX_PATHS = 48;

type Axis = 'x' | 'y' | 'z';
type SurfaceId = 'left' | 'right' | 'rear' | 'ceiling' | 'floor' | 'front';

interface ReflectionSurface {
  readonly id: SurfaceId;
  readonly axis: Axis;
  readonly value: number;
  readonly lowGain: number;
  readonly highGain: number;
  contains(point: CinemaPoint): boolean;
}
interface PathCandidate {
  readonly speaker: number;
  readonly point: CinemaPoint;
  readonly delaySamples: number;
  readonly gain: number;
  readonly highGain: number;
  readonly strength: number;
}

export interface CinemaEarlyPath {
  /** Index into CINEMA_RENDER_SPEAKERS. */
  readonly speaker: number;
  /** The last finite-surface bounce point in world metres. */
  readonly point: CinemaPoint;
  /** Absolute propagation time plus the speaker's fixed calibration delay. */
  readonly delaySamples: number;
  /** Relative reflection amplitude, with 38.02 m as the reference path. */
  readonly gain: number;
  /** Relative high-frequency reflection gain, constrained to 0..1. */
  readonly highGain: number;
}

function distance(a: CinemaPoint, b: CinemaPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function reflect(point: CinemaPoint, surface: ReflectionSurface): CinemaPoint {
  if (surface.axis === 'x') return [2 * surface.value - point[0], point[1], point[2]];
  if (surface.axis === 'y') return [point[0], 2 * surface.value - point[1], point[2]];
  return [point[0], point[1], 2 * surface.value - point[2]];
}

function segmentIntersection(from: CinemaPoint, to: CinemaPoint, surface: ReflectionSurface): CinemaPoint | undefined {
  const delta = surface.axis === 'x' ? to[0] - from[0]
    : surface.axis === 'y' ? to[1] - from[1] : to[2] - from[2];
  if (Math.abs(delta) < 1e-9) return undefined;
  const start = surface.axis === 'x' ? from[0] : surface.axis === 'y' ? from[1] : from[2];
  const fraction = (surface.value - start) / delta;
  if (!(fraction > 1e-7 && fraction < 1 - 1e-7)) return undefined;
  const point = [
    from[0] + (to[0] - from[0]) * fraction,
    from[1] + (to[1] - from[1]) * fraction,
    from[2] + (to[2] - from[2]) * fraction,
  ] as const;
  return surface.contains(point) ? point : undefined;
}

function roomPoint(point: CinemaPoint): boolean {
  return point[0] >= CINEMA_BOUNDS.minX - 1e-6 && point[0] <= CINEMA_BOUNDS.maxX + 1e-6
    && point[1] >= cinemaGroundHeight(point[0], point[2]) - 1e-6
    && point[1] <= CINEMA_ROOM_HEIGHT + 1e-6
    && point[2] >= CINEMA_BOUNDS.minZ - 1e-6 && point[2] <= CINEMA_BOUNDS.maxZ + 1e-6;
}

function segmentInsideRoom(from: CinemaPoint, to: CinemaPoint): boolean {
  for (const fraction of [0.25, 0.5, 0.75]) {
    const point: CinemaPoint = [
      from[0] + (to[0] - from[0]) * fraction,
      from[1] + (to[1] - from[1]) * fraction,
      from[2] + (to[2] - from[2]) * fraction,
    ];
    if (!roomPoint(point)) return false;
  }
  return true;
}

/** Keep the cheap rake/seat test bounded so this function can run at 20 Hz. */
function blockedBySeating(from: CinemaPoint, to: CinemaPoint): boolean {
  if (Math.abs(to[2] - from[2]) < 0.01) return false;
  const crosses = (z: number, height: number, seatBack: boolean): boolean => {
    const fraction = (z - from[2]) / (to[2] - from[2]);
    if (!(fraction > 0.01 && fraction < 0.99)
      || from[1] + (to[1] - from[1]) * fraction >= height) return false;
    if (!seatBack) return true;
    const x = from[0] + (to[0] - from[0]) * fraction;
    return CINEMA_SEAT_BANKS.some(bank => x >= bank.minX && x <= bank.maxX);
  };
  return CINEMA_TREADS.some(tread => crosses(tread.z, tread.y, false))
    || CINEMA_ROWS.some(row => !row.hasWheelchairBays && crosses(row.z + 0.4, row.y + 0.86, true));
}

function wallContains(point: CinemaPoint): boolean {
  return point[1] >= cinemaGroundHeight(point[0], point[2]) - 1e-6
    && point[1] <= CINEMA_ROOM_HEIGHT + 1e-6
    && point[0] >= CINEMA_BOUNDS.minX - 1e-6 && point[0] <= CINEMA_BOUNDS.maxX + 1e-6
    && point[2] >= CINEMA_BOUNDS.minZ - 1e-6 && point[2] <= CINEMA_BOUNDS.maxZ + 1e-6;
}

const surfaces: readonly ReflectionSurface[] = [
  {
    id: 'left', axis: 'x', value: CINEMA_BOUNDS.minX, lowGain: Math.sqrt(.74 * .65),
    highGain: Math.sqrt(.23 * .65), contains: wallContains,
  },
  {
    id: 'right', axis: 'x', value: CINEMA_BOUNDS.maxX, lowGain: Math.sqrt(.74 * .65),
    highGain: Math.sqrt(.23 * .65), contains: wallContains,
  },
  {
    id: 'rear', axis: 'z', value: CINEMA_BOUNDS.maxZ, lowGain: Math.sqrt(.62 * .75),
    highGain: Math.sqrt(.18 * .75), contains: wallContains,
  },
  {
    id: 'ceiling', axis: 'y', value: CINEMA_ROOM_HEIGHT, lowGain: Math.sqrt(.79 * .75),
    highGain: Math.sqrt(.30 * .75), contains: point => point[0] >= CINEMA_BOUNDS.minX - 1e-6
      && point[0] <= CINEMA_BOUNDS.maxX + 1e-6 && point[2] >= CINEMA_BOUNDS.minZ - 1e-6
      && point[2] <= CINEMA_BOUNDS.maxZ + 1e-6,
  },
  {
    id: 'floor', axis: 'y', value: 0, lowGain: .56, highGain: .34,
    contains: point => point[0] >= CINEMA_BOUNDS.minX - 1e-6 && point[0] <= CINEMA_BOUNDS.maxX + 1e-6
      && point[2] >= CINEMA_BOUNDS.minZ - 1e-6 && point[2] <= CINEMA_BOUNDS.maxZ + 1e-6,
  },
  {
    id: 'front', axis: 'z', value: CINEMA_BOUNDS.minZ, lowGain: .58, highGain: .40,
    contains: wallContains,
  },
];

function unfoldedPath(
  source: CinemaPoint,
  listener: CinemaPoint,
  sequence: readonly ReflectionSurface[],
): readonly CinemaPoint[] | undefined {
  let imageListener = listener;
  for (let i = sequence.length - 1; i >= 0; i -= 1) imageListener = reflect(imageListener, sequence[i]);
  let from = source;
  const points: CinemaPoint[] = [];
  for (const surface of sequence) {
    const bounce = segmentIntersection(from, imageListener, surface);
    if (!bounce) return undefined;
    points.push(bounce);
    if (!segmentInsideRoom(from, bounce) || blockedBySeating(from, bounce)) return undefined;
    from = bounce;
    imageListener = reflect(imageListener, surface);
  }
  if (!segmentInsideRoom(from, listener) || blockedBySeating(from, listener)) return undefined;
  return points;
}

function makeCandidate(
  speakerIndex: number,
  speakerPosition: CinemaPoint,
  speakerDelay: number,
  listener: CinemaPoint,
  sequence: readonly ReflectionSurface[],
): PathCandidate | undefined {
  const points = unfoldedPath(speakerPosition, listener, sequence);
  if (!points) return undefined;
  const legs = [speakerPosition, ...points, listener];
  const pathLength = legs.slice(1).reduce((sum, point, index) => sum + distance(legs[index], point), 0);
  const delaySamples = speakerDelay + pathLength * SAMPLE_RATE / SOUND_SPEED_METRES_PER_SECOND;
  if (!(delaySamples >= 0 && delaySamples <= MAX_DELAY_SAMPLES)) return undefined;
  const lowReflection = sequence.reduce((value, surface) => value * surface.lowGain, 1);
  const highReflection = sequence.reduce((value, surface) => value * surface.highGain, 1);
  const gain = REFERENCE_DISTANCE / Math.max(1, pathLength) * lowReflection;
  const highGain = Math.max(0, Math.min(1, highReflection));
  if (!(gain > 0) || !Number.isFinite(gain) || !Number.isFinite(highGain)) return undefined;
  return {
    speaker: speakerIndex,
    point: points[points.length - 1],
    delaySamples,
    gain,
    highGain,
    strength: gain * (0.55 + 0.45 * highGain),
  };
}

function sequences(): readonly (readonly ReflectionSurface[])[] {
  const result: (readonly ReflectionSurface[])[] = [];
  for (const surface of surfaces) result.push([surface]);
  for (const first of surfaces) {
    for (const second of surfaces) {
      if (first.id === second.id) continue;
      result.push([first, second]);
    }
  }
  return result;
}

const REFLECTION_SEQUENCES = sequences();

/**
 * Find early finite-room reflections for a listener position.
 *
 * The fixed six planes use the absorption/scatter values from cinemaAcoustics:
 * their low-band amplitude is `sqrt((1 - absorption) * (1 - scatter))` and the
 * high-band value is the same expression at 4 kHz. Floor/front-wall values are
 * conservative design estimates until the room is measured. Two-plane paths
 * are unfolded once, then sorted by relative amplitude; this keeps the 20 Hz
 * update bounded while retaining the strongest secondary returns.
 */
export function findCinemaEarlyPaths(position: CinemaPoint, limit = MAX_PATHS): readonly CinemaEarlyPath[] {
  if (!roomPoint(position)) return [];
  const count = Math.max(0, Math.min(MAX_PATHS, Math.floor(limit)));
  if (count === 0) return [];
  const candidates: PathCandidate[] = [];
  RENDER_SPEAKERS.forEach((speaker, speakerIndex) => {
    if (speaker.kind === 'screenSub' || speaker.kind === 'surroundSub') return;
    for (const sequence of REFLECTION_SEQUENCES) {
      const candidate = makeCandidate(speakerIndex, speaker.position, speaker.delaySamples, position, sequence);
      if (candidate) candidates.push(candidate);
    }
  });
  candidates.sort((a, b) => b.strength - a.strength || a.delaySamples - b.delaySamples || a.speaker - b.speaker);
  return candidates.slice(0, count).map(({ speaker, point, delaySamples, gain, highGain }) => ({
    speaker, point, delaySamples, gain, highGain,
  }));
}
