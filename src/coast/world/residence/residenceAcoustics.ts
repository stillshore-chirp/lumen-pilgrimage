import { airCutoff } from '../../coastAcoustics';
import { acousticRoomAt } from './residenceAcousticScene';
import { smoothstep, type CoastPoint } from '../../terrain';
import {
  RESIDENCE_AVENUE, RESIDENCE_BALCONY_REFLECTOR, RESIDENCE_CROSS_STREETS, RESIDENCE_STREET_LEVEL,
} from './residenceCityPlan';
import { RESIDENCE_BALCONY_DOOR, RESIDENCE_DOORWAYS, RESIDENCE_ROOMS, RESIDENCE_STUDY_RUG, RESIDENCE_TEA_TATAMI, RESIDENCE_WALLS,
  type ResidenceRect, type ResidenceWall } from './residencePlan';
import {
  residenceDoorFraction, residenceOpeningPoint, residenceSoundPath,
  type ResidenceDoorOpenness,
} from './residencePortalAcoustics';

export { residenceSoundPath, type ResidenceDoorOpenness } from './residencePortalAcoustics';

type Point = Readonly<CoastPoint>;
type Window = { axis: 'e' | 'n'; fixed: number; from: number; to: number; y: number; wall: ResidenceWall };

export type ResidenceSurface = 'oak' | 'stone' | 'tile' | 'balcony' | 'tatami' | 'wool';

const { e: doorEast, nFrom: doorSouth, nTo: doorNorth } = RESIDENCE_BALCONY_DOOR;
export const BALCONY_DOOR = { x: doorEast, y: 1.47, z: -(doorSouth + doorNorth) * 0.5 };

const roomRects = (...ids: string[]): ResidenceRect[] => RESIDENCE_ROOMS
  .filter(room => ids.includes(room.id)).flatMap(room => room.rectangles);
const [BALCONY] = roomRects('BL');
const LIVING = roomRects('LD', 'K');
const PRIMARY = roomRects('01');
const BEDROOMS = roomRects('02', '03');
const TEA_ROOM = roomRects('04');
const STUDY = roomRects('05');
const TILED = roomRects(...RESIDENCE_ROOMS.filter(room => room.floor === 'tile').map(room => room.id));
const WINDOWS: Window[] = RESIDENCE_WALLS.filter(wall => wall.kind === 'exterior').flatMap(wall =>
  (wall.openings ?? []).filter(opening => opening.kind === 'window')
    .map(opening => ({ axis: wall.axis, fixed: wall.fixed, from: opening.from, to: opening.to,
      y: (opening.top + opening.bottom) / 2, wall })));
const SOUTH_WINDOWS = WINDOWS.filter(window => window.axis === 'e' && window.fixed === 0);
const EAST_WINDOWS = WINDOWS.filter(window => window.axis === 'n');
export const RESIDENCE_INTERIOR_DOORS = RESIDENCE_DOORWAYS;

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

function strongestPane(point: Point, windows: readonly Window[], doorOpenness?: ResidenceDoorOpenness) {
  let best = { point, gain: 0.0005, cutoff: 160, diffuseGain: 0.0005, delay: 0 };
  for (const { axis, fixed, from, to, y, wall } of windows) {
    const edge = clamp(axis === 'e' ? point.x : -point.z, from, to);
    const pane = axis === 'e' ? { x: edge, y, z: -fixed } : { x: fixed, y, z: -edge };
    const reach = wall.thickness / 2 + .005;
    const candidates = [-reach, reach].map(offset => axis === 'e'
      ? { ...pane, z: -(fixed + offset) } : { ...pane, x: fixed + offset });
    const indoors = candidates.find(candidate => {
      const id = acousticRoomAt(candidate);
      return id && RESIDENCE_ROOMS.find(room => room.id === id)?.floor !== 'deck';
    }) ?? candidates.find(candidate => acousticRoomAt(candidate)) ?? pane;
    // The pane's empirical glazing factor is applied once below. Start the
    // interior path just inside that glazing, then follow the same room/leaf graph.
    const route = residenceSoundPath(point, indoors, doorOpenness);
    const reference = Math.max(1, distance(point, indoors));
    const transmission = Math.min(1, route.gain * reference);
    const near = 1 - smoothstep(0.5, 9.6, distance(point, pane));
    const glass = 0.004 + 0.075 * near;
    const gain = glass * transmission;
    if (gain > best.gain) best = { point: route.arrival, gain,
      cutoff: Math.min(route.cutoff, 160 + 265 * near * transmission),
      diffuseGain: glass * route.diffuseGain * reference, delay: route.delay };
  }
  return best;
}

