import * as THREE from 'three';
import { LANDSCAPE_BOUNDS, coastRandom, groundHeight, groundSlope, SPAWN } from '../terrain';
import { coastNoise } from './coastNoise';
import { createCoastRoots, createCoastTreeMeshes, createDistantCoastTreeMesh, type TreeForm } from './coastTreeMeshes';

type Plant = { x: number; y: number; z: number; width: number; height: number; yaw: number; tone: number };
type Tree = Plant & { form: TreeForm };
type TrailDistance = (x: number, z: number) => number;
const placed = new THREE.Object3D();
const color = new THREE.Color();

function instances(geometry: THREE.BufferGeometry, material: THREE.Material, plants: Plant[], shadows: boolean,
  origin?: THREE.Vector3): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, plants.length);
  for (let i = 0; i < plants.length; i += 1) {
    const p = plants[i];
    placed.position.set(p.x, p.y, p.z);
    if (origin) placed.position.sub(origin);
    placed.rotation.set(0, p.yaw, 0);
    placed.scale.set(p.width, p.height, p.width);
    placed.updateMatrix();
    mesh.setMatrixAt(i, placed.matrix);
    mesh.setColorAt(i, color.setRGB(0.66 + p.tone * 0.47, 0.78 + p.tone * 0.28, 0.89 - p.tone * 0.19));
  }
  mesh.computeBoundingSphere();
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

// A raised midrib and a tapered outline catch sunlight on each leaflet.
function addBlade(
  vertices: number[], colors: number[], start: THREE.Vector3, end: THREE.Vector3,
  width: number, ridge: number, leaf: THREE.Color,
): void {
  const axis = end.clone().sub(start);
  const across = new THREE.Vector3(-axis.z, 0, axis.x).normalize().multiplyScalar(width);
  const center = start.clone().lerp(end, 0.46);
  const spine = center.clone().add(new THREE.Vector3(0, ridge, 0));
  const left = center.clone().sub(across);
  const right = center.clone().add(across);
  const top = start.clone().lerp(end, 0.76);
  const topSpine = top.clone().add(new THREE.Vector3(0, ridge * 0.57, 0));
  const tipLeft = top.clone().addScaledVector(across, -0.62);
  const tipRight = top.clone().addScaledVector(across, 0.62);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, shade: number) => {
    vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (const point of [a, b, c]) {
      const vein = point === spine || point === topSpine ? 1.18 : 0.90;
      colors.push(leaf.r * shade * vein, leaf.g * shade * vein, leaf.b * shade * vein);
    }
  };
  tri(start, left, spine, 0.77);
  tri(start, spine, right, 0.94);
  tri(left, tipLeft, spine, 0.94);
  tri(tipLeft, topSpine, spine, 1.03);
  tri(spine, topSpine, right, 1.16);
  tri(topSpine, tipRight, right, 1.01);
  tri(tipLeft, end, topSpine, 1.04);
  tri(topSpine, end, tipRight, 1.21);
}

