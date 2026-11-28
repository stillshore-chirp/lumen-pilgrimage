import type { BufferGeometry } from 'three';

type Size = readonly [number, number, number];
const HALF_ARC = Math.PI / 4;

function arcLength(angle: number, tangent: number, normal: number, radius: number): number {
  const steps = 32;
  const increment = angle / steps;
  const speed = (theta: number) => radius * Math.hypot(tangent * Math.cos(theta), normal * Math.sin(theta));
  let sum = speed(0) + speed(angle);
  for (let step = 1; step < steps; step += 1) sum += (step % 2 ? 4 : 2) * speed(step * increment);
  return sum * increment / 3;
}

function chartDistance(uv: number, tangent: number, normal: number, radius: number): number {
  if (radius === 0) return uv * tangent;
  const nativeArc = radius * HALF_ARC / (1 - 2 * radius + radius * Math.PI / 2);
  const arc = arcLength(HALF_ARC, tangent, normal, radius);
  const flat = (1 - 2 * radius) * tangent;
  if (uv < nativeArc) return arc - arcLength(HALF_ARC * (1 - uv / nativeArc), tangent, normal, radius);
  if (uv > 1 - nativeArc) return arc + flat
    + arcLength(HALF_ARC * (uv - 1 + nativeArc) / nativeArc, tangent, normal, radius);
  return arc + (uv - nativeArc) / (1 - 2 * nativeArc) * flat;
}

/**
 * Bake the existing unit box/rounded-box instance scale without changing shape
 * or normals. The native six face charts use metres along their flat/edge axes.
 * Double-curved corners retain chart distortion; this is not an isometric unwrap.
 */
export function cinemaUpholsteryGeometry(unit: BufferGeometry, size: Size, radius: number, period: number): BufferGeometry {
  if (!(period > 0) || !Number.isFinite(period) || size.some(value => !(value > 0 && Number.isFinite(value)))
    || !(radius >= 0 && radius < .5) || unit.groups.length !== 6) {
    throw new Error('Cinema upholstery mapping requires six unit-box charts and positive dimensions');
  }
  const geometry = unit.clone().scale(...size);
  const source = unit.getAttribute('uv');
  const uv = geometry.getAttribute('uv');
  const axes = [[0, 2, 1], [0, 2, 1], [1, 0, 2], [1, 0, 2], [2, 0, 1], [2, 0, 1]] as const;
  for (const group of geometry.groups) {
    const [normal, u, v] = axes[group.materialIndex ?? 0];
    for (let offset = group.start; offset < group.start + group.count; offset += 1) {
      const index = geometry.index ? geometry.index.getX(offset) : offset;
      uv.setXY(index, chartDistance(source.getX(index), size[u], size[normal], radius) / period,
        chartDistance(source.getY(index), size[v], size[normal], radius) / period);
    }
  }
  uv.needsUpdate = true;
  geometry.userData = { ...geometry.userData,
    cinemaUpholstery: { period, unitRadius: radius, dimensions: [...size] } };
  return geometry;
}
