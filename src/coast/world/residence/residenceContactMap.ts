import * as THREE from 'three';
import { residenceFieldExtent, residenceFieldOrigin } from './residenceLightField';

const width = 768;
const height = 686;
const metersPerTexel = residenceFieldExtent.x / width;
const lowestReceiver = -.028;
const casterHeight = .26;
const flushFinishHeight = .006;
const footSpanInTexels = .18 / metersPerTexel;

// Project the low part of each furniture mesh onto the floor. Thin feet supply their true silhouette,
// and the underside of a cabinet produces a continuous shadow along its plinth.
export function createResidenceContactMap(furniture: THREE.Object3D, rug: THREE.Material): THREE.DataTexture {
  const casters = new Uint8Array(width * height);
  const point = new THREE.Vector3();
  const worldBounds = new THREE.Box3();
  furniture.updateWorldMatrix(true, true);
  furniture.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || Array.isArray(object.material)
      || object.userData.dynamicResidenceShadow || object.material.transparent || object.material.name === rug.name) return;
    const positions = object.geometry.getAttribute('position');
    if (!positions) return;
    const buffer = positions instanceof THREE.InterleavedBufferAttribute ? positions.data : positions;
    // Curtain cloth updates its vertex buffer as it travels. Only its current geometry casts a shadow.
    if (buffer.usage !== THREE.StaticDrawUsage) return;
    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    worldBounds.copy(object.geometry.boundingBox!).applyMatrix4(object.matrixWorld);
    if (worldBounds.min.y > casterHeight || worldBounds.max.y <= flushFinishHeight) return;

    const vertices = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i += 1) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      vertices[i * 3] = (point.x - residenceFieldOrigin.x) / metersPerTexel;
      vertices[i * 3 + 1] = (-point.z - residenceFieldOrigin.y) / metersPerTexel;
      vertices[i * 3 + 2] = point.y;
    }
    const index = object.geometry.index;
    const count = index?.count ?? positions.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const a = 3 * (index ? index.getX(i) : i);
      const b = 3 * (index ? index.getX(i + 1) : i + 1);
      const c = 3 * (index ? index.getX(i + 2) : i + 2);
      const ay = vertices[a + 2], by = vertices[b + 2], cy = vertices[c + 2];
      const highest = Math.max(ay, by, cy);
      if (Math.min(ay, by, cy) >= casterHeight || highest <= lowestReceiver) continue;
      const ax = vertices[a], az = vertices[a + 1];
      const bx = vertices[b], bz = vertices[b + 1];
      const cx = vertices[c], cz = vertices[c + 1];
      const west = Math.min(ax, bx, cx), east = Math.max(ax, bx, cx);
      const south = Math.min(az, bz, cz), north = Math.max(az, bz, cz);
      // Flush floor tiles and their trim can share a batch with solid furniture.
      // Large faces at floor level are receivers; retain the small base faces of raised feet.
      if (highest <= flushFinishHeight && Math.max(east - west, north - south) > footSpanInTexels) continue;
      const determinant = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(determinant) < .002) continue;
      const x0 = Math.max(0, Math.floor(west));
      const x1 = Math.min(width - 1, Math.floor(east));
      const z0 = Math.max(0, Math.floor(south));
      const z1 = Math.min(height - 1, Math.floor(north));
      const closest = Math.min(ay, by, cy);
      // Keep a subtexel chair glide or felted foot in the map when it falls between samples.
      if (Math.abs(determinant) < .85 && closest < .07) {
        const x = Math.floor((ax + bx + cx) / 3);
        const z = Math.floor((az + bz + cz) / 3);
        if (x >= 0 && x < width && z >= 0 && z < height) casters[z * width + x] = 255;
        continue;
      }
      for (let z = z0; z <= z1; z += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const dx = x + .5 - cx;
          const dz = z + .5 - cz;
          const u = ((bz - cz) * dx + (cx - bx) * dz) / determinant;
          const v = ((cz - az) * dx + (ax - cx) * dz) / determinant;
          const w = 1 - u - v;
          if (u < 0 || v < 0 || w < 0) continue;
          const y = u * ay + v * by + w * cy;
          if (y < lowestReceiver) continue;
          const strength = Math.round(255 * (1 - THREE.MathUtils.smoothstep(y, .022, casterHeight)));
          const texel = z * width + x;
          casters[texel] = Math.max(casters[texel], strength);
        }
      }
    }
  });

  const result = new Uint8Array(casters.length);
  const kernel = [];
  for (let dz = -8; dz <= 8; dz += 1) for (let dx = -8; dx <= 8; dx += 1) {
    const distance = Math.hypot(dx, dz);
    if (distance < 8.4) kernel.push({ dx, dz, falloff: (1 - THREE.MathUtils.smoothstep(distance, 0, 8.4)) ** 1.65 });
  }
  for (let z = 0; z < height; z += 1) for (let x = 0; x < width; x += 1) {
    const strength = casters[z * width + x];
    if (strength === 0) continue;
    for (const { dx, dz, falloff } of kernel) {
      if (x + dx < 0 || x + dx >= width || z + dz < 0 || z + dz >= height) continue;
      const texel = (z + dz) * width + x + dx;
      result[texel] = Math.max(result[texel], Math.round(strength * falloff));
    }
  }
  const map = new THREE.DataTexture(result, width, height, THREE.RedFormat);
  map.name = 'Projected low furniture geometry and feathered contact shadows';
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}
