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
import { createOverlookCorridorPlan, createOverlookRoadDatum } from './overlookCorridorPlan';
import { createOverlookEarthworks } from './overlookEarthworks';
import { createOverlookRoadStructures } from './overlookRoadStructures';
import { blocksPavilionFlight } from './overlookPavilionPlan';
import { createOverlookSurface, DECK_LEVEL, gradeOverlookView, loadOverlookSurvey, OVERLOOK_SURFACE_BOUNDS } from './overlookTerrain';
import { createOverlookTraffic } from './overlookTraffic';
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
  const survey = await loadOverlookSurvey();
  const heightAt = (x: number, z: number) => gradeOverlookView(x, z, survey(x, z));
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
  const high = { value: 0 };
  const ground = createOverlookSurface(heightAt, streets, atmosphere.night, high);
  const originalSurfaceHeight = (x: number, z: number): number => {
    const y = ground.sampleHeight(x, z);
    if (y === undefined) throw new Error('The overlook placement is outside the rendered terrain.');
    return y;
  };
  const corridors = createOverlookCorridorPlan(createOverlookRoadDatum(survey), originalSurfaceHeight, OVERLOOK_SURFACE_BOUNDS);
  const earthworks = createOverlookEarthworks(ground.group, ground.sampleHeight, corridors, ground.material);
  const surfaceHeight = (x: number, z: number): number => {
    const y = earthworks.sampleHeight(x, z);
    if (y === undefined) throw new Error('The overlook support is outside the rendered field.');
    return y;
  };
  const traffic = createOverlookTraffic(surfaceHeight, corridors);
  const roadStructures = createOverlookRoadStructures(corridors);
  const airTraffic = createOverlookAirTraffic();
  const terrainBounds = OVERLOOK_SURFACE_BOUNDS;
  const city = createOverlookCity(surfaceHeight, {
    sunDirection: DAY_SUN, dayHaze: 0xaebbc1, nightHaze: 0x272c35,
    blocksFootprint: (x, z, padding) => x - padding < terrainBounds.minX || x + padding > terrainBounds.maxX
      || z - padding < terrainBounds.minZ || z + padding > terrainBounds.maxZ || corridors.isRoadway(x, z, padding),
  });
  const deck = createOverlookDeck(high, atmosphere.night);
  const scene = new THREE.Scene();
  scene.add(sky.dome, sky.clouds, ground.group, earthworks.group, roadStructures.group, deck.group, city.group, traffic.group, airTraffic.group,
    createOverlookHillside(heightAt, earthworks.sampleHeight));
  const lighting = createCoastLighting(scene, atmosphere, heightAt, {
    nightIntensityScale: 0.28, receiverPlaneShadowMaterials: deck.receiverPlaneShadowMaterials,
    receiverPlaneShadowDomains: deck.receiverPlaneShadowDomains,
  });
  await Promise.all([streets.ready, city.ready]);

  return {
    id: 'overlook',
    audio: new OverlookAudio(traffic.soundCorridors, surfaceHeight, earthworks.sampleHeight),
    navigation: {
      bounds, spawn: EXPLORATION_WORLDS[1].places[0], groundHeight: overlookDeckGround,
      flightCeiling: DECK_LEVEL + 105, blocksWalking: blocksDeckWalking,
      blocksFlight: (x, z, eyeY, clearance) => blocksPavilionFlight(x, z, eyeY - DECK_LEVEL, clearance),
    },
    world: {
      scene,
      get artificialLightingMode() { return deck.artificialLightingMode; },
      setArtificialLightingMode: deck.setArtificialLightingMode,
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
        deck.applyLamps();
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
        earthworks.dispose();
        roadStructures.dispose();
        ground.dispose();
        traffic.dispose();
        airTraffic.dispose();
        atmosphere.sky.value.dispose();
        streets.texture.dispose();
      },
    },
  };
}