export function residenceSurfaceAt(point: Point): ResidenceSurface {
  if (inset(point, RESIDENCE_TEA_TATAMI) >= 0) return 'tatami';
  if (inset(point, RESIDENCE_STUDY_RUG) >= 0) return 'wool';
  const floor = RESIDENCE_ROOMS.find(room => room.rectangles.some(zone => inset(point, zone) >= 0))?.floor;
  if (floor === 'deck') return 'balcony';
  if (floor === 'core') return 'stone';
  return floor ?? 'oak';
}

function roomMix(point: Point): number[] {
  const primary = roomWeight(point, PRIMARY);
  const bedroom = roomWeight(point, BEDROOMS) * (1 - primary);
  const tea = roomWeight(point, TEA_ROOM) * (1 - primary - bedroom);
  const study = roomWeight(point, STUDY) * (1 - primary - bedroom - tea);
  const tiled = roomWeight(point, TILED) * (1 - primary - bedroom - tea - study);
  const living = roomWeight(point, LIVING) * (1 - primary - bedroom - tea - study - tiled);
  return [living, primary, bedroom, 1 - living - primary - bedroom - tea - study - tiled, tiled, tea, study];
}

const DOOR_ROOM_MIXES = RESIDENCE_INTERIOR_DOORS.map(({ wall, opening }) => {
  const point = residenceOpeningPoint(wall, (opening.from + opening.to) / 2, 1.65);
  const x = wall.axis === 'n' ? 0.54 : 0;
  const z = wall.axis === 'e' ? 0.54 : 0;
  return { wall, opening, point, rooms: [roomMix({ ...point, x: point.x - x, z: point.z - z }),
    roomMix({ ...point, x: point.x + x, z: point.z + z })] };
});

function listenerRoomMix(point: Point, exterior: number, doorOpenness?: ResidenceDoorOpenness): number[] {
  const wet = roomMix(point);
  if (doorOpenness) {
    for (const door of DOOR_ROOM_MIXES) {
      const openness = residenceDoorFraction(doorOpenness(door.wall, door.opening));
      const distance = Math.hypot(point.x - door.point.x, point.z - door.point.z);
      const coupling = openness * 0.28 * (1 - smoothstep(0.25, 2.7, distance));
      if (coupling === 0) continue;
      const offset = door.wall.axis === 'e' ? point.z - door.point.z : point.x - door.point.x;
      const side = smoothstep(-0.24, 0.24, offset);
      for (const [index, level] of wet.entries()) {
        const neighbor = door.rooms[0][index] * side + door.rooms[1][index] * (1 - side);
        wet[index] = level + (neighbor - level) * coupling;
      }
    }
  }
  return wet.map(room => (1 - exterior) * Math.max(0, room));
}

function exteriorAt(point: Point, openness: number): number {
  if (!acousticRoomAt(point)) return 1;
  // Outside the flush threshold the direct field replaces the sound coming through the opening.
  const doorSpan = Math.min(-point.z - doorSouth, doorNorth + point.z);
  const nearSill = smoothstep(-0.18, 0.2, doorSpan) * openness;
  const balconyDepth = Math.min(point.x - BALCONY[0] + nearSill * 0.24, -point.z - BALCONY[1],
    BALCONY[2] - point.x + 0.55, BALCONY[3] + point.z + 0.55);
  return smoothstep(0, 0.64, balconyDepth);
}

