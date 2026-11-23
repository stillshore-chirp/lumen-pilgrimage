import * as THREE from 'three';
import type { CoastQuality } from '../../CoastWorld';
import { createCoastAtmosphere, type CoastTimeOfDay } from '../coastAtmosphere';
import { createCoastSky } from '../coastSky';
import { createAirTraffic, type AirTrafficRoute } from '../overlook/overlookAirTraffic';
import { createOverlookCity, createOverlookCityGround } from '../overlook/overlookCity';
import { createOverlookSurface, loadOverlookTerrain } from '../overlook/overlookTerrain';
import { isOverlookRoadway } from '../overlook/overlookTraffic';
import {
  RESIDENCE_DAY_HAZE, RESIDENCE_NIGHT_HAZE, RESIDENCE_SUN,
} from './residenceCityMaterials';
import {
  RESIDENCE_AXIAL_CORRIDORS, RESIDENCE_DISTRICT_AREAS, RESIDENCE_REGIONAL_ORIGIN, RESIDENCE_STREET_LEVEL, type CityRect,
} from './residenceCityPlan';
import { createResidenceBlocks } from './residenceDistrictGround';
import { createResidenceNeighborhood } from './residenceNeighborhood';
import { createResidenceStreetTraffic } from './residenceStreetTraffic';

// The two southern passes run in opposite directions. A third passes east of the balcony.
// Keep them in residence coordinates so the surveyed ground's reflection does not mirror the aircraft.
const residenceFlights = [
  { centerX: 650, centerZ: 15800, eastRadius: 9650, northRadius: 6200, altitude: 1190, phase: -1.83, rate: 0.013, scale: 0.90 },
  { centerX: -1550, centerZ: 24000, eastRadius: 10300, northRadius: 8800, altitude: 2400, phase: -0.99, rate: -0.011, scale: 1.08 },
  { centerX: 21500, centerZ: -2200, eastRadius: 8250, northRadius: 9300, altitude: 1680, phase: 2.79, rate: 0.013, scale: 0.96 },
] satisfies readonly AirTrafficRoute[];

function distanceFromNeighborhood(x: number, z: number, areas: readonly CityRect[]): number {
  const east = x - RESIDENCE_REGIONAL_ORIGIN.x;
  const south = RESIDENCE_REGIONAL_ORIGIN.z - z;
  let distance = Infinity;
  for (const { minX, maxX, minZ, maxZ } of areas) {
    distance = Math.min(distance, Math.hypot(Math.max(0, minX - east, east - maxX), Math.max(0, minZ - south, south - maxZ)));
  }
  return distance;
}

