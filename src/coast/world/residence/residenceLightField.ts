import * as THREE from 'three';
import { RESIDENCE_ROOMS, RESIDENCE_WALLS, type ResidenceRect } from './residencePlan';

interface LightSource {
  readonly span: ResidenceRect;
  readonly height: number;
  readonly spread: number;
  readonly level: number;
  readonly kind: 'cove' | 'foot' | 'task' | 'down';
  readonly accent?: number;
}

type Mount = 'north' | 'west' | 'south';
const cove = (span: ResidenceRect, height: number, spread: number, level: number, mount: Mount) => (
  { span, height, spread, level, mount, kind: 'cove' as const });
const foot = (east: number, north: number): LightSource => (
  { span: [east, north, east, north], height: .20, spread: .65, level: .43, kind: 'foot' });
const task = (span: ResidenceRect, height: number, spread: number, level: number, accent?: number): LightSource => (
  { span, height, spread, level, accent, kind: 'task' });
const down = (east: number, north: number, height: number, level: number): LightSource => (
  { span: [east, north, east, north], height, spread: 1.2, level, kind: 'down' });

export const livingCoves = [cove([17.77, 6.42, 22.25, 6.42], 2.72, 2.45, 1.32, 'north'),
  cove([11.19, 1.16, 11.19, 4.62], 2.72, 2.00, .98, 'west')];
export const bedroomCoves = {
  '01': cove([17.39, 15.37, 20.33, 15.37], 2.61, 1.77, .96, 'north'),
  '02': cove([18.07, 6.87, 21.46, 6.87], 2.61, 1.65, .81, 'south'),
  '03': cove([.32, 4.77, 2.10, 4.77], 2.61, 1.83, .86, 'north'),
  '04': cove([3.95, 4.77, 5.70, 4.77], 2.61, 1.83, .74, 'north'),
  '05': cove([7.63, 4.77, 9.38, 4.77], 2.61, 1.83, .59, 'north'),
};
export const hallCoves = {
  H0: cove([11.19, 7.19, 11.19, 11.74], 2.49, 1.20, .49, 'west'),
  FO: cove([8.22, 13.15, 8.22, 15.21], 2.35, 1.75, .83, 'west'),
};
export const corridorFootlights = {
  H1: [.96, 3.30, 5.99, 8.56, 10.68].map(east => foot(east, 6.54)),
  H0: [7.12, 8.73, 11.85].map(north => foot(11.11, north)),
  H2: [13.21, 15.02, 16.77, 18.78].map(east => foot(east, 11.50)),
  FO: [12.56, 14.47].map(north => foot(12.67, north)),
};
export const serviceDownlights: Readonly<Record<string, readonly LightSource[]>> = {
  BA: [down(1.85, 8.64, 2.55, .85)], BB: [down(4.74, 8.63, 2.55, .68)],
  UT: [down(7.25, 8.50, 2.55, .75)], ST: [down(9.63, 8.20, 2.55, .65)],
  WC: [down(9.52, 10.95, 2.55, .71)], MB: [down(13.93, 13.39, 2.55, .83)],
  WI: [down(16.23, 13.92, 2.55, .66)],
  K: [down(15.19, 7.79, 2.85, .70)],
  C1: [1.70, 4.15, 6.60, 9.3, 12.0, 14.7].map(east => down(east, 16.65, 2.65, .76)),
};
export const diningPendants = { east: [15.36, 16.69], north: 4.72, height: 2.083 } as const;

export const fabricLamps = [
  { room: 'LD', east: 12.22, north: 1.27, base: .001, height: 1.42, accent: .68 },
  { room: 'LD', east: 17.97, north: .90, base: .507, height: .34, accent: .43 },
  { room: '01', east: 17.49, north: 15.218, base: .487, height: .35, accent: .48 },
  { room: '01', east: 19.905, north: 15.277, base: .487, height: .32, accent: .48 },
  { room: '02', east: 21.335, north: 9.167, base: .487, height: .32, accent: .51 },
  { room: '03', east: 2.305, north: 3.127, base: .487, height: .32, accent: .52 },
  { room: '04', east: 5.845, north: 3.127, base: .487, height: .32, accent: .37 },
  { room: '05', east: 9.315, north: 3.037, base: .487, height: .32, accent: .38 },
] as const;

function fabricLampSources(room: string): LightSource[] {
  return fabricLamps.filter(lamp => lamp.room === room).map(({ east, north, base, height, accent }) =>
    task([east, north, east, north], base + height * .58, 1.05, .24, accent));
}

