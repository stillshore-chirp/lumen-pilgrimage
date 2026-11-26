import {
  Color, MathUtils, Mesh, MeshStandardMaterial, Vector3, type Group,
} from 'three';
import { PlantSurface } from '../coastTreeMeshes';
import { coastNoise } from '../coastNoise';
import { loadCoastTexture } from '../coastSurface';
import { LAKE_TERRAIN, LAKE_WATER_Y } from './lakeLayout';

const fullCircle = 2 * Math.PI;

export type RockMass = {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  bottom?: number;
  height: number;
  yaw: number;
  seed: number;
  color: number;
  taper?: number;
  lean?: number;
  detail?: number;
};

export function lakeStoneMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    name: 'Limestone with aligned fractures and damp lower faces',
    map: loadCoastTexture('limestone.webp', true),
    vertexColors: true,
    roughness: 0.92,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBasinStone;
        varying vec3 vBasinStoneNormal;
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBasinStone = position;
        vBasinStoneNormal = normal;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBasinStone;
        varying vec3 vBasinStoneNormal;
        ${coastNoise}
      `)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec3 stone = vBasinStone;
          vec3 weights = pow(abs(normalize(vBasinStoneNormal)), vec3(5.0));
          weights /= max(dot(weights, vec3(1.0)), 0.01);
          float drift = (coastNoise(stone.xz * 0.045) - 0.5) * 3.5;
          // The limestone tile remains vertical on either axis of a buttress.
          vec3 scanned = texture2D(map, vec2(stone.z + drift, stone.y * 0.74) * 0.112).rgb * weights.x
            + texture2D(map, (stone.xz + vec2(2.6, 0.0)) * 0.112).rgb * weights.y
            + texture2D(map, vec2(stone.x + drift, stone.y * 0.74) * 0.112).rgb * weights.z;
          float relief = pow(dot(scanned, vec3(0.2126, 0.7152, 0.0722)), 0.64);
          float nearDetail = 1.0 - smoothstep(75.0, 275.0, length(vViewPosition));
          vec2 jointUV = vec2(stone.x - stone.y * 0.13 + stone.z * 0.67, stone.y * 0.095);
          float fractures = coastNoise(jointUV * 0.91);
          float broad = coastNoise((stone.xz + stone.y * vec2(0.17, -0.19)) * 0.19);
          float ribs = coastNoise(jointUV * vec2(4.9, 0.56));
          float joints = smoothstep(0.61, 0.91, ribs) * nearDetail;
          float fluting = coastNoise(jointUV * vec2(1.61, 0.21));
          float moss = smoothstep(0.21, 0.82, vBasinStoneNormal.y) * nearDetail
            * smoothstep(0.47, 0.78, broad * 0.71 + fractures * 0.29)
            * smoothstep(${LAKE_WATER_Y}, 2.5, stone.y) * (1.0 - smoothstep(23.0, 35.0, stone.y));
          float saturated = 1.0 - smoothstep(${LAKE_WATER_Y - 0.05}, ${LAKE_WATER_Y + 1.02},
            stone.y + (broad - 0.5) * 0.66);
          float oxide = smoothstep(0.46, 0.93, broad) * smoothstep(0.20, 0.82, fractures);
          diffuseColor.rgb *= (0.72 + relief * 0.73)
            * (0.77 + fractures * 0.31 + broad * 0.22 + 0.41 * fluting * nearDetail - 0.27 * joints);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.12, 0.97, 0.81), oxide * 0.32);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.67, 0.81, 0.39), 0.84 * moss);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.50, 0.56, 0.56), saturated);
        #endif
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef USE_MAP
          float stoneElevation = (relief * 0.035 + fractures * 0.064 + fluting * 0.143 - joints * 0.024) * nearDetail;
          vec3 stoneX = dFdx(-vViewPosition);
          vec3 stoneY = dFdy(-vViewPosition);
          vec3 acrossX = cross(stoneY, normal);
          vec3 acrossY = cross(normal, stoneX);
          float determinant = dot(stoneX, acrossX);
          vec3 stoneGradient = sign(determinant)
            * (dFdx(stoneElevation) * acrossX + dFdy(stoneElevation) * acrossY);
          normal = normalize(normal * max(0.000001, abs(determinant)) - stoneGradient);
        #endif
      `);
  };
  return material;
}

