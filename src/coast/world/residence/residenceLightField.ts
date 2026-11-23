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
  { span: [east, north, east, north], height, spread: 1.75, level, accent: level * .54, kind: 'down' });

export const livingCoves = [cove([17.77, 6.42, 22.25, 6.42], 2.72, 3.20, 1.44, 'north'),
  cove([11.19, 1.16, 11.19, 4.62], 2.72, 2.84, 1.18, 'west')];
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
  { room: '04', east: 6.672, north: 3.414, base: -.04, height: .43, accent: .45 },
] as const;

function fabricLampSources(room: string): LightSource[] {
  return fabricLamps.filter(lamp => lamp.room === room).map(({ east, north, base, height, accent }) =>
    task([east, north, east, north], base + height * .72, 1.20, .32, accent * 1.25));
}

const roomSources: Readonly<Record<string, readonly LightSource[]>> = {
  LD: [...livingCoves, ...diningPendants.east.map(east => down(east, diningPendants.north, diningPendants.height, .25)),
    ...fabricLampSources('LD')],
  '01': [bedroomCoves['01'], ...fabricLampSources('01')],
  '02': [bedroomCoves['02'], ...fabricLampSources('02')],
  '03': [bedroomCoves['03'], ...fabricLampSources('03')],
  '04': [bedroomCoves['04'], ...fabricLampSources('04'), task([4.19, 4.790, 5.20, 4.790], 2.15, 1.06, .51, .53)],
  '05': [bedroomCoves['05'], task([8.005, 2.025, 8.005, 2.025], 1.092, 1.22, .60, .57),
    task([9.978, 1.437, 9.978, 1.437], 1.27, 1.19, .47, .51),
    task([10.64, 2.55, 10.64, 3.26], 2.404, 1.14, .39, .38)],
  H1: corridorFootlights.H1,
  H0: [...corridorFootlights.H0, hallCoves.H0],
  H2: corridorFootlights.H2,
  FO: [...corridorFootlights.FO, hallCoves.FO],
  ...serviceDownlights,
  BA: [...serviceDownlights.BA, task([.53, 9.18, 1.75, 9.18], 1.91, .83, .34, .35)],
  BB: [...serviceDownlights.BB, task([5.38, 9.24, 5.86, 9.24], 1.91, .76, .31, .31)],
  MB: [...serviceDownlights.MB, task([13.10, 12.19, 13.10, 13.43], 1.91, .87, .38, .39)],
  WC: [...serviceDownlights.WC, task([8.25, 10.35, 8.25, 11.57], 1.91, .79, .32, .35)],
  K: [task([13.90, 9.48, 16.80, 9.48], 1.49, 1.03, .95, .37), ...serviceDownlights.K],
};

const fieldOrigin = [-.42, -.42, -.12] as const;
const fieldExtent = [23.64, 21.12, 3.72] as const;
export const residenceFieldOrigin = new THREE.Vector3(...fieldOrigin);
export const residenceFieldExtent = new THREE.Vector3(...fieldExtent);
const apertureHeights = [.18, .50, .82];

function isInside([west, south, east, north]: ResidenceRect, x: number, n: number): boolean {
  return x >= west && x < east && n >= south && n < north;
}

function distanceTo([west, south, east, north]: ResidenceRect, x: number, n: number): number {
  return Math.hypot(Math.max(west - x, x - east, 0), Math.max(south - n, n - north, 0));
}

interface DaylightAperture {
  span: ResidenceRect;
  bottom: number;
  top: number;
  axis: 'e' | 'n';
}

// Each room sees only its own exterior glazing. Light from adjoining rooms is accounted for by the bounce term.
const openingsByRoom = new Map<string, DaylightAperture[]>();
const opaqueWallRuns: ResidenceRect[] = [];
for (const wall of RESIDENCE_WALLS) {
  if (wall.kind === 'guard') continue;
  const half = wall.thickness / 2;
  const alongWall = (from: number, to: number, offset: number): ResidenceRect => wall.axis === 'e'
    ? [from, wall.fixed - offset, to, wall.fixed + offset]
    : [wall.fixed - offset, from, wall.fixed + offset, to];
  let solidFrom = wall.from;
  for (const opening of wall.openings ?? []) {
    if (opening.from > solidFrom) opaqueWallRuns.push(alongWall(solidFrom, opening.from, half));
    solidFrom = opening.to;
    if (opening.kind !== 'window' && opening.kind !== 'balcony-door') continue;
    const mid = (opening.from + opening.to) / 2;
    for (const sign of [-1, 1]) {
      const side = wall.fixed + sign * (half + .077);
      const [x, n] = wall.axis === 'e' ? [mid, side] : [side, mid];
      const room = RESIDENCE_ROOMS.find(candidate => candidate.floor !== 'deck'
        && candidate.rectangles.some(rect => isInside(rect, x, n)));
      if (!room) continue;
      const openings = openingsByRoom.get(room.id) ?? [];
      openings.push({ span: alongWall(opening.from, opening.to, 0), bottom: opening.bottom, top: opening.top, axis: wall.axis });
      openingsByRoom.set(room.id, openings);
    }
  }
  if (wall.to > solidFrom) opaqueWallRuns.push(alongWall(solidFrom, wall.to, half));
}

