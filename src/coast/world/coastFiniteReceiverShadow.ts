// Explicitly bounded planar receiver, never a caster or bias override.
const finiteReceiverHelpers = /* glsl */`
#if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
// Sampling helper for an explicitly selected finite planar face.
// UV/depth are normalized shadow coordinates; world values and bounds are metres.
// Caller computes receiver/world derivatives at fragment-main entry, before spatial branches.
// World tangents follow from the same signed UV Jacobian as the depth gradient:
// worldU = (worldDx * shadowDy.y - worldDy * shadowDx.y) / determinant;
// worldV = (worldDy * shadowDx.x - worldDx * shadowDy.x) / determinant;
// The face domain must come from unchanged source geometry; it is not a new caster mask.
vec2 coastFiniteReceiverTexel(sampler2DShadow map, vec2 mapSize, vec3 p, vec2 texel,
  vec2 depthGradient, vec2 domainAnchorUV, vec3 receiverWorld, vec3 worldU, vec3 worldV, vec3 domainMin, vec3 domainMax) {
  vec2 center = (clamp(texel, vec2(0.0), mapSize - 1.0) + 0.5) / mapSize;
  vec2 delta = center - p.xy;
  vec2 domainDelta = center - domainAnchorUV;
  vec3 domainPoint = receiverWorld + worldU * domainDelta.x + worldV * domainDelta.y;
  const float domainToleranceMetres = 0.0002;
  bool inside = all(greaterThanEqual(domainPoint, domainMin - domainToleranceMetres))
    && all(lessThanEqual(domainPoint, domainMax + domainToleranceMetres));
  if (!inside) return vec2(0.0);
  return vec2(texture(map, vec3(center, p.z + dot(depthGradient, delta))), 1.0);
}

// Accumulate both visible weight and available receiver-area weight over the whole kernel.
// Do not normalize each four-texel group independently before combining the five samples.
vec2 coastFiniteReceiverBilinear(sampler2DShadow map, vec2 mapSize, vec3 p, vec2 uv,
  vec2 depthGradient, vec2 domainAnchorUV, vec3 receiverWorld, vec3 worldU, vec3 worldV, vec3 domainMin, vec3 domainMax) {
  vec2 grid = uv * mapSize - 0.5;
  vec2 first = floor(grid);
  vec2 f = fract(grid);
  vec2 a = coastFiniteReceiverTexel(map, mapSize, p, first, depthGradient, domainAnchorUV,
    receiverWorld, worldU, worldV, domainMin, domainMax);
  vec2 b = coastFiniteReceiverTexel(map, mapSize, p, first + vec2(1.0, 0.0), depthGradient, domainAnchorUV,
    receiverWorld, worldU, worldV, domainMin, domainMax);
  vec2 c = coastFiniteReceiverTexel(map, mapSize, p, first + vec2(0.0, 1.0), depthGradient, domainAnchorUV,
    receiverWorld, worldU, worldV, domainMin, domainMax);
  vec2 d = coastFiniteReceiverTexel(map, mapSize, p, first + 1.0, depthGradient, domainAnchorUV,
    receiverWorld, worldU, worldV, domainMin, domainMax);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float coastFiniteReceiverResolve(vec2 accumulated, float originalShadowFallback) {
  // A subtexel domain may have no sample center inside. Preserve the original shadow then.
  return accumulated.y > 1e-6 ? accumulated.x / accumulated.y : originalShadowFallback;
}

#endif

  #if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
    uniform vec3 uCoastReceiverDomainMin;
    uniform vec3 uCoastReceiverDomainMax;
    vec3 coastFiniteWorldPoint;
    bool coastFiniteDomainActive;
    varying vec2 vCoastUnbiasedBroadShadowUV;
    mat2x3 coastBroadWorldTangents;
    #if NUM_DIR_LIGHT_SHADOWS > 1
      varying vec2 vCoastUnbiasedLocalShadowUV;
      mat2x3 coastLocalWorldTangents;
    #endif

    mat2x3 coastFiniteWorldTangents(vec3 p, vec3 worldDx, vec3 worldDy) {
      vec3 dx = dFdx(p);
      vec3 dy = dFdy(p);
      float scale = length(dx.xy) * length(dy.xy);
      float det = dx.x * dy.y - dx.y * dy.x;
      if (!(scale > 1e-20) || !(abs(det) > max(1e-20, scale * 1e-4))) return mat2x3(0.0);
      return mat2x3((worldDx * dy.y - worldDy * dx.y) / det,
        (worldDy * dx.x - worldDx * dy.x) / det);
    }

    vec2 coastFiniteSample(sampler2DShadow map, vec2 size, vec3 p, vec2 uv, vec3 plane, mat2x3 worldTangents, vec2 domainAnchorUV) {
      if (!coastFiniteDomainActive || plane.z < 0.5) return vec2(coastReceiverPlaneSample(map, size, p, uv, plane), 1.0);
      return coastFiniteReceiverBilinear(map, size, p, uv, plane.xy, domainAnchorUV, coastFiniteWorldPoint,
        worldTangents[0], worldTangents[1], uCoastReceiverDomainMin, uCoastReceiverDomainMax);
    }

    #if NUM_DIR_LIGHT_SHADOWS > 1
      float coastReceiverPlaneLocalShadow(DirectionalLightShadow shadow, vec4 coord) {
        if (!coastFiniteDomainActive) return coastInfiniteReceiverLocalShadow(shadow, coord);
        vec3 p = coord.xyz / coord.w;
        p.z += shadow.shadowBias;
        bool inside = p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0 && p.z <= 1.0;
        if (!inside) return 1.0;
        float radius = shadow.shadowRadius / shadow.shadowMapSize.x;
        float phi = interleavedGradientNoise(gl_FragCoord.xy) * PI2;
        vec2 visible = vec2(0.0);
        for (int i = 0; i < 5; i++) {
          vec2 uv = p.xy + vogelDiskSample(i, 5, phi) * radius;
          visible += coastFiniteSample(directionalShadowMap[1], shadow.shadowMapSize, p, uv,
            coastLocalReceiverPlane, coastLocalWorldTangents, vCoastUnbiasedLocalShadowUV) * 0.2;
        }
        if (visible.y <= 1e-6) return coastInfiniteReceiverLocalShadow(shadow, coord);
        return mix(1.0, visible.x / visible.y, shadow.shadowIntensity);
      }
    #endif
  #endif

  void coastPrepareFiniteReceiverPlanes(vec3 worldPoint) {
    coastPrepareReceiverPlanes();
    #if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
      // All derivatives are taken before deciding whether this fragment is in the finite face.
      vec3 worldDx = dFdx(worldPoint);
      vec3 worldDy = dFdy(worldPoint);
      coastBroadWorldTangents = coastFiniteWorldTangents(vDirectionalShadowCoord[0].xyz / vDirectionalShadowCoord[0].w,
        worldDx, worldDy);
      #if NUM_DIR_LIGHT_SHADOWS > 1
        coastLocalWorldTangents = coastFiniteWorldTangents(vDirectionalShadowCoord[1].xyz / vDirectionalShadowCoord[1].w,
          worldDx, worldDy);
      #endif
      coastFiniteWorldPoint = worldPoint;
      coastFiniteDomainActive = all(greaterThanEqual(worldPoint, uCoastReceiverDomainMin - 0.0002))
        && all(lessThanEqual(worldPoint, uCoastReceiverDomainMax + 0.0002));
    #endif
  }
`;

