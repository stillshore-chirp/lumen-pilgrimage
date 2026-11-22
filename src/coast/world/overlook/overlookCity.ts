import * as THREE from 'three';
import { createOverlookSkyline, type SkylineLight } from './overlookSkyline';

const minX = -23000;
const minZ = -26000;
const width = 46000;
const depth = 37000;
const assetRoot = `${import.meta.env.BASE_URL}coast-overlook/`;

export function createOverlookCityGround() {
  const bounds = new THREE.Vector4(minX, minZ, width, depth);
  const texture = new THREE.Texture();
  texture.name = 'Census street and development coverage';
  texture.colorSpace = THREE.NoColorSpace;
  // The first image row maps to the south edge (minimum world Z).
  texture.flipY = false;
  texture.anisotropy = 8;
  const ready = new THREE.ImageLoader().loadAsync(`${assetRoot}overlook-streets.webp`).then(image => {
    texture.image = image;
    texture.needsUpdate = true;
  });
  return { texture, bounds, ready };
}

type TimeOfDay = 'day' | 'night';
type Quality = 'light' | 'high';

type Building = {
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  yaw: number; color: THREE.Color;
  pitch: boolean; variant: number;
};

const roofs = {
  plaster: [0xd3c4b2, 0xc4bfae, 0xa7a29a, 0xdbd4bd, 0xddd6cb, 0xb9b8ad],
  shingle: [0x807a72, 0x716965, 0x92908a, 0x73645e, 0x929296, 0xa69381],
  terracotta: [0xa17159, 0x986654, 0xad7860, 0xa77861, 0x8d6b5b, 0xb4866d],
  commercial: [0xd7d1c4, 0xa6abb0, 0xc6c4b8, 0x969995, 0xc4bab1, 0xb9b9b1],
  industrial: [0xbec3c0, 0xe0d8cc, 0x9e9d97, 0xcfd4d3, 0xb2ada5, 0xc6bab4],
} as const;

const cityAir = /* glsl */`
  uniform float uNight;
  uniform vec3 uCityDayHaze;
  uniform vec3 uCityNightHaze;
  float cityTransmittance(vec3 world) {
    float distanceToEye = distance(world, cameraPosition);
    float layer = exp(-max(0.0, world.y + cameraPosition.y) * 0.0010);
    return exp(-distanceToEye * mix(0.000058, 0.000042, uNight) * (0.60 + 1.12 * layer));
  }
  vec3 cityInAir(vec3 color, float transmission) {
    return mix(mix(uCityDayHaze, uCityNightHaze, uNight), color, transmission);
  }
`;

