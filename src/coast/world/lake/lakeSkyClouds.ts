import * as THREE from 'three';
import { bindCoastSky, coastSkyGlsl, type CoastAtmosphere } from '../coastAtmosphere';
import { coastNoise } from '../coastNoise';
import { LAKE_SPAWN } from './lakeLayout';
import { lakeSkyRadianceGlsl } from './lakeSkyRadiance';

// Pixel bounds measured from the upper-left corner of the 1254 px square atlas.
// Each crop includes the low-opacity fringe around its cloud.
const atlasTiles = {
  tower: [9, 88, 620, 683],
  chain: [627, 164, 1250, 618],
  bank: [5, 794, 621, 1094],
  cluster: [633, 738, 1249, 1130],
} as const;

type CloudBank = {
  tile: keyof typeof atlasTiles;
  center: readonly [x: number, y: number, z: number];
  size: readonly [width: number, height: number];
  opacity: number;
  wind?: number;
};

// Metres and metres per second. Depth testing lets the distant banks show
// through the ring while the lower, nearer clouds break up its feet.
const banks: readonly CloudBank[] = [
  { tile: 'bank', center: [-125, 44, -344], size: [91, 54], opacity: 0.82, wind: 1.13 },
  { tile: 'cluster', center: [-67, 27, -382], size: [106, 53], opacity: 0.74, wind: 1.27 },
  { tile: 'bank', center: [74, 29, -403], size: [144, 44], opacity: 0.95, wind: 1.54 },
  { tile: 'chain', center: [221, 48, -365], size: [108, 69], opacity: 0.76, wind: 1.38 },
  // The distant cloud banks advance together in horizontal view coordinates.
  // The two upwind banks start behind the western cliffs. Their phases fill
  // the long gap between the clouds at the opposite ends of the valley.
  { tile: 'cluster', center: [-708, 94, -770], size: [179, 98], opacity: 0.88 },
  { tile: 'chain', center: [-514, 115, -788], size: [222, 121], opacity: 0.94 },
  { tile: 'chain', center: [-185, 106, -610], size: [210, 119], opacity: 0.94 },
  { tile: 'cluster', center: [-59, 92, -686], size: [174, 111], opacity: 0.98 },
  { tile: 'bank', center: [81, 84, -914], size: [240, 90], opacity: 0.87 },
  { tile: 'tower', center: [264, 148, -800], size: [212, 181], opacity: 0.99 },
  { tile: 'chain', center: [611, 127, -1095], size: [290, 138], opacity: 0.83 },
];
const distantDrift = 0.0032;
const distantHalfSpan = 0.95;

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
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  ${coastSkyGlsl}
  ${lakeSkyRadianceGlsl}

  void main() {
    vec4 cloud = texture2D(uCumulus, uAtlasTile.xy + vUv * uAtlasTile.zw);
    // Keep the asset's semi-transparent wisps and remove only residual atlas fringe.
    float baseFade = mix(0.63, 1.0, smoothstep(2.0, 31.0, vWorldPosition.y));
    float alpha = cloud.a * smoothstep(0.020, 0.047, cloud.a) * uOpacity * baseFade;
    if (alpha <= 0.004) discard;

    vec3 viewRay = vWorldPosition - cameraPosition;
    float distanceToCloud = length(viewRay);
    vec3 direction = viewRay / distanceToCloud;
    vec3 sky = lakeSkyRadiance(direction);
    float opticalDepth = distanceToCloud * (0.00027 + 0.00028 * exp(-max(0.0, vWorldPosition.y) / 105.0));
    float aerial = 1.0 - exp(-opticalDepth);
    vec3 daylight = cloud.rgb * vec3(1.32, 1.34, 1.36);
    vec3 aerialTint = mix(sky, vec3(0.57, 0.66, 0.75), 0.49);
    daylight = mix(daylight, aerialTint, aerial);

    float luma = dot(cloud.rgb, vec3(0.2126, 0.7152, 0.0722));
    float moonlight = pow(max(0.0, dot(direction, uCoastSunDirection)), 12.0);
    vec3 nightLight = sky * (0.40 + 0.51 * luma + 0.20 * aerial)
      + vec3(0.014, 0.019, 0.029) * luma * moonlight * uCoastMoonVisible;
    gl_FragColor = vec4(mix(daylight, nightLight, uCoastNight), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const cirrusFragmentShader = /* glsl */`
  uniform float uElapsed;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  ${coastSkyGlsl}
  ${lakeSkyRadianceGlsl}
  ${coastNoise}

  void main() {
    vec2 boundary = min(vUv, 1.0 - vUv);
    float edge = smoothstep(0.02, 0.19, min(boundary.x, boundary.y));
    vec2 drift = vWorldPosition.xz - vec2(7.0, -3.1) * uElapsed;
    vec2 wind = mat2(0.91, 0.41, -0.41, 0.91) * drift * 0.010;
    float bends = coastNoise(wind * 0.60 + 9.0);
    vec2 filaments = vec2(wind.x * 1.38, (wind.y + bends * 1.21) * 4.59);
    float fibers = 0.55 * coastNoise(filaments) + 0.30 * coastNoise(filaments * 2.13 + 7.0)
      + 0.15 * coastNoise(filaments * 5.23 + 3.0);
    float coverage = coastNoise(wind * vec2(0.55, 0.69) - 8.0) + 0.20 * coastNoise(wind * 1.51 + 17.0);
    float brokenPatches = coastNoise(wind * vec2(1.57, 0.93) + vec2(2.0, 13.0));
    vec3 direction = normalize(vWorldPosition - cameraPosition);
    float sunward = lakeSunwardSky(direction);
    float filamentDensity = smoothstep(0.43, 0.80, fibers) * smoothstep(0.37, 0.77, coverage)
      * smoothstep(0.24, 0.66, brokenPatches);
    float thinVeil = smoothstep(0.45, 0.78, coverage) * smoothstep(0.33, 0.69, fibers);
    float forwardLight = smoothstep(0.64, 1.0, sunward) * (1.0 - uCoastNight);
    float density = filamentDensity + (1.0 - filamentDensity) * thinVeil * forwardLight * 0.48;
    float alpha = edge * density * mix(0.54 + sunward * 0.29, 0.17, uCoastNight);
    if (alpha <= 0.004) discard;

    vec3 sky = lakeSkyRadiance(direction);
    vec3 daylight = mix(vec3(0.79, 0.86, 0.92), vec3(1.20, 1.18, 1.11), sunward);
    gl_FragColor = vec4(mix(daylight, sky * 0.70, uCoastNight), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const shoreMistFragmentShader = /* glsl */`
  uniform float uElapsed;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  ${coastSkyGlsl}
  ${lakeSkyRadianceGlsl}
  ${coastNoise}

  void main() {
    float advectedX = vWorldPosition.x - 1.28 * uElapsed;
    vec2 position = vec2(advectedX * 0.012, vWorldPosition.y * 0.051);
    float drift = coastNoise(position * vec2(0.60, 0.70) + 3.9);
    float folds = 0.79 * drift + 0.21 * coastNoise(position + vec2(0.0, 5.7));
    float side = 1.0 - smoothstep(0.39, 1.0, abs(vUv.x * 2.0 - 1.0));
    float ground = smoothstep(0.03, 0.20, vUv.y);
    float ceiling = 1.0 - smoothstep(0.21, 0.92, vUv.y + 0.20 * (folds - 0.5));
    float alpha = side * ground * ceiling * (0.57 + 0.43 * folds) * mix(0.65, 0.34, uCoastNight);
    if (alpha <= 0.004) discard;

    vec3 sky = lakeSkyRadiance(normalize(vWorldPosition - cameraPosition));
    vec3 daylight = mix(vec3(0.55, 0.64, 0.73), sky, 0.35);
    vec3 nightMist = mix(uCoastNightHorizon, sky, 0.29) * 0.78;
    gl_FragColor = vec4(mix(daylight, nightMist, uCoastNight), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function buildLakeSkyClouds(sky: THREE.Group, atmosphere: CoastAtmosphere) {
  const cloudMap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}lake-materials/lake-cumulus-atlas.webp`);
  cloudMap.colorSpace = THREE.SRGBColorSpace;
  const bankGeometry = new THREE.PlaneGeometry();
  // These single-sheet layers also render from below in the planar lake reflection.
  const layer = { side: THREE.DoubleSide, transparent: true, depthWrite: false } as const;
  const atlasSize = 1254;
  const cumulus = banks.map(bank => {
    const [left, top, right, bottom] = atlasTiles[bank.tile];
    const opacity = { value: bank.opacity };
    const material = new THREE.ShaderMaterial({
      ...layer,
      uniforms: {
        uCumulus: { value: cloudMap },
        uAtlasTile: { value: new THREE.Vector4(left / atlasSize, 1 - bottom / atlasSize,
          (right - left) / atlasSize, (bottom - top) / atlasSize) },
        uOpacity: opacity,
      },
      vertexShader: cloudVertexShader,
      fragmentShader: cumulusFragmentShader,
    });
    bindCoastSky(material.uniforms, atmosphere);
    const mesh = new THREE.Mesh(bankGeometry, material);
    mesh.name = 'Lake cumulus';
    mesh.position.set(...bank.center);
    mesh.scale.set(...bank.size, 1);
    sky.add(mesh);
    const distance = LAKE_SPAWN.z - bank.center[2];
    const halfSpan = bank.wind === undefined ? distance * distantHalfSpan : Math.abs(bank.center[2]) * 1.55;
    const speed = bank.wind ?? distance * distantDrift;
    return { bank, mesh, opacity, halfSpan, speed };
  });

  const elapsedTime = { value: 0 };
  const mistMaterial = new THREE.ShaderMaterial({
    ...layer,
    uniforms: { uElapsed: elapsedTime },
    vertexShader: cloudVertexShader,
    fragmentShader: shoreMistFragmentShader,
  });
  bindCoastSky(mistMaterial.uniforms, atmosphere);
  const mist = new THREE.Mesh(bankGeometry, mistMaterial);
  mist.name = 'Lake shore mist';
  mist.position.set(0, 26, -352);
  mist.scale.set(556, 78, 1);
  sky.add(mist);

  const cirrusGeometry = new THREE.PlaneGeometry(2330, 1650);
  const cirrusMaterial = new THREE.ShaderMaterial({
    ...layer,
    uniforms: { uElapsed: elapsedTime },
    vertexShader: cloudVertexShader,
    fragmentShader: cirrusFragmentShader,
  });
  bindCoastSky(cirrusMaterial.uniforms, atmosphere);
  const cirrus = new THREE.Mesh(cirrusGeometry, cirrusMaterial);
  cirrus.name = 'Lake cirrus';
  cirrus.rotation.x = Math.PI / 2;
  cirrus.position.set(14, 356, -1000);
  cirrus.renderOrder = -1;
  sky.add(cirrus);

  function update(elapsed: number): void {
    elapsedTime.value = elapsed;
    for (const { bank, mesh, opacity, halfSpan, speed } of cumulus) {
      const [startX, y] = bank.center;
      mesh.position.x = THREE.MathUtils.euclideanModulo(startX + elapsed * speed + halfSpan, 2 * halfSpan) - halfSpan;
      // The cloud fades beyond the main valley before returning upwind.
      opacity.value = bank.opacity * (1 - THREE.MathUtils.smoothstep(Math.abs(mesh.position.x) / halfSpan, 0.80, 1));
      mesh.lookAt(LAKE_SPAWN.x, y, LAKE_SPAWN.z);
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
