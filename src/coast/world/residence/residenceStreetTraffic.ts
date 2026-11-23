import * as THREE from 'three';
import { seededDetail } from '../overlook/overlookModel';
import { createDistrictMaterial } from './residenceCityMaterials';
import {
  RESIDENCE_AVENUE, RESIDENCE_CROSS_STREETS, RESIDENCE_EAST_RETURN, RESIDENCE_SIDE_STREET, RESIDENCE_STREET_LEVEL,
} from './residenceCityPlan';

type Vehicle = {
  directionX: number; directionZ: number; originX: number; originZ: number; travel: number;
  departure: number; speed: number; width: number; length: number; height: number; color: number;
};

const signalCycle = 42;
const routeCycle = signalCycle * 2;
const asphaltLevel = RESIDENCE_STREET_LEVEL;
const colors = [0xc8c6bb, 0x515b63, 0x5b747e, 0xa29c90, 0x7f4844, 0xc5bf8f, 0x6a6971, 0x333c49];

function planVehicles(): Vehicle[] {
  const random = seededDetail(483);
  const cars: Vehicle[] = [];
  function lane(alongZ: boolean, lateral: number, min: number, max: number, direction: number,
    junction: number, occurrences: number[], speed: number): void {
    const origin = direction > 0 ? min : max;
    for (const arrival of [...occurrences, ...occurrences.map(t => t + signalCycle)]) {
      const delivery = random() < 0.075;
      cars.push({
        directionX: alongZ ? 0 : direction, directionZ: alongZ ? direction : 0,
        originX: alongZ ? lateral : origin, originZ: alongZ ? origin : lateral,
        travel: max - min, departure: arrival - Math.abs(junction - origin) / speed,
        speed, width: delivery ? 2.18 : 1.68 + random() * 0.26,
        length: delivery ? 6.8 : 4.12 + random() * 0.71,
        height: delivery ? 2.36 : 1.29 + random() * 0.29,
        color: delivery ? 0xc3c3ad : colors[Math.floor(random() * colors.length)],
      });
    }
  }

  const { minZ, maxZ } = RESIDENCE_AVENUE;
  for (const [i, x] of [7.5, 11.9, 15.8, 23.3, 27.1, 31.2].entries()) {
    const offset = (i % 3) * 0.45;
    lane(true, x, minZ, maxZ, x < 19.5 ? 1 : -1, 180, [7, 10.4, 13.8].map(t => t + offset), 12);
  }

  // The cross streets use gaps in the avenue's two streams. Arrival times are staggered
  // across lanes so the intersections show moving groups with time between them.
  const crossArrivals = [[9.5, 13.0], [23.0, 28, 33], [29, 33.7], [5, 10], [9, 12], [24, 30]];
  for (const [streetIndex, { minX, maxX, minZ: from, maxZ: to }] of RESIDENCE_CROSS_STREETS.entries()) {
    const center = (from + to) / 2;
    for (const [i, delta] of [-5.8, -2.0, 2.0, 5.8].entries()) {
      lane(false, center + delta, minX, maxX,
        delta > 0 ? 1 : -1, 19.5, crossArrivals[streetIndex].map(t => t + (i % 2) * 0.68), 10.8);
    }
  }

  for (const direction of [-1, 1]) {
    lane(true, 43 + direction * 1.72, RESIDENCE_SIDE_STREET.minZ, 8, direction, 6, [4.3, 18, 32], 7.2);
    lane(false, -0.5 + direction * 1.5, RESIDENCE_EAST_RETURN.minX, RESIDENCE_EAST_RETURN.maxX, direction,
      105, [8.6, 24.9], 6.8);
  }
  return cars;
}

