// Coherent variation for the shoreline, rock strata and flowing water.
export const coastNoise = /* glsl */`
  float coastHash(vec2 point) {
    vec3 p = fract(vec3(point.xyx) * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float coastNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(coastHash(i), coastHash(i + vec2(1,0)), f.x),
               mix(coastHash(i + vec2(0,1)), coastHash(i + vec2(1,1)), f.x), f.y);
  }
`;
