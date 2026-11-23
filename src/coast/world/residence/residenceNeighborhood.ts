import * as THREE from 'three';
import { seededDetail } from '../overlook/overlookModel';
import { createDistrictMaterial, createDistrictShadows, createStreetGlowMaterial } from './residenceCityMaterials';
import {
  RESIDENCE_AVENUE, RESIDENCE_CITY_AREAS, RESIDENCE_CITY_BUILDINGS, RESIDENCE_CROSS_STREETS,
  RESIDENCE_EAST_LANES, RESIDENCE_EAST_LINKS, RESIDENCE_EAST_RETURN, RESIDENCE_SIDE_STREET,
  RESIDENCE_STREET_LEVEL, type CityRect,
} from './residenceCityPlan';

type Solid = { x: number; y: number; z: number; w: number; h: number; d: number; color: number };
type Facade = Solid & { bay: number; floor: number; kind: number; seed: number };

function batch<T extends Solid>(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, items: readonly T[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  for (const [index, { x, y, z, w, h, d, color: tint }] of items.entries()) {
    matrix.makeScale(w, h, d).setPosition(x, y, z);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, color.set(tint));
  }
  return mesh;
}

const plain = 3;
const asphalt = 0x525759;
const pavement = 0xc1b7a6;
const warmWhite = 0xe0d9c4;
const yellow = 0xe2b768;
const ground = RESIDENCE_STREET_LEVEL;

