import { OUTER_DISTRICTS } from '../overlook/overlookDistricts';
import { RESIDENCE_FLOOR_ABOVE_STREET } from './residenceFloor';

export const RESIDENCE_STREET_LEVEL = -RESIDENCE_FLOOR_ABOVE_STREET;
export const RESIDENCE_REGIONAL_ORIGIN = {
  x: OUTER_DISTRICTS.downtown[0] + 500,
  z: OUTER_DISTRICTS.downtown[1] + 280,
};

// Plan coordinates use east-positive X and south-positive Z. The surveyed basin uses north-positive Z.
export const RESIDENCE_CITY_LIMITS = { minX: -738, maxX: 1132, minZ: -570, maxZ: 1528 };

export type CityRect = {
  minX: number; maxX: number; minZ: number; maxZ: number;
};

const west = -664, east = 1058, north = -496, south = 1454;
const fartherEast = 2290, fartherSouth = 2780;
const northEast = -132, southEast = 128, westSouth = -156, eastSouth = 161.5;

export const RESIDENCE_EXTENSION_BLOCK_LIMITS: readonly CityRect[] = [
  { minX: east, maxX: fartherEast, minZ: northEast, maxZ: southEast },
  { minX: westSouth, maxX: eastSouth, minZ: south, maxZ: fartherSouth },
];

export const RESIDENCE_DISTRICT_AREAS: readonly CityRect[] = [
  RESIDENCE_CITY_LIMITS,
  { minX: east, maxX: fartherEast + 82, minZ: northEast - 32, maxZ: southEast + 36 },
  { minX: westSouth - 32, maxX: eastSouth + 34, minZ: south, maxZ: fartherSouth + 84 },
];

// The reserved view continues through the final cross street into the surveyed city.
export const RESIDENCE_AXIAL_CORRIDORS: readonly CityRect[] = [
  { minX: east, maxX: 4180, minZ: -7, maxZ: 43 },
  { minX: 25, maxX: 61, minZ: south, maxZ: 4540 },
  { minX: 25, maxX: 61, minZ: -1330, maxZ: north },
];

export type DistrictBuilding = CityRect & {
  height: number; form: 'stone' | 'glass' | 'ribbon' | 'balcony'; color: number;
  entrance?: { axis: 'x' | 'z'; side: -1 | 1 };
  compact?: boolean;
  mass?: 'stepped' | 'twin';
};

function building(minX: number, maxX: number, minZ: number, maxZ: number, height: number,
  form: DistrictBuilding['form'], color: number): DistrictBuilding {
  return { minX, maxX, minZ, maxZ, height, form, color };
}

export const RESIDENCE_BALCONY_REFLECTOR = building(64.5, 112, -44, -27, 169, 'ribbon', 0x8f9694);

