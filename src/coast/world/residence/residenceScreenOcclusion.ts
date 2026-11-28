import * as THREE from 'three';

const depthHelpers = `
  uniform highp sampler2D sampledDepth;
  uniform mat4 depthInverseProjection;
  vec4 residenceDepthPoint(ivec2 pixel) {
    ivec2 size = textureSize(sampledDepth, 0);
    pixel = clamp(pixel, ivec2(0), size - 1);
    float depth = texelFetch(sampledDepth, pixel, 0).r;
    if (depth >= 0.99998 || depth < 0.0 || isnan(depth) || isinf(depth)) return vec4(0.0);
    vec2 uv = (vec2(pixel) + 0.5) / vec2(size);
    vec4 point = depthInverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    if (abs(point.w) < 0.0000001 || any(isnan(point)) || any(isinf(point))) return vec4(0.0);
    return vec4(point.xyz / point.w, 1.0);
  }
  vec4 residenceDepthAtUV(vec2 uv) {
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return vec4(0.0);
    return residenceDepthPoint(ivec2(uv * vec2(textureSize(sampledDepth, 0))));
  }
  vec3 residenceDecodeNormal(vec3 packedNormal) {
    vec3 normal = packedNormal * 2.0 - 1.0;
    float squared = dot(normal, normal);
    if (squared < 0.0001 || any(isnan(normal)) || any(isinf(normal))) return vec3(0.0);
    return normal * inversesqrt(squared);
  }
`;

// The guide uses two tangent planes so that a sample cannot bleed across either surface.
// Six millimetres is a reconstruction tolerance, not an increased AO bias or radius.
const guideWeight = `
  float residenceGuideWeight(vec3 point, vec3 normal, vec3 otherPoint, vec3 otherNormal, float tolerance) {
    vec3 delta = otherPoint - point;
    float planeDistance = max(abs(dot(normal, delta)), abs(dot(otherNormal, delta)));
    float alignment = dot(normal, otherNormal);
    if (planeDistance > tolerance || alignment < 0.65) return 0.0;
    float normalWeight = pow(alignment, 8.0);
    float planeWeight = exp(-0.5 * pow(planeDistance / 0.006, 2.0));
    return normalWeight * planeWeight * (1.0 - smoothstep(0.03, 0.12, length(delta)));
  }
`;

const vertexShader = `
  precision highp float;
  in vec3 position;
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const aoFragmentShader = `
  precision highp float;
  precision highp int;
  uniform highp sampler2D capturedNormal;
  uniform mat4 depthProjection;
  uniform vec2 imageSize;
  out vec4 fragmentColor;
  ${depthHelpers}
  void main() {
    vec2 uv = gl_FragCoord.xy / imageSize;
    ivec2 pixel = ivec2(uv * vec2(textureSize(sampledDepth, 0)));
    vec4 center = residenceDepthPoint(pixel);
    if (center.w < 0.5) { fragmentColor = vec4(0.5, 0.5, 1.0, 0.0); return; }
    vec3 facing = residenceDecodeNormal(texelFetch(capturedNormal, pixel, 0).rgb);
    if (dot(facing, facing) < 0.5) { fragmentColor = vec4(0.5, 0.5, 1.0, 0.0); return; }
    vec3 tangent = normalize(cross(facing, abs(facing.z) > 0.8 ? vec3(0, 1, 0) : vec3(0, 0, 1)));
    vec3 bitangent = cross(facing, tangent);
    // Each 4x4 neighborhood covers sixteen rotation strata; the guide filter suppresses the short-period residual.
    uvec2 coordinate = uvec2(gl_FragCoord.xy);
    uint rank = ((coordinate.x ^ coordinate.y) & 1u) * 8u + (coordinate.y & 1u) * 4u
      + (((coordinate.x >> 1u) ^ (coordinate.y >> 1u)) & 1u) * 2u + ((coordinate.y >> 1u) & 1u);
    float rotation = float(rank) * (6.28318530718 / 16.0);
    float occlusion = 0.0;
    for (int i = 0; i < 20; i++) {
      float index = float(i);
      float angle = index * 2.39996323 + rotation;
      float reach = mix(0.052, 0.263, (index + 0.5) / 20.0);
      vec3 candidate = center.xyz + (cos(angle) * tangent + sin(angle) * bitangent) * reach
        + facing * (0.018 + reach * 0.31);
      vec4 clip = depthProjection * vec4(candidate, 1.0);
      if (clip.w <= 0.0) continue;
      vec2 sampleUV = clip.xy / clip.w * 0.5 + 0.5;
      if (any(lessThan(sampleUV, vec2(0.004))) || any(greaterThan(sampleUV, vec2(0.996)))) continue;
      vec4 blocker = residenceDepthAtUV(sampleUV);
      if (blocker.w < 0.5) continue;
      vec3 delta = blocker.xyz - center.xyz;
      float separation = length(delta);
      float cosine = dot(facing, delta) / max(0.005, separation);
      occlusion += smoothstep(0.09, 0.54, cosine) * (1.0 - smoothstep(0.07, 0.29, separation));
    }
    fragmentColor = vec4(facing * 0.5 + 0.5, occlusion / 20.0);
  }
