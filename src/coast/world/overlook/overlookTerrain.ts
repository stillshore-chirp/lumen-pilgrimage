import * as THREE from 'three';
import { coastNoise } from '../coastNoise';

export const DECK_LEVEL = 346;
export const DECK_FRONT = -24;
export const DECK_SIDE = 35;
const DATA_FOLDER = `${import.meta.env.BASE_URL}coast-overlook/`;
const HEADER_BYTES = 24;
const FRONT_FOOTING = DECK_FRONT - 0.45;
const SIDE_FOOTING = DECK_SIDE + 0.45;

interface ElevationGrid {
  readonly data: DataView;
  readonly width: number;
  readonly height: number;
  readonly west: number;
  readonly north: number;
  readonly dx: number;
  readonly dz: number;
}

async function loadElevation(file: string): Promise<ElevationGrid> {
  const response = await fetch(DATA_FOLDER + file);
  if (!response.ok) throw new Error('Could not fetch the overlook terrain.');
  const data = new DataView(await response.arrayBuffer());
  if (data.byteLength < HEADER_BYTES || data.getUint32(0) !== 0x48494c4c) throw new Error('Invalid elevation grid.');
  const width = data.getUint16(4, true), height = data.getUint16(6, true);
  const west = data.getFloat32(8, true), north = data.getFloat32(12, true);
  const dx = data.getFloat32(16, true), dz = data.getFloat32(20, true);
  if (width < 2 || height < 2 || data.byteLength !== HEADER_BYTES + width * height * 2
    || ![west, north, dx, dz].every(Number.isFinite) || dx <= 0 || dz <= 0) {
    throw new Error('Invalid elevation grid dimensions.');
  }
  return { data, width, height, west, north, dx, dz };
}

function elevation(grid: ElevationGrid, x: number, z: number): number {
  const column = THREE.MathUtils.clamp((x - grid.west) / grid.dx, 0, grid.width - 1);
  const row = THREE.MathUtils.clamp((grid.north - z) / grid.dz, 0, grid.height - 1);
  const left = Math.min(Math.floor(column), grid.width - 2);
  const top = Math.min(Math.floor(row), grid.height - 2);
  const offset = HEADER_BYTES + (top * grid.width + left) * 2;
  const east = column - left, south = row - top;
  const upper = THREE.MathUtils.lerp(grid.data.getInt16(offset, true), grid.data.getInt16(offset + 2, true), east);
  const lowerOffset = offset + grid.width * 2;
  const lower = THREE.MathUtils.lerp(grid.data.getInt16(lowerOffset, true), grid.data.getInt16(lowerOffset + 2, true), east);
  return THREE.MathUtils.lerp(upper, lower, south) * 0.25;
}

export async function loadOverlookTerrain(): Promise<(x: number, z: number) => number> {
  const [regional, nearby] = await Promise.all([loadElevation('overlook-elevation.bin'), loadElevation('overlook-detail.bin')]);
  return (x, z) => {
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge >= 1030) return elevation(regional, x, z);
    let h = elevation(nearby, x, z);
    if (edge > 810) {
      h = THREE.MathUtils.lerp(h, elevation(regional, x, z), THREE.MathUtils.smoothstep(edge, 810, 1030));
    }
    const side = Math.max(Math.abs(x) - SIDE_FOOTING, 0);
    const front = Math.max(FRONT_FOOTING - z, 0);
    const rear = Math.max(z - 30.9, 0);
    const terraceEdge = Math.hypot(side, front, rear);
    const foundation = DECK_LEVEL - 0.35;
    const apron = THREE.MathUtils.lerp(foundation, h, THREE.MathUtils.smoothstep(terraceEdge, 0, 20));

    // A short, steep cut at the retaining wall turns into a gentler slope below the terrace.
    const distance = Math.hypot(side, front);
    const run = THREE.MathUtils.lerp(Math.max(side, front), distance, THREE.MathUtils.smoothstep(distance, 6, 20));
    const cut = foundation - 12.5 * (1 - Math.exp(-run * 0.36))
      - 23 * (1 - Math.exp(-run * 0.026)) - 0.30 * run;
    const southFace = 1 - THREE.MathUtils.smoothstep(z, -11, 6);
    const surveyBlend = 1 - THREE.MathUtils.smoothstep(run, 330, 780);
    return THREE.MathUtils.lerp(apron, Math.min(apron, cut), southFace * surveyBlend);
  };
}

