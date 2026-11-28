import {
  ATRIUM_BOUNDS,
  ATRIUM_LEVELS,
  ATRIUM_LOUNGE,
  ATRIUM_SKYLIGHT,
  ATRIUM_WALK_LEVEL,
  atriumDeckContains,
  atriumStairDistance,
  atriumStairHeight,
  atriumUpperStairHeight,
  inAtriumRug,
} from './atriumLayout';
import {
  ATRIUM_TENANT_COMMON, ATRIUM_TENANT_GLAZING_DEPTH, ATRIUM_TENANTS, tenantWidth, tenantWorldPoint,
} from './atriumTenantPlan';
import type { TenantBay, TenantWorldPoint } from './atriumTenantPlan';
import { ATRIUM_FRONT_GLAZING, ATRIUM_FRONT_GLASS_PLANES } from './atriumFrontPlan';
import { ATRIUM_CAFE_EQUIPMENT_POSITION } from './atriumCafePlan';

type MutablePoint = { x: number; y: number; z: number };
export type AtriumPoint = Readonly<MutablePoint>;
export type AtriumSurface = 'stone' | 'rug' | 'stair' | 'gallery';
type ReflectionSurface = 'floor' | 'gallery-floor' | 'soffit' | 'ceiling' | 'left-wall' | 'right-wall' | 'rear-wall'
  | 'front-glass';
type Axis = 'x' | 'y' | 'z';

type AtriumReflection = {
  surface: ReflectionSurface;
  point: MutablePoint;
  delay: number;
  gain: number;
  cutoff: number;
};

type AtriumSoundPath = {
  directDistance: number;
  gain: number;
  cutoff: number;
  shelter: number;
  lateSend: number;
  reflections: [AtriumReflection, AtriumReflection];
};

type VerticalPanel = Readonly<{
  axis: 'x' | 'z';
  plane: number;
  start: number;
  end: number;
  low: number;
  high: number;
  shelter: number;
}>;

export const ATRIUM_SOUND_SPEED = 343;
export const ATRIUM_REFLECTION_MAX_DELAY = 0.18;
// Design values informed by shopping-centre measurements in the attribution.
export const ATRIUM_ROOM_DECAY = { void: 1.86, sheltered: 0.95 } as const;
const SOFFIT_DEPTH = 0.49;
const COVER_INSETS = [-0.9, -0.45, 0, 0.45, 0.9];
const SKYLIGHT_COS = Math.cos(ATRIUM_SKYLIGHT.yaw);
const SKYLIGHT_SIN = Math.sin(ATRIUM_SKYLIGHT.yaw);
const GLAZING_SHELTER = 0.60;
const WALL_SHELTER = 0.90;

function tenantPanels(bay: TenantBay): VerticalPanel[] {
  const faceAxis = bay.side === 'rear' ? 'z' : 'x';
  const sideAxis = faceAxis === 'z' ? 'x' : 'z';
  const panels: VerticalPanel[] = [];
  const add = (axis: VerticalPanel['axis'], a: TenantWorldPoint, b: TenantWorldPoint,
    low: number, high: number, shelter: number) => {
    const along = axis === 'x' ? 'z' : 'x';
    panels.push({ axis, plane: a[axis], start: Math.min(a[along], b[along]), end: Math.max(a[along], b[along]),
      low, high, shelter });
  };
  const { portalHead } = bay.elevation;
  const top = ATRIUM_TENANT_COMMON.soffit;
  const [doorStart, doorEnd, recess] = bay.entry;
  // Model the finished surfaces as thin panels, using the plan's clear opening and glazing plane.
  for (const { u: [start, end], kind } of bay.frontage) {
    const entrance = kind === 'door' || kind === 'open';
    const d = entrance ? recess : kind === 'glass' ? ATRIUM_TENANT_GLAZING_DEPTH : 0;
    const a = tenantWorldPoint(bay, start, d);
    const b = tenantWorldPoint(bay, end, d);
    add(faceAxis, a, b, entrance ? bay.entryHeight : 0, portalHead,
      kind === 'glass' || kind === 'door' ? GLAZING_SHELTER : WALL_SHELTER);
    add(faceAxis, a, b, portalHead, top, WALL_SHELTER);
  }
  // Short returns define the opening for oblique rays through the recessed entrance.
  for (const [u, end] of [[doorStart, 1], [doorEnd, 0]] as const) {
    const beside = bay.frontage.find(segment => Math.abs(segment.u[end] - u) < 1e-6);
    const glass = beside?.kind === 'glass';
    add(sideAxis, tenantWorldPoint(bay, u, glass ? ATRIUM_TENANT_GLAZING_DEPTH : 0),
      tenantWorldPoint(bay, u, recess), 0, glass ? bay.entryHeight : portalHead,
      glass ? GLAZING_SHELTER : WALL_SHELTER);
  }
  for (const edge of [0, tenantWidth(bay)]) {
    add(sideAxis, tenantWorldPoint(bay, edge, 0), tenantWorldPoint(bay, edge, bay.depth), 0, bay.ceiling, WALL_SHELTER);
  }
  return panels;
}

