import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANDSCAPE_BOUNDS, coastRandom, groundHeight, groundSlope, SPAWN } from '../terrain';

type Plant = { x: number; y: number; z: number; width: number; height: number; yaw: number; tone: number };
const placed = new THREE.Object3D();
const color = new THREE.Color();

function instances(geometry: THREE.BufferGeometry, material: THREE.Material, plants: Plant[], shadows: boolean): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, plants.length);
  for (let i = 0; i < plants.length; i += 1) {
    const p = plants[i];
    placed.position.set(p.x, p.y, p.z);
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

function crownGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const lobe = 1 + 0.18 * Math.sin(x * 7.8 + z * 6.1 + y * 3.8)
      + 0.15 * Math.cos(z * 6.6 - y * 8.4) + 0.10 * Math.sin(x * 4.7 - z * 7.2);
    position.setXYZ(i, x * lobe + y * 0.11, y * (0.79 + 0.18 * lobe), z * lobe);
    const light = THREE.MathUtils.lerp(0.43, 1.13, Math.max(0, (y + 1) * 0.5));
    colors.set([light * 0.94, light, light * (1.06 - y * 0.11)], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
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

function splitTrunk(): THREE.BufferGeometry {
  const branches = [
    { from: [0, -0.09, 0], to: [0.10, 0.96, 0.02], width: 0.08 },
    { from: [0.07, 0.55, 0.01], to: [-0.49, 0.99, 0.20], width: 0.049 },
    { from: [0.08, 0.61, 0.02], to: [0.57, 1.03, -0.27], width: 0.038 },
    { from: [0.09, 0.73, 0.01], to: [0.02, 1.11, 0.38], width: 0.029 },
  ];
  const up = new THREE.Vector3(0, 1, 0);
  const geometry = branches.map(branch => {
    const start = new THREE.Vector3(...branch.from);
    const end = new THREE.Vector3(...branch.to);
    const axis = end.clone().sub(start);
    const limb = new THREE.CylinderGeometry(branch.width*0.43, branch.width, axis.length(), 8, 2);
    limb.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.normalize()));
    const middle = start.lerp(end, 0.5);
    limb.translate(middle.x, middle.y, middle.z);
    return limb;
  });
  const base = mergeGeometries(geometry)!;
  for (const part of geometry) part.dispose();
  return base;
}

