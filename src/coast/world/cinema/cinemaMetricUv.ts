import type { MeshStandardMaterial } from 'three';

/**
 * Metre-based face UVs for unit BoxGeometry, orthogonal positive instance scale,
 * and unit mesh/parent scales. Rounded or sheared geometry needs its own mapping.
 * Sampler repeat stays one: dimensions and cycles are applied exactly once.
 */
export function applyCinemaMetricBoxUv(material: MeshStandardMaterial, cyclesPerMetre: number): void {
  if (!(cyclesPerMetre > 0 && Number.isFinite(cyclesPerMetre))) throw new RangeError('Invalid cinema UV scale');
  if (material.userData.cinemaMetricUv) throw new RangeError('Cinema metric UVs are already configured');
  for (const texture of new Set([material.map, material.bumpMap])) {
    if (texture && (texture.repeat.x !== 1 || texture.repeat.y !== 1)) {
      throw new RangeError('Metric cinema UVs require unit sampler repeat');
    }
  }
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey.call(material);
  material.userData.cinemaMetricUv = { geometry: 'unitBox', cyclesPerMetre };
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.cinemaMetricCycles = { value: cyclesPerMetre };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float cinemaMetricCycles;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec3 cinemaMetricSize = vec3(1.0);
        #ifdef USE_INSTANCING
          cinemaMetricSize = vec3(length(instanceMatrix[0].xyz),
            length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif
        vec3 cinemaMetricNormal = abs(normal);
        vec2 cinemaMetricFace = cinemaMetricNormal.x > 0.5 ? cinemaMetricSize.zy
          : (cinemaMetricNormal.y > 0.5 ? cinemaMetricSize.xz : cinemaMetricSize.xy);
        #ifdef USE_MAP
          vMapUv = (mapTransform * vec3(MAP_UV * cinemaMetricFace * cinemaMetricCycles, 1.0)).xy;
        #endif
        #ifdef USE_BUMPMAP
          vBumpMapUv = (bumpMapTransform * vec3(BUMPMAP_UV * cinemaMetricFace * cinemaMetricCycles, 1.0)).xy;
        #endif`);
  };
  material.customProgramCacheKey = () => `${key}|cinema-metric-box-uv-v1`;
  material.needsUpdate = true;
}
