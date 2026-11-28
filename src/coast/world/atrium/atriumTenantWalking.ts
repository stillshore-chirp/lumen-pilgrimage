import { Box3, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import { ATRIUM_BOUNDS } from './atriumLayout';
import { ATRIUM_FRONT_TENANTS, atriumFrontTenantPoint } from './atriumFrontPlan';
import {
  ATRIUM_TENANT_COMMON, ATRIUM_TENANT_GLAZING_DEPTH, ATRIUM_TENANTS,
  tenantEntryGeometry, tenantWidth, tenantWorldPoint,
} from './atriumTenantPlan';
import type { TenantBay } from './atriumTenantPlan';

type Point = Readonly<{ x: number; z: number }>;
type Rect = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
type StoreId = TenantBay['id'] | 'front-W' | 'front-E';
type FixtureKind = 'rack' | 'plant' | 'cloth' | 'rigid';
type Registration = Readonly<{ tenantId: StoreId; fixtureId: string; kind: FixtureKind }>;
type Volume = Rect & Readonly<{ bottom: number; top: number }>;
type TopFace = Readonly<{ a: Point; b: Point; c: Point; y: number }>;
type Domain = Rect & Readonly<{ id: StoreId | 'concourse'; ceiling: number }>;
type StoreGeometry = { volumes: Volume[]; tops: TopFace[] };

/** A square body footprint, in metres; apply it after joining connected floors. */
export const ATRIUM_TENANT_BODY_CLEARANCE = .20;
const EPSILON = 1e-6;
const REGISTRATION = 'atriumTenantWalkFixture';

/** Register only children produced by one explicitly identified fixture operation. */
export function registerTenantWalkFixture(
  root: Object3D, firstChild: number, registration: Registration,
): void {
  if (registration.tenantId === 'R2') return;
  for (const object of root.children.slice(firstChild)) object.traverse(child => {
    if (child instanceof Mesh) child.userData[REGISTRATION] = registration;
  });
}

/** Scope rendering to a fixture without inferring its identity from mesh names. */
export function buildTenantWalkFixture(
  root: Object3D, tenantId: StoreId, fixtureId: string, kind: FixtureKind, build: () => void,
): void {
  const firstChild = root.children.length;
  build();
  registerTenantWalkFixture(root, firstChild, { tenantId, fixtureId, kind });
}

function rectangle(a: Point, b: Point): Rect {
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}

function contains(rect: Rect, x: number, z: number, margin = 0): boolean {
  return x >= rect.minX - margin - EPSILON && x <= rect.maxX + margin + EPSILON
    && z >= rect.minZ - margin - EPSILON && z <= rect.maxZ + margin + EPSILON;
}

function overlaps(rect: Rect, x: number, z: number): boolean {
  const margin = ATRIUM_TENANT_BODY_CLEARANCE;
  return x > rect.minX - margin + EPSILON && x < rect.maxX + margin - EPSILON
    && z > rect.minZ - margin + EPSILON && z < rect.maxZ + margin - EPSILON;
}

const STORE_DOMAINS: readonly Domain[] = [
  ...ATRIUM_TENANTS.filter(bay => bay.id !== 'R2').map(bay => ({
    ...rectangle(tenantWorldPoint(bay, 0, 0), tenantWorldPoint(bay, tenantWidth(bay), bay.depth)),
    id: bay.id, ceiling: bay.ceiling,
  })),
  ...ATRIUM_FRONT_TENANTS.map(store => ({
    ...rectangle(atriumFrontTenantPoint(store, 0, 0),
      atriumFrontTenantPoint(store, store.z[1] - store.z[0], store.depth)),
    id: `front-${store.id}` as const, ceiling: store.ceilingY,
  })),
];
const CONNECTOR_DOMAINS: readonly Domain[] = ATRIUM_TENANT_COMMON.rearReveals.map(reveal => ({
  id: reveal.id as TenantBay['id'], minX: reveal.x[0], maxX: reveal.x[1],
  minZ: -reveal.s[1], maxZ: -reveal.floorStartS, ceiling: reveal.head,
}));
const FLOOR_DOMAINS: readonly Domain[] = [
  { ...ATRIUM_BOUNDS, id: 'concourse', ceiling: 17.1 }, ...STORE_DOMAINS, ...CONNECTOR_DOMAINS,
];

const allRoomCorners = ATRIUM_TENANTS.flatMap(bay => [
  tenantWorldPoint(bay, 0, 0), tenantWorldPoint(bay, tenantWidth(bay), bay.depth),
]);
/** Bounding rectangle is a clamp only. The floor union below remains authoritative. */
export const ATRIUM_TENANT_WALK_BOUNDS: Rect = {
  minX: Math.min(ATRIUM_BOUNDS.minX, ...allRoomCorners.map(point => point.x), ...STORE_DOMAINS.map(room => room.minX)),
  maxX: Math.max(ATRIUM_BOUNDS.maxX, ...allRoomCorners.map(point => point.x), ...STORE_DOMAINS.map(room => room.maxX)),
  minZ: Math.min(ATRIUM_BOUNDS.minZ, ...allRoomCorners.map(point => point.z), ...STORE_DOMAINS.map(room => room.minZ)),
  maxZ: ATRIUM_BOUNDS.maxZ,
};

/** Includes the supported rear connectors; excludes the independently built R2 cafe. */
export function inAtriumTenantRoom(x: number, z: number): boolean {
  return [...STORE_DOMAINS, ...CONNECTOR_DOMAINS].some(room => contains(room, x, z));
}

export function atriumTenantRoomCeilingAt(x: number, z: number): number | undefined {
  const matching = [...STORE_DOMAINS, ...CONNECTOR_DOMAINS].filter(room => contains(room, x, z));
  return matching.length ? Math.min(...matching.map(room => room.ceiling)) : undefined;
}

/** The two timber sales floors share the authored finish used by their room geometry. */
export function atriumTenantFloorAt(x: number, z: number): 'wood' | 'stone' | undefined {
  const store = STORE_DOMAINS.find(room => contains(room, x, z));
  return store ? store.id === 'L1' || store.id === 'L5' ? 'wood' : 'stone' : undefined;
}

function planVolumes(): Volume[] {
  const volumes: Volume[] = [];
  const add = (a: Point, b: Point, bottom: number, top: number) => {
    volumes.push({ ...rectangle(a, b), bottom, top });
  };
  for (const bay of ATRIUM_TENANTS) {
    if (bay.id === 'R2') continue;
    const point = (u: number, d: number) => tenantWorldPoint(bay, u, d);
    const width = tenantWidth(bay), [low, high, recess] = bay.entry;
    const entry = tenantEntryGeometry(bay);
    for (const [start, end] of [[0, .18], [width - .18, width]] as const) {
      add(point(start, .075), point(end, bay.depth), 0, bay.ceiling);
    }
    add(point(0, bay.depth), point(width, bay.depth + .20), 0, bay.ceiling);
    add(point(0, 0), point(width, entry.soffitDepth), entry.soffitBottom, entry.soffitBottom + .062);
    for (const segment of bay.frontage) {
      const [start, end] = segment.u;
      if (segment.kind === 'glass') {
        add(point(start, ATRIUM_TENANT_GLAZING_DEPTH - .0275),
          point(end, ATRIUM_TENANT_GLAZING_DEPTH + .0275), 0, bay.elevation.portalHead);
      } else if (segment.kind === 'wall') {
        add(point(start, 0), point(end, recess + .046), 0, bay.elevation.portalHead);
      }
    }
    for (const [edge, direction] of [[low, -1], [high, 1]] as const) {
      const jambWidth = bay.id === 'L1' ? .055 : .042;
      add(point(edge + Math.min(0, direction * jambWidth), 0),
        point(edge + Math.max(0, direction * jambWidth), recess + .04), 0, bay.elevation.portalHead);
    }
    const open = bay.frontage.some(segment => segment.kind === 'open');
    const headDepth = open ? entry.lintelDepth : .084;
    add(point(low, recess - headDepth / 2), point(high, recess + headDepth / 2),
      bay.entryHeight, bay.elevation.portalHead);
    for (const fixture of bay.fixtures) {
      if (fixture.type !== 'wall' && fixture.type !== 'other') continue;
      const [u, d, w, l] = fixture.rect;
      add(point(u, d), point(u + w, d + l), 0, fixture.height);
    }
  }
  for (const store of ATRIUM_FRONT_TENANTS) {
    const point = (u: number, d: number) => atriumFrontTenantPoint(store, u, d);
    const width = store.z[1] - store.z[0], [low, high] = store.entryU;
    for (const [start, end] of [[0, low - .085], [high + .085, width]] as const) {
      add(point(start, 0), point(end, .070), 0, store.ceilingY);
    }
    // Both inner portal assemblies already exist; the wider 170 mm jamb controls the clear.
    for (const edge of [low, high]) {
      add(point(edge - .085, 0), point(edge + .085, store.entryRecess + .08), 0, store.entryHeight);
    }
    add(point(low, store.entryRecess - .07), point(high, store.entryRecess + .08),
      store.entryHeight, store.entryHeight + .16);
    add(point(0, -.035), point(width, .14), 3.0575, store.ceilingY);
    add(point(0, store.depth), point(width, store.depth + .20), 0, store.ceilingY);
  }
  return volumes;
}

function pointInTriangle(x: number, z: number, face: TopFace): boolean {
  const cross = (a: Point, b: Point) => (x - b.x) * (a.z - b.z) - (a.x - b.x) * (z - b.z);
  const a = cross(face.a, face.b), b = cross(face.b, face.c), c = cross(face.c, face.a);
  return !((a < -EPSILON || b < -EPSILON || c < -EPSILON) && (a > EPSILON || b > EPSILON || c > EPSILON));
}

function horizontalFaces(geometry: BufferGeometry, transform: Matrix4): TopFace[] {
  const position = geometry.getAttribute('position'), index = geometry.index;
  const faces: TopFace[] = [], a = new Vector3(), b = new Vector3(), c = new Vector3();
  const count = index?.count ?? position.count;
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(transform);
    b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(transform);
    c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(transform);
    if (Math.abs(a.y - b.y) > EPSILON || Math.abs(a.y - c.y) > EPSILON) continue;
    const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (up <= EPSILON) continue;
    faces.push({ a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, c: { x: c.x, z: c.z }, y: a.y });
  }
  return faces;
}

