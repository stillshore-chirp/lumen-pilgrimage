import { OUTER_DISTRICTS } from '../overlook/overlookDistricts';

export const RESIDENCE_STREET_LEVEL = -176;
export const RESIDENCE_REGIONAL_ORIGIN = {
  x: OUTER_DISTRICTS.downtown[0] + 500,
  z: OUTER_DISTRICTS.downtown[1] + 280,
};

// Plan coordinates use east-positive X and south-positive Z. The surveyed basin uses north-positive Z.
export const RESIDENCE_CITY_LIMITS = { minX: -165, maxX: 165, minZ: -51, maxZ: 447 };
export const RESIDENCE_CITY_AREAS = [
  RESIDENCE_CITY_LIMITS,
  { minX: -115, maxX: 125, minZ: 447, maxZ: 793 },
  { minX: 165, maxX: 406, minZ: -103, maxZ: 146 },
] as const;

export type CityRect = {
  minX: number; maxX: number; minZ: number; maxZ: number;
};

type Building = CityRect & {
  height: number; form: 'stone' | 'glass' | 'ribbon'; color: number;
};

function building(minX: number, maxX: number, minZ: number, maxZ: number, height: number,
  form: Building['form'], color: number): Building {
  return { minX, maxX, minZ, maxZ, height, form, color };
}

export const RESIDENCE_CITY_BUILDINGS: readonly Building[] = [
  building(-132, -86, 52, 100, 138, 'ribbon', 0x82939b),
  building(-76, -22, 57, 114, 188, 'stone', 0xcac3ad),
  building(52, 104, 66, 129, 202, 'glass', 0x577785),
  building(-80, -23, 136, 165, 54, 'stone', 0xaaa598),
  building(54, 104, 144, 160, 58, 'ribbon', 0x849994),
  building(-72, -23, 206, 249, 220, 'glass', 0x687c8f),
  building(49, 103, 208, 247, 165, 'stone', 0xb0aa9c),
  building(-132, -94, 199, 263, 139, 'ribbon', 0x998d80),
  building(110, 139, 195, 259, 172, 'glass', 0x718a97),
  building(-79, -30, 297, 347, 158, 'stone', 0xab9d90),
  building(51, 109, 289, 331, 188, 'glass', 0x749297),
  building(-80, -25, 371, 401, 111, 'ribbon', 0xa59c8c),
  building(51, 116, 365, 395, 170, 'glass', 0x77889a),
  building(54, 112, -44, -27, 169, 'ribbon', 0x8f9694),
  // Low near roofs beneath the balcony and on the south-side return.
  building(54, 111, -22, -5, 30, 'stone', 0xa59984),
  building(116, 150, -27, -9, 42, 'ribbon', 0x9b9f96),
  building(-143, -87, 129, 156, 79, 'stone', 0xb3a08f),
  building(-88, -44, -36, -12, 94, 'ribbon', 0x938d8d),
  building(-19, -2, 98, 122, 24, 'stone', 0xb5ada0),
  building(116, 150, 70, 122, 82, 'stone', 0xb5ac9b),
  building(-148, -90, 322, 369, 65, 'ribbon', 0x929d96),
  building(117, 153, 309, 348, 96, 'stone', 0xaca49a),
  building(-101, -36, 468, 528, 116, 'ribbon', 0x89969c),
  building(52, 111, 469, 519, 78, 'stone', 0xa7a896),
  building(53, 106, 525, 550, 42, 'stone', 0x9dada3),
  building(-103, -38, 601, 675, 99, 'stone', 0xaaa187),
  building(50, 111, 610, 671, 123, 'glass', 0x788d95),
  building(-57, 72, 749, 788, 55, 'ribbon', 0xa9a799),
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

export const RESIDENCE_AVENUE = { minX: 1.5, maxX: 37.5, minZ: 6, maxZ: 725 };
export const RESIDENCE_SIDE_STREET = { minX: 38, maxX: 48, minZ: -51, maxZ: 6 };
export const RESIDENCE_EAST_RETURN = { minX: 48, maxX: 406, minZ: -5, maxZ: 4 };
export const RESIDENCE_EAST_LANES = [
  { minX: 222, maxX: 236, minZ: -103, maxZ: 146 },
  { minX: 315, maxX: 330, minZ: -103, maxZ: 146 },
] satisfies CityRect[];
export const RESIDENCE_EAST_LINKS = [
  { minX: 165, maxX: 406, minZ: -66, maxZ: -54 },
  { minX: 165, maxX: 406, minZ: 119, maxZ: 134 },
] satisfies CityRect[];
export const RESIDENCE_CROSS_STREETS = [
  { minX: -165, maxX: 406, minZ: 6, maxZ: 42 },
  { minX: -165, maxX: 165, minZ: 167, maxZ: 194 },
  { minX: -165, maxX: 165, minZ: 268, maxZ: 285 },
  { minX: -115, maxX: 125, minZ: 434, maxZ: 456 },
  { minX: -115, maxX: 125, minZ: 558, maxZ: 585 },
  { minX: -115, maxX: 125, minZ: 697, maxZ: 725 },
] satisfies CityRect[];
