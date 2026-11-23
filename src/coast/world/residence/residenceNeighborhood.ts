import * as THREE from 'three';
import { seededDetail } from '../overlook/overlookModel';
import {
  createDistrictMaterial, createDistrictShadows, createDistrictSurfaceTexture, createStreetGlowMaterial, DISTRICT_SURFACE,
} from './residenceCityMaterials';
import {
  RESIDENCE_DISTRICT_ROADS, RESIDENCE_STREET_LEVEL, type CityRect, type DistrictBuilding, type DistrictRoad,
} from './residenceCityPlan';
import { shapeDistrictBuildings, type DistrictFacade, type DistrictSolid } from './residenceDistrictBuildings';
import type { DistrictYard } from './residenceDistrictGround';

function batch(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, items: readonly DistrictSolid[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const angles = new THREE.Euler();
  const scale = new THREE.Vector3();
  for (const [index, { x, y, z, w, h, d, color: tint, yaw = 0, tilt = 0 }] of items.entries()) {
    matrix.makeRotationFromEuler(angles.set(tilt, yaw, 0)).scale(scale.set(w, h, d)).setPosition(x, y, z);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, color.set(tint));
  }
  return mesh;
}

const asphalt = 0x555758;
const pavement = 0xb5aa97;
const warmWhite = 0xd8d0b8;
const yellow = 0xd5a85a;
const ground = RESIDENCE_STREET_LEVEL;
const { vegetation, pavingStone } = DISTRICT_SURFACE;

function coordinates({ minX, maxX, minZ, maxZ }: CityRect, alongZ: boolean) {
  return alongZ ? { from: minZ, to: maxZ, left: minX, right: maxX }
    : { from: minX, to: maxX, left: minZ, right: maxZ };
}

function laneRect(alongZ: boolean, left: number, right: number, from: number, to: number): CityRect {
  return alongZ ? { minX: left, maxX: right, minZ: from, maxZ: to }
    : { minX: from, maxX: to, minZ: left, maxZ: right };
}

function openSegments(road: DistrictRoad, network: readonly DistrictRoad[], lateral: number, space: number): [number, number][] {
  const { from, to } = coordinates(road.rect, road.alongZ);
  let pieces: [number, number][] = [[from, to]];
  for (const other of network) {
    if (other === road || road.alongZ === other.alongZ) continue;
    const crossing = coordinates(other.rect, road.alongZ);
    if (lateral < crossing.left - space || lateral > crossing.right + space) continue;
    const begin = crossing.from - space, end = crossing.to + space;
    pieces = pieces.flatMap(([low, high]) => {
      if (end <= low || begin >= high) return [[low, high]];
      const next: [number, number][] = [];
      if (begin > low) next.push([low, begin]);
      if (end < high) next.push([end, high]);
      return next;
    });
  }
  return pieces;
}

