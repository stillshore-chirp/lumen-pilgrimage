import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ResidenceRect } from './residencePlan';

type Point = readonly [x: number, y: number, z: number];

export class FurnitureModel {
  readonly group = new THREE.Group();
  readonly obstacles: ResidenceRect[] = [];
  private readonly batches = new Map<THREE.Group, Map<THREE.Material, THREE.BufferGeometry[]>>();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly finishes = new Set<THREE.Material>();
  private space = this.group;

  constructor() {
    this.group.name = '50F furniture and fixtures';
  }

  room(name: string): void {
    this.space = new THREE.Group();
    this.space.name = name;
    this.group.add(this.space);
  }

  at(east: number, north: number, heading = 0): FurniturePiece {
    return new FurniturePiece(east, north, heading, (geometry, material) => this.add(geometry, material));
  }

  footprint(west: number, south: number, width: number, depth: number): void {
    this.obstacles.push([west, south, west + width, south + depth]);
  }

  tone(base: THREE.MeshStandardMaterial, color: number): THREE.MeshStandardMaterial {
    const finish = base.clone();
    finish.color.setHex(color);
    this.finishes.add(finish);
    return finish;
  }

  private add(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    if (material.transparent) {
      geometry.computeBoundingBox();
      const center = geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
      geometry.translate(-center.x, -center.y, -center.z);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(center);
      this.space.add(mesh);
      this.geometries.add(geometry);
      return;
    }
    let room = this.batches.get(this.space);
    if (!room) {
      room = new Map();
      this.batches.set(this.space, room);
    }
    let batch = room.get(material);
    if (!batch) {
      batch = [];
      room.set(material, batch);
    }
    if (geometry.index) {
      const indexed = geometry;
      geometry = indexed.toNonIndexed();
      indexed.dispose();
    }
    batch.push(geometry);
  }

  finish(): void {
    for (const [space, room] of this.batches) {
      for (const [material, pieces] of room) {
        const geometry = mergeGeometries(pieces);
        for (const piece of pieces) piece.dispose();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.geometries.add(geometry);
        space.add(mesh);
      }
    }
    this.batches.clear();
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const finish of this.finishes) finish.dispose();
  }
}

export class FurniturePiece {
  private readonly transform: THREE.Matrix4;
  private readonly add: (geometry: THREE.BufferGeometry, material: THREE.Material) => void;

  constructor(
    east: number,
    north: number,
    heading: number,
    add: (geometry: THREE.BufferGeometry, material: THREE.Material) => void,
  ) {
    this.transform = new THREE.Matrix4().makeRotationY(heading).setPosition(east, 0, -north);
    this.add = add;
  }

  box(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number,
    radius = 0, pitch = 0): void {
    const geometry = radius === 0
      ? new THREE.BoxGeometry(w, h, d)
      : new RoundedBoxGeometry(w, h, d, radius >= .026 ? 2 : 1, radius);
    const uv = geometry.getAttribute('uv');
    const dimensions = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const verticesPerFace = uv.count / 6;
    for (let i = 0; i < uv.count; i++) {
      const [u, v] = dimensions[Math.floor(i / verticesPerFace)];
      uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
    }
    if (pitch) geometry.rotateX(pitch);
    this.place(geometry, material, x, y, z);
  }

  cylinder(material: THREE.Material, x: number, y: number, z: number, radius: number,
    height: number, bottomRadius = radius): void {
    this.place(new THREE.CylinderGeometry(radius, bottomRadius, height, 20), material, x, y, z);
  }

  rod(material: THREE.Material, from: Point, to: Point, radius: number, endRadius = radius): void {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(endRadius, radius, direction.length(), 8);
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), direction.normalize(),
    );
    geometry.applyQuaternion(rotation);
    const center = a.add(b).multiplyScalar(.5);
    this.place(geometry, material, center.x, center.y, center.z);
  }

  tube(material: THREE.Material, points: readonly Point[], radius: number, closed = false): void {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), closed);
    const geometry = new THREE.TubeGeometry(curve, Math.max(points.length * 3, 12), radius, 6, closed);
    this.place(geometry, material, 0, 0, 0);
  }

  // A turned profile can become an oval with independent width and depth.
  vessel(material: THREE.Material, x: number, y: number, z: number, width: number, depth: number,
    profile: readonly (readonly [radius: number, height: number])[], pitch = 0): void {
    const geometry = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 40);
    geometry.scale(width / 2, 1, depth / 2);
    if (pitch) geometry.rotateX(pitch);
    this.place(geometry, material, x, y, z);
  }

  oval(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number,
    pitch = 0): void {
    const geometry = new THREE.SphereGeometry(1, 24, 10);
    geometry.scale(w / 2, h / 2, d / 2);
    if (pitch) geometry.rotateX(pitch);
    this.place(geometry, material, x, y, z);
  }

  // The wide corners are independent of the thickness. Holes leave real space for inset basins.
  slab(material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number,
    radius: number, hole?: { x: number; z: number; width: number; depth: number }): void {
    const shape = new THREE.Shape();
    roundedOutline(shape, 0, 0, w, d, radius);
    if (hole) {
      const cut = new THREE.Path();
      roundedOutline(cut, hole.x, -hole.z, hole.width, hole.depth, .085);
      shape.holes.push(cut);
    }
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: h - .004,
      bevelEnabled: true,
      bevelThickness: .002,
      bevelSize: .002,
      bevelSegments: 1,
      curveSegments: 6,
    });
    geometry.rotateX(-Math.PI / 2);
    this.place(geometry, material, x, y + .002, z);
  }

  private place(geometry: THREE.BufferGeometry, material: THREE.Material,
    x: number, y: number, z: number): void {
    geometry.translate(x, y, z).applyMatrix4(this.transform);
    this.add(geometry, material);
  }
}

function roundedOutline(path: THREE.Path, x: number, y: number, width: number, depth: number,
  radius: number): void {
  const left = x - width / 2;
  const right = x + width / 2;
  const bottom = y - depth / 2;
  const top = y + depth / 2;
  path.moveTo(left + radius, bottom);
  path.lineTo(right - radius, bottom);
  path.quadraticCurveTo(right, bottom, right, bottom + radius);
  path.lineTo(right, top - radius);
  path.quadraticCurveTo(right, top, right - radius, top);
  path.lineTo(left + radius, top);
  path.quadraticCurveTo(left, top, left, top - radius);
  path.lineTo(left, bottom + radius);
  path.quadraticCurveTo(left, bottom, left + radius, bottom);
}
