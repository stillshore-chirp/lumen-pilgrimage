import { ATRIUM_TENANTS, tenantEntryGeometry, tenantWorldPoint } from './atriumTenantPlan';

/** R2 u runs along the unchanged frontage; d runs east, into the tenant. Metres. */
export const ATRIUM_CAFE_BAY = ATRIUM_TENANTS.find(bay => bay.id === 'R2')!;
const movableSeats = ATRIUM_CAFE_BAY.fixtures.filter(item => item.type === 'seat').length;
const pairedBenchPlaces = ATRIUM_CAFE_BAY.fixtures.filter(item => item.type === 'table' && item.id.startsWith('R2-T')).length;
export const ATRIUM_CAFE_PLAN = {
  width: 10.10,
  depth: ATRIUM_CAFE_BAY.depth,
  ceiling: ATRIUM_CAFE_BAY.ceiling,
  entrance: ATRIUM_CAFE_BAY.entry,
  entryGeometry: tenantEntryGeometry(ATRIUM_CAFE_BAY),
  aisle: [5.50, 2.50, 1.80, 15.20],
  service: [.25, 2.70, 3.25, 4.90],
  staffRoom: [.35, 15.85, 3.60, 2.35],
  seating: { movableSeats, pairedBenchPlaces, total: movableSeats + pairedBenchPlaces },
  clearAreas: {
    entryTurn: [3.25, .65, 1.80, 1.80],
    rearTurn: [5.50, 15.90, 1.80, 1.80],
    lowCounterParallel: [3.72, 2.55, .80, 1.30],
  },
  frameDepth: .18,
  sidePosts: [.30, 9.80],
  postWidth: .24,
  coreWidth: .14,
  bodyClearance: .16,
  frameStations: [2.35, 8.10, 15.60, 18.10],
  beamBottom: 3.18,
  beamTop: 3.36,
  beamDepth: .24,
  primaryBeamBottom: 3.60,
  primaryBeamTop: 4.04,
  roofTop: 4.16,
  roofDepth: .12,
  ceilingPanelBottom: 3.415,
  ceilingPanels: [[.70, 2.70, 3.80, 5.0], [.70, 8.45, 3.80, 6.65],
    [7.90, 2.70, 1.70, 5.0], [7.90, 8.45, 1.70, 6.65]],
  ceilingLights: [
    { u: 5.1, d: 4.2, y: 3.305, intensity: 20 }, { u: 5.1, d: 8.6, y: 3.305, intensity: 25 },
    { u: 5.1, d: 13.0, y: 3.305, intensity: 25 }, { u: 5.1, d: 16.6, y: 3.305, intensity: 20 },
  ],
  speakerHeight: 2.82,
  speakerCabinet: { width: .22, height: .34, depth: .20, tilt: Math.PI * 25 / 180 },
  speakerBracket: { centerU: .225, width: .09, height: .14, depth: .14 },
} as const;

export function atriumCafeCeilingAt(x: number, z: number, foot = 0): number {
  const { u, d } = atriumCafeLocalPoint(x, z);
  const { entryGeometry } = ATRIUM_CAFE_PLAN;
  let ceiling = ATRIUM_CAFE_PLAN.ceiling;
  if (d >= 0 && d <= entryGeometry.soffitDepth) ceiling = Math.min(ceiling, entryGeometry.soffitBottom);
  if (Math.abs(d - entryGeometry.lintelCenterD) <= entryGeometry.lintelDepth / 2) {
    ceiling = Math.min(ceiling, entryGeometry.lintelBottom);
  }
  if (ATRIUM_CAFE_PLAN.frameStations.some(station => Math.abs(d - station) <= ATRIUM_CAFE_PLAN.beamDepth / 2)) {
    ceiling = Math.min(ceiling, ATRIUM_CAFE_PLAN.beamBottom);
  }
  if (ATRIUM_CAFE_PLAN.ceilingPanels.some(([left, front, w, l]) => u >= left && u <= left + w && d >= front && d <= front + l)) {
    ceiling = Math.min(ceiling, ATRIUM_CAFE_PLAN.ceilingPanelBottom);
  }
  if (ATRIUM_CAFE_PLAN.ceilingLights.some(light => Math.abs(u - light.u) <= .575 && Math.abs(d - light.d) <= .12)) {
    ceiling = Math.min(ceiling, 3.30);
  }
  for (const solid of ATRIUM_CAFE_BOUNDARY_SOLIDS) {
    if (solid.bottom > foot + 1e-6 && containsCafeSolid(solid, u, d)) ceiling = Math.min(ceiling, solid.bottom);
  }
  return ceiling;
}

export function atriumCafeWorldPoint(u: number, d: number, y = 0): readonly [number, number, number] {
  const { x, z } = tenantWorldPoint(ATRIUM_CAFE_BAY, u, d);
  return [x, y, z];
}

export function atriumCafeLocalPoint(x: number, z: number): Readonly<{ u: number; d: number }> {
  return { u: -z - ATRIUM_CAFE_BAY.span[0], d: x - 11.40 };
}

