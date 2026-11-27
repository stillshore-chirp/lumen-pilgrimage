import { Color, Vector4 } from 'three';
import { coastSkyGlsl } from '../coastAtmosphere';
import { coastNoise } from '../coastNoise';
import { coastWaterOptics } from '../coastWaterOptics';
import { LAKE_TERRAIN } from './lakeLayout';

export const lakeWaterShader = {
  name: 'Lake reflection and shallow transmission',
  uniforms: {
    tDiffuse: { value: null },
    color: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uLiveReflection: { value: 0 },
    uWaterDetailLevel: { value: 0 },
    uDepthProfile: { value: new Vector4() },
    uWaterTint: { value: new Color(0x3b6072) },
    uWaterDeep: { value: new Color(0x192d47) },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec3 vLakeSurface;
    varying vec4 vLakeReflection;

    void main() {
      vec4 local = vec4(position, 1.0);
      vLakeSurface = (modelMatrix * local).xyz;
      vLakeReflection = textureMatrix * local;
      gl_Position = projectionMatrix * modelViewMatrix * local;
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform mat4 textureMatrix;
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
        // Retain a haze-softened shore silhouette when no scene texture is available.
        float shoreTravel = (${LAKE_TERRAIN.shoreZ.toFixed(1)} - vLakeSurface.z) / ray.z;
        vec2 shore = (vLakeSurface + shoreTravel * ray).xy;
        float shoreWeight = smoothstep(0.0, 22.0, shoreTravel)
          * (1.0 - smoothstep(4.0, 31.0, shore.y)) * (1.0 - smoothstep(415.0, 480.0, abs(shore.x)));
        vec3 shoreLight = vec3(0.17, 0.23, 0.31) * uCoastSurfaceLight;
        sky = mix(sky, shoreLight, shoreWeight * mix(0.86, 0.48, uCoastNight));

        // Intersect a distant vertical plane to retain parallax in the cloud bank.
        float travel = (${LAKE_TERRAIN.ringZ.toFixed(1)} - vLakeSurface.z) / ray.z;
        vec2 landscape = (vLakeSurface + travel * ray).xy;
        vec2 cloudPoint = (landscape - vec2(uTime * 1.18, 45.0)) * vec2(0.006, 0.021);
        float clouds = smoothstep(0.43, 0.69, coastNoise(cloudPoint) * 0.75
          + coastNoise(cloudPoint * 2.13) * 0.25);
        clouds *= smoothstep(-4.0, 19.0, landscape.y) * (1.0 - smoothstep(94.0, 170.0, landscape.y));

        float radius = length(landscape - vec2(0.0, ${LAKE_TERRAIN.ringCenterY.toFixed(1)}));
        float ring = smoothstep(${(LAKE_TERRAIN.ringRadius - 35).toFixed(1)}, ${(LAKE_TERRAIN.ringRadius - 28).toFixed(1)}, radius)
          * (1.0 - smoothstep(${(LAKE_TERRAIN.ringRadius - 5).toFixed(1)}, ${(LAKE_TERRAIN.ringRadius + 2).toFixed(1)}, radius));
        ring *= smoothstep(12.0, 54.0, landscape.y);
        sky = mix(sky, vec3(0.16, 0.22, 0.29) * uCoastSurfaceLight, ring * 0.47);
        // Soft silhouettes match the primary peaks and the near wooded shores.
        float farStone = max(
          reflectedPeak(ray, vec2(-118.0, -329.0), vec2(21.0, 143.0)),
          reflectedPeak(ray, vec2(287.0, -345.0), vec2(31.0, 183.0)));
        float nearStone = max(
          reflectedPeak(ray, vec2(-48.0, -47.0), vec2(21.0, 74.0)),
          reflectedPeak(ray, vec2(43.0, -48.0), vec2(20.0, 13.0)));
        sky = mix(sky, vec3(0.16, 0.20, 0.24) * uCoastSurfaceLight, farStone * 0.58);
        sky = mix(sky, vec3(0.53, 0.63, 0.73) * uCoastSurfaceLight, clouds * mix(0.47, 0.16, uCoastNight));
        sky = mix(sky, vec3(0.035, 0.063, 0.064) * uCoastSurfaceLight, nearStone * 0.84);
      }
      return sky;
    }

    vec2 rippleGradient(vec2 p) {
      vec2 cell = floor(p), f = fract(p);
      vec2 blend = f * f * f * (f * (6.0 * f - 15.0) + 10.0);
      vec2 derivative = 30.0 * f * f * (f - 1.0) * (f - 1.0);
      float a = coastHash(cell);
      float b = coastHash(cell + vec2(1.0, 0.0));
      float c = coastHash(cell + vec2(0.0, 1.0));
      float d = coastHash(cell + vec2(1.0, 1.0));
      return derivative * vec2(mix(b - a, d - c, blend.y), mix(c - a, d - b, blend.x));
    }

    vec2 rippleBand(vec2 p, mat2 axes, vec2 frequency, vec2 drift, float height) {
      vec2 cells = (axes * p - uTime * drift) * frequency;
      float footprint = max(length(dFdx(cells)), length(dFdy(cells)));
      float weight = height * (1.0 - smoothstep(0.26, 0.83, footprint));
      return transpose(axes) * (rippleGradient(cells) * frequency * weight);
    }

    vec2 rippleSlope(vec2 p) {
      // Advect differently oriented patches of short waves. A patch smaller than a pixel
      // contributes to the filtered reflection instead of drawing a moving stripe.
      const mat2 wind = mat2(0.91, 0.42, -0.42, 0.91);
      const mat2 crosswind = mat2(0.56, -0.83, 0.83, 0.56);
      vec2 slope = rippleBand(p, wind, vec2(0.72, 1.18), vec2(0.28, 0.43), 0.0052)
        + rippleBand(p + 23.1, crosswind, vec2(1.68, 2.47), vec2(-0.23, 0.24), 0.0026);
      if (uWaterDetailLevel > 0.5) {
        slope += rippleBand(p - 41.9, wind, vec2(3.27, 4.72), vec2(0.19, 0.30), 0.0012);
      }
      return slope;
    }

    void main() {
      vec3 toEye = cameraPosition - vLakeSurface;
      float distanceToEye = length(toEye);
      vec3 view = toEye / max(distanceToEye, 0.001);
      vec2 p = vLakeSurface.xz;
      float broad = coastNoise(p * 0.065 + uTime * vec2(0.010, -0.007));
      vec2 slope = rippleSlope(p);
      vec3 normalToAir = normalize(vec3(-slope.x, 1.0, -slope.y));
      float facing = clamp(dot(normalToAir, view), 0.0, 1.0);
      float fresnel = waterFresnel(facing);
      vec3 reflectionRay = reflect(-view, normalToAir);
      float captured = 0.0;
      vec3 reflected = vec3(0.0);
      if (uLiveReflection > 0.5) {
        // Project the change of reflected direction through the mirror camera. This
        // retains the flat reflection's perspective and the camera's lens shift.
        vec3 directionDelta = reflectionRay - vec3(-view.x, view.y, -view.z);
        vec4 samplePoint = vLakeReflection + 2.0 * distanceToEye
          * (textureMatrix * vec4(directionDelta.x, -directionDelta.z, directionDelta.y, 0.0));
        vec2 uv = samplePoint.xy / max(0.001, samplePoint.w);
        vec2 edge = min(uv, 1.0 - uv);
        captured = smoothstep(0.001, 0.018, min(edge.x, edge.y)) * step(0.001, samplePoint.w);
        // Mip filtering gives the unresolved roughness a small reflection footprint.
        reflected = texture2D(tDiffuse, clamp(uv, 0.001, 0.999), 0.45 + 0.62 * (1.0 - facing)).rgb;
      }
      if (captured < 1.0) reflected = mix(directionalReflection(reflectionRay), reflected, captured);

      // Snell's law gives the path through the water column. The opaque pass
      // already has the bed and fish, so one alpha carries their transmitted light.
      float depth = mix(uDepthProfile.z, uDepthProfile.w, smoothstep(uDepthProfile.x, uDepthProfile.y, -p.y));
      float cosineUnderwater = sqrt(1.0 - (1.0 - facing * facing) / (1.333 * 1.333));
      float path = depth / cosineUnderwater;
      const vec3 extinction = vec3(0.30, 0.19, 0.15);
      const vec3 scattering = vec3(0.082, 0.089, 0.092);
      vec3 beam = exp(-extinction * path);
      float transmitted = (1.0 - fresnel) * dot(beam, vec3(0.2126, 0.7152, 0.0722));
      vec3 scatter = (1.0 - fresnel) * scattering / extinction * (1.0 - beam);
      vec3 tint = mix(uWaterTint, uWaterDeep, smoothstep(1.0, 9.0, path)) * uCoastSurfaceLight;
      float glint = waterSunGlint(normalToAir, view, uCoastSunDirection, 0.044 + 0.016 * broad);
      glint *= mix(1.0, uCoastMoonVisible, uCoastNight);
      float alpha = 1.0 - transmitted;
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

      vec3 silt = mix(vec3(0.049, 0.080, 0.103), vec3(0.168, 0.183, 0.178), patches);
      vec3 gravel = mix(vec3(0.043, 0.065, 0.079), vec3(0.36, 0.38, 0.34), pow(seed, 2.3));
      vec3 bed = mix(silt, gravel, pebble * 0.92);

      float wave1 = sin(dot(p, vec2(3.02, 0.89)) - uTime * 0.85);
      float wave2 = cos(dot(p, vec2(-1.14, 3.67)) + uTime * 1.07);
      float caustic = pow(max(0.0, 1.0 - abs(wave1 + wave2 * 0.66)), 5.0);
      caustic *= 1.0 - smoothstep(0.25, 1.3, length(fwidth(p * 3.67)));
      float light = (0.69 + 0.078 * caustic) * exp(0.10 * vBedPosition.y);

      gl_FragColor = vec4(bed * uCoastSurfaceLight * light, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `,
};
