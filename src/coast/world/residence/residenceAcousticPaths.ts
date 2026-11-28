import { residenceDoorLeafPose, type ResidenceDoorLeafPose } from './residenceDoors';
import {
  acousticWallPrism as wallPrism, acousticSegmentBox as intersect, pointInAcousticOpening as insideOpening,
} from './residenceAcousticGeometry';
import { RESIDENCE_DOORWAYS, type ResidenceOpening, type ResidenceWall } from './residencePlan';
import {
  acousticPortals, acousticRoomAt, acousticWalls, portalPoint,
  type AcousticDoorState, type AcousticPoint, type ResidenceAcousticPortal,
} from './residenceAcousticScene';

type Point = AcousticPoint & { readonly feature?: string };
type Portal = ResidenceAcousticPortal;
type Power = [number, number, number];
type Leaf = { id: string; pose: ResidenceDoorLeafPose; bottom: number; top: number; kind: Portal['kind'];
  clear: { from: number; to: number }; openFraction: number };
type Crossing = { kind: 'opaque' | 'leaf' | ResidenceOpening['kind']; opening?: ResidenceOpening; leafId?: string; id?: string };
type Visibility = { visible: boolean; blocking?: ResidenceWall; blockingLeaf?: Leaf };

export interface ResidenceAcousticPath {
  readonly kind: 'direct-or-wall' | 'open-chain' | 'panel-or-mixed-chain' | 'leaf-detour' | 'external-chain';
  readonly ids: readonly string[];
  readonly points: readonly Point[];
  readonly length: number;
  readonly delay: number;
  readonly first: Point;
  readonly arrival: Point;
  readonly lowGain: number;
  readonly highGain: number;
  readonly diffuseGain: number;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const mix = (a: number, b: number, q: number): number => a + (b - a) * q;
const at = (a: Point, b: Point, q: number): Point => ({ x: mix(a.x, b.x, q), y: mix(a.y, b.y, q), z: mix(a.z, b.z, q) });
const fraction = (portal: Portal, state: AcousticDoorState): number =>
  portal.kind === 'passage' ? 1 : clamp(state[portal.id] ?? 1, 0, 1);
const openPower: Power = [.95 ** 2, .91 ** 2, .78 ** 2];

function panelPower(kind: Portal['kind']): Power {
  const closed = kind === 'balcony-door' ? [.055, .009, .043]
    : kind === 'fusuma' ? [.24, .057, .19] : [.135, .022, .105];
  return closed.map(gain => gain ** 2) as Power;
}

function bands(portal: Portal, a: number): Power {
  if (portal.kind === 'passage') return [1, 1, 1];
  const closed = panelPower(portal.kind);
  // Retain the existing scene's two-band area law; these are not measured transmission losses.
  return closed.map((power, index) => {
    const blend = index === 1 ? a ** 1.55 : a;
    return blend * openPower[index] + (1 - blend) * power;
  }) as Power;
}

const wallPrisms = acousticWalls.map((wall, index) => ({ wall, box: wallPrism(wall), id: `wall:${index}` }));

export function residenceAcousticPathResponse(points: readonly Point[], power: Power,
  kind: ResidenceAcousticPath['kind'], ids: readonly string[]): ResidenceAcousticPath {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1], points[index]);
  const spread = 1 / Math.max(1, length);
  const arrival = points.slice(0, -1).reverse().find(point => distance(point, points.at(-1)!) > .025) ?? points[0];
  return { kind, ids,
    points, length, delay: length / 343,
    arrival, first: points[1] ?? points[0], lowGain: Math.sqrt(power[0]) * spread,
    highGain: Math.sqrt(power[1]) * spread, diffuseGain: Math.sqrt(power[2]) * spread };
}

function response(points: readonly Point[], power: Power, kind: ResidenceAcousticPath['kind'],
  chain: readonly Portal[]): ResidenceAcousticPath {
  return residenceAcousticPathResponse(points, power, kind,
    [...chain.map(portal => portal.id), ...points.flatMap(point => point.feature ? [point.feature] : [])]);
}

