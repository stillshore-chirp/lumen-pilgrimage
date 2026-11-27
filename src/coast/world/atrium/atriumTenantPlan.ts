import tenantInteriors from '../../../../docs/atrium/tenant-interiors.json' with { type: 'json' };

export type TenantSide = 'west' | 'east' | 'rear';
export type TenantId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'R1' | 'R2' | 'R3' | 'R4' | 'F1' | 'F2';
export type TenantFrontageKind = 'glass' | 'wall' | 'door' | 'open';
export type TenantSpan = readonly [start: number, end: number];
export type TenantEntry = readonly [start: number, end: number, recess: number];
export type TenantRoutePoint = readonly [u: number, d: number];
export type TenantRect = readonly [u: number, d: number, width: number, depth: number];
export type TenantWorldPoint = Readonly<{ x: number; z: number }>;

/** Shared physical thickness for fixed tenant glazing, in metres. */
export const ATRIUM_TENANT_GLAZING_DEPTH = 0.055;

export type TenantFrontage = Readonly<{
  u: TenantSpan;
  kind: TenantFrontageKind;
  detail: string;
}>;

export type TenantFixture = Readonly<{
  id: string;
  type: string;
  rect: TenantRect;
  height: number;
  label: string;
  spec: string;
}>;

export type TenantMount = Readonly<{
  id: string;
  rect: TenantRect;
  bottom: number;
  top: number;
  label: string;
  spec: string;
}>;

export type TenantLight = Readonly<{
  id: string;
  u: number;
  d: number;
  y: number;
  kind: string;
  aim?: string;
}>;

export type TenantElevationBand = Readonly<{
  low: number;
  high: number;
  kind: string;
  label: string;
}>;

export type TenantElevation = Readonly<{
  portalHead: number;
  bands: readonly TenantElevationBand[];
}>;

export type TenantBay = Readonly<{
  id: TenantId;
  name: string;
  side: TenantSide;
  span: TenantSpan;
  plane?: number;
  depth: number;
  ceiling: number;
  entry: TenantEntry;
  entryHeight: number;
  clearWidth: number;
  photo?: readonly (number | null)[];
  doorType: string;
  route: readonly TenantRoutePoint[];
  fixtures: readonly TenantFixture[];
  mounts?: readonly TenantMount[];
  frontage: readonly TenantFrontage[];
  lights: readonly TenantLight[];
  elevation: TenantElevation;
}>;

export type TenantIsland = Readonly<{
  id: string;
  center: readonly [x: number, s: number];
  size: readonly [width: number, length: number];
  height: number;
  label: string;
  spec: string;
}>;

export type TenantLighting = Readonly<{
  ambient: string;
  accent: string;
  cct: string;
  aim: string;
}>;

export type TenantRearReveal = Readonly<{
  id: string;
  x: readonly [min: number, max: number];
  s: readonly [min: number, max: number];
  floorStartS: number;
  floor: number;
  head: number;
}>;

export type TenantPierRelocation = Readonly<{
  bay: string;
  x: number;
  previousS: number;
  groundS: number;
}>;

export type TenantCommon = Readonly<{
  halfWidth: number;
  nearS: number;
  rearS: number;
  firstFloor: number;
  soffit: number;
  existingPerimeterX: number;
  sofa: readonly [x: number, s: number, width: number, depth: number];
  tree: readonly [x: number, s: number, radius: number];
  lounge: readonly [x: number, s: number, radiusX: number, radiusS: number];
  elevator: readonly [minX: number, minS: number, maxX: number, maxS: number];
  cafe: readonly [x: number, s: number];
  stairMouth: readonly [x: number, s: number];
  stairWidth: number;
  stairCenterline: readonly TenantRoutePoint[];
  rearReveals: readonly TenantRearReveal[];
  pierRelocations: readonly TenantPierRelocation[];
}>;

type TenantPlanData = Readonly<{
  common: TenantCommon;
  bays: readonly TenantBay[];
  islands: readonly TenantIsland[];
  lighting: Readonly<Record<string, TenantLighting>>;
}>;

// The JSON is the single authored source for the browser scene.  The assertion
// is kept at this trusted import boundary so downstream code only sees the
// small readonly design types above.
const PLAN = tenantInteriors as unknown as TenantPlanData;

export const ATRIUM_TENANT_COMMON: TenantCommon = PLAN.common;
export const ATRIUM_TENANTS: readonly TenantBay[] = PLAN.bays;
export const ATRIUM_TENANT_ISLANDS: readonly TenantIsland[] = PLAN.islands;
export const ATRIUM_TENANT_LIGHTING: Readonly<Record<string, TenantLighting>> = PLAN.lighting;

/** Convert local storefront coordinates to the atrium's world X/Z floor grid. */
export function tenantWorldPoint(bay: TenantBay, u: number, d: number): TenantWorldPoint {
  const worldS = bay.side === 'rear'
    ? (bay.plane ?? ATRIUM_TENANT_COMMON.rearS) + d
    : bay.span[0] + u;
  const x = bay.side === 'rear'
    ? bay.span[0] + u
    : (bay.side === 'west' ? -ATRIUM_TENANT_COMMON.halfWidth - d : ATRIUM_TENANT_COMMON.halfWidth + d);
  const z = -worldS;
  return { x, z };
}

/** The usable storefront span in the local u direction, in metres. */
export function tenantWidth(bay: TenantBay): number {
  return Math.abs(bay.span[1] - bay.span[0]);
}
