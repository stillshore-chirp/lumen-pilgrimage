import type { CoastNavigation } from '../../CoastControls';
import {
  ATRIUM_BOUNDS, ATRIUM_CAFE, ATRIUM_CAFE_CHAIRS, ATRIUM_CAFE_COUNTER, ATRIUM_CAFE_PLANTERS, ATRIUM_CAFE_TABLES,
  ATRIUM_DESTINATIONS, ATRIUM_ELEVATOR, ATRIUM_LEVELS, ATRIUM_SCULPTURE, ATRIUM_SOFA, ATRIUM_WALK_LEVEL,
  atriumDeckContains, atriumStairDistance, atriumStairHeight, atriumUpperStairHeight,
} from './atriumLayout';

const railClearance = 0.20;
const slabDepth = 0.49;
const stairDepth = 1.15;
const roofY = 17.1;

function stairFloor(x: number, z: number, inset = 0): number {
  const along = atriumStairDistance(x, z, inset);
  return along === undefined ? -Infinity : atriumStairHeight(along);
}

export function atriumSupportAt(x: number, z: number, footLimit: number): number {
  const stair = stairFloor(x, z, railClearance);
  const upperStair = atriumUpperStairHeight(x, z, railClearance);
  const gallery = footLimit >= ATRIUM_LEVELS[2] - 1e-6 && atriumDeckContains(x, z, 2, railClearance) ? ATRIUM_LEVELS[2]
    : footLimit >= ATRIUM_WALK_LEVEL - 1e-6 && atriumDeckContains(x, z, 1, railClearance) ? ATRIUM_WALK_LEVEL : 0;
  return Math.max(gallery, stair <= footLimit ? stair : 0, upperStair <= footLimit ? upperStair : 0);
}

export function atriumCeilingHeight(x: number, z: number, foot = 0): number {
  let ceiling = roofY;
  for (const [index, level] of ATRIUM_LEVELS.entries()) {
    if (level - slabDepth > foot && atriumDeckContains(x, z, index)) {
      ceiling = level - slabDepth;
      break;
    }
  }
  const stair = stairFloor(x, z);
  if (stair - foot > 0.12) ceiling = Math.min(ceiling, stair - stairDepth);
  const upperStair = atriumUpperStairHeight(x, z);
  if (upperStair - foot > 0.12) ceiling = Math.min(ceiling, upperStair - 0.63);
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
  const cafeX = x - ATRIUM_CAFE.x;
  const cafeZ = z - ATRIUM_CAFE.z;
  const counter = ATRIUM_CAFE_COUNTER;
  const cafe = (Math.abs(cafeX - counter.x) < counter.width / 2 + .16
    && Math.abs(cafeZ - counter.z) < counter.depth / 2 + .16)
    || ATRIUM_CAFE_TABLES.some(table =>
      ((cafeX - table.x) / (table.width / 2 + .16)) ** 2 + ((cafeZ - table.z) / (table.depth / 2 + .16)) ** 2 < 1)
    || ATRIUM_CAFE_CHAIRS.some(chair => Math.hypot(cafeX - chair.x, cafeZ - chair.z) < .44)
    || ATRIUM_CAFE_PLANTERS.some(planter => Math.hypot(cafeX - planter.x, cafeZ - planter.z) < .52);
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
