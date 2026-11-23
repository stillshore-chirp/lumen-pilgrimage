import * as THREE from 'three';
import { createResidenceContactMap } from './residenceContactMap';
import { createResidenceLightSpill } from './residenceLightSpill';
import { teaShojiTransmission } from './residenceShoji';
import type { CoastQuality } from '../../CoastWorld';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { RESIDENCE_SUN } from './residenceCityMaterials';
import { createResidenceLightField, diningPendants, diningPendantHeight, diningPendantNorth, fabricLamps,
  residenceFieldExtent, residenceFieldOrigin, roomSources, type LightSource } from './residenceLightField';
import type { ResidenceMaterials } from './residenceMaterials';
import { RESIDENCE_ROOMS, type ResidenceRect } from './residencePlan';
import { FurnitureModel } from './residenceFurnitureModel';
import type { createResidenceTheaterLights } from './residenceTheaterLights';

const switchMounts: Readonly<Record<string, readonly [east: number, north: number, heading: number]>> = {
  LD: [11.072, 4.78, Math.PI / 2],
  '01': [18.76, 11.672, Math.PI],
  '02': [19.10, 9.878, 0],
  '03': [2.17, 4.928, 0],
  '04': [5.90, 4.927, 0],
  '05': [9.42, 4.928, 0],
  H1: [10.67, 6.578, 0],
  H0: [11.072, 9.54, Math.PI / 2],
  H2: [17.44, 11.528, 0],
  FO: [11.81, 15.468, 0],
  K: [17.278, 8.78, -Math.PI / 2],
  BA: [3.11, 6.722, Math.PI],
  BB: [4.71, 6.722, Math.PI],
  UT: [7.69, 6.722, Math.PI],
  ST: [10.58, 6.722, Math.PI],
  WC: [10.929, 10.29, -Math.PI / 2],
  MB: [15.078, 13.16, -Math.PI / 2],
  WI: [16.977, 13.16, -Math.PI / 2],
};
const switchReach = .95;
const windowRooms = RESIDENCE_ROOMS.filter(({ id }) => ['LD', '01', '02', '03', '04', '05'].includes(id));

function createLightingSwitches(materials: ResidenceMaterials) {
  const plates = new FurnitureModel();
  plates.group.name = 'Residence lighting switches';
  const finish = plates.tone(materials.ceiling, 0xdcd0be);

  const switches = RESIDENCE_ROOMS.flatMap(room => {
    if (!(room.id in switchMounts)) return [];
    const mount = switchMounts[room.id];
    const [east, north, heading] = mount;
    const plate = plates.at(...mount);
    const height = 1.245;
    plate.box(finish, 0, height, .006, .080, .118, .013, .005);
    plate.box(materials.darkMetal, 0, height, .013, .058, .087, .008, .004);
    plate.box(finish, 0, height, .019, .052, .081, .008, .003, -.066);
    plate.box(materials.metal, 0, height - .023, .024, .017, .003, .001);
    const inwardX = Math.sin(heading);
    const inwardZ = Math.cos(heading);

    return [{
      candidate(position: THREE.Vector3) {
        const dx = position.x - east;
        const dz = position.z + north;
        const distance = Math.hypot(dx, dz);
        if (distance > switchReach || dx * inwardX + dz * inwardZ <= 0) return null;
        const inside = room.rectangles.some(([w, s, e, n]) =>
          position.x >= w && position.x <= e && -position.z >= s && -position.z <= n);
        if (!inside) return null;
        return { distance, label: `${room.label}の照明を操作`, sectionId: `lighting-${room.id}` };
      },
    }];
  });
  plates.finish();
  return {
    group: plates.group,
    nearby(position: THREE.Vector3) {
      let nearest: ReturnType<(typeof switches)[number]['candidate']> = null;
      for (const { candidate } of switches) {
        const found = candidate(position);
        if (found && (!nearest || found.distance < nearest.distance)) nearest = found;
      }
      return nearest;
    },
    dispose: () => plates.dispose(),
  };
}

