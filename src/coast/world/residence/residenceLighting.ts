import * as THREE from 'three';
import type { CoastQuality } from '../../CoastWorld';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { RESIDENCE_SUN } from './residenceCityMaterials';
import { bedroomCoves, corridorFootlights, createResidenceLightField, diningPendants, fabricLamps, hallCoves,
  livingCoves, residenceFieldExtent, residenceFieldOrigin, serviceDownlights } from './residenceLightField';
import type { ResidenceMaterials } from './residenceMaterials';
import type { ResidenceRect } from './residencePlan';

function createLuminaires(trim: THREE.Material, darkMetal: THREE.Material) {
  const group = new THREE.Group();
  group.name = '50F concealed coves, guide lights and recessed downlights';
  const opal = new THREE.MeshBasicMaterial({ name: 'Warm white architectural diffuser', color: 0xb9b1a2 });
  const geometries: THREE.BufferGeometry[] = [];
  function place(geometry: THREE.BufferGeometry, material: THREE.Material, east: number, height: number, north: number) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(east, height, -north);
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.push(geometry);
  }
  const coves = [...livingCoves, ...Object.values(bedroomCoves), ...Object.values(hallCoves)];
  for (const { span: [west, south, east, north], height, mount } of coves) {
    const width = east - west;
    const depth = north - south;
    const centerEast = (west + east) / 2;
    const centerNorth = (south + north) / 2;
    const wallEast = mount === 'west' ? -.076 : 0;
    const wallNorth = mount === 'north' ? .076 : mount === 'south' ? -.076 : 0;
    place(new THREE.BoxGeometry(width + (wallEast ? .216 : .10), .045, depth + (wallNorth ? .216 : .10)),
      trim, centerEast + wallEast, height, centerNorth + wallNorth);
    place(new THREE.BoxGeometry(width + .04, .011, depth + .04), opal, centerEast, height + .026, centerNorth);
  }
  for (const [room, sources] of Object.entries(corridorFootlights)) {
    for (const { span: [east, north], height } of sources) {
      const alongEast = room === 'H1' || room === 'H2';
      place(new THREE.BoxGeometry(alongEast ? .112 : .025, .042, alongEast ? .025 : .112),
        darkMetal, east, height, north);
      place(new THREE.BoxGeometry(alongEast ? .079 : .026, .019, alongEast ? .026 : .079),
        opal, east, height, north);
    }
  }
  for (const sources of Object.values(serviceDownlights)) {
    for (const { span: [east, north], height } of sources) {
      place(new THREE.CylinderGeometry(.063, .063, .018, 20), darkMetal, east, height - .008, north);
      place(new THREE.CylinderGeometry(.045, .045, .007, 20), opal, east, height - .018, north);
    }
  }
  return {
    group,
    setTimeOfDay(time: CoastTimeOfDay) {
      opal.color.setHex(time === 'night' ? 0xffd5a4 : 0xb9b1a2);
    },
    dispose() {
      geometries.forEach(geometry => geometry.dispose());
      opal.dispose();
    },
  };
}

function diningSpot(east: number): THREE.SpotLight {
  const light = new THREE.SpotLight(0xffd9b1, 3.8, 3.6, .66, .61, 2);
  light.name = '50F dining pendant, downlight and furniture shadows';
  light.position.set(east, diningPendants.height - .058, -diningPendants.north);
  light.target.position.set(east, .74, -diningPendants.north);
  light.visible = false;
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = .13;
  light.shadow.bias = -.00035;
  light.shadow.normalBias = .012;
  light.shadow.radius = 1.5;
  light.shadow.intensity = .88;
  light.shadow.autoUpdate = false;
  return light;
}

function resizeShadow(shadow: THREE.LightShadow, size: number): void {
  if (shadow.mapSize.x === size) return;
  shadow.mapSize.set(size, size);
  shadow.map?.dispose();
  shadow.map = null;
  shadow.needsUpdate = true;
}

