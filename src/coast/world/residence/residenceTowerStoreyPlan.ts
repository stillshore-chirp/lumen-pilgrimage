import { RESIDENCE_TOWER } from './residenceCityPlan';
import { RESIDENCE_ROOMS, RESIDENCE_WALLS, type ResidenceRect } from './residencePlan';

// Match the existing tower cutout. The shallow exterior recess is a visual joint,
// not a change to the apartment, shared hall, balcony or their walking surfaces.
export const RESIDENCE_TOWER_STOREY = { bottom: -.31, top: 3.25, exteriorRecess: .02 } as const;

function neighboringStorey(): readonly ResidenceRect[] {
  const { exteriorRecess: inset } = RESIDENCE_TOWER_STOREY;
  const west = RESIDENCE_TOWER.minX + inset;
  const east = RESIDENCE_TOWER.maxX - inset;
  const south = -RESIDENCE_TOWER.maxZ + inset;
  const north = -RESIDENCE_TOWER.minZ - inset;
  const occupied = RESIDENCE_ROOMS.flatMap(room => room.rectangles);
  const edges = [...new Set([west, east, ...occupied.flatMap(rect => [rect[0], rect[2]])])]
    .filter(value => value >= west && value <= east).sort((a, b) => a - b);
  const result: [number, number, number, number][] = [];
  for (let index = 1; index < edges.length; index += 1) {
    const start = edges[index - 1];
    const end = edges[index];
    const middle = (start + end) / 2;
    const spans = occupied.filter(rect => middle > rect[0] && middle < rect[2])
      .map(rect => [Math.max(south, rect[1]), Math.min(north, rect[3])])
      .filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0]);
    let cursor = south;
    const append = (from: number, to: number) => {
      if (to <= from) return;
      const previous = result.find(rect => rect[2] === start && rect[1] === from && rect[3] === to);
      if (previous) previous[2] = end;
      else result.push([start, from, end, to]);
    };
    for (const [from, to] of spans) {
      if (from > cursor) append(cursor, from);
      cursor = Math.max(cursor, to);
    }
    append(cursor, north);
  }
  return result;
}

export interface ResidenceTowerNeighbor {
  rect: ResidenceRect;
  bottom: number;
  top: number;
}

// The north hall wall contains the existing recessed elevator doors, which are
// assembled by the Shell rather than listed as ordinary Plan openings. Preserve
// that wall's full finite thickness and height, including the dark rear plates.
function preserveHallWall(rect: ResidenceRect): ResidenceTowerNeighbor[] {
  const wall = RESIDENCE_WALLS.find(candidate => candidate.axis === 'e'
    && candidate.fixed === 17.7 && candidate.from === 0 && candidate.kind === 'party');
  if (!wall) throw new Error('The shared hall wall must be defined before the tower storey');
  const [west, south, east, north] = rect;
  const left = Math.max(west, wall.from);
  const right = Math.min(east, wall.to);
  const front = Math.max(south, wall.fixed - wall.thickness / 2);
  const back = Math.min(north, wall.fixed + wall.thickness / 2);
  const { bottom, top } = RESIDENCE_TOWER_STOREY;
  if (right <= left || back <= front) return [{ rect, bottom, top }];
  const result: ResidenceTowerNeighbor[] = [];
  const append = (bounds: ResidenceRect, low: number, high: number) => {
    if (bounds[2] > bounds[0] && bounds[3] > bounds[1] && high > low) {
      result.push({ rect: bounds, bottom: low, top: high });
    }
  };
  append([west, south, left, north], bottom, top);
  append([right, south, east, north], bottom, top);
  append([left, south, right, front], bottom, top);
  append([left, back, right, north], bottom, top);
  append([left, front, right, back], bottom, Math.max(bottom, 0));
  append([left, front, right, back], Math.min(top, wall.height), top);
  return result;
}

// Restore only unoccupied tower volumes. The wall recess remains the existing
// Shell's responsibility; the small upper/lower caps keep the storey connected.
export const RESIDENCE_TOWER_NEIGHBORS = neighboringStorey().flatMap(preserveHallWall);
