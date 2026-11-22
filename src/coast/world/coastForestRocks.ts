import * as THREE from 'three';
import { coastRandom, coastTrailDistance, forestStreamDistance, groundHeight, groundSlope } from '../terrain';

function fractureGeometry(seed: number): THREE.BufferGeometry {
  const random = coastRandom(seed);
  const corners = 11;
  const rings = [-0.44, -0.18, 0.05, 0.43, 0.76, 1.0];
  const profile = [0.71, 0.98, 1.0, 0.95, 0.79, 0.37];
  const tilt = random() * 0.36 - 0.18;
  const cuts = Array.from({ length: corners }, () => 0.73 + random() * 0.35);
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  for (let row = 0; row < rings.length; row += 1) {
    const y = rings[row];
    for (let i = 0; i <= corners; i += 1) {
      const corner = i % corners;
      const angle = corner / corners * Math.PI * 2 - y * 0.27;
      const radius = profile[row] * cuts[corner];
      positions.push(Math.cos(angle) * radius + tilt * y,
        y + 0.096 * Math.sin(angle * 3 + row * 0.92), Math.sin(angle) * radius * (0.94 + 0.09 * y));
      uvs.push(i / corners * 2.5, (y + 0.44) * 1.75);
      if (row === 0 || i === corners) continue;
      const a = (row - 1) * (corners + 1) + i;
      const b = row * (corners + 1) + i;
      if ((row + i) % 2) indices.push(a, b, a + 1, b, b + 1, a + 1);
      else indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const rim = (rings.length - 1) * (corners + 1);
  const peak = positions.length / 3;
  positions.push(tilt, 0.97, 0.04);
  uvs.push(1.25, 2.61);
  for (let i = 0; i < corners; i += 1) indices.push(peak, rim + i + 1, rim + i);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createForestRocks(moss: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Karst fragments and stream cobbles';
  const material = new THREE.MeshStandardMaterial({ map: moss, bumpMap: moss, bumpScale: 0.13, roughness: 0.85 });
  const wet = new THREE.MeshStandardMaterial({ map: moss, bumpMap: moss, bumpScale: 0.062, roughness: 0.42 });
  const dryPieces: { x: number; z: number; size: number; height: number }[] = [];
  const wetPieces: typeof dryPieces = [];
  const random = coastRandom(101826);
  const boulderBeds = [
    { x: -40, z: 140, spread: 12, count: 17, maxSize: 3.1 },
    { x: 5, z: 200, spread: 32, count: 45, maxSize: 3.2 },
    { x: -44, z: 254, spread: 25, count: 40, maxSize: 3.1 },
    { x: -66, z: 305, spread: 23, count: 55, maxSize: 5.0 },
    { x: 22, z: 256, spread: 34, count: 75, maxSize: 1.75 },
    { x: 73, z: 288, spread: 33, count: 69, maxSize: 3.0 },
    { x: 88, z: 316, spread: 24, count: 35, maxSize: 3.9 },
    { x: 12, z: 383, spread: 34, count: 37, maxSize: 2.4 },
  ];
  for (const bed of boulderBeds) {
    for (let i = 0; i < bed.count; i += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * bed.spread;
      const x = bed.x + Math.cos(angle) * distance;
      const z = bed.z + Math.sin(angle) * distance;
      const size = 0.19 + Math.pow(random(), 2.35) * bed.maxSize;
      if (coastTrailDistance(x, z) < 1.7 + size || groundHeight(x, z) < 6
        || (size > 0.7 && groundSlope(x, z, 1.1) > 0.8)) continue;
      const isWet = forestStreamDistance(x, z) < 1.3;
      (isWet ? wetPieces : dryPieces).push({ x, z, size, height: size * (isWet ? 0.34 : 0.47 + 0.66 * random()) });
    }
  }
  dryPieces.push(
    { x: -9.7, z: 393.5, size: 2.7, height: 0.64 },
  );
  const dummy = new THREE.Object3D();
  for (let form = 0; form < 4; form += 1) {
    const geometry = fractureGeometry(30427 + form * 81);
    for (const [placements, finish] of [[dryPieces, material], [wetPieces, wet]] as const) {
      const pieces = placements.filter((_, index) => index % 4 === form);
      const batch = new THREE.InstancedMesh(geometry, finish, pieces.length);
      pieces.forEach(({ x, z, size, height }, index) => {
        dummy.position.set(x, groundHeight(x, z) - height * 0.14, z);
        dummy.rotation.set((random() - 0.5) * 0.14, random() * Math.PI * 2, (random() - 0.5) * 0.18);
        dummy.scale.set(size, height, size * (0.62 + random() * 0.61));
        dummy.updateMatrix();
        batch.setMatrixAt(index, dummy.matrix);
        const tone = 0.72 + 0.28 * random();
        batch.setColorAt(index, new THREE.Color(tone, tone * 1.01, tone * 0.96));
      });
      batch.castShadow = batch.receiveShadow = true;
      group.add(batch);
    }
  }
  return group;
}
