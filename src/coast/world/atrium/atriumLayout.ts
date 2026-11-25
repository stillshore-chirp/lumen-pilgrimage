import type { CoastPose } from '../../CoastControls';

// Metres. The reference camera stands near z=0 and looks along the negative Z axis.
export const ATRIUM_LABEL = '商業アトリウム';
export const ATRIUM_BOUNDS = { minX: -11.4, maxX: 11.4, minZ: -60, maxZ: 3 };
export const ATRIUM_GALLERY_EDGE = 8.15;
export const ATRIUM_FIRST_BRIDGE = { minX: -8.25, maxX: 1.8, minZ: -43.65, maxZ: -38.35 };
export const ATRIUM_FIRST_GALLERY_FRONT_EDGE = { west: 6.05, east: 4.55 } as const;
export const ATRIUM_FIRST_LEVEL_FORECOURT = {
  frontZ: 3,
  taperZ: -38.35,
  westFrontX: -ATRIUM_FIRST_GALLERY_FRONT_EDGE.west,
  eastFrontX: ATRIUM_FIRST_GALLERY_FRONT_EDGE.east,
  galleryEdge: ATRIUM_GALLERY_EDGE,
} as const;
export const ATRIUM_REAR_GALLERY = -56.45;
export const ATRIUM_LEVELS = [4.55, 9.15, 13.55] as const;
export const ATRIUM_GALLERY_FRONTS = [3, 1.8, -0.35] as const;
export const ATRIUM_WALK_LEVEL = ATRIUM_LEVELS[1];
export const ATRIUM_SKYLIGHT = { x: .565, y: 17.10, z: -44.92, radiusX: 9.56, radiusZ: 13.17, yaw: .383 };
export const ATRIUM_ELEVATOR = { minX: 1.55, maxX: 8.15, minZ: -55.6, maxZ: -49.7 };
export const ATRIUM_SOFA = { x: -2.7, z: -29.7, width: 4.55, seatedEyeHeight: 1.20 };
export const ATRIUM_LOUNGE = { x: -2.1, z: -32, radiusX: 5.2, radiusZ: 3.6 };
export const ATRIUM_SCULPTURE = { x: -2.15, z: -34, radius: 0.68, height: 5.4 };
export const ATRIUM_CAFE = { x: 8.9, z: -30.7 };
export const ATRIUM_CAFE_COUNTER = { x: 0.06, z: -2.02, width: 3.05, depth: 0.73 };
export const ATRIUM_CAFE_TABLES = [
  { x: -1.05, z: 0.95, width: 0.96, depth: 0.90 },
  { x: 0.84, z: -0.25, width: 0.84, depth: 0.76 },
] as const;
export const ATRIUM_CAFE_CHAIRS = [
  { x: -1.05, z: 1.94, yaw: Math.PI },
  { x: -1.05, z: -0.05, yaw: 0 },
  { x: -2.02, z: 0.95, yaw: Math.PI / 2 },
  { x: 1.28, z: -0.25, yaw: -Math.PI / 2 },
  { x: 0.84, z: 0.74, yaw: Math.PI },
] as const;
export const ATRIUM_CAFE_PLANTERS = [
  { x: 1.20, z: -2.45, scale: 0.95 },
  { x: 1.20, z: 2.45, scale: 0.86 },
] as const;

type Point = Readonly<{ x: number; z: number }>;
type StairDeck = Readonly<{ start: number; end: number; low: number; high: number }>;

const stairCenter = { x: .73, z: -42.45 };
const turningRadius = 4.62;
const turningSweep = 2.07;
const mouth = { x: 2.55, z: -34.55 };
const turnStart = { x: stairCenter.x + turningRadius, z: stairCenter.z };
const turnEnd = { x: stairCenter.x + turningRadius * Math.cos(turningSweep),
  z: stairCenter.z - turningRadius * Math.sin(turningSweep) };
const westLanding = { x: -9.72, z: -39.18 };

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    z: a * p0.z + b * p1.z + c * p2.z + d * p3.z };
}