function moveLeaves(material: THREE.MeshStandardMaterial, time: THREE.IUniform<number>): void {
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
          transformed.x += (gust*0.028+stir*0.017)*tipFlex*tipFlex;
          transformed.z += (gust*0.020-stir*0.011)*tipFlex*tipFlex;
        #endif
      `);
  };
}

function makePlant(x: number, z: number, width: number, height: number, random: () => number, lift = 0): Plant {
  return { x, y: groundHeight(x, z) + lift, z, width, height, yaw: random()*Math.PI*2, tone: random() };
}

function groupCrowns(parent: THREE.Group, canopy: THREE.Texture): void {
  const shape = crownGeometry();
  const material = new THREE.MeshStandardMaterial({
    map: canopy, vertexColors: true, roughness: 0.87,
    emissiveMap: canopy, emissive: 0xf4f9e8, emissiveIntensity: 0.14,
  });
  const random = coastRandom(6395194);
  const trunks: Plant[] = [];
  const { minX, maxX, minZ, maxZ } = LANDSCAPE_BOUNDS;
  // Cell-local instance bounds keep the back side of the islands out of the current draw.
  const tileSize = 88;
  for (let z0 = minZ; z0 < maxZ; z0 += tileSize) {
    for (let x0 = minX; x0 < maxX; x0 += tileSize) {
      const distance = Math.hypot(x0 + tileSize * 0.5 - SPAWN.x, z0 + tileSize * 0.5 - SPAWN.z);
      const spacing = distance < 340 ? 4.45 : 7.0;
      const plants: Plant[] = [];
      const centerX = Math.min(x0 + tileSize, maxX);
      const centerZ = Math.min(z0 + tileSize, maxZ);
      for (let cz = z0; cz < centerZ; cz += spacing) {
        for (let cx = x0; cx < centerX; cx += spacing) {
          const x = cx + random() * spacing;
          const z = cz + random() * spacing;
          const top = groundHeight(x, z);
          if (top < 2.4 || x > maxX || z > maxZ) continue;
          const slope = groundSlope(x, z, 1.4);
          const patch = Math.sin(x*0.095 + z*0.084) * Math.cos(z*0.136 - x*0.061);
          const cliff = slope > 1.39;
          const coastalGrass = top < 4.25 && z > 30 && Math.abs(x - SPAWN.x) < 48;
          if (coastalGrass || (cliff && (slope > 3.4 || patch < 0.03))) continue;
          const size = (0.76 + random() * 0.61) * (distance < 340 ? 3.53 : 5.2);
          const low = cliff || top < 8.4;
          const mature = !low && distance < 140 && slope < 1.25 && patch > -0.39 && random() < 0.68;
          const trunkHeight = size * (1.12 + random()*0.59);
          const y = mature ? top + trunkHeight : low ? top - size * 0.09 : top + size*0.49;
          const yaw = random()*Math.PI*2;
          const tone = 0.07 + random()*0.92;
          plants.push({ x, y, z, width: size, height: size*(low ? 0.71 : 0.86), yaw, tone });
          if (mature) {
            trunks.push({ x, y: top, z, width: size, height: trunkHeight, yaw, tone });
            plants.push({ x: x + size*0.48*Math.cos(yaw), y: y - size*0.16,
              z: z - size*0.48*Math.sin(yaw), width: size*0.86, height: size*0.51, yaw, tone: tone*0.86 });
          }
          // A second, offset lobe breaks up the round silhouette near the beach.
          if (!low && distance < 213 && random() < 0.57) {
            const angle = random() * Math.PI * 2;
            plants.push({ x: x + Math.cos(angle)*size*0.69, y: y - size*0.28, z: z + Math.sin(angle)*size*0.69,
              width: size*0.65, height: size*0.62, yaw: angle, tone: random() });
          }
        }
      }
      if (plants.length) parent.add(instances(shape, material, plants, distance < 352));
    }
  }
  parent.add(instances(splitTrunk(),
    new THREE.MeshStandardMaterial({ color: 0x655142, roughness: 0.96 }), trunks, true));
}

export function createCoastVegetation(canopy: THREE.Texture, time: THREE.IUniform<number>): THREE.Group {
  const vegetation = new THREE.Group();
  vegetation.name = 'Rainforest canopy, palms and understory';
  groupCrowns(vegetation, canopy);
  const random = coastRandom(441201);
  const leaves = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide, vertexColors: true, roughness: 0.76,
    emissive: 0x173012, emissiveIntensity: 0.32,
  });
  const bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 });
  moveLeaves(leaves, time);

  const palms: Plant[] = [];
  // Mature trees frame the entrance to the beach and continue along the forest edge.
  const shorelinePalms = [
    [-23, 70, 8.9], [-27, 73, 7.0], [-32, 75, 8.7], [-25, 82, 10.1], [-19, 85, 7.1], [-37, 79, 5.9], [-43, 71, 8.8],
    [1, 73, 8.1], [5, 80, 8.4], [14, 88, 9.2], [27, 81, 6.9], [39, 75, 7.4], [15, 92, 5.8],
    [-50, 61, 7.2], [-61, 51, 7.7], [-71, 44, 9.2],
  ];
  for (const [x, z, height] of shorelinePalms) palms.push(makePlant(x, z, height, height, random, -0.12));

  for (let i = 0; i < 2160 && palms.length < 128; i += 1) {
    const x = -174 + random()*355;
    const z = -156 + random()*274;
    const y = groundHeight(x, z);
    if (y < 2.05 || y > 30 || groundSlope(x, z) > 1.23) continue;
    if (Math.abs(x - SPAWN.x) < 12 && z < SPAWN.z + 10 && z > SPAWN.z - 36) continue;
    const height = 4.4 + random()*6.4;
    palms.push(makePlant(x, z, height, height, random, -0.15));
  }
  vegetation.add(instances(palmTrunk(), bark, palms, true), instances(palmCrown(), leaves, palms, true));

  const ferns: Plant[] = [];
  const shrubs: Plant[] = [];
  const groundPlants = [
    [-18.8, 71.7, 2.7], [-21.3, 74.8, 2.9], [-17.6, 76.0, 1.9], [-26, 70, 3.1], [-20, 67, 1.4],
    [-3.8, 75.65, 2.85], [-5.5, 77.6, 1.8], [1.1, 83, 2.4], [3, 76.5, 1.9], [6, 80, 3.0],
  ];
  for (let i = 0; i < groundPlants.length; i += 1) {
    const [x, z, size] = groundPlants[i];
    (i % 3 === 0 ? ferns : shrubs).push(makePlant(x, z, size, size, random, -0.04));
  }

  for (let i = 0; i < 4900 && shrubs.length + ferns.length < 1000; i += 1) {
    const x = -160 + random() * 340;
    const z = -143 + random() * 293;
    const y = groundHeight(x, z);
    if (y < 2.7 || y > 33 || groundSlope(x, z) > 1.30) continue;
    if (Math.abs(x - SPAWN.x) < 8 && z <= SPAWN.z + 8) continue;
    const size = 0.61 + random() * (1.05 + 1.02 * (z > 35 ? 1 : 0));
    (random() < 0.19 ? ferns : shrubs).push(makePlant(x, z, size, size, random, -0.06));
  }
  vegetation.add(instances(forestFloorLeaves(true), leaves, ferns, true));
  vegetation.add(instances(forestFloorLeaves(false), leaves, shrubs, true));
  return vegetation;
}
