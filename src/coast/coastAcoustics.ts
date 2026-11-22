import { groundHeight, SEA_LEVEL, smoothstep, type CoastPoint } from './terrain';
import type { CoastTimeOfDay } from './world/coastAtmosphere';

export const REFRACTION_SHELF_HZ = 520;

/** Midpoint offset from a straight ray for calm daylight and a weak night inversion. */
export function thermalRayLift(horizontalDistance: number, time: CoastTimeOfDay): number {
  // A linear sound speed gradient gives a shallow arc. Its influence is bounded outside the surface layer.
  const speedGradient = time === 'night' ? 0.016 : -0.010;
  return Math.max(-14, Math.min(14, speedGradient * horizontalDistance ** 2 / (8 * 343)));
}

/** Approximate the change in low-band arrivals as near-ground shadowing opens or closes. */
export function thermalLowShelfDb(distance: number, time: CoastTimeOfDay, fullDistance = 480): number {
  return (time === 'night' ? 2.7 : -1.1) * smoothstep(60, fullDistance, distance);
}

export function terrainOcclusion(listener: CoastPoint, source: CoastPoint, rayLift = 0): number {
  const distance = Math.hypot(source.x - listener.x, source.z - listener.z);
  const samples = Math.min(44, Math.max(3, Math.ceil(distance / (distance < 45 ? 1.5 : 3.7))));
  let obstruction = 0;
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const x = listener.x + (source.x - listener.x) * t;
    const z = listener.z + (source.z - listener.z) * t;
    const y = listener.y + (source.y - listener.y) * t + 4 * rayLift * t * (1 - t);
    obstruction = Math.max(obstruction, groundHeight(x, z) - y);
  }
  return smoothstep(0.12, 10, obstruction);
}

export function soundReach(distance: number, range: number): number {
  return 1 - smoothstep(range * 0.72, range, distance);
}

export function airCutoff(distance: number): number {
  return 17_000 / (1 + distance / 130) ** 1.45;
}

type RockFace = { point: CoastPoint; strength: number; angle: number };
type Opening = { point: CoastPoint; distance: number; clearance: number };
export type TerrainArrival = { point: CoastPoint; gain: number; delay: number; cutoff: number; distance: number };

const PROBE_DISTANCES = [2.5, 4.5, 7, 10, 14.5, 20] as const;
const PROBE_DIRECTIONS = Array.from({ length: 12 }, (_, index) => {
  const angle = index * Math.PI / 6;
  return { x: Math.cos(angle), z: Math.sin(angle), angle };
});
const ROCK_SLOT_MOUTHS = [{ x: -63, z: 280 }, { x: -52, z: 323 }] as const;