export function residenceRoomWet(point: Point, opening: number, doorOpenness?: ResidenceDoorOpenness): number[] {
  return listenerRoomMix(point, exteriorAt(point, residenceDoorFraction(opening)), doorOpenness);
}

export function residenceReceiver(point: Point, opening: number, doorOpenness?: ResidenceDoorOpenness) {
  const openness = residenceDoorFraction(opening);
  const exterior = exteriorAt(point, openness);
  if (exterior === 1) {
    const pane = { point, gain: .0005, cutoff: 160, diffuseGain: .0005, delay: 0 };
    return { point, exterior, openness, south: pane, east: pane, doorReach: 0,
      doorPath: { gain: 0, cutoff: 160, arrival: point, diffuseGain: 0, delay: 0, paths: [] },
      wet: listenerRoomMix(point, exterior, doorOpenness) };
  }
  const balconyWall = RESIDENCE_WALLS.find(wall => wall.axis === 'n' && wall.fixed === doorEast)!;
  const doorPath = residenceSoundPath(point, { ...BALCONY_DOOR, x: doorEast + balconyWall.thickness / 2 + .005 },
    (wall, gap) => gap.kind === 'balcony-door' ? openness : doorOpenness?.(wall, gap) ?? 1);
  return {
    point, exterior, openness,
    south: strongestPane(point, SOUTH_WINDOWS, doorOpenness), east: strongestPane(point, EAST_WINDOWS, doorOpenness),
    doorReach: doorPath.gain, doorPath,
    wet: listenerRoomMix(point, exterior, doorOpenness),
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
  const { point, exterior, openness, doorPath, south, east } = receiver;
  const directDistance = distance(point, source);
  // Pressure halves per doubled distance for a vehicle and drops by sqrt(2) for a long stream.
  const spreading = (REFERENCE_DISTANCE / Math.max(1, directDistance)) ** (line ? 0.5 : 1);
  const span = Math.max(1, Math.hypot(source.x - point.x, source.z - point.z));
  const eastFacing = smoothstep(-0.35, 0.72, (source.x - point.x) / span);
  const southFacing = smoothstep(-0.35, 0.72, (source.z - point.z) / span);
  const southGlass = south.gain * (0.15 + 0.85 * southFacing);
  const eastGlass = east.gain * (0.15 + 0.85 * eastFacing);
  const southDiffuse = south.diffuseGain * (0.15 + 0.85 * southFacing);
  const eastDiffuse = east.diffuseGain * (0.15 + 0.85 * eastFacing);
  const door = .29 / .95 * doorPath.gain * (.23 + .77 * eastFacing);
  const doorDiffuse = .29 / .95 * doorPath.diffuseGain * (.23 + .77 * eastFacing);
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
    + Math.log(Math.min(air, doorPath.cutoff) * (.44 + .08 * openness)) * doorWeight
    + Math.log(outdoorCutoff) * outsideWeight) / power);

  // Blend arrival bearings instead of coordinates so the distant road does not pull the image
  // away from the nearby opening until its contribution actually dominates.
  const virtual = { ...point };
  for (const [arrival, weight] of [[south.point, southWeight], [east.point, eastWeight], [doorPath.arrival, doorWeight],
    [source, outsideWeight]] as const) {
    const scale = weight * 12 / (power * Math.max(0.16, distance(point, arrival)));
    virtual.x += (arrival.x - point.x) * scale;
    virtual.y += (arrival.y - point.y) * scale;
    virtual.z += (arrival.z - point.z) * scale;
  }
  const diffusePower = (southDiffuse ** 2 + eastDiffuse ** 2 + doorDiffuse ** 2) * (1 - exterior) + outsideWeight;
  const delay = (south.delay * southWeight + east.delay * eastWeight + doorPath.delay * doorWeight) / power;
  return { gain: spreading * Math.sqrt(power), cutoff, arrival: virtual,
    diffuseGain: spreading * Math.sqrt(diffusePower), delay };
}
