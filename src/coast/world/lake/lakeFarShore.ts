import { Color, MathUtils, MeshStandardMaterial, Vector3 } from 'three';
import { coastRandom } from '../../terrain';
import { PlantSurface } from '../coastTreeMeshes';
import { coastNoise } from '../coastNoise';
import { addRockMass } from './lakeBasinStone';
import { LAKE_TERRAIN, LAKE_WATER_Y } from './lakeLayout';

// Coordinates are metres. Positive inland distance runs from the shore into the cirque.
function shoreInlet(x: number): number {
  return 4.1 * Math.sin(x * 0.021 + 0.3) + 1.8 * Math.sin(x * 0.055 + 0.8);
}

function ridge(distance: number, crest: number, lakeSide: number, inlandSide: number): number {
  return MathUtils.smoothstep(distance, crest - lakeSide, crest)
    * (1 - MathUtils.smoothstep(distance, crest, crest + inlandSide));
}

const gravelBanks = [
  { x: -91, span: 34, d: 9, rise: 2.8 },
  { x: -22, span: 27, d: 21, rise: 2.9 },
  { x: 20, span: 24, d: 15, rise: 3.5 },
  { x: 71, span: 32, d: 15, rise: 2.4 },
  { x: 127, span: 31, d: 22, rise: 4.9 },
  { x: 182, span: 36, d: 27, rise: 4.4 },
] as const;

function shoreProfile(x: number, distance: number): number {
  const wetApron = MathUtils.lerp(-2.6, 1.55, MathUtils.smoothstep(distance, -23, -9));
  const inlandGrade = 6.8 * MathUtils.smoothstep(distance, -6, 62)
    + 4.7 * MathUtils.smoothstep(distance, 28, 128);
  const bar = ridge(distance, -4.1 + 2.7 * Math.sin(x * 0.037), 4.5, 8.8)
    * (0.7 + 0.64 * Math.sin(x * 0.043 - 1.1) ** 2);
  let folds = 1.55 * ridge(distance, 48 + 13 * Math.sin(x * 0.018 + 2), 21, 26);
  for (const bank of gravelBanks) {
    const across = (x - bank.x) / bank.span;
    const fan = 1 - MathUtils.smoothstep(Math.abs(across), 0.08, 1);
    const crest = bank.d + 7.8 * across + 4.7 * across * across;
    folds += bank.rise * fan * ridge(distance, crest, 14, 22);
  }
  const eastward = MathUtils.smoothstep(x, 46, 232);
  const rightApron = eastward * (10.5 * MathUtils.smoothstep(distance, -13, 23)
    + 3.2 * MathUtils.smoothstep(distance, 18, 64));
  const leftApron = 6.2 * (1 - MathUtils.smoothstep(x, -133, -35))
    * MathUtils.smoothstep(distance, -7, 31);
  // A low collar continues under the pale eave, with a lower runnel to its east.
  const eaveApron = 6.6 * Math.exp(-(((x + 45) / 20) ** 2))
    * ridge(distance, 13, 20, 35);
  const runnel = 1.25 * Math.exp(-(((x + 5 - distance * 0.18) / 19) ** 2))
    * ridge(distance, 25, 29, 26);
  return LAKE_WATER_Y + wetApron + inlandGrade + bar + folds + rightApron + leftApron + eaveApron - runnel;
}

function farShoreHeight(x: number, z: number): number {
  return shoreProfile(x, LAKE_TERRAIN.shoreZ - z + shoreInlet(x));
}

// The directional shadow camera covers the hall. Distant ridges use the same low
// east light to shade their lee sides in the mesh, preserving shadows in reflections.
const sunwardWalls = [
  { x: -119, z: -358, span: 18, depth: 9 },
  { x: -58, z: -369, span: 20, depth: 9 },
  { x: 108, z: -392, span: 22, depth: 12 },
  { x: 192, z: -357, span: 23, depth: 12 },
] as const;

function terrainShelter(x: number, y: number, z: number): number {
  let horizon = 0;
  for (const travel of [3, 7, 13, 22, 39, 62]) {
    const rise = farShoreHeight(x + travel * 0.89, z - travel * 0.37) - y;
    horizon = Math.max(horizon, MathUtils.smoothstep(rise / travel, 0.08, 0.31));
  }
  for (const wall of sunwardWalls) {
    const across = x - wall.x;
    const along = (z - wall.z + across * 0.31) / wall.depth;
    const envelope = Math.hypot(across / wall.span, along);
    const penumbra = 1 - MathUtils.smoothstep(envelope, 0.29, 1);
    horizon = Math.max(horizon, 0.68 * penumbra);
  }
  return horizon;
}

