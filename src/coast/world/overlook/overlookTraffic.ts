import * as THREE from 'three';
import type { CoastQuality } from '../../CoastWorld';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { seededDetail } from './overlookModel';
import { createOverlookRoadSurface as roadwaySurface, ROAD_LAMP_SPACING as lampSpacing, ROAD_LAMP_TINT as roadLampTint } from './overlookRoadSurface';

import { corridorRole, createOriginalRoadProfiles, isOverlookOriginalRoadway, sampleCorridorRoad,
  type CorridorRoad, type OverlookCorridorPlan } from './overlookCorridorPlan';

type HeightAt = (x: number, z: number) => number;
type Road = CorridorRoad;
type RoadPoint = { x: number; y: number; z: number; nx: number; nz: number; slope: number };
export const isOverlookRoadway = isOverlookOriginalRoadway;
function sampleRoad(road: Road, distance: number, point: RoadPoint): void {
  const p = sampleCorridorRoad(road, distance);
  point.x = p.x; point.y = p.y - 0.42; point.z = p.z; point.nx = p.nx; point.nz = p.nz;
  point.slope = p.grade;
}

const lightsVertex = /* glsl */`
  attribute vec2 heading;
  attribute vec2 lamp;
  uniform float uPixelFactor;
  varying vec3 vColor;
  varying vec2 vAxis;
  varying float vOpacity;
  varying float vTraffic;
  ${roadLampTint}

  void main() {
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 view = viewMatrix * vec4(world, 1.0);
    vec4 clip = projectionMatrix * view;
    float eyeDistance = length(view.xyz);
    float axle = lamp.x;
    float power = lamp.y;
    vTraffic = step(0.5, axle);
    vAxis = vec2(1.0, 0.0);
    float size;
    if (vTraffic > 0.5) {
      vec2 facing = (cameraPosition.xz - world.xz) / max(1.0, length(cameraPosition.xz - world.xz));
      vec3 direction = vec3(heading.x, 0.0, heading.y);
      float visibility = smoothstep(-0.51, 0.37, dot(heading, facing) * (axle < 1.5 ? 1.0 : -1.0));
      vec4 ahead = projectionMatrix * viewMatrix * vec4(world + 45.0 * direction, 1.0);
      vec2 motion = ahead.xy / ahead.w - clip.xy / clip.w;
      motion *= vec2(projectionMatrix[1][1] / projectionMatrix[0][0], -1.0);
      vAxis = motion / max(length(motion), 0.00001);
      vColor = axle < 1.5 ? vec3(0.96, 0.98, 1.0) : vec3(1.0, 0.049, 0.024);
      vOpacity = exp(-eyeDistance * 0.000066) * power * 1.38 * visibility;
      size = clamp(5.4 + 10700.0 / max(820.0, eyeDistance), 6.1, 13.2);
    } else {
      vOpacity = min(0.94, exp(-eyeDistance * 0.000043) * power);
      vColor = roadLampTint(world.xz);
      size = clamp(5.05 + 4000.0 / max(700.0, eyeDistance), 5.4, 8.5);
    }
    gl_PointSize = size * uPixelFactor;
    gl_Position = clip;
  }
`;

const lightsFragment = /* glsl */`
  varying vec3 vColor;
  varying vec2 vAxis;
  varying float vOpacity;
  varying float vTraffic;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float rad2 = dot(p, p);
    if (rad2 > 0.25 || vOpacity < 0.005) discard;
    vec2 tangentSpace = vec2(dot(p, vAxis), dot(p, vec2(-vAxis.y, vAxis.x)));
    float head = exp(-mix(100.0, 74.0, vTraffic) * rad2);
    float halo = exp(-mix(16.0, 22.0, vTraffic) * rad2);
    float tail = exp(-202.0 * tangentSpace.y * tangentSpace.y)
      * smoothstep(-0.47, -0.065, tangentSpace.x) * (1.0 - smoothstep(-0.08, 0.13, tangentSpace.x));
    float alpha = head * 0.91 + halo * mix(0.20, 0.15, vTraffic) + tail * 0.33 * vTraffic;
    gl_FragColor = vec4(vColor, vOpacity * alpha);
    #include <colorspace_fragment>
  }
`;

function points(positions: THREE.BufferAttribute, heading: THREE.BufferAttribute, lamps: THREE.BufferAttribute,
  material: THREE.ShaderMaterial): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setAttribute('heading', heading);
  geometry.setAttribute('lamp', lamps);
  const mesh = new THREE.Points(geometry, material);
  const bufferSize = new THREE.Vector2();
  mesh.onBeforeRender = renderer => {
    renderer.getDrawingBufferSize(bufferSize);
    material.uniforms.uPixelFactor.value = THREE.MathUtils.clamp(bufferSize.y / 860, 0.72, 2.5);
  };
  return mesh;
}

