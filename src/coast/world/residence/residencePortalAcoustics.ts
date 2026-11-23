import { smoothstep, type CoastPoint } from '../../terrain';
import { RESIDENCE_WALLS, type ResidenceOpening, type ResidenceWall } from './residencePlan';

type Point = Readonly<CoastPoint>;
export type ResidenceDoorOpenness = (wall: ResidenceWall, opening: ResidenceOpening) => number;

export const RESIDENCE_PARTITIONS = RESIDENCE_WALLS.filter(wall => wall.kind === 'interior' || wall.kind === 'party');
const SOUND_BARRIERS = RESIDENCE_WALLS.filter(wall => wall.kind !== 'guard');

export function residenceDoorFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function residenceOpeningPoint(wall: ResidenceWall, along: number, y: number): Point {
  return wall.axis === 'e' ? { x: along, y, z: -wall.fixed } : { x: wall.fixed, y, z: -along };
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;

function wallOffset(wall: ResidenceWall, point: Point): number {
  return (wall.axis === 'e' ? -point.z : point.x) - wall.fixed;
}

function apertureBands(wall: ResidenceWall, opening: ResidenceOpening, doorOpenness?: ResidenceDoorOpenness) {
  if (opening.kind === 'passage') return { low: 1, high: 1, diffuse: 1 };
  if (opening.kind === 'window') return { low: 0.050 ** 2, high: 0.009 ** 2, diffuse: 0.040 ** 2 };
  const balcony = opening.kind === 'balcony-door';
  const fusuma = opening.kind === 'fusuma';
  const fraction = residenceDoorFraction(doorOpenness?.(wall, opening) ?? (balcony ? 0 : 1));
  // The hinged leaf rotates through 90 degrees and progressively uncovers its projection.
  const slides = balcony || fusuma || opening.kind === 'gallery-slide';
  const openArea = slides ? fraction : 1 - Math.cos(fraction * Math.PI / 2);
  // Parallel paths through the closed panel/leaks and the uncovered part of the aperture.
  // Asakura (2009), Ch. 3; Raghuvanshi (2021), Sec. 5. Coefficients are scene estimates.
  return {
    low: mix((balcony ? 0.055 : fusuma ? 0.24 : 0.135) ** 2, 0.95 ** 2, openArea),
    high: mix((balcony ? 0.009 : fusuma ? 0.057 : 0.022) ** 2, 0.91 ** 2, openArea ** 1.55),
    diffuse: mix((balcony ? 0.043 : fusuma ? 0.19 : 0.105) ** 2, 0.78 ** 2, openArea),
  };
}

export function traceResidenceWalls(listener: Point, source: Point, walls: readonly ResidenceWall[],
  doorOpenness?: ResidenceDoorOpenness) {
  const crossings = walls.flatMap(wall => {
    const from = wallOffset(wall, listener);
    const to = wallOffset(wall, source);
    if (from * to >= 0) return [];
    const fraction = from / (from - to);
    const x = mix(listener.x, source.x, fraction);
    const n = -mix(listener.z, source.z, fraction);
    const y = mix(listener.y, source.y, fraction);
    const along = wall.axis === 'e' ? x : n;
    const edge = Math.min(along - wall.from, wall.to - along);
    const thickness = smoothstep(0, 0.24, Math.min(Math.abs(from), Math.abs(to)));
    const through = smoothstep(-0.12, 0.12, edge) * smoothstep(-0.12, 0.12, wall.height - y) * thickness;
    return through > 0 ? [{ wall, fraction, along, y, through }] : [];
  }).sort((a, b) => b.fraction - a.fraction);

  let low = 1;
  let high = 1;
  let diffuse = 1;
  let arrival = source;
  for (const { wall, along, y, through } of crossings) {
    const interior = wall.kind === 'interior';
    const opaqueLow = (interior ? 0.095 : 0.032) ** 2;
    const opaqueHigh = (interior ? 0.012 : 0.004) ** 2;
    const opaqueDiffuse = (interior ? 0.075 : 0.024) ** 2;
    let lowAcross = opaqueLow;
    let highAcross = opaqueHigh;
    let diffuseAcross = opaqueDiffuse;
    let arrivalWeight = 0;
    let arrivalAlong = 0;
    let arrivalHeight = 0;
    for (const opening of wall.openings ?? []) {
      const width = opening.to - opening.from;
      const nearest = clamp(along, opening.from + width * 0.10, opening.to - width * 0.10);
      const height = clamp(y, opening.bottom + 0.06, opening.top - 0.06);
      const offset = Math.hypot(nearest - along, height - y);
      const direct = 1 / (1 + (offset / (0.13 + width * 0.55)) ** 2) ** 2;
      const scattered = 1 / (1 + (offset / (0.45 + width * 0.76)) ** 2) ** 2;
      const bands = apertureBands(wall, opening, doorOpenness);
      const directPower = direct * bands.low;
      lowAcross = Math.max(lowAcross, directPower);
      highAcross = Math.max(highAcross, direct ** 2 * bands.high);
      diffuseAcross = Math.max(diffuseAcross, scattered * bands.diffuse);
      const weight = Math.max(0, directPower - opaqueLow) ** 2;
      arrivalWeight += weight;
      arrivalAlong += nearest * weight;
      arrivalHeight += height * weight;
    }
    low *= mix(1, lowAcross, through);
    high *= mix(1, highAcross, through);
    diffuse *= mix(1, diffuseAcross, through);
    if (arrivalWeight > 0) {
      const aperture = residenceOpeningPoint(wall, arrivalAlong / arrivalWeight, arrivalHeight / arrivalWeight);
      const bend = through * smoothstep(opaqueLow, opaqueLow * 5, lowAcross);
      arrival = { x: mix(arrival.x, aperture.x, bend), y: mix(arrival.y, aperture.y, bend),
        z: mix(arrival.z, aperture.z, bend) };
    }
  }
  // Approximate the two transmission bands as one variable low-pass. Easing across
  // wall edges and threshold distance keeps moving sources and listeners continuous.
  return { gain: Math.sqrt(low), cutoff: 110 + 17_890 * (high / low), arrival, diffuseGain: Math.sqrt(diffuse) };
}

export function residenceSoundPath(listener: Point, source: Point, doorOpenness?: ResidenceDoorOpenness) {
  const path = traceResidenceWalls(listener, source, SOUND_BARRIERS, doorOpenness);
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y, source.z - listener.z);
  const spreading = 1 / Math.max(1, distance);
  return { ...path, gain: path.gain * spreading, diffuseGain: path.diffuseGain * spreading };
}
