import {
  Color, MathUtils, Mesh, MeshStandardMaterial, MirroredRepeatWrapping, Vector3, type Group, type Texture,
} from 'three';
import { coastRandom } from '../../terrain';
import { PlantSurface } from '../coastTreeMeshes';
import { coastNoise } from '../coastNoise';
import { loadCoastTexture } from '../coastSurface';
import { LAKE_TERRAIN, LAKE_WATER_Y } from './lakeLayout';

const fullCircle = 2 * Math.PI;
const ringScale = 0.932;
const ringYaw = 0.092;
const ringFaceX = Math.cos(ringYaw);
const ringFaceZ = Math.sin(ringYaw);

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

function stoneMaterial(map: Texture, ring: boolean): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    name: ring ? 'Weathered stonework with worn joints' : 'Exposed bedrock with sheltered lichens and wet toes',
    map,
    vertexColors: true,
    roughness: 0.91,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uLakeRingStone = { value: ring };
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
        uniform bool uLakeRingStone;
        ${coastNoise}
      `)
      .replace('#include <map_fragment>', `
        vec3 stone = vBasinStone;
        vec3 rockNormal = normalize(vBasinStoneNormal);
        vec3 weights = pow(abs(rockNormal), vec3(4.0));
        weights /= dot(weights, vec3(1.0));
        vec2 strike = vec2(stone.x + stone.z * 0.42, stone.y + stone.x * 0.16 - stone.z * 0.11);
        float weathering = coastNoise(strike * vec2(0.24, 0.15));
        float faceTone = coastNoise(strike * vec2(0.68, 0.21) + 5.3);
        float mappedY = stone.y * (uLakeRingStone ? 0.83 : 0.96);
        vec3 scanned = texture2D(map, vec2(-stone.z + stone.y * 0.07, mappedY) * 0.119).rgb * weights.x
          + texture2D(map, (stone.xz + vec2(2.6, -1.3)) * 0.18).rgb * weights.y
          + texture2D(map, vec2(stone.x - stone.y * 0.11, mappedY + stone.x * 0.044) * 0.13).rgb * weights.z;
        float scanHeight = dot(scanned, vec3(0.2126, 0.7152, 0.0722));
        vec3 exposedRock = mix(vec3(1.0), clamp(scanned * 3.9, 0.25, 2.65),
          uLakeRingStone ? 0.49 : 0.88);
        float wetness = 1.0 - smoothstep(${LAKE_WATER_Y}, ${LAKE_WATER_Y + 0.95},
          stone.y + (weathering - 0.5) * 0.85);
        float surfaceHeight = scanHeight * 0.064;
        if (uLakeRingStone) {
          float along = stone.x * ${ringFaceX.toFixed(8)} - (stone.z - ${LAKE_TERRAIN.ringZ.toFixed(3)})
            * ${ringFaceZ.toFixed(8)};
          vec2 ringPoint = vec2(along, stone.y - ${LAKE_TERRAIN.ringCenterY.toFixed(3)}) / ${ringScale};
          float radius = length(ringPoint);
          float bearing = atan(ringPoint.y, ringPoint.x) / 6.28318530718;
          float course = floor((radius + 0.8 * weathering) * 0.11);
          float jointCell = bearing * 35.0 + course * 0.41 + 0.085 * (faceTone - 0.5);
          float joint = (1.0 - smoothstep(0.006, 0.032 + 0.5 * fwidth(jointCell),
            abs(fract(jointCell + 0.5) - 0.5)))
            * (0.18 + 0.55 * coastNoise(vec2(floor(jointCell + 0.5), radius * 0.19)));
          exposedRock *= mix(vec3(0.87, 0.96, 1.05), vec3(1.18, 1.06, 0.89), weathering);
          exposedRock *= 1.0 - 0.29 * joint;
          surfaceHeight -= 0.07 * joint;
        } else {
          float fault = (1.0 - smoothstep(0.017, 0.061,
            abs(fract(strike.y * 0.31 + coastNoise(strike * vec2(0.72, 0.12)) * 0.47) - 0.5)))
            * smoothstep(0.45, 0.79, weathering);
          float lichen = smoothstep(0.23, 0.83, rockNormal.y)
            * smoothstep(0.34, 0.80, weathering * 0.56 + faceTone * 0.29 + scanHeight * 0.43)
            * smoothstep(${LAKE_WATER_Y}, 0.5, stone.y) * (1.0 - smoothstep(22.0, 43.0, stone.y));
          exposedRock *= (0.66 + faceTone * 0.29 + weathering * 0.40 - fault * 0.29)
            * mix(vec3(0.86, 0.94, 1.07), vec3(1.14, 1.04, 0.91), weathering);
          exposedRock = mix(exposedRock, exposedRock * vec3(0.53, 0.68, 0.31), 0.86 * lichen);
          surfaceHeight += 0.10 * faceTone + 0.038 * weathering - 0.055 * fault;
        }
        diffuseColor.rgb *= exposedRock * mix(vec3(1.0), vec3(0.46, 0.54, 0.59), wetness);
      `)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor =
        mix(roughness + 0.065 * (weathering - 0.5), 0.54, wetness);`)
      .replace('#include <normal_fragment_maps>', `
        vec3 stoneX = dFdx(-vViewPosition);
        vec3 stoneY = dFdy(-vViewPosition);
        vec3 acrossX = cross(stoneY, normal);
        vec3 acrossY = cross(normal, stoneX);
        float determinant = dot(stoneX, acrossX);
        vec3 gradient = sign(determinant)
          * (dFdx(surfaceHeight) * acrossX + dFdy(surfaceHeight) * acrossY);
        // Keep the sun from picking out sharp texture ridges in the submerged shore.
        float submerged = smoothstep(0.0, 0.12, ${LAKE_WATER_Y} - vBasinStone.y);
        float relief = uLakeRingStone ? 1.0 : mix(1.0, 0.1, submerged);
        normal = normalize(normal * max(0.000001, abs(determinant)) - gradient * relief);
      `);
  };
  return material;
}

