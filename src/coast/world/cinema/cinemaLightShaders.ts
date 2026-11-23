import {
  CINEMA_LENS_SCATTER, CINEMA_LIGHT_BOUNCE, CINEMA_LIGHT_DEPTH, CINEMA_LIGHT_META, CINEMA_LIGHT_PAGES,
  CINEMA_PROJECTOR_CONTRAST, CINEMA_ROOM_RETURN,
} from './cinemaLightTransport';
import { CINEMA_AISLES, CINEMA_BOUNDS, CINEMA_ROOM_HEIGHT, CINEMA_SCREEN } from './cinemaLayout';

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
    vec2 center = vec2(page * cinemaProbes.x, 0.0)
      + vec2(0.5) + clamp(coord, 0.0, 1.0) * (cinemaProbes - 1.0);
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
  vec3 lightOnScreen = vec3(cinemaSpill);
  if (cinemaLive > 0.5) {
    if (cinemaInOpening(vMapUv)) {
      vec3 direct = cinemaProjectedPixel(vMapUv, pictureGradients);
      vec3 stray = cinemaAtlas(${CINEMA_LIGHT_META}.0, vec2(0.0));
      vec3 returned = cinemaAtlas(${CINEMA_LIGHT_BOUNCE}.0, vMapUv);
      lightOnScreen += cinemaProjectorWhite *
        ((1.0 - ${CINEMA_LENS_SCATTER}) * direct + ${CINEMA_LENS_SCATTER} * stray + returned);
    } else {
      lightOnScreen *= 0.035;
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

export const cinemaRoomPars = /* glsl */ `
  ${atlas}
  varying vec3 cinemaWorld;
  uniform sampler2D cinemaSteps;
  uniform float cinemaProjectorWhite;

  float cinemaDepthUV(float z) {
    return sqrt(clamp((z - 1.0) / ${CINEMA_LIGHT_DEPTH}, 0.0, 1.0));
  }

  vec3 cinemaReceive(vec3 p, vec3 n, float heightAboveTread) {
    vec2 floorUV = vec2(p.x / 39.6 + 0.5, cinemaDepthUV(p.z));
    vec2 wallUV = vec2(floorUV.y, p.y / ${CINEMA_ROOM_HEIGHT}.0);
    float side = smoothstep(17.8, 19.8, abs(p.x));
    float ceiling = smoothstep(19.0, 21.7, p.y);
    float rear = smoothstep(52.0, 53.8, p.z);
    float seats = smoothstep(0.04, 0.64, heightAboveTread)
      * (1.0 - side) * (1.0 - ceiling) * smoothstep(18.0, 20.0, p.z);
    vec3 room = mix(cinemaAtlas(0.0, floorUV) * (0.20 + 0.80 * max(0.0, n.y)),
      cinemaAtlas(1.0, floorUV) * (0.16 + 0.84 * max(0.0, -n.z)), seats);
    room = mix(room, cinemaAtlas(p.x < 0.0 ? 2.0 : 3.0, wallUV)
      * (0.50 + 0.50 * max(0.0, -sign(p.x) * n.x)), side);
    room = mix(room, cinemaAtlas(4.0, floorUV) * (0.32 + 0.68 * max(0.0, -n.y)), ceiling);
    room = mix(room, cinemaAtlas(5.0, vec2(floorUV.x, wallUV.y))
      * (0.32 + 0.68 * max(0.0, -n.z)), rear * (1.0 - ceiling));
    return room * smoothstep(0.0, 0.3, p.z);
  }

  vec3 cinemaArchitecturalLight(vec3 p, vec3 n, vec2 tread) {
    float ax = abs(p.x);
    float edge = ${aisleFalloff};
    float heightAboveTread = p.y - tread.x * 4.0;
    float atFloor = 1.0 - smoothstep(0.04, 0.65, abs(heightAboveTread));
    float edgeLight = edge * atFloor * (0.035 + 0.28 * tread.y)
      * (0.62 + 0.38 * max(0.0, n.y - 0.25 * n.z));
    float sideMarker = (1.0 - smoothstep(0.06, 0.49, abs(heightAboveTread - 0.07)))
      * smoothstep(17.8, 19.9, ax)
      * (1.0 - smoothstep(0.05, 0.47, abs(fract((p.z - 6.5) / 4.15 + 0.5) - 0.5)))
      * smoothstep(3.5, 7.0, p.z);
    vec3 stepLight = vec3(1.0, 0.54, 0.26) * (edgeLight + 0.23 * sideMarker);
    vec3 weakBounce = vec3(0.021, 0.024, 0.029)
      * (0.54 + 0.46 * max(0.0, n.y)) * (0.62 + 0.38 * smoothstep(0.0, 20.0, p.z));

    float side = smoothstep(15.0, 19.8, ax);
    float wallFacing = 0.48 + 0.52 * max(0.0, -sign(p.x) * n.x);
    float wallCove = side * wallFacing
      * (0.13 + 0.82 * exp(-pow((p.y - 17.6) / 3.55, 2.0))
        + 0.14 * exp(-pow((p.y - 10.0) / 6.80, 2.0)));
    float ceilingCove = smoothstep(17.4, 21.8, p.y) * smoothstep(3.1, 18.0, ax)
      * (0.13 + 0.29 * max(0.0, -n.y));
    float floorWash = 0.30 + 0.29 * max(0.0, n.y) + 0.11 * edge * atFloor
      + 0.15 * abs(n.x) + 0.09 * max(0.0, n.z);
    float proscenium = (1.0 - smoothstep(0.25, 6.0, abs(p.z)))
      * (0.07 + 0.13 * smoothstep(4.0, 18.0, p.y)) * max(0.0, n.z);
    float cove = (floorWash + wallCove + ceilingCove + proscenium + 0.14 * sideMarker)
      * (0.72 + 0.28 * smoothstep(0.0, 11.0, p.z));
    vec3 arrival = vec3(1.0, 0.66, 0.38) * cinemaLamps.x * cove;

    float overheadSpacing = abs(fract((p.z - 5.5) / 6.4 + 0.5) - 0.5) * 6.4;
    float toOverhead = abs(ax - 10.9);
    float overhead = 0.62 + 0.92 * exp(-(toOverhead * toOverhead * 0.016 + overheadSpacing * overheadSpacing * 0.032));
    float down = 0.42 + 0.58 * max(0.0, n.y);
    vec3 service = vec3(0.84, 0.91, 1.0) * cinemaLamps.y * overhead * down;
    float emergencyAisles = 0.34 + 0.42 * edge + 0.48 * smoothstep(16.4, 19.8, ax);
    vec3 emergency = vec3(0.86, 0.94, 1.0) * cinemaLamps.z * emergencyAisles * down;
    return weakBounce + stepLight + arrival + service + emergency;
  }
`;

export const cinemaRoomFragment = /* glsl */ `
  vec3 cinemaNormal = inverseTransformDirection(normal, viewMatrix);
  vec2 cinemaTread = texture2D(cinemaSteps, vec2(
    clamp((cinemaWorld.z - (${CINEMA_BOUNDS.minZ})) / ${CINEMA_BOUNDS.maxZ - CINEMA_BOUNDS.minZ}.0, 0.0, 1.0), 0.5)).rg;
  vec3 cinemaIncident = cinemaArchitecturalLight(cinemaWorld, cinemaNormal, cinemaTread);
  if (cinemaLive > 0.5) {
    cinemaIncident += cinemaProjectorWhite * cinemaReceive(cinemaWorld, cinemaNormal, cinemaWorld.y - cinemaTread.x * 4.0);
  }
  outgoingLight += diffuseColor.rgb * (1.0 - 0.74 * metalnessFactor) * cinemaIncident;
`;
