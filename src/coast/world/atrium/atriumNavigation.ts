import type { CoastNavigation } from '../../CoastControls';
import {
  ATRIUM_BOUNDS, ATRIUM_CAFE, ATRIUM_DESTINATIONS, ATRIUM_ELEVATOR, ATRIUM_GALLERY_EDGE, ATRIUM_LEVELS,
  ATRIUM_REAR_GALLERY, ATRIUM_SCULPTURE, ATRIUM_SOFA, ATRIUM_WALK_LEVEL, atriumStairAngle, atriumStairHeight,
} from './atriumLayout';

const railClearance = 0.20;
const slabDepth = 0.49;
const stairDepth = 0.55;
const roofY = 17.4;

function onGallery(x: number, z: number, inset = 0): boolean {
  return Math.abs(x) >= ATRIUM_GALLERY_EDGE + inset || z <= ATRIUM_REAR_GALLERY - inset;
}

function stairFloor(x: number, z: number, inset = 0): number {
  const angle = atriumStairAngle(x, z, inset);
  return angle === undefined ? -Infinity : atriumStairHeight(angle);
}

export function atriumSupportAt(x: number, z: number, footLimit: number): number {
  const stair = stairFloor(x, z, railClearance);
  const gallery = footLimit >= ATRIUM_WALK_LEVEL - 1e-6 && onGallery(x, z, railClearance) ? ATRIUM_WALK_LEVEL : 0;
  return Math.max(gallery, stair <= footLimit ? stair : 0);
}

export function atriumCeilingHeight(x: number, z: number, foot = 0): number {
  let ceiling = roofY;
  if (onGallery(x, z)) {
    for (const level of ATRIUM_LEVELS) {
      if (level - slabDepth > foot) {
        ceiling = level - slabDepth;
        break;
      }
    }
  }
  const stair = stairFloor(x, z);
  if (stair - foot > 0.12) ceiling = Math.min(ceiling, stair - stairDepth);
  return ceiling;
}

function insideElevator(x: number, z: number): boolean {
  return x > ATRIUM_ELEVATOR.minX - railClearance && x < ATRIUM_ELEVATOR.maxX + railClearance
    && z > ATRIUM_ELEVATOR.minZ - railClearance && z < ATRIUM_ELEVATOR.maxZ + railClearance;
}

function hitsGroundFurnishing(x: number, z: number): boolean {
  const acrossSofa = Math.abs(x - ATRIUM_SOFA.x);
  const alongSofa = z - ATRIUM_SOFA.z;
  const sofa = acrossSofa < ATRIUM_SOFA.width / 2 + 0.12
    && ((alongSofa < -0.30 && alongSofa > -0.78) || (acrossSofa > ATRIUM_SOFA.width / 2 - 0.28
      && alongSofa > -0.50 && alongSofa < 0.53));
  const sculpture = Math.hypot(x - ATRIUM_SCULPTURE.x, z - ATRIUM_SCULPTURE.z) < ATRIUM_SCULPTURE.radius + 0.17;
  const cafe = ((x - ATRIUM_CAFE.x) / 1.81) ** 2 + ((z - ATRIUM_CAFE.z) / 2.7) ** 2 < 1;
  return sofa || sculpture || cafe;
}

function blocksWalking(x: number, z: number, foot: number, previousFoot?: number): boolean {
  if (insideElevator(x, z)) return true;
  // Catch sideways crossings of the stair and balcony guards, including when jumping.
  if (previousFoot !== undefined) {
    const drop = previousFoot - atriumSupportAt(x, z, foot + 0.04);
    if (drop > 0.26 && (foot < previousFoot - 0.24 || drop > 1.58)) return true;
  }
  return foot < 0.70 && hitsGroundFurnishing(x, z);
}

export const atriumNavigation = {
  bounds: ATRIUM_BOUNDS,
  spawn: ATRIUM_DESTINATIONS[0],
  groundHeight: () => 0,
  supportAt: atriumSupportAt,
  ceilingHeight: atriumCeilingHeight,
  blocksWalking,
  flightCeiling: roofY,
  allowFlight: false,
  walkSpeed: 2.35,
} satisfies CoastNavigation;
