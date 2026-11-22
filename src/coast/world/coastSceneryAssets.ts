import { Mesh, type BufferGeometry, type MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const sceneryPacks = [
  { file: 'moss.glb', names: ['moss01', 'moss02', 'moss03', 'moss04', 'moss05', 'moss06'] },
  { file: 'shelf.glb', names: ['rockShelf'] },
  { file: 'boulder.glb', names: ['rockBoulder'] },
  { file: 'ferns.glb', names: ['fernA', 'fernB', 'fernC', 'fernD'] },
] as const;

export type CoastSceneryName = (typeof sceneryPacks)[number]['names'][number];
export type CoastScenery = Record<CoastSceneryName, Mesh<BufferGeometry, MeshStandardMaterial>>;

/** Templates share their pack's maps and use meters, centered X/Z and a base pivot at Y=0. */
export async function loadCoastScenery(): Promise<CoastScenery> {
  const loader = new GLTFLoader();
  const basePath = `${import.meta.env.BASE_URL}coast-materials/scenery/`;
  const parts = await Promise.all(sceneryPacks.map(async ({ file, names }) => {
    const { scene } = await loader.loadAsync(`${basePath}${file}`);
    return names.map((name) => {
      const mesh = scene.getObjectByName(name);
      if (!(mesh instanceof Mesh) || !mesh.material?.isMeshStandardMaterial) {
        throw new Error(`Missing scenery mesh ${name} in ${file}`);
      }
      const material: MeshStandardMaterial = mesh.material;
      for (const texture of [material.map, material.normalMap, material.roughnessMap]) {
        if (texture) texture.anisotropy = 4;
      }
      return [name, mesh] as const;
    });
  }));
  return Object.fromEntries(parts.flat()) as CoastScenery;
}
