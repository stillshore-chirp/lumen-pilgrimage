import { InstancedMesh, Light, Line, Mesh, Points, ShaderMaterial, Sprite, Texture } from 'three';
import type { BufferGeometry, Material, Scene } from 'three';

/** Release scene-owned GPU resources when the renderer outlives the world. */
export function disposeSceneDrawables(scene: Scene): void {
  const geometry = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  scene.traverse(object => {
    if (object instanceof Light) object.dispose();
    if (object instanceof InstancedMesh) object.dispose();
    if (object instanceof Sprite) {
      // Three.js sprites share one renderer-independent geometry.
      materials.add(object.material);
    } else if (object instanceof Mesh || object instanceof Points || object instanceof Line) {
      geometry.add(object.geometry);
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) materials.add(material);
      if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
      if (object.customDistanceMaterial) materials.add(object.customDistanceMaterial);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof Texture && !value.isRenderTargetTexture) textures.add(value);
    }
    if (material instanceof ShaderMaterial) {
      for (const { value } of Object.values(material.uniforms)) {
        if (value instanceof Texture && !value.isRenderTargetTexture) textures.add(value);
      }
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const buffer of geometry) buffer.dispose();
  scene.clear();
}