function probeLight(source: LightSource, distance: number, y: number): number {
  const vertical = source.height - y;
  switch (source.kind) {
    case 'cove':
      return source.level * Math.exp(-((distance / source.spread) ** 2))
        * (.44 + .51 * THREE.MathUtils.smoothstep(y, .6, source.height + .11))
        + .54 * source.level * THREE.MathUtils.smoothstep(y, source.height, source.height + .24)
          * Math.exp(-distance / .86);
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
  const daylight = new Uint8Array(pixels.length);
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
      const apertureDistance = openings.reduce((minimum, { span }) => Math.min(minimum, distanceTo(span, east, north)), 18);
      const skyBounce = Math.exp(-apertureDistance / 4.1);
      const reflectedDay = id === 'K' ? .43 + .67 * Math.exp(-(north - 6.65) * .47)
        : id === 'H0' ? .42 + .60 * Math.exp(-(north - 6.65) * .56) : .56;
      const day = outdoors ? 1.72 : reflectedDay + .76 * skyBounce + (daytimeFixtures ? .38 : 0);
      const night = outdoors ? .006 : (id === '04' ? .42 : id === 'LD' ? .35 : id === 'H1' || id === 'H2' ? .23 : .28);
      const sources = roomSources[id]?.map(source => ({
        source, distance: distanceTo(source.span, east, north),
        dx: THREE.MathUtils.clamp(east, source.span[0], source.span[2]) - east,
        dz: north - THREE.MathUtils.clamp(north, source.span[1], source.span[3]),
      })) ?? [];
      const nearFurniture = room ? obstacles.reduce((minimum, rect) => Math.min(minimum, distanceTo(rect, east, north)), .31) : .31;
      const nearWall = room ? opaqueWallRuns.reduce((minimum, rect) => Math.min(minimum, distanceTo(rect, east, north)), .60) : .60;
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
        const corner = 1 - THREE.MathUtils.smoothstep(nearWall, .010, .66);
        const floorContact = 1 - THREE.MathUtils.smoothstep(height, .018, .36);
        const ceilingContact = THREE.MathUtils.smoothstep(height, (room?.ceiling ?? 4) - .42, room?.ceiling ?? 4);
        const furnitureShade = .59 * (1 - THREE.MathUtils.smoothstep(nearFurniture, .012, .33)) * floorContact;
        const joinShade = corner * (.09 + .23 * floorContact + .30 * ceilingContact);
        const occlusion = 1 - (1 - furnitureShade) * (1 - joinShade);
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

        // Integrate a rectangle as a line of short projected patches. Encoding the weighted direction
        // steers the blue sky lobe toward the glazing while leaving floor bounce broad and warm.
        let skyX = 0;
        let skyY = 0;
        let skyZ = 0;
        let skyEnergy = 0;
        for (const { span: [west, south, endEast, endNorth], bottom, top, axis } of openings) {
          const along = axis === 'e' ? endEast - west : endNorth - south;
          const across = Math.abs(axis === 'e' ? north - south : east - west);
          const columns = Math.ceil(along / 1.2);
          const patchArea = along * (top - bottom) / (columns * 3);
          for (let column = 0; column < columns; column += 1) {
            const horizontal = (column + .5) / columns;
            const dx = THREE.MathUtils.lerp(west, endEast, horizontal) - east;
            const dz = north - THREE.MathUtils.lerp(south, endNorth, horizontal);
            for (const vertical of apertureHeights) {
              const dy = THREE.MathUtils.lerp(bottom, top, vertical) - height;
              const range2 = dx * dx + dy * dy + dz * dz + .45;
              const inverseRange = 1 / Math.sqrt(range2);
              const energy = patchArea * Math.max(.13, across) * inverseRange / range2;
              const directionalEnergy = energy * inverseRange;
              skyX += dx * directionalEnergy;
              skyY += dy * directionalEnergy;
              skyZ += dz * directionalEnergy;
              skyEnergy += energy;
            }
          }
        }
        if (outdoors) {
          skyY = .75;
          skyEnergy = .75;
        }
        const daylightScale = .50 / Math.max(1.0, skyEnergy);
        daylight[pixel] = toByte(.5 + skyX * daylightScale);
        daylight[pixel + 1] = toByte(.5 + skyY * daylightScale);
        daylight[pixel + 2] = toByte(.5 + skyZ * daylightScale);
        daylight[pixel + 3] = toByte(skyEnergy / 2.5);
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
    diffuse: texture(pixels, 'Residence floor bounce, cove and task lighting, room edge occlusion'),
    accent: texture(accents, 'Residence directional task and reading lamps'),
    daylight: texture(daylight, 'Residence directional window apertures'),
  };
}