`;

const blurFragmentShader = `
  precision highp float;
  precision highp int;
  uniform highp sampler2D inputImage;
  uniform vec2 imageSize;
  uniform ivec2 filterDirection;
  out vec4 fragmentColor;
  ${depthHelpers}
  ${guideWeight}
  void main() {
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    ivec2 size = ivec2(imageSize);
    vec4 center = residenceDepthAtUV((vec2(pixel) + 0.5) / imageSize);
    vec4 middle = texelFetch(inputImage, pixel, 0);
    if (center.w < 0.5) { fragmentColor = vec4(middle.rgb, 0.0); return; }
    vec3 normal = residenceDecodeNormal(middle.rgb);
    float occlusion = 0.0;
    float total = 0.0;
    for (int i = -3; i <= 3; i++) {
      if (i == 0) { occlusion += middle.a; total += 1.0; continue; }
      ivec2 samplePixel = clamp(pixel + filterDirection * i, ivec2(0), size - 1);
      vec4 other = residenceDepthAtUV((vec2(samplePixel) + 0.5) / imageSize);
      if (other.w < 0.5) continue;
      vec4 value = texelFetch(inputImage, samplePixel, 0);
      float weight = exp(-float(i * i) / 4.5)
        * residenceGuideWeight(center.xyz, normal, other.xyz, residenceDecodeNormal(value.rgb), 0.012);
      occlusion += value.a * weight;
      total += weight;
    }
    // Never average the geometry guide during the separable filtering passes.
    fragmentColor = vec4(middle.rgb, total > 0.000001 ? occlusion / total : 0.0);
  }