function layRoads(boxes: Solid[], paint: Solid[], trees: Solid[], lamps: Solid[], glow: Solid[]): void {
  function slab(to: Solid[], rect: CityRect, top: number, color: number, h = 0.12): void {
    const { minX, maxX, minZ, maxZ } = rect;
    to.push({ x: (minX + maxX) * 0.5, z: (minZ + maxZ) * 0.5, w: maxX - minX, d: maxZ - minZ, y: ground + top - h / 2, h, color });
  }

  for (const [i, area] of RESIDENCE_CITY_AREAS.entries()) slab(boxes, area, -0.15, i === 2 ? 0x8f8980 : 0x8b877d, 0.22);
  function road(rect: CityRect, alongZ: boolean, sidewalk: number): void {
    const insetX = alongZ ? sidewalk : 0;
    const insetZ = alongZ ? 0 : sidewalk;
    slab(boxes, {
      minX: rect.minX + insetX, maxX: rect.maxX - insetX,
      minZ: rect.minZ + insetZ, maxZ: rect.maxZ - insetZ,
    }, 0, asphalt);
    if (alongZ) {
      slab(boxes, { ...rect, maxX: rect.minX + insetX }, 0.16, pavement);
      slab(boxes, { ...rect, minX: rect.maxX - insetX }, 0.16, pavement);
    } else {
      const sides = rect.minX > RESIDENCE_AVENUE.maxX
        ? [[rect.minX, rect.maxX]] : [[rect.minX, 4.75], [34.25, rect.maxX]];
      for (const [minX, maxX] of sides) {
        slab(boxes, { minX, maxX, minZ: rect.minZ, maxZ: rect.minZ + insetZ }, 0.16, pavement);
        slab(boxes, { minX, maxX, minZ: rect.maxZ - insetZ, maxZ: rect.maxZ }, 0.16, pavement);
      }
    }
  }

  // In each block the avenue has planted islands. The islands break at cross streets.
  const sections = RESIDENCE_CROSS_STREETS.slice(1).map((street, i) => [RESIDENCE_CROSS_STREETS[i].maxZ, street.minZ]);
  road(RESIDENCE_SIDE_STREET, true, 1.5);
  road(RESIDENCE_EAST_RETURN, false, 1.2);
  for (const street of RESIDENCE_EAST_LANES) road(street, true, 2.0);
  for (const street of RESIDENCE_EAST_LINKS) road(street, false, 1.6);
  slab(boxes, { ...RESIDENCE_EAST_RETURN, minX: 44.5, maxX: 48, minZ: -3.8, maxZ: 2.8 }, 0.17, asphalt);
  for (const street of RESIDENCE_CROSS_STREETS) road(street, false, 3.4);
  for (const [minZ, maxZ] of sections) road({ ...RESIDENCE_AVENUE, minZ, maxZ }, true, 3.25);
  for (const { minZ, maxZ } of RESIDENCE_CROSS_STREETS) {
    slab(boxes, { minX: 4.75, maxX: 34.25, minZ, maxZ }, 0.012, asphalt);
  }

  for (const [start, end] of sections) {
    for (const x of [10, 14, 25, 29]) {
      for (let z = start + 9; z < end - 9; z += 13) {
        slab(paint, { minX: x - 0.09, maxX: x + 0.09, minZ: z, maxZ: z + 5.5 }, 0.022, warmWhite, 0.03);
      }
    }
    for (const x of [17.8, 21.2]) {
      slab(paint, { minX: x - 0.08, maxX: x + 0.08, minZ: start + 6, maxZ: end - 6 }, 0.023, yellow, 0.03);
    }
    slab(boxes, { minX: 18.25, maxX: 20.75, minZ: start + 11, maxZ: end - 11 }, 0.47, 0x918a7c);
    slab(boxes, { minX: 18.47, maxX: 20.53, minZ: start + 12, maxZ: end - 12 }, 0.55, 0x586a49);
  }

  for (const { minX, maxX, minZ, maxZ } of RESIDENCE_CROSS_STREETS) {
    const center = (minZ + maxZ) * 0.5;
    for (const z of [center - 4.1, center, center + 4.1]) {
      for (let x = minX + 3; x < maxX - 6; x += 13) {
        if (x > -6 && x < 38) continue;
        slab(paint, { minX: x, maxX: x + 5, minZ: z - 0.08, maxZ: z + 0.08 }, 0.022,
          z === center ? yellow : warmWhite, 0.03);
      }
    }
    for (const x of [1.3, 37.7]) {
      for (let z = minZ + 4.4; z < maxZ - 4.9; z += 1.55) {
        slab(paint, { minX: x - 1.75, maxX: x + 1.75, minZ: z, maxZ: z + 0.72 }, 0.022, warmWhite, 0.035);
      }
    }
    for (const z of [minZ + 1.4, maxZ - 1.4]) {
      for (let x = 5.2; x < 33.2; x += 1.62) {
        slab(paint, { minX: x, maxX: x + 0.70, minZ: z - 1.4, maxZ: z + 1.4 }, 0.025, warmWhite, 0.035);
      }
    }
  }

  const random = seededDetail(1334);
  function tree(x: number, z: number, size: number): void {
    const y = ground + 0.14;
    boxes.push({ x, z, y: y + size * 0.42, w: 0.46, d: 0.46, h: size * 0.84, color: 0x63574b });
    trees.push({ x, z, y: y + size * 0.86, w: size * 0.71, d: size * 0.65, h: size * 0.78,
      color: random() > 0.5 ? 0x697850 : 0x52674c });
    trees.push({ x: x + 0.18 * size, z: z - 0.09 * size, y: y + size * 0.73, w: size * 0.57, d: size * 0.56,
      h: size * 0.58, color: 0x627449 });
  }

  for (const [start, end] of sections) {
    for (let z = start + 19; z < end - 13; z += 15) {
      tree(3.1, z, 4.9 + random() * 2.1);
      tree(35.9, z + 4, 4.5 + random() * 2.2);
    }
  }
  for (const z of [4, 39.8, 164.2, 196.8, 266.1, 287.4]) {
    for (let x = -147; x < 150; x += 15) {
      if (x < -3 || x > 51) tree(x, z, 4.6 + random() * 1.7);
    }
  }
  for (const z of [-67.2, 5, 43.8, 116.4]) {
    for (let x = 175; x < 396; x += 14) {
      if (x < 218 || (x > 240 && x < 311) || x > 334) tree(x, z, 3.9 + random() * 2.2);
    }
  }
  slab(boxes, { minX: -44, maxX: 55, minZ: 725, maxZ: 749 }, 0.16, 0xa69b88);
  for (const x of [-25, -13, 27, 38]) tree(x, 735 + random() * 5, 7.3);

  function light(x: number, z: number, dx: number, dz: number, color: number): void {
    const y = ground + 7.5;
    const metal = 0x69716d;
    boxes.push({ x, z, y: ground + 3.75, w: 0.22, d: 0.22, h: 7.5, color: metal });
    boxes.push({ x: x + dx * 0.5, z: z + dz * 0.5, y, w: Math.abs(dx) + 0.22, d: Math.abs(dz) + 0.22, h: 0.15, color: metal });
    lamps.push({ x: x + dx, z: z + dz, y: y - 0.10, w: 0.78, d: 0.60, h: 0.095, color });
    glow.push({ x: x + dx * 2, z: z + dz * 2, y: ground + 0.055, w: 19, d: 16, h: 1, color });
  }

  for (const [start, end] of sections) {
    for (let z = start + 8; z < end - 4; z += 26) {
      light(3.8, z, 2.6, 0, 0xffd996);
      light(35.2, z + 4, -2.6, 0, 0xe2eeff);
    }
  }
  for (const { minX, maxX, minZ, maxZ } of RESIDENCE_CROSS_STREETS) {
    for (let x = minX + 9; x < maxX - 8; x += 26) {
      if (x > -8 && x < 45) continue;
      light(x, minZ + 2.8, 0, 2.0, 0xffc57b);
      light(x + 5, maxZ - 2.8, 0, -2.0, 0xffd995);
    }
  }
  for (let x = 57; x < 407; x += 26) light(x, 3.15, 0, -1.95, 0xffd996);
  for (const { minX } of RESIDENCE_EAST_LANES) {
    for (let z = -94; z < 140; z += 29) light(minX + 1.4, z, 2, 0, 0xffcb83);
  }
  for (const [x, z, dz] of [[-1.2, 165.4, 1.7], [40.2, 195.4, -1.7], [-1.2, 266.4, 1.7], [40.2, 286.8, -1.7]]) {
    boxes.push({ x, z, y: ground + 2.7, w: 0.22, d: 0.22, h: 5.4, color: 0x555d54 });
    boxes.push({ x, z: z + dz * 0.5, y: ground + 5.2, w: 0.19, d: Math.abs(dz) + 0.18, h: 0.18, color: 0x686e62 });
    boxes.push({ x, z: z + dz, y: ground + 4.84, w: 0.42, d: 0.42, h: 0.84, color: 0x47493c });
  }
}

