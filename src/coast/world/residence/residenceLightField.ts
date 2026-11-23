import * as THREE from 'three';
import { RESIDENCE_ROOMS, RESIDENCE_WALLS, type ResidenceRect } from './residencePlan';

type Mount = 'north' | 'west' | 'south';

interface Source {
  readonly id: string;
  readonly label: string;
  readonly span: ResidenceRect;
  readonly height: number;
  readonly spread: number;
  readonly level: number;
  readonly accent?: number;
  readonly daytime?: boolean;
}

export type LightSource = Source & (
  | { readonly kind: 'cove'; readonly mount: Mount }
  | { readonly kind: 'foot' | 'task' | 'down' | 'pendant' }
);

const cove = (id: string, label: string, span: ResidenceRect, height: number, spread: number,
  level: number, mount: Mount): LightSource => ({ id, label, span, height, spread, level, mount, kind: 'cove' });
const foot = (room: string, positions: readonly (readonly [east: number, north: number])[]): LightSource[] =>
  positions.map(([east, north], index) => ({
    id: `${room}-foot-${index + 1}`, label: `足元灯 ${index + 1}`,
    span: [east, north, east, north], height: .20, spread: .65, level: .43, kind: 'foot',
  }));
const task = (id: string, label: string, span: ResidenceRect, height: number,
  spread: number, level: number, accent: number): LightSource =>
  ({ id, label, span, height, spread, level, accent, kind: 'task' });
const down = (id: string, east: number, north: number, height: number, level: number, daytime = true,
  label = 'ダウンライト', kind: 'down' | 'pendant' = 'down'): LightSource => (
  { id, label, span: [east, north, east, north], height, spread: 1.75, level, accent: level * .54,
    daytime, kind });

export const diningPendants = [
  { id: 'LD-pendant-west', east: 15.36, label: 'ペンダント灯（西）' },
  { id: 'LD-pendant-east', east: 16.69, label: 'ペンダント灯（東）' },
] as const;
export const diningPendantNorth = 4.72;
export const diningPendantHeight = 2.083;

export const fabricLamps = [
  { id: 'LD-floor', room: 'LD', label: 'フロアランプ', east: 12.22, north: 1.27, base: .001, height: 1.42, accent: .68 },
  { id: 'LD-table', room: 'LD', label: 'ソファ横のランプ', east: 17.97, north: .90, base: .507, height: .34, accent: .43 },
  { id: '01-bed-west', room: '01', label: 'ベッド脇のランプ（西）', east: 17.49, north: 15.218, base: .487, height: .35, accent: .48 },
  { id: '01-bed-east', room: '01', label: 'ベッド脇のランプ（東）', east: 19.905, north: 15.277, base: .487, height: .32, accent: .48 },
  { id: '02-bed', room: '02', label: 'ベッド脇のランプ', east: 21.335, north: 9.167, base: .487, height: .32, accent: .51 },
  { id: '03-bed', room: '03', label: 'ベッド脇のランプ', east: 2.305, north: 3.127, base: .487, height: .32, accent: .52 },
  { id: '04-lantern', room: '04', label: '行灯', east: 6.672, north: 3.414, base: -.04, height: .43, accent: .45 },
] as const;

function fabricLampSources(room: string): LightSource[] {
  return fabricLamps.filter(lamp => lamp.room === room).map(({ id, label, east, north, base, height, accent }) =>
    task(id, label, [east, north, east, north], base + height * .72, 1.20, .32, accent * 1.25));
}