function roadFurniture(graded: Road[], heightAt: HeightAt, box: THREE.BoxGeometry, lightMaterial: THREE.ShaderMaterial, corridor?: OverlookCorridorPlan) {
  const props: Array<{ x: number; y: number; z: number; w: number; h: number; d: number; color: number }> = [];
  const fixtures: number[] = [], power: number[] = [];
  const point: RoadPoint = { x: 0, y: 0, z: 0, nx: 0, nz: 0, slope: 0 };
  const random = seededDetail(642901);

  for (const [i, road] of graded.entries()) {
    for (const side of [-1, 1]) {
      const startingDistance = side === 1 ? lampSpacing : lampSpacing * 0.5;
      for (let distance = startingDistance; distance < road.length; distance += lampSpacing) {
        sampleRoad(road, distance, point);
        const offset = side * (road.plan.halfWidth - 2.5);
        const x = point.x + point.nx * offset, z = point.z + point.nz * offset;
        const h = 8.2 + random() * 2.7;
        const powerValue = 0.64 + random() * 0.48;
        const portal = corridor?.portals.find(p => p.roadId === road.id);
        if (portal && distance <= portal.frame.station + 12) {
          const across = side * (road.plan.halfWidth + 0.70), wallX = point.x + point.nx * across, wallZ = point.z + point.nz * across;
          props.push({ x: wallX, z: wallZ, y: point.y + 4.87, w: 1.0, h: 0.25, d: 1.6, color: 0x777c76 });
          fixtures.push(wallX, point.y + 4.82, wallZ); power.push(0, powerValue); continue;
        }
        props.push({ x, z, y: point.y + h / 2, w: 0.77, h, d: 0.77, color: 0x686d68 });
        fixtures.push(x, point.y + h, z);
        power.push(0, powerValue);
      }
    }
    for (let distance = 43; distance < road.length - 30; distance += 66) {
      sampleRoad(road, distance, point);
      if (corridor && corridorRole(corridor, road.id, distance) !== 'open') continue;
      const ground = Math.min(...[-2.9, 2.9].flatMap(dx => [-4.2, 4.2].map(dz => heightAt(point.x + dx, point.z + dz))));
      if (point.y - ground < 7.6 || (corridor ? corridor.isRoadway(point.x, point.z, 6, i) : isOverlookOriginalRoadway(point.x, point.z, 6, i))) continue;
      const h = point.y - ground - 1.1;
      props.push({ x: point.x, y: ground + h / 2 - 0.5, z: point.z,
        w: 5.8, h: h + 1.0, d: 8.4, color: 0x9b8e7d });
    }
  }

  const material = new THREE.MeshStandardMaterial({ roughness: 0.86 });
  const poles = new THREE.InstancedMesh(box, material, props.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (const [i, prop] of props.entries()) {
    dummy.position.set(prop.x, prop.y, prop.z);
    dummy.scale.set(prop.w, prop.h, prop.d);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    poles.setColorAt(i, color.set(prop.color));
  }
  poles.name = 'Lamp standards and viaduct piers';

  const lamps = points(new THREE.Float32BufferAttribute(fixtures, 3),
    new THREE.BufferAttribute(new Float32Array(power.length), 2), new THREE.Float32BufferAttribute(power, 2), lightMaterial);
  lamps.name = 'Warm roadside lamps';
  return { poles, lamps };
}

type Vehicle = {
  road: Road; speed: number; lane: number; phase: number; w: number; h: number; length: number; power: number;
};

function createVehicles(roads: Road[], random: () => number) {
  const vehicles: Vehicle[] = [], extra: Vehicle[] = [];
  for (const road of roads) {
    const lanes = road.plan.lanes === 2 ? [0.28, 0.62] : [0.24, 0.43, 0.64];
    const spacingByLane = road.plan.lanes === 2 ? [134, 157] : [146, 122, 171];
    for (const direction of [-1, 1]) {
      for (const [lane, fraction] of lanes.entries()) {
        const count = Math.floor(road.length / spacingByLane[lane]);
        const spacing = road.length / count;
        const speed = road.plan.speed * direction * (0.85 + 0.26 * random() + (0.61 - fraction) * 0.23);
        const phase = random() * spacing;
        for (let i = 0; i < count; i += 1) {
          const truck = random() < 0.12;
          const h = truck ? 3.7 : 1.9 + random() * 0.65;
          const list = lane === 1 && i % 2 === 0 ? extra : vehicles;
          list.push({ road, speed, lane: road.plan.halfWidth * fraction * direction, h,
            phase: i * spacing + phase - random() * spacing * 0.74,
            w: truck ? 3.2 : 2.5, length: truck ? 15 + random() * 4 : 5.8 + random() * 2.6,
            power: 0.68 + random() * 0.38 });
        }
      }
    }
  }
  return { vehicles: vehicles.concat(extra), lightCount: vehicles.length };
}

type SoundCorridor = {
  readonly points: readonly { x: number; y: number; z: number }[];
  readonly weight: number;
  readonly roadId?: number;
  readonly role?: 'exposed' | 'portal';
  readonly bore?: -1 | 1;
  readonly playbackRate?: number;
  readonly offsetSeconds?: number;
  readonly sections?: readonly { point: { x: number; y: number; z: number }; length: number; interiorDistance: number }[];
};

export function createOverlookTraffic(heightAt: HeightAt, corridor?: OverlookCorridorPlan) {
  const group = new THREE.Group();
  group.name = 'Basin expressways and traffic';
  const graded: Road[] = [...(corridor?.roads ?? createOriginalRoadProfiles(heightAt))];
  const soundCorridors: readonly SoundCorridor[] = graded.flatMap(road => {
    const weight = road.plan.soundWeight;
    if (weight === undefined) return [];
    const segments = Math.round(road.length / 285);
    const sample: RoadPoint = { x: 0, y: 0, z: 0, nx: 0, nz: 0, slope: 0 };
    const points = Array.from({ length: segments + 1 }, (_, i) => {
      sampleRoad(road, road.length * (i / segments), sample);
      return { x: sample.x, y: sample.y + 0.42, z: sample.z };
    });
    const portal = corridor?.portals.find(p => p.roadId === road.id);
    const stations = Array.from({ length: segments + 1 }, (_, i) => road.length * i / segments);
    if (portal) stations.push(portal.frame.station);
    stations.sort((a, b) => a - b);
    const exposed: NonNullable<SoundCorridor['sections']>[number][] = [];
    const covered: NonNullable<SoundCorridor['sections']>[number][] = [];
    for (let i = 0; i + 1 < stations.length; i += 1) {
      const start = stations[i], end = stations[i + 1];
      if (end - start < 1e-6) continue;
      const station = (start + end) * 0.5, p = sampleCorridorRoad(road, station);
      const section = { point: { x: p.x, y: p.y, z: p.z }, length: end - start,
        interiorDistance: portal && station < portal.frame.station ? portal.frame.station - station : 0 };
      (section.interiorDistance > 0 ? covered : exposed).push(section);
    }
    const baseRate = 1 - (road.id % 8) * 0.011;
    const sources: SoundCorridor[] = [{ points, weight, roadId: road.id, role: 'exposed', sections: exposed,
      playbackRate: baseRate, offsetSeconds: road.id * 23.7 }];
    if (portal && covered.length) for (const bore of [-1, 1] as const) {
      const lateral = bore * (portal.medianHalfWidth + portal.halfWidth + 1) * 0.5;
      const point = { x: portal.frame.x + portal.frame.nx * lateral,
        y: portal.frame.y - 0.42 * Math.abs(lateral / portal.halfWidth) + 1.2,
        z: portal.frame.z + portal.frame.nz * lateral };
      // Split source length/weight once between the real openings. Each opening
      // gets its own arrival voice, so aggregation cannot move it into the web.
      const rateDelta = baseRate > 0.998 ? -(bore < 0 ? 0.0015 : 0.0025)
        : baseRate < 0.925 ? (bore < 0 ? 0.0015 : 0.0025) : bore * 0.0015;
      sources.push({ points: [point], weight, roadId: road.id, role: 'portal', bore,
        playbackRate: baseRate + rateDelta, offsetSeconds: road.id * 23.7 + (bore < 0 ? 3.37 : 11.13),
        sections: covered.map(section => ({ ...section, point, length: section.length * 0.5 })) });
    }
    return sources;
  });
  const night = { value: 0 };
  const high = { value: 0 };
  const { surface, fascias } = roadwaySurface(graded, night, high);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const lightsMaterial = new THREE.ShaderMaterial({
    uniforms: { uPixelFactor: { value: 1 } }, vertexShader: lightsVertex, fragmentShader: lightsFragment,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const { poles, lamps } = roadFurniture(graded, heightAt, box, lightsMaterial, corridor);
  const random = seededDetail(304402);
  const { vehicles, lightCount } = createVehicles(graded, random);
  const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.14 });
  const bodies = new THREE.InstancedMesh(box, bodyMaterial, vehicles.length);
  bodies.name = 'Moving cars and freight vehicles';
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bodies.boundingSphere = surface.geometry.boundingSphere;

  const positions = new THREE.BufferAttribute(new Float32Array(vehicles.length * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const headings = new THREE.BufferAttribute(new Float32Array(vehicles.length * 4), 2).setUsage(THREE.DynamicDrawUsage);
  const lampData = new THREE.BufferAttribute(new Float32Array(vehicles.length * 4), 2).setUsage(THREE.DynamicDrawUsage);
  const movingLights = points(positions, headings, lampData, lightsMaterial);
  movingLights.name = 'Moving headlights and tail lamps';
  movingLights.geometry.boundingSphere = surface.geometry.boundingSphere;
  const colors = [0xccc6b7, 0x494f55, 0x808b9b, 0x793c36, 0x2a3e47, 0xbcae91, 0x777c80, 0x38454e];
  const color = new THREE.Color();
  for (let i = 0; i < vehicles.length; i += 1) {
    bodies.setColorAt(i, color.set(colors[Math.floor(random() * colors.length)]));
  }

  group.add(surface, fascias, poles, bodies, lamps, movingLights);
  const point: RoadPoint = { x: 0, y: 0, z: 0, nx: 0, nz: 0, slope: 0 };
  const matrices = bodies.instanceMatrix.array;
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  let elapsed = 0;
  function update(time: number): void {
    elapsed = time;
    for (let i = 0; i < bodies.count; i += 1) {
      const car = vehicles[i];
      const distance = THREE.MathUtils.euclideanModulo(time * car.speed + car.phase, car.road.length);
      sampleRoad(car.road, distance, point);
      const direction = Math.sign(car.speed);
      const dx = point.nz * direction, dz = -point.nx * direction;
      forward.set(dx, point.slope * direction, dz).normalize();
      right.set(dz, 0.42 * Math.sign(car.lane) * direction / car.road.plan.halfWidth, -dx).normalize();
      up.copy(forward).cross(right).normalize(); right.copy(up).cross(forward).normalize();
      const x = point.x + point.nx * car.lane, z = point.z + point.nz * car.lane;
      const y = point.y + 0.42 * (1 - Math.abs(car.lane / car.road.plan.halfWidth));
      // Write the changing entries of the column-major instance matrix directly.
      const offset = i * 16;
      matrices[offset] = right.x * car.w; matrices[offset + 1] = right.y * car.w; matrices[offset + 2] = right.z * car.w;
      matrices[offset + 4] = up.x * car.h; matrices[offset + 5] = up.y * car.h; matrices[offset + 6] = up.z * car.h;
      matrices[offset + 8] = forward.x * car.length; matrices[offset + 9] = forward.y * car.length; matrices[offset + 10] = forward.z * car.length;
      matrices[offset + 12] = x + up.x * car.h * 0.5;
      matrices[offset + 13] = y + up.y * car.h * 0.5;
      matrices[offset + 14] = z + up.z * car.h * 0.5;
      if (night.value === 0) continue;

      // Paired vehicle lamps occlude with terrain and are visible according to facing.
      const nose = car.length * 0.47;
      const lampX = x + up.x * car.h * 0.54, lampY = y + up.y * car.h * 0.54, lampZ = z + up.z * car.h * 0.54;
      const arrival = THREE.MathUtils.smoothstep(distance, 0, 55);
      const exit = 1 - THREE.MathUtils.smoothstep(distance, car.road.length - 55, car.road.length);
      const brightness = car.power * arrival * exit;
      positions.setXYZ(i * 2, lampX + forward.x * nose, lampY + forward.y * nose, lampZ + forward.z * nose);
      positions.setXYZ(i * 2 + 1, lampX - forward.x * nose, lampY - forward.y * nose, lampZ - forward.z * nose);
      headings.setXY(i * 2, dx, dz);
      headings.setXY(i * 2 + 1, dx, dz);
      lampData.setXY(i * 2, 1, brightness);
      lampData.setXY(i * 2 + 1, 2, brightness);
    }
    bodies.instanceMatrix.needsUpdate = true;
    if (night.value > 0) {
      positions.needsUpdate = true;
      headings.needsUpdate = true;
      lampData.needsUpdate = true;
    }
  }

  function setQuality(quality: CoastQuality): void {
    high.value = Number(quality === 'high');
    bodies.count = high.value === 1 ? vehicles.length : lightCount;
    movingLights.geometry.setDrawRange(0, bodies.count * 2);
    update(elapsed);
  }

  const setTimeOfDay = (time: CoastTimeOfDay): void => {
    const dark = time === 'night';
    night.value = Number(dark);
    lamps.visible = movingLights.visible = dark;
    if (dark) update(elapsed);
  };

  setTimeOfDay('day');
  setQuality('light');

  return {
    group, soundCorridors, update, setTimeOfDay, setQuality,
    dispose() {
      for (const geometry of [surface.geometry, fascias.geometry, box, lamps.geometry, movingLights.geometry])
        geometry.dispose();
      for (const material of [surface.material, fascias.material, poles.material, bodyMaterial, lightsMaterial])
        material.dispose();
      poles.dispose();
      bodies.dispose();
    },
  };
}
