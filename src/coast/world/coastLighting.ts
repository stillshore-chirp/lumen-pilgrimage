import * as THREE from 'three';
import type { CoastQuality } from '../CoastWorld';
import { groundHeight } from '../terrain';

const localHalfWidth = 67;
const localMapSize = 2048;
const windShadowInterval = 0.28;

function createSunShadow(name: string, intensity: number, radius: number, resolution: number,
  far: number, normalBias: number, bias: number, filterRadius: number): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xffebcd, intensity);
  light.name = name;
  light.castShadow = true;
  const { shadow } = light;
  shadow.camera.left = shadow.camera.bottom = -radius;
  shadow.camera.right = shadow.camera.top = radius;
  shadow.camera.near = 0.5;
  shadow.camera.far = far;
  shadow.camera.updateProjectionMatrix();
  shadow.mapSize.setScalar(resolution);
  shadow.normalBias = normalBias;
  shadow.bias = bias;
  shadow.radius = filterRadius;
  shadow.autoUpdate = false;
  shadow.needsUpdate = true;
  return light;
}

const sunVisibility = /* glsl */`
  float coastSunShadow() {
    #if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
      if (receiveShadow) {
        #if NUM_DIR_LIGHT_SHADOWS > 1
          // The first shadow covers the whole bay and forest. The second follows the viewer.
          vec4 nearCoord = vDirectionalShadowCoord[1];
          vec3 projected = nearCoord.xyz / nearCoord.w;
          vec2 nearEdge = min(projected.xy, 1.0 - projected.xy);
          float localWeight = smoothstep(0.035, 0.135, min(nearEdge.x, nearEdge.y))
            * smoothstep(0.0, 0.07, projected.z) * (1.0 - smoothstep(0.92, 1.0, projected.z));
          float nearby = 1.0;
          if (localWeight > 0.0) {
            DirectionalLightShadow localShadow = directionalLightShadows[1];
            nearby = getShadow(directionalShadowMap[1], localShadow.shadowMapSize,
              localShadow.shadowIntensity, localShadow.shadowBias, localShadow.shadowRadius, nearCoord);
            if (localWeight >= 1.0) return nearby;
          }
        #endif

        DirectionalLightShadow broadShadow = directionalLightShadows[0];
        float broad = getShadow(directionalShadowMap[0], broadShadow.shadowMapSize, broadShadow.shadowIntensity,
          broadShadow.shadowBias, broadShadow.shadowRadius, vDirectionalShadowCoord[0]);
        #if NUM_DIR_LIGHT_SHADOWS > 1
          return mix(broad, nearby, localWeight);
        #else
          return broad;
        #endif
      }
    #endif
    return 1.0;
  }
`;

const forestBounce = /* glsl */`
  float coastOpening(vec2 p, vec2 center, vec2 radius) {
    vec2 d = (p - center) / radius;
    return 1.0 - smoothstep(0.12, 1.0, dot(d, d));
  }

  vec3 coastIndirectTint(vec2 p) {
    if (p.y < 104.0 || p.y > 515.0 || abs(p.x) > 217.0) return vec3(1.0);
    float cover = smoothstep(104.0, 159.0, p.y) * (1.0 - smoothstep(432.0, 515.0, p.y));
    cover *= 1.0 - smoothstep(142.0, 217.0, abs(p.x));
    float glade = coastOpening(p, vec2(39.0, 262.0), vec2(27.0, 34.0));
    float overlook = coastOpening(p, vec2(-14.0, 392.0), vec2(37.0, 34.0));
    float rockSlot = coastOpening(p, vec2(-63.0, 304.0), vec2(17.0, 22.0));
    cover *= 1.0 - max(glade * 0.87, overlook * 0.94);
    return mix(vec3(1.0), vec3(0.61, 0.69, 0.61), cover) * (1.0 - 0.37 * rockSlot);
  }
`;

