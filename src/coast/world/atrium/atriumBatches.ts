import { BufferGeometry, InstancedMesh, Mesh, Vector3 } from 'three';
import type { Group, Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Keep opaque draws pooled by finish and by part of the building. Transparent glass
// keeps its original draw order, and repeated instance batches keep their shared vertices.
export function batchAtriumOpaqueMeshes(root: Group): void {
  const buckets = new Map<string, { material: Material; meshes: Mesh[] }>();
  const center = new Vector3();
  const detached = new Set<BufferGeometry>();
  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    if (!(object instanceof Mesh) || object instanceof InstancedMesh || Array.isArray(object.material) || !object.visible
      || object.material.transparent || object.material.opacity < 1
      || object.geometry.drawRange.start !== 0 || object.geometry.drawRange.count !== Infinity
      || object.morphTargetInfluences || object.userData.atriumAnimated || object.matrixWorld.determinant() <= 0) return;
    const sourceGeometry: BufferGeometry = object.geometry;
    const attributes = Object.entries(sourceGeometry.attributes).map(([name, attribute]) =>
      `${name}:${attribute.itemSize}:${attribute.array.constructor.name}:${attribute.normalized}`).sort().join('/');
    object.geometry.computeBoundingSphere();
    if (!object.geometry.boundingSphere) return;
    center.copy(object.geometry.boundingSphere.center).applyMatrix4(object.matrixWorld);
    const sector = `${Math.floor(center.x / 8)},${Math.floor(center.y / 4.55)},${Math.floor(center.z / 12)}`;
    const key = `${object.material.id}|${sector}|${attributes}|${Number(Boolean(object.geometry.index))}`
      + `|${Number(object.castShadow)}${Number(object.receiveShadow)}|${object.renderOrder}`;
    let batch = buckets.get(key);
    if (!batch) {
      batch = { material: object.material, meshes: [] };
      buckets.set(key, batch);
    }
    batch.meshes.push(object);
  });
  const rootInverse = root.matrixWorld.clone().invert();
  for (const { material, meshes } of buckets.values()) {
    if (meshes.length < 3) continue;
    const parts = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(rootInverse.clone().multiply(mesh.matrixWorld)));
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!geometry) continue;
    const first = meshes[0];
    const batch = new Mesh(geometry, material);
    batch.name = material.name || 'atrium architectural batch';
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    batch.renderOrder = first.renderOrder;
    root.add(batch);
    for (const mesh of meshes) {
      detached.add(mesh.geometry);
      mesh.removeFromParent();
    }
  }
  root.traverse(object => {
    if (object instanceof Mesh) detached.delete(object.geometry);
  });
  for (const geometry of detached) geometry.dispose();
}
