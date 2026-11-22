import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { CoastQuality } from '../CoastWorld';
import { groundHeight, UPLAND_FALL, UPLAND_LAKE, uplandLakeRadius } from '../terrain';
import { coastNoise } from './coastNoise';
import { coastWaterOptics } from './coastWaterOptics';

const lakeShader = {
  name: 'Upland lake, reflected sky and limestone shallows',
  uniforms: {
    ...THREE.UniformsLib.fog,
    tDiffuse: { value: null },
    color: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uLiveReflection: { value: 0 },
    uSun: { value: new THREE.Vector3() },
    uSpring: { value: new THREE.Vector2(UPLAND_FALL.impact.x, UPLAND_FALL.impact.z) },
  },
  vertexShader: `
    #include <common>
    #include <fog_pars_vertex>
    attribute float lakeDepth, lakeRadius;
    uniform mat4 textureMatrix;
    varying vec3 vWorld;
    varying vec4 vReflection;
    varying float vDepth, vRadius;
    void main() {
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vReflection = textureMatrix * vec4(position, 1.0);
      vDepth = lakeDepth;
      vRadius = lakeRadius;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: `
    #include <common>
    #include <fog_pars_fragment>
    uniform sampler2D tDiffuse;
    uniform float uTime, uLiveReflection;
    uniform vec3 uSun;
    uniform vec2 uSpring;
    varying vec3 vWorld;
    varying vec4 vReflection;
    varying float vDepth, vRadius;
    ${coastNoise}
    ${coastWaterOptics}
    void main() {
      if (vRadius > 1.0 || vDepth < -0.16) discard;
      vec2 p = vWorld.xz;
      float gust = coastNoise(p * 0.12 + uTime * vec2(0.075, -0.031));
      float rolling = sin(dot(p, vec2(0.81, 0.33)) - uTime * 0.95 + gust * 2.7);
      float fine = cos(dot(p, vec2(-0.51, 1.7)) + uTime * 0.79 + gust * 4.0);
      float pulse = sin(dot(p, vec2(1.61, -0.82)) - uTime * 1.25);
      vec2 ripple = vec2(rolling * 0.047 + fine * 0.023, fine * 0.041 + pulse * 0.029);
      vec3 normalToAir = normalize(vec3(ripple.x, 1.0, ripple.y));
      vec3 view = normalize(cameraPosition - vWorld);
      float facing = max(dot(normalToAir, view), 0.0);
      float fresnel = 0.026 + 0.974 * pow(1.0 - facing, 5.0);
      vec3 skyDirection = reflect(-view, normalToAir);
      float horizon = smoothstep(0.0, 0.64, skyDirection.y);
      float veil = coastNoise(skyDirection.xz * 4.8 + skyDirection.y * 2.8);
      vec3 sky = mix(vec3(0.48, 0.69, 0.76), vec3(0.12, 0.37, 0.61), horizon);
      sky = mix(sky, vec3(0.73, 0.85, 0.87), smoothstep(0.50, 0.83, veil) * 0.47);
      if (uLiveReflection > 0.0 && vReflection.w > 0.0) {
        vec2 uv = vReflection.xy / vReflection.w;
        uv += ripple * vec2(0.039, 0.064) * (0.6 + 0.7 * facing);
        float edge = smoothstep(0.0, 0.064, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
        sky = mix(sky, texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb, edge * 0.93);
      }
      float pathLength = max(vDepth, 0.0) / max(0.26, facing);
      vec3 sediment = mix(vec3(0.12, 0.32, 0.23), vec3(0.023, 0.20, 0.19), smoothstep(0.3, 12.0, pathLength));
      sediment *= 0.82 + 0.31 * gust + 0.085 * pow(max(0.0, rolling + fine * 0.34), 3.0);
      float sun = max(dot(skyDirection, uSun), 0.0);
      float glint = pow(sun, 149.0) * 0.56 + pow(sun, 28.0) * 0.10;
      vec2 spray = (p - uSpring) / vec2(8.2, 4.3);
      float foam = exp(-dot(spray, spray)) * smoothstep(0.37, 0.74, gust * 0.54 + 0.27 + pulse * 0.23);
      vec3 result = mix(sediment, sky, fresnel * 0.92);
      result += vec3(1.0, 0.90, 0.72) * glint;
      result = mix(result, vec3(0.67, 0.79, 0.75), foam * 0.61);
      float alpha = smoothstep(0.02, 0.26, vDepth) * clamp(0.21 + pathLength * 0.084 + fresnel * 0.79, 0.0, 0.97);
      if (!gl_FrontFacing) {
        vec3 throughWater;
        float transmission = waterTransmission(-view, normalToAir, throughWater);
        result = mix(vec3(0.054, 0.24, 0.22), vec3(0.37, 0.65, 0.65), transmission);
        alpha = 0.92;
      }
      gl_FragColor = vec4(result, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `,
};

export function createUplandLake(time: THREE.IUniform<number>, sun: THREE.Vector3) {
  const { x, z, width, length, level } = UPLAND_LAKE;
  const geometry = new THREE.PlaneGeometry(width * 2.28, length * 2.28, 112, 100);
  const position = geometry.getAttribute('position');
  const depth = new Float32Array(position.count);
  const radius = new Float32Array(position.count);
  for (let i = 0; i < position.count; i += 1) {
    const px = x + position.getX(i), pz = z - position.getY(i);
    depth[i] = level - groundHeight(px, pz);
    radius[i] = uplandLakeRadius(px, pz);
  }
  geometry.setAttribute('lakeDepth', new THREE.BufferAttribute(depth, 1));
  geometry.setAttribute('lakeRadius', new THREE.BufferAttribute(radius, 1));
  const mesh = new Reflector(geometry, {
    shader: lakeShader, textureWidth: 768, textureHeight: 512, multisample: 0, clipBias: 0.001,
  });
  mesh.name = 'Lake surface with actual reflected mountain and sky';
  mesh.position.set(x, level, z);
  mesh.rotation.x = -Math.PI / 2;
  const surface = mesh.material as THREE.ShaderMaterial;
  surface.side = THREE.DoubleSide;
  surface.transparent = true;
  surface.depthWrite = false;
  surface.forceSinglePass = true;
  surface.fog = true;
  surface.uniforms.uSun.value.copy(sun);
  surface.uniforms.uTime = time;

  const reflect = mesh.onBeforeRender;
  let lastReflection = -Infinity;
  mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
    if (!surface.uniforms.uLiveReflection.value || camera.position.y < level + 0.17
      || time.value - lastReflection < 0.125) return;
    lastReflection = time.value;
    reflect.call(mesh, renderer, scene, camera, geometry, material, group);
  };
  return {
    mesh,
    setQuality(quality: CoastQuality) {
      surface.uniforms.uLiveReflection.value = Number(quality === 'high');
      lastReflection = -Infinity;
    },
  };
}
