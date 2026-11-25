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
      const wall = 0.15 + 0.17 * Math.max(0, up);
      const bands = Math.exp(-((up - 0.25) ** 2) * 335) + 0.8 * Math.exp(-((up - 0.61) ** 2) * 165);
      const brightWall = bands * (0.36 + 1.34 * x ** 2);
      const roof = Math.max(0, up) ** 5 * Math.max(0.16, 0.6 - 0.35 * z);
      const ceiling = Math.max(0, up) * (0.32 + 0.1 * Math.cos(3 * azimuth));
      const index = (row * width + column) * 4;
      data[index] = DataUtils.toHalfFloat(wall + brightWall * 1.45 + roof * 0.58 + ceiling);
      data[index + 1] = DataUtils.toHalfFloat(wall * 0.79 + brightWall * 1.02 + roof * 1.30 + ceiling * 0.83);
      data[index + 2] = DataUtils.toHalfFloat(wall * 0.57 + brightWall * 0.64 + roof * 1.90 + ceiling * 0.68);
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
  const fill = new AmbientLight(0xfff3e2, 0.53);
  const bounce = new HemisphereLight(0xe3ecff, 0xb79c7d, 1.02);
  const coveBounce = new DirectionalLight(0xffdec0, 1.32);
  coveBounce.position.set(-4, 13, 8);
  const shopBounce = new DirectionalLight(0xffdfbd, 0.58);
  shopBounce.position.set(9, 6, -34);
  shopBounce.target.position.set(0, 0, -25);
  const roofLight = new DirectionalLight(0xb9daff, 0.81);
  roofLight.position.set(4, 20, -30);
  roofLight.target.position.set(-1, 0, -19);
  const floorBounce = new DirectionalLight(0xffe4c9, 0.55);
  floorBounce.position.set(0, -9, -22);
  floorBounce.target.position.set(0, 8, -21);
  scene.add(fill, bounce, coveBounce, shopBounce, shopBounce.target, roofLight, roofLight.target,
    floorBounce, floorBounce.target);

  const floor = await createAtriumFloor(scene);
  const shell = buildAtriumShell(room, floor.wallStone);
  const roof = buildAtriumRoof(room);
  const stair = buildAtriumStair(room);
  const retail = buildAtriumRetail(room);
  const furnishings = buildAtriumFurnishings(room);
  batchAtriumOpaqueMeshes(room);
  let mode: WorldLightingMode = 'auto';
  let time: CoastTimeOfDay = 'day';
  let disposed = false;

  function updateLighting() {
    const artificialOn = mode !== 'off';
    const daytime = time === 'day';
    scene.environmentIntensity = artificialOn ? (daytime ? 0.64 : 0.56) : (daytime ? 0.25 : 0.08);
    fill.intensity = artificialOn ? 0.56 : 0.15;
    bounce.intensity = daytime ? 0.90 : 0.35;
    coveBounce.intensity = artificialOn ? 1.28 : 0;
    shopBounce.intensity = artificialOn ? 0.69 : 0;
    roofLight.intensity = daytime ? 0.86 : 0.14;
    floorBounce.intensity = artificialOn ? 0.62 : (daytime ? 0.18 : 0.04);
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
