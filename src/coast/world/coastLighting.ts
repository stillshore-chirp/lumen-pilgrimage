import * as THREE from 'three';
import type { CoastQuality } from '../CoastWorld';
import { groundHeight } from '../terrain';
import { bindCoastSky, coastAerialGlsl, coastSkyGlsl, type CoastAtmosphere, type CoastTimeOfDay } from './coastAtmosphere';
import { coastForestLight } from './coastForestLight';

const broadHalfWidth = 230;
const broadMapSize = 1024;
const localHalfWidth = 55;
const localMapSize = 2048;
const windShadowInterval = 0.28;

function createSunShadow(name: string, intensity: number, radius: number, resolution: number,
  far: number, normalBias: number, bias: number, filterRadius: number): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xffffff, intensity);
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
  // Keep the broad penumbra stable across pixels and frames. The near map still uses Three's PCF.
  #if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
    float coastBroadShadow(DirectionalLightShadow shadow, vec4 coord) {
      vec3 p = coord.xyz / coord.w;
      vec2 margin = min(p.xy, 1.0 - p.xy);
      float weight = smoothstep(0.004, 0.093, min(margin.x, margin.y))
        * smoothstep(0.0, 0.025, p.z) * (1.0 - smoothstep(0.96, 1.0, p.z));
      if (weight <= 0.0) return 1.0;
      p.z += shadow.shadowBias;
      vec2 r = vec2(shadow.shadowRadius) / shadow.shadowMapSize;
      float visible = (4.0 * texture(directionalShadowMap[0], p)
        + texture(directionalShadowMap[0], p + vec3(r.x, 0.0, 0.0))
        + texture(directionalShadowMap[0], p - vec3(r.x, 0.0, 0.0))
        + texture(directionalShadowMap[0], p + vec3(0.0, r.y, 0.0))
        + texture(directionalShadowMap[0], p - vec3(0.0, r.y, 0.0))) * 0.125;
      return mix(1.0, visible, weight * shadow.shadowIntensity);
    }
  #endif

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
        #ifdef SHADOWMAP_TYPE_PCF
          float broad = coastBroadShadow(broadShadow, vDirectionalShadowCoord[0]);
        #else
          float broad = getShadow(directionalShadowMap[0], broadShadow.shadowMapSize, broadShadow.shadowIntensity,
            broadShadow.shadowBias, broadShadow.shadowRadius, vDirectionalShadowCoord[0]);
        #endif
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

  float coastCanopyCover(vec3 world) {
    vec2 p = world.xz;
    if (p.y < 104.0 || p.y > 1190.0 || abs(p.x) > 435.0) return 0.0;
    float cover = smoothstep(104.0, 159.0, p.y) * (1.0 - smoothstep(432.0, 515.0, p.y));
    cover *= 1.0 - smoothstep(142.0, 217.0, abs(p.x));
    float glade = coastOpening(p, vec2(39.0, 262.0), vec2(27.0, 34.0));
    float overlook = coastOpening(p, vec2(-14.0, 392.0), vec2(37.0, 34.0));
    cover *= 1.0 - max(glade * 0.87, overlook * 0.94);
    float lake = coastOpening(p, vec2(143.0, 754.0), vec2(113.0, 107.0));
    float upland = smoothstep(458.0, 567.0, p.y) * (1.0 - smoothstep(1045.0, 1190.0, p.y));
    float canopyHeight = 31.0 + max(0.0, p.y - 205.0) * 0.15;
    float lowlandCanopy = cover * (1.0 - smoothstep(canopyHeight, canopyHeight + 18.0, world.y));
    return max(lowlandCanopy, upland * (1.0 - lake) * 0.44);
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

function applyCoastLighting(scene: THREE.Object3D, atmosphere: CoastAtmosphere,
  updated: WeakSet<THREE.Material>, nightIntensityScale: number, forestScattering: boolean): void {
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const standard = material instanceof THREE.MeshStandardMaterial;
      const builtIn = standard || (material instanceof THREE.MeshBasicMaterial && material.fog);
      const custom = material instanceof THREE.ShaderMaterial ? material : undefined;
      const water = custom?.lights && custom.fragmentShader.includes('varying vec3 vSurface;');
      const customFog = custom?.fog && custom.fragmentShader.includes('#include <fog_fragment>');
      if ((!builtIn && !water && !customFog) || updated.has(material)) continue;
      updated.add(material);
      const compile = material.onBeforeCompile;
      const programKey = material.customProgramCacheKey();
      const forestAir = forestScattering && (standard || water);
      material.customProgramCacheKey = () => `${programKey}|coast-lighting${forestAir ? '|forest-air' : ''}`;
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        bindCoastSky(shader.uniforms, atmosphere);
        shader.uniforms.uCoastSubmersion = atmosphere.submersion;
        shader.uniforms.uCoastAerialDistanceScale = atmosphere.aerialDistanceScale;
        // Built-ins expose the final view position after skinning, bending and instancing.
        // The underwater fog retains the dive behavior while air is integrated before tone mapping.
        const addWorldPoint = !water;
        const worldPoint = water ? 'vSurface' : 'vCoastWorldPoint';
        if (addWorldPoint) {
          const afterView = 'vCoastWorldPoint = cameraPosition + (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;';
          const hook = builtIn ? '#include <project_vertex>' : '#include <fog_vertex>';
          shader.vertexShader = `varying vec3 vCoastWorldPoint;\n${shader.vertexShader}`
            .replace(hook, `${hook}\n${afterView}`);
        }
        const sky = shader.fragmentShader.includes('vec3 coastSkyRadiance(') ? '' : coastSkyGlsl;
        shader.fragmentShader = shader.fragmentShader
          .replace('void main()', `
            ${addWorldPoint ? 'varying vec3 vCoastWorldPoint;' : ''}
            ${sky}
            ${coastAerialGlsl}
            ${forestAir ? coastForestLight : ''}
            void main()`)
          // The ocean shader may return through an underwater-specific branch.
          .replaceAll('#include <tonemapping_fragment>', `
            gl_FragColor.rgb = coastApplyAerial(gl_FragColor.rgb, ${worldPoint});
            ${forestAir ? `gl_FragColor.rgb = coastForestInscatter(gl_FragColor.rgb, ${worldPoint});` : ''}
            #include <tonemapping_fragment>`)
          .replace('#include <fog_fragment>', `
            #ifdef USE_FOG
              vec3 coastUnfogged = gl_FragColor.rgb;
              #include <fog_fragment>
              gl_FragColor.rgb = mix(coastUnfogged, gl_FragColor.rgb, uCoastSubmersion);
            #endif`);
        if (standard || water) {
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${sunVisibility}`)
            .replaceAll('getShadowMask()', 'coastSunShadow()');
        }
        if (!standard) return;
        shader.uniforms.uCoastNightIntensityScale = { value: nightIntensityScale };
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nuniform float uCoastNightIntensityScale;\n${forestBounce}`)
          .replace('#include <lights_fragment_begin>', directLight)
          .replace('#include <lights_fragment_end>', `
            float canopy = coastCanopyCover(vCoastWorldPoint);
            float up = dot(geometryNormal, vec3(viewMatrix[1]));
            vec3 canopyTint = mix(vec3(0.67, 0.76, 0.62), vec3(0.72, 0.77, 0.85), uCoastNight);
            vec3 bounce = mix(vec3(0.17, 0.21, 0.10), vec3(0.039, 0.053, 0.072) * uCoastNightIntensityScale, uCoastNight);
            irradiance *= mix(vec3(1.0), canopyTint, canopy);
            irradiance += bounce * canopy * (0.73 - 0.27 * up);
            #include <lights_fragment_end>`);
      };
      material.needsUpdate = true;
    }
  });
}