const foreground: readonly DistrictBuilding[] = [
  building(-132, -86, 52, 100, 138, 'ribbon', 0x82939b),
  building(-76, -22, 57, 114, 188, 'stone', 0xc7b399),
  building(64.5, 104, 66, 129, 202, 'glass', 0x517989),
  building(-80, -23, 136, 165, 54, 'stone', 0xaaa598),
  building(64.5, 104, 144, 160, 58, 'balcony', 0x9a9b87),
  building(-72, -23, 206, 249, 220, 'glass', 0x687c8f),
  building(64.5, 103, 208, 247, 165, 'balcony', 0xa3a194),
  building(-132, -94, 199, 263, 139, 'ribbon', 0xa38e7f),
  building(110, 139, 195, 259, 172, 'glass', 0x718a97),
  building(-79, -30, 297, 347, 158, 'stone', 0xab9d90),
  building(64.5, 109, 289, 331, 188, 'glass', 0x749297),
  building(-80, -25, 371, 401, 111, 'ribbon', 0xac8578),
  building(64.5, 116, 365, 395, 170, 'glass', 0x77889a),
  RESIDENCE_BALCONY_REFLECTOR,
  // Low near roofs beneath the balcony and on the south-side return.
  building(64.5, 111, -22, -8.5, 49, 'stone', 0xa59984),
  building(116, 150, -27, -9, 63, 'ribbon', 0x9b9f96),
  building(-143, -87, 129, 156, 79, 'stone', 0xb3a08f),
  building(-88, -44, -36, -12, 94, 'ribbon', 0x938d8d),
  building(-19, -2, 98, 122, 36, 'stone', 0xb5ada0),
  building(116, 150, 70, 122, 82, 'stone', 0xb5ac9b),
  building(-148, -90, 322, 369, 65, 'ribbon', 0x929d96),
  building(117, 153, 309, 348, 96, 'stone', 0xaca49a),
  building(-101, -36, 468, 528, 116, 'ribbon', 0x89969c),
  building(64.5, 111, 469, 519, 78, 'balcony', 0xb6a28c),
  building(64.5, 106, 525, 550, 58, 'stone', 0x9dada3),
  building(-103, -38, 601, 675, 99, 'stone', 0xaaa187),
  building(64.5, 111, 610, 671, 123, 'glass', 0x788d95),
  building(-63, -12, 749, 788, 55, 'ribbon', 0xa9a799),
  building(64.5, 99, 754, 801, 72, 'balcony', 0xb2a18b),
  building(169, 213, -51, -9, 67, 'stone', 0xb0a992),
  building(240, 302, -51, -9, 95, 'glass', 0x87989c),
  building(336, 394, -46, -8, 58, 'ribbon', 0x9faaa0),
  building(172, 215, -99, -70, 42, 'ribbon', 0x88928e),
  building(241, 306, -96, -73, 71, 'stone', 0xa4a192),
  building(340, 386, -91, -70, 83, 'stone', 0xaba59c),
  building(172, 213, 52, 115, 104, 'ribbon', 0x939e9b),
  building(242, 306, 50, 113, 66, 'stone', 0xaea496),
  building(336, 395, 49, 103, 86, 'glass', 0x779197),
];

export type DistrictRoad = {
  id: string;
  center: number;
  from: number;
  to: number;
  alongZ: boolean;
  walk: number;
  rect: CityRect;
  carriageway: CityRect;
};

function road(id: string, alongZ: boolean, center: number, from: number, to: number, width: number, walk: number): DistrictRoad {
  const extent = (half: number) => alongZ
    ? { minX: center - half, maxX: center + half, minZ: from, maxZ: to }
    : { minX: from, maxX: to, minZ: center - half, maxZ: center + half };
  return { id, alongZ, center, from, to, walk, rect: extent(width / 2), carriageway: extent(width / 2 - walk) };
}

const vertical = (id: string, x: number, from: number, to: number, width: number, walk: number) =>
  road(id, true, x, from, to, width, walk);
const horizontal = (id: string, z: number, from: number, to: number, width: number, walk: number) =>
  road(id, false, z, from, to, width, walk);

const avenue = vertical('south-avenue', 43, north, fartherSouth, 36, 3.25);
const eastReturn = horizontal('east-return', -1, 43, fartherEast, 10, 1.5);
const crosses = [
  horizontal('southern-boulevard', 24, west, fartherEast, 36, 3.12),
  horizontal('junction-180', 180.5, west, 161.5, 27, 3.12),
  horizontal('junction-276', 276.5, west, east, 17, 2.45),
  horizontal('commercial-445', 445, west, east, 22, 3.12),
  horizontal('junction-571', 571.5, west, 322, 27, 3.12),
  horizontal('market-711', 711, west, east, 28, 3.12),
  horizontal('junction-834', 834.5, -388, 322, 21, 2.65),
  horizontal('station-916', 916, west, east, 22, 3.12),
];

