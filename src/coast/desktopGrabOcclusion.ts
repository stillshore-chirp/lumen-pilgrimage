import {
  InstancedMesh, Mesh, MeshPhysicalMaterial, Raycaster, Sphere, Vector3,
  type Intersection, type Material, type Object3D, type Scene,
} from 'three';

const occluders = new WeakMap<Mesh, (ray: Raycaster) => boolean>();

export function registerDesktopGrabOccluder(mesh: Mesh, intersects: (ray: Raycaster) => boolean): void {
  occluders.set(mesh, intersects);
}

function isOpaque(material: Material): boolean {
  return material.visible && material.colorWrite && !material.transparent && material.opacity === 1
    && material.alphaTest === 0 && !material.alphaHash
    && !(material instanceof MeshPhysicalMaterial && material.transmission > 0);
}

export function createDesktopGrabOcclusion(scene: Scene): (ray: Raycaster, target: Object3D, distance: number) => boolean {
  const ray = new Raycaster();
  const hits: Intersection[] = [];
  const instanceBounds = new Sphere();
  const closest = new Vector3();

  function intersects(mesh: Mesh, distance: number): boolean {
    const { material } = mesh;
    if (Array.isArray(material) ? !material.some(isOpaque) : !isOpaque(material)) return false;
    const occluder = occluders.get(mesh);
    if (occluder) return occluder(ray);
    if (mesh instanceof InstancedMesh && mesh.boundingSphere) {
      // Three checks the infinite ray against this bound before testing every instance.
      instanceBounds.copy(mesh.boundingSphere).applyMatrix4(mesh.matrixWorld);
      const along = closest.subVectors(instanceBounds.center, ray.ray.origin).dot(ray.ray.direction);
      ray.ray.at(Math.max(ray.near, Math.min(ray.far, along)), closest);
      if (!instanceBounds.containsPoint(closest)) return false;
    }
    mesh.raycast(ray, hits);
    const blocked = hits.some(hit => hit.distance < distance && (
      !Array.isArray(material) || (!!hit.face && isOpaque(material[hit.face.materialIndex]))
    ));
    hits.length = 0;
    return blocked;
  }

  function visit(object: Object3D, target: Object3D, distance: number): boolean {
    if (!object.visible || object === target) return false;
    object.updateWorldMatrix(false, false);
    if (object instanceof Mesh && object.layers.test(ray.layers) && intersects(object, distance)) return true;
    for (const child of object.children) {
      if (visit(child, target, distance)) return true;
    }
    return false;
  }

  return (source, target, distance) => {
    ray.ray.copy(source.ray);
    ray.camera = source.camera;
    ray.layers.mask = source.camera?.layers.mask ?? source.layers.mask;
    ray.near = source.near;
    ray.far = Math.min(source.far, distance);
    return ray.far > ray.near && visit(scene, target, distance);
  };
}
