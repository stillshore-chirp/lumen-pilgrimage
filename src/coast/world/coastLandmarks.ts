import * as THREE from 'three';
import { coastRandom, coastTrailDistance, coastWaterLevel, forestStreamDistance, groundHeight, groundSlope, smoothstep } from '../terrain';
import { type CoastScenery, type CoastSceneryName } from './coastSceneryAssets';

type Rock = readonly [kind: CoastSceneryName, x: number, z: number, yaw: number, width: number, height: number];
type FernBed = readonly [x: number, z: number, radius: number, count: number, size: number];

const landmarks: readonly { name: string; rocks: readonly Rock[]; ferns?: readonly FernBed[] }[] = [
  {
    name: 'Limestone banks on the way down to the western wash',
    rocks: [
      ['rockShelf', -44, 51, 0.82, 1.5, 1.29], ['moss05', -37, 43, 2.7, 1.14, 1.14],
      ['moss02', -56, 35, -0.42, 2.34, 3.1], ['rockBoulder', -55, 32, 0.93, 2.23, 2.46],
      ['rockShelf', -46, 26, 1.2, 1.14, 0.69], ['moss03', -62, 19, -1.2, 2.31, 2.89],
      ['moss06', -63, 13, -0.07, 1.68, 1.83], ['rockShelf', -53, 10, -0.41, 1.14, 1.03],
      ['moss04', -67, -2, 0.75, 2.13, 2.9], ['rockShelf', -57, -10, 0.50, 1.63, 1.38],
      ['moss01', -74, -24, 1.93, 1.66, 2.45], ['moss05', -81, -28, 0.23, 2.77, 3.85],
      ['rockShelf', -74, -42, -2.48, 0.94, 1.17], ['moss02', -90, -53, -0.7, 2.74, 3.38],
    ],
    ferns: [[-46, 54, 3.4, 15, 1.25], [-55, 35, 2.8, 10, 1.4], [-61, 21, 3.5, 14, 1.4],
      [-64.5, -0.4, 4.25, 16, 1.55], [-68, 6, 2.85, 15, 1.55], [-71, -17, 4.4, 17, 1.4],
      [-76.5, -25.5, 3.2, 12, 1.45]],
  },
  {
    name: 'Tidal shelves and the eastern cliff foot',
    rocks: [
      ['rockShelf', 42.9, 39.2, -0.5, 1.5, 1.10], ['moss03', 46.3, 41.6, 0.6, 0.82, 0.55],
      ['rockShelf', 52.1, 35.6, 1.3, 0.94, 0.76], ['moss06', 54.4, 27.7, -0.91, 0.99, 0.84],
      ['rockShelf', 48.7, 25.1, 0.76, 0.91, 0.67], ['moss01', 53.5, 16, 2.22, 1.45, 0.85],
      ['rockShelf', 59, 10, 1.4, 1.7, 1.22], ['rockBoulder', 72.4, 17, -1.5, 2.2, 3.1],
      ['moss04', 73.5, 12.2, -2.3, 2.15, 2.7], ['rockShelf', 65.1, -3.3, 0.4, 0.81, 1.1],
      ['moss03', 80.7, -11.6, 1.7, 2.28, 3.15], ['moss06', 81.1, -19.1, -0.2, 1.79, 2.4],
      ['rockShelf', 73.0, -32.7, -0.95, 1.28, 1.1], ['moss05', 91.9, -36.4, 1.59, 2.92, 3.7],
    ],
    ferns: [[53, 43, 2.9, 12, 1.06], [55, 30, 1.8, 13, 1.27], [62, 41, 2.3, 12, 1.38],
      [70.5, 17.2, 2.5, 11, 1.22], [82, -13, 3.1, 12, 1.35]],
  },
  {
    name: 'Enclosed forest approach and the buttress-root fork',
    rocks: [
      ['moss05', -33.1, 143, 1.1, 1.33, 1.05], ['moss03', -38.9, 152.3, -0.3, 2.8, 2.19],
      ['moss04', -36.4, 156.5, 0.69, 2.6, 2.8], ['moss01', -32.8, 159, -0.82, 2.13, 2.3],
      ['moss06', -17.2, 164, -0.25, 1.73, 1.51], ['moss02', -17.5, 185, 0.93, 1.27, 1.1],
      ['moss06', -1.6, 182.5, 2.3, 2.0, 1.53], ['moss04', -18.8, 198.5, 0.18, 2.35, 2.85],
      ['moss01', -26.9, 206.2, -1.22, 2.48, 2.7], ['moss05', -20.1, 213.2, 2.06, 1.85, 1.65],
      ['moss03', -0.8, 222.0, -0.53, 1.6, 1.31], ['moss01', -9.3, 225.9, 2.31, 2.22, 1.58],
      ['moss04', -0.1, 228.7, -0.47, 2.08, 2.6], ['moss06', -6.4, 225.5, 1.57, 1.48, 1.22],
      ['moss02', 12.4, 227.2, 0.47, 1.72, 1.01],
      ['moss04', 24.1, 228.2, -1.61, 1.86, 2.24], ['moss05', 33.6, 232.5, 0.8, 1.69, 1.56],
    ],
    ferns: [[-35, 152, 5.3, 20, 1.5], [-20, 162, 4.25, 19, 1.65], [-16, 182, 5.1, 24, 1.68],
      [-1, 194, 4.5, 23, 1.59], [-20, 204, 4.3, 19, 1.65], [-14, 218, 4.9, 26, 1.68],
      [-6.4, 222, 2.1, 15, 2.25], [3.4, 213.2, 2.0, 14, 1.84], [-4, 225, 6.8, 27, 1.73],
      [8, 225, 3.9, 18, 1.62], [18, 231, 5.0, 21, 1.59]],
  },
  {
    name: 'Broken ledges around the ford and the plunge pool',
    rocks: [
      ['moss01', 22.5, 248.4, -0.1, 1.6, 1.22], ['moss04', 43.2, 251.7, -1.82, 2.37, 2.2],
      ['moss06', 48, 258.4, -0.64, 1.41, 0.83], ['moss05', 45.5, 268.4, 0.33, 1.29, 0.98],
      ['moss03', 32.8, 271.9, 0.8, 1.51, 0.96], ['moss02', 52.5, 268.7, 1.74, 1.66, 1.23],
      ['moss06', 62.1, 277.4, -1.41, 1.26, 0.59], ['moss03', 77.5, 281.2, 1.71, 1.73, 1.4],
      ['moss04', 87.3, 290.8, 1.22, 2.7, 3.8], ['moss06', 87.3, 306.5, -0.16, 2.94, 2.3],
      ['moss05', 92.0, 296.8, 2.44, 2.3, 4.5], ['moss02', 91.1, 309.3, 2.14, 1.65, 1.8],
    ],
    ferns: [[26.2, 249, 4.45, 18, 1.8], [46, 253, 4.9, 19, 1.63], [45, 272, 5.1, 21, 1.65],
      [55, 281.2, 3.7, 15, 1.46], [75.1, 295.1, 4.25, 19, 1.72], [90.1, 304.4, 4.45, 15, 1.4]],
  },
  {
    name: 'Facing walls of the ravine and the upper edge of the valley',
    rocks: [
      ['moss04', -52.9, 282.2, -1.7, 2.46, 3.35], ['moss06', -68.5, 286.2, 2.3, 2.19, 2.5],
      ['moss02', -68.3, 294.8, 1.72, 1.81, 2.98], ['moss05', -57.6, 296.2, -0.57, 1.89, 3.15],
      ['moss04', -71.9, 305.3, 0.05, 2.8, 3.61], ['moss01', -56.3, 309.4, 1.6, 2.02, 1.97],
      ['moss06', -65.6, 318.7, 0.27, 1.81, 2.68], ['moss05', -58.4, 328.3, -1.5, 1.9, 2.3],
      ['moss03', -22.4, 392.8, 0.59, 1.62, 0.81], ['moss06', -8.8, 391.1, 1.0, 1.35, 0.64],
    ],
    ferns: [[-55, 280.5, 3.9, 14, 1.35], [-70.1, 296.3, 2.9, 11, 1.61], [-55.8, 309, 3.4, 16, 1.55],
      [-64, 319, 3.8, 15, 1.62], [-20.4, 390.9, 3.9, 16, 1.05]],
  },
  {
    name: 'Submerged limestone and broken cobbles on the first dive',
    rocks: [
      ['rockShelf', -13.3, 52.8, 1.46, 1.7, 1.31], ['moss01', -15.5, 49.1, 2.1, 1.03, 1.07],
      ['moss02', -4.7, 48.1, -0.5, 1.31, 1.31], ['moss06', -7.6, 55.2, 0.79, 0.63, 0.66],
      ['rockShelf', 0.9, 46.4, -0.59, 2.1, 1.4], ['moss06', -8.3, 38.5, 0.8, 1.58, 1.3],
      ['moss05', -18.5, 44.0, 2.9, 1.08, 1.18], ['moss03', -18.9, 52.1, 0.7, 0.71, 0.67],
      ['moss04', -59.2, -16.3, -0.9, 1.35, 1.21], ['rockShelf', 64.2, -19.8, 0.81, 1.43, 0.93],
    ],
  },
  {
    name: 'Boulders and wet fern banks of the upland lake',
    rocks: [
      ['moss02', 93, 696, 0.15, 2.6, 1.7], ['moss05', 92, 702, -1.00, 1.6, 1.2],
      ['rockShelf', 87, 717, 1.52, 2.9, 0.79], ['moss06', 82, 718, -1.5, 1.86, 1.1],
      ['moss03', 64, 734, 0.72, 2.4, 2.0], ['moss01', 63, 773, 2.7, 2.1, 1.6],
      ['rockShelf', 92, 798, -0.82, 3.4, 1.3], ['moss04', 102, 817, 1.91, 3.7, 2.4],
      ['rockShelf', 196, 800, -1.2, 2.5, 1.1], ['moss05', 203, 794, 0.8, 2.4, 1.8],
      ['rockBoulder', 217, 786, 0.5, 4.2, 3.0], ['moss02', 214, 801, 1.7, 3.0, 2.5],
    ],
    ferns: [[76, 696, 3.5, 24, 1.78], [93, 697, 3.2, 19, 1.66], [85, 716, 4.4, 24, 1.24],
      [66, 737, 4.4, 23, 1.73], [58, 767, 4.7, 21, 1.64], [92, 812, 5.6, 25, 1.55],
      [109, 824, 4.5, 23, 1.66], [210, 799, 3.8, 19, 1.47]],
  },
  {
    name: 'Exposed stones between the ridgeline and the warm valley',
    rocks: [
      ['rockShelf', -116, 968, 1.35, 3.4, 1.8], ['moss04', -106, 971, -0.64, 2.0, 0.8],
      ['moss06', -106, 982, 1.9, 1.76, 0.93], ['moss01', -116, 986, 1.7, 1.66, 1.25],
      ['moss05', -128, 950, -0.45, 2.8, 1.84], ['rockShelf', -96, 1002, 0.9, 2.54, 1.3],
    ],
    ferns: [[-124, 956, 3.3, 17, 1.2], [-120, 967, 3.6, 19, 1.31], [-111, 969, 2.7, 15, 1.1],
      [-101, 982, 3.3, 14, 1.1]],
  },
];