function layRoads(
  roads: DistrictSolid[], medians: DistrictSolid[], boxes: DistrictSolid[], paint: DistrictSolid[], trees: DistrictSolid[], lamps: DistrictSolid[],
  glow: DistrictSolid[], yards: readonly DistrictYard[],
): void {
  function slab(to: DistrictSolid[], rect: CityRect, top: number, color: number, h = 0.12, surface = 0): void {
    const { minX, maxX, minZ, maxZ } = rect;
    to.push({ x: (minX + maxX) * 0.5, z: (minZ + maxZ) * 0.5, w: maxX - minX, d: maxZ - minZ,
      y: ground + top - h / 2, h, color, surface });
  }

  const network = RESIDENCE_DISTRICT_ROADS;
  const avenue = network[0];
  const cross = network.slice(1, 9);
  for (const yard of yards) {
    const platform = yard.surface === 'platform';
    const paving = yard.surface === 'paving';
    slab(boxes, yard, platform ? 0.159 : -0.092, platform ? 0xa9a08e : paving ? 0x959083 : 0x85827a,
      0.22, platform || paving ? pavingStone : DISTRICT_SURFACE.asphalt);
  }
  const random = seededDetail(1334);

  for (const { rect: vertical } of network.filter(road => road.alongZ)) {
    for (const { rect: horizontal } of network.filter(road => !road.alongZ)) {
      const minX = Math.max(vertical.minX, horizontal.minX), maxX = Math.min(vertical.maxX, horizontal.maxX);
      const minZ = Math.max(vertical.minZ, horizontal.minZ), maxZ = Math.min(vertical.maxZ, horizontal.maxZ);
      if (minX >= maxX || minZ >= maxZ) continue;
      slab(roads, { minX, maxX, minZ, maxZ }, -0.012, asphalt, 0.169, DISTRICT_SURFACE.asphalt);
    }
  }

  function tree(x: number, z: number, size: number): void {
    const y = ground + 0.16;
    boxes.push({ x, z, y: y + size * 0.44, w: 0.37, d: 0.36, h: size * 0.88, color: 0x746354 });
    trees.push({ x, z, y: y + size * 0.86, w: size * 0.72, d: size * 0.65, h: size * 0.83,
      color: random() > 0.5 ? 0x6c7b54 : 0x526b50, surface: vegetation, yaw: random() * Math.PI });
    if (Math.hypot(x - 30, z * 0.78) > 430) return;
    trees.push({ x: x + 0.16 * size, z: z - 0.19 * size, y: y + size * 0.73, w: size * 0.56, d: size * 0.58,
      h: size * 0.54, color: 0x718255, surface: vegetation });
    trees.push({ x: x - 0.17 * size, z: z + 0.17 * size, y: y + size * 0.81, w: size * 0.44, d: size * 0.52,
      h: size * 0.52, color: 0x7e8859, surface: vegetation });
  }

  function lamp(x: number, z: number, dx: number, dz: number, color: number, height: number): void {
    const y = ground + height;
    boxes.push({ x, z, y: ground + height * 0.5, w: 0.18, d: 0.18, h: height, color: 0x69726d });
    boxes.push({ x: x + dx * 0.5, z: z + dz * 0.5, y, w: Math.abs(dx) + 0.19,
      d: Math.abs(dz) + 0.19, h: 0.16, color: 0x626d66 });
    lamps.push({ x: x + dx, z: z + dz, y: y - 0.10, w: 0.83, d: 0.64, h: 0.15, color });
    glow.push({ x: x + dx * 2.05, z: z + dz * 2.05, y: ground + 0.043, w: 17, d: 15, h: 1, color });
  }

  for (const [index, road] of network.entries()) {
    const { alongZ, walk } = road;
    const { left, right } = coordinates(road.rect, alongZ);
    const center = (left + right) * 0.5;
    // Trim sidewalk and curb strips against each complete crossing to leave a paved
    // intersection. The horizontal and vertical road beds then meet at the corner.
    slab(roads, road.carriageway, 0, asphalt, 0.18, DISTRICT_SURFACE.asphalt);
    for (const [corner, direction] of [[left, 1], [right, -1]]) {
      const curb = corner + direction * walk;
      const walkLeft = Math.min(corner, curb), walkRight = Math.max(corner, curb);
      for (const [begin, end] of openSegments(road, network, corner + direction * walk * 0.5, 0)) {
        slab(boxes, laneRect(alongZ, walkLeft, walkRight, begin, end), 0.181, pavement, 0.30, DISTRICT_SURFACE.pavement);
        slab(boxes, laneRect(alongZ, curb - 0.145, curb + 0.145, begin, end), 0.203, 0xbab3a2, 0.21, pavingStone);
      }
      if (index === 0) {
        for (const [begin, end] of openSegments(road, network, corner, 0)) {
          const back = corner - direction * 4.75;
          slab(boxes, laneRect(alongZ, Math.min(corner, back), Math.max(corner, back), begin, end), 0.156,
            0x9e9687, 0.28, pavingStone);
        }
      }
      for (const [begin, end] of openSegments(road, network, corner, 7.4)) {
        const step = index === 0 ? 19 : index <= cross.length ? 31 : 43;
        for (let position = begin + 3.4 + random() * 6; position < end - 1.8; position += step + random() * 3) {
          const y = corner + direction * 0.95;
          const x = alongZ ? y : position, z = alongZ ? position : y;
          const size = (index === 0 ? 4.8 : 3.9) + random() * 2.5;
          if (walk >= 2 && random() > 0.43 && Math.hypot(x - 40, z * 0.65) < 980) {
            slab(boxes, { minX: x - 0.94, maxX: x + 0.94, minZ: z - 0.92, maxZ: z + 0.92 },
              0.219, 0x6c6d51, 0.16, vegetation);
            tree(x, z, size);
          }
          if ((direction > 0 || index < 5) && Math.hypot(x - 40, z * 0.62) < 1380) {
            const warm = index % 5 === 0 ? 0xffd79f : index % 3 === 0 ? 0xffcd8d : 0xeeefff;
            lamp(x + (alongZ ? 0 : 4.4), z + (alongZ ? 4.4 : 0), alongZ ? direction * 2.22 : 0,
              alongZ ? 0 : direction * 2.22, warm, index < 7 ? 7.2 : 5.9);
          }
        }
      }
    }

    const widths = index === 0 ? [center - 9.4, center - 5.5, center + 5.5, center + 9.4]
      : right - left > 25 ? [center - 4.2, center, center + 4.2] : [center];
    for (const lateral of widths) {
      for (const [begin, end] of openSegments(road, network, lateral, index === 0 ? 5 : 3.2)) {
        for (let position = begin + 2.4; position + 4.7 < end; position += index < 7 ? 12 : 8) {
          slab(paint, laneRect(alongZ, lateral - 0.086, lateral + 0.086, position, position + (index < 7 ? 5.1 : 3.2)),
            0.016, lateral === center ? yellow : warmWhite, 0.024);
        }
      }
    }
  }

  for (const [begin, end] of openSegments(avenue, network, 19.5, 9)) {
    if (end - begin < 13) continue;
    for (const x of [17.75, 21.25]) {
      slab(paint, laneRect(true, x - 0.097, x + 0.097, begin - 4.4, end + 4.4), 0.018, yellow, 0.026);
    }
    slab(medians, laneRect(true, 18.23, 20.77, begin, end), 0.41, 0xb7ae98, 0.60, DISTRICT_SURFACE.pavement);
    slab(medians, laneRect(true, 18.43, 20.57, begin + 0.4, end - 0.4), 0.48, 0x67764e, 0.18, vegetation);
    for (let z = begin + 9; z < end - 4; z += 16.2) {
      const h = 1.4 + random() * 1.6;
      trees.push({ x: 19.5, z, y: ground + 0.46 + h * 0.46, w: 1.64, d: 2.24, h, color: 0x758654, surface: vegetation });
    }
  }

  for (const { rect: { minX, maxX, minZ, maxZ }, walk } of cross) {
    for (const x of [1.5, 37.5, 154.5]) {
      if (x > maxX - 4 || x < minX + 4) continue;
      for (let z = minZ + walk + 0.68; z < maxZ - walk - 0.82; z += 1.44) {
        slab(paint, { minX: x - 2.25, maxX: x + 2.25, minZ: z, maxZ: z + 0.64 }, 0.021, warmWhite, 0.027);
      }
    }
    for (const side of [-1, 1]) {
      const z = side > 0 ? maxZ + 2.58 : minZ - 2.58;
      if (z - 2 < avenue.from || z + 2 > avenue.to) continue;
      for (let x = 5.2; x < 33.2; x += 1.57) {
        slab(paint, { minX: x, maxX: x + 0.77, minZ: z - 1.35, maxZ: z + 1.35 }, 0.021, warmWhite, 0.027);
      }
      const stop = z + side * 2.45;
      for (const [left, right] of [[5.0, 17.6], [21.4, 34.0]]) {
        slab(paint, { minX: left, maxX: right, minZ: stop - 0.24, maxZ: stop + 0.24 }, 0.024, warmWhite, 0.026);
      }
      if (maxZ - minZ < 20 || minZ > 750) continue;
      for (const x of side > 0 ? [7.1, 12.3, 16.3] : [22.9, 27.3, 31.7]) {
        const middle = z + side * 8.2;
        slab(paint, { minX: x - 0.125, maxX: x + 0.125, minZ: middle - 1.42, maxZ: middle + 1.42 },
          0.022, warmWhite, 0.026);
        for (const yaw of [-0.56, 0.56]) {
          paint.push({ x: x + Math.sign(yaw) * 0.35, z: middle - side * 1.31, y: ground + 0.011,
            w: 0.22, h: 0.025, d: 1.32, yaw: yaw * side, color: warmWhite });
        }
      }
    }
  }

}

