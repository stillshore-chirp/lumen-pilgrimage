import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coastPlantingDistance, coastRandom, groundHeight, groundSlope, inariCanopyScale, inariWoodland } from '../terrain';

const up = new THREE.Vector3(0, 1, 0);

function cedar(seed: number) {
  const random = coastRandom(seed);
  const bark: THREE.BufferGeometry[] = [];
  const leaves: number[] = [];
  const colors: number[] = [];
  const green = new THREE.Color();

  function limb(start: THREE.Vector3, end: THREE.Vector3, base: number, tip: number, sides = 6): void {
    const axis = end.clone().sub(start);
    const mesh = new THREE.CylinderGeometry(tip, base, axis.length(), sides);
    const orientation = new THREE.Quaternion().setFromUnitVectors(up, axis.normalize());
    const middle = start.clone().lerp(end, 0.5);
    mesh.applyQuaternion(orientation).translate(middle.x, middle.y, middle.z);
    bark.push(mesh);
  }

  function spray(base: THREE.Vector3, direction: THREE.Vector3, size: number): void {
    const tangent = direction.clone().normalize();
    const sideways = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const end = base.clone().addScaledVector(tangent, size);
    const peak = base.clone().lerp(end, 0.52).addScaledVector(up, size * 0.13);
    const left = base.clone().lerp(end, 0.44).addScaledVector(sideways, size * 0.18);
    const right = base.clone().lerp(end, 0.48).addScaledVector(sideways, -size * 0.16);
    const tone = 0.32 + random() * 0.30;
    green.setHSL(0.242 + random() * 0.05, 0.39 + random() * 0.20, tone, THREE.SRGBColorSpace);
    for (const point of [base, left, peak, left, end, peak, base, peak, right, right, peak, end]) {
      leaves.push(point.x, point.y, point.z);
      colors.push(green.r, green.g, green.b);
    }
  }

  const trunk = [
    new THREE.Vector3(0, -0.55, 0),
    new THREE.Vector3(0.02, 3.4, -0.035),
    new THREE.Vector3(-0.07, 7.2, 0.085),
    new THREE.Vector3(0.11, 10.4, 0.12),
    new THREE.Vector3(0.13, 13.0, 0.095),
  ];
  const radii = [0.32, 0.25, 0.18, 0.105, 0.025];
  for (let i = 1; i < trunk.length; i += 1) limb(trunk[i - 1], trunk[i], radii[i - 1], radii[i], 11);
  for (let i = 0; i < 19; i += 1) {
    const h = 5.7 + i * 0.375 + random() * 0.35;
    const angle = i * 2.39996 + (random() - 0.5) * 0.45;
    const width = (1 - (h - 5.7) / 8.1) * (2.05 + random() * 1.0);
    const pivot = new THREE.Vector3(0.07, h, 0.07);
    const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const knuckle = pivot.clone().addScaledVector(radial, width * 0.62).addScaledVector(up, -0.42 * width);
    const tip = knuckle.clone().addScaledVector(radial, width * 0.40).addScaledVector(up, 0.26 * width);
    limb(pivot, knuckle, 0.037 + 0.017 * width, 0.025, 5);
    limb(knuckle, tip, 0.025, 0.007, 5);
    for (let j = 0; j < 7; j += 1) {
      const side = j % 2 === 0 ? -1 : 1;
      const forkBase = j < 4 ? pivot.clone().lerp(knuckle, 0.40 + 0.16 * j) : knuckle.clone().lerp(tip, (j - 3) * 0.25);
      const theta = angle + side * (0.49 + random() * 0.68);
      const fork = new THREE.Vector3(Math.cos(theta), -0.12 - random() * 0.32, Math.sin(theta));
      const span = Math.min(1.21, width * (0.41 + random() * 0.24));
      const branchTip = forkBase.clone().addScaledVector(fork, span);
      limb(forkBase, branchTip, 0.012, 0.0035, 4);
      for (let k = 0; k < 5; k += 1) {
        const start = forkBase.clone().lerp(branchTip, 0.19 + k * 0.17);
        const phi = theta + (k % 2 === 0 ? 0.82 : -0.82) + (random() - 0.5) * 0.40;
        spray(start, new THREE.Vector3(Math.cos(phi), -0.16 + random() * 0.26, Math.sin(phi)),
          span * (0.79 - k * 0.08) * (0.74 + random() * 0.26));
      }
    }
  }
  const needles = new THREE.BufferGeometry();
  needles.setAttribute('position', new THREE.Float32BufferAttribute(leaves, 3));
  needles.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  needles.computeVertexNormals();
  const branches = mergeGeometries(bark)!;
  for (const twig of bark) twig.dispose();
  return { branches, needles };
}

export function createInariGrove(wood: THREE.Texture): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Cedar grove along the vermilion trail';
  const bark = new THREE.MeshStandardMaterial({
    color: 0x896c56, map: wood, bumpMap: wood, bumpScale: 0.12, roughness: 0.89,
  });
  const needles = new THREE.MeshStandardMaterial({
    color: 0xc3c6a4, vertexColors: true, side: THREE.DoubleSide, roughness: 0.86,
  });
  const random = coastRandom(3563451);
  const groves = Array.from({ length: 3 }, () => [] as THREE.Matrix4[]);
  const tree = new THREE.Object3D();
  for (let row = 901; row < 1063; row += 4.5) {
    for (let col = 185; col < 293; col += 4.5) {
      const x = col + random() * 3.9, z = row + random() * 3.9;
      const cover = inariWoodland(x, z);
      if (random() > cover * 0.67 || coastPlantingDistance(x, z) < 2.2 || groundSlope(x, z) > 1.76) continue;
      const height = 0.80 + random() * 0.77;
      const spread = 0.74 + (height - 0.80) * 0.53;
      tree.position.set(x, groundHeight(x, z) - 0.14, z);
      tree.rotation.set(0, random() * Math.PI * 2, (random() - 0.5) * 0.08);
      const growthScale = inariCanopyScale(x, z);
      const width = spread * (0.54 + 0.46 * growthScale);
      tree.scale.set(width, height * growthScale, width);
      tree.updateMatrix();
      groves[Math.floor(random() * groves.length)].push(tree.matrix.clone());
    }
  }
  for (const [i, grove] of groves.entries()) {
    const model = cedar(57389 + i * 379);
    for (const [form, material] of [[model.branches, bark], [model.needles, needles]] as const) {
      const mesh = new THREE.InstancedMesh(form, material, grove.length);
      for (const [index, matrix] of grove.entries()) mesh.setMatrixAt(index, matrix);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}
