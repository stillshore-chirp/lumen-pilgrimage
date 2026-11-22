import * as THREE from 'three';
import { coastRandom } from '../terrain';
import { bindCoastSky, coastSkyGlsl, type CoastAtmosphere, type CoastTimeOfDay } from './coastAtmosphere';
import { loadCoastTexture } from './coastSurface';

const atlas = [
  { x: 0, y: 0, w: 0.49, h: 0.49 },
  { x: 0.50, y: 0.134, w: 0.50, h: 0.305 },
  { x: 0, y: 0.56, w: 0.50, h: 0.38 },
  { x: 0.50, y: 0.59, w: 0.50, h: 0.34 },
];

const cloudBanks = [
  { tile: 0, x: 88, y: 432, z: -1450, width: 615, height: 658, opacity: 1.0 },
  { tile: 1, x: -462, y: 409, z: -1320, width: 510, height: 245, opacity: 0.88 },
  { tile: 3, x: 535, y: 582, z: -1460, width: 620, height: 247, opacity: 0.83 },
  { tile: 1, x: 155, y: 115, z: -1680, width: 870, height: 250, opacity: 0.82 },
  { tile: 2, x: -990, y: 525, z: -1010, width: 510, height: 448, opacity: 0.92 },
  { tile: 0, x: 1140, y: 385, z: -577, width: 415, height: 463, opacity: 0.94 },
  { tile: 2, x: 1285, y: 315, z: 756, width: 565, height: 392, opacity: 0.95 },
  { tile: 0, x: -660, y: 385, z: 1267, width: 505, height: 570, opacity: 0.92 },
  { tile: 3, x: 160, y: 200, z: 1520, width: 740, height: 270, opacity: 0.85 },
  { tile: 0, x: 1318, y: 470, z: 1450, width: 668, height: 681, opacity: 0.96 },
  { tile: 2, x: 1030, y: 317, z: 1740, width: 540, height: 445, opacity: 0.87 },
  { tile: 3, x: 1550, y: 665, z: 1410, width: 726, height: 285, opacity: 0.84 },
  { tile: 1, x: -1290, y: 215, z: 166, width: 600, height: 315, opacity: 0.82 },
];

function createStars(atmosphere: CoastAtmosphere) {
  const random = coastRandom(21791);
  const positions: number[] = [];
  const photometry: number[] = [];
  for (let i = 0; i < 1900; i += 1) {
    const azimuth = random() * Math.PI * 2;
    const y = 0.012 + random() * 0.988;
    const horizontal = Math.sqrt(1 - y * y);
    positions.push(Math.cos(azimuth) * horizontal, y, Math.sin(azimuth) * horizontal);
    photometry.push(Math.pow(random(), 3.7), random());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('photometry', new THREE.Float32BufferAttribute(photometry, 2));
  const material = new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    uniforms: { uStarVisibility: atmosphere.starVisibility },
    vertexShader: /* glsl */`
      attribute vec2 photometry;
      varying vec3 vStarDirection;
      varying vec2 vPhotometry;
      void main() {
        vStarDirection = position;
        vPhotometry = photometry;
        gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position.z = gl_Position.w;
        gl_PointSize = 1.8 + 2.3 * photometry.x;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uStarVisibility;
      varying vec3 vStarDirection;
      varying vec2 vPhotometry;
      ${coastSkyGlsl}
      void main() {
        vec2 fromCenter = 2.0 * gl_PointCoord - 1.0;
        float radius = dot(fromCenter, fromCenter);
        float moonSeparation = 1.0 - dot(vStarDirection, uCoastSunDirection);
        if (radius >= 1.0 || moonSeparation <= 0.002) discard;
        float visibility = smoothstep(0.014, 0.43, vStarDirection.y) * smoothstep(0.002, 0.065, moonSeparation)
          * uStarVisibility;
        float energy = 0.013 + 0.44 * vPhotometry.x * vPhotometry.x;
        float intensity = energy * visibility * (1.0 - smoothstep(0.0, 1.0, radius));
        vec3 tint = mix(vec3(0.65, 0.8, 1.0), vec3(1.0, 0.84, 0.68), vPhotometry.y);
        gl_FragColor = vec4(coastNightSky(vStarDirection) + tint * intensity, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  bindCoastSky(material.uniforms, atmosphere);
  const stars = new THREE.Points(geometry, material);
  stars.name = 'Stars above the aerosol horizon';
  stars.renderOrder = -99;
  stars.frustumCulled = false;
  stars.visible = false;
  return stars;
}

export function createCoastSky(atmosphere: CoastAtmosphere, nightCloudOpacity = 0.53) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */`
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = position;
        gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vSkyDirection;
      ${coastSkyGlsl}
      void main() {
        vec3 direction = normalize(vSkyDirection);
        gl_FragColor = vec4(coastSkyRadiance(direction) + coastSunRadiance(direction), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  bindCoastSky(material.uniforms, atmosphere);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2170, 28, 18), material);
  dome.name = 'Open sky, sun and moon';
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  const stars = createStars(atmosphere);
  dome.add(stars);

  const texture = loadCoastTexture('cumulus.webp');
  const clouds = new THREE.Group();
  clouds.name = 'Cumulus and distant banks';
  const materials: { material: THREE.MeshBasicMaterial; daylight: THREE.Color; opacity: number }[] = [];
  for (const bank of cloudBanks) {
    const { x, y, w, h } = atlas[bank.tile];
    const geometry = new THREE.PlaneGeometry(bank.width, bank.height);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, x + w * uv.getX(i), 1 - y - h * (1 - uv.getY(i)));
    }
    const sunward = new THREE.Vector3(bank.x, 0, bank.z).normalize()
      .dot(atmosphere.sun.value);
    const cloud = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: texture, color: new THREE.Color(0.95 + 0.13 * sunward, 0.98 + 0.06 * sunward, 1.00 - 0.08 * sunward),
      transparent: true, opacity: bank.opacity, alphaTest: 0.018,
      side: THREE.DoubleSide, depthWrite: false, fog: false,
    }));
    materials.push({ material: cloud.material, daylight: cloud.material.color.clone(), opacity: bank.opacity });
    cloud.position.set(bank.x, bank.y, bank.z);
    cloud.lookAt(0, bank.y, 30);
    // Keep the distant planes behind nearby transparent spray.
    cloud.renderOrder = -20;
    clouds.add(cloud);
  }
  return {
    dome, clouds,
    setTimeOfDay(time: CoastTimeOfDay): void {
      const night = time === 'night';
      stars.visible = night && atmosphere.starVisibility.value > 0;
      for (const { material, daylight, opacity } of materials) {
        if (night) {
          material.color.copy(daylight).multiply(atmosphere.nightHorizon.value).multiplyScalar(1.3);
        } else {
          material.color.copy(daylight);
        }
        material.opacity = night ? opacity * nightCloudOpacity : opacity;
      }
    },
    dispose(): void {
      stars.geometry.dispose();
      material.dispose();
      stars.material.dispose();
      dome.geometry.dispose();
      for (const cloud of clouds.children) {
        if (cloud instanceof THREE.Mesh) cloud.geometry.dispose();
      }
      for (const { material } of materials) material.dispose();
      texture.dispose();
    },
  };
}