export function lakeStoneMaterials(): { bedrock: MeshStandardMaterial; ring: MeshStandardMaterial } {
  const map = loadCoastTexture('limestone.webp', true);
  map.wrapS = map.wrapT = MirroredRepeatWrapping;
  return { bedrock: stoneMaterial(map, false), ring: stoneMaterial(map, true) };
}

function rockPerimeter(detail: number, random: () => number) {
  const corners = Math.floor(5 + random() * 4);
  const angleStep = fullCircle / corners;
  const outline = Array.from({ length: corners }, (_, index) => {
    const angle = (index + 0.31 * (random() - 0.5)) * angleStep;
    const reach = 0.83 + random() * 0.28;
    return {
      x: Math.cos(angle) * reach,
      z: Math.sin(angle) * reach,
      crest: 0.026 * Math.sin(angle * 2.0) + 0.024 * (random() - 0.5),
    };
  });
  return outline.flatMap((corner, index) => {
    const next = outline[(index + 1) % corners];
    const samples = Math.max(2, Math.round(28 * detail / corners));
    const opening = 0.25 + random() * 0.44;
    const depth = 0.09 + random() * 0.14;
    const shelf = 0.20 + random() * 0.59;
    const chisel = 0.014 + random() * 0.051;
    return Array.from({ length: samples }, (_, sample) => {
      const fraction = sample / samples;
      const seam = 1 - MathUtils.smoothstep(Math.abs(fraction - opening), 0.014, 0.31);
      return {
        x: MathUtils.lerp(corner.x, next.x, fraction),
        z: MathUtils.lerp(corner.z, next.z, fraction),
        seam: seam * depth,
        shelf: shelf + fraction * chisel * 2.6,
        chisel,
        crest: MathUtils.lerp(corner.crest, next.crest, fraction),
      };
    });
  });
}

