import * as THREE from 'three';
import { coastRandom, groundHeight } from '../terrain';

export const GOLDEN_ANGLE = 2.39996323;
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

const treeProfiles = {
  emergent: { seed: 85121, trunk: 0.074, lean: 0.12, forks: 6, base: 0.52, spread: 0.90, lift: 0.30,
    bark: 0x655646, leaf: 0x456d3e, blade: 0.139, halfWidth: 0.25 },
  spreading: { seed: 32667, trunk: 0.091, lean: 0.19, forks: 7, base: 0.30, spread: 1.00, lift: 0.17,
    bark: 0x70624c, leaf: 0x607c3d, blade: 0.165, halfWidth: 0.32 },
  windPruned: { seed: 63197, trunk: 0.069, lean: 0.36, forks: 5, base: 0.38, spread: 0.81, lift: 0.22,
    bark: 0x595247, leaf: 0x536d3b, blade: 0.143, halfWidth: 0.26 },
  buttressed: { seed: 684931, trunk: 0.152, lean: -0.18, forks: 7, base: 0.29, spread: 1.18, lift: 0.27,
    bark: 0x655b4c, leaf: 0x46642e, blade: 0.161, halfWidth: 0.33 },
  sapling: { seed: 412822, trunk: 0.043, lean: 0.08, forks: 4, base: 0.52, spread: 0.76, lift: 0.25,
    bark: 0x6a6d5f, leaf: 0x4d7840, blade: 0.161, halfWidth: 0.23 },
};

export type TreeForm = keyof typeof treeProfiles;
type Detail = 'near' | 'middle' | 'distant';
type Stem = { points: THREE.Vector3[]; radii: number[] };
type Shoot = { base: THREE.Vector3; tip: THREE.Vector3; size: number; shade: number };

export class PlantSurface {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  private readonly uvs: number[] = [];

  constructor(private readonly leafUvs = false) {}

  point(point: THREE.Vector3, color: THREE.Color, shade: number, u = 0, v = 0): number {
    const index = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z);
    this.colors.push(color.r * shade, color.g * shade, color.b * shade);
    if (this.leafUvs) this.uvs.push(u, v);
    return index;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  geometry(): THREE.BufferGeometry {
    const mesh = new THREE.BufferGeometry();
    mesh.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    mesh.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.leafUvs) mesh.setAttribute('bladeUv', new THREE.Float32BufferAttribute(this.uvs, 2));
    mesh.setIndex(this.indices);
    mesh.computeVertexNormals();
    return mesh;
  }
}

export function plantDirection(angle: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
}

export function addStem(surface: PlantSurface, stem: Stem, bark: THREE.Color, sides: number, phase: number, baseShade = 1): void {
  const rings: number[][] = [];
  const facing = new THREE.Vector3();
  const across = new THREE.Vector3();
  for (let i = 0; i < stem.points.length; i += 1) {
    const center = stem.points[i];
    const tangent = stem.points[Math.min(i + 1, stem.points.length - 1)].clone()
      .sub(stem.points[Math.max(i - 1, 0)]).normalize();
    // Transport the cross-section around bends so the bark does not twist between rings.
    facing.addScaledVector(tangent, -facing.dot(tangent));
    if (facing.lengthSq() < 0.0001) facing.crossVectors(tangent, Math.abs(tangent.y) > 0.8 ? X_AXIS : UP);
    facing.normalize();
    across.crossVectors(tangent, facing);
    const ring: number[] = [];
    rings.push(ring);
    for (let side = 0; side < sides; side += 1) {
      const angle = side / sides * Math.PI * 2;
      const groove = Math.sin(angle * 3 + phase) * 0.12 + Math.sin(angle * 5 - phase * 1.6) * 0.09;
      const radius = stem.radii[i] * (1 + groove);
      const point = center.clone().addScaledVector(facing, Math.cos(angle) * radius)
        .addScaledVector(across, Math.sin(angle) * radius);
      const shade = baseShade * (0.79 + 0.20 * Math.sin(angle * 3 + phase + center.y * 2.6))
        * (0.76 + 0.38 * THREE.MathUtils.smoothstep(center.y, -0.02, 0.45));
      ring.push(surface.point(point, bark, shade));
    }
    if (i === 0) continue;
    const previous = rings[i - 1];
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      surface.triangle(previous[side], previous[next], ring[side]);
      surface.triangle(previous[next], ring[next], ring[side]);
    }
  }
}

