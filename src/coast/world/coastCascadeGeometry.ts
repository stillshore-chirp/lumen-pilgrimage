import * as THREE from 'three';
import { groundHeight, SEA_LEVEL, smoothstep, type CoastPoint, type CoastWaterfall } from '../terrain';

interface Channel {
  offset: number;
  width: number;
  depth: number;
  separation: number;
  from?: number;
  to?: number;
}

interface CascadeShape {
  feederStart: number;
  lip: number;
  join: number;
  bend: number;
  ledge: number;
  channels: Channel[];
}

const shapes: CascadeShape[] = [
  // The broad eastern fall runs across two shelves before reaching the bay.
  { feederStart: -12, lip: 10.5, join: 2, bend: -0.19, ledge: 0.68, channels: [
    { offset: -0.07, width: 0.63, depth: 0.119, separation: -0.05 },
    { offset: 0.31, width: 0.28, depth: 0.065, separation: 0.21 },
    { offset: -0.41, width: 0.22, depth: 0.037, separation: -0.19 },
    { offset: 0.52, width: 0.08, depth: 0.023, separation: 0.27, from: 0.29, to: 0.87 },
  ] },
  // The nearer western fall parts around the rock at the lip and rejoins below.
  { feederStart: -11, lip: 5.2, join: 2, bend: -0.19, ledge: 0.55, channels: [
    { offset: -0.15, width: 0.66, depth: 0.118, separation: -0.12 },
    { offset: 0.28, width: 0.29, depth: 0.078, separation: 0.18 },
    { offset: -0.51, width: 0.15, depth: 0.028, separation: -0.25, from: 0.35, to: 0.95 },
  ] },
  // Two narrow streams split around the distant spur.
  { feederStart: 9.5, lip: 27.8, join: 5, bend: 0.08, ledge: 0.68, channels: [
    { offset: -0.24, width: 0.48, depth: 0.083, separation: -0.16 },
    { offset: 0.23, width: 0.35, depth: 0.067, separation: 0.18 },
    { offset: -0.56, width: 0.13, depth: 0.030, separation: -0.25, from: 0.16, to: 0.80 },
  ] },
];

interface Section {
  center: THREE.Vector3;
  progress: number;
  onRock: number;
  width: number;
  depth: number;
  opacity: number;
}

export interface CascadeImpact {
  point: CoastPoint;
  width: number;
  kind: 'pool' | 'ledge' | 'shear';
}

// A monotone path in the downslope direction keeps the short shelves from
// picking up the hooks that ordinary cubic interpolation adds to steep bends.
function slope(a: number, b: number): number {
  return a * b > 0 ? 2 * a * b / (a + b) : 0;
}

function runAt(runs: readonly number[], row: number): number {
  const i = Math.min(runs.length - 2, Math.floor(row));
  const u = row - i;
  const a = runs[i];
  const b = runs[i + 1];
  const m0 = slope(a - (runs[i - 1] ?? a), b - a);
  const m1 = slope(b - a, (runs[i + 2] ?? b) - b);
  return THREE.MathUtils.lerp(a, b, u * u * (3 - 2 * u))
    + u * (1 - u) * ((1 - u) * m0 - u * m1);
}