function shapeBuildings(facades: Facade[], fittings: Solid[], detail: Solid[]): void {
  const random = seededDetail(6814);

  function body(x: number, z: number, w: number, d: number, low: number, high: number, color: number,
    kind: number, bay: number, floor: number, seed: number): void {
    facades.push({ x, z, w, d, y: ground + (low + high) / 2, h: high - low, color, kind, bay, floor, seed });
  }

  function trim(to: Solid[], x: number, z: number, w: number, d: number, low: number, high: number, color: number): void {
    to.push({ x, z, w, d, y: ground + (low + high) / 2, h: high - low, color });
  }

  function roof(x: number, z: number, w: number, d: number, height: number, glass: boolean): void {
    const cap = glass ? 0x88989b : 0xc0b8a7;
    const lip = height - 1.25;
    trim(fittings, x, z, w, d, lip - 0.50, lip, 0x807d74);
    for (const side of [-1, 1]) {
      trim(fittings, x + side * (w - 0.55) / 2, z, 0.55, d, lip, height, cap);
      trim(fittings, x, z + side * (d - 0.55) / 2, w - 1.10, 0.55, lip, height, cap);
    }
    for (let i = 0; i < 3; i += 1) {
      const ax = x + w * (i - 1) * 0.21;
      trim(fittings, ax, z + d * 0.16, w * 0.15, d * 0.16, lip - 0.17, lip + 0.85, 0xaeaead);
      for (let fin = -2; fin <= 2; fin += 1) {
        trim(detail, ax, z + d * (0.16 + fin * 0.017), w * 0.132, d * 0.008, lip + 0.84, lip + 0.95, 0x505a58);
      }
    }
    trim(fittings, x - w * 0.17, z - d * 0.18, w * 0.20, d * 0.25, lip, height, 0xb1aba0);
    trim(detail, x + w * 0.23, z - d * 0.18, w * 0.23, d * 0.045, lip, lip + 0.14, 0xaca388);
  }

  for (const { minX, maxX, minZ, maxZ, height, form, color } of RESIDENCE_CITY_BUILDINGS) {
    const x = (minX + maxX) * 0.5, z = (minZ + maxZ) * 0.5;
    const w = maxX - minX, d = maxZ - minZ;
    const glass = form === 'glass';
    const kind = glass ? 1 : form === 'ribbon' ? 2 : 0;
    const bay = glass ? 2.35 : 2.7 + random() * 0.75, floor = 3.37 + random() * 0.75;
    const tall = height > 100;
    const skirt = tall ? (glass ? 9.8 : 13) : 5.2;
    const seed = random();
    body(x, z, w, d, 0, skirt, glass ? 0x848f8e : color, tall ? 1 : 2, 3.64, 4.92, seed);
    trim(fittings, x, z, w, d, skirt - 0.18, skirt + 0.59, 0xa59f90);
    const shaftW = w - (tall ? 4.9 : 1.75), shaftD = d - (tall ? 5.7 : 1.75);
    const crown = height - (tall ? (glass ? 12.4 : 8.7) : 1.25);
    body(x, z, shaftW, shaftD, skirt, crown, color, kind, bay, floor, seed);
    if (tall) {
      const upperW = shaftW - (glass ? 1.7 : 5.4), upperD = shaftD - (glass ? 5.8 : 5.0);
      trim(fittings, x, z, shaftW + 0.34, shaftD + 0.34, crown - 0.36, crown + 0.38, glass ? 0x94a1a4 : 0xc5baaa);
      body(x, z, upperW, upperD, crown, height - 1.25, color, glass ? 2 : plain, bay, floor, seed + 0.69);
      roof(x, z, upperW, upperD, height, glass);
      for (const side of [-1, 1]) {
        if (kind === 0) {
          trim(fittings, x, z, shaftW + 0.60, shaftD + 0.60, crown - 23.5, crown - 22.9, color);
          trim(fittings, x + side * (shaftW / 2 - 0.9), z, 1.36, shaftD + 0.52, skirt, crown, color);
        } else if (glass) {
          trim(fittings, x + side * (shaftW / 2 - 1.4), z, 0.8, shaftD + 0.63, skirt, crown, 0x9ca8a9);
          trim(fittings, x, z + side * (shaftD / 2 - 0.7), shaftW + 0.53, 0.76, skirt, crown, 0x9ca8a9);
        }
      }
    } else {
      roof(x, z, shaftW, shaftD, height, glass);
    }

    // Lower entrance canopies leave the podium roof and adjacent sidewalks readable.
    const front = minZ + 1.2;
    trim(fittings, x, front, Math.min(12, w * 0.56), 3.8, 3.6, 3.88, glass ? 0x596d76 : 0x7c7669);
    for (const px of [-0.25, 0.25]) {
      trim(detail, x + w * px, front - 1.5, 0.32, 0.32, 0, 3.74, color);
    }
  }

  // The occupied level stays open for the interior shell. Its tower carries on below and above it.
  body(5.4, -17, 34.8, 34, 0, 15, 0xb5afa7, 0, 3.48, 5, 0.52);
  body(5.4, -17, 34.8, 34, 15, 175.69, 0x858f8f, 2, 3.48, 3.5, 0.42);
  body(5.4, -17, 34.8, 34, 179.25, 214.25, 0x858f8f, 2, 3.48, 3.5, 0.32);
  roof(5.4, -17, 33.5, 32.7, 215.5, false);
}