function leafGeometry(vertices: number[], colors: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function palmCrown(): THREE.BufferGeometry {
  const vertices: number[] = [];
  const colors: number[] = [];
  const random = coastRandom(778301);
  for (let frond = 0; frond < 11; frond += 1) {
    const angle = frond * 2.39996323;
    const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const cross = new THREE.Vector3(-radial.z, 0, radial.x);
    const reach = 0.43 + random() * 0.31;
    const lift = 0.16 + random() * 0.25;
    const bend = 0.09 + random() * 0.27;
    const leaf = new THREE.Color().setHSL(0.22 + random() * 0.055, 0.57 + random() * 0.19, 0.22 + random() * 0.12);
    const spline = (t: number) => new THREE.Vector3(0.16, 1.0 + lift*Math.sin(Math.PI*t*0.91) - bend*t*t, 0.012)
      .addScaledVector(radial, t*reach)
      .addScaledVector(cross, 0.085*t*t);
    let previous = spline(0);
    for (let joint = 1; joint <= 14; joint += 1) {
      const t = joint / 14;
      const next = spline(t);
      addBlade(vertices, colors, previous, next, 0.009*(1 - t*0.76), 0.004, leaf);
      previous = next;
      if (joint <= 2 || joint >= 14) continue;
      const extension = Math.sin(t * Math.PI) * (0.12 + reach * 0.12);
      for (const side of [-1, 1]) {
        const start = next.clone().addScaledVector(radial, 0.014 * side);
        const end = start.clone().addScaledVector(cross, extension * side * (0.86 + random()*0.24))
          .addScaledVector(radial, extension * (0.64 + 0.25*t));
        end.y -= extension * (0.18 + t * 0.46);
        addBlade(vertices, colors, start, end, extension * (0.115 + 0.05 * (1 - t)), 0.014, leaf);
      }
    }
  }
  return leafGeometry(vertices, colors);
}

function palmTrunk(): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.028, 0.057, 1, 9, 24);
  geometry.translate(0, 0.5, 0);
  const points = geometry.getAttribute('position');
  const colors = new Float32Array(points.count * 3);
  for (let i = 0; i < points.count; i += 1) {
    const t = points.getY(i);
    points.setXYZ(i, points.getX(i) + 0.16 * t*t, t, points.getZ(i) + 0.03 * Math.sin(3*t));
    const band = 0.70 + 0.26 * (0.5 + 0.5 * Math.sin(t * 130 + i * 0.031));
    colors.set([0.32*band, 0.24*band, 0.155*band], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function forestFloorLeaves(fern: boolean): THREE.BufferGeometry {
  const vertices: number[] = [];
  const colors: number[] = [];
  const random = coastRandom(fern ? 459142 : 10348);
  for (let stem = 0; stem < 11; stem += 1) {
    const angle = stem * 2.39996323;
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new THREE.Vector3(-out.z, 0, out.x);
    const leaf = new THREE.Color().setHSL(0.22 + random()*0.095, 0.53 + random()*0.19, 0.22 + random()*0.13);
    const extent = 0.47 + random() * 0.62;
    const rise = 0.36 + random() * 0.49;
    const base = out.clone().multiplyScalar(0.055);
    const mid = out.clone().multiplyScalar(extent * 0.30).setY(rise * 0.6);
    const end = out.clone().multiplyScalar(extent).setY(rise * (0.56 + random() * 0.44));
    addBlade(vertices, colors, base, mid, 0.016, 0.006, leaf);
    if (!fern) {
      addBlade(vertices, colors, mid, end, extent * (0.16 + 0.09 * random()), extent * 0.085, leaf);
      continue;
    }
    addBlade(vertices, colors, mid, end, 0.026, 0.012, leaf);
    for (let node = 0; node < 9; node += 1) {
      const t = node / 9;
      const start = mid.clone().lerp(end, t);
      const spread = (1 - t) * extent * 0.30;
      for (const sign of [-1, 1]) {
        const tip = start.clone().addScaledVector(side, sign * spread).addScaledVector(out, spread * 0.51);
        tip.y += spread * 0.21;
        addBlade(vertices, colors, start, tip, spread*0.23, 0.014, leaf);
      }
    }
  }
  return leafGeometry(vertices, colors);
}

function moveLeaves(material: THREE.MeshStandardMaterial, time: THREE.IUniform<number>, veins = false): void {
  material.onBeforeCompile = shader => {
    shader.uniforms.uBreezeTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uBreezeTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 root = instanceMatrix[3].xz;
          float gust = sin(dot(root, vec2(0.14,0.09)) + uBreezeTime*1.35);
          float stir = sin(position.x*4.5 + position.z*3.7 + uBreezeTime*2.95);
          float tipFlex = min(1.0, length(position.xz) + position.y*0.21);
          float flex = tipFlex*tipFlex*${veins ? 'bladeUv.y*0.44' : '1.0'};
          transformed.x += (gust*0.028+stir*0.017)*flex;
          transformed.z += (gust*0.020-stir*0.011)*flex;
        #endif
      `);
    if (veins) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 bladeUv;\nvarying vec2 vBlade;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlade = bladeUv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vBlade;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float across = abs(vBlade.x - 0.5) * 2.0;
          float midrib = (1.0 - smoothstep(0.01, 0.06, across)) * (1.0 - smoothstep(0.70, 0.97, vBlade.y));
          float riblet = abs(fract((vBlade.y - across * 0.20) * 5.0) - 0.5);
          float resolution = 1.0 - smoothstep(0.06, 0.32, fwidth(vBlade.y) * 5.0 + fwidth(across));
          diffuseColor.rgb *= 1.0 + resolution * (midrib * 0.22 + (1.0 - smoothstep(0.02, 0.14, riblet)) * 0.075);
        `);
    }
  };
  material.customProgramCacheKey = () => veins ? 'coast-broadleaf-breeze' : 'coast-understory-breeze';
}

