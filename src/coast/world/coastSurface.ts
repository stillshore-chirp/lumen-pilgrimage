import * as THREE from 'three';
import { COAST_BOUNDS, LANDSCAPE_BOUNDS, coastTrailDistance, groundHeight, smoothstep } from '../terrain';
import { coastNoise } from './coastNoise';

export function loadCoastTexture(file: string, repeat = false): THREE.Texture {
  const texture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}coast-materials/${file}`);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function terrainAxis(start: number, end: number, playStart: number, playEnd: number,
  detailedStart: number, detailedEnd: number): number[] {
  const result = [start];
  let value = start;
  while (value < end) {
    const step = value >= detailedStart && value < detailedEnd ? 1.17
      : value < playStart || value >= playEnd ? 6.6 : 2.55;
    value = Math.min(value + step, end);
    result.push(value);
  }
  return result;
}

export function createCoastTerrain(
  rock: THREE.Texture, sand: THREE.Texture, canopy: THREE.Texture
): THREE.Mesh {
  const { minX, maxX, minZ, maxZ } = LANDSCAPE_BOUNDS;
  const xs = terrainAxis(minX, maxX, COAST_BOUNDS.minX, COAST_BOUNDS.maxX, -162, 149);
  const zs = terrainAxis(minZ, maxZ, COAST_BOUNDS.minZ, COAST_BOUNDS.maxZ, -17, 127);
  const positions = new Float32Array(xs.length * zs.length * 3);
  const trail = new Float32Array(xs.length * zs.length);
  const indices = new Uint32Array((xs.length - 1) * (zs.length - 1) * 6);
  let offset = 0;
  for (const z of zs) {
    for (const x of xs) {
      trail[offset / 3] = 1 - smoothstep(0.87, 2.95, coastTrailDistance(x, z));
      positions[offset++] = x;
      positions[offset++] = groundHeight(x, z);
      positions[offset++] = z;
    }
  }
  offset = 0;
  for (let row = 0; row < zs.length - 1; row += 1) {
    for (let col = 0; col < xs.length - 1; col += 1) {
      const a = row * xs.length + col;
      const next = a + xs.length;
      indices[offset++] = a;
      indices[offset++] = next;
      indices[offset++] = a + 1;
      indices[offset++] = a + 1;
      indices[offset++] = next;
      indices[offset++] = next + 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('coastTrail', new THREE.BufferAttribute(trail, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const surface = new THREE.MeshStandardMaterial({ roughness: 0.91 });
  surface.onBeforeCompile = shader => {
    shader.uniforms.uStone = { value: rock };
    shader.uniforms.uSand = { value: sand };
    shader.uniforms.uCanopy = { value: canopy };
    shader.uniforms.uGrayStone = { value: new THREE.Color(0x596e90) };
    shader.uniforms.uLitStone = { value: new THREE.Color(0xcbc3a6) };
    shader.uniforms.uWetSand = { value: new THREE.Color(0xaf9472) };
    shader.uniforms.uDrySand = { value: new THREE.Color(0xe7cfa0) };
    shader.uniforms.uForestFloor = { value: new THREE.Color(0x668656) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float coastTrail;
        varying float vTrail;
        varying vec3 vCoastPoint;
        varying vec3 vCoastNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTrail = coastTrail;
        vCoastPoint = position;
        vCoastNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vTrail;
        varying vec3 vCoastPoint;
        varying vec3 vCoastNormal;
        uniform sampler2D uStone;
        uniform sampler2D uSand;
        uniform sampler2D uCanopy;
        uniform vec3 uGrayStone, uLitStone, uWetSand, uDrySand, uForestFloor;

        ${coastNoise}
        vec3 surfaceProjection(sampler2D materialMap, vec3 p, vec3 n) {
          vec3 w = pow(abs(n), vec3(5.0));
          w /= w.x + w.y + w.z;
          return texture2D(materialMap, p.zy).rgb * w.x
            + texture2D(materialMap, p.xz).rgb * w.y
            + texture2D(materialMap, p.xy).rgb * w.z;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 p = vCoastPoint;
        vec3 n = normalize(vCoastNormal);
        float broad = coastNoise(p.xz * 0.068);
        float rocky = 1.0 - smoothstep(0.58, 0.88, n.y + 0.11 * (broad - 0.5));
        float pocket = coastNoise(p.xz * 0.143 + p.y * 0.083)
          + coastNoise(p.xz * 0.36 - p.y * 0.18) * 0.24;
        float green = smoothstep(2.1, 6.8, p.y + 2.5 * (broad - 0.5));
        float moss = smoothstep(0.68, 1.08, pocket) * smoothstep(6.0, 20.0, p.y);
        green *= (1.0 - rocky * (0.96 - moss * 0.77));

        vec3 scale = vec3(0.109, 0.071, 0.109);
        vec3 stone = surfaceProjection(uStone, p * scale + broad * 0.08, n);
        float grit = dot(stone, vec3(0.28, 0.59, 0.13));
        float band = coastNoise(vec2((p.x - p.z * 0.75 + p.y * 0.21) * 0.46, p.y * 0.04));
        float seam = smoothstep(0.64, 0.86, band);
        float strata = coastNoise(vec2(p.y * 0.31 + p.x * 0.047, p.z * 0.11));
        vec3 cliff = stone * mix(uGrayStone, uLitStone, broad * 0.61 + strata * 0.38) * 1.72;
        cliff *= (0.60 + 0.53 * band - 0.34 * seam) * (0.72 + 0.28 * smoothstep(0.0, 3.8, p.y));

        vec3 grains = texture2D(uSand, p.xz * 0.42).rgb;
        float smallRipple = 0.91 + 0.13*coastNoise(vec2(p.x*0.39, p.z*2.1 + sin(p.x*0.57)*0.38));
        vec3 sand = mix(uDrySand, grains * vec3(2.20, 2.09, 1.97), 0.62) * smallRipple;
        float wash = smoothstep(-0.35, 1.05, p.y);
        sand = mix(sand * uWetSand * 1.65, sand, wash) * (0.87 + 0.20 * broad);
        vec3 litter = surfaceProjection(uCanopy, p * 0.53, n);
        vec3 soil = mix(uForestFloor * (0.34 + broad * 0.46), litter * 1.09, 0.43);
        vec3 terrain = mix(mix(sand, cliff, rocky), soil, green);
        float worn = smoothstep(0.12, 0.96, vTrail + (pocket - 0.55) * 0.37);
        worn *= smoothstep(0.5, 2.3, p.y);
        vec3 gravel = mix(sand*0.55, cliff*1.62, 0.44 + broad*0.31);
        diffuseColor.rgb *= mix(terrain, gravel, worn * 0.86);
        float relief = rocky * (grit*0.54 + band*0.24 - seam*0.079) + (1.0-rocky)*dot(sand,vec3(0.3))*0.02;
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 coastTangentX = dFdx(-vViewPosition);
        vec3 coastTangentY = dFdy(-vViewPosition);
        vec3 coastCrossX = cross(coastTangentY, normal);
        vec3 coastCrossY = cross(normal, coastTangentX);
        float coastDet = dot(coastTangentX, coastCrossX) * faceDirection;
        vec3 coastGradient = sign(coastDet) * (dFdx(relief)*coastCrossX + dFdy(relief)*coastCrossY);
        normal = normalize(max(abs(coastDet), 0.000001)*normal - coastGradient);
      `);
  };
  const terrain = new THREE.Mesh(geometry, surface);
  terrain.name = 'Bay terrain, sea bed and escarpments';
  terrain.castShadow = true;
  terrain.receiveShadow = true;
  return terrain;
}
