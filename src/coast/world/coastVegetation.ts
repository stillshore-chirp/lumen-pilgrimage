import * as THREE from 'three';
import { COAST_WALKS, LANDSCAPE_BOUNDS, coastRandom, groundHeight, groundSlope, smoothstep, SPAWN } from '../terrain';
import { isInlandForest, makePlant, plantForest, type FloorPlant, type Plant, type PlantingDistance, type Tree } from './coastForestVegetation';
import { createFloorModel, createPalmCrown, floorForms } from './coastPlantMeshes';
import { coastNoise } from './coastNoise';
import { loadCoastTexture } from './coastSurface';
import { createCoastRoots, createCoastTreeMeshes, createHorizonTreeMesh } from './coastTreeMeshes';

type Quality = 'light' | 'high';
type Range = readonly [light: number, high: number];
type Level = { group: THREE.Object3D; limit: Range };
type Tile = { origin: THREE.Vector3; levels: Level[]; active: number };

class CoastVegetation extends THREE.Group {
  readonly leafDetail = { value: 0 };
  private readonly tiles: Tile[] = [];
  private quality: Quality = 'high';
  private readonly lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  private readonly view = new THREE.Vector3();

  addTile(name: string, origin: THREE.Vector3, levels: Level[]): void {
    const tile = new THREE.Group();
    tile.name = name;
    tile.position.copy(origin);
    for (const level of levels) {
      level.group.visible = false;
      tile.add(level.group);
    }
    this.tiles.push({ origin, levels, active: levels.length });
    this.add(tile);
  }

  setQuality(quality: Quality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.leafDetail.value = Number(quality === 'high');
    this.lastCamera.set(Infinity, Infinity, Infinity);
  }

  update(camera: THREE.Camera): void {
    const position = camera.getWorldPosition(this.view);
    if (this.lastCamera.distanceToSquared(position) < 0.22) return;
    this.lastCamera.copy(position);
    const tier = this.quality === 'light' ? 0 : 1;
    for (const tile of this.tiles) {
      const distanceSquared = tile.origin.distanceToSquared(position);
      let next = 0;
      for (const level of tile.levels) {
        const limit = level.limit[tier] * (next === tile.active ? 1.04 : 1);
        if (limit > 0 && distanceSquared <= limit * limit) break;
        next += 1;
      }
      if (next === tile.active) continue;
      if (tile.active < tile.levels.length) tile.levels[tile.active].group.visible = false;
      if (next < tile.levels.length) tile.levels[next].group.visible = true;
      tile.active = next;
    }
  }
}

const placed = new THREE.Object3D();
const color = new THREE.Color();

function instances(geometry: THREE.BufferGeometry, material: THREE.Material, plants: Plant[],
  origin: THREE.Vector3, castShadow = false, depth?: THREE.MeshDepthMaterial): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, plants.length);
  for (let i = 0; i < plants.length; i += 1) {
    const p = plants[i];
    placed.position.set(p.x, p.y, p.z).sub(origin);
    placed.rotation.set(0, p.yaw, 0);
    placed.scale.set(p.width, p.height, p.width);
    placed.updateMatrix();
    mesh.setMatrixAt(i, placed.matrix);
    mesh.setColorAt(i, color.setRGB(0.72 + p.tone * 0.42, 0.82 + p.tone * 0.19, 0.91 - p.tone * 0.21));
  }
  mesh.computeBoundingSphere();
  if (mesh.boundingSphere) mesh.boundingSphere.radius += 0.38; // Wind displacement at full scale.
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  if (depth && castShadow) mesh.customDepthMaterial = depth;
  return mesh;
}

type Foliage = { surface: THREE.MeshStandardMaterial; depth?: THREE.MeshDepthMaterial };

