import { airCutoff } from '../../coastAcoustics';
import { smoothstep, type CoastPoint } from '../../terrain';
import {
  RESIDENCE_AVENUE, RESIDENCE_BALCONY_REFLECTOR, RESIDENCE_CROSS_STREETS, RESIDENCE_STREET_LEVEL,
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
const BEDROOMS = roomRects('02', '03', '04', '05');
const TILED = roomRects(...RESIDENCE_ROOMS.filter(room => room.floor === 'tile').map(room => room.id));
const WINDOWS: Window[] = RESIDENCE_WALLS.filter(wall => wall.kind === 'exterior').flatMap(wall =>
  (wall.openings ?? []).filter(opening => opening.kind === 'window' || opening.kind === 'balcony-door')
    .map(opening => ({ axis: wall.axis, fixed: wall.fixed, from: opening.from, to: opening.to,
      y: (opening.top + opening.bottom) / 2 })));
const SOUTH_WINDOWS = WINDOWS.filter(window => window.axis === 'e' && window.fixed === 0);
const EAST_WINDOWS = WINDOWS.filter(window => window.axis === 'n');
const PARTITIONS = RESIDENCE_WALLS.filter(wall => wall.kind === 'interior' || wall.kind === 'party');

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

function insideTransmission(point: Point, aperture: Point): number {
  const dx = aperture.x - point.x;
  const dz = aperture.z - point.z;
  let transmission = 1;
  for (const wall of PARTITIONS) {
    const span = wall.axis === 'e' ? -dz : dx;
    if (Math.abs(span) < 0.001) continue;
    const offset = wall.axis === 'e' ? -point.z : point.x;
    const fraction = (wall.fixed - offset) / span;
    if (fraction <= 0 || fraction >= 1) continue;
    const crossing = wall.axis === 'e' ? point.x + dx * fraction : -point.z - dz * fraction;
    const inset = Math.min(crossing - wall.from, wall.to - crossing);
    const through = smoothstep(-0.08, 0.15, inset) * smoothstep(0, 0.26, Math.abs(wall.fixed - offset));
    const opening = (wall.openings ?? []).reduce((clear, gap) => Math.max(clear,
      smoothstep(-0.09, 0.09, Math.min(crossing - gap.from, gap.to - crossing))), 0);
    transmission *= 1 - through * (0.82 - 0.26 * opening);
  }
  return transmission;
}

function strongestPane(point: Point, windows: readonly Window[]) {
  let best = { point, gain: 0.0005, cutoff: 160 };
  for (const { axis, fixed, from, to, y } of windows) {
    const edge = clamp(axis === 'e' ? point.x : -point.z, from, to);
    const pane = axis === 'e' ? { x: edge, y, z: -fixed } : { x: fixed, y, z: -edge };
    const transmission = insideTransmission(point, pane);
    const near = 1 - smoothstep(0.5, 9.6, distance(point, pane));
    const gain = (0.004 + 0.075 * near) * transmission;
    if (gain > best.gain) best = { point: pane, gain, cutoff: 160 + 265 * near * transmission };
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
  const primary = roomWeight(point, PRIMARY);
  const bedroom = roomWeight(point, BEDROOMS) * (1 - primary);
  const tiled = roomWeight(point, TILED) * (1 - primary - bedroom);
  const living = roomWeight(point, LIVING) * (1 - primary - bedroom - tiled);
  const doorDistance = Math.hypot(point.x - BALCONY_DOOR.x, point.z - BALCONY_DOOR.z);
  // Outside the flush threshold the direct field replaces the sound coming through the opening.
  const doorSpan = Math.min(-point.z - doorSouth, doorNorth + point.z);
  const nearSill = smoothstep(-0.18, 0.2, doorSpan) * openness;
  const balconyDepth = Math.min(point.x - BALCONY[0] + nearSill * 0.24, -point.z - BALCONY[1],
    BALCONY[2] - point.x + 0.55, BALCONY[3] + point.z + 0.55);
  const exterior = smoothstep(0, 0.64, balconyDepth);
  return {
    point, exterior, openness,
    south: strongestPane(point, SOUTH_WINDOWS), east: strongestPane(point, EAST_WINDOWS),
    doorReach: primary * (1 - smoothstep(0.5, 5.4, doorDistance)),
    wet: [living, primary, bedroom, 1 - living - primary - bedroom - tiled, tiled]
      .map(room => (1 - exterior) * Math.max(0, room)),
  };
}

const SOURCE_HEIGHT = RESIDENCE_STREET_LEVEL + 0.55;
const southCrossing = RESIDENCE_CROSS_STREETS[0];
const southDepth = (southCrossing.minZ + southCrossing.maxZ) * 0.5;
const avenueCenter = (RESIDENCE_AVENUE.minX + RESIDENCE_AVENUE.maxX) * 0.5;
const avenueSouth = {
  minZ: Math.max(RESIDENCE_AVENUE.minZ, southDepth + 28),
  maxZ: Math.min(RESIDENCE_AVENUE.maxZ, southDepth + 308),
};
// Sample the avenue along the foreground facades below the balcony. Extending the
// road across the city leaves the nearby traffic and its reflection in this section.
const avenueEast = {
  minZ: Math.max(RESIDENCE_AVENUE.minZ, -144),
  maxZ: Math.min(RESIDENCE_AVENUE.maxZ, 15),
};

function road(fromX: number, fromZ: number, toX: number, toZ: number, day: number, night: number) {
  const at = (fraction: number) => ({ x: fromX + (toX - fromX) * fraction, y: SOURCE_HEIGHT,
    z: fromZ + (toZ - fromZ) * fraction });
  return { from: at(0), to: at(1), patches: [at(0.22), at(0.62)], activity: { day, night } };
}

export const RESIDENCE_ROADS = [
  road(Math.max(-112, southCrossing.minX), southDepth, Math.min(142, southCrossing.maxX), southDepth, 0.65, 0.28),
  road(avenueCenter, avenueSouth.minZ, avenueCenter, avenueSouth.maxZ, 0.58, 0.26),
  road(avenueCenter, avenueEast.minZ, avenueCenter, avenueEast.maxZ, 0.48, 0.19),
] as const;

// Image of the east street across the adjacent tower's west face.
// This is a quiet, band-limited reflection. The recording's other arrivals remain in the road bed.
export const STREET_REFLECTION = { ...RESIDENCE_ROADS[2].patches[1], x: 2 * RESIDENCE_BALCONY_REFLECTOR.minX - avenueCenter };
const REFERENCE_DISTANCE = 100;

export function residenceTrafficPath(receiver: ReturnType<typeof residenceReceiver>, source: Point, line: boolean) {
  const { point, exterior, openness, doorReach, south, east } = receiver;
  const directDistance = distance(point, source);
  // Pressure halves per doubled distance for a vehicle and drops by sqrt(2) for a long stream.
  const spreading = (REFERENCE_DISTANCE / Math.max(1, directDistance)) ** (line ? 0.5 : 1);
  const span = Math.max(1, Math.hypot(source.x - point.x, source.z - point.z));
  const eastFacing = smoothstep(-0.35, 0.72, (source.x - point.x) / span);
  const southFacing = smoothstep(-0.35, 0.72, (source.z - point.z) / span);
  const southGlass = south.gain * (0.15 + 0.85 * southFacing);
  const eastGlass = east.gain * (0.15 + 0.85 * eastFacing);
  const door = 0.29 * Math.sqrt(openness) * doorReach * (0.23 + 0.77 * eastFacing);
  // The recessed balcony slab and return wall screen steep arrivals. The retaining low band
  // models diffraction until the receiver approaches the exposed edge.
  const edge = smoothstep(BALCONY[2] - 0.96, BALCONY[2] - 0.23, point.x);
  const outside = (0.43 + eastFacing * 0.57) * (0.68 + edge * 0.32);
  const southWeight = southGlass ** 2 * (1 - exterior);
  const eastWeight = eastGlass ** 2 * (1 - exterior);
  const doorWeight = door ** 2 * (1 - exterior);
  const outsideWeight = outside ** 2 * exterior;
  const power = southWeight + eastWeight + doorWeight + outsideWeight;
  const air = airCutoff(directDistance);
  const outdoorCutoff = air * (0.62 + 0.38 * edge) * (0.78 + 0.22 * eastFacing);
  const cutoff = Math.exp((Math.log(south.cutoff) * southWeight + Math.log(east.cutoff) * eastWeight
    + Math.log(air * (0.44 + 0.08 * openness)) * doorWeight
    + Math.log(outdoorCutoff) * outsideWeight) / power);

  // Blend arrival bearings instead of coordinates so the distant road does not pull the image
  // away from the nearby opening until its contribution actually dominates.
  const virtual = { ...point };
  for (const [arrival, weight] of [[south.point, southWeight], [east.point, eastWeight], [BALCONY_DOOR, doorWeight],
    [source, outsideWeight]] as const) {
    const scale = weight * 12 / (power * Math.max(0.16, distance(point, arrival)));
    virtual.x += (arrival.x - point.x) * scale;
    virtual.y += (arrival.y - point.y) * scale;
    virtual.z += (arrival.z - point.z) * scale;
  }
  return { gain: spreading * Math.sqrt(power), cutoff, arrival: virtual };
}