const TENANT_PANELS = ATRIUM_TENANTS.flatMap(tenantPanels);

export const ATRIUM_AIR_SOURCES: readonly AtriumPoint[] = [
  { x: ATRIUM_BOUNDS.minX + 1.7, y: ATRIUM_LEVELS[0] - 0.62, z: -13.5 },
  { x: ATRIUM_BOUNDS.maxX - 1.8, y: ATRIUM_LEVELS[0] - 0.62, z: -40.9 },
  { x: ATRIUM_BOUNDS.minX + 1.5, y: ATRIUM_LEVELS[2] - 0.62, z: -44.5 },
];

export const ATRIUM_SERVICE_SOURCES: readonly AtriumPoint[] = [
  { x: ATRIUM_CAFE_EQUIPMENT_POSITION[0], y: ATRIUM_CAFE_EQUIPMENT_POSITION[1],
    z: ATRIUM_CAFE_EQUIPMENT_POSITION[2] },
  // The storefront opening is the point where the filtered interior noise enters the gallery.
  { x: ATRIUM_BOUNDS.maxX - 0.03, y: ATRIUM_WALK_LEVEL + 1.15, z: -18.5 },
];

function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

function loungeRadius(x: number, z: number): number {
  return Math.hypot((x - ATRIUM_LOUNGE.x) / ATRIUM_LOUNGE.radiusX, (z - ATRIUM_LOUNGE.z) / ATRIUM_LOUNGE.radiusZ);
}

function inSkylightOpening(x: number, z: number): boolean {
  const dx = x - ATRIUM_SKYLIGHT.x;
  const dz = z - ATRIUM_SKYLIGHT.z;
  const localX = dx * SKYLIGHT_COS - dz * SKYLIGHT_SIN;
  const localZ = dx * SKYLIGHT_SIN + dz * SKYLIGHT_COS;
  const { radiusX, radiusZ, wallInset } = ATRIUM_SKYLIGHT;
  return (localX / (radiusX - wallInset)) ** 2 + (localZ / (radiusZ - wallInset)) ** 2 < 1;
}

/** The local response gains weight near low soffits. The void still returns sound to these open areas. */
export function atriumLocalTailMix(listener: AtriumPoint): number {
  let covered = 0;
  for (let index = 0; index < ATRIUM_LEVELS.length; index += 1) {
    const headroom = ATRIUM_LEVELS[index] - SOFFIT_DEPTH - listener.y;
    if (headroom <= 0 || headroom >= 8.5) continue;
    let cover = 0;
    for (const inset of COVER_INSETS) {
      if (atriumDeckContains(listener.x, listener.z, index, inset)) cover += 1;
    }
    const depthWeight = 1 - smoothstep(2.7, 8.5, headroom);
    covered = Math.max(covered, cover / COVER_INSETS.length * depthWeight * (index === 0 ? 0.88 : 0.68));
  }
  const topIndex = ATRIUM_LEVELS.length - 1;
  if (listener.y >= ATRIUM_LEVELS[topIndex] && atriumDeckContains(listener.x, listener.z, topIndex)
    && !inSkylightOpening(listener.x, listener.z)) {
    covered = Math.max(covered, 0.64 * (1 - smoothstep(2.0, 5.2, ATRIUM_SKYLIGHT.y - listener.y)));
  }
  const lounge = 0.37 * (1 - smoothstep(0.64, 1.45, loungeRadius(listener.x, listener.z)))
    * (1 - smoothstep(1.7, 3.55, listener.y));
  return covered + lounge * (1 - covered);
}

function slabShelter(x: number, y: number, z: number, toX: number, toY: number, toZ: number): number {
  const heightDelta = toY - y;
  if (Math.abs(heightDelta) < 0.001) return 0;
  let shelter = 0;
  for (let index = 0; index < ATRIUM_LEVELS.length; index += 1) {
    const t = (ATRIUM_LEVELS[index] - SOFFIT_DEPTH * 0.5 - y) / heightDelta;
    if (t <= 0.015 || t >= 0.985) continue;
    const crossingX = x + (toX - x) * t;
    const crossingZ = z + (toZ - z) * t;
    if (atriumDeckContains(crossingX, crossingZ, index, 0.45)) return 0.78;
    if (atriumDeckContains(crossingX, crossingZ, index)) shelter = 0.56;
    else if (atriumDeckContains(crossingX, crossingZ, index, -0.35)) shelter = Math.max(shelter, 0.24);
  }
  return shelter;
}