export function buildFarShoreSurface(): PlantSurface {
  const ground = new PlantSurface();
  const point = new Vector3();
  const tint = new Color();
  const wet = new Color(0x9e998a);
  const exposed = new Color(0xffedd2);
  const shelter = new Color(0x929bab);
  const colluvium = new Color(0xb3b2a1);
  const rows = [-30, -25, -22, -20, -18, -16, -14, -12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 11,
    14, 17, 20, 23, 27, 32, 37, 42, 48, 54, 61, 69, 78, 89, 103, 122, 153, 200, 282];
  let previous: number[] | undefined;
  for (const distance of rows) {
    const row: number[] = [];
    for (let x = -480; x <= 480; x += 3) {
      const z = LAKE_TERRAIN.shoreZ - distance + shoreInlet(x);
      const y = shoreProfile(x, distance);
      const dry = MathUtils.smoothstep(y, LAKE_WATER_Y, LAKE_WATER_Y + 0.86);
      const shade = terrainShelter(x, y, z);
      const weathering = 0.48 + 0.20 * Math.sin(x * 0.075 - z * 0.067)
        + 0.20 * Math.cos(x * 0.16 + z * 0.027);
      const lateSlope = MathUtils.smoothstep(distance, 18, 105) * (0.31 + 0.65 * weathering);
      tint.copy(wet).lerp(exposed, dry).lerp(colluvium, lateSlope).lerp(shelter, dry * shade * 0.48);
      row.push(ground.point(point.set(x, y, z), tint, 0.94 + 0.55 * dry - 0.43 * shade));
    }
    if (previous) {
      for (let i = 0; i < row.length - 1; i += 1) {
        ground.triangle(previous[i], previous[i + 1], row[i]);
        ground.triangle(previous[i + 1], row[i + 1], row[i]);
      }
    }
    previous = row;
  }

  // Low scree is sparse on the exposed gravel, denser under the uphill retaining wall.
  const random = coastRandom(38509);
  for (let i = 0; i < 47; i += 1) {
    const x = i < 12 ? -105 + random() * 73 : 133 + random() * 98;
    const z = LAKE_TERRAIN.shoreZ - (3.7 + random() * (i < 12 ? 24 : 47));
    const radius = 0.29 + random() ** 3 * 1.65;
    addRockMass(ground, {
      x, z, bottom: farShoreHeight(x, z) - radius * 0.25, radiusX: radius, radiusZ: radius * (0.67 + random() * 0.38),
      height: radius * (0.24 + random() * 0.40), yaw: random() * Math.PI,
      seed: i * 13 + 8, color: i % 3 === 0 ? 0xa3a8a3 : 0xb7b3a8, detail: 0.28, taper: 0.47,
    });
  }
  return ground;
}

export function farShoreMaterial(layer: 'gravel' | 'masonry'): MeshStandardMaterial {
  const ground = layer === 'gravel';
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: ground ? 0.94 : 0.87 });
  material.customProgramCacheKey = () => `lake-far-${layer}`;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFarShorePosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFarShorePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFarShorePosition;
        ${coastNoise}
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 p = vFarShorePosition;
        float grains = coastNoise(${ground ? 'p.xz * 1.6' : 'vec2(p.x + p.z * 0.37, p.y) * 0.79'});
        float weathering = coastNoise(${ground ? 'p.xz * vec2(0.17, 0.30)' : 'vec2(p.x + p.z, p.y * 0.08) * 0.22'});
        diffuseColor.rgb *= 0.92 + 0.14 * weathering + 0.12 * grains;
      `)
      .replace('#include <fog_fragment>', `
        #if defined(USE_FOG) && defined(FOG_EXP2)
          float opticalDepth = fogDensity * vFogDepth;
          float fogFactor = 1.0 - exp(-opticalDepth * opticalDepth);
          // The cirque shelters uneven, low pockets of hazy air. The exposed gravel
          // keeps its brighter patches while bases farther up the valley fade into gray.
          float drift = coastNoise(p.xz * vec2(0.017, 0.010));
          float height = ${ground ? 'p.y' : 'p.y - 5.0'};
          float lowBank = 1.0 - smoothstep(4.0, 18.0 + 28.0 * drift, height);
          float valley = smoothstep(306.0, 463.0, -p.z) * (0.32 + 0.68 * drift);
          float westFoot = (1.0 - smoothstep(17.0, 62.0, abs(p.x + 106.0)))
            * (1.0 - smoothstep(10.0, 34.0 + 29.0 * drift, p.y));
          float air = valley * lowBank * ${ground ? '0.16' : '0.84'}
            + westFoot * ${ground ? '0.07' : '0.41'};
          fogFactor = 1.0 - (1.0 - fogFactor) * exp(-air);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
        #else
          #include <fog_fragment>
        #endif
      `);
    if (ground) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          // The pale dry gravel is brighter in direct sunlight, with warmer grains
          // on the exposed crests. Read the existing light so moonlight stays subdued.
          float daylight = smoothstep(0.56, 1.72, luminance(directionalLights[0].color));
          float elevation = smoothstep(${LAKE_WATER_Y.toFixed(2)}, 0.85, p.y);
          reflectedLight.directDiffuse *= mix(vec3(1.0), vec3(2.90, 2.55, 2.20), daylight * elevation);
        #endif
      `);
    }
  };
  return material;
}
