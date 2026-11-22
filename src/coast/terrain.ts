export const SEA_LEVEL = 0;
export const COAST_BOUNDS = { minX: -380, maxX: 390, minZ: -760, maxZ: 195 };
export const LANDSCAPE_BOUNDS = { minX: -574, maxX: 574, minZ: -817, maxZ: 383 };
export const SPAWN = { x: -12, z: 79, yaw: -0.035, pitch: 0.102 };

export function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

export function coastRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Promontory = {
  x: number;
  z: number;
  width: number;
  length: number;
  height: number;
  bearing: number;
};

// Two interlocking headlands frame the inner bay. Smaller offshore ridges
// step into the distance and leave a channel all the way out to the open sea.
const promontories: Promontory[] = [
  { x: -180, z: -143, width: 76, length: 104, height: 154, bearing: -0.25 },
  { x: -154, z: -222, width: 53, length: 78, height: 116, bearing: 0.22 },
  { x: -212, z: -164, width: 92, length: 114, height: 171, bearing: 0.24 },
  { x: -73, z: -281, width: 31, length: 54, height: 96, bearing: -0.24 },
  { x: -112, z: -336, width: 61, length: 77, height: 133, bearing: -0.33 },
  { x: -28, z: -407, width: 41, length: 69, height: 92, bearing: 0.3 },
  { x: -78, z: -503, width: 68, length: 94, height: 124, bearing: 0.42 },
  { x: -171, z: -582, width: 117, length: 83, height: 148, bearing: -0.1 },
  { x: -248, z: -476, width: 72, length: 101, height: 103, bearing: 0.64 },
  { x: 196, z: -199, width: 85, length: 109, height: 181, bearing: 0.3 },
  { x: 233, z: -152, width: 84, length: 96, height: 173, bearing: -0.55 },
  { x: 125, z: -294, width: 39, length: 57, height: 95, bearing: -0.37 },
  { x: 183, z: -323, width: 98, length: 108, height: 148, bearing: 0.22 },
  { x: 133, z: -450, width: 54, length: 83, height: 92, bearing: -0.42 },
  { x: 199, z: -577, width: 91, length: 95, height: 124, bearing: 0.2 },
  { x: 277, z: -653, width: 103, length: 95, height: 99, bearing: -0.3 },
];

const buttresses = promontories.map(rock => ({
  ...rock, cos: Math.cos(rock.bearing), sin: Math.sin(rock.bearing),
  extent: Math.max(rock.length, rock.width) * 1.55 + 12
}));

function dune(x: number, z: number, cx: number, cz: number, rx: number, rz: number): number {
  const radius = Math.hypot((x - cx) / rx, (z - cz) / rz);
  return 1 - smoothstep(0.22, 1.22, radius);
}

export function shoreline(x: number): number {
  return 72 + 13 * Math.sin(x * 0.014) + 3.2 * Math.sin(x * 0.062 + 0.6)
    - 45 * (1 - smoothstep(0, 105, Math.abs(x + 103)))
    - 33 * (1 - smoothstep(0, 88, Math.abs(x - 117)));
}