function propagationShelter(x: number, y: number, z: number, toX: number, toY: number, toZ: number): number {
  let shelter = slabShelter(x, y, z, toX, toY, toZ);
  const { minX, maxX, minZ } = ATRIUM_BOUNDS;
  if (x >= minX && x <= maxX && z >= minZ && toX >= minX && toX <= maxX && toZ >= minZ) return shelter;
  const dx = toX - x;
  const dy = toY - y;
  const dz = toZ - z;
  for (const panel of TENANT_PANELS) {
    if (panel.shelter <= shelter) continue;
    const onX = panel.axis === 'x';
    const t = onX ? (panel.plane - x) / dx : (panel.plane - z) / dz;
    if (!(t > 0 && t < 1)) continue;
    const height = y + dy * t;
    const along = onX ? z + dz * t : x + dx * t;
    if (height < panel.low || height > panel.high || along < panel.start || along > panel.end) continue;
    shelter = panel.shelter;
    if (shelter === WALL_SHELTER) return shelter;
  }
  return shelter;
}

function isFrontageOpening(surface: ReflectionSurface, x: number, y: number, z: number): boolean {
  if (y >= ATRIUM_TENANT_COMMON.soffit) return false;
  if (surface === 'rear-wall') {
    for (const reveal of ATRIUM_TENANT_COMMON.rearReveals) {
      if (x > reveal.x[0] && x < reveal.x[1] && y < reveal.head) return true;
    }
    return false;
  }
  if (surface !== 'left-wall' && surface !== 'right-wall') return false;
  const side = surface === 'left-wall' ? 'west' : 'east';
  for (const bay of ATRIUM_TENANTS) {
    const u = -z - bay.span[0];
    if (bay.side === side && u > bay.entry[0] && u < bay.entry[1] && y < bay.entryHeight) return true;
  }
  return false;
}

function directCutoff(distanceMetres: number, shelter: number): number {
  const air = 17_500 / (1 + distanceMetres / 24) ** 0.74;
  return Math.max(700, air * Math.exp(-2.75 * shelter));
}

function createReflection(): AtriumReflection {
  return { surface: 'floor', point: { x: 0, y: 0, z: 0 }, delay: 0, gain: 0, cutoff: 0 };
}

export function createAtriumSoundPath(): AtriumSoundPath {
  return { directDistance: 0, gain: 0, cutoff: 0, shelter: 0, lateSend: 0,
    reflections: [createReflection(), createReflection()] };
}

/** Nominal fixed-window assemblies include their flush reflecting metal frames. */
function inFrontGlass(x: number, y: number, z: number): boolean {
  for (const pane of ATRIUM_FRONT_GLASS_PLANES) {
    if (z === pane.faceZ && x >= pane.minX && x <= pane.maxX && y >= pane.minY && y <= pane.maxY) return true;
  }
  return false;
}

