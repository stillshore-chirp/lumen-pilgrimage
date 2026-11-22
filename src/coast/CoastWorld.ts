import * as THREE from 'three';
import {
  COAST_FALLS, SEA_LEVEL, coastPlantingDistance, coastRandom, coastTrailDistance, forestStreamDistance,
  forestStreamLevel, groundHeight, groundSlope, smoothstep,
} from './terrain';
import { createForestRocks } from './world/coastForestRocks';
import { createForestWater } from './world/coastForestWater';
import { createCoastLandmarks, createCoastSeagrass, createCreekFlowers } from './world/coastLandmarks';
import { createCoastLighting } from './world/coastLighting';
import { createCoastOceanGeometry, createCoastOceanMaterial } from './world/coastOcean';
import { loadCoastScenery } from './world/coastSceneryAssets';
import { createCoastSky } from './world/coastSky';
import { createCoastTerrain, loadCoastTexture } from './world/coastSurface';
import { createCoastVegetation } from './world/coastVegetation';
import { createWaterfalls } from './world/coastWaterfall';
import { SEA_WATER_SCATTER, STREAM_WATER_SCATTER } from './world/coastWaterOptics';

export type CoastQuality = 'light' | 'high';

function createShoreRocks(stone: THREE.Texture): THREE.Group {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const fracture = 0.83 + 0.14*Math.sin(x*7.6 + y*7.9 + z*3.3) + 0.12*Math.cos(z*8.3 - y*6.7);
    positions.setXYZ(i, x*fracture + 0.18*y, Math.max(-0.59, Math.min(0.78, y*fracture)), z*fracture);
    const moss = THREE.MathUtils.smoothstep(y, 0.13, 0.76) * (0.6 + 0.4*Math.sin(x*6.2 + z*4.2));
    const wet = THREE.MathUtils.smoothstep(y, -0.63, -0.06);
    colors.set([0.72 + wet*0.23 - moss*0.37, 0.75 + wet*0.22 - moss*0.07, 0.78 + wet*0.16 - moss*0.43], i*3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    map: stone, vertexColors: true, roughness: 0.82, bumpMap: stone, bumpScale: 0.31,
  });
  const random = coastRandom(75782);
  const props = new THREE.Group();
  props.name = 'Broken rock and moss at the tide line';
  const clusters = [
    { x: -29, z: 65, width: 2.8, pieces: 9 },
    { x: 7, z: 77, width: 3.1, pieces: 9 },
    { x: -49, z: 45, width: 7.5, pieces: 15 },
    { x: 39, z: 65, width: 5.2, pieces: 15 },
    { x: -39, z: 25, width: 4.9, pieces: 13 },
    { x: 39, z: 21, width: 6.4, pieces: 16 },
    { x: 48, z: 43, width: 6.2, pieces: 12 },
    { x: 47, z: -6, width: 6.5, pieces: 13 },
    { x: 42, z: 26, width: 3.4, pieces: 13 },
    { x: 53, z: 20, width: 2.5, pieces: 10 },
    { x: 53, z: 39, width: 2.7, pieces: 14 },
    { x: 59, z: 26, width: 2.8, pieces: 10 },
    { x: 66, z: 52, width: 3.5, pieces: 11 },
    { x: 129, z: -22, width: 4.7, pieces: 13 },
    { x: -73, z: 10, width: 7.8, pieces: 16 },
    { x: -126, z: -14, width: 4.8, pieces: 12 },
    { x: -151, z: 10, width: 3.6, pieces: 9 },
    { x: -99, z: 112, width: 3.4, pieces: 12 },
    { x: -94, z: 121, width: 3.9, pieces: 12 },
    { x: -76, z: 120, width: 2.4, pieces: 9 },
    { x: -65, z: -48, width: 8.9, pieces: 18 },
    { x: 89, z: -52, width: 8.8, pieces: 17 },
  ];
  for (const cluster of clusters) {
    const instance = new THREE.InstancedMesh(geometry, material, cluster.pieces);
    const transform = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < cluster.pieces; i += 1) {
      const angle = random()*Math.PI*2;
      const size = cluster.width * (i === 0 ? 0.67 : 0.05+random()*random()*0.52);
      const radius = cluster.width * (i === 0 ? 0 : 0.32+random()*1.94);
      const x = cluster.x + Math.cos(angle)*radius;
      const z = cluster.z + Math.sin(angle)*radius;
      if (coastTrailDistance(x, z) < 1.75 + size || groundSlope(x, z) > 1.1 || groundHeight(x, z) < -3.4) continue;
      const height = 0.37 + random()*0.58;
      transform.position.set(x, groundHeight(x, z) + size*height*0.06, z);
      transform.rotation.set((random()-0.5)*0.40, random()*Math.PI*2, (random()-0.5)*0.45);
      transform.scale.set(size*(0.8+random()*0.62), size*height, size*(0.69+random()*0.66));
      transform.updateMatrix();
      instance.setMatrixAt(placed++, transform.matrix);
    }
    if (placed === 0) continue;
    instance.count = placed;
    instance.castShadow = instance.receiveShadow = true;
    props.add(instance);
  }
  return props;
}