function terrainAxis(minimum: number, maximum: number): number[] {
  const coordinates = [minimum];
  let cursor = minimum;
  const bands = [-4800, -1150, -205, -50, 50, 205, 1150, 4800, maximum];
  for (const edge of bands) {
    while (cursor < edge) {
      const farthest = Math.max(Math.abs(edge), Math.abs(cursor));
      const step = farthest <= 50 ? 2.5 : farthest <= 205 ? 5 : farthest <= 1150 ? 19 : farthest <= 4800 ? 65 : 235;
      cursor = Math.min(cursor + step, edge);
      coordinates.push(cursor);
    }
  }
  return coordinates;
}

export function createOverlookSurface(
  heightAt: (x: number, z: number) => number, streets: { texture: THREE.Texture; bounds: THREE.Vector4 },
  night: THREE.IUniform<number>, high?: THREE.IUniform<number>,
): THREE.Mesh {
  const xs = terrainAxis(-23000, 23000), zs = terrainAxis(-26000, 11000);
  // Sample the top and toe of the cut independently of the regular grid.
  xs.push(-SIDE_FOOTING - 1.4, -SIDE_FOOTING, SIDE_FOOTING, SIDE_FOOTING + 1.4);
  zs.push(FRONT_FOOTING - 1.4, FRONT_FOOTING);
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const positions = new Float32Array(xs.length * zs.length * 3);
  const colors = new Float32Array(positions.length);
  const indices = new Uint32Array((xs.length - 1) * (zs.length - 1) * 6);
  const scrub = new THREE.Color(0x79754b);
  const drySoil = new THREE.Color(0xad956c);
  const shale = new THREE.Color(0xa69b82);
  const sea = new THREE.Color(0x4e758b);
  const ground = new THREE.Color();
  let offset = 0;
  for (const z of zs) {
    for (const x of xs) {
      const y = heightAt(x, z);
      const low = THREE.MathUtils.smoothstep(y, 0, 6);
      const fold = Math.sin(x * 0.012 + Math.sin(z * 0.017)) * Math.cos(z * 0.014 - x * 0.007);
      const greens = Math.sin(x * 0.0022 + z * 0.0013) * Math.cos(z * 0.0031 - x * 0.0009);
      const rock = THREE.MathUtils.smoothstep(y - 76 * fold, 380, 750);
      ground.copy(scrub).lerp(drySoil, 0.35 + 0.18 * greens + 0.12 * fold).lerp(shale, rock * 0.65);
      if (low < 1) ground.lerp(sea, 1 - low);
      positions.set([x, y, z], offset);
      ground.toArray(colors, offset);
      offset += 3;
    }
  }
  offset = 0;
  for (let row = 0; row + 1 < zs.length; row += 1) {
    for (let col = 0; col + 1 < xs.length; col += 1) {
      const a = row * xs.length + col, b = a + xs.length;
      indices.set([a, b, a + 1, b, b + 1, a + 1], offset);
      offset += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  material.customProgramCacheKey = () => high ? 'overlook-terrain-detail' : 'overlook-terrain';
  material.onBeforeCompile = shader => {
    if (high) shader.uniforms.uHillHigh = high;
    shader.uniforms.uStreets = { value: streets.texture };
    shader.uniforms.uStreetBounds = { value: streets.bounds };
    shader.uniforms.uHillNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vHillPoint;
        ${high ? 'varying float vHillSteepness;' : ''}
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vHillPoint = position;
        ${high ? 'vHillSteepness = 1.0 - normal.y;' : ''}
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vHillPoint;
        uniform sampler2D uStreets;
        uniform vec4 uStreetBounds;
        uniform float uHillNight;
        ${high ? 'uniform float uHillHigh; varying float vHillSteepness;' : ''}
        ${coastNoise}
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 streetUv = (vHillPoint.xz - uStreetBounds.xy) / uStreetBounds.zw;
        vec3 cityGround = texture2D(uStreets, streetUv).rgb;
        float hillDistance = length(vViewPosition);
        float soilDetail = 1.0 - smoothstep(35.0, 180.0, hillDistance);
        vec2 soil = vHillPoint.xz;
        float rockyPatch = smoothstep(0.35, 0.72, coastNoise(soil * 0.41));
        float chips = coastNoise(soil * 4.2) * 0.68 + coastNoise(soil * 13.4) * 0.32;
        float paleGravel = rockyPatch * smoothstep(0.32, 0.77, chips);
        diffuseColor.rgb = mix(diffuseColor.rgb * (0.88 + 0.22 * chips), vec3(0.36, 0.30, 0.21),
          soilDetail * paleGravel * 0.58);
        float planting = coastNoise(soil * 0.0055) * coastNoise(soil * 0.019);
        vec3 block = mix(vec3(0.16, 0.169, 0.153), vec3(0.265, 0.247, 0.221), coastNoise(soil * 0.082));
        block = mix(block, vec3(0.094, 0.131, 0.080), planting * 0.94);
        diffuseColor.rgb = mix(diffuseColor.rgb, block, cityGround.r * 0.94);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.066, 0.074, 0.078), cityGround.g * (0.55 + cityGround.b * 0.28));
        ${high ? `
          float bankRelief = 0.0;
          if (uHillHigh > 0.0) {
            float bank = smoothstep(35.0, 150.0, vHillPoint.y) * (1.0 - smoothstep(1500.0, 5300.0, hillDistance));
            float scrubPatch = coastNoise(soil * vec2(0.013, 0.020));
            float cover = coastNoise(soil * 0.052);
            float granular = coastNoise(soil * 0.21);
            float exposure = smoothstep(0.09, 0.44, vHillSteepness + 0.22 * scrubPatch);
            float bareSoil = smoothstep(0.27, 0.75, 0.36 * scrubPatch + 0.32 * cover + 0.64 * exposure);
            vec3 vegetation = mix(vec3(0.095, 0.123, 0.052), vec3(0.25, 0.262, 0.107), cover);
            vec3 rockyScree = mix(vec3(0.22, 0.181, 0.112), vec3(0.38, 0.322, 0.205), granular);
            float exposedBank = bank * (1.0 - max(cityGround.r, cityGround.g));
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(vegetation, rockyScree, bareSoil), exposedBank * 0.79);
            bankRelief = exposedBank * (0.27 * scrubPatch + 0.20 * cover + 0.09 * granular) * (0.45 + bareSoil);
          }
        ` : ''}

      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float hillRelief = soilDetail * (0.018 * chips + 0.035 * paleGravel) ${high ? "+ bankRelief" : ""};
        vec3 tangentX = dFdx(-vViewPosition);
        vec3 tangentY = dFdy(-vViewPosition);
        vec3 acrossX = cross(tangentY, normal);
        vec3 acrossY = cross(normal, tangentX);
        float orientation = dot(tangentX, acrossX);
        vec3 hillGradient = sign(orientation) * (dFdx(hillRelief) * acrossX + dFdy(hillRelief) * acrossY);
        normal = normalize(max(abs(orientation), 1e-8) * normal - hillGradient);
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uHillNight * vec3(0.044, 0.023, 0.008)
          * (cityGround.b * 0.45 + cityGround.r * 0.34);
        ${high ? `
          if (uHillHigh > 0.0 && uHillNight > 0.0) {
            // Broaden arterial spill by a texel on each side of the mapped road bed.
            vec2 texel = 1.0 / vec2(textureSize(uStreets, 0));
            vec2 xStep = vec2(texel.x, 0.0), zStep = vec2(0.0, texel.y);
            vec3 shoulders = 0.25 * (texture2D(uStreets, streetUv - xStep).rgb + texture2D(uStreets, streetUv + xStep).rgb
                                  + texture2D(uStreets, streetUv - zStep).rgb + texture2D(uStreets, streetUv + zStep).rgb);
            float district = coastNoise(soil * 0.0027 + 7.2);
            float pixelSpan = max(length(dFdx(soil)), length(dFdy(soil)));
            float nodes = mix(coastNoise(soil * 0.049), 0.50, smoothstep(8.0, 24.0, pixelSpan));
            float arterial = max(cityGround.b, 0.38 * shoulders.b);
            float sideStreet = cityGround.g * (1.0 - cityGround.b) * smoothstep(0.06, 0.58, cityGround.r);
            vec3 amber = vec3(0.035, 0.020, 0.008);
            vec3 neutral = vec3(0.019, 0.031, 0.034);
            vec3 spill = mix(amber, neutral, smoothstep(0.38, 0.71, district));
            float lights = arterial * (0.38 + 0.56 * nodes) + sideStreet * (0.27 + 0.73 * nodes);
            totalEmissiveRadiance += spill * lights * (1.0 - smoothstep(6200.0, 15500.0, hillDistance));
          }
        ` : ''}

      `);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Measured basin terrain and street beds';
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
