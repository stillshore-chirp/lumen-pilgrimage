import * as THREE from 'three';
import { coastRandom, SEA_LEVEL, type CoastWaterfall } from '../terrain';
import { coastNoise } from './coastNoise';

function mistTexture(): THREE.DataTexture {
  const size = 88;
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const x = col / (size - 1) * 2 - 1;
      const y = row / (size - 1) * 2 - 1;
      const r = Math.hypot(x + 0.045 * Math.sin(y * 11), y + 0.055 * Math.sin(x * 13));
      const edge = Math.max(0, 1 - r * 1.1);
      const billow = 0.82 + 0.10 * Math.sin(x * 16 + y * 13) + 0.064 * Math.cos(x * 28 - y * 24);
      data.set([242, 251, 255, Math.round(Math.pow(edge, 1.81) * billow * 255)], (row * size + col) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function curtainGeometry(fall: CoastWaterfall): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const cols = 12;
  const rows = fall.path.length;
  for (let row = 0; row < rows; row += 1) {
    const t = row / (rows - 1);
    const p = fall.path[row];
    for (let col = 0; col <= cols; col += 1) {
      const u = col / cols;
      const offset = (u - 0.5) * fall.width * (0.96 + 0.25 * t * t - 0.15 * Math.sin(t*Math.PI));
      const rippled = 0.23 * Math.sin(u*21.4 + t*2.8) + 0.12 * Math.sin(t*16.1 - u*12.8);
      positions.push(p.x - fall.direction.z*offset + fall.direction.x*rippled, p.y,
        p.z + fall.direction.x*offset + fall.direction.z*rippled);
      uvs.push(u, t);
      if (col === cols || row === rows - 1) continue;
      const i = row * (cols + 1) + col;
      indices.push(i, i + cols + 1, i + 1, i + 1, i + cols + 1, i + cols + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function curtainMaterial(time: THREE.IUniform<number>, offset: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: time,
      uOffset: { value: offset },
      uGlacier: { value: new THREE.Color(0x549fc6) },
      uWhite: { value: new THREE.Color(0xf3ffff) },
    },
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vDrop;
      #include <fog_pars_vertex>
      void main() {
        vDrop = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime,uOffset;
      uniform vec3 uGlacier,uWhite;
      varying vec2 vDrop;
      #include <fog_pars_fragment>
      ${coastNoise}
      void main() {
        float u = vDrop.x;
        float t = vDrop.y;
        float fall = sqrt(0.055 + t) * 36.0 - uTime * 8.45 + uOffset;
        float curl = coastNoise(vec2(u*5.6, t*8.2-uTime*1.74));
        float warp = (curl-0.5)*0.085 + 0.012*sin(fall*0.63);
        float strands = coastNoise(vec2((u+warp)*26.0, fall*0.42));
        float sheets = coastNoise(vec2((u+warp)*10.3, fall*0.19));
        float droplets = coastNoise(vec2((u+warp)*79.0, fall*1.83));
        float foam = smoothstep(0.17, 0.84, strands*0.45 + sheets*0.41 + droplets*0.14);
        float scattered = smoothstep(0.37, 0.89, droplets);
        float width = smoothstep(0.005, 0.105, u) * smoothstep(0.005, 0.105, 1.0-u);
        float feather = width * (0.78 + scattered*0.22);
        float lips = smoothstep(0.0,0.03,t) * (1.0 - smoothstep(0.94,1.02,t));
        vec3 water = mix(uGlacier, uWhite, 0.43 + 0.52*foam + 0.09*scattered);
        gl_FragColor = vec4(water, lips * feather * (0.46 + 0.49*foam));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

function rainbowTexture(): THREE.DataTexture {
  const size = 176;
  const rgb = [
    [119, 114, 255], [82, 157, 255], [72, 225, 237], [115, 242, 149],
    [231, 248, 140], [255, 213, 120], [251, 137, 111],
  ];
  const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const x = 2 * col / (size - 1) - 1;
      const y = 2 * row / (size - 1) - 0.60;
      const radius = Math.hypot(x + 0.09, y);
      const t = (radius - 0.64) / 0.132;
      const alpha = Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1))
        * THREE.MathUtils.smoothstep(y, 0.01, 0.19)
        * THREE.MathUtils.smoothstep(x, -0.82, -0.28)
        * (1 - THREE.MathUtils.smoothstep(x, 0.38, 0.7));
      const band = Math.min(rgb.length - 1, Math.max(0, Math.round(t * (rgb.length - 1))));
      pixels.set([...rgb[band], Math.round(alpha * 128)], (row * size + col) * 4);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createWaterfalls(falls: CoastWaterfall[], time: THREE.IUniform<number>): {
  group: THREE.Group;
  update: (elapsed: number) => void;
} {
  const group = new THREE.Group();
  group.name = 'Waterfalls, drifting spray and rainbows';
  const mist = mistTexture();
  const spectrum = rainbowTexture();
  const random = coastRandom(47957);
  const clouds: { sprite: THREE.Sprite; start: THREE.Vector3; size: number; phase: number; width: number }[] = [];
  for (const [index, fall] of falls.entries()) {
    const waterfall = new THREE.Mesh(curtainGeometry(fall), curtainMaterial(time, random()*19));
    waterfall.renderOrder = 1;
    group.add(waterfall);
    const base = fall.impact;
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(fall.width * 4.75, fall.width * 4.4),
      new THREE.MeshBasicMaterial({
        map: mist, color: 0xd0fbff, transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false,
      }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(base.x + 2.0*fall.direction.x, SEA_LEVEL + 0.036, base.z + 2.0*fall.direction.z);
    foam.renderOrder = 2;
    group.add(foam);
    for (let j = 0; j < 21; j += 1) {
      const size = fall.width * (0.78 + random()*2.08);
      const p = fall.path[fall.path.length - 1 - (j < 16 ? 0 : 3 + Math.floor(random()*6))];
      const reach = (random() - 0.5) * (j < 16 ? 2.9 : 0.7) * fall.width;
      const drift = 1 + random() * fall.width;
      const start = new THREE.Vector3(p.x - fall.direction.z*reach + fall.direction.x*drift,
        Math.max(p.y, 0.8 + size*0.23) + random()*size*0.42,
        p.z + fall.direction.x*reach + fall.direction.z*drift);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: mist, color: 0xf4fdff, transparent: true, opacity: 0.56,
        depthWrite: false, fog: true, toneMapped: false,
      }));
      sprite.renderOrder = 3;
      sprite.position.copy(start);
      sprite.scale.set(size*1.83, size, 1);
      clouds.push({ sprite, start, size, phase: random()*2*Math.PI, width: fall.width });
      group.add(sprite);
    }
    if (index < 2) {
      const rainbow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: spectrum, transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false, fog: true,
      }));
      rainbow.position.set(base.x + fall.direction.x*3, 7.8, base.z + fall.direction.z*3);
      rainbow.scale.set(fall.width*5.3, fall.width*5.0, 1);
      rainbow.renderOrder = 4;
      group.add(rainbow);
    }
  }
  return {
    group,
    update(elapsed) {
      for (const plume of clouds) {
        const phase = elapsed * 0.51 + plume.phase;
        const drift = Math.sin(phase) * plume.width * 0.37;
        plume.sprite.position.set(plume.start.x + drift, plume.start.y + Math.cos(phase*1.17)*plume.size*0.22,
          plume.start.z + Math.sin(phase - 0.8)*plume.width*0.29);
        plume.sprite.material.opacity = 0.48 + Math.sin(phase + 0.88)*0.16;
      }
    }
  };
}
