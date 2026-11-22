import * as THREE from 'three';
import { INARI_COURT, INARI_INNER_COURT, INARI_WALKS, coastRandom, groundHeight, type CoastPoint } from '../terrain';
import { createInariArchitecture, type InariGatePlacement, type InariPlacement } from './coastInariModels';
import { createInariGrove } from './coastInariGrove';
import { InariStoneBatch, stoneCourse } from './coastInariStonework';
import { loadCoastTexture } from './coastSurface';

const [entrance, west, east] = INARI_WALKS;

function placement(x: number, z: number, yaw: number): InariPlacement {
  return { x, z, yaw, y: groundHeight(x, z) };
}

function atZ(points: readonly CoastPoint[], z: number): InariPlacement {
  const next = points.findIndex(point => point.z >= z);
  const a = points[next - 1], b = points[next];
  const along = (z - a.z) / (b.z - a.z);
  return placement(THREE.MathUtils.lerp(a.x, b.x, along), z, Math.atan2(b.x - a.x, b.z - a.z));
}

function stations(points: readonly CoastPoint[], spacing: number, start: number, end: number): InariPlacement[] {
  const result: InariPlacement[] = [];
  let travelled = 0;
  let next = spacing * 0.5;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    while (next <= travelled + length) {
      const along = (next - travelled) / length;
      const z = a.z + along * dz;
      if (z >= start && z <= end) result.push(placement(a.x + along * dx, z, Math.atan2(dx, dz)));
      next += spacing;
    }
    travelled += length;
  }
  return result;
}

function across(at: InariPlacement, distance: number, forward = 0): InariPlacement {
  const sine = Math.sin(at.yaw), cosine = Math.cos(at.yaw);
  return placement(at.x + cosine * distance + sine * forward, at.z - sine * distance + cosine * forward, at.yaw);
}

function trailFrames(points: readonly CoastPoint[], start: InariPlacement, end: InariPlacement,
  pitch: number): InariPlacement[] {
  return [start, ...stations(points, pitch, start.z + pitch * 0.48, end.z - pitch * 0.48), end];
}

function straightFrames(start: InariPlacement, end: InariPlacement, rows: number): InariPlacement[] {
  return Array.from({ length: rows + 1 }, (_, i) => {
    const t = i / rows;
    return placement(THREE.MathUtils.lerp(start.x, end.x, t), THREE.MathUtils.lerp(start.z, end.z, t),
      THREE.MathUtils.lerp(start.yaw, end.yaw, t));
  });
}

