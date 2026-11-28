import * as THREE from 'three';
import type { CorridorRoad } from './overlookCorridorPlan';

export const ROAD_LAMP_SPACING = 78;

export const ROAD_LAMP_TINT = /* glsl */`
  vec3 roadLampTint(vec2 xz) {
    float district = sin(dot(xz, vec2(0.0016, 0.0007))) * cos(xz.y * 0.0019);
    float warmth = smoothstep(-0.65, 0.65, district);
    return mix(vec3(1.0, 0.84, 0.55), vec3(1.0, 0.57, 0.19), warmth);
  }
`;

export function createOverlookRoadSurface(roads: readonly CorridorRoad[], night: THREE.IUniform<number>, high: THREE.IUniform<number>) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  const laneStyles: number[] = [];
  const walls: number[] = [], wallIndices: number[] = [];
  const columns = [-1, 0, 1];
  for (const { plan, frames, originalOffset } of roads) {
    const base = positions.length / 3;
    const wallBase = walls.length / 3;
    for (const [i, { x, z, nx, nz }] of frames.entries()) {
      for (const fraction of columns) {
        const offset = fraction * plan.halfWidth;
        positions.push(x + nx * offset, frames[i].y - 0.42 * Math.abs(fraction), z + nz * offset);
        uv.push(fraction, frames[i].station - originalOffset);
        laneStyles.push(Number(plan.lanes === 2));
      }
      for (const side of [-1, 1]) {
        const offset = side * plan.halfWidth;
        walls.push(x + nx * offset, frames[i].y + 0.28, z + nz * offset,
          x + nx * offset, frames[i].y - 3.52, z + nz * offset);
      }
      if (i === 0) continue;
      const stride = columns.length;
      for (let c = 0; c < stride - 1; c += 1) {
        const a = base + (i - 1) * stride + c, b = a + stride;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const a = wallBase + (i - 1) * 4, b = a + 4;
      wallIndices.push(b, b + 1, a + 1, b, a + 1, a, a + 2, a + 3, b + 3, a + 2, b + 3, b + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('laneStyle', new THREE.Float32BufferAttribute(laneStyles, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({ roughness: 0.87 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uRoadNight = night;
    shader.uniforms.uRoadHigh = high;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float laneStyle;
      varying vec2 vTrafficUv;
      varying vec2 vRoadXZ;
      varying float vLaneStyle;
    `).replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrafficUv = uv;\nvRoadXZ = position.xz;\nvLaneStyle = laneStyle;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRoadNight;
        uniform float uRoadHigh;
        varying vec2 vTrafficUv;
        varying vec2 vRoadXZ;
        varying float vLaneStyle;
        ${ROAD_LAMP_TINT}
        float paintLine(float center, float width, float feather) {
          float lateral = abs(vTrafficUv.x) - center;
          return smoothstep(-width - feather, -width + feather, lateral)
            - smoothstep(width - feather, width + feather, lateral);
        }
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float lateral = abs(vTrafficUv.x);
        float chainage = vTrafficUv.y;
        float feather = max(0.008, fwidth(vTrafficUv.x) * 0.45);
        vec3 asphalt = vec3(0.062, 0.069, 0.075) * (0.95 + 0.05 * sin(chainage * 0.17));
        vec3 shoulder = vec3(0.18, 0.16, 0.126);
        diffuseColor.rgb = mix(asphalt, shoulder, smoothstep(0.83, 0.97, lateral));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.115, 0.113, 0.08), 1.0 - smoothstep(0.06, 0.102, lateral));
        float dash = 1.0 - smoothstep(0.15, 0.20, abs(fract(chainage / 30.0) - 0.5));
        float fadeDashes = 1.0 - smoothstep(7.0, 20.0, fwidth(chainage));
        float edge = paintLine(0.79, 0.011, feather) * 0.67;
        float median = paintLine(0.116, 0.011, feather) * 0.61;
        float lanes = max(paintLine(0.33, 0.014, feather), paintLine(0.55, 0.014, feather));
        lanes = mix(lanes, paintLine(0.44, 0.014, feather), vLaneStyle);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.47, 0.49, 0.49), max(edge, lanes * dash * fadeDashes));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.51, 0.36, 0.14), median);
        if (uRoadHigh > 0.0) {
          // Recessed gutters and a lighter concrete leading edge read as separate surfaces.
          float gutter = paintLine(0.855, 0.048, feather) + paintLine(0.101, 0.024, feather) * 0.45;
          float coping = paintLine(0.958, 0.029, feather);
          diffuseColor.rgb *= 1.0 - gutter * 0.48;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.25, 0.226, 0.184), coping * 0.69);
        }
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uRoadNight > 0.0) {
          float station = chainage / ${ROAD_LAMP_SPACING.toFixed(1)};
          float fromLamp = abs(fract(station - step(0.0, vTrafficUv.x) * 0.5) - 0.5);
          float lightAcross = (lateral - 0.68) / 0.36;
          // Average neighboring pools when a projected pixel spans an entire lamp interval.
          float along = mix(exp(-fromLamp * fromLamp * 12.0), 0.51, smoothstep(0.35, 1.2, fwidth(station)));
          float roadPool = exp(-lightAcross * lightAcross * 1.45) * along;
          float edgeReflection = (lateral - 0.84) * 7.0;
          float distanceLift = smoothstep(3800.0, 13800.0, length(vViewPosition));
          float reflection = roadPool * mix(0.27, 0.40, distanceLift) + exp(-edgeReflection * edgeReflection) * 0.054;
          if (uRoadHigh > 0.0) {
            float nearLamp = fromLamp * 5.4;
            float across = (lateral - 0.72) * 3.9;
            float diffusePool = exp(-nearLamp * nearLamp - across * across);
            float resolved = 1.0 - smoothstep(0.23, 0.78, fwidth(station));
            float gutter = paintLine(0.855, 0.048, feather);
            reflection = mix(reflection, reflection * (0.55 - 0.18 * gutter) + diffusePool * 0.18, resolved);
          }
          totalEmissiveRadiance += uRoadNight * reflection * roadLampTint(vRoadXZ);
        }
      `);
  };
  const surface = new THREE.Mesh(geometry, material);
  surface.name = 'Asphalt, lane markings, and streetlight reflections';
  const wallGeometry = new THREE.BufferGeometry();
  wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(walls, 3));
  wallGeometry.setIndex(wallIndices);
  wallGeometry.computeVertexNormals();
  const fascias = new THREE.Mesh(wallGeometry, new THREE.MeshStandardMaterial({ color: 0x918979, roughness: 0.92 }));
  fascias.name = 'Concrete viaduct fascias';
  return { surface, fascias };
}