// The lower flight opens toward the viewer, then turns north around the tower. The
// upper sweep returns toward the left gallery. All distances are centreline metres.
function stairCenterline() {
  const points: Point[] = [mouth];
  for (let step = 1; step <= 64; step++) {
    points.push(cubicPoint(mouth, { x: 3.3, z: -36.55 }, { x: turnStart.x, z: -39.1 }, turnStart, step / 64));
  }
  for (let step = 1; step <= 96; step++) {
    const angle = turningSweep * step / 96;
    points.push({ x: stairCenter.x + turningRadius * Math.cos(angle),
      z: stairCenter.z - turningRadius * Math.sin(angle) });
  }
  const join = { x: turnEnd.x - 3.8 * Math.sin(turningSweep), z: turnEnd.z - 3.8 * Math.cos(turningSweep) };
  for (let step = 1; step <= 80; step++) {
    points.push(cubicPoint(turnEnd, join, { x: -6.75, z: -38.0 }, westLanding, step / 80));
  }
  let distance = 0;
  return points.map((point, index) => {
    const behind = points[Math.max(0, index - 1)];
    const ahead = points[Math.min(points.length - 1, index + 1)];
    distance += Math.hypot(point.x - behind.x, point.z - behind.z);
    const tangentSize = Math.hypot(ahead.x - behind.x, ahead.z - behind.z);
    return { ...point, along: distance, normalX: (behind.z - ahead.z) / tangentSize,
      normalZ: (ahead.x - behind.x) / tangentSize };
  });
}

const centerline = stairCenterline();
export const ATRIUM_STAIR_LENGTH = centerline[centerline.length - 1].along;
const mainFlights: readonly StairDeck[] = [
  { start: 0, end: 7.8, low: 0, high: 3.05 },
  { start: 8.55, end: 14.9, low: 3.05, high: 6.10 },
  { start: 15.65, end: 21.8, low: 6.10, high: ATRIUM_WALK_LEVEL },
];

function stepIntervals(flights: readonly StairDeck[], risers: number, length: number) {
  const steps: { start: number; end: number; y: number }[] = [];
  for (const [index, flight] of flights.entries()) {
    const run = (flight.end - flight.start) / risers;
    const rise = (flight.high - flight.low) / risers;
    for (let step = 0; step < risers; step++) {
      steps.push({ start: flight.start + run * step, end: flight.start + run * (step + 1),
        y: flight.low + rise * (step + 0.5) });
    }
    steps.push({ start: flight.end, end: flights[index + 1]?.start ?? length, y: flight.high });
  }
  return steps;
}

export const ATRIUM_STAIR_STEPS = stepIntervals(mainFlights, 18, ATRIUM_STAIR_LENGTH);

export function atriumStairHeight(along: number): number {
  let floor = 0;
  for (const { start, end, low, high } of mainFlights) {
    if (along < start) return floor;
    if (along <= end) return low + (high - low) * (along - start) / (end - start);
    floor = high;
  }
  return floor;
}

export function atriumStairFrame(distance: number) {
  const along = Math.min(ATRIUM_STAIR_LENGTH, Math.max(0, distance));
  let lower = 0, upper = centerline.length - 1;
  while (upper - lower > 1) {
    const middle = Math.floor((upper + lower) / 2);
    if (along < centerline[middle].along) upper = middle;
    else lower = middle;
  }
  const a = centerline[lower], b = centerline[upper];
  const t = (along - a.along) / (b.along - a.along);
  const nx = a.normalX + (b.normalX - a.normalX) * t;
  const nz = a.normalZ + (b.normalZ - a.normalZ) * t;
  const unit = Math.hypot(nx, nz);
  const width = 4.14 + 0.90 * (1 - Math.min(1, along / 7.8)) ** 2;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, normalX: nx / unit, normalZ: nz / unit,
    width, y: atriumStairHeight(along) };
}

export function atriumStairPoint(along: number, across: number): Point {
  const frame = atriumStairFrame(along);
  return { x: frame.x + across * frame.normalX, z: frame.z + across * frame.normalZ };
}

export function atriumStairDistance(x: number, z: number, railInset = 0): number | undefined {
  if (x < -11.8 || x > 8.0 || z < -50.0 || z > -32.0) return;
  let nearest = Infinity, along = 0, across = 0;
  for (let index = 1; index < centerline.length; index++) {
    const a = centerline[index - 1], b = centerline[index];
    const dx = b.x - a.x, dz = b.z - a.z;
    const raw = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz);
    const t = Math.min(1, Math.max(0, raw));
    const ex = x - a.x - t * dx, ez = z - a.z - t * dz;
    const distance = ex * ex + ez * ez;
    if (distance >= nearest) continue;
    nearest = distance;
    across = Math.sqrt(distance);
    along = (index === 1 && raw < 0) || (index === centerline.length - 1 && raw > 1)
      ? -1 : a.along + (b.along - a.along) * t;
  }
  if (along < 0 || across > atriumStairFrame(along).width * 0.5 - railInset) return;
  return along;
}

export const ATRIUM_UPPER_STAIR = {
  start: { x: -8.60, z: -47.15, y: ATRIUM_WALK_LEVEL },
  end: { x: .60, z: -47.15, y: ATRIUM_LEVELS[2] },
  width: 2.45,
  risers: 26,
};
export const ATRIUM_UPPER_LANDING = { minX: .38, maxX: 8.82, minZ: -48.59, maxZ: -45.71 };
export const ATRIUM_STAIR_WEST_LINK = { minX: -8.85, maxX: -5.85, minZ: -43.20, maxZ: -38.74 };