function makeSkeleton(form: TreeForm): { trunk: Stem; limbs: Stem[]; twigs: Stem[]; vines: Stem[]; shoots: Shoot[] } {
  const profile = treeProfiles[form];
  const random = coastRandom(profile.seed);
  const trunkCenter = (y: number) => {
    const t = Math.max(0, y);
    return new THREE.Vector3(profile.lean * (t * t + 0.19 * Math.sin(t * 5.1)), y,
      0.085 * Math.sin(t * 4.4) * t);
  };
  const trunk = {
    points: [-0.32, -0.03, 0.035, 0.13, 0.27, 0.42, 0.56, 0.70, 0.83, 0.93, 1.01].map(trunkCenter),
    radii: [1.25, 1.30, 1.09, 0.85, 0.75, 0.64, 0.52, 0.44, 0.32, 0.21, 0.03]
      .map(radius => radius * profile.trunk),
  };
  const limbs: Stem[] = [];
  const twigs: Stem[] = [];
  const vines: Stem[] = [];
  const shoots: Shoot[] = [];
  for (let i = 0; i <= profile.forks; i += 1) {
    const leader = i === profile.forks;
    const level = leader ? 0.89 : i / (profile.forks - 1);
    const angle = i * GOLDEN_ANGLE + (random() - 0.5) * 0.70;
    const out = plantDirection(angle);
    const lateral = plantDirection(angle + Math.PI * 0.5);
    const forkHeight = leader ? 0.92 : profile.base + level * (0.73 - profile.base) + (random() - 0.5) * 0.09;
    const root = trunkCenter(forkHeight);
    const fork = form === 'buttressed' && i === 0;
    const reach = leader ? 0.21 : profile.spread * (0.66 + random() * 0.48) * (1 - level * 0.35) * (fork ? 0.79 : 1);
    const rise = leader ? 0.15 : profile.lift * (0.73 + random() * 0.60);
    const branch = (t: number) => root.clone().addScaledVector(out, reach * t)
      .addScaledVector(UP, fork ? 0.66 * t ** 1.62 : rise * t ** 0.77 + Math.sin(t * 3.7) * 0.025)
      .addScaledVector(lateral, Math.sin(t * 2.4) * reach * 0.19)
      .addScaledVector(X_AXIS, profile.lean * t * 0.34);
    const radius = profile.trunk * (fork ? 0.84 : 0.64 - level * 0.29);
    limbs.push({ points: [0, 0.23, 0.53, 0.77, 1].map(branch),
      radii: [1, 0.75, 0.49, 0.27, 0.045].map(factor => radius * factor) });

    const twigCount = form === 'sapling' ? 3 : 4;
    for (let j = 0; j < twigCount; j += 1) {
      const t = 0.29 + j * 0.63 / (twigCount - 1) + random() * 0.054;
      const twigBase = branch(t);
      const direction = plantDirection(angle + (j % 2 ? -1 : 1) * (0.43 + random() * 0.90));
      const short = (0.17 + random() * 0.22) * (1 - level * 0.30);
      const twigMid = twigBase.clone().addScaledVector(direction, short * 0.54)
        .addScaledVector(UP, 0.025 + random() * 0.072);
      const twigEnd = twigMid.clone().addScaledVector(direction, short * 0.46)
        .addScaledVector(UP, (random() - 0.34) * 0.115);
      twigs.push({ points: [twigBase, twigMid, twigEnd], radii: [radius * (1 - t * 0.59) * 0.49, radius * 0.19, 0.0014] });

      for (const base of [twigMid, twigEnd]) {
        const fan = plantDirection(angle + (random() - 0.5) * 3.0);
        const size = 0.70 + random() * 0.72;
        const tip = base.clone().addScaledVector(fan, size * 0.19).addScaledVector(UP, (random() - 0.27) * 0.09);
        shoots.push({ base, tip, size, shade: 0.51 + base.y * 0.26 + t * 0.34 + random() * 0.20 });
      }
      if (form === 'buttressed' && j === 2 && i % 3 === 0) {
        const drop = 0.17 + random() * 0.30;
        const vine = (u: number) => twigMid.clone().addScaledVector(UP, -u * drop)
          .addScaledVector(out, 0.05 * Math.sin(u * 4.0))
          .addScaledVector(lateral, 0.028 * Math.sin(u * 7.0));
        vines.push({ points: [0, 0.15, 0.34, 0.55, 0.78, 1].map(vine),
          radii: [0.0058, 0.0048, 0.0042, 0.0036, 0.0027, 0.001] });
      }
    }
    const last = branch(1);
    shoots.push({ base: last, tip: last.clone().addScaledVector(out, 0.19).addScaledVector(UP, 0.04),
      size: 1.12 + random() * 0.32, shade: 0.90 + level * 0.27 });
  }
  return { trunk, limbs, twigs, vines, shoots };
}

