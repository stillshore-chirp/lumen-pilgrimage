import {
  ATRIUM_BOUNDS,
  ATRIUM_CAFE,
  ATRIUM_CAFE_COUNTER,
  ATRIUM_LEVELS,
  ATRIUM_LOUNGE,
  ATRIUM_SKYLIGHT,
  ATRIUM_WALK_LEVEL,
  atriumDeckContains,
  atriumStairDistance,
  atriumStairHeight,
  atriumUpperStairHeight,
  inAtriumRug,
} from './atriumLayout';

type MutablePoint = { x: number; y: number; z: number };
export type AtriumPoint = Readonly<MutablePoint>;
export type AtriumSurface = 'stone' | 'rug' | 'stair' | 'gallery';
type ReflectionSurface = 'floor' | 'gallery-floor' | 'soffit' | 'ceiling' | 'left-wall' | 'right-wall' | 'rear-wall';
type Axis = 'x' | 'y' | 'z';

type AtriumReflection = {
  surface: ReflectionSurface;
  point: MutablePoint;
  delay: number;
  gain: number;
  cutoff: number;
};

type AtriumSoundPath = {
  directDistance: number;
  gain: number;
  cutoff: number;
  shelter: number;
  lateSend: number;
  reflections: [AtriumReflection, AtriumReflection];
};

export const ATRIUM_SOUND_SPEED = 343;
export const ATRIUM_REFLECTION_MAX_DELAY = 0.18;
// Design values informed by shopping-centre measurements in the attribution.
export const ATRIUM_ROOM_DECAY = { void: 1.86, sheltered: 0.95 } as const;
const SOFFIT_DEPTH = 0.49;
const COVER_INSETS = [-0.9, -0.45, 0, 0.45, 0.9];
const SKYLIGHT_COS = Math.cos(ATRIUM_SKYLIGHT.yaw);
const SKYLIGHT_SIN = Math.sin(ATRIUM_SKYLIGHT.yaw);

export const ATRIUM_AIR_SOURCES: readonly AtriumPoint[] = [
  { x: ATRIUM_BOUNDS.minX + 1.7, y: ATRIUM_LEVELS[0] - 0.62, z: -13.5 },
  { x: ATRIUM_BOUNDS.maxX - 1.8, y: ATRIUM_LEVELS[0] - 0.62, z: -40.9 },
  { x: ATRIUM_BOUNDS.minX + 1.5, y: ATRIUM_LEVELS[2] - 0.62, z: -44.5 },
];

export const ATRIUM_SERVICE_SOURCES: readonly AtriumPoint[] = [
  { x: ATRIUM_CAFE.x + ATRIUM_CAFE_COUNTER.x, y: 0.65, z: ATRIUM_CAFE.z + ATRIUM_CAFE_COUNTER.z },
  // The storefront opening is the point where the filtered interior noise enters the gallery.
  { x: ATRIUM_BOUNDS.maxX - 0.03, y: ATRIUM_WALK_LEVEL + 1.15, z: -18.5 },
];

function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function loungeRadius(x: number, z: number): number {
  return Math.hypot((x - ATRIUM_LOUNGE.x) / ATRIUM_LOUNGE.radiusX, (z - ATRIUM_LOUNGE.z) / ATRIUM_LOUNGE.radiusZ);
}

function inSkylightOpening(x: number, z: number): boolean {
  const dx = x - ATRIUM_SKYLIGHT.x;
  const dz = z - ATRIUM_SKYLIGHT.z;
  const localX = dx * SKYLIGHT_COS - dz * SKYLIGHT_SIN;
  const localZ = dx * SKYLIGHT_SIN + dz * SKYLIGHT_COS;
  const { radiusX, radiusZ, wallInset } = ATRIUM_SKYLIGHT;
  return (localX / (radiusX - wallInset)) ** 2 + (localZ / (radiusZ - wallInset)) ** 2 < 1;
}

