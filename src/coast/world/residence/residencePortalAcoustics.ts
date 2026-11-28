import type { CoastPoint } from '../../terrain';
import { createResidenceAcousticPathModel, residenceAcousticPathResponse, type ResidenceAcousticPath } from './residenceAcousticPaths';
import { acousticDoorSnapshot, acousticRoomAt } from './residenceAcousticScene';
import { acousticPointAt, acousticSegmentBox, acousticWallPrism, pointInAcousticOpening } from './residenceAcousticGeometry';
import { RESIDENCE_ROOMS, RESIDENCE_WALLS, type ResidenceOpening, type ResidenceWall } from './residencePlan';

type Point = Readonly<CoastPoint>;
export type ResidenceDoorOpenness = (wall: ResidenceWall, opening: ResidenceOpening) => number;

export const RESIDENCE_PARTITIONS = RESIDENCE_WALLS.filter(wall => wall.kind === 'interior' || wall.kind === 'party');
const SOUND_BARRIERS = RESIDENCE_WALLS.filter(wall => wall.kind !== 'guard');
const model = createResidenceAcousticPathModel();

export function residenceDoorFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function residenceOpeningPoint(wall: ResidenceWall, along: number, y: number): Point {
  return wall.axis === 'e' ? { x: along, y, z: -wall.fixed } : { x: wall.fixed, y, z: -along };
}

function apertureBands(wall: ResidenceWall, opening: ResidenceOpening, doorOpenness?: ResidenceDoorOpenness) {
  if (opening.kind === 'passage') return { low: 1, high: 1, diffuse: 1 };
  if (opening.kind === 'window') return { low: .050 ** 2, high: .009 ** 2, diffuse: .040 ** 2 };
  const balcony = opening.kind === 'balcony-door';
  const fusuma = opening.kind === 'fusuma';
  const fraction = residenceDoorFraction(doorOpenness?.(wall, opening) ?? (balcony ? 0 : 1));
  const slides = balcony || fusuma || opening.kind === 'gallery-slide';
  const area = slides ? fraction : 1 - Math.cos(fraction * Math.PI / 2);
  const blend = (closed: number, open: number, amount: number) => closed + (open - closed) * amount;
  // Existing scene estimates. They are not measured product transmission losses.
  return {
    low: blend((balcony ? .055 : fusuma ? .24 : .135) ** 2, .95 ** 2, area),
    high: blend((balcony ? .009 : fusuma ? .057 : .022) ** 2, .91 ** 2, area ** 1.55),
    diffuse: blend((balcony ? .043 : fusuma ? .19 : .105) ** 2, .78 ** 2, area),
  };
}

// Direct finite-volume transmission remains available for endpoints outside the
// room graph and custom wall fixtures. Wall proximity never cancels its material.
export function traceResidenceWalls(listener: Point, source: Point, walls: readonly ResidenceWall[],
  doorOpenness?: ResidenceDoorOpenness) {
  let low = 1;
  let high = 1;
  let diffuse = 1;
  for (const wall of walls) {
    const interval = acousticSegmentBox(listener, source, acousticWallPrism(wall));
    if (!interval) continue;
    const entry = acousticPointAt(listener, source, interval[0]);
    const exit = acousticPointAt(listener, source, interval[1]);
    const opening = wall.openings?.find(candidate => pointInAcousticOpening(wall, candidate, entry)
      && pointInAcousticOpening(wall, candidate, exit));
    const bands = opening ? apertureBands(wall, opening, doorOpenness) : {
      low: (wall.kind === 'interior' ? .095 : .032) ** 2,
      high: (wall.kind === 'interior' ? .012 : .004) ** 2,
      diffuse: (wall.kind === 'interior' ? .075 : .024) ** 2,
    };
    low *= bands.low;
    high *= bands.high;
    diffuse *= bands.diffuse;
  }
  return { gain: Math.sqrt(low), highGain: Math.sqrt(high), cutoff: 110 + 17_890 * high / Math.max(1e-24, low),
    arrival: source, diffuseGain: Math.sqrt(diffuse) };
}

