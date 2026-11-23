import * as THREE from 'three';
import { createResidenceContactMap } from './residenceContactMap';
import type { CoastQuality } from '../../CoastWorld';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { RESIDENCE_SUN } from './residenceCityMaterials';
import { bedroomCoves, corridorFootlights, createResidenceLightField, diningPendants, fabricLamps, hallCoves,
  livingCoves, residenceFieldExtent, residenceFieldOrigin, serviceDownlights } from './residenceLightField';
import type { ResidenceMaterials } from './residenceMaterials';
import type { ResidenceRect } from './residencePlan';

function createLuminaires(plaster: THREE.Material, darkMetal: THREE.Material) {
  const group = new THREE.Group();
  group.name = 'Concealed coves, guide lights and recessed downlights';
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
    place(new THREE.BoxGeometry(width + (wallEast ? .216 : .10), .040, depth + (wallNorth ? .216 : .10)),
      plaster, centerEast + wallEast, height, centerNorth + wallNorth);
    place(new THREE.BoxGeometry(width + .04, .009, depth + .04), opal, centerEast, height + .026, centerNorth);
    place(new THREE.BoxGeometry(width + .04, .031, depth + .04), plaster,
      centerEast - wallEast * .53, height + .016, centerNorth - wallNorth * .53);
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
      place(new THREE.CylinderGeometry(.052, .064, .015, 28), plaster, east, height - .007, north);
      place(new THREE.CylinderGeometry(.046, .052, .009, 28), darkMetal, east, height - .016, north);
      place(new THREE.CylinderGeometry(.031, .038, .004, 24), opal, east, height - .021, north);
    }
  }
  return {
    group,
    setTimeOfDay(time: CoastTimeOfDay) {
      opal.color.setHex(time === 'night' ? 0xffdcb6 : 0xb9b1a2).multiplyScalar(time === 'night' ? 2.8 : 1);
    },
    dispose() {
      geometries.forEach(geometry => geometry.dispose());
      opal.dispose();
    },
  };
}

