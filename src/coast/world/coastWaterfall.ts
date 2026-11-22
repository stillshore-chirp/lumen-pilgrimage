import * as THREE from 'three';
import { coastRandom, groundHeight, SEA_LEVEL, type CoastWaterfall } from '../terrain';
import { coastNoise } from './coastNoise';
import { createCascadeGeometry, type CascadeImpact } from './coastCascadeGeometry';

const sun = new THREE.Vector3(0.46, 0.70, 0.58).normalize();

function currentMaterial(time: THREE.IUniform<number>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: time,
      uSun: { value: sun },
      uWater: { value: new THREE.Color(0x328698) },
      uWhite: { value: new THREE.Color(0xf1fdfa) },
    },
    transparent: true, depthWrite: false, fog: true,
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
        vec3 point = position + normal * aWater.y * (0.123 * wave + 0.062 * pulse);
        vPoint = (modelMatrix * vec4(point, 1.0)).xyz;
        vNormal = mat3(modelMatrix) * normal;
        vec4 mvPosition = modelViewMatrix * vec4(point, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uSun, uWater, uWhite;
      varying vec4 vFlow, vWater;
      varying vec3 vPoint, vNormal;
      #include <fog_pars_fragment>
      ${coastNoise}
      void main() {
        float clock = vFlow.x - uTime;
        float offset = vWater.w;
        float across = vFlow.y;
        float cloud = coastNoise(vec2(across * 0.47 + offset, clock * 3.5));
        float slip = coastNoise(vec2(across * 0.83 - offset, clock * 1.8)) - 0.5;
        vec2 stream = vec2(across + 0.38 * slip, clock + 0.11 * cloud);
        float ropes = coastNoise(stream * vec2(2.52, 4.15) + offset);
        float fibres = coastNoise(stream * vec2(7.3, 10.4) - offset);
        float beads = coastNoise(stream * vec2(21.0, 36.0) + offset);
        // Keep the fine droplets from turning into crawling pixels from the beach.
        beads = mix(beads, 0.5, smoothstep(0.42, 1.12, fwidth(stream.x * 21.0)));
        float lace = smoothstep(0.30, 0.76, ropes * 0.39 + fibres * 0.29 + beads * 0.19 + cloud * 0.13);
        float air = vWater.y;
        float lowFall = smoothstep(0.07, 0.75, vFlow.z);
        float foamFray = smoothstep(0.14, 0.78, ropes * 0.49 + beads * 0.51);
        float ragged = 0.15 + 0.47 * (1.0 - foamFray) * (0.71 + 0.29 * air);
        float opacity = (0.52 + 0.43 * lace)
          * smoothstep(0.035, ragged, vWater.x)
          * mix(0.79 + 0.20 * beads, 1.0, air) * vFlow.w;
        opacity *= 1.0 - 0.79 * vWater.z * (1.0 - smoothstep(0.2, 0.86, ropes));

        vec3 eye = normalize(cameraPosition - vPoint);
        vec3 normal = normalize(vNormal + vec3(0.20 * slip, 0.15 * (fibres - 0.5), -0.21 * slip));
        float face = 0.47 + 0.53 * max(dot(normal, uSun), 0.0);
        float fresnel = pow(1.0 - max(dot(normal, eye), 0.0), 3.5);
        float gleam = pow(max(dot(normal, normalize(eye + uSun)), 0.0), 65.0);
        float bubbles = smoothstep(0.57, 0.88, beads) * (0.32 + 0.68 * air);
        float milk = clamp(0.08 + 0.55 * lace + 0.23 * air + 0.13 * lowFall + 0.21 * bubbles
          + fresnel * 0.16 + vWater.z * 0.11, 0.0, 1.0);
        vec3 blue = uWater * (0.68 + 0.41 * face + 0.32 * cloud) + vec3(0.055, 0.077, 0.082) * fresnel;
        vec3 white = uWhite * (0.68 + 0.22 * face + 0.27 * cloud);
        gl_FragColor = vec4(mix(blue, white, milk) + uWhite * gleam * (0.27 + 0.48 * beads), opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

function impactFoam(fall: CoastWaterfall, time: THREE.IUniform<number>): THREE.Mesh {
  const { width, impact, direction } = fall;
  const rows = 40;
  const cols = 40;
  const geometry = new THREE.PlaneGeometry(1, 1, cols, rows);
  const positions = geometry.attributes.position;
  const samples = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i += 1) {
    const across = positions.getX(i) * width * 4.7;
    const along = (positions.getY(i) * 5.7 + 1.05) * width;
    const x = impact.x + direction.x * along - direction.z * across;
    const z = impact.z + direction.z * along + direction.x * across;
    positions.setXYZ(i, x, SEA_LEVEL + 0.047, z);
    samples[i] = Math.max(-2, Math.min(2, SEA_LEVEL - groundHeight(x, z)));
  }
  geometry.setAttribute('aDepth', new THREE.BufferAttribute(samples, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: time,
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
      uniform vec3 uFoam, uWater;
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
        gl_FragColor = vec4(mix(uWater, uFoam, 0.26 + 0.74 * smoothstep(0.0, 0.60, foam)),
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

function sprayMesh(inputs: SprayInputs[], time: THREE.IUniform<number>, mist: boolean): THREE.Mesh {
  const origin: number[] = [];
  const motion: number[] = [];
  const plume: number[] = [];
  const aspect: number[] = [];
  const random = coastRandom(mist ? 180723 : 562911);
  const floor = (x: number, z: number) => Math.max(SEA_LEVEL, groundHeight(x, z));
  for (const { fall, impact } of inputs) {
    const { width, point, kind } = impact;
    const { x, z } = fall.direction;
    const pool = kind === 'pool';
    const shear = kind === 'shear';
    const count = (mist ? { pool: 24, ledge: 12, shear: 6 } : { pool: 93, ledge: 31, shear: 11 })[kind];
    for (let i = 0; i < count; i += 1) {
      const spread = (random() + random() - 1) * width * (mist ? 1.28 : 0.64);
      const along = width * (random() - 0.30) * (mist ? 0.63 : 0.35);
      const px = point.x + x * along - z * spread;
      const pz = point.z + z * along + x * spread;
      const py = Math.max(point.y - 0.38, floor(px, pz)) + (mist ? 0.55 + width * random() * 0.29 : 0.22);
      const sideways = (random() - 0.5) * (mist ? 2.45 : 12.8);
      const forward = mist ? 1.25 + random() * 2.06 : random() * 10.9 - 2.28;
      const vx = x * forward - z * sideways;
      const vz = z * forward + x * sideways;
      const vy = shear ? -(mist ? 2.7 + random() * 5.8 : 9.1 + random() * 12.4)
        : mist ? 0.35 + random() * 1.85 : 3.9 + random() * (pool ? 12.1 : 8.2);
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
      const size = mist ? width * (0.48 + random() * 1.42) * (shear ? 0.51 : 1) : 0.075 + random() ** 2 * 0.22;
      const opacity = mist ? (pool ? 0.33 : shear ? 0.12 : 0.25) * (0.66 + random() * 0.33)
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
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: time,
      uSun: { value: sun },
      uBillow: { value: mist ? billowTexture() : null },
      uSpray: { value: new THREE.Color(mist ? 0xe8f6f4 : 0xf3fef8) },
    },
    transparent: true, fog: true, depthWrite: false,
    vertexShader: /* glsl */`
      uniform float uTime;
      attribute vec3 aOrigin, aMotion;
      attribute vec4 aPlume;
      attribute vec2 aAspect;
      varying float vAlpha;
      varying vec2 vSprite;
      varying vec3 vPoint;
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
      uniform vec3 uSun, uSpray;
      uniform sampler2D uBillow;
      varying float vAlpha;
      varying vec2 vSprite;
      varying vec3 vPoint;
      #include <fog_pars_fragment>
      void main() {
        vec3 light = uSpray;
        #ifdef BILLOW
          float density = texture2D(uBillow, vSprite).r;
          // The same spray shows an arc only when seen near the antisolar angle.
          float scatter = dot(normalize(vPoint - cameraPosition), -uSun);
          float band = clamp((scatter - 0.731) / 0.061, 0.0, 1.0);
          vec3 spectrum = clamp(1.5 - abs(4.15 * band - vec3(0.30, 1.84, 3.31)), 0.0, 1.0);
          float rainbow = sin(band * 3.14159265) * smoothstep(0.02, 0.39, density);
          light = mix(light, 0.27 + spectrum * 0.81, rainbow * 0.65);
        #else
          float density = 1.0 - smoothstep(0.10, 0.96, length((vSprite - 0.5) * 2.0));
        #endif
        gl_FragColor = vec4(light, density * vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = mist ? 'Drifting waterfall spray and spectral scattering' : 'Ballistic cascade droplets';
  mesh.frustumCulled = false;
  mesh.renderOrder = mist ? 4 : 3;
  return mesh;
}

export function createWaterfalls(falls: CoastWaterfall[], time: THREE.IUniform<number>): {
  group: THREE.Group;
  update: (elapsed: number) => void;
} {
  const group = new THREE.Group();
  group.name = 'Waterfalls, drifting spray and rainbows';
  const current = currentMaterial(time);
  const sprays: SprayInputs[] = [];
  for (const [index, fall] of falls.entries()) {
    const { geometry, impacts } = createCascadeGeometry(fall, index);
    const water = new THREE.Mesh(geometry, current);
    water.name = 'Feeder runs and falling currents';
    water.renderOrder = 1;
    group.add(water, impactFoam(fall, time));
    for (const impact of impacts) sprays.push({ fall, impact });
  }
  group.add(sprayMesh(sprays, time, false), sprayMesh(sprays, time, true));
  return { group, update: elapsed => { time.value = elapsed; } };
}
