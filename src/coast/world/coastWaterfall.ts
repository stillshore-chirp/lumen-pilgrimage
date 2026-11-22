import * as THREE from 'three';
import { groundHeight, POOL, WATERFALL } from '../terrain';

export const FALL_IMPACT_Z = POOL.z - POOL.radiusZ * 0.82;

const WATER_VERTEX_SHADER = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

/** Place a curved curtain just in front of the cliff profile and below the pool's surface. */
export function createWaterfall(time: THREE.IUniform<number>): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const widthSegments = 24;
  const heightSegments = 28;
  const geometry = new THREE.PlaneGeometry(1, 1, widthSegments, heightSegments);
  const positions = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  const lipZ = WATERFALL.z - 2.1;
  const crestY = groundHeight(WATERFALL.x, lipZ) + 0.16;

  for (let vertex = 0; vertex < positions.count; vertex += 1) {
    const u = uvs.getX(vertex);
    const v = 1 - uvs.getY(vertex);
    const width = 7.0 + 3.6 * v + 0.42 * Math.sin(v * Math.PI * 2.1);
    const x = WATERFALL.x + (u - 0.5) * width + v * 0.7 + Math.sin(v * 5) * 0.22;
    const y = THREE.MathUtils.lerp(crestY + Math.sin(u * 5) * 0.19, POOL.y - 0.24, v);
    let cliff = lipZ;
    let air = FALL_IMPACT_Z + 2;
    for (let step = 0; step < 11; step += 1) {
      const midpoint = (cliff + air) * 0.5;
      if (groundHeight(x, midpoint) > y - 0.92) cliff = midpoint;
      else air = midpoint;
    }
    const fallArc = THREE.MathUtils.lerp(lipZ, FALL_IMPACT_Z, Math.pow(v, 0.82));
    const z = Math.max(air, fallArc) + Math.sin(v * Math.PI) * (0.39 + 0.13 * Math.sin(u * 14 + v * 3));
    positions.setXYZ(vertex, x, y, z);
    uvs.setY(vertex, v);
  }
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: time },
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorld;

      void main() {
        float u = vUv.x;
        float v = vUv.y;
        float drift = u + 0.021 * sin(v * 15.0 + u * 13.0 - uTime * 1.4)
          + 0.012 * sin(v * 28.0 - u * 9.0 - uTime * 4.1);
        float stream = 0.5 + 0.5 * sin(drift * 72.0 + sin(u * 23.0 + v * 8.0));
        float fineStream = 0.5 + 0.5 * sin(drift * 157.0 - v * 8.0);
        float rush = 0.5 + 0.5 * sin((v * 17.0 - uTime * 6.8)
          + 2.2 * sin(u * 38.0) + v * v * 11.0);
        float aeration = smoothstep(0.51, 0.90, stream * 0.39 + fineStream * 0.20 + rush * 0.41);
        float body = 0.56 + 0.30 * stream + 0.22 * rush;
        float edge = min(u, 1.0 - u);
        float feather = 0.10 + 0.046 * sin(v * 16.0 + uTime * 0.9 + u * 6.0);
        float opacity = smoothstep(0.0, feather, edge) * smoothstep(0.0, 0.11, v)
          * (1.0 - smoothstep(0.93, 1.0, v)) * body;

        vec3 water = mix(vec3(0.28, 0.48, 0.56), vec3(0.89, 0.97, 1.0), aeration);
        water += vec3(0.10, 0.13, 0.14) * smoothstep(0.58, 1.0, v);
        water = mix(water, vec3(0.45, 0.66, 0.77),
          smoothstep(110.0, 260.0, distance(cameraPosition, vWorld)) * 0.62);
        gl_FragColor = vec4(water, opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const waterfall = new THREE.Mesh(geometry, material);
  waterfall.name = 'Waterfall curtain';
  waterfall.renderOrder = 3;
  return waterfall;
}

export function createWaterfallPool(time: THREE.IUniform<number>): THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial> {
  const geometry = new THREE.CircleGeometry(1, 72);
  const positions = geometry.getAttribute('position');
  for (let vertex = 1; vertex < positions.count; vertex += 1) {
    const x = positions.getX(vertex);
    const y = positions.getY(vertex);
    const angle = Math.atan2(y, x);
    const bank = 1.09 + 0.06 * Math.sin(angle * 3) + 0.045 * Math.sin(angle * 7 + 1.7);
    positions.setXY(vertex, x * bank, y * bank);
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: time,
      uImpact: { value: new THREE.Vector2(WATERFALL.x, FALL_IMPACT_Z) },
    },
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec2 uImpact;
      varying vec2 vUv;
      varying vec3 vWorld;

      void main() {
        vec2 offset = vWorld.xz - uImpact;
        float dist = length(offset * vec2(0.76, 1.0));
        float cross = sin(dot(vWorld.xz, vec2(1.6, 2.6)) + uTime * 1.3);
        float smallRipples = sin(dot(vWorld.xz, vec2(-3.2, 3.8)) - uTime * 2.1 + cross);
        float ripples = sin(dist * 3.2 - uTime * 4.1 + cross * 0.28);
        float turbulent = 1.0 - smoothstep(1.8, 7.5, dist);
        float scatteredFoam = smoothstep(0.58, 0.97, ripples * (0.7 + smallRipples * 0.24));
        float edge = 1.0 - smoothstep(0.38, 0.55, length(vUv - 0.5));
        float grazing = 1.0 - normalize(cameraPosition - vWorld).y;
        vec3 water = mix(vec3(0.014, 0.128, 0.142), vec3(0.042, 0.34, 0.40),
          grazing * 0.53 + edge * 0.35 + cross * 0.06);
        water *= 0.94 + smallRipples * 0.07;
        water = mix(water, vec3(0.68, 0.94, 0.95), turbulent * (0.24 + scatteredFoam * 0.62));
        gl_FragColor = vec4(water, 0.70 + edge * 0.24);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const pool = new THREE.Mesh(geometry, material);
  pool.name = 'Waterfall pool';
  pool.rotation.x = -Math.PI / 2;
  pool.scale.set(POOL.radiusX, POOL.radiusZ, 1);
  pool.position.set(POOL.x, POOL.y, POOL.z);
  return pool;
}
