import type { CoastNavigation } from '../../CoastControls';
import {
  ATRIUM_BOUNDS, ATRIUM_CAFE, ATRIUM_CAFE_CHAIRS, ATRIUM_CAFE_PLANTERS, ATRIUM_CAFE_TABLES,
  ATRIUM_DESTINATIONS, ATRIUM_ELEVATOR, ATRIUM_LEVELS, ATRIUM_SCULPTURE, ATRIUM_SOFA, ATRIUM_WALK_LEVEL,
  atriumDeckContains, atriumStairDistance, atriumStairHeight, atriumUpperStairHeight,
} from './atriumLayout';
import { ATRIUM_TENANT_ISLANDS } from './atriumTenantPlan';
import { ATRIUM_TENANT_WALK_BOUNDS, createAtriumTenantWalking } from './atriumTenantWalking';
import type { AtriumTenantWalking } from './atriumTenantWalking';
import { ATRIUM_CAFE_PLAN, atriumCafeCeilingAt, atriumCafeLocalPoint, blocksAtriumCafe, inAtriumCafe } from './atriumCafePlan';

const railClearance = 0.20;
const slabDepth = 0.49;
const stairDepth = 1.15;
const roofY = 17.1;

function stairFloor(x: number, z: number, inset = 0): number {
  const along = atriumStairDistance(x, z, inset);
  return along === undefined ? -Infinity : atriumStairHeight(along);
}

function inConcourse(x: number, z: number): boolean {
  return x >= ATRIUM_BOUNDS.minX && x <= ATRIUM_BOUNDS.maxX
    && z >= ATRIUM_BOUNDS.minZ && z <= ATRIUM_BOUNDS.maxZ;
}

export function atriumSupportAt(x: number, z: number, footLimit: number): number {
  if (!inConcourse(x, z)) return 0;
  const stair = stairFloor(x, z, railClearance);
  const upperStair = atriumUpperStairHeight(x, z, railClearance);
  const gallery = footLimit >= ATRIUM_LEVELS[2] - 1e-6 && atriumDeckContains(x, z, 2, railClearance) ? ATRIUM_LEVELS[2]
    : footLimit >= ATRIUM_WALK_LEVEL - 1e-6 && atriumDeckContains(x, z, 1, railClearance) ? ATRIUM_WALK_LEVEL : 0;
  return Math.max(gallery, stair <= footLimit ? stair : 0, upperStair <= footLimit ? upperStair : 0);
}

export function atriumCeilingHeight(x: number, z: number, foot = 0): number {
  if (inAtriumCafe(x, z) && foot < ATRIUM_CAFE_PLAN.ceiling) return atriumCafeCeilingAt(x, z, foot);
  if (!inConcourse(x, z)) return roofY;
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
  const cafe = ATRIUM_CAFE_TABLES.some(table =>
      ((cafeX - table.x) / (table.width / 2 + .16)) ** 2 + ((cafeZ - table.z) / (table.depth / 2 + .16)) ** 2 < 1)
    || ATRIUM_CAFE_CHAIRS.some(chair => Math.hypot(cafeX - chair.x, cafeZ - chair.z) < .44)
    || ATRIUM_CAFE_PLANTERS.some(planter => Math.hypot(cafeX - planter.x, cafeZ - planter.z) < .52);
  return sofa || sculpture || cafe;
}

function hitsDisplayIsland(x: number, z: number): boolean {
  return ATRIUM_TENANT_ISLANDS.some(({ center: [centerX, along], size: [width, depth] }) =>
    Math.abs(x - centerX) < width / 2 + 0.16 && Math.abs(z + along) < depth / 2 + 0.16);
}

function blocksCommonWalking(x: number, z: number, foot: number, previousFoot: number | undefined,
  supportAt: NonNullable<CoastNavigation['supportAt']>): boolean {
  if (insideElevator(x, z)) return true;
  // Catch sideways crossings of the stair and balcony guards, including when jumping.
  if (previousFoot !== undefined && inConcourse(x, z)) {
    const drop = previousFoot - supportAt(x, z, foot + 0.04);
    if (drop > 0.26 && (foot < previousFoot - 0.24 || drop > 1.58)) return true;
  }
  // Keep ground movement out of the cases even at the apex of a jump. The galleries use their own layer.
  if (foot < ATRIUM_LEVELS[0] && hitsDisplayIsland(x, z)) return true;
  return foot < 0.70 && hitsGroundFurnishing(x, z);
}

/** Each world owns its mesh snapshot. The exported default uses plan volumes only for CPU callers. */
export function createAtriumNavigation(walking: AtriumTenantWalking = createAtriumTenantWalking()) {
  const supportAt = (x: number, z: number, footLimit: number) =>
    Math.max(atriumSupportAt(x, z, footLimit), walking.supportAt(x, z, footLimit));
  return {
    bounds: { ...ATRIUM_TENANT_WALK_BOUNDS,
      maxX: Math.max(ATRIUM_TENANT_WALK_BOUNDS.maxX, 11.4 + ATRIUM_CAFE_PLAN.depth) },
    spawn: ATRIUM_DESTINATIONS[0],
    groundHeight: () => 0,
    supportAt,
    ceilingHeight(x: number, z: number, foot = 0) {
      return Math.min(atriumCeilingHeight(x, z, foot), walking.ceilingAt(x, z, foot) ?? Infinity);
    },
    blocksWalking(x: number, z: number, foot: number, previousFoot?: number) {
      const { u, d } = atriumCafeLocalPoint(x, z);
      // The generic floor union excludes R2; its doorway and room use the cafe plan.
      const cafeDomain = u >= 0 && u <= ATRIUM_CAFE_PLAN.width && d >= -.35
        && (d >= 0 || foot < ATRIUM_CAFE_PLAN.ceiling);
      if (cafeDomain) {
        if (foot > ATRIUM_CAFE_PLAN.ceiling - .25 || blocksAtriumCafe(x, z, foot)) return true;
      } else if (!(inConcourse(x, z) && foot >= ATRIUM_LEVELS[0])
        && walking.blocksWalking(x, z, foot)) return true;
      // Ground-store floor erosion must not narrow the original upper galleries.
      return blocksCommonWalking(x, z, foot, previousFoot, supportAt);
    },
    flightCeiling: roofY,
    allowFlight: false,
    walkSpeed: 2.35,
  } satisfies CoastNavigation;
}

export const atriumNavigation = createAtriumNavigation();
