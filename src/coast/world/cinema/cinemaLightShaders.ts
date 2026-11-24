import {
  CINEMA_LENS_SCATTER, CINEMA_LIGHT_BOUNCE, CINEMA_LIGHT_CROWN, CINEMA_LIGHT_DEPTH, CINEMA_LIGHT_META,
  CINEMA_LIGHT_NEAR, CINEMA_LIGHT_PAGES, CINEMA_PROJECTOR_CONTRAST, CINEMA_ROOM_RETURN,
} from './cinemaLightTransport';
import { CINEMA_COVE_LENS_X, CINEMA_COVE_LENS_Y, CINEMA_EXIT_LAMPS, CINEMA_STEP_MARKER_INSET, CINEMA_WALL_LENS_X } from './cinemaFixtureLighting';
import { CINEMA_AISLES, CINEMA_BOUNDS, CINEMA_CROSS_AISLES, CINEMA_ROOM_HEIGHT, CINEMA_SCREEN } from './cinemaLayout';

export const cinemaPassVertex = /* glsl */ `
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const picture = /* glsl */ `
  uniform sampler2D cinemaSource;
  uniform vec2 cinemaOpening;
  uniform float cinemaDecodeVideo;

  bool cinemaInOpening(vec2 uv) {
    return all(lessThanEqual(abs(uv - 0.5), cinemaOpening * 0.5));
  }

  vec3 cinemaProjectedPixel(vec2 uv, vec4 gradients) {
    vec2 sourceUV = (uv - 0.5) / cinemaOpening + 0.5;
    vec4 src = textureGrad(cinemaSource, sourceUV, gradients.xy, gradients.zw);
    // WebGL uses sRGB sampling for regular sRGB textures. Video uploads do not.
    if (cinemaDecodeVideo > 0.5) src = sRGBTransferEOTF(src);
    vec2 centered = uv * 2.0 - 1.0;
    float falloff = 1.0 - dot(centered * centered, vec2(0.15, 0.065));
    float black = 1.0 / ${CINEMA_PROJECTOR_CONTRAST}.0;
    return (vec3(black) + (1.0 - black) * src.rgb) * falloff;
  }
`;

export const cinemaTilesFragment = /* glsl */ `
  ${picture}
  uniform vec2 cinemaTiles;
  uniform float cinemaSamples;

  void main() {
    vec3 sum = vec3(0.0);
    float coverage = 0.0;
    vec2 cell = floor(gl_FragCoord.xy);
    for (int y = 0; y < 8; y++) {
      if (float(y) >= cinemaSamples) break;
      for (int x = 0; x < 8; x++) {
        if (float(x) >= cinemaSamples) break;
        vec2 at = (cell + (vec2(float(x), float(y)) + 0.5) / cinemaSamples) / cinemaTiles;
        if (cinemaInOpening(at)) {
          sum += cinemaProjectedPixel(at, vec4(0.0));
          coverage += 1.0;
        }
      }
    }
    float count = cinemaSamples * cinemaSamples;
    // The square-root encoding preserves darker levels in an RGBA8 render target.
    gl_FragColor = vec4(sqrt(max(sum / count, 0.0)), coverage / count);
  }