function createFoliage(time: THREE.IUniform<number>, mode: 'canopy' | 'understory' | 'distant',
  detail: THREE.IUniform<number>): Foliage {
  const near = mode !== 'distant';
  const flex = mode === 'canopy' ? 0.36 : 0.9;
  const surface = new THREE.MeshStandardMaterial({
    side: THREE.DoubleSide, vertexColors: true, roughness: mode === 'understory' ? 0.64 : 0.77,
  });
  const wind = (vertex: string) => vertex
    .replace('#include <common>', '#include <common>\nuniform float uBreezeTime;\nattribute vec2 bladeUv;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 root = (modelMatrix * instanceMatrix[3]).xz;
        float gust = sin(dot(root, vec2(0.107, 0.081)) + uBreezeTime * 1.12);
        float sway = sin(dot(root, vec2(0.043, -0.061)) + uBreezeTime * 0.47);
        float flutter = sin(position.x*13.5 + position.z*14.7 + uBreezeTime*2.95);
        float bending = bladeUv.y * bladeUv.y * ${flex.toFixed(2)};
        transformed.x += (0.037 * gust + 0.022 * sway + 0.014 * flutter) * bending;
        transformed.z += (0.017 * gust - 0.015 * sway + 0.009 * flutter) * bending;
      #endif
    `);
  surface.onBeforeCompile = shader => {
    if (near) {
      shader.uniforms.uBreezeTime = time;
      shader.uniforms.uCoastLeafDetail = detail;
      shader.vertexShader = wind(shader.vertexShader);
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${near ? '' : 'attribute vec2 bladeUv;'}
        varying vec2 vBlade;
      `)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlade = bladeUv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vBlade;
        ${near ? `uniform float uCoastLeafDetail;\n${coastNoise}` : ''}
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float across = abs(vBlade.x - 0.5) * 2.0;
        float rib = 1.0 - smoothstep(0.016, 0.073, across);
        float veinT = (vBlade.y - across * 0.16) * 14.0;
        float veinlets = 1.0 - smoothstep(0.021, 0.12, abs(fract(veinT) - 0.5));
        float resolved = 1.0 - smoothstep(0.09, 0.58, fwidth(veinT));
        float base = smoothstep(0.0, 0.42, vBlade.y);
        vec3 tint = mix(vec3(0.80, 0.88, 0.77), vec3(1.08, 1.03, 0.87), base);
        diffuseColor.rgb *= tint * (1.0 + resolved * (rib * 0.29 + veinlets * 0.086) * base);
        ${near ? `
          float bladeRelief = 0.0;
          float bladeRoughness = 1.0;
          if (uCoastLeafDetail > 0.0) {
            float spread = pow(across, 0.73);
            float ribs = (vBlade.y - 0.19 * spread + 0.075 * across * vBlade.y) * 8.8;
            float lateralVein = 1.0 - smoothstep(0.025, 0.112 + 0.2 * fwidth(ribs), abs(fract(ribs) - 0.5));
            float membrane = smoothstep(0.06, 0.42, vBlade.y) * (1.0 - smoothstep(0.86, 1.0, vBlade.y));
            float visibleRibs = 1.0 - smoothstep(0.16, 0.67, fwidth(ribs));
            float vein = (0.76 * rib + lateralVein * (1.0 - 0.43 * across)) * membrane * visibleRibs;
            vec2 microUV = vBlade * vec2(19.0, 28.0) + vec2(0.31 * sin(25.0 * vBlade.y), 0.0);
            float grain = coastNoise(microUV);
            float patina = smoothstep(0.56, 0.83, coastNoise(microUV * 0.38 + vec2(2.0, 5.0)));
            float fine = 1.0 - smoothstep(0.28, 1.24, length(fwidth(microUV)));
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.92, 0.85, 0.63), patina * fine * 0.65);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.13, 1.19, 1.08)
              + vec3(0.014, 0.025, 0.007), vein * 0.66);
            bladeRelief = (0.0056 * vein + 0.0022 * (grain - 0.5) * fine) * membrane;
            bladeRoughness = mix(${mode === 'understory' ? '0.59' : '0.76'}, 0.96,
              clamp(patina * 0.31 + vein * 0.27 + across * 0.20, 0.0, 1.0));
          }
        ` : ''}
      `)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>

        // Thin leaf tissue transmits direct light already attenuated by the shadow map.
        void RE_Direct_CoastLeaf(const in IncidentLight directLight, const in vec3 geometryPosition,
          const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 clearcoatNormal,
          const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
          RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir,
            clearcoatNormal, material, reflectedLight);
          float backlight = max(0.0, dot(-geometryNormal, directLight.direction));
          float through = max(0.0, dot(geometryViewDir, -directLight.direction));
          float edge = abs(vBlade.x - 0.5) * 2.0;
          float tissue = mix(0.45, 1.0, smoothstep(0.08, 0.94, edge));
          reflectedLight.directDiffuse += material.diffuseColor * directLight.color * vec3(0.84, 1.0, 0.55)
            * backlight * tissue * (0.11 + 0.21 * through * through);
          ${near ? `if (uCoastLeafDetail > 0.0) {
            float lateralTissue = 0.52 + 0.48 * smoothstep(0.065, 0.70, edge);
            float membrane = smoothstep(0.06, 0.65, vBlade.y) * lateralTissue;
            vec3 tissueColor = vec3(0.82, 0.97, 0.40);
            reflectedLight.directDiffuse += material.diffuseColor * directLight.color * tissueColor
              * membrane * backlight * (0.23 + 0.40 * through * through);
          }` : ''}
        }

        #undef RE_Direct
        #define RE_Direct RE_Direct_CoastLeaf
      `);
    if (near) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor *= bladeRoughness;
        `)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          if (uCoastLeafDetail > 0.0) {
            vec3 leafDx = dFdx(-vViewPosition);
            vec3 leafDy = dFdy(-vViewPosition);
            vec3 leafR1 = cross(leafDy, normal);
            vec3 leafR2 = cross(normal, leafDx);
            float leafDet = dot(leafDx, leafR1) * faceDirection;
            vec3 gradient = sign(leafDet) * (dFdx(bladeRelief) * leafR1 + dFdy(bladeRelief) * leafR2);
            normal = normalize(max(0.000001, abs(leafDet)) * normal - gradient);
          }
        `);
    }
  };
  surface.customProgramCacheKey = () => `coast-leaf-${mode}`;
  if (!near) return { surface };

  const depth = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
  depth.onBeforeCompile = shader => {
    shader.uniforms.uBreezeTime = time;
    shader.vertexShader = wind(shader.vertexShader);
  };
  depth.customProgramCacheKey = () => `coast-leaf-depth-${mode}`;
  return { surface, depth };
}

