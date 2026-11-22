import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type StaticBatch = {
  material: THREE.Material;
  geometries: THREE.BufferGeometry[];
  castShadow: boolean;
};

export class OverlookModel {
  private readonly batches = new Map<string, StaticBatch>();

  mesh(geometry: THREE.BufferGeometry, material: THREE.Material, castShadow = true): void {
    const key = `${material.uuid}:${castShadow}:${geometry.index !== null}`;
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { material, castShadow, geometries: [] };
      this.batches.set(key, batch);
    }
    batch.geometries.push(geometry);
  }

  block(material: THREE.Material, x: number, y: number, z: number,
    width: number, height: number, depth: number, yaw = 0): void {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const uv = geometry.attributes.uv;
    const faceSizes = [[depth, height], [depth, height], [width, depth],
      [width, depth], [width, height], [width, height]];
    for (let i = 0; i < uv.count; i += 1) {
      const [u, v] = faceSizes[Math.floor(i / 4)];
      uv.setXY(i, (uv.getX(i) * u + x * 0.61 + z * 0.39) * 0.27,
        (uv.getY(i) * v + y * 0.71 + z * 0.29) * 0.27);
    }
    this.mesh(geometry.rotateY(yaw).translate(x, y, z), material);
  }

  column(material: THREE.Material, x: number, y: number, z: number, radiusTop: number,
    radiusBottom: number, height: number, sides: number, yaw = 0): void {
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, sides);
    this.mesh(geometry.rotateY(yaw).translate(x, y, z), material);
  }

  rod(material: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number, sides = 8): void {
    const delta = new THREE.Vector3().subVectors(b, a);
    const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    this.mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), sides)
      .applyQuaternion(orientation).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), material);
  }

  finish(group: THREE.Group): void {
    for (const { geometries, material, castShadow } of this.batches.values()) {
      const merged = mergeGeometries(geometries);
      if (!merged) throw new Error('Incompatible overlook mesh attributes');
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = material.name;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const geometry of geometries) geometry.dispose();
    }
    this.batches.clear();
  }
}

export function seededDetail(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function stoneTexture(seed: number, color: boolean): THREE.DataTexture {
  const size = 256;
  const random = seededDetail(seed);
  const gridSize = 16;
  const aggregate = Float32Array.from({ length: gridSize * gridSize }, random);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const gx = x / gridSize, gy = y / gridSize;
      const ix = Math.floor(gx), iy = Math.floor(gy);
      const fx = gx - ix, fy = gy - iy;
      const smoothX = fx * fx * (3 - 2 * fx), smoothY = fy * fy * (3 - 2 * fy);
      const sample = (a: number, b: number) => aggregate[(a % gridSize) + (b % gridSize) * gridSize];
      const a = THREE.MathUtils.lerp(sample(ix, iy), sample(ix + 1, iy), smoothX);
      const b = THREE.MathUtils.lerp(sample(ix, iy + 1), sample(ix + 1, iy + 1), smoothX);
      const body = THREE.MathUtils.lerp(a, b, smoothY);
      const chip = random();
      const index = (x + y * size) * 4;
      const value = color ? 231 + (body - 0.5) * 21 + (chip - 0.5) * 24 - (chip < 0.035 ? 27 : 0)
        : 128 + (body - 0.5) * 74 + (chip - 0.5) * 97;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.name = color ? 'Overlook mineral aggregate' : 'Overlook stone microrelief';
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function overlookFinishes() {
  const map = stoneTexture(8249, true);
  const bumpMap = stoneTexture(8249, false);
  const stone = (name: string, color: number) => new THREE.MeshStandardMaterial({
    name, color, map, bumpMap, bumpScale: 0.019, roughness: 0.89,
  });
  const finish = (name: string, color: number, metalness: number, roughness: number) =>
    new THREE.MeshStandardMaterial({ name, color, metalness, roughness });

  return {
    limestone: stone('Pale cast stone', 0xd7cbaf),
    cream: stone('Fine cream limestone', 0xf1e1bb),
    shadowStone: stone('Recessed limestone', 0x9b8b74),
    foundation: stone('Terrace retaining masonry', 0xa2947b),
    mortar: finish('Terrace joints', 0x6e665c, 0, 0.98),
    paving: new THREE.MeshStandardMaterial({
      name: 'Beveled terrace slabs', color: 0xffffff, map, bumpMap, bumpScale: 0.012,
      vertexColors: true, roughness: 0.92,
    }),
    iron: finish('Graphite-painted ironwork', 0x343b3e, 0.39, 0.62),
    bronze: finish('Weathered architectural bronze', 0x594331, 0.51, 0.53),
    brass: finish('Worn brass', 0x9c794b, 0.46, 0.48),
    pewter: finish('Painted cast viewer housing', 0x8b9896, 0.23, 0.48),
    lens: finish('Smoked optical glass', 0x263e44, 0.32, 0.26),
    wood: [0x7c543a, 0x926747, 0x815b40].map((color, i) => stone(`Oiled hardwood slats ${i + 1}`, color)),
    copper: [0x567b71, 0x5d8479, 0x557b75, 0x6a8b7a, 0x4f7369, 0x628275]
      .map((color, i) => finish(`Patinated copper panel ${i + 1}`, color, 0.21, 0.67)),
    copperSeam: finish('Copper seam and flashings', 0x42665f, 0.37, 0.61),
    window: new THREE.MeshStandardMaterial({
      name: 'Amber ribbed glazing', color: 0x4c4235, emissive: 0xffad57, emissiveIntensity: 0,
      metalness: 0.24, roughness: 0.37,
    }),
    frosted: new THREE.MeshStandardMaterial({
      name: 'Ribbed opal fixture glass', color: 0xe2c99f, emissive: 0xffac53, emissiveIntensity: 0,
      roughness: 0.45,
    }),
  };
}

export type OverlookFinishes = ReturnType<typeof overlookFinishes>;
