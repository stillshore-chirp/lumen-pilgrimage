import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COAST_BOUNDS, POOL, SEA_LEVEL, SPAWN, WATERFALL, groundHeight, shoreline } from './terrain';
import { addCoastSurfaceDetail } from './world/coastSurface';
import { createCoastOceanMaterial } from './world/coastOcean';
import { createCoastSky } from './world/coastSky';
import { createWaterfall, createWaterfallPool, FALL_IMPACT_Z } from './world/coastWaterfall';

export type CoastQuality = 'low' | 'normal';

interface TreeSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  readonly width: number;
  readonly kind: 'palm' | 'broadleaf';
  readonly tint: THREE.Color;
  readonly yaw: number;
}

interface GrassSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: THREE.Vector3;
  readonly yaw: number;
  readonly tint: THREE.Color;
}

interface RockSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: THREE.Vector3;
  readonly yaw: number;
  readonly tint: THREE.Color;
}

interface MistSample {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly phase: number;
}

const TERRAIN_SAND = new THREE.Color(0xd2b47c);
const TERRAIN_GRASS = new THREE.Color(0x52734d);
const TERRAIN_HIGH_GRASS = new THREE.Color(0x5b7d52);
const TERRAIN_ROCK = new THREE.Color(0x807d71);
const TERRAIN_SHADOW_ROCK = new THREE.Color(0x5c625d);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleSlope(x: number, z: number, distance = 1.1): number {
  const dx = groundHeight(x + distance, z) - groundHeight(x - distance, z);
  const dz = groundHeight(x, z + distance) - groundHeight(x, z - distance);
  return Math.hypot(dx, dz) / (2 * distance);
}

function pointOutsideViewCorridor(x: number, z: number, halfWidth: number): boolean {
  const t = (SPAWN.z - z) / (SPAWN.z + 36);
  if (t < -0.16 || t > 1.26) {
    return true;
  }
  const viewX = SPAWN.x + (WATERFALL.x - SPAWN.x) * t;
  return Math.abs(x - viewX) > halfWidth;
}

function createGrassGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let blade = 0; blade < 5; blade += 1) {
    const angle = blade * 2.39996323;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    const height = 0.56 + 0.11 * Math.sin(blade * 3.2);
    const spread = 0.36 + 0.08 * Math.sin(blade * 5.1);
    const vertex = blade * 5;
    positions.push(
      x * 0.07 - z * 0.095, 0, z * 0.07 + x * 0.095,
      x * 0.07 + z * 0.095, 0, z * 0.07 - x * 0.095,
      x * spread * 0.37 - z * 0.055, height * 0.63, z * spread * 0.37 + x * 0.055,
      x * spread * 0.37 + z * 0.055, height * 0.65, z * spread * 0.37 - x * 0.055,
      x * spread, height, z * spread
    );
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2, vertex + 2, vertex + 3, vertex + 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createRockGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const wobble = 0.88 + 0.09 * Math.sin(x * 13.2 + y * 8.1 + z * 5.3) + 0.03 * Math.cos(y * 17.4 - z * 6.8);
    const heightShape = 0.88 + 0.12 * Math.cos(x * 10.4 + z * 11.1);
    positions.setXYZ(i, x * wobble, y * heightShape, z * wobble);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createMistTexture(): THREE.DataTexture {
  const size = 72;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / (size - 1)) * 2 - 1;
      const v = (y / (size - 1)) * 2 - 1;
      const radius = Math.sqrt(u * u + v * v);
      const irregular = 0.06 * Math.sin(u * 9 + v * 4) + 0.045 * Math.cos(v * 11 - u * 3);
      const alpha = Math.pow(clamp01(1 - radius + irregular), 1.75) * 255;
      const index = (y * size + x) * 4;
      pixels[index] = 229;
      pixels[index + 1] = 246;
      pixels[index + 2] = 249;
      pixels[index + 3] = Math.round(alpha);
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createPalmFrondGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const pushTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const up = new THREE.Vector3(0, 1, 0);
  for (let frond = 0; frond < 9; frond += 1) {
    const angle = (frond / 9) * Math.PI * 2;
    const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    let previous: THREE.Vector3 | null = null;
    for (let step = 1; step <= 12; step += 1) {
      const t = step / 12;
      const center = radial.clone().multiplyScalar(t * 1.18)
        .addScaledVector(up, 0.08 + Math.sin(t * Math.PI) * 0.33 - t * 0.38);
      if (previous) {
        const ribWidth = 0.018 * (1 - t * 0.35);
        pushTriangle(previous.clone().addScaledVector(tangent, -ribWidth), previous.clone().addScaledVector(tangent, ribWidth), center.clone().addScaledVector(tangent, ribWidth * 0.6));
        pushTriangle(previous.clone().addScaledVector(tangent, -ribWidth), center.clone().addScaledVector(tangent, ribWidth * 0.6), center.clone().addScaledVector(tangent, -ribWidth * 0.6));
      }
      previous = center;
      if (step < 3 || step > 11) continue;
      const leafletLength = 0.12 + (1 - t) * 0.54;
      for (const side of [-1, 1]) {
        const base = center.clone();
        const tip = center.clone().addScaledVector(tangent, leafletLength * side).addScaledVector(radial, 0.09).addScaledVector(up, -0.13 * (0.45 + t));
        const shoulder = center.clone().addScaledVector(tangent, leafletLength * side * 0.56).addScaledVector(radial, -0.09).addScaledVector(up, -0.045);
        pushTriangle(base, tip, shoulder);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createOrganicLeafGeometry(detail: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const lobe = 1 + 0.13 * Math.sin(x * 7 + z * 6 + y * 4) + 0.09 * Math.cos(z * 8 - y * 7);
    positions.setXYZ(i, x * lobe, y * (0.93 + 0.12 * Math.sin(x * 7 + z * 8)), z * lobe);
  }
  return geometry;
}

function createBeachRosette(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const frondCount = 10;
  const steps = 11;
  for (let frond = 0; frond < frondCount; frond += 1) {
    const angle = frond * 2.39996323;
    const forwardX = Math.cos(angle);
    const forwardZ = Math.sin(angle);
    const inner = frond < 4;
    const length = (inner ? 0.65 : 1.15) * (0.83 + 0.18 * Math.sin(frond * 7));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const reach = t * length;
      const bend = Math.sin(t * Math.PI * 0.82);
      const lift = bend * (inner ? 1.2 : 0.72) - t * t * (inner ? 0.06 : 0.24);
      const width = Math.pow(Math.sin(t * Math.PI), 0.7) * (step % 2 === 0 ? 0.17 : 0.125);
      for (let side = -1; side <= 1; side += 1) {
        positions.push(forwardX * reach - forwardZ * side * width, lift - Math.abs(side) * width * 0.34, forwardZ * reach + forwardX * side * width);
        const shade = (side === 0 ? 0.86 : 0.52 + side * 0.075) + t * 0.12;
        colors.push(shade, shade, shade * 0.94);
      }
      if (step === steps) continue;
      const a = (frond * (steps + 1) + step) * 3;
      indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createCanopyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const random = seededRandom(0x4f1c01);
  context.fillStyle = '#747b70';
  context.fillRect(0, 0, 256, 256);

  // Paint overlapping leaflets at two scales so clusters keep their shading in the distance.
  for (let leaf = 0; leaf < 1360; leaf += 1) {
    const x = random() * 256;
    const y = random() * 256;
    const r = leaf < 80 ? 7 + random() * 19 : 1.5 + random() * 6;
    const tilt = random() * Math.PI;
    const shade = Math.round(163 + random() * 68 + Math.sin(x * Math.PI / 32) * Math.cos(y * Math.PI / 32) * 19);
    context.fillStyle = 'rgb(' + shade + ',' + (shade + 8) + ',' + (shade - 8) + ')';
    for (const offsetX of [0, x < 128 ? 256 : -256]) {
      for (const offsetY of [0, y < 128 ? 256 : -256]) {
        context.beginPath();
        context.ellipse(x + offsetX, y + offsetY, r, r * 0.43, tilt, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

export class CoastWorld {
  readonly scene = new THREE.Scene();

  private readonly terrainLow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly terrainNormal: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly oceanTimeUniform: THREE.IUniform<number>;
  private readonly mist: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly mistSamples: MistSample[];
  private readonly sun: THREE.DirectionalLight;
  private readonly lowVegetation: THREE.Group;
  private readonly normalVegetation: THREE.Group;
  private readonly lowGrass: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly normalGrass: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly canopyTexture = createCanopyTexture();
  private readonly windUniforms: THREE.IUniform<number>[] = [];
  private readonly windMaterials: THREE.MeshStandardMaterial[] = [];
  private quality: CoastQuality = 'low';

  constructor() {
    this.scene.background = new THREE.Color(0xb8d9ef);
    this.scene.fog = new THREE.Fog(0xc9e0e8, 215, 930);

    const sunDirection = new THREE.Vector3(-0.35, 0.76, 0.55).normalize();
    this.scene.add(createCoastSky(sunDirection));

    this.scene.add(new THREE.HemisphereLight(0xc9e9ff, 0x566453, 1.9));
    const softFill = new THREE.AmbientLight(0xfff1dc, 0.38);
    this.sun = new THREE.DirectionalLight(0xffedcc, 3.0);
    this.sun.position.copy(sunDirection).multiplyScalar(360);
    this.sun.target.position.set(0, 0, -20);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -145;
    this.sun.shadow.camera.right = 145;
    this.sun.shadow.camera.top = 115;
    this.sun.shadow.camera.bottom = -100;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 620;
    this.sun.shadow.bias = -0.00012;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.mapSize.set(512, 512);
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(softFill, this.sun, this.sun.target);

    this.terrainLow = this.createTerrainMesh(124, 128);
    this.terrainNormal = this.createTerrainMesh(220, 224);
    this.terrainLow.visible = true;
    this.terrainNormal.visible = false;
    this.scene.add(this.terrainLow, this.terrainNormal);

    this.oceanTimeUniform = { value: 0 };
    const oceanMaterial = createCoastOceanMaterial(this.oceanTimeUniform, sunDirection);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2200, 1500), oceanMaterial);
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(0, SEA_LEVEL - 0.03, -220);
    this.scene.add(ocean);

    this.scene.add(createWaterfall(this.oceanTimeUniform), createWaterfallPool(this.oceanTimeUniform));

    const mistMaterial = new THREE.MeshBasicMaterial({
      color: 0xe9f8fc,
      map: createMistTexture(),
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    const spray = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mistMaterial, 64);
    spray.frustumCulled = false;
    spray.renderOrder = 4;
    spray.castShadow = false;
    spray.receiveShadow = false;
    this.mistSamples = this.createMistSamples(64);
    this.mist = spray;
    this.updateMist(0);
    this.scene.add(this.mist);

    this.addRainbow();

    const lowTrees = [...this.createTreeSamples(108, 0x1a7e), ...this.createHeadlandTreeSamples(54, 0x54a2)];
    const normalTrees = [...this.createTreeSamples(196, 0x5c391), ...this.createHeadlandTreeSamples(72, 0x6b903)];
    this.lowVegetation = this.createVegetationGroup(lowTrees, 0x1a7e);
    this.normalVegetation = this.createVegetationGroup(normalTrees, 0x5c391);
    this.lowVegetation.add(this.createCliffCover(1, 0xb877));
    this.normalVegetation.add(this.createCliffCover(0.36, 0x771a));
    this.lowVegetation.add(this.createBeachPlants());
    this.lowVegetation.add(this.createShrubInstances(92, 0x3450));
    this.normalVegetation.add(this.createShrubInstances(142, 0x8f1c));
    this.scene.add(this.lowVegetation, this.normalVegetation);

    const grassGeometry = createGrassGeometry();
    this.lowGrass = this.createGrassInstances(this.createGrassSamples(1200, 0x2246), grassGeometry);
    this.normalGrass = this.createGrassInstances(this.createGrassSamples(2300, 0x5921), grassGeometry);
    const grassLowGroup = new THREE.Group();
    const grassNormalGroup = new THREE.Group();
    grassLowGroup.name = 'Coast grass · low detail';
    grassNormalGroup.name = 'Coast grass · normal detail';
    grassLowGroup.add(this.lowGrass);
    grassNormalGroup.add(this.normalGrass);
    this.scene.add(grassLowGroup, grassNormalGroup);
    this.lowVegetation.add(grassLowGroup);
    this.normalVegetation.add(grassNormalGroup);

    this.addIslandRocks();
    this.addShoreRock();
    this.setQuality('low');
  }

  setQuality(quality: CoastQuality): void {
    this.quality = quality;
    const isNormal = quality === 'normal';
    this.terrainLow.visible = !isNormal;
    this.terrainNormal.visible = isNormal;
    this.normalVegetation.visible = isNormal;
    this.lowVegetation.visible = true;
    // Reuse the small shadow map in low mode so cliff and plant shadows do not cost a second draw per frame.
    this.sun.shadow.autoUpdate = isNormal;
    const mapSize = isNormal ? 1536 : 512;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.map?.depthTexture?.dispose();
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(mapSize, mapSize);
    }
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.needsUpdate = true;
    for (const listener of this.qualityListeners) {
      listener();
    }
  }

  update(elapsed: number, camera: THREE.PerspectiveCamera): void {
    this.oceanTimeUniform.value = elapsed;
    for (const uniform of this.windUniforms) {
      uniform.value = elapsed;
    }
    this.updateMist(elapsed, camera);

    const poolDistance = camera.position.distanceTo(new THREE.Vector3(POOL.x, POOL.y, POOL.z));
    this.mist.visible = poolDistance < 260;
    this.lowGrass.visible = camera.position.y < 48;
    this.normalGrass.visible = camera.position.y < 42;
  }

  private createTerrainMesh(xSegments: number, zSegments: number): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    const { minX, maxX, minZ, maxZ } = COAST_BOUNDS;
    const xStep = (maxX - minX) / xSegments;
    const zStep = (maxZ - minZ) / zSegments;
    const vertexCount = (xSegments + 1) * (zSegments + 1);
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(xSegments * zSegments * 6);
    let vertex = 0;

    for (let zIndex = 0; zIndex <= zSegments; zIndex += 1) {
      const z = minZ + zStep * zIndex;
      for (let xIndex = 0; xIndex <= xSegments; xIndex += 1) {
        const x = minX + xStep * xIndex;
        const y = groundHeight(x, z);
        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = z;

        const slope = sampleSlope(x, z, Math.max(0.65, Math.min(xStep, zStep) * 0.55));
        const inland = z - shoreline(x);
        const aboveBeach = Math.max(smoothstep(1, 17, inland), smoothstep(2.8, 8.5, y));
        const rockBlend = clamp01((slope - 0.42) / 1.45 + smoothstep(16, 31, y) * 0.24);
        const grade = smoothstep(9, 24, y);
        const tint = TERRAIN_GRASS.clone().lerp(TERRAIN_HIGH_GRASS, grade * 0.72);
        tint.lerp(TERRAIN_SAND, 1 - aboveBeach);
        tint.lerp(slope > 0.84 ? TERRAIN_SHADOW_ROCK : TERRAIN_ROCK, rockBlend);
        const strata = 0.965 + 0.035 * Math.sin(y * 0.78 + x * 0.08 + Math.sin(z * 0.11) * 1.4);
        const patch = 0.94 + 0.06 * Math.sin(x * 0.21 + z * 0.12) * Math.sin(z * 0.17 - x * 0.08);
        tint.multiplyScalar(strata * patch);
        colors[vertex * 3] = tint.r;
        colors[vertex * 3 + 1] = tint.g;
        colors[vertex * 3 + 2] = tint.b;
        vertex += 1;
      }
    }

    let index = 0;
    const row = xSegments + 1;
    for (let zIndex = 0; zIndex < zSegments; zIndex += 1) {
      for (let xIndex = 0; xIndex < xSegments; xIndex += 1) {
        const a = zIndex * row + xIndex;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        if ((xIndex + zIndex) % 2 === 0) {
          indices[index++] = a; indices[index++] = c; indices[index++] = b;
          indices[index++] = b; indices[index++] = c; indices[index++] = d;
        } else {
          indices[index++] = a; indices[index++] = c; indices[index++] = d;
          indices[index++] = a; indices[index++] = d; indices[index++] = b;
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0.015 });
    addCoastSurfaceDetail(material, xSegments >= 150);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = xSegments < 150 ? 'Coast land · low detail' : 'Coast land · normal detail';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private createMistSamples(count: number): MistSample[] {
    const random = seededRandom(0x7fa311);
    const samples: MistSample[] = [];
    for (let i = 0; i < count; i += 1) {
      const spread = 2.4 + random() * 5.5;
      samples.push({
        x: POOL.x + (random() - 0.5) * spread * 1.8,
        y: POOL.y + 0.7 + random() * 3.6,
        z: FALL_IMPACT_Z + 0.8 + (random() - 0.4) * spread * 0.78,
        sx: 1.5 + random() * 3.6,
        sy: 0.9 + random() * 2.1,
        sz: 1,
        phase: random() * Math.PI * 2
      });
    }
    return samples;
  }

  private updateMist(elapsed: number, camera?: THREE.PerspectiveCamera): void {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    for (let i = 0; i < this.mistSamples.length; i += 1) {
      const sample = this.mistSamples[i];
      if (!sample) {
        continue;
      }
      const lift = Math.sin(elapsed * 0.78 + sample.phase) * 0.5;
      position.set(sample.x + Math.sin(elapsed * 0.33 + sample.phase) * 0.4, sample.y + lift, sample.z + Math.cos(elapsed * 0.29 + sample.phase) * 0.42);
      scale.set(sample.sx, sample.sy * (0.94 + 0.08 * Math.sin(elapsed + sample.phase)), 1);
      quaternion.copy(camera?.quaternion ?? new THREE.Quaternion());
      matrix.compose(position, quaternion, scale);
      this.mist.setMatrixAt(i, matrix);
    }
    this.mist.instanceMatrix.needsUpdate = true;
  }

  private addRainbow(): void {
    const cameraRight = new THREE.Vector3(Math.cos(SPAWN.yaw), 0, -Math.sin(SPAWN.yaw));
    const center = new THREE.Vector3(POOL.x, 4.15, FALL_IMPACT_Z + 2.1);
    const geometry = new THREE.PlaneGeometry(1, 1, 64, 1);
    const positions = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      const angle = Math.PI * uv.getX(vertex);
      const reach = 3.05 + uv.getY(vertex) * 2.15;
      const horizontal = Math.cos(angle) * reach;
      positions.setXYZ(vertex, center.x + cameraRight.x * horizontal, center.y + Math.sin(angle) * reach,
        center.z + cameraRight.z * horizontal);
    }
    geometry.computeBoundingSphere();

    const material = new THREE.ShaderMaterial({
      vertexShader: /* glsl */`
        varying vec2 vUv;
        varying float vDepth;
        void main() {
          vUv = uv;
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vDepth = -viewPosition.z;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        varying float vDepth;
        void main() {
          float hue = (1.0 - vUv.y) * 5.0;
          vec3 rainbow = clamp(vec3(abs(hue - 3.0) - 1.0, 2.0 - abs(hue - 2.0), 2.0 - abs(hue - 4.0)), 0.0, 1.0);
          float widthFade = smoothstep(0.0, 0.30, vUv.y) * smoothstep(0.0, 0.30, 1.0 - vUv.y);
          float spread = smoothstep(0.0, 0.17, vUv.x) * smoothstep(0.0, 0.17, 1.0 - vUv.x);
          float mist = 0.75 + 0.25 * sin(vUv.x * 17.0 + 0.5) * sin(vUv.x * 8.0);
          float distanceFade = 1.0 - smoothstep(95.0, 190.0, vDepth);
          gl_FragColor = vec4(mix(rainbow, vec3(0.75, 0.86, 0.95), 0.30), 0.38 * widthFade * spread * mist * distanceFade);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const arc = new THREE.Mesh(geometry, material);
    arc.name = 'Mist rainbow';
    arc.renderOrder = 5;
    this.scene.add(arc);
  }

  private createTreeSamples(count: number, seed: number): TreeSample[] {
    const random = seededRandom(seed);
    const samples: TreeSample[] = [];
    let attempts = 0;
    while (samples.length < count && attempts < count * 48) {
      attempts += 1;
      const x = COAST_BOUNDS.minX + 5 + random() * (COAST_BOUNDS.maxX - COAST_BOUNDS.minX - 10);
      const z = COAST_BOUNDS.minZ + 5 + random() * (COAST_BOUNDS.maxZ - COAST_BOUNDS.minZ - 10);
      const height = groundHeight(x, z);
      const inland = z - shoreline(x);
      if (height < 1.1 || inland < 8 || inland > 130 || sampleSlope(x, z) > 0.72) {
        continue;
      }
      if (!pointOutsideViewCorridor(x, z, 13)) {
        continue;
      }
      if (Math.hypot((x - POOL.x) / 16, (z - POOL.z) / 17) < 1.45) {
        continue;
      }
      const kind = random() < 0.23 ? 'palm' : 'broadleaf';
      const palette = kind === 'palm'
        ? [0x47784b, 0x5a884f, 0x73904f, 0x477044]
        : [0x3f6945, 0x4c7748, 0x5c8450, 0x6c8c56, 0x44744e, 0x72844e];
      const color = palette[Math.floor(random() * palette.length)] ?? 0x4c7748;
      samples.push({
        x,
        y: height,
        z,
        height: kind === 'palm' ? 7.1 + random() * 4.2 : 3.7 + random() * 4.8,
        width: kind === 'palm' ? 2.8 + random() * 1.6 : 2.8 + random() * 2.5,
        kind,
        tint: new THREE.Color(color),
        yaw: random() * Math.PI * 2
      });
    }
    return samples;
  }

  private createHeadlandTreeSamples(count: number, seed: number): TreeSample[] {
    const random = seededRandom(seed);
    const anchors = [
      { x: -56, z: -44, width: 21, depth: 12 },
      { x: -34, z: -80, width: 10, depth: 9 },
      { x: 47, z: -51, width: 25, depth: 13 },
      { x: -52, z: -8, width: 16, depth: 14 },
      { x: 40, z: -6, width: 18, depth: 15 }
    ];
    const samples: TreeSample[] = [];
    let attempts = 0;
    while (samples.length < count && attempts < count * 36) {
      attempts += 1;
      const regionRoll = random();
      const anchorIndex = regionRoll < 0.46 ? 0 : regionRoll < 0.54 ? 1 : regionRoll < 0.88 ? 2 : regionRoll < 0.94 ? 3 : 4;
      const anchor = anchors[anchorIndex];
      if (!anchor) continue;
      const x = anchor.x + (random() - 0.5) * anchor.width;
      const z = anchor.z + (random() - 0.5) * anchor.depth;
      const height = groundHeight(x, z);
      if (height < 5.2 || sampleSlope(x, z) > 0.78 || !pointOutsideViewCorridor(x, z, 11)) {
        continue;
      }
      const kind = random() < 0.2 ? 'palm' : 'broadleaf';
      const palette = [0x3f6945, 0x4c7748, 0x5c8450, 0x6c8c56, 0x47784b, 0x73904f];
      samples.push({
        x,
        y: height,
        z,
        height: kind === 'palm' ? 7.5 + random() * 3.5 : 4.0 + random() * 4.8,
        width: kind === 'palm' ? 3.0 + random() * 1.7 : 3.1 + random() * 2.5,
        kind,
        tint: new THREE.Color(palette[Math.floor(random() * palette.length)] ?? 0x4c7748),
        yaw: random() * Math.PI * 2
      });
    }
    return samples;
  }

  private createCliffCover(density: number, seed: number): THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    const random = seededRandom(seed);
    const patches = [
      // Trees and scrub close the cap silhouettes and follow the broken slopes beneath them.
      { x: -57, z: -44, rx: 17, rz: 22, count: 115, minY: 25, maxY: 63, width: 2.25, height: 1.7 },
      { x: -35, z: -79, rx: 9, rz: 11, count: 58, minY: 16, maxY: 38, width: 1.7, height: 1.35 },
      { x: 46, z: -37, rx: 21, rz: 23, count: 126, minY: 25, maxY: 63, width: 2.2, height: 1.7 },
      { x: -45, z: -19, rx: 19, rz: 11, count: 81, minY: 1.8, maxY: 16, width: 1.9, height: 1.3 },
      { x: 29, z: -23, rx: 24, rz: 10, count: 82, minY: 2.8, maxY: 15, width: 1.85, height: 1.35 },
    ];
    const count = patches.reduce((sum, patch) => sum + Math.round(patch.count * density), 0);
    const material = this.createWindMaterial(0xffffff, 0.96);
    material.map = this.canopyTexture;
    material.side = THREE.FrontSide;
    const cover = new THREE.InstancedMesh(createOrganicLeafGeometry(1), material, count);
    cover.name = 'Cliff cap, ledge and beach foliage';
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const palette = [0x2a613a, 0x30673c, 0x447e44, 0x4d833e, 0x649549, 0x376b4a, 0x527a3b].map(hex => new THREE.Color(hex));
    let instance = 0;

    for (const patch of patches) {
      const target = Math.round(patch.count * density);
      let planted = 0;
      for (let attempt = 0; attempt < target * 16 && planted < target; attempt += 1) {
        const angle = random() * Math.PI * 2;
        const radius = Math.sqrt(random());
        const x = patch.x + Math.cos(angle) * radius * patch.rx;
        const z = patch.z + Math.sin(angle) * radius * patch.rz;
        const y = groundHeight(x, z);
        const maxSlope = patch.minY >= 16 ? 1.1 : 0.70;
        if (y < patch.minY || y > patch.maxY || sampleSlope(x, z) > maxSlope) continue;
        if (Math.abs(x - WATERFALL.x) < 6.1 && z > -40 && z < -30) continue;
        if (Math.hypot((x - POOL.x) / POOL.radiusX, (z - POOL.z) / POOL.radiusZ) < 1.04) continue;

        const size = 0.48 + random() * 1.06;
        const height = patch.height * size * (0.7 + random() * 0.63);
        const width = patch.width * size;
        position.set(x, y + height * 0.18, z);
        scale.set(width, height, width * (0.68 + random() * 0.36));
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
        matrix.compose(position, rotation, scale);
        cover.setMatrixAt(instance, matrix);
        cover.setColorAt(instance, palette[Math.floor(random() * palette.length)]!);
        planted += 1;
        instance += 1;
      }
    }
    cover.count = instance;
    cover.castShadow = true;
    return cover;
  }

  private createBeachPlants(): THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    const random = seededRandom(0xb7c21);
    const patches = [
      { x: -25.6, z: 4.6, radius: 3.4, count: 23 },
      { x: -9.0, z: 0.8, radius: 3.2, count: 23 },
      { x: 6.1, z: -19.3, radius: 6.0, count: 24 },
      { x: 31.4, z: -20.1, radius: 6.5, count: 24 },
    ];
    const material = this.createWindMaterial(0xffffff, 0.86);
    material.vertexColors = true;
    const count = patches.reduce((sum, patch) => sum + patch.count, 0);
    const plants = new THREE.InstancedMesh(createBeachRosette(), material, count);
    plants.name = 'Coastal ferns';
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const palette = [0x407744, 0x528746, 0x628e43, 0x2b6351, 0x596f3b].map(hex => new THREE.Color(hex));
    let instance = 0;
    for (const patch of patches) {
      let planted = 0;
      for (let attempt = 0; attempt < patch.count * 8 && planted < patch.count; attempt += 1) {
        const angle = random() * Math.PI * 2;
        const radius = Math.sqrt(random()) * patch.radius;
        const x = patch.x + Math.cos(angle) * radius;
        const z = patch.z + Math.sin(angle) * radius;
        const y = groundHeight(x, z);
        if (y < 0.7 || sampleSlope(x, z) > 0.86) continue;
        if (Math.hypot((x - POOL.x) / POOL.radiusX, (z - POOL.z) / POOL.radiusZ) < 1.02) continue;

        const size = 0.45 + random() * 0.83;
        position.set(x, y - 0.03, z);
        scale.set(size, size * (0.63 + random() * 0.34), size);
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
        matrix.compose(position, rotation, scale);
        plants.setMatrixAt(instance, matrix);
        plants.setColorAt(instance, palette[Math.floor(random() * palette.length)]!);
        instance += 1;
        planted += 1;
      }
    }
    plants.count = instance;
    plants.castShadow = true;
    return plants;
  }

  private createShrubInstances(count: number, seed: number): THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    const random = seededRandom(seed);
    const samples: Array<{ x: number; y: number; z: number; width: number; height: number; yaw: number; tint: THREE.Color }> = [];
    let attempts = 0;
    while (samples.length < count && attempts < count * 32) {
      attempts += 1;
      const side = random() < 0.5 ? 'west' : 'east';
      const x = side === 'west' ? -35 + random() * 13 : -6 + random() * 14;
      const z = -8 + random() * 24;
      const y = groundHeight(x, z);
      const inland = z - shoreline(x);
      if (y < 0.5 || inland < 1 || inland > 37 || sampleSlope(x, z) > 0.48 || !pointOutsideViewCorridor(x, z, 10)) {
        continue;
      }
      samples.push({
        x,
        y,
        z,
        width: 0.75 + random() * 1.35,
        height: 0.56 + random() * 0.73,
        yaw: random() * Math.PI * 2,
        tint: new THREE.Color([0x527849, 0x64844b, 0x78904d, 0x456e46, 0x6a8850][Math.floor(random() * 5)] ?? 0x527849)
      });
    }
    const shrubs = new THREE.InstancedMesh(createOrganicLeafGeometry(1), this.createWindMaterial(0xffffff, 0.97), samples.length * 3);
    shrubs.name = 'Coast beach shrubs';
    shrubs.material.map = this.canopyTexture;
    shrubs.material.side = THREE.FrontSide;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    let instance = 0;
    for (const sample of samples) {
      for (let lobe = 0; lobe < 3; lobe += 1) {
        const angle = sample.yaw + (lobe * Math.PI * 2) / 3;
        position.set(sample.x + Math.cos(angle) * sample.width * 0.26, sample.y + sample.height * 0.48, sample.z + Math.sin(angle) * sample.width * 0.26);
        scale.set(sample.width * 0.48, sample.height * (lobe === 0 ? 0.57 : 0.48), sample.width * 0.43);
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle * 0.2);
        matrix.compose(position, rotation, scale);
        shrubs.setMatrixAt(instance, matrix);
        shrubs.setColorAt(instance, sample.tint.clone().multiplyScalar(0.92 + lobe * 0.035));
        instance += 1;
      }
    }
    shrubs.castShadow = false;
    shrubs.receiveShadow = false;
    return shrubs;
  }

  private createVegetationGroup(samples: readonly TreeSample[], seed: number): THREE.Group {
    const group = new THREE.Group();
    group.name = `Coast vegetation ${seed.toString(16)}`;
    const palms = samples.filter((sample) => sample.kind === 'palm');
    const broadleafTrees = samples.filter((sample) => sample.kind === 'broadleaf');
    const trunkGeometry = new THREE.CylinderGeometry(0.8, 1, 1, 7, 1);
    trunkGeometry.translate(0, 0.5, 0);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, samples.length);
    const trunkMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const color = new THREE.Color();
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      if (!sample) continue;
      const trunkHeight = sample.height * (sample.kind === 'palm' ? 0.73 : 0.60);
      position.set(sample.x, sample.y, sample.z);
      scale.set(sample.width * (sample.kind === 'palm' ? 0.065 : 0.12), trunkHeight, sample.width * (sample.kind === 'palm' ? 0.065 : 0.12));
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, sample.yaw);
      trunkMatrix.compose(position, rotation, scale);
      trunkMesh.setMatrixAt(i, trunkMatrix);
      trunkMesh.setColorAt(i, color.setHex(0x76553a).multiplyScalar(0.83 + (i % 5) * 0.055));
    }
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    group.add(trunkMesh);

    const leafMaterial = this.createWindMaterial(0xffffff, 0.96);
    const palmCrown = new THREE.InstancedMesh(createPalmFrondGeometry(), leafMaterial, palms.length);
    for (let i = 0; i < palms.length; i += 1) {
      const sample = palms[i];
      if (!sample) continue;
      position.set(sample.x, sample.y + sample.height * 0.72, sample.z);
      scale.set(sample.width, sample.height * 0.7, sample.width);
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, sample.yaw);
      trunkMatrix.compose(position, rotation, scale);
      palmCrown.setMatrixAt(i, trunkMatrix);
      palmCrown.setColorAt(i, color.copy(sample.tint).multiplyScalar(0.96));
    }
    palmCrown.castShadow = true;
    palmCrown.receiveShadow = true;
    group.add(palmCrown);

    const broadleafGeometry = createOrganicLeafGeometry(2);
    const canopyMaterial = this.createWindMaterial(0xffffff, 0.96);
    canopyMaterial.map = this.canopyTexture;
    canopyMaterial.side = THREE.FrontSide;
    const broadleafCanopy = new THREE.InstancedMesh(broadleafGeometry, canopyMaterial, broadleafTrees.length * 4);
    const branchGeometry = new THREE.CylinderGeometry(0.45, 1, 1, 5, 1);
    branchGeometry.translate(0, 0.5, 0);
    const branches = new THREE.InstancedMesh(branchGeometry, trunkMaterial, broadleafTrees.length * 4);
    const branchStart = new THREE.Vector3();
    const branchEnd = new THREE.Vector3();
    const branchDirection = new THREE.Vector3();
    let canopyIndex = 0;
    let branchIndex = 0;
    for (let i = 0; i < broadleafTrees.length; i += 1) {
      const sample = broadleafTrees[i];
      if (!sample) continue;
      for (let lobe = 0; lobe < 4; lobe += 1) {
        const angle = sample.yaw + (lobe * Math.PI * 2) / 3;
        const offset = lobe === 0 ? 0 : sample.width * 0.34;
        position.set(sample.x + Math.cos(angle) * offset, sample.y + sample.height * (lobe === 0 ? 0.73 : 0.62), sample.z + Math.sin(angle) * offset);
        scale.set(sample.width * (lobe === 0 ? 0.62 : 0.48), sample.height * (lobe === 0 ? 0.32 : 0.28), sample.width * (lobe === 0 ? 0.56 : 0.46));
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle * 0.17);
        trunkMatrix.compose(position, rotation, scale);
        broadleafCanopy.setMatrixAt(canopyIndex, trunkMatrix);
        broadleafCanopy.setColorAt(canopyIndex, color.copy(sample.tint).multiplyScalar(0.91 + lobe * 0.025));
        canopyIndex += 1;

        const startHeight = sample.height * (0.36 + lobe * 0.035);
        const endHeight = sample.height * (0.57 + (lobe % 2) * 0.035);
        branchStart.set(sample.x + Math.cos(angle) * sample.width * 0.07, sample.y + startHeight, sample.z + Math.sin(angle) * sample.width * 0.07);
        branchEnd.set(sample.x + Math.cos(angle) * sample.width * 0.55, sample.y + endHeight, sample.z + Math.sin(angle) * sample.width * 0.55);
        branchDirection.subVectors(branchEnd, branchStart);
        scale.set(sample.width * 0.07, branchDirection.length(), sample.width * 0.07);
        rotation.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, branchDirection.normalize());
        trunkMatrix.compose(branchStart, rotation, scale);
        branches.setMatrixAt(branchIndex, trunkMatrix);
        branches.setColorAt(branchIndex, color.setHex(0x705039).multiplyScalar(0.88 + (branchIndex % 3) * 0.06));
        branchIndex += 1;
      }
    }
    broadleafCanopy.castShadow = true;
    broadleafCanopy.receiveShadow = true;
    branches.castShadow = true;
    branches.receiveShadow = true;
    group.add(branches, broadleafCanopy);
    return group;
  }

  private createGrassSamples(count: number, seed: number): GrassSample[] {
    const random = seededRandom(seed);
    const samples: GrassSample[] = [];
    let attempts = 0;
    while (samples.length < count && attempts < count * 32) {
      attempts += 1;
      const aroundCove = random() < 0.36;
      const x = aroundCove ? -41 + random() * 57 : -78 + random() * 142;
      const z = aroundCove ? -4 + random() * 39 : -8 + random() * 87;
      const height = groundHeight(x, z);
      const inland = z - shoreline(x);
      if (height < 0.5 || inland < 2 || inland > 68 || sampleSlope(x, z) > 0.62) {
        continue;
      }
      if (!pointOutsideViewCorridor(x, z, 8)) {
        continue;
      }
      const stature = 0.27 + random() * 0.63;
      const tint = new THREE.Color([0x496638, 0x657948, 0x758748, 0x587045][Math.floor(random() * 4)] ?? 0x496638);
      samples.push({
        x,
        y: height - 0.015,
        z,
        scale: new THREE.Vector3(0.18 + random() * 0.23, stature, 0.18 + random() * 0.23),
        yaw: random() * Math.PI,
        tint
      });
    }
    return samples;
  }

  private createGrassInstances(samples: readonly GrassSample[], geometry: THREE.BufferGeometry): THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    const material = this.createWindMaterial(0xffffff, 0.94);
    const grass = new THREE.InstancedMesh(geometry, material, samples.length);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      if (!sample) continue;
      position.set(sample.x, sample.y, sample.z);
      scale.copy(sample.scale);
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, sample.yaw);
      matrix.compose(position, rotation, scale);
      grass.setMatrixAt(i, matrix);
      grass.setColorAt(i, sample.tint);
    }
    grass.castShadow = false;
    grass.receiveShadow = false;
    grass.frustumCulled = true;
    return grass;
  }

  private createWindMaterial(color: THREE.ColorRepresentation, roughness: number): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      const timeUniform = { value: 0 };
      shader.uniforms['uCoastWindTime'] = timeUniform;
      this.windUniforms.push(timeUniform);
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nuniform float uCoastWindTime;'
      ).replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
          float coastWindPhase = uCoastWindTime * 1.25 + instanceMatrix[3][0] * 0.031 + instanceMatrix[3][2] * 0.027;
          transformed.x += sin(coastWindPhase + transformed.y * 1.4) * transformed.y * 0.055;
          transformed.z += cos(coastWindPhase * 0.83 + transformed.y) * transformed.y * 0.032;`
      );
    };
    material.customProgramCacheKey = () => 'coast-wind-v1';
    this.windMaterials.push(material);
    return material;
  }

  private createRockSamples(count: number, seed: number): RockSample[] {
    const random = seededRandom(seed);
    const samples: RockSample[] = [];
    let attempts = 0;
    while (samples.length < count && attempts < count * 35) {
      attempts += 1;
      const x = COAST_BOUNDS.minX + 4 + random() * (COAST_BOUNDS.maxX - COAST_BOUNDS.minX - 8);
      const z = COAST_BOUNDS.minZ + 3 + random() * (COAST_BOUNDS.maxZ - COAST_BOUNDS.minZ - 6);
      const height = groundHeight(x, z);
      const slope = sampleSlope(x, z);
      const inland = z - shoreline(x);
      if (height < 0.2 || inland < -4 || inland > 110 || slope > 0.78 || (slope < 0.14 && random() < 0.65)) {
        continue;
      }
      if (!pointOutsideViewCorridor(x, z, 11)) {
        continue;
      }
      if (Math.hypot((x - POOL.x) / 13, (z - POOL.z) / 14) < 1.4) {
        continue;
      }
      const size = 0.45 + random() * 1.25;
      samples.push({
        x,
        y: height + size * 0.12,
        z,
        scale: new THREE.Vector3(size * (0.8 + random() * 1.1), size * (0.5 + random() * 0.82), size * (0.75 + random() * 0.9)),
        yaw: random() * Math.PI * 2,
        tint: new THREE.Color([0x827e70, 0x6c716b, 0x9a8b74, 0x77766b][Math.floor(random() * 4)] ?? 0x827e70)
      });
    }
    return samples;
  }

  private createRockInstances(samples: readonly RockSample[], name: string): THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
    const mesh = new THREE.InstancedMesh(createRockGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96 }), samples.length);
    mesh.name = name;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i];
      if (!sample) continue;
      position.set(sample.x, sample.y, sample.z);
      quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, sample.yaw);
      matrix.compose(position, quaternion, sample.scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, sample.tint);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private addIslandRocks(): void {
    const base = this.createRockInstances(this.createRockSamples(106, 0x7a411), 'Coastal boulders · low detail');
    const extra = this.createRockInstances(this.createRockSamples(184, 0xe317b), 'Coastal boulders · normal detail');
    base.castShadow = true;
    extra.castShadow = true;
    const rockLow = new THREE.Group();
    rockLow.add(base);
    const rockNormal = new THREE.Group();
    rockNormal.add(extra);
    this.scene.add(rockLow, rockNormal);
    const updateVisibility = (): void => {
      rockNormal.visible = this.quality === 'normal';
    };
    updateVisibility();
    this.qualityListeners.push(updateVisibility);
  }

  private addShoreRock(): void {
    const root = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : import.meta.env.BASE_URL + '/';
    new GLTFLoader().load(root + 'coast-materials/cliff-ledge.glb', ({ scene: rock }) => {
      rock.name = 'Intertidal rock ledge';
      rock.position.set(-32.8, -1.86, -18.5);
      rock.rotation.set(-0.15, 0.61, 0.25);
      rock.scale.set(1.40, 1.05, 1.15);
      rock.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      this.scene.add(rock);
      this.sun.shadow.needsUpdate = true;
    }, undefined, () => {
      // Procedural rocks already populate the coast if the scan is unavailable.
    });
  }

  private readonly qualityListeners: Array<() => void> = [];
}
