import * as THREE from 'three';
import { createOverlookSkyline, OVERLOOK_DISTRICTS, type SkylineLight } from './overlookSkyline';
import { DECK_LEVEL } from './overlookTerrain';

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
type BuildingForm = 'flat' | 'pitched' | 'terraced';

type CityVolume = {
  x: number; y: number; z: number;
  width: number; height: number; depth: number;
  yaw: number; color: THREE.Color;
  variant: number; facade: number;
};

const roofs = {
  plaster: [0xd3c4b2, 0xc4bfae, 0xa7a29a, 0xdbd4bd, 0xddd6cb, 0xb9b8ad],
  shingle: [0x807a72, 0x716965, 0x92908a, 0x73645e, 0x929296, 0xa69381],
  terracotta: [0xa17159, 0x986654, 0xad7860, 0xa77861, 0x8d6b5b, 0xb4866d],
  industrial: [0xbec3c0, 0xe0d8cc, 0x9e9d97, 0xcfd4d3, 0xb2ada5, 0xc6bab4],
  shops: [0xb6a48d, 0x9b9187, 0xb8b2a2, 0x99877d, 0xab9b83, 0x919b95],
  masonry: [0xbcb6aa, 0xa1978e, 0xa3978d, 0xb6aaa3, 0x8e8380, 0xc0b7a6],
  offices: [0x7a929f, 0x8296a2, 0x667d8d, 0x859a9d, 0x92999d, 0x99928a],
} as const;

const canopyColors = [0x455038, 0x46573e, 0x556447, 0x3d4e42, 0x50634f];

// Small groves on the open slope between the deck and the nearest street frontages.
const slopeGroves = [
  [225, -492, 66, 79], [335, -421, 74, 53], [480, -349, 72, 64],
  [546, -587, 101, 76], [668, -472, 85, 65], [651, -308, 68, 50],
] as const;

const commercialDistricts = [
  [OVERLOOK_DISTRICTS.campus, 1200, 970, 68],
  [OVERLOOK_DISTRICTS.west, 1440, 1080, 74],
  [OVERLOOK_DISTRICTS.midtown, 1110, 970, 96],
  [OVERLOOK_DISTRICTS.exchange, 1190, 980, 89],
  [OVERLOOK_DISTRICTS.central, 1770, 1440, 134],
  [OVERLOOK_DISTRICTS.parkway, 980, 810, 76],
  [OVERLOOK_DISTRICTS.east, 1540, 1210, 108],
  [OVERLOOK_DISTRICTS.gateway, 1370, 1160, 77],
  [[8300, -5200], 1700, 1130, 92],
  [OVERLOOK_DISTRICTS.south, 2050, 1360, 96],
  [OVERLOOK_DISTRICTS.westRidge, 1700, 1510, 88],
  [OVERLOOK_DISTRICTS.eastRidge, 1860, 1580, 104],
  [OVERLOOK_DISTRICTS.horizon, 2240, 1740, 100],
] as const;

const cityAir = /* glsl */`
  uniform float uNight;
  uniform vec3 uCityDayHaze;
  uniform vec3 uCityNightHaze;
  float cityTransmittance(vec3 world) {
    float distanceToEye = distance(world, cameraPosition);
    float layer = exp(-max(0.0, world.y + cameraPosition.y) * 0.0010);
    return exp(-distanceToEye * mix(0.000040, 0.000038, uNight) * (0.55 + 1.12 * layer));
  }
  vec3 cityInAir(vec3 color, float transmission) {
    return mix(mix(uCityDayHaze, uCityNightHaze, uNight), color, transmission);
  }

  float windowRandom(vec2 cell) {
    vec3 p = fract(vec3(cell.xyx) * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
`;

