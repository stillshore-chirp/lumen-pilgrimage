import * as THREE from 'three';
import { coastWaterLevel, groundHeight, smoothstep, type CoastPoint, type CoastWaterfall } from '../terrain';

interface CascadeShape {
  feederStart: number;
  lip: number;
  join: number;
  bend: number;
  shelf: number;
  sourceWidth: number;
  fan: number;
  rockRunout?: number;
}

const shapes: Record<CoastWaterfall['id'], CascadeShape> = {
  'east-headland': { feederStart: -15, lip: 10.5, join: 2, bend: -0.19, shelf: 0.70, sourceWidth: 0.60, fan: 1.29 },
  'west-headland': { feederStart: -14, lip: 5.2, join: 2, bend: -0.16, shelf: 0.52, sourceWidth: 0.52, fan: 1.09 },
  'offshore-ridge': { feederStart: -10, lip: 21.5, join: 5, bend: 0.083, shelf: 0.67, sourceWidth: 0.51, fan: 1.01 },
  'upland-lake': { feederStart: -19, lip: -1.05, join: 2, bend: 0.015, shelf: 0.37, sourceWidth: 0.72, fan: 1.36, rockRunout: 0.33 },
  'west-wall': { feederStart: -9, lip: -0.50, join: 3, bend: -0.14, shelf: 0.58, sourceWidth: 0.66, fan: 1.31 },
  'east-outer-cliff': { feederStart: -12, lip: -1.60, join: 4, bend: 0.17, shelf: 0.66, sourceWidth: 0.51, fan: 1.46 },
  'shore-ledge': { feederStart: -4.5, lip: -0.5, join: 4, bend: 0.19, shelf: 0.58, sourceWidth: 0.69, fan: 1.43 },
};

interface Section {
  center: THREE.Vector3;
  width: number;
  progress: number;
  coverage: number;
  slope: number;
  onRock: number;
}

export interface CascadeImpact {
  point: CoastPoint;
  width: number;
  kind: 'pool' | 'ledge' | 'shear';
}

function slope(a: number, b: number): number {
  return a * b > 0 ? 2 * a * b / (a + b) : 0;
}

// Interpolate the terrain trace without reversing direction on a steep face.
function runAt(runs: readonly number[], row: number): number {
  const i = Math.min(runs.length - 2, Math.floor(row));
  const t = row - i;
  const a = runs[i];
  const b = runs[i + 1];
  const m0 = slope(a - (runs[i - 1] ?? a), b - a);
  const m1 = slope(b - a, (runs[i + 2] ?? b) - b);
  return THREE.MathUtils.lerp(a, b, t * t * (3 - 2 * t)) + t * (1 - t) * ((1 - t) * m0 - t * m1);
}

function cascadeSections(fall: CoastWaterfall, shape: CascadeShape, index: number): Section[] {
  const crown = fall.path[0];
  const { direction, width } = fall;
  const runs = fall.path.map(point => (point.x - crown.x) * direction.x + (point.z - crown.z) * direction.z);
  const last = runs.length - 1;
  const join = Math.min(shape.join, last - 1);
  const lip = Math.min(shape.lip, runs[join] - 0.85);
  const waterline = coastWaterLevel(fall.impact.x, fall.impact.z);
  const sections: Section[] = [];

  function addSection(run: number, y: number, progress: number, coverage: number, feeding = false): void {
    const phase = 1.12 * index;
    const middle = smoothstep(0.03, 0.22, progress) * (1 - smoothstep(0.75, 1, progress));
    const turbulence = 0.024 * Math.sin(progress * 29 + phase) + 0.051 * Math.sin(progress * 13 + phase);
    const lateral = width * (turbulence * middle + shape.bend * (1 - smoothstep(-0.19, 0.19, progress)));
    const x = crown.x + direction.x * run - direction.z * lateral;
    const z = crown.z + direction.z * run + direction.x * lateral;
    const terrain = groundHeight(x, z);
    const rockSkin = Math.max(waterline + 0.047, terrain + 0.26);
    const bed = shape.rockRunout === undefined ? 0 : smoothstep(shape.rockRunout, shape.rockRunout + 0.23, progress);
    const height = feeding ? rockSkin : THREE.MathUtils.lerp(Math.max(y, rockSkin), rockSkin, bed);
    const shelfDistance = (progress - shape.shelf) * 7.5;
    const shelf = Math.exp(-shelfDistance * shelfDistance);
    const widthAtCrest = THREE.MathUtils.lerp(shape.sourceWidth, 0.80, smoothstep(0.015, 0.16, progress));
    const headwaterWidth = shape.rockRunout === undefined ? 0
      : 0.87 * smoothstep(-0.2, -0.173, progress) * (1 - smoothstep(-0.133, -0.079, progress));
    const span = width * (THREE.MathUtils.lerp(widthAtCrest, shape.fan, smoothstep(0.69, 1, progress))
      + shelf * 0.16 + middle * turbulence + headwaterWidth);
    sections.push({
      center: new THREE.Vector3(x, height, z), progress, coverage,
      width: span * (0.61 + 0.39 * coverage), slope: 0,
      onRock: 1 - smoothstep(0.44, 5.2, height - terrain),
    });
  }

  const feederRows = Math.ceil((lip - shape.feederStart) / 0.48);
  for (let i = 0; i <= feederRows; i += 1) {
    const t = i / feederRows;
    addSection(THREE.MathUtils.lerp(shape.feederStart, lip, t), 0, (t - 1) * 0.2,
      smoothstep(0, 0.24, t), true);
  }

  const lipY = sections[sections.length - 1].center.y;
  const joinY = fall.path[join].y;
  for (let i = 1; i < 14; i += 1) {
    const t = i / 14;
    // Momentum carries the water beyond the crest before gravity turns the sheet downward.
    addSection(THREE.MathUtils.lerp(lip, runs[join], t * (2 - t)),
      THREE.MathUtils.lerp(lipY, joinY, t * t), t * join / last, 1);
  }

  for (let row = join; row < last; row += 1) {
    const a = fall.path[row];
    const b = fall.path[row + 1];
    const count = Math.max(3, Math.ceil(Math.hypot(b.y - a.y, runs[row + 1] - runs[row]) / 0.68));
    for (let i = 0; i < count; i += 1) {
      const t = i / count;
      const progress = (row + t) / last;
      addSection(runAt(runs, row + t), THREE.MathUtils.lerp(a.y, b.y, t), progress, 1);
    }
  }
  addSection(runs[last], fall.impact.y, 1, 1);

  for (let pass = 0; pass < 3; pass += 1) {
    const centers = sections.map(section => section.center.clone());
    for (let i = 1; i < sections.length - 1; i += 1) {
      sections[i].center.copy(centers[i - 1]).lerp(centers[i + 1], 0.5).lerp(centers[i], 0.57);
    }
  }
  const tangent = new THREE.Vector3();
  for (const [i, section] of sections.entries()) {
    tangent.subVectors(sections[Math.min(sections.length - 1, i + 1)].center,
      sections[Math.max(0, i - 1)].center).normalize();
    section.slope = Math.abs(tangent.y);
  }
  return sections;
}

