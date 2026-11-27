import { MathUtils } from 'three';
import { LAKE_GLAZING, LAKE_HALL, LAKE_SIDE_VENTS, LAKE_TATAMI } from './lakeLayout';

export type LakePoint = Readonly<{ x: number; y: number; z: number }>;
export type LakeSurface = 'tatami' | 'wood';
type Arrival = {
  x: number;
  y: number;
  z: number;
  gain: number;
  cutoff: number;
  delay: number;
};

export type LakeSoundPaths = [direct: Arrival, westVent: Arrival, eastVent: Arrival];

const AIR_CUTOFF = 15_000;
const SOUND_SPEED = 343;
export const LAKE_MAX_VENT_DELAY = 0.2;
// Approximate transmission for each louver, with gain scaled to the square root of its face area.
const VENT_TRANSMISSION = 0.18 * Math.sqrt(LAKE_SIDE_VENTS.width * LAKE_SIDE_VENTS.height);

export function createLakeSoundPaths(): LakeSoundPaths {
  const arrival = { x: 0, y: 0, z: 0, gain: 0, cutoff: AIR_CUTOFF, delay: 0 };
  const { x, y, z } = LAKE_SIDE_VENTS;
  const west = { ...arrival, x: -x, y, z };
  const east = { ...west, x };
  return [arrival, west, east];
}

export function lakeSurfaceAt(x: number, z: number): LakeSurface | undefined {
  if (Math.abs(x) <= LAKE_TATAMI.halfWidth && z >= LAKE_TATAMI.frontZ && z <= LAKE_TATAMI.rearZ) return 'tatami';
  if (Math.abs(x) <= LAKE_HALL.halfWidth && z >= LAKE_HALL.frontZ && z <= LAKE_HALL.rearZ) return 'wood';
  return undefined;
}

function distanceGain(distance: number): number {
  return 4 / (4 + distance);
}

function airCutoff(distance: number): number {
  return AIR_CUTOFF / (1 + distance / 75) ** 0.8;
}

/** Transmission through the fixed lake facade to a listener in the hall. */
export function lakeSoundPaths(
  listener: LakePoint, source: LakePoint, paths = createLakeSoundPaths(),
): LakeSoundPaths {
  const [direct, westVent, eastVent] = paths;
  const { frontZ } = LAKE_HALL;
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
  // Keep the facade closed at the glass even if a tracked eye reaches its plane.
  const depth = Math.max(0, listener.z - frontZ);
  const fraction = Math.min(1, depth / Math.max(0.001, depth + frontZ - source.z));
  const crossX = MathUtils.lerp(listener.x, source.x, fraction);
  const crossY = MathUtils.lerp(listener.y, source.y, fraction);
  const glass = (1 - MathUtils.smoothstep(Math.abs(crossX), LAKE_GLAZING.halfWidth - 0.18, LAKE_GLAZING.halfWidth + 0.18))
    * MathUtils.smoothstep(crossY, 0, 0.24)
    * (1 - MathUtils.smoothstep(crossY, LAKE_GLAZING.headY - 0.35, LAKE_GLAZING.headY));
  direct.x = source.x;
  direct.y = source.y;
  direct.z = source.z;
  direct.gain = distanceGain(distance) * MathUtils.lerp(0.025, 0.11, glass);
  direct.cutoff = airCutoff(distance) * MathUtils.lerp(0.05, 0.11, glass);

  for (const vent of [westVent, eastVent]) {
    const route = Math.hypot(vent.x - listener.x, vent.y - listener.y, vent.z - listener.z)
      + Math.hypot(vent.x - source.x, vent.y - source.y, vent.z - source.z);
    const detour = Math.max(0, route - distance);
    vent.delay = Math.min(LAKE_MAX_VENT_DELAY, detour / SOUND_SPEED);
    vent.gain = VENT_TRANSMISSION * distanceGain(route) * Math.exp(-detour / 14);
    vent.cutoff = 0.24 * airCutoff(route) / (1 + detour / 10);
  }
  return paths;
}
