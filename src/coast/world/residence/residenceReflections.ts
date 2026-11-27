import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { CoastQuality } from '../../CoastWorld';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import type { ResidenceMaterials } from './residenceMaterials';
import { createResidenceScreenOcclusion } from './residenceScreenOcclusion';
import { RESIDENCE_BALCONY_DOOR } from './residencePlan';
import { EAST_GLASS_EAST, SOUTH_GLASS_NORTH } from './residenceShell';

function makeCapture(position: THREE.Vector3, yaw: number, pitch = 0) {
  const geometry = new THREE.PlaneGeometry();
  const reflector = new Reflector(geometry, { textureWidth: 320, textureHeight: 200, clipBias: .0018, multisample: 0 });
  reflector.position.copy(position);
  reflector.rotation.set(pitch, yaw, 0);
  reflector.updateMatrixWorld(true);
  const material = reflector.material as THREE.ShaderMaterial;
  const inverseTransform = reflector.matrixWorld.clone().invert();
  return {
    reflector,
    geometry,
    material,
    position,
    normal: new THREE.Vector3(0, 0, 1).applyQuaternion(reflector.quaternion),
    inverseTransform,
    visible: { value: 0 },
    matrix: { value: new THREE.Matrix4() },
    texture: { value: reflector.getRenderTarget().texture },
    bounds: new THREE.Box3(),
  };
}

