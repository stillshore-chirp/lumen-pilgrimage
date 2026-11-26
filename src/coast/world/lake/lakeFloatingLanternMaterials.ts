import { AdditiveBlending, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import type { IUniform } from 'three';
import { coastWaterOptics } from '../coastWaterOptics';
import { LAKE_WATER_Y } from './lakeLayout';

const candlelight = /* glsl */`
  uniform float uLanternTime, uLanternNight;
  varying vec3 vLanternVariation;

  vec3 lanternFlameColor() {
    return mix(vec3(1.0, 0.33, 0.073), vec3(1.0, 0.57, 0.26), vLanternVariation.z);
  }

  float lanternFlicker() {
    float phase = vLanternVariation.x * 81.0;
    return vLanternVariation.y * (0.95 + 0.039 * sin(2.0 * uLanternTime + phase)
      + 0.019 * sin(5.4 * uLanternTime + phase * 1.47));
  }
`;

export function createFloatingLanternMaterials(
  lightDirection: IUniform<Vector3> = { value: new Vector3(0.89, 0.20, -0.37).normalize() },
) {
  const time = { value: 0 };
  const night = { value: 0 };
  const paper = new ShaderMaterial({
    name: 'Translucent lantern paper',
    fog: true,
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      uLanternTime: time,
      uLanternNight: night,
      uLanternLightDirection: lightDirection,
    },
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      attribute vec3 lanternVariation;
      varying vec3 vLanternVariation, vPanelNormal;
      varying vec2 vPaper;

      void main() {
        vPaper = uv;
        vLanternVariation = lanternVariation;
        vPanelNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      ${candlelight}
      uniform vec3 uLanternLightDirection;
      varying vec3 vPanelNormal;
      varying vec2 vPaper;

      float paperGrain(vec2 coordinate) {
        return fract(sin(dot(coordinate, vec2(92.47, 53.81))) * 4375.13);
      }

      vec3 shadePaper() {
        float shade = 0.45 + 0.55 * max(dot(vPanelNormal, uLanternLightDirection), 0.0);
        vec3 paperColor = mix(vec3(0.79, 0.67, 0.46), vec3(0.87, 0.80, 0.65), vLanternVariation.z);
        float edge = min(vPaper.x, 1.0 - vPaper.x);
        float bond = 0.81 + 0.19 * smoothstep(0.0, 0.095, edge);
        float fibre = paperGrain(floor(vPaper * vec2(122.0, 43.0)));
        float fibreWeight = 1.0 - smoothstep(0.004, 0.018, max(fwidth(vPaper.x), fwidth(vPaper.y)));
        float grain = 0.97 + 0.065 * fibreWeight * (fibre - 0.5)
          + 0.035 * sin(17.0 * vPaper.x + 3.0 * vPaper.y);
        // One flame below the middle of the paper lights the bottom and centre most strongly.
        vec2 fromFlame = (vPaper - vec2(0.50, 0.24)) * vec2(1.4, 1.83);
        float transmission = 0.20 + 0.80 / (1.0 + 2.8 * dot(fromFlame, fromFlame));
        vec3 ambientPaper = paperColor * shade * mix(0.79, 0.063, uLanternNight);
        vec3 glow = lanternFlameColor() * transmission * lanternFlicker() * mix(0.12, 1.19, uLanternNight);
        return (ambientPaper + glow) * bond * grain;
      }

      vec3 shadeFlame() {
        float height = vPaper.y - 2.0;
        float lean = sin(uLanternTime * 2.1 + vLanternVariation.x * 81.0) * 0.15 * height;
        vec2 drop = vec2((vPaper.x - 0.5 + lean) / mix(0.31, 0.065, height), (height - 0.38) / 0.55);
        float radius = dot(drop, drop);
        if (radius > 1.0) discard;
        return mix(vec3(1.4, 0.90, 0.41), lanternFlameColor(), smoothstep(0.12, 1.0, radius));
      }

      void main() {
        vec3 color = vPaper.y < 1.5 ? shadePaper() : shadeFlame();
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });

  const reflection = new ShaderMaterial({
    name: 'Floating lantern reflections',
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uLanternTime: time, uLanternNight: night },
    vertexShader: /* glsl */`
      attribute vec3 lanternVariation;
      varying vec3 vLanternVariation;
      varying vec2 vPatch, vLakePoint;
      varying float vEyeAboveWater;

      void main() {
        const float waterY = ${LAKE_WATER_Y.toFixed(2)};
        vec3 anchor = (modelMatrix * instanceMatrix[3]).xyz;
        vec2 toEye = cameraPosition.xz - anchor.xz;
        float distance = max(length(toEye), 0.01);
        vec2 tangent = vec2(-toEye.y, toEye.x) / distance;
        float heightScale = length(instanceMatrix[1].xyz);
        float widthScale = length(instanceMatrix[0].xyz);
        vEyeAboveWater = cameraPosition.y - waterY;
        // The sightline to the virtual image under the water intersects the
        // surface between the floating base and the viewer.
        float reflectedHeight = uv.y * 0.66 * heightScale;
        float mirrorContact = reflectedHeight / (max(0.35, vEyeAboveWater) + reflectedHeight);
        float halfWidth = 0.35 * widthScale + min(0.54, distance * 0.006);
        vLakePoint = anchor.xz + toEye * mirrorContact + tangent * position.x * halfWidth;
        vPatch = vec2(position.x, uv.y);
        vLanternVariation = lanternVariation;
        vec3 worldPosition = vec3(vLakePoint.x, waterY + 0.006, vLakePoint.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      ${candlelight}
      ${coastWaterOptics}
      varying vec2 vPatch, vLakePoint;
      varying float vEyeAboveWater;

      void main() {
        vec2 fromEye = vLakePoint - cameraPosition.xz;
        float range = length(fromEye);
        float facing = vEyeAboveWater / max(0.01, length(vec3(fromEye, vEyeAboveWater)));
        vec2 ray = fromEye / max(0.01, range);
        float along = dot(vLakePoint, ray);
        float across = dot(vLakePoint, vec2(-ray.y, ray.x));
        float ripplePhase = along * 7.4 + across * 1.8 + 1.13 * uLanternTime;
        float resolution = 1.0 - smoothstep(0.74, 3.14, fwidth(ripplePhase));
        float move = resolution * (0.17 * sin(ripplePhase) + 0.10 * sin(ripplePhase * 0.63 + across * 2.0));
        float width = mix(0.76, 0.39, vPatch.y);
        float body = 1.0 - smoothstep(width * 0.22, width, abs(vPatch.x + move));
        float trail = smoothstep(0.0, 0.095, vPatch.y) * (1.0 - smoothstep(0.37, 1.0, vPatch.y));
        float ripples = mix(0.70, 0.34 + 0.66 * smoothstep(-0.53, 0.58, sin(ripplePhase)), resolution);
        float attenuation = exp(-0.0000045 * range * range);
        float fresnel = waterFresnel(facing) * smoothstep(0.03, 0.25, vEyeAboveWater);
        float alpha = body * trail * ripples * attenuation * fresnel
          * lanternFlicker() * mix(0.17, 0.85, uLanternNight);
        vec3 reflectedPaper = mix(vec3(0.66, 0.53, 0.34), lanternFlameColor(), uLanternNight);
        gl_FragColor = vec4(reflectedPaper, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  return { paper, reflection, time, night };
}