export function groundHeight(x: number, z: number): number {
  const shore = z - shoreline(x);
  const shelf = shore * (shore < 0 ? 0.177 : 0.208);
  const beachRipples = (0.1 * Math.sin(z * 0.58 + x * 0.24) + 0.13 * Math.sin(x * 0.14 - z * 0.26))
    * smoothstep(0, 4, Math.abs(shore));
  const beds = (1.16 * Math.sin(x * 0.052 - z * 0.084) + 0.63 * Math.sin(x * 0.16 + z * 0.099))
    * smoothstep(5.0, 31.0, -shore);
  const base = Math.max(-37, Math.min(shelf, 6.4)) + beachRipples + beds;
  const dunes = 18 * dune(x, z, -101, 48, 57, 48)
    + 37 * dune(x, z, -123, -29, 71, 113)
    + 45 * dune(x, z, 136, -29, 82, 128)
    + 17 * dune(x, z, 90, 61, 60, 53)
    + 29 * dune(x, z, -120, -156, 47, 62)
    + 24 * dune(x, z, 117, -143, 45, 67)
    + 7 * dune(x, z, -15, 134, 66, 39);
  const roughGround = (1.05 * Math.sin(x * 0.126 + z * 0.16)
    + 0.68 * Math.sin(z * 0.37 - x * 0.093)
    + 0.19 * Math.sin(x * 0.79 + z * 0.56)) * smoothstep(4, 27, shore + dunes * 0.6);
  const flats = 8.1 * dune(x, z, -39, 26, 13, 16) + 9.9 * dune(x, z, 39, 22, 17, 19);
  let height = base + dunes + roughGround + flats;

  const warpedX = x + 4.4 * Math.sin(z * 0.16 + x * 0.021)
    + 2.8 * Math.sin(z * 0.51 - x * 0.26) + 2.05 * Math.sin(x * 0.34 + z * 0.25);
  const warpedZ = z + 5.1 * Math.sin(x * 0.13 + z * 0.045)
    + 3.0 * Math.sin(x * 0.45 - z * 0.20);
  for (const rock of buttresses) {
    const dx = warpedX - rock.x;
    const dz = warpedZ - rock.z;
    if (Math.abs(dx) > rock.extent || Math.abs(dz) > rock.extent) continue;
    const u = Math.abs((dx * rock.cos + dz * rock.sin) / rock.width);
    const v = Math.abs((-dx * rock.sin + dz * rock.cos) / rock.length);
    const r = Math.hypot(u, v) * 0.72 + Math.max(u, v) * 0.28;
    if (r >= 1.28) continue;

    const bedding = 0.035 * Math.sin(x * 0.081 + z * 0.13)
      + 0.027 * Math.sin(x * 0.34 - z * 0.21) + 0.012 * Math.sin(x * 0.67 + z * 0.57);
    const terrace = 0.036 * Math.sin(x * 0.078 - z * 0.13);
    const face = 0.55 * (1 - smoothstep(0.732, 0.861, r + bedding + terrace));
    const shoulder = 0.25 * (1 - smoothstep(0.90, 1.043, r + bedding*0.54));
    const crest = 0.20 * (1 - smoothstep(0.16, 0.84, r));
    const foothill = 18 * (1 - smoothstep(0.99, 1.245, r));
    const cap = (6.3 * Math.sin(x * 0.103 + z * 0.069) + 4.4 * Math.cos(z * 0.14 - x * 0.18)
      + 2.1 * Math.sin(x * 0.44 + z * 0.50)) * (1 - smoothstep(0.40, 0.98, r));
    const cliff = rock.height * (face + shoulder + crest) + foothill + cap - 7;
    const skirt = 1 - smoothstep(1.08, 1.28, r);
    height = Math.max(height, base + (cliff - base) * skirt);
  }
  const edgeX = smoothstep(336, 560, Math.abs(x + 13 * Math.sin(z * 0.031)));
  const inlandEdge = 222 + 32 * Math.sin(x * 0.016) + 17 * Math.sin(x * 0.061);
  const edgeZ = smoothstep(inlandEdge, inlandEdge + 107, z);
  const shelfEdge = Math.max(edgeX, edgeZ);
  return height * (1 - shelfEdge) - 29 * shelfEdge;
}

export function groundSlope(x: number, z: number, span = 1.35): number {
  return Math.hypot(groundHeight(x + span, z) - groundHeight(x - span, z),
    groundHeight(x, z + span) - groundHeight(x, z - span)) / (2 * span);
}

export type CoastPoint = { x: number; y: number; z: number };
export type CoastWaterfall = {
  path: CoastPoint[];
  width: number;
  direction: { x: number; z: number };
  impact: CoastPoint;
};

function traceWaterfall(x: number, z: number, angle: number, width: number): CoastWaterfall {
  const direction = { x: Math.cos(angle), z: Math.sin(angle) };
  // Start above the crown and march towards the bay until each elevation
  // clears the face, including the two edges of the sheet.
  const lip = groundHeight(x, z) + 1.3;
  const path: CoastPoint[] = [];
  let run = 0;
  for (let row = 0; row <= 28; row += 1) {
    const drop = row / 28;
    const y = lip * (1 - drop) + 0.2;
    const halfSpan = width * (0.47 + 0.17 * drop);
    let px = x + run * direction.x;
    let pz = z + run * direction.z;
    while (run < 148) {
      const left = groundHeight(px - direction.z * halfSpan, pz + direction.x * halfSpan);
      const right = groundHeight(px + direction.z * halfSpan, pz - direction.x * halfSpan);
      if (Math.max(left, right, groundHeight(px, pz)) < y - 0.44) break;
      run += 0.38;
      px = x + run * direction.x;
      pz = z + run * direction.z;
    }
    path.push({ x: px + direction.x * 0.7, y, z: pz + direction.z * 0.7 });
  }
  return { path, width, direction, impact: path[path.length - 1] };
}

export const COAST_FALLS = [
  traceWaterfall(150, -186, 2.13, 8.6),
  traceWaterfall(-127, -192, 0.57, 7.7),
  traceWaterfall(-48, -383, 0.92, 5.5),
];

export const COAST_GROVES = {
  west: { x: -64, z: 67 },
  east: { x: 50, z: 79 },
  shore: { x: -25, z: 91 },
};