interface Placement {
  x: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
  tuck: number;
  tone: number;
}

const fernForms = ['fernA', 'fernB', 'fernC', 'fernD'] as const;

function settleRock(geometry: THREE.BufferGeometry, x: number, z: number, yaw: number,
  width: number, height: number, baseHeight: number): number {
  const vertices = geometry.getAttribute('position');
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const support: number[] = [];
  const stride = Math.max(1, Math.floor(vertices.count / 640));
  for (let index = 0; index < vertices.count; index += stride) {
    const side = vertices.getX(index) * width, forward = vertices.getZ(index) * width;
    const vertexY = vertices.getY(index);
    if (vertexY > baseHeight * 0.31) continue;
    const px = x + side * cos + forward * sin, pz = z - side * sin + forward * cos;
    support.push(groundHeight(px, pz) - vertexY * height);
  }
  support.sort((a, b) => a - b);
  const center = groundHeight(x, z);
  const foot = support[Math.floor((support.length - 1) * 0.30)] ?? center;
  const anchored = Math.min(center, foot) - height * baseHeight * 0.10;
  return center - anchored;
}

export function createCoastLandmarks(scenery: CoastScenery): {
  group: THREE.Group;
  diveObstacleHeight: (x: number, z: number) => number | undefined;
} {
  const composition = new THREE.Group();
  composition.name = 'Rock ledges, stream banks and forest understory';
  const random = coastRandom(1427008);
  const transform = new THREE.Object3D();
  const tint = new THREE.Color();
  const submerged: { mesh: THREE.Mesh; bounds: THREE.Box3 }[] = [];

  for (const landmark of landmarks) {
    const group = new THREE.Group();
    group.name = landmark.name;
    const batches = new Map<CoastSceneryName, Placement[]>();
    const add = (name: CoastSceneryName, placement: Placement) => {
      const batch = batches.get(name);
      if (batch) batch.push(placement);
      else batches.set(name, [placement]);
    };

    for (const [name, x, z, yaw, width, height] of landmark.rocks) {
      const geometry = scenery[name].geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const halfSpan = Math.max(box.max.x, box.max.z);
      const room = (coastTrailDistance(x, z) - 1.32) / halfSpan;
      const scale = Math.min(width, room);
      if (scale < width * 0.43) continue;
      const tuck = settleRock(geometry, x, z, yaw, scale, height, box.max.y);
      if (tuck > box.max.y * height * 0.88) continue;
      add(name, { x, z, yaw, width: scale, height, tuck, tone: 0.82 + random() * 0.24 });
    }

    for (const [x, z, radius, count, size] of landmark.ferns ?? []) {
      for (let i = 0; i < count; i += 1) {
        const angle = random() * Math.PI * 2;
        const spread = Math.sqrt(random()) * radius;
        const px = x + Math.cos(angle) * spread, pz = z + Math.sin(angle) * spread;
        const scale = size * (0.31 + random() ** 1.35 * 0.94);
        if (coastTrailDistance(px, pz) < 1.66 + scale * 0.33 || groundHeight(px, pz) < Math.max(1.1, coastWaterLevel(px, pz) + 0.2)
          || forestStreamDistance(px, pz) < 0.28 || groundSlope(px, pz, 0.74) > 1.19) continue;
        const name = fernForms[Math.floor(random() * fernForms.length)];
        add(name, { x: px, z: pz, yaw: random() * Math.PI * 2, width: scale,
          height: scale * (0.84 + random() * 0.23), tuck: 0.03, tone: 0.68 + random() * 0.42 });
      }
    }

    for (const [name, placements] of batches) {
      const { geometry, material } = scenery[name];
      const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
      const fern = name.startsWith('fern');
      placements.forEach(({ x, z, yaw, width, height, tuck, tone }, index) => {
        const y = groundHeight(x, z);
        const water = coastWaterLevel(x, z);
        transform.position.set(x, y - tuck, z);
        transform.rotation.set(0, yaw, 0);
        transform.scale.set(width, height, width);
        transform.updateMatrix();
        mesh.setMatrixAt(index, transform.matrix);
        const wet = Math.max(0, Math.min(1, water + 0.85 - y));
        const salt = z < 103 && !name.startsWith('fern') ? 1 - wet * 0.50 : 0;
        mesh.setColorAt(index, tint.setRGB(tone * (1 - wet * 0.39 - salt * 0.23),
          tone * (1 - wet * 0.21 - salt * 0.12), tone * (1 - wet * 0.16 + salt * 0.12)));
        if (!fern && y < water - 0.65) {
          const bounds = geometry.boundingBox!.clone().applyMatrix4(transform.matrix);
          const collision = new THREE.Mesh(geometry, material);
          collision.matrixWorld.copy(transform.matrix);
          submerged.push({ mesh: collision, bounds });
        }
      });
      mesh.castShadow = !fern || placements.length < 12;
      mesh.receiveShadow = true;
      mesh.name = name;
      group.add(mesh);
    }
    composition.add(group);
  }
  const probe = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 52);
  const hits: THREE.Intersection[] = [];
  return {
    group: composition,
    diveObstacleHeight(x, z) {
      let surface: number | undefined;
      for (const { mesh, bounds } of submerged) {
        if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
        probe.ray.origin.set(x, bounds.max.y + 0.2, z);
        hits.length = 0;
        probe.intersectObject(mesh, false, hits);
        if (hits[0]) surface = Math.max(surface ?? -Infinity, hits[0].point.y);
      }
      return surface;
    },
  };
}