`;

// Near AO corrects only the existing room irradiance. Direct lighting and reflections keep their own paths.
export function createResidenceScreenOcclusion(...interior: THREE.Group[]) {
  const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  depth.name = 'Interior depth for near-surface occlusion';
  const target = new THREE.WebGLRenderTarget(1, 1, { depthTexture: depth });
  target.texture.name = 'Interior geometric normals for near-surface occlusion';
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.minFilter = target.texture.magFilter = THREE.NearestFilter;
  target.texture.generateMipmaps = false;
  // Reuse the existing depth target's color attachment; no extra geometry pass or float format is needed.
  const captureMaterial = new THREE.MeshNormalMaterial({ flatShading: true, toneMapped: false, blending: THREE.NoBlending });
  captureMaterial.name = 'Residence near occlusion normal and depth';
  const imageTarget = (name: string) => {
    const result = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    result.texture.name = name;
    result.texture.colorSpace = THREE.NoColorSpace;
    result.texture.generateMipmaps = false;
    return result;
  };
  const image = imageTarget('Residence near occlusion and geometric-normal guide');
  const scratch = imageTarget('Residence near occlusion filter scratch');
  const placeholder = new THREE.DataTexture(new Uint8Array([128, 128, 255, 0]), 1, 1);
  placeholder.colorSpace = THREE.NoColorSpace;
  placeholder.needsUpdate = true;
  const active = { value: 0 };
  const sampledDepth = { value: depth };
  const capturedNormal = { value: target.texture };
  const nearImage = { value: placeholder as THREE.Texture };
  const depthView = { value: new THREE.Matrix4() };
  const depthProjection = { value: new THREE.Matrix4() };
  const depthInverseProjection = { value: new THREE.Matrix4() };
  const imageSize = { value: new THREE.Vector2(1, 1) };
  const filterDirection = { value: new THREE.Vector2(1, 0) };
  const inputImage = { value: image.texture };
  const aoMaterial = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader: aoFragmentShader,
    uniforms: { sampledDepth, capturedNormal, depthProjection, depthInverseProjection, imageSize },
    depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
  const blurMaterial = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader: blurFragmentShader,
    uniforms: { sampledDepth, depthInverseProjection, imageSize, filterDirection, inputImage },
    depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.NoBlending });
  aoMaterial.name = 'Residence near occlusion integration';
  blurMaterial.name = 'Residence near occlusion reconstruction';
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const fullScreen = new THREE.Scene();
  const fullScreenCamera = new THREE.Camera();
  const quad = new THREE.Mesh(triangle, aoMaterial);
  quad.frustumCulled = false;
  fullScreen.add(quad);
  const bound = new Set<THREE.Material>();
  const transparent = new Set<THREE.Mesh>();
  const restoreHooks: Array<() => void> = [];
  let valid = false;
  let desiredActive = false;
  let disposed = false;
  let owner: THREE.WebGLRenderer | undefined;
  const capturedSize = new THREE.Vector2();
  const currentSize = new THREE.Vector2();
  const invalidate = () => { valid = false; active.value = 0; };
  const updateActive = () => { active.value = Number(desiredActive && valid && !disposed && !owner?.xr.isPresenting); };

  const releaseLostContextResources = () => {
    invalidate();
    if (!owner?.getContext().isContextLost()) return;
    // Dispose while the context is lost: old renderer closures are detached before a new GPU generation exists.
    target.dispose(); image.dispose(); scratch.dispose(); placeholder.dispose();
    nearImage.value = placeholder;
    placeholder.needsUpdate = true;
  };

  function bindRenderer(renderer: THREE.WebGLRenderer): void {
    if (disposed || owner === renderer) return;
    owner?.domElement.removeEventListener('webglcontextlost', releaseLostContextResources);
    owner?.domElement.removeEventListener('webglcontextrestored', invalidate);
    owner = renderer;
    owner.domElement.addEventListener('webglcontextlost', releaseLostContextResources);
    owner.domElement.addEventListener('webglcontextrestored', invalidate);
    invalidate();
  }

  for (const group of interior) group.traverse(object => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    const material = object.material;
    if (material.transparent) transparent.add(object);
    if (material.transparent || !(material instanceof THREE.MeshStandardMaterial) || bound.has(material)) return;
    bound.add(material);
    const previousCompile = material.onBeforeCompile;
    const previousCache = material.customProgramCacheKey;
    const cacheKey = previousCache.call(material);
    const ownCache = () => `${cacheKey}|residence-screen-occlusion-v3-stratified16`;
    const compile: typeof material.onBeforeCompile = (shader, renderer) => {
      previousCompile.call(material, shader, renderer);
      Object.assign(shader.uniforms, { residenceNearAO: active, residenceNearImage: nearImage, sampledDepth,
        depthView, depthProjection, depthInverseProjection });
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform float residenceNearAO;
        uniform highp sampler2D residenceNearImage;
        uniform mat4 depthView;
        uniform mat4 depthProjection;
        ${depthHelpers}
        ${guideWeight}
        float residenceNearOcclusion(vec3 point, vec3 worldNormal) {
          vec3 center = (depthView * vec4(point, 1.0)).xyz;
          vec3 normal = mat3(depthView) * worldNormal;
          if (dot(normal, normal) < 0.5 || any(isnan(normal)) || any(isinf(normal))) return 0.0;
          normal = normalize(normal);
          vec4 clip = depthProjection * vec4(center, 1.0);
          if (clip.w <= 0.0) return 0.0;
          vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
          if (any(lessThan(uv, vec2(0.0))) || any(greaterThanEqual(uv, vec2(1.0)))) return 0.0;
          // Verify the current receiver against the captured front surface before reusing its AO.
          vec4 receiver = residenceDepthAtUV(uv);
          vec3 receiverDelta = receiver.xyz - center;
          if (receiver.w < 0.5 || abs(dot(normal, receiverDelta)) > 0.006 || length(receiverDelta) > 0.12) return 0.0;
          ivec2 size = textureSize(residenceNearImage, 0);
          vec2 coordinate = uv * vec2(size) - 0.5;
          ivec2 base = ivec2(floor(coordinate));
          vec2 part = fract(coordinate);
          float occlusion = 0.0;
          float total = 0.0;
          for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
            ivec2 pixel = clamp(base + ivec2(x, y), ivec2(0), size - 1);
            vec4 other = residenceDepthAtUV((vec2(pixel) + 0.5) / vec2(size));
            if (other.w < 0.5) continue;
            vec4 value = texelFetch(residenceNearImage, pixel, 0);
            float spatial = (x == 0 ? 1.0 - part.x : part.x) * (y == 0 ? 1.0 - part.y : part.y);
            float weight = spatial * residenceGuideWeight(center, normal, other.xyz, residenceDecodeNormal(value.rgb), 0.006);
            occlusion += value.a * weight;
            total += weight;
          }
          return total > 0.000001 ? occlusion / total : 0.0;
        }`).replace('// Near-surface occlusion is inserted here for high quality.', `
        if (residenceNearAO > 0.5) {
          float localOcclusion = residenceNearOcclusion(vResidenceWorld, surfaceNormal);
          float aboveFloor = 0.35 + 0.65 * smoothstep(0.015, 0.26, vResidenceWorld.y);
          probe.a *= 1.0 - 0.64 * smoothstep(0.05, 0.48, localOcclusion) * aboveFloor;
        }`);
    };
    material.onBeforeCompile = compile;
    material.customProgramCacheKey = ownCache;
    material.needsUpdate = true;
    restoreHooks.push(() => {
      if (material.onBeforeCompile === compile) material.onBeforeCompile = previousCompile;
      if (material.customProgramCacheKey === ownCache) material.customProgramCacheKey = previousCache;
      material.needsUpdate = true;
    });
  });

  function capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
    width: number, height: number): void {
    bindRenderer(renderer);
    if (disposed || renderer.xr.isPresenting || renderer.getContext().isContextLost()) { invalidate(); return; }
    invalidate();
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const viewport = renderer.getViewport(new THREE.Vector4());
    const scissor = renderer.getScissor(new THREE.Vector4());
    const scissorTest = renderer.getScissorTest();
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    const xrEnabled = renderer.xr.enabled;
    const autoShadow = renderer.shadowMap.autoUpdate;
    const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    const override = scene.overrideMaterial;
    const states = new Map<THREE.Mesh, boolean>();
    let captured = false;
    const context = renderer.getContext();
    const depthMask = context.getParameter(context.DEPTH_WRITEMASK) as boolean;
    const depthClear = context.getParameter(context.DEPTH_CLEAR_VALUE) as number;
    const colorMask = context.getParameter(context.COLOR_WRITEMASK) as boolean[];
    try {
      for (const mesh of transparent) { states.set(mesh, mesh.visible); mesh.visible = false; }
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.autoClear = false;
      renderer.setClearColor(0, 0);
      renderer.getDrawingBufferSize(currentSize);
      target.setSize(width, height);
      const imageWidth = Math.min(width, Math.max(1, Math.floor(currentSize.x * 0.5)));
      const imageHeight = Math.min(height, Math.max(1, Math.floor(currentSize.y * 0.5)));
      image.setSize(imageWidth, imageHeight);
      scratch.setSize(imageWidth, imageHeight);
      imageSize.value.set(imageWidth, imageHeight);
      depthView.value.copy(camera.matrixWorldInverse);
      depthProjection.value.copy(camera.projectionMatrix);
      depthInverseProjection.value.copy(camera.projectionMatrixInverse);
      scene.overrideMaterial = captureMaterial;
      renderer.setRenderTarget(target);
      renderer.state.buffers.color.setMask(true);
      renderer.state.buffers.depth.setMask(true);
      renderer.state.buffers.depth.setClear(1);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      // Target-owned viewport/scissor use drawing pixels; setViewport would apply DPR a second time.
      quad.material = aoMaterial;
      renderer.setRenderTarget(image);
      renderer.render(fullScreen, fullScreenCamera);
      quad.material = blurMaterial;
      inputImage.value = image.texture;
      filterDirection.value.set(1, 0);
      renderer.setRenderTarget(scratch);
      renderer.render(fullScreen, fullScreenCamera);
      inputImage.value = scratch.texture;
      filterDirection.value.set(0, 1);
      renderer.setRenderTarget(image);
      renderer.render(fullScreen, fullScreenCamera);
      captured = !context.isContextLost();
    } finally {
      scene.overrideMaterial = override;
      for (const [mesh, visible] of states) mesh.visible = visible;
      if (colorMask.every(value => value === colorMask[0])) renderer.state.buffers.color.setMask(colorMask[0]);
      else {
        // A caller using per-channel masks must not leave Three's uniform-mask cache stale.
        renderer.state.buffers.color.reset();
        context.colorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3]);
      }
      renderer.xr.enabled = xrEnabled;
      renderer.shadowMap.autoUpdate = autoShadow;
      renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
      renderer.autoClear = autoClear;
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.state.buffers.depth.setClear(depthClear);
      renderer.state.buffers.depth.setMask(depthMask);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
    }
    if (captured) {
      nearImage.value = image.texture;
      capturedSize.copy(currentSize);
      valid = true;
      updateActive();
    }
  }

  return {
    capture,
    bindRenderer,
    // The caller checks high quality, desktop and the residence height limit before consulting this flag.
    needsCapture(renderer: THREE.WebGLRenderer, eligible: boolean): boolean {
      if (!eligible || disposed) return false;
      if (renderer.xr.isPresenting) { active.value = 0; return false; }
      if (renderer.getContext().isContextLost()) { invalidate(); return false; }
      renderer.getDrawingBufferSize(currentSize);
      if (!currentSize.equals(capturedSize)) invalidate();
      return !valid;
    },
    setActive(value: boolean) { desiredActive = value; updateActive(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
      owner?.domElement.removeEventListener('webglcontextlost', releaseLostContextResources);
      owner?.domElement.removeEventListener('webglcontextrestored', invalidate);
      for (const restore of restoreHooks) restore();
      target.dispose(); image.dispose(); scratch.dispose(); placeholder.dispose();
      captureMaterial.dispose(); aoMaterial.dispose(); blurMaterial.dispose(); triangle.dispose();
      fullScreen.clear(); transparent.clear(); bound.clear();
    },
  };
}