function createBark(albedo: THREE.Texture, height: THREE.Texture, root = false): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.90 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uBarkAlbedo = { value: albedo };
    shader.uniforms.uBarkHeight = { value: height };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCoastBark, vBarkMeters, vBarkNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCoastBark = position;
        vBarkNormal = normal;
        vBarkMeters = position;
        #ifdef USE_INSTANCING
          vBarkMeters *= vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #endif
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCoastBark, vBarkMeters, vBarkNormal;
        uniform sampler2D uBarkAlbedo, uBarkHeight;
        ${coastNoise}
        vec3 barkProjection(sampler2D field, vec3 point, vec3 weights) {
          return texture2D(field, point.zy).rgb * weights.x + texture2D(field, point.xz).rgb * weights.y
            + texture2D(field, point.xy).rgb * weights.z;
        }
      `)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 p = vCoastBark;
        vec2 folds = ${root ? 'p.xz * 4.8' : '(p.xz + p.y * vec2(0.13, -0.091)) * 103.0'};
        float resolved = 1.0 - smoothstep(0.31, 1.8, length(fwidth(folds)));
        float plate = coastNoise(folds * 0.46 + vec2(p.y * 23.0, p.y * -13.0));
        float fissure = smoothstep(0.48, 0.78, coastNoise(folds + plate * 1.78) * 0.81 + plate * 0.19);
        float shellGrain = coastNoise(folds * 2.63 + p.y * vec2(-19.0, 5.0));
        vec2 mosaic = ${root ? 'p.xz * 1.76 + p.y' : 'p.xz * 21.3 + p.y * vec2(6.8, 8.2)'};
        float mossPatch = coastNoise(mosaic) * 0.73 + plate * 0.27;
        float damp = ${root ? '0.87' : '1.0 - smoothstep(0.024, 0.29, p.y)'};
        float moss = damp * smoothstep(0.39, 0.66, mossPatch + (shellGrain - 0.51) * 0.15 * resolved);
        float lichen = smoothstep(0.64, 0.82, mossPatch + 0.081 * fissure) * (1.0 - moss);
        vec3 weights = pow(abs(normalize(vBarkNormal)), vec3(4.0));
        weights /= weights.x + weights.y + weights.z;
        vec3 grain = vBarkMeters * vec3(0.93, 0.64, 0.93) + vec3(0.0, 0.04 * plate, 0.0);
        vec3 scan = barkProjection(uBarkAlbedo, grain, weights);
        vec3 treeTone = mix(vec3(0.96), diffuseColor.rgb * 3.8, 0.31);
        vec3 bark = scan * treeTone * (0.83 + 0.29 * plate - 0.18 * fissure * resolved);
        bark = mix(bark, vec3(0.041, 0.068, 0.021) * (0.68 + 0.62 * mossPatch), moss * 0.92);
        diffuseColor.rgb = mix(bark, bark * 0.72 + vec3(0.083, 0.092, 0.062), lichen * 0.73);
        float relief = 0.068 * barkProjection(uBarkHeight, grain, weights).r
          + (0.013 * plate - 0.005 * fissure + 0.002 * shellGrain) * resolved;
      `)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 barkDx = dFdx(-vViewPosition);
        vec3 barkDy = dFdy(-vViewPosition);
        vec3 barkR1 = cross(barkDy, normal);
        vec3 barkR2 = cross(normal, barkDx);
        float barkDet = dot(barkDx, barkR1);
        vec3 barkGradient = sign(barkDet) * (dFdx(relief) * barkR1 + dFdy(relief) * barkR2);
        normal = normalize(max(1e-8, abs(barkDet)) * normal - barkGradient);
      `);
  };
  material.customProgramCacheKey = () => root ? 'coast-bark-root' : 'coast-bark-tree';
  return material;
}

function palmTrunk(): THREE.BufferGeometry {
  const radialSegments = 12;
  const verticalSegments = 75;
  const geometry = new THREE.CylinderGeometry(0.028, 0.057, 1, radialSegments, verticalSegments);
  geometry.translate(0, 0.5, 0);
  const points = geometry.getAttribute('position');
  const colors = new Float32Array(points.count * 3);
  const fiber = new THREE.Color(0x85745d);
  for (let i = 0; i < points.count; i += 1) {
    const x = points.getX(i);
    const z = points.getZ(i);
    const t = points.getY(i);
    const bands = Math.abs(Math.sin(t * 113 - Math.atan2(z, x) * 0.27));
    const ridge = 1.0 + 0.11 * bands ** 5;
    points.setXYZ(i, x * ridge + 0.16 * t * t, t, z * ridge + 0.004 * Math.sin(Math.PI * t));
    const shade = 0.71 + 0.25 * bands + 0.16 * Math.cos(i * 2.399);
    colors.set([fiber.r * shade, fiber.g * shade, fiber.b * shade], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function plantTiles<T extends Plant>(plants: T[], size: number): Map<string, T[]> {
  const tiles = new Map<string, T[]>();
  for (const plant of plants) {
    const key = `${Math.floor(plant.x / size)},${Math.floor(plant.z / size)}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = [];
      tiles.set(key, tile);
    }
    tile.push(plant);
  }
  return tiles;
}

