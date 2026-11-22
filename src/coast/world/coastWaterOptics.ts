export const SEA_WATER_SCATTER = 0x297f80;
export const STREAM_WATER_SCATTER = 0x416653;

export const coastWaterOptics = /* glsl */`
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
