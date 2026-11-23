import * as THREE from 'three';

// A near-depth pass supplies geometry missing from the room's diffuse irradiance field,
// such as pillow/headboard joins and the narrow gap around a sink or fitted cabinetry.
export function createResidenceScreenOcclusion(...interior: THREE.Group[]) {
  const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  depth.name = 'Interior depth for near-surface occlusion';
  const target = new THREE.WebGLRenderTarget(1, 1, { depthTexture: depth });
  const depthMaterial = new THREE.MeshDepthMaterial({ colorWrite: false });
  const active = { value: 0 };
  const sampledDepth = { value: depth };
  const depthView = { value: new THREE.Matrix4() };
  const depthProjection = { value: new THREE.Matrix4() };
  const bound = new Set<THREE.Material>();
  const transparent = new Set<THREE.Mesh>();
  for (const group of interior) group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const material = object.material;
    if (material.transparent) transparent.add(object);
    if (material.transparent || !(material instanceof THREE.MeshStandardMaterial) || bound.has(material)) return;
    bound.add(material);
    const before = material.onBeforeCompile.bind(material);
    const cacheKey = material.customProgramCacheKey();
    material.customProgramCacheKey = () => `${cacheKey}|residence-screen-occlusion`;
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, { residenceNearAO: active, sampledDepth, depthView, depthProjection });
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform float residenceNearAO;
        uniform sampler2D sampledDepth;
        uniform mat4 depthView;
        uniform mat4 depthProjection;
        float residenceNearOcclusion(vec3 point, vec3 worldNormal) {
          vec3 center = (depthView * vec4(point, 1.0)).xyz;
          vec3 facing = mat3(depthView) * worldNormal;
          vec3 tangent = normalize(cross(facing, abs(facing.z) > 0.8 ? vec3(0, 1, 0) : vec3(0, 0, 1)));
          vec3 bitangent = cross(facing, tangent);
          float occlusion = 0.0;
          for (int i = 0; i < 20; i++) {
            float sampleIndex = float(i);
            float angle = sampleIndex * 2.39996323;
            float reach = mix(0.052, 0.263, (sampleIndex + 0.5) / 20.0);
            vec3 ray = (cos(angle) * tangent + sin(angle) * bitangent) * reach;
            vec3 candidate = center + ray + facing * (0.018 + reach * 0.31);
            vec4 clip = depthProjection * vec4(candidate, 1.0);
            if (clip.w <= 0.0) continue;
            vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
            if (any(lessThan(uv, vec2(0.004))) || any(greaterThan(uv, vec2(0.996)))) continue;
            float z = texture2D(sampledDepth, uv).r;
            if (z >= 0.99998) continue;
            float blockerZ = -depthProjection[3][2] / (2.0 * z - 1.0 + depthProjection[2][2]);
            vec3 toBlocker = candidate * (blockerZ / candidate.z) - center;
            float separation = length(toBlocker);
            float cosine = dot(facing, toBlocker) / max(0.005, separation);
            // Weight the real surface direction and distance. A coplanar tap contributes zero.
            occlusion += smoothstep(0.09, 0.54, cosine) * (1.0 - smoothstep(0.07, 0.29, separation));
          }
          return occlusion / 20.0;
        }`).replace('// Near-surface occlusion is inserted here for high quality.', `
        if (residenceNearAO > 0.5) {
          float localOcclusion = residenceNearOcclusion(vResidenceWorld, surfaceNormal);
          float aboveFloor = 0.35 + 0.65 * smoothstep(0.015, 0.26, vResidenceWorld.y);
          probe.a *= 1.0 - 0.64 * smoothstep(0.05, 0.48, localOcclusion) * aboveFloor;
        }`);
    };
  });

  function capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
    width: number, height: number): void {
    const override = scene.overrideMaterial;
    const states = new Map<THREE.Mesh, boolean>();
    try {
      for (const mesh of transparent) {
        states.set(mesh, mesh.visible);
        mesh.visible = false;
      }
      scene.overrideMaterial = depthMaterial;
      target.setSize(width, height);
      renderer.setRenderTarget(target);
      renderer.state.buffers.depth.setMask(true);
      renderer.render(scene, camera);
      depthView.value.copy(camera.matrixWorldInverse);
      depthProjection.value.copy(camera.projectionMatrix);
    } finally {
      scene.overrideMaterial = override;
      for (const [mesh, visible] of states) mesh.visible = visible;
    }
  }

  return {
    capture,
    setActive(value: boolean) { active.value = Number(value); },
    dispose() {
      target.dispose();
      depthMaterial.dispose();
    },
  };
}
