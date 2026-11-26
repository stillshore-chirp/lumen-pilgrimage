import * as THREE from 'three';
import { bindCoastSky, coastAerialGlsl, coastSkyGlsl, type CoastAtmosphere } from '../coastAtmosphere';
import { coastNoise } from '../coastNoise';
import { loadCoastTexture } from '../coastSurface';

// Crops of the project's cumulus atlas, normalized from its upper-left corner.
const atlasTiles = [
  [0, 0, 0.49, 0.49],
  [0.50, 0.134, 0.50, 0.305],
  [0, 0.56, 0.50, 0.38],
  [0.50, 0.59, 0.50, 0.34],
] as const;

type CloudBank = {
  tile: 0 | 1 | 2 | 3;
  center: readonly [x: number, y: number, z: number];
  size: readonly [width: number, height: number];
  opacity: number;
  wind: number;
  featherBase?: boolean;
};

// Each distance is in metres and wind is in m/s. The near banks pass in front
// of the ring's feet while the farther banks are seen through the opening.
const banks: readonly CloudBank[] = [
  { tile: 1, center: [9, 36, -382], size: [164, 53], opacity: 0.86, wind: 1.75, featherBase: true },
  { tile: 2, center: [-36, 89, -522], size: [144, 84], opacity: 0.95, wind: 2.25 },
  { tile: 1, center: [76, 70, -575], size: [150, 61], opacity: 0.86, wind: 2.50 },
  { tile: 2, center: [-187, 103, -590], size: [191, 87], opacity: 0.92, wind: 2.15 },
  { tile: 3, center: [-318, 104, -709], size: [232, 92], opacity: 0.82, wind: 2.80 },
  { tile: 0, center: [346, 164, -900], size: [294, 212], opacity: 0.99, wind: 3.15 },
  { tile: 2, center: [514, 136, -972], size: [264, 128], opacity: 0.93, wind: 3.45 },
  { tile: 1, center: [251, 56, -811], size: [309, 91], opacity: 0.88, wind: 2.75 },
  { tile: 3, center: [611, 96, -1040], size: [316, 67], opacity: 0.79, wind: 3.60 },
];