`;

export const cinemaTransportFragment = /* glsl */ `
  uniform sampler2D cinemaTileColors;
  uniform sampler2D cinemaWeights;
  uniform vec2 cinemaTiles;
  uniform vec2 cinemaProbes;
  uniform float cinemaAccurateBounce;
  uniform vec3 cinemaEye;
  uniform vec3 cinemaView;

  void main() {
    ivec2 at = ivec2(gl_FragCoord.xy);
    int columns = int(cinemaTiles.x);
    int count = columns * int(cinemaTiles.y);
    int page = at.x / int(cinemaProbes.x);
    int receiver = at.y * int(cinemaProbes.x) * ${CINEMA_LIGHT_PAGES} + at.x;
    bool meta = page == ${CINEMA_LIGHT_META};
    if (meta && (at.y != 0 || at.x % int(cinemaProbes.x) != 0)) {
      gl_FragColor = vec4(0.0);
      return;
    }
    bool scalarReturn = page == ${CINEMA_LIGHT_BOUNCE} && cinemaAccurateBounce < 0.5;
    vec3 sum = vec3(0.0);
    vec3 received = vec3(0.0);
    float openWeight = 0.0;
    float peak = 0.0;

    for (int index = 0; index < 448; index++) {
      if (index >= count) break;
      ivec2 cell = ivec2(index % columns, index / columns);
      vec4 packedTile = texelFetch(cinemaTileColors, cell, 0);
      vec3 energy = packedTile.rgb * packedTile.rgb;
      sum += energy;
      if (meta) {
        vec2 uv = (vec2(cell) + 0.5) / cinemaTiles;
        vec3 location = vec3((uv.x - 0.5) * ${CINEMA_SCREEN.width}.0,
          ${CINEMA_SCREEN.bottom} + uv.y * ${CINEMA_SCREEN.height}, 0.0);
        if (dot(normalize(location - cinemaEye), cinemaView) >= 0.62) {
          vec2 size = vec2(${CINEMA_SCREEN.width}.0, ${CINEMA_SCREEN.height});
          vec2 diameter = max(length(location - cinemaEye) * tan(radians(2.5)) * 2.0
            * cinemaTiles / size, vec2(1.0));
          // Sample a roughly five-degree neighborhood. Outside-screen texels are dark.
          vec2 radius = clamp(floor(diameter * 0.5), 0.0, 3.0);
          float local = 0.0;
          for (int y = -3; y <= 3; y++) {
            for (int x = -3; x <= 3; x++) {
              vec2 offset = vec2(float(x), float(y));
              if (any(greaterThan(abs(offset), radius))) continue;
              ivec2 tapAt = cell + ivec2(x, y);
              if (any(lessThan(tapAt, ivec2(0))) || any(greaterThanEqual(tapAt, ivec2(cinemaTiles)))) continue;
              vec3 tap = texelFetch(cinemaTileColors, tapAt, 0).rgb;
              local += dot(tap * tap, vec3(0.2126, 0.7152, 0.0722));
            }
          }
          float samples = (2.0 * radius.x + 1.0) * (2.0 * radius.y + 1.0);
          peak = max(peak, local / samples);
        }
      } else if (!scalarReturn) {
        float weight = texelFetch(cinemaWeights, ivec2(index, receiver), 0).r;
        received += weight * energy;
        openWeight += weight * packedTile.a;
      }
    }
    vec3 mean = sum / float(count);
    vec3 value = meta ? mean : scalarReturn ? mean * ${CINEMA_ROOM_RETURN}
      : (1.0 - ${CINEMA_LENS_SCATTER}) * received + ${CINEMA_LENS_SCATTER} * mean * openWeight;
    gl_FragColor = vec4(sqrt(clamp(value, 0.0, 1.0)), sqrt(clamp(peak, 0.0, 1.0)));
  }
`;

const atlas = /* glsl */ `
  uniform sampler2D cinemaLightPrev;
  uniform sampler2D cinemaLightNext;
  uniform vec2 cinemaProbes;
  uniform float cinemaLightBlend;
  uniform float cinemaLive;
  uniform vec3 cinemaLamps;

  vec3 cinemaAtlas(float page, vec2 coord) {
    // Probes are baked at cell centers. Clamp at a page's end texels to keep pages isolated.
    vec2 probe = clamp(coord * cinemaProbes, vec2(0.5), cinemaProbes - 0.5);
    vec2 center = vec2(page * cinemaProbes.x, 0.0) + probe;
    vec2 uv = center / (cinemaProbes * vec2(${CINEMA_LIGHT_PAGES}.0, 1.0));
    vec3 previous = texture2D(cinemaLightPrev, uv).rgb;
    vec3 latest = texture2D(cinemaLightNext, uv).rgb;
    return mix(previous * previous, latest * latest, cinemaLightBlend);
  }
`;

export const cinemaScreenPars = /* glsl */ `
  ${picture}
  ${atlas}
  uniform float cinemaProjectorWhite;
  uniform float cinemaSpill;
