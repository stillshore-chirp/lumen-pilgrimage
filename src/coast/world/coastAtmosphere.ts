import * as THREE from 'three';

export const COAST_SUN_DIRECTION = new THREE.Vector3(0.669, 0.556, -0.493).normalize();

const solarAngularRadius = THREE.MathUtils.degToRad(0.265);
const planetRadius = 6360;
const atmosphereRadius = 6460;
const observerHeight = 0.025;
const rayleighExtinction = [0.005802, 0.013558, 0.033100];
const aerosolScattering = 0.0085;
const aerosolExtinction = 0.0096;
const aerosolAnisotropy = 0.74;
const solarRadiance = 19;
const skyWidth = 128;
const skyHeight = 64;

function distanceToTop(radius: number, zenithCosine: number): number {
  const radial = radius * zenithCosine;
  return Math.sqrt(radial * radial + atmosphereRadius ** 2 - radius ** 2) - radial;
}

function altitudeAlongRay(radius: number, cosine: number, distance: number): number {
  return Math.max(0, Math.sqrt(radius ** 2 + distance ** 2 + 2 * radius * cosine * distance) - planetRadius);
}

function opticalDepth(radius: number, cosine: number): [number, number] {
  const length = distanceToTop(radius, cosine);
  let rayleigh = 0;
  let aerosol = 0;
  for (let i = 0; i < 10; i += 1) {
    const from = length * (i / 10) ** 2;
    const to = length * ((i + 1) / 10) ** 2;
    const altitude = altitudeAlongRay(radius, cosine, (from + to) * 0.5);
    rayleigh += Math.exp(-altitude / 8) * (to - from);
    aerosol += Math.exp(-altitude / 1.25) * (to - from);
  }
  return [rayleigh, aerosol];
}

function extinction(channel: number, rayleighDepth: number, aerosolDepth: number): number {
  return Math.exp(-rayleighExtinction[channel] * rayleighDepth - aerosolExtinction * aerosolDepth);
}