const roomSources: Readonly<Record<string, readonly LightSource[]>> = {
  LD: [...livingCoves, ...diningPendants.east.map(east => down(east, diningPendants.north, diningPendants.height, .25)),
    ...fabricLampSources('LD')],
  '01': [bedroomCoves['01'], ...fabricLampSources('01')],
  '02': [bedroomCoves['02'], ...fabricLampSources('02')],
  '03': [bedroomCoves['03'], ...fabricLampSources('03')],
  '04': [bedroomCoves['04'], ...fabricLampSources('04'), task([6.748, .452, 6.748, .452], 1.065, .78, .39, .45)],
  '05': [bedroomCoves['05'], ...fabricLampSources('05'), task([10.193, .520, 10.193, .520], 1.065, .81, .39, .50)],
  H1: corridorFootlights.H1,
  H0: [...corridorFootlights.H0, hallCoves.H0],
  H2: corridorFootlights.H2,
  FO: [...corridorFootlights.FO, hallCoves.FO],
  ...serviceDownlights,
  K: [task([13.90, 9.48, 16.80, 9.48], 1.49, 1.03, .95, .37), ...serviceDownlights.K],
};

const fieldOrigin = [-.42, -.42, -.12] as const;
const fieldExtent = [23.64, 21.12, 3.72] as const;
export const residenceFieldOrigin = new THREE.Vector3(...fieldOrigin);
export const residenceFieldExtent = new THREE.Vector3(...fieldExtent);

function isInside([west, south, east, north]: ResidenceRect, x: number, n: number): boolean {
  return x >= west && x < east && n >= south && n < north;
}

function distanceTo([west, south, east, north]: ResidenceRect, x: number, n: number): number {
  return Math.hypot(Math.max(west - x, x - east, 0), Math.max(south - n, n - north, 0));
}

// Sample the room on each side of an aperture so recesses and interior partitions retain their own lighting.
const openingsByRoom = new Map<string, ResidenceRect[]>();
for (const wall of RESIDENCE_WALLS) {
  for (const opening of wall.openings ?? []) {
    if (opening.kind !== 'window' && opening.kind !== 'balcony-door') continue;
    const mid = (opening.from + opening.to) / 2;
    const span: ResidenceRect = wall.axis === 'e' ? [opening.from, wall.fixed, opening.to, wall.fixed]
      : [wall.fixed, opening.from, wall.fixed, opening.to];
    for (const sign of [-1, 1]) {
      const side = wall.fixed + sign * (wall.thickness / 2 + .077);
      const [x, n] = wall.axis === 'e' ? [mid, side] : [side, mid];
      const room = RESIDENCE_ROOMS.find(candidate => candidate.floor !== 'deck'
        && candidate.rectangles.some(rect => isInside(rect, x, n)));
      if (!room) continue;
      const openings = openingsByRoom.get(room.id) ?? [];
      openings.push(span);
      openingsByRoom.set(room.id, openings);
    }
  }
}

function probeLight(source: LightSource, distance: number, y: number): number {
  const vertical = source.height - y;
  switch (source.kind) {
    case 'cove':
      return source.level * Math.exp(-((distance / source.spread) ** 2))
        * (.32 + .68 * THREE.MathUtils.smoothstep(y, .75, source.height + .11));
    case 'foot':
      return source.level * Math.exp(-((distance / source.spread) ** 2) - (vertical / .49) ** 2);
    case 'task':
      return source.level * Math.exp(-((distance / source.spread) ** 2) - ((vertical - .30) / .99) ** 2)
        * (1 - .80 * THREE.MathUtils.smoothstep(y, source.height, source.height + .28));
    case 'down':
      return source.level * Math.exp(-((distance / (source.spread + Math.max(0, vertical) * .34)) ** 2))
        * (1 - .88 * THREE.MathUtils.smoothstep(y, source.height, source.height + .24))
        / (1 + vertical * vertical * .21);
  }
}