function createLuminaires(plaster: THREE.Material, darkMetal: THREE.Material) {
  const group = new THREE.Group();
  group.name = 'Concealed coves, guide lights and recessed downlights';
  const opal = new THREE.MeshBasicMaterial({ name: 'Warm white architectural diffuser', color: 0xb9b1a2 });
  const footOpal = new THREE.MeshBasicMaterial({
    name: 'Warm low-output footlight diffuser', color: new THREE.Color(0xffd7aa).multiplyScalar(.53),
  });
  const unlitOpal = new THREE.MeshStandardMaterial({ name: 'Unlit architectural diffuser', color: 0x9c9180, roughness: .79 });
  const emitters = new Map<LightSource, THREE.Mesh>();
  const geometries: THREE.BufferGeometry[] = [];
  function place(geometry: THREE.BufferGeometry, material: THREE.Material, east: number, height: number, north: number,
    fixture?: LightSource) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(east, height, -north);
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.push(geometry);
    if (fixture) {
      mesh.name = `Residence light fixture ${fixture.id}`;
      emitters.set(fixture, mesh);
    }
  }

  for (const sources of Object.values(roomSources)) {
    for (const fixture of sources) {
      const { span: [west, south, east, north], height } = fixture;
      if (fixture.kind === 'cove') {
        const { mount } = fixture;
        const width = east - west;
        const depth = north - south;
        const centerEast = (west + east) / 2;
        const centerNorth = (south + north) / 2;
        const wallEast = mount === 'west' ? -.076 : 0;
        const wallNorth = mount === 'north' ? .076 : mount === 'south' ? -.076 : 0;
        place(new THREE.BoxGeometry(width + (wallEast ? .216 : .10), .040, depth + (wallNorth ? .216 : .10)),
          plaster, centerEast + wallEast, height, centerNorth + wallNorth);
        place(new THREE.BoxGeometry(width + .04, .009, depth + .04), unlitOpal, centerEast, height + .026, centerNorth, fixture);
        place(new THREE.BoxGeometry(width + .04, .031, depth + .04), plaster,
          centerEast - wallEast * .53, height + .016, centerNorth - wallNorth * .53);
      }
      if (fixture.kind === 'foot') {
        const { mount } = fixture;
        const inwardEast = mount === 'west' ? 1 : mount === 'east' ? -1 : 0;
        const inwardNorth = mount === 'south' ? 1 : mount === 'north' ? -1 : 0;
        const alongEast = inwardNorth !== 0;
        const box = (width: number, tall: number, depth: number) =>
          new THREE.BoxGeometry(alongEast ? width : depth, tall, alongEast ? depth : width);
        // Sink the back of the housing into the wall. The low diffuser faces the walkable side.
        place(box(.118, .042, .016), darkMetal, east + .006 * inwardEast, height, north + .006 * inwardNorth);
        place(box(.083, .014, .005), unlitOpal, east + .016 * inwardEast, height - .006,
          north + .016 * inwardNorth, fixture);
      }
      if (fixture.kind === 'down') {
        place(new THREE.CylinderGeometry(.052, .064, .015, 28), plaster, east, height - .007, north);
        place(new THREE.CylinderGeometry(.046, .052, .009, 28), darkMetal, east, height - .016, north);
        place(new THREE.CylinderGeometry(.031, .038, .004, 24), unlitOpal, east, height - .021, north, fixture);
      }
    }
  }
  return {
    group,
    unlitOpal,
    update(night: boolean, enabled: (fixture: LightSource) => boolean) {
      opal.color.setHex(night ? 0xffdcb6 : 0xb9b1a2).multiplyScalar(night ? 2.8 : 1);
      for (const [fixture, mesh] of emitters) {
        const lit = fixture.kind === 'foot' ? footOpal : opal;
        mesh.material = enabled(fixture) ? lit : unlitOpal;
      }
    },
    dispose() {
      geometries.forEach(geometry => geometry.dispose());
      opal.dispose();
      footOpal.dispose();
      unlitOpal.dispose();
    },
  };
}