function channelSections(
  fall: CoastWaterfall, shape: CascadeShape, channel: Channel, position: number
): Section[] {
  const crown = fall.path[0];
  const last = fall.path.length - 1;
  const { x, z } = fall.direction;
  const { width } = fall;
  const phase = position * 2.15 + shape.lip * 0.19;
  const minimumRun = fall.path.map(point => (point.x - crown.x) * x + (point.z - crown.z) * z);
  const join = Math.min(shape.join, last - 1);
  // Each course braces against the ledge near its own lateral position.
  function makeSection(run: number, y: number, progress: number, feather: number, feeding: boolean): Section {
    const branching = smoothstep(0.08, 0.38, progress) * (1 - 0.30 * smoothstep(0.78, 1, progress));
    const meander = 0.026 * Math.sin(14 * progress + phase) + 0.016 * Math.sin(31 * progress - phase);
    const spreading = smoothstep(-0.03, 0.13, progress);
    const lateral = width * (channel.offset * (0.38 + 0.62 * spreading)
      + channel.separation * branching + meander
      + shape.bend * (1 - smoothstep(-0.07, 0.15, progress)));
    const hittingShelf = Math.exp(-Math.pow((progress - shape.ledge) * 12, 2));
    const widthScale = feeding ? 0.74 + 0.25 * feather : 0.83 + 0.12 * Math.sin(17 * progress + phase)
      + 0.047 * Math.sin(53 * progress + phase) + 0.21 * hittingShelf + 0.25 * smoothstep(0.81, 1, progress);
    const span = width * channel.width * widthScale * (0.52 + 0.48 * feather)
      * (position === 0 ? 1 : 0.66 + 0.34 * spreading);
    const px = crown.x + run * x - lateral * z;
    const pz = crown.z + run * z + lateral * x;
    const ground = groundHeight(px, pz);
    const runoff = smoothstep(0.76, 0.94, progress) * (1 - smoothstep(3.2, 12, y - ground));
    const height = feeding ? ground + 0.66 : THREE.MathUtils.lerp(Math.max(y, ground + 0.52),
      Math.max(SEA_LEVEL + 0.13, ground + 0.53), runoff * 0.88);
    const clearance = feeding ? 0 : height - ground;
    const loose = smoothstep(1.8, 9, clearance);
    const depth = width * channel.depth * (0.42 + loose * (0.58 + 0.14 * Math.sin(28 * progress + phase)));
    return {
      center: new THREE.Vector3(px, height, pz),
      progress, onRock: 1 - loose, width: span, depth, opacity: feather,
    };
  }

  const sections: Section[] = [];
  const from = channel.from ?? 0;
  const to = channel.to ?? 1;
  const lip = Math.min(shape.lip, minimumRun[join] - 0.9);
  if (from === 0) {
    const feederRows = 24;
    for (let i = 0; i <= feederRows; i += 1) {
      const t = i / feederRows;
      const run = THREE.MathUtils.lerp(shape.feederStart, lip, t);
      const fade = smoothstep(0, 0.23, t) * (position === 0 ? 1 : 0.45 + 0.55 * smoothstep(0.4, 1, t));
      sections.push(makeSection(run, 0, -0.15 * (1 - t), fade, true));
    }
    const lipCenter = sections[sections.length - 1].center;
    const joinY = fall.path[join].y;
    for (let i = 1; i < 12; i += 1) {
      const t = i / 12;
      // Carry the lip's horizontal momentum into a drop, easing into the
      // near-vertical course. The terrain still supports the uphill half.
      const run = THREE.MathUtils.lerp(lip, minimumRun[join], 1 - (1 - t) * (1 - t));
      const y = THREE.MathUtils.lerp(Math.max(lipCenter.y, joinY + 1.1), joinY, t * t);
      sections.push(makeSection(run, y, t * join / last, 1, false));
    }
  }

  const first = Math.max(join, from * last);
  const rows = Math.ceil((to * last - first) * 5);
  for (let i = 0; i <= rows; i += 1) {
    const row = THREE.MathUtils.lerp(first, to * last, i / rows);
    const progress = row / last;
    const run = runAt(minimumRun, row)
      + (0.52 + 0.48 * Math.sin(12 * progress + phase)) * width * 0.09 * Math.sin(Math.PI * progress);
    const verticalRow = Math.min(last - 1, Math.floor(row));
    const y = THREE.MathUtils.lerp(fall.path[verticalRow].y, fall.path[verticalRow + 1].y, row - verticalRow);
    const birth = from === 0 ? 1 : smoothstep(from, from + 0.065, progress);
    const end = to === 1 ? 1 - 0.42 * smoothstep(0.94, 1, progress) : 1 - smoothstep(to - 0.1, to, progress);
    sections.push(makeSection(run, y, progress, birth * end, false));
  }
  // Smooth small variations between terrain samples while leaving the broad
  // steps intact, especially where a shallow run turns into a drop.
  for (let pass = 0; pass < 2; pass += 1) {
    const centers = sections.map(section => section.center.clone());
    for (let i = 1; i < sections.length - 1; i += 1) {
      sections[i].center.copy(centers[i]).multiplyScalar(0.60)
        .addScaledVector(centers[i - 1], 0.20).addScaledVector(centers[i + 1], 0.20);
    }
  }
  return sections;
}

