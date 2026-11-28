import * as THREE from 'three';

export type TunnelFrame = Readonly<{ x: number; y: number; z: number; nx: number; nz: number; station: number }>;
export type TunnelPoint = Readonly<{ lateral: number; height: number }>;
export type TunnelSectionOptions = Readonly<{
  halfWidth: number;
  floorRecess?: number;
  medianHalfWidth?: number;
  springHeight?: number;
  archRise?: number;
  liningThickness?: number;
  archSegments?: number;
}>;
export type TunnelSection = Readonly<{
  halfWidth: number; medianHalfWidth: number; springHeight: number; archRise: number; liningThickness: number;
  bores: readonly Readonly<{ inner: readonly TunnelPoint[]; outer: readonly TunnelPoint[] }>[];
}>;
export type PortalOptions = Readonly<{
  depth?: number;
  outerHalfWidth?: number;
  bottomHeight?: number;
  crest?: readonly TunnelPoint[];
}>;

function finite(value: number): boolean { return Number.isFinite(value); }

function validateFrame(frame: TunnelFrame): void {
  if (![frame.x, frame.y, frame.z, frame.nx, frame.nz, frame.station].every(finite)
    || Math.abs(Math.hypot(frame.nx, frame.nz) - 1) > 1e-5) throw new Error('Invalid tunnel frame');
}

/** frame.y is the centre road TOP, not the old un-crowned road datum. */
export function tunnelFloorHeight(lateral: number, halfWidth: number): number {
  return -0.42 * Math.abs(lateral / halfWidth);
}

function offsetConvexProfile(profile: readonly TunnelPoint[], thickness: number): TunnelPoint[] {
  return profile.map((point, i) => {
    const a = profile[(i + profile.length - 1) % profile.length], b = profile[(i + 1) % profile.length];
    const px = point.lateral - a.lateral, py = point.height - a.height;
    const qx = b.lateral - point.lateral, qy = b.height - point.height;
    const p = Math.hypot(px, py), q = Math.hypot(qx, qy);
    const npx = py / p, npy = -px / p, nqx = qy / q, nqy = -qx / q;
    const denominator = 1 + npx * nqx + npy * nqy;
    if (denominator < 1e-6) throw new Error('Invalid tunnel profile offset');
    return { lateral: point.lateral + thickness * (npx + nqx) / denominator,
      height: point.height + thickness * (npy + nqy) / denominator };
  });
}

export function createTunnelSection(options: TunnelSectionOptions): TunnelSection {
  const { halfWidth } = options;
  const medianHalfWidth = options.medianHalfWidth ?? halfWidth * 0.116;
  const springHeight = options.springHeight ?? 5;
  const archRise = options.archRise ?? THREE.MathUtils.clamp((halfWidth + 1 - medianHalfWidth) * 0.25, 4.8, 8.5);
  const liningThickness = options.liningThickness ?? 0.8;
  const segments = options.archSegments ?? 24;
  if (![halfWidth, medianHalfWidth, springHeight, archRise, liningThickness].every(finite)
    || halfWidth <= 0 || medianHalfWidth <= liningThickness || medianHalfWidth >= halfWidth
    || springHeight <= 0 || archRise <= 0 || liningThickness <= 0
    || !Number.isInteger(segments) || segments < 8) throw new Error('Invalid tunnel section');
  const bores = [-1, 1].map(side => {
    const left = side < 0 ? -halfWidth - 1 : medianHalfWidth;
    const right = side < 0 ? -medianHalfWidth : halfWidth + 1;
    const centre = (left + right) / 2, radius = (right - left) / 2;
    const inner: TunnelPoint[] = [
      { lateral: left, height: tunnelFloorHeight(left, halfWidth) - (options.floorRecess ?? 0) },
      { lateral: right, height: tunnelFloorHeight(right, halfWidth) - (options.floorRecess ?? 0) },
      { lateral: right, height: springHeight },
    ];
    for (let i = 1; i <= segments; i += 1) {
      const angle = Math.PI * i / segments;
      inner.push({ lateral: centre + radius * Math.cos(angle), height: springHeight + archRise * Math.sin(angle) });
    }
    return { inner, outer: offsetConvexProfile(inner, liningThickness) };
  });
  return { halfWidth, medianHalfWidth, springHeight, archRise, liningThickness, bores };
}