/** The local response gains weight near low soffits. The void still returns sound to these open areas. */
export function atriumLocalTailMix(listener: AtriumPoint): number {
  let covered = 0;
  for (let index = 0; index < ATRIUM_LEVELS.length; index += 1) {
    const headroom = ATRIUM_LEVELS[index] - SOFFIT_DEPTH - listener.y;
    if (headroom <= 0 || headroom >= 8.5) continue;
    let cover = 0;
    for (const inset of COVER_INSETS) {
      if (atriumDeckContains(listener.x, listener.z, index, inset)) cover += 1;
    }
    const depthWeight = 1 - smoothstep(2.7, 8.5, headroom);
    covered = Math.max(covered, cover / COVER_INSETS.length * depthWeight * (index === 0 ? 0.88 : 0.68));
  }
  const topIndex = ATRIUM_LEVELS.length - 1;
  if (listener.y >= ATRIUM_LEVELS[topIndex] && atriumDeckContains(listener.x, listener.z, topIndex)
    && !inSkylightOpening(listener.x, listener.z)) {
    covered = Math.max(covered, 0.64 * (1 - smoothstep(2.0, 5.2, ATRIUM_SKYLIGHT.y - listener.y)));
  }
  const lounge = 0.37 * (1 - smoothstep(0.64, 1.45, loungeRadius(listener.x, listener.z)))
    * (1 - smoothstep(1.7, 3.55, listener.y));
  return covered + lounge * (1 - covered);
}

function slabShelter(x: number, y: number, z: number, toX: number, toY: number, toZ: number): number {
  const heightDelta = toY - y;
  if (Math.abs(heightDelta) < 0.001) return 0;
  let shelter = 0;
  for (let index = 0; index < ATRIUM_LEVELS.length; index += 1) {
    const t = (ATRIUM_LEVELS[index] - SOFFIT_DEPTH * 0.5 - y) / heightDelta;
    if (t <= 0.015 || t >= 0.985) continue;
    const crossingX = x + (toX - x) * t;
    const crossingZ = z + (toZ - z) * t;
    if (atriumDeckContains(crossingX, crossingZ, index, 0.45)) return 0.78;
    if (atriumDeckContains(crossingX, crossingZ, index)) shelter = 0.56;
    else if (atriumDeckContains(crossingX, crossingZ, index, -0.35)) shelter = Math.max(shelter, 0.24);
  }
  return shelter;
}

function directCutoff(distanceMetres: number, shelter: number): number {
  const air = 17_500 / (1 + distanceMetres / 24) ** 0.74;
  return Math.max(700, air * Math.exp(-2.75 * shelter));
}

function createReflection(): AtriumReflection {
  return { surface: 'floor', point: { x: 0, y: 0, z: 0 }, delay: 0, gain: 0, cutoff: 0 };
}

export function createAtriumSoundPath(): AtriumSoundPath {
  return { directDistance: 0, gain: 0, cutoff: 0, shelter: 0, lateSend: 0,
    reflections: [createReflection(), createReflection()] };
}

