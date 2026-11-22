import * as THREE from 'three';
import type { CoastTimeOfDay } from '../coastAtmosphere';

const flights = [
  { centerX: -1350, centerZ: -15300, eastRadius: 8950, northRadius: 5820, altitude: 1760, phase: 2.17, rate: 0.022, scale: 0.94 },
  { centerX: 1700, centerZ: -15600, eastRadius: 7030, northRadius: 5200, altitude: 2490, phase: 4.29, rate: -0.026, scale: 1.12 },
  { centerX: 1980, centerZ: -14500, eastRadius: 7580, northRadius: 5300, altitude: 1510, phase: 1.30, rate: -0.025, scale: 0.82 },
  { centerX: 3200, centerZ: -15900, eastRadius: 9600, northRadius: 6550, altitude: 3190, phase: 5.42, rate: 0.021, scale: 1.05 },
  { centerX: 6100, centerZ: -13800, eastRadius: 7650, northRadius: 5450, altitude: 1990, phase: 1.00, rate: 0.024, scale: 0.90 },
] as const;

// White strobe and red beacon rates (flashes/minute), each with its own phase.
const flashTiming = [
  [60, 0.12, 57, 0.61],
  [56, 0.68, 61, 0.18],
  [63, 0.37, 59, 0.84],
  [58, 0.86, 63, 0.24],
  [61, 0.53, 55, 0.45],
] as const;

function flash(elapsed: number, flashesPerMinute: number, phase: number, hold: number, fade: number): number {
  const rate = flashesPerMinute / 60;
  const seconds = THREE.MathUtils.euclideanModulo(elapsed * rate + phase, 1) / rate;
  return THREE.MathUtils.smoothstep(seconds, 0, 0.012) * (1 - THREE.MathUtils.smoothstep(seconds, hold, fade));
}

function wing(outline: [number, number][], thickness: number): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))), {
    depth: thickness, bevelEnabled: false,
  });
}