function inPad(x: number, z: number, pad: { minX: number; maxX: number; minZ: number; maxZ: number }, inset: number) {
  return x >= pad.minX + inset && x <= pad.maxX - inset && z >= pad.minZ + inset && z <= pad.maxZ - inset;
}

export function atriumFirstLevelInnerEdge(z: number, side: -1 | 1, inset = 0): number {
  const { frontZ, taperZ, westFrontX, eastFrontX, galleryEdge } = ATRIUM_FIRST_LEVEL_FORECOURT;
  const t = Math.max(0, Math.min(1, (frontZ - z) / (frontZ - taperZ)));
  const front = side < 0 ? westFrontX : eastFrontX;
  const rear = side < 0 ? -galleryEdge : galleryEdge;
  return front + (rear - front) * t + (side < 0 ? -inset : inset);
}

export function atriumDeckContains(x: number, z: number, index: number, inset = 0): boolean {
  if (index === 0) {
    if (z <= ATRIUM_FIRST_LEVEL_FORECOURT.taperZ - inset) {
      if (Math.abs(x) >= ATRIUM_GALLERY_EDGE + inset) return true;
    } else if (z <= ATRIUM_FIRST_LEVEL_FORECOURT.frontZ - inset) {
      const west = atriumFirstLevelInnerEdge(z, -1, inset);
      const east = atriumFirstLevelInnerEdge(z, 1, inset);
      if (x <= west || x >= east) return true;
    }
    return inPad(x, z, ATRIUM_FIRST_BRIDGE, inset);
  }
  if (Math.abs(x) >= ATRIUM_GALLERY_EDGE + inset && z <= ATRIUM_GALLERY_FRONTS[index] - inset) return true;
  return z <= ATRIUM_REAR_GALLERY - inset
    || inPad(x, z, index === 1 ? ATRIUM_STAIR_WEST_LINK : ATRIUM_UPPER_LANDING, inset);
}
const upperStart = ATRIUM_UPPER_STAIR.start, upperEnd = ATRIUM_UPPER_STAIR.end;
const upperX = upperEnd.x - upperStart.x, upperZ = upperEnd.z - upperStart.z;
export const ATRIUM_UPPER_STAIR_LENGTH = Math.hypot(upperX, upperZ);

export function atriumUpperStairPoint(along: number, across: number) {
  const t = Math.min(1, Math.max(0, along / ATRIUM_UPPER_STAIR_LENGTH));
  return { x: upperStart.x + upperX * t - across * upperZ / ATRIUM_UPPER_STAIR_LENGTH,
    z: upperStart.z + upperZ * t + across * upperX / ATRIUM_UPPER_STAIR_LENGTH,
    y: upperStart.y + (upperEnd.y - upperStart.y) * t };
}

export function atriumUpperStairHeight(x: number, z: number, railInset = 0): number {
  const dx = x - upperStart.x, dz = z - upperStart.z;
  const t = (dx * upperX + dz * upperZ) / (ATRIUM_UPPER_STAIR_LENGTH ** 2);
  const across = (dz * upperX - dx * upperZ) / ATRIUM_UPPER_STAIR_LENGTH;
  if (t < 0 || t > 1 || Math.abs(across) > ATRIUM_UPPER_STAIR.width * .5 - railInset) return -Infinity;
  return upperStart.y + (upperEnd.y - upperStart.y) * t;
}

export function inAtriumRug(x: number, z: number): boolean {
  return ((x - ATRIUM_LOUNGE.x) / ATRIUM_LOUNGE.radiusX) ** 2
    + ((z - ATRIUM_LOUNGE.z) / ATRIUM_LOUNGE.radiusZ) ** 2 <= 1;
}

export const ATRIUM_DESTINATIONS = [
  { id: 'lounge', label: 'ラウンジのソファ', ...ATRIUM_SOFA, yaw: Math.PI, pitch: 0.035 },
  { id: 'concourse', label: '正面通路', x: 0, z: 0, yaw: 0.038, pitch: 0.122 },
  { id: 'stair-foot', label: '大階段の前', x: 2.38, z: -31.7, yaw: -0.25, pitch: 0.13 },
  { id: 'upper-gallery', label: '上階の回廊', x: -9.22, z: -44.1, yaw: -2.40, pitch: -0.20, floorY: ATRIUM_WALK_LEVEL },
] as const satisfies readonly (CoastPose & { id: string; label: string })[];
