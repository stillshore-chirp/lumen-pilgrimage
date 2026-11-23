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

export type DistrictBuilding = CityRect & {
  height: number; form: 'stone' | 'glass' | 'ribbon' | 'balcony'; color: number;
  entrance?: { axis: 'x' | 'z'; side: -1 | 1 };
  compact?: boolean;
};

function building(minX: number, maxX: number, minZ: number, maxZ: number, height: number,
  form: DistrictBuilding['form'], color: number): DistrictBuilding {
  return { minX, maxX, minZ, maxZ, height, form, color };
}

const foreground: readonly DistrictBuilding[] = [
  building(-132, -86, 52, 100, 138, 'ribbon', 0x82939b),
  building(-76, -22, 57, 114, 188, 'stone', 0xc7b399),
  building(52, 104, 66, 129, 202, 'glass', 0x517989),
  building(-80, -23, 136, 165, 54, 'stone', 0xaaa598),
  building(54, 104, 144, 160, 58, 'balcony', 0x9a9b87),
  building(-72, -23, 206, 249, 220, 'glass', 0x687c8f),
  building(49, 103, 208, 247, 165, 'balcony', 0xa3a194),
  building(-132, -94, 199, 263, 139, 'ribbon', 0xa38e7f),
  building(110, 139, 195, 259, 172, 'glass', 0x718a97),
  building(-79, -30, 297, 347, 158, 'stone', 0xab9d90),
  building(51, 109, 289, 331, 188, 'glass', 0x749297),
  building(-80, -25, 371, 401, 111, 'ribbon', 0xac8578),
  building(51, 116, 365, 395, 170, 'glass', 0x77889a),
  building(54, 112, -44, -27, 169, 'ribbon', 0x8f9694),
  // Low near roofs beneath the balcony and on the south-side return.
  building(54, 111, -22, -8.5, 30, 'stone', 0xa59984),
  building(116, 150, -27, -9, 42, 'ribbon', 0x9b9f96),
  building(-143, -87, 129, 156, 79, 'stone', 0xb3a08f),
  building(-88, -44, -36, -12, 94, 'ribbon', 0x938d8d),
  building(-19, -2, 98, 122, 24, 'stone', 0xb5ada0),
  building(116, 150, 70, 122, 82, 'stone', 0xb5ac9b),
  building(-148, -90, 322, 369, 65, 'ribbon', 0x929d96),
  building(117, 153, 309, 348, 96, 'stone', 0xaca49a),
  building(-101, -36, 468, 528, 116, 'ribbon', 0x89969c),
  building(52, 111, 469, 519, 78, 'balcony', 0xb6a28c),
  building(53, 106, 525, 550, 42, 'stone', 0x9dada3),
  building(-103, -38, 601, 675, 99, 'stone', 0xaaa187),
  building(50, 111, 610, 671, 123, 'glass', 0x788d95),
  building(-63, -12, 749, 788, 55, 'ribbon', 0xa9a799),
  building(48, 99, 754, 801, 72, 'balcony', 0xb2a18b),
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

const west = -664, east = 1058, north = -496, south = 1454;
const avenue = vertical('south-avenue', 19.5, 24, south, 36, 3.25);
const side = vertical('residence-service', 43, north, 24, 10, 1.55);
const eastReturn = horizontal('east-return', -1, 43, east, 10, 1.5);
const crosses = [
  horizontal('southern-boulevard', 24, west, east, 36, 3.12),
  horizontal('junction-180', 180.5, west, 161.5, 27, 3.12),
  horizontal('junction-276', 276.5, west, east, 17, 2.45),
  horizontal('commercial-445', 445, west, east, 22, 3.12),
  horizontal('junction-571', 571.5, west, 322, 27, 3.12),
  horizontal('market-711', 711, west, east, 28, 3.12),
  horizontal('junction-834', 834.5, -388, 322, 21, 2.65),
  horizontal('station-916', 916, west, east, 22, 3.12),
];

export const RESIDENCE_DISTRICT_ROADS: readonly DistrictRoad[] = [
  avenue, ...crosses, side, eastReturn,
  vertical('west-loop', west, north, south, 25, 3.2),
  vertical('west-viaduct-street', -520, north, south, 17, 2.2),
  vertical('workshops-west', -388, north, south, 25, 3.1),
  vertical('printing-street', -274, -358, 1282, 13, 2.2),
  vertical('arcade-west', -156, -132, 916, 14, 2.15),
  vertical('north-warehouse', -118, north, -132, 15, 2.3),
  vertical('south-court-street', -118, 445, 1282, 13, 2.1),
  vertical('first-east', 161.5, north, south, 13, 2.15),
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
  horizontal('station-north', -132, west, east, 18, 2.5),
  horizontal('residence-north-link', -60, -156, east, 13, 2.0),
  horizontal('theater-link', 128, 161.5, east, 18, 2.4),
  horizontal('southeast-link', 352, 161.5, 872, 16, 2.25),
  horizontal('market-east-link', 611, 493, east, 22, 2.75),
  horizontal('southwest-link', 1046, west, 322, 20, 2.60),
  horizontal('education-link', 1184, 322, east, 20, 2.60),
  horizontal('lower-distributor', 1282, west, east, 24, 3.1),
  horizontal('south-loop', south, west, east, 25, 3.2),
];

export const RESIDENCE_AVENUE = avenue.rect;
export const RESIDENCE_SIDE_STREET = side.rect;
export const RESIDENCE_CROSS_STREETS = crosses.map(({ rect }) => rect);
export const RESIDENCE_TOWER = { minX: -12, maxX: 22.8, minZ: -34, maxZ: 0, height: RESIDENCE_FLOOR_ABOVE_STREET + 39.5 };
export const RESIDENCE_CITY_BUILDINGS = foreground;
