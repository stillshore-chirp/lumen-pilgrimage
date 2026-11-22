import * as THREE from 'three';
import { coastRandom, groundHeight } from '../terrain';

const GOLDEN_ANGLE = 2.39996323;
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

const treeProfiles = {
  emergent: { seed: 85121, trunk: 0.074, lean: 0.12, forks: 6, base: 0.52, spread: 0.90, lift: 0.30,
    bark: 0x655646, leaf: 0x456d3e, blade: 0.139, halfWidth: 0.25 },
  spreading: { seed: 32667, trunk: 0.091, lean: 0.19, forks: 7, base: 0.30, spread: 1.00, lift: 0.17,
    bark: 0x70624c, leaf: 0x607c3d, blade: 0.165, halfWidth: 0.32 },
  windPruned: { seed: 63197, trunk: 0.069, lean: 0.36, forks: 5, base: 0.38, spread: 0.81, lift: 0.22,
    bark: 0x595247, leaf: 0x536d3b, blade: 0.143, halfWidth: 0.26 },
};

export type TreeForm = keyof typeof treeProfiles;
type Detail = 'near' | 'middle';
type Stem = { points: THREE.Vector3[]; radii: number[] };
type Shoot = { base: THREE.Vector3; tip: THREE.Vector3; size: number; shade: number };

