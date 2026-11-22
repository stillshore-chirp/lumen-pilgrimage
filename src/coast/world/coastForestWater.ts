import * as THREE from 'three';
import { FOREST_STREAM, groundHeight } from '../terrain';
import { coastNoise } from './coastNoise';

export function createForestWater(time: THREE.IUniform<number>): THREE.Mesh {
  const positions: number[] = [];
  const depths: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const across = 14;
  let travelled = 0;

  function addRow(x: number, y: number, z: number, halfWidth: number, along: number): void {
    for (let column = 0; column <= across; column += 1) {
      const span = column / across;
      const bank = z + (span * 2 - 1) * Math.max(0.025, halfWidth);
      const drop = Math.max(0, 1 - Math.abs((x - 86.7) / 2.2));
      const pitch = drop * (0.32 * Math.sin(span * 8.4 + x * 0.6) + 0.18 * Math.cos(span * 14.1));
      positions.push(x, y + 0.018 + pitch, bank);
      depths.push(Math.max(0, y - groundHeight(x, bank)));
      uvs.push(along, span);
    }
    const row = depths.length / (across + 1) - 1;
    if (row === 0) return;
    for (let column = 0; column < across; column += 1) {
      const next = row * (across + 1) + column;
      const previous = next - across - 1;
      indices.push(previous, previous + 1, next, next, previous + 1, next + 1);
    }
  }

  for (let index = 1; index < FOREST_STREAM.length; index += 1) {
    const a = FOREST_STREAM[index - 1];
    const b = FOREST_STREAM[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const count = Math.ceil(length / 0.42);
    for (let step = 0; step < count; step += 1) {
      const t = step / count;
      addRow(THREE.MathUtils.lerp(a.x, b.x, t), THREE.MathUtils.lerp(a.y, b.y, t),
        THREE.MathUtils.lerp(a.z, b.z, t), THREE.MathUtils.lerp(a.halfWidth, b.halfWidth, t), travelled + length * t);
    }
    travelled += length;
  }
  const end = FOREST_STREAM[FOREST_STREAM.length - 1];
  addRow(end.x, end.y, end.z, end.halfWidth, travelled);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('depthAtBank', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.29, specularIntensity: 0.34, transparent: true, depthWrite: false,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uForestWaterTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float depthAtBank;
        varying vec3 vStreamPoint;
        varying vec2 vStreamUV;
        varying float vStreamDepth, vStreamSlope;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vStreamPoint = position;
        vStreamUV = uv;
        vStreamDepth = depthAtBank;
        vStreamSlope = 1.0 - normal.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uForestWaterTime;
        varying vec3 vStreamPoint;
        varying vec2 vStreamUV;
        varying float vStreamDepth, vStreamSlope;
        ${coastNoise}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float brokenWater = smoothstep(0.12, 0.30, vStreamSlope);
        vec2 moving = vec2(vStreamUV.x + uForestWaterTime * 0.57, (vStreamUV.y - 0.5) * 7.0);
        float ripples = coastNoise(moving * vec2(1.27, 1.77));
        float thinWaves = sin(moving.x * 15.0 + moving.y * 3.1 + ripples * 3.7);
        float resolved = 1.0 - smoothstep(0.5, 3.2, fwidth(moving.x * 15.0));
        float waterHeightDetail = 0.006 * ripples + 0.0005 * thinWaves * resolved;

        vec2 chute = vec2(vStreamUV.x * 1.8 + uForestWaterTime * 6.9, moving.y * 5.4 + ripples * 0.5);
        float strands = coastNoise(vec2(chute.x * 0.28, chute.y * 1.9));
        float flecks = coastNoise(chute * vec2(1.24, 1.48));
        float cascade = smoothstep(0.36, 0.78, strands * 0.67 + flecks * 0.33) * brokenWater;
        vec2 fromImpact = (vStreamPoint.xz - vec2(84.85, 297.1)) / vec2(2.68, 1.72);
        float splash = exp(-dot(fromImpact, fromImpact)) * (0.30 + 0.70 * flecks);
        float bank = 1.0 - smoothstep(0.08, 0.32, min(vStreamUV.y, 1.0 - vStreamUV.y));
        float coverage = smoothstep(0.015, 0.14, vStreamDepth);
        float trace = 0.14 * bank * smoothstep(0.54, 0.87, coastNoise(moving * vec2(0.98, 6.51)));
        float foam = clamp(cascade * (0.52 + 0.43 * flecks) + splash * 0.71 + trace, 0.0, 1.0);
        vec3 view = normalize(cameraPosition - vStreamPoint);
        float fresnel = pow(1.0 - clamp(view.y + (ripples - 0.5) * 0.12, 0.0, 1.0), 4.0);
        vec3 bottomTint = mix(vec3(0.08, 0.20, 0.125), vec3(0.017, 0.12, 0.097),
          smoothstep(0.02, 1.05, vStreamDepth));
        vec3 skyTint = mix(vec3(0.10, 0.19, 0.155), vec3(0.36, 0.51, 0.58), ripples * ripples);
        diffuseColor.rgb = mix(mix(bottomTint, skyTint, fresnel), vec3(0.75, 0.88, 0.85), foam);
        diffuseColor.a *= coverage * min(0.95, 0.19 + 0.51 * fresnel + 0.69 * foam);
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 waterTangentX = dFdx(-vViewPosition);
        vec3 waterTangentY = dFdy(-vViewPosition);
        vec3 waterCrossX = cross(waterTangentY, normal);
        vec3 waterCrossY = cross(normal, waterTangentX);
        float determinant = dot(waterTangentX, waterCrossX);
        vec3 gradient = sign(determinant) * (dFdx(waterHeightDetail) * waterCrossX + dFdy(waterHeightDetail) * waterCrossY);
        normal = normalize(max(abs(determinant), 0.000001) * normal - gradient);
      `);
  };
  const water = new THREE.Mesh(geometry, material);
  water.name = 'Forest stream, ford and headwater cascade';
  water.receiveShadow = true;
  return water;
}
