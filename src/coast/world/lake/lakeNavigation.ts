import type { CoastNavigation } from '../../CoastControls';
import { LAKE_HALL, LAKE_SPAWN } from './lakeLayout';

const wallClearance = 0.20;

export function lakeWalkBlocked(x: number, z: number): boolean {
  return Math.abs(x) > LAKE_HALL.halfWidth - wallClearance
    || z > LAKE_HALL.rearZ - wallClearance || z < LAKE_HALL.frontZ + wallClearance;
}

export const lakeNavigation = {
  bounds: {
    minX: -LAKE_HALL.halfWidth,
    maxX: LAKE_HALL.halfWidth,
    minZ: LAKE_HALL.frontZ,
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