function distanceBetween(a: CoastPoint, b: CoastPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Sample near the ears so rock responses follow landforms and drop away in flight or in the open. */
export function listenerTerrain(listener: CoastPoint): {
  faces: RockFace[];
  openings: Opening[];
  enclosure: number;
  canopy: number;
} {
  const ground = groundHeight(listener.x, listener.z);
  const aboveGround = listener.y - ground;
  const canopy = smoothstep(146, 215, listener.z) * (1 - smoothstep(351, 392, listener.z))
    * (1 - smoothstep(10, 28, aboveGround)) * (1 - smoothstep(80, 150, Math.abs(listener.x)));
  if (aboveGround > 21) return { faces: [], openings: [], enclosure: 0, canopy };

  const faces: RockFace[] = [];
  for (const direction of PROBE_DIRECTIONS) {
    let previousHeight = ground;
    let previousDistance = 0;
    for (const radius of PROBE_DISTANCES) {
      const x = listener.x + direction.x * radius;
      const z = listener.z + direction.z * radius;
      const height = groundHeight(x, z);
      const grade = (height - previousHeight) / (radius - previousDistance);
      previousHeight = height;
      previousDistance = radius;
      const strength = smoothstep(0.4, 2.4, height - listener.y) * smoothstep(0.45, 1.35, grade)
        * (1 - smoothstep(7, 22, radius));
      if (strength < 0.045) continue;
      // Put the reflecting point just in front of the steep face.
      const point = { x: x - direction.x, y: listener.y + 0.35, z: z - direction.z };
      const clearance = (1 - terrainOcclusion(listener, point)) ** 2;
      faces.push({ angle: direction.angle, point, strength: strength * clearance });
      break;
    }
  }
  faces.sort((a, b) => b.strength - a.strength);
  const strongest = faces[0];
  const opposite = strongest && faces.find(face => Math.cos(face.angle - strongest.angle) < -0.35);
  const enclosure = strongest ? strongest.strength * 0.35 + (opposite?.strength ?? 0) * 0.65 : 0;
  const nearbyFaces = strongest ? [strongest, ...(opposite ? [opposite] : [])] : [];

  const openings: Opening[] = [];
  for (const mouth of ROCK_SLOT_MOUTHS) {
    const horizontal = Math.hypot(listener.x - mouth.x, listener.z - mouth.z);
    if (horizontal > 53) continue;
    const point = { ...mouth, y: groundHeight(mouth.x, mouth.z) + 2.7 };
    const clearance = (1 - terrainOcclusion(listener, point)) ** 2 * (1 - smoothstep(24, 53, horizontal));
    openings.push({ point, clearance, distance: distanceBetween(listener, point) });
  }
  return { faces: nearbyFaces, openings, enclosure, canopy };
}

/** Choose the strongest early arrival from exposed rock or a leg around the rock slot. */
export function terrainArrival(
  listener: CoastPoint,
  source: CoastPoint,
  terrain: ReturnType<typeof listenerTerrain>,
  directDistance: number,
  obstruction: number,
): TerrainArrival | undefined {
  let arrival: TerrainArrival | undefined;
  if (obstruction > 0.08) {
    for (const opening of terrain.openings) {
      const fromSource = distanceBetween(source, opening.point);
      const distance = fromSource + opening.distance;
      const detour = distance - directDistance;
      const exposed = (1 - terrainOcclusion(source, opening.point)) ** 2;
      const gain = 0.64 * obstruction * exposed * opening.clearance / (1 + detour * 0.052);
      if (gain < 0.016 || (arrival && gain <= arrival.gain)) continue;
      arrival = {
        point: opening.point, distance, gain, delay: Math.min(0.22, detour / 343 + 0.012),
        cutoff: Math.min(3650, airCutoff(distance) * 0.54),
      };
    }
  }

  for (const face of terrain.faces) {
    const distance = distanceBetween(listener, face.point) + distanceBetween(face.point, source);
    const excess = distance - directDistance;
    const exposed = (1 - terrainOcclusion(source, face.point)) ** 2;
    const gain = 0.38 * face.strength * exposed / (1 + excess * 0.08);
    if (gain < 0.016 || (arrival && gain <= arrival.gain)) continue;
    arrival = {
      point: face.point, distance, gain, delay: Math.min(0.18, 0.018 + excess / 343),
      cutoff: Math.min(6200, airCutoff(distance) * 0.70),
    };
  }
  return arrival;
}

export function waterReflection(listener: CoastPoint, source: CoastPoint): { gain: number; delay: number } {
  const sourceHeight = source.y - SEA_LEVEL;
  const earHeight = listener.y - SEA_LEVEL;
  if (earHeight <= 0 || sourceHeight <= 0) return { gain: 0, delay: 0 };
  const t = earHeight / (earHeight + sourceHeight);
  const bounce = { x: listener.x + (source.x - listener.x) * t, y: SEA_LEVEL, z: listener.z + (source.z - listener.z) * t };
  const wet = smoothstep(0.07, 0.82, SEA_LEVEL - groundHeight(bounce.x, bounce.z));
  if (wet === 0) return { gain: 0, delay: 0 };
  const blocked = Math.max(terrainOcclusion(listener, bounce), terrainOcclusion(bounce, source));
  const horizontal = Math.hypot(listener.x - source.x, listener.z - source.z);
  const direct = Math.hypot(horizontal, earHeight - sourceHeight);
  const reflected = Math.hypot(horizontal, earHeight + sourceHeight);
  // A short offset spreads the reflection from the moving water.
  return {
    gain: wet * (1 - blocked) ** 2 * (1 - smoothstep(180, 480, direct) * 0.75),
    delay: Math.min(0.15, 0.009 + (reflected - direct) / 343),
  };
}
