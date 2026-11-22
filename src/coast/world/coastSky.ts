import * as THREE from 'three';

const BASE_URL = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
const SKY_SUN_LONGITUDE = 0.6;

function createAzureFallback(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Coast sky fallback requires a 2D canvas context');
  }

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#246fc3');
  gradient.addColorStop(0.48, '#4d9bd7');
  gradient.addColorStop(0.72, '#a9d0e2');
  gradient.addColorStop(1, '#c7dfe9');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

/** Builds a camera-centered dome with a lightweight fallback while the local panorama loads. */
export function createCoastSky(sunDirection: THREE.Vector3): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.SphereGeometry(560, 48, 32);
  const material = new THREE.MeshBasicMaterial({
    map: createAzureFallback(),
    side: THREE.BackSide,
    fog: false,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 coastSkyUv = vec2(vMapUv.x, max(vMapUv.y, 0.5));
        vec4 sampledDiffuseColor = texture2D(map, coastSkyUv);
        diffuseColor *= sampledDiffuseColor;
      #endif`
    );
  };
  material.customProgramCacheKey = () => 'coast-sky-panorama-v1';

  const sky = new THREE.Mesh(geometry, material);
  const cameraPosition = new THREE.Vector3();
  const normalizedSun = sunDirection.clone().normalize();
  const worldSunAzimuth = Math.atan2(normalizedSun.x, normalizedSun.z);
  const sourceSunAzimuth = SKY_SUN_LONGITUDE * Math.PI * 2 - Math.PI / 2;
  sky.rotation.y = worldSunAzimuth - sourceSunAzimuth;
  sky.name = 'Coast sky and clouds';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldPosition(cameraPosition);
    if (sky.parent) {
      sky.position.copy(sky.parent.worldToLocal(cameraPosition));
    } else {
      sky.position.copy(cameraPosition);
    }
    sky.updateMatrixWorld(true);
  };

  new THREE.TextureLoader().load(
    `${BASE_URL}coast-materials/sky.webp`,
    (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.wrapS = THREE.ClampToEdgeWrapping;
      loaded.wrapT = THREE.ClampToEdgeWrapping;
      loaded.magFilter = THREE.LinearFilter;
      loaded.minFilter = THREE.LinearMipmapLinearFilter;
      loaded.generateMipmaps = true;
      loaded.needsUpdate = true;
      material.map = loaded;
      material.needsUpdate = true;
    },
    undefined,
    () => { /* Keep the azure gradient if the local panorama is unavailable. */ }
  );
  return sky;
}