class TunnelGeometry {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, outward: THREE.Vector3): void {
    const cross = b.clone().sub(a).cross(c.clone().sub(a));
    if (cross.lengthSq() < 1e-18) throw new Error('Degenerate tunnel triangle');
    if (cross.dot(outward) < 0) [b, c] = [c, b];
    const first = this.positions.length / 3;
    for (const p of [a, b, c]) {
      this.positions.push(p.x, p.y, p.z);
      this.uvs.push((p.x + p.z) * 0.1, p.y * 0.1);
    }
    this.indices.push(first, first + 1, first + 2);
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, outward: THREE.Vector3): void {
    this.triangle(a, b, c, outward);
    this.triangle(a, c, d, outward);
  }

  finish(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    return geometry;
  }
}

function worldPoint(frame: TunnelFrame, point: TunnelPoint): THREE.Vector3 {
  return new THREE.Vector3(frame.x + frame.nx * point.lateral, frame.y + point.height,
    frame.z + frame.nz * point.lateral);
}

function sectionOutward(a: TunnelPoint, b: TunnelPoint, nx: number, nz: number, sign = 1): THREE.Vector3 {
  const lateral = b.height - a.height, vertical = a.lateral - b.lateral;
  return new THREE.Vector3(nx * lateral * sign, vertical * sign, nz * lateral * sign).normalize();
}

/** Closed concrete shells; the annular end faces leave both air passages open. */
export function createTwinBoreLining(frames: readonly TunnelFrame[], options: TunnelSectionOptions): {
  section: TunnelSection; bores: readonly THREE.BufferGeometry[];
} {
  if (frames.length < 2) throw new Error('Tunnel lining needs at least two frames');
  frames.forEach(validateFrame);
  for (let i = 1; i < frames.length; i += 1) {
    const a = frames[i - 1], b = frames[i];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-4 || a.nx * b.nx + a.nz * b.nz <= 0)
      throw new Error('Discontinuous tunnel frames');
  }
  const section = createTunnelSection(options);
  const bores = section.bores.map(({ inner, outer }) => {
    const geometry = new TunnelGeometry(), count = inner.length;
    for (let i = 1; i < frames.length; i += 1) {
      const a = frames[i - 1], b = frames[i], nx = a.nx + b.nx, nz = a.nz + b.nz;
      const norm = Math.hypot(nx, nz);
      for (const [profile, sign] of [[inner, -1], [outer, 1]] as const) {
        for (let j = 0; j < count; j += 1) {
          const k = (j + 1) % count;
          geometry.quad(worldPoint(a, profile[j]), worldPoint(b, profile[j]), worldPoint(b, profile[k]),
            worldPoint(a, profile[k]), sectionOutward(profile[j], profile[k], nx / norm, nz / norm, sign));
        }
      }
    }
    for (const [index, neighbour] of [[0, 1], [frames.length - 1, frames.length - 2]]) {
      const frame = frames[index], adjacent = frames[neighbour];
      const outward = new THREE.Vector3(frame.x - adjacent.x, frame.y - adjacent.y, frame.z - adjacent.z).normalize();
      for (let j = 0; j < count; j += 1) {
        const k = (j + 1) % count;
        geometry.quad(worldPoint(frame, inner[j]), worldPoint(frame, inner[k]), worldPoint(frame, outer[k]),
          worldPoint(frame, outer[j]), outward);
      }
    }
    return geometry.finish();
  });
  return { section, bores };
}

/** Remove only vertically collinear crest knots, preserving the sampled terrain envelope.
 * Every removed knot must remain within tolerance of the retained piecewise-linear crest.
 * Face triangulation and the outer thickness faces use this same retained boundary.
 */
