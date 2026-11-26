/** Metres. The seated viewer looks along +Z; W/-X is seated right, E/+X is seated left. */
export type AtriumFrontSpan = readonly [min: number, max: number];
export type AtriumFrontPoint = Readonly<{ x: number; z: number }>;
export type AtriumFrontRect = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
export type AtriumFrontLocalFixture = Readonly<{
  u: number; d: number; width: number; depth: number; height: number;
}>;

export const ATRIUM_FRONT_GLAZING = {
  faceZ: 3.040,
  thickness: .014,
  centerZ: 3.047,
  backZ: 3.054,
  frameDepth: .070,
  frameBackZ: 3.110,
  insideZ: 3.180,
  frameWidth: .045,
  gardenX: [-4.48, 4.48] as AtriumFrontSpan,
  gardenY: [.12, 3.92] as AtriumFrontSpan,
  upperBays: [[-8.85, -4.86], [-4.58, 4.58], [4.86, 8.85]] as readonly AtriumFrontSpan[],
} as const;

export const ATRIUM_FRONT_STRUCTURE = {
  floorPlateDepth: .440,
  ceilingFinishDepth: .025,
  fasciaDepth: .490,
  wallDepth: .200,
  sideWallDepth: .180,
  supportX: [-8.99, -4.72, 4.72, 8.99] as readonly number[],
  supportWidth: .280,
  supportDepth: .450,
  frontSupportZ: 3.180,
  rearSupportZ: 7.780,
  topY: 17.150,
} as const;

export const ATRIUM_FRONT_GARDEN = {
  bounds: { minX: -4.72, maxX: 4.72, minZ: 3.180, maxZ: 13.270 },
  floorY: 0,
  ceilingY: 4.085,
  ceilingDepth: .250,
  backWallZ: 13.270,
  wallDepth: .200,
  serviceDoor: { x: 4.72, z: [11.65, 12.65] as AtriumFrontSpan, height: 2.30 },
  planting: {
    outline: [
      { x: -.80, z: 7.30 }, { x: .00, z: 6.35 }, { x: 2.60, z: 6.55 },
      { x: 3.60, z: 8.10 }, { x: 2.90, z: 10.70 }, { x: .00, z: 10.10 },
    ] as readonly AtriumFrontPoint[],
    cornerRadius: .30,
    edgeTopY: .350,
    soilY: .300,
    edgeWidth: .050,
    rootCell: { minX: .35, maxX: 1.65, minZ: 7.85, maxZ: 9.15, minY: -.35, maxY: .30 },
  },
  tree: {
    x: 1.00, z: 8.50, topY: 3.25, maxTopY: 3.40,
    crownWidth: 1.50, crownMinWidth: 1.35, branchStartY: 1.85,
    trunkDiameter: .105,
  },
  lowPlantGroups: [
    { x: 2.25, z: 7.20, width: 1.80, depth: 1.00, topY: .80, count: 16 },
    { x: 2.25, z: 9.70, width: 1.70, depth: 1.40, topY: .95, count: 17 },
    { x: .05, z: 9.30, width: .80, depth: .90, topY: .80, count: 7 },
  ],
  openSightlineX: [-3.60, -1.80] as AtriumFrontSpan,
} as const;

export type AtriumFrontTenant = Readonly<{
  id: 'W' | 'E'; name: string; side: -1 | 1; faceX: number;
  z: AtriumFrontSpan; depth: number; ceilingY: number;
  entryU: AtriumFrontSpan; entryRecess: number; entryHeight: number;
  fixtures: Readonly<{
    frontTable: AtriumFrontLocalFixture;
    middleDisplay: AtriumFrontLocalFixture;
    backShelf: AtriumFrontLocalFixture;
    serviceCounter: AtriumFrontLocalFixture;
  }>;
}>;

