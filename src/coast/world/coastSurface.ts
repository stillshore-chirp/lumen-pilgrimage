import * as THREE from 'three';

const SURFACE_SHADER_KEY = 'coast-surface-detail-v2';
const BASE_URL = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

const rockMapUniform: THREE.IUniform<THREE.Texture> = { value: new THREE.Texture() };
const sandMapUniform: THREE.IUniform<THREE.Texture> = { value: new THREE.Texture() };
const rockMapReadyUniform: THREE.IUniform<number> = { value: 0 };
const sandMapReadyUniform: THREE.IUniform<number> = { value: 0 };
let surfaceMapsRequested = false;

const NOISE_GLSL = /* glsl */`
  uniform sampler2D uCoastRockMap;
  uniform sampler2D uCoastSandMap;
  uniform float uCoastRockMapReady;
  uniform float uCoastSandMapReady;
  varying vec3 vCoastWorldPosition;
  varying vec3 vCoastWorldNormal;
  varying vec3 vCoastBaseColor;

  float coastHash(vec2 p) {
    p = fract(p * vec2(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
  }

  float coastNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 local = fract(p);
    local = local * local * (3.0 - 2.0 * local);
    float a = coastHash(cell);
    float b = coastHash(cell + vec2(1.0, 0.0));
    float c = coastHash(cell + vec2(0.0, 1.0));
    float d = coastHash(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
  }

  vec3 coastSampleRock(vec3 position, vec3 normal, float scale) {
    vec3 weights = pow(abs(normalize(normal)), vec3(4.0));
    weights /= max(weights.x + weights.y + weights.z, 0.0001);
    vec3 alongX = texture2D(uCoastRockMap, position.zy * scale).rgb;
    vec3 alongY = texture2D(uCoastRockMap, position.xz * scale).rgb;
    vec3 alongZ = texture2D(uCoastRockMap, position.xy * scale).rgb;
    return alongX * weights.x + alongY * weights.y + alongZ * weights.z;
  }
`;

function configureRepeatTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
}

function requestSurfaceMaps(): void {
  if (surfaceMapsRequested) return;
  surfaceMapsRequested = true;
  const loader = new THREE.TextureLoader();

  const rockTexture = loader.load(
    `${BASE_URL}coast-materials/rock.webp`,
    (loaded) => {
      configureRepeatTexture(loaded);
      loaded.needsUpdate = true;
      rockMapReadyUniform.value = 1;
    },
    undefined,
    () => { rockMapReadyUniform.value = 0; }
  );
  configureRepeatTexture(rockTexture);
  rockMapUniform.value = rockTexture;

  const sandTexture = loader.load(
    `${BASE_URL}coast-materials/sand.webp`,
    (loaded) => {
      configureRepeatTexture(loaded);
      loaded.needsUpdate = true;
      sandMapReadyUniform.value = 1;
    },
    undefined,
    () => { sandMapReadyUniform.value = 0; }
  );
  configureRepeatTexture(sandTexture);
  sandMapUniform.value = sandTexture;
}

function replaceShaderChunk(source: string, needle: string, replacement: string): string {
  const index = source.indexOf(needle);
  if (index === -1) {
    throw new Error(`Coast surface shader could not find ${needle.trim()}`);
  }
  return source.slice(0, index) + replacement + source.slice(index + needle.length);
}