function addLeaf(surface: PlantSurface, base: THREE.Vector3, tip: THREE.Vector3, normal: THREE.Vector3,
  halfWidth: number, color: THREE.Color, shade: number, level: Detail | 'horizon'): void {
  const axis = tip.clone().sub(base);
  const across = new THREE.Vector3().crossVectors(normal, axis).normalize().multiplyScalar(halfWidth);
  const a = surface.point(base, color, shade * 0.85, 0.5, 0);
  const b = surface.point(tip, color, shade * 1.12, 0.5, 1);
  if (level === 'distant' || level === 'horizon') {
    const middle = base.clone().lerp(tip, 0.45);
    const ridge = surface.point(middle.clone().addScaledVector(normal, halfWidth * 0.29), color, shade * 1.08, 0.5, 0.45);
    const left = surface.point(middle.clone().add(across), color, shade * 0.93, 0, 0.45);
    const right = surface.point(middle.clone().sub(across), color, shade, 1, 0.45);
    surface.triangle(a, ridge, left);
    surface.triangle(a, right, ridge);
    surface.triangle(left, ridge, b);
    surface.triangle(ridge, right, b);
    return;
  }

  // The midrib arches through the whole blade and the shoulders roll down gently into its edge.
  const steps = level === 'near' ? [0.13, 0.28, 0.47, 0.65, 0.82] : [0.26, 0.54, 0.77];
  const curl = Math.sin(base.x * 35.8 + tip.z * 58.1);
  let previousLeft = a;
  let previousCenter = a;
  let previousRight = a;
  for (const t of steps) {
    const width = Math.sin(t ** 0.84 * Math.PI) ** 0.83;
    const bow = base.clone().lerp(tip, t).addScaledVector(normal, halfWidth * 0.42 * Math.sin(t * Math.PI))
      .addScaledVector(across, t * (1 - t) * curl * 0.17);
    const tint = shade * (0.84 + t * 0.33);
    const center = surface.point(bow, color, tint * 1.07, 0.5, t);
    const edge = (sign: number) => bow.clone().addScaledVector(across, sign * width * (1 + curl * sign * 0.09))
      .addScaledVector(normal, halfWidth * width * (-0.27 + sign * curl * t * 0.31));
    const left = surface.point(edge(1), color, tint * 0.95, 0, t);
    const right = surface.point(edge(-1), color, tint, 1, t);
    surface.triangle(previousLeft, center, left);
    surface.triangle(previousRight, right, center);
    if (previousCenter !== a) {
      surface.triangle(previousLeft, previousCenter, center);
      surface.triangle(previousRight, center, previousCenter);
    }
    previousLeft = left;
    previousCenter = center;
    previousRight = right;
  }
  surface.triangle(previousLeft, previousCenter, b);
  surface.triangle(previousCenter, previousRight, b);
}