export const ATRIUM_FRONT_TENANTS = [
  {
    id: 'W', name: '装丁・書籍', side: -1, faceX: -11.40, z: [-10.20, 1.60],
    depth: 5.00, ceilingY: 3.60, entryU: [7.40, 9.20], entryRecess: .65, entryHeight: 2.80,
    fixtures: {
      frontTable: { u: 1.00, d: 1.20, width: 3.20, depth: .80, height: .78 },
      middleDisplay: { u: 4.90, d: 1.70, width: 1.50, depth: .65, height: 1.05 },
      backShelf: { u: .80, d: 4.25, width: 5.60, depth: .40, height: 2.35 },
      serviceCounter: { u: 9.60, d: 3.50, width: 1.60, depth: 1.00, height: .92 },
    },
  },
  {
    id: 'E', name: '生活工芸', side: 1, faceX: 11.40, z: [-10.20, 1.60],
    depth: 5.40, ceilingY: 3.60, entryU: [2.00, 3.80], entryRecess: .80, entryHeight: 2.85,
    fixtures: {
      frontTable: { u: 5.00, d: 1.20, width: 3.20, depth: .90, height: .85 },
      middleDisplay: { u: 9.10, d: 2.00, width: 1.40, depth: .70, height: 1.10 },
      backShelf: { u: 4.80, d: 4.65, width: 5.60, depth: .40, height: 2.15 },
      serviceCounter: { u: .30, d: 3.70, width: 1.30, depth: 1.00, height: .92 },
    },
  },
] as const satisfies readonly AtriumFrontTenant[];

export const ATRIUM_FRONT_UPPER_ROOMS = [
  { id: 'reading', floorY: 4.55, ceilingY: 8.40, glassY: [4.70, 8.07] as AtriumFrontSpan },
  { id: 'gallery', floorY: 9.15, ceilingY: 12.95, glassY: [9.30, 12.67] as AtriumFrontSpan },
  { id: 'salon', floorY: 13.55, ceilingY: 16.95, glassY: [13.70, 16.55] as AtriumFrontSpan },
] as const;

export const ATRIUM_FRONT_UPPER_BOUNDS = { minX: -8.85, maxX: 8.85, minZ: 3.180, maxZ: 7.580 } as const;
export const ATRIUM_FRONT_UPPER_ROUTE_Z = [3.180, 4.980] as AtriumFrontSpan;

export type AtriumFrontRoomFixture = Readonly<{
  id: string; room: 'reading' | 'gallery' | 'salon';
  kind: 'bookshelf' | 'readingTable' | 'banquette' | 'lowCase' | 'partition' | 'materialPanel' | 'curtain' | 'woodPanel' | 'bench';
  bounds: AtriumFrontRect; bottom: number; top: number;
}>;
export const ATRIUM_FRONT_ROOM_FIXTURES = [
  { id: 'U2-books', room: 'reading', kind: 'bookshelf', bounds: { minX: -8.55, maxX: -5.15, minZ: 7.10, maxZ: 7.50 }, bottom: 0, top: 2.35 },
  { id: 'U2-table', room: 'reading', kind: 'readingTable', bounds: { minX: -2.10, maxX: 1.60, minZ: 5.10, maxZ: 6.00 }, bottom: 0, top: .75 },
  { id: 'U2-seat', room: 'reading', kind: 'banquette', bounds: { minX: 5.10, maxX: 8.55, minZ: 6.25, maxZ: 7.10 }, bottom: 0, top: 1.10 },
  { id: 'U3-case', room: 'gallery', kind: 'lowCase', bounds: { minX: -8.20, maxX: -5.50, minZ: 5.20, maxZ: 6.10 }, bottom: 0, top: 1.05 },
  { id: 'U3-partition', room: 'gallery', kind: 'partition', bounds: { minX: -3.80, maxX: -.80, minZ: 5.75, maxZ: 5.90 }, bottom: 0, top: 2.45 },
  { id: 'U3-plinth', room: 'gallery', kind: 'lowCase', bounds: { minX: 1.10, maxX: 3.80, minZ: 5.20, maxZ: 6.10 }, bottom: 0, top: .95 },
  { id: 'U3-samples', room: 'gallery', kind: 'materialPanel', bounds: { minX: 5.20, maxX: 8.40, minZ: 7.28, maxZ: 7.40 }, bottom: 1.20, top: 2.80 },
  { id: 'U4-curtain', room: 'salon', kind: 'curtain', bounds: { minX: -8.50, maxX: -5.15, minZ: 6.80, maxZ: 6.95 }, bottom: .05, top: 2.85 },
  { id: 'U4-wood', room: 'salon', kind: 'woodPanel', bounds: { minX: -3.80, maxX: 3.80, minZ: 7.30, maxZ: 7.48 }, bottom: 0, top: 2.70 },
  { id: 'U4-bench', room: 'salon', kind: 'bench', bounds: { minX: 5.30, maxX: 8.40, minZ: 6.20, maxZ: 7.10 }, bottom: 0, top: .95 },
] as const satisfies readonly AtriumFrontRoomFixture[];