/** Adds restrained, world-space terrain variation to the existing vertex colors. */
export function addCoastSurfaceDetail(material: THREE.MeshStandardMaterial, detailed: boolean): void {
  requestSurfaceMaps();
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  const fineGroundWeight = detailed ? 0.105 : 0.035;
  const rockDetailWeight = detailed ? 1.0 : 0.68;
  const rockMapScale = detailed ? 0.12 : 0.10;
  const sandMapScale = detailed ? 0.14 : 0.12;
  const bumpStrength = detailed ? 0.68 : 0.88;
  const bumpFadeEnd = detailed ? 210 : 165;

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);

    shader.vertexShader = replaceShaderChunk(
      shader.vertexShader,
      '#include <common>',
      `#include <common>\n      varying vec3 vCoastWorldPosition;\n      varying vec3 vCoastWorldNormal;\n      varying vec3 vCoastBaseColor;`
    );
    shader.vertexShader = replaceShaderChunk(
      shader.vertexShader,
      '#include <color_vertex>',
      `#include <color_vertex>\n      vCoastBaseColor = color;`
    );
    shader.vertexShader = replaceShaderChunk(
      shader.vertexShader,
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>\n      vCoastWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`
    );
    shader.vertexShader = replaceShaderChunk(
      shader.vertexShader,
      '#include <begin_vertex>',
      `#include <begin_vertex>\n      vCoastWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );

    shader.fragmentShader = replaceShaderChunk(
      shader.fragmentShader,
      '#include <common>',
      `#include <common>\n${NOISE_GLSL}`
    );
    shader.fragmentShader = replaceShaderChunk(
      shader.fragmentShader,
      '#include <color_fragment>',
      `#include <color_fragment>
      vec2 coastGround = vCoastWorldPosition.xz;
      float coastMeadow = smoothstep(0.018, 0.075, vCoastBaseColor.g - max(vCoastBaseColor.r, vCoastBaseColor.b));
      float coastSand = smoothstep(0.045, 0.20, vCoastBaseColor.r - vCoastBaseColor.g) * (1.0 - coastMeadow);
      float coastCliffFace = smoothstep(0.17, 0.58, 1.0 - abs(normalize(vCoastWorldNormal).y));
      float coastRockShelf = smoothstep(4.0, 8.0, vCoastWorldPosition.y);
      float coastRock = clamp(1.0 - coastMeadow - coastSand, 0.0, 1.0) * max(coastCliffFace, coastRockShelf);
      float coastRockPhotoLuma = 0.0;

      float coastBroad = coastNoise(coastGround * 0.052 + vec2(7.2, 3.8));
      float coastPatch = coastNoise(coastGround * 0.17 + vec2(2.4, 9.1));
      float coastGrain = coastNoise(coastGround * 0.82 + vec2(13.1, 5.7));
      float coastGrassTone = (coastBroad - 0.5) * 0.20 + (coastPatch - 0.5) * 0.11;
      float coastSandTone = (coastPatch - 0.5) * 0.12 + (coastGrain - 0.5) * ${fineGroundWeight.toFixed(3)};
      vec3 coastGroundTint = vec3(1.0 + coastGrassTone * 0.88, 1.0 + coastGrassTone, 1.0 + coastGrassTone * 0.72);
      vec3 coastSandTint = vec3(1.0 + coastSandTone * 0.72, 1.0 + coastSandTone * 0.48, 1.0 + coastSandTone * 0.20);

      vec2 coastRockCoord = vec2(vCoastWorldPosition.x + vCoastWorldPosition.z * 0.38,
        vCoastWorldPosition.y + vCoastWorldPosition.z * 0.10);
      float coastRockBroad = coastNoise(coastRockCoord * 0.045 + vec2(4.3, 8.6));
      float coastRockGrain = coastNoise(coastRockCoord * 0.76 + vec2(11.8, 2.1));
      float coastCrackField = coastNoise(coastRockCoord * 0.22 + vec2(3.5, 7.1));
      float coastCrackRidge = 1.0 - abs(coastCrackField * 2.0 - 1.0);
      float coastFissure = 1.0 - smoothstep(0.075, 0.16, coastCrackRidge);
      float coastStrata = sin((vCoastWorldPosition.y + vCoastWorldPosition.x * 0.15
        + vCoastWorldPosition.z * 0.055) * 1.15 + (coastRockBroad - 0.5) * 3.2);
      float coastRockTone = (coastRockBroad - 0.5) * 0.14
        + (coastRockGrain - 0.5) * 0.08 * ${rockDetailWeight.toFixed(2)}
        + coastStrata * 0.045 * ${rockDetailWeight.toFixed(2)}
        - coastFissure * 0.075 * ${rockDetailWeight.toFixed(2)};
      vec3 coastRockTint = vec3(1.0 + coastRockTone, 1.0 + coastRockTone * 0.96, 1.0 + coastRockTone * 0.88);

      diffuseColor.rgb *= mix(vec3(1.0), coastGroundTint, coastMeadow);
      diffuseColor.rgb *= mix(vec3(1.0), coastSandTint, coastSand);
      diffuseColor.rgb *= mix(vec3(1.0), coastRockTint, coastRock);

      if (uCoastRockMapReady > 0.5 && coastRock > 0.01) {
        vec3 rockPhoto = coastSampleRock(vCoastWorldPosition, vCoastWorldNormal, ${rockMapScale.toFixed(2)});
        coastRockPhotoLuma = dot(rockPhoto, vec3(0.2126, 0.7152, 0.0722));
        vec3 texturedRock = diffuseColor.rgb * 0.45 + rockPhoto * 0.66;
        diffuseColor.rgb = mix(diffuseColor.rgb, texturedRock, coastRock);

        float coastMossField = coastNoise(coastGround * 0.082 + vec2(14.7, 6.1)) * 0.68
          + coastNoise(coastGround * 0.29 + vec2(4.2, 11.5)) * 0.32;
        float coastMossPatch = smoothstep(0.54, 0.68, coastMossField);
        float coastGentleCap = smoothstep(0.28, 0.76, abs(vCoastWorldNormal.y));
        float coastLowShelf = smoothstep(1.5, 2.5, vCoastWorldPosition.y)
          * (1.0 - smoothstep(7.0, 9.0, vCoastWorldPosition.y));
        float coastHighCap = smoothstep(12.0, 16.0, vCoastWorldPosition.y)
          * (1.0 - smoothstep(34.0, 40.0, vCoastWorldPosition.y));
        float coastLeftRange = smoothstep(-70.0, -63.0, vCoastWorldPosition.x)
          * (1.0 - smoothstep(-32.0, -25.0, vCoastWorldPosition.x));
        float coastLeftShelfZ = smoothstep(-60.0, -50.0, vCoastWorldPosition.z)
          * (1.0 - smoothstep(-7.0, 1.0, vCoastWorldPosition.z));
        float coastRightRange = smoothstep(4.0, 9.0, vCoastWorldPosition.x)
          * (1.0 - smoothstep(32.0, 38.0, vCoastWorldPosition.x));
        float coastPoolZ = smoothstep(-34.0, -28.0, vCoastWorldPosition.z)
          * (1.0 - smoothstep(-10.0, -4.0, vCoastWorldPosition.z));
        float coastMossZone = max(coastLeftRange * max(coastLowShelf * coastLeftShelfZ, coastHighCap),
          coastRightRange * coastPoolZ * coastLowShelf);
        float coastMoss = coastRock * coastGentleCap * coastMossZone * coastMossPatch * 0.72;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.48, 0.68, 0.54), coastMoss);
      }
      if (uCoastSandMapReady > 0.5 && coastSand > 0.01) {
        vec3 sandPhoto = texture2D(uCoastSandMap, coastGround * ${sandMapScale.toFixed(2)}).rgb;
        vec3 texturedSand = diffuseColor.rgb * 0.56 + sandPhoto * 1.15;
        diffuseColor.rgb = mix(diffuseColor.rgb, texturedSand, coastSand);
      }`
    );
    shader.fragmentShader = replaceShaderChunk(
      shader.fragmentShader,
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      vec3 coastBumpPositionDx = dFdx(-vViewPosition);
      vec3 coastBumpPositionDy = dFdy(-vViewPosition);
      float coastBumpHeightDx = dFdx(coastRockPhotoLuma);
      float coastBumpHeightDy = dFdy(coastRockPhotoLuma);
      float coastBumpFade = 1.0 - smoothstep(45.0, ${bumpFadeEnd.toFixed(1)}, length(vViewPosition));
      if (uCoastRockMapReady > 0.5 && coastRock > 0.05 && coastBumpFade > 0.0) {
        vec3 coastBumpNormal = normalize(normal);
        vec3 coastR1 = cross(coastBumpPositionDy, coastBumpNormal);
        vec3 coastR2 = cross(coastBumpNormal, coastBumpPositionDx);
        float coastDet = dot(coastBumpPositionDx, coastR1);
        float coastDetSign = coastDet < 0.0 ? -1.0 : 1.0;
        vec3 coastGradient = coastDetSign * (coastBumpHeightDx * coastR1 + coastBumpHeightDy * coastR2);
        normal = normalize(abs(coastDet) * coastBumpNormal
          - coastGradient * ${bumpStrength.toFixed(2)} * coastRock * coastBumpFade);
      }`
    );
    shader.uniforms['uCoastRockMap'] = rockMapUniform;
    shader.uniforms['uCoastSandMap'] = sandMapUniform;
    shader.uniforms['uCoastRockMapReady'] = rockMapReadyUniform;
    shader.uniforms['uCoastSandMapReady'] = sandMapReadyUniform;
  };

  material.customProgramCacheKey = () => `${previousCacheKey.call(material)}|${SURFACE_SHADER_KEY}|${detailed ? 'normal' : 'low'}|${rockMapScale}-${sandMapScale}`;
  material.needsUpdate = true;
}