/** Snapshot before opaque batching. Returned data contains no scene, mesh or geometry references. */
export function createAtriumTenantWalking(root?: Object3D) {
  const started = performance.now(), stores = new Map<StoreId, StoreGeometry>();
  const architecture = planVolumes();
  let meshCount = 0;
  root?.updateWorldMatrix(true, true);
  root?.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const registration = object.userData[REGISTRATION] as Registration | undefined;
    if (!registration || registration.tenantId === 'R2') return;
    let store = stores.get(registration.tenantId);
    if (!store) stores.set(registration.tenantId, store = { volumes: [], tops: [] });
    object.geometry.computeBoundingBox();
    const bounds = object.geometry.boundingBox;
    if (!bounds) return;
    const count = object instanceof InstancedMesh ? object.count : 1;
    for (let instance = 0; instance < count; instance++) {
      const transform = object.matrixWorld.clone();
      if (object instanceof InstancedMesh) {
        const local = new Matrix4();
        object.getMatrixAt(instance, local);
        transform.multiply(local);
      }
      const box = new Box3().copy(bounds).applyMatrix4(transform);
      store.volumes.push({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z,
        bottom: box.min.y, top: box.max.y });
      // Exact horizontal triangles preserve rounded top clear and open shelf gaps.
      if (registration.kind === 'rigid'
        && (object.geometry.type === 'BoxGeometry' || object.geometry.type === 'RoundedBoxGeometry')) {
        store.tops.push(...horizontalFaces(object.geometry, transform));
      }
    }
    meshCount++;
  });
  const metrics = Object.freeze({ meshCount, volumeCount: architecture.length
    + [...stores.values()].reduce((sum, store) => sum + store.volumes.length, 0),
  supportTriangles: [...stores.values()].reduce((sum, store) => sum + store.tops.length, 0),
  constructionMs: performance.now() - started });
  const nearbyStores = (x: number, z: number) => STORE_DOMAINS
    .filter(room => contains(room, x, z, ATRIUM_TENANT_BODY_CLEARANCE))
    .map(room => stores.get(room.id as StoreId)).filter((store): store is StoreGeometry => store !== undefined);
  const volumesAt = (x: number, z: number) => [architecture, ...nearbyStores(x, z).map(store => store.volumes)];

  return {
    metrics,
    supportAt(x: number, z: number, footLimit: number): number {
      let support = 0;
      for (const store of nearbyStores(x, z)) for (const face of store.tops) {
        if (face.y > support && face.y <= footLimit + EPSILON && pointInTriangle(x, z, face)) support = face.y;
      }
      return support;
    },
    ceilingAt(x: number, z: number, foot = 0): number | undefined {
      let ceiling = atriumTenantRoomCeilingAt(x, z) ?? Infinity;
      for (const volumes of volumesAt(x, z)) for (const volume of volumes) {
        if (volume.bottom > foot + EPSILON && overlaps(volume, x, z)) {
          ceiling = Math.min(ceiling, volume.bottom);
        }
      }
      return Number.isFinite(ceiling) ? ceiling : undefined;
    },
    blocksWalking(x: number, z: number, foot: number): boolean {
      const rooms = [...STORE_DOMAINS, ...CONNECTOR_DOMAINS].filter(room => contains(room, x, z));
      if (!contains(ATRIUM_BOUNDS, x, z) && rooms.some(room => foot >= room.ceiling - EPSILON)) return true;
      // Apply clearance to the already-joined floor union, including the real connectors.
      for (const dx of [-ATRIUM_TENANT_BODY_CLEARANCE, 0, ATRIUM_TENANT_BODY_CLEARANCE]) {
        for (const dz of [-ATRIUM_TENANT_BODY_CLEARANCE, 0, ATRIUM_TENANT_BODY_CLEARANCE]) {
          if (!FLOOR_DOMAINS.some(domain => contains(domain, x + dx, z + dz))) return true;
        }
      }
      for (const volumes of volumesAt(x, z)) for (const volume of volumes) {
        if (foot >= volume.bottom - EPSILON && foot < volume.top - EPSILON
          && overlaps(volume, x, z)) return true;
      }
      return false;
    },
  };
}

export type AtriumTenantWalking = ReturnType<typeof createAtriumTenantWalking>;
