import { airCutoff } from '../../coastAcoustics';
import { smoothstep, type CoastPoint } from '../../terrain';
import {
  RESIDENCE_AVENUE, RESIDENCE_CROSS_STREETS, RESIDENCE_SIDE_STREET, RESIDENCE_STREET_LEVEL,
} from './residenceCityPlan';
import { RESIDENCE_BALCONY_DOOR, RESIDENCE_ROOMS, RESIDENCE_WALLS, type ResidenceRect } from './residencePlan';

type Point = Readonly<CoastPoint>;
type Window = { axis: 'e' | 'n'; fixed: number; from: number; to: number; y: number };

export type ResidenceSurface = 'oak' | 'stone' | 'tile' | 'balcony';

const { e: doorEast, nFrom: doorSouth, nTo: doorNorth } = RESIDENCE_BALCONY_DOOR;
export const BALCONY_DOOR = { x: doorEast, y: 1.47, z: -(doorSouth + doorNorth) * 0.5 };

const roomRects = (...ids: string[]): ResidenceRect[] => RESIDENCE_ROOMS
  .filter(room => ids.includes(room.id)).flatMap(room => room.rectangles);
const [BALCONY] = roomRects('BL');
const LIVING = roomRects('LD', 'K');
const PRIMARY = roomRects('01');
const BEDROOMS = roomRects('01', '02', '03', '04', '05');
const WINDOWS: Window[] = RESIDENCE_WALLS.filter(wall => wall.kind === 'exterior').flatMap(wall =>
  (wall.openings ?? []).filter(opening => opening.kind === 'window' || opening.kind === 'balcony-door')
    .map(opening => ({ axis: wall.axis, fixed: wall.fixed, from: opening.from, to: opening.to,
      y: (opening.top + opening.bottom) / 2 })));
const SOUTH_WINDOWS = WINDOWS.filter(window => window.axis === 'e' && window.fixed === 0);
const EAST_WINDOWS = WINDOWS.filter(window => window.axis === 'n');

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function inset(point: Point, [west, south, east, north]: ResidenceRect): number {
  return Math.min(point.x - west, east - point.x, -point.z - south, north + point.z);
}

function roomWeight(point: Point, rooms: readonly ResidenceRect[]): number {
  return Math.min(1, rooms.reduce((sum, room) => sum + smoothstep(-0.32, 0.32, inset(point, room)), 0));
}

function closestWindow(point: Point, source: Point, windows: readonly Window[]): Point {
  let best: Point = point;
  let nearest = Infinity;
  for (const { axis, fixed, from, to, y } of windows) {
    const along = axis === 'e' ? point.x + (source.x - point.x) * 0.025 : -point.z;
    const edge = clamp(along, from, to);
    const candidate = axis === 'e' ? { x: edge, y, z: -fixed } : { x: fixed, y, z: -edge };
    const separation = distance(point, candidate);
    if (separation < nearest) {
      best = candidate;
      nearest = separation;
    }
  }
  return best;
}

export function residenceSurfaceAt(point: Point): ResidenceSurface {
  const floor = RESIDENCE_ROOMS.find(room => room.rectangles.some(zone => inset(point, zone) >= 0))?.floor;
  if (floor === 'deck') return 'balcony';
  if (floor === 'core') return 'stone';
  return floor ?? 'oak';
}

export function residenceReceiver(point: Point, opening: number) {
  const openness = Number.isFinite(opening) ? clamp(opening, 0, 1) : 0;
  const bedroom = roomWeight(point, BEDROOMS);
  const living = roomWeight(point, LIVING) * (1 - bedroom);
  const primary = roomWeight(point, PRIMARY);
  const doorDistance = Math.hypot(point.x - BALCONY_DOOR.x, point.z - BALCONY_DOOR.z);
  // Outside the flush threshold the direct field replaces the sound coming through the opening.
  const doorSpan = Math.min(-point.z - doorSouth, doorNorth + point.z);
  const nearSill = smoothstep(-0.18, 0.2, doorSpan) * openness;
  const balconyDepth = Math.min(point.x - BALCONY[0] + nearSill * 0.24, -point.z - BALCONY[1],
    BALCONY[2] - point.x + 0.55, BALCONY[3] + point.z + 0.55);
  const exterior = smoothstep(0, 0.64, balconyDepth);
  return {
    point, exterior, openness,
    doorReach: (0.028 + 0.972 * primary) * (1 - smoothstep(0.5, 5.4, doorDistance)),
    wet: [living, bedroom, 1 - living - bedroom].map(room => room * (1 - exterior)),
  };
}

