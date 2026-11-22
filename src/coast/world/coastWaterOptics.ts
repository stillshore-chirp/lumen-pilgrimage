export const SEA_WATER_SCATTER = 0x297f80;
export const STREAM_WATER_SCATTER = 0x416653;

export const coastWaterOptics = /* glsl */`
  float waterFresnel(float facing) {
    return 0.0204 + 0.9796 * pow(1.0 - clamp(facing, 0.0, 1.0), 5.0);
  }

  // GGX microfacet reflection. The slope width includes unresolved ripple motion.
  float waterSunGlint(vec3 normal, vec3 view, vec3 sun, float slopeWidth) {
    float lightAngle = max(dot(normal, sun), 0.0);
    float viewAngle = max(dot(normal, view), 0.0);
    vec3 halfVector = normalize(view + sun);
    float peak = max(dot(normal, halfVector), 0.0);
    float width2 = slopeWidth * slopeWidth;
    float slope = peak * peak * (width2 - 1.0) + 1.0;
    float distribution = width2 / (3.14159265 * slope * slope);
    float visibility = 0.5 / max(0.02,
      lightAngle * sqrt(viewAngle * viewAngle * (1.0 - width2) + width2)
      + viewAngle * sqrt(lightAngle * lightAngle * (1.0 - width2) + width2));
    return min(3.0, distribution * visibility * lightAngle * waterFresnel(dot(halfVector, view)));
  }

  // Trace from water into air. Outside the refraction cone the surface is a mirror.
  float waterTransmission(vec3 ray, vec3 airNormal, out vec3 airRay) {
    const float waterToAir = 1.333;
    float cosIncident = clamp(dot(ray, airNormal), 0.0, 1.0);
    float k = 1.0 - waterToAir * waterToAir * (1.0 - cosIncident * cosIncident);
    airRay = refract(ray, -airNormal, waterToAir);
    float cosTransmitted = sqrt(max(0.0, k));
    float rs = (waterToAir * cosIncident - cosTransmitted)
      / max(0.001, waterToAir * cosIncident + cosTransmitted);
    float rp = (cosIncident - waterToAir * cosTransmitted)
      / max(0.001, cosIncident + waterToAir * cosTransmitted);
    return smoothstep(0.0, 0.035, k) * (1.0 - 0.5 * (rs * rs + rp * rp));
  }

  vec3 underwaterExtinction(float path) {
    return exp(-path * vec3(0.23, 0.11, 0.092));
  }
`;
