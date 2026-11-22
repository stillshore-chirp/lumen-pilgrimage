export const SEA_LEVEL = 0;
export const COAST_BOUNDS = { minX: -104, maxX: 108, minZ: -101, maxZ: 114 };
export const SPAWN = { x: -30, z: 7, yaw: -0.60 };
export const WATERFALL = { x: 18, y: 24, z: -36 };
export const POOL = { x: 18, y: 2.2, z: -22, radiusX: 8, radiusZ: 10 };

function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function mound(x: number, z: number, centerX: number, centerZ: number, width: number, depth: number): number {
  return Math.exp(-(((x - centerX) / width) ** 2 + ((z - centerZ) / depth) ** 2));
}

export function shoreline(x: number): number {
  return -49 + 32 * mound(x, 0, -62, 0, 25, 1)
    - 15 * mound(x, 0, 44, 0, 47, 1) + 2.5 * Math.sin(x * 0.105 + 0.8);
}

export function groundHeight(x: number, z: number): number {
  const inland = z - shoreline(x);
  // The shallow shore grades into rolling ground and then a dry ridge inland.
  const beach = 0.22 * Math.max(-38, Math.min(inland, 10));
  const rise = 3.4 * smoothstep(10, 70, inland) + 7.5 * smoothstep(50, 155, inland);
  const roughness = smoothstep(1, 24, inland) *
    (0.42 * Math.sin(x * 0.18 + z * 0.08) + 0.31 * Math.sin(z * 0.37 - x * 0.09)
      + 0.12 * Math.sin(x * 0.96 + z * 0.58));

  // Each bluff has an irregular, steep seaward face and a broader top.
  const lipZ = -34 + 1.5 * Math.sin((x - WATERFALL.x) * 0.17);
  const fallsBluff = 22 * Math.exp(-(((x - WATERFALL.x) / 18) ** 4)) *
    (1 - smoothstep(lipZ - 2, lipZ + 2, z)) * smoothstep(-63, -48, z);
  const eastFace = -18 + 4 * Math.sin(x * 0.11) + 2 * Math.sin(x * 0.28);
  const eastBluff = 36 * Math.exp(-(((x - 55) / 23) ** 4)) *
    (1 - smoothstep(eastFace - 4, eastFace + 3, z)) * smoothstep(-66, -51, z);
  const westBluff = 12 * mound(x, z, -58, -10, 13, 13) *
    smoothstep(-25, -14, z);
  const ridge = 10 * mound(x, z, 23, 76, 44, 27) + 6 * mound(x, z, -54, 58, 28, 33);

  const basin = Math.hypot((x - POOL.x) / POOL.radiusX, (z - POOL.z) / POOL.radiusZ);
  const poolDepth = 3.8 * (1 - smoothstep(0.58, 1.22, basin));
  return beach + rise + roughness + fallsBluff + eastBluff + westBluff + ridge - poolDepth;
}
