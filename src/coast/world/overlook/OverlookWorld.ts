import * as THREE from 'three';
import type { ExplorationScene } from '../../CoastApp';
import { EXPLORATION_WORLDS } from '../../coastDestinations';
import type { CoastQuality } from '../../CoastWorld';
import { createCoastAtmosphere, type CoastTimeOfDay } from '../coastAtmosphere';
import { createCoastLighting } from '../coastLighting';
import { createCoastSky } from '../coastSky';
import { createOverlookAirTraffic } from './overlookAirTraffic';
import { OverlookAudio } from './overlookAudio';
import { createOverlookCity, createOverlookCityGround } from './overlookCity';
import { createOverlookDeck, OVERLOOK_DECK_OBSTACLES } from './overlookDeck';
import { createOverlookHillside } from './overlookHillside';
import { createOverlookSurface, DECK_LEVEL, loadOverlookTerrain } from './overlookTerrain';
import { createOverlookTraffic, isOverlookRoadway } from './overlookTraffic';
import { blocksUpperDeckWalking, isUpperDeck, overlookDeckGround } from './overlookUpperDeck';

const DAY_SUN = new THREE.Vector3(-0.66, 0.51, -0.55).normalize();
const bounds = { minX: -34.35, maxX: 34.35, minZ: -23.15, maxZ: 23.75 };

function insidePavilion(x: number, z: number): boolean {
  return Math.abs(x) < 24.35 && z > 8.20 && !isUpperDeck(x, z);
}

function blocksDeckWalking(x: number, z: number, foot: number): boolean {
  if (insidePavilion(x, z) || blocksUpperDeckWalking(x, z, foot)) return true;
  return foot < DECK_LEVEL + 1.08 && OVERLOOK_DECK_OBSTACLES.some(
    box => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ,
  );
}

export async function loadOverlookScene(): Promise<ExplorationScene> {
  const heightAt = await loadOverlookTerrain();
  const atmosphere = createCoastAtmosphere(DAY_SUN, {
    nightHorizon: 0x1b2330,
    nightZenith: 0x141824,
    nightGlow: { color: 0x100e0d, direction: new THREE.Vector3(0.16, 0, -0.987) },
    starVisibility: 0.085,
    aerialDistanceScale: 0.22,
    moonDirection: new THREE.Vector3(-0.77, 0.48, -0.42),
  });
  const sky = createCoastSky(atmosphere, 0.10);
  sky.clouds.scale.setScalar(2.70);
  sky.clouds.position.y = 425;

  const streets = createOverlookCityGround();
  const traffic = createOverlookTraffic(heightAt);
  const airTraffic = createOverlookAirTraffic();
  const city = createOverlookCity(heightAt, {
    sunDirection: DAY_SUN, dayHaze: 0xaebbc1, nightHaze: 0x272c35, blocksFootprint: isOverlookRoadway,
  });
  const high = { value: 0 };
  const ground = createOverlookSurface(heightAt, streets, atmosphere.night, high);
  const deck = createOverlookDeck(high, atmosphere.night);
  const scene = new THREE.Scene();
  scene.add(sky.dome, sky.clouds, ground, deck.group, city.group, traffic.group, airTraffic.group, createOverlookHillside(heightAt));
  const lighting = createCoastLighting(scene, atmosphere, heightAt, { nightIntensityScale: 0.28 });
  await Promise.all([streets.ready, city.ready]);

  return {
    id: 'overlook',
    audio: new OverlookAudio(traffic.soundCorridors, heightAt),
    navigation: {
      bounds, spawn: EXPLORATION_WORLDS[1].places[0], groundHeight: overlookDeckGround,
      flightCeiling: DECK_LEVEL + 105, blocksWalking: blocksDeckWalking, blocksFlight: insidePavilion,
    },
    world: {
      scene,
      setQuality(quality: CoastQuality) {
        high.value = Number(quality === 'high');
        deck.setQuality(high.value === 1);
        lighting.setQuality(quality);
        city.setQuality(quality);
        traffic.setQuality(quality);
      },
      setTimeOfDay(time: CoastTimeOfDay) {
        atmosphere.setTimeOfDay(time);
        sky.setTimeOfDay(time);
        lighting.setTimeOfDay(time);
        city.setTimeOfDay(time);
        deck.setTimeOfDay(time);
        traffic.setTimeOfDay(time);
        airTraffic.setTimeOfDay(time);
      },
      update(elapsed: number, camera: THREE.PerspectiveCamera) {
        lighting.update(elapsed, camera);
        traffic.update(elapsed);
        airTraffic.update(elapsed);
        return [];
      },
      dispose() {
        sky.dispose();
        lighting.dispose();
        deck.dispose();
        traffic.dispose();
        airTraffic.dispose();
        atmosphere.sky.value.dispose();
        streets.texture.dispose();
      },
    },
  };
}
