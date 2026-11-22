import * as THREE from 'three';
import type { CoastQuality } from '../CoastWorld';
import {
  COAST_BOUNDS, LANDSCAPE_BOUNDS, coastBedrock, coastTreadWear, forestStreamDistance, groundHeight,
  smoothstep, uplandSpillWetness,
} from '../terrain';
import { coastNoise } from './coastNoise';

export function loadCoastTexture(file: string, repeat = false): THREE.Texture {
  const texture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}coast-materials/${file}`);
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function terrainAxis(start: number, end: number, playStart: number, playEnd: number,
  detailedStart: number, detailedEnd: number, outerDetailEnd: number, pavedBand: readonly [number, number]): number[] {
  const result = [start];
  let value = start;
  while (value < end) {
    const offMap = Math.max(playStart - value, value - playEnd);
    const onStonework = value >= pavedBand[0] && value < pavedBand[1];
    const step = onStonework ? 0.96 : value >= detailedStart && value < detailedEnd ? 1.17
      : value >= detailedEnd && value < outerDetailEnd ? 1.96
      : offMap > 0 ? Math.min(31, 6.6 + offMap * 0.09) : 3.15;
    value = Math.min(value + step, end);
    result.push(value);
  }
  return result;
}

export function createCoastTerrain(rock: THREE.Texture, sand: THREE.Texture, time: THREE.IUniform<number>) {
  const { minX, maxX, minZ, maxZ } = LANDSCAPE_BOUNDS;
  const xs = terrainAxis(minX, maxX, COAST_BOUNDS.minX, COAST_BOUNDS.maxX, -164, 153, 246, [194, 270]);
  const zs = terrainAxis(minZ, maxZ, COAST_BOUNDS.minZ, COAST_BOUNDS.maxZ, -59, 416, 1115, [889, 1044]);
  const positions = new Float32Array(xs.length * zs.length * 3);
  const trail = new Float32Array(xs.length * zs.length);
  const damp = new Float32Array(xs.length * zs.length);
  const bedrock = new Float32Array(xs.length * zs.length);
  const indices = new Uint32Array((xs.length - 1) * (zs.length - 1) * 6);
  let offset = 0;
  for (const z of zs) {
    for (const x of xs) {
      trail[offset / 3] = coastTreadWear(x, z);
      damp[offset / 3] = Math.max(uplandSpillWetness(x, z), 1 - smoothstep(0, 6.2, forestStreamDistance(x, z)));
      bedrock[offset / 3] = coastBedrock(x, z);
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
  geometry.setAttribute('forestDamp', new THREE.BufferAttribute(damp, 1));
  geometry.setAttribute('bedrock', new THREE.BufferAttribute(bedrock, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const litter = loadCoastTexture('forest-litter.webp', true);
  const mossRock = loadCoastTexture('forest-rock.webp', true);
  const mud = loadCoastTexture('forest-mud.webp', true);
  const relief = loadCoastTexture('forest-relief.webp', true);
  relief.colorSpace = THREE.NoColorSpace;
  const microRelief = { value: 0.52 };
  const surface = new THREE.MeshStandardMaterial({ roughness: 0.91 });
  surface.onBeforeCompile = shader => {
    shader.uniforms.uStone = { value: rock };
    shader.uniforms.uSand = { value: sand };
    shader.uniforms.uForestLitter = { value: litter };
    shader.uniforms.uForestRock = { value: mossRock };
    shader.uniforms.uForestMud = { value: mud };
    shader.uniforms.uForestRelief = { value: relief };
    shader.uniforms.uMicroRelief = microRelief;
    shader.uniforms.uCoastSurfaceTime = time;
    shader.uniforms.uGrayStone = { value: new THREE.Color(0x596e90) };
    shader.uniforms.uLitStone = { value: new THREE.Color(0xcbc3a6) };
    shader.uniforms.uWetSand = { value: new THREE.Color(0xaf9472) };
    shader.uniforms.uDrySand = { value: new THREE.Color(0xe7cfa0) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float coastTrail, forestDamp, bedrock;
        varying float vTrail, vDamp, vBedrock;
        varying vec3 vCoastPoint;
        varying vec3 vCoastNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vTrail = coastTrail;
        vDamp = forestDamp;
        vBedrock = bedrock;
        vCoastPoint = position;
        vCoastNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vTrail, vDamp, vBedrock;
        varying vec3 vCoastPoint;
        varying vec3 vCoastNormal;
        uniform sampler2D uStone;
        uniform sampler2D uSand;
        uniform sampler2D uForestLitter, uForestRock, uForestMud, uForestRelief;
        uniform float uMicroRelief, uCoastSurfaceTime;
        uniform vec3 uGrayStone, uLitStone, uWetSand, uDrySand;

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
        float rocky = 1.0 - smoothstep(0.56, 0.90, n.y + 0.11 * (broad - 0.5));
        float pocket = coastNoise(p.xz * 0.143 + p.y * 0.083)
          + coastNoise(p.xz * 0.36 - p.y * 0.18) * 0.24;
        float weathered = vBedrock * smoothstep(0.24, 0.67, pocket);
        rocky = max(rocky, max(weathered, vBedrock * vDamp * 0.91));
        float green = smoothstep(2.1, 6.8, p.y + 2.5 * (broad - 0.5));
        float moss = smoothstep(0.68, 1.08, pocket) * smoothstep(6.0, 20.0, p.y);
        green *= (1.0 - rocky * (0.96 - moss * 0.77));

        vec3 scale = vec3(0.109, 0.071, 0.109);
        vec3 stone = surfaceProjection(uStone, p * scale + broad * 0.08, n);
        float grit = dot(stone, vec3(0.28, 0.59, 0.13));
        float band = coastNoise(vec2((p.x - p.z * 0.75 + p.y * 0.21) * 0.32, p.y * 0.12));
        float seam = smoothstep(0.73, 0.91, band);
        float strata = coastNoise(vec2(p.y * 0.31 + p.x * 0.047, p.z * 0.11));
        vec3 cliff = stone * mix(uGrayStone, uLitStone, broad * 0.61 + strata * 0.38) * 1.72;
        cliff *= (0.71 + 0.36 * band - 0.23 * seam) * (0.66 + 0.34 * smoothstep(0.0, 3.8, p.y));
        vec3 rockCoordinates = p / vec3(3.8, 4.0, 3.8);
        float shelf = smoothstep(0.18, 0.76, n.y) * (1.0 - smoothstep(6.0, 29.0, p.y))
          * smoothstep(-4.0, -1.0, p.y) * (1.0 - smoothstep(75.0, 153.0, p.z));
        if (shelf > 0.0) {
          vec3 scannedShelf = surfaceProjection(uForestRock, rockCoordinates, n);
          float limestone = dot(scannedShelf, vec3(0.2126, 0.7152, 0.0722));
          vec3 shelfStone = mix(limestone * vec3(1.09, 1.04, 0.92), scannedShelf, 0.31);
          shelfStone *= (0.68 + 0.28 * smoothstep(0.0, 2.9, p.y)) * (0.83 + 0.28 * pocket);
          cliff = mix(cliff, shelfStone, shelf * (0.45 + 0.48 * weathered));
        }

        vec3 grains = texture2D(uSand, p.xz * 0.42).rgb;
        float smallRipple = 0.91 + 0.13*coastNoise(vec2(p.x*0.39, p.z*2.1 + sin(p.x*0.57)*0.38));
        vec3 sand = mix(uDrySand, grains * vec3(2.20, 2.09, 1.97), 0.62) * smallRipple;
        float wash = smoothstep(-0.2, 1.1, p.y);
        vec3 saturatedSand = sand * mix(uWetSand * 1.66, vec3(0.56, 0.76, 0.84), 1.0 - smoothstep(-1.4, -0.26, p.y));
        sand = mix(saturatedSand, sand, wash) * (0.87 + 0.20 * broad);
        vec3 coastalLitter = texture2D(uForestLitter, p.xz * 0.418).rgb;
        float growth = smoothstep(0.14, 0.87, broad + (pocket - 0.4) * 0.45);
        float greenBed = smoothstep(3.4, 10.7, p.y) * growth * (1.0 - rocky * 0.43);
        vec3 soil = coastalLitter * mix(vec3(0.98, 1.06, 0.78), vec3(0.46, 0.97, 0.63), greenBed)
          * (0.62 + 0.40 * pocket);
        vec3 terrain = mix(mix(sand, cliff, rocky), soil, green);
        float worn = smoothstep(0.15, 0.91, vTrail * (0.81 + 0.32 * pocket)
          + (coastNoise(p.xz * 1.70) - 0.51) * 0.28) * smoothstep(0.2, 2.3, p.y);
        vec3 gravel = mix(sand * 0.60, cliff * 1.38, 0.42 + broad * 0.26);
        vec3 coastalGround = mix(terrain, gravel, worn * (0.35 + 0.32 * pocket));
        float upland = smoothstep(413.0, 586.0, p.z);
        float nearDetail = 1.0 - smoothstep(30.0, 121.0, length(p - cameraPosition));
        float forestWidth = mix(144.0, 344.0, upland);
        float interior = smoothstep(100.0, 170.0, p.z) * smoothstep(4.0, 15.0, p.y)
          * (1.0 - smoothstep(forestWidth, forestWidth + 114.0, abs(p.x)));
        float rockHeight = surfaceProjection(uForestRelief, rockCoordinates, n).g;
        float strataRelief = (grit * 0.057 + band * 0.075 - seam * 0.036) * (1.0 - shelf * 0.76);
        float roughStone = strataRelief + rockHeight * 0.123;
        float relief = rocky * roughStone + (1.0 - rocky) * dot(grains, vec3(0.3)) * 0.019;
        float forestWet = 0.0;
        diffuseColor.rgb *= coastalGround;
        if (interior > 0.0) {
          vec2 groundUV = p.xz / 3.0;
          vec2 mudUV = vec2(p.x * 0.41 - p.z * 0.13, p.z * 0.41 + p.x * 0.13);
          vec3 faceUV = p / vec3(3.3, 3.7, 3.3) + vec3(pocket * 0.24, broad * 0.29, strata * 0.22);
          float rockCover = smoothstep(0.12, 0.90, rocky + 0.28 * (pocket - 0.43));
          float mudCover = smoothstep(0.13, 0.93, 0.51 * worn + 0.97 * vDamp + (pocket - 0.53) * 0.81);
          forestWet = interior * vDamp * (0.75 + 0.25 * broad);
          vec3 leafMat = texture2D(uForestLitter, groundUV).rgb;
          vec3 mudMat = texture2D(uForestMud, mudUV).rgb;
          vec3 rockMat = surfaceProjection(uForestRock, faceUV, n);
          float slopeColor = coastNoise(p.xz * 0.026 + p.y * 0.041)
            + 0.35 * coastNoise(p.xz * 0.064 - p.y * 0.025);
          float grove = smoothstep(0.27, 0.92, slopeColor);
          vec3 farFloor = mix(vec3(0.154, 0.179, 0.083), vec3(0.27, 0.26, 0.13), grove);
          leafMat = mix(leafMat, farFloor, upland * (1.0 - nearDetail) * 0.93);
          mudMat = mix(mudMat, vec3(0.19, 0.16, 0.098) * (0.82 + 0.28 * grove), upland * (1.0 - nearDetail));
          vec3 grayOcher = mix(vec3(0.118, 0.142, 0.086), vec3(0.30, 0.302, 0.229),
            smoothstep(0.37, 1.1, slopeColor));
          vec3 farRock = surfaceProjection(uForestRock, p / vec3(24.0, 30.0, 24.0), n);
          rockMat = mix(mix(grayOcher, farRock, 0.22), rockMat, nearDetail);
          vec3 forestFloor = mix(leafMat * vec3(0.89, 1.06, 0.84), mudMat, mudCover);
          vec3 packedEarth = mix(mudMat, leafMat, 0.32) * vec3(1.34, 1.22, 1.03);
          forestFloor = mix(forestFloor, packedEarth, worn * (0.62 - 0.43 * vDamp));
          float moor = upland * smoothstep(105.0, 163.0, p.y) * (0.64 + 0.36 * broad);
          vec3 meadow = leafMat * vec3(1.11, 1.45, 0.68) * (0.94 + 0.39 * pocket);
          forestFloor = mix(forestFloor, meadow, moor * (1.0 - worn * 0.90) * 0.76);
          float greenSlope = upland * (1.0 - worn) * smoothstep(0.19, 0.92, slopeColor) * (1.0 - rockCover * 0.74);
          forestFloor *= mix(vec3(1.0), vec3(0.83, 1.29, 0.77), greenSlope * 0.86);
          float cedarGrove = smoothstep(177.0, 208.0, p.x) * (1.0 - smoothstep(259.0, 310.0, p.x))
            * smoothstep(886.0, 909.0, p.z) * (1.0 - smoothstep(1046.0, 1078.0, p.z));
          forestFloor *= mix(vec3(1.0), vec3(0.84, 0.69, 0.52), cedarGrove * (0.89 - 0.29 * worn));
          vec3 forestSurface = mix(forestFloor, rockMat, rockCover) * (0.78 + 0.49 * broad);
          forestSurface *= mix(vec3(1.0), vec3(0.54, 0.67, 0.63), forestWet);
          diffuseColor.rgb = mix(diffuseColor.rgb, forestSurface, interior);

          float leafHeight = texture2D(uForestRelief, groundUV).r;
          float mudHeight = texture2D(uForestRelief, mudUV).b;
          float rockRelief = surfaceProjection(uForestRelief, faceUV, n).g;
          float scanned = mix(mix(leafHeight, mudHeight, mudCover) * 0.085, rockRelief * 0.166, rockCover);
          relief = mix(relief, uMicroRelief * scanned * (0.08 + nearDetail * 0.92), interior);
        }
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 1.0 - 0.63 * forestWet;
      `)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (vCoastPoint.y < 0.0) {
          float depth = -vCoastPoint.y;
          vec2 field = (vCoastPoint.xz + vec2(0.44, 0.56) * depth * 0.64) * 2.05;
          float t = uCoastSurfaceTime;
          float w1 = sin(field.x + 0.47 * field.y - 1.36 * t);
          float w2 = sin(field.y - 0.61 * field.x + 0.93 * t + 0.78 * w1);
          float w3 = sin(field.x - field.y * 0.73 - 0.66 * t + 0.89 * w2);
          float focus = abs(w1 + w2 + w3 * 0.72);
          float caustic = (1.0 - smoothstep(0.026, 0.18 + fwidth(focus) * 0.5, focus));
          float pulse = 0.47 + 0.53 * coastNoise(field * 0.24 + t * 0.16);
          float penetration = exp(-depth * 0.165) * smoothstep(0.015, 0.22, depth);
          reflectedLight.directDiffuse *= exp(-depth * vec3(0.106, 0.026, 0.018));
          reflectedLight.directDiffuse *= 1.0 + 0.92 * pulse * caustic * penetration;
        }
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
  return {
    mesh: terrain,
    mossRock,
    setQuality(quality: CoastQuality): void {
      microRelief.value = quality === 'high' ? 1.20 : 0.52;
    },
  };
}