export function createCoastLighting(scene: THREE.Scene, atmosphere: CoastAtmosphere, heightAt = groundHeight,
  { nightIntensityScale = 1, forestScattering = false }: { nightIntensityScale?: number; forestScattering?: boolean } = {}): {
  addScenery: (scenery: THREE.Object3D) => void;
  setQuality: (quality: CoastQuality) => void;
  setTimeOfDay: (time: CoastTimeOfDay) => void;
  update: (elapsed: number, camera: THREE.PerspectiveCamera) => void;
  dispose: () => void;
} {
  const sunDirection = atmosphere.sun.value;
  const skyFill = new THREE.HemisphereLight(0xc6d9f5, 0xa28d6c, 1.38);
  const bounce = new THREE.AmbientLight(0xd5d4b0, 0.11);
  const sun = createSunShadow('Sun, moon and broad coast shadows', 4.1, broadHalfWidth, broadMapSize,
    790, 0.17, -0.000105, 1.0);
  sun.color.copy(atmosphere.solarColor.value).multiplyScalar(1 / atmosphere.solarColor.value.r);
  sun.target.position.set(0, 16, 92);
  sun.position.copy(sun.target.position).addScaledVector(sunDirection, 391);

  // This light contributes a depth map only. Surface shading adds the sun once.
  const local = createSunShadow('Near canopy and terrain shadows', 0, localHalfWidth, localMapSize,
    450, 0.040, -0.000028, 1.35);
  local.visible = false;
  const lightRight = new THREE.Vector3(0, 1, 0).cross(sunDirection).normalize();
  const lightUp = sunDirection.clone().cross(lightRight).normalize();
  const nearTexel = localHalfWidth * 2 / localMapSize;
  const broadTexel = broadHalfWidth * 2 / broadMapSize;
  const focus = new THREE.Vector3();
  const broadAnchor = new THREE.Vector3(Infinity, Infinity, Infinity);
  const materials = new WeakSet<THREE.Material>();
  let lastShadow = -Infinity;
  const snapToGrid = (point: THREE.Vector3, texel: number) => {
    const u = point.dot(lightRight);
    const v = point.dot(lightUp);
    point.addScaledVector(lightRight, Math.round(u / texel) * texel - u);
    point.addScaledVector(lightUp, Math.round(v / texel) * texel - v);
  };
  scene.add(skyFill, bounce, sun, sun.target, local, local.target);
  applyCoastLighting(scene, atmosphere, materials, nightIntensityScale, forestScattering);

  return {
    addScenery(scenery) {
      applyCoastLighting(scenery, atmosphere, materials, nightIntensityScale, forestScattering);
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
    setTimeOfDay(time) {
      const night = time === 'night';
      const lightColor = atmosphere.solarColor.value;
      sun.color.copy(lightColor).multiplyScalar(1 / Math.max(lightColor.r, lightColor.b));
      sun.intensity = night ? 0.57 * nightIntensityScale : 4.1;
      skyFill.color.setHex(night ? 0xa3bfef : 0xc6d9f5);
      skyFill.groundColor.setHex(night ? 0xa0aac0 : 0xa28d6c);
      skyFill.intensity = night ? 0.49 * nightIntensityScale : 1.38;
      bounce.color.setHex(night ? 0xb2c0db : 0xd5d4b0);
      bounce.intensity = night ? 0.14 * nightIntensityScale : 0.11;
      lightRight.set(0, 1, 0).cross(sunDirection).normalize();
      lightUp.copy(sunDirection).cross(lightRight).normalize();
      broadAnchor.set(Infinity, Infinity, Infinity);
      lastShadow = -Infinity;
    },
    update(elapsed, camera) {
      // New shadow-casting tree tiles become visible as the viewer changes valleys.
      if (broadAnchor.distanceToSquared(camera.position) > 27 * 27) {
        broadAnchor.copy(camera.position);
        const height = Math.max(18, heightAt(camera.position.x, camera.position.z));
        sun.target.position.set(camera.position.x, height, camera.position.z);
        snapToGrid(sun.target.position, broadTexel);
        sun.position.copy(sun.target.position).addScaledVector(sunDirection, 391);
        sun.shadow.needsUpdate = true;
      }
      if (!local.visible || elapsed - lastShadow < windShadowInterval) return;
      lastShadow = elapsed;
      focus.copy(camera.position);
      focus.y = Math.min(focus.y, Math.max(0, heightAt(focus.x, focus.z)) + 18);
      snapToGrid(focus, nearTexel);
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