export function createResidenceLightField(obstacles: readonly ResidenceRect[]) {
  const [eastCount, northCount, levels] = [148, 132, 20];
  const pixels = new Uint8Array(eastCount * northCount * levels * 4);
  const accents = new Uint8Array(pixels.length);
  const toByte = (value: number) => Math.round(255 * THREE.MathUtils.clamp(value, 0, 1));
  for (let northIndex = 0; northIndex < northCount; northIndex += 1) {
    const north = fieldOrigin[1] + (northIndex + .5) * fieldExtent[1] / northCount;
    for (let eastIndex = 0; eastIndex < eastCount; eastIndex += 1) {
      const east = fieldOrigin[0] + (eastIndex + .5) * fieldExtent[0] / eastCount;
      const room = RESIDENCE_ROOMS.find(candidate => candidate.rectangles.some(rect => isInside(rect, east, north)));
      const id = room?.id ?? '';
      const outdoors = !room || room.floor === 'deck';
      const daytimeFixtures = id !== 'K' && Boolean(serviceDownlights[id]);
      const openings = openingsByRoom.get(id) ?? [];
      const apertures = openings.reduce((sum, window) => sum + .96 * Math.exp(-distanceTo(window, east, north) / 4.30), 0);
      const reflectedDay = id === 'K' ? .56 + .54 * Math.exp(-(north - 6.65) * .44)
        : id === 'H0' ? .49 + .59 * Math.exp(-(north - 6.65) * .54) : .64;
      const day = outdoors ? 2.02 : Math.min(2.47, reflectedDay + apertures + (daytimeFixtures ? .17 : 0));
      const night = outdoors ? .005 : (id === 'LD' ? .24 : id === 'H1' || id === 'H2' ? .26 : .30);
      const sources = roomSources[id]?.map(source => ({
        source, distance: distanceTo(source.span, east, north),
        dx: THREE.MathUtils.clamp(east, source.span[0], source.span[2]) - east,
        dz: north - THREE.MathUtils.clamp(north, source.span[1], source.span[3]),
      })) ?? [];
      const nearFurniture = room ? obstacles.reduce((minimum, rect) => Math.min(minimum, distanceTo(rect, east, north)), .31) : .31;
      for (let level = 0; level < levels; level += 1) {
        const height = fieldOrigin[2] + (level + .5) * fieldExtent[2] / levels;
        const pixel = ((level * northCount + northIndex) * eastCount + eastIndex) * 4;
        let warm = night;
        let work = 0;
        let incidenceX = 0;
        let incidenceY = 0;
        let incidenceZ = 0;
        let strength = 0;
        for (const { source, distance, dx, dz } of sources) {
          const contribution = probeLight(source, distance, height);
          if (source.kind === 'task') work += contribution;
          else warm += contribution;
          if (!source.accent) continue;
          const dy = source.height - height;
          const length = Math.sqrt(distance * distance + dy * dy);
          const cone = THREE.MathUtils.smoothstep(dy + .35 * distance, -.12, .28);
          const falloff = source.accent * cone
            * (1 - THREE.MathUtils.smoothstep(length, .66 * source.spread, 1.60 * source.spread)) / (.27 + length * length);
          const weight = falloff / Math.max(length, .05);
          incidenceX += dx * weight;
          incidenceY += dy * weight;
          incidenceZ += dz * weight;
          strength += falloff;
        }
        const occlusion = .63 * (1 - THREE.MathUtils.smoothstep(nearFurniture, .015, .26))
          * (1 - THREE.MathUtils.smoothstep(height, .055, .36));
        pixels[pixel] = toByte((day + (daytimeFixtures ? .66 * (warm - night) : 0)) / 2.6);
        pixels[pixel + 1] = toByte(warm / 2.1);
        pixels[pixel + 2] = toByte(work / 1.5);
        pixels[pixel + 3] = toByte(1 - occlusion);
        // Store weighted direction so interpolation fades a light out instead of bending its direction toward an unlit probe.
        const normalization = .5 / Math.max(1.85, strength);
        accents[pixel] = toByte(.5 + incidenceX * normalization);
        accents[pixel + 1] = toByte(.5 + incidenceY * normalization);
        accents[pixel + 2] = toByte(.5 + incidenceZ * normalization);
        accents[pixel + 3] = toByte(strength / 2.6);
      }
    }
  }
  function texture(bytes: Uint8Array, name: string) {
    const field = new THREE.Data3DTexture(bytes, eastCount, northCount, levels);
    field.name = name;
    field.format = THREE.RGBAFormat;
    field.minFilter = field.magFilter = THREE.LinearFilter;
    field.needsUpdate = true;
    return field;
  }
  return {
    diffuse: texture(pixels, '50F daylight, cove bounce, task lighting and contact occlusion'),
    accent: texture(accents, '50F directional task and reading lamps'),
  };
}
