import { MathUtils } from 'three';
import { LAKE_GLAZING, LAKE_HALL, LAKE_TATAMI, LAKE_VERANDA } from './lakeLayout';

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

export type LakeSoundPaths = [direct: Arrival, westOpening: Arrival, eastOpening: Arrival];

const AIR_CUTOFF = 15_000;
const SOUND_SPEED = 343;
export const LAKE_MAX_OPENING_DELAY = 0.2;

export function createLakeSoundPaths(): LakeSoundPaths {
  const arrival = { x: 0, y: 0, z: 0, gain: 0, cutoff: AIR_CUTOFF, delay: 0 };
  const west = { ...arrival, x: -LAKE_GLAZING.halfWidth, y: 1.65, z: LAKE_HALL.frontZ };
  const east = { ...west, x: LAKE_GLAZING.halfWidth };
  return [arrival, west, east];
}

export function lakeSurfaceAt(x: number, z: number): LakeSurface | undefined {
  if (Math.abs(x) <= LAKE_TATAMI.halfWidth && z >= LAKE_TATAMI.frontZ && z <= LAKE_TATAMI.rearZ) return 'tatami';
  if (Math.abs(x) <= LAKE_HALL.halfWidth && z >= LAKE_HALL.frontZ && z <= LAKE_HALL.rearZ) return 'wood';
  if (Math.abs(x) >= LAKE_VERANDA.insideX && Math.abs(x) <= LAKE_VERANDA.outsideX
    && z >= LAKE_VERANDA.endZ && z < LAKE_HALL.frontZ) return 'wood';
  return undefined;
}

function distanceGain(distance: number): number {
  return 4 / (4 + distance);
}

function airCutoff(distance: number): number {
  return AIR_CUTOFF / (1 + distance / 75) ** 0.8;
}

/** Fixed facade approximation for lake-side emitters and a listener inside or on the veranda. */
export function lakeSoundPaths(
  listener: LakePoint, source: LakePoint, paths = createLakeSoundPaths(),
): LakeSoundPaths {
  const { frontZ, halfWidth } = LAKE_HALL;
  const direct = paths[0];
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
  direct.x = source.x;
  direct.y = source.y;
  direct.z = source.z;
  direct.gain = distanceGain(distance);
  direct.cutoff = airCutoff(distance);
  paths[1].gain = 0;
  paths[2].gain = 0;
  if (listener.z <= frontZ || source.z >= frontZ) return paths;

  const t = (frontZ - listener.z) / (source.z - listener.z);
  const crossX = MathUtils.lerp(listener.x, source.x, t);
  const crossY = MathUtils.lerp(listener.y, source.y, t);
  const glass = 1 - MathUtils.smoothstep(Math.abs(crossX), LAKE_GLAZING.halfWidth - 0.55, LAKE_GLAZING.halfWidth + 0.55);
  // Rays beyond the facade's outer posts leave through a solid side wall.
  const side = MathUtils.smoothstep(Math.abs(crossX), halfWidth - 0.55, halfWidth + 0.55);
  const openingHeight = MathUtils.smoothstep(crossY, -0.24, 0.16)
    * (1 - MathUtils.smoothstep(crossY, LAKE_GLAZING.headY - 0.6, LAKE_GLAZING.headY + 0.25));
  const depth = MathUtils.smoothstep(listener.z - frontZ, 0, 0.18);
  const throughGlass = depth * openingHeight * glass;
  const screen = depth * (1 - openingHeight * (1 - glass - side));
  direct.gain *= 1 - 0.88 * throughGlass - 0.96 * (screen - throughGlass);
  direct.cutoff *= 0.078 ** screen;
  if (screen === 0) return paths;

  for (const [index, arrival] of paths.entries()) {
    if (index === 0) continue;
    const sign = index === 1 ? -1 : 1;
    const x = sign * MathUtils.clamp(sign * crossX, LAKE_GLAZING.halfWidth, halfWidth);
    const near = Math.hypot(listener.x - x, listener.z - frontZ);
    const far = Math.hypot(source.x - x, source.z - frontZ);
    const y = MathUtils.clamp(MathUtils.lerp(listener.y, source.y, near / (near + far)), 0.12, LAKE_GLAZING.headY);
    const route = Math.hypot(near, listener.y - y) + Math.hypot(far, source.y - y);
    const detour = Math.max(0, route - distance);
    arrival.x = x;
    arrival.y = y;
    arrival.z = frontZ;
    arrival.delay = Math.min(LAKE_MAX_OPENING_DELAY, detour / SOUND_SPEED);
    // The two opening edges keep their own positions, gains and delays as the viewer moves.
    // Longer detours lose more upper-band energy and contribute less at the listener.
    arrival.gain = 0.64 * screen * distanceGain(route) * Math.exp(-detour / 15);
    arrival.cutoff = airCutoff(route) / (1 + detour / 5.5);
  }
  return paths;
}
