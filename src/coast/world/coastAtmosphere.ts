import * as THREE from 'three';

export const COAST_SUN_DIRECTION = new THREE.Vector3(0.669, 0.556, -0.493).normalize();
export type CoastTimeOfDay = 'day' | 'night';

const coastMoonDirection = new THREE.Vector3(0.25, 0.38, -0.89).normalize();
const moonlight = new THREE.Color(0.23, 0.31, 0.46);
const moonlitWater = new THREE.Color(0.12, 0.18, 0.28);

interface CoastAtmosphereOptions {
  nightHorizon?: THREE.ColorRepresentation;
  starVisibility?: number;
  moonDirection?: THREE.Vector3;
  aerialDistanceScale?: number;
}

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

export function createCoastAtmosphere(daySunDirection: THREE.Vector3, options: CoastAtmosphereOptions = {}) {
  const daytime = daySunDirection.clone().normalize();
  const nighttime = (options.moonDirection ?? coastMoonDirection).clone().normalize();
  const [rayleigh, aerosol] = opticalDepth(planetRadius + observerHeight, daytime.y);
  const direct = new THREE.Color(extinction(0, rayleigh, aerosol), extinction(1, rayleigh, aerosol),
    extinction(2, rayleigh, aerosol));
  const sun = { value: daytime.clone() };
  const solarColor = { value: direct.clone() };
  const night = { value: 0 };
  const surfaceLight = { value: new THREE.Color(1, 1, 1) };
  return {
    sun,
    sky: { value: createSkyTexture(daytime) },
    solarColor,
    night,
    surfaceLight,
    nightHorizon: { value: new THREE.Color(options.nightHorizon ?? 0x293a55) },
    starVisibility: { value: options.starVisibility ?? 1 },
    aerialDistanceScale: { value: options.aerialDistanceScale ?? 1 },
    submersion: { value: 0 },
    setTimeOfDay(time: CoastTimeOfDay): void {
      const dark = time === 'night';
      night.value = Number(dark);
      sun.value.copy(dark ? nighttime : daytime);
      solarColor.value.copy(dark ? moonlight : direct);
      if (dark) surfaceLight.value.copy(moonlitWater);
      else surfaceLight.value.setRGB(1, 1, 1);
    },
  };
}

export type CoastAtmosphere = ReturnType<typeof createCoastAtmosphere>;

export const coastSkyGlsl = /* glsl */`
  uniform sampler2D uCoastSky;
  uniform vec3 uCoastSunDirection, uCoastSolarColor, uCoastNightHorizon, uCoastSurfaceLight;
  uniform float uCoastNight;

  vec3 coastNightSky(vec3 direction) {
    float elevation = max(0.0, direction.y);
    float airMass = exp(-elevation * 5.5);
    float moonAngle = dot(direction, uCoastSunDirection);
    float halo = exp((moonAngle - 1.0) * 31.0) * 0.035 + exp((moonAngle - 1.0) * 480.0) * 0.13;
    return mix(vec3(0.006, 0.011, 0.026), uCoastNightHorizon, airMass)
      + vec3(0.62, 0.76, 1.0) * halo;
  }

  vec3 coastSkyRadiance(vec3 direction) {
    if (uCoastNight > 0.5) return coastNightSky(direction);
    vec2 horizontalSun = normalize(uCoastSunDirection.xz);
    float azimuthCosine = dot(direction.xz, horizontalSun) / max(length(direction.xz), 0.0001);
    float solarAzimuth = acos(clamp(azimuthCosine, -1.0, 1.0)) / 3.14159265;
    vec2 coordinate = vec2(solarAzimuth, sqrt(max(0.0, direction.y)));
    vec2 size = vec2(${skyWidth}.0, ${skyHeight}.0);
    return texture2D(uCoastSky, (0.5 + coordinate * (size - 1.0)) / size).rgb;
  }

  vec3 coastSunRadiance(vec3 direction) {
    float chord = length(direction - uCoastSunDirection);
    float radius = uCoastNight > 0.5 ? 0.0065 : ${(2 * Math.sin(solarAngularRadius / 2)).toPrecision(8)};
    float feather = max(fwidth(chord) * 0.65, 0.00005);
    float disc = 1.0 - smoothstep(radius - feather, radius + feather, chord);
    float limb = sqrt(max(0.0, 1.0 - (chord / radius) * (chord / radius)));
    if (uCoastNight > 0.5) {
      if (disc <= 0.0) return vec3(0.0);
      vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), uCoastSunDirection));
      vec3 north = cross(uCoastSunDirection, east);
      vec2 face = vec2(dot(direction, east), dot(direction, north)) / radius;
      // The larger dark plains remain discernible on the small lunar disc.
      float maria = 0.32 * exp(-12.0 * dot(face - vec2(-0.34, 0.23), face - vec2(-0.34, 0.23)));
      maria += 0.36 * exp(-9.0 * dot(face - vec2(0.26, 0.16), face - vec2(0.26, 0.16)));
      maria += 0.20 * exp(-21.0 * dot(face - vec2(0.33, -0.34), face - vec2(0.33, -0.34)));
      return vec3(0.91, 0.94, 1.0) * disc * (0.43 + 0.41 * limb - maria);
    }
    return uCoastSolarColor * (6.0 + 4.0 * limb) * disc;
  }
`;

export function bindCoastSky(uniforms: Record<string, THREE.IUniform>, atmosphere: CoastAtmosphere): void {
  uniforms.uCoastSunDirection = atmosphere.sun;
  uniforms.uCoastSky = atmosphere.sky;
  uniforms.uCoastSolarColor = atmosphere.solarColor;
  uniforms.uCoastNight = atmosphere.night;
  uniforms.uCoastNightHorizon = atmosphere.nightHorizon;
  uniforms.uCoastSurfaceLight = atmosphere.surfaceLight;
}

export const coastAerialGlsl = /* glsl */`
  uniform float uCoastSubmersion, uCoastAerialDistanceScale;

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
    float opticalPath = distanceToPoint * uCoastAerialDistanceScale;
    float opticalDepth = opticalPath * (0.00016 + 0.00088 * seaDensity + 0.00165 * valleyDensity);
    vec3 transmission = exp(-opticalDepth * vec3(0.89, 1.00, 1.15));
    vec3 sky = coastSkyRadiance(direction);
    // Nearby in-scattering receives both skylight and the local sun-facing aerosol lobe.
    float distanceFade = smoothstep(320.0, 1800.0, opticalPath);
    vec3 inscatter = sky * mix(0.59 + 0.41 * distanceFade, 0.45 + 0.37 * distanceFade, uCoastNight)
      * (1.0 - 0.47 * valleyDensity);
    vec3 inAir = radiance * transmission + inscatter * (1.0 - transmission);
    return mix(inAir, radiance, uCoastSubmersion);
  }
`;
