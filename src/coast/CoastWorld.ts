import * as THREE from 'three';
import type { CoastBirdCue } from './coastBirdCue';
import {
  COAST_FALLS, COAST_REST_SITES, SEA_LEVEL, UPLAND_FALL, coastPlantingDistance, coastRandom, coastTrailDistance,
  forestStreamDistance, groundHeight, groundSlope, inlandWaterLevel, smoothstep,
} from './terrain';
import { COAST_SUN_DIRECTION, createCoastAtmosphere, type CoastTimeOfDay } from './world/coastAtmosphere';
import { createCoastBirdLife } from './world/coastBirdLife';
import { createForestRocks } from './world/coastForestRocks';
import { createForestWater } from './world/coastForestWater';
import { createInariTrail } from './world/coastInariTrail';
import { createCoastLandmarks, createCoastSeagrass, createCreekFlowers } from './world/coastLandmarks';
import { createCoastLighting } from './world/coastLighting';
import { createCoastOcean } from './world/coastOcean';
import { createCoastRestAreas } from './world/coastRestAreas';
import { loadCoastScenery } from './world/coastSceneryAssets';
import { createCoastSky } from './world/coastSky';
import { createCoastTerrain, loadCoastTexture } from './world/coastSurface';
import { createCoastVegetation } from './world/coastVegetation';
import { createUplandLake } from './world/coastUplandLake';
import { createUplandTrailDetails } from './world/coastUplandDetails';
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

export class CoastWorld {
  readonly scene = new THREE.Scene();
  private readonly time = { value: 0 };
  private readonly fog = new THREE.Fog(0xa6d0e8, 135, 854);
  private readonly coastAir = new THREE.Color(0xa6d0e8);
  private readonly forestAir = new THREE.Color(0x80988e);
  private readonly uplandAir = new THREE.Color(0xa4c9db);
  private readonly seaScattering = new THREE.Color(SEA_WATER_SCATTER);
  private readonly streamScattering = new THREE.Color(STREAM_WATER_SCATTER);
  private readonly waterFog = new THREE.Color();
  private readonly atmosphere = createCoastAtmosphere(COAST_SUN_DIRECTION);
  private readonly lighting: ReturnType<typeof createCoastLighting>;
  private readonly sky: ReturnType<typeof createCoastSky>;
  private readonly terrain: ReturnType<typeof createCoastTerrain>;
  private readonly vegetation: ReturnType<typeof createCoastVegetation>;
  private readonly waterfalls: ReturnType<typeof createWaterfalls>;
  private readonly ocean: ReturnType<typeof createCoastOcean>;
  private readonly lake: ReturnType<typeof createUplandLake>;
  private readonly birds = createCoastBirdLife();
  private quality: CoastQuality | undefined;
  private timeOfDay: CoastTimeOfDay = 'day';
  private disposed = false;
  private diveObstacles: ((x: number, z: number) => number | undefined) | undefined;

  constructor() {
    this.scene.fog = this.fog;
    this.sky = createCoastSky(this.atmosphere);
    this.scene.add(this.sky.dome, this.sky.clouds);

    const stone = loadCoastTexture('limestone.webp', true);
    const sand = loadCoastTexture('sand.webp', true);
    this.terrain = createCoastTerrain(stone, sand, this.time);
    this.scene.add(this.terrain.mesh, createShoreRocks(stone), createForestRocks(this.terrain.mossRock));
    this.ocean = createCoastOcean(this.time, this.atmosphere, sand);
    this.vegetation = createCoastVegetation(this.time, coastPlantingDistance, forestStreamDistance);
    this.lake = createUplandLake(this.time, this.atmosphere);
    const wood = loadCoastTexture('forest-bark.webp', true);
    this.scene.add(this.ocean.mesh, this.lake.mesh, this.vegetation,
      createForestWater(this.time, this.atmosphere.surfaceLight), createCoastSeagrass(this.time),
      createCreekFlowers(), createCoastRestAreas(COAST_REST_SITES, wood, stone), createUplandTrailDetails(this.time, wood),
      createInariTrail(wood));

    this.waterfalls = createWaterfalls([...COAST_FALLS, UPLAND_FALL], this.time, this.atmosphere);
    this.scene.add(this.waterfalls.group, this.birds.group);
    this.lighting = createCoastLighting(this.scene, this.atmosphere);
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
    this.ocean.setQuality(quality);
    this.lake.setQuality(quality);
  }

  setTimeOfDay(time: CoastTimeOfDay): void {
    if (this.timeOfDay === time) return;
    this.timeOfDay = time;
    this.atmosphere.setTimeOfDay(time);
    this.sky.setTimeOfDay(time);
    this.lighting.setTimeOfDay(time);
  }

  update(elapsed: number, camera: THREE.PerspectiveCamera): readonly CoastBirdCue[] {
    this.time.value = elapsed;
    const { x, y, z } = camera.position;
    const inside = smoothstep(127, 194, z) * (1 - smoothstep(152, 219, Math.abs(x)));
    const humidAir = inside * (1 - 0.83 * smoothstep(346, 392, z)) * (1 - smoothstep(51, 83, y));
    const upland = smoothstep(409, 626, z);
    const ridge = smoothstep(95, 166, y) * upland;
    this.fog.color.copy(this.coastAir).lerp(this.forestAir, humidAir).lerp(this.uplandAir, upland);
    if (this.timeOfDay === 'night') this.fog.color.copy(this.atmosphere.nightHorizon.value);
    this.fog.near = THREE.MathUtils.lerp(135 - humidAir * 95, 92 + ridge * 104, upland);
    this.fog.far = THREE.MathUtils.lerp(854 - humidAir * 433, 1410 + ridge * 565, upland);
    const inlandWater = inlandWaterLevel(x, z);
    const depth = (inlandWater ?? SEA_LEVEL) - y;
    const underwater = depth > 0.10;
    const submersion = smoothstep(0.01, 0.24, depth);
    this.atmosphere.submersion.value = submersion;
    this.sky.dome.visible = this.sky.clouds.visible = !underwater;
    this.scene.background = underwater ? this.fog.color : null;
    if (depth > 0) {
      const openWater = inlandWater === undefined;
      this.waterFog.copy(openWater ? this.seaScattering : this.streamScattering)
        .multiply(this.atmosphere.surfaceLight.value);
      this.fog.color.lerp(this.waterFog, submersion);
      this.fog.near = THREE.MathUtils.lerp(this.fog.near, 2.0, submersion);
      const visibility = openWater ? 58 - 30 * smoothstep(1.7, 23, depth) : 23;
      this.fog.far = THREE.MathUtils.lerp(this.fog.far, visibility, submersion);
    }
    this.waterfalls.update(elapsed);
    this.vegetation.update(camera);
    this.lighting.update(elapsed, camera);
    return this.birds.update(elapsed, camera.position);
  }

  dispose(): void {
    this.disposed = true;
    this.ocean.mesh.dispose();
    this.lake.mesh.dispose();
    this.lighting.dispose();
    this.sky.dispose();
    this.atmosphere.sky.value.dispose();
  }
}
