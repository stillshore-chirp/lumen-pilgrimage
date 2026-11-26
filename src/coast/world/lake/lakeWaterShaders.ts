import { Color, UniformsLib, Vector4 } from 'three';
import { coastSkyGlsl } from '../coastAtmosphere';
import { coastNoise } from '../coastNoise';
import { coastWaterOptics } from '../coastWaterOptics';
import { LAKE_TERRAIN } from './lakeLayout';

export const lakeWaterShader = {
  name: 'Lake reflection and shallow transmission',
  uniforms: {
    ...UniformsLib.fog,
    tDiffuse: { value: null },
    color: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uLiveReflection: { value: 0 },
    uWaterDetailLevel: { value: 0 },
    uDepthProfile: { value: new Vector4() },
    uWaterTint: { value: new Color(0x386967) },
    uWaterDeep: { value: new Color(0x1d3946) },
  },
  vertexShader: /* glsl */`
    #include <fog_pars_vertex>
    uniform mat4 textureMatrix;
    varying vec3 vLakeSurface;
    varying vec4 vLakeReflection;

    void main() {
      vec4 local = vec4(position, 1.0);
      vLakeSurface = (modelMatrix * local).xyz;
      vLakeReflection = textureMatrix * local;
      vec4 mvPosition = modelViewMatrix * local;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: /* glsl */`
    #include <fog_pars_fragment>
    uniform sampler2D tDiffuse;
    uniform float uTime, uLiveReflection, uWaterDetailLevel;
    uniform vec4 uDepthProfile;
    uniform vec3 uWaterTint, uWaterDeep;
    varying vec3 vLakeSurface;
    varying vec4 vLakeReflection;
    ${coastNoise}
    ${coastWaterOptics}
    ${coastSkyGlsl}

    float reflectedPeak(vec3 ray, vec2 center, vec2 dimensions) {
      float travel = (center.y - vLakeSurface.z) / ray.z;
      vec3 hit = vLakeSurface + travel * ray;
      float x = abs(hit.x - center.x) / dimensions.x;
      float brokenCrown = dimensions.y * (0.79 + 0.21 * cos(min(x, 1.0) * 1.7));
      brokenCrown *= 0.88 + 0.12 * coastNoise(vec2(hit.x * 0.23, center.x));
      float outline = (1.0 - smoothstep(0.72, 1.0, x))
        * (1.0 - smoothstep(brokenCrown * 0.87, brokenCrown, hit.y));
      return outline * smoothstep(0.0, 4.0, travel);
    }

    vec3 directionalReflection(vec3 ray) {
      vec3 sky = coastSkyRadiance(normalize(vec3(ray.x, max(0.015, ray.y), ray.z)));
      if (ray.z < -0.08) {
        // Intersect a distant vertical plane to retain parallax in the sky approximation.
        float travel = (${LAKE_TERRAIN.ringZ.toFixed(1)} - vLakeSurface.z) / ray.z;
        vec2 landscape = (vLakeSurface + travel * ray).xy;
        vec2 cloudPoint = (landscape - vec2(uTime * 1.18, 45.0)) * vec2(0.006, 0.021);
        float clouds = smoothstep(0.43, 0.69, coastNoise(cloudPoint) * 0.75
          + coastNoise(cloudPoint * 2.13) * 0.25);
        clouds *= smoothstep(-4.0, 19.0, landscape.y) * (1.0 - smoothstep(94.0, 170.0, landscape.y));
        sky = mix(sky, vec3(0.70, 0.77, 0.84) * uCoastSurfaceLight, clouds * mix(0.62, 0.19, uCoastNight));

        float radius = length(landscape - vec2(0.0, ${LAKE_TERRAIN.ringCenterY.toFixed(1)}));
        float ring = smoothstep(${(LAKE_TERRAIN.ringRadius - 35).toFixed(1)}, ${(LAKE_TERRAIN.ringRadius - 28).toFixed(1)}, radius)
          * (1.0 - smoothstep(${(LAKE_TERRAIN.ringRadius - 5).toFixed(1)}, ${(LAKE_TERRAIN.ringRadius + 2).toFixed(1)}, radius));
        ring *= smoothstep(9.0, 49.0, landscape.y);
        sky = mix(sky, vec3(0.19, 0.25, 0.31) * uCoastSurfaceLight, ring * 0.69);
        // Soft silhouettes match the primary peaks and the near wooded shores.
        float farStone = max(
          reflectedPeak(ray, vec2(-118.0, -329.0), vec2(21.0, 143.0)),
          reflectedPeak(ray, vec2(287.0, -345.0), vec2(31.0, 183.0)));
        float nearStone = max(
          reflectedPeak(ray, vec2(-47.0, -53.0), vec2(17.0, 68.0)),
          reflectedPeak(ray, vec2(47.0, -54.0), vec2(19.0, 13.0)));
        sky = mix(sky, vec3(0.16, 0.20, 0.24) * uCoastSurfaceLight, farStone * 0.58);
        sky = mix(sky, vec3(0.035, 0.063, 0.064) * uCoastSurfaceLight, nearStone * 0.84);
      }
      return sky;
    }

    float ripple(float phase) {
      return cos(phase) * (1.0 - smoothstep(0.65, 3.0, fwidth(phase)));
    }

    vec2 rippleSlope(vec2 p) {
      vec2 first = vec2(1.77, 0.61);
      vec2 second = vec2(-1.13, 1.30);
      vec2 phaseDrift = vec2(coastNoise(p * 0.24), coastNoise(p * 0.31 + 5.8));
      vec2 slope = first * (0.0072 * ripple(dot(p, first) - uTime * 1.17 + phaseDrift.x * 5.6))
        + second * (0.0064 * ripple(dot(p, second) + uTime * 1.05 + phaseDrift.y * 4.9));
      if (uWaterDetailLevel > 0.5) {
        vec2 third = vec2(2.75, -1.88);
        slope += third * (0.0023 * ripple(dot(p, third) - uTime * 1.73 + phaseDrift.x * 4.2));
      }
      return slope;
    }

    void main() {
      vec3 toEye = cameraPosition - vLakeSurface;
      float distanceToEye = length(toEye);
      vec3 view = toEye / max(distanceToEye, 0.001);
      vec2 p = vLakeSurface.xz;
      float broad = coastNoise(p * 0.065 + uTime * vec2(0.010, -0.007));
      vec2 slope = rippleSlope(p) * (1.0 - 0.44 * smoothstep(70.0, 290.0, distanceToEye));
      vec3 normalToAir = normalize(vec3(-slope.x, 1.0, -slope.y));
      float facing = clamp(dot(normalToAir, view), 0.0, 1.0);
      float fresnel = waterFresnel(facing);
      vec3 reflectionRay = reflect(-view, normalToAir);
      float captured = 0.0;
      vec2 reflectionUv = vec2(0.0);
      if (uLiveReflection > 0.5 && vLakeReflection.w > 0.0) {
        reflectionUv = vLakeReflection.xy / vLakeReflection.w;
        reflectionUv += slope * vec2(0.20, 0.19) * (0.45 + 0.55 * facing);
        vec2 edge = min(reflectionUv, 1.0 - reflectionUv);
        captured = smoothstep(0.002, 0.033, min(edge.x, edge.y));
      }
      vec3 reflected = vec3(0.0);
      if (captured < 1.0) reflected = directionalReflection(reflectionRay) * (1.0 - captured);
      if (captured > 0.0) {
        // The low central sight line reflects the distant basin. A vertical
        // spread softens it while the much nearer wooded banks retain contrast.
        float openBasin = smoothstep(0.55, 0.93, -reflectionRay.z)
          * (1.0 - smoothstep(0.23, 0.45, reflectionRay.y)) * (1.0 - uCoastNight);
        float filmBlur = 0.72 + 0.55 * (1.0 - facing) + 0.65 * openBasin;
        vec3 mirror = texture2D(tDiffuse, reflectionUv, filmBlur).rgb;
        if (openBasin > 0.02) {
          vec2 spread = vec2(0.0, 0.038 * openBasin);
          vec3 above = texture2D(tDiffuse, clamp(reflectionUv + spread, 0.001, 0.999), filmBlur).rgb;
          vec3 below = texture2D(tDiffuse, clamp(reflectionUv - spread, 0.001, 0.999), filmBlur).rgb;
          mirror = mix(mirror, (above + below) * 0.5, openBasin * 0.66);
          mirror = mix(mirror, vec3(0.145, 0.192, 0.25), openBasin * 0.54);
        }
        reflected += mirror * captured;
      }

      // The opaque pass already holds the bed and fish. Use the transmitted fraction
      // as the destination weight and put reflection plus in-scattering in the source.
      float depth = mix(uDepthProfile.z, uDepthProfile.w, smoothstep(uDepthProfile.x, uDepthProfile.y, -p.y));
      float cosineUnderwater = sqrt(1.0 - (1.0 - facing * facing) / (1.333 * 1.333));
      float path = depth / cosineUnderwater;
      float scatter = (1.0 - exp(-0.40 * path)) * (1.0 - fresnel);
      vec3 tint = mix(uWaterTint, uWaterDeep, smoothstep(1.0, 9.0, path)) * uCoastSurfaceLight;
      tint *= 0.93 + 0.08 * broad;
      float glint = waterSunGlint(normalToAir, view, uCoastSunDirection, 0.055 + 0.025 * broad);
      float alpha = fresnel + scatter;
      vec3 result = (reflected * fresnel + tint * scatter + uCoastSolarColor * glint * 0.54) / max(alpha, 0.02);

      if (!gl_FrontFacing) {
        vec3 throughWater;
        float transmission = waterTransmission(-view, normalToAir, throughWater);
        vec3 undersideSky = coastSkyRadiance(throughWater) + coastSunRadiance(throughWater);
        result = mix(uWaterDeep * uCoastSurfaceLight, undersideSky * vec3(0.66, 0.89, 0.86), transmission);
        alpha = 1.0;
      }

      gl_FragColor = vec4(result, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `,
};

export const lakeBedShader = {
  name: 'Submerged lake gravel and silt',
  vertexShader: /* glsl */`
    #include <fog_pars_vertex>
    varying vec3 vBedPosition;

    void main() {
      vBedPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: /* glsl */`
    #include <fog_pars_fragment>
    uniform float uTime;
    uniform vec3 uCoastSurfaceLight;
    varying vec3 vBedPosition;
    ${coastNoise}

    void main() {
      vec2 p = vBedPosition.xz;
      float patches = coastNoise(p * 0.73) * 0.72 + coastNoise(p * 2.21) * 0.28;
      vec2 drift = vec2(coastNoise(p * 1.7), coastNoise(p * 1.7 + 22.9)) - 0.5;
      vec2 grid = (p + drift * 0.47) * vec2(4.3, 5.8);
      vec2 stone = fract(grid) - 0.5;
      float seed = coastHash(floor(grid));
      vec2 variation = fract(seed * vec2(4.68, 7.71));
      stone += (variation - 0.5) * 0.54;
      float radius = mix(0.18, 0.34, variation.x);
      float pebble = 1.0 - smoothstep(radius * 0.64, radius, length(stone * vec2(1.02, 1.32)));
      pebble *= smoothstep(0.26, 0.69, patches) * smoothstep(0.13, 0.32, seed);
      pebble *= 1.0 - smoothstep(0.24, 1.1, length(fwidth(grid)));

      vec3 silt = mix(vec3(0.084, 0.106, 0.081), vec3(0.23, 0.24, 0.177), patches);
      vec3 gravel = mix(vec3(0.058, 0.083, 0.079), vec3(0.30, 0.29, 0.21), seed);
      vec3 bed = mix(silt, gravel, pebble * 0.78);

      float wave1 = sin(dot(p, vec2(3.02, 0.89)) - uTime * 0.85);
      float wave2 = cos(dot(p, vec2(-1.14, 3.67)) + uTime * 1.07);
      float caustic = pow(max(0.0, 1.0 - abs(wave1 + wave2 * 0.66)), 5.0);
      caustic *= 1.0 - smoothstep(0.25, 1.3, length(fwidth(p * 3.67)));
      float light = (0.69 + 0.12 * caustic) * exp(0.10 * vBedPosition.y);

      gl_FragColor = vec4(bed * uCoastSurfaceLight * light, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `,
};
