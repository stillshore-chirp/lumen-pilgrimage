import * as THREE from 'three';
import type { CorridorApproach, CorridorFrame, OverlookCorridorPlan } from './overlookCorridorPlan';

type SurfaceHeight = (x: number, z: number) => number | undefined;
type Point = { x: number; y: number; z: number; color: number[]; normal: number[] };
type CutQuad = { points: Point[]; bounds: Bounds };
type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
const EPSILON = 1e-7;
const CELL_SIZE = 120;
const area = (p: readonly Point[]) => p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a.x * b.z - a.z * b.x; }, 0);
const side = (a: Point, b: Point, p: Point) => (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
const bounds = (p: readonly Point[]): Bounds => ({ minX: Math.min(...p.map(v => v.x)), maxX: Math.max(...p.map(v => v.x)),
  minZ: Math.min(...p.map(v => v.z)), maxZ: Math.max(...p.map(v => v.z)) });
const overlaps = (a: Bounds, b: Bounds) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
function mix(a: Point, b: Point, t: number): Point {
  const lerp = THREE.MathUtils.lerp;
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t),
    color: a.color.map((v, i) => lerp(v, b.color[i], t)), normal: a.normal.map((v, i) => lerp(v, b.normal[i], t)) };
}
function clip(poly: readonly Point[], a: Point, b: Point, inside: boolean): Point[] {
  if (poly.length < 3) return [];
  const out: Point[] = [];
  let previous = poly[poly.length - 1], previousSide = side(a, b, previous) * (inside ? 1 : -1);
  for (const current of poly) {
    const currentSide = side(a, b, current) * (inside ? 1 : -1);
    const before = previousSide >= -EPSILON, after = currentSide >= -EPSILON;
    if (before !== after) out.push(mix(previous, current, previousSide / (previousSide - currentSide)));
    if (after) out.push(current);
    previous = current; previousSide = currentSide;
  }
  const clean = out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.z - out[i - 1].z) > EPSILON);
  if (clean.length > 1 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].z - clean[clean.length - 1].z) <= EPSILON) clean.pop();
  return clean.length >= 3 && Math.abs(area(clean)) > 1e-9 ? clean : [];
}
function subtract(poly: readonly Point[], convex: readonly Point[]): Point[][] {
  let remaining = [...poly];
  const result: Point[][] = [];
  for (let i = 0; i < convex.length && remaining.length >= 3; i += 1) {
    const a = convex[i], b = convex[(i + 1) % convex.length], outside = clip(remaining, a, b, false);
    if (outside.length >= 3) result.push(outside);
    remaining = clip(remaining, a, b, true);
  }
  return result;
}
function keys(b: Bounds): string[] {
  const result: string[] = [];
  for (let x = Math.floor(b.minX / CELL_SIZE); x <= Math.floor(b.maxX / CELL_SIZE); x += 1) {
    for (let z = Math.floor(b.minZ / CELL_SIZE); z <= Math.floor(b.maxZ / CELL_SIZE); z += 1) result.push(`${x}:${z}`);
  }
  return result;
}
function plain(x: number, y: number, z: number): Point { return { x, y, z, color: [0.45, 0.42, 0.33], normal: [0, 1, 0] }; }
function edge(frame: CorridorFrame, halfWidth: number, sign: number, depth: number): Point {
  return plain(Math.fround(frame.x + frame.nx * halfWidth * sign), Math.fround(frame.y - depth), Math.fround(frame.z + frame.nz * halfWidth * sign));
}
function quads(approaches: readonly CorridorApproach[]): CutQuad[] {
  return approaches.flatMap(approach => approach.frames.slice(1).map((b, i) => {
    const a = approach.frames[i];
    const points = [edge(a, approach.halfWidth, -1, approach.formationDepth), edge(b, approach.halfWidth, -1, approach.formationDepth),
      edge(b, approach.halfWidth, 1, approach.formationDepth), edge(a, approach.halfWidth, 1, approach.formationDepth)];
    if (area(points) < 0) points.reverse();
    // The query later interpolates exactly the packed Float32 formation triangles.
    for (const p of points) { p.x = Math.fround(p.x); p.y = Math.fround(p.y); p.z = Math.fround(p.z); }
    return { points, bounds: bounds(points) };
  }));
}
function triangleHeight(points: readonly Point[], x: number, z: number): number | undefined {
  const [a, b, c] = points, determinant = side(a, b, c);
  if (Math.abs(determinant) < 1e-12) return undefined;
  const u = side(b, c, plain(x, 0, z)) / determinant, v = side(c, a, plain(x, 0, z)) / determinant, w = 1 - u - v;
  return Math.min(u, v, w) >= -1e-7 ? a.y * u + b.y * v + c.y * w : undefined;
}
function segmentInsideTriangle(a: Point, b: Point, triangle: readonly Point[]): [number, number] | undefined {
  let low = 0, high = 1;
  const t = area(triangle) >= 0 ? triangle : [triangle[0], triangle[2], triangle[1]];
  for (let i = 0; i < 3; i += 1) {
    const p = t[i], q = t[(i + 1) % 3], sa = side(p, q, a), sb = side(p, q, b), delta = sb - sa;
    if (Math.abs(delta) < 1e-12) { if (sa < -EPSILON) return undefined; continue; }
    const at = -sa / delta;
    if (delta > 0) low = Math.max(low, at); else high = Math.min(high, at);
    if (low > high + 1e-10) return undefined;
  }
  return high - low > 1e-8 ? [Math.max(0, low), Math.min(1, high)] : undefined;
}