const towersVertex = /* glsl */`
  attribute vec3 color;
  attribute vec4 cityFacade;
  varying vec3 vCityColor;
  varying vec4 vFacade;
  varying float vTransmission;
  uniform vec3 uCitySun;
  ${cityAir}
  void main() {
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    float sun = max(0.0, dot(normal, uCitySun));
    float dayExposure = 0.72 + sun * 0.84 + max(normal.y, 0.0) * 0.16;
    float nightExposure = 0.13 + max(normal.y, 0.0) * 0.13;
    vCityColor = color * mix(dayExposure, nightExposure, uNight);
    vFacade = cityFacade;
    vTransmission = cityTransmittance(world);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const towersFragment = /* glsl */`
  varying vec3 vCityColor;
  varying vec4 vFacade;
  varying float vTransmission;
  ${cityAir}

  float windowRandom(vec2 cell) {
    vec3 p = fract(vec3(cell.xyx) * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 color = vCityColor;
    if (vFacade.z > 0.1) {
      vec2 window = vFacade.xy * vec2(0.30 * vFacade.z, 0.243);
      vec2 pixel = fwidth(window);
      vec2 frame = abs(fract(window) - 0.5);
      vec2 panes = 1.0 - smoothstep(vec2(0.31, 0.30) - min(pixel, vec2(0.28)),
        vec2(0.39, 0.38) + min(pixel, vec2(0.29)), frame);
      float resolved = 1.0 - smoothstep(0.65, 2.2, max(pixel.x, pixel.y));
      float pane = mix(0.34, panes.x * panes.y, resolved);
      float local = windowRandom(floor(window));
      float floorSuite = windowRandom(floor(window * vec2(0.20, 0.365)));
      float occupancy = mix(0.17 + 0.47 * floorSuite, smoothstep(0.43, 0.75, local * 0.77 + floorSuite * 0.52), resolved);
      float tint = windowRandom(floor(window * vec2(0.29, 0.49)) + vec2(13.0));
      vec3 light = mix(vec3(0.88, 0.55, 0.25), vec3(0.34, 0.57, 0.76), smoothstep(0.25, 0.80, tint));
      color *= 1.0 - pane * mix(0.57, 0.33, uNight);
      color += uNight * pane * occupancy * light * (0.30 + 0.42 * floorSuite);
    }
    color += vFacade.w * uNight * vec3(0.30, 0.49, 0.67);
    gl_FragColor = vec4(cityInAir(color, vTransmission), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const blocksVertex = /* glsl */`
  attribute vec3 cityCenter;
  attribute vec3 cityScale;
  attribute vec2 cityHeading;
  attribute vec3 cityColor;
  attribute float cityVariant;
  varying vec3 vCityColor;
  uniform vec3 uCitySun;
  ${cityAir}
  void main() {
    vec3 p = position * cityScale;
    vec3 world = cityCenter + vec3(
      p.x * cityHeading.x + p.z * cityHeading.y,
      p.y,
      p.z * cityHeading.x - p.x * cityHeading.y
    );
    vec3 n = normalize(normal / cityScale);
    n = vec3(n.x * cityHeading.x + n.z * cityHeading.y, n.y, n.z * cityHeading.x - n.x * cityHeading.y);
    float facing = max(0.0, dot(n, uCitySun));
    float roof = smoothstep(0.18, 0.77, n.y);
    vec3 walls = mix(cityColor, vec3(0.46, 0.40, 0.343), 0.19);
    vec3 base = mix(walls, cityColor, roof);
    float sunlight = 0.64 + facing * 0.85 + roof * 0.14;
    float shade = mix(0.56, 1.0, smoothstep(0.0, 0.95, position.y + roof * 0.2));
    vec3 day = base * sunlight * shade;
    vec3 dark = base * (0.092 + roof * 0.050) + vec3(0.006, 0.010, 0.018);
    dark += (1.0 - roof) * vec3(0.011, 0.006, 0.001) * cityVariant;
    vCityColor = cityInAir(mix(day, dark, uNight), cityTransmittance(world));
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const blocksFragment = /* glsl */`
  varying vec3 vCityColor;
  void main() {
    gl_FragColor = vec4(vCityColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const nightPointsVertex = /* glsl */`
  attribute float cityLightKind;
  attribute float cityPower;
  uniform float uCityPixelFactor;
  varying vec3 vLamp;
  varying float vPower;
  ${cityAir}

  void main() {
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 view = viewMatrix * vec4(world, 1.0);
    float distanceToEye = length(view.xyz);
    float lightKind = cityLightKind;
    vec3 amber = vec3(1.0, 0.44, 0.12);
    vec3 warmWhite = vec3(1.0, 0.75, 0.46);
    vec3 coolWhite = vec3(0.64, 0.77, 1.0);
    vec3 color = mix(amber, warmWhite, smoothstep(0.2, 0.8, cityPower));
    float size = 1.02;
    if (lightKind < 0.5) {
      color = mix(amber, warmWhite, smoothstep(0.25, 1.0, cityPower));
      size = 0.81;
    } else if (lightKind < 1.5) {
      color = mix(color, coolWhite, 0.29 * step(0.66, cityPower));
    } else if (lightKind < 2.5) {
      color = mix(warmWhite, coolWhite, 0.72 * smoothstep(0.49, 0.95, cityPower));
      size = 1.33;
    } else if (lightKind < 3.5) {
      color = mix(amber * vec3(1.0, 0.80, 0.7), warmWhite, 0.82 * step(0.48, cityPower));
      size = 1.45;
    } else {
      color = vec3(1.0, 0.086, 0.050);
      size = 1.8;
    }
    float coreSize = 1.16 + cityPower * 0.87 + 1400.0 / max(850.0, distanceToEye);
    gl_PointSize = clamp(size * coreSize * uCityPixelFactor, 1.3, 6.5 * uCityPixelFactor);
    vLamp = color;
    float distanceFade = 1.0 - 0.30 * smoothstep(6800.0, 21000.0, distanceToEye);
    vPower = cityTransmittance(world) * (0.34 + cityPower * 0.68) * min(1.0, size * 0.90) * distanceFade;
    gl_Position = projectionMatrix * view;
  }
`;

const nightPointsFragment = /* glsl */`
  varying vec3 vLamp;
  varying float vPower;
  void main() {
    float radius = length(gl_PointCoord - 0.5) * 2.0;
    if (radius > 1.0) discard;
    float core = 1.0 - smoothstep(0.16, 0.76, radius);
    float halo = exp(-radius * radius * 3.0);
    gl_FragColor = vec4(vLamp, vPower * (core * 0.75 + halo * 0.20));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function randomUnit(seed: number, salt: number): number {
  let n = Math.imul(seed ^ salt, 3266489917);
  n = Math.imul(n ^ n >>> 15, 2246822519);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}

function flatGeometry(): THREE.BufferGeometry {
  // Open bottom. Capture sunlight on the rooftop and four walls.
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const indices = Array.from(geometry.index!.array).filter((_, i) => i < 18 || i >= 24);
  geometry.setIndex(indices);
  geometry.clearGroups();
  return geometry;
}

function pitchedGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const a = [-0.5, 0, -0.5], b = [0.5, 0, -0.5], c = [0.5, 0, 0.5], d = [-0.5, 0, 0.5];
  const e = [-0.5, 0.68, -0.5], f = [0.5, 0.68, -0.5], g = [0.5, 0.68, 0.5], h = [-0.5, 0.68, 0.5];
  const i = [-0.5, 1, 0], j = [0.5, 1, 0];
  const quad = (v0: number[], v1: number[], v2: number[], v3: number[]) => positions.push(...v0, ...v1, ...v2, ...v0, ...v2, ...v3);
  quad(a, e, f, b);
  quad(b, f, g, c);
  quad(c, g, h, d);
  quad(d, h, e, a);
  quad(e, i, j, f);
  quad(i, h, g, j);
  positions.push(...e, ...h, ...i, ...f, ...j, ...g);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function tileKey(x: number, z: number): string {
  return `${Math.floor(x / 4500)}:${Math.floor(z / 4500)}`;
}

function append<T>(map: Map<string, T[]>, key: string, item: T): void {
  const tile = map.get(key);
  if (tile) tile.push(item);
  else map.set(key, [item]);
}

function createBlocks(items: Building[], material: THREE.ShaderMaterial, shape: THREE.BufferGeometry): THREE.Mesh {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = shape.index;
  geometry.setAttribute('position', shape.attributes.position);
  geometry.setAttribute('normal', shape.attributes.normal);
  const centers = new Float32Array(items.length * 3);
  const dimensions = new Float32Array(items.length * 3);
  const directions = new Float32Array(items.length * 2);
  const colors = new Float32Array(items.length * 3);
  const variety = new Float32Array(items.length);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const [i, block] of items.entries()) {
    centers.set([block.x, block.y, block.z], i * 3);
    dimensions.set([block.width, block.height, block.depth], i * 3);
    directions.set([Math.cos(block.yaw), Math.sin(block.yaw)], i * 2);
    colors.set([block.color.r, block.color.g, block.color.b], i * 3);
    variety[i] = block.variant;
    bounds.expandByPoint(point.set(block.x, block.y, block.z));
  }
  bounds.expandByScalar(100);
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  geometry.setAttribute('cityCenter', new THREE.InstancedBufferAttribute(centers, 3));
  geometry.setAttribute('cityScale', new THREE.InstancedBufferAttribute(dimensions, 3));
  geometry.setAttribute('cityHeading', new THREE.InstancedBufferAttribute(directions, 2));
  geometry.setAttribute('cityColor', new THREE.InstancedBufferAttribute(colors, 3));
  geometry.setAttribute('cityVariant', new THREE.InstancedBufferAttribute(variety, 1));
  geometry.instanceCount = items.length;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = items[0].pitch ? 'Pitched residential roofs' : 'Inferred buildings on street frontages';
  return mesh;
}

function createPoints(points: SkylineLight[], material: THREE.ShaderMaterial): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(points.length * 3);
  const kinds = new Float32Array(points.length);
  const intensity = new Float32Array(points.length);
  for (const [i, light] of points.entries()) {
    positions.set([light.x, light.y, light.z], i * 3);
    kinds[i] = light.kind;
    intensity[i] = light.power;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('cityLightKind', new THREE.BufferAttribute(kinds, 1));
  geometry.setAttribute('cityPower', new THREE.BufferAttribute(intensity, 1));
  geometry.computeBoundingSphere();
  const lights = new THREE.Points(geometry, material);
  const viewport = new THREE.Vector2();
  lights.onBeforeRender = renderer => {
    renderer.getDrawingBufferSize(viewport);
    material.uniforms.uCityPixelFactor.value = Math.min(2.4, Math.max(0.86, viewport.y / 860));
  };
  lights.name = 'Street and building lights';
  return lights;
}

async function loadPlacements(): Promise<DataView> {
  const response = await fetch(`${assetRoot}overlook-buildings.bin.gz`);
  if (!response.ok) throw new Error('Overlook city placements could not be loaded');
  const packed = await response.arrayBuffer();
  // Some static hosting configurations already decode a Content-Encoding: gzip response.
  const signature = new Uint8Array(packed, 0, Math.min(2, packed.byteLength));
  const startsWithGzip = signature[0] === 0x1f && signature[1] === 0x8b;
  const unpacked = startsWithGzip
    ? await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : packed;
  const view = new DataView(unpacked);
  if (view.byteLength < 12 || view.getUint32(0) !== 0x4f564331
    || view.byteLength !== 12 + view.getUint32(4, true) * 8 + view.getUint32(8, true) * 6) {
    throw new Error('Overlook city placements have an unexpected format');
  }
  return view;
}

export type OverlookCityOptions = {
  sunDirection?: THREE.Vector3;
  dayHaze?: THREE.ColorRepresentation;
  nightHaze?: THREE.ColorRepresentation;
};

export function createOverlookCity(heightAt: (x: number, z: number) => number, options: OverlookCityOptions = {}) {
  const group = new THREE.Group();
  group.name = 'City basin';
  const nightPoints = new THREE.Group();
  const mainLamps = new THREE.Group();
  const extraLamps = new THREE.Group();
  const extraRoofs = new THREE.Group();
  nightPoints.visible = false;
  extraRoofs.visible = false;
  extraLamps.visible = false;
  nightPoints.add(mainLamps, extraLamps);
  group.add(nightPoints, extraRoofs);

  const uniforms = {
    uNight: { value: 0 },
    uCitySun: { value: (options.sunDirection ?? new THREE.Vector3(-0.46, 0.70, 0.55)).clone().normalize() },
    uCityDayHaze: { value: new THREE.Color(options.dayHaze ?? 0x9aafb8) },
    uCityNightHaze: { value: new THREE.Color(options.nightHaze ?? 0x2c3441) },
  };
  const blockMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: blocksVertex, fragmentShader: blocksFragment });
  const skylineMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: towersVertex, fragmentShader: towersFragment });
  const pointsMaterial = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uCityPixelFactor: { value: 1 } },
    vertexShader: nightPointsVertex,
    fragmentShader: nightPointsFragment,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const skyline = createOverlookSkyline(heightAt);
  const landmarkMesh = new THREE.Mesh(skyline.geometry, skylineMaterial);
  landmarkMesh.name = 'Skyline landmarks';
  group.add(landmarkMesh);
  mainLamps.add(createPoints(skyline.lights, pointsMaterial));

  const ready = loadPlacements().then(view => {
    const buildingTiles = new Map<string, Building[]>();
    const lampTiles = new Map<string, SkylineLight[]>();
    const closeToLandmark = (x: number, z: number, padding: number) => skyline.exclusions.some(exclusion =>
      (x - exclusion.x) ** 2 + (z - exclusion.z) ** 2 < (exclusion.radius + padding) ** 2,
    );
    const buildingCount = view.getUint32(4, true);
    const lampCount = view.getUint32(8, true);
    let offset = 12;
    for (let i = 0; i < buildingCount; i += 1, offset += 8) {
      const x = minX + view.getUint16(offset, true);
      const z = minZ + view.getUint16(offset + 2, true);
      const seed = Math.imul(x, 27173) + Math.imul(z, 65539);
      const w = view.getUint8(offset + 4), d = view.getUint8(offset + 5);
      const use = view.getUint8(offset + 7);
      const distance = Math.hypot(x, z);
      if (distance < 525 || closeToLandmark(x, z, Math.min(w, d) * 0.4)) continue;

      const ground = heightAt(x, z);
      if (ground < 1 || ground > 587) continue;
      const step = Math.min(22, Math.max(w, d) * 0.47);
      const edges = [heightAt(x - step, z), heightAt(x + step, z), heightAt(x, z - step), heightAt(x, z + step)];
      const lowest = Math.min(ground, ...edges), highest = Math.max(ground, ...edges);
      if (highest - lowest > step * 0.77) continue;

      const random = randomUnit(seed, 641);
      const nearby = distance < 5600;
      const pitch = nearby && use === 0 && random > 0.20;
      const urban = use !== 0;
      const business = Math.exp(-(((x - 4650) / 1500) ** 2 + ((z + 7540) / 1020) ** 2));
      const highStreet = Math.exp(-(((z + 6280) / 410) ** 2 + ((x + 5000) / 6500) ** 2));
      const restrained = use === 2 ? 0.22 : random;
      const h = (urban ? 5.4 + restrained ** 1.80 * 14 : 3.5 + random ** 2 * 6.4) +
        (business * (7 + restrained ** 3 * 47) + highStreet * restrained * 16);
      const palette = use === 2 ? roofs.industrial : use === 1 ? roofs.commercial :
        random > 0.92 ? roofs.terracotta : random > 0.43 ? roofs.shingle : roofs.plaster;
      const variant = randomUnit(seed, 3464);
      const color = new THREE.Color(palette[Math.min(palette.length - 1, Math.floor(variant * palette.length))]);
      color.multiplyScalar(0.85 + randomUnit(seed, 1675) * 0.31);
      const feet = lowest - 3.0;
      const yaw = -view.getUint8(offset + 6) / 256 * Math.PI;
      const tile = tileKey(x, z);
      const detail = !nearby && business < 0.31 && randomUnit(seed, 757) < (distance > 11000 ? 0.56 : 0.30);
      append(buildingTiles, `${detail ? '1' : '0'}${pitch ? 'p' : 'f'}:${tile}`, {
        x, y: feet, z, width: w, depth: d, height: h + ground - feet, yaw, color, pitch, variant,
      });
      if (variant > 0.76 && distance < 16500 && (urban || random > 0.45)) {
        append(lampTiles, `${urban || !detail ? '0' : '1'}:${tile}`, {
          x: x + Math.sin(yaw) * d * 0.53, z: z + Math.cos(yaw) * d * 0.53,
          y: ground + Math.min(h * 0.72, 9.2), kind: 0, power: 0.42 + variant * 0.45,
        });
      }
    }

    for (let i = 0; i < lampCount; i += 1, offset += 6) {
      const x = minX + view.getUint16(offset, true);
      const z = minZ + view.getUint16(offset + 2, true);
      const kind = view.getUint8(offset + 4), power = view.getUint8(offset + 5) / 255;
      const ground = heightAt(x, z);
      if (ground < 1 || ground > 520 || Math.hypot(x, z) < 615 || closeToLandmark(x, z, -14)) continue;
      const extra = kind === 1 && power < 0.54 && Math.hypot(x, z) > 3700;
      append(lampTiles, `${extra ? '1' : '0'}:${tileKey(x, z)}`, {
        x, y: ground + (kind === 1 ? 6 : kind === 2 ? 8 : 4.4), z, kind, power,
      });
    }
    const flat = flatGeometry();
    const pitched = pitchedGeometry();
    for (const [key, buildings] of buildingTiles) {
      const mesh = createBlocks(buildings, blockMaterial, key[1] === 'p' ? pitched : flat);
      (key[0] === '1' ? extraRoofs : group).add(mesh);
    }
    for (const [key, lamps] of lampTiles) {
      (key[0] === '1' ? extraLamps : mainLamps).add(createPoints(lamps, pointsMaterial));
    }
  });

  return {
    group,
    ready,
    setTimeOfDay(time: TimeOfDay) {
      uniforms.uNight.value = time === 'night' ? 1 : 0;
      nightPoints.visible = time === 'night';
    },
    setQuality(quality: Quality) {
      const high = quality === 'high';
      extraLamps.visible = extraRoofs.visible = high;
    },
  };
}