function createSkyTexture(sunDirection: THREE.Vector3): THREE.DataTexture {
  // Single scattering integrated once for the fixed sun, with denser samples near the horizon.
  // Rayleigh/aerosol scale heights, extinction and phase functions follow the atmosphere models
  // described by Hillaire (2020) and Bruneton/Neyret (2008), with coastal aerosol loading.
  const pixels = new Uint16Array(skyWidth * skyHeight * 4);
  const radius = planetRadius + observerHeight;
  const sunHorizontal = Math.sqrt(1 - sunDirection.y ** 2);
  for (let y = 0; y < skyHeight; y += 1) {
    const viewUp = (y / (skyHeight - 1)) ** 2;
    const viewHorizontal = Math.sqrt(1 - viewUp ** 2);
    const length = distanceToTop(radius, viewUp);
    for (let x = 0; x < skyWidth; x += 1) {
      const azimuth = Math.PI * x / (skyWidth - 1);
      const angle = Math.cos(azimuth) * sunHorizontal * viewHorizontal + sunDirection.y * viewUp;
      const rayleighPhase = 3 * (1 + angle ** 2) / (16 * Math.PI);
      const g = aerosolAnisotropy;
      const aerosolPhase = (1 - g ** 2) / (4 * Math.PI * (1 + g ** 2 - 2 * g * angle) ** 1.5);
      let viewRayleigh = 0;
      let viewAerosol = 0;
      // Approximate the diffuse contribution of subsequent scattering orders.
      const radiance = [0.028, 0.058, 0.094];
      for (let i = 0; i < 24; i += 1) {
        const from = length * (i / 24) ** 2;
        const to = length * ((i + 1) / 24) ** 2;
        const middle = (from + to) * 0.5;
        const altitude = altitudeAlongRay(radius, viewUp, middle);
        const stepRayleigh = Math.exp(-altitude / 8) * (to - from);
        const stepAerosol = Math.exp(-altitude / 1.25) * (to - from);
        const localSunUp = (radius * sunDirection.y + middle * angle) / (planetRadius + altitude);
        const [sunRayleigh, sunAerosol] = opticalDepth(planetRadius + altitude, localSunUp);
        for (let c = 0; c < 3; c += 1) {
          const throughAir = extinction(c, sunRayleigh + viewRayleigh + 0.5 * stepRayleigh,
            sunAerosol + viewAerosol + 0.5 * stepAerosol);
          radiance[c] += solarRadiance * throughAir * (
            rayleighExtinction[c] * stepRayleigh * rayleighPhase + aerosolScattering * stepAerosol * aerosolPhase);
        }
        viewRayleigh += stepRayleigh;
        viewAerosol += stepAerosol;
      }
      const offset = 4 * (y * skyWidth + x);
      for (let c = 0; c < 3; c += 1) pixels[offset + c] = THREE.DataUtils.toHalfFloat(radiance[c]);
      pixels[offset + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const texture = new THREE.DataTexture(pixels, skyWidth, skyHeight, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.name = 'Daylight scattering by elevation and solar azimuth';
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createCoastAtmosphere(sunDirection: THREE.Vector3) {
  const [rayleigh, aerosol] = opticalDepth(planetRadius + observerHeight, sunDirection.y);
  const direct = new THREE.Color(extinction(0, rayleigh, aerosol), extinction(1, rayleigh, aerosol),
    extinction(2, rayleigh, aerosol));
  return {
    sun: { value: sunDirection },
    sky: { value: createSkyTexture(sunDirection) },
    solarColor: { value: direct },
    submersion: { value: 0 },
  };
}

export type CoastAtmosphere = ReturnType<typeof createCoastAtmosphere>;

export const coastSkyGlsl = /* glsl */`
  uniform sampler2D uCoastSky;
  uniform vec3 uCoastSunDirection, uCoastSolarColor;

  vec3 coastSkyRadiance(vec3 direction) {
    vec2 horizontalSun = normalize(uCoastSunDirection.xz);
    float azimuthCosine = dot(direction.xz, horizontalSun) / max(length(direction.xz), 0.0001);
    float solarAzimuth = acos(clamp(azimuthCosine, -1.0, 1.0)) / 3.14159265;
    vec2 coordinate = vec2(solarAzimuth, sqrt(max(0.0, direction.y)));
    vec2 size = vec2(${skyWidth}.0, ${skyHeight}.0);
    return texture2D(uCoastSky, (0.5 + coordinate * (size - 1.0)) / size).rgb;
  }

  vec3 coastSunRadiance(vec3 direction) {
    float chord = length(direction - uCoastSunDirection);
    float radius = ${(2 * Math.sin(solarAngularRadius / 2)).toPrecision(8)};
    float feather = max(fwidth(chord) * 0.65, 0.00005);
    float disc = 1.0 - smoothstep(radius - feather, radius + feather, chord);
    float limb = sqrt(max(0.0, 1.0 - (chord / radius) * (chord / radius)));
    return uCoastSolarColor * (6.0 + 4.0 * limb) * disc;
  }
`;

export function bindCoastSky(uniforms: Record<string, THREE.IUniform>, atmosphere: CoastAtmosphere): void {
  uniforms.uCoastSunDirection = atmosphere.sun;
  uniforms.uCoastSky = atmosphere.sky;
  uniforms.uCoastSolarColor = atmosphere.solarColor;
}

export const coastAerialGlsl = /* glsl */`
  uniform float uCoastSubmersion;

  float coastForestAir(vec3 point) {
    float valley = smoothstep(117.0, 178.0, point.z) * (1.0 - smoothstep(390.0, 493.0, point.z))
      * (1.0 - smoothstep(125.0, 213.0, abs(point.x)));
    float floorHeight = 17.0 + max(0.0, point.z - 205.0) * 0.12;
    return valley * exp(-max(0.0, point.y - floorHeight) * 0.052);
  }

  vec3 coastApplyAerial(vec3 radiance, vec3 worldPoint) {
    vec3 ray = worldPoint - cameraPosition;
    float distanceToPoint = length(ray);
    if (distanceToPoint < 1.0 || uCoastSubmersion >= 1.0) return radiance;
    vec3 direction = ray / distanceToPoint;
    // Integrate marine air along the ray through an exponential vertical density profile.
    float eyeHeight = max(0.0, cameraPosition.y);
    float endpointHeight = max(0.0, worldPoint.y);
    float delta = abs(endpointHeight - eyeHeight) / 87.0;
    float seaDensity = exp(-min(eyeHeight, endpointHeight) / 87.0)
      * (delta > 0.005 ? (1.0 - exp(-delta)) / delta : 1.0 - 0.5 * delta);
    float valleyDensity = (coastForestAir(cameraPosition + ray * 0.17)
      + coastForestAir(cameraPosition + ray * 0.50)
      + coastForestAir(cameraPosition + ray * 0.83)) / 3.0;
    float opticalDepth = distanceToPoint * (0.00016 + 0.00088 * seaDensity + 0.00165 * valleyDensity);
    vec3 transmission = exp(-opticalDepth * vec3(0.89, 1.00, 1.15));
    vec3 sky = coastSkyRadiance(direction);
    // Nearby in-scattering receives both skylight and the local sun-facing aerosol lobe.
    vec3 inscatter = sky * (0.59 + 0.41 * smoothstep(320.0, 1800.0, distanceToPoint))
      * (1.0 - 0.47 * valleyDensity);
    vec3 inAir = radiance * transmission + inscatter * (1.0 - transmission);
    return mix(inAir, radiance, uCoastSubmersion);
  }
`;