export function createResidenceLighting(scene: THREE.Scene, materials: ResidenceMaterials,
  furnitureObstacles: readonly ResidenceRect[] = []) {
  const field = createResidenceLightField(furnitureObstacles);
  const nightAmount = { value: 0 };
  const daylight = new THREE.DirectionalLight(0xffead6, 2.72);
  daylight.name = 'Southwest daylight through the glazing';
  daylight.target.position.set(11.4, 0, -8.1);
  daylight.position.copy(daylight.target.position).addScaledVector(RESIDENCE_SUN, 32);
  daylight.castShadow = true;
  const camera = daylight.shadow.camera;
  camera.left = camera.bottom = -18;
  camera.right = camera.top = 18;
  camera.near = 6;
  camera.far = 56;
  camera.updateProjectionMatrix();
  daylight.shadow.mapSize.set(1024, 1024);
  daylight.shadow.bias = -.00016;
  daylight.shadow.normalBias = .019;
  daylight.shadow.radius = 1.5;
  daylight.shadow.autoUpdate = false;
  daylight.shadow.needsUpdate = true;
  const dining = diningPendants.east.map(diningSpot);
  const diningObjects = dining.flatMap(light => [light, light.target]);
  const lampCenters = fabricLamps.map(({ east, north, base, height }) =>
    new THREE.Vector4(east, base + .79 * height, -north, .255 * height));
  const luminaires = createLuminaires(materials.trim, materials.darkMetal);
  const patched = new WeakSet<THREE.Material>();

  function bind(material: THREE.Material): void {
    if (!(material instanceof THREE.MeshStandardMaterial) || material.transparent || patched.has(material)) return;
    patched.add(material);
    const before = material.onBeforeCompile.bind(material);
    const cacheKey = material.customProgramCacheKey();
    const clothShade = material === materials.fabric;
    material.customProgramCacheKey = () => `${cacheKey}|residence-light-field|${clothShade}`;
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      shader.uniforms.residenceLightVolume = { value: field.diffuse };
      shader.uniforms.residenceAccentVolume = { value: field.accent };
      shader.uniforms.residenceFieldOrigin = { value: residenceFieldOrigin };
      shader.uniforms.residenceFieldExtent = { value: residenceFieldExtent };
      shader.uniforms.residenceNight = nightAmount;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        varying vec3 vResidenceWorld;`).replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 residenceWorld = vec4(transformed, 1.0);
        #ifdef USE_BATCHING
          residenceWorld = batchingMatrix * residenceWorld;
        #endif
        #ifdef USE_INSTANCING
          residenceWorld = instanceMatrix * residenceWorld;
        #endif
        vResidenceWorld = (modelMatrix * residenceWorld).xyz;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vResidenceWorld;
        uniform highp sampler3D residenceLightVolume;
        uniform highp sampler3D residenceAccentVolume;
        uniform vec3 residenceFieldOrigin;
        uniform vec3 residenceFieldExtent;
        uniform float residenceNight;`).replace('#include <lights_fragment_end>', `
        vec3 roomNormal = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
        vec3 roomPoint = vResidenceWorld + roomNormal * 0.092;
        vec3 fieldUV = clamp((vec3(roomPoint.x, -roomPoint.z, roomPoint.y) - residenceFieldOrigin) / residenceFieldExtent, 0.0, 1.0);
        vec4 probe = texture(residenceLightVolume, fieldUV);
        float orientation = 0.82 + 0.18 * max(0.0, max(roomNormal.y, max(roomNormal.x, roomNormal.z)));
        vec3 daytime = vec3(0.96, 0.986, 1.0) * (2.6 * probe.r * orientation);
        float warmBounce = 2.1 * probe.g;
        vec3 bouncedColor = mix(vec3(0.92, 0.90, 0.84), vec3(1.0, 0.78, 0.56),
          smoothstep(0.33, 1.26, warmBounce));
        vec3 evening = bouncedColor * warmBounce * (0.82 + 0.18 * abs(roomNormal.y))
          + vec3(1.0, 0.83, 0.65) * (1.30 * probe.b)
          + vec3(0.42, 0.57, 0.90) * (0.51 * probe.r * probe.r + 0.062 * probe.r);
        vec3 roomIrradiance = mix(daytime, evening, residenceNight) * probe.a;
        irradiance += roomIrradiance;
        radiance += roomIrradiance * mix(0.13, 0.092, residenceNight);
        if (residenceNight > 0.5) {
          // Room-local direction and falloff feed the Standard BRDF, including its normal-map and specular response.
          vec4 accent = texture(residenceAccentVolume, fieldUV);
          vec3 sourceDirection = accent.rgb - vec3(0.5);
          if (accent.a > 0.005 && dot(sourceDirection, sourceDirection) > 0.00001) {
            IncidentLight lamp;
            lamp.color = vec3(1.0, 0.71, 0.44) * (2.6 * accent.a * probe.a);
            lamp.direction = transformDirection(sourceDirection, viewMatrix);
            lamp.visible = true;
            RE_Direct(lamp, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal,
              material, reflectedLight);
          }
        }
        #include <lights_fragment_end>`);
      if (clothShade) {
        shader.uniforms.residenceFabricLamp = { value: lampCenters };
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_pars_fragment>', `
          #include <emissivemap_pars_fragment>
          uniform vec4 residenceFabricLamp[${lampCenters.length}];`).replace('#include <emissivemap_fragment>', `
          #include <emissivemap_fragment>
          if (residenceNight > 0.5) {
            float transmitted = 0.0;
            for (int i = 0; i < ${lampCenters.length}; i++) {
              vec4 source = residenceFabricLamp[i];
              vec3 delta = vResidenceWorld - source.xyz;
              float radius = length(delta.xz);
              float within = (1.0 - smoothstep(0.126, 0.151, radius))
                * (1.0 - smoothstep(source.w, source.w + 0.018, abs(delta.y)));
              float shadeTaper = smoothstep(-source.w, source.w, delta.y);
              transmitted = max(transmitted, within * mix(1.0, 0.42, shadeTaper));
            }
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.75, 0.51) * (transmitted * 0.84);
          }`);
      }
    };
    material.needsUpdate = true;
  }

  function attachInterior(...groups: THREE.Object3D[]): void {
    for (const group of groups) group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (Array.isArray(object.material)) object.material.forEach(bind);
      else bind(object.material);
    });
  }

  for (const material of Object.values(materials)) {
    if (material instanceof THREE.Material) bind(material);
  }
  attachInterior(luminaires.group);
  scene.add(daylight, daylight.target, luminaires.group, ...diningObjects);
  return {
    attachInterior,
    invalidateShadows() {
      if (daylight.castShadow) daylight.shadow.needsUpdate = true;
    },
    setQuality(quality: CoastQuality) {
      resizeShadow(daylight.shadow, quality === 'high' ? 2048 : 1024);
      for (const lamp of dining) resizeShadow(lamp.shadow, quality === 'high' ? 1024 : 512);
    },
    setTimeOfDay(time: CoastTimeOfDay) {
      const night = time === 'night';
      if (nightAmount.value === Number(night)) return;
      nightAmount.value = Number(night);
      daylight.intensity = night ? 0 : 2.72;
      daylight.castShadow = !night;
      daylight.shadow.needsUpdate = !night;
      for (const lamp of dining) {
        lamp.visible = night;
        lamp.shadow.needsUpdate = night;
      }
      materials.lamp.emissiveIntensity = night ? 0.70 : 0.10;
      materials.glass.opacity = night ? 0.057 : 0.092;
      materials.guard.opacity = night ? 0.088 : 0.122;
      luminaires.setTimeOfDay(time);
    },
    dispose() {
      scene.remove(daylight, daylight.target, luminaires.group, ...diningObjects);
      daylight.shadow.dispose();
      for (const lamp of dining) lamp.shadow.dispose();
      field.diffuse.dispose();
      field.accent.dispose();
      luminaires.dispose();
    },
  };
}
