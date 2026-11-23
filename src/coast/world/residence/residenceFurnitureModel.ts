import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { furnitureSurface, upholsteryShape, type Upholstery } from './residenceFurnitureCloth';
import type { ResidenceRect } from './residencePlan';

type Point = readonly [x: number, y: number, z: number];

export class FurnitureModel {
  readonly group = new THREE.Group();
  readonly obstacles: ResidenceRect[] = [];
  private readonly batches = new Map<THREE.Group, Map<THREE.Material, THREE.BufferGeometry[]>>();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly finishes = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private space = this.group;

  constructor() {
    this.group.name = '70F furniture and fixtures';
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

  printed(texture: THREE.Texture): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      name: 'Printed cloth book spines', map: texture, color: 0xe4ce9f, roughness: .84, alphaTest: .19,
    });
    this.finishes.add(material);
    this.textures.add(texture);
    return material;
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
    for (const texture of this.textures) texture.dispose();
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
    radius = 0, pitch = 0, turnGrain = false): void {
    const geometry = radius === 0
      ? new THREE.BoxGeometry(w, h, d)
      : new RoundedBoxGeometry(w, h, d, radius >= .026 ? 2 : 1, radius);
    const uv = geometry.getAttribute('uv');
    const dimensions = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const verticesPerFace = uv.count / 6;
    for (let i = 0; i < uv.count; i++) {
      const [u, v] = dimensions[Math.floor(i / verticesPerFace)];
      const x = uv.getX(i) * u;
      const y = uv.getY(i) * v;
      uv.setXY(i, turnGrain ? y : x, turnGrain ? x : y);
    }
    if (pitch) geometry.rotateX(pitch);
    this.place(geometry, material, x, y, z);
  }

  upholstered(material: THREE.Material, x: number, y: number, z: number, shape: Upholstery,
    options: { pitch?: number; yaw?: number; roll?: number; welt?: THREE.Material; vertical?: boolean } = {}): void {
    const { pitch = 0, yaw = 0, roll = 0, welt, vertical = false } = options;
    const { geometry, map } = upholsteryShape(shape);
    const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, roll));
    geometry.applyMatrix4(rotation);
    this.place(geometry, material, x, y, z);
    if (welt) {
      const samples = [-1, -.98, -.93, -.85, -.75, -.57, -.29, 0, .29, .57, .75, .85, .93, .98];
      const outline = [
        ...samples.map(s => [s, -1]), ...samples.map(s => [1, s]),
        ...samples.map(s => [-s, 1]), ...samples.map(s => [-1, -s]),
      ];
      const stitches: Point[] = outline.map(([u, v]) => {
        const point = (vertical ? map(u, v, .12, .0026) : map(u, .19, v, .0026)).applyMatrix4(rotation);
        return [x + point.x, y + point.y, z + point.z];
      });
      this.tube(welt, stitches, .0019, true);
    }
  }

  surface(material: THREE.Material, width: number, length: number, columns: number, rows: number,
    sample: (u: number, v: number) => Point): void {
    this.place(furnitureSurface(width, length, columns, rows, sample), material, 0, 0, 0);
  }

  print(material: THREE.Material, x: number, y: number, z: number, w: number, h: number,
    uvRect: readonly [left: number, bottom: number, right: number, top: number]): void {
    const geometry = new THREE.PlaneGeometry(w, h);
    const uv = geometry.getAttribute('uv');
    const [left, bottom, right, top] = uvRect;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, THREE.MathUtils.lerp(left, right, uv.getX(i)), THREE.MathUtils.lerp(bottom, top, uv.getY(i)));
    }
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
    const geometry = new THREE.TubeGeometry(curve, Math.max(points.length * 2, 12), radius, radius > .006 ? 10 : 6,
      closed);
    const uv = geometry.getAttribute('uv');
    const length = curve.getLength();
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * length, uv.getY(i) * Math.PI * radius * 2);
    }
    this.place(geometry, material, 0, 0, 0);
  }

  // A turned profile can become an oval with independent width and depth.
  vessel(material: THREE.Material, x: number, y: number, z: number, width: number, depth: number,
    profile: readonly (readonly [radius: number, height: number])[], pitch = 0, turnGrain = false): void {
    const geometry = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 40);
    geometry.scale(width / 2, 1, depth / 2);
    const uv = geometry.getAttribute('uv');
    const circumference = Math.PI * (width + depth) / 2;
    let distance = 0;
    const profileDistances = profile.map(([r, h], i) => {
      if (i > 0) distance += Math.hypot((r - profile[i - 1][0]) * (width + depth) / 4, h - profile[i - 1][1]);
      return distance;
    });
    for (let i = 0; i < uv.count; i++) {
      const horizontal = uv.getX(i) * circumference;
      const vertical = profileDistances[i % profile.length];
      uv.setXY(i, turnGrain ? vertical : horizontal, turnGrain ? horizontal : vertical);
    }
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
    radius: number, hole?: { x: number; z: number; width: number; depth: number; radius?: number }): void {
    const shape = new THREE.Shape();
    roundedOutline(shape, 0, 0, w, d, radius);
    if (hole) {
      const cut = new THREE.Path();
      roundedOutline(cut, hole.x, -hole.z, hole.width, hole.depth, hole.radius ?? .085);
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
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    for (let index = 0; index < uv.count; index++) {
      const x = position.getX(index) + w / 2;
      const z = position.getZ(index) + d / 2;
      const y = position.getY(index);
      const top = Math.abs(normal.getY(index)) > .52;
      uv.setXY(index, top || Math.abs(normal.getX(index)) < .64 ? x : z, top ? z : y);
    }
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
