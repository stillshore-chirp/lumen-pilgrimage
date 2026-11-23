import * as THREE from 'three';
import { coastRandom, coastWaterLevel, groundHeight, type CoastWaterfall } from '../terrain';
import type { CoastAtmosphere } from './coastAtmosphere';
import { coastNoise } from './coastNoise';
import { createCascadeGeometry, type CascadeImpact } from './coastCascadeGeometry';
import { coastSprayRainbow } from './coastSprayRainbow';

function currentMaterial(time: THREE.IUniform<number>, atmosphere: CoastAtmosphere): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: time,
      uSun: atmosphere.sun,
      uLight: atmosphere.surfaceLight,
      uWater: { value: new THREE.Color(0x43899a) },
      uWhite: { value: new THREE.Color(0xeaf5f3) },
    },
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, forceSinglePass: true,
    vertexShader: /* glsl */`
      uniform float uTime;
      attribute vec4 aFlow, aWater;
      varying vec4 vFlow, vWater;
      varying vec3 vPoint, vNormal;
      #include <fog_pars_vertex>
      void main() {
        vFlow = aFlow;
        vWater = aWater;
        float wave = sin(aFlow.x * 8.0 + aFlow.y * 4.1 - uTime * 8.0 + aWater.w);
        float pulse = sin(aFlow.x * 19.3 - aFlow.y * 6.2 - uTime * 19.3);
        vec3 point = position + normal * aWater.y * (0.080 * wave + 0.033 * pulse);
        vPoint = (modelMatrix * vec4(point, 1.0)).xyz;
        vNormal = mat3(modelMatrix) * normal;
        vec4 mvPosition = modelViewMatrix * vec4(point, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uSun, uLight, uWater, uWhite;
      varying vec4 vFlow, vWater;
      varying vec3 vPoint, vNormal;
      #include <fog_pars_fragment>
      ${coastNoise}
      void main() {
        float age = vFlow.x - uTime;
        float across = vFlow.y;
        float air = vWater.y;
        float seed = vWater.w;
        float drift = coastNoise(vec2(across * 0.68 + seed, age * 2.9));
        float channel = coastNoise(vec2(across * 0.91 + seed * 1.3, vFlow.x * 0.92));
        vec2 flow = vec2(across + 0.36 * (drift - 0.5) + 0.39 * channel + seed,
          age + 0.16 * drift + 0.19 * channel);
        float swirls = coastNoise(flow * vec2(1.80, 3.25));
        float strands = coastNoise(flow * vec2(5.1, 4.0) + swirls * 0.52);
        float flecks = coastNoise(flow * vec2(14.5, 18.0) - seed);
        // Filter the smallest spray detail before its cells become subpixel.
        float resolution = max(fwidth(flow.x * 14.5), fwidth(flow.y * 18.0));
        flecks = mix(flecks, 0.5, smoothstep(0.35, 1.5, resolution));

        float foam = smoothstep(0.26, 0.83, swirls * 0.50 + strands * 0.34 + flecks * 0.16);
        float turbulence = smoothstep(0.43, 0.83, swirls + flecks * 0.20);
        float fringe = 1.0 - smoothstep(0.67 + 0.16 * foam, 0.85 + 0.15 * turbulence, vWater.x);
        float aerated = clamp((0.33 + foam * 0.79) * air + turbulence * 0.15 + foam * 0.13, 0.0, 1.0);

        vec3 view = normalize(cameraPosition - vPoint);
        vec3 normal = normalize(vNormal + vec3(0.13 * (strands - 0.5), 0.07 * (drift - 0.5), -0.13 * (strands - 0.5)));
        normal *= gl_FrontFacing ? 1.0 : -1.0;
        float facing = clamp(dot(normal, view), 0.0, 1.0);
        float fresnel = 0.026 + 0.974 * pow(1.0 - facing, 5.0);
        float sky = 0.62 + 0.38 * smoothstep(-0.25, 0.86, reflect(-view, normal).y);
        float lit = 0.68 + 0.30 * max(dot(normal, uSun), 0.0);
        float glint = pow(max(dot(normal, normalize(view + uSun)), 0.0), 53.0) * fresnel;
        vec3 clear = uWater * (0.47 + 0.28 * swirls) + uWhite * fresnel * sky * 0.49;
        vec3 bubbles = uWhite * (lit * (0.74 + 0.26 * turbulence) + 0.10 * flecks);
        float opacity = vFlow.w * fringe * (0.29 + 0.59 * aerated + 0.27 * fresnel);
        opacity *= 1.0 - vWater.z * (0.56 - 0.28 * turbulence) * smoothstep(0.45, 1.0, vWater.x);
        gl_FragColor = vec4((mix(clear, bubbles, aerated) + uWhite * glint * 0.39) * uLight, min(0.95, opacity));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

function impactFoam(fall: CoastWaterfall, width: number, time: THREE.IUniform<number>,
  light: THREE.IUniform<THREE.Color>): THREE.Mesh {
  const { impact, direction } = fall;
  const level = coastWaterLevel(impact.x, impact.z);
  const rows = 24;
  const cols = 25;
  const geometry = new THREE.PlaneGeometry(1, 1, cols, rows);
  const positions = geometry.attributes.position;
  const samples = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i += 1) {
    const across = positions.getX(i) * width * 4.7;
    const along = (positions.getY(i) * 5.7 + 1.05) * width;
    const x = impact.x + direction.x * along - direction.z * across;
    const z = impact.z + direction.z * along + direction.x * across;
    positions.setXYZ(i, x, level + 0.064, z);
    samples[i] = Math.max(-2, Math.min(2, coastWaterLevel(x, z) - groundHeight(x, z)));
  }
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(samples, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: time,
      uLight: light,
      uSeed: { value: impact.x * 0.276 },
      uFoam: { value: new THREE.Color(0xe2fff3) },
      uWater: { value: new THREE.Color(0x4bb6b9) },
    },
    transparent: true, depthWrite: false, fog: true,
    vertexShader: /* glsl */`
      attribute float aDepth;
      varying vec2 vPool;
      varying float vDepth;
      #include <fog_pars_vertex>
      void main() {
        vPool = (uv - vec2(0.5, 0.3158)) * vec2(4.7, 5.7);
        vDepth = aDepth;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime, uSeed;
      uniform vec3 uFoam, uWater, uLight;
      varying vec2 vPool;
      varying float vDepth;
      #include <fog_pars_fragment>
      ${coastNoise}
      void main() {
        vec2 p = vPool;
        vec2 drift = vec2(sin(p.y * 1.9 + uTime * 1.17), cos(p.x * 1.9 - uTime * 0.53)) * 0.13;
        vec2 q = p + drift - vec2(0.0, uTime * 0.41);
        float curl = coastNoise(q * vec2(4.3, 2.8) + uSeed);
        float grit = coastNoise(q * vec2(13.0, 9.4) + 11.8 + uSeed);
        float torn = smoothstep(0.32, 0.77, curl * 0.62 + grit * 0.38);
        float radius = length(vec2(p.x / 1.08, (p.y - 0.35) * 0.70)) + 0.17 * (curl - 0.5);
        vec2 core = vec2(p.x * 0.95, (p.y - 0.12) * 1.32);
        float splash = exp(-5.7 * dot(core, core));
        float edge = fract(3.1 * radius - uTime * 1.45 + 0.37 * curl);
        float arcs = (1.0 - smoothstep(0.06, 0.26, abs(edge - 0.54))) * smoothstep(0.40, 0.79, curl);
        float width = 0.64 + 0.47 * sqrt(max(p.y, 0.0));
        float wake = (1.0 - smoothstep(0.34, width, abs(p.x + 0.26 * sin(2.5 * p.y))))
          * smoothstep(-0.26, 0.37, p.y) * (1.0 - smoothstep(0.7, 3.8, p.y));
        float boundary = (1.0 - smoothstep(1.07, 1.68, radius)) * smoothstep(-1.03, -0.48, p.y);
        float foam = clamp(splash * (0.57 + 0.42 * grit) + 0.43 * arcs * boundary + 0.65 * torn * wake, 0.0, 1.0);
        float wet = smoothstep(-0.11, 0.30, vDepth);
        gl_FragColor = vec4(mix(uWater, uFoam, 0.26 + 0.74 * smoothstep(0.0, 0.60, foam)) * uLight,
          wet * clamp(foam + 0.21 * wake * (1.0 - torn), 0.0, 0.92));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Foam rings and returning current';
  mesh.renderOrder = 2;
  return mesh;
}

interface SprayInputs {
  fall: CoastWaterfall;
  impact: CascadeImpact;
}

function billowTexture(): THREE.DataTexture {
  const size = 80;
  const pixels = new Uint8Array(size * size);
  const puff: [number, number, number, number][] = [[-0.39, -0.14, 0.43, 0.78], [0.24, -0.08, 0.60, 0.89],
    [0.42, 0.23, 0.32, 0.58], [-0.05, 0.36, 0.42, 0.75], [-0.14, -0.42, 0.39, 0.72]];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const x = col / (size - 1) * 2 - 1;
      const y = row / (size - 1) * 2 - 1;
      let strength = 0;
      for (const [cx, cy, spread, density] of puff) {
        strength += density * Math.exp(-3.1 * ((x - cx) ** 2 + (y - cy) ** 2) / (spread * spread));
      }
      const ripples = 0.88 + 0.08 * Math.sin(x * 22 + y * 17) + 0.06 * Math.cos(y * 29 - x * 11);
      const rim = Math.max(0, 1 - Math.pow(Math.hypot(x, y), 3));
      pixels[row * size + col] = Math.round(Math.min(1, strength * ripples * rim * 1.3) * 255);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function sprayMesh(inputs: SprayInputs[], time: THREE.IUniform<number>, atmosphere: CoastAtmosphere,
  mist: boolean): THREE.Mesh {
  const origin: number[] = [];
  const motion: number[] = [];
  const plume: number[] = [];
  const aspect: number[] = [];
  const random = coastRandom(mist ? 180723 : 562911);
  const floor = (x: number, z: number) => Math.max(coastWaterLevel(x, z), groundHeight(x, z));
  for (const { fall, impact } of inputs) {
    const { width, point, kind } = impact;
    const { x, z } = fall.direction;
    const pool = kind === 'pool';
    const shear = kind === 'shear';
    const count = (mist ? { pool: 24, ledge: 9, shear: 5 } : { pool: 80, ledge: 21, shear: 10 })[kind];
    for (let i = 0; i < count; i += 1) {
      const spread = (random() + random() - 1) * width * (mist ? 1.28 : 0.64);
      const along = width * (random() - 0.30) * (mist ? 0.63 : 0.35);
      const px = point.x + x * along - z * spread;
      const pz = point.z + z * along + x * spread;
      const py = Math.max(point.y - 0.38, floor(px, pz)) + (mist ? 0.55 + width * random() * 0.29 : 0.22);
      const sideways = (random() - 0.5) * (mist ? 2.45 : 12.8);
      const forward = mist ? 0.56 + random() * 1.48 : random() * 7.1 - 1.45;
      const vx = x * forward - z * sideways;
      const vz = z * forward + x * sideways;
      const vy = shear ? -(mist ? 2.7 + random() * 5.8 : 9.1 + random() * 12.4)
        : mist ? 0.33 + random() * 1.36 : 2.2 + random() * (pool ? 8.3 : 5.2);
      let life = shear ? 0.63 + random() * 1.06 : mist ? 3.0 + random() * 3.4 : vy * 0.204 + 0.10;
      if (!mist) {
        for (let t = 0.06; t < life; t += 0.06) {
          if (py + vy * t - 4.9 * t * t > floor(px + vx * t, pz + vz * t) + 0.06) continue;
          life = t;
          break;
        }
      }
      origin.push(px, py, pz);
      motion.push(vx, vy, vz);
      const size = mist ? width * (0.44 + random() * 1.12) * (shear ? 0.51 : 1) : 0.044 + random() ** 2 * 0.113;
      const opacity = mist ? (pool ? 0.27 : shear ? 0.10 : 0.23) * (0.66 + random() * 0.33)
        : 0.52 + random() * 0.43;
      plume.push(life, random(), size, opacity);
      aspect.push(mist ? 1.45 + random() * 0.85 : 2 + random() * 4.0, random() * Math.PI * 2);
    }
  }
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(plane.index);
  geometry.setAttribute('position', plane.attributes.position);
  geometry.setAttribute('uv', plane.attributes.uv);
  geometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(new Float32Array(origin), 3));
  geometry.setAttribute('aMotion', new THREE.InstancedBufferAttribute(new Float32Array(motion), 3));
  geometry.setAttribute('aPlume', new THREE.InstancedBufferAttribute(new Float32Array(plume), 4));
  geometry.setAttribute('aAspect', new THREE.InstancedBufferAttribute(new Float32Array(aspect), 2));
  geometry.instanceCount = origin.length / 3;
  const material = new THREE.ShaderMaterial({
    defines: mist ? { BILLOW: 1 } : {},
    uniforms: {
      ...(mist ? THREE.UniformsUtils.clone(THREE.UniformsLib.lights) : {}),
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: time,
      uSun: atmosphere.sun,
      uLight: atmosphere.surfaceLight,
      uNight: atmosphere.night,
      uSubmersion: atmosphere.submersion,
      uBillow: { value: mist ? billowTexture() : null },
      uSpray: { value: new THREE.Color(mist ? 0xe8f6f4 : 0xf3fef8) },
    },
    transparent: true, fog: true, depthWrite: false, lights: mist,
    vertexShader: /* glsl */`
      uniform float uTime;
      attribute vec3 aOrigin, aMotion;
      attribute vec4 aPlume;
      attribute vec2 aAspect;
      varying float vAlpha;
      varying vec2 vSprite;
      varying vec3 vPoint;
      #ifdef BILLOW
        #include <shadowmap_pars_vertex>
      #endif
      #include <fog_pars_vertex>
      void main() {
        float age = fract(uTime / aPlume.x + aPlume.y);
        float time = age * aPlume.x;
        vec3 p = aOrigin + aMotion * time;
        float size = aPlume.z;
        #ifdef BILLOW
          p.xz += sin(vec2(0.82, 0.69) * time + aAspect.y) * min(1.0, time * 0.83) * 0.84;
          size *= 0.69 + 1.12 * age;
          vec2 axis = vec2(-0.16 + 0.15 * sin(time + aAspect.y), 1.0);
          vAlpha = aPlume.w * smoothstep(0.0, 0.22, age) * (1.0 - smoothstep(0.42, 1.0, age));
        #else
          p.y -= 4.9 * time * time;
          vec3 velocity = aMotion - vec3(0., 9.8 * time, 0.);
          vec2 axis = (mat3(viewMatrix) * velocity).xy + vec2(0.0002, 0.0);
          size *= 1.12 - 0.37 * age;
          vAlpha = aPlume.w * smoothstep(0.0, 0.09, age) * (1.0 - smoothstep(0.60, 1.0, age));
        #endif
        vSprite = uv;
        axis = normalize(axis);
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        #ifdef BILLOW
          vec2 corner = (vec2(axis.y, -axis.x) * position.x * aAspect.x + axis * position.y) * size;
          mvPosition.xy += corner;
          vPoint = p + transpose(mat3(viewMatrix)) * vec3(corner, 0.0);
          vec4 worldPosition = vec4(vPoint, 1.0);
          #include <shadowmap_vertex>
        #else
          mvPosition.xy += (vec2(axis.y, -axis.x) * position.x + axis * position.y * aAspect.x) * size;
          vAlpha *= 1.0 - smoothstep(76.0, 310.0, -mvPosition.z);
          vPoint = p;
        #endif
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uLight, uSpray;
      uniform float uNight, uSubmersion;
      uniform sampler2D uBillow;
      varying float vAlpha;
      varying vec2 vSprite;
      varying vec3 vPoint;
      #ifdef BILLOW
        #include <common>
        #include <packing>
        #include <lights_pars_begin>
        #include <shadowmap_pars_fragment>
        #include <shadowmask_pars_fragment>
        ${coastSprayRainbow}
      #endif
      #include <fog_pars_fragment>
      void main() {
        vec3 light = uSpray;
        #ifdef BILLOW
          float density = texture2D(uBillow, vSprite).r;
          vec4 bow = primaryRainbow(normalize(vPoint - cameraPosition), uSun);
          float scattering = bow.a * smoothstep(0.02, 0.37, density) * (1.0 - uNight) * (1.0 - uSubmersion);
          if (scattering > 0.0) {
            light = mix(light, vec3(0.13) + 1.01 * bow.rgb, 0.89 * scattering * sunlitSpray());
          }
        #else
          float density = 1.0 - smoothstep(0.10, 0.96, length((vSprite - 0.5) * 2.0));
        #endif
        gl_FragColor = vec4(light * uLight, density * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = mist ? 'Drifting waterfall spray and spectral scattering' : 'Ballistic cascade droplets';
  mesh.frustumCulled = false;
  mesh.receiveShadow = mist;
  mesh.renderOrder = mist ? 4 : 3;
  return mesh;
}

export function createWaterfalls(
  falls: CoastWaterfall[], time: THREE.IUniform<number>, atmosphere: CoastAtmosphere,
): {
  group: THREE.Group;
  update: (elapsed: number) => void;
} {
  const group = new THREE.Group();
  group.name = 'Waterfalls, drifting spray and rainbows';
  const current = currentMaterial(time, atmosphere);
  const sprays: SprayInputs[] = [];
  for (const [index, fall] of falls.entries()) {
    const { geometry, impacts } = createCascadeGeometry(fall, index);
    const water = new THREE.Mesh(geometry, current);
    water.name = `Feeder and falling current: ${fall.id}`;
    water.renderOrder = 1;
    group.add(water);
    for (const impact of impacts) {
      if (impact.kind === 'pool') group.add(impactFoam(fall, impact.width, time, atmosphere.surfaceLight));
      sprays.push({ fall, impact });
    }
  }
  group.add(sprayMesh(sprays, time, atmosphere, false), sprayMesh(sprays, time, atmosphere, true));
  return { group, update: elapsed => { time.value = elapsed; } };
}
