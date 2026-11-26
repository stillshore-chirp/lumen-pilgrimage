import type { CoastNavigation } from '../../CoastControls';
import { LAKE_GLAZING, LAKE_HALL, LAKE_SPAWN, LAKE_TABLE, LAKE_VERANDA } from './lakeLayout';

const wallClearance = 0.20;

export function lakeWalkBlocked(x: number, z: number): boolean {
  const across = Math.abs(x);
  if (across > LAKE_HALL.halfWidth - wallClearance || z > LAKE_HALL.rearZ - wallClearance) return true;
  if (z < LAKE_HALL.frontZ + wallClearance
    && (across < LAKE_GLAZING.halfWidth + wallClearance || z < LAKE_VERANDA.endZ + wallClearance)) return true;

  return Math.abs(x - LAKE_TABLE.x) < LAKE_TABLE.width / 2 + wallClearance
    && Math.abs(z - LAKE_TABLE.z) < LAKE_TABLE.depth / 2 + wallClearance;
}

export const lakeNavigation = {
  bounds: {
    minX: -LAKE_HALL.halfWidth,
    maxX: LAKE_HALL.halfWidth,
    minZ: LAKE_VERANDA.endZ,
    maxZ: LAKE_HALL.rearZ,
  },
  spawn: LAKE_SPAWN,
  groundHeight: () => 0,
  blocksWalking: lakeWalkBlocked,
  ceilingHeight: () => LAKE_HALL.ceilingY,
  flightCeiling: LAKE_HALL.ceilingY,
  allowFlight: false,
  walkSpeed: 2.65,
} satisfies CoastNavigation;