function createSeabirds(): { mesh: THREE.InstancedMesh; update: (elapsed: number) => void } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0,0,0.33, -0.21,0,-0.39, 0,0,-0.15,
    0,0,0.33, 0,0,-0.15, 0.21,0,-0.39,
    -0.07,0,-0.10, -0.49,0.08,0.02, -1.02,0.06,-0.38,
    -0.07,0,-0.10, -1.02,0.06,-0.38, -0.33,0,-0.29,
    0.07,0,-0.10, 1.02,0.06,-0.38, 0.49,0.08,0.02,
    0.07,0,-0.10, 0.33,0,-0.29, 1.02,0.06,-0.38,
  ], 3));
  const time = { value: 0 };
  const material = new THREE.MeshBasicMaterial({ color: 0xf5f5df, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.uniforms.uFlightTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFlightTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float flap = sin(uFlightTime*6.8 + float(gl_InstanceID)*2.399);
        transformed.y += abs(position.x)*flap*0.42;
      `);
  };
  const flocks = [
    { x: -56, z: -125, y: 29, radius: 37, count: 14, size: 0.65 },
    { x: 39, z: -287, y: 68, radius: 66, count: 16, size: 0.93 },
  ];
  const mesh = new THREE.InstancedMesh(geometry, material, flocks.reduce((total, flock) => total+flock.count, 0));
  mesh.name = 'Seabird flocks';
  mesh.frustumCulled = false;
  const shape = new THREE.Object3D();
  return {
    mesh,
    update(elapsed) {
      time.value = elapsed;
      let index = 0;
      for (const flock of flocks) {
        const angle = elapsed*0.069 + flock.x;
        for (let bird = 0; bird < flock.count; bird += 1) {
          const phase = angle + bird*0.057 + 0.11*Math.sin(bird*8.69);
          const radius = flock.radius + bird*0.91 + 6*Math.sin(bird*2.399);
          shape.position.set(flock.x + Math.cos(phase)*radius, flock.y + 6.3*Math.sin(phase*0.74+bird*1.34),
            flock.z + Math.sin(phase)*radius);
          shape.rotation.set(0.07, -phase, Math.sin(phase+bird)*0.15);
          shape.scale.setScalar(flock.size * (0.66+0.40*Math.sin(bird*3.17)**2));
          shape.updateMatrix();
          mesh.setMatrixAt(index++, shape.matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

export class CoastWorld {
  readonly scene = new THREE.Scene();
  private readonly time = { value: 0 };
  private readonly fog = new THREE.Fog(0xa6d0e8, 135, 854);
  private readonly coastAir = new THREE.Color(0xa6d0e8);
  private readonly forestAir = new THREE.Color(0x80988e);
  private readonly seaScattering = new THREE.Color(SEA_WATER_SCATTER);
  private readonly streamScattering = new THREE.Color(STREAM_WATER_SCATTER);
  private readonly lighting: ReturnType<typeof createCoastLighting>;
  private readonly sky: ReturnType<typeof createCoastSky>;
  private readonly terrain: ReturnType<typeof createCoastTerrain>;
  private readonly vegetation: ReturnType<typeof createCoastVegetation>;
  private readonly waterfalls: ReturnType<typeof createWaterfalls>;
  private readonly seabirds = createSeabirds();
  private quality: CoastQuality | undefined;
  private disposed = false;
  private diveObstacles: ((x: number, z: number) => number | undefined) | undefined;

  constructor() {
    this.scene.fog = this.fog;
    const sunDirection = new THREE.Vector3(0.46, 0.70, 0.58).normalize();
    this.sky = createCoastSky(sunDirection);
    this.scene.add(this.sky.dome, this.sky.clouds);

    const stone = loadCoastTexture('limestone.webp', true);
    const sand = loadCoastTexture('sand.webp', true);
    this.terrain = createCoastTerrain(stone, sand, this.time);
    this.scene.add(this.terrain.mesh, createShoreRocks(stone), createForestRocks(this.terrain.mossRock));
    const ocean = new THREE.Mesh(createCoastOceanGeometry(),
      createCoastOceanMaterial(this.time, sunDirection, sand));
    ocean.name = 'Clear shoals and open sea';
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(0, SEA_LEVEL, -230);
    ocean.receiveShadow = true;
    this.vegetation = createCoastVegetation(this.time, coastPlantingDistance, forestStreamDistance);
    this.scene.add(ocean, this.vegetation, createForestWater(this.time), createCoastSeagrass(this.time), createCreekFlowers());

    this.waterfalls = createWaterfalls(COAST_FALLS, this.time);
    this.scene.add(this.waterfalls.group, this.seabirds.mesh);
    this.lighting = createCoastLighting(this.scene, sunDirection);
    void loadCoastScenery().then(scenery => {
      if (this.disposed) return;
      const landmarks = createCoastLandmarks(scenery);
      this.scene.add(landmarks.group);
      this.diveObstacles = landmarks.diveObstacleHeight;
      this.lighting.addScenery(landmarks.group);
    }).catch(() => {
      if (!this.disposed) console.error('Could not load the local coast scenery models.');
    });
    this.setQuality('light');
  }

  diveObstacleHeight(x: number, z: number): number | undefined {
    return this.diveObstacles?.(x, z);
  }

  setQuality(quality: CoastQuality): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.lighting.setQuality(quality);
    this.terrain.setQuality(quality);
    this.vegetation.setQuality(quality);
  }

  update(elapsed: number, camera: THREE.PerspectiveCamera): void {
    this.time.value = elapsed;
    this.sky.dome.position.copy(camera.position);
    const { x, y, z } = camera.position;
    const inside = smoothstep(127, 194, z) * (1 - smoothstep(152, 219, Math.abs(x)));
    const humidAir = inside * (1 - 0.83 * smoothstep(346, 392, z)) * (1 - smoothstep(51, 83, y));
    this.fog.color.copy(this.coastAir).lerp(this.forestAir, humidAir);
    this.fog.near = 135 - humidAir * 95;
    this.fog.far = 854 - humidAir * 433;
    const stream = forestStreamLevel(x, z);
    const depth = (stream ?? SEA_LEVEL) - y;
    const underwater = depth > 0.10;
    this.sky.dome.visible = this.sky.clouds.visible = !underwater;
    this.scene.background = underwater ? this.fog.color : null;
    if (depth > 0) {
      const submersion = smoothstep(0.01, 0.24, depth);
      const openWater = stream === undefined;
      this.fog.color.lerp(openWater ? this.seaScattering : this.streamScattering, submersion);
      this.fog.near = THREE.MathUtils.lerp(this.fog.near, 2.0, submersion);
      const visibility = openWater ? 58 - 30 * smoothstep(1.7, 23, depth) : 23;
      this.fog.far = THREE.MathUtils.lerp(this.fog.far, visibility, submersion);
    }
    this.waterfalls.update(elapsed);
    this.seabirds.update(elapsed);
    this.vegetation.update(camera);
    this.lighting.update(elapsed, camera);
  }

  dispose(): void {
    this.disposed = true;
    this.lighting.dispose();
  }
}