export function createResidenceNeighborhood(night: THREE.IUniform<number>) {
  const group = new THREE.Group();
  group.name = 'Residence neighborhood';
  const facadeMaterial = createDistrictMaterial(night, true);
  const shade = createDistrictShadows();
  const material = createDistrictMaterial(night, false, shade);
  const facades: Facade[] = [];
  const boxes: Solid[] = [];
  const markings: Solid[] = [];
  const trees: Solid[] = [];
  const lamps: Solid[] = [];
  const pools: Solid[] = [];
  const detail: Solid[] = [];
  layRoads(boxes, markings, trees, lamps, pools);
  shapeBuildings(facades, boxes, detail);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const walls = new THREE.BoxGeometry(1, 1, 1);
  walls.setAttribute('districtFacade', new THREE.InstancedBufferAttribute(new Float32Array(
    facades.flatMap(({ bay, floor, kind, seed }) => [bay, floor, kind, seed]),
  ), 4));
  const detailMesh = batch('Roof equipment and entrance fittings', box, material, detail);
  const lampMeshes = batch('Street luminaires', box, new THREE.MeshBasicMaterial(), lamps);
  const poolGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const poolMesh = batch('Illuminated pavement beneath the lamps', poolGeometry, createStreetGlowMaterial(), pools);
  const paint = createDistrictMaterial(night, false, shade);
  paint.polygonOffset = true;
  paint.polygonOffsetFactor = -1;
  paint.polygonOffsetUnits = -3;
  poolMesh.renderOrder = 1;
  group.add(
    batch('Original 3D building volumes and storeys', walls, facadeMaterial, facades),
    batch('Walls, roof structures and paved surfaces', box, material, boxes),
    batch('Lane markings and pedestrian crossings', box, paint, markings),
    batch('Street tree crowns', new THREE.IcosahedronGeometry(0.5, 1), material, trees),
    detailMesh,
    lampMeshes,
    poolMesh,
  );
  return {
    group,
    setNight(dark: boolean) {
      lampMeshes.visible = poolMesh.visible = dark;
    },
    setQuality(high: boolean) {
      detailMesh.visible = high;
    },
    dispose() {
      shade.texture.dispose();
    },
  };
}
