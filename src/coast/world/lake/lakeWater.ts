import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { CoastQuality } from '../../CoastWorld';
import { bindCoastSky, type CoastAtmosphere } from '../coastAtmosphere';
import { LAKE_HALL, LAKE_TERRAIN, LAKE_WATER_Y } from './lakeLayout';
import { lakeBedShader, lakeWaterShader } from './lakeWaterShaders';

const LAKE_BACK_Z = LAKE_TERRAIN.shoreZ - 40;
const LAKE_NEAR_Z = 220;
const LAKE_HALF_WIDTH = 680;
const SHALLOW_DEPTH = 0.84;
const DEEP_DEPTH = 12;
const SHALLOWS_END_Z = -32;
const DEEP_WATER_Z = -94;
const REFLECTION_SIZES = {
  light: { width: 384, height: 216, interval: 0.22 },
  high: { width: 640, height: 360, interval: 0.12 },
};

function createLakeGeometry(rows: readonly number[], depthAt: (z: number) => number): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const [row, z] of rows.entries()) {
    const depth = depthAt(z);
    // Reflector takes its plane normal from local +Z. Rotation maps it to world +Y.
    vertices.push(-LAKE_HALF_WIDTH, -z, -depth, LAKE_HALF_WIDTH, -z, -depth);
    if (row > 0) {
      const i = row * 2;
      indices.push(i - 2, i - 1, i, i, i - 1, i + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function lakeDepthAt(z: number): number {
  return THREE.MathUtils.lerp(SHALLOW_DEPTH, DEEP_DEPTH, THREE.MathUtils.smoothstep(-z, -SHALLOWS_END_Z, -DEEP_WATER_Z));
}

export function buildLakeWater(scene: THREE.Scene, time: THREE.IUniform<number>, atmosphere: CoastAtmosphere) {
  // Extend underneath the hall and both banks so oblique views have no exposed lake edge.
  const surfaceGeometry = createLakeGeometry([LAKE_NEAR_Z, LAKE_BACK_Z], () => 0);
  const initialSize = REFLECTION_SIZES.light;
  const surface = new Reflector(surfaceGeometry, {
    shader: lakeWaterShader,
    textureWidth: initialSize.width,
    textureHeight: initialSize.height,
    multisample: 0,
    clipBias: 0.001,
  });
  surface.name = 'Lake water surface';
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = LAKE_WATER_Y;
  surface.updateMatrixWorld();
  surface.renderOrder = 8;

  const material = surface.material as THREE.ShaderMaterial;
  material.side = THREE.DoubleSide;
  material.transparent = true;
  material.depthWrite = false;
  material.forceSinglePass = true;
  material.uniforms.uTime = time;
  material.uniforms.uDepthProfile.value.set(-SHALLOWS_END_Z, -DEEP_WATER_Z, SHALLOW_DEPTH, DEEP_DEPTH);
  bindCoastSky(material.uniforms, atmosphere);
  scene.add(surface);

  const bedGeometry = createLakeGeometry([
    LAKE_NEAR_Z, SHALLOWS_END_Z, -42, -54, -68, -82, DEEP_WATER_Z, LAKE_BACK_Z,
  ], lakeDepthAt);
  const bed = new THREE.Mesh(bedGeometry, new THREE.ShaderMaterial({
    ...lakeBedShader,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: time,
      uCoastSurfaceLight: atmosphere.surfaceLight,
    },
  }));
  bed.name = 'Lake shallow gravel bed';
  bed.rotation.copy(surface.rotation);
  bed.position.copy(surface.position);
  scene.add(bed);

  // Reflector uses only the renderer, scene and camera from the mesh callback.
  const capture = surface.onBeforeRender.bind(surface) as (
    renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  ) => void;
  surface.onBeforeRender = () => {};
  const target = surface.getRenderTarget();
  target.texture.generateMipmaps = true;
  target.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const surfaceBounds = new THREE.Box3().setFromObject(surface);
  const windowBounds = new THREE.Box3(
    new THREE.Vector3(-LAKE_HALL.halfWidth, LAKE_WATER_Y, LAKE_HALL.frontZ - 0.1),
    new THREE.Vector3(LAKE_HALL.halfWidth, LAKE_HALL.ceilingY, LAKE_HALL.frontZ + 0.1),
  );
  const viewProjection = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const eye = new THREE.Vector3();
  const capturedEye = new THREE.Vector3();
  const capturedLightDirection = new THREE.Vector3();
  const capturedProjection = new THREE.Matrix4();
  const viewport = new THREE.Vector4();
  const scissor = new THREE.Vector4();
  const hidden: THREE.Object3D[] = [];
  let quality: CoastQuality = 'light';
  let lastCapture = -Infinity;
  let capturedNight = -1;
  let capturedMoonVisibility = 1;

  function prepareRender(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    if (renderer.xr.isPresenting || !surface.visible) {
      material.uniforms.uLiveReflection.value = 0;
      lastCapture = -Infinity;
      return;
    }

    camera.updateMatrixWorld();
    eye.setFromMatrixPosition(camera.matrixWorld);
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);
    if (eye.y <= LAKE_WATER_Y + 0.04 || !frustum.intersectsBox(surfaceBounds)
      || (eye.z > LAKE_HALL.frontZ && !frustum.intersectsBox(windowBounds))) {
      material.uniforms.uLiveReflection.value = 0;
      lastCapture = -Infinity;
      return;
    }

    const night = atmosphere.night.value;
    const lightDirection = atmosphere.sun.value;
    const moonVisibility = night > 0.5 ? atmosphere.moonVisible.value : 1;
    const interval = REFLECTION_SIZES[quality].interval;
    const seconds = time.value;
    // Camera optics change both the mirror and its lookup. Sky settings also invalidate the image.
    if (night === capturedNight && lightDirection.equals(capturedLightDirection)
      && moonVisibility === capturedMoonVisibility && seconds >= lastCapture && seconds - lastCapture < interval
      && capturedProjection.equals(camera.projectionMatrix) && capturedEye.distanceToSquared(eye) < 4) return;

    if (target.texture.type === THREE.HalfFloatType && !renderer.extensions.has('EXT_color_buffer_float')) {
      target.texture.type = THREE.UnsignedByteType;
      target.dispose();
    }

    const previousTarget = renderer.getRenderTarget();
    const cubeFace = renderer.getActiveCubeFace();
    const mipLevel = renderer.getActiveMipmapLevel();
    const xrEnabled = renderer.xr.enabled;
    const shadowEnabled = renderer.shadowMap.enabled;
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    const scissorTest = renderer.getScissorTest();
    renderer.getViewport(viewport);
    renderer.getScissor(scissor);

    // The hall, glass, fish and interior fixtures do not take part in the mirror pass.
    for (const object of scene.children) {
      if (!object.visible || object === surface || object instanceof THREE.Light
        || object.name === 'Rock basin and stone ring' || object.name === 'Lake sky'
        || object.name === 'Lake sky and clouds') continue;
      object.visible = false;
      hidden.push(object);
    }
    material.uniforms.uLiveReflection.value = 0;
    try {
      // No interior shadows are needed in the basin capture. The first frame can
      // run before the main renderer has allocated its depth-compare shadow map.
      renderer.shadowMap.enabled = false;
      renderer.shadowMap.needsUpdate = false;
      capture(renderer, scene, camera);
    } finally {
      for (const object of hidden) object.visible = true;
      hidden.length = 0;
      surface.visible = true;
      renderer.xr.enabled = xrEnabled;
      renderer.shadowMap.enabled = shadowEnabled;
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
      renderer.setRenderTarget(previousTarget, cubeFace, mipLevel);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
    }

    material.uniforms.uLiveReflection.value = 1;
    lastCapture = seconds;
    capturedNight = night;
    capturedLightDirection.copy(lightDirection);
    capturedMoonVisibility = moonVisibility;
    capturedEye.copy(eye);
    capturedProjection.copy(camera.projectionMatrix);
  }

  return {
    prepareRender,
    setQuality(next: CoastQuality): void {
      if (quality === next) return;
      quality = next;
      material.uniforms.uWaterDetailLevel.value = Number(next === 'high');
      const size = REFLECTION_SIZES[next];
      target.setSize(size.width, size.height);
      material.uniforms.uLiveReflection.value = 0;
      lastCapture = -Infinity;
    },
    dispose(): void {
      scene.remove(surface, bed);
      surface.dispose();
      surfaceGeometry.dispose();
      bedGeometry.dispose();
      bed.material.dispose();
    },
  };
}
