import * as THREE from 'three';
import {
  RESIDENCE_CITY_BUILDINGS, RESIDENCE_DISTRICT_AREAS, RESIDENCE_STREET_LEVEL, RESIDENCE_TOWER, type DistrictBuilding,
} from './residenceCityPlan';

export const RESIDENCE_SUN = new THREE.Vector3(-0.66, 0.51, 0.55).normalize();
export const RESIDENCE_DAY_HAZE = new THREE.Color(0xaebbc1);
export const RESIDENCE_NIGHT_HAZE = new THREE.Color(0x252e3e);

export const DISTRICT_SURFACE = {
  solid: 0, asphalt: 1, pavement: 2, roof: 3, vegetation: 4, pavingStone: 5, solar: 6,
} as const;

type Night = THREE.IUniform<number>;

export function createDistrictShadows(additions: readonly DistrictBuilding[]) {
  const minX = Math.min(...RESIDENCE_DISTRICT_AREAS.map(area => area.minX));
  const maxX = Math.max(...RESIDENCE_DISTRICT_AREAS.map(area => area.maxX));
  const minZ = Math.min(...RESIDENCE_DISTRICT_AREAS.map(area => area.minZ));
  const maxZ = Math.max(...RESIDENCE_DISTRICT_AREAS.map(area => area.maxZ));
  const step = 1.75;
  const columns = Math.ceil((maxX - minX) / step);
  const rows = Math.ceil((maxZ - minZ) / step);
  const pixels = new Uint8Array(columns * rows * 2);
  const sunEast = -RESIDENCE_SUN.x, sunSouth = RESIDENCE_SUN.z;
  const contact = 5.0;
  const ceiling = 366;
  const tower = RESIDENCE_TOWER;
  for (const building of [...RESIDENCE_CITY_BUILDINGS, tower, ...additions]) {
    const height = building.height;
    const trace = height / RESIDENCE_SUN.y;
    // The base and the narrower shaft project different silhouettes into the street.
    const setback = building.height > 85 && building !== tower ? 2.4 : 0;
    const left = Math.max(0, Math.floor((building.minX - contact - minX) / step));
    const right = Math.min(columns, Math.ceil((building.maxX + trace * sunEast + contact - minX) / step));
    const north = Math.max(0, Math.floor((building.minZ - trace * sunSouth - contact - minZ) / step));
    const south = Math.min(rows, Math.ceil((building.maxZ + contact - minZ) / step));
    for (let row = north; row < south; row += 1) {
      const z = minZ + (row + 0.5) * step;
      for (let column = left; column < right; column += 1) {
        const x = minX + (column + 0.5) * step;
        const enter = Math.max(0, (x - building.maxX + setback) / sunEast, (building.minZ + setback - z) / sunSouth);
        const leave = Math.min(trace, (x - building.minX - setback) / sunEast, (building.maxZ - setback - z) / sunSouth);
        const gap = Math.hypot(Math.max(0, building.minX - x, x - building.maxX),
          Math.max(0, building.minZ - z, z - building.maxZ));
        const index = (row * columns + column) * 2;
        if (enter <= leave) {
          const shadeHeight = height - enter * RESIDENCE_SUN.y;
          pixels[index] = Math.max(pixels[index], Math.round(THREE.MathUtils.clamp(shadeHeight / ceiling, 0, 1) * 255));
        }
        const near = 1 - THREE.MathUtils.smoothstep(gap, 0, contact);
        pixels[index + 1] = Math.max(pixels[index + 1], Math.round(near * 255));
      }
    }
  }
  const texture = new THREE.DataTexture(pixels, columns, rows, THREE.RGFormat);
  texture.name = 'Building contact and sun occlusion by elevation';
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, ceiling, bounds: new THREE.Vector4(minX, minZ, columns * step, rows * step) };
}