export function simplifyTunnelPortalCrest(crest: readonly TunnelPoint[], tolerance = 1e-9): TunnelPoint[] {
  if (crest.length < 2 || !finite(tolerance) || tolerance < 0
    || crest.some((point, i) => !finite(point.lateral) || !finite(point.height)
      || (i > 0 && point.lateral <= crest[i - 1].lateral))) throw new Error('Invalid portal crest');
  const retained = new Set([0, crest.length - 1]);
  const simplify = (first: number, last: number): void => {
    const a = crest[first], b = crest[last];
    let greatest = tolerance, selected = -1;
    for (let i = first + 1; i < last; i += 1) {
      const point = crest[i], t = (point.lateral - a.lateral) / (b.lateral - a.lateral);
      const deviation = Math.abs(point.height - (a.height + (b.height - a.height) * t));
      if (deviation > greatest) { greatest = deviation; selected = i; }
    }
    if (selected !== -1) {
      retained.add(selected);
      simplify(first, selected); simplify(selected, last);
    }
  };
  simplify(0, crest.length - 1);
  return [...retained].sort((a, b) => a - b).map(i => crest[i]);
}

/** Thick headwall with two through-holes, outer edges, sill and hole soffits.
 * nextFrame points INSIDE the bore, even when the lining array runs interior -> portal.
 * The wall extends by depth toward the approach, opposite that direction.
 */
export function createTunnelPortal(frame: TunnelFrame, nextFrame: TunnelFrame,
  options: TunnelSectionOptions, portal: PortalOptions = {}): THREE.BufferGeometry {
  validateFrame(frame); validateFrame(nextFrame);
  const section = createTunnelSection(options), depth = portal.depth ?? 1.6;
  const outerPoints = section.bores.flatMap(bore => bore.outer);
  const extent = Math.max(...outerPoints.map(p => Math.abs(p.lateral)));
  const outerHalfWidth = portal.outerHalfWidth ?? extent + 0.5;
  const bottomHeight = portal.bottomHeight ?? Math.min(...outerPoints.map(p => p.height));
  const defaultCrest = Math.max(...outerPoints.map(p => p.height)) + 0.5;
  const crest = portal.crest ?? [{ lateral: -outerHalfWidth, height: defaultCrest },
    { lateral: outerHalfWidth, height: defaultCrest }];
  if (!(depth > 0) || outerHalfWidth < extent || crest.length < 2
    || crest[0].lateral !== -outerHalfWidth || crest.at(-1)!.lateral !== outerHalfWidth
    || crest.some((p, i) => !finite(p.lateral) || !finite(p.height) || p.height < defaultCrest - 0.5
      || (i > 0 && p.lateral <= crest[i - 1].lateral))) throw new Error('Invalid portal envelope');
  const retainedCrest = simplifyTunnelPortalCrest(crest);
  const outer: TunnelPoint[] = [{ lateral: -outerHalfWidth, height: bottomHeight },
    { lateral: outerHalfWidth, height: bottomHeight }, ...[...retainedCrest].reverse()];
  const holes = section.bores.map(bore => [...bore.inner].reverse());
  const contour = outer.map(p => new THREE.Vector2(p.lateral, p.height));
  const holeContours = holes.map(hole => hole.map(p => new THREE.Vector2(p.lateral, p.height)));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holeContours), points = [...outer, ...holes.flat()];
  const dx = nextFrame.x - frame.x, dz = nextFrame.z - frame.z, run = Math.hypot(dx, dz);
  if (run < 1e-4) throw new Error('Portal direction is undefined');
  const forward = new THREE.Vector3(dx / run, (nextFrame.y - frame.y) / run, dz / run);
  const at = (point: TunnelPoint, offset: number) => worldPoint(frame, point).addScaledVector(forward, offset);
  const geometry = new TunnelGeometry();
  for (const [offset, sign] of [[-depth, -1], [0, 1]]) {
    for (const [a, b, c] of triangles) geometry.triangle(at(points[a], offset), at(points[b], offset),
      at(points[c], offset), forward.clone().multiplyScalar(sign));
  }
  for (const [profile, sign] of [[outer, 1], ...section.bores.map(bore => [bore.inner, -1] as const)] as const) {
    for (let i = 0; i < profile.length; i += 1) {
      const j = (i + 1) % profile.length;
      geometry.quad(at(profile[i], -depth), at(profile[j], -depth), at(profile[j], 0), at(profile[i], 0),
        sectionOutward(profile[i], profile[j], frame.nx, frame.nz, sign));
    }
  }
  return geometry.finish();
}