const finiteBroad = /* glsl */`
    float coastBroadShadow(DirectionalLightShadow shadow, vec4 coord) {
      if (!coastFiniteDomainActive) return coastInfiniteReceiverBroadShadow(shadow, coord);
      vec3 p = coord.xyz / coord.w;
      vec2 margin = min(p.xy, 1.0 - p.xy);
      float weight = smoothstep(0.004, 0.093, min(margin.x, margin.y))
        * smoothstep(0.0, 0.025, p.z) * (1.0 - smoothstep(0.96, 1.0, p.z));
      if (weight <= 0.0) return 1.0;
      p.z += shadow.shadowBias;
      vec2 r = vec2(shadow.shadowRadius) / shadow.shadowMapSize;
      vec2 visible = (4.0 * coastFiniteSample(directionalShadowMap[0], shadow.shadowMapSize, p, p.xy,
          coastBroadReceiverPlane, coastBroadWorldTangents, vCoastUnbiasedBroadShadowUV)
        + coastFiniteSample(directionalShadowMap[0], shadow.shadowMapSize, p, p.xy + vec2(r.x, 0.0),
          coastBroadReceiverPlane, coastBroadWorldTangents, vCoastUnbiasedBroadShadowUV)
        + coastFiniteSample(directionalShadowMap[0], shadow.shadowMapSize, p, p.xy - vec2(r.x, 0.0),
          coastBroadReceiverPlane, coastBroadWorldTangents, vCoastUnbiasedBroadShadowUV)
        + coastFiniteSample(directionalShadowMap[0], shadow.shadowMapSize, p, p.xy + vec2(0.0, r.y),
          coastBroadReceiverPlane, coastBroadWorldTangents, vCoastUnbiasedBroadShadowUV)
        + coastFiniteSample(directionalShadowMap[0], shadow.shadowMapSize, p, p.xy - vec2(0.0, r.y),
          coastBroadReceiverPlane, coastBroadWorldTangents, vCoastUnbiasedBroadShadowUV)) * 0.125;
      if (visible.y <= 1e-6) return coastInfiniteReceiverBroadShadow(shadow, coord);
      return mix(1.0, visible.x / visible.y, weight * shadow.shadowIntensity);
    }
`;

export function createFiniteReceiverVisibility(planeHelpers: string, planeVisibility: string): string {
  if (!planeVisibility.startsWith(planeHelpers)) throw new Error('The receiver shadow helper prefix changed.');
  const visibility = planeVisibility.slice(planeHelpers.length);
  const match = visibility.match(/float coastBroadShadow\(DirectionalLightShadow shadow, vec4 coord\) \{[\s\S]*?\n    \}/);
  if (!match) throw new Error('The broad receiver shadow function changed.');
  const broadFallback = match[0].replace('coastBroadShadow(', 'coastInfiniteReceiverBroadShadow(');
  const renamedHelpers = planeHelpers.replace('float coastReceiverPlaneLocalShadow(', 'float coastInfiniteReceiverLocalShadow(');
  return renamedHelpers + finiteReceiverHelpers + visibility.replace(match[0], broadFallback + finiteBroad);
}
