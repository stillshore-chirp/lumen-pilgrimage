import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { CoastQuality } from '../CoastWorld';
import { coastRandom, groundHeight, SEA_LEVEL } from '../terrain';
import { bindCoastSky, coastSkyGlsl, type CoastAtmosphere } from './coastAtmosphere';
import { coastNoise } from './coastNoise';
import { coastSwellGLSL } from './coastSwell';
import { coastWaterOptics, SEA_WATER_SCATTER } from './coastWaterOptics';

// The sea shader only needs the coastal strip, at a higher sampling density than the uplands.
const OCEAN_BATHYMETRY = { minX: -574, maxX: 574, minZ: -817, maxZ: 695 };

function createCoastOceanGeometry(): THREE.BufferGeometry {
  // Denser triangles at the beach carry the breaking lip. Open water stays a flat extension.
  const xs = [-2445, -575, -315];
  const zs = [-2580, -818];
  for (let x = -315; x < 315;) {
    x = Math.min(315, x + (x >= -100 && x < 100 ? 1.6 : 4.8));
    xs.push(x);
  }
  xs.push(575, 2445);
  for (let z = -818; z < 142;) {
    const step = z >= 32 && z < 88 ? 1.25 : z >= -132 ? 3.0 : z >= -410 ? 7.0 : 16;
    z = Math.min(142, z + step);
    zs.push(z);
  }
  zs.push(384, 2120);

  const positions = new Float32Array(xs.length * zs.length * 3);
  const indices = new Uint16Array((xs.length - 1) * (zs.length - 1) * 6);
  let vertex = 0;
  for (const z of zs) {
    for (const x of xs) {
      positions[vertex++] = x;
      positions[vertex++] = -z - 230;
      positions[vertex++] = 0;
    }
  }
  let index = 0;
  for (let row = 0; row < zs.length - 1; row += 1) {
    for (let col = 0; col < xs.length - 1; col += 1) {
      const a = row * xs.length + col;
      const b = a + xs.length;
      indices[index++] = a;
      indices[index++] = b;
      indices[index++] = a + 1;
      indices[index++] = a + 1;
      indices[index++] = b;
      indices[index++] = b + 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function createDepthTexture(): THREE.DataTexture {
  const width = 680;
  const height = 712;
  const depths = new Float32Array(width * height);
  const data = new Uint8Array(width * height * 4);
  const { minX, maxX, minZ, maxZ } = OCEAN_BATHYMETRY;
  const dx = (maxX - minX) / width;
  const dz = (maxZ - minZ) / height;
  for (let row = 0; row < height; row += 1) {
    const z = minZ + (row + 0.5) * dz;
    for (let col = 0; col < width; col += 1) {
      const x = minX + (col + 0.5) * dx;
      depths[row * width + col] = SEA_LEVEL - groundHeight(x, z);
    }
  }
  const pack = (value: number) => Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const i = row * width + col;
      const depth = depths[i];
      const slopeX = (depths[row * width + Math.min(col + 1, width - 1)]
        - depths[row * width + Math.max(col - 1, 0)]) / (2 * dx);
      const slopeZ = (depths[Math.min(row + 1, height - 1) * width + col]
        - depths[Math.max(row - 1, 0) * width + col]) / (2 * dz);
      // Wide-range optical depth, depth gradient and a higher-precision waterline depth.
      data[i * 4] = pack(Math.sqrt(Math.max(0, (depth + 2) / 32)));
      data[i * 4 + 1] = pack(0.5 + slopeX * 0.31);
      data[i * 4 + 2] = pack(0.5 + slopeZ * 0.31);
      data[i * 4 + 3] = pack((depth + 1.5) / 7);
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createWaterDetailTexture(): THREE.DataTexture {
  const size = 256;
  const cells = 16;
  const random = coastRandom(4618);
  const points = Array.from({ length: cells * cells }, () => ({
    x: 0.18 + random() * 0.64,
    y: 0.18 + random() * 0.64,
    density: random(),
  }));
  const pointAt = (x: number, y: number) => points[((y + cells) % cells) * cells + (x + cells) % cells];
  const pixels = new Uint8Array(size * size * 2);
  const ease = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y += 1) {
    const cy = Math.floor(y * cells / size);
    const fy = (y + 0.5) * cells / size - cy;
    for (let x = 0; x < size; x += 1) {
      const cx = Math.floor(x * cells / size);
      const fx = (x + 0.5) * cells / size - cx;
      let nearest = Infinity;
      let second = Infinity;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const point = pointAt(cx + offsetX, cy + offsetY);
          const squared = (offsetX + point.x - fx) ** 2 + (offsetY + point.y - fy) ** 2;
          if (squared < nearest) {
            second = nearest;
            nearest = squared;
          } else {
            second = Math.min(second, squared);
          }
        }
      }
      const bottom = THREE.MathUtils.lerp(pointAt(cx, cy).density, pointAt(cx + 1, cy).density, ease(fx));
      const top = THREE.MathUtils.lerp(pointAt(cx, cy + 1).density, pointAt(cx + 1, cy + 1).density, ease(fx));
      const gap = Math.sqrt(second) - Math.sqrt(nearest);
      const i = (y * size + x) * 2;
      pixels[i] = Math.round(THREE.MathUtils.lerp(bottom, top, ease(fy)) * 255);
      pixels[i + 1] = Math.round(255 * (1 - THREE.MathUtils.smoothstep(gap, 0, 0.18)));
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const shoreBathymetry = /* glsl */`
  uniform float uTime;
  uniform sampler2D uDepth;
  uniform vec2 uOffset, uSpan;
  ${coastSwellGLSL}

  float depthAt(vec4 sampleDepth) {
    float depth = sampleDepth.r * sampleDepth.r * 32.0 - 2.0;
    float shallows = sampleDepth.a * 7.0 - 1.5;
    return mix(shallows, depth, smoothstep(3.3, 5.4, shallows));
  }

  float shoreDistance(vec4 sampleDepth, float depth) {
    vec2 grade = (sampleDepth.gb - 0.5) / 0.31;
    return depth / clamp(length(grade), 0.15, 0.62);
  }

  float frontDistance(float phase) {
    float advance = clamp((phase - 0.065) / 0.49, 0.0, 1.0);
    return 11.2 * pow(1.0 - advance, 1.55) - 0.42
      + 3.8 * smoothstep(0.61, 0.96, phase);
  }

  float breakerWeight(float phase) {
    return smoothstep(0.20, 0.37, phase) * (1.0 - smoothstep(0.48, 0.78, phase));
  }
`;

function oceanShader(sand: THREE.Texture) {
  const { minX, maxX, minZ, maxZ } = OCEAN_BATHYMETRY;
  return {
    name: 'Shore breakers and reflected cliffs',
    uniforms: {
      ...THREE.UniformsLib.lights,
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      color: { value: null },
      uTime: { value: 0 },
      uWaterDetailLevel: { value: 0 },
      uLiveReflection: { value: 0 },
      uDepth: { value: createDepthTexture() },
      uWaterDetail: { value: createWaterDetailTexture() },
      uSand: { value: sand },
      uOffset: { value: new THREE.Vector2(minX, minZ) },
      uSpan: { value: new THREE.Vector2(maxX - minX, maxZ - minZ) },
      uLagoon: { value: new THREE.Color(0x17b4b0) },
      uWater: { value: new THREE.Color(0x1381b0) },
      uDeep: { value: new THREE.Color(0x0a5484) },
      uWash: { value: new THREE.Color(0xe9fff7) },
      uUnderwaterScatter: { value: new THREE.Color(SEA_WATER_SCATTER) },
    },
    vertexShader: /* glsl */`
      varying vec3 vSurface;
      varying vec4 vReflection;
      uniform mat4 textureMatrix;
      #include <common>
      #include <shadowmap_pars_vertex>
      ${shoreBathymetry}
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vec2 bathyUv = (worldPosition.xz - uOffset) / uSpan;
        if (all(greaterThan(bathyUv, vec2(0.0))) && all(lessThan(bathyUv, vec2(1.0)))) {
          vec4 bathy = texture2D(uDepth, bathyUv);
          float depth = depthAt(bathy);
          if (depth > -0.55 && depth < 3.1) {
            float phase = fract(swellCycles(uTime, worldPosition.xz));
            float head = shoreDistance(bathy, depth) - frontDistance(phase);
            float rounding = 1.0 - smoothstep(0.0, 2.8, abs(head - 0.55));
            float spill = breakerWeight(phase) * rounding * 0.19;
            float runup = (1.0 - smoothstep(0.0, 2.0, abs(head)))
              * smoothstep(0.42, 0.54, phase) * (1.0 - smoothstep(0.67, 0.96, phase)) * 0.065;
            worldPosition.y += (spill + runup) * smoothstep(-0.55, -0.12, depth);
          }
        }
        vec3 transformedNormal = normalize(normalMatrix * normal);
        vSurface = worldPosition.xyz;
        vReflection = textureMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        #include <shadowmap_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uSand, uWaterDetail, tDiffuse;
      uniform float uLiveReflection, uWaterDetailLevel;
      uniform vec3 uLagoon, uWater, uDeep, uWash;
      uniform vec3 uUnderwaterScatter;
      varying vec3 vSurface;
      varying vec4 vReflection;
      #include <common>
      #include <packing>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>
      ${coastNoise}
      ${shoreBathymetry}
      ${coastWaterOptics}
      ${coastSkyGlsl}

      vec3 oceanUnderside(vec3 ray, vec3 normal, vec2 p, float thickness,
        float sunlit, float wave, vec2 dpdx, vec2 dpdy) {
        vec3 airRay;
        float transmission = waterTransmission(ray, normal, airRay);
        vec3 sky = coastSkyRadiance(airRay) + sunlit * coastSunRadiance(airRay);

        vec3 bounce = reflect(ray, -normal);
        float bedPath = thickness / max(0.055, -bounce.y);
        vec2 bedUV = (p + bounce.xz * min(bedPath, 45.0)) * 0.42;
        vec3 sand = textureGrad(uSand, bedUV, dpdx * 0.42, dpdy * 0.42).rgb;
        vec3 bed = sand * vec3(0.55, 0.94, 0.80) * (0.85 + wave * 0.22) * (0.54 + sunlit * 0.46);
        vec3 reflected = mix(uUnderwaterScatter * 0.64, bed, underwaterExtinction(bedPath)) * uCoastSurfaceLight;
        return mix(reflected, sky, transmission);
      }

      void main() {
        vec2 p = vSurface.xz;
        vec3 toEye = cameraPosition - vSurface;
        float distance = length(toEye);
        vec3 eye = toEye / max(distance, 0.001);
        vec2 uv = (p - uOffset) / uSpan;
        float within = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
        vec4 bathy = texture2D(uDepth, uv);
        float depth = mix(30.0, depthAt(bathy), within);
        float cycles = swellCycles(uTime, p);
        float phase = fract(cycles);
        float shore = shoreDistance(bathy, depth);
        vec2 grade = 0.5 - bathy.gb;
        vec2 shoreward = grade / max(0.01, length(grade));
        float front = frontDistance(phase);
        float head = shore - front;
        float breaker = breakerWeight(phase);
        float shoal = within * (1.0 - smoothstep(2.05, 3.1, depth));
        float shallows = smoothstep(-0.26, 0.05, depth) * shoal;
        float current = coastNoise(p*0.086 + vec2(uTime*0.034, -uTime*0.023));
        float swell = coastNoise(p.yx*0.037 + vec2(0.0, -0.041*uTime));
        float phaseA = dot(p, vec2(0.132, 0.81)) - 0.92*uTime + 6.2*swell;
        float phaseB = dot(p, vec2(1.62, -0.36)) + 1.22*uTime + 4.8*current;
        float phaseC = dot(p, vec2(-0.89, 2.12)) - 1.63*uTime + 9.1*swell;
        float phaseD = dot(p, vec2(0.57, 3.73)) + 2.02*uTime + sin(phaseA)*0.83 + 6.2*current;
        float wave = sin(phaseA)*0.44 + sin(phaseB)*0.25 + sin(phaseC)*0.19 + sin(phaseD)*0.12;
        vec2 slope = vec2(0.132,0.81)*cos(phaseA)*0.096 + vec2(1.62,-0.36)*cos(phaseB)*0.049
          + vec2(-0.89,2.12)*cos(phaseC)*0.031 + vec2(0.57,3.73)*cos(phaseD)*0.019;
        float waveFace = 1.0 - smoothstep(0.0, 1.9, abs(head + 0.24));
        slope -= shoreward * waveFace * breaker * shallows * 0.13;
        float rippleFade = 1.0 - smoothstep(95.0, 550.0, distance);
        vec2 capillary = textureGrad(uWaterDetail,
          p * 0.32 + vec2(uTime * 0.071, -uTime * 0.033) + 0.04 * sin(p.yx * 0.69),
          dFdx(p) * 0.32, dFdy(p) * 0.32).rg - 0.5;
        slope += 0.13 * capillary * (1.0 - smoothstep(0.22, 3.1, length(fwidth(p))));
        vec2 dpdx = dFdx(p);
        vec2 dpdy = dFdy(p);
        float footprint = length(fwidth(p));
        // Short crossed wind waves break up long swell fronts and soften distant reflected shapes.
        if (uWaterDetailLevel > 0.0 && distance < 210.0) {
          vec2 wind = vec2(0.79, -0.61);
          mat2 acrossWind = mat2(wind, vec2(-wind.y, wind.x));
          vec2 cells = acrossWind * p;
          float drift = textureGrad(uWaterDetail, cells * 0.075 + vec2(uTime * 0.017, -0.016 * uTime),
            acrossWind * dpdx * 0.075, acrossWind * dpdy * 0.075).r;
          vec2 ripple = vec2(sin(cells.x * 3.24 - cells.y * 0.90 - uTime * 3.38 + drift * 13.5),
            sin(cells.y * 4.43 + cells.x * 0.69 + uTime * 4.36 + drift * 9.30));
          vec2 chop = (0.58 + 0.42 * drift) * transpose(acrossWind) * ripple * vec2(0.086, 0.061);
          slope += chop * (1.0 - smoothstep(0.20, 1.8, footprint))
            * (1.0 - smoothstep(86.0, 210.0, distance));
        }
        vec3 normal = normalize(vec3(-slope.x*rippleFade, 1.0, -slope.y*rippleFade));
        float thickness = max(depth + vSurface.y, 0.0);
        float sunlit = getShadowMask();
        if (!gl_FrontFacing) {
          if (thickness <= 0.015) discard;
          vec2 ripples = 0.035 * vec2(cos(phaseD * 2.49), sin(phaseC * 2.31 + phaseB)) * rippleFade;
          vec3 opticalNormal = normalize(normal + vec3(ripples.x, 0.0, ripples.y));
          gl_FragColor = vec4(oceanUnderside(-eye, opticalNormal, p, thickness, sunlit, wave, dpdx, dpdy), 1.0);
          #include <tonemapping_fragment>
          // The distant water and the Three.js scene fog share a display-referred color.
          gl_FragColor.rgb = mix(uUnderwaterScatter * uCoastSurfaceLight, gl_FragColor.rgb, underwaterExtinction(distance));
          #include <colorspace_fragment>
          return;
        }

        float teal = smoothstep(2.4, 11.7, depth);
        float blue = smoothstep(12.0, 33.0, depth);
        vec3 water = mix(mix(uLagoon, uWater, teal), uDeep, blue);
        if (depth < 12.0) {
          float bottom = exp(-thickness * (0.34 + max(0.0, 0.35 - eye.y) * 0.38))
            * (1.0 - smoothstep(9.0, 12.0, depth));
          vec2 refractUv = p + slope * min(thickness, 7.0) * 0.45;
          if (uWaterDetailLevel > 0.0) {
            // Bend the visible ray at the water surface before sampling the sea bed.
            vec3 submergedRay = refract(-eye, normal, 0.7504);
            float travel = thickness / max(0.48, -submergedRay.y);
            refractUv = p + submergedRay.xz * travel;
            bottom *= exp(-0.18 * max(0.0, travel - thickness));
          }
          vec3 sand = textureGrad(uSand, refractUv * 0.42, dpdx * 0.42, dpdy * 0.42).rgb;
          // Moving refraction folds two light fields together over the sand.
          vec2 lightFlow = refractUv + 0.66 * sin(refractUv.yx * 1.39 + uTime * vec2(0.85, -0.64));
          lightFlow += 0.32 * sin(refractUv * 3.13 - uTime * 0.77 + wave * 1.09);
          vec2 directLight = lightFlow * 0.098 + uTime * vec2(0.015, 0.011);
          float focusedLight = textureGrad(uWaterDetail, directLight, dpdx * 0.124, dpdy * 0.124).g;
          mat2 lightRotation = mat2(0.077, 0.077, 0.077, -0.077);
          vec2 bouncedLight = lightRotation * lightFlow + uTime * vec2(-0.018, 0.011);
          float crossedLight = textureGrad(uWaterDetail, bouncedLight, lightRotation * dpdx, lightRotation * dpdy).g;
          float caustics = max(0.0, focusedLight * (0.16 + 0.84 * crossedLight) - 0.105);
          caustics *= smoothstep(0.12, 0.52, thickness) * rippleFade;
          vec3 seaBed = sand * mix(vec3(1.02, 0.99, 0.93), vec3(0.75, 1.12, 1.05),
            smoothstep(0.02, 1.25, thickness));
          seaBed += vec3(0.54, 0.88, 0.72) * caustics * 0.15 * sunlit;
          if (uWaterDetailLevel > 0.0) {
            // Project the crossed moving wave fronts along the refracted solar direction.
            vec3 sunRay = refract(-uCoastSunDirection, vec3(0.0, 1.0, 0.0), 0.7504);
            vec2 focus = refractUv - sunRay.xz * thickness / max(0.5, -sunRay.y);
            mat2 lattice = mat2(0.162, -0.096, 0.083, 0.185);
            vec2 focusedUv = lattice * focus + 0.022 * vec2(uTime, -uTime * 0.73);
            vec2 warp = focus.yx * 1.37 + vec2(-uTime, uTime * 0.68);
            focusedUv += 0.083 * sin(warp);
            vec2 warpSlope = 0.114 * cos(warp);
            vec2 lens = textureGrad(uWaterDetail, focusedUv,
              lattice * dpdx + warpSlope * dpdx.yx, lattice * dpdy + warpSlope * dpdy.yx).rg;
            float crossing = smoothstep(0.09, 0.61, crossedLight * 0.71 + current * 0.39);
            float sunFocus = smoothstep(0.18, 0.94, lens.g)
              * (0.32 + 0.68 * (1.0 - abs(2.0 * lens.r - 1.0))) * mix(0.30, 1.0, crossing);
            float bedFocus = smoothstep(0.10, 0.47, thickness) * exp(-0.24 * thickness)
              * (1.0 - smoothstep(0.45, 2.8, footprint)) * sunlit * (1.0 - uCoastNight);
            seaBed *= 1.0 - 0.10 * bedFocus;
            seaBed += uCoastSolarColor * (0.22 + 1.19 * seaBed) * (sunFocus * bedFocus);
          }
          water = mix(water, seaBed, bottom * 0.97);
        }
        water *= (0.69 + 0.31*sunlit) * (0.96 + 0.08*swell + rippleFade
          * (0.067*wave + 0.024*cos(phaseC + phaseD + sin(p.x*0.42-p.y*0.77))));
        water = mix(water, water * 0.83 + vec3(0.008, 0.034, 0.018),
          waveFace * breaker * shallows * rippleFade);
        water *= uCoastSurfaceLight;
        float fresnel = waterFresnel(dot(normal, eye));
        vec3 reflectedRay = reflect(-eye, normal);
        vec3 broadSky = coastSkyRadiance(normalize(vec3(reflectedRay.x, max(0.20, reflectedRay.y), reflectedRay.z)));
        // Near-horizontal reflections sample the surrounding banks and distant water.
        float skyOpening = smoothstep(-0.08, 0.37, reflectedRay.y);
        vec3 reflected = mix(water * vec3(0.69, 0.79, 0.83) + 0.024 * uCoastSurfaceLight,
          broadSky * (0.63 + 0.17 * sunlit), skyOpening);
        if (uLiveReflection > 0.0 && vReflection.w > 0.0) {
          float resolvedRipples = 1.0 - smoothstep(0.9, 4.1, length(fwidth(p)));
          vec2 uvReflect = vReflection.xy / vReflection.w
            + (slope * vec2(0.042, 0.075) + slope.yx * vec2(0.014, -0.010)) * resolvedRipples;
          float edge = min(min(uvReflect.x, uvReflect.y), min(1.0 - uvReflect.x, 1.0 - uvReflect.y));
          vec2 center = clamp(uvReflect, 0.005, 0.995);
          vec2 reflectionBlur = mix(vec2(0.0012, 0.0009), vec2(0.0031, 0.0016),
            smoothstep(14.0, 178.0, distance));
          // Average reflections over the unresolved ripple slopes at grazing angles.
          vec3 sceneReflection = texture2D(tDiffuse, center).rgb * 0.40;
          sceneReflection += 0.15 * (texture2D(tDiffuse, center + vec2(reflectionBlur.x, 0.0)).rgb
            + texture2D(tDiffuse, center - vec2(reflectionBlur.x, 0.0)).rgb
            + texture2D(tDiffuse, center + vec2(0.0, reflectionBlur.y)).rgb
            + texture2D(tDiffuse, center - vec2(0.0, reflectionBlur.y)).rgb);
          float reflectionWeight = smoothstep(0.012, 0.075, edge) * (0.45 + 0.33 * resolvedRipples);
          reflected = mix(reflected, sceneReflection, reflectionWeight);
        }
        water = mix(water, reflected, fresnel);
        float sparkle = waterSunGlint(normal, eye, uCoastSunDirection, 0.12 + 0.15 * current);
        water += uCoastSolarColor * sparkle * sunlit;

        float antialias = max(fwidth(head) * 0.55, 0.035);
        if (shoal > 0.0 && depth > -0.31 && abs(head) < 8.0) {
          // The spilling lip breaks into patches of froth. Their trailing bubbles linger and drain away.
          float drawBack = smoothstep(0.60, 0.97, phase);
          vec2 frothUv = p - shoreward * (1.55 * smoothstep(0.24, 0.60, phase) - 1.25 * drawBack);
          mat2 groupShape = mat2(0.022, -0.018, 0.011, 0.036);
          float groups = textureGrad(uWaterDetail, groupShape * frothUv + 0.13 * mod(floor(cycles), 32.0),
            groupShape * dpdx, groupShape * dpdy).r;
          vec2 bubbleFlow = frothUv * 0.169 + 0.034 * sin(frothUv.yx * 3.45) + vec2(0.09, 0.37);
          vec2 bubbles = textureGrad(uWaterDetail, bubbleFlow, dpdx * 0.177, dpdy * 0.177).rg;
          float brokenHead = head + (groups - 0.5) * 1.46 + (bubbles.r - 0.5) * 0.51;
          float bodyWidth = 0.18 + 0.57 * groups;
          float lip = 1.0 - smoothstep(bodyWidth, bodyWidth + 0.16 + antialias, abs(brokenHead));
          float broken = smoothstep(0.36, 0.78, groups * 0.77 + bubbles.r * 0.33);
          float foamLift = breaker * shoal * smoothstep(-0.13, 0.11, depth + vSurface.y);
          float crestFoam = lip * broken * foamLift * (0.73 + 0.27 * bubbles.r - 0.26 * bubbles.g)
            * bodyWidth / (bodyWidth + 0.33 * antialias);
          float tail = smoothstep(-0.24, 0.68, brokenHead)
            * (1.0 - smoothstep(1.0, 3.1 + 1.45 * groups, brokenHead));
          float trailFoam = tail * smoothstep(0.33, 0.48, phase)
            * (1.0 - smoothstep(0.69, 0.99, phase)) * shallows;
          mat2 frothRotation = mat2(0.235, -0.118, 0.118, 0.235);
          float flecks = textureGrad(uWaterDetail, frothRotation * frothUv + vec2(0.51, 0.67),
            frothRotation * dpdx, frothRotation * dpdy).r;
          float driftingLace = smoothstep(0.52, 0.82,
            bubbles.r * 0.51 + flecks * 0.34 + groups * 0.19 + bubbles.g * 0.12);
          float residue = trailFoam * (0.055 * broken + (0.28 + 0.20 * breaker) * driftingLace);
          float shoreFoam = crestFoam + residue * (1.0 - crestFoam);
          if (uWaterDetailLevel > 0.0) {
            mat2 streak = mat2(0.217, -0.082, 0.123, 0.324);
            vec2 detail = textureGrad(uWaterDetail, streak * frothUv + vec2(uTime * -0.037, uTime * 0.023),
              streak * dpdx, streak * dpdy).rg;
            float meshFoam = smoothstep(0.17, 0.79, detail.g + bubbles.r * 0.18)
              * (0.51 + 0.49 * detail.r);
            float resolving = 1.0 - smoothstep(0.33, 2.8, footprint);
            float porousCrest = crestFoam * (0.41 + 0.63 * meshFoam) + foamLift * lip * meshFoam * 0.28;
            float laceTail = residue * (0.67 + 0.51 * meshFoam) + trailFoam * meshFoam * 0.23;
            shoreFoam = mix(shoreFoam, clamp(porousCrest + laceTail * (1.0 - porousCrest), 0.0, 1.0), resolving);
          }
          water = mix(water, uWash * uCoastSurfaceLight * (0.69 + 0.31 * sunlit), shoreFoam);
        }

        float horizon = smoothstep(500.0, 2240.0, distance);
        water = mix(water, coastSkyRadiance(-eye), horizon);
        gl_FragColor = vec4(water, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
}

export function createCoastOcean(time: THREE.IUniform<number>, atmosphere: CoastAtmosphere, sand: THREE.Texture) {
  const mesh = new Reflector(createCoastOceanGeometry(), {
    shader: oceanShader(sand), textureWidth: 840, textureHeight: 512, multisample: 0, clipBias: 0.0007,
  });
  mesh.name = 'Clear shoals and open sea';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, SEA_LEVEL, -230);
  mesh.receiveShadow = true;
  const surface = mesh.material as THREE.ShaderMaterial;
  surface.side = THREE.DoubleSide;
  surface.lights = true;
  surface.uniforms.uTime = time;
  bindCoastSky(surface.uniforms, atmosphere);

  const reflect = mesh.onBeforeRender;
  let high = false;
  let lastReflection = -Infinity;
  let reflectedNight = atmosphere.night.value;
  mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
    const canReflect = high && camera.position.y > SEA_LEVEL + 0.17 && camera.position.z < 164;
    surface.uniforms.uLiveReflection.value = Number(canReflect);
    if (!canReflect) {
      lastReflection = -Infinity;
      return;
    }
    if (reflectedNight === atmosphere.night.value && time.value - lastReflection < 0.105) return;
    reflectedNight = atmosphere.night.value;
    lastReflection = time.value;
    reflect.call(mesh, renderer, scene, camera, geometry, material, group);
  };
  return {
    mesh,
    setQuality(quality: CoastQuality) {
      high = quality === 'high';
      surface.uniforms.uWaterDetailLevel.value = Number(high);
      lastReflection = -Infinity;
    },
  };
}
