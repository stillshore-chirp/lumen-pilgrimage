import * as THREE from 'three';
import { coastRandom, groundHeight } from '../terrain';
import type { InariPlacement } from './coastInariModels';

export type StoneCourse = {
  near: InariPlacement;
  far: InariPlacement;
  length: number;
};

type StoneFinish = 'flag' | 'step' | 'edge';
type StonePoint = { x: number; y: number; z: number; u: number; v: number };
type OutlinePoint = { side: number; run: number };

export function stoneCourse(near: InariPlacement, far: InariPlacement): StoneCourse {
  return { near, far, length: Math.hypot(far.x - near.x, far.z - near.z) };
}

function coursePoint(course: StoneCourse, side: number, run: number): { x: number; z: number } {
  const { near, far, length } = course;
  const t = run / length + 0.5;
  return {
    x: THREE.MathUtils.lerp(near.x + Math.cos(near.yaw) * side, far.x + Math.cos(far.yaw) * side, t),
    z: THREE.MathUtils.lerp(near.z - Math.sin(near.yaw) * side, far.z - Math.sin(far.yaw) * side, t),
  };
}

export class InariStoneBatch {
  private readonly positions: number[] = [];
  private readonly uv: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];
  private readonly random: () => number;

  constructor(seed: number) {
    this.random = coastRandom(seed);
  }

  private vertex(point: StonePoint, shade: number, patina: number): number {
    const index = this.positions.length / 3;
    this.positions.push(point.x, point.y, point.z);
    this.uv.push(point.u, point.v);
    this.colors.push(shade * (1.02 - patina * 0.12), shade * (1.04 - patina * 0.06),
      shade * (1.14 - patina * 0.33));
    return index;
  }

  private strip(outside: number[], inside: number[]): void {
    for (let i = 0; i < outside.length; i += 1) {
      const next = (i + 1) % outside.length;
      this.indices.push(outside[i], outside[next], inside[i], outside[next], inside[next], inside[i]);
    }
  }

  slab(course: StoneCourse, left: number, right: number, finish: StoneFinish): void {
    const random = this.random;
    const center = (left + right) * 0.5;
    const joint = finish === 'edge' ? 0.012 : 0.007;
    const w = (right - left) * 0.5 - joint * (0.72 + random() * 0.63);
    const d = course.length * 0.5 - joint * (0.71 + random() * 0.66);
    const cutter = Math.min(w, d, 0.1);
    const chip = () => cutter * (0.14 + random() * 0.39);
    const jostle = () => cutter * (random() - 0.5) * 0.19;
    const outline: OutlinePoint[] = [
      { side: -w + chip(), run: -d }, { side: -w, run: -d + chip() },
      { side: -w + jostle(), run: jostle() },
      { side: -w, run: d - chip() }, { side: -w + chip(), run: d },
      { side: jostle(), run: d + jostle() },
      { side: w - chip(), run: d }, { side: w, run: d - chip() },
      { side: w + jostle(), run: jostle() },
      { side: w, run: -d + chip() }, { side: w - chip(), run: -d },
      { side: jostle(), run: -d + jostle() },
    ];
    // UVs hold a common scale in metres and vary in orientation and origin between stones.
    const angle = random() * Math.PI * 2;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const u0 = random(), v0 = random();
    const grain = 1.63 + random() * 0.39;
    const tone = (finish === 'edge' ? 1.02 : 1.22) + random() * 0.33;
    const surfacePatina = random() * 0.37 + (finish === 'edge' ? 0.37 : 0.07);
    const offset = 0.039 + random() * 0.012 + (finish === 'edge' ? 0.025 : 0);
    const scaleBevel = finish === 'step' ? 0.29 : 0.35;
    const tread = finish === 'step';
    const grade = (side: number, run: number) => {
      const { x, z } = coursePoint(course, center + side, run);
      return groundHeight(x, z);
    };
    // Dress each face to a single plane, with only shallow wear in the cap.
    // The step faces follow the crossfall and expose an uphill-height riser.
    const sampleRun = tread ? course.length * 0.5 : 0;
    const crossfall = (grade(w, sampleRun) - grade(-w, sampleRun)) / (2 * w);
    const slope = tread ? 0 : (grade(0, d) - grade(0, -d)) / (2 * d);
    const relativeY = (side: number, run: number) => crossfall * side + slope * run;
    const supportY = Math.max(grade(0, sampleRun), grade(0, 0), ...outline.map(({ side, run }) =>
      grade(side, run) - relativeY(side, run)));
    const point = (side: number, run: number, height: number): StonePoint => {
      const { x, z } = coursePoint(course, center + side, run);
      return { x, z, y: supportY + relativeY(side, run) + offset + height,
        u: u0 + (side * cos - run * sin) * grain, v: v0 + (side * sin + run * cos) * grain };
    };
    const bevels = outline.map(() => cutter * (scaleBevel * (0.78 + random() * 0.43)));
    const rim = outline.map(({ side, run }, i) => point(side, run, -bevels[i] * 0.83));
    const crown = outline.map(({ side, run }, i) =>
      point(side * (1 - bevels[i] / w), run * (1 - bevels[i] / d), -random() * 0.008));
    const inner = outline.map(({ side, run }) => point(side * 0.47, run * 0.42, (random() - 0.52) * 0.011));
    const lip = rim.map((p) => this.vertex(p, tone * 0.82, surfacePatina + 0.28));
    const face = crown.map((p) => this.vertex(p, tone * (0.91 + random() * 0.12), surfacePatina + 0.12));
    const worn = inner.map((p) => this.vertex(p, tone * (0.99 + random() * 0.09), surfacePatina * 0.66));
    const middle = this.vertex(point(0, 0, 0.002), tone * 1.05, surfacePatina * 0.58);
    this.strip(lip, face);
    this.strip(face, worn);
    for (let i = 0; i < worn.length; i += 1) this.indices.push(worn[i], worn[(i + 1) % worn.length], middle);

    let wrap = u0;
    const foot = rim.map(p => Math.min(p.y - 0.08, groundHeight(p.x, p.z) - 0.10));
    for (let i = 0; i < rim.length; i += 1) {
      const next = (i + 1) % rim.length;
      const a = rim[i], b = rim[next];
      const end = wrap + Math.hypot(b.x - a.x, b.z - a.z) * 2.3;
      const high = (p: StonePoint, u: number) =>
        this.vertex({ ...p, u, v: v0 + p.y * 2.3 }, tone * 0.83, surfacePatina + 0.18);
      const low = (p: StonePoint, u: number, y: number) =>
        this.vertex({ ...p, u, y, v: v0 + y * 2.3 }, tone * 0.54, surfacePatina + 0.49);
      const a0 = low(a, wrap, foot[i]), b0 = low(b, end, foot[next]);
      const a1 = high(a, wrap), b1 = high(b, end);
      this.indices.push(a0, b0, a1, b0, b1, a1);
      wrap = end;
    }
  }

  mesh(name: string, material: THREE.MeshStandardMaterial): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
}