function excludeRegionalFootprint(x: number, z: number, padding: number): boolean {
  return distanceFromNeighborhood(x, z, RESIDENCE_DISTRICT_AREAS) <= padding + 26
    || distanceFromNeighborhood(x, z, RESIDENCE_AXIAL_CORRIDORS) <= padding + 31
    || isOverlookRoadway(x, z, padding);
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
    const transition = THREE.MathUtils.smoothstep(distanceFromNeighborhood(x, z, RESIDENCE_DISTRICT_AREAS), 333, 480);
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
    nearCityNightView: true,
    blocksFootprint: excludeRegionalFootprint,
  });
  const terrain = createOverlookSurface(heightAt, streets, atmosphere.night);
  terrain.castShadow = terrain.receiveShadow = false;
  const loaded = await Promise.allSettled([streets.ready, basin.ready]);
  for (const result of loaded) {
    if (result.status === 'rejected') {
      sky.dispose();
      streets.texture.dispose();
      atmosphere.sky.value.dispose();
      disposeDrawables(terrain);
      disposeDrawables(basin.group);
      throw result.reason;
    }
  }
  const neighborhood = createResidenceNeighborhood(atmosphere.night, createResidenceBlocks());
  const groundMaterial = terrain.material as THREE.MeshStandardMaterial;
  const streetCoverage = groundMaterial.onBeforeCompile;
  groundMaterial.onBeforeCompile = (shader, renderer) => {
    streetCoverage(shader, renderer);
    shader.uniforms.uResidenceDayHaze = { value: RESIDENCE_DAY_HAZE };
    shader.uniforms.uResidenceNightHaze = { value: RESIDENCE_NIGHT_HAZE };
    shader.uniforms.uResidenceOrigin = { value: new THREE.Vector2(origin.x, origin.z) };
    shader.uniforms.uResidenceBounds = { value: neighborhood.shade.bounds };
    shader.uniforms.uResidenceDistrictAreas = { value: RESIDENCE_DISTRICT_AREAS.map(({ minX, minZ, maxX, maxZ }) =>
      new THREE.Vector4(minX, minZ, maxX, maxZ)) };
    shader.uniforms.uResidenceShade = { value: neighborhood.shade.texture };
    shader.uniforms.uResidenceSurface = { value: neighborhood.surface };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uResidenceDayHaze, uResidenceNightHaze;
        uniform vec2 uResidenceOrigin;
        uniform vec4 uResidenceBounds;
        uniform vec4 uResidenceDistrictAreas[${RESIDENCE_DISTRICT_AREAS.length}];
        uniform sampler2D uResidenceShade, uResidenceSurface;
      `)
      .replace('#include <opaque_fragment>', `
        vec2 district = (vHillPoint.xz - uResidenceOrigin) * vec2(1.0, -1.0);
        vec2 localUv = (district - uResidenceBounds.xy) / uResidenceBounds.zw;
        float districtDistance = 43500.0;
        for (int area = 0; area < ${RESIDENCE_DISTRICT_AREAS.length}; area++) {
          vec4 bounds = uResidenceDistrictAreas[area];
          vec2 outside = max(max(bounds.xy - district, district - bounds.zw), vec2(0.0));
          districtDistance = min(districtDistance, length(outside));
        }
        float nearDistrict = 1.0 - smoothstep(4.0, 111.0, districtDistance);
        vec4 surface = texture2D(uResidenceSurface, district * 0.031);
        vec2 shade = texture2D(uResidenceShade, localUv).rg;
        float inner = 1.0 - step(0.001, districtDistance);
        float fabric = smoothstep(0.32, 0.71, surface.r * 0.65 + surface.g * 0.35);
        vec3 gravel = mix(vec3(0.125, 0.119, 0.109), vec3(0.195, 0.180, 0.155), fabric);
        gravel *= (0.91 + surface.b * 0.15) * (1.0 - inner * (smoothstep(0.007, 0.020, shade.r) * 0.44 + shade.g * 0.14));
        float air = exp(-length(vViewPosition) * 0.000073);
        vec3 groundDay = mix(diffuseColor.rgb * vec3(0.82, 0.85, 0.89), gravel, nearDistrict);
        vec3 sharedNight = diffuseColor.rgb * vec3(0.05, 0.06, 0.084) + totalEmissiveRadiance * 0.6;
        vec3 groundNight = mix(sharedNight, gravel * vec3(0.096, 0.115, 0.16), nearDistrict);
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

  const traffic = createResidenceStreetTraffic(atmosphere.night);
  const airTraffic = createAirTraffic(residenceFlights);
  const group = new THREE.Group();
  group.name = 'Downtown at the residence';
  group.add(sky.dome, sky.clouds, region, neighborhood.group, traffic.group, airTraffic.group);
  function dispose(): void {
    sky.dispose();
    streets.texture.dispose();
    atmosphere.sky.value.dispose();
    neighborhood.dispose();
    airTraffic.dispose();
    for (const part of [region, neighborhood.group, traffic.group]) disposeDrawables(part);
  }
  let elapsed = 0;
  function setTimeOfDay(time: CoastTimeOfDay): void {
    const night = time === 'night';
    atmosphere.setTimeOfDay(time);
    sky.setTimeOfDay(time);
    basin.setTimeOfDay(time);
    airTraffic.setTimeOfDay(time);
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
      airTraffic.update(time);
    },
    dispose,
  };
}