function stonework(texture: THREE.Texture, normal: THREE.Texture, worship: InariPlacement, shrine: InariPlacement): THREE.Group {
  const material = new THREE.MeshStandardMaterial({
    map: texture, normalMap: normal, normalScale: new THREE.Vector2(0.93, 0.93), roughness: 0.91, vertexColors: true,
  });
  const group = new THREE.Group();
  group.name = 'Worn granite paving and uphill stairs';
  const random = coastRandom(187734);
  function pave(batch: InariStoneBatch, frames: InariPlacement[], width: number, columns: number,
    finish: 'flag' | 'step', curb = false): void {
    for (let row = 0; row < frames.length - 1; row += 1) {
      const course = stoneCourse(frames[row], frames[row + 1]);
      const joints = [-width * 0.5];
      // Long treads occasionally span the full stair. Shift the other joints to break the centre seam.
      const pieces = finish === 'step' && random() < 0.17 ? 1 : columns;
      const pitch = width / pieces;
      const shift = finish === 'flag' && row % 2 ? pitch * 0.45 : 0;
      for (let col = 1; col <= pieces; col += 1) {
        const joint = col * pitch - width * 0.5 - shift;
        if (joint < width * 0.5 - 0.19) joints.push(joint + (random() - 0.5) * (finish === 'step' ? 0.49 : 0.19));
      }
      joints.push(width * 0.5);
      for (let col = 1; col < joints.length; col += 1) batch.slab(course, joints[col - 1], joints[col], finish);
      const z = (course.near.z + course.far.z) * 0.5;
      if (curb && z > 902 && z < 944) {
        const edge = width * 0.5;
        batch.slab(course, -edge - 0.18, -edge, 'edge');
        batch.slab(course, edge, edge + 0.18, 'edge');
      }
    }
  }

  const courtSouth = INARI_COURT.z - 5.04, courtNorth = INARI_COURT.z + 5.88;
  const entranceSouth = { ...atZ(entrance.points, courtSouth), yaw: 0 };
  const entranceNorth = { ...atZ(entrance.points, courtNorth), yaw: 0 };
  const apron = new InariStoneBatch(50138);
  pave(apron, trailFrames(entrance.points, atZ(entrance.points, 895), entranceSouth, 0.83), 3.2, 3, 'flag', true);
  pave(apron, trailFrames(entrance.points, entranceNorth, atZ(entrance.points, 947), 0.83), 3.2, 3, 'flag', true);
  group.add(apron.mesh('Entrance flags and embedded curbs', material));

  const courtWidth = 8.15, courtX = INARI_COURT.x + 0.85;
  const court = new InariStoneBatch(50139);
  pave(court, straightFrames(placement(courtX, courtSouth, 0), placement(courtX, courtNorth, 0), 13), courtWidth, 10, 'flag');
  const worshipSteps = across(worship, 0, -3.06);
  pave(court, straightFrames({ ...worshipSteps, yaw: worship.yaw + Math.PI },
    placement(courtX - courtWidth * 0.5, INARI_COURT.z - 2.95, Math.PI * 0.5), 7), 2.55, 3, 'flag');
  group.add(court.mesh('Forecourt and worship hall approach', material));

  for (const [lane, pitch, name, seed] of [
    [west, 0.41, 'West dressed granite stairs', 50140], [east, 0.39, 'East dressed granite stairs', 50141],
  ] as const) {
    const stairs = new InariStoneBatch(seed);
    // Stone gives way to the hillside before the two trails merge.
    pave(stairs, trailFrames(lane.points, atZ(lane.points, 952), atZ(lane.points, 1027.45), pitch), 2.41, 2, 'step');
    group.add(stairs.mesh(name, material));
  }

  const upper = new InariStoneBatch(50142);
  pave(upper, straightFrames(placement(INARI_INNER_COURT.x, 1033.55, shrine.yaw), across(shrine, 0, -2.44), 5),
    3.12, 4, 'flag');
  group.add(upper.mesh('Hill shrine foresteps', material));
  return group;
}

export function createInariTrail(wood: THREE.Texture): THREE.Group {
  const granite = loadCoastTexture('trail-granite.webp', true);
  const graniteNormal = loadCoastTexture('trail-granite-normal.webp', true);
  graniteNormal.colorSpace = THREE.NoColorSpace;
  const random = coastRandom(835556);
  const main = atZ(entrance.points, 901.3);
  const gate = atZ(entrance.points, 913.2);
  const worship = placement(204.2, 923.6, -1.06);
  const shrine = placement(253.9, 1038.9, -0.10);
  const firstRow = [west, east].flatMap((lane, i) =>
    stations(lane.points, i === 0 ? 1.39 : 1.48, 955, 1025).map((at): InariGatePlacement => ({
      ...at, y: at.y - 0.08, scale: 0.98 + random() * 0.12, style: 'path',
    })));
  // Wider gateways mark the entrances to the two parallel stairs.
  const pair = [west, east].map((lane): InariGatePlacement => ({
    ...atZ(lane.points, 952.7), scale: 1.12, style: 'path',
  }));
  const group = new THREE.Group();
  group.name = 'Vermilion trail';
  group.add(
    stonework(granite, graniteNormal, worship, shrine),
    createInariGrove(wood),
    createInariArchitecture({
      gates: [{ ...main, style: 'main' }, ...pair, ...firstRow],
      buildings: [
        { ...gate, y: gate.y - 0.09, kind: 'roumon' },
        { ...worship, kind: 'worship' },
        { ...shrine, kind: 'small' },
      ],
      lanterns: [
        across(main, -4.0, -1.9), across(main, 4.0, -1.9),
        across(gate, -4.9, -3.0), across(gate, 4.9, -3.0),
        placement(211.5, 925.3, 0.23), placement(224.1, 924.6, -0.63),
        placement(249.6, 1036.7, 0.24), placement(257.9, 1036.6, -0.26),
      ],
    }, granite, graniteNormal),
  );
  return group;
}