export function createDistrictSurfaceTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let random = 209101;
  function sample(): number {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random / 4294967296;
  }
  const layers = [8, 16, 32, 128].map(period => ({
    period, noise: Array.from({ length: period * period }, sample),
  }));
  for (const [channel, { period, noise }] of layers.entries()) {
    const at = (x: number, y: number) => noise[y % period * period + x % period];
    for (let row = 0; row < size; row += 1) {
      const sy = row * period / size, y = Math.floor(sy);
      const fy = THREE.MathUtils.smoothstep(sy - y, 0, 1);
      for (let col = 0; col < size; col += 1) {
        const sx = col * period / size, x = Math.floor(sx);
        const fx = THREE.MathUtils.smoothstep(sx - x, 0, 1);
        const low = THREE.MathUtils.lerp(at(x, y), at(x + 1, y), fx);
        const high = THREE.MathUtils.lerp(at(x, y + 1), at(x + 1, y + 1), fx);
        data[(row * size + col) * 4 + channel] = THREE.MathUtils.lerp(low, high, fy) * 255;
      }
    }
  }
  const map = new THREE.DataTexture(data, size, size);
  map.name = 'District aggregate, joints and weathering';
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
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
  #ifdef DISTRICT_SURFACES
    attribute float districtSurface;
    flat varying float vSurface;
  #endif
  void main() {
    vec4 point = instanceMatrix * vec4(position, 1.0);
    vWorld = (modelMatrix * point).xyz;
    // The inverse squared lengths remove scale from the transformed tree and box normals.
    mat3 axes = mat3(instanceMatrix);
    vec3 squareScale = max(vec3(dot(axes[0], axes[0]), dot(axes[1], axes[1]), dot(axes[2], axes[2])), vec3(0.000001));
    vNormal = mat3(modelMatrix) * axes * (normal / squareScale);
    vColor = instanceColor;
    vUv = uv;
    #ifdef DISTRICT_FACADES
      vSpan = vec2(abs(normal.x) > 0.5 ? length(axes[2]) : length(axes[0]), length(axes[1]));
      vFacade = districtFacade;
    #endif
    #ifdef DISTRICT_SURFACES
      vSurface = districtSurface;
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

  float seam(float grid, float width, float aa) {
    float edge = abs(fract(grid + 0.5) - 0.5);
    return 1.0 - smoothstep(width, width + max(0.006, aa), edge);
  }
`;

const facadeLighting = /* glsl */`
  void applyFacade(inout vec3 day, inout vec3 night, vec3 normal, vec3 incident, float sun) {
    vec2 m = vUv * vSpan;
    float stone = 1.0 - step(0.5, vFacade.z);
    float glazed = 1.0 - step(0.5, abs(vFacade.z - 1.0));
    float balcony = 1.0 - step(0.5, abs(vFacade.z - 3.0));
    float lobby = step(3.5, vFacade.z);
    vec2 grid = m / vFacade.xy;
    vec2 footprint = fwidth(grid);
    vec2 aa = clamp(footprint * 0.55, vec2(0.003), vec2(0.19));
    vec2 cell = fract(grid);
    vec2 line = abs(cell - 0.5);
    vec2 limits = vec2(0.46 - 0.17 * stone - 0.07 * balcony, 0.32 + 0.128 * glazed + 0.109 * lobby);
    vec2 pane = 1.0 - smoothstep(limits - aa, limits + aa, line);
    float window = pane.x * pane.y;
    vec2 id = floor(grid) + vec2(vFacade.w, vFacade.w * 1.39) * 76.4;
    float floorChance = cellRandom(vec2(vFacade.w * 43.2, id.y));
    float individual = cellRandom(id);
    float visibleDetail = 1.0 - smoothstep(0.14, 0.39, max(aa.x, aa.y));

    // Metal fins, masonry courses and projecting slabs need different daylight response.
    vec4 grain = texture2D(uSurface, m * vec2(0.043, 0.025));
    float mineral = 0.83 + grain.r * 0.20 + grain.b * 0.11;
    float joint = seam(m.y * 1.89, 0.020, fwidth(m.y * 1.89));
    float horizontal = seam(grid.y - 0.095, 0.035, aa.y);
    float edgeHighlight = seam(grid.x + 0.455, 0.014, aa.x);
    float sill = seam(grid.y - (0.49 - limits.y), 0.021, aa.y) * pane.x;
    float solidShade = 0.89 + 0.11 * visibleDetail * (1.0 - horizontal);
    day *= mineral * solidShade * (1.0 - joint * visibleDetail * 0.15 * stone);
    day += vColor * (edgeHighlight * (0.10 + 0.36 * sun) * glazed + sill * (0.21 + 0.20 * sun) * stone);
    night *= mineral * (0.62 + sill * 0.38);

    // Reflected sky and the softer patterned silhouette of neighboring blocks.
    vec3 bumped = normalize(normal + vec3((grain.g - 0.5) * 0.014 * normal.z,
      (individual - 0.5) * 0.033 + (cell.y - 0.5) * 0.009, (grain.g - 0.5) * -0.014 * normal.x));
    vec3 reflected = reflect(-incident, bumped);
    float aboveHorizon = smoothstep(-0.42, 0.27, reflected.y);
    float fresnel = pow(1.0 - max(0.0, dot(incident, normal)), 3.6);
    vec2 reflectedPoint = vec2(reflected.x - reflected.z, reflected.y) + m * vec2(0.0008, 0.00045);
    vec4 panorama = texture2D(uSurface, reflectedPoint * 0.38 + vec2(vFacade.w * 0.1, 0.0));
    float cloud = smoothstep(0.48, 0.75, panorama.r * 0.58 + panorama.g * 0.42) * smoothstep(-0.17, 0.23, reflected.y);
    float skyline = smoothstep(-0.48, 0.14, reflected.y + (panorama.g - 0.5) * 0.31);
    vec3 groundGlare = mix(vec3(0.025, 0.054, 0.067), vec3(0.090, 0.130, 0.142), panorama.b);
    vec3 air = mix(vec3(0.40, 0.60, 0.69), vec3(0.119, 0.29, 0.45), aboveHorizon);
    air = mix(air, vec3(0.66, 0.71, 0.73), cloud * 0.82);
    vec3 sky = mix(groundGlare, air, skyline * (0.58 + 0.42 * aboveHorizon));
    float innerColumn = seam(grid.x * 2.0, 0.032, aa.x * 2.0) * (1.0 - 0.64 * stone);
    float coverage = mix(0.15, 0.54, cellRandom(id + 2.7));
    float shadeInGlass = (1.0 - smoothstep(coverage, coverage + aa.y, cell.y)) * step(0.60, individual);
    float slats = (1.0 - smoothstep(0.25, 0.67, fract(cell.y * 9.0))) * visibleDetail * shadeInGlass;
    float glint = pow(max(0.0, dot(reflected, uSun)), 76.0);
    vec3 glass = mix(vColor * mix(0.11, 0.28, glazed), sky, 0.24 + 0.39 * fresnel + 0.15 * glazed)
      + vec3(0.74, 0.62, 0.40) * glint * glazed;
    glass *= 0.81 + 0.33 * individual;
    glass = mix(glass, day * 0.75, shadeInGlass * (0.30 + slats * 0.22));
    glass *= 1.0 - innerColumn * (0.23 + 0.25 * stone);
    day = mix(day, glass, window);

    float railing = balcony * (1.0 - smoothstep(0.35, 0.41, cell.y)) * pane.x;
    day *= 1.0 - railing * 0.34;
    if (uNight > 0.0) {
      // Neighboring rooms can belong to a single tenant, but an individual bay still varies.
      float buildingUse = cellRandom(vec2(vFacade.w * 96.7, vFacade.z + 33.4));
      float tenant = cellRandom(floor((id + vec2(9.8, 4.3)) * vec2(0.48 + 0.22 * balcony, 0.68)) + 43.0);
      float occupied = smoothstep(0.43, 0.76, individual * (0.57 + 0.10 * balcony)
        + tenant * (0.29 - 0.10 * balcony) + buildingUse * 0.18 + floorChance * 0.065);
      float groundLobby = lobby * (1.0 - smoothstep(5.2, 10.0, vWorld.y - uStreetLevel));
      float entry = groundLobby * smoothstep(0.21, 0.77, tenant * 0.60 + individual * 0.40);
      float upperRoom = step(0.83, buildingUse) * glazed * step(73.0, vWorld.y - uStreetLevel)
        * smoothstep(0.89, 0.97, vUv.y) * smoothstep(0.52, 0.86, individual);
      float equipment = (1.0 - smoothstep(0.76, 0.96, cell.y)) * (0.50 + 0.50 * smoothstep(0.20, 0.61, cell.y));
      float sources = exp(-abs(cell.y - (0.66 + individual * 0.11)) * 27.0)
        * (1.0 - smoothstep(0.31, 0.47, line.x)) * visibleDetail;
      float tint = cellRandom(id + vec2(27.3, 63.0)) * 0.62 + tenant * 0.38;
      vec3 warm = mix(vec3(1.0, 0.61, 0.33), vec3(0.93, 0.76, 0.57), individual);
      vec3 neutral = mix(vec3(0.77, 0.86, 1.0), vec3(0.96, 0.91, 0.76), tint);
      vec3 electric = mix(warm, neutral, smoothstep(0.24, 0.82, tint) * (1.0 - 0.65 * balcony));
      electric = mix(electric, vec3(1.0, 0.68, 0.39), entry * 0.73);
      float glow = max(occupied, entry * 0.82) * (0.061 + equipment * (0.14 + 0.08 * glazed) + sources * 0.24)
        + 0.05 * upperRoom;
      glow *= (1.0 - 0.60 * shadeInGlass) * (1.0 - innerColumn * 0.41);
      // Blend individual lights into groups as a pane approaches a pixel in size.
      // The mean glow keeps the façade luminous when even the groups are subpixel.
      float fixtureDetail = 1.0 - smoothstep(0.22, 0.68, max(footprint.x, footprint.y));
      vec2 groupSpan = vec2(2.0, 2.4);
      vec2 groupedGrid = (grid + vec2(0.0, 0.48)) / groupSpan;
      vec2 groupedFootprint = footprint / groupSpan;
      vec2 groupId = floor(groupedGrid) + vec2(vFacade.w * 61.0, vFacade.w * 27.0);
      float groupUse = cellRandom(groupId + 9.7);
      vec2 groupBounds = vec2(0.30, 0.23);
      vec2 groupFilter = clamp(groupedFootprint * 0.57, vec2(0.003), vec2(0.34));
      vec2 groupPane = 1.0 - smoothstep(groupBounds - groupFilter, groupBounds + groupFilter,
        abs(fract(groupedGrid) - 0.5));
      float groupVisibility = 1.0 - smoothstep(0.46, 1.05, max(groupedFootprint.x, groupedFootprint.y));
      float groupLevel = mix(0.28, 0.80 + 4.0 * groupPane.x * groupPane.y, groupUse);
      float averageGlow = mix(0.050, 0.108, buildingUse) * (1.0 + 0.12 * glazed - 0.15 * balcony);
      float groupTint = mix(buildingUse * 0.5, groupUse, groupVisibility) * (1.0 - 0.65 * balcony);
      vec3 averageElectric = mix(vec3(0.99, 0.68, 0.48), vec3(0.84, 0.86, 0.91), groupTint);
      vec3 filteredLight = averageGlow * averageElectric * (4.0 * limits.x * limits.y)
        * mix(1.0, groupLevel, groupVisibility);
      vec3 detailedLight = glow * electric * window * (1.0 - railing * 0.56);
      vec2 paneDetail = 1.0 - smoothstep(vec2(0.35), vec2(0.88), footprint);
      vec2 filteredPane = mix(2.0 * limits, pane, paneDetail);
      float filteredRail = balcony * mix(0.38, 1.0 - smoothstep(0.35, 0.41, cell.y), paneDetail.y) * filteredPane.x;
      night = mix(night, vec3(0.0027, 0.0050, 0.0084), filteredPane.x * filteredPane.y) * (1.0 - filteredRail * 0.56);
      night += mix(filteredLight, detailedLight, fixtureDetail);
    }
  }
`;

type DistrictOptions = {
  facades?: boolean;
  surface?: THREE.Texture;
  shade?: ReturnType<typeof createDistrictShadows>;
  paving?: boolean;
};

export function createDistrictMaterial(night: Night, { facades, surface, shade, paving }: DistrictOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { ...(facades && { DISTRICT_FACADES: 1 }), ...(paving && { DISTRICT_SURFACES: 1 }),
      ...(shade && { DISTRICT_SHADE: 1 }), ...(surface && { DISTRICT_MAP: 1 }) },
    uniforms: {
      uNight: night, uSun: { value: RESIDENCE_SUN },
      uDayHaze: { value: RESIDENCE_DAY_HAZE }, uNightHaze: { value: RESIDENCE_NIGHT_HAZE },
      uStreetLevel: { value: RESIDENCE_STREET_LEVEL },
      ...(surface && { uSurface: { value: surface } }),
      ...(shade && { uPavingShade: { value: shade.texture }, uPavingBounds: { value: shade.bounds },
        uShadeCeiling: { value: shade.ceiling } }),
    },
    vertexShader: commonVertex,
    fragmentShader: /* glsl */`
      uniform float uNight;
      uniform vec3 uSun;
      uniform vec3 uDayHaze;
      uniform vec3 uNightHaze;
      uniform float uStreetLevel;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec2 vUv;
      #ifdef DISTRICT_MAP
        uniform sampler2D uSurface;
      #endif
      #ifdef DISTRICT_FACADES
        varying vec2 vSpan;
        flat varying vec4 vFacade;
      #endif
      #ifdef DISTRICT_SURFACES
        flat varying float vSurface;
      #endif
      #ifdef DISTRICT_SHADE
        uniform sampler2D uPavingShade;
        uniform vec4 uPavingBounds;
        uniform float uShadeCeiling;
      #endif
      ${random}
      #ifdef DISTRICT_FACADES
        ${facadeLighting}
      #endif
      void main() {
        vec3 normal = normalize(vNormal);
        vec3 towardEye = cameraPosition - vWorld;
        float distanceToEye = length(towardEye);
        vec3 incident = towardEye / max(distanceToEye, 0.01);
        float sun = max(dot(normal, uSun), 0.0);
        float roof = max(normal.y, 0.0);
        float daylight = 1.0;
        float contact = 0.0;
        #ifdef DISTRICT_SHADE
          vec2 pavingUv = (vWorld.xz - uPavingBounds.xy) / uPavingBounds.zw;
          vec2 obstruction = texture2D(uPavingShade, pavingUv).rg;
          obstruction *= step(0.0, pavingUv.x) * step(0.0, pavingUv.y) * step(pavingUv.x, 1.0) * step(pavingUv.y, 1.0);
          float height = vWorld.y - uStreetLevel;
          daylight = 1.0 - smoothstep(1.6, 6.3, obstruction.r * uShadeCeiling - height);
          contact = obstruction.g * (1.0 - smoothstep(0.15, 10.0, height));
        #endif
        vec3 skyLight = mix(vec3(0.39, 0.46, 0.56), vec3(0.53, 0.60, 0.69), roof);
        vec3 day = vColor * (skyLight * (1.0 - contact * 0.48)
          + sun * daylight * vec3(1.02, 0.84, 0.66));
        vec3 night = vColor * (vec3(0.051, 0.063, 0.082) + roof * 0.026) + vec3(0.0014, 0.0020, 0.0031);
        #ifdef DISTRICT_FACADES
          if (roof < 0.1) applyFacade(day, night, normal, incident, sun * daylight);
        #endif
        #ifdef DISTRICT_MAP
          #ifdef DISTRICT_SURFACES
            float terrain = vSurface;
          #else
            float terrain = 0.0;
          #endif
          if (roof > 0.08 && terrain > 0.49) {
            vec2 groundPoint = vWorld.xz;
            vec4 aggregate = texture2D(uSurface, groundPoint * 0.038);
            vec4 fine = texture2D(uSurface, groundPoint * 0.137);
            float pavement = 1.0 - step(0.49, abs(terrain - 2.0));
            float membrane = 1.0 - step(0.49, abs(terrain - 3.0));
            float plant = 1.0 - step(0.49, abs(terrain - 4.0));
            float stonePaving = 1.0 - step(0.49, abs(terrain - 5.0));
            float solar = step(5.5, terrain);
            float asphalt = 1.0 - step(0.49, abs(terrain - 1.0));
            float wear = smoothstep(0.45, 0.71, aggregate.r * 0.66 + aggregate.g * 0.34) * 0.28
              + (aggregate.b - 0.5) * 0.16 + (fine.a - 0.5) * 0.20;
            vec2 tile = groundPoint / mix(vec2(1.8, 1.4), vec2(2.8, 3.5), membrane);
            vec2 aa = fwidth(tile) * 0.42;
            vec2 offsetTile = vec2(tile.x + mod(floor(tile.y), 2.0) * 0.5, tile.y);
            float seams = max(seam(offsetTile.x, 0.024, aa.x), seam(tile.y, 0.032, aa.y));
            float slab = cellRandom(floor(offsetTile));
            wear += (pavement + membrane + stonePaving) * (slab - 0.5) * 0.23;
            wear -= seams * (pavement * 0.20 + membrane * 0.19 + stonePaving * 0.22);
            float patches = seam(groundPoint.x * 0.39 + (aggregate.r - 0.5) * 0.12, 0.038, fwidth(groundPoint.x) * 0.12);
            wear -= asphalt * (patches * 0.075 + 0.12 * smoothstep(0.37, 0.48, aggregate.r));
            day *= 0.95 + wear;
            night *= 0.94 + wear * 0.69;
            day = mix(day, day * vec3(0.64, 0.79, 1.08), plant * (0.25 + 0.30 * aggregate.b));
            float glassReflection = pow(max(0.0, dot(reflect(-incident, normal), uSun)), 24.0);
            day += solar * (glassReflection * vec3(0.37, 0.47, 0.60) + vec3(0.026, 0.05, 0.081))
              * (1.0 - 0.71 * seams);
          }
        #endif
        vec3 color = mix(day, night, uNight);
        color = mix(mix(uDayHaze, uNightHaze, uNight), color, exp(-distanceToEye * 0.000109));
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
        vec2 p = vUv * 2.0 - 1.0;
        float radius = length(p);
        float spread = exp(-radius * radius * 2.75) * (1.0 - smoothstep(0.27, 1.0, radius));
        gl_FragColor = vec4(vColor * 0.76, spread * 0.46);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
