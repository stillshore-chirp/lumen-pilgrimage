import { RESIDENCE_ROOMS, RESIDENCE_WALLS, type ResidenceOpening, type ResidenceWall } from './residencePlan';

export type AcousticPoint = { readonly x: number; readonly y: number; readonly z: number };
export type AcousticDoorState = Readonly<Record<string, number>>;
type DoorOpenness = (wall: ResidenceWall, opening: ResidenceOpening) => number;
export interface ResidenceAcousticPortal {
  readonly id: string;
  readonly axis: 'e' | 'n';
  readonly fixed: number;
  readonly from: number;
  readonly to: number;
  readonly bottom: number;
  readonly top: number;
  readonly rooms: readonly [string, string];
  readonly kind: ResidenceOpening['kind'];
  readonly wall?: ResidenceWall;
  readonly opening?: ResidenceOpening;
}

export const acousticRooms = RESIDENCE_ROOMS.filter(room => room.id !== 'PS');
export const acousticWalls = RESIDENCE_WALLS.filter(wall => wall.kind !== 'guard');

export function acousticRoomAt(point: AcousticPoint): string | undefined {
  return RESIDENCE_ROOMS.find(room => room.rectangles.some(([west, south, east, north]) =>
    point.x >= west && point.x < east && -point.z >= south && -point.z < north))?.id;
}

export function portalPoint(portal: Pick<ResidenceAcousticPortal, 'axis' | 'fixed'>,
  along: number, height: number): AcousticPoint {
  return portal.axis === 'e' ? { x: along, y: height, z: -portal.fixed } : { x: portal.fixed, y: height, z: -along };
}

function buildPortals(): readonly ResidenceAcousticPortal[] {
  const portals: ResidenceAcousticPortal[] = [];
  const keys = new Set<string>();
  function add(portal: ResidenceAcousticPortal): void {
    if (portal.rooms[0] === portal.rooms[1] || portal.to <= portal.from) return;
    const key = [portal.axis, portal.fixed, portal.from, portal.to, [...portal.rooms].sort().join(':')].join(':');
    if (keys.has(key)) return;
    keys.add(key);
    portals.push(portal);
  }
  for (const wall of acousticWalls) {
    for (const opening of wall.openings ?? []) {
      if (opening.kind === 'window') continue;
      const middle = (opening.from + opening.to) / 2;
      const across = wall.thickness / 2 + .08;
      const side = (offset: number) => acousticRoomAt(wall.axis === 'n'
        ? { x: wall.fixed + offset, y: 1.65, z: -middle }
        : { x: middle, y: 1.65, z: -(wall.fixed + offset) });
      const a = side(-across);
      const b = side(across);
      if (!a || !b) continue;
      const id = 'id' in opening ? opening.id : `${opening.kind}-${wall.axis}-${wall.fixed}-${opening.from}-${opening.to}`;
      add({ id, axis: wall.axis, fixed: wall.fixed, ...opening, rooms: [a, b], wall, opening });
    }
  }
  // Unwalled adjacent room rectangles are portals too. A new Plan partition removes
  // the corresponding edge without maintaining a separate acoustic floor plan.
  for (let index = 0; index < acousticRooms.length; index += 1) {
    const a = acousticRooms[index];
    for (const b of acousticRooms.slice(index + 1)) {
      for (const ar of a.rectangles) for (const br of b.rectangles) {
        for (const axis of ['e', 'n'] as const) {
          const along = axis === 'e' ? 0 : 1;
          const across = 1 - along;
          let fixed: number;
          if (ar[across + 2] === br[across]) fixed = br[across];
          else if (br[across + 2] === ar[across]) fixed = ar[across];
          else continue;
          const from = Math.max(ar[along], br[along]);
          const to = Math.min(ar[along + 2], br[along + 2]);
          if (to - from < .01) continue;
          const runs = acousticWalls.filter(wall => wall.axis === axis && wall.fixed === fixed
            && wall.to > from && wall.from < to).sort((x, y) => x.from - y.from);
          const gap = (start: number, end: number) => add({
            id: `open-${a.id}-${b.id}`, axis, fixed, from: start, to: end, bottom: 0,
            top: Math.min(a.ceiling ?? 3.19, b.ceiling ?? 3.19), rooms: [a.id, b.id], kind: 'passage',
          });
          let cursor = from;
          for (const wall of runs) {
            if (wall.from > cursor) gap(cursor, Math.min(to, wall.from));
            cursor = Math.max(cursor, wall.to);
          }
          if (cursor < to) gap(cursor, to);
        }
      }
    }
  }
  return portals;
}

export const acousticPortals = buildPortals();

export function acousticDoorSnapshot(openness?: DoorOpenness): AcousticDoorState {
  return Object.fromEntries(acousticPortals.filter(portal => portal.opening && portal.kind !== 'passage')
    .map(portal => {
      const amount = openness?.(portal.wall!, portal.opening!) ?? (portal.kind === 'balcony-door' ? 0 : 1);
      return [portal.id, Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0];
    }));
}