export function createCascadeGeometry(fall: CoastWaterfall, index: number): {
  geometry: THREE.BufferGeometry;
  impacts: CascadeImpact[];
} {
  const shape = shapes[index] ?? shapes[0];
  const positions: number[] = [];
  const flows: number[] = [];
  const water: number[] = [];
  const indices: number[] = [];
  const impacts: CascadeImpact[] = [];
  const side = new THREE.Vector3(-fall.direction.z, 0, fall.direction.x);
  const tangent = new THREE.Vector3();
  const across = new THREE.Vector3();
  const surface = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const ringSize = 14;

  for (const [lane, channel] of shape.channels.entries()) {
    const sections = channelSections(fall, shape, channel, lane);
    const start = positions.length / 3;
    let travelTime = 0;
    let speed = 5.5 + lane * 0.49;
    for (const [row, section] of sections.entries()) {
      const previous = sections[Math.max(0, row - 1)];
      const next = sections[Math.min(sections.length - 1, row + 1)];
      const distance = section.center.distanceTo(previous.center);
      const drop = previous.center.y - section.center.y;
      // The flow coordinate is travel time. It stretches a moving filament
      // where gravity accelerates it and compresses it at a rocky landing.
      speed = Math.max(4.5, Math.sqrt(Math.max(0, speed * speed + 16 * drop)))
        * Math.exp(-distance * section.onRock * 0.033);
      travelTime += distance / Math.max(speed, 3.6);
      tangent.subVectors(next.center, previous.center).normalize();
      across.copy(side).addScaledVector(tangent, -side.dot(tangent)).normalize();
      surface.crossVectors(across, tangent).normalize();
      for (let col = 0; col < ringSize; col += 1) {
        const angle = col / ringSize * Math.PI * 2;
        const lateral = Math.cos(angle);
        const height = Math.sin(angle);
        const relief = 1 + 0.12 * Math.sin(angle * 3 + section.progress * 19 + lane)
          + 0.10 * Math.sin(angle * 5 - section.progress * 27);
        vertex.copy(section.center).addScaledVector(across, lateral * section.width * 0.5 * relief)
          .addScaledVector(surface, height * section.depth * relief);
        const terrain = groundHeight(vertex.x, vertex.z);
        // Where the cross-section touches an outcrop keep the surface attached.
        // Its contact mask exposes fragments of rock at the turbulent margin.
        const contact = smoothstep(vertex.y - 1.35, vertex.y + 0.33, terrain);
        vertex.y += 0.68 * THREE.MathUtils.clamp(terrain + 0.20 - vertex.y, 0, 0.76);
        positions.push(vertex.x, vertex.y, vertex.z);
        flows.push(travelTime, channel.offset * fall.width + lateral * section.width * 0.5,
          section.progress, section.opacity);
        water.push(Math.abs(height), 1 - section.onRock, contact, 0.8 + 2.13 * lane + 7.71 * index);
        if (row === sections.length - 1) continue;
        const a = start + row * ringSize + col;
        const b = start + row * ringSize + (col + 1) % ringSize;
        indices.push(a, a + ringSize, b, b, a + ringSize, b + ringSize);
      }
    }

    if (lane === 0) {
      const atProgress = (progress: number) => sections.reduce((best, candidate) =>
        Math.abs(candidate.progress - progress) < Math.abs(best.progress - progress) ? candidate : best);
      const { center } = atProgress(shape.ledge);
      impacts.push({
        point: { x: center.x, z: center.z, y: Math.max(SEA_LEVEL, groundHeight(center.x, center.z)) + 0.9 },
        width: fall.width * 0.62, kind: 'ledge',
      });
      for (const progress of [0.19, 0.40, 0.56, 0.81]) {
        const section = atProgress(progress);
        impacts.push({ point: section.center, width: fall.width * 0.61, kind: 'shear' });
      }
    }
  }
  impacts.push({ point: fall.impact, width: fall.width, kind: 'pool' });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 4));
  geometry.setAttribute('aWater', new THREE.Float32BufferAttribute(water, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, impacts };
}
