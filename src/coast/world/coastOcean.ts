import * as THREE from 'three';
import { COAST_BOUNDS, shoreline } from '../terrain';

const SHORELINE_TEXTURE_WIDTH = 512;
const SHORELINE_HEIGHT_MIN = -80;
const SHORELINE_HEIGHT_MAX = 40;

function createShorelineTexture(): THREE.DataTexture {
  const heights = new Uint8Array(SHORELINE_TEXTURE_WIDTH);
  const spanX = COAST_BOUNDS.maxX - COAST_BOUNDS.minX;
  const spanY = SHORELINE_HEIGHT_MAX - SHORELINE_HEIGHT_MIN;

  for (let index = 0; index < SHORELINE_TEXTURE_WIDTH; index += 1) {
    const x = COAST_BOUNDS.minX + (spanX * index) / (SHORELINE_TEXTURE_WIDTH - 1);
    const encoded = (shoreline(x) - SHORELINE_HEIGHT_MIN) / spanY;
    heights[index] = Math.round(Math.max(0, Math.min(1, encoded)) * 255);
  }

  const texture = new THREE.DataTexture(
    heights,
    SHORELINE_TEXTURE_WIDTH,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Animated shallow-to-deep ocean shading with wave glints and a shoreline-following wash. */
export function createCoastOceanMaterial(
  elapsed: THREE.IUniform<number>,
  sunDirection: THREE.Vector3
): THREE.ShaderMaterial {
  const shorelineTexture = createShorelineTexture();

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: elapsed,
      uSunDirection: { value: sunDirection },
      uShoreline: { value: shorelineTexture },
      uShorelineX: { value: new THREE.Vector2(COAST_BOUNDS.minX, COAST_BOUNDS.maxX) },
      uShorelineY: { value: new THREE.Vector2(SHORELINE_HEIGHT_MIN, SHORELINE_HEIGHT_MAX) },
      uShallowColor: { value: new THREE.Color(0x188f9c) },
      uDeepColor: { value: new THREE.Color(0x0d4976) },
      uSkyColor: { value: new THREE.Color(0x8fc7df) },
      uFoamColor: { value: new THREE.Color(0xf4fff8) },
      uSunColor: { value: new THREE.Color(0xffefc7) },
      uFogColor: { value: new THREE.Color(0xb6d6e5) },
      uFogNear: { value: 230 },
      uFogFar: { value: 590 }
    },
    vertexShader: /* glsl */`
      varying vec3 vWorldPosition;
      varying float vViewDepth;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec4 viewPosition = viewMatrix * worldPosition;
        vWorldPosition = worldPosition.xyz;
        vViewDepth = -viewPosition.z;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform sampler2D uShoreline;
      uniform vec2 uShorelineX;
      uniform vec2 uShorelineY;
      uniform vec3 uShallowColor;
      uniform vec3 uDeepColor;
      uniform vec3 uSkyColor;
      uniform vec3 uFoamColor;
      uniform vec3 uSunColor;
      uniform vec3 uFogColor;
      uniform float uFogNear;
      uniform float uFogFar;
      varying vec3 vWorldPosition;
      varying float vViewDepth;

      void main() {
        vec2 waterPosition = vWorldPosition.xz;

        // Crossed short wave trains create small, uneven ripples and shifting highlights.
        vec2 directionA = normalize(vec2(0.82, 0.57));
        vec2 directionB = normalize(vec2(-0.48, 0.88));
        vec2 directionC = normalize(vec2(0.94, -0.34));
        vec2 directionD = normalize(vec2(-0.91, -0.42));
        vec2 directionE = normalize(vec2(0.31, 0.95));
        float phaseA = dot(waterPosition, directionA) * 0.42 + uTime * 0.72;
        float phaseB = dot(waterPosition, directionB) * 0.79 - uTime * 1.02;
        float phaseC = dot(waterPosition, directionC) * 1.48 + uTime * 1.32;
        float phaseD = dot(waterPosition, directionD) * 2.35 - uTime * 1.52;
        float phaseE = dot(waterPosition, directionE) * 1.92 + uTime * 1.08;
        float waveA = sin(phaseA);
        float waveB = sin(phaseB);
        float waveC = sin(phaseC);
        float waveD = sin(phaseD);
        float waveE = sin(phaseE);
        vec2 waveSlope = directionA * (0.25 * 0.42 * cos(phaseA))
          + directionB * (0.17 * 0.79 * cos(phaseB))
          + directionC * (0.09 * 1.48 * cos(phaseC))
          + directionD * (0.055 * 2.35 * cos(phaseD))
          + directionE * (0.045 * 1.92 * cos(phaseE));
        vec3 normal = normalize(vec3(-waveSlope.x, 1.0, -waveSlope.y));
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 lightDirection = normalize(uSunDirection);
        vec3 halfDirection = normalize(viewDirection + lightDirection);

        float shoreU = clamp(
          (vWorldPosition.x - uShorelineX.x) / (uShorelineX.y - uShorelineX.x),
          0.0,
          1.0
        );
        float shoreZ = texture2D(uShoreline, vec2(shoreU, 0.5)).r
          * (uShorelineY.y - uShorelineY.x) + uShorelineY.x;
        float shoreDistance = shoreZ - vWorldPosition.z;
        float depthBlend = smoothstep(2.0, 55.0, shoreDistance);
        vec3 water = mix(uShallowColor, uDeepColor, depthBlend);
        // The first few meters retain the sand color underneath the water.
        vec3 sandUnderWater = vec3(0.28, 0.35, 0.23);
        water = mix(sandUnderWater, water, smoothstep(-0.4, 5.8, shoreDistance));

        float rippleContrast = waveA * 0.11 + waveB * 0.09 + waveC * 0.075
          + waveD * 0.06 + waveE * 0.045 + waveC * waveD * 0.055;
        water *= 1.0 + rippleContrast;
        water *= 0.82 + 0.21 * max(dot(normal, lightDirection), 0.0);

        float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.0);
        water = mix(water, uSkyColor, fresnel * 0.22);
        float rippleCrests = smoothstep(0.58, 0.93, waveC * 0.37 + waveD * 0.38 + waveE * 0.25);
        water += uSkyColor * rippleCrests * 0.095 * (1.0 - smoothstep(32.0, 120.0, shoreDistance));

        // A tight sun glint sits over broader reflected highlights and shifts with the waves.
        float specular = pow(max(dot(normal, halfDirection), 0.0), 112.0);
        float broadGlint = pow(max(dot(normal, halfDirection), 0.0), 34.0) * 0.09;
        water += uSunColor * (specular * 1.2 + broadGlint);

        // The wash band follows the same shoreline function used to build the land mesh.
        float shoreNoise = 0.32 * waveB + 0.16 * waveD;
        float washDistance = shoreDistance + shoreNoise;
        float surgeCenter = 0.95 + 0.52 * sin(vWorldPosition.x * 0.17 + uTime * 0.48)
          + 0.22 * waveE;
        float laceA = sin(vWorldPosition.x * 0.61 + washDistance * 0.76 + uTime * 0.31);
        float laceB = sin(vWorldPosition.x * 1.47 - washDistance * 0.93 - uTime * 0.52);
        float laceC = sin(vWorldPosition.x * 0.28 + washDistance * 1.34 + uTime * 0.24);
        float laceField = 0.5 + 0.5 * (laceA * laceB * 0.72 + laceC * 0.28);
        float laceMask = smoothstep(0.25, 0.72, laceField);
        float foamBody = 1.0 - smoothstep(0.2, 3.8, washDistance);
        float brokenCrest = 1.0 - smoothstep(0.04, 0.58, abs(washDistance - surgeCenter));
        float foamFilaments = smoothstep(
          0.74,
          0.94,
          0.5 + 0.5 * sin(washDistance * 2.6 + vWorldPosition.x * 0.24 - uTime * 1.2
            + 0.48 * sin(vWorldPosition.x * 0.43 + uTime * 0.36))
        );
        float oceanSide = smoothstep(-0.38, 0.36, shoreDistance);
        float foam = clamp(
          (foamBody * 0.18 * laceMask
            + brokenCrest * (0.13 + 0.50 * laceMask)
            + foamFilaments * foamBody * 0.23 * laceMask) * oceanSide,
          0.0,
          0.76
        );
        water = mix(water, uFoamColor, foam);

        float fog = smoothstep(uFogNear, uFogFar, vViewDepth);
        water = mix(water, uFogColor, fog);
        gl_FragColor = vec4(water, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    toneMapped: true
  });
}