export const ATRIUM_FRONT_LIGHTING = {
  opticalY: 4.060, emitterY: 4.140,
  gardenWallWash: { x: [-3.30, -1.65, 0, 1.65, 3.30], z: 11.940, targetZ: 13.270 },
  gardenViewing: {
    x: -.10, y: 4.060, z: 7.10, target: { x: 1.00, y: 2.60, z: 8.50 },
    fullAngle: Math.PI / 3, halfAngle: Math.PI / 6,
    recess: { minX: -.25, maxX: .05, minZ: 6.95, maxZ: 7.25, minY: 4.085, maxY: 4.230 },
  },
  gardenGrowing: {
    x: 1.00, y: 4.060, z: 8.50, width: .600, depth: .300,
    fullAngle: Math.PI * 100 / 180, halfAngle: Math.PI * 50 / 180, normallyOn: false,
  },
} as const;

export type AtriumFrontGlassPlane = Readonly<{
  id: string; faceZ: number; minX: number; maxX: number; minY: number; maxY: number;
}>;
export const ATRIUM_FRONT_GLASS_PLANES: readonly AtriumFrontGlassPlane[] = [
  { id: 'garden', faceZ: ATRIUM_FRONT_GLAZING.faceZ, minX: -4.48, maxX: 4.48, minY: .12, maxY: 3.92 },
  ...ATRIUM_FRONT_UPPER_ROOMS.flatMap(room => ATRIUM_FRONT_GLAZING.upperBays.map(([minX, maxX], index) => ({
    id: `${room.id}-${index}`, faceZ: ATRIUM_FRONT_GLAZING.faceZ,
    minX, maxX, minY: room.glassY[0], maxY: room.glassY[1],
  }))),
];

/** Tenant u/d values denote lower-left rectangle origins, never fixture centres. */
export function atriumFrontTenantPoint(tenant: AtriumFrontTenant, u: number, d: number): AtriumFrontPoint {
  return { x: tenant.faceX + tenant.side * d, z: tenant.z[0] + u };
}

export function atriumFrontTenantRect(tenant: AtriumFrontTenant, fixture: AtriumFrontLocalFixture): AtriumFrontRect {
  const a = atriumFrontTenantPoint(tenant, fixture.u, fixture.d);
  const b = atriumFrontTenantPoint(tenant, fixture.u + fixture.width, fixture.d + fixture.depth);
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: a.z, maxZ: b.z };
}

/** Remove only the new front tenants from old filler/perimeter spans, in s=-z. */
export function atriumFrontRemainingSideSpans(startS: number, endS: number): readonly AtriumFrontSpan[] {
  const frontMinS = -Math.max(...ATRIUM_FRONT_TENANTS.map(tenant => tenant.z[1])) - ATRIUM_FRONT_STRUCTURE.sideWallDepth;
  const frontMaxS = -Math.min(...ATRIUM_FRONT_TENANTS.map(tenant => tenant.z[0])) + ATRIUM_FRONT_STRUCTURE.sideWallDepth;
  if (endS <= frontMinS || startS >= frontMaxS) return [[startS, endS]];
  const remaining: AtriumFrontSpan[] = [];
  if (startS < frontMinS) remaining.push([startS, frontMinS]);
  if (endS > frontMaxS) remaining.push([frontMaxS, endS]);
  return remaining;
}
