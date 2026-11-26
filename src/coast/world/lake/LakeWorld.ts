import { AmbientLight, Color, DirectionalLight, FogExp2, Group, HemisphereLight, PointLight, Scene } from 'three';
import type { ExplorationScene } from '../../CoastApp';
import { disposeSceneDrawables } from '../../disposeSceneDrawables';
import type { WorldLightingMode } from '../../WorldLightingControl';
import { createCoastAtmosphere, type CoastTimeOfDay } from '../coastAtmosphere';
import { buildLakeAndon } from './lakeAndon';
import { LakeAudio } from './lakeAudio';
import { buildLakeBasin } from './lakeBasin';
import { buildLakeFloatingLanterns } from './lakeFloatingLanterns';
import { buildLakeFuton } from './lakeFuton';
import { buildLakeHall } from './lakeHall';
import { lakeNavigation } from './lakeNavigation';
import { createLakeSettings, LAKE_DEFAULT_MOON, LAKE_DEFAULT_SUN, setLakeLightDirection } from './lakeSettings';
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
  const fog = new FogExp2(0x9cb3ca, 0.00162);
  scene.fog = fog;
  scene.background = new Color(0x96bad8);
  const atmosphere = createCoastAtmosphere(LAKE_DEFAULT_SUN, {
    moonDirection: LAKE_DEFAULT_MOON,
    nightHorizon: 0x111b2e,
    nightZenith: 0x070d1a,
  });

  const ambient = new AmbientLight(0xf1ebdf);
  const daylight = new HemisphereLight(0xdceaff, 0xa5a3a1);
  const sun = new DirectionalLight(0xfff3dc);
  sun.target.position.set(0, 0, -1.8);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 19;
  sun.shadow.camera.bottom = -19;
  sun.shadow.camera.far = 145;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.00024;
  sun.shadow.normalBias = 0.016;
  sun.shadow.radius = 2.8;
  sun.shadow.autoUpdate = false;
  scene.add(ambient, daylight, sun, sun.target);

  const hallGroup = sceneGroup(scene, 'Lakeside hall');
  const basinGroup = sceneGroup(scene, 'Rock basin and stone ring');
  const wildlifeGroup = sceneGroup(scene, 'Birds and shallow-water fish');
  const lampMounts = [
    [-14.4, 2.50, 15.35], [0, 3.35, 15.62], [14.4, 2.50, 15.35],
  ] as const;
  const lamps = lampMounts.map(([x, y, z]) => {
    const lamp = new PointLight(0xffd2a2, 0, 8, 2);
    lamp.position.set(x, y, z);
    hallGroup.add(lamp);
    return lamp;
  });

  const [hall] = await Promise.all([buildLakeHall(hallGroup), buildLakeBasin(basinGroup)]);
  const andon = buildLakeAndon(hallGroup, hall.arrangementBounds);
  const futon = buildLakeFuton(hallGroup);
  const lanterns = buildLakeFloatingLanterns(sceneGroup(scene, 'Lake lantern display'), atmosphere.sun);
  const sky = buildLakeSky(scene, atmosphere);
  const wildlife = buildLakeWildlife(wildlifeGroup);
  const elapsed = { value: 0 };
  const water = buildLakeWater(scene, elapsed, atmosphere);
  let time: CoastTimeOfDay = 'day';
  let mode: WorldLightingMode = 'auto';
  let disposed = false;
  const lakeSettings = createLakeSettings((next, previous) => {
    if (next.futon !== previous.futon) {
      futon.setVisible(next.futon);
      sun.shadow.needsUpdate = true;
    }
    if (next.lanterns !== previous.lanterns) lanterns.setVisible(next.lanterns);
    if (next.moonVisible !== previous.moonVisible) sky.setMoonVisible(next.moonVisible);
    const activeLightMoved = time === 'day'
      ? next.sunAzimuth !== previous.sunAzimuth || next.sunElevation !== previous.sunElevation
      : next.moonAzimuth !== previous.moonAzimuth || next.moonElevation !== previous.moonElevation;
    if (activeLightMoved) {
      setLakeLightDirection(atmosphere.sun.value, next, time);
      updateLighting();
    }
  });

  function updateLighting(): void {
    const night = time === 'night';
    const lampsOn = mode === 'on' || (mode === 'auto' && night);
    ambient.intensity = night ? 0.075 : 0.22;
    daylight.color.setHex(night ? 0x93aad6 : 0xdceaff);
    daylight.groundColor.setHex(night ? 0x655d69 : 0xa5a3a1);
    daylight.intensity = night ? 0.49 : 0.92;
    sun.color.setHex(night ? 0xabc4f4 : 0xfff3dc);
    sun.intensity = night ? 0.33 : 2.9;
    sun.position.copy(atmosphere.sun.value).multiplyScalar(68).add(sun.target.position);
    sun.castShadow = !night;
    sun.shadow.needsUpdate = true;
    fog.color.setHex(night ? 0x13243a : 0x9cb3ca);
    fog.density = night ? 0.00151 : 0.00162;
    for (const lamp of lamps) lamp.intensity = lampsOn ? 3.5 : 0;
    hall.setTimeOfDay(time, lampsOn);
    andon.setLighting(night, lampsOn);
  }

  futon.setVisible(lakeSettings.state.futon);
  lanterns.setVisible(lakeSettings.state.lanterns);
  sky.setMoonVisible(lakeSettings.state.moonVisible);
  setLakeLightDirection(atmosphere.sun.value, lakeSettings.state, time);
  updateLighting();
  const audio = new LakeAudio();
  return {
    id: 'lake',
    navigation: lakeNavigation,
    audio,
    lakeKoto: audio,
    lakeSettings,
    world: {
      scene,
      grabTargets: [andon.grabTarget],
      get artificialLightingMode() { return mode; },
      setArtificialLightingMode(value) {
        mode = value;
        updateLighting();
      },
      setTimeOfDay(value) {
        time = value;
        atmosphere.setTimeOfDay(value);
        setLakeLightDirection(atmosphere.sun.value, lakeSettings.state, time);
        sky.setTimeOfDay(value);
        wildlife.setTimeOfDay(value);
        lanterns.setTimeOfDay(value);
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
        lanterns.update(seconds);
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