export function createOverlookAirTraffic() {
  const group = new THREE.Group();
  group.name = 'Distant passenger aircraft';

  // Each aircraft points along its local negative Z axis.
  const fuselage = new THREE.LatheGeometry([
    [0, -27], [0.8, -23], [1.3, -17], [2.55, -7], [2.65, 17], [2.4, 22], [1.5, 25.3], [0, 28],
  ].map(([radius, length]) => new THREE.Vector2(radius, length)), 12).rotateX(-Math.PI / 2);
  const mainWing = wing([
    [-2, -8], [-22, 5], [-25, 9], [-25, 11], [-2, 6], [2, 6], [25, 11], [25, 9], [22, 5], [2, -8],
  ], 0.6).rotateX(Math.PI / 2).translate(0, -0.7, 0);
  const tailWing = wing([
    [-0.6, 16], [-10, 22.5], [-10.3, 24.5], [-0.6, 22.4],
    [0.6, 22.4], [10.3, 24.5], [10, 22.5], [0.6, 16],
  ], 0.38).rotateX(Math.PI / 2).translate(0, 0.6, 0);
  const tailFin = wing([
    [-15.5, 1.4], [-22, 9.3], [-24.7, 9.3], [-26.5, 0.6],
  ], 0.42).rotateY(Math.PI / 2).translate(-0.21, 0, 0);
  const engine = new THREE.CylinderGeometry(1.65, 1.30, 6.1, 10).rotateX(-Math.PI / 2);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xd2dae1, roughness: 0.66 });
  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0x9aaab9, roughness: 0.73 });

  const lamps = [
    { kind: 0, position: [-25.08, -0.65, 9.45], color: 0xf64e3e },
    { kind: 0, position: [25.08, -0.65, 9.45], color: 0x51df98 },
    { kind: 0, position: [0, 0.65, 27.3], color: 0xfaf0dc },
    { kind: 1, position: [-25.24, -1.12, 10.6], color: 0xf5f8ff },
    { kind: 1, position: [25.24, -1.12, 10.6], color: 0xf5f8ff },
    { kind: 1, position: [0, 0.12, 27.45], color: 0xf5f8ff },
    { kind: 2, position: [0, 2.75, -4.8], color: 0xff3d30 },
    { kind: 2, position: [0, -2.75, -2.8], color: 0xff3d30 },
  ];
  const lampGeometry = new THREE.BufferGeometry();
  lampGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lamps.flatMap(lamp => lamp.position), 3));
  lampGeometry.setAttribute('color', new THREE.Float32BufferAttribute(
    lamps.flatMap(lamp => new THREE.Color(lamp.color).toArray()), 3));
  lampGeometry.setAttribute('kind', new THREE.Float32BufferAttribute(lamps.map(lamp => lamp.kind), 1));
  const night = { value: 0 };
  const createLampMaterial = () => new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uNight: night, uFlashes: { value: new THREE.Vector2() } },
    vertexShader: /* glsl */`
      attribute float kind;
      uniform float uNight;
      uniform vec2 uFlashes;
      varying vec3 vLampColor;
      varying float vLampPower;
      void main() {
        vec4 eye = modelViewMatrix * vec4(position, 1.0);
        vec3 towardCamera = cameraPosition - modelMatrix[3].xyz;
        vec3 localView = normalize(vec3(dot(towardCamera, modelMatrix[0].xyz),
          dot(towardCamera, modelMatrix[1].xyz), dot(towardCamera, modelMatrix[2].xyz)));
        vec2 heading = normalize(localView.xz);
        float wingSide = heading.x * sign(position.x);
        bool tail = abs(position.x) < 0.01;
        float power;
        if (kind < 0.5) {
          float aft = smoothstep(0.30, 0.38, heading.y);
          float sector = tail ? aft : smoothstep(-0.06, 0.06, wingSide) * (1.0 - aft);
          power = 0.67 * uNight * sector;
          gl_PointSize = 2.8;
        } else if (kind < 1.5) {
          float sector = tail ? smoothstep(0.16, 0.67, heading.y)
            : smoothstep(-0.27, 0.25, wingSide) * (1.0 - smoothstep(0.62, 0.96, heading.y));
          power = uFlashes.x * mix(1.10, 1.42, uNight) * sector;
          gl_PointSize = 4.3;
        } else {
          float sector = smoothstep(-0.08, 0.12, localView.y * sign(position.y));
          power = uFlashes.y * mix(0.65, 0.97, uNight) * sector;
          gl_PointSize = 3.6;
        }
        vLampColor = color;
        vLampPower = min(0.98, power * exp(-length(eye.xyz) * 0.000028));
        gl_Position = projectionMatrix * eye;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vLampColor;
      varying float vLampPower;
      void main() {
        vec2 offset = gl_PointCoord - 0.5;
        float radius = dot(offset, offset);
        if (radius > 0.25 || vLampPower < 0.004) discard;
        gl_FragColor = vec4(vLampColor, vLampPower * exp(-18.0 * radius));
        #include <colorspace_fragment>
      }
    `,
  });

  const aircraft = flights.map(({ scale }) => {
    const model = new THREE.Group();
    model.scale.setScalar(scale);
    model.rotation.order = 'YXZ';
    model.add(new THREE.Mesh(fuselage, bodyMaterial), new THREE.Mesh(mainWing, wingMaterial),
      new THREE.Mesh(tailWing, wingMaterial), new THREE.Mesh(tailFin, wingMaterial));
    for (const side of [-1, 1]) {
      const nacelle = new THREE.Mesh(engine, bodyMaterial);
      nacelle.position.set(side * 10.4, -2.75, -0.9);
      model.add(nacelle);
    }
    const lights = new THREE.Points(lampGeometry, createLampMaterial());
    model.add(lights);
    group.add(model);
    return { model, lights };
  });

  function update(elapsed: number): void {
    for (const [i, { model, lights }] of aircraft.entries()) {
      const { centerX, centerZ, eastRadius, northRadius, altitude, phase, rate } = flights[i];
      const angle = phase + elapsed * rate;
      const sine = Math.sin(angle), cosine = Math.cos(angle);
      model.position.set(centerX + eastRadius * cosine, altitude + 85 * sine, centerZ + northRadius * sine);
      const vx = -eastRadius * sine * rate, vz = northRadius * cosine * rate;
      const speed = Math.hypot(vx, vz);
      const pitch = Math.atan2(85 * cosine * rate, speed);
      const bank = -Math.atan(eastRadius * northRadius * rate ** 3 / (9.81 * speed));
      model.rotation.set(pitch, Math.atan2(-vx, -vz), bank);
      const [strobeRate, strobePhase, beaconRate, beaconPhase] = flashTiming[i];
      lights.material.uniforms.uFlashes.value.set(
        flash(elapsed, strobeRate, strobePhase, 0.049, 0.100),
        flash(elapsed, beaconRate, beaconPhase, 0.066, 0.146),
      );
    }
  }
  update(0);

  return {
    group, update,
    setTimeOfDay(time: CoastTimeOfDay): void {
      night.value = Number(time === 'night');
    },
    dispose(): void {
      for (const geometry of [fuselage, mainWing, tailWing, tailFin, engine, lampGeometry]) geometry.dispose();
      for (const material of [bodyMaterial, wingMaterial]) material.dispose();
      for (const { lights } of aircraft) lights.material.dispose();
    },
  };
}