function createTreeDetail(form: TreeForm, skeleton: ReturnType<typeof makeSkeleton>, detail: Detail) {
  const profile = treeProfiles[form];
  const wood = new PlantSurface();
  const leaves = new PlantSurface(true);
  const bark = new THREE.Color(profile.bark);
  const leafColor = new THREE.Color(profile.leaf);
  const near = detail === 'near';
  const distant = detail === 'distant';
  const trunkSteps = distant ? [0, 4, 7, 10] : [0, 2, 4, 6, 8, 10];
  const trunk = near ? skeleton.trunk : {
    points: trunkSteps.map(i => skeleton.trunk.points[i]),
    radii: trunkSteps.map(i => skeleton.trunk.radii[i]),
  };
  addStem(wood, trunk, bark, near ? 12 : distant ? 4 : 7, 0.3);
  skeleton.limbs.forEach((limb, i) => addStem(wood, near ? limb : {
    points: [limb.points[0], limb.points[2], limb.points[4]],
    radii: [limb.radii[0], limb.radii[2], limb.radii[4]],
  }, bark, near ? 7 : 4, i * 1.43));
  if (near) {
    skeleton.twigs.forEach((twig, i) => addStem(wood, twig, bark, 4, i * 2.7));
    skeleton.vines.forEach((vine, i) => addStem(wood, vine, bark, 4, i * 3.37, 0.68));
  }

  const random = coastRandom(profile.seed + 3170);
  for (let index = 0; index < skeleton.shoots.length; index += 1) {
    const shoot = skeleton.shoots[index];
    const direction = shoot.tip.clone().sub(shoot.base).setY(0).normalize();
    const lateral = new THREE.Vector3().crossVectors(UP, direction);
    const leavesPerShoot = 7;
    for (let leaf = 0; leaf < leavesPerShoot; leaf += 1) {
      const t = (leaf + 1) / leavesPerShoot;
      const sign = leaf % 2 === 0 ? -1 : 1;
      const blade = profile.blade * shoot.size * (1.24 - t * 0.50) * (0.59 + random() * 0.61);
      const width = blade * (profile.halfWidth + random() * 0.07);
      const fanning = sign * (0.47 + random() * 0.47);
      const rise = (random() - 0.48) * 0.85;
      const shade = shoot.shade * (0.84 + random() * 0.32);
      const twist = (random() - 0.5) * 1.46;
      if (distant && (index % 2 !== 0 || (leaf !== 0 && leaf !== 3))) continue;
      if (!distant && !near && leaf !== 0 && leaf !== 2 && leaf !== 5) continue;
      const scale = near ? 0.73 : distant ? 1.92 : 1.07;
      const base = shoot.base.clone().lerp(shoot.tip, t);
      const tip = base.clone().addScaledVector(lateral, blade * fanning * scale)
        .addScaledVector(direction, blade * (1.02 - Math.abs(fanning) * 0.62) * scale)
        .addScaledVector(UP, blade * rise);
      const normal = UP.clone().applyAxisAngle(tip.clone().sub(base).normalize(), twist);
      addLeaf(leaves, base, tip, normal, width * scale * (distant ? 1.51 : 1.02), leafColor, shade, detail);
    }
    if (near) {
      addStem(wood, { points: [shoot.base, shoot.tip], radii: [0.003, 0.0008] }, bark, 3, 0);
    }
  }
  return { wood: wood.geometry(), leaves: leaves.geometry() };
}

export function createCoastTreeMeshes(form: TreeForm) {
  const skeleton = makeSkeleton(form);
  return (['near', 'middle', 'distant'] as const).map(detail => createTreeDetail(form, skeleton, detail));
}

