import * as THREE from 'three';
import { FOREST_STREAM, groundHeight, smoothstep } from '../terrain';
import { coastNoise } from './coastNoise';
import { coastWaterOptics, STREAM_WATER_SCATTER } from './coastWaterOptics';

export function createForestWater(time: THREE.IUniform<number>): THREE.Mesh {
  const positions: number[] = [];
  const depths: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const across = 14;
  let travelled = 0;

  function addRow(x: number, y: number, z: number, halfWidth: number, along: number): void {
    const drop = 1 - smoothstep(0.1, 2.4, Math.abs(x - 86.7));
    const chuteWidth = (1 - 0.26 * drop) * Math.max(0.025, halfWidth);
    for (let column = 0; column <= across; column += 1) {
      const span = column / across;
      const bank = z + (span * 2 - 1) * chuteWidth;
      const pitch = drop * (0.13 * Math.sin(span * 8.4 + x * 0.6) + 0.054 * Math.cos(span * 18.3)
        - 0.13 * (span * 2 - 1) ** 2);
      const level = y + 0.018 + pitch;
      positions.push(x, level, bank);
      depths.push(Math.max(0, level - groundHeight(x, bank)));
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
    side: THREE.DoubleSide, forceSinglePass: true,
  });
  const scatter = new THREE.Color(STREAM_WATER_SCATTER);
  material.onBeforeCompile = shader => {
    shader.uniforms.uForestWaterTime = time;
    shader.uniforms.uForestWaterScatter = { value: scatter };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float depthAtBank;
        varying vec3 vStreamPoint, vStreamNormal;
        varying vec2 vStreamUV;
        varying float vStreamDepth, vStreamSlope;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vStreamPoint = position;
        vStreamNormal = normal;
        vStreamUV = uv;
        vStreamDepth = depthAtBank;
        vStreamSlope = 1.0 - normal.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uForestWaterTime;
        uniform vec3 uForestWaterScatter;
        varying vec3 vStreamPoint, vStreamNormal;
        varying vec2 vStreamUV;
        varying float vStreamDepth, vStreamSlope;
        ${coastNoise}
        ${coastWaterOptics}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float brokenWater = smoothstep(0.12, 0.30, vStreamSlope);
        vec2 moving = vec2(vStreamUV.x + uForestWaterTime * 0.57, (vStreamUV.y - 0.5) * 7.0);
        float ripples = coastNoise(moving * vec2(1.27, 1.77));
        float thinWaves = sin(moving.x * 15.0 + moving.y * 3.1 + ripples * 3.7);
        float resolved = 1.0 - smoothstep(0.5, 3.2, fwidth(moving.x * 15.0));
        float waterHeightDetail = 0.006 * ripples + 0.0005 * thinWaves * resolved;

        float slide = vStreamUV.x + uForestWaterTime * 7.3;
        vec2 chute = vec2(slide, moving.y + 0.25 * ripples);
        float swirls = coastNoise(chute * vec2(1.0, 2.5));
        float strands = coastNoise(chute * vec2(0.72, 7.2) + swirls * 0.39);
        float flecks = coastNoise(chute * vec2(4.9, 14.0));
        float runFoam = smoothstep(0.20, 0.81, swirls * 0.44 + strands * 0.38 + flecks * 0.18);
        float cascade = (0.17 + 0.83 * runFoam) * brokenWater;
        vec2 fromImpact = (vStreamPoint.xz - vec2(84.85, 297.1)) / vec2(2.68, 1.72);
        float splash = exp(-dot(fromImpact, fromImpact)) * (0.31 + 0.45 * swirls + 0.24 * flecks);
        float frayed = smoothstep(0.017 + 0.042 * swirls, 0.12 + 0.052 * strands, min(vStreamUV.y, 1.0 - vStreamUV.y));
        float bank = 1.0 - smoothstep(0.08, 0.32, min(vStreamUV.y, 1.0 - vStreamUV.y));
        float coverage = smoothstep(0.015, 0.14, vStreamDepth);
        float trace = 0.14 * bank * smoothstep(0.54, 0.87, coastNoise(moving * vec2(0.98, 6.51)));
        float foam = clamp(cascade * (0.60 + 0.35 * flecks) + splash * 0.83 + trace, 0.0, 1.0);
        vec3 view = normalize(cameraPosition - vStreamPoint);
        float fresnel = pow(1.0 - clamp(dot(view, normalize(vStreamNormal)) + (ripples - 0.5) * 0.12, 0.0, 1.0), 4.0);
        vec3 bottomTint = mix(vec3(0.08, 0.20, 0.125), vec3(0.017, 0.12, 0.097),
          smoothstep(0.02, 1.05, vStreamDepth));
        vec3 skyTint = mix(vec3(0.10, 0.19, 0.155), vec3(0.36, 0.51, 0.58), ripples * ripples);
        diffuseColor.rgb = mix(mix(bottomTint, skyTint, fresnel), vec3(0.75, 0.88, 0.85), foam);
        diffuseColor.a *= coverage * mix(1.0, frayed, brokenWater) * min(0.95, 0.19 + 0.48 * fresnel + 0.74 * foam);
        vec3 streamUnderside = vec3(0.0);
        if (!gl_FrontFacing) {
          vec3 normalToAir = normalize(vStreamNormal + vec3(0.15 * (0.5 - ripples), 0.0, 0.035 * thinWaves * resolved));
          vec3 airRay;
          float transmission = waterTransmission(-view, normalToAir, airRay);
          float opening = smoothstep(0.23, 0.88, airRay.y);
          float crowns = coastNoise(airRay.xz * 9.2 + vStreamPoint.xz * 0.023);
          vec3 canopy = mix(vec3(0.065, 0.15, 0.063), vec3(0.45, 0.66, 0.46), smoothstep(0.25, 0.83, crowns));
          vec3 sky = mix(canopy, vec3(0.37, 0.58, 0.68), opening);
          vec3 bounce = reflect(-view, -normalToAir);
          float bedPath = vStreamDepth / max(0.06, -bounce.y);
          vec3 reflected = mix(uForestWaterScatter * 0.68, bottomTint * (0.8 + 0.5 * ripples),
            underwaterExtinction(bedPath));
          streamUnderside = mix(mix(reflected, sky, transmission), vec3(0.49, 0.65, 0.54), foam * 0.63);
          diffuseColor.a = coverage;
        }
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.19, 0.24, 0.23) * foam * max(brokenWater, splash);
      `)
      .replace('#include <normal_fragment_maps>',  `#include <normal_fragment_maps>
        vec3 waterTangentX = dFdx(-vViewPosition);
        vec3 waterTangentY = dFdy(-vViewPosition);
        vec3 waterCrossX = cross(waterTangentY, normal);
        vec3 waterCrossY = cross(normal, waterTangentX);
        float determinant = dot(waterTangentX, waterCrossX);
        vec3 gradient = sign(determinant) * (dFdx(waterHeightDetail) * waterCrossX + dFdy(waterHeightDetail) * waterCrossY);
        normal = normalize(max(abs(determinant), 0.000001) * normal - gradient);
      `)
      .replace('#include <opaque_fragment>', `
        if (!gl_FrontFacing) outgoingLight = streamUnderside;
        #include <opaque_fragment>
      `)
      .replace('#include <tonemapping_fragment>', `#include <tonemapping_fragment>
        if (!gl_FrontFacing) gl_FragColor.rgb = mix(uForestWaterScatter, gl_FragColor.rgb,
          underwaterExtinction(length(cameraPosition - vStreamPoint)));
      `);
  };
  const water = new THREE.Mesh(geometry, material);
  water.name = 'Forest stream, ford and headwater cascade';
  water.receiveShadow = true;
  return water;
}