export function createResidenceAcousticPathModel() {
  const leafSnapshots = new Map<string, readonly Leaf[]>();
  let lastState: AcousticDoorState | undefined;
  let lastLeaves: readonly Leaf[] = [];
  const chainCache = new Map<string, { found: readonly (readonly Portal[])[]; expanded: number; capped: boolean }>();

  function leaves(state: AcousticDoorState): readonly Leaf[] {
    if (state === lastState) return lastLeaves;
    const movable = acousticPortals.filter(portal => portal.opening && portal.kind !== 'passage');
    const key = movable.map(portal => fraction(portal, state)).join(':');
    const cached = leafSnapshots.get(key);
    if (cached) { lastState = state; lastLeaves = cached; return cached; }
    const result: Leaf[] = [];
    for (const portal of movable) {
      const q = fraction(portal, state);
      let pose: ResidenceDoorLeafPose;
      let full: ResidenceDoorLeafPose;
      if (portal.kind === 'balcony-door') {
        pose = { east: portal.fixed - .035, north: portal.from + (portal.to - portal.from) * q,
          angle: Math.PI / 2, width: portal.to - portal.from, halfDepth: .016 };
        full = { ...pose, north: portal.to };
      } else {
        const doorway = RESIDENCE_DOORWAYS.find(door => door.id === portal.id);
        if (!doorway) continue;
        pose = residenceDoorLeafPose(doorway, q);
        full = q === 1 ? pose : residenceDoorLeafPose(doorway, 1);
      }
      const clear = (value: ResidenceDoorLeafPose) => {
        const cos = Math.cos(value.angle);
        const sin = Math.sin(value.angle);
        const projection: number[] = [];
        for (const along of [0, value.width]) for (const across of [-value.halfDepth, value.halfDepth]) {
          projection.push(portal.axis === 'e' ? value.east + along * cos - across * sin
            : value.north + along * sin + across * cos);
        }
        const from = portal.from + .028;
        const to = portal.to - .028;
        const opensFrom = portal.kind === 'balcony-door'
          || (portal.opening?.kind === 'door' && portal.opening.swing.hinge === 'to');
        return opensFrom ? { from, to: Math.min(to, Math.min(...projection) - .0005) }
          : { from: Math.max(from, Math.max(...projection) + .0005), to };
      };
      const current = clear(pose);
      const fullClear = clear(full);
      const openFraction = clamp((current.to - current.from) / Math.max(.001, fullClear.to - fullClear.from), 0, 1);
      result.push({ id: portal.id, pose, bottom: portal.kind === 'balcony-door' ? .004 : .009,
        top: portal.top - .015, kind: portal.kind, clear: current, openFraction });
    }
    leafSnapshots.set(key, result);
    if (leafSnapshots.size > 8) leafSnapshots.delete(leafSnapshots.keys().next().value!);
    lastState = state;
    lastLeaves = result;
    return result;
  }

  const area = (portal: Portal, state: AcousticDoorState): number => portal.kind === 'passage' ? 1
    : leaves(state).find(leaf => leaf.id === portal.id)?.openFraction ?? 0;

  function leafHit(a: Point, b: Point, leaf: Leaf): boolean {
    const { east, north, angle, width, halfDepth } = leaf.pose;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const local = (point: Point): Point => {
      const e = point.x - east;
      const n = -point.z - north;
      return { x: e * cos + n * sin, y: point.y, z: n * cos - e * sin };
    };
    return Boolean(intersect(local(a), local(b), [[0, width], [leaf.bottom, leaf.top], [-halfDepth, halfDepth]]));
  }

  function finiteSegment(a: Point, b: Point, state: AcousticDoorState, transmit = false) {
    let energy: Power = [1, 1, 1];
    const crossed: Crossing[] = [];
    const countedLeaves = transmit ? new Set<string>() : undefined;
    const physicalLeaves = transmit ? leaves(state) : [];
    for (const { wall, box, id } of wallPrisms) {
      const interval = intersect(a, b, box);
      if (!interval) continue;
      const entry = at(a, b, interval[0]);
      const exit = at(a, b, interval[1]);
      const opening = wall.openings?.find(candidate => insideOpening(wall, candidate, entry) && insideOpening(wall, candidate, exit));
      if (!opening) {
        if (!transmit) return { visible: false, crossed, energy, blocking: wall };
        const opaque = wall.kind === 'interior' ? [.095, .012, .075] : [.032, .004, .024];
        energy = energy.map((value, index) => value * opaque[index] ** 2) as Power;
        crossed.push({ kind: 'opaque', id });
        continue;
      }
      if (!transmit) {
        if (opening.kind === 'window') return { visible: false, crossed, energy };
        continue;
      }
      const portal = acousticPortals.find(candidate => candidate.wall === wall && candidate.opening === opening);
      const leaf = portal && physicalLeaves.find(candidate => candidate.id === portal.id && leafHit(a, b, candidate));
      const power: Power = opening.kind === 'window' ? [.050 ** 2, .009 ** 2, .040 ** 2]
        : leaf ? panelPower(leaf.kind) : portal ? bands(portal, area(portal, state)) : [1, 1, 1];
      energy = energy.map((value, index) => value * power[index]) as Power;
      crossed.push({ kind: opening.kind, opening, id: portal?.id ?? `${id}:${opening.kind}:${opening.from}` });
      if (leaf) {
        countedLeaves!.add(leaf.id);
        crossed.push({ kind: 'leaf', leafId: leaf.id, id: `leaf:${leaf.id}` });
      }
    }
    // An open leaf can intercept a different ray inside one room. Its material
    // remains opaque even though the wall aperture is completely uncovered.
    if (transmit) for (const leaf of physicalLeaves) {
      if (countedLeaves!.has(leaf.id) || !leafHit(a, b, leaf)) continue;
      const power = panelPower(leaf.kind);
      energy = energy.map((value, index) => value * power[index]) as Power;
      crossed.push({ kind: 'leaf', leafId: leaf.id, id: `leaf:${leaf.id}` });
    }
    return { visible: true, crossed, energy };
  }

  function geometrySegment(a: Point, b: Point, state: AcousticDoorState, ignoredLeaves: ReadonlySet<string>): Visibility {
    const wall = finiteSegment(a, b, state);
    if (!wall.visible) return wall;
    for (const leaf of leaves(state)) {
      if (ignoredLeaves.has(leaf.id)) continue;
      if (leafHit(a, b, leaf)) return { visible: false, blockingLeaf: leaf };
    }
    return wall;
  }

  function topology(a: string, b: string) {
    const key = `${a}:${b}`;
    const cached = chainCache.get(key);
    if (cached) return cached;
    const queue = [{ room: a, visited: [a], chain: [] as Portal[] }];
    const found: Portal[][] = [];
    let expanded = 0;
    while (queue.length && expanded < 64 && found.length < 8) {
      const node = queue.shift()!;
      expanded += 1;
      if (node.room === b) { found.push(node.chain); continue; }
      for (const portal of acousticPortals) {
        if (!portal.rooms.includes(node.room)) continue;
        const next = portal.rooms.find(room => room !== node.room)!;
        if (node.visited.includes(next)) continue;
        queue.push({ room: next, visited: [...node.visited, next], chain: [...node.chain, portal] });
      }
    }
    const result = { found, expanded, capped: expanded >= 64 };
    chainCache.set(key, result);
    return result;
  }

  function optimize(chain: readonly Portal[], source: Point, listener: Point, state: AcousticDoorState, openOnly: boolean) {
    const bounds = chain.map(portal => {
      let from = portal.from;
      let to = portal.to;
      if (portal.opening && portal.kind !== 'passage') { from += .028; to -= .028; }
      if (openOnly && portal.kind !== 'passage') {
        const leaf = leaves(state).find(candidate => candidate.id === portal.id);
        if (!leaf) return;
        from = leaf.clear.from;
        to = leaf.clear.to;
        if (to - from < .0002) return;
      }
      const pad = Math.min(portal.wall ? .015 : .09, (to - from) * .10);
      return { from: from + pad, to: to - pad, bottom: portal.bottom + .025, top: portal.top - .025 };
    });
    if (bounds.some(bound => !bound)) return;
    const points = chain.map((portal, index) => {
      const bound = bounds[index]!;
      return portalPoint(portal, (bound.from + bound.to) / 2, clamp((source.y + listener.y) / 2, bound.bottom, bound.top));
    });
    for (let pass = 0; pass < 5; pass += 1) for (let index = 0; index < chain.length; index += 1) {
      const portal = chain[index];
      const bound = bounds[index]!;
      const previous = points[index - 1] ?? source;
      const next = points[index + 1] ?? listener;
      let along = portal.axis === 'e' ? points[index].x : -points[index].z;
      let height = points[index].y;
      for (const vertical of [false, true]) {
        let low = vertical ? bound.bottom : bound.from;
        let high = vertical ? bound.top : bound.to;
        const cost = (value: number) => {
          const point = portalPoint(portal, vertical ? along : value, vertical ? value : height);
          return distance(previous, point) + distance(point, next);
        };
        for (let step = 0; step < 12; step += 1) {
          const a = low + (high - low) / 3;
          const b = high - (high - low) / 3;
          if (cost(a) < cost(b)) high = b; else low = a;
        }
        if (vertical) height = (low + high) / 2; else along = (low + high) / 2;
      }
      points[index] = portalPoint(portal, along, height);
    }
    // Both finite wall faces must pass through the aperture, including at oblique incidence.
    const expanded: Point[] = [source];
    let room = acousticRoomAt(source);
    for (let index = 0; index < chain.length; index += 1) {
      const portal = chain[index];
      const center = points[index];
      if (portal.wall) {
        const reach = portal.wall.thickness / 2 + .001;
        const key = portal.axis === 'e' ? 'z' : 'x';
        const positive = { ...center, [key]: center[key] + (portal.axis === 'e' ? -reach : reach) };
        const offset = (acousticRoomAt(positive) === room ? 1 : -1) * reach;
        expanded.push({ ...center, [key]: center[key] + (portal.axis === 'e' ? -offset : offset) },
          { ...center, [key]: center[key] + (portal.axis === 'e' ? offset : -offset) });
      } else expanded.push(center);
      room = portal.rooms.find(id => id !== room);
    }
    return [...expanded, listener];
  }

  function finitePolyline(points: readonly Point[], state: AcousticDoorState, ignoredLeaves: ReadonlySet<string>) {
    const result = [points[0]];
    for (const b of points.slice(1)) {
      const a = result.at(-1)!;
      const blocked = geometrySegment(a, b, state, ignoredLeaves);
      if (blocked.visible) { result.push(b); continue; }
      const wall = blocked.blocking;
      const leaf = blocked.blockingLeaf;
      if (!wall && !leaf) return;
      const margin = .001;
      const around: Point[] = [];
      if (wall) for (const along of [wall.from - margin, wall.to + margin]) {
        for (const across of [wall.fixed - wall.thickness / 2 - margin, wall.fixed + wall.thickness / 2 + margin]) {
          const feature = `wall:${acousticWalls.indexOf(wall)}:${along < wall.from ? 'from' : 'to'}:${across < wall.fixed ? 'near' : 'far'}`;
          around.push(wall.axis === 'e' ? { x: along, y: (a.y + b.y) / 2, z: -across, feature }
            : { x: across, y: (a.y + b.y) / 2, z: -along, feature });
        }
      }
      if (leaf) {
        const pose = leaf.pose;
        const cos = Math.cos(pose.angle);
        const sin = Math.sin(pose.angle);
        for (const along of [-margin, pose.width + margin]) for (const across of [-pose.halfDepth - margin, pose.halfDepth + margin]) {
          around.push({ x: pose.east + along * cos - across * sin, y: (a.y + b.y) / 2,
            z: -(pose.north + along * sin + across * cos),
            feature: `leaf:${leaf.id}:${along < 0 ? 'hinge' : 'tip'}:${across < 0 ? 'near' : 'far'}` });
        }
      }
      const visible = (from: Point, to: Point) => geometrySegment(from, to, state, ignoredLeaves).visible;
      const candidates: Point[][] = [];
      for (const first of around) {
        if (!acousticRoomAt(first) || !visible(a, first)) continue;
        if (visible(first, b)) candidates.push([first]);
        for (const second of around) {
          if (first === second || !acousticRoomAt(second)) continue;
          if (visible(first, second) && visible(second, b)) candidates.push([first, second]);
        }
      }
      const length = (points: readonly Point[]) => {
        let value = distance(a, points[0]) + distance(points.at(-1)!, b);
        for (let index = 1; index < points.length; index += 1) value += distance(points[index - 1], points[index]);
        return value;
      };
      candidates.sort((p, q) => length(p) - length(q));
      if (!candidates.length) return;
      result.push(...candidates[0], b);
    }
    return result;
  }

  return {
    solve(source: Point, listener: Point, state: AcousticDoorState) {
      const start = acousticRoomAt(source);
      const end = acousticRoomAt(listener);
      if (!start || !end) return { paths: [] as ResidenceAcousticPath[], invalidRoom: true, capped: false, expanded: 0 };
      const graph = topology(start, end);
      const direct = finiteSegment(source, listener, state, true);
      const paths: ResidenceAcousticPath[] = [{ ...response([source, listener], direct.energy, 'direct-or-wall', []),
        ids: direct.crossed.flatMap(crossing => crossing.id ? [crossing.id] : []) }];
      const opaque = direct.crossed.some(crossing => crossing.kind === 'opaque');
      const secondaryLeaves = direct.crossed.filter(crossing => crossing.kind === 'leaf');
      if (start === end && secondaryLeaves.length && !opaque) {
        const points = finitePolyline([source, listener], state, new Set());
        if (points) {
          const detour = response(points, openPower, 'leaf-detour', []);
          paths.push({ ...detour, ids: [...secondaryLeaves.map(crossing => `leaf:${crossing.leafId}`), ...detour.ids] });
        }
      }
      for (const chain of graph.found) {
        if (!chain.length) continue;
        if (!opaque && !secondaryLeaves.length
          && chain.every(portal => !portal.wall || direct.crossed.some(crossing => crossing.opening === portal.opening))) continue;
        const total: Power = [1, 1, 1];
        const open: Power = [1, 1, 1];
        for (const portal of chain) {
          const power = bands(portal, area(portal, state));
          const uncovered = area(portal, state);
          for (let index = 0; index < 3; index += 1) {
            total[index] *= power[index];
            open[index] *= portal.kind === 'passage' ? 1 : (index === 1 ? uncovered ** 1.55 : uncovered) * openPower[index];
          }
        }
        for (const openOnly of [true, false]) {
          const power = openOnly ? open : total.map((value, index) => Math.max(0, value - open[index])) as Power;
          if (Math.max(...power) < 1e-12) continue;
          const raw = optimize(chain, source, listener, state, openOnly);
          const points = raw && finitePolyline(raw, state, openOnly ? new Set() : new Set(chain.map(portal => portal.id)));
          if (!points) continue;
          const path = response(points, power, openOnly ? 'open-chain' : 'panel-or-mixed-chain', chain);
          if (path.length - distance(source, listener) < .035 && !opaque && (!secondaryLeaves.length || !openOnly)) continue;
          paths.push(path);
        }
      }
      paths.sort((a, b) => b.lowGain - a.lowGain);
      return { paths: paths.slice(0, 3), invalidRoom: false, capped: graph.capped, expanded: graph.expanded };
    },
    get cacheSizes() { return { topology: chainCache.size, leafStates: leafSnapshots.size }; },
    dispose() { leafSnapshots.clear(); chainCache.clear(); lastState = undefined; lastLeaves = []; },
  };
}