// The skyline keeps an uneven, porous crown while distant tiles use one material and one draw.
export function createHorizonTreeMesh(): THREE.BufferGeometry {
  const form = 'spreading';
  const { trunk, limbs, shoots } = makeSkeleton(form);
  const surface = new PlantSurface();
  const bark = new THREE.Color(treeProfiles[form].bark);
  const leaf = new THREE.Color(treeProfiles[form].leaf);
  const indices = [0, 3, 7, 10];
  addStem(surface, { points: indices.map(i => trunk.points[i]), radii: indices.map(i => trunk.radii[i]) }, bark, 3, 0.7);
  for (const limb of limbs) {
    addStem(surface, { points: [limb.points[0], limb.points[4]], radii: [limb.radii[0], limb.radii[4]] }, bark, 3, 0.4);
  }
  shoots.forEach((shoot, index) => {
    if (index % 3 !== 0) return;
    const axis = shoot.tip.clone().sub(shoot.base).normalize();
    const normal = UP.clone().applyAxisAngle(axis, Math.sin(index * 2.39) * 1.08);
    const tip = shoot.base.clone().addScaledVector(axis, 0.41 * shoot.size);
    addLeaf(surface, shoot.base, tip, normal, 0.185 * shoot.size, leaf, shoot.shade, 'horizon');
  });
  return surface.geometry();
}

type RootPlacement = { x: number; y: number; z: number; width: number; height: number; yaw: number; form: TreeForm };

export function createCoastRoots(trees: RootPlacement[], origin: THREE.Vector3): THREE.BufferGeometry {
  const surface = new PlantSurface();
  const bark = new THREE.Color();
  for (const tree of trees) {
    const profile = treeProfiles[tree.form];
    bark.setHex(profile.bark);
    if (tree.form === 'sapling') continue;
    const large = tree.form === 'buttressed';
    const rootCount = large ? 6 : 4;
    const steps = large ? 5 : 4;
    for (let root = 0; root < rootCount; root += 1) {
      const angle = tree.yaw + root * GOLDEN_ANGLE;
      const sinuosity = Math.sin(root * 9.1 + tree.yaw);
      const length = tree.width * ((large ? 0.39 : 0.24) + 0.23 * sinuosity ** 2);
      const ribs: number[][] = [];
      const width = profile.trunk * tree.width;
      for (let step = 0; step < steps; step += 1) {
        const t = step / (steps - 1);
        const heading = angle + t * 0.38 * sinuosity;
        const x = tree.x + Math.cos(heading) * length * t;
        const z = tree.z + Math.sin(heading) * length * t;
        const spread = width * (0.56 * (1 - t) + 0.03);
        const relief = step === 0 ? tree.y + tree.height * (large ? 0.19 : 0.12)
          : groundHeight(x, z) + tree.height * (large ? 0.105 : 0.061) * (1 - t) ** 1.9 - 0.22 * t * t;
        const crest = new THREE.Vector3(x, relief, z).sub(origin);
        const side = (sign: number) => {
          const leftX = x + sign * Math.sin(heading) * spread;
          const leftZ = z - sign * Math.cos(heading) * spread;
          return new THREE.Vector3(leftX, groundHeight(leftX, leftZ) - 0.13 - 0.22 * t, leftZ).sub(origin);
        };
        const rib = [surface.point(side(-1), bark, 0.64), surface.point(crest, bark, 0.91), surface.point(side(1), bark, 0.70)];
        ribs.push(rib);
        if (step === 0) continue;
        const previous = ribs[step - 1];
        surface.triangle(previous[0], rib[0], previous[1]);
        surface.triangle(previous[1], rib[0], rib[1]);
        surface.triangle(previous[1], rib[1], previous[2]);
        surface.triangle(previous[2], rib[1], rib[2]);
      }
    }
  }
  return surface.geometry();
}