function considerReflection(
  path: AtriumSoundPath,
  listener: AtriumPoint,
  source: AtriumPoint,
  surface: ReflectionSurface,
  axis: Axis,
  plane: number,
  coefficient: number,
  deck?: number,
): void {
  if ((listener[axis] - plane) * (source[axis] - plane) <= 0) return;
  const offset = 2 * (plane - source[axis]);
  const t = (plane - listener[axis]) / (source[axis] + offset - listener[axis]);
  const x = axis === 'x' ? plane : listener.x + (source.x - listener.x) * t;
  const y = axis === 'y' ? plane : listener.y + (source.y - listener.y) * t;
  const z = axis === 'z' ? plane : listener.z + (source.z - listener.z) * t;
  const { minX, maxX, minZ, maxZ } = ATRIUM_BOUNDS;
  const frontGlass = surface === 'front-glass';
  if (frontGlass && (listener.z >= plane || source.z >= plane || !inFrontGlass(x, y, z))) return;
  // Only the finite finished glazing face extends beyond the unchanged walkable room bound.
  const reflectionMaxZ = frontGlass ? plane : maxZ;
  if (x < minX || x > maxX || z < minZ || z > reflectionMaxZ || y < 0 || y > ATRIUM_SKYLIGHT.y) return;
  if (deck !== undefined && !atriumDeckContains(x, z, deck, -0.25)) return;
  if (surface === 'ceiling' && inSkylightOpening(x, z)) return;
  if (isFrontageOpening(surface, x, y, z)) return;
  const distance = Math.hypot(source.x - listener.x + (axis === 'x' ? offset : 0),
    source.y - listener.y + (axis === 'y' ? offset : 0), source.z - listener.z + (axis === 'z' ? offset : 0));
  const excess = Math.max(0, distance - path.directDistance);
  const delay = excess / ATRIUM_SOUND_SPEED;
  if (delay > ATRIUM_REFLECTION_MAX_DELAY) return;
  const rug = surface === 'floor' ? 1 - smoothstep(0.83, 1.07, loungeRadius(x, z)) : 0;
  const edgeWeight = deck !== undefined && !atriumDeckContains(x, z, deck, 0.15) ? 0.56 : 1;
  const reflectedShelter = Math.max(propagationShelter(listener.x, listener.y, listener.z, x, y, z),
    propagationShelter(x, y, z, source.x, source.y, source.z));
  const relative = coefficient * (1 - rug * 0.82) * edgeWeight * (1 - reflectedShelter * 0.76);
  const gain = relative * (2.2 / (2.2 + distance)) ** 0.74 * Math.exp(-excess * 0.046);
  const arrivals = path.reflections;
  const reflection = arrivals[1];
  if (gain <= reflection.gain) return;
  reflection.surface = surface;
  reflection.point.x = x;
  reflection.point.y = y;
  reflection.point.z = z;
  reflection.delay = delay;
  reflection.gain = gain;
  reflection.cutoff = Math.min(directCutoff(distance, reflectedShelter), 11_500 * (1 - rug * 0.74));
  if (gain > arrivals[0].gain) {
    arrivals[1] = arrivals[0];
    arrivals[0] = reflection;
  }
}

/** Fill two strongest finite image paths without allocating during propagation. */
export function atriumSoundPath(
  listener: AtriumPoint, source: AtriumPoint, path = createAtriumSoundPath(),
): AtriumSoundPath {
  const directDistance = Math.hypot(listener.x - source.x, listener.y - source.y, listener.z - source.z);
  const shelter = propagationShelter(listener.x, listener.y, listener.z, source.x, source.y, source.z);
  const distanceGain = (2.2 / (2.2 + directDistance)) ** 0.74;
  path.directDistance = directDistance;
  path.shelter = shelter;
  path.gain = distanceGain * (1 - shelter * 0.68);
  path.cutoff = directCutoff(directDistance, shelter);
  path.lateSend = distanceGain * (0.24 + 0.31 * smoothstep(2, 22, directDistance) + shelter * 0.24);
  path.reflections[0].gain = 0;
  path.reflections[1].gain = 0;
  considerReflection(path, listener, source, 'floor', 'y', 0, 0.40);
  for (let index = 0; index < ATRIUM_LEVELS.length; index += 1) {
    const level = ATRIUM_LEVELS[index];
    if (listener.y > level && source.y > level) {
      considerReflection(path, listener, source, 'gallery-floor', 'y', level, 0.38, index);
    } else if (listener.y < level - SOFFIT_DEPTH && source.y < level - SOFFIT_DEPTH) {
      considerReflection(path, listener, source, 'soffit', 'y', level - SOFFIT_DEPTH, 0.35, index);
    }
  }
  considerReflection(path, listener, source, 'ceiling', 'y', ATRIUM_SKYLIGHT.y, 0.22);
  considerReflection(path, listener, source, 'left-wall', 'x', ATRIUM_BOUNDS.minX, 0.33);
  considerReflection(path, listener, source, 'right-wall', 'x', ATRIUM_BOUNDS.maxX, 0.33);
  considerReflection(path, listener, source, 'rear-wall', 'z', ATRIUM_BOUNDS.minZ, 0.27);
  // All front window assemblies are coplanar; test their union once to avoid duplicate arrivals.
  considerReflection(path, listener, source, 'front-glass', 'z', ATRIUM_FRONT_GLAZING.faceZ, 0.30);
  return path;
}

export function atriumSurfaceAt(x: number, z: number, floorY = 0): AtriumSurface {
  const stair = atriumStairDistance(x, z);
  if ((stair !== undefined && Math.abs(atriumStairHeight(stair) - floorY) < 0.27)
    || Math.abs(atriumUpperStairHeight(x, z) - floorY) < 0.27) return 'stair';
  if (inAtriumRug(x, z) && floorY < 0.27) return 'rug';
  if (floorY >= ATRIUM_LEVELS[0] - 0.27) return 'gallery';
  return 'stone';
}
