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

export function waterReflection(listener: CoastPoint, source: CoastPoint): { gain: number; delay: number } {
  const sourceHeight = source.y - SEA_LEVEL;
  const earHeight = listener.y - SEA_LEVEL;
  const t = earHeight / (earHeight + sourceHeight);
  const bounceX = listener.x + (source.x - listener.x) * t;
  const bounceZ = listener.z + (source.z - listener.z) * t;
  const wet = smoothstep(0.07, 0.82, SEA_LEVEL - groundHeight(bounceX, bounceZ));
  const horizontal = Math.hypot(listener.x - source.x, listener.z - source.z);
  const direct = Math.hypot(horizontal, earHeight - sourceHeight);
  const reflected = Math.hypot(horizontal, earHeight + sourceHeight);
  // A short offset spreads the reflection from the moving water.
  return {
    gain: wet * (1 - smoothstep(160, 450, direct) * 0.75),
    delay: Math.min(0.15, 0.009 + (reflected - direct) / 343),
  };
}