export function addRockMass(surface: PlantSurface, mass: RockMass): void {
  const {
    x, z, radiusX, radiusZ, bottom = LAKE_WATER_Y - 2.0, height, yaw, seed,
    taper = 0.37, lean = 0.11, detail = 1,
  } = mass;
  const random = coastRandom(Math.round(seed * 503 + x * 79 + z * 17));
  const perimeter = rockPerimeter(detail, random);
  const tiers = Math.max(5, Math.ceil(17 * detail));
  const tall = MathUtils.smoothstep(height / Math.max(radiusX, radiusZ), 0.86, 4.0);
  const base = new Color(mass.color);
  const cap = new Color(0x9b997d);
  const tint = new Color();
  const point = new Vector3();
  const facingX = Math.cos(yaw);
  const facingZ = Math.sin(yaw);
  let lower: number[] = [];

  for (let tier = 0; tier <= tiers; tier += 1) {
    const t = tier / tiers;
    const foot = 1 + 0.16 * Math.exp(-t * 13);
    const shoulder = 1 - taper * (0.37 * t + 0.63 * MathUtils.smoothstep(t, 0.74, 1));
    const shift = lean * t + (0.5 - t) * 0.09 * MathUtils.smoothstep(t, 0.22, 0.28);
    const row = perimeter.map((edge, side) => {
      // One steep joint may terminate at an inclined fracture; adjoining faces keep a different scarp height.
      const joint = edge.seam * MathUtils.smoothstep(t, -0.03, 0.14)
        * (1.0 - 0.71 * MathUtils.smoothstep(t, edge.shelf, edge.shelf + 0.13));
      const bedding = MathUtils.smoothstep(t, edge.shelf - edge.chisel, edge.shelf + 0.01)
        - MathUtils.smoothstep(t, edge.shelf + 0.049, edge.shelf + 0.31);
      const broken = (Math.sin(t * 37.0 + side * 4.1 + seed) + 0.54 * Math.sin(t * 79.3 - side * 1.16)) * 0.019;
      const span = foot * shoulder - joint - (0.10 + 0.08 * tall) * bedding + broken;
      const localX = radiusX * (edge.x * span + shift);
      const localZ = radiusZ * (edge.z * span + 0.075 * MathUtils.smoothstep(t, 0.53, 0.66) * Math.sin(seed));
      const elevation = t + t * t * (edge.crest + broken * (1.24 - 0.74 * tall));
      tint.copy(base).lerp(cap, (1 - tall * 0.62) * MathUtils.smoothstep(t, 0.65, 1.0) * 0.27);
      point.set(x + localX * facingX - localZ * facingZ, bottom + height * elevation,
        z + localX * facingZ + localZ * facingX);
      return surface.point(point, tint, 1.07 - joint * 1.27 - bedding * 0.20 + broken * 4.4
        + 0.11 * Math.sin(side * 1.4 + seed));
    });
    if (tier > 0) {
      for (let side = 0; side < perimeter.length; side += 1) {
        const next = (side + 1) % perimeter.length;
        surface.triangle(lower[side], row[side], lower[next]);
        surface.triangle(lower[next], row[side], row[next]);
      }
    }
    lower = row;
  }

  const capCenter = surface.point(point.set(
    x + radiusX * (lean * 0.82 - 0.11) * facingX, bottom + height * (0.976 + tall * 0.038),
    z + radiusZ * (lean * 0.82 - 0.11) * facingZ,
  ), tint, 0.96);
  for (let side = 0; side < perimeter.length; side += 1) {
    surface.triangle(lower[side], capCenter, lower[(side + 1) % perimeter.length]);
  }
}

export function buildLakeStoneRing(root: Group, material: MeshStandardMaterial): void {
  const { ringCenterY, ringRadius, ringZ } = LAKE_TERRAIN;
  const surface = new PlantSurface();
  const point = new Vector3();
  const stone = new Color(0x77848f);
  const oxide = new Color(0x968576);
  const tint = new Color();
  const inner = ringRadius - 34;
  const profile: readonly (readonly [radius: number, depth: number])[] = [
    [inner, 11.6], [inner + 1.6, 14.2], [inner + 4.2, 15.5], [inner + 8.9, 15.7],
    [inner + 15, 15.3], [inner + 21.9, 15.6], [ringRadius - 5.1, 15.4], [ringRadius - 2, 14.65],
    [ringRadius, 11.9], [ringRadius - 0.45, 4], [ringRadius - 0.7, -10.7], [ringRadius - 4.6, -14.1],
    [inner + 3.5, -13.0], [inner - 0.12, -7.6], [inner - 0.86, -0.6],
  ];
  const steps = 256;
  const rows: number[][] = [];
  for (let step = 0; step < steps; step += 1) {
    const theta = fullCircle * step / steps;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const wear = 0.69 * Math.sin(13 * theta + 0.3) + 0.30 * Math.cos(34 * theta) + 0.17 * Math.sin(79 * theta);
    rows.push(profile.map(([radius, depth]) => {
      const chipped = wear + 0.34 * Math.sin(theta * 29 - radius * 0.32);
      const weatheredRadius = (radius + chipped) * ringScale;
      // Both arcs share one circular section. Thickness varies independently of its radius.
      const along = weatheredRadius * cos;
      const y = ringCenterY + weatheredRadius * sin;
      const facet = Math.sin(y * 0.102 + along * 0.071) * Math.sin(along * 0.12 - y * 0.032);
      const bedding = Math.sin(y * 0.46 - along * 0.103 + facet) * Math.sin(along * 0.197 + y * 0.089);
      const rockDepth = depth + 0.75 * facet + 0.43 * bedding;
      point.set(ringFaceX * along + ringFaceZ * rockDepth, y, ringZ - ringFaceZ * along + ringFaceX * rockDepth);
      tint.copy(stone).lerp(oxide, MathUtils.smoothstep(facet + bedding * 0.25, 0.52, 1.05) * 0.36);
      return surface.point(point, tint, 0.98 + facet * 0.12 + bedding * 0.047);
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
  ring.name = 'Continuous weathered stone ring with buried lower arc';
  root.add(ring);
}
