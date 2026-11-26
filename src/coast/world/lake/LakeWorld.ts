import { AmbientLight, Color, DirectionalLight, FogExp2, Group, HemisphereLight, PointLight, Scene, Vector3 } from 'three';
import type { ExplorationScene } from '../../CoastApp';
import { disposeSceneDrawables } from '../../disposeSceneDrawables';
import type { WorldLightingMode } from '../../WorldLightingControl';
import { createCoastAtmosphere, type CoastTimeOfDay } from '../coastAtmosphere';
import { LakeAudio } from './lakeAudio';
import { buildLakeBasin } from './lakeBasin';
import { buildLakeHall } from './lakeHall';
import { lakeNavigation } from './lakeNavigation';
import { buildLakeSky } from './lakeSky';
import { buildLakeWater } from './lakeWater';
import { buildLakeWildlife } from './lakeWildlife';

function sceneGroup(scene: Scene, name: string): Group {
  const group = new Group();
  group.name = name;
  scene.add(group);
  return group;
}

export async function loadLakeScene(): Promise<ExplorationScene> {
  const scene = new Scene();
  const fog = new FogExp2(0xa1bbd0, 0.00155);
  scene.fog = fog;
  scene.background = new Color(0x96bad8);
  const atmosphere = createCoastAtmosphere(new Vector3(0.58, 0.56, -0.55), {
    moonDirection: new Vector3(-0.67, 0.31, 0.67),
    nightHorizon: 0x111b2e,
    nightZenith: 0x070d1a,
  });

  const ambient = new AmbientLight(0xffeee5);
  const daylight = new HemisphereLight(0xe2efff, 0x9b8873);
  const sun = new DirectionalLight(0xfff0d8);
  sun.target.position.set(0, 0, -1.8);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 19;
  sun.shadow.camera.bottom = -19;
  sun.shadow.camera.far = 145;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.00024;
  sun.shadow.normalBias = 0.026;
  sun.shadow.radius = 2.8;
  sun.shadow.autoUpdate = false;
  scene.add(ambient, daylight, sun, sun.target);

  const hallGroup = sceneGroup(scene, 'Lakeside hall');
  const basinGroup = sceneGroup(scene, 'Rock basin and stone ring');
  const wildlifeGroup = sceneGroup(scene, 'Birds and shallow-water fish');
  const lamps = [-18.8, 18.8].map(x => {
    const lamp = new PointLight(0xffc793, 0, 7, 2);
    lamp.position.set(x, 0.82, 10.6);
    hallGroup.add(lamp);
    return lamp;
  });

  const [hall] = await Promise.all([buildLakeHall(hallGroup), buildLakeBasin(basinGroup)]);
  const sky = buildLakeSky(scene, atmosphere);
  const wildlife = buildLakeWildlife(wildlifeGroup);
  const elapsed = { value: 0 };
  const water = buildLakeWater(scene, elapsed, atmosphere);
  let time: CoastTimeOfDay = 'day';
  let mode: WorldLightingMode = 'auto';
  let disposed = false;

  function updateLighting(): void {
    const night = time === 'night';
    const lampsOn = mode === 'on' || (mode === 'auto' && night);
    ambient.intensity = night ? 0.050 : 0.14;
    daylight.color.setHex(night ? 0x839cd3 : 0xe2efff);
    daylight.groundColor.setHex(night ? 0x635568 : 0x9b8873);
    daylight.intensity = night ? 0.42 : 0.90;
    sun.color.setHex(night ? 0xabc4f4 : 0xfff0d8);
    sun.intensity = night ? 0.32 : 2.45;
    sun.position.copy(atmosphere.sun.value).multiplyScalar(68).add(sun.target.position);
    sun.castShadow = !night;
    sun.shadow.needsUpdate = true;
    fog.color.setHex(night ? 0x102036 : 0xa1bbd0);
    fog.density = night ? 0.00158 : 0.00155;
    for (const lamp of lamps) lamp.intensity = lampsOn ? 2.1 : 0;
    hall.setTimeOfDay(time, lampsOn);
  }

  updateLighting();
  return {
    id: 'lake',
    navigation: lakeNavigation,
    audio: new LakeAudio(),
    world: {
      scene,
      get artificialLightingMode() { return mode; },
      setArtificialLightingMode(value) {
        mode = value;
        updateLighting();
      },
      setTimeOfDay(value) {
        time = value;
        atmosphere.setTimeOfDay(value);
        sky.setTimeOfDay(value);
        wildlife.setTimeOfDay(value);
        updateLighting();
      },
      setQuality(quality) {
        const size = quality === 'high' ? 2048 : 1024;
        if (sun.shadow.mapSize.x !== size) {
          sun.shadow.map?.dispose();
          sun.shadow.map = null;
          sun.shadow.mapSize.set(size, size);
          sun.shadow.needsUpdate = true;
        }
        water.setQuality(quality);
      },
      update(seconds) {
        elapsed.value = seconds;
        sky.update(seconds);
        return wildlife.update(seconds);
      },
      prepareRender(renderer, camera) { water.prepareRender?.(renderer, camera); },
      dispose() {
        if (disposed) return;
        disposed = true;
        water.dispose?.();
        sky.dispose?.();
        atmosphere.sky.value.dispose();
        disposeSceneDrawables(scene);
      },
    },
  };
}