`;

export const cinemaScreenFragment = /* glsl */ `
  // The calibrated screen signal is kept in linear light through output encoding.
  // Define the sampling footprint before the aperture branch so the edge uses the picture's mip level.
  vec4 pictureGradients = vec4(dFdx(vMapUv), dFdy(vMapUv)) / cinemaOpening.xyxy;
  vec2 halfPixel = max(fwidth(vMapUv) * 0.5, vec2(1e-6));
  vec3 lightOnScreen = vec3(cinemaSpill);
  if (cinemaLive > 0.5) {
    vec2 halfOpening = cinemaOpening * 0.5;
    vec2 edgeCoverage = smoothstep(-halfPixel, halfPixel, halfOpening - abs(vMapUv - 0.5));
    // The geometry already antialiases any edges that fill the physical screen.
    edgeCoverage = mix(edgeCoverage, vec2(1.0), step(vec2(1.0), cinemaOpening));
    float coverage = edgeCoverage.x * edgeCoverage.y;
    lightOnScreen *= mix(0.035, 1.0, coverage);
    if (coverage > 0.0) {
      vec2 pictureUV = clamp(vMapUv, 0.5 - halfOpening, 0.5 + halfOpening);
      vec3 direct = cinemaProjectedPixel(pictureUV, pictureGradients);
      vec3 stray = cinemaAtlas(${CINEMA_LIGHT_META}.0, vec2(0.0));
      vec3 returned = cinemaAtlas(${CINEMA_LIGHT_BOUNCE}.0, vMapUv);
      lightOnScreen += cinemaProjectorWhite * coverage *
        ((1.0 - ${CINEMA_LENS_SCATTER}) * direct + ${CINEMA_LENS_SCATTER} * stray + returned);
    }
  } else {
    vec2 centered = vMapUv * 2.0 - 1.0;
    float coveWash = 0.78 + 0.14 * vMapUv.y + 0.17 * centered.x * centered.x;
    float roomWash = 0.83 + 0.17 * (1.0 - vMapUv.y);
    lightOnScreen = lightOnScreen * roomWash + vec3(1.0, 0.97, 0.93) * coveWash * (0.027 * cinemaLamps.x);
  }
  diffuseColor.rgb *= lightOnScreen;
`;

export const cinemaRoomVertex = /* glsl */ `
  #include <project_vertex>
  vec4 cinemaPosition = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    cinemaPosition = batchingMatrix * cinemaPosition;
  #endif
  #ifdef USE_INSTANCING
    cinemaPosition = instanceMatrix * cinemaPosition;
  #endif
  cinemaWorld = (modelMatrix * cinemaPosition).xyz;