export function createCreekFlowers(): THREE.Group {
  const flowers = new THREE.Group();
  flowers.name = 'Heliconia at the fork and above the ford';
  const random = coastRandom(812352);
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x48623a, roughness: 0.78 });
  const bractMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.53 });
  const bases = [[-7.4, 221], [-3.8, 222.8], [2.7, 227.5], [3.3, 213.1],
    [29.2, 249.5], [31.8, 251.3], [43.6, 251.9]];
  const crimson = new THREE.Color(0xd0462b);
  const gold = new THREE.Color(0xe4bd44);
  for (const [x, z] of bases) {
    if (coastTrailDistance(x, z) < 1.8) continue;
    const y = groundHeight(x, z) - 0.08;
    const height = 0.98 + random() * 0.61;
    const yaw = random() * Math.PI * 2;
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const end = new THREE.Vector3(x + dx * 0.43, y + height * 0.92, z + dz * 0.43);
    const stalk = new THREE.CatmullRomCurve3([new THREE.Vector3(x, y, z),
      new THREE.Vector3(x + dx * 0.06, y + height * 0.7, z + dz * 0.06),
      new THREE.Vector3(x + dx * 0.24, y + height, z + dz * 0.24), end]);
    flowers.add(new THREE.Mesh(new THREE.TubeGeometry(stalk, 13, 0.019, 6, false), stemMaterial));
    const hanging = new THREE.CatmullRomCurve3([end,
      new THREE.Vector3(end.x + dx * 0.045, end.y - 0.31, end.z + dz * 0.09),
      new THREE.Vector3(end.x + dz * 0.1, end.y - 0.52, end.z + dx * 0.1)]);
    flowers.add(new THREE.Mesh(new THREE.TubeGeometry(hanging, 8, 0.012, 5, false), stemMaterial));
    for (let index = 0; index < 6; index += 1) {
      const stemPoint = hanging.getPoint((index + 0.17) / 6);
      const direction = index % 2 ? -1 : 1;
      const length = 0.39 - index * 0.035 + random() * 0.052;
      const vertices: number[] = [], colors: number[] = [], triangles: number[] = [];
      for (let row = 0; row <= 7; row += 1) {
        const t = row / 7;
        const along = direction * t * length;
        const arch = length * (0.75 * t * t - 0.28 * t);
        const width = length * (0.025 + 0.18 * Math.sin(Math.PI * t) ** 0.8);
        const tint = crimson.clone().lerp(gold, smoothstep(0.75, 1.0, t));
        for (const side of [-1, 0, 1]) {
          vertices.push(stemPoint.x + dz * along + dx * width * side,
            stemPoint.y + arch + Math.abs(side) * width * 0.67, stemPoint.z - dx * along + dz * width * side);
          colors.push(tint.r, tint.g, tint.b);
        }
        if (row > 0) {
          const a = (row - 1) * 3;
          for (let column = 0; column < 2; column += 1) {
            const v = a + column;
            triangles.push(v, v + 3, v + 1, v + 1, v + 3, v + 4);
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(triangles);
      geometry.computeVertexNormals();
      const bract = new THREE.Mesh(geometry, bractMaterial);
      bract.receiveShadow = true;
      flowers.add(bract);
    }
  }
  return flowers;
}

export function createCoastSeagrass(time: THREE.IUniform<number>): THREE.Mesh {
  const shoals = [[-19, 54, 3.0], [-9, 50, 4.0], [-6, 45, 3.5], [-21, 44, 3.2],
    [3, 56, 3], [-28, 45, 3.8], [-59, -17, 4.8], [65, -27, 4.2]];
  const random = coastRandom(901541);
  const points: number[] = [];
  const tips: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const foot = new THREE.Color(0x203f35);
  const tip = new THREE.Color(0x678b4d);
  const color = new THREE.Color();
  for (const [cx, cz, radius] of shoals) {
    for (let plant = 0; plant < 44; plant += 1) {
      const angle = random() * Math.PI * 2;
      const spread = Math.sqrt(random()) * radius;
      const x = cx + spread * Math.cos(angle);
      const z = cz + spread * Math.sin(angle);
      const y = groundHeight(x, z) - 0.045;
      if (y > -1.1 || y < -10.0 || groundSlope(x, z, 0.44) > 0.65) continue;
      const scale = 0.35 + random() ** 2 * 0.75;
      for (let blade = 0; blade < 9; blade += 1) {
        const heading = random() * Math.PI * 2;
        const dx = Math.cos(heading), dz = Math.sin(heading);
        const length = scale * (0.55 + random() * 0.58);
        const colorGain = 0.68 + random() * 0.46;
        const first = tips.length;
        for (let segment = 0; segment <= 4; segment += 1) {
          const t = segment / 4;
          const arc = length * (0.12 * t + 0.58 * t * t);
          const height = length * (1.33 * t - 0.51 * t * t);
          const width = length * 0.054 * (1 - 0.97 * t * t);
          color.copy(foot).lerp(tip, t).multiplyScalar(colorGain);
          for (const side of [-1, 1]) {
            points.push(x + dx * arc - dz * width * side, y + height, z + dz * arc + dx * width * side);
            colors.push(color.r, color.g, color.b);
            tips.push(t * t);
          }
          if (segment > 0) {
            const a = first + (segment - 1) * 2;
            indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
          }
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('bladeFlex', new THREE.Float32BufferAttribute(tips, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.64 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uCurrentTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uCurrentTime;\nattribute float bladeFlex;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float swell = uCurrentTime * 0.92 + dot(position.xz, vec2(0.19, 0.34));
        transformed.xz += bladeFlex * vec2(0.11 * sin(swell), 0.17 * cos(swell * 0.73));`);
  };
  const grass = new THREE.Mesh(geometry, material);
  grass.name = 'Seagrass in the shallow currents';
  grass.receiveShadow = true;
  return grass;
}
