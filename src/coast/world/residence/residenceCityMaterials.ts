import * as THREE from 'three';
import { RESIDENCE_CITY_AREAS, RESIDENCE_CITY_BUILDINGS, RESIDENCE_STREET_LEVEL } from './residenceCityPlan';

export const RESIDENCE_SUN = new THREE.Vector3(-0.66, 0.51, 0.55).normalize();
export const RESIDENCE_DAY_HAZE = new THREE.Color(0xaebbc1);
export const RESIDENCE_NIGHT_HAZE = new THREE.Color(0x252e3e);

type Night = THREE.IUniform<number>;

export function createDistrictShadows() {
  const minX = Math.min(...RESIDENCE_CITY_AREAS.map(area => area.minX));
  const minZ = Math.min(...RESIDENCE_CITY_AREAS.map(area => area.minZ));
  const step = 1.5;
  const columns = Math.ceil((Math.max(...RESIDENCE_CITY_AREAS.map(area => area.maxX)) - minX) / step);
  const rows = Math.ceil((Math.max(...RESIDENCE_CITY_AREAS.map(area => area.maxZ)) - minZ) / step);
  const pixels = new Uint8Array(columns * rows);
  const sunEast = -RESIDENCE_SUN.x, sunSouth = RESIDENCE_SUN.z;
  const contact = 7.0;
  const residence = { minX: -12, maxX: 22.8, minZ: -34, maxZ: 0, height: 215.5 };
  for (const building of [...RESIDENCE_CITY_BUILDINGS, residence]) {
    const trace = building.height / RESIDENCE_SUN.y;
    const left = Math.max(0, Math.floor((building.minX - contact - minX) / step));
    const right = Math.min(columns, Math.ceil((building.maxX + trace * sunEast + contact - minX) / step));
    const north = Math.max(0, Math.floor((building.minZ - trace * sunSouth - contact - minZ) / step));
    const south = Math.min(rows, Math.ceil((building.maxZ + contact - minZ) / step));
    for (let row = north; row < south; row += 1) {
      const z = minZ + (row + 0.5) * step;
      for (let column = left; column < right; column += 1) {
        const x = minX + (column + 0.5) * step;
        const enter = Math.max(0, (x - building.maxX) / sunEast, (building.minZ - z) / sunSouth);
        const leave = Math.min(trace, (x - building.minX) / sunEast, (building.maxZ - z) / sunSouth);
        const gap = Math.max(0, building.minX - x, x - building.maxX, building.minZ - z, z - building.maxZ);
        const near = 1 - THREE.MathUtils.smoothstep(gap, 0, contact);
        const index = row * columns + column;
        pixels[index] = Math.max(pixels[index], Math.round((enter <= leave ? 158 : 0) + 91 * near));
      }
    }
  }
  const texture = new THREE.DataTexture(pixels, columns, rows, THREE.RedFormat);
  texture.name = 'District sun and building-footprint shading';
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, bounds: new THREE.Vector4(minX, minZ, columns * step, rows * step) };
}

const commonVertex = /* glsl */`
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec2 vUv;
  #ifdef DISTRICT_FACADES
    attribute vec4 districtFacade;
    varying vec2 vSpan;
    flat varying vec4 vFacade;
  #endif
  void main() {
    vec4 point = instanceMatrix * vec4(position, 1.0);
    vWorld = (modelMatrix * point).xyz;
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vColor = instanceColor;
    vUv = uv;
    #ifdef DISTRICT_FACADES
      vSpan = vec2(abs(normal.x) > 0.5 ? length(instanceMatrix[2].xyz) : length(instanceMatrix[0].xyz),
        length(instanceMatrix[1].xyz));
      vFacade = districtFacade;
    #endif
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }
`;

const random = /* glsl */`
  float cellRandom(vec2 p) {
    vec3 value = fract(vec3(p.xyx) * 0.1031);
    value += dot(value, value.yzx + 33.33);
    return fract((value.x + value.y) * value.z);
  }
`;