const cloudVertexShader = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const cumulusFragmentShader = /* glsl */`
  uniform sampler2D uCumulus;
  uniform vec4 uAtlasTile;
  uniform float uOpacity, uFeatherBase;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  ${coastSkyGlsl}
  ${coastAerialGlsl}

  void main() {
    vec4 cloud = texture2D(uCumulus, uAtlasTile.xy + vUv * uAtlasTile.zw);
    float underside = mix(1.0, smoothstep(0.015, 0.55, vUv.y), uFeatherBase);
    float alpha = smoothstep(0.04, 0.96, cloud.a) * uOpacity * underside;
    if (alpha <= 0.008) discard;

    vec3 direction = normalize(vWorldPosition - cameraPosition);
    float moonlight = pow(max(0.0, dot(direction, uCoastSunDirection)), 12.0);
    float luma = dot(cloud.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 daylight = cloud.rgb * vec3(1.15, 1.11, 1.07);
    vec3 nightLight = uCoastNightHorizon * (0.36 + 0.72 * luma)
      + vec3(0.0012, 0.0015, 0.0022) + vec3(0.020, 0.026, 0.038) * luma * moonlight;
    vec3 radiance = coastApplyAerial(mix(daylight, nightLight, uCoastNight), vWorldPosition);
    gl_FragColor = vec4(radiance, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const cirrusFragmentShader = /* glsl */`
  uniform float uElapsed;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  ${coastSkyGlsl}
  ${coastNoise}

  void main() {
    vec2 boundary = min(vUv, 1.0 - vUv);
    float edge = smoothstep(0.035, 0.19, min(boundary.x, boundary.y));
    vec2 drift = vWorldPosition.xz - vec2(6.0, -2.5) * uElapsed;
    vec2 wind = mat2(0.80, 0.60, -0.60, 0.80) * (drift * 0.010);
    float bends = coastNoise(wind * 0.54 + 9.0);
    vec2 filaments = vec2(wind.x * 1.23, (wind.y + bends * 1.20) * 3.45);
    float fibers = 0.54 * coastNoise(filaments) + 0.30 * coastNoise(filaments * 2.11 + 7.0)
      + 0.16 * coastNoise(filaments * 5.1 + 3.0);
    // Local patches interrupt the streaks and leave gaps of clear sky.
    float coverage = coastNoise(wind * vec2(0.59, 0.71) - 8.0);
    coverage += 0.22 * coastNoise(wind * 1.47 + 17.0);
    float density = smoothstep(0.43, 0.80, fibers) * smoothstep(0.42, 0.74, coverage);
    float alpha = edge * density * mix(0.81, 0.24, uCoastNight);
    if (alpha <= 0.008) discard;

    vec3 direction = normalize(vWorldPosition - cameraPosition);
    vec3 sky = coastSkyRadiance(direction);
    vec3 light = mix(mix(vec3(0.99, 1.05, 1.08), sky, 0.17), sky * 0.60, uCoastNight);
    gl_FragColor = vec4(light, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const shoreMistFragmentShader = /* glsl */`
  uniform float uElapsed;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  ${coastSkyGlsl}
  ${coastNoise}

  void main() {
    float advectedX = vWorldPosition.x - 1.85 * uElapsed;
    vec2 position = vec2(advectedX * 0.018, vWorldPosition.y * 0.062);
    float drift = coastNoise(position * vec2(0.56, 0.78) + vec2(3.9, 0.0));
    float folds = 0.72 * drift + 0.28 * coastNoise(position + vec2(0.0, 5.7));
    float side = 1.0 - smoothstep(0.39, 1.0, abs(vUv.x * 2.0 - 1.0));
    float ground = smoothstep(0.007, 0.27, vUv.y);
    float ceiling = 1.0 - smoothstep(0.27, 0.83, vUv.y + 0.27 * (folds - 0.5));
    float alpha = side * ground * ceiling * (0.51 + 0.49 * folds) * mix(0.56, 0.32, uCoastNight);
    if (alpha <= 0.008) discard;

    vec3 sky = coastSkyRadiance(normalize(vWorldPosition - cameraPosition));
    vec3 dayMist = mix(vec3(0.72, 0.78, 0.83), sky, 0.31);
    vec3 nightMist = mix(uCoastNightHorizon, sky, 0.25) * 0.88;
    gl_FragColor = vec4(mix(dayMist, nightMist, uCoastNight), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function buildLakeSkyClouds(sky: THREE.Group, atmosphere: CoastAtmosphere) {
  const cloudMap = loadCoastTexture('cumulus.webp');
  const bankGeometry = new THREE.PlaneGeometry();
  const cumulus = banks.map(bank => {
    const [left, top, width, height] = atlasTiles[bank.tile];
    const opacity = { value: bank.opacity };
    const material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uCumulus: { value: cloudMap },
        uAtlasTile: { value: new THREE.Vector4(left, 1 - top - height, width, height) },
        uOpacity: opacity,
        uFeatherBase: { value: Number(bank.featherBase ?? false) },
      },
      vertexShader: cloudVertexShader,
      fragmentShader: cumulusFragmentShader,
    });
    bindCoastSky(material.uniforms, atmosphere);
    material.uniforms.uCoastAerialDistanceScale = atmosphere.aerialDistanceScale;
    material.uniforms.uCoastSubmersion = atmosphere.submersion;
    const mesh = new THREE.Mesh(bankGeometry, material);
    mesh.name = 'Lake cumulus';
    mesh.position.set(...bank.center);
    mesh.scale.set(...bank.size, 1);
    sky.add(mesh);
    return { bank, mesh, opacity };
  });

  const elapsedTime = { value: 0 };
  const mistMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    uniforms: { uElapsed: elapsedTime },
    vertexShader: cloudVertexShader,
    fragmentShader: shoreMistFragmentShader,
  });
  bindCoastSky(mistMaterial.uniforms, atmosphere);
  // Placed on the lake side of the settlement to keep the veil in front of its walls.
  const mist = new THREE.Mesh(bankGeometry, mistMaterial);
  mist.name = 'Lake shore mist';
  mist.position.set(-34, 37, -369);
  mist.scale.set(530, 104, 1);
  sky.add(mist);

  const cirrusGeometry = new THREE.PlaneGeometry(2380, 1790);
  const cirrusMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    uniforms: { uElapsed: elapsedTime },
    vertexShader: cloudVertexShader,
    fragmentShader: cirrusFragmentShader,
  });
  bindCoastSky(cirrusMaterial.uniforms, atmosphere);
  const cirrus = new THREE.Mesh(cirrusGeometry, cirrusMaterial);
  cirrus.name = 'Lake cirrus';
  cirrus.rotation.x = Math.PI / 2;
  cirrus.position.set(18, 355, -1040);
  // The horizontal high layer spans both nearer and farther cumulus distances.
  cirrus.renderOrder = -1;
  sky.add(cirrus);

  function update(elapsed: number): void {
    elapsedTime.value = elapsed;
    for (const { bank, mesh, opacity } of cumulus) {
      const [startX, y, z] = bank.center;
      const halfSpan = Math.abs(z) * 1.55;
      mesh.position.x = THREE.MathUtils.euclideanModulo(startX + elapsed * bank.wind + halfSpan, 2 * halfSpan) - halfSpan;
      // Fade off the ends of each bank's path before it re-enters the valley.
      opacity.value = bank.opacity * (1 - THREE.MathUtils.smoothstep(Math.abs(mesh.position.x) / halfSpan, 0.80, 1));
      mesh.lookAt(0, y, 7);
    }
  }
  update(0);

  return {
    update,
    dispose(): void {
      cloudMap.dispose();
      bankGeometry.dispose();
      for (const { mesh } of cumulus) mesh.material.dispose();
      mistMaterial.dispose();
      cirrusGeometry.dispose();
      cirrusMaterial.dispose();
    },
  };
}
