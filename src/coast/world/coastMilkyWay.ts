import * as THREE from 'three';

const tau = 2 * Math.PI;
const latitudeLimit = 0.39;
const galacticCenter = new THREE.Vector3(-0.101, 0.349, -0.932).normalize();
const east = new THREE.Vector3(-galacticCenter.z, 0, galacticCenter.x).normalize();
const north = new THREE.Vector3().crossVectors(east, galacticCenter);
const inclination = 0.83;
const galacticEquator = east.clone().multiplyScalar(Math.cos(inclination)).addScaledVector(north, Math.sin(inclination));
const galacticPole = new THREE.Vector3().crossVectors(galacticCenter, galacticEquator);

function lattice(x: number, y: number, salt: number): number {
  const cell = Math.imul(x, 374761393) + Math.imul(y, 668265263) + salt;
  const hash = Math.imul(cell ^ (cell >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}

function galacticNoise(u: number, v: number, columns: number, rows: number, salt: number): number {
  const x = u * columns, y = v * rows;
  const iy = Math.floor(y), ix = Math.floor(x);
  const left = ((ix % columns) + columns) % columns, right = (left + 1) % columns;
  const tx = x - ix, ty = y - iy;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(lattice(left, iy, salt), lattice(right, iy, salt), sx),
    THREE.MathUtils.lerp(lattice(left, iy + 1, salt), lattice(right, iy + 1, salt), sx), sy);
}

function galaxyDensity(u: number, latitude: number): { glow: number; warmth: number } {
  const longitude = (u - 0.5) * tau;
  const v = latitude / (latitudeLimit * 2) + 0.5;
  const bulge = Math.exp((Math.cos(longitude + 0.07) - 1) * 8.5);
  const starFields = 0.80 + 0.42 * Math.exp((Math.cos(longitude - 0.67) - 1) * 17);
  const sweep = 0.029 * Math.sin(longitude * 3 + 0.27) + 0.013 * Math.sin(longitude * 9 - 0.3);
  const coarse = galacticNoise(u, v, 39, 11, 56273);
  const folds = galacticNoise(u + 0.0018 * coarse, v, 99, 30, 61717);
  const knots = galacticNoise(u, v, 233, 67, 71819);
  const grain = galacticNoise(u, v, 523, 127, 91373);
  const offset = latitude - sweep - (coarse - 0.5) * 0.033;
  const disk = Math.exp(-((offset / (0.073 + bulge * 0.058)) ** 2));
  const envelope = Math.exp(-((offset / (0.136 + bulge * 0.041)) ** 2));
  const brokenRim = 0.43 + coarse * 0.35 + 0.11 * Math.sin(longitude * 5 + 0.42);
  const dustCenter = offset + 0.014 + (folds - 0.5) * 0.055 + 0.017 * Math.sin(longitude * 7 - 0.75);
  const mainRift = Math.exp(-((dustCenter / (0.014 + knots * 0.019)) ** 2)) * (0.66 + 0.33 * coarse);
  const dustBranches = THREE.MathUtils.smoothstep(folds * 0.70 + knots * 0.30, 0.46, 0.82)
    * Math.exp(-(((dustCenter - 0.047) / 0.069) ** 2)) * 0.74;
  const pockets = THREE.MathUtils.smoothstep(coarse + knots * 0.28, 0.31, 0.97);
  const starCloud = disk * (brokenRim * starFields + bulge * 1.22) * (0.12 + 0.53 * pockets + 0.35 * knots);
  const glow = envelope * (0.059 + 0.076 * coarse) * (1 - 0.62 * mainRift)
    + starCloud * (1 - 0.96 * mainRift) * (1 - dustBranches) * (0.66 + grain * 0.59);
  const edge = 1 - THREE.MathUtils.smoothstep(Math.abs(latitude), 0.27, latitudeLimit);
  return { glow: glow * edge, warmth: bulge * (0.40 + 0.54 * coarse) };
}

export function createCoastMilkyWay() {
  // Periodic longitude and a band that fades to zero outside its sampled latitudes.
  // The small radiance map is generated locally so every view uses the same sky.
  const width = 2048, height = 128;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const latitude = ((y + 0.5) / height * 2 - 1) * latitudeLimit;
    for (let x = 0; x < width; x += 1) {
      const { glow, warmth } = galaxyDensity((x + 0.5) / width, latitude);
      const brightness = Math.min(1, glow) * 255;
      const pixel = (y * width + x) * 4;
      data[pixel] = brightness * (0.68 + warmth * 0.30);
      data[pixel + 1] = brightness * (0.78 + warmth * 0.14);
      data[pixel + 2] = brightness * (1 - warmth * 0.18);
      data[pixel + 3] = 255;
    }
  }
  const radiance = new THREE.DataTexture(data, width, height);
  radiance.name = 'Procedural galactic disk and dark dust';
  radiance.wrapS = THREE.RepeatWrapping;
  radiance.minFilter = radiance.magFilter = THREE.LinearFilter;
  radiance.needsUpdate = true;
  const frame = new THREE.Matrix3().set(
    galacticCenter.x, galacticCenter.y, galacticCenter.z,
    galacticEquator.x, galacticEquator.y, galacticEquator.z,
    galacticPole.x, galacticPole.y, galacticPole.z);
  return { radiance, uniforms: { uGalaxyRadiance: { value: radiance }, uGalaxyFrame: { value: frame } } };
}

export function sampleGalacticStars(random: () => number, positions: number[], photometry: number[]): void {
  const direction = new THREE.Vector3();
  for (let i = 0; i < 22500; i += 1) {
    const u = random(), longitude = (u - 0.5) * tau;
    const latitude = ((random() + random() + random()) / 3 - 0.5) * 0.66;
    const { glow } = galaxyDensity(u, latitude);
    if (random() > 0.09 + 0.82 * glow) continue;
    const horizontal = Math.sqrt(1 - latitude * latitude);
    direction.copy(galacticCenter).multiplyScalar(Math.cos(longitude) * horizontal)
      .addScaledVector(galacticEquator, Math.sin(longitude) * horizontal)
      .addScaledVector(galacticPole, latitude);
    if (direction.y < 0.012) continue;
    positions.push(direction.x, direction.y, direction.z);
    photometry.push(0.04 + 0.62 * random() ** 3.8, random());
  }
}

export const coastMilkyWayGlsl = /* glsl */`
  uniform sampler2D uGalaxyRadiance;
  uniform mat3 uGalaxyFrame;

  vec3 coastMilkyWay(vec3 direction) {
    vec3 galactic = uGalaxyFrame * direction;
    if (abs(galactic.z) >= ${latitudeLimit} || uCoastNight < 0.5) return vec3(0.0);
    vec2 uv = vec2(atan(galactic.y, galactic.x) * 0.159154943 + 0.5, galactic.z / ${latitudeLimit * 2} + 0.5);
    float horizon = smoothstep(0.055, 0.37, direction.y);
    float lunarGlare = smoothstep(0.003, 0.062, 1.0 - dot(direction, uCoastSunDirection));
    return texture2D(uGalaxyRadiance, uv).rgb * (0.155 * horizon * lunarGlare);
  }
`;