export const RESIDENCE_DISTRICT_ROADS: readonly DistrictRoad[] = [
  avenue, ...crosses, eastReturn,
  vertical('west-loop', west, north, south, 25, 3.2),
  vertical('west-viaduct-street', -520, north, south, 17, 2.2),
  vertical('workshops-west', -388, north, south, 25, 3.1),
  vertical('printing-street', -274, -358, 1282, 13, 2.2),
  vertical('arcade-west', -156, -132, 916, 14, 2.15),
  vertical('north-warehouse', -118, north, -132, 15, 2.3),
  vertical('south-court-street', -118, 445, 1282, 13, 2.1),
  vertical('first-east', eastSouth, north, fartherSouth, 13, 2.15),
  vertical('hotel-street', 228, -266, 445, 16, 2.3),
  vertical('theater-avenue', 322, north, south, 18, 2.65),
  vertical('arcade-east', 412, -132, 445, 20, 2.65),
  vertical('market-street', 493, 24, 1282, 18, 2.45),
  vertical('eastern-avenue', 603, north, south, 28, 3.25),
  vertical('waterworks-street', 743, north, 1184, 15, 2.25),
  vertical('university-street', 872, north, south, 20, 2.65),
  vertical('eastern-lane', 983, -358, 916, 12, 1.9),
  vertical('east-loop', east, north, south, 25, 3.2),
  horizontal('north-loop', north, west, east, 24, 3.2),
  horizontal('north-distributor', -358, west, east, 19, 2.45),
  horizontal('upper-east-link', -266, 43, east, 16, 2.25),
  horizontal('north-west-link', -223, west, -118, 14, 2.0),
  horizontal('station-north', northEast, west, fartherEast, 18, 2.5),
  horizontal('residence-north-link', -60, -156, east, 13, 2.0),
  horizontal('theater-link', southEast, eastSouth, fartherEast, 18, 2.4),
  horizontal('southeast-link', 352, 161.5, 872, 16, 2.25),
  horizontal('market-east-link', 611, 493, east, 22, 2.75),
  horizontal('southwest-link', 1046, west, 322, 20, 2.60),
  horizontal('education-link', 1184, 322, east, 20, 2.60),
  horizontal('lower-distributor', 1282, west, east, 24, 3.1),
  horizontal('south-loop', south, west, east, 25, 3.2),
  vertical('east-freight', 1228, northEast, southEast, 18, 2.5),
  vertical('east-foundry', 1392, northEast, southEast, 23, 3.1),
  vertical('east-square', 1584, northEast, southEast, 18, 2.6),
  vertical('east-exchange', 1818, northEast, southEast, 24, 3.2),
  vertical('east-distributor', 2094, northEast, southEast, 26, 3.3),
  vertical('outer-east-avenue', fartherEast, northEast, southEast, 30, 3.5),
  horizontal('east-rear-workshops', -64, 1228, 1818, 13, 2.1),
  horizontal('east-market-arcade', 82, 1392, 2094, 14, 2.15),
  vertical('south-warehouse', westSouth, south, fartherSouth, 20, 2.45),
  vertical('south-west-lane', -70, 1609, 2194, 13, 2.15),
  vertical('south-east-lane', 79, 1788, 2600, 14, 2.3),
  horizontal('south-first-transfer', 1609, westSouth, eastSouth, 23, 3.1),
  horizontal('south-wholesale', 1788, westSouth, eastSouth, 20, 2.5),
  horizontal('south-terminal-district', 1970, westSouth, eastSouth, 27, 3.25),
  horizontal('south-delivery-link', 2194, westSouth, eastSouth, 19, 2.5),
  horizontal('south-station-road', 2412, westSouth, eastSouth, 24, 3.0),
  horizontal('south-civic-link', 2600, westSouth, eastSouth, 22, 2.7),
  horizontal('outer-south-boulevard', fartherSouth, westSouth, eastSouth, 31, 3.6),
];

export const RESIDENCE_TERMINAL_JUNCTIONS = {
  'south-avenue': 'outer-south-boulevard',
  'southern-boulevard': 'outer-east-avenue',
  'east-return': 'outer-east-avenue',
} as const;

export const RESIDENCE_AVENUE = avenue.rect;
export const RESIDENCE_CROSS_STREETS = crosses.map(({ rect }) => rect);
export const RESIDENCE_TOWER = { minX: -12, maxX: 22.8, minZ: -34, maxZ: 0, height: RESIDENCE_FLOOR_ABOVE_STREET + 39.5 };
export const RESIDENCE_CITY_BUILDINGS = foreground;