function createBroadleafBark(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCoastBark;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCoastBark = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vCoastBark;\n${coastNoise}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 p = vCoastBark;
        float resolution = 1.0 - smoothstep(0.24, 0.89, length(fwidth(p)) * 67.0);
        float plate = coastNoise(p.xz * 42.0 + vec2(p.y * 23.0, p.y * -17.0));
        float grain = coastNoise(p.xz * 119.0 + vec2(p.y * 3.0, p.y * -5.0));
        float fissure = smoothstep(0.52, 0.78, grain * 0.68 + plate * 0.32);
        float lichen = smoothstep(0.58, 0.78, plate) * smoothstep(0.34, 0.61, grain);
        vec3 bark = diffuseColor.rgb * (0.84 + 0.62 * plate - 0.63 * fissure);
        bark = mix(bark, bark * 0.64 + vec3(0.068, 0.082, 0.052), lichen * 0.65);
        diffuseColor.rgb = mix(diffuseColor.rgb, bark, resolution);
      `);
  };
  return material;
}

function makePlant(x: number, z: number, width: number, height: number, random: () => number, lift = 0): Plant {
  return { x, y: groundHeight(x, z) + lift, z, width, height, yaw: random()*Math.PI*2, tone: random() };
}

function plantTiles<T extends Plant>(plants: T[], size: number): Map<string, T[]> {
  const tiles = new Map<string, T[]>();
  for (const plant of plants) {
    const key = `${Math.floor(plant.x / size)},${Math.floor(plant.z / size)}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = [];
      tiles.set(key, tile);
    }
    tile.push(plant);
  }
  return tiles;
}

function plantBroadleaf(trailDistance: TrailDistance): Tree[] {
  const random = coastRandom(6395194);
  const trees: Tree[] = [];
  const { minX, maxX, minZ, maxZ } = LANDSCAPE_BOUNDS;
  const regionSize = 88;
  for (let z0 = minZ; z0 < maxZ; z0 += regionSize) {
    for (let x0 = minX; x0 < maxX; x0 += regionSize) {
      const distance = Math.hypot(x0 + regionSize * 0.5 - SPAWN.x, z0 + regionSize * 0.5 - SPAWN.z);
      const spacing = distance < 340 ? 4.45 : 7.0;
      for (let cz = z0; cz < Math.min(z0 + regionSize, maxZ); cz += spacing) {
        for (let cx = x0; cx < Math.min(x0 + regionSize, maxX); cx += spacing) {
          const x = cx + random() * spacing;
          const z = cz + random() * spacing;
          if (x > maxX || z > maxZ) continue;
          const top = groundHeight(x, z);
          if (top < 2.4) continue;
          const slope = groundSlope(x, z, 1.4);
          const patch = Math.sin(x * 0.095 + z * 0.084) * Math.cos(z * 0.136 - x * 0.061);
          const cliff = slope > 1.39;
          const coastalGrass = top < 4.25 && z > 30 && Math.abs(x - SPAWN.x) < 48;
          if (coastalGrass || (cliff && (slope > 3.4 || patch < 0.03))) continue;

          const width = (0.76 + random() * 0.61) * (distance < 340 ? 3.53 : 5.2);
          const low = cliff || top < 8.4;
          const mature = !low && slope < 1.25 && patch > -0.39 && random() < 0.61;
          const form = low ? 'windPruned' : mature && random() < 0.55 ? 'emergent' : 'spreading';
          const stature = width * (low ? 0.79 + random() * 0.27
            : mature ? 1.57 + random() * 0.65 : 1.10 + random() * 0.47);
          const yaw = random() * Math.PI * 2;
          const tone = random();
          const clearance = trailDistance(x, z);
          if (clearance < 2.2 + width * 0.13) continue;
          // Taller trunks along the trail keep the lowest branches above eye level.
          const height = clearance < width + 2.2 ? Math.max(stature, low ? 5.2 : 6.6) : stature;
          trees.push({ x, y: top - slope * 0.15, z, width, height, yaw, tone, form });
        }
      }
    }
  }
  return trees;
}

function groupTrees(parent: THREE.Group, bark: THREE.Material, leaves: THREE.Material,
  trailDistance: TrailDistance): void {
  const forms = ['emergent', 'spreading', 'windPruned'] as const;
  const models = forms.map(createCoastTreeMeshes);
  const distant = createDistantCoastTreeMesh();
  const distantMaterial = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, vertexColors: true, roughness: 0.89 });
  const tileSize = 60;
  for (const tile of plantTiles(plantBroadleaf(trailDistance), tileSize).values()) {
    const levels = new THREE.LOD();
    const anchor = tile[0];
    levels.position.set(
      (Math.floor(anchor.x / tileSize) + 0.5) * tileSize,
      tile.reduce((total, tree) => total + tree.y, 0) / tile.length,
      (Math.floor(anchor.z / tileSize) + 0.5) * tileSize,
    );
    levels.name = 'Broadleaf forest tile';
    const shadows = Math.hypot(levels.position.x - SPAWN.x, levels.position.z - SPAWN.z) < 345;
    const placements = forms.map(form => tile.filter(tree => tree.form === form));
    const detailDistances = [0, 67];
    detailDistances.forEach((distance, detail) => {
      const batch = new THREE.Group();
      placements.forEach((plants, form) => {
        if (!plants.length) return;
        const model = models[form][detail];
        batch.add(instances(model.wood, bark, plants, shadows, levels.position),
          instances(model.leaves, leaves, plants, shadows, levels.position));
      });
      if (detail === 0) {
        const roots = new THREE.Mesh(createCoastRoots(tile, levels.position), bark);
        roots.castShadow = roots.receiveShadow = shadows;
        batch.add(roots);
      }
      levels.addLevel(batch, distance, 0.12);
    });
    levels.addLevel(instances(distant, distantMaterial, tile, shadows, levels.position), 151, 0.12);
    // Fully fogged trees have no visible contribution, including the edge of the tile.
    levels.addLevel(new THREE.Group(), 925, 0.04);
    parent.add(levels);
  }
}

