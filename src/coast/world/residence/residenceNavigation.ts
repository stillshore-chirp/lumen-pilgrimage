import type { CoastNavigation, CoastPose } from '../../CoastControls';
import { createResidenceDoors, RESIDENCE_WALKER_RADIUS, type ResidenceDoors } from './residenceDoors';
import {
  RESIDENCE_BATH_SERVICE_SHAFT, RESIDENCE_FACADE_PIERS, RESIDENCE_ROOMS,
  RESIDENCE_STAIR_ENCLOSURE, RESIDENCE_WALLS, type ResidenceRect, type ResidenceWall,
} from './residencePlan';

const WALKER_RADIUS_SQUARED = RESIDENCE_WALKER_RADIUS ** 2;

const floor = RESIDENCE_ROOMS.filter(room => room.id !== 'PS').flatMap(room => room.rectangles);
const balconyFloor = RESIDENCE_ROOMS.filter(room => room.id === 'BL').flatMap(room => room.rectangles);
const bounds = {
  minX: Math.min(...floor.map(rect => rect[0])) - 1,
  maxX: Math.max(...floor.map(rect => rect[2])) + 1,
  minZ: -Math.max(...floor.map(rect => rect[3])) - 1,
  maxZ: -Math.min(...floor.map(rect => rect[1])) + 1,
};

function wallFootprint(wall: ResidenceWall, from: number, to: number): ResidenceRect {
  const halfThickness = wall.thickness / 2;
  return wall.axis === 'e'
    ? [from, wall.fixed - halfThickness, to, wall.fixed + halfThickness]
    : [wall.fixed - halfThickness, from, wall.fixed + halfThickness, to];
}

const permanentObstacles: ResidenceRect[] = [
  ...RESIDENCE_FACADE_PIERS, RESIDENCE_BATH_SERVICE_SHAFT, RESIDENCE_STAIR_ENCLOSURE,
];
const closedBalconyDoor: ResidenceRect[] = [];

for (const wall of RESIDENCE_WALLS) {
  let cursor = wall.from;
  for (const opening of wall.openings ?? []) {
    if (opening.kind === 'window') continue;
    if (cursor < opening.from) permanentObstacles.push(wallFootprint(wall, cursor, opening.from));
    if (opening.kind === 'balcony-door') closedBalconyDoor.push(wallFootprint(wall, opening.from, opening.to));
    cursor = opening.to;
  }
  if (cursor < wall.to) permanentObstacles.push(wallFootprint(wall, cursor, wall.to));
}

function contains([west, south, east, north]: ResidenceRect, e: number, n: number): boolean {
  return e >= west && e <= east && n >= south && n <= north;
}

function overlapsWalker([west, south, east, north]: ResidenceRect, e: number, n: number): boolean {
  const gapEast = Math.max(west - e, e - east, 0);
  const gapNorth = Math.max(south - n, n - north, 0);
  return gapEast * gapEast + gapNorth * gapNorth < WALKER_RADIUS_SQUARED;
}

export function createResidenceNavigation(spawn: CoastPose, furnitureFootprints: readonly ResidenceRect[],
  balconyOpen: () => boolean, doors: Pick<ResidenceDoors, 'blocksWalking'> = createResidenceDoors()): CoastNavigation {
  const balconyFurniture = furnitureFootprints.filter(([west, south, east, north]) => balconyFloor.some(
    rect => contains(rect, west, south) && contains(rect, east, north),
  ));
  const obstacles = [...permanentObstacles, ...balconyFurniture];

  return {
    bounds, spawn, groundHeight: () => 0,
    flightEnabled: false, jumpEnabled: false, flightCeiling: 2.55, walkSpeed: 2.4,
    blocksWalking(e, z) {
      const n = -z;
      return !floor.some(rect => contains(rect, e, n))
        || obstacles.some(rect => overlapsWalker(rect, e, n))
        || doors.blocksWalking(e, z)
        || (closedBalconyDoor.some(rect => overlapsWalker(rect, e, n)) && !balconyOpen());
    },
  };
}
