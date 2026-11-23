export const PRIMARY_RAINBOW_ANGLE = { violet: 40.0, red: 42.0 } as const;

export const coastSprayRainbow = /* glsl */`
  float sunlitSpray() {
    #if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )
      vec3 projected = vDirectionalShadowCoord[0].xyz / vDirectionalShadowCoord[0].w;
      vec3 margin = min(projected, 1.0 - projected);
      // Let distant spray fade at the edge of the scene's sun shadow coverage.
      float coverage = smoothstep(0.003, 0.035, min(min(margin.x, margin.y), margin.z));
      return coverage * smoothstep(0.12, 0.90, getShadowMask());
    #else
      return 0.0;
    #endif
  }

  vec4 primaryRainbow(vec3 ray, vec3 sun) {
    // WMO International Cloud Atlas: radii measured from the antisolar point.
    const float violet = ${PRIMARY_RAINBOW_ANGLE.violet.toFixed(1)};
    const float red = ${PRIMARY_RAINBOW_ANGLE.red.toFixed(1)};
    float angle = degrees(acos(clamp(dot(ray, -sun), -1.0, 1.0)));
    float edge = clamp(0.75 * fwidth(angle), 0.035, 0.20);
    float band = smoothstep(violet - 0.29 - edge, violet + 0.09 + edge, angle)
      * (1.0 - smoothstep(red - 0.07 - edge, red + 0.26 + edge, angle));
    float hue = clamp((angle - violet) / (red - violet), 0.0, 1.0);
    vec3 spectrum = vec3(
      0.50 * (1.0 - smoothstep(0.0, 0.23, hue)) + smoothstep(0.53, 0.77, hue),
      smoothstep(0.19, 0.48, hue) * (1.0 - smoothstep(0.74, 0.98, hue)),
      1.0 - smoothstep(0.29, 0.58, hue)
    );
    return vec4(spectrum, band);
  }
`;