export function createDistrictMaterial(night: Night, facades = false, shade?: ReturnType<typeof createDistrictShadows>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: facades ? { DISTRICT_FACADES: 1 } : shade ? { DISTRICT_SHADE: 1 } : {},
    uniforms: {
      uNight: night, uSun: { value: RESIDENCE_SUN },
      uDayHaze: { value: RESIDENCE_DAY_HAZE }, uNightHaze: { value: RESIDENCE_NIGHT_HAZE },
      ...(shade && { uPavingShade: { value: shade.texture }, uPavingBounds: { value: shade.bounds },
        uStreetLevel: { value: RESIDENCE_STREET_LEVEL } }),
    },
    vertexShader: commonVertex,
    fragmentShader: /* glsl */`
      uniform float uNight;
      uniform vec3 uSun;
      uniform vec3 uDayHaze;
      uniform vec3 uNightHaze;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec2 vUv;
      #ifdef DISTRICT_FACADES
        varying vec2 vSpan;
        flat varying vec4 vFacade;
      #endif
      #ifdef DISTRICT_SHADE
        uniform sampler2D uPavingShade;
        uniform vec4 uPavingBounds;
        uniform float uStreetLevel;
      #endif
      ${random}
      void main() {
        vec3 normal = normalize(vNormal);
        vec3 towardEye = cameraPosition - vWorld;
        float distanceToEye = length(towardEye);
        float sun = max(dot(normal, uSun), 0.0);
        float roof = max(normal.y, 0.0);
        vec3 day = vColor * (vec3(0.49, 0.55, 0.65) + sun * vec3(0.75, 0.66, 0.53) + roof * 0.16);
        vec3 night = vColor * (vec3(0.042, 0.054, 0.074) + roof * 0.018) + vec3(0.001, 0.0017, 0.003);
        #ifdef DISTRICT_FACADES
          if (roof < 0.1 && vFacade.z < 2.5) {
            // A storey and bay grid with individually occupied suites, and different façade proportions.
            vec2 cells = vUv * vSpan / vFacade.xy;
            vec2 line = abs(fract(cells) - 0.5);
            vec2 aa = clamp(fwidth(cells) * 0.5, vec2(0.004), vec2(0.18));
            float glazed = step(0.5, vFacade.z) * (1.0 - step(1.5, vFacade.z));
            float ribbon = step(1.5, vFacade.z);
            vec2 end = mix(vec2(0.34, 0.34), vec2(0.476, 0.432), glazed);
            end = mix(end, vec2(0.466, 0.30), ribbon);
            vec2 panes = 1.0 - smoothstep(end - aa, end + aa, line);
            float pane = panes.x * panes.y;
            vec2 window = floor(cells) + vec2(vFacade.w, vFacade.w * 1.39) * 73.3;
            float variation = cellRandom(window);
            vec3 incident = towardEye / max(distanceToEye, 0.01);
            vec3 reflected = reflect(-incident, normal);
            float reflectedSky = smoothstep(-0.35, 0.62, reflected.y);
            float edgeFresnel = pow(1.0 - clamp(dot(incident, normal), 0.0, 1.0), 3.0);
            vec3 sky = mix(vec3(0.094, 0.158, 0.17), vec3(0.26, 0.47, 0.57), reflectedSky);
            float elevationReflection = 0.70 + 0.30 * smoothstep(-27.0, 19.0, vWorld.y + reflected.x * 35.0);
            float glare = pow(max(0.0, dot(reflected, uSun)), 64.0);
            vec3 glass = vColor * (0.30 + variation * 0.09) + sky * (0.36 + 0.34 * edgeFresnel) * elevationReflection;
            glass += vec3(0.21, 0.17, 0.105) * glare;
            // Vertical blinds and neighboring floors create groups of dark and light rooms.
            float suite = cellRandom(floor(window * vec2(0.34, 0.72)) + 29.0);
            float working = smoothstep(0.57, 0.84, suite * 0.67 + variation * 0.48);
            float blind = step(0.83, variation) * (1.0 - smoothstep(0.14, 0.20, line.y));
            float tint = smoothstep(0.50, 0.92, cellRandom(floor(window * vec2(0.76, 0.49)) + 12.0));
            vec3 lit = mix(vec3(1.0, 0.70, 0.38), vec3(0.71, 0.85, 1.0), tint);
            float fittings = (1.0 - smoothstep(0.28, 0.32, line.x)) * smoothstep(0.18, 0.29, fract(cells.y));
            day = mix(day, glass * (1.0 - 0.19 * blind), pane);
            night = mix(night, vec3(0.0025, 0.004, 0.007) + lit * working * (0.21 + fittings * 0.32) * (1.0 - 0.66 * blind), pane);
          }
        #else
          // Broad patches read on the asphalt at street distance. Fine aggregate fades by projected pixel size.
          float pavingTone = cellRandom(floor(vWorld.xz * 0.71));
          float grain = cellRandom(floor(vWorld.xz * 11.0));
          float fine = 1.0 - smoothstep(0.11, 0.40, max(fwidth(vWorld.x), fwidth(vWorld.z)));
          day *= 1.0 + 0.048 * roof * (pavingTone - 0.5) + 0.095 * fine * roof * (grain - 0.5);
          #ifdef DISTRICT_SHADE
            vec2 pavingUv = (vWorld.xz - uPavingBounds.xy) / uPavingBounds.zw;
            float closeToStreet = 1.0 - smoothstep(0.55, 1.6, vWorld.y - uStreetLevel);
            float shade = texture2D(uPavingShade, pavingUv).r * closeToStreet;
            day *= mix(vec3(1.0), vec3(0.43, 0.50, 0.61), shade);
            night += roof * closeToStreet * vec3(0.0045, 0.0039, 0.0041);
          #endif
        #endif
        vec3 color = mix(day, night, uNight);
        color = mix(mix(uDayHaze, uNightHaze, uNight), color, exp(-distanceToEye * 0.000105));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

export function createStreetGlowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: commonVertex,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying vec2 vUv;
      void main() {
        float radius = length(vUv * 2.0 - 1.0);
        gl_FragColor = vec4(vColor, exp(-radius * radius * 4.8) * (1.0 - smoothstep(0.30, 1.0, radius)) * 0.27);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