/**
 * Construction-time local excavation. It clips the actual indexed triangles;
 * the retained survey attributes and every unaffected vertex stay unchanged.
 * The caller owns the returned group/disposal. It intentionally replaces only
 * the input terrain meshes' geometry, never the road plan or field boundary.
 */
export function createOverlookEarthworks(terrain: THREE.Group, baseHeight: SurfaceHeight,
  plan: OverlookCorridorPlan, groundMaterial: THREE.Material) {
  const cuts = quads(plan.approaches), buckets = new Map<string, Set<CutQuad>>();
  for (const cut of cuts) for (const key of keys(cut.bounds)) {
    const list = buckets.get(key) ?? new Set<CutQuad>(); list.add(cut); buckets.set(key, list);
  }
  const patchPosition: number[] = [], patchColor: number[] = [], patchNormal: number[] = [];
  const newGeometries: THREE.BufferGeometry[] = [], nearbyTriangles: Point[][] = [];
  let originalTriangles = 0, touchedTriangles = 0, removedTriangles = 0;
  const emit = (poly: readonly Point[]) => {
    for (let i = 1; i + 1 < poly.length; i += 1) {
      const tri = [poly[0], poly[i], poly[i + 1]];
      if (Math.abs(area(tri)) < 1e-9) continue;
      for (const p of tri) {
        patchPosition.push(p.x, p.y, p.z); patchColor.push(...p.color);
        const length = Math.hypot(...p.normal); patchNormal.push(...p.normal.map(n => n / length));
      }
    }
  };
  terrain.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const source = object.geometry, position = source.getAttribute('position'), color = source.getAttribute('color'), normal = source.getAttribute('normal');
    const index = source.getIndex();
    if (!index || !position || !color || !normal) throw new Error('Indexed terrain position/color/normal attributes are required.');
    const read = (i: number): Point => ({ x: position.getX(i), y: position.getY(i), z: position.getZ(i),
      color: [color.getX(i), color.getY(i), color.getZ(i)], normal: [normal.getX(i), normal.getY(i), normal.getZ(i)] });
    const kept: number[] = [], start = source.drawRange.start, end = Math.min(index.count, start + source.drawRange.count);
    let changed = false;
    for (let i = start; i < end; i += 3) {
      originalTriangles += 1;
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)], tri = ids.map(read), box = bounds(tri);
      const candidates = new Set<CutQuad>();
      for (const key of keys(box)) for (const candidate of buckets.get(key) ?? []) if (overlaps(box, candidate.bounds)) candidates.add(candidate);
      if (candidates.size === 0) { kept.push(...ids); continue; }
      nearbyTriangles.push(tri);
      let pieces = [tri];
      for (const candidate of candidates) pieces = pieces.flatMap(poly => subtract(poly, candidate.points));
      const previousArea = Math.abs(area(tri)), remainingArea = pieces.reduce((sum, poly) => sum + Math.abs(area(poly)), 0);
      if (Math.abs(previousArea - remainingArea) < 1e-7) { kept.push(...ids); continue; }
      changed = true; touchedTriangles += 1;
      if (pieces.length === 0) removedTriangles += 1;
      for (const piece of pieces) emit(piece);
    }
    if (changed) {
      const next = new THREE.BufferGeometry();
      for (const name of Object.keys(source.attributes)) next.setAttribute(name, source.getAttribute(name));
      next.setIndex(kept); next.boundingBox = source.boundingBox?.clone() ?? null; next.boundingSphere = source.boundingSphere?.clone() ?? null;
      object.geometry = next; newGeometries.push(next);
    }
  });
  const patch = new THREE.BufferGeometry();
  patch.setAttribute('position', new THREE.Float32BufferAttribute(patchPosition, 3));
  patch.setAttribute('color', new THREE.Float32BufferAttribute(patchColor, 3));
  patch.setAttribute('normal', new THREE.Float32BufferAttribute(patchNormal, 3));
  const group = new THREE.Group(); group.name = 'Road excavation, formation, and supported retaining sides';
  const fragments = new THREE.Mesh(patch, groundMaterial); fragments.name = 'Survey triangles clipped to actual approach edges'; group.add(fragments);
  const floorPosition: number[] = [], wallPosition: number[] = [];
  const floorTriangles: Point[][] = [];
  for (const cut of cuts) {
    for (const ids of [[0, 2, 1], [0, 3, 2]]) {
      const tri = ids.map(i => cut.points[i]); floorTriangles.push(tri);
      for (const p of tri) floorPosition.push(p.x, p.y, p.z);
    }
  }
  const triangleBuckets = new Map<string, Point[][]>();
  for (const tri of nearbyTriangles) for (const key of keys(bounds(tri))) {
    const list = triangleBuckets.get(key) ?? []; list.push(tri); triangleBuckets.set(key, list);
  }
  const requiredGround = (x: number, z: number): number => {
    const y = baseHeight(x, z); if (y === undefined) throw new Error('Retaining support is outside the ground field.'); return y;
  };
  const quad = (a: Point, b: Point, c: Point, d: Point) => {
    for (const p of [a, b, c, a, c, d]) wallPosition.push(p.x, p.y, p.z);
  };
  // Derive sidewall upper knots from intersections with actual terrain faces,
  // including each grid diagonal, rather than a second height approximation.
  for (const approach of plan.approaches) for (const sign of [-1, 1]) {
    const section: { innerTop: Point; outerTop: Point; innerBottom: Point; outerBottom: Point; station: number }[] = [];
    for (let i = 0; i + 1 < approach.frames.length; i += 1) {
      const a = edge(approach.frames[i], approach.halfWidth, sign, approach.formationDepth);
      const b = edge(approach.frames[i + 1], approach.halfWidth, sign, approach.formationDepth);
      const candidates = new Set<Point[]>();
      for (const key of keys(bounds([a, b]))) for (const tri of triangleBuckets.get(key) ?? []) candidates.add(tri);
      const parameters = new Set<number>([0, 1]);
      for (const tri of candidates) {
        const interval = segmentInsideTriangle(a, b, tri);
        if (interval) for (const t of interval) parameters.add(t);
      }
      for (const t of [...parameters].sort((u, v) => u - v)) {
        const p = mix(a, b, t), s = THREE.MathUtils.lerp(approach.frames[i].station, approach.frames[i + 1].station, t);
        if (section.length && s - section[section.length - 1].station < 1e-7) continue;
        const top = requiredGround(p.x, p.z), nx = THREE.MathUtils.lerp(approach.frames[i].nx, approach.frames[i + 1].nx, t),
          nz = THREE.MathUtils.lerp(approach.frames[i].nz, approach.frames[i + 1].nz, t), length = Math.hypot(nx, nz);
        const outerX = p.x + nx / length * sign * 1.2, outerZ = p.z + nz / length * sign * 1.2;
        section.push({ station: s, innerTop: plain(p.x, Math.max(top, p.y), p.z),
          outerTop: plain(outerX, Math.max(requiredGround(outerX, outerZ), p.y), outerZ),
          innerBottom: plain(p.x, Math.min(p.y - 0.8, top - 0.5), p.z),
          outerBottom: plain(outerX, Math.min(p.y - 0.8, requiredGround(outerX, outerZ) - 0.5), outerZ) });
      }
    }
    for (let i = 0; i + 1 < section.length; i += 1) {
      const a = section[i], b = section[i + 1];
      const inner = [a.innerBottom, a.innerTop, b.innerTop, b.innerBottom];
      const outer = [a.outerBottom, b.outerBottom, b.outerTop, a.outerTop];
      for (const points of sign < 0 ? [inner, outer] : [inner.slice().reverse(), outer.slice().reverse()]) quad(points[0], points[1], points[2], points[3]);
      quad(a.innerTop, a.outerTop, b.outerTop, b.innerTop);
      quad(a.innerBottom, b.innerBottom, b.outerBottom, a.outerBottom);
    }
    if (section.length) {
      const a = section[0], b = section[section.length - 1];
      quad(a.innerBottom, a.outerBottom, a.outerTop, a.innerTop);
      quad(b.innerBottom, b.innerTop, b.outerTop, b.outerBottom);
    }
  }
  for (const approach of plan.approaches) {
    const last = approach.frames[approach.frames.length - 1];
    for (let i = 0; i < 32; i += 1) {
      const a = edge(last, approach.halfWidth, -1 + i / 16, approach.formationDepth);
      const b = edge(last, approach.halfWidth, -1 + (i + 1) / 16, approach.formationDepth);
      const lowA = plain(a.x, Math.min(a.y - 0.8, requiredGround(a.x, a.z) - 0.5), a.z);
      const lowB = plain(b.x, Math.min(b.y - 0.8, requiredGround(b.x, b.z) - 0.5), b.z);
      quad(a, b, lowB, lowA);
    }
  }
  const portalSoilPosition: number[] = [], portalSoilColor: number[] = [], portalSoilNormal: number[] = [];
  for (const portal of plan.portals) {
    const approach = plan.approaches.find(a => a.roadId === portal.roadId);
    if (!approach) continue;
    const first = approach.frames[0], a = edge(first, approach.halfWidth, -1, 0), b = edge(first, approach.halfWidth, 1, 0);
    const parameters = new Set<number>([0, 1]);
    for (const knot of portal.crest) parameters.add((knot.lateral + portal.outerHalfWidth) / (2 * portal.outerHalfWidth));
    const candidates = new Set<Point[]>();
    for (const key of keys(bounds([a, b]))) for (const tri of triangleBuckets.get(key) ?? []) candidates.add(tri);
    for (const tri of candidates) {
      const interval = segmentInsideTriangle(a, b, tri);
      if (interval) for (const t of interval) parameters.add(t);
    }
    const crestAt = (t: number) => {
      const lateral = portal.outerHalfWidth * (2 * t - 1);
      let i = 0;
      while (i + 1 < portal.crest.length - 1 && portal.crest[i + 1].lateral < lateral) i += 1;
      const left = portal.crest[i], right = portal.crest[i + 1];
      return first.y + THREE.MathUtils.lerp(left.height, right.height, (lateral - left.lateral) / (right.lateral - left.lateral));
    };
    const groundPoint = (t: number): Point => {
      const p = mix(a, b, t); p.y = requiredGround(p.x, p.z);
      for (const tri of candidates) {
        if (triangleHeight(tri, p.x, p.z) === undefined) continue;
        const total = side(tri[0], tri[1], tri[2]), u = side(tri[1], tri[2], p) / total,
          v = side(tri[2], tri[0], p) / total, w = 1 - u - v;
        p.color = tri[0].color.map((c, k) => c * u + tri[1].color[k] * v + tri[2].color[k] * w); break;
      }
      return p;
    };
    const emitSoil = (polygon: Point[]) => {
      const expected = new THREE.Vector3(first.nz, 0, -first.nx);
      for (let i = 1; i + 1 < polygon.length; i += 1) {
        const tri = [polygon[0], polygon[i], polygon[i + 1]], vec = tri.map(p => new THREE.Vector3(p.x, p.y, p.z));
        const cross = vec[1].clone().sub(vec[0]).cross(vec[2].clone().sub(vec[0]));
        if (cross.lengthSq() < 1e-18) continue;
        if (cross.dot(expected) < 0) { tri.reverse(); cross.negate(); }
        cross.normalize();
        for (const p of tri) { portalSoilPosition.push(p.x, p.y, p.z); portalSoilColor.push(...p.color); portalSoilNormal.push(cross.x, cross.y, cross.z); }
      }
    };
    const knots = [...parameters].sort((u, v) => u - v);
    for (let i = 0; i + 1 < knots.length; i += 1) {
      let lo = knots[i], hi = knots[i + 1];
      if (hi - lo < 1e-9) continue;
      let topA = groundPoint(lo), topB = groundPoint(hi), gapA = topA.y - crestAt(lo) + 0.01, gapB = topB.y - crestAt(hi) + 0.01;
      if (gapA <= 0 && gapB <= 0) continue;
      if (gapA < 0) { lo += (hi - lo) * -gapA / (gapB - gapA); topA = groundPoint(lo); gapA = 0; }
      if (gapB < 0) { hi = lo + (hi - lo) * gapA / (gapA - gapB); topB = groundPoint(hi); }
      const lower = (p: Point, t: number): Point => ({ ...p,
        // Embed the lower edge 10mm vertically and 2mm into the concrete volume.
        x: first.x + first.nx * portal.outerHalfWidth * (2 * t - 1) + first.nz * 0.002,
        y: crestAt(t) - 0.01,
        z: first.z + first.nz * portal.outerHalfWidth * (2 * t - 1) - first.nx * 0.002 });
      emitSoil([topA, topB, lower(topB, hi), lower(topA, lo)]);
    }
  }
  const portalSoil = new THREE.BufferGeometry();
  portalSoil.setAttribute('position', new THREE.Float32BufferAttribute(portalSoilPosition, 3));
  portalSoil.setAttribute('color', new THREE.Float32BufferAttribute(portalSoilColor, 3));
  portalSoil.setAttribute('normal', new THREE.Float32BufferAttribute(portalSoilNormal, 3));
  const soil = new THREE.Mesh(portalSoil, groundMaterial); soil.name = 'Native soil sections closing recessed portal crests'; group.add(soil);
  const makeGeometry = (positions: number[]) => {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals(); return geometry;
  };
  const formation = makeGeometry(floorPosition), walls = makeGeometry(wallPosition);
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8f897a, roughness: 0.94 });
  const floor = new THREE.Mesh(formation, concrete); floor.name = 'Continuous road formation at the slab underside';
  const retaining = new THREE.Mesh(walls, concrete); retaining.name = 'Thick retaining walls tied to original survey triangles'; group.add(floor, retaining);
  const floorBuckets = new Map<string, Point[][]>();
  for (const tri of floorTriangles) for (const key of keys(bounds(tri))) {
    const list = floorBuckets.get(key) ?? []; list.push(tri); floorBuckets.set(key, list);
  }
  const sampleHeight: SurfaceHeight = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return undefined;
    for (const tri of floorBuckets.get(`${Math.floor(x / CELL_SIZE)}:${Math.floor(z / CELL_SIZE)}`) ?? []) {
      const height = triangleHeight(tri, x, z); if (height !== undefined) return height;
    }
    return baseHeight(x, z);
  };
  return { group, sampleHeight, diagnostics: { originalTriangles, touchedTriangles, removedTriangles,
    retainedFragments: patchPosition.length / 9, formationTriangles: floorPosition.length / 9, wallTriangles: wallPosition.length / 9, portalSoilTriangles: portalSoilPosition.length / 9 },
    dispose() { for (const geometry of [...newGeometries, patch, formation, walls, portalSoil]) geometry.dispose(); concrete.dispose(); } };
}