const SOURCE_HEIGHT = RESIDENCE_STREET_LEVEL + 0.55;
const southCrossing = RESIDENCE_CROSS_STREETS[0];
const southDepth = (southCrossing.minZ + southCrossing.maxZ) * 0.5;
const avenueCenter = (RESIDENCE_AVENUE.minX + RESIDENCE_AVENUE.maxX) * 0.5;
const sideStreetCenter = (RESIDENCE_SIDE_STREET.minX + RESIDENCE_SIDE_STREET.maxX) * 0.5;

export const RESIDENCE_ROADS = [
  {
    // The transverse avenue below the south facade.
    from: { x: -60, y: SOURCE_HEIGHT, z: southDepth },
    to: { x: 74, y: SOURCE_HEIGHT, z: southDepth },
    bed: { x: -42, y: SOURCE_HEIGHT, z: southDepth }, activity: { day: 0.53, night: 0.24 },
  },
  {
    // The intersection visible against the further south towers.
    from: { x: avenueCenter, y: SOURCE_HEIGHT, z: 122 },
    to: { x: avenueCenter, y: SOURCE_HEIGHT, z: 238 },
    bed: { x: avenueCenter, y: SOURCE_HEIGHT, z: 180 }, activity: { day: 0.39, night: 0.23 },
  },
  {
    // The side street below the recessed east balcony.
    from: { x: sideStreetCenter, y: SOURCE_HEIGHT, z: RESIDENCE_SIDE_STREET.minZ },
    to: { x: sideStreetCenter, y: SOURCE_HEIGHT, z: RESIDENCE_SIDE_STREET.maxZ },
    bed: { x: sideStreetCenter, y: SOURCE_HEIGHT, z: -47 }, activity: { day: 0.48, night: 0.21 },
  },
] as const;

// Image of the east street across the adjacent tower face at E54.
// This is a quiet, band-limited reflection. The recording's other arrivals remain in the road bed.
export const STREET_REFLECTION = { ...RESIDENCE_ROADS[2].bed, x: 2 * 54 - sideStreetCenter };

export function residenceTrafficPath(receiver: ReturnType<typeof residenceReceiver>, source: Point, line: boolean) {
  const { point, exterior, openness, doorReach } = receiver;
  const directDistance = distance(point, source);
  // Continuous traffic behaves as a line source. An isolated vehicle spreads as a point source.
  const spreading = (176 / Math.max(176, directDistance)) ** (line ? 0.5 : 1);
  const eastFacing = smoothstep(-0.27, 0.69,
    (source.x - point.x) / Math.max(1, Math.hypot(source.x - point.x, source.z - point.z)));
  const south = closestWindow(point, source, SOUTH_WINDOWS);
  const east = closestWindow(point, source, EAST_WINDOWS);
  const southNear = 1 - smoothstep(0.8, point.x < 11 ? 7.1 : 10, distance(point, south));
  const eastNear = 1 - smoothstep(0.8, 9.1, distance(point, east));
  const southGlass = (0.009 + 0.137 * southNear) * (1 - eastFacing * 0.84);
  const eastGlass = (0.009 + 0.129 * eastNear) * (0.14 + eastFacing * 0.86);
  const door = 0.51 * Math.sqrt(openness) * doorReach * (0.25 + eastFacing * 0.75);
  const outside = 0.39 + eastFacing * 0.61;
  const southWeight = southGlass ** 2 * (1 - exterior);
  const eastWeight = eastGlass ** 2 * (1 - exterior);
  const doorWeight = door ** 2 * (1 - exterior);
  const outsideWeight = outside ** 2 * exterior;
  const power = southWeight + eastWeight + doorWeight + outsideWeight;
  const air = airCutoff(directDistance) * (0.70 + eastFacing * 0.30);
  const glassCutoff = 155 + 345 * Math.max(southNear * (1 - eastFacing), eastNear * eastFacing);
  const cutoff = Math.exp((Math.log(glassCutoff) * (southWeight + eastWeight)
    + Math.log(air * 0.76) * doorWeight + Math.log(air) * outsideWeight) / power);

  // Blend arrival bearings instead of coordinates so the distant road does not pull the image
  // away from the nearby opening until its contribution actually dominates.
  const virtual = { ...point };
  for (const [arrival, weight] of [[south, southWeight], [east, eastWeight], [BALCONY_DOOR, doorWeight],
    [source, outsideWeight]] as const) {
    const scale = weight * 12 / (power * Math.max(0.16, distance(point, arrival)));
    virtual.x += (arrival.x - point.x) * scale;
    virtual.y += (arrival.y - point.y) * scale;
    virtual.z += (arrival.z - point.z) * scale;
  }
  return { gain: spreading * Math.sqrt(power), cutoff, arrival: virtual };
}