export function createCoastVegetation(time: THREE.IUniform<number>, trailDistance: TrailDistance = () => Infinity): THREE.Group {
  const vegetation = new THREE.Group();
  vegetation.name = 'Rainforest canopy, palms and understory';
  const random = coastRandom(441201);
  const leaves = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide, vertexColors: true, roughness: 0.76,
    emissive: 0x173012, emissiveIntensity: 0.32,
  });
  const treeLeaves = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide, vertexColors: true, roughness: 0.87,
    emissive: 0x263c17, emissiveIntensity: 0.14,
  });
  const bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 });
  moveLeaves(leaves, time);
  moveLeaves(treeLeaves, time, true);
  groupTrees(vegetation, createBroadleafBark(), treeLeaves, trailDistance);

  const palms: Plant[] = [];
  // Mature trees frame the entrance to the beach and continue along the forest edge.
  const shorelinePalms = [
    [-23, 70, 8.9], [-27, 73, 7.0], [-32, 75, 8.7], [-25, 82, 10.1], [-19, 85, 7.1], [-37, 79, 5.9], [-43, 71, 8.8],
    [1, 73, 8.1], [5, 80, 8.4], [14, 88, 9.2], [27, 81, 6.9], [39, 75, 7.4], [15, 92, 5.8],
    [-50, 61, 7.2], [-61, 51, 7.7], [-71, 44, 9.2],
  ];
  for (const [x, z, height] of shorelinePalms) {
    const palm = makePlant(x, z, height, height, random, -0.12);
    if (trailDistance(x, z) >= 2.2 + height * 0.057) palms.push(palm);
  }

  for (let i = 0; i < 2160 && palms.length < 128; i += 1) {
    const x = -174 + random()*355;
    const z = -156 + random()*274;
    const y = groundHeight(x, z);
    if (y < 2.05 || y > 30 || groundSlope(x, z) > 1.23) continue;
    if (Math.abs(x - SPAWN.x) < 12 && z < SPAWN.z + 10 && z > SPAWN.z - 36) continue;
    const height = 4.4 + random()*6.4;
    const palm = makePlant(x, z, height, height, random, -0.15);
    if (trailDistance(x, z) >= 2.2 + height * 0.057) palms.push(palm);
  }
  const palmWood = palmTrunk();
  const palmLeaves = palmCrown();
  for (const tile of plantTiles(palms, 80).values()) {
    vegetation.add(instances(palmWood, bark, tile, true), instances(palmLeaves, leaves, tile, true));
  }

  const ferns: Plant[] = [];
  const shrubs: Plant[] = [];
  const groundPlants = [
    [-18.8, 71.7, 2.7], [-21.3, 74.8, 2.9], [-17.6, 76.0, 1.9], [-26, 70, 3.1], [-20, 67, 1.4],
    [-3.8, 75.65, 2.85], [-5.5, 77.6, 1.8], [1.1, 83, 2.4], [3, 76.5, 1.9], [6, 80, 3.0],
  ];
  for (let i = 0; i < groundPlants.length; i += 1) {
    const [x, z, size] = groundPlants[i];
    const plant = makePlant(x, z, size, size, random, -0.04);
    if (trailDistance(x, z) >= 2.2 + size * 0.9) (i % 3 === 0 ? ferns : shrubs).push(plant);
  }

  for (let i = 0; i < 4900 && shrubs.length + ferns.length < 1000; i += 1) {
    const x = -160 + random() * 340;
    const z = -143 + random() * 293;
    const y = groundHeight(x, z);
    if (y < 2.7 || y > 33 || groundSlope(x, z) > 1.30) continue;
    if (Math.abs(x - SPAWN.x) < 8 && z <= SPAWN.z + 8) continue;
    const size = 0.61 + random() * (1.05 + 1.02 * (z > 35 ? 1 : 0));
    const patch = random() < 0.19 ? ferns : shrubs;
    const plant = makePlant(x, z, size, size, random, -0.06);
    if (trailDistance(x, z) >= 2.2 + size * 0.9) patch.push(plant);
  }
  for (const [isFern, plants] of [[true, ferns], [false, shrubs]] as const) {
    const geometry = forestFloorLeaves(isFern);
    for (const tile of plantTiles(plants, 55).values()) vegetation.add(instances(geometry, leaves, tile, true));
  }
  return vegetation;
}