function tileOrigin(tile: Plant[], size: number): THREE.Vector3 {
  const anchor = tile[0];
  return new THREE.Vector3(
    (Math.floor(anchor.x / size) + 0.5) * size,
    tile.reduce((total, plant) => total + plant.y, 0) / tile.length,
    (Math.floor(anchor.z / size) + 0.5) * size,
  );
}

function plantShoreBroadleaf(distanceToPath: PlantingDistance): Tree[] {
  const random = coastRandom(6395194);
  const trees: Tree[] = [];
  const { minX, maxX, minZ, maxZ } = LANDSCAPE_BOUNDS;
  const regionSize = 88;
  for (let z0 = minZ; z0 < maxZ; z0 += regionSize) {
    for (let x0 = minX; x0 < maxX; x0 += regionSize) {
      const distance = Math.hypot(x0 + regionSize * 0.5 - SPAWN.x, z0 + regionSize * 0.5 - SPAWN.z);
      const spacing = distance < 340 ? 4.8 : 7.6;
      for (let cz = z0; cz < Math.min(z0 + regionSize, maxZ); cz += spacing) {
        for (let cx = x0; cx < Math.min(x0 + regionSize, maxX); cx += spacing) {
          const x = cx + random() * spacing;
          const z = cz + random() * spacing;
          if (x > maxX || z > maxZ || isInlandForest(x, z)) continue;
          const top = groundHeight(x, z);
          if (top < 2.4) continue;
          const slope = groundSlope(x, z, 1.4);
          const patch = Math.sin(x * 0.095 + z * 0.084) * Math.cos(z * 0.136 - x * 0.061);
          const cliff = slope > 1.39;
          const coastalGrass = top < 4.25 && z > 30 && Math.abs(x - SPAWN.x) < 48;
          if (coastalGrass || (cliff && (slope > 3.4 || patch < 0.03))) continue;

          const width = (0.71 + random() * 0.76) * (distance < 340 ? 3.68 : 5.2);
          const low = cliff || top < 8.4;
          const mature = !low && slope < 1.25 && patch > -0.39 && random() < 0.61;
          const form = low ? 'windPruned' : mature && random() < 0.55 ? 'emergent' : 'spreading';
          const stature = width * (low ? 0.79 + random() * 0.27
            : mature ? 1.57 + random() * 0.65 : 1.10 + random() * 0.52);
          const clearance = distanceToPath(x, z);
          if (clearance < 2.2 + width * 0.34) continue;
          const height = clearance < width + 2.2 ? Math.max(stature, low ? 5.2 : 6.6) : stature;
          if (Math.hypot(x + 18, z - 85) < 4.0 + width * 0.25) continue;
          trees.push({ ...makePlant(x, z, width, height, random, -slope * 0.15), form });
        }
      }
    }
  }
  return trees;
}