export function addRockMass(surface: PlantSurface, mass: RockMass): void {
  const {
    x, z, radiusX, radiusZ, bottom = LAKE_WATER_Y - 2.0, height, yaw, seed,
    taper = 0.37, lean = 0.11, detail = 1,
  } = mass;
  const sides = Math.ceil(24 * detail);
  const tiers = Math.ceil(16 * detail);
  const base = new Color(mass.color);
  const cap = new Color(0xa8a38c);
  const tint = new Color();
  const point = new Vector3();
  const facingX = Math.cos(yaw);
  const facingZ = Math.sin(yaw);
  const rings: number[][] = [];

  for (let tier = 0; tier <= tiers; tier += 1) {
    const t = tier / tiers;
    const ring: number[] = [];
    const foot = 1 + 0.18 * Math.exp(-t * 11.0);
    const crown = 1 - taper * (t * 0.33 + t ** 6 * 0.67);
    const ledge = Math.sin(t * 13.8 + seed) * 0.025 + Math.sin(t * 43 - seed) * 0.009;
    for (let side = 0; side < sides; side += 1) {
      const angle = side / sides * fullCircle;
      // Long, offset vertical grooves carry across tiers. The low shelf at
      // each foot is wider than the crown and disappears below the waterline.
      const strike = angle + t * (0.11 + Math.sin(seed) * 0.072);
      const blade = 1 - Math.abs(Math.sin(strike * 7 + seed * 0.67));
      const ridge = 0.092 * Math.sin(strike * 5 + seed) + 0.065 * Math.sin(strike * 9 - seed)
        + 0.12 * blade ** 1.6 - 0.036;
      const brokenEdge = Math.sin(angle * 7.0 - t * 13.8 + seed) * Math.sin(t * 9.3 + seed * 0.47);
      const perimeter = foot * crown * (1 + ridge + ledge + 0.021 * brokenEdge);
      const localX = radiusX * (Math.cos(angle) * perimeter + lean * t ** 1.35);
      const localZ = radiusZ * (Math.sin(angle) * perimeter + 0.09 * Math.sin(t * 5.0 + seed) * t);
      const topRoughness = (0.027 * Math.sin(angle * 2 + seed) + 0.015 * Math.sin(angle * 7 - seed)) * t ** 3;
      point.set(x + localX * facingX - localZ * facingZ, bottom + height * (t + topRoughness),
        z + localX * facingZ + localZ * facingX);
      tint.copy(base).lerp(cap, MathUtils.smoothstep(t, 0.68, 1.0) * 0.22);
      ring.push(surface.point(point, tint, 0.90 + ridge * 0.66 + brokenEdge * 0.06));
    }
    rings.push(ring);
    if (tier === 0) continue;
    const lower = rings[tier - 1];
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      surface.triangle(lower[side], ring[side], lower[next]);
      surface.triangle(lower[next], ring[side], ring[next]);
    }
  }

  const top = rings[tiers];
  const capCenter = surface.point(point.set(x + radiusX * lean * facingX, bottom + height * 1.012,
    z + radiusX * lean * facingZ), base, 1.06);
  for (let side = 0; side < sides; side += 1) surface.triangle(top[side], capCenter, top[(side + 1) % sides]);
}

export function buildLakeStoneRing(root: Group, material: MeshStandardMaterial): void {
  const { ringCenterY, ringRadius, ringZ } = LAKE_TERRAIN;
  const surface = new PlantSurface();
  const point = new Vector3();
  const stone = new Color(0x788691);
  const tilt = 0.092;
  const faceX = Math.cos(tilt);
  const faceZ = Math.sin(tilt);
  const inner = ringRadius - 34;
  const profile: readonly (readonly [radius: number, depth: number])[] = [
    [inner, 12.8], [inner + 1.8, 15.2], [inner + 6, 15.65], [inner + 15.5, 15.8],
    [ringRadius - 6, 15.65], [ringRadius - 2, 15.0], [ringRadius, 12.8],
    [ringRadius - 0.7, -10.3], [ringRadius - 4.6, -14.1], [inner + 3.5, -13.0], [inner - 0.12, -7.6],
  ];
  const steps = 240;
  const rows: number[][] = [];
  for (let step = 0; step < steps; step += 1) {
    const theta = fullCircle * step / steps;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    // The lower ring keeps its width down into the valley floor. The buried
    // turn closes the ring while each visible flank continues through the mist.
    const drop = Math.max(0, -sin);
    const lateral = drop > 0 ? Math.sign(cos) * (1 - drop ** 4) ** 0.25 : cos;
    const lowerStretch = 1 + 0.12 * drop ** 3;
    const toe = 12 * MathUtils.smoothstep(drop, 0.22, 0.87);
    const wear = 0.47 * Math.sin(19 * theta) + 0.30 * Math.cos(37 * theta) + 0.19 * Math.sin(63 * theta);
    rows.push(profile.map(([radius, depth]) => {
      const chipped = wear + 0.32 * Math.sin(theta * 29 - radius * 0.32);
      const along = (radius + chipped) * lateral;
      const y = ringCenterY + (radius + chipped) * sin * lowerStretch;
      const facet = Math.sin(y * 0.098 + along * 0.041) * Math.sin(along * 0.103 - y * 0.032);
      const bedding = Math.sin(y * 0.51 - along * 0.085 + facet) * Math.sin(along * 0.134 + y * 0.05);
      const rockDepth = depth + 0.39 * facet + 0.20 * bedding;
      point.set(faceX * along + faceZ * rockDepth, y, ringZ - faceZ * along + faceX * rockDepth + toe);
      return surface.point(point, stone, 0.91 + facet * 0.037 + bedding * 0.031);
    }));
  }
  for (let step = 0; step < steps; step += 1) {
    const row = rows[step];
    const nextRow = rows[(step + 1) % steps];
    for (let side = 0; side < profile.length; side += 1) {
      const next = (side + 1) % profile.length;
      surface.triangle(row[side], row[next], nextRow[side]);
      surface.triangle(row[next], nextRow[next], nextRow[side]);
    }
  }

  const ring = new Mesh(surface.geometry(), material);
  ring.name = 'Continuous stone ring with buried lower arc';
  root.add(ring);
}