const towersVertex = /* glsl */`
  attribute vec3 color;
  attribute vec4 cityFacade;
  varying vec3 vCityColor;
  varying vec4 vFacade;
  varying float vTransmission;
  varying float vSkyReflection;
  uniform vec3 uCitySun;
  ${cityAir}
  void main() {
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    float sun = max(0.0, dot(normal, uCitySun));
    float roof = max(normal.y, 0.0);
    vec3 daylight = vec3(0.57, 0.65, 0.75) + sun * vec3(0.97, 0.86, 0.69) + roof * 0.19;
    vec3 nightlight = vec3(0.068, 0.100, 0.155) + roof * 0.058;
    vCityColor = color * mix(daylight, nightlight, uNight);
    vFacade = cityFacade;
    vTransmission = cityTransmittance(world);
    vSkyReflection = pow(1.0 - clamp(dot(normalize(cameraPosition - world), normal), 0.0, 1.0), 2.6);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const towersFragment = /* glsl */`
  varying vec3 vCityColor;
  varying vec4 vFacade;
  varying float vTransmission;
  varying float vSkyReflection;
  ${cityAir}

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
      float floorSuite = windowRandom(floor(window * vec2(0.12, 0.19)));
      float occupancy = mix(0.059 + 0.37 * floorSuite, smoothstep(0.55, 0.90, local * 0.67 + floorSuite * 0.55), resolved);
      float tint = windowRandom(floor(window * vec2(0.09, 0.14)) + vec2(13.0));
      vec3 light = mix(vec3(1.0, 0.78, 0.52), vec3(0.64, 0.79, 0.95), smoothstep(0.24, 0.85, tint));
      vec3 glazing = color * (0.58 + local * 0.095) + vec3(0.074, 0.143, 0.230) * (0.35 + 0.80 * vSkyReflection);
      color = mix(color, glazing, pane * (1.0 - uNight));
      color += uNight * pane * occupancy * light * (0.27 + 0.58 * floorSuite);
    }
    vec3 accent = mix(vec3(0.48, 0.76, 1.0), vec3(1.0, 0.56, 0.23), step(vFacade.w, -0.001));
    color += abs(vFacade.w) * uNight * accent;
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
  attribute float cityWindowScale;
  varying vec3 vCityColor;
  varying vec3 vBlockFace;
  varying float vBlockTransmission;
  uniform vec3 uCitySun;
  ${cityAir}
  void main() {
    vec3 p = position * cityScale;
    vec3 world = cityCenter + vec3(
      p.x * cityHeading.x + p.z * cityHeading.y,
      p.y,
      p.z * cityHeading.x - p.x * cityHeading.y
    );
    vec3 localNormal = normalize(normal / cityScale);
    vec3 n = localNormal;
    n = vec3(n.x * cityHeading.x + n.z * cityHeading.y, n.y, n.z * cityHeading.x - n.x * cityHeading.y);
    float facing = max(0.0, dot(n, uCitySun));
    float roof = smoothstep(0.18, 0.77, n.y);
    vec3 day = cityColor * (vec3(0.53, 0.62, 0.73) + facing * vec3(0.86, 0.78, 0.65) + roof * 0.10);
    day *= mix(0.54, 1.0, smoothstep(0.0, 0.46, position.y + roof * 0.2));
    vec3 dark = cityColor * (vec3(0.038, 0.054, 0.082) + roof * 0.039) + vec3(0.002, 0.004, 0.008);
    vCityColor = mix(day, dark, uNight);
    float across = abs(localNormal.x) > 0.5 ? p.z : p.x;
    vBlockFace = vec3(across * cityWindowScale + cityVariant * 81.0, p.y * 0.254, cityWindowScale * (1.0 - roof));
    vBlockTransmission = cityTransmittance(world);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const blocksFragment = /* glsl */`
  varying vec3 vCityColor;
  varying vec3 vBlockFace;
  varying float vBlockTransmission;
  ${cityAir}
  void main() {
    vec3 color = vCityColor;
    if (vBlockFace.z > 0.1) {
      vec2 cell = vBlockFace.xy;
      vec2 footprint = min(fwidth(cell), vec2(0.5));
      float resolved = 1.0 - smoothstep(0.30, 0.50, max(footprint.x, footprint.y));
      vec2 opening = 1.0 - smoothstep(vec2(0.34, 0.25) - footprint * 0.4,
        vec2(0.42, 0.34) + footprint * 0.4, abs(fract(cell) - 0.5));
      float pane = mix(0.48, opening.x * opening.y, resolved);
      float occupancy = windowRandom(floor(cell / vec2(6.1, 2.6)));
      float lit = mix(0.035 + occupancy * 0.25, smoothstep(0.52, 0.88, windowRandom(floor(cell)) * (0.73 + occupancy * 0.44)), resolved);
      float glass = smoothstep(0.27, 0.32, vBlockFace.z);
      // Shopfront glazing extends across the ground-floor bays.
      float storefront = (1.0 - glass) * (1.0 - smoothstep(1.24, 1.62, cell.y));
      pane = max(pane, storefront * (0.32 + 0.51 * mix(0.66, opening.x, resolved)));
      vec3 reflectedSky = vec3(0.071, 0.125, 0.174);
      vec3 electric = mix(vec3(1.0, 0.72, 0.41), vec3(0.63, 0.76, 1.0), step(0.72, occupancy));
      color = mix(color, color * 0.46 + reflectedSky * mix(0.58, 1.25, glass), pane * (1.0 - uNight));
      color += electric * lit * pane * uNight * (mix(0.43, 0.73, glass) + 0.14 * storefront);
    }
    gl_FragColor = vec4(cityInAir(color, vBlockTransmission), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const nightPointsVertex = /* glsl */`
  attribute float cityLightKind;
  attribute float cityPower;
  attribute float cityTemperature;
  uniform float uCityPixelFactor;
  varying vec3 vLamp;
  varying float vPower;
  varying float vScatter;
  ${cityAir}

  void main() {
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 view = viewMatrix * vec4(world, 1.0);
    float distanceToEye = length(view.xyz);
    float lightKind = cityLightKind;
    vec3 amber = vec3(1.0, 0.45, 0.14);
    vec3 warmWhite = vec3(1.0, 0.75, 0.45);
    vec3 coolWhite = vec3(0.64, 0.81, 1.0);
    vec3 color = mix(amber, warmWhite, smoothstep(0.09, 0.59, cityTemperature));
    color = mix(color, coolWhite, smoothstep(0.72, 0.96, cityTemperature));
    float diameter = 3.5;
    float radiance = 1.0;
    if (lightKind < 0.5) {
      diameter = 3.2;
      radiance = 0.86;
    } else if (lightKind < 2.5) {
      diameter = mix(3.5, 4.35, step(1.5, lightKind));
    } else if (lightKind < 3.5) {
      diameter = 4.1;
      radiance = 0.93;
    } else {
      color = vec3(1.0, 0.094, 0.071);
      diameter = 3.0;
      radiance = 0.86;
    }
    float distant = smoothstep(5300.0, 14800.0, distanceToEye);
    float spread = min(2.8, 2100.0 / max(750.0, distanceToEye));
    float practicalSize = diameter * (0.55 + 0.66 * cityPower) * mix(1.09, 0.94, distant);
    gl_PointSize = max(1.7, (practicalSize + spread) * uCityPixelFactor);
    float transmission = cityTransmittance(world);
    vec3 basinGlow = vec3(1.0, 0.57, 0.23);
    vLamp = mix(color, basinGlow, 0.70 * distant * (1.0 - step(3.5, lightKind)));
    vPower = transmission * radiance * (0.16 + cityPower * 0.96) * mix(1.14, 0.73, distant);
    vScatter = mix(0.18, 0.095, distant) * smoothstep(0.33, 0.99, cityPower);
    gl_Position = projectionMatrix * view;
  }
`;

const nightPointsFragment = /* glsl */`
  varying vec3 vLamp;
  varying float vPower;
  varying float vScatter;
  void main() {
    vec2 offset = gl_PointCoord * 2.0 - 1.0;
    float radiusSquared = dot(offset, offset);
    float core = exp(-radiusSquared * 7.7);
    float halo = exp(-radiusSquared * 2.1) * (1.0 - smoothstep(0.32, 1.0, radiusSquared));
    gl_FragColor = vec4(vLamp, vPower * (core + halo * vScatter));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function randomUnit(seed: number, salt: number): number {
  let n = Math.imul(seed ^ salt, 3266489917);
  n = Math.imul(n ^ n >>> 15, 2246822519);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}

function neighborhoodNoise(x: number, z: number, size: number, salt: number): number {
  const column = Math.floor(x / size), row = Math.floor(z / size);
  const east = THREE.MathUtils.smoothstep(x / size - column, 0, 1);
  const south = THREE.MathUtils.smoothstep(z / size - row, 0, 1);
  const cell = Math.imul(column, 27173) + Math.imul(row, 65539);
  const north = THREE.MathUtils.lerp(randomUnit(cell, salt), randomUnit(cell + 27173, salt), east);
  const next = THREE.MathUtils.lerp(randomUnit(cell + 65539, salt), randomUnit(cell + 92712, salt), east);
  return THREE.MathUtils.lerp(north, next, south);
}

function neighborhoodActivity(x: number, z: number): number {
  return neighborhoodNoise(x, z, 1240, 74) * 0.66 + neighborhoodNoise(x, z, 390, 327) * 0.34;
}

function flatGeometry(): THREE.BufferGeometry {
  // Open bottom. Capture sunlight on the rooftop and four walls.
  const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const indices = Array.from(geometry.index!.array).filter((_, i) => i < 18 || i >= 24);
  geometry.setIndex(indices);
  geometry.clearGroups();
  return geometry;
}

function terracedGeometry(flat: THREE.BufferGeometry): THREE.BufferGeometry {
  const base = flat.getAttribute('position');
  const indices = flat.index!.array;
  const positions: number[] = [];
  const levels = [
    { width: 1.00, depth: 1.00, from: 0, to: 0.17 },
    { width: 0.82, depth: 0.87, from: 0.17, to: 0.92 },
    { width: 0.48, depth: 0.60, from: 0.92, to: 1.00 },
  ];
  for (const { width, depth, from, to } of levels) {
    for (const index of indices) {
      positions.push(base.getX(index) * width, THREE.MathUtils.lerp(from, to, base.getY(index)), base.getZ(index) * depth);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
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

function canopyGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(0.5, 1);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const lobes = 0.94 + 0.14 * Math.sin(x * 16.1 + y * 8.7) * Math.cos(z * 14.3 - y * 5.6);
    const taper = 1 + Math.min(0, y) * 0.88;
    positions.setXYZ(i, x * lobes * taper, 0.45 + y * lobes, z * lobes * taper);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function tileKey(x: number, z: number): string {
  return `${Math.floor(x / 4500)}:${Math.floor(z / 4500)}`;
}

function append<Key, T>(map: Map<Key, T[]>, key: Key, item: T): void {
  const tile = map.get(key);
  if (tile) tile.push(item);
  else map.set(key, [item]);
}

function createBlocks(items: CityVolume[], material: THREE.ShaderMaterial, shape: THREE.BufferGeometry): THREE.Mesh {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = shape.index;
  geometry.setAttribute('position', shape.attributes.position);
  geometry.setAttribute('normal', shape.attributes.normal);
  const centers = new Float32Array(items.length * 3);
  const dimensions = new Float32Array(items.length * 3);
  const directions = new Float32Array(items.length * 2);
  const colors = new Float32Array(items.length * 3);
  const variety = new Float32Array(items.length);
  const facades = new Float32Array(items.length);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const [i, block] of items.entries()) {
    centers.set([block.x, block.y, block.z], i * 3);
    dimensions.set([block.width, block.height, block.depth], i * 3);
    directions.set([Math.cos(block.yaw), Math.sin(block.yaw)], i * 2);
    colors.set([block.color.r, block.color.g, block.color.b], i * 3);
    variety[i] = block.variant;
    facades[i] = block.facade;
    bounds.expandByPoint(point.set(block.x, block.y, block.z));
  }
  bounds.expandByScalar(100);
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
  geometry.setAttribute('cityCenter', new THREE.InstancedBufferAttribute(centers, 3));
  geometry.setAttribute('cityScale', new THREE.InstancedBufferAttribute(dimensions, 3));
  geometry.setAttribute('cityHeading', new THREE.InstancedBufferAttribute(directions, 2));
  geometry.setAttribute('cityColor', new THREE.InstancedBufferAttribute(colors, 3));
  geometry.setAttribute('cityVariant', new THREE.InstancedBufferAttribute(variety, 1));
  geometry.setAttribute('cityWindowScale', new THREE.InstancedBufferAttribute(facades, 1));
  geometry.instanceCount = items.length;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Inferred buildings on street frontages';
  return mesh;
}

function createPoints(points: SkylineLight[], material: THREE.ShaderMaterial): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(points.length * 3);
  const kinds = new Float32Array(points.length);
  const intensity = new Float32Array(points.length);
  const temperatures = new Float32Array(points.length);
  for (const [i, light] of points.entries()) {
    positions.set([light.x, light.y, light.z], i * 3);
    kinds[i] = light.kind;
    intensity[i] = light.power;
    temperatures[i] = light.temperature ?? 0.52;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('cityLightKind', new THREE.BufferAttribute(kinds, 1));
  geometry.setAttribute('cityPower', new THREE.BufferAttribute(intensity, 1));
  geometry.setAttribute('cityTemperature', new THREE.BufferAttribute(temperatures, 1));
  geometry.computeBoundingSphere();
  const lights = new THREE.Points(geometry, material);
  const viewport = new THREE.Vector2();
  lights.onBeforeRender = renderer => {
    renderer.getDrawingBufferSize(viewport);
    material.uniforms.uCityPixelFactor.value = Math.min(2.4, Math.max(0.60, viewport.y / 900));
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
  blocksFootprint?: (x: number, z: number, padding: number) => boolean;
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
  const skyline = createOverlookSkyline(heightAt, options.blocksFootprint);
  const landmarkMesh = new THREE.Mesh(skyline.geometry, skylineMaterial);
  landmarkMesh.name = 'Skyline landmarks';
  group.add(landmarkMesh);
  mainLamps.add(createPoints(skyline.lights, pointsMaterial));

  const ready = loadPlacements().then(view => {
    const buildingTiles = new Map<`${0 | 1}:${BuildingForm}:${string}`, CityVolume[]>();
    const canopyTiles = new Map<string, CityVolume[]>();
    const lampTiles = new Map<string, SkylineLight[]>();
    const appendCrown = (x: number, y: number, z: number, crown: number, yaw: number, seed: number) => {
      const shape = randomUnit(seed, 7403);
      const colorIndex = Math.floor(randomUnit(seed, 4221) * canopyColors.length);
      append(canopyTiles, tileKey(x, z), {
        x, y: y - 0.7, z, width: crown, depth: crown * (0.76 + shape * 0.31),
        height: crown * (0.62 + randomUnit(seed, 7927) * 0.45), yaw,
        color: new THREE.Color(canopyColors[colorIndex]), variant: shape, facade: 0,
      });
    };
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
      const footprint = Math.max(w, d) * 0.68;
      if (distance < 410 || closeToLandmark(x, z, footprint) || options.blocksFootprint?.(x, z, footprint)) continue;

      const ground = heightAt(x, z);
      if (ground < 1 || ground > 587) continue;
      const step = Math.min(22, Math.max(w, d) * 0.47);
      const edges = [heightAt(x - step, z), heightAt(x + step, z), heightAt(x, z - step), heightAt(x, z + step)];
      const lowest = Math.min(ground, ...edges), highest = Math.max(ground, ...edges);
      if (highest - lowest > step * 0.77) continue;

      const random = randomUnit(seed, 641);
      const nearby = distance < 8000;
      const variant = randomUnit(seed, 3464);
      let district = 0, rise = 0;
      for (const [[centerX, centerZ], width, depth, height] of commercialDistricts) {
        const reach = ((x - centerX) / width) ** 2 + ((z - centerZ) / depth) ** 2;
        if (reach > 4.8) continue;
        const influence = Math.exp(-reach);
        district = Math.max(district, influence);
        rise = Math.max(rise, influence * height);
      }
      const side = Math.min(w, d);
      const broadLot = THREE.MathUtils.smoothstep(side, 13, 31);
      const neighborhood = use === 0
        ? neighborhoodNoise(x, z, 950, 618) * 0.74 + neighborhoodNoise(x, z, 240, 663) * 0.26 : 0;
      const gardens = THREE.MathUtils.smoothstep(neighborhood, 0.38, 0.76);
      // Keep pockets of detached homes and reuse the other lots for shops and offices.
      const residentialShare = THREE.MathUtils.lerp(0.16, 0.76, gardens) * (1 - district * 0.85);
      const residence = use === 0 && randomUnit(seed, 9451) < residentialShare;
      const commercial = use !== 2 && !residence;
      const office = commercial && (use === 1 || random < 0.12 + broadLot * 0.32 + district * 0.41);
      const commercialHeight = office ? 15 + 12 * broadLot + 10 * variant + rise * (0.17 + 0.78 * random ** 1.55)
        : 9.4 + 7 * broadLot + 6.8 * variant + rise * (0.03 + 0.19 * random);
      const h = commercial ? Math.min(side * 3.3, commercialHeight)
        : use === 2 ? 7 + 12 * random + district * 8 : 4.5 + random ** 1.72 * 6.9;
      const form: BuildingForm = office && nearby && h > 28 && variant < (h > 50 ? 0.57 : 0.28) ? 'terraced'
        : residence && nearby && variant > 0.45 ? 'pitched' : 'flat';
      const palette = office ? (variant < 0.72 ? roofs.offices : roofs.masonry) : commercial ? roofs.shops : use === 2 ? roofs.industrial
        : random > 0.96 ? roofs.terracotta : random > 0.53 ? roofs.shingle : roofs.plaster;
      const color = new THREE.Color(palette[Math.min(palette.length - 1, Math.floor(variant * palette.length))]);
      color.multiplyScalar((residence ? 0.75 : 0.90) + randomUnit(seed, 1675) * 0.22);
      const feet = lowest - 3.0;
      const yaw = -view.getUint8(offset + 6) / 256 * Math.PI;
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      const tile = tileKey(x, z);
      const detail = !nearby && district < 0.31 && randomUnit(seed, 757) < (distance > 11000 ? 0.48 : 0.24);
      const building: CityVolume = {
        x, y: feet, z, width: w, depth: d, height: h + ground - feet, yaw, color, variant,
        facade: commercial ? (office ? 0.302 + variant * 0.047 : 0.184 + variant * 0.039) : 0,
      };
      if (commercial && side >= 17 && Math.max(w, d) >= 29 && h < 48 && randomUnit(seed, 7807) < 0.53) {
        // Wide plots can hold an office with a separate retail building along the same frontage.
        const alongWidth = w >= d;
        const dx = alongWidth ? cos : sin, dz = alongWidth ? -sin : cos;
        const span = Math.max(w, d);
        const lower: CityVolume = {
          ...building,
          x: x + dx * span * 0.335, z: z + dz * span * 0.335,
          width: w * (alongWidth ? 0.33 : 1), depth: d * (alongWidth ? 1 : 0.33),
          height: 5.8 + variant * 7.2 + ground - feet,
          color: new THREE.Color(roofs.shops[Math.floor(random * roofs.shops.length)]),
          facade: 0.191 + variant * 0.024,
        };
        append(buildingTiles, `${detail ? 1 : 0}:flat:${tile}`, lower);
        building.x -= dx * span * 0.205;
        building.z -= dz * span * 0.205;
        building.width *= alongWidth ? 0.59 : 1;
        building.depth *= alongWidth ? 1 : 0.59;
      }
      append(buildingTiles, `${detail ? 1 : 0}:${form}:${tile}`, building);
      if (residence && distance < 6200) {
        if (randomUnit(seed, 7194) < 0.16 + gardens * 0.71) {
          // Draw crowns along garden edges, outside the inferred roof footprint.
          const crown = 6 + gardens * 5 + randomUnit(seed, 4133) * 7;
          const side = (randomUnit(seed, 5120) > 0.46 ? -1 : 1) * (d * 0.5 + crown * 0.31);
          const along = (randomUnit(seed, 1539) - 0.5) * w * 0.91;
          const treeX = x + sin * side + cos * along, treeZ = z + cos * side - sin * along;
          const treeY = heightAt(treeX, treeZ);
          if (Math.abs(treeY - ground) < 6.5 && Math.hypot(treeX, treeZ) > 405
            && !options.blocksFootprint?.(treeX, treeZ, crown * 0.45)) {
            appendCrown(treeX, treeY, treeZ, crown, yaw, seed);
          }
        }
      }
      const activity = neighborhoodActivity(x, z);
      const lit = randomUnit(seed, 2629);
      const occupancy = use === 2 ? 0.13 + activity * 0.36 : 0.24 + activity * 0.58;
      if (lit > occupancy * (commercial ? 0.62 : 1)) continue;

      // The street-aligned façades catch different lights in adjoining rooms and entrances.
      const frontage = (sin * building.x + cos * building.z > 0 ? -1 : 1)
        * building.depth * (form === 'terraced' ? 0.439 : 0.515);
      const along = (randomUnit(seed, 1331) - 0.5) * building.width * 0.79;
      const temperature = 0.28 + randomUnit(seed, 2003) * (use === 2 ? 0.70 : 0.49);
      const power = 0.25 + randomUnit(seed, 4907) ** 1.43 * (0.56 + activity * 0.16) + 0.15 * activity;
      const lampX = building.x + sin * frontage + cos * along, lampZ = building.z + cos * frontage - sin * along;
      append(lampTiles, `0:${tile}`, {
        x: lampX, z: lampZ, y: ground + Math.min(h * (0.32 + random * 0.22), 12), kind: 0, power, temperature,
      });
      if (nearby && power > 0.52 && randomUnit(seed, 1617) < 0.35) {
        const spacing = (along > 0 ? -1 : 1) * building.width * (0.28 + variant * 0.2);
        append(lampTiles, `0:${tile}`, {
          x: lampX + cos * spacing, z: lampZ - sin * spacing,
          y: ground + Math.min(h * 0.39, 10), kind: 0, power: power * 0.68, temperature,
        });
      }
    }

    for (let i = 0; i < lampCount; i += 1, offset += 6) {
      const x = minX + view.getUint16(offset, true);
      const z = minZ + view.getUint16(offset + 2, true);
      const kind = view.getUint8(offset + 4), sourceIntensity = view.getUint8(offset + 5) / 255;
      const ground = heightAt(x, z);
      const distance = Math.hypot(x, z);
      if (ground < 1 || ground > 520 || distance < 465 || closeToLandmark(x, z, -14)
        || options.blocksFootprint?.(x, z, 0)) continue;
      const seed = Math.imul(x, 27173) + Math.imul(z, 65539);
      const activity = neighborhoodActivity(x, z);
      const power = Math.min(1.18, (0.17 + 0.89 * sourceIntensity ** 1.7) * (0.70 + 0.64 * activity));
      const electricDistrict = neighborhoodNoise(x, z, 820, 438);
      const temperature = (kind === 2 ? 0.11 : 0) + electricDistrict * 0.69 + randomUnit(seed, 863) * 0.36;
      const extra = kind === 1 && power < 0.36 && distance > 5300;
      append(lampTiles, `${extra ? '1' : '0'}:${tileKey(x, z)}`, {
        x, y: ground + (kind === 1 ? 6 : kind === 2 ? 8 : 4.4) + randomUnit(seed, 272) * 1.8,
        z, kind, power, temperature,
      });
    }

    const groveSpacing = 14;
    for (const [centerX, centerZ, radiusX, radiusZ] of slopeGroves) {
      for (let row = -Math.floor(radiusZ / groveSpacing); row <= radiusZ / groveSpacing; row += 1) {
        for (let column = -Math.floor(radiusX / groveSpacing); column <= radiusX / groveSpacing; column += 1) {
          const seed = Math.imul(centerX + column, 27173) + Math.imul(centerZ + row, 65539);
          const x = centerX + (column + randomUnit(seed, 1528) - 0.5) * groveSpacing;
          const z = centerZ + (row + randomUnit(seed, 3828) - 0.5) * groveSpacing;
          const edge = ((x - centerX) / radiusX) ** 2 + ((z - centerZ) / radiusZ) ** 2;
          if (edge > 0.58 + neighborhoodNoise(x, z, 35, 112) * 0.48 || Math.hypot(x, z) < 420
            || randomUnit(seed, 4093) < 0.17 || options.blocksFootprint?.(x, z, 7.5)) continue;
          const y = heightAt(x, z);
          const width = 7 + randomUnit(seed, 8149) * 8;
          if (y > 1 && y + width * 1.07 < DECK_LEVEL - 24) {
            appendCrown(x, y, z, width, randomUnit(seed, 8431) * Math.PI, seed);
          }
        }
      }
    }
    const flat = flatGeometry();
    const shapes = { flat, pitched: pitchedGeometry(), terraced: terracedGeometry(flat) };
    for (const [key, buildings] of buildingTiles) {
      const form = key.split(':', 2)[1] as BuildingForm;
      const mesh = createBlocks(buildings, blockMaterial, shapes[form]);
      (key[0] === '1' ? extraRoofs : group).add(mesh);
    }
    const canopy = canopyGeometry();
    for (const crowns of canopyTiles.values()) {
      const mesh = createBlocks(crowns, blockMaterial, canopy);
      mesh.name = 'Neighborhood tree crowns';
      group.add(mesh);
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