export const roomSources: Readonly<Record<string, readonly LightSource[]>> = {
  LD: [
    cove('LD-cove-north', '北側の間接照明', [17.77, 6.42, 22.25, 6.42], 2.72, 3.20, 1.44, 'north'),
    cove('LD-cove-west', '西側の間接照明', [11.19, 1.16, 11.19, 4.62], 2.72, 2.84, 1.18, 'west'),
    ...diningPendants.map(({ id, east, label }) => down(id, east, diningPendantNorth, diningPendantHeight, .25, false, label, 'pendant')),
    ...fabricLampSources('LD'),
  ],
  '01': [cove('01-cove', '間接照明', [17.39, 15.37, 20.33, 15.37], 2.61, 1.77, .96, 'north'), ...fabricLampSources('01')],
  '02': [cove('02-cove', '間接照明', [18.07, 6.87, 21.46, 6.87], 2.61, 1.65, .81, 'south'), ...fabricLampSources('02')],
  '03': [cove('03-cove', '間接照明', [.32, 4.77, 2.10, 4.77], 2.61, 1.83, .86, 'north'), ...fabricLampSources('03')],
  '04': [cove('04-cove', '間接照明', [3.95, 4.77, 5.70, 4.77], 2.61, 1.83, .74, 'north'), ...fabricLampSources('04'),
    task('04-alcove', '床の間の照明', [4.19, 4.790, 5.20, 4.790], 2.15, 1.06, .51, .53)],
  '05': [cove('05-cove', '間接照明', [7.63, 4.77, 9.38, 4.77], 2.61, 1.83, .59, 'north'),
    task('05-desk', 'デスクライト', [8.005, 2.025, 8.005, 2.025], 1.092, 1.22, .60, .57),
    task('05-reading', '読書灯', [9.978, 1.437, 9.978, 1.437], 1.27, 1.19, .47, .51),
    task('05-bookcase', '書棚の照明', [10.64, 2.55, 10.64, 3.26], 2.404, 1.14, .39, .38)],
  H1: foot('H1', [.96, 3.30, 5.99, 8.56, 10.68].map(east => [east, 6.54])),
  H0: [cove('H0-cove', '間接照明', [11.19, 7.19, 11.19, 11.74], 2.49, 1.20, .49, 'west'),
    ...foot('H0', [7.12, 8.73, 11.85].map(north => [11.11, north]))],
  H2: foot('H2', [13.21, 15.02, 16.77, 18.78].map(east => [east, 11.50])),
  FO: [cove('FO-cove', '間接照明', [8.22, 13.15, 8.22, 15.21], 2.35, 1.75, .83, 'west'),
    ...foot('FO', [12.56, 14.47].map(north => [12.67, north]))],
  BA: [down('BA-down', 1.85, 8.64, 2.55, .85),
    task('BA-vanity', '鏡の照明', [.53, 9.18, 1.75, 9.18], 1.91, .83, .34, .35)],
  BB: [down('BB-down', 4.74, 8.63, 2.55, .68),
    task('BB-vanity', '鏡の照明', [5.38, 9.24, 5.86, 9.24], 1.91, .76, .31, .31)],
  UT: [down('UT-down', 7.25, 8.50, 2.55, .75)],
  ST: [down('ST-down', 9.63, 8.20, 2.55, .65)],
  WC: [down('WC-down', 9.52, 10.95, 2.55, .71),
    task('WC-vanity', '鏡の照明', [8.25, 10.35, 8.25, 11.57], 1.91, .79, .32, .35)],
  MB: [down('MB-down', 13.93, 13.39, 2.55, .83),
    task('MB-vanity', '鏡の照明', [13.10, 12.19, 13.10, 13.43], 1.91, .87, .38, .39)],
  WI: [down('WI-down', 16.23, 13.92, 2.55, .66)],
  K: [down('K-down', 15.19, 7.79, 2.85, .70, false),
    task('K-strip-west', '作業台の照明（西）', [13.87, 9.48, 15.34, 9.48], 1.49, 1.03, .64, .25),
    task('K-strip-east', '作業台の照明（東）', [15.48, 9.48, 16.95, 9.48], 1.49, 1.03, .64, .25)],
  C1: [1.70, 4.15, 6.60, 9.3, 12.0, 14.7].map((east, index) => down(`C1-down-${index + 1}`, east, 16.65, 2.65, .76)),
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
    case 'pendant':
      return source.level * Math.exp(-((distance / (source.spread + Math.max(0, vertical) * .34)) ** 2))
        * (1 - .88 * THREE.MathUtils.smoothstep(y, source.height, source.height + .24))
        / (1 + vertical * vertical * .21);
  }
}

interface ProbeColumn {
  readonly offset: number;
  readonly day: number;
  readonly sources: readonly {
    readonly source: LightSource;
    readonly distance: number;
    readonly dx: number;
    readonly dz: number;
  }[];
}