export function createResidenceNeighborhood(night: THREE.IUniform<number>,
  { buildings, paved }: { buildings: readonly DistrictBuilding[]; paved: readonly DistrictYard[] }) {
  const group = new THREE.Group();
  group.name = 'Residence neighborhood';
  const shade = createDistrictShadows(buildings);
  const surface = createDistrictSurfaceTexture();
  const facadeMaterial = createDistrictMaterial(night, { facades: true, surface });
  const material = createDistrictMaterial(night, { shade, surface, paving: true });
  const untextured = createDistrictMaterial(night, { shade });
  const facades: DistrictFacade[] = [];
  const roads: DistrictSolid[] = [];
  const medians: DistrictSolid[] = [];
  const boxes: DistrictSolid[] = [];
  const markings: DistrictSolid[] = [];
  const trees: DistrictSolid[] = [];
  const lamps: DistrictSolid[] = [];
  const pools: DistrictSolid[] = [];
  const detail: DistrictSolid[] = [];
  const machinery: DistrictSolid[] = [];
  layRoads(roads, medians, boxes, markings, trees, lamps, pools, paved);
  shapeDistrictBuildings(facades, boxes, detail, trees, machinery, lamps, buildings);

  function surfaceGeometry(geometry: THREE.BufferGeometry, instances: readonly DistrictSolid[]) {
    geometry.setAttribute('districtSurface', new THREE.InstancedBufferAttribute(new Float32Array(
      instances.map(({ surface = 0 }) => surface),
    ), 1));
    return geometry;
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  const walls = new THREE.BoxGeometry(1, 1, 1);
  walls.setAttribute('districtFacade', new THREE.InstancedBufferAttribute(new Float32Array(
    facades.flatMap(({ bay, floor, kind, seed }) => [bay, floor, kind, seed]),
  ), 4));
  const detailMesh = batch('Roof equipment and entrance fittings', box, untextured, detail);
  const lampMeshes = batch('Street and roof luminaires', box, new THREE.MeshBasicMaterial(), lamps);
  const poolGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const poolMesh = batch('Illuminated pavement beneath the lamps', poolGeometry, createStreetGlowMaterial(), pools);
  const paint = createDistrictMaterial(night, { shade });
  paint.polygonOffset = true;
  paint.polygonOffsetFactor = -1;
  paint.polygonOffsetUnits = -3;
  poolMesh.renderOrder = 1;
  group.add(
    batch('Original stone, curtain-wall, ribbon and balcony facades', walls, facadeMaterial, facades),
    batch('Authored district asphalt lanes and junctions', surfaceGeometry(box.clone(), roads), material, roads),
    batch('South avenue median islands', surfaceGeometry(box.clone(), medians), material, medians),
    batch('Roof terraces, curb stones and paving', surfaceGeometry(box.clone(), boxes), material, boxes),
    batch('Lane markings and pedestrian crossings', box, paint, markings),
    batch('Street trees and rooftop planting', surfaceGeometry(new THREE.IcosahedronGeometry(0.5, 1), trees), material, trees),
    batch('Roof ventilation housings', new THREE.CylinderGeometry(0.5, 0.5, 1, 12), untextured, machinery),
    detailMesh,
    lampMeshes,
    poolMesh,
  );
  return {
    group,
    shade,
    surface,
    setNight(dark: boolean) {
      lampMeshes.visible = poolMesh.visible = dark;
    },
    setQuality(high: boolean) {
      detailMesh.visible = high;
    },
    dispose() {
      shade.texture.dispose();
      surface.dispose();
    },
  };
}
