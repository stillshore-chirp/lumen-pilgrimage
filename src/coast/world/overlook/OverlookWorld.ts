import * as THREE from 'three';
import type { OverlookScene } from '../../CoastApp';
import { EXPLORATION_WORLDS } from '../../coastDestinations';
import type { CoastQuality } from '../../CoastWorld';
import { createCoastAtmosphere, type CoastTimeOfDay } from '../coastAtmosphere';
import { createCoastLighting } from '../coastLighting';
import { createCoastSky } from '../coastSky';
import { createOverlookCity, createOverlookCityGround } from './overlookCity';
import { createOverlookDeck, OVERLOOK_DECK_OBSTACLES } from './overlookDeck';
import { createOverlookHillside } from './overlookHillside';
import { createOverlookSurface, DECK_LEVEL, loadOverlookTerrain } from './overlookTerrain';

const DAY_SUN = new THREE.Vector3(-0.57, 0.71, -0.42).normalize();
const bounds = { minX: -34.35, maxX: 34.35, minZ: -23.15, maxZ: 23.75 };

function insidePavilion(x: number, z: number): boolean {
  return Math.abs(x) < 24.35 && z > 8.20;
}

function blocksDeckWalking(x: number, z: number, foot: number): boolean {
  if (insidePavilion(x, z)) return true;
  return foot < DECK_LEVEL + 1.08 && OVERLOOK_DECK_OBSTACLES.some(
    box => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ,
  );
}

export async function loadOverlookScene(): Promise<OverlookScene> {
  const heightAt = await loadOverlookTerrain();
  const atmosphere = createCoastAtmosphere(DAY_SUN, { nightHorizon: 0x303848, starVisibility: 0.42,
    aerialDistanceScale: 0.19, moonDirection: new THREE.Vector3(0.43, 0.33, -0.84).normalize() });
  const sky = createCoastSky(atmosphere);
  sky.clouds.scale.setScalar(2.70);
  sky.clouds.position.y = 425;

  const streets = createOverlookCityGround();
  const city = createOverlookCity(heightAt, { sunDirection: DAY_SUN, dayHaze: 0xa1b5be, nightHaze: 0x2b3340 });
  const ground = createOverlookSurface(heightAt, streets, atmosphere.night);
  const deck = createOverlookDeck();
  const scene = new THREE.Scene();
  scene.add(sky.dome, sky.clouds, ground, deck.group, city.group, createOverlookHillside(heightAt));
  const lighting = createCoastLighting(scene, atmosphere, heightAt);
  await Promise.all([streets.ready, city.ready]);

  return {
    navigation: {
      bounds, spawn: EXPLORATION_WORLDS[1].places[0], groundHeight: () => DECK_LEVEL,
      flightCeiling: DECK_LEVEL + 105, blocksWalking: blocksDeckWalking, blocksFlight: insidePavilion,
    },
    world: {
      scene,
      setQuality(quality: CoastQuality) {
        lighting.setQuality(quality);
        city.setQuality(quality);
      },
      setTimeOfDay(time: CoastTimeOfDay) {
        atmosphere.setTimeOfDay(time);
        sky.setTimeOfDay(time);
        lighting.setTimeOfDay(time);
        city.setTimeOfDay(time);
        deck.setTimeOfDay(time);
      },
      update(elapsed: number, camera: THREE.PerspectiveCamera) {
        lighting.update(elapsed, camera);
        return [];
      },
      dispose() {
        sky.dispose();
        lighting.dispose();
        atmosphere.sky.value.dispose();
        streets.texture.dispose();
      },
    },
  };
}
