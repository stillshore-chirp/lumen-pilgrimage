import * as THREE from 'three';

export function createResidenceTheaterLights(screen: THREE.Mesh, onChange?: () => void) {
  const enabled = { value: 0 };
  const tint = { value: new THREE.Color('#ffb875') };
  const screenCenter = { value: screen.getWorldPosition(new THREE.Vector3()) };
  screen.geometry.computeBoundingBox();
  const screenSize = screen.geometry.boundingBox!.getSize(new THREE.Vector3());
  const screenHalfSize = { value: new THREE.Vector2(screenSize.x, screenSize.y).multiplyScalar(.5) };

  return {
    enabled: () => enabled.value === 1,
    setEnabled(on: boolean) {
      const next = Number(on);
      if (enabled.value === next) return;
      enabled.value = next;
    },
    color: () => '#' + tint.value.getHexString(),
    setColor(hex: string) {
      if (!/^#[0-9a-f]{6}$/i.test(hex) || hex.toLowerCase() === '#' + tint.value.getHexString()) return;
      tint.value.set(hex);
      if (enabled.value) onChange?.();
    },
    bind(shader: THREE.WebGLProgramParametersWithUniforms) {
      Object.assign(shader.uniforms, {
        residenceTheaterEnabled: enabled, residenceTheaterTint: tint,
        residenceTheaterScreenCenter: screenCenter, residenceTheaterScreenHalfSize: screenHalfSize,
      });
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform float residenceTheaterEnabled;
        uniform vec3 residenceTheaterTint;
        uniform vec3 residenceTheaterScreenCenter;
        uniform vec2 residenceTheaterScreenHalfSize;

        float residenceTheaterFalloff(vec3 point, vec3 normal) {
          vec3 fromScreen = point - residenceTheaterScreenCenter;
          // The light source is recessed behind the screen. Its wall is nine centimetres behind the glass.
          float wall = max(0.0, normal.z) * (1.0 - smoothstep(0.018, 0.055, abs(fromScreen.z + 0.09)));
          vec2 beyondLight = max(abs(fromScreen.xy) - residenceTheaterScreenHalfSize + vec2(0.12, 0.09), 0.0);
          float upperWash = wall * exp(-10.0 * dot(beyondLight, beyondLight))
            * mix(0.70, 1.0, smoothstep(-0.70, 0.40, fromScreen.y));

          // Soft spill from the underside of the media console onto the first half metre of floor.
          float floor = max(0.0, normal.y) * (1.0 - smoothstep(0.015, 0.085, abs(point.y)))
            * smoothstep(-0.06, 0.08, fromScreen.z);
          vec2 beneathConsole = vec2(max(0.0, abs(fromScreen.x) - 0.69), fromScreen.z - 0.15);
          float floorWash = floor * exp(-dot(beneathConsole, beneathConsole * vec2(6.2, 5.4)));
          return 0.24 * upperWash + 0.095 * floorWash;
        }`).replace('irradiance += roomIrradiance * 0.75;', `
        if (residenceTheaterEnabled > 0.5) {
          roomIrradiance += residenceTheaterTint * residenceTheaterFalloff(vResidenceWorld, surfaceNormal);
        }
        irradiance += roomIrradiance * 0.75;`);
    },
    dispose() { enabled.value = 0; },
  };
}
