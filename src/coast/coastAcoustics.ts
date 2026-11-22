import { groundHeight, SEA_LEVEL, smoothstep, type CoastPoint } from './terrain';

export function terrainOcclusion(listener: CoastPoint, source: CoastPoint): number {
  const distance = Math.hypot(source.x - listener.x, source.z - listener.z);
  const samples = Math.min(44, Math.max(3, Math.ceil(distance / 3.7)));
  let obstruction = 0;
  for (let i = 1; i < samples; i += 1) {
    const t = i / samples;
    const x = listener.x + (source.x - listener.x) * t;
    const z = listener.z + (source.z - listener.z) * t;
    const y = listener.y + (source.y - listener.y) * t;
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
