import * as THREE from 'three';
import type { CoastTimeOfDay } from '../coastAtmosphere';

const flights = [
  { centerX: -1350, centerZ: -15300, eastRadius: 8950, northRadius: 5820, altitude: 1760, phase: 2.17, rate: 0.022, scale: 0.94 },
  { centerX: 1700, centerZ: -15600, eastRadius: 7030, northRadius: 5200, altitude: 2490, phase: 4.29, rate: -0.026, scale: 1.12 },
  { centerX: 1980, centerZ: -14500, eastRadius: 7580, northRadius: 5300, altitude: 1510, phase: 1.30, rate: -0.025, scale: 0.82 },
  { centerX: 3200, centerZ: -15900, eastRadius: 9600, northRadius: 6550, altitude: 3190, phase: 5.42, rate: 0.021, scale: 1.05 },
  { centerX: 6100, centerZ: -13800, eastRadius: 7650, northRadius: 5450, altitude: 1990, phase: 1.00, rate: 0.024, scale: 0.90 },
] as const;

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

  const lampGeometry = new THREE.BufferGeometry();
  lampGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -24.9, -0.64, 9.5, 24.9, -0.64, 9.5, 0, 0.65, 27.3,
  ], 3));
  const lampColors = [0xf64e3e, 0x51df98, 0xfaf0dc].flatMap(hex => new THREE.Color(hex).toArray());
  lampGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lampColors, 3));
  const lampMaterial = new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vLampColor;
      varying float vLampPower;
      void main() {
        vec4 eye = modelViewMatrix * vec4(position, 1.0);
        vLampColor = color;
        vLampPower = 0.67 * exp(-length(eye.xyz) * 0.000028);
        gl_Position = projectionMatrix * eye;
        gl_PointSize = 2.8;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vLampColor;
      varying float vLampPower;
      void main() {
        vec2 offset = gl_PointCoord - 0.5;
        float radius = dot(offset, offset);
        if (radius > 0.25) discard;
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
    const lamps = new THREE.Points(lampGeometry, lampMaterial);
    lamps.visible = false;
    model.add(lamps);
    group.add(model);
    return { model, lamps };
  });

  function update(elapsed: number): void {
    for (const [i, { model }] of aircraft.entries()) {
      const { centerX, centerZ, eastRadius, northRadius, altitude, phase, rate } = flights[i];
      const angle = phase + elapsed * rate;
      const sine = Math.sin(angle), cosine = Math.cos(angle);
      model.position.set(centerX + eastRadius * cosine, altitude + 85 * sine, centerZ + northRadius * sine);
      const vx = -eastRadius * sine * rate, vz = northRadius * cosine * rate;
      const speed = Math.hypot(vx, vz);
      const pitch = Math.atan2(85 * cosine * rate, speed);
      const bank = -Math.atan(eastRadius * northRadius * rate ** 3 / (9.81 * speed));
      model.rotation.set(pitch, Math.atan2(-vx, -vz), bank);
    }
  }
  update(0);

  return {
    group, update,
    setTimeOfDay(time: CoastTimeOfDay): void {
      for (const { lamps } of aircraft) lamps.visible = time === 'night';
    },
    dispose(): void {
      for (const geometry of [fuselage, mainWing, tailWing, tailFin, engine, lampGeometry]) geometry.dispose();
      for (const material of [bodyMaterial, wingMaterial, lampMaterial]) material.dispose();
    },
  };
}
