import * as THREE from 'three';
import type { CoastQuality } from '../../CoastWorld';
import { createCoastAtmosphere, type CoastTimeOfDay } from '../coastAtmosphere';
import { createCoastSky } from '../coastSky';
import { createOverlookCity, createOverlookCityGround } from '../overlook/overlookCity';
import { createOverlookSurface, loadOverlookTerrain } from '../overlook/overlookTerrain';
import { isOverlookRoadway } from '../overlook/overlookTraffic';
import {
  RESIDENCE_DAY_HAZE, RESIDENCE_NIGHT_HAZE, RESIDENCE_SUN,
} from './residenceCityMaterials';
import {
  RESIDENCE_CITY_AREAS, RESIDENCE_REGIONAL_ORIGIN, RESIDENCE_STREET_LEVEL,
} from './residenceCityPlan';
import { createResidenceNeighborhood } from './residenceNeighborhood';
import { createResidenceStreetTraffic } from './residenceStreetTraffic';

function distanceFromNeighborhood(x: number, z: number): number {
  const east = x - RESIDENCE_REGIONAL_ORIGIN.x;
  const south = RESIDENCE_REGIONAL_ORIGIN.z - z;
  let distance = Infinity;
  for (const { minX, maxX, minZ, maxZ } of RESIDENCE_CITY_AREAS) {
    const dx = Math.max(0, minX - east, east - maxX), dz = Math.max(0, minZ - south, south - maxZ);
    distance = Math.min(distance, Math.hypot(dx, dz));
  }
  return distance;
}

function excludeRegionalFootprint(x: number, z: number, padding: number): boolean {
  return distanceFromNeighborhood(x, z) <= padding || isOverlookRoadway(x, z, padding);
}

function disposeDrawables(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return;
    geometries.add(object.geometry);
    if (Array.isArray(object.material)) {
      for (const material of object.material) materials.add(material);
    } else {
      materials.add(object.material);
    }
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

export async function createResidenceCity() {
  const survey = await loadOverlookTerrain();
  const origin = RESIDENCE_REGIONAL_ORIGIN;
  const grade = survey(origin.x, origin.z);
  const heightAt = (x: number, z: number) => {
    // Adjacent terrain vertices are at most 235 m apart here. Extend the level district
    // below its streets before rejoining the measured surface, including at patch corners.
    const transition = THREE.MathUtils.smoothstep(distanceFromNeighborhood(x, z), 333, 480);
    return THREE.MathUtils.lerp(grade - 0.38, survey(x, z), transition);
  };

  const atmosphere = createCoastAtmosphere(RESIDENCE_SUN, {
    nightHorizon: 0x252b38, nightZenith: 0x111924,
    nightGlow: { color: 0x181006, direction: new THREE.Vector3(0.18, 0, 0.98) },
    starVisibility: 0.040, moonDirection: new THREE.Vector3(-0.77, 0.48, 0.42),
  });
  const sky = createCoastSky(atmosphere, 0.08);
  sky.clouds.scale.setScalar(5.2);
  sky.clouds.position.y = 650;
  const streets = createOverlookCityGround();
  const basin = createOverlookCity(heightAt, {
    sunDirection: new THREE.Vector3(RESIDENCE_SUN.x, RESIDENCE_SUN.y, -RESIDENCE_SUN.z),
    dayHaze: RESIDENCE_DAY_HAZE, nightHaze: RESIDENCE_NIGHT_HAZE,
    blocksFootprint: excludeRegionalFootprint,
  });
  const terrain = createOverlookSurface(heightAt, streets, atmosphere.night);
  terrain.castShadow = terrain.receiveShadow = false;
  const groundMaterial = terrain.material as THREE.MeshStandardMaterial;
  const streetCoverage = groundMaterial.onBeforeCompile;
  groundMaterial.onBeforeCompile = (shader, renderer) => {
    streetCoverage(shader, renderer);
    shader.uniforms.uResidenceDayHaze = { value: RESIDENCE_DAY_HAZE };
    shader.uniforms.uResidenceNightHaze = { value: RESIDENCE_NIGHT_HAZE };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uResidenceDayHaze, uResidenceNightHaze;')
      .replace('#include <opaque_fragment>', `
        float air = exp(-length(vViewPosition) * 0.000073);
        vec3 groundDay = diffuseColor.rgb * vec3(0.82, 0.85, 0.89);
        vec3 groundNight = diffuseColor.rgb * vec3(0.05, 0.06, 0.084) + totalEmissiveRadiance * 0.6;
        outgoingLight = mix(mix(uResidenceDayHaze, uResidenceNightHaze, uHillNight), mix(groundDay, groundNight, uHillNight), air);
        #include <opaque_fragment>
      `);
  };
  groundMaterial.customProgramCacheKey = () => 'residence-regional-streets';

  const region = new THREE.Group();
  region.name = 'Surveyed hills and shared downtown skyline';
  region.position.set(-origin.x, RESIDENCE_STREET_LEVEL - grade, origin.z);
  region.scale.z = -1;
  region.add(terrain, basin.group);

  const neighborhood = createResidenceNeighborhood(atmosphere.night);
  const traffic = createResidenceStreetTraffic(atmosphere.night);
  const group = new THREE.Group();
  group.name = 'Downtown at the residence';
  group.add(sky.dome, sky.clouds, region, neighborhood.group, traffic.group);
  function dispose(): void {
    sky.dispose();
    streets.texture.dispose();
    atmosphere.sky.value.dispose();
    neighborhood.dispose();
    for (const part of [region, neighborhood.group, traffic.group]) disposeDrawables(part);
  }
  const loaded = await Promise.allSettled([streets.ready, basin.ready]);
  for (const result of loaded) {
    if (result.status === 'rejected') {
      dispose();
      throw result.reason;
    }
  }

  let elapsed = 0;
  function setTimeOfDay(time: CoastTimeOfDay): void {
    const night = time === 'night';
    atmosphere.setTimeOfDay(time);
    sky.setTimeOfDay(time);
    basin.setTimeOfDay(time);
    neighborhood.setNight(night);
    traffic.setNight(night);
    traffic.update(elapsed);
  }
  function setQuality(quality: CoastQuality): void {
    basin.setQuality(quality);
    neighborhood.setQuality(quality === 'high');
  }

  setTimeOfDay('day');
  setQuality('light');
  return {
    group,
    setTimeOfDay,
    setQuality,
    update(time: number, _camera?: THREE.PerspectiveCamera) {
      elapsed = time;
      traffic.update(time);
    },
    dispose,
  };
}