function diningSpot(east: number): THREE.SpotLight {
  const light = new THREE.SpotLight(0xffd6a5, 4.3, 4.2, .73, .78, 2);
  light.name = 'Dining pendant direct light';
  light.position.set(east, diningPendants.height - .058, -diningPendants.north);
  light.target.position.set(east, .74, -diningPendants.north);
  light.visible = false;
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = .13;
  light.shadow.bias = -.00035;
  light.shadow.normalBias = .012;
  light.shadow.radius = 3.0;
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
  const contactEnabled = { value: 0 };
  const contactMap: { value: THREE.DataTexture | null } = { value: null };
  let furnitureGroup: THREE.Object3D;
  const sunPower = 2.35;
  const daylight = new THREE.DirectionalLight(0xffe7d0, sunPower);
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
  daylight.shadow.normalBias = .016;
  daylight.shadow.radius = 2.35;
  daylight.shadow.intensity = .92;
  daylight.shadow.autoUpdate = false;
  daylight.shadow.needsUpdate = true;
  const dining = diningPendants.east.map(diningSpot);
  const diningObjects = dining.flatMap(light => [light, light.target]);
  const lampCenters = fabricLamps.map(({ east, north, base, height }) =>
    new THREE.Vector4(east, base + .79 * height, -north, .255 * height));
  const luminaires = createLuminaires(materials.ceiling, materials.darkMetal);
  const patched = new WeakSet<THREE.Material>();

  function bind(material: THREE.Material): void {
    if (!(material instanceof THREE.MeshStandardMaterial) || material.transparent || patched.has(material)) return;
    patched.add(material);
    const before = material.onBeforeCompile.bind(material);
    const cacheKey = material.customProgramCacheKey();
    const clothShade = material === materials.linenShade || material === materials.fabric;
    material.customProgramCacheKey = () => `${cacheKey}|residence-light-field|${clothShade}`;
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      shader.uniforms.residenceLightVolume = { value: field.diffuse };
      shader.uniforms.residenceAccentVolume = { value: field.accent };
      shader.uniforms.residenceWindowVolume = { value: field.daylight };
      shader.uniforms.residenceFieldOrigin = { value: residenceFieldOrigin };
      shader.uniforms.residenceFieldExtent = { value: residenceFieldExtent };
      shader.uniforms.residenceNight = nightAmount;
      shader.uniforms.residenceContactEnabled = contactEnabled;
      shader.uniforms.residenceContactMap = contactMap;
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
        uniform highp sampler3D residenceWindowVolume;
        uniform vec3 residenceFieldOrigin;
        uniform vec3 residenceFieldExtent;
        uniform float residenceNight;
        uniform float residenceContactEnabled;
        uniform sampler2D residenceContactMap;`).replace('#include <lights_fragment_end>', `
        vec3 surfaceNormal = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
        vec3 roomNormal = inverseTransformDirection(geometryNormal, viewMatrix);
        vec3 roomPoint = vResidenceWorld + surfaceNormal * mix(0.095, 0.050, abs(surfaceNormal.y));
        vec3 fieldUV = clamp((vec3(roomPoint.x, -roomPoint.z, roomPoint.y) - residenceFieldOrigin) / residenceFieldExtent, 0.0, 1.0);
        vec4 probe = texture(residenceLightVolume, fieldUV);
        if (residenceContactEnabled > 0.5 && vResidenceWorld.y < 0.38) {
          vec2 floorUV = (vec2(vResidenceWorld.x, -vResidenceWorld.z) - residenceFieldOrigin.xy) / residenceFieldExtent.xy;
          float contact = texture2D(residenceContactMap, floorUV).r;
          float receiver = (1.0 - smoothstep(0.025, 0.38, vResidenceWorld.y)) * (0.40 + 0.60 * abs(surfaceNormal.y));
          probe.a *= 1.0 - 0.65 * contact * receiver;
        }
        vec4 portal = texture(residenceWindowVolume, fieldUV);
        vec3 toWindow = portal.rgb - vec3(0.5);
        toWindow *= inversesqrt(max(dot(toWindow, toWindow), 0.0002));
        float skyFacing = max(0.0, dot(roomNormal, toWindow));
        float skyAmount = portal.a * (0.24 + 0.76 * skyFacing);
        float floorBounce = 0.71 + 0.21 * max(0.0, -surfaceNormal.y);
        vec3 daytime = vec3(1.0, 0.93, 0.81) * (2.7 * probe.r * floorBounce)
          + vec3(0.77, 0.88, 1.0) * (3.1 * skyAmount);
        float warmBounce = 2.18 * probe.g;
        vec3 evening = vec3(1.0, 0.77, 0.53) * warmBounce * (0.82 + 0.18 * abs(roomNormal.y))
          + vec3(1.0, 0.79, 0.58) * (1.54 * probe.b)
          + vec3(0.40, 0.57, 1.0) * (0.63 * skyAmount + 0.10 * probe.r);
        // Near-surface occlusion is inserted here for high quality.
        vec3 roomIrradiance = mix(daytime, evening, residenceNight) * probe.a;
        irradiance += roomIrradiance * 0.75;
        iblIrradiance += roomIrradiance * 0.25;
        vec3 reflection = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
        float windowHighlight = pow(max(0.0, dot(reflection, toWindow)), mix(12.0, 1.9, material.roughness));
        vec3 skySpecular = vec3(0.74, 0.86, 1.0) * portal.a * windowHighlight;
        vec3 indoorSpecular = roomIrradiance * (0.16 + 0.17 * max(0.0, reflection.y));
        radiance += indoorSpecular + skySpecular * mix(2.45, 0.12, residenceNight);
        #ifdef USE_CLEARCOAT
          clearcoatRadiance += indoorSpecular * 0.5 + skySpecular * mix(2.0, 0.09, residenceNight);
        #endif
        if (residenceNight > 0.5) {
          // Room-local direction and falloff feed the Standard BRDF, including its normal-map and specular response.
          vec4 accent = texture(residenceAccentVolume, fieldUV);
          vec3 sourceDirection = accent.rgb - vec3(0.5);
          if (accent.a > 0.005 && dot(sourceDirection, sourceDirection) > 0.00001) {
            IncidentLight lamp;
            lamp.color = vec3(1.0, 0.73, 0.46) * (3.15 * accent.a * probe.a);
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
              float within = (1.0 - smoothstep(0.133, 0.182, radius))
                * (1.0 - smoothstep(source.w, source.w + 0.025, abs(delta.y)));
              float shadeTaper = smoothstep(-source.w, source.w, delta.y);
              transmitted = max(transmitted, within * mix(1.0, 0.53, shadeTaper));
            }
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.74, 0.45) * (transmitted * 1.94);
          }`);
      }
    };
    material.needsUpdate = true;
  }

  function attachMaterials(...groups: THREE.Object3D[]): void {
    for (const group of groups) group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (Array.isArray(object.material)) object.material.forEach(bind);
      else bind(object.material);
    });
  }

  for (const material of Object.values(materials)) {
    if (material instanceof THREE.Material) bind(material);
  }
  attachMaterials(luminaires.group);
  scene.add(daylight, daylight.target, luminaires.group, ...diningObjects);
  return {
    attachInterior(shell: THREE.Object3D, furniture: THREE.Object3D) {
      furnitureGroup = furniture;
      attachMaterials(shell, furniture);
    },
    invalidateShadows() {
      if (daylight.castShadow) daylight.shadow.needsUpdate = true;
    },
    setQuality(quality: CoastQuality) {
      if (quality === 'high' && !contactMap.value) contactMap.value = createResidenceContactMap(furnitureGroup, materials.rug);
      contactEnabled.value = Number(quality === 'high');
      resizeShadow(daylight.shadow, quality === 'high' ? 2048 : 1024);
      daylight.shadow.radius = quality === 'high' ? 3.4 : 2.35;
      for (const lamp of dining) resizeShadow(lamp.shadow, quality === 'high' ? 1024 : 512);
    },
    setTimeOfDay(time: CoastTimeOfDay) {
      const night = time === 'night';
      if (nightAmount.value === Number(night)) return;
      nightAmount.value = Number(night);
      daylight.intensity = night ? 0 : sunPower;
      daylight.castShadow = !night;
      daylight.shadow.needsUpdate = !night;
      for (const lamp of dining) {
        lamp.visible = night;
        lamp.shadow.needsUpdate = night;
      }
      materials.lamp.emissiveIntensity = night ? 1.18 : 0.10;
      materials.glass.opacity = night ? 0.027 : 0.050;
      materials.guard.opacity = night ? 0.061 : 0.090;
      luminaires.setTimeOfDay(time);
    },
    dispose() {
      scene.remove(daylight, daylight.target, luminaires.group, ...diningObjects);
      daylight.shadow.dispose();
      for (const lamp of dining) lamp.shadow.dispose();
      field.diffuse.dispose();
      field.accent.dispose();
      field.daylight.dispose();
      contactMap.value?.dispose();
      luminaires.dispose();
    },
  };
}
