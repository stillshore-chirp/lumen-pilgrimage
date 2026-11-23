import * as THREE from 'three';
import { seededDetail } from '../overlook/overlookModel';
import { createDistrictMaterial } from './residenceCityMaterials';
import { RESIDENCE_DISTRICT_ROADS, RESIDENCE_STREET_LEVEL } from './residenceCityPlan';

type Vehicle = {
  directionX: number; directionZ: number; originX: number; originZ: number; travel: number;
  departure: number; cycle: number; speed: number; width: number; length: number; height: number; color: number;
};

const signalCycle = 42;
const asphaltLevel = RESIDENCE_STREET_LEVEL;
const colors = [0xc8c6bb, 0x515b63, 0x5b747e, 0xa29c90, 0x7f4844, 0xc5bf8f, 0x6a6971, 0x333c49];

function planVehicles(): Vehicle[] {
  const random = seededDetail(483);
  const cars: Vehicle[] = [];
  function lane(alongZ: boolean, lateral: number, min: number, max: number, direction: number,
    junction: number, occurrences: number[], speed: number): void {
    const origin = direction > 0 ? min : max;
    const travel = max - min;
    const repeats = Math.ceil((travel / speed + 19) / signalCycle);
    const arrivals = Array.from({ length: repeats }, (_, index) => occurrences.map(t => t + index * signalCycle)).flat();
    for (const arrival of arrivals) {
      const delivery = random() < 0.075;
      cars.push({
        directionX: alongZ ? 0 : direction, directionZ: alongZ ? direction : 0,
        originX: alongZ ? lateral : origin, originZ: alongZ ? origin : lateral,
        travel, cycle: repeats * signalCycle, departure: arrival - Math.abs(junction - origin) / speed,
        speed, width: delivery ? 2.18 : 1.68 + random() * 0.26,
        length: delivery ? 6.8 : 4.12 + random() * 0.71,
        height: delivery ? 2.36 : 1.29 + random() * 0.29,
        color: delivery ? 0xc3c3ad : colors[Math.floor(random() * colors.length)],
      });
    }
  }

  const [avenue, ...roads] = RESIDENCE_DISTRICT_ROADS;
  for (const [i, x] of [7.5, 11.9, 15.8, 23.3, 27.1, 31.2].entries()) {
    const offset = (i % 3) * 0.45;
    lane(true, x, avenue.from, avenue.to, x < avenue.center ? -1 : 1, 276.5, [7, 10.4, 13.8].map(t => t + offset), 13.8);
  }

  // All traffic uses these same carriageways, with sparser departures on the service streets.
  const crossArrivals = [[9.5, 13.0], [23.0, 28, 33], [23, 29, 33.7], [5, 10], [9, 12], [24, 30], [9, 15, 22], [16, 22]];
  for (const [index, road] of roads.entries()) {
    const { alongZ, center, from, to, carriageway } = road;
    const width = alongZ ? carriageway.maxX - carriageway.minX : carriageway.maxZ - carriageway.minZ;
    const offsets = index < 8 && width > 19 ? [-5.8, -2.0, 2.0, 5.8] : [-Math.min(2.6, width * 0.24), Math.min(2.6, width * 0.24)];
    const junction = index < 8 ? avenue.center : (from + to) * 0.5;
    for (const [i, offset] of offsets.entries()) {
      const direction = Math.sign(offset) * (alongZ ? 1 : -1);
      const arrivals = crossArrivals[index] ?? (index % 3 ? [7 + index * 0.81] : [8 + index * 0.54, 24.6 + index * 0.39]);
      lane(alongZ, center + offset, from + 2.4, to - 2.4, direction, junction,
        arrivals.map(time => time + (i % 2) * 0.68), width > 13 ? 11.5 : width > 8 ? 8.7 : 6.8);
    }
  }
  return cars;
}

function createRoadBeamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec2 vBeam;
      varying vec3 vColor;
      void main() {
        vBeam = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y);
        vColor = instanceColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vBeam;
      varying vec3 vColor;
      void main() {
        float trail = vBeam.y;
        float spread = 0.24 + 0.61 * trail;
        float across = abs(vBeam.x) / spread;
        float paired = exp(-abs(across - 0.25) * 6.4) * (1.0 - 0.72 * trail);
        float footprint = exp(-across * across * 3.7) * (0.56 + 0.42 * paired);
        float intensity = (0.26 + 0.74 * exp(-trail * 3.8)) * (1.0 - smoothstep(0.45, 1.0, trail))
          * smoothstep(0.0, 0.15, trail);
        gl_FragColor = vec4(vColor, footprint * intensity * 0.77);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export function createResidenceStreetTraffic(night: THREE.IUniform<number>) {
  const group = new THREE.Group();
  group.name = 'Residence avenues moving traffic';
  const vehicles = planVehicles();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const material = createDistrictMaterial(night);
  const body = new THREE.InstancedMesh(box, material, vehicles.length);
  const cabin = new THREE.InstancedMesh(box, material, vehicles.length);
  const beamGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const beams = new THREE.InstancedMesh(beamGeometry, createRoadBeamMaterial(), vehicles.length * 2);
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
        gl_PointSize = clamp(uHeight * 1.46 / max(1.0, -view.z), 2.5, 7.4);
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
  beams.name = 'Moving headlight and taillight footprints on asphalt';
  const bound = new THREE.Sphere(new THREE.Vector3(192, asphaltLevel, 478), 1330);
  for (const mesh of [body, cabin, beams]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // One fixed bound covers the route network as individual cars move through it.
    mesh.boundingSphere = bound;
  }
  glow.boundingSphere = bound;
  const viewport = new THREE.Vector2();
  lamps.onBeforeRender = renderer => { viewHeight.value = renderer.getDrawingBufferSize(viewport).y; };
  lamps.renderOrder = 3;
  beams.renderOrder = 2;
  const color = new THREE.Color();
  for (const [i, car] of vehicles.entries()) {
    body.setColorAt(i, color.set(car.color));
    cabin.setColorAt(i, color.set(car.height > 2 ? 0xbabcb3 : 0x3f5360));
    beams.setColorAt(i * 2, color.set(i % 4 ? 0xffe3b3 : 0xd6eaff));
    beams.setColorAt(i * 2 + 1, color.set(0xdc1e0e));
    for (let light = 0; light < 4; light += 1) {
      color.set(light < 2 ? 0xfff4d9 : 0xff2b15);
      shades.setXYZ(i * 4 + light, color.r, color.g, color.b);
    }
  }
  group.add(body, cabin, beams, lamps);

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
      const distance = THREE.MathUtils.euclideanModulo(time - car.departure, car.cycle) * car.speed;
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
      const blend = THREE.MathUtils.smoothstep(distance, 0, 6)
        * (1 - THREE.MathUtils.smoothstep(distance, car.travel - 6, car.travel));
      const reach = 14.4 + (i % 4) * 1.3 + (delivery ? 3.5 : 0.0);
      const front = (length + reach) * 0.5;
      const rear = (length + 4.5) * 0.5;
      place(beams, i * 2, x + dx * front, asphaltLevel + 0.089, z + dz * front,
        width * 4.15, 1, reach, dx, dz, blend > 0.03 ? 1 : 0);
      place(beams, i * 2 + 1, x - dx * rear, asphaltLevel + 0.081, z - dz * rear,
        width * 2.72, 1, 4.5, -dx, -dz, blend > 0.03 ? 1 : 0);
      for (let light = 0; light < 4; light += 1) {
        const axial = (light < 2 ? 1 : -1) * (length * 0.5 + 0.24);
        const lateral = (light % 2 ? -1 : 1) * width * 0.32;
        positions.setXYZ(i * 4 + light, x + axial * dx + lateral * dz, asphaltLevel + 0.73,
          z + axial * dz - lateral * dx);
        energy.setX(i * 4 + light, blend * (light < 2 ? 1.0 : 0.91));
      }
    }
    body.instanceMatrix.needsUpdate = cabin.instanceMatrix.needsUpdate = true;
    if (night.value > 0) beams.instanceMatrix.needsUpdate = positions.needsUpdate = energy.needsUpdate = true;
  }

  lamps.visible = beams.visible = false;
  update(0);

  return {
    group,
    update,
    setNight(dark: boolean) {
      lamps.visible = beams.visible = dark;
    },
  };
}
