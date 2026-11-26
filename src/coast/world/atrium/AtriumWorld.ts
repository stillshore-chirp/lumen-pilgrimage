import {
  AmbientLight, Color, DataTexture, DataUtils, DirectionalLight, EquirectangularReflectionMapping, Group,
  HalfFloatType, HemisphereLight, LinearFilter, RGBAFormat, Scene,
} from 'three';
import type { ExplorationScene } from '../../CoastApp';
import { disposeSceneDrawables } from '../../disposeSceneDrawables';
import type { WorldLightingMode } from '../../WorldLightingControl';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { AtriumAudio } from './atriumAudio';
import { batchAtriumOpaqueMeshes } from './atriumBatches';
import { createAtriumFloor } from './atriumFloor';
import { buildAtriumFurnishings } from './atriumFurnishings';
import { atriumNavigation } from './atriumNavigation';
import { buildAtriumRetail } from './atriumRetail';
import { buildAtriumRoof } from './atriumRoof';
import { buildAtriumShell } from './atriumShell';
import { buildAtriumStair } from './atriumStair';

// A compact indoor radiance map gives metal and glazing their broad reflected light sources.
// The floor additionally uses a spatial reflection of the actual architecture.
function atriumRoomRadiance() {
  const width = 256;
  const height = 128;
  const data = new Uint16Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const elevation = (row + 0.5) / height * Math.PI - Math.PI / 2;
    const up = Math.sin(elevation);
    const horizontal = Math.cos(elevation);
    for (let column = 0; column < width; column++) {
      const azimuth = (column + 0.5) / width * Math.PI * 2;
      const x = Math.cos(azimuth) * horizontal;
      const z = Math.sin(azimuth) * horizontal;
      const paleSurfaces = 0.105 + 0.15 * Math.max(0, up);
      const sideWeight = 0.28 + 1.58 * Math.abs(x) ** 1.5;
      const railHeight = Math.exp(-((up - 0.28) ** 2) * 980) + 0.72 * Math.exp(-((up - 0.53) ** 2) * 450);
      const coveWash = 0.44 * Math.exp(-((up - 0.35) ** 2) * 45) + 0.27 * Math.exp(-((up - 0.68) ** 2) * 64);
      const warmShelves = Math.exp(-((up + 0.07) ** 2) * 48) * 0.30;
      const warm = (railHeight + coveWash + warmShelves) * sideWeight;
      const roofOpening = Math.exp(-((up - 0.65) ** 2) * 18 - (x * x) * 6) * Math.max(0, -z) ** 2;
      const index = (row * width + column) * 4;
      data[index] = DataUtils.toHalfFloat(paleSurfaces + warm * 1.62 + roofOpening * 0.37);
      data[index + 1] = DataUtils.toHalfFloat(paleSurfaces * 0.81 + warm * 1.23 + roofOpening * 0.74);
      data[index + 2] = DataUtils.toHalfFloat(paleSurfaces * 0.67 + warm * 0.76 + roofOpening * 1.12);
      data[index + 3] = DataUtils.toHalfFloat(1);
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, HalfFloatType);
  texture.name = 'atrium radiance';
  texture.mapping = EquirectangularReflectionMapping;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export async function loadAtriumScene(): Promise<ExplorationScene> {
  const scene = new Scene();
  const room = new Group();
  const radiance = atriumRoomRadiance();
  scene.add(room);
  scene.background = new Color(0x283348);
  scene.environment = radiance;
  const fill = new AmbientLight(0xffe7cf);
  const bounce = new HemisphereLight(0xe4eeff, 0xb39476);
  const coveBounce = new DirectionalLight(0xffd5a8);
  coveBounce.position.set(-8, 12, -4);
  const shopBounce = new DirectionalLight(0xffe1be);
  shopBounce.position.set(11, 5, -34);
  shopBounce.target.position.set(0, 0, -25);
  const roofLight = new DirectionalLight(0xbcd9ff);
  roofLight.position.set(2, 20, -43);
  roofLight.target.position.set(-1, 0, -30);
  const floorBounce = new DirectionalLight(0xffd7ad);
  floorBounce.position.set(0, -9, -22);
  floorBounce.target.position.set(0, 8, -21);
  scene.add(fill, bounce, coveBounce, shopBounce, shopBounce.target, roofLight, roofLight.target,
    floorBounce, floorBounce.target);

  const floor = await createAtriumFloor(scene);
  const shell = buildAtriumShell(room, floor.wallStone);
  const roof = buildAtriumRoof(room);
  const stair = buildAtriumStair(room);
  const retail = await buildAtriumRetail(room, floor.wallStone);
  const furnishings = buildAtriumFurnishings(room);
  batchAtriumOpaqueMeshes(room);
  let mode: WorldLightingMode = 'auto';
  let time: CoastTimeOfDay = 'day';
  let disposed = false;

  function updateLighting() {
    const artificialOn = mode !== 'off';
    const daytime = time === 'day';
    scene.environmentIntensity = artificialOn ? (daytime ? 0.69 : 0.53) : (daytime ? 0.22 : 0.07);
    fill.intensity = artificialOn ? 0.39 : 0.125;
    bounce.intensity = daytime ? 0.82 : 0.33;
    coveBounce.intensity = artificialOn ? 1.20 : 0;
    shopBounce.intensity = artificialOn ? 0.74 : 0;
    roofLight.intensity = daytime ? 0.75 : 0.10;
    floorBounce.intensity = artificialOn ? 0.54 : (daytime ? 0.16 : 0.035);
    shell.setLighting(artificialOn, time);
    roof.setLighting(artificialOn, time);
    stair.setLighting(artificialOn);
    retail.setLighting(artificialOn);
    furnishings.setLighting(artificialOn);
    floor.setLighting(artificialOn, time);
  }

  updateLighting();
  return {
    id: 'atrium',
    navigation: atriumNavigation,
    audio: new AtriumAudio(),
    world: {
      scene,
      get artificialLightingMode() { return mode; },
      setArtificialLightingMode(value) {
        mode = value;
        updateLighting();
      },
      setTimeOfDay(value) {
        time = value;
        updateLighting();
      },
      setQuality: floor.setQuality,
      update() { return []; },
      prepareRender: floor.prepareRender,
      dispose() {
        if (disposed) return;
        disposed = true;
        scene.environment = null;
        radiance.dispose();
        floor.dispose();
        disposeSceneDrawables(scene);
      },
    },
  };
}