class Surface {
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

function limbDirection(angle: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
}

function addStem(surface: Surface, stem: Stem, bark: THREE.Color, sides: number, phase: number): void {
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
      const shade = (0.79 + 0.20 * Math.sin(angle * 3 + phase + center.y * 2.6))
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

function makeSkeleton(form: TreeForm): { trunk: Stem; limbs: Stem[]; twigs: Stem[]; shoots: Shoot[] } {
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
  const shoots: Shoot[] = [];
  for (let i = 0; i <= profile.forks; i += 1) {
    const leader = i === profile.forks;
    const level = leader ? 0.89 : i / (profile.forks - 1);
    const angle = i * GOLDEN_ANGLE + (random() - 0.5) * 0.70;
    const out = limbDirection(angle);
    const lateral = limbDirection(angle + Math.PI * 0.5);
    const forkHeight = leader ? 0.92 : profile.base + level * (0.73 - profile.base) + (random() - 0.5) * 0.09;
    const root = trunkCenter(forkHeight);
    const reach = leader ? 0.21 : profile.spread * (0.71 + random() * 0.36) * (1 - level * 0.30);
    const rise = leader ? 0.15 : profile.lift * (0.73 + random() * 0.60);
    const branch = (t: number) => root.clone().addScaledVector(out, reach * t)
      .addScaledVector(UP, rise * t ** 0.77)
      .addScaledVector(lateral, Math.sin(t * 2.4) * reach * 0.13)
      .addScaledVector(X_AXIS, profile.lean * t * 0.34);
    const radius = profile.trunk * (0.61 - level * 0.29);
    limbs.push({ points: [0, 0.23, 0.53, 0.77, 1].map(branch),
      radii: [1, 0.75, 0.49, 0.27, 0.045].map(factor => radius * factor) });

    for (let j = 0; j < 4; j += 1) {
      const t = 0.32 + j * 0.20 + random() * 0.054;
      const twigBase = branch(t);
      const direction = limbDirection(angle + (j % 2 ? -1 : 1) * (0.43 + random() * 0.90));
      const short = (0.17 + random() * 0.22) * (1 - level * 0.30);
      const twigMid = twigBase.clone().addScaledVector(direction, short * 0.54)
        .addScaledVector(UP, 0.025 + random() * 0.072);
      const twigEnd = twigMid.clone().addScaledVector(direction, short * 0.46)
        .addScaledVector(UP, (random() - 0.34) * 0.115);
      twigs.push({ points: [twigBase, twigMid, twigEnd], radii: [radius * (1 - t * 0.59) * 0.49, radius * 0.19, 0.0014] });

      for (const base of [twigMid, twigEnd]) {
        const fan = limbDirection(angle + (random() - 0.5) * 3.0);
        const size = 0.74 + random() * 0.56;
        const tip = base.clone().addScaledVector(fan, size * 0.18).addScaledVector(UP, 0.065 * random());
        shoots.push({ base, tip, size, shade: 0.58 + base.y * 0.28 + t * 0.30 + random() * 0.16 });
      }
    }
    const last = branch(1);
    shoots.push({ base: last, tip: last.clone().addScaledVector(out, 0.19).addScaledVector(UP, 0.04),
      size: 1.12 + random() * 0.32, shade: 0.90 + level * 0.27 });
  }
  return { trunk, limbs, twigs, shoots };
}

function addLeaf(surface: Surface, base: THREE.Vector3, tip: THREE.Vector3, normal: THREE.Vector3,
  halfWidth: number, color: THREE.Color, shade: number, folded: boolean): void {
  const axis = tip.clone().sub(base);
  const across = new THREE.Vector3().crossVectors(normal, axis).normalize().multiplyScalar(halfWidth);
  const middle = base.clone().lerp(tip, 0.42);
  const ridge = surface.point(middle.clone().addScaledVector(normal, halfWidth * 0.34), color, shade * 1.09, 0.5, 0.42);
  const left = surface.point(middle.clone().add(across), color, shade * 0.90, 0, 0.42);
  const right = surface.point(middle.clone().sub(across), color, shade, 1, 0.42);
  const a = surface.point(base, color, shade * 0.85, 0.5, 0);
  const b = surface.point(tip, color, shade * 1.12, 0.5, 1);
  if (folded) {
    const heel = base.clone().lerp(tip, 0.19);
    const heelLeft = surface.point(heel.clone().addScaledVector(across, 0.61), color, shade * 0.92, 0.195, 0.19);
    const heelRight = surface.point(heel.clone().addScaledVector(across, -0.62), color, shade * 0.96, 0.81, 0.19);
    const shoulder = base.clone().lerp(tip, 0.69).addScaledVector(normal, -halfWidth * 0.24);
    const tipLeft = surface.point(shoulder.clone().addScaledVector(across, 0.73), color, shade * 0.98, 0.135, 0.69);
    const tipRight = surface.point(shoulder.clone().addScaledVector(across, -0.68), color, shade * 1.03, 0.84, 0.69);
    const outline = [a, heelRight, right, tipRight, b, tipLeft, left, heelLeft];
    for (let i = 0; i < outline.length; i += 1) {
      surface.triangle(ridge, outline[i], outline[(i + 1) % outline.length]);
    }
  } else {
    surface.triangle(a, ridge, left);
    surface.triangle(a, right, ridge);
    surface.triangle(left, ridge, b);
    surface.triangle(ridge, right, b);
  }
}

function createTreeDetail(form: TreeForm, skeleton: ReturnType<typeof makeSkeleton>, detail: Detail) {
  const profile = treeProfiles[form];
  const wood = new Surface();
  const leaves = new Surface(true);
  const bark = new THREE.Color(profile.bark);
  const leafColor = new THREE.Color(profile.leaf);
  const near = detail === 'near';
  const trunk = near ? skeleton.trunk : {
    points: skeleton.trunk.points.filter((_, i) => i % 2 === 0),
    radii: skeleton.trunk.radii.filter((_, i) => i % 2 === 0),
  };
  addStem(wood, trunk, bark, near ? 10 : 5, 0.3);
  skeleton.limbs.forEach((limb, i) => addStem(wood, near ? limb : {
    points: [limb.points[0], limb.points[2], limb.points[4]],
    radii: [limb.radii[0], limb.radii[2], limb.radii[4]],
  }, bark, near ? 7 : 3, i * 1.43));
  if (near) {
    skeleton.twigs.forEach((twig, i) => addStem(wood, twig, bark, 4, i * 2.7));
  }

  const random = coastRandom(profile.seed + 3170);
  for (const shoot of skeleton.shoots) {
    const direction = shoot.tip.clone().sub(shoot.base).setY(0).normalize();
    const lateral = new THREE.Vector3().crossVectors(UP, direction);
    const leavesPerShoot = 6;
    for (let leaf = 0; leaf < leavesPerShoot; leaf += 1) {
      const t = (leaf + 1) / leavesPerShoot;
      const sign = leaf % 2 === 0 ? -1 : 1;
      const blade = profile.blade * shoot.size * (1.24 - t * 0.50) * (0.58 + random() * 0.78);
      const width = blade * (profile.halfWidth + random() * 0.07);
      const fanning = sign * (0.47 + random() * 0.47);
      const rise = (random() - 0.48) * 0.85;
      const shade = shoot.shade * (0.84 + random() * 0.32);
      const twist = (random() - 0.5) * 1.46;
      if (!near && leaf !== 0 && leaf !== 3) continue;
      const scale = near ? 1 : 1.76;
      const base = shoot.base.clone().lerp(shoot.tip, t);
      const tip = base.clone().addScaledVector(lateral, blade * fanning * scale)
        .addScaledVector(direction, blade * (1.02 - Math.abs(fanning) * 0.62) * scale)
        .addScaledVector(UP, blade * rise);
      const normal = UP.clone().applyAxisAngle(tip.clone().sub(base).normalize(), twist);
      addLeaf(leaves, base, tip, normal, width * scale, leafColor, shade, near);
    }
    if (near) {
      addStem(wood, { points: [shoot.base, shoot.tip], radii: [0.003, 0.0008] }, bark, 3, 0);
    }
  }
  return { wood: wood.geometry(), leaves: leaves.geometry() };
}

export function createCoastTreeMeshes(form: TreeForm) {
  const skeleton = makeSkeleton(form);
  return (['near', 'middle'] as const).map(detail => createTreeDetail(form, skeleton, detail));
}

// At long range the leaf fans still have depth and gaps, with one folded blade for a whole shoot.
export function createDistantCoastTreeMesh(): THREE.BufferGeometry {
  const form = 'spreading';
  const { trunk, limbs, shoots } = makeSkeleton(form);
  const surface = new Surface();
  const bark = new THREE.Color(treeProfiles[form].bark);
  const leaf = new THREE.Color(treeProfiles[form].leaf);
  const indices = [0, 3, 7, 10];
  addStem(surface, { points: indices.map(i => trunk.points[i]), radii: indices.map(i => trunk.radii[i]) }, bark, 3, 0.7);
  for (const limb of limbs) {
    addStem(surface, { points: [limb.points[0], limb.points[4]], radii: [limb.radii[0], limb.radii[4]] }, bark, 3, 0.4);
  }
  shoots.forEach((shoot, index) => {
    if (index % 2 > 0) return;
    const axis = shoot.tip.clone().sub(shoot.base).normalize();
    const middle = shoot.base.clone().addScaledVector(axis, 0.20 * shoot.size);
    const width = new THREE.Vector3().crossVectors(UP, axis).multiplyScalar(0.18 * shoot.size);
    const tip = shoot.base.clone().addScaledVector(axis, 0.43 * shoot.size).addScaledVector(UP, 0.035);
    const a = surface.point(shoot.base, leaf, shoot.shade * 0.75);
    const b = surface.point(middle.clone().add(width), leaf, shoot.shade);
    const c = surface.point(tip, leaf, shoot.shade * 1.08);
    const d = surface.point(middle.clone().sub(width).addScaledVector(UP, 0.09), leaf, shoot.shade * 0.92);
    surface.triangle(a, b, c);
    surface.triangle(a, c, d);
  });
  return surface.geometry();
}

type RootPlacement = { x: number; y: number; z: number; width: number; height: number; yaw: number; form: TreeForm };

export function createCoastRoots(trees: RootPlacement[], origin: THREE.Vector3): THREE.BufferGeometry {
  const surface = new Surface();
  const bark = new THREE.Color();
  for (const tree of trees) {
    const profile = treeProfiles[tree.form];
    bark.setHex(profile.bark);
    for (let root = 0; root < 4; root += 1) {
      const angle = tree.yaw + root * GOLDEN_ANGLE;
      const length = tree.width * (0.22 + 0.19 * Math.sin(root * 9.1 + tree.yaw) ** 2);
      const ribs: number[][] = [];
      const width = profile.trunk * tree.width;
      for (let step = 0; step < 4; step += 1) {
        const t = step / 3;
        const heading = angle + t * 0.24;
        const x = tree.x + Math.cos(heading) * length * t;
        const z = tree.z + Math.sin(heading) * length * t;
        const spread = width * (0.52 * (1 - t) + 0.03);
        const relief = step === 0 ? tree.y + tree.height * 0.14
          : groundHeight(x, z) + tree.height * 0.077 * (1 - t) ** 2 - 0.36 * t * t;
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