function externalPaths(listener: Point, source: Point, doorOpenness?: ResidenceDoorOpenness): ResidenceAcousticPath[] {
  const direct = traceResidenceWalls(listener, source, SOUND_BARRIERS, doorOpenness);
  const paths = [residenceAcousticPathResponse([source, listener],
    [direct.gain ** 2, direct.highGain ** 2, direct.diffuseGain ** 2], 'direct-or-wall', ['boundary-direct'])];
  const listenerRoom = acousticRoomAt(listener);
  const sourceRoom = acousticRoomAt(source);
  if (Boolean(listenerRoom) === Boolean(sourceRoom)) return paths;
  const reverse = !listenerRoom;
  const outside = reverse ? listener : source;
  const indoors = reverse ? source : listener;
  const state = acousticDoorSnapshot(doorOpenness);
  const directDistance = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  for (const [wallIndex, wall] of SOUND_BARRIERS.entries()) {
    if (wall.kind !== 'exterior') continue;
    for (const opening of wall.openings ?? []) {
      if (opening.kind !== 'window' && opening.kind !== 'balcony-door') continue;
      const alongOutside = wall.axis === 'e' ? outside.x : -outside.z;
      const alongInside = wall.axis === 'e' ? indoors.x : -indoors.z;
      const along = clamp((alongOutside + alongInside) / 2, opening.from + .04, opening.to - .04);
      const height = clamp((outside.y + indoors.y) / 2, opening.bottom + .05, opening.top - .05);
      const center = residenceOpeningPoint(wall, along, height);
      const reach = wall.thickness / 2 + .005;
      const faces = [-reach, reach].map(offset => wall.axis === 'e' ? { ...center, z: -(wall.fixed + offset) }
        : { ...center, x: wall.fixed + offset });
      const inside = faces.find(point => {
        const id = acousticRoomAt(point);
        return id && RESIDENCE_ROOMS.find(room => room.id === id)?.floor !== 'deck';
      });
      if (!inside) continue;
      const exterior = faces.find(point => point !== inside)!;
      const sourceOffset = wall.axis === 'e' ? -outside.z - wall.fixed : outside.x - wall.fixed;
      const exteriorOffset = wall.axis === 'e' ? -exterior.z - wall.fixed : exterior.x - wall.fixed;
      if (sourceOffset * exteriorOffset <= 0) continue;
      // A balcony door already belongs to the room graph. A fixed window adds
      // its glazing once between the two faces before entering that graph.
      const entry = opening.kind === 'balcony-door' ? exterior : inside;
      const segment = traceResidenceWalls(exterior, outside, SOUND_BARRIERS.filter(candidate => candidate !== wall), doorOpenness);
      const glass = opening.kind === 'window' ? [.050, .009, .040] : [1, 1, 1];
      for (const interior of model.solve(entry, indoors, state).paths) {
        let points: readonly Point[] = [outside, exterior, ...interior.points];
        const reference = Math.max(1, interior.length);
        const pressure = [interior.lowGain * reference * segment.gain * glass[0],
          interior.highGain * reference * segment.highGain * glass[1],
          interior.diffuseGain * reference * segment.diffuseGain * glass[2]];
        if (reverse) points = [...points].reverse();
        const path = residenceAcousticPathResponse(points, pressure.map(value => value ** 2) as [number, number, number],
          'external-chain', [`entry:${wallIndex}:${opening.kind}:${opening.from}`, ...interior.ids]);
        if (path.length - directDistance < .035) continue;
        paths.push(path);
      }
    }
  }
  paths.sort((a, b) => b.lowGain - a.lowGain);
  return paths.slice(0, 3);
}

export function residenceSoundPath(listener: Point, source: Point, doorOpenness?: ResidenceDoorOpenness) {
  const result = model.solve(source, listener, acousticDoorSnapshot(doorOpenness));
  const paths = result.paths.length ? result.paths : externalPaths(listener, source, doorOpenness);
  if (paths.length) {
    const gain = Math.hypot(...paths.map(path => path.lowGain));
    const high = Math.hypot(...paths.map(path => path.highGain));
    const dominant = paths[0];
    return { gain, cutoff: 110 + 17_890 * high ** 2 / Math.max(1e-24, gain ** 2), arrival: dominant.arrival,
      diffuseGain: Math.hypot(...paths.map(path => path.diffuseGain)), delay: dominant.delay, paths };
  }
  const path = traceResidenceWalls(listener, source, SOUND_BARRIERS, doorOpenness);
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
  const spreading = 1 / Math.max(1, distance);
  return { ...path, gain: path.gain * spreading, diffuseGain: path.diffuseGain * spreading,
    delay: distance / 343, paths: result.paths };
}