/** Refrigeration/cleaning base cabinet, behind the service bar, not in the staff aisle. */
export const ATRIUM_CAFE_EQUIPMENT_POSITION = atriumCafeWorldPoint(.60, 5.80, .65);

/** Matched visible cabinets and positional monitor feeds. +aim is the acoustic front. */
export const ATRIUM_CAFE_SPEAKERS = [5, 10.5, 14.8].flatMap((d, row) =>
  ([.38, 9.72] as const).map((u, side) => ({
    id: `cafe-${row + 1}-${side === 0 ? 'L' : 'R'}`,
    position: atriumCafeWorldPoint(u, d, ATRIUM_CAFE_PLAN.speakerHeight),
    aim: [0, -Math.sin(ATRIUM_CAFE_PLAN.speakerCabinet.tilt),
      (side === 0 ? -1 : 1) * Math.cos(ATRIUM_CAFE_PLAN.speakerCabinet.tilt)] as const,
  })));

type CafeSolid = Readonly<{ id: string; rect: readonly [number, number, number, number]; bottom: number; top: number }>;
const { sidePosts, frameStations, postWidth, coreWidth, beamBottom, beamTop,
  speakerCabinet: cabinet, speakerBracket: bracket } = ATRIUM_CAFE_PLAN;
const firstHead = frameStations[0] - postWidth / 2;
const lastHead = frameStations[frameStations.length - 1] + postWidth / 2;
// The tilted cabinet uses its unrounded design envelope, conservatively including the rounded corners.
const cabinetAcross = Math.cos(cabinet.tilt) * cabinet.depth / 2 + Math.sin(cabinet.tilt) * cabinet.height / 2;
const cabinetVertical = Math.sin(cabinet.tilt) * cabinet.depth / 2 + Math.cos(cabinet.tilt) * cabinet.height / 2;
export const ATRIUM_CAFE_BOUNDARY_SOLIDS: readonly CafeSolid[] = [
  ...sidePosts.flatMap(u => frameStations.flatMap(d => [
    { id: 'side-post', rect: [u - postWidth / 2, d - postWidth / 2, postWidth, postWidth] as const,
      bottom: 0, top: beamBottom + .06 },
    { id: 'steel-core', rect: [u - coreWidth / 2, d - coreWidth / 2, coreWidth, coreWidth] as const,
      bottom: 0, top: ATRIUM_CAFE_PLAN.primaryBeamTop },
  ])),
  ...sidePosts.map(u => ({ id: 'side-head', rect: [u - postWidth / 2, firstHead, postWidth, lastHead - firstHead] as const,
    bottom: beamBottom, top: beamTop })),
  ...ATRIUM_CAFE_SPEAKERS.flatMap(speaker => {
    const { u, d } = atriumCafeLocalPoint(speaker.position[0], speaker.position[2]);
    const mountU = u < ATRIUM_CAFE_PLAN.width / 2 ? bracket.centerU : ATRIUM_CAFE_PLAN.width - bracket.centerU;
    return [
      { id: `${speaker.id}-cabinet`, rect: [u - cabinetAcross, d - cabinet.width / 2,
        cabinetAcross * 2, cabinet.width] as const,
      bottom: speaker.position[1] - cabinetVertical, top: speaker.position[1] + cabinetVertical },
      { id: `${speaker.id}-bracket`, rect: [mountU - bracket.width / 2, d - bracket.depth / 2,
        bracket.width, bracket.depth] as const,
      bottom: speaker.position[1] - bracket.height / 2, top: speaker.position[1] + bracket.height / 2 },
    ];
  }),
];

function containsCafeSolid(solid: CafeSolid, u: number, d: number): boolean {
  const [left, front, width, depth] = solid.rect, margin = ATRIUM_CAFE_PLAN.bodyClearance;
  return u > left - margin && u < left + width + margin && d > front - margin && d < front + depth + margin;
}

export function inAtriumCafe(x: number, z: number, inset = 0): boolean {
  const { u, d } = atriumCafeLocalPoint(x, z);
  return u >= inset && u <= ATRIUM_CAFE_PLAN.width - inset
    && d >= 0 && d <= ATRIUM_CAFE_PLAN.depth - inset;
}

export function blocksAtriumCafe(x: number, z: number, foot = 0): boolean {
  const { u, d } = atriumCafeLocalPoint(x, z);
  if (d < -.35) return false;
  // Only the R2 entrance opens the former ground-floor concourse boundary.
  if (d < .85) return u < ATRIUM_CAFE_PLAN.entrance[0] + .20
    || u > ATRIUM_CAFE_PLAN.entrance[1] - .20;
  if (!inAtriumCafe(x, z, .35)) return true;
  if (ATRIUM_CAFE_BOUNDARY_SOLIDS.some(solid => foot >= solid.bottom && foot < solid.top
    && containsCafeSolid(solid, u, d))) return true;
  const inside = (a: number, b: number, w: number, l: number, margin: number) =>
    u > a - margin && u < a + w + margin && d > b - margin && d < b + l + margin;
  if (inside(...ATRIUM_CAFE_PLAN.service, .18)) return true;
  return ATRIUM_CAFE_BAY.fixtures.some(item => inside(...item.rect, .16));
}
