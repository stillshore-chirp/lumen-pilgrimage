import {
  ATRIUM_BOUNDS,
  ATRIUM_LEVELS,
  ATRIUM_WALK_LEVEL,
  atriumDeckContains,
  atriumStairDistance,
  atriumStairHeight,
  atriumUpperStairHeight,
  inAtriumRug,
} from './atriumLayout';

export type AtriumPoint = Readonly<{ x: number; y: number; z: number }>;
export type AtriumSurface = 'stone' | 'rug' | 'stair' | 'gallery';

export type AtriumReflection = Readonly<{
  surface: 'floor' | 'left-wall' | 'right-wall' | 'rear-wall';
  point: AtriumPoint;
  delay: number;
  gain: number;
  cutoff: number;
}>;

export type AtriumSoundPath = Readonly<{
  directDistance: number;
  gain: number;
  cutoff: number;
  shelter: number;
  lateSend: number;
  reflections: readonly AtriumReflection[];
}>;

export const ATRIUM_SOUND_SPEED = 343;
export const ATRIUM_VOID_TAIL_SECONDS = 1.86;
const LISTENER_PERIOD = 0.075;

export function atriumListenerUpdatePeriod(): number {
  return LISTENER_PERIOD;
}

function distance(a: AtriumPoint, b: AtriumPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(start: number, end: number, value: number): number {
  const t = clamp((value - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
}

function reflectedPoint(listener: AtriumPoint, image: AtriumPoint, axis: 'x' | 'y' | 'z', value: number):
  AtriumPoint | undefined {
  const denominator = image[axis] - listener[axis];
  if (Math.abs(denominator) < 0.0001) return undefined;
  const t = (value - listener[axis]) / denominator;
  if (t <= 0 || t >= 1) return undefined;
  const point = {
    x: listener.x + (image.x - listener.x) * t,
    y: listener.y + (image.y - listener.y) * t,
    z: listener.z + (image.z - listener.z) * t,
  };
  return point;
}

function withinOpening(point: AtriumPoint, surface: AtriumReflection['surface']): boolean {
  if (surface === 'floor') {
    return point.x >= ATRIUM_BOUNDS.minX && point.x <= ATRIUM_BOUNDS.maxX
      && point.z >= ATRIUM_BOUNDS.minZ && point.z <= ATRIUM_BOUNDS.maxZ;
  }
  if (surface === 'rear-wall') {
    return point.x >= ATRIUM_BOUNDS.minX && point.x <= ATRIUM_BOUNDS.maxX
      && point.y >= 0 && point.y <= ATRIUM_LEVELS.at(-1)!;
  }
  return point.z >= ATRIUM_BOUNDS.minZ && point.z <= ATRIUM_BOUNDS.maxZ
    && point.y >= 0 && point.y <= ATRIUM_LEVELS.at(-1)!;
}

function reflection(
  listener: AtriumPoint,
  surface: AtriumReflection['surface'],
  image: AtriumPoint,
  axis: 'x' | 'y' | 'z',
  value: number,
  coefficient: number,
  directDistance: number,
): AtriumReflection | undefined {
  const point = reflectedPoint(listener, image, axis, value);
  if (!point || !withinOpening(point, surface)) return undefined;
  const pathDistance = distance(listener, image);
  const excess = Math.max(0, pathDistance - directDistance);
  return {
    surface,
    point,
    delay: Math.min(0.18, excess / ATRIUM_SOUND_SPEED),
    // The image-method path supplies the excess delay; the coefficient models a
    // polished floor, glazed wall, or absorbent rear return without adding taps.
    gain: coefficient * directDistance / Math.max(pathDistance, directDistance + 0.001)
      * Math.exp(-excess * 0.08),
    cutoff: Math.max(780, 11_500 / (1 + pathDistance / 22) ** 0.82),
  };
}

function slabShelter(listener: AtriumPoint, source: AtriumPoint): number {
  const heightDelta = Math.abs(source.y - listener.y);
  if (heightDelta < 2.8) return 0;
  const crossesSlab = ATRIUM_LEVELS.some((level, index) => {
    const t = (level - 0.24 - listener.y) / (source.y - listener.y);
    return t > 0.07 && t < 0.93 && atriumDeckContains(
      listener.x + (source.x - listener.x) * t, listener.z + (source.z - listener.z) * t, index, 0.10);
  });
  return crossesSlab ? smoothstep(2.8, 8.0, heightDelta) * 0.78 : 0;
}

function directCutoff(distanceMetres: number, shelter: number): number {
  const air = 17_500 / (1 + distanceMetres / 24) ** 0.74;
  return Math.max(900, air * (1 - shelter * 0.82));
}

/**
 * Return a bounded direct/early/late path for an atrium source.
 *
 * The two strongest valid image paths are retained. This keeps the graph small
 * while preserving a measurable floor/wall excess delay for moving listeners.
 */
export function atriumSoundPath(listener: AtriumPoint, source: AtriumPoint): AtriumSoundPath {
  const directDistance = Math.max(0.35, distance(listener, source));
  const shelter = slabShelter(listener, source);
  const distanceGain = (2.2 / (2.2 + directDistance)) ** 0.74;
  const gain = distanceGain * (1 - shelter * 0.62);
  const reflections: AtriumReflection[] = [];
  const images: readonly [AtriumReflection['surface'], AtriumPoint, 'x' | 'y' | 'z', number, number][] = [
    ['floor', { x: source.x, y: -source.y, z: source.z }, 'y', 0, 0.31],
    ['left-wall', { x: 2 * ATRIUM_BOUNDS.minX - source.x, y: source.y, z: source.z }, 'x', ATRIUM_BOUNDS.minX, 0.23],
    ['right-wall', { x: 2 * ATRIUM_BOUNDS.maxX - source.x, y: source.y, z: source.z }, 'x', ATRIUM_BOUNDS.maxX, 0.23],
    ['rear-wall', { x: source.x, y: source.y, z: 2 * ATRIUM_BOUNDS.minZ - source.z }, 'z', ATRIUM_BOUNDS.minZ, 0.17],
  ];
  for (const [surface, image, axis, value, coefficient] of images) {
    const path = reflection(listener, surface, image, axis, value, coefficient, directDistance);
    if (path) reflections.push(path);
  }
  reflections.sort((a, b) => b.gain - a.gain);
  const selected = reflections.slice(0, 2).map(path => ({
    ...path,
    gain: path.gain * (1 - shelter * 0.18),
    cutoff: Math.min(path.cutoff, directCutoff(path.delay * ATRIUM_SOUND_SPEED + directDistance, shelter) * 1.12),
  }));
  const lateSend = clamp(0.10 + smoothstep(4, 25, directDistance) * 0.42 + shelter * 0.24, 0.08, 0.72);
  return {
    directDistance,
    gain,
    cutoff: directCutoff(directDistance, shelter),
    shelter,
    lateSend,
    reflections: selected,
  };
}

export function atriumSurfaceAt(x: number, z: number, floorY = 0): AtriumSurface {
  const stair = atriumStairDistance(x, z);
  if ((stair !== undefined && Math.abs(atriumStairHeight(stair) - floorY) < 0.27)
    || Math.abs(atriumUpperStairHeight(x, z) - floorY) < 0.27) return 'stair';
  if (inAtriumRug(x, z) && floorY < ATRIUM_WALK_LEVEL - 0.8) return 'rug';
  if (floorY >= ATRIUM_WALK_LEVEL - 0.55) return 'gallery';
  return 'stone';
}

export function atriumAirSource(): AtriumPoint {
  return { x: 8.72, y: ATRIUM_WALK_LEVEL + 0.15, z: -42.2 };
}

export function atriumGallerySources(): readonly AtriumPoint[] {
  return [
    { x: -9.05, y: ATRIUM_WALK_LEVEL + 1.12, z: -40.8 },
    { x: 8.95, y: ATRIUM_WALK_LEVEL + 1.06, z: -16.5 },
  ];
}

export function atriumCafeSource(): AtriumPoint {
  return { x: 8.8, y: 1.25, z: -31 };
}
