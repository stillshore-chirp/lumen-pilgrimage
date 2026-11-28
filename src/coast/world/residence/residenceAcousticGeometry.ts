import type { AcousticPoint } from './residenceAcousticScene';
import type { ResidenceOpening, ResidenceWall } from './residencePlan';

export type AcousticBox = readonly (readonly [number, number])[];

export function acousticWallPrism(wall: ResidenceWall): AcousticBox {
  return wall.axis === 'e'
    ? [[wall.from, wall.to], [0, wall.height], [-wall.fixed - wall.thickness / 2, -wall.fixed + wall.thickness / 2]]
    : [[wall.fixed - wall.thickness / 2, wall.fixed + wall.thickness / 2], [0, wall.height], [-wall.to, -wall.from]];
}

export function acousticSegmentBox(a: AcousticPoint, b: AcousticPoint, box: AcousticBox): readonly [number, number] | undefined {
  let low = 0;
  let high = 1;
  for (const [axis, key] of (['x', 'y', 'z'] as const).entries()) {
    const delta = b[key] - a[key];
    const [min, max] = box[axis];
    if (Math.abs(delta) < 1e-10) {
      if (a[key] < min || a[key] > max) return;
    } else {
      let u = (min - a[key]) / delta;
      let v = (max - a[key]) / delta;
      if (u > v) [u, v] = [v, u];
      low = Math.max(low, u);
      high = Math.min(high, v);
      if (low >= high) return;
    }
  }
  return [low, high];
}

export function acousticPointAt(a: AcousticPoint, b: AcousticPoint, fraction: number): AcousticPoint {
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: a.z + (b.z - a.z) * fraction };
}

export function pointInAcousticOpening(wall: ResidenceWall, opening: ResidenceOpening, point: AcousticPoint): boolean {
  const along = wall.axis === 'e' ? point.x : -point.z;
  return along >= opening.from && along <= opening.to && point.y >= opening.bottom && point.y <= opening.top;
}