export function createCascadeGeometry(fall: CoastWaterfall, index: number): {
  geometry: THREE.BufferGeometry;
  impacts: CascadeImpact[];
} {
  const shape = shapes[fall.id];
  const sections = cascadeSections(fall, shape, index);
  const positions: number[] = [];
  const flows: number[] = [];
  const water: number[] = [];
  const indices: number[] = [];
  const side = new THREE.Vector3(-fall.direction.z, 0, fall.direction.x);
  const tangent = new THREE.Vector3();
  const across = new THREE.Vector3();
  const surface = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const columns = 18;
  let travelTime = 0;
  let speed = 3.4;
  let aeration = 0;

  for (const [row, section] of sections.entries()) {
    const previous = sections[Math.max(0, row - 1)];
    const next = sections[Math.min(sections.length - 1, row + 1)];
    const distance = section.center.distanceTo(previous.center);
    const drop = previous.center.y - section.center.y;
    // Travel time stretches streaks as water falls and shortens them over the rock.
    speed = Math.max(2.4, Math.sqrt(Math.max(0, speed * speed + 17.0 * drop))
      * Math.exp(-distance * (0.018 + section.onRock * 0.112)));
    travelTime += distance / speed;
    tangent.subVectors(next.center, previous.center).normalize();
    across.copy(side).addScaledVector(tangent, -side.dot(tangent)).normalize();
    surface.crossVectors(across, tangent).normalize();
    const whitewater = smoothstep(0.14, 0.79, section.slope)
      * (shape.rockRunout === undefined ? smoothstep(-0.050, 0.11, section.progress) : 0.75 + 0.25 * section.coverage);
    const broken = smoothstep(0.76, 0.98, section.progress);
    // An attached run keeps some of the bubbles entrained above it.
    const retention = Math.exp(-distance * (whitewater > aeration ? 1.4 : 0.13));
    aeration = THREE.MathUtils.lerp(whitewater, aeration, retention);
    const air = Math.max(broken * 0.85, aeration * (0.92 - 0.11 * section.onRock));

    for (let col = 0; col <= columns; col += 1) {
      const span = col / columns * 2 - 1;
      const relief = (1 - span * span) * 0.16
        + 0.037 * Math.sin(span * 8.6 + section.progress * 6.3 + index)
        + 0.019 * Math.sin(span * 24.6 - section.progress * 12.8 + Math.sin(span * 8.2));
      vertex.copy(section.center).addScaledVector(across, span * section.width * 0.5)
        .addScaledVector(surface, relief * section.width * (0.15 + 0.31 * air));

      const terrain = groundHeight(vertex.x, vertex.z);
      const attachment = section.onRock * (1 - smoothstep(0.34, 0.78, section.slope));
      vertex.y = THREE.MathUtils.lerp(vertex.y, terrain + 0.22, attachment * (0.28 + 0.72 * Math.abs(span)));
      const contact = smoothstep(vertex.y - 0.57, vertex.y + 0.52, terrain);
      positions.push(vertex.x, vertex.y, vertex.z);
      flows.push(travelTime, span * fall.width * 0.5, section.progress, section.coverage);
      water.push(Math.abs(span), air, contact, index * 7.71);
      if (row === sections.length - 1 || col === columns) continue;
      const a = row * (columns + 1) + col;
      const b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const atProgress = (p: number) => sections.reduce((best, current) =>
    Math.abs(current.progress - p) < Math.abs(best.progress - p) ? current : best);
  const shelf = atProgress(shape.shelf);
  const shear = sections.filter(section => section.progress > 0.15 && section.progress < 0.70
    && section.slope > 0.78 && section.onRock < 0.38);
  const impacts: CascadeImpact[] = [{
    point: shelf.center, width: fall.width * 0.56, kind: 'ledge',
  }, {
    point: fall.impact, width: fall.width * shape.fan, kind: 'pool',
  }];
  if (shear.length > 0) {
    const section = shear[Math.floor(shear.length * 0.55)];
    impacts.push({ point: section.center, width: section.width, kind: 'shear' });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 4));
  geometry.setAttribute('aWater', new THREE.Float32BufferAttribute(water, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, impacts };
}