function plantShorePalms(distanceToPath: PlantingDistance): Plant[] {
  const random = coastRandom(441201);
  const palms: Plant[] = [];
  const addPalm = (x: number, z: number, height: number) => {
    if (distanceToPath(x, z) < 2.2 + height * 0.057 || Math.hypot(x + 18, z - 85) < 4.0) return;
    palms.push(makePlant(x, z, height * (0.78 + random() * 0.22), height, random, -0.15));
  };
  for (const [x, z, height] of [
    [-23, 70, 8.9], [-27, 73, 7.0], [-32, 75, 8.7], [-25, 82, 10.1], [-19, 85, 7.1], [-37, 79, 5.9], [-43, 71, 8.8],
    [1, 73, 8.1], [5, 80, 8.4], [14, 88, 9.2], [27, 81, 6.9], [39, 75, 7.4], [15, 92, 5.8],
    [-50, 61, 7.2], [-61, 51, 7.7], [-71, 44, 9.2],
  ]) addPalm(x, z, height);

  for (let i = 0; i < 2160 && palms.length < 116; i += 1) {
    const x = -174 + random() * 355;
    const z = -156 + random() * 274;
    const y = groundHeight(x, z);
    if (y < 2.05 || y > 24 || groundSlope(x, z) > 1.23) continue;
    if (Math.abs(x - SPAWN.x) < 12 && z < SPAWN.z + 10 && z > SPAWN.z - 36) continue;
    addPalm(x, z, 4.4 + random() * 6.4);
  }
  return palms;
}

