import type { CoastPose } from '../../CoastControls';

// Metres. The reference camera stands near z=0 and looks along the negative Z axis.
export const ATRIUM_LABEL = '商業アトリウム';
export const ATRIUM_BOUNDS = { minX: -11.4, maxX: 11.4, minZ: -48, maxZ: 3 };
export const ATRIUM_GALLERY_EDGE = 8.15;
export const ATRIUM_REAR_GALLERY = -45.25;
export const ATRIUM_LEVELS = [4.55, 9.15, 13.55] as const;
export const ATRIUM_WALK_LEVEL = ATRIUM_LEVELS[1];
export const ATRIUM_ELEVATOR = { minX: 7.65, maxX: 10.25, minZ: -42, maxZ: -35 };
export const ATRIUM_SOFA = { x: -2.7, z: -29.7, width: 4.55, seatedEyeHeight: 1.20 };
export const ATRIUM_LOUNGE = { x: -2.1, z: -32, radiusX: 5.2, radiusZ: 3.6 };
export const ATRIUM_SCULPTURE = { x: -2.15, z: -34, radius: 0.68, height: 5.4 };
export const ATRIUM_CAFE = { x: 8.9, z: -30.7, radiusX: 2.4, radiusZ: 3.3 };

export const ATRIUM_STAIR = {
  centerX: -7.8,
  centerZ: -30.6,
  radius: 12.5,
  width: 3.8,
  angle: 1.46,
  landingEnd: 1.69,
  height: ATRIUM_WALK_LEVEL,
  flights: 3,
  stepsPerFlight: 18,
  landingLength: 0.9,
};

const { radius, angle, flights, stepsPerFlight, landingLength, height, landingEnd } = ATRIUM_STAIR;
const landingAngle = landingLength / radius;
const stepAngle = (angle - landingAngle * (flights - 1)) / (flights * stepsPerFlight);
const rise = height / (flights * stepsPerFlight);

// Each rendered nosing sits half a tread ahead of its matching smooth support height.
// The two inter-flight landings and the final bridge have level support.
function stairProfile() {
  const steps: { start: number; end: number; y: number }[] = [];
  const ramps: { start: number; end: number; low: number; high: number }[] = [];
  let along = 0;
  let y = 0;
  for (let flight = 0; flight < flights; flight++) {
    const end = along + stepAngle * stepsPerFlight;
    ramps.push({ start: along, end, low: y, high: y + rise * stepsPerFlight });
    for (let step = 0; step < stepsPerFlight; step++) {
      steps.push({ start: along, end: along + stepAngle, y: y + rise * 0.5 });
      y += rise;
      along += stepAngle;
    }
    if (flight < flights - 1) {
      steps.push({ start: along, end: along + landingAngle, y });
      along += landingAngle;
    }
  }
  steps.push({ start: angle, end: landingEnd, y: height });
  return { steps, ramps };
}

const profile = stairProfile();
export const ATRIUM_STAIR_STEPS = profile.steps;

export function atriumStairPoint(angle: number, radius: number): { x: number; z: number } {
  return {
    x: ATRIUM_STAIR.centerX + radius * Math.cos(angle),
    z: ATRIUM_STAIR.centerZ - radius * Math.sin(angle),
  };
}

export function atriumStairHeight(angle: number): number {
  if (angle <= 0) return 0;
  if (angle >= ATRIUM_STAIR.angle) return height;
  let previousHeight = 0;
  for (const ramp of profile.ramps) {
    if (angle < ramp.start) return previousHeight;
    if (angle <= ramp.end) return ramp.low + (ramp.high - ramp.low) * (angle - ramp.start) / (ramp.end - ramp.start);
    previousHeight = ramp.high;
  }
  return height;
}

export function atriumStairAngle(x: number, z: number, railInset = 0): number | undefined {
  const dx = x - ATRIUM_STAIR.centerX;
  const dz = ATRIUM_STAIR.centerZ - z;
  const r = Math.hypot(dx, dz);
  if (Math.abs(r - radius) > ATRIUM_STAIR.width * 0.5 - railInset) return;
  const angle = Math.atan2(dz, dx);
  return angle >= 0 && angle <= landingEnd ? angle : undefined;
}

export function inAtriumRug(x: number, z: number): boolean {
  return ((x - ATRIUM_LOUNGE.x) / ATRIUM_LOUNGE.radiusX) ** 2
    + ((z - ATRIUM_LOUNGE.z) / ATRIUM_LOUNGE.radiusZ) ** 2 <= 1;
}

export const ATRIUM_DESTINATIONS = [
  { id: 'lounge', label: 'ラウンジのソファ', ...ATRIUM_SOFA, yaw: Math.PI, pitch: 0.035 },
  { id: 'concourse', label: '正面通路', x: 0, z: 0, yaw: 0.038, pitch: 0.122 },
  { id: 'stair-foot', label: '大階段の前', x: 4.72, z: -27.8, yaw: 0.02, pitch: 0.13 },
  { id: 'upper-gallery', label: '上階の回廊', x: -9.22, z: -44.1, yaw: -2.40, pitch: -0.20, floorY: ATRIUM_WALK_LEVEL },
] as const satisfies readonly (CoastPose & { id: string; label: string })[];
