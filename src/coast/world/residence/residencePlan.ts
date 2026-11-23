// Plan axes in metres. World coordinates are x = e and z = -n.
export type ResidenceRect = readonly [west: number, south: number, east: number, north: number];

export interface ResidenceRoom {
  readonly id: string;
  readonly label: string;
  readonly rectangles: readonly ResidenceRect[];
  readonly floor: 'oak' | 'stone' | 'tile' | 'deck' | 'core';
  readonly ceiling: number | null;
}

export interface ResidenceOpening {
  readonly kind: 'window' | 'door' | 'passage' | 'balcony-door';
  readonly from: number;
  readonly to: number;
  readonly bottom: number;
  readonly top: number;
  readonly swing?: { readonly hinge: 'from' | 'to'; readonly side: -1 | 1 };
}

export interface ResidenceWall {
  readonly axis: 'e' | 'n';
  readonly fixed: number;
  readonly from: number;
  readonly to: number;
  readonly thickness: number;
  readonly height: number;
  readonly kind: 'interior' | 'party' | 'exterior' | 'guard';
  readonly openings?: readonly ResidenceOpening[];
}

// Dimensions are measured at wall centrelines. The common core is outside the dwelling area.
export const RESIDENCE_ROOMS: readonly ResidenceRoom[] = [
  { id: '03', label: '寝室03', rectangles: [[0, 0, 3.65, 5]], floor: 'oak', ceiling: 2.85 },
  { id: '04', label: '寝室04', rectangles: [[3.65, 0, 7.30, 5]], floor: 'oak', ceiling: 2.85 },
  { id: '05', label: '寝室05・書斎', rectangles: [[7.30, 0, 11, 5]], floor: 'oak', ceiling: 2.85 },
  { id: 'LD', label: 'リビング・ダイニング', rectangles: [[11, 0, 22.8, 6.65]], floor: 'oak', ceiling: 3 },
  { id: 'H1', label: '寝室側廊下', rectangles: [[0, 5, 11, 6.65]], floor: 'oak', ceiling: 2.65 },
  { id: 'BA', label: '浴室A', rectangles: [[0, 6.65, 3.35, 10.2]], floor: 'tile', ceiling: 2.55 },
  { id: 'BB', label: '浴室B', rectangles: [[3.35, 6.65, 6.25, 10.2]], floor: 'tile', ceiling: 2.55 },
  { id: 'PS', label: '設備・PS1', rectangles: [[0, 10.2, 6.25, 11.1]], floor: 'core', ceiling: null },
  { id: 'UT', label: '洗濯室', rectangles: [[6.25, 6.65, 8, 11.1]], floor: 'tile', ceiling: 2.55 },
  { id: 'ST', label: '収納', rectangles: [[8, 6.65, 11, 9.7]], floor: 'oak', ceiling: 2.55 },
  { id: 'WC', label: '来客用WC', rectangles: [[8, 9.7, 11, 12.1]], floor: 'tile', ceiling: 2.55 },
  { id: 'FO', label: '玄関・前室', rectangles: [[8, 12.1, 12.8, 15.6]], floor: 'stone', ceiling: 2.65 },
  { id: 'H0', label: '玄関ギャラリー', rectangles: [[11, 6.65, 12.8, 12.1]], floor: 'oak', ceiling: 2.65 },
  { id: 'K', label: 'キッチン', rectangles: [[12.8, 6.65, 17.35, 9.95]], floor: 'oak', ceiling: 2.85 },
  { id: '02', label: '寝室02', rectangles: [[17.35, 6.65, 22.8, 9.95]], floor: 'oak', ceiling: 2.85 },
  { id: 'H2', label: '東側廊下', rectangles: [[12.8, 9.95, 19, 11.6]], floor: 'oak', ceiling: 2.65 },
  { id: 'MB', label: '主浴室', rectangles: [[12.8, 11.6, 15.15, 15.6]], floor: 'tile', ceiling: 2.55 },
  { id: 'WI', label: 'WIC', rectangles: [[15.15, 11.6, 17.05, 15.6]], floor: 'oak', ceiling: 2.55 },
  { id: '01', label: '主寝室01', rectangles: [[17.05, 11.6, 20.7, 15.6], [19, 9.95, 22.8, 11.6]], floor: 'oak', ceiling: 2.85 },
  { id: 'BL', label: 'バルコニー', rectangles: [[20.7, 11.6, 22.8, 15.6]], floor: 'deck', ceiling: null },
  { id: 'C0', label: '共用コア', rectangles: [[0, 11.1, 8, 15.6]], floor: 'core', ceiling: 2.65 },
  { id: 'C1', label: 'エレベーターホール・共用廊下', rectangles: [[0, 15.6, 16.5, 17.7]], floor: 'core', ceiling: 2.65 },
];

export const RESIDENCE_BALCONY_DOOR = { e: 20.7, nFrom: 13.05, nTo: 14.1 } as const;
export const RESIDENCE_HINGED_DOOR = { hingeInset: 0.019, skinOffset: 0.013, leafInset: 0.063, halfLeaf: 0.021 } as const;

export const RESIDENCE_FACADE_PIERS: readonly ResidenceRect[] = [
  [17.71, -0.12, 18.15, 0.43],
  [22.43, -0.12, 22.94, 0.42],
  [10.92, -0.12, 11.43, 0.39],
  [22.50, 6.36, 22.92, 6.94],
  [0.06, 0.08, 0.35, 0.50],
];

