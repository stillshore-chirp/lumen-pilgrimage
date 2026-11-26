import * as THREE from 'three';
import { coastRandom } from '../../terrain';
import { bindCoastSky, coastSkyGlsl, type CoastAtmosphere, type CoastTimeOfDay } from '../coastAtmosphere';
import { coastMilkyWayGlsl, createCoastMilkyWay, sampleGalacticStars } from '../coastMilkyWay';
import { buildLakeSkyClouds } from './lakeSkyClouds';
import { lakeSkyRadianceGlsl } from './lakeSkyRadiance';

const lakeMilkyWayGlsl = /* glsl */`
  ${coastMilkyWayGlsl}

  vec3 lakeMilkyWay(vec3 direction) {
    return coastMilkyWay(direction) * 0.34;
  }
`;

const skyVertexShader = /* glsl */`
  varying vec3 vDirection;

  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`;

function createLakeStars(atmosphere: CoastAtmosphere, galaxy: ReturnType<typeof createCoastMilkyWay>) {
  const random = coastRandom(36427);
  const directions: number[] = [];
  const photometry: number[] = [];
  // Uniform solid angle above the horizon, with a long tail of faint stars.
  for (let i = 0; i < 10300; i += 1) {
    const azimuth = random() * Math.PI * 2;
    const y = random();
    const horizontal = Math.sqrt(1 - y * y);
    directions.push(Math.cos(azimuth) * horizontal, y, Math.sin(azimuth) * horizontal);
    photometry.push(random() ** 3.45, random());
  }
  sampleGalacticStars(random, directions, photometry);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(directions, 3));
  geometry.setAttribute('photometry', new THREE.Float32BufferAttribute(photometry, 2));
  const pixelRatio = { value: 1 };
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { uPixelRatio: pixelRatio, uStarVisibility: atmosphere.starVisibility, ...galaxy.uniforms },
    vertexShader: /* glsl */`
      attribute vec2 photometry;
      uniform float uPixelRatio;
      varying vec3 vDirection;
      varying vec2 vPhotometry;

      void main() {
        vDirection = position;
        vPhotometry = photometry;
        gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position.z = gl_Position.w;
        gl_PointSize = (1.45 + 2.65 * pow(photometry.x, 0.7)) * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uStarVisibility;
      varying vec3 vDirection;
      varying vec2 vPhotometry;
      ${coastSkyGlsl}
      ${lakeMilkyWayGlsl}

      void main() {
        vec2 offset = 2.0 * gl_PointCoord - 1.0;
        float radius = dot(offset, offset);
        float moonSeparation = 1.0 - dot(vDirection, uCoastSunDirection);
        if (radius >= 1.0 || moonSeparation <= 0.002) discard;
        float visibility = smoothstep(0.013, 0.23, vDirection.y)
          * smoothstep(0.002, 0.062, moonSeparation) * uStarVisibility;
        float energy = 0.026 + 0.58 * pow(vPhotometry.x, 2.35);
        vec3 tint = mix(vec3(0.72, 0.85, 1.0), vec3(1.0, 0.87, 0.72), vPhotometry.y);
        vec3 sky = coastNightSky(vDirection) + lakeMilkyWay(vDirection);
        gl_FragColor = vec4(sky + tint * energy * visibility * (1.0 - smoothstep(0.0, 1.0, radius)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  bindCoastSky(material.uniforms, atmosphere);
  const stars = new THREE.Points(geometry, material);
  stars.name = 'Lake stars';
  stars.renderOrder = -99;
  stars.frustumCulled = false;
  stars.onBeforeRender = renderer => { pixelRatio.value = renderer.getPixelRatio(); };
  return stars;
}

export function buildLakeSky(root: THREE.Group | THREE.Scene, atmosphere: CoastAtmosphere) {
  const sky = new THREE.Group();
  sky.name = 'Lake sky';
  root.add(sky);

  const galaxy = createCoastMilkyWay();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 28, 18), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    uniforms: { ...galaxy.uniforms },
    vertexShader: skyVertexShader,
    fragmentShader: /* glsl */`
      varying vec3 vDirection;
      ${coastSkyGlsl}
      ${lakeMilkyWayGlsl}
      ${lakeSkyRadianceGlsl}

      void main() {
        vec3 direction = normalize(vDirection);
        gl_FragColor = vec4(lakeSkyRadiance(direction) + coastSunRadiance(direction) + lakeMilkyWay(direction), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  dome.name = 'Lake sky dome';
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  bindCoastSky(dome.material.uniforms, atmosphere);
  const stars = createLakeStars(atmosphere, galaxy);
  stars.visible = atmosphere.night.value > 0.5 && atmosphere.starVisibility.value > 0;
  dome.add(stars);
  sky.add(dome);
  const clouds = buildLakeSkyClouds(sky, atmosphere);
  let disposed = false;

  return {
    setTimeOfDay(time: CoastTimeOfDay): void {
      stars.visible = time === 'night' && atmosphere.starVisibility.value > 0;
    },
    update(elapsed: number): void {
      clouds.update(elapsed);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      sky.removeFromParent();
      clouds.dispose();
      dome.geometry.dispose();
      dome.material.dispose();
      stars.geometry.dispose();
      stars.material.dispose();
      galaxy.radiance.dispose();
    },
  };
}
