import * as THREE from 'three';
import { LANDSCAPE_BOUNDS, groundHeight, SEA_LEVEL } from '../terrain';
import { coastNoise } from './coastNoise';

function createDepthTexture(): THREE.DataTexture {
  const width = 680;
  const height = 712;
  const depths = new Uint8Array(width * height);
  const { minX, maxX, minZ, maxZ } = LANDSCAPE_BOUNDS;
  for (let row = 0; row < height; row += 1) {
    const z = minZ + (row + 0.5) / height * (maxZ - minZ);
    for (let col = 0; col < width; col += 1) {
      const x = minX + (col + 0.5) / width * (maxX - minX);
      const depth = Math.max(0, Math.min(1, (2 + SEA_LEVEL - groundHeight(x, z)) / 32));
      depths[row * width + col] = Math.round(Math.sqrt(depth) * 255);
    }
  }
  const texture = new THREE.DataTexture(depths, width, height, THREE.RedFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createCoastOceanMaterial(
  time: THREE.IUniform<number>, sun: THREE.Vector3, sand: THREE.Texture
): THREE.ShaderMaterial {
  const { minX, maxX, minZ, maxZ } = LANDSCAPE_BOUNDS;
  return new THREE.ShaderMaterial({
    lights: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      uTime: time,
      uSun: { value: sun },
      uDepth: { value: createDepthTexture() },
      uSand: { value: sand },
      uOffset: { value: new THREE.Vector2(minX, minZ) },
      uSpan: { value: new THREE.Vector2(maxX - minX, maxZ - minZ) },
      uLagoon: { value: new THREE.Color(0x17b4b0) },
      uWater: { value: new THREE.Color(0x1381b0) },
      uDeep: { value: new THREE.Color(0x0a5484) },
      uReflection: { value: new THREE.Color(0x4c97c7) },
      uHorizon: { value: new THREE.Color(0x8cbfdf) },
      uWash: { value: new THREE.Color(0xe9fff7) },
    },
    vertexShader: /* glsl */`
      varying vec3 vSurface;
      #include <common>
      #include <shadowmap_pars_vertex>
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec3 transformedNormal = normalize(normalMatrix * normal);
        vSurface = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        #include <shadowmap_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform sampler2D uDepth, uSand;
      uniform vec2 uOffset, uSpan;
      uniform vec3 uSun, uLagoon, uWater, uDeep, uReflection, uHorizon, uWash;
      varying vec3 vSurface;
      #include <common>
      #include <packing>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>
      ${coastNoise}

      float depthAt(vec2 uv) {
        float value = texture2D(uDepth, uv).r;
        return value * value * 32.0 - 2.0;
      }

      // Two warped cellular layers draw the moving network cast on the sandy bottom.
      float caustic(vec2 p) {
        vec2 q = p + 0.29 * sin(p.yx * 1.91 + uTime * vec2(0.68, -0.51));
        vec3 a = sin(vec3(q.x, 0.49*q.x + 0.87*q.y, 0.49*q.x - 0.87*q.y));
        vec3 b = cos(vec3(q.y, 0.67*q.y - q.x, q.x*1.74 + 0.51*q.y));
        vec3 lines = abs(a + 0.22 * b);
        return pow(1.0 - min(min(lines.x, lines.y), lines.z), 12.0);
      }

      void main() {
        vec2 p = vSurface.xz;
        vec3 toEye = cameraPosition - vSurface;
        float distance = length(toEye);
        vec3 eye = toEye / max(distance, 0.001);
        vec2 uv = (p - uOffset) / uSpan;
        float within = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
        float depth = mix(30.0, depthAt(uv), within);
        float current = coastNoise(p*0.086 + vec2(uTime*0.034, -uTime*0.023));
        float swell = coastNoise(p.yx*0.037 + vec2(0.0, -0.041*uTime));
        float phaseA = dot(p, vec2(0.132, 0.81)) - 0.92*uTime + 6.2*swell;
        float phaseB = dot(p, vec2(1.62, -0.36)) + 1.22*uTime + 4.8*current;
        float phaseC = dot(p, vec2(-0.89, 2.12)) - 1.63*uTime + 9.1*swell;
        float phaseD = dot(p, vec2(0.57, 3.73)) + 2.02*uTime + sin(phaseA)*0.83 + 6.2*current;
        float wave = sin(phaseA)*0.44 + sin(phaseB)*0.25 + sin(phaseC)*0.19 + sin(phaseD)*0.12;
        vec2 slope = vec2(0.132,0.81)*cos(phaseA)*0.096 + vec2(1.62,-0.36)*cos(phaseB)*0.049
          + vec2(-0.89,2.12)*cos(phaseC)*0.031 + vec2(0.57,3.73)*cos(phaseD)*0.019;
        float rippleFade = 1.0 - smoothstep(95.0, 550.0, distance);
        vec3 normal = normalize(vec3(-slope.x*rippleFade, 1.0, -slope.y*rippleFade));
        float bottom = exp(-max(depth, 0.0) * (0.34 + max(0.0, 0.35 - eye.y) * 0.38));
        float sunlit = getShadowMask();
        vec2 refractUv = p + slope * max(depth, 0.0) * 0.45;
        vec3 sand = texture2D(uSand, refractUv * 0.37).rgb;
        float lines = caustic(refractUv * 5.8) * caustic(refractUv.yx*1.8+1.3) * rippleFade;
        vec3 seaBed = sand * vec3(0.75, 1.12, 1.05) + vec3(0.51,0.88,0.72) * lines * 0.13 * sunlit;
        float teal = smoothstep(2.4, 11.7, depth);
        float blue = smoothstep(12.0, 33.0, depth);
        vec3 water = mix(mix(uLagoon, uWater, teal), uDeep, blue);
        water = mix(water, seaBed, bottom * 0.97);
        water *= (0.69 + 0.31*sunlit) * (0.96 + 0.08*swell + rippleFade
          * (0.13*wave + 0.043*cos(phaseC + phaseD + sin(p.x*0.42-p.y*0.77))));
        float fresnel = pow(1.0 - max(dot(normal, eye), 0.0), 5.0);
        vec3 reflected = uReflection * (0.71 + 0.38*smoothstep(-0.1, 0.79, wave));
        water = mix(water, reflected, fresnel * (0.36 + 0.25*blue));

        vec3 halfway = normalize(eye + uSun);
        float specular = pow(max(dot(halfway, normal), 0.0), 95.0);
        float sparkle = smoothstep(0.56, 0.9, cos(phaseD)*(0.09 + current*0.53) + wave*0.67);
        water += uWash * (specular * 1.23 * sunlit + sparkle * 0.056) * rippleFade;

        float shoreNoise = 0.11*sin(p.x*1.27+p.y*0.77) + 0.13*sin(p.y*1.12-p.x*0.36);
        float washDepth = depth + shoreNoise + 0.18*sin(phaseA);
        float crest = 0.45 + 0.19*sin(uTime*1.08 + p.x*0.19 + p.y*0.14);
        float crestLine = 1.0-smoothstep(0.06, 0.20, abs(washDepth-crest));
        float lace = caustic(p*3.25 + slope*1.2);
        float strand = smoothstep(-0.42, 0.41, sin(p.x*0.93 + p.y*0.64 + wave*1.3));
        float shoreFoam = (crestLine * (0.22 + strand*0.44 + sparkle*0.12)
          + lace * 0.36 * (1.0 - smoothstep(0.37, 1.44, washDepth))
          + 0.17 * sparkle * (1.0 - smoothstep(0.1, 1.2, washDepth)))
          * smoothstep(-0.13, 0.12, depth) * within;
        water = mix(water, uWash, clamp(shoreFoam, 0.0, 0.9));

        float horizon = smoothstep(500.0, 2240.0, distance);
        water = mix(water, uHorizon, horizon * 0.87);
        gl_FragColor = vec4(water, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