`;

const aisleFalloff = CINEMA_AISLES.filter(({ x }) => x > 0)
  .map(({ x, width }) => `(1.0 - smoothstep(${width / 2 - 0.35}, ${width / 2 + 0.32}, abs(ax - ${x})))`)
  .join(' + ');

const stepMarkers = CINEMA_AISLES.filter(({ x }) => x > 0)
  .map(({ x, width }) => `(1.0 - smoothstep(0.09, 0.52, abs(abs(ax - ${x}) - ${width / 2 - CINEMA_STEP_MARKER_INSET})))`)
  .join(' + ');

const exitPools = CINEMA_EXIT_LAMPS.map(({ x, y, z }) => (
  `cinemaExitPool(p, n, vec3(${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}))`
)).join(' + ');

export const cinemaRoomPars = /* glsl */ `
  ${atlas}
  varying vec3 cinemaWorld;
  uniform sampler2D cinemaSteps;
  uniform float cinemaProjectorWhite;

  float cinemaDepthUV(float z) {
    return sqrt(clamp((z - ${CINEMA_LIGHT_NEAR}) / ${CINEMA_LIGHT_DEPTH}, 0.0, 1.0));
  }

  float cinemaIncidence(vec3 n, vec3 receiver, vec3 towardScreen) {
    // The bake integrates the rectangle. This local correction turns the probe's
    // reference plane toward the actual material normal without moving the color field.
    return min(2.2, max(0.0, dot(n, towardScreen)) / max(0.16, dot(receiver, towardScreen)));
  }

  vec3 cinemaReceive(vec3 p, vec3 n, float heightAboveTread, vec3 towardScreen) {
    vec2 floorUV = vec2(p.x / 39.6 + 0.5, cinemaDepthUV(p.z));
    vec2 wallUV = vec2(floorUV.y, p.y / ${CINEMA_ROOM_HEIGHT}.0);
    float side = smoothstep(18.2, 19.68, abs(p.x));
    float ceiling = smoothstep(19.3, 21.5, p.y);
    float rear = smoothstep(52.0, 53.8, p.z);
    vec3 room = vec3(0.0);
    if (side < 1.0 && ceiling < 1.0 && rear < 1.0) {
      vec3 floorLight = cinemaAtlas(0.0, floorUV) * cinemaIncidence(n, vec3(0, 1, 0), towardScreen);
      float seats = smoothstep(0.15, 0.65, heightAboveTread) * smoothstep(18.0, 20.0, p.z);
      if (seats > 0.0) {
        float frontFacing = max(0.0, dot(n, vec3(towardScreen.x / max(0.4, -towardScreen.z), 0.0, -1.0)));
        vec3 seatLight = cinemaAtlas(1.0, floorUV) * frontFacing
          + cinemaAtlas(${CINEMA_LIGHT_CROWN}.0, floorUV) * max(0.0, n.y);
        floorLight = mix(floorLight, seatLight, seats);
      }
      room = floorLight * (1.0 - side) * (1.0 - ceiling) * (1.0 - rear);
    }
    if (side > 0.0 && ceiling < 1.0 && rear < 1.0) {
      room += cinemaAtlas(p.x < 0.0 ? 2.0 : 3.0, wallUV) * side * (1.0 - ceiling) * (1.0 - rear)
        * cinemaIncidence(n, vec3(-sign(p.x), 0, 0), towardScreen);
    }
    if (ceiling > 0.0) {
      room += cinemaAtlas(4.0, floorUV) * ceiling * cinemaIncidence(n, vec3(0, -1, 0), towardScreen);
    }
    if (rear > 0.0 && ceiling < 1.0) {
      room += cinemaAtlas(5.0, vec2(floorUV.x, wallUV.y)) * rear * (1.0 - ceiling)
        * cinemaIncidence(n, vec3(0, 0, -1), towardScreen);
    }
    return room * smoothstep(0.0, ${CINEMA_LIGHT_NEAR}, p.z);
  }

  vec3 cinemaDiffuseReturn(vec3 p, vec3 n) {
    // Dark carpet and walls return a small fraction of the light after direct incidence.
    vec3 mean = cinemaAtlas(${CINEMA_LIGHT_META}.0, vec2(0.0));
    float facing = 0.016 + 0.018 * max(0.0, n.y) + 0.008 * max(0.0, n.z);
    return mean * facing * smoothstep(0.0, ${CINEMA_LIGHT_NEAR}, p.z);
  }

  float cinemaCoveWash(vec3 p, vec3 n, float side) {
    vec2 towardLens = vec2(side * ${CINEMA_COVE_LENS_X} - p.x, ${CINEMA_COVE_LENS_Y} - p.y);
    float inverseDistance = inversesqrt(dot(towardLens, towardLens) + 0.18);
    vec2 direction = towardLens * inverseDistance;
    float emission = max(0.0, direction.y);
    float reception = max(0.0, dot(n.xy, direction));
    // Long linear strips have a slower falloff than individual emitters.
    return emission * reception * inverseDistance;
  }

  float cinemaExitPool(vec3 p, vec3 n, vec3 source) {
    vec3 toLight = source - p;
    float inverseDistance = inversesqrt(dot(toLight, toLight) + 0.12);
    vec3 direction = toLight * inverseDistance;
    float beam = smoothstep(0.50, 0.86, direction.y);
    return beam * max(0.0, dot(n, direction)) * inverseDistance * inverseDistance;
  }

  vec3 cinemaArchitecturalLight(vec3 p, vec3 n, vec4 tread) {
    float ax = abs(p.x);
    float heightAboveTread = p.y - tread.x;
    float atFloor = 1.0 - smoothstep(0.02, 0.32, abs(heightAboveTread));
    float marker = ${stepMarkers};
    float edge = ${aisleFalloff};
    float up = max(0.0, n.y);
    float step = atFloor * (marker * (0.10 * tread.y + 0.27 * tread.w) * (0.16 + 0.84 * up)
      + edge * (0.025 * tread.y + 0.059 * tread.w) * up);
    float footlight = tread.z * atFloor * exp(-1.85 * abs(${CINEMA_WALL_LENS_X} - ax)) * (0.24 + 0.76 * up);
    // Shielded safety fixtures illuminate the nearby walking surface. The upper room
    // receives light only from powered house lamps or the projected image.
    vec3 result = vec3(1.0, 0.54, 0.26) * (step + 0.42 * footlight);

    if (cinemaLamps.x > 0.0) {
      float bounce = 0.09 + 0.19 * max(0.0, n.y) + 0.025 * abs(n.x);
      float cove = cinemaCoveWash(p, n, -1.0) + cinemaCoveWash(p, n, 1.0);
      float ceilingReturn = smoothstep(18.6, 21.7, p.y) * smoothstep(10.0, 19.0, ax) * max(0.0, -n.y);
      result += vec3(1.0, 0.66, 0.38) * cinemaLamps.x * (bounce + 3.35 * cove + 0.20 * ceilingReturn);
    }
    if (cinemaLamps.y > 0.0) {
      float overheadSpacing = abs(fract((p.z - 5.5) / 6.4 + 0.5) - 0.5) * 6.4;
      float toOverhead = abs(ax - 10.9);
      float overhead = 0.62 + 0.92 * exp(-(toOverhead * toOverhead * 0.016 + overheadSpacing * overheadSpacing * 0.032));
      float down = 0.42 + 0.58 * max(0.0, n.y);
      result += vec3(0.84, 0.91, 1.0) * cinemaLamps.y * overhead * down;
    }
    if (cinemaLamps.z > 0.0) {
      float emergencyAisles = 0.08 + 0.14 * edge * max(0.0, n.y);
      float exitSpill = ${exitPools};
      result += vec3(0.86, 0.94, 1.0) * cinemaLamps.z * (emergencyAisles + 8.0 * exitSpill);
    }
    return result;
  }