function plantShoreFloor(distanceToPath: PlantingDistance): FloorPlant[] {
  const random = coastRandom(200513);
  const plants: FloorPlant[] = [];
  const addPlant = (x: number, z: number, width: number, height: number, form: FloorPlant['form'], detailOnly = false) => {
    const grass = form === 'grass' || form === 'sedge';
    if (distanceToPath(x, z) < (grass ? 1.76 + width * 0.30 : 2.12 + width * 0.84)
      || Math.hypot(x + 18, z - 85) < 4.0 + width * 0.51) return;
    plants.push({ ...makePlant(x, z, width, height, random, -0.04), form, detailOnly });
  };
  for (const [x, z, size, form] of [
    [-18.8, 71.7, 2.0, 'swordFern'], [-21.3, 74.8, 2.3, 'heliconia'], [-17.6, 76, 1.65, 'birdnest'],
    [-26, 70, 2.45, 'shieldLeaf'], [-20, 67, 1.05, 'sedge'], [-3.8, 75.65, 2.15, 'swordFern'],
    [-5.5, 77.6, 1.5, 'shieldLeaf'], [1.1, 83, 1.65, 'birdnest'], [3, 76.5, 1.18, 'sedge'], [6, 80, 2.1, 'heliconia'],
  ] as const) addPlant(x, z, size, size, form);

  for (const walk of COAST_WALKS) {
    const points = walk.points;
    for (let i = 2; i < points.length - 1; i += 2 + Math.floor(random() * 2)) {
      const point = points[i];
      if (point.y < 2.6 || point.z < SPAWN.z - 2 && Math.abs(point.x - SPAWN.x) < 10) continue;
      const dx = points[i + 1].x - points[i - 1].x;
      const dz = points[i + 1].z - points[i - 1].z;
      const sideLength = Math.hypot(dx, dz);
      for (const side of [-1, 1]) {
        const offset = side * (2.1 + random() * 2.92);
        const x = point.x + dz / sideLength * offset;
        const z = point.z - dx / sideLength * offset;
        if (groundHeight(x, z) < 2.0 || groundSlope(x, z, 0.76) > 1.48) continue;
        const width = 0.41 + random() ** 1.7;
        const form = point.y < 5.9 ? 'sedge' : random() < 0.73 ? 'grass' : 'swordFern';
        addPlant(x, z, width, width * (0.75 + random() * 0.25), form);
        addPlant(x + (random() - 0.5) * 1.7, z + (random() - 0.5) * 1.7, width * 0.78, width * 0.57, 'grass', true);
      }
    }
  }

  const spacing = 2.45;
  for (let row = -95; row <= 141; row += spacing) {
    for (let column = -167; column <= 170; column += spacing) {
      const x = column + spacing * random();
      const z = row + spacing * random();
      if (isInlandForest(x, z)) continue;
      const height = groundHeight(x, z);
      if (height < 1.65 || height > 26 || groundSlope(x, z) > 1.30) continue;
      const cover = 0.49 + 0.23 * Math.cos(x * 0.122 + z * 0.118) + 0.26 * Math.sin(z * 0.237 - x * 0.093);
      const sheltered = smoothstep(2.8, 7.4, height);
      if (random() > cover * (0.66 + 0.38 * sheltered)) continue;
      if (Math.abs(x - SPAWN.x) < 7.5 && z < SPAWN.z - 1) continue;
      const size = 0.37 + random() ** 1.89 * (0.76 + 0.94 * sheltered);
      const variety = random();
      const form = variety > sheltered * 0.82 ? (height < 4.6 ? 'sedge' : 'grass')
        : variety < 0.19 ? 'swordFern' : variety < 0.36 ? 'birdnest' : variety < 0.62 ? 'shieldLeaf' : 'heliconia';
      addPlant(x, z, size, size * (0.70 + random() * 0.35), form);
      if (cover > 0.44) {
        const width = 0.24 + random() * 0.66;
        addPlant(x + (random() - 0.5) * 1.95, z + (random() - 0.5) * 1.95, width, width * 0.87, 'grass', true);
      }
    }
  }
  return plants;
}

function groupTrees(parent: CoastVegetation, trees: Tree[], canopy: Foliage, leaves: Foliage,
  bark: THREE.MeshStandardMaterial, rootBark: THREE.MeshStandardMaterial): void {
  const forms = ['emergent', 'spreading', 'windPruned', 'buttressed', 'sapling'] as const;
  const models = forms.map(createCoastTreeMeshes);
  const horizon = createHorizonTreeMesh();
  const plainWood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const horizonMaterial = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, vertexColors: true, roughness: 0.88 });
  const tileSize = 36;
  for (const tile of plantTiles(trees, tileSize).values()) {
    const origin = tileOrigin(tile, tileSize);
    const placements = forms.map(form => tile.filter(tree => tree.form === form));
    const limits: Range[] = [[29, 38], [68, 94], [143, 188]];
    const levels = limits.map((limit, detail) => {
      const group = new THREE.Group();
      const foliage = detail === 0 ? canopy : leaves;
      const shadows = detail < 2;
      placements.forEach((plants, form) => {
        if (!plants.length) return;
        const model = models[form][detail];
        group.add(instances(model.wood, detail === 0 ? bark : plainWood, plants, origin, shadows),
          instances(model.leaves, foliage.surface, plants, origin, shadows, foliage.depth));
      });
      if (detail === 0 && tile.some(tree => tree.form !== 'sapling')) {
        const roots = new THREE.Mesh(createCoastRoots(tile, origin), rootBark);
        roots.castShadow = roots.receiveShadow = true;
        group.add(roots);
      }
      return { group, limit };
    });
    const distant = instances(horizon, horizonMaterial, tile, origin);
    distant.receiveShadow = false;
    parent.addTile('Forest canopy tile', origin, [...levels, { group: distant, limit: [867, 892] }]);
  }
}