export const RESIDENCE_STAIR_ENCLOSURE: ResidenceRect = [0.65, 11.5, 4.05, 15.3];
export const RESIDENCE_BATH_SERVICE_SHAFT: ResidenceRect = [12.94, 11.68, 13.72, 12.04];

function windowOpening(from: number, to: number, top: number): ResidenceOpening {
  return { kind: 'window', from, to, bottom: 0.12, top };
}

function clearOpening(kind: 'door' | 'passage' | 'balcony-door', from: number, to: number, top: number,
  swing?: ResidenceOpening['swing']): ResidenceOpening {
  return { kind, from, to, bottom: 0, top, swing };
}

function wall(axis: ResidenceWall['axis'], fixed: number, from: number, to: number,
  kind: ResidenceWall['kind'] = 'interior', openings?: readonly ResidenceOpening[],
  thickness = kind === 'interior' ? 0.14 : 0.26): ResidenceWall {
  return { axis, fixed, from, to, thickness, height: kind === 'guard' ? 1.18 : 3.12, kind, openings };
}

const bedroomSwing = { hinge: 'from', side: -1 } as const;
const northSwing = { hinge: 'from', side: 1 } as const;
const [stairWest, stairSouth, stairEast, stairNorth] = RESIDENCE_STAIR_ENCLOSURE;
const { e: balconyWest, nFrom: doorSouth, nTo: doorNorth } = RESIDENCE_BALCONY_DOOR;

export const RESIDENCE_WALLS: readonly ResidenceWall[] = [
  wall('e', 0, 0, 22.8, 'exterior', [
    windowOpening(0.49, 3.04, 2.73), windowOpening(4.16, 6.8, 2.73), windowOpening(7.81, 10.46, 2.73),
    windowOpening(11.43, 17.71, 2.95), windowOpening(18.15, 22.43, 2.95),
  ]),
  wall('n', 22.8, 0, 11.6, 'exterior', [
    windowOpening(0.42, 6.36, 2.95), windowOpening(7.04, 9.58, 2.73), windowOpening(10.14, 11.4, 2.73),
  ]),
  wall('n', 0, 0, 11.1, 'exterior'),
  wall('e', 11.1, 0, 8, 'party'),
  wall('n', 8, 11.1, 15.6, 'party'),
  wall('e', 15.6, 8, 16.5, 'party', [clearOpening('door', 10.38, 11.54, 2.35, bedroomSwing)]),
  wall('e', 15.6, 16.5, 22.8, 'exterior'),
  wall('e', 11.6, 20.7, 22.8, 'exterior', [windowOpening(20.99, 22.53, 2.73)], 0.24),
  wall('n', balconyWest, 11.6, 15.6, 'exterior', [
    windowOpening(12.06, doorSouth, 2.73),
    clearOpening('balcony-door', doorSouth, doorNorth, 2.73),
    windowOpening(doorNorth, 15.17, 2.73),
  ], 0.24),
  wall('n', 22.8, 11.68, 15.48, 'guard', undefined, 0.08),

  wall('n', 3.65, 0, 5),
  wall('n', 7.3, 0, 5),
  wall('e', 5, 0, 11, 'interior', [
    clearOpening('door', 2.36, 3.32, 2.2, bedroomSwing),
    clearOpening('door', 6.01, 6.97, 2.2, bedroomSwing),
    clearOpening('door', 9.57, 10.53, 2.2, bedroomSwing),
  ]),
  wall('n', 11, 0, 12.1, 'interior', [
    clearOpening('passage', 5.08, 6.57, 2.65),
    clearOpening('door', 10.49, 11.47, 2.2, bedroomSwing),
  ]),
  wall('e', 6.65, 0, 11, 'interior', [
    clearOpening('door', 1.98, 2.94, 2.2, northSwing),
    clearOpening('door', 4.89, 5.81, 2.2, northSwing),
    clearOpening('door', 6.61, 7.53, 2.2, northSwing),
    clearOpening('door', 9.48, 10.4, 2.2, northSwing),
  ]),
  wall('n', 3.35, 6.65, 10.2),
  wall('n', 6.25, 6.65, 11.1),
  wall('n', 8, 6.65, 11.1),
  wall('e', 10.2, 0, 6.25),
  wall('e', 9.7, 8, 11),
  wall('e', 12.1, 8, 11),
  wall('n', 12.8, 11.6, 15.6),
  wall('e', 9.95, 12.8, 19, 'interior', [clearOpening('door', 17.9, 18.86, 2.2, bedroomSwing)]),
  wall('n', 19, 9.95, 11.6),
  wall('e', 6.65, 17.35, 22.8),
  wall('n', 17.35, 6.65, 9.95),
  wall('e', 11.6, 12.8, 19, 'interior', [clearOpening('door', 17.59, 18.63, 2.2, northSwing)]),
  wall('n', 15.15, 11.6, 15.6, 'interior', [clearOpening('door', 12.07, 13.01, 2.2, bedroomSwing)]),
  wall('n', 17.05, 11.6, 15.6, 'interior', [clearOpening('door', 12.07, 13.01, 2.2, bedroomSwing)]),

  wall('n', 0, 11.1, 17.7, 'party'),
  wall('e', 17.7, 0, 16.5, 'party'),
  wall('n', 16.5, 15.6, 17.7, 'party'),
  wall('n', stairWest, stairSouth, stairNorth, 'party'),
  wall('n', stairEast, stairSouth, stairNorth, 'party'),
  wall('e', stairSouth, stairWest, stairEast, 'party'),
  wall('e', stairNorth, stairWest, stairEast, 'party'),
];