const directLight = THREE.ShaderChunk.lights_fragment_begin.replace(
  /#if \( NUM_DIR_LIGHTS > 0 \) && defined\( RE_Direct \)[\s\S]*?(?=#if \( NUM_RECT_AREA_LIGHTS > 0 \))/, /* glsl */`
    #if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
      getDirectionalLightInfo(directionalLights[0], directLight);
      directLight.color *= coastSunShadow();
      RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    #endif
  `,
);

function applyCoastLighting(scene: THREE.Object3D): void {
  const updated = new Set<THREE.Material>();
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const standard = material instanceof THREE.MeshStandardMaterial;
      const custom = material instanceof THREE.ShaderMaterial && material.lights
        && material.fragmentShader.includes('getShadowMask()');
      if ((!standard && !custom) || updated.has(material)) continue;
      updated.add(material);
      const compile = material.onBeforeCompile;
      const programKey = material.customProgramCacheKey();
      material.customProgramCacheKey = () => `${programKey}|coast-sun`;
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${sunVisibility}`)
          .replaceAll('getShadowMask()', 'coastSunShadow()');
        if (!standard) return;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${forestBounce}`)
          .replace('#include <lights_fragment_begin>', directLight)
          .replace('#include <lights_fragment_end>', `
            vec2 coastLightingXZ = ((vec4(geometryPosition, 1.0) - viewMatrix[3]) * viewMatrix).xz;
            irradiance *= coastIndirectTint(coastLightingXZ);
            #include <lights_fragment_end>`);
      };
      material.needsUpdate = true;
    }
  });
}

export function createCoastLighting(scene: THREE.Scene, sunDirection: THREE.Vector3): {
  addScenery: (scenery: THREE.Object3D) => void;
  setQuality: (quality: CoastQuality) => void;
  update: (elapsed: number, camera: THREE.PerspectiveCamera) => void;
  dispose: () => void;
} {
  const skyFill = new THREE.HemisphereLight(0xdbeaff, 0x7f926d, 1.42);
  const bounce = new THREE.AmbientLight(0xfff6de, 0.24);
  const sun = createSunShadow('Sun and broad coast shadows', 3.0, 380, 1024, 880, 0.27, -0.00013, 1.65);
  sun.target.position.set(0, 16, 175);
  sun.position.copy(sun.target.position).addScaledVector(sunDirection, 463);

  // This light contributes a depth map only. Surface shading adds the sun once.
  const local = createSunShadow('Near canopy and terrain shadows', 0, localHalfWidth, localMapSize,
    500, 0.052, -0.000032, 1.7);
  local.visible = false;
  const lightRight = new THREE.Vector3(0, 1, 0).cross(sunDirection).normalize();
  const lightUp = sunDirection.clone().cross(lightRight).normalize();
  const texel = localHalfWidth * 2 / localMapSize;
  const focus = new THREE.Vector3();
  const broadAnchor = new THREE.Vector3(Infinity, Infinity, Infinity);
  let lastShadow = -Infinity;
  scene.add(skyFill, bounce, sun, sun.target, local, local.target);
  applyCoastLighting(scene);

  return {
    addScenery(scenery) {
      applyCoastLighting(scenery);
      sun.shadow.needsUpdate = true;
      lastShadow = -Infinity;
    },
    setQuality(quality) {
      const high = quality === 'high';
      if (local.visible === high) return;
      local.visible = high;
      lastShadow = -Infinity;
      broadAnchor.set(Infinity, Infinity, Infinity);
      if (!high) {
        local.shadow.dispose();
        local.shadow.map = null;
      }
    },
    update(elapsed, camera) {
      // New shadow-casting tree tiles become visible as the viewer changes valleys.
      if (broadAnchor.distanceToSquared(camera.position) > 36 * 36) {
        broadAnchor.copy(camera.position);
        sun.shadow.needsUpdate = true;
      }
      if (!local.visible || elapsed - lastShadow < windShadowInterval) return;
      lastShadow = elapsed;
      focus.copy(camera.position);
      focus.y = Math.min(focus.y, Math.max(0, groundHeight(focus.x, focus.z)) + 18);
      const u = focus.dot(lightRight);
      const v = focus.dot(lightUp);
      focus.addScaledVector(lightRight, Math.round(u / texel) * texel - u);
      focus.addScaledVector(lightUp, Math.round(v / texel) * texel - v);
      local.target.position.copy(focus);
      local.position.copy(focus).addScaledVector(sunDirection, 258);
      local.shadow.needsUpdate = true;
    },
    dispose() {
      sun.shadow.dispose();
      local.shadow.dispose();
    },
  };
}