export function createResidenceLightField(obstacles: readonly ResidenceRect[]) {
  const [eastCount, northCount, levels] = [148, 132, 20];
  const levelStride = eastCount * northCount * 4;
  const pixels = new Uint8Array(levelStride * levels);
  const accents = new Uint8Array(pixels.length);
  const daylight = new Uint8Array(pixels.length);
  const columnsByRoom = new Map<string, ProbeColumn[]>();
  const toByte = (value: number) => Math.round(255 * THREE.MathUtils.clamp(value, 0, 1));

  for (let northIndex = 0; northIndex < northCount; northIndex += 1) {
    const north = fieldOrigin[1] + (northIndex + .5) * fieldExtent[1] / northCount;
    for (let eastIndex = 0; eastIndex < eastCount; eastIndex += 1) {
      const east = fieldOrigin[0] + (eastIndex + .5) * fieldExtent[0] / eastCount;
      const room = RESIDENCE_ROOMS.find(candidate => candidate.rectangles.some(rect => isInside(rect, east, north)));
      const id = room?.id ?? '';
      const outdoors = !room || room.floor === 'deck';
      const openings = openingsByRoom.get(id) ?? [];
      const apertureDistance = openings.reduce((minimum, { span }) => Math.min(minimum, distanceTo(span, east, north)), 18);
      const skyBounce = Math.exp(-apertureDistance / 4.1);
      const reflectedDay = id === 'K' ? .43 + .67 * Math.exp(-(north - 6.65) * .47)
        : id === 'H0' ? .42 + .60 * Math.exp(-(north - 6.65) * .56) : .56;
      const day = outdoors ? 1.72 : reflectedDay + .76 * skyBounce;
      const offset = (northIndex * eastCount + eastIndex) * 4;
      const sources = roomSources[id]?.map(source => ({
        source, distance: distanceTo(source.span, east, north),
        dx: THREE.MathUtils.clamp(east, source.span[0], source.span[2]) - east,
        dz: north - THREE.MathUtils.clamp(north, source.span[1], source.span[3]),
      }));
      if (sources) {
        const columns = columnsByRoom.get(id) ?? [];
        columns.push({ offset, day, sources });
        columnsByRoom.set(id, columns);
      }
      const nearFurniture = room ? obstacles.reduce((minimum, rect) => Math.min(minimum, distanceTo(rect, east, north)), .31) : .31;
      const nearWall = room ? opaqueWallRuns.reduce((minimum, rect) => Math.min(minimum, distanceTo(rect, east, north)), .60) : .60;
      const corner = 1 - THREE.MathUtils.smoothstep(nearWall, .010, .66);
      const nearFootprint = .59 * (1 - THREE.MathUtils.smoothstep(nearFurniture, .012, .33));
      for (let level = 0; level < levels; level += 1) {
        const height = fieldOrigin[2] + (level + .5) * fieldExtent[2] / levels;
        const pixel = offset + level * levelStride;
        const floorContact = 1 - THREE.MathUtils.smoothstep(height, .018, .36);
        const ceilingContact = THREE.MathUtils.smoothstep(height, (room?.ceiling ?? 4) - .42, room?.ceiling ?? 4);
        const furnitureShade = nearFootprint * floorContact;
        const joinShade = corner * (.09 + .23 * floorContact + .30 * ceilingContact);
        const occlusion = 1 - (1 - furnitureShade) * (1 - joinShade);
        pixels[pixel] = toByte(day / 2.6);
        pixels[pixel + 1] = toByte((outdoors ? .006 : .28) / 2.1);
        pixels[pixel + 3] = toByte(1 - occlusion);
        accents[pixel] = accents[pixel + 1] = accents[pixel + 2] = 128;

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
  const diffuse = texture(pixels, 'Residence floor bounce, cove and task lighting, room edge occlusion');
  const accent = texture(accents, 'Residence directional task and reading lamps');

  function updateRoom(id: string, enabled: (source: LightSource) => boolean, night: boolean): void {
    const columns = columnsByRoom.get(id);
    if (!columns) return;
    const fixtures = roomSources[id];
    const active = new Set(fixtures.filter(enabled));
    const totalLevel = fixtures.reduce((sum, fixture) => sum + fixture.level, 0);
    const activeLevel = fixtures.reduce((sum, fixture) => sum + (active.has(fixture) ? fixture.level : 0), 0);
    const daytimeCount = fixtures.filter(fixture => fixture.daytime).length;
    const activeDaytime = fixtures.filter(fixture => fixture.daytime && active.has(fixture)).length;
    const nightBounce = id === '04' ? .42 : id === 'LD' ? .35 : id === 'H1' || id === 'H2' ? .23 : .28;
    const ambient = THREE.MathUtils.lerp(.018, nightBounce, activeLevel / totalLevel);
    const dayBounce = daytimeCount > 0 ? .38 * activeDaytime / daytimeCount : 0;

    // Change only the affected room's probes. Window direction and static contact shadow stay baked.
    for (const { offset, day, sources } of columns) {
      const lit = sources.filter(({ source }) => active.has(source));
      for (let level = 0; level < levels; level += 1) {
        const height = fieldOrigin[2] + (level + .5) * fieldExtent[2] / levels;
        const pixel = offset + level * levelStride;
        let daytime = day + dayBounce;
        let warm = ambient;
        let work = 0;
        let incidenceX = 0;
        let incidenceY = 0;
        let incidenceZ = 0;
        let strength = 0;
        for (const { source, distance, dx, dz } of lit) {
          const contribution = probeLight(source, distance, height);
          if (source.kind === 'task') work += contribution;
          else warm += contribution;
          if (source.daytime) daytime += .66 * contribution;
          else if (!night) daytime += 1.1 * contribution;
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
        pixels[pixel] = toByte(daytime / 2.6);
        pixels[pixel + 1] = toByte(warm / 2.1);
        pixels[pixel + 2] = toByte(work / 1.5);
        // Store weighted direction so interpolation fades each light without steering toward an unlit probe.
        const normalization = .5 / Math.max(1.85, strength);
        accents[pixel] = toByte(.5 + incidenceX * normalization);
        accents[pixel + 1] = toByte(.5 + incidenceY * normalization);
        accents[pixel + 2] = toByte(.5 + incidenceZ * normalization);
        accents[pixel + 3] = toByte(strength / 2.6);
      }
    }
    diffuse.needsUpdate = true;
    accent.needsUpdate = true;
  }

  for (const id of columnsByRoom.keys()) updateRoom(id, source => source.daytime === true, false);
  return { diffuse, accent, daylight: texture(daylight, 'Residence directional window apertures'), updateRoom };
}