`;

export const cinemaRoomFragment = /* glsl */ `
  vec3 cinemaNormal = inverseTransformDirection(normal, viewMatrix);
  vec4 cinemaTread = texture2D(cinemaSteps, vec2(
    clamp((cinemaWorld.z - (${CINEMA_BOUNDS.minZ})) / ${CINEMA_BOUNDS.maxZ - CINEMA_BOUNDS.minZ}.0, 0.0, 1.0), 0.5));
  cinemaTread.x *= ${CINEMA_CROSS_AISLES[3].y.toFixed(3)};
  vec3 cinemaIncident = cinemaArchitecturalLight(cinemaWorld, cinemaNormal, cinemaTread);
  if (cinemaLive > 0.5) {
    vec3 screenCenter = vec3(cinemaWorld.x * 0.48, ${CINEMA_SCREEN.center}, ${CINEMA_SCREEN.z}.0);
    vec3 towardScreen = normalize(screenCenter - cinemaWorld);
    vec3 direct = cinemaProjectorWhite * cinemaReceive(cinemaWorld, cinemaNormal,
      cinemaWorld.y - cinemaTread.x, towardScreen);
    cinemaIncident += direct + cinemaProjectorWhite * cinemaDiffuseReturn(cinemaWorld, cinemaNormal);
    // The screen spans a large angle. Broaden the representative reflection lobe
    // instead of producing sharp point highlights on seat shells and handrails.
    if (dot(cinemaNormal, towardScreen) > 0.0) {
      vec3 sourceInView = transformDirection(towardScreen, viewMatrix);
      PhysicalMaterial screenMaterial = material;
      screenMaterial.roughness = min(1.0, sqrt(material.roughness * material.roughness + 0.14));
      vec3 sheen = BRDF_GGX(sourceInView, geometryViewDir, normal, screenMaterial) * PI;
      outgoingLight += direct * min(sheen, vec3(0.24));
    }
  }
  outgoingLight += diffuseColor.rgb * (1.0 - 0.74 * metalnessFactor) * cinemaIncident;
`;
