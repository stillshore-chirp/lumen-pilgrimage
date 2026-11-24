import * as THREE from 'three';
import { coastNoise } from '../coastNoise';
import type { OverlookFinishes } from './overlookModel';
import { DECK_FRONT, DECK_SIDE } from './overlookTerrain';

export type DeckContact = (
  level: 'main' | 'upper', x: number, z: number, width: number, depth: number, reach: number, strength: number,
) => void;

export const PARAPET_CAP = { y: 0.787, width: 0.88, height: 0.054, pitch: 2.15 };

export type DeckWallLamp = { x: number; z: number; yaw: number };

export function createOverlookDeckContacts() {
  const west = -DECK_SIDE - 1;
  const south = -25;
  const width = 1024, height = 768;
  const spanX = -west * 2, spanZ = 57;
  const dx = spanX / width, dz = spanZ / height;
  const pixels = new Uint8Array(width * height * 2);
  const add: DeckContact = (level, x, z, footprintWidth, footprintDepth, reach, strength) => {
    const halfWidth = footprintWidth * 0.5, halfDepth = footprintDepth * 0.5;
    const left = Math.max(0, Math.floor((x - halfWidth - reach - west) / dx));
    const right = Math.min(width, Math.ceil((x + halfWidth + reach - west) / dx));
    const near = Math.max(0, Math.floor((z - halfDepth - reach - south) / dz));
    const far = Math.min(height, Math.ceil((z + halfDepth + reach - south) / dz));
    const channel = level === 'main' ? 0 : 1;
    for (let row = near; row < far; row += 1) {
      const offsetZ = Math.max(0, Math.abs(south + (row + 0.5) * dz - z) - halfDepth);
      for (let col = left; col < right; col += 1) {
        const offsetX = Math.max(0, Math.abs(west + (col + 0.5) * dx - x) - halfWidth);
        const distance = Math.hypot(offsetX, offsetZ);
        const occlusion = (1 - THREE.MathUtils.smoothstep(distance, 0, reach)) * strength;
        const index = (row * width + col) * 2 + channel;
        pixels[index] = Math.max(pixels[index], Math.round(occlusion * 255));
      }
    }
  };

  return {
    add,
    apply(
      finish: OverlookFinishes, lamps: readonly DeckWallLamp[], upperHeight: number,
      high: THREE.IUniform<number>, night: THREE.IUniform<number>, lights: THREE.IUniform<number>,
    ) {
      const contact = new THREE.DataTexture(pixels, width, height, THREE.RGFormat);
      contact.name = 'Pavement contact shadow distances';
      contact.magFilter = THREE.LinearFilter;
      contact.minFilter = THREE.LinearMipmapLinearFilter;
      contact.generateMipmaps = true;
      contact.anisotropy = 4;
      contact.needsUpdate = true;

      const lampFrames = lamps.map(({ x, z, yaw }) => {
        const nx = Math.sin(yaw), nz = Math.cos(yaw);
        return new THREE.Vector4(x + 0.465 * nx, z + 0.465 * nz, nx, nz);
      });
      const stone = [finish.paving, finish.limestone, finish.cream, finish.shadowStone, finish.foundation, finish.mortar];
      for (const material of [...stone, finish.iron, finish.bronze, finish.brass, finish.pewter]) {
        material.onBeforeCompile = shader => {
          shader.uniforms.uDeckHigh = high;
          shader.uniforms.uDeckNight = night;
          shader.uniforms.uDeckLights = lights;
          shader.uniforms.uDeckStone = { value: Number(stone.includes(material)) };
          shader.uniforms.uDeckContact = { value: contact };
          shader.uniforms.uDeckWallLamps = { value: lampFrames };
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
              varying vec3 vDeckPoint;
              varying float vDeckUp;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              vDeckPoint = position;
              vDeckUp = abs(normal.y);`);
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
              varying vec3 vDeckPoint;
              varying float vDeckUp;
              uniform float uDeckHigh;
              uniform float uDeckNight;
              uniform float uDeckLights;
              uniform float uDeckStone;
              uniform sampler2D uDeckContact;
              uniform vec4 uDeckWallLamps[${lampFrames.length}];
              ${coastNoise}

              vec3 deckWallLight(vec3 stoneNormal) {
                vec3 result = vec3(0.0);
                for (int i = 0; i < ${lampFrames.length}; i++) {
                  vec4 lamp = uDeckWallLamps[i];
                  vec3 toLamp = vec3(lamp.x, 0.535, lamp.y) - vDeckPoint;
                  float distanceSquared = dot(toLamp, toLamp);
                  if (distanceSquared >= 11.0) continue;
                  vec3 lightDirection = toLamp * inversesqrt(max(distanceSquared, 0.00001));
                  float shield = smoothstep(0.015, 0.40, lightDirection.y)
                    * smoothstep(-0.68, -0.16, -dot(lightDirection.xz, lamp.zw));
                  float grazing = max(0.0, dot(stoneNormal, lightDirection));
                  result += vec3(1.0, 0.61, 0.25) * grazing * shield * (1.0 - smoothstep(6.0, 11.0, distanceSquared))
                    * (0.84 / (1.0 + 2.1 * distanceSquared));
                }
                return result;
              }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
              float deckRelief = 0.0;
              if (uDeckHigh > 0.0) {
                vec2 face = mix(vec2(vDeckPoint.x + vDeckPoint.z, vDeckPoint.y), vDeckPoint.xz, vDeckUp);
                float distanceFade = 1.0 - smoothstep(19.0, 72.0, length(vViewPosition));
                float grainWidth = max(length(dFdx(face)), length(dFdy(face)));
                float grains = coastNoise(face * 14.0) - 0.5;
                grains *= 1.0 - smoothstep(0.026, 0.095, grainWidth);
                float pores = coastNoise(face * 4.5 + vec2(10.4, 2.7));
                float veins = coastNoise(face * vec2(0.75, 5.0) + 0.68 * pores);
                float mineral = (veins - 0.5) * 0.23 + grains * 0.12;
                float patina = smoothstep(0.30, 0.71, coastNoise(face * vec2(0.55, 1.22)));
                vec3 stoneTint = mix(vec3(0.82, 0.84, 0.82), vec3(1.14, 1.075, 0.99), patina);
                vec3 metalTint = mix(vec3(0.77, 0.84, 0.88), vec3(1.12, 1.08, 0.97), patina);
                diffuseColor.rgb *= mix(vec3(1.0), mix(metalTint, stoneTint, uDeckStone) + mineral, distanceFade);
                deckRelief = (0.0032 * pores + 0.0050 * grains + 0.0026 * veins) * distanceFade * uDeckStone;

                // The coping shares its footprint with light mode. Its high-quality
                // surface resolves the individual capstones and their mortar joints.
                float atFront = 1.0 - step(${(PARAPET_CAP.width * 0.5 + 0.002).toFixed(3)},
                  abs(vDeckPoint.z - ${DECK_FRONT.toFixed(1)}));
                float atSide = 1.0 - step(${(PARAPET_CAP.width * 0.5 + 0.002).toFixed(3)},
                  abs(abs(vDeckPoint.x) - ${DECK_SIDE.toFixed(1)}));
                float cap = max(atFront, atSide) * uDeckStone
                  * (1.0 - step(${(PARAPET_CAP.height * 0.5 + 0.001).toFixed(3)}, abs(vDeckPoint.y - ${PARAPET_CAP.y})));
                float stone = (mix(vDeckPoint.z, vDeckPoint.x, atFront) + 0.6) / ${PARAPET_CAP.pitch};
                float jointDistance = abs(fract(stone + 0.5) - 0.5) * ${PARAPET_CAP.pitch};
                float seam = 1.0 - smoothstep(0.005, 0.019 + 0.45 * grainWidth, jointDistance);
                float capstoneTint = coastHash(vec2(floor(stone + 0.5), 12.0)) - 0.5;
                diffuseColor.rgb *= 1.0 + (0.16 * capstoneTint - 0.48 * seam) * cap;
                deckRelief -= 0.006 * seam * cap;
              }`)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
              if (uDeckHigh > 0.0) {
                vec3 tangentX = dFdx(-vViewPosition), tangentY = dFdy(-vViewPosition);
                vec3 acrossX = cross(tangentY, normal), acrossY = cross(normal, tangentX);
                float orientation = dot(tangentX, acrossX);
                vec3 gradient = dFdx(deckRelief) * acrossX + dFdy(deckRelief) * acrossY;
                normal = normalize(max(abs(orientation), 1e-8) * normal - sign(orientation) * gradient);
              }`)
            .replace('#include <aomap_fragment>', `#include <aomap_fragment>
              if (uDeckHigh > 0.0) {
                float mainContact = 1.0 - smoothstep(0.03, 0.31, abs(vDeckPoint.y));
                float upperContact = 1.0 - smoothstep(0.025, 0.20, abs(vDeckPoint.y - ${upperHeight.toFixed(2)}));
                vec2 contactUv = (vDeckPoint.xz - vec2(${west.toFixed(1)}, ${south.toFixed(1)}))
                  / vec2(${spanX.toFixed(1)}, ${spanZ.toFixed(1)});
                float contact = dot(texture2D(uDeckContact, contactUv).rg, vec2(mainContact, upperContact));
                reflectedLight.indirectDiffuse *= 1.0 - 0.68 * contact;
                reflectedLight.indirectSpecular *= 1.0 - 0.68 * contact;
                if (uDeckLights > 0.0 && uDeckStone > 0.0 && vDeckPoint.y < 0.54
                  && (vDeckPoint.z < -19.9 || abs(vDeckPoint.x) > 31.4)) {
                  vec3 stoneNormal = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
                  reflectedLight.directDiffuse += deckWallLight(stoneNormal) * diffuseColor.rgb * (1.0 - 0.4 * contact);
                }
                if (uDeckNight > 0.0 && uDeckStone == 0.0) {
                  vec3 ray = reflect(-normalize(vViewPosition), normal);
                  vec3 skyRay = (vec4(ray, 0.0) * viewMatrix).xyz;
                  skyRay.y = max(0.0, skyRay.y) + 0.26;
                  float grazing = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
                  vec3 skyLight = coastSkyRadiance(normalize(skyRay));
                  reflectedLight.indirectSpecular += skyLight * (0.23 + 0.43 * grazing) * (1.0 - 0.68 * contact);
                }
              }`);
        };
      }
      return contact;
    },
  };
}
