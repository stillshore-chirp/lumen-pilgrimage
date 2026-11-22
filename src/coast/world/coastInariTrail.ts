import * as THREE from 'three';
import { INARI_COURT, INARI_INNER_COURT, INARI_WALKS, coastRandom, groundHeight, type CoastPoint } from '../terrain';
import { createInariArchitecture, type InariGatePlacement, type InariPlacement } from './coastInariModels';
import { createInariGrove } from './coastInariGrove';
import { loadCoastTexture } from './coastSurface';

const [entrance, west, east] = INARI_WALKS;

function placement(x: number, z: number, yaw: number): InariPlacement {
  return { x, z, yaw, y: groundHeight(x, z) };
}

function atZ(points: readonly CoastPoint[], z: number): InariPlacement {
  const next = points.findIndex(point => point.z >= z);
  const a = points[next - 1], b = points[next];
  const along = (z - a.z) / (b.z - a.z);
  return placement(THREE.MathUtils.lerp(a.x, b.x, along), z, Math.atan2(b.x - a.x, b.z - a.z));
}

function stations(points: readonly CoastPoint[], spacing: number, start: number, end: number): InariPlacement[] {
  const result: InariPlacement[] = [];
  let travelled = 0;
  let next = spacing * 0.5;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    while (next <= travelled + length) {
      const along = (next - travelled) / length;
      const z = a.z + along * dz;
      if (z >= start && z <= end) result.push(placement(a.x + along * dx, z, Math.atan2(dx, dz)));
      next += spacing;
    }
    travelled += length;
  }
  return result;
}

function across(at: InariPlacement, distance: number, forward = 0): InariPlacement {
  const sine = Math.sin(at.yaw), cosine = Math.cos(at.yaw);
  return placement(at.x + cosine * distance + sine * forward, at.z - sine * distance + cosine * forward, at.yaw);
}

function stonework(texture: THREE.Texture, normal: THREE.Texture): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    map: texture, normalMap: normal, normalScale: new THREE.Vector2(0.53, 0.53), roughness: 0.9,
  });
  const courses = [
    { positions: stations(entrance.points, 0.83, 895, 947), length: 0.83, width: 3.2, columns: 3 },
    { positions: stations(west.points, 0.41, 952, 1028), length: 0.41, width: 2.41, columns: 2 },
    { positions: stations(east.points, 0.39, 952, 1028), length: 0.39, width: 2.41, columns: 2 },
  ];
  const courtColumns = 10, courtRows = 13;
  const courtWidth = 0.815, courtLength = 0.84;
  const edging = courses[0].positions.filter(row => row.z > 902 && row.z < 944 && (row.z < 917.7 || row.z > 929));
  const count = courses.reduce((total, course) => total + course.positions.length * course.columns, 0)
    + courtColumns * courtRows + 20 + edging.length * 2;
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = 'Worn granite paving and uphill stairs';
  mesh.castShadow = mesh.receiveShadow = true;
  const random = coastRandom(187734);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  let index = 0;
  function set(at: InariPlacement, width: number, length: number, rise: number, reveal: number): void {
    const left = width * 0.47, front = length * 0.48;
    const upper = Math.max(at.y, across(at, -left, front).y, across(at, left, front).y,
      across(at, -left, -front).y, across(at, left, -front).y);
    transform.position.set(at.x, upper - rise * 0.5 + reveal, at.z);
    transform.rotation.set(0, at.yaw, 0);
    transform.scale.set(width - 0.016, rise, length - 0.016);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    color.setScalar(0.79 + random() * 0.26);
    mesh.setColorAt(index++, color);
  }
  for (const { positions, length, width, columns } of courses) {
    const tile = width / columns;
    for (const row of positions) {
      if (row.z >= 918.1 && row.z <= 928.8) continue;
      const seam = (random() - 0.5) * 0.17;
      for (let col = 0; col < columns; col += 1) {
        const left = tile * col - width * 0.5 + (col > 0 ? seam : 0);
        const right = tile * (col + 1) - width * 0.5 + (col + 1 < columns ? seam : 0);
        const at = across(row, (left + right) / 2);
        set(at, right - left, length, 0.44, 0.054);
      }
    }
  }
  for (const row of edging) {
    set(across(row, -1.68), 0.18, 0.84, 0.34, 0.083);
    set(across(row, 1.68), 0.18, 0.84, 0.34, 0.083);
  }
  for (let row = 0; row < courtRows; row += 1) {
    const z = INARI_COURT.z + (row - 6) * courtLength + 0.42;
    for (let col = 0; col < courtColumns; col += 1) {
      const x = INARI_COURT.x + (col - 4.5) * courtWidth + 0.85 + (row % 2) * courtWidth * 0.5;
      set(placement(x, z, 0), courtWidth, courtLength, 0.17, 0.031);
    }
  }
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      set(placement(INARI_INNER_COURT.x + (col - 1.5) * 0.78, 1034.1 + row * 0.71, 0), 0.78, 0.71, 0.22, 0.051);
    }
  }
  mesh.count = index;
  return mesh;
}

export function createInariTrail(wood: THREE.Texture): THREE.Group {
  const granite = loadCoastTexture('trail-granite.webp');
  const graniteNormal = loadCoastTexture('trail-granite-normal.webp');
  graniteNormal.colorSpace = THREE.NoColorSpace;
  const random = coastRandom(835556);
  const main = atZ(entrance.points, 901.3);
  const gate = atZ(entrance.points, 913.2);
  const firstRow = [west, east].flatMap((lane, i) =>
    stations(lane.points, i === 0 ? 1.39 : 1.48, 955, 1025).map((at): InariGatePlacement => ({
      ...at, y: at.y - 0.08, scale: 0.98 + random() * 0.12, style: 'path',
    })));
  // Wider gateways mark the entrances to the two parallel stairs.
  const pair = [west, east].map((lane): InariGatePlacement => ({
    ...atZ(lane.points, 952.7), scale: 1.12, style: 'path',
  }));
  const group = new THREE.Group();
  group.name = 'Vermilion trail';
  group.add(
    stonework(granite, graniteNormal),
    createInariGrove(wood),
    createInariArchitecture({
      gates: [{ ...main, style: 'main' }, ...pair, ...firstRow],
      buildings: [
        { ...gate, y: gate.y - 0.09, kind: 'roumon' },
        { ...placement(204.2, 923.6, -1.06), kind: 'worship' },
        { ...placement(253.9, 1038.9, -0.10), kind: 'small' },
      ],
      lanterns: [
        across(main, -4.0, -1.9), across(main, 4.0, -1.9),
        across(gate, -4.9, -3.0), across(gate, 4.9, -3.0),
        placement(211.5, 925.3, 0.23), placement(224.1, 924.6, -0.63),
        placement(249.6, 1036.7, 0.24), placement(257.9, 1036.6, -0.26),
      ],
    }, granite, graniteNormal),
  );
  return group;
}
