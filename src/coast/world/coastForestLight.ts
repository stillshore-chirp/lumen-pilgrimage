export const coastForestLight = /* glsl */`
  #if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && ( NUM_DIR_LIGHT_SHADOWS > 1 )
    uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
  #endif

  vec3 coastForestInscatter(vec3 radiance, vec3 worldPoint) {
    #if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF ) && ( NUM_DIR_LIGHT_SHADOWS > 1 )
      if (uCoastNight > 0.5 || uCoastSubmersion > 0.0) return radiance;
      float viewerDensity = smoothstep(0.025, 0.24, coastForestAir(cameraPosition));
      if (viewerDensity <= 0.0) return radiance;
      vec3 path = worldPoint - cameraPosition;
      float distance = length(path);
      if (distance <= 0.3) return radiance;
      vec3 ray = path / distance;
      float maxPath = min(distance, 39.0);
      float stepLength = maxPath / 9.0;
      float sunPath = 0.0;
      float totalPath = 0.0;
      // Integrate between the eye and the actual visible surface. Thin shafts follow the
      // same canopy depth map as their patches on the ground.
      for (int i = 0; i < 9; i++) {
        float t = (float(i) + 0.46) * stepLength;
        vec3 samplePoint = cameraPosition + ray * t;
        vec3 shadow = (directionalShadowMatrix[1] * vec4(samplePoint, 1.0)).xyz;
        vec3 margin = min(shadow, 1.0 - shadow);
        float insideMap = smoothstep(0.008, 0.054, min(margin.z, min(margin.x, margin.y)));
        float density = coastForestAir(samplePoint) * smoothstep(1.75, 5.2, t)
          * (1.0 - smoothstep(30.0, 39.0, t));
        float visible = texture(directionalShadowMap[1], vec3(shadow.xy, shadow.z - 0.00032));
        totalPath += density;
        sunPath += insideMap * density * visible;
      }
      float phase = 0.70 + 0.82 * pow(clamp(0.5 + 0.5 * dot(ray, uCoastSunDirection), 0.0, 1.0), 2.0);
      float opticalDepth = 0.0037 * stepLength * totalPath;
      float scattered = 0.24 * (1.0 - exp(-0.083 * phase * sunPath * stepLength));
      vec3 forestLight = radiance * exp(-opticalDepth) + uCoastSolarColor * vec3(0.83, 0.81, 0.75) * scattered;
      return mix(radiance, forestLight, viewerDensity);
    #else
      return radiance;
    #endif
  }
`;
