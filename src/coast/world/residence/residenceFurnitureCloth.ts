import * as THREE from 'three';

type Point = readonly [x: number, y: number, z: number];

export interface Upholstery {
  width: number;
  height: number;
  depth: number;
  radius: number;
  crown: Point;
  gathers?: number;
  seed?: number;
}

// Lift the panels between sewn edges and let short gathers die away from the welting.
// The same surface parameterization locates the stitching, including its rounded corners.
export function upholsteryShape({ width, height, depth, radius, crown, gathers = 0, seed = 0 }: Upholstery) {
  const half = [width / 2, height / 2, depth / 2];
  const edge = Math.min(radius, ...half) * .97;
  const core = half.map(size => size - edge);
  const normalized = new THREE.Vector3();
  const clamped = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const result = new THREE.Vector3();
  const map = (x: number, y: number, z: number, lift = 0): THREE.Vector3 => {
    normalized.set(x, y, z);
    for (let axis = 0; axis < 3; axis++) {
      const q = normalized.getComponent(axis);
      const amount = Math.abs(q);
      const inset = Math.sign(q) * Math.min(amount / .74, 1) * core[axis];
      const excess = Math.sign(q) * Math.max(0, (amount - .74) / .26) * edge;
      clamped.setComponent(axis, inset);
      outward.setComponent(axis, excess);
    }
    outward.normalize();
    result.copy(clamped).addScaledVector(outward, edge + lift);
    for (let axis = 0; axis < 3; axis++) {
      const u = normalized.getComponent((axis + 1) % 3);
      const v = normalized.getComponent((axis + 2) % 3);
      const loft = crown[axis] * (1 - u * u) * (1 - v * v);
      const crease = (along: number, across: number, phase: number) => {
        const envelope = (1 - across * across) * Math.exp(-((Math.abs(along) - .63) ** 2) / .025);
        return envelope * (Math.sin(across * 13 + along * 3 + phase) * .62
          + Math.sin(across * 29 - along * 4 + phase) * .23);
      };
      const folds = gathers * (crease(u, v, seed + axis) + crease(v, u, seed * .7 + axis + 1.1));
      result.setComponent(axis, result.getComponent(axis) + outward.getComponent(axis) * (loft + folds));
    }
    return result;
  };
  const [across, rise, deep] = half.map(size => THREE.MathUtils.clamp(Math.ceil(size / .037), 8, 34));
  const geometry = new THREE.BoxGeometry(2, 2, 2, across, rise, deep);
  const position = geometry.getAttribute('position');
  const original = geometry.getAttribute('normal').clone();
  const uv = geometry.getAttribute('uv');
  const normalGroups = new Map<string, number[]>();
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const point = map(x, y, z);
    position.setXYZ(index, point.x, point.y, point.z);
    const faceX = original.getX(index);
    const faceY = original.getY(index);
    uv.setXY(index, uv.getX(index) * (faceX ? depth : width), uv.getY(index) * (faceY ? depth : height));
    const edges = Number(Math.abs(x) === 1) + Number(Math.abs(y) === 1) + Number(Math.abs(z) === 1);
    if (edges < 2) continue;
    const key = [x, y, z].map(component => Math.round(component * 1e5)).join(',');
    const group = normalGroups.get(key) ?? [];
    group.push(index);
    normalGroups.set(key, group);
  }
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  const direction = new THREE.Vector3();
  for (const group of normalGroups.values()) {
    if (group.length < 2) continue;
    direction.set(0, 0, 0);
    for (const index of group) direction.add(outward.fromBufferAttribute(normal, index));
    direction.normalize();
    for (const index of group) normal.setXYZ(index, direction.x, direction.y, direction.z);
  }
  return { geometry, map };
}

export function furnitureSurface(
  width: number, length: number, columns: number, rows: number, sample: (u: number, v: number) => Point,
): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, columns, rows);
  const positions = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const v = row / rows;
      const index = row * (columns + 1) + column;
      positions.setXYZ(index, ...sample(u, v));
      uv.setXY(index, u * width, (1 - v) * length);
    }
  }
  geometry.computeVertexNormals();
  return geometry;
}
