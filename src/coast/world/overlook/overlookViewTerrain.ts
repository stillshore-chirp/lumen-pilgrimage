import * as THREE from 'three';
import type { CorridorFrame, HeightAt, OverlookCorridorPlan } from './overlookCorridorPlan';
import { gradeBeforeLocalWorks, gradeOverlookView } from './overlookTerrain';

interface CoveredSegment {
  readonly a: CorridorFrame;
  readonly b: CorridorFrame;
  readonly height: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
}

/** Open the foreground while retaining low, continuous soil over covered roads. */
export function createOverlookViewGrade(survey: HeightAt, reference: OverlookCorridorPlan): HeightAt {
  const cellSize = 80;
  const cells = new Map<string, CoveredSegment[]>();
  for (const portal of reference.portals) {
    const road = reference.roads[portal.roadId];
    const frames = road.frames.filter(frame => frame.station < portal.frame.station).concat(portal.frame);
    // The changed foreground uses 19 m grid cells (diagonal <27 m). Include
    // their entire triangles, then blend into the surrounding slope over 35 m.
    const innerRadius = portal.outerHalfWidth + 32;
    const outerRadius = innerRadius + 35;
    for (let i = 0; i + 1 < frames.length; i += 1) {
      const a = frames[i], b = frames[i + 1];
      const segment = { a, b, height: Math.max(a.y, b.y) + portal.roofAboveRoad + 2.5, innerRadius, outerRadius };
      for (let x = Math.floor((Math.min(a.x, b.x) - outerRadius) / cellSize);
        x <= Math.floor((Math.max(a.x, b.x) + outerRadius) / cellSize); x += 1) {
        for (let z = Math.floor((Math.min(a.z, b.z) - outerRadius) / cellSize);
          z <= Math.floor((Math.max(a.z, b.z) + outerRadius) / cellSize); z += 1) {
          const key = `${x}:${z}`;
          let bucket = cells.get(key);
          if (!bucket) cells.set(key, bucket = []);
          bucket.push(segment);
        }
      }
    }
  }
  return (x, z) => {
    const measured = survey(x, z);
    const original = gradeBeforeLocalWorks(x, z, measured);
    const open = gradeOverlookView(x, z, measured);
    if (open === original) return open;
    const bucket = cells.get(`${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`);
    if (!bucket) return open;
    let ground = open;
    for (const { a, b, height, innerRadius, outerRadius } of bucket) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const distance = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
      if (distance >= outerRadius) continue;
      const covered = Math.min(original, height);
      const blend = 1 - THREE.MathUtils.smootherstep(distance, innerRadius, outerRadius);
      ground = Math.max(ground, THREE.MathUtils.lerp(open, covered, blend));
    }
    return ground;
  };
}