function groupPalms(parent: CoastVegetation, plants: Plant[], leaves: Foliage, reduced: Foliage): void {
  const wood = palmTrunk();
  const bark = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.90 });
  const nearCrown = createPalmCrown(true);
  const farCrown = createPalmCrown(false);
  const tileSize = 48;
  for (const tile of plantTiles(plants, tileSize).values()) {
    const origin = tileOrigin(tile, tileSize);
    const detail = new THREE.Group();
    const distant = new THREE.Group();
    detail.add(instances(wood, bark, tile, origin, true),
      instances(nearCrown, leaves.surface, tile, origin, true, leaves.depth));
    distant.add(instances(wood, bark, tile, origin, true),
      instances(farCrown, reduced.surface, tile, origin, true));
    parent.addTile('Coastal palms tile', origin, [
      { group: detail, limit: [40, 62] }, { group: distant, limit: [221, 267] },
    ]);
  }
}

function groupFloor(parent: CoastVegetation, plants: FloorPlant[], leaves: Foliage, reduced: Foliage): void {
  const geo = floorForms.map(form => ({ near: createFloorModel(form, true), middle: createFloorModel(form, false) }));
  const tileSize = 22;
  for (const tile of plantTiles(plants, tileSize).values()) {
    const origin = tileOrigin(tile, tileSize);
    const near = new THREE.Group();
    const middle = new THREE.Group();
    const details = new THREE.Group();
    for (const [index, form] of floorForms.entries()) {
      const group = tile.filter(plant => plant.form === form && !plant.detailOnly);
      const extra = tile.filter(plant => plant.form === form && plant.detailOnly);
      const shadows = form !== 'grass' && form !== 'sedge';
      if (group.length) {
        near.add(instances(geo[index].near, leaves.surface, group, origin, shadows, leaves.depth));
        middle.add(instances(geo[index].middle, reduced.surface, group, origin, shadows));
      }
      if (extra.length) {
        details.add(instances(geo[index].near, leaves.surface, extra, origin));
      }
    }

    // Extra grass appears only in the near high-quality tier.
    if (details.children.length) parent.addTile('Fine grasses tile', origin, [{ group: details, limit: [0, 36] }]);
    if (near.children.length) parent.addTile('Forest understory tile', origin, [
      { group: near, limit: [28, 42] }, { group: middle, limit: [66, 88] },
    ]);
  }
}

export function createCoastVegetation(time: THREE.IUniform<number>, distanceToPath: PlantingDistance = () => Infinity,
  streamDistance: PlantingDistance = () => Infinity): CoastVegetation {
  const vegetation = new CoastVegetation();
  vegetation.name = 'Rainforest canopy, palms and understory';
  const floor = createFoliage(time, 'understory', vegetation.leafDetail);
  const canopy = createFoliage(time, 'canopy', vegetation.leafDetail);
  const distant = createFoliage(time, 'distant', vegetation.leafDetail);
  const barkAlbedo = loadCoastTexture('forest-bark.webp', true);
  const barkHeight = loadCoastTexture('forest-bark-height.webp', true);
  barkHeight.colorSpace = THREE.NoColorSpace;
  const forest = plantForest(distanceToPath, streamDistance);
  groupTrees(vegetation, plantShoreBroadleaf(distanceToPath).concat(forest.trees), canopy, distant,
    createBark(barkAlbedo, barkHeight), createBark(barkAlbedo, barkHeight, true));
  groupPalms(vegetation, plantShorePalms(distanceToPath), floor, distant);
  groupFloor(vegetation, plantShoreFloor(distanceToPath).concat(forest.understory), floor, distant);
  return vegetation;
}