function considerReflection(
  path: AtriumSoundPath,
  listener: AtriumPoint,
  source: AtriumPoint,
  surface: ReflectionSurface,
  axis: Axis,
  plane: number,
  coefficient: number,
  deck?: number,
): void {
  if ((listener[axis] - plane) * (source[axis] - plane) <= 0) return;
  const offset = 2 * (plane - source[axis]);
  const t = (plane - listener[axis]) / (source[axis] + offset - listener[axis]);
  const x = axis === 'x' ? plane : listener.x + (source.x - listener.x) * t;
  const y = axis === 'y' ? plane : listener.y + (source.y - listener.y) * t;
  const z = axis === 'z' ? plane : listener.z + (source.z - listener.z) * t;
  const { minX, maxX, minZ, maxZ } = ATRIUM_BOUNDS;
  if (x < minX || x > maxX || z < minZ || z > maxZ || y < 0 || y > ATRIUM_SKYLIGHT.y) return;
  if (deck !== undefined && !atriumDeckContains(x, z, deck, -0.25)) return;
  if (surface === 'ceiling' && inSkylightOpening(x, z)) return;
  const distance = Math.hypot(source.x - listener.x + (axis === 'x' ? offset : 0),
    source.y - listener.y + (axis === 'y' ? offset : 0), source.z - listener.z + (axis === 'z' ? offset : 0));
  const excess = Math.max(0, distance - path.directDistance);
  const delay = excess / ATRIUM_SOUND_SPEED;
  if (delay > ATRIUM_REFLECTION_MAX_DELAY) return;
  const rug = surface === 'floor' ? 1 - smoothstep(0.83, 1.07, loungeRadius(x, z)) : 0;
  const edgeWeight = deck !== undefined && !atriumDeckContains(x, z, deck, 0.15) ? 0.56 : 1;
  const reflectedShelter = Math.max(slabShelter(listener.x, listener.y, listener.z, x, y, z),
    slabShelter(x, y, z, source.x, source.y, source.z));
  const relative = coefficient * (1 - rug * 0.82) * edgeWeight * (1 - reflectedShelter * 0.76);
  const gain = relative * (2.2 / (2.2 + distance)) ** 0.74 * Math.exp(-excess * 0.046);
  const arrivals = path.reflections;
  const reflection = arrivals[1];
  if (gain <= reflection.gain) return;
  reflection.surface = surface;
  reflection.point.x = x;
  reflection.point.y = y;
  reflection.point.z = z;
  reflection.delay = delay;
  reflection.gain = gain;
  reflection.cutoff = Math.min(directCutoff(distance, reflectedShelter), 11_500 * (1 - rug * 0.74));
  if (gain > arrivals[0].gain) {
    arrivals[1] = arrivals[0];
    arrivals[0] = reflection;
  }
}

/** Fill two strongest finite image paths without allocating during propagation. */
export function atriumSoundPath(
  listener: AtriumPoint, source: AtriumPoint, path = createAtriumSoundPath(),
): AtriumSoundPath {
  const directDistance = Math.hypot(listener.x - source.x, listener.y - source.y, listener.z - source.z);
  const shelter = slabShelter(listener.x, listener.y, listener.z, source.x, source.y, source.z);
  const distanceGain = (2.2 / (2.2 + directDistance)) ** 0.74;
  path.directDistance = directDistance;
  path.shelter = shelter;
  path.gain = distanceGain * (1 - shelter * 0.68);
  path.cutoff = directCutoff(directDistance, shelter);
  path.lateSend = distanceGain * (0.24 + 0.31 * smoothstep(2, 22, directDistance) + shelter * 0.24);
  path.reflections[0].gain = 0;
  path.reflections[1].gain = 0;
  considerReflection(path, listener, source, 'floor', 'y', 0, 0.40);
  for (let index = 0; index < ATRIUM_LEVELS.length; index += 1) {
    const level = ATRIUM_LEVELS[index];
    if (listener.y > level && source.y > level) {
      considerReflection(path, listener, source, 'gallery-floor', 'y', level, 0.38, index);
    } else if (listener.y < level - SOFFIT_DEPTH && source.y < level - SOFFIT_DEPTH) {
      considerReflection(path, listener, source, 'soffit', 'y', level - SOFFIT_DEPTH, 0.35, index);
    }
  }
  considerReflection(path, listener, source, 'ceiling', 'y', ATRIUM_SKYLIGHT.y, 0.22);
  considerReflection(path, listener, source, 'left-wall', 'x', ATRIUM_BOUNDS.minX, 0.33);
  considerReflection(path, listener, source, 'right-wall', 'x', ATRIUM_BOUNDS.maxX, 0.33);
  considerReflection(path, listener, source, 'rear-wall', 'z', ATRIUM_BOUNDS.minZ, 0.27);
  return path;
}

export function atriumSurfaceAt(x: number, z: number, floorY = 0): AtriumSurface {
  const stair = atriumStairDistance(x, z);
  if ((stair !== undefined && Math.abs(atriumStairHeight(stair) - floorY) < 0.27)
    || Math.abs(atriumUpperStairHeight(x, z) - floorY) < 0.27) return 'stair';
  if (inAtriumRug(x, z) && floorY < 0.27) return 'rug';
  if (floorY >= ATRIUM_LEVELS[0] - 0.27) return 'gallery';
  return 'stone';
}