function diningSpot(east: number): THREE.SpotLight {
  const light = new THREE.SpotLight(0xffd6a5, 4.3, 4.2, .73, .78, 2);
  light.name = 'Dining pendant direct light';
  light.position.set(east, diningPendantHeight - .058, -diningPendantNorth);
  light.target.position.set(east, .74, -diningPendantNorth);
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
  furnitureObstacles: readonly ResidenceRect[] = [], onFixtureChange?: () => void,
  theaterLights?: ReturnType<typeof createResidenceTheaterLights>) {
  const field = createResidenceLightField(furnitureObstacles);
  const spill = createResidenceLightSpill(residenceFieldOrigin, residenceFieldExtent);
  const nightAmount = { value: 0 };
  const overrides = new Map<string, boolean>();
  const windowTransmission = { value: new Float32Array(windowRooms.length).fill(1) };
  const windowRoomIndex = new Map(windowRooms.map((room, index) => [room.id, index]));
  const teaShoji = { value: teaShojiTransmission(1) };
  const apertureRooms = windowRooms.map(({ id, rectangles }, index) => {
    const area = rectangles.map(([w, s, e, n]) =>
      `(point.x >= ${w.toFixed(2)} && point.x <= ${e.toFixed(2)} && point.y >= ${s.toFixed(2)} && point.y <= ${n.toFixed(2)})`);
    return `if (${area.join(' || ')}) return residenceWindowTransmission[${index}]${id === '04' ? ' * residenceTeaShojiTransmission' : ''};`;
  }).join('\n');
  const livingFixtures = new Set(roomSources.LD);
  function isOn(source: LightSource): boolean {
    if (livingFixtures.has(source) && theaterLights?.enabled()) return false;
    return overrides.get(source.id) ?? (nightAmount.value === 1 || source.daytime === true);
  }
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
  const dining = diningPendants.map(({ id, east }) => ({
    source: roomSources.LD.find(fixture => fixture.id === id)!,
    light: diningSpot(east),
  }));
  const diningObjects = dining.flatMap(({ light }) => [light, light.target]);
  const lampCenters = fabricLamps.map(({ east, north, base, height }) =>
    new THREE.Vector4(east, base + .79 * height, -north, .255 * height));
  const shadeSources = fabricLamps.map(({ id, room }) => roomSources[room].find(fixture => fixture.id === id)!);
  const shadeSwitches = { value: new Float32Array(lampCenters.length) };
  const emitters = new Map<string, THREE.MeshStandardMaterial>();
  const luminaires = createLuminaires(materials.ceiling, materials.darkMetal);
  const switches = createLightingSwitches(materials);
  const patched = new WeakSet<THREE.Material>();

  function updateSpill(): void {
    spill.update((id, east, north, height) => {
      const [electric, sky] = field.doorwayLight(id, east, north, height, isOn);
      const window = windowRoomIndex.get(id);
      const curtains = window === undefined ? 1 : windowTransmission.value[window];
      const shoji = id === '04' ? teaShoji.value : 1;
      return [electric, sky * curtains * shoji];
    });
  }

  function invalidateShadows(): void {
    updateSpill();
    if (daylight.castShadow) daylight.shadow.needsUpdate = true;
    for (const { light } of dining) if (light.visible) light.shadow.needsUpdate = true;
  }

  function refreshEmitters(): void {
    const night = nightAmount.value === 1;
    const strength = night ? 1.18 : .61;
    for (const [id, material] of emitters) {
      const source = fixtureById.get(id);
      if (source) material.emissiveIntensity = isOn(source) ? strength : 0;
    }
    for (const { source, light } of dining) {
      const on = isOn(source);
      if (on && !light.visible) light.shadow.needsUpdate = true;
      light.visible = on;
    }
    for (const [index, source] of shadeSources.entries()) shadeSwitches.value[index] = Number(isOn(source));
    luminaires.update(night, isOn);
  }

  function refreshRoom(room: string): void {
    field.updateRoom(room, isOn, nightAmount.value === 1);
    spill.invalidate();
    refreshEmitters();
    invalidateShadows();
    onFixtureChange?.();
  }

  function setFixtures(room: string, sources: readonly LightSource[], on: boolean, wholeZone = false): void {
    const exitTheater = wholeZone && room === 'LD' && theaterLights?.enabled();
    if (exitTheater) theaterLights?.setEnabled(false);
    const changed = exitTheater || sources.some(source => isOn(source) !== on);
    for (const source of sources) overrides.set(source.id, on);
    if (changed) refreshRoom(room);
  }

  function theaterControls() {
    if (!theaterLights) return [];
    return [
      { kind: 'toggle' as const, id: 'theater-light', label: 'シアター照明',
        get: theaterLights.enabled,
        set(on: boolean) {
          if (theaterLights.enabled() === on) return;
          theaterLights.setEnabled(on);
          refreshRoom('LD');
        } },
      { kind: 'color' as const, id: 'theater-color', label: 'シアター照明の色',
        get: theaterLights.color, set: theaterLights.setColor },
    ];
  }

  const fixtureById = new Map(Object.values(roomSources).flat().map(source => [source.id, source]));
  const sectionOrder = ['LD', 'K', '01', '02', '03', '04', '05', 'FO', 'H0', 'H1', 'H2', 'BA', 'BB', 'MB', 'WI', 'WC', 'UT', 'ST'];
  const sections = sectionOrder.map(id => {
    const title = RESIDENCE_ROOMS.find(room => room.id === id)!.label;
    const sources = roomSources[id];
    return {
      id: `lighting-${id}`, title, category: 'lighting' as const,
      controls: [
        { kind: 'button' as const, id: 'on', label: '一括点灯', invoke: () => setFixtures(id, sources, true, true) },
        { kind: 'button' as const, id: 'off', label: '一括消灯', invoke: () => setFixtures(id, sources, false, true) },
        ...(id === 'LD' ? theaterControls() : []),
        ...sources.map(source => ({
          kind: 'toggle' as const, id: source.id, label: source.label,
          get: () => isOn(source), set: (on: boolean) => setFixtures(id, [source], on),
          disabled: id === 'LD' ? theaterLights?.enabled : undefined,
        })),
      ],
    };
  });

  function bind(material: THREE.Material): void {
    if (!(material instanceof THREE.MeshStandardMaterial) || material.transparent || patched.has(material)) return;
    patched.add(material);
    const before = material.onBeforeCompile.bind(material);
    const cacheKey = material.customProgramCacheKey();
    const id = material.userData.residenceFixtureId;
    if (typeof id === 'string') emitters.set(id, material);
    const clothShade = material === materials.linenShade || material === materials.fabric;
    material.customProgramCacheKey = () => `${cacheKey}|residence-light-field|${clothShade}|${Boolean(theaterLights)}`;
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      shader.uniforms.residenceLightVolume = { value: field.diffuse };
      shader.uniforms.residenceAccentVolume = { value: field.accent };
      shader.uniforms.residenceWindowVolume = { value: field.daylight };
      shader.uniforms.residenceSpillVolume = { value: spill.texture };
      shader.uniforms.residenceFieldOrigin = { value: residenceFieldOrigin };
      shader.uniforms.residenceFieldExtent = { value: residenceFieldExtent };
      shader.uniforms.residenceNight = nightAmount;
      shader.uniforms.residenceWindowTransmission = windowTransmission;
      shader.uniforms.residenceTeaShojiTransmission = teaShoji;
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
        uniform highp sampler3D residenceSpillVolume;
        uniform vec3 residenceFieldOrigin;
        uniform vec3 residenceFieldExtent;
        uniform float residenceNight;
        uniform float residenceWindowTransmission[${windowRooms.length}];
        uniform float residenceTeaShojiTransmission;
        float windowTransmissionAt(vec2 point) {
          ${apertureRooms}
          return 1.0;
        }
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
        portal.a *= windowTransmissionAt(vec2(roomPoint.x, -roomPoint.z));
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
        vec2 spillLight = texture(residenceSpillVolume, fieldUV).rg;
        vec3 indirect = vec3(1.0, 0.79, 0.57) * (1.02 * spillLight.r)
          + vec3(0.69, 0.84, 1.0) * (spillLight.g * mix(1.35, 0.16, residenceNight));
        roomIrradiance += indirect * probe.a;
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
        shader.uniforms.residenceFabricLampOn = shadeSwitches;
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_pars_fragment>', `
          #include <emissivemap_pars_fragment>
          uniform vec4 residenceFabricLamp[${lampCenters.length}];
          uniform float residenceFabricLampOn[${lampCenters.length}];`).replace('#include <emissivemap_fragment>', `
          #include <emissivemap_fragment>
          {
            float transmitted = 0.0;
            for (int i = 0; i < ${lampCenters.length}; i++) {
              if (residenceFabricLampOn[i] < 0.5) continue;
              vec4 source = residenceFabricLamp[i];
              vec3 delta = vResidenceWorld - source.xyz;
              float radius = length(delta.xz);
              float within = (1.0 - smoothstep(0.133, 0.182, radius))
                * (1.0 - smoothstep(source.w, source.w + 0.025, abs(delta.y)));
              float shadeTaper = smoothstep(-source.w, source.w, delta.y);
              transmitted = max(transmitted, within * mix(1.0, 0.53, shadeTaper));
            }
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.74, 0.45) * (transmitted * mix(1.1, 1.94, residenceNight));
          }`);
      }
      theaterLights?.bind(shader);
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
  attachMaterials(luminaires.group, switches.group);
  scene.add(daylight, daylight.target, luminaires.group, switches.group, ...diningObjects);
  refreshEmitters();
  updateSpill();
  return {
    attachInterior(shell: THREE.Object3D, furniture: THREE.Object3D) {
      furnitureGroup = furniture;
      attachMaterials(shell, furniture);
      refreshEmitters();
    },
    sections,
    nearby: switches.nearby,
    invalidateShadows,
    setDaylightTransmission(roomId: string, transmission: number) {
      const index = windowRoomIndex.get(roomId);
      if (index === undefined) return;
      const value = Math.fround(THREE.MathUtils.clamp(transmission, 0, 1));
      if (windowTransmission.value[index] !== value) {
        windowTransmission.value[index] = value;
        spill.invalidate();
      }
    },
    setTeaShojiOpenness(openness: number) {
      const value = teaShojiTransmission(openness);
      if (teaShoji.value !== value) {
        teaShoji.value = value;
        spill.invalidate();
      }
    },
    setDoorOpenness: spill.setDoorOpenness,
    setQuality(quality: CoastQuality) {
      if (quality === 'high' && !contactMap.value) contactMap.value = createResidenceContactMap(furnitureGroup, materials.rug);
      contactEnabled.value = Number(quality === 'high');
      resizeShadow(daylight.shadow, quality === 'high' ? 2048 : 1024);
      daylight.shadow.radius = quality === 'high' ? 3.4 : 2.35;
      for (const { light } of dining) resizeShadow(light.shadow, quality === 'high' ? 1024 : 512);
    },
    setTimeOfDay(time: CoastTimeOfDay) {
      const night = time === 'night';
      if (nightAmount.value === Number(night)) return;
      nightAmount.value = Number(night);
      daylight.intensity = night ? 0 : sunPower;
      daylight.castShadow = !night;
      daylight.shadow.needsUpdate = !night;
      for (const id of Object.keys(roomSources)) field.updateRoom(id, isOn, night);
      refreshEmitters();
      spill.invalidate();
      updateSpill();
      materials.lamp.emissiveIntensity = night ? 1.18 : 0.10;
      materials.glass.opacity = night ? 0.027 : 0.050;
      materials.guard.opacity = night ? 0.061 : 0.090;
    },
    dispose() {
      scene.remove(daylight, daylight.target, luminaires.group, switches.group, ...diningObjects);
      daylight.shadow.dispose();
      for (const { light } of dining) light.shadow.dispose();
      field.diffuse.dispose();
      field.accent.dispose();
      field.daylight.dispose();
      spill.texture.dispose();
      contactMap.value?.dispose();
      luminaires.dispose();
      switches.dispose();
    },
  };
}