export function createResidenceReflections(scene: THREE.Scene, exterior: THREE.Object3D, shell: THREE.Group,
  furniture: THREE.Group, materials: ResidenceMaterials) {
  const south = makeCapture(new THREE.Vector3(0, 0, -SOUTH_GLASS_NORTH), Math.PI);
  const east = makeCapture(new THREE.Vector3(EAST_GLASS_EAST, 0, 0), -Math.PI / 2);
  const balconyEast = RESIDENCE_BALCONY_DOOR.e;
  const bedroom = makeCapture(new THREE.Vector3(balconyEast, 0, 0), -Math.PI / 2);
  const floor = makeCapture(new THREE.Vector3(0, -.006, 0), 0, -Math.PI / 2);
  floor.texture.value.generateMipmaps = true;
  floor.texture.value.minFilter = THREE.LinearMipmapLinearFilter;
  const floorMaterials = [materials.oak, materials.stone, materials.tile];
  const rendersHiddenInCaptures: THREE.Mesh[] = [];
  const meshBounds = new THREE.Box3();
  shell.updateMatrixWorld(true);
  shell.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.material === materials.oak || object.material === materials.stone || object.material === materials.tile) {
      meshBounds.setFromObject(object);
      floor.bounds.union(meshBounds);
    }
    if (object.material !== materials.glass) return;
    rendersHiddenInCaptures.push(object);
    meshBounds.setFromObject(object);
    if (Math.abs(meshBounds.min.z + SOUTH_GLASS_NORTH) < .001
      && Math.abs(meshBounds.max.z - meshBounds.min.z) < .001) south.bounds.union(meshBounds);
    if (Math.abs(meshBounds.min.x - EAST_GLASS_EAST) < .001
      && Math.abs(meshBounds.max.x - meshBounds.min.x) < .001) east.bounds.union(meshBounds);
    if (Math.abs(meshBounds.min.x - balconyEast) < .055
      && Math.abs(meshBounds.max.x - meshBounds.min.x) < .001) bedroom.bounds.union(meshBounds);
  });
  const mirrors: ReturnType<typeof makeCapture>[] = [];
  furniture.updateMatrixWorld(true);
  furniture.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.material !== materials.clearMirror) return;
    rendersHiddenInCaptures.push(object);
    meshBounds.setFromObject(object);
    const position = meshBounds.getCenter(new THREE.Vector3());
    const eastFacing = meshBounds.max.x - meshBounds.min.x < meshBounds.max.z - meshBounds.min.z;
    if (eastFacing) position.x = meshBounds.max.x;
    else position.z = meshBounds.max.z;
    const capture = makeCapture(position, eastFacing ? Math.PI / 2 : 0);
    capture.bounds.copy(meshBounds);
    mirrors.push(capture);
  });
  const windows = [south, east, bedroom];
  const captures = [...windows, ...mirrors, floor];
  floor.bounds.min.y = -.025;
  floor.bounds.max.y = .025;

  const night = { value: 0 };
  const readReflection = `
      vec4 readResidenceReflection(sampler2D photo, mat4 projection, vec3 point) {
        vec4 texel = projection * vec4(point, 1.0);
        vec2 uv = texel.xy / max(0.0001, texel.w);
        vec2 edge = min(uv, 1.0 - uv);
        return texture2D(photo, uv) * smoothstep(0.0, 0.012, min(edge.x, edge.y));
      }`;
  const previous = materials.glass.onBeforeCompile.bind(materials.glass);
  materials.glass.customProgramCacheKey = () => 'residence-planar-glazing';
  materials.glass.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    Object.assign(shader.uniforms, {
      windowSouthImage: south.texture, windowEastImage: east.texture, windowBedroomImage: bedroom.texture,
      windowSouthMatrix: south.matrix, windowEastMatrix: east.matrix, windowBedroomMatrix: bedroom.matrix,
      windowSouthVisible: south.visible, windowEastVisible: east.visible, windowBedroomVisible: bedroom.visible,
      windowNight: night,
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 residencePanePoint;`).replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      residencePanePoint = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 residencePanePoint;
      uniform sampler2D windowSouthImage;
      uniform sampler2D windowEastImage;
      uniform sampler2D windowBedroomImage;
      uniform mat4 windowSouthMatrix;
      uniform mat4 windowEastMatrix;
      uniform mat4 windowBedroomMatrix;
      uniform float windowSouthVisible;
      uniform float windowEastVisible;
      uniform float windowBedroomVisible;
      uniform float windowNight;${readReflection}`).replace('#include <opaque_fragment>', `
      vec4 reflection = vec4(0.0);
      if (windowSouthVisible > 0.5 && abs(residencePanePoint.z + ${SOUTH_GLASS_NORTH.toFixed(3)}) < 0.0015) {
        reflection = readResidenceReflection(windowSouthImage, windowSouthMatrix, residencePanePoint);
      } else if (windowEastVisible > 0.5 && abs(residencePanePoint.x - ${EAST_GLASS_EAST.toFixed(3)}) < 0.0015) {
        reflection = readResidenceReflection(windowEastImage, windowEastMatrix, residencePanePoint);
      } else if (windowBedroomVisible > 0.5 && abs(residencePanePoint.x - ${balconyEast.toFixed(3)}) < 0.055) {
        reflection = readResidenceReflection(windowBedroomImage, windowBedroomMatrix, residencePanePoint);
      }
      float surfaceReflection = reflection.a * mix(0.040, 0.101, windowNight) * (1.0 + 1.22 * grazing);
      outgoingLight = (outgoingLight * diffuseColor.a + reflection.rgb * surfaceReflection)
        / max(0.001, diffuseColor.a + surfaceReflection);
      diffuseColor.a += surfaceReflection;
      #include <opaque_fragment>`);
  };

  const mirrorImage = { value: south.texture.value };
  const mirrorMatrix = { value: new THREE.Matrix4() };
  const mirrorPosition = { value: new THREE.Vector3() };
  const mirrorNormal = { value: new THREE.Vector3() };
  const mirrorVisible = { value: 0 };
  const priorMirror = materials.clearMirror.onBeforeCompile.bind(materials.clearMirror);
  const mirrorKey = materials.clearMirror.customProgramCacheKey();
  materials.clearMirror.customProgramCacheKey = () => `${mirrorKey}|residence-planar-mirror`;
  materials.clearMirror.onBeforeCompile = (shader, renderer) => {
    priorMirror(shader, renderer);
    Object.assign(shader.uniforms, { mirrorImage, mirrorMatrix, mirrorPosition, mirrorNormal, mirrorVisible });
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D mirrorImage;
      uniform mat4 mirrorMatrix;
      uniform vec3 mirrorPosition;
      uniform vec3 mirrorNormal;
      uniform float mirrorVisible;${readReflection}`).replace('#include <opaque_fragment>', `
      vec3 mirrorOffset = vResidenceWorld - mirrorPosition;
      if (mirrorVisible > 0.5 && abs(dot(mirrorOffset, mirrorNormal)) < 0.003 && length(mirrorOffset) < 1.1) {
        vec4 reflection = readResidenceReflection(mirrorImage, mirrorMatrix, vResidenceWorld);
        outgoingLight = mix(outgoingLight, reflection.rgb * diffuseColor.rgb, reflection.a * 0.92);
      }
      #include <opaque_fragment>`);
  };


  const floorImage: { value: THREE.Texture | null } = { value: null };
  const daySky = new THREE.Color().setRGB(1.46, 1.79, 2.34);
  const nightSky = new THREE.Color().setRGB(.013, .025, .061);
  for (const surface of floorMaterials) {
    const before = surface.onBeforeCompile.bind(surface);
    const cacheKey = surface.customProgramCacheKey();
    surface.customProgramCacheKey = () => `${cacheKey}|residence-floor-reflection`;
    surface.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, { floorImage, floorMatrix: floor.matrix, floorVisible: floor.visible });
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        uniform sampler2D floorImage;
        uniform mat4 floorMatrix;
        uniform float floorVisible;`).replace('#include <opaque_fragment>', `
        if (floorVisible > 0.5 && abs(vResidenceWorld.y) < 0.038 && surfaceNormal.y > 0.82) {
          vec4 floorProjection = floorMatrix * vec4(vResidenceWorld, 1.0);
          vec2 floorUV = floorProjection.xy / max(0.001, floorProjection.w);
          floorUV += (geometryNormal.xy - nonPerturbedNormal.xy) * 0.020;
          vec2 safeEdge = min(floorUV, 1.0 - floorUV);
          float edge = smoothstep(0.006, 0.036, min(safeEdge.x, safeEdge.y));
          float spread = 1.0 + material.roughness * 3.6 + min(1.0, floorProjection.w * 0.08);
          vec3 reflectedRoom = textureLod(floorImage, floorUV, spread).rgb;
          float viewNormal = clamp(dot(nonPerturbedNormal, geometryViewDir), 0.0, 1.0);
          float fresnel = 0.036 + 0.36 * pow(1.0 - viewNormal, 4.0);
          outgoingLight += reflectedRoom * fresnel * (0.92 - 0.40 * material.roughness) * edge;
        }
        #include <opaque_fragment>`);
    };
  }

  const nearOcclusion = createResidenceScreenOcclusion(shell, furniture);
  const clear = new THREE.Color();
  const viewport = new THREE.Vector4();
  const scissor = new THREE.Vector4();
  const size = new THREE.Vector2();
  const viewPoint = new THREE.Vector3();
  const planeToCamera = new THREE.Vector3();
  const projectionView = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const latestPosition = new THREE.Vector3();
  const latestRotation = new THREE.Quaternion();
  const rotation = new THREE.Quaternion();
  const latestProjection = new THREE.Matrix4();
  const floorPosition = new THREE.Vector3();
  const floorRotation = new THREE.Quaternion();
  let floorHasImage = false;
  // Recapture once after the main pass refreshes the static shadow maps on a time or quality change.
  let pendingRefreshes = 2;
  let quality: CoastQuality = 'light';
  const exteriorVisibility: boolean[] = [];

  function prepareRender(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera) {
    if (renderer.xr.isPresenting) {
      for (const capture of captures) capture.visible.value = 0;
      mirrorVisible.value = 0;
      floorImage.value = null;
      floorHasImage = false;
      nearOcclusion.setActive(false);
      pendingRefreshes = 2;
      return;
    }
    if (renderer.shadowMap.enabled) {
      const missing: THREE.LightShadow[] = [];
      scene.traverseVisible(object => {
        if (!(object instanceof THREE.Light) || !object.castShadow || !object.layers.test(camera.layers)) return;
        const shadow = (object as THREE.DirectionalLight | THREE.PointLight | THREE.SpotLight).shadow;
        if (shadow && !shadow.map) missing.push(shadow);
      });
      if (missing.length) {
        // Reflector disables shadow updates during its offscreen render. Let the
        // main camera create typed shadow textures before any capture samples them.
        for (const shadow of missing) shadow.needsUpdate = true;
        renderer.shadowMap.needsUpdate = true;
        for (const capture of captures) capture.visible.value = 0;
        mirrorVisible.value = 0;
        floorImage.value = null;
        floorHasImage = false;
        nearOcclusion.setActive(false);
        pendingRefreshes = Math.max(pendingRefreshes, 2);
        return;
      }
    }
    camera.updateMatrixWorld();
    camera.getWorldPosition(viewPoint);
    camera.getWorldQuaternion(rotation);
    if (pendingRefreshes === 0 && viewPoint.distanceToSquared(latestPosition) < .000016 && rotation.dot(latestRotation) > .999995
      && latestProjection.equals(camera.projectionMatrix)) return;
    latestPosition.copy(viewPoint);
    latestRotation.copy(rotation);
    latestProjection.copy(camera.projectionMatrix);
    const refreshing = pendingRefreshes > 0;
    pendingRefreshes = Math.max(0, pendingRefreshes - 1);
    frustum.setFromProjectionMatrix(projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const visible = windows.filter(capture => {
      const distance = planeToCamera.subVectors(viewPoint, capture.position).dot(capture.normal);
      capture.visible.value = 0;
      if (capture === bedroom && (viewPoint.x < 16.4 || viewPoint.z < -15.9 || viewPoint.z > -11.4)) return false;
      return distance > .07 && distance < 14 && frustum.intersectsBox(capture.bounds);
    });
    mirrorVisible.value = 0;
    const mirror = mirrors.find(capture => planeToCamera.subVectors(viewPoint, capture.position).dot(capture.normal) > .07
      && planeToCamera.lengthSq() < 14.44 && frustum.intersectsBox(capture.bounds));
    if (mirror) visible.push(mirror);
    const floorInView = quality === 'high' && viewPoint.y > .12 && viewPoint.y < 3.5 && frustum.intersectsBox(floor.bounds);
    if (floorInView && (!floorHasImage || refreshing || floorPosition.distanceToSquared(viewPoint) > .0049
      || floorRotation.dot(rotation) < .99991)) visible.push(floor);
    floor.visible.value = Number(floorInView && floorHasImage);
    const useNearOcclusion = quality === 'high' && viewPoint.y < 3.5;
    if (!visible.length && !useNearOcclusion) return;

    renderer.getDrawingBufferSize(size);
    const width = Math.max(160, Math.min(quality === 'high' ? 640 : 448,
      Math.round(size.x * (quality === 'high' ? .53 : .40))));
    const height = Math.max(90, Math.round(width * size.y / Math.max(size.x, 1)));
    const mirrorWidth = Math.min(quality === 'high' ? 1250 : 900, Math.max(640, size.x));
    const floorWidth = Math.min(576, Math.max(288, Math.round(size.x * .32)));
    const reflectionType = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const target = renderer.getRenderTarget();
    const targetFace = renderer.getActiveCubeFace();
    const targetMip = renderer.getActiveMipmapLevel();
    renderer.getViewport(viewport);
    renderer.getScissor(scissor);
    const scissorTest = renderer.getScissorTest();
    renderer.getClearColor(clear);
    const alpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    const xrEnabled = renderer.xr.enabled;
    const autoShadow = renderer.shadowMap.autoUpdate;
    const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    const exteriorWasVisible = exterior.visible;
    const background = scene.background;

    try {
      exterior.visible = false;
      floor.visible.value = 0;
      floorImage.value = null;
      nearOcclusion.setActive(false);
      scene.background = null;
      renderer.setClearColor(0, 0);
      renderer.autoClear = true;
      renderer.shadowMap.needsUpdate = false;
      for (let index = 0; index < rendersHiddenInCaptures.length; index += 1) {
        exteriorVisibility[index] = rendersHiddenInCaptures[index].visible;
        rendersHiddenInCaptures[index].visible = false;
      }
      for (const capture of visible) {
        const captureTarget = capture.reflector.getRenderTarget();
        // The silvered mirrors occupy more pixels at arm's length and retain a sharper image.
        captureTarget.texture.type = reflectionType;
        const captureWidth = capture === mirror ? mirrorWidth : capture === floor ? floorWidth : width;
        captureTarget.setSize(captureWidth, Math.round(captureWidth * height / width));
        if (capture === floor) scene.background = night.value > .5 ? nightSky : daySky;
        capture.reflector.onBeforeRender(renderer, scene, camera, capture.geometry, capture.material, shell);
        capture.matrix.value.multiplyMatrices(
          capture.material.uniforms.textureMatrix.value as THREE.Matrix4, capture.inverseTransform);
        if (capture === floor) {
          floorHasImage = true;
          floorPosition.copy(viewPoint);
          floorRotation.copy(rotation);
        } else capture.visible.value = 1;
      }
      if (mirror) {
        mirrorImage.value = mirror.texture.value;
        mirrorMatrix.value.copy(mirror.matrix.value);
        mirrorNormal.value.copy(mirror.normal);
        mirrorPosition.value.copy(mirror.position);
        mirrorVisible.value = 1;
      }
      if (useNearOcclusion) {
        for (const [index, mesh] of rendersHiddenInCaptures.entries()) {
          // The opaque mirror has a screen edge. The transparent panes do not occlude interior light.
          if (mesh.material === materials.clearMirror) mesh.visible = exteriorVisibility[index];
        }
        scene.background = null;
        renderer.shadowMap.autoUpdate = false;
        const depthWidth = Math.min(960, Math.max(480, Math.round(size.x * .51)));
        nearOcclusion.capture(renderer, scene, camera, depthWidth, Math.round(depthWidth * height / width));
        nearOcclusion.setActive(true);
      }
    } finally {
      for (let index = 0; index < rendersHiddenInCaptures.length; index += 1) {
        rendersHiddenInCaptures[index].visible = exteriorVisibility[index];
      }
      floor.visible.value = Number(floorInView && floorHasImage);
      floorImage.value = floor.visible.value ? floor.texture.value : null;
      scene.background = background;
      exterior.visible = exteriorWasVisible;
      renderer.xr.enabled = xrEnabled;
      renderer.shadowMap.autoUpdate = autoShadow;
      renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
      renderer.autoClear = autoClear;
      renderer.setClearColor(clear, alpha);
      renderer.setRenderTarget(target, targetFace, targetMip);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
    }
  }

  return {
    prepareRender,
    invalidate() { pendingRefreshes = 2; },
    setQuality(value: CoastQuality) {
      quality = value;
      if (quality === 'light') nearOcclusion.setActive(false);
      pendingRefreshes = 2;
    },
    setTimeOfDay(time: CoastTimeOfDay) {
      night.value = Number(time === 'night');
      pendingRefreshes = 2;
    },
    dispose() {
      nearOcclusion.dispose();
      for (const { geometry, reflector } of captures) {
        reflector.dispose();
        geometry.dispose();
      }
    },
  };
}