export function createResidenceStreetTraffic(night: THREE.IUniform<number>) {
  const group = new THREE.Group();
  group.name = 'Residence avenues moving traffic';
  const vehicles = planVehicles();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const material = createDistrictMaterial(night);
  const body = new THREE.InstancedMesh(box, material, vehicles.length);
  const cabin = new THREE.InstancedMesh(box, material, vehicles.length);
  const positions = new THREE.BufferAttribute(new Float32Array(vehicles.length * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const energy = new THREE.BufferAttribute(new Float32Array(vehicles.length * 4), 1).setUsage(THREE.DynamicDrawUsage);
  const shades = new THREE.BufferAttribute(new Float32Array(vehicles.length * 4 * 3), 3);
  const glow = new THREE.BufferGeometry();
  glow.setAttribute('position', positions);
  glow.setAttribute('energy', energy);
  glow.setAttribute('color', shades);
  const viewHeight = { value: 720 };
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: { uHeight: viewHeight },
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: /* glsl */`
      uniform float uHeight;
      attribute float energy;
      varying vec3 vLamp;
      varying float vPower;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = clamp(uHeight * 1.02 / max(1.0, -view.z), 2.25, 6.5);
        vLamp = color;
        vPower = energy;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vLamp;
      varying float vPower;
      void main() {
        float r = length(gl_PointCoord * 2.0 - 1.0);
        float halo = exp(-3.5 * r * r) * (1.0 - smoothstep(0.46, 1.0, r));
        gl_FragColor = vec4(vLamp, vPower * halo);
        #include <colorspace_fragment>
      }
    `,
  });
  const lamps = new THREE.Points(glow, glowMaterial);
  body.name = 'Car bodies on traveled lanes';
  cabin.name = 'Cabins and delivery boxes';
  lamps.name = 'Paired car headlamps and taillamps';
  const bound = new THREE.Sphere(new THREE.Vector3(98, asphaltLevel, 314), 565);
  for (const mesh of [body, cabin]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // One fixed bound covers the route network as individual cars move through it.
    mesh.boundingSphere = bound;
  }
  glow.boundingSphere = bound;
  const viewport = new THREE.Vector2();
  lamps.onBeforeRender = renderer => { viewHeight.value = renderer.getDrawingBufferSize(viewport).y; };
  lamps.renderOrder = 2;
  const color = new THREE.Color();
  for (const [i, car] of vehicles.entries()) {
    body.setColorAt(i, color.set(car.color));
    cabin.setColorAt(i, color.set(car.height > 2 ? 0xbabcb3 : 0x3f5360));
    for (let light = 0; light < 4; light += 1) {
      color.set(light < 2 ? 0xfff4d9 : 0xff2b15);
      shades.setXYZ(i * 4 + light, color.r, color.g, color.b);
    }
  }
  group.add(body, cabin, lamps);

  const matrix = new THREE.Matrix4();
  function place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number,
    w: number, h: number, length: number, dx: number, dz: number, active: number): void {
    matrix.set(
      dz * w * active, 0, dx * length * active, x,
      0, h * active, 0, y,
      -dx * w * active, 0, dz * length * active, z,
      0, 0, 0, 1,
    );
    mesh.setMatrixAt(i, matrix);
  }

  function update(time: number): void {
    for (const [i, car] of vehicles.entries()) {
      const { width, length, height, directionX: dx, directionZ: dz } = car;
      const distance = THREE.MathUtils.euclideanModulo(time - car.departure, routeCycle) * car.speed;
      const limit = Math.min(distance, car.travel);
      const active = Number(distance < car.travel);
      const x = car.originX + limit * dx, z = car.originZ + limit * dz;
      const delivery = height > 2;
      const deck = delivery ? 0.65 : 0.67;
      place(body, i, x, asphaltLevel + deck * 0.62, z, width, deck, length, dx, dz, active);
      const setback = delivery ? -0.80 : -0.22;
      place(cabin, i, x + dx * setback, asphaltLevel + deck + (height - deck) / 2, z + dz * setback,
        width * (delivery ? 0.91 : 0.86), height - deck, length * (delivery ? 0.69 : 0.55), dx, dz, active);
      if (night.value === 0) continue;
      for (let light = 0; light < 4; light += 1) {
        const axial = (light < 2 ? 1 : -1) * (length * 0.5 + 0.24);
        const lateral = (light % 2 ? -1 : 1) * width * 0.32;
        positions.setXYZ(i * 4 + light, x + axial * dx + lateral * dz, asphaltLevel + 0.73,
          z + axial * dz - lateral * dx);
        const blend = THREE.MathUtils.smoothstep(distance, 0, 6)
          * (1 - THREE.MathUtils.smoothstep(distance, car.travel - 6, car.travel));
        energy.setX(i * 4 + light, blend * (light < 2 ? 1.0 : 0.91));
      }
    }
    body.instanceMatrix.needsUpdate = cabin.instanceMatrix.needsUpdate = true;
    if (night.value > 0) positions.needsUpdate = energy.needsUpdate = true;
  }

  lamps.visible = false;
  update(0);

  return {
    group,
    update,
    setNight(dark: boolean) {
      lamps.visible = dark;
    },
  };
}
