export const lakeSkyRadianceGlsl = /* glsl */`
  float lakeSunwardSky(vec3 direction) {
    float azimuth = dot(direction.xz, normalize(uCoastSunDirection.xz)) / max(length(direction.xz), 0.0001);
    return smoothstep(0.06, 1.0, azimuth);
  }

  vec3 lakeSkyRadiance(vec3 direction) {
    vec3 scattered = coastSkyRadiance(direction);
    if (uCoastNight > 0.5) return scattered;

    // Grade the valley from cool blue aloft to a paler grey-blue above the shore.
    // Keep the atmosphere's solar halo and the lower contrast on the sunward side.
    float sunward = lakeSunwardSky(direction);
    float elevation = smoothstep(0.015, 0.44, direction.y);
    vec3 horizon = mix(vec3(0.44, 0.57, 0.67), vec3(0.61, 0.72, 0.79), sunward);
    vec3 upperSky = mix(vec3(0.075, 0.229, 0.40), vec3(0.23, 0.42, 0.59), sunward);
    return mix(mix(horizon, upperSky, elevation), scattered, 0.20);
  }
`;
