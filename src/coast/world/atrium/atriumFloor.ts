import {
  Box3, Frustum, Group, LinearMipmapLinearFilter, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion,
  RepeatWrapping, ShaderChunk, SRGBColorSpace, TextureLoader, UnsignedByteType, Vector2, Vector3, Vector4,
} from 'three';
import type { PerspectiveCamera, Scene, ShaderMaterial, WebGLRenderer } from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { CoastQuality } from '../../CoastWorld';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import {
  ATRIUM_BOUNDS, ATRIUM_CAFE, ATRIUM_FIRST_BRIDGE, ATRIUM_FIRST_LEVEL_FORECOURT, ATRIUM_GALLERY_EDGE,
  ATRIUM_LEVELS, ATRIUM_LOUNGE, ATRIUM_REAR_GALLERY, ATRIUM_SKYLIGHT, ATRIUM_SOFA, atriumStairFrame,
} from './atriumLayout';

const TILE_SIZE = 1.35;
const lowStair = atriumStairFrame(5.8);

const floorVertex = /* glsl */`
  varying vec3 atriumFloorPoint;
`;

const floorFragment = /* glsl */`
  varying vec3 atriumFloorPoint;
  uniform sampler2D atriumMirror;
  uniform mat4 atriumMirrorProjection;
  uniform float atriumCaptured;
  uniform float atriumFixtureLight;
  uniform float atriumDaylight;

  float atriumBand(float distanceToLine, float spread) {
    return 1.0 - smoothstep(spread * 0.30, spread, abs(distanceToLine));
  }

  float atriumTileTone(vec2 tile) {
    return fract(sin(dot(tile, vec2(12.989, 78.233))) * 4375.683);
  }

  // Each rectangle lies inside one source slab. The three marble maps share the
  // same layout; joints instead come from the 1.35 metre installation grid.
  const vec4 atriumStoneAreas[8] = vec4[8](
    vec4(0.092, 0.808, 0.164, 0.164), vec4(0.405, 0.812, 0.166, 0.166),
    vec4(0.725, 0.809, 0.166, 0.166), vec4(0.147, 0.576, 0.205, 0.205),
    vec4(0.530, 0.569, 0.207, 0.207), vec4(0.061, 0.081, 0.209, 0.209),
    vec4(0.367, 0.069, 0.221, 0.221), vec4(0.700, 0.074, 0.223, 0.223)
  );

  float atriumFirstGalleryEdge(vec2 p) {
    const float nearZ = ${ATRIUM_FIRST_LEVEL_FORECOURT.frontZ.toFixed(2)};
    const float joinZ = ${ATRIUM_FIRST_LEVEL_FORECOURT.taperZ.toFixed(2)};
    float t = clamp((nearZ - p.y) / (nearZ - joinZ), 0.0, 1.0);
    float nearEdge = p.x < 0.0 ? ${Math.abs(ATRIUM_FIRST_LEVEL_FORECOURT.westFrontX).toFixed(2)}
      : ${ATRIUM_FIRST_LEVEL_FORECOURT.eastFrontX.toFixed(2)};
    return mix(nearEdge, ${ATRIUM_GALLERY_EDGE.toFixed(2)}, t);
  }

  // The ray starts on the stone, and is evaluated from each eye by Three's cameraPosition uniform.
  // Intersect the principal luminous surfaces when a second scene render would contend with XR.
  vec3 atriumReflectedFixtures(vec3 point, vec3 ray) {
    vec3 warm = vec3(2.23, 1.65, 1.02);
    float slope = max(0.045, ray.y);
    float strips = 0.0;
    const vec3 soffits = vec3(4.033, ${(ATRIUM_LEVELS[1] - .51).toFixed(2)}, ${(ATRIUM_LEVELS[2] - .51).toFixed(2)});
    for (int i = 0; i < 3; ++i) {
      float t = soffits[i] / slope;
      vec2 hit = point.xz + ray.xz * t;
      float cleanEdge = 1.0 - smoothstep(2.9, 3.32, hit.y);
      float span = smoothstep(${ATRIUM_REAR_GALLERY.toFixed(2)}, -44.82, hit.y) * cleanEdge;
      float galleryEdge = ${(ATRIUM_GALLERY_EDGE + .16).toFixed(2)};
      float crossGallery = ${ATRIUM_REAR_GALLERY.toFixed(2)};
      float crossEnd = 1.0 - smoothstep(7.8, 8.25, abs(hit.x));
      if (i == 0) {
        galleryEdge = atriumFirstGalleryEdge(hit);
        crossGallery = ${(ATRIUM_FIRST_BRIDGE.maxZ - .14).toFixed(2)};
        crossEnd = smoothstep(${ATRIUM_FIRST_BRIDGE.minX.toFixed(2)}, ${(ATRIUM_FIRST_BRIDGE.minX + .22).toFixed(2)}, hit.x)
          * (1.0 - smoothstep(${(ATRIUM_FIRST_BRIDGE.maxX - .22).toFixed(2)}, ${ATRIUM_FIRST_BRIDGE.maxX.toFixed(2)}, hit.x));
      }
      float distanceToCove = abs(hit.x) - galleryEdge;
      float diffuser = atriumBand(distanceToCove, 0.105 + t * 0.004);
      float soffit = smoothstep(0.0, 0.32, distanceToCove) * (1.0 - smoothstep(0.38, 1.50, distanceToCove));
      strips += (diffuser + soffit * 0.27) * span;
      strips += atriumBand(hit.y - crossGallery, 0.11 + t * 0.004) * crossEnd;
    }
    float side = ray.x > 0.0 ? 1.0 : -1.0;
    float tSide = (11.42 - point.x * side) / max(0.025, abs(ray.x));
    vec2 sideHit = point.yz + ray.yz * tSide;
    float display = smoothstep(0.1, 0.65, sideHit.x) * (1.0 - smoothstep(3.1, 4.15, sideHit.x));
    display *= smoothstep(-48.0, -45.0, sideHit.y) * (1.0 - smoothstep(-4.0, 0.0, sideHit.y));
    float framing = atriumBand(fract(sideHit.y * 0.44) - 0.50, 0.12);
    float glazing = display * (0.21 + 0.51 * framing);
    vec2 skylight = point.xz + ray.xz * (${ATRIUM_SKYLIGHT.y.toFixed(2)} / slope);
    vec2 skyCenter = skylight - vec2(${ATRIUM_SKYLIGHT.x.toFixed(3)}, ${ATRIUM_SKYLIGHT.z.toFixed(2)});
    const float apertureSin = ${Math.sin(ATRIUM_SKYLIGHT.yaw).toFixed(6)};
    const float apertureCos = ${Math.cos(ATRIUM_SKYLIGHT.yaw).toFixed(6)};
    vec2 localSky = vec2(skyCenter.x * apertureCos - skyCenter.y * apertureSin,
      skyCenter.x * apertureSin + skyCenter.y * apertureCos);
    const vec2 rimRadius = vec2(${ATRIUM_SKYLIGHT.radiusX.toFixed(2)}, ${ATRIUM_SKYLIGHT.radiusZ.toFixed(2)});
    const vec2 apertureRadius = rimRadius - ${ATRIUM_SKYLIGHT.wallInset.toFixed(2)};
    float rim = atriumBand(length(localSky / rimRadius) - 1.0, 0.045);
    float opening = 1.0 - smoothstep(0.87, 1.0, length(localSky / apertureRadius));
    float skylightGrid = 1.0 - 0.57 * max(atriumBand(fract(skylight.x / 1.4) - 0.50, 0.083),
      atriumBand(fract(skylight.y / 1.7) - 0.50, 0.081));
    vec3 cool = vec3(0.29, 0.58, 0.98) * opening * skylightGrid;
    return (strips * 0.75 + glazing + 0.6 * rim) * warm * atriumFixtureLight + cool * atriumDaylight;
  }

  float atriumContact(vec2 p) {
    vec2 sofa = (p - vec2(${ATRIUM_SOFA.x}, ${ATRIUM_SOFA.z - 0.18})) / vec2(2.38, 0.58);
    vec2 island = (p - vec2(${ATRIUM_LOUNGE.x}, ${ATRIUM_LOUNGE.z})) / vec2(5.35, 3.78);
    vec2 stair = (p - vec2(${lowStair.x.toFixed(3)}, ${lowStair.z.toFixed(3)})) / vec2(3.0, 4.0);
    vec2 cafe = (p - vec2(${ATRIUM_CAFE.x}, ${ATRIUM_CAFE.z})) / vec2(1.89, 2.5);
    float nearFacade = smoothstep(10.82, 11.4, abs(p.x));
    return 1.0 - 0.32 * exp(-2.8 * dot(sofa, sofa))
      - 0.12 * (1.0 - smoothstep(0.82, 1.20, length(island))) - 0.20 * nearFacade
      - 0.21 * (1.0 - smoothstep(0.38, 1.24, length(stair)))
      - 0.12 * (1.0 - smoothstep(0.52, 1.28, length(cafe)));
  }

  vec3 atriumStoneFinish(vec2 p, float slabTonalVariation, float seam) {
    float strip = smoothstep(4.08, 4.10, abs(p.x)) * (1.0 - smoothstep(5.41, 5.43, abs(p.x)));
    vec3 stone = mix(vec3(0.97, 0.92, 0.91), vec3(1.16, 1.12, 1.07), strip);
    return stone * (0.81 + 0.39 * slabTonalVariation) * (1.0 - 0.22 * seam);
  }

  float atriumFloorIrradiance(vec2 p) {
    float sideEdge = atriumFirstGalleryEdge(p);
    float underBalcony = smoothstep(sideEdge + 0.2, 10.7, abs(p.x));
    vec2 skyPool = (p - vec2(${ATRIUM_SKYLIGHT.x.toFixed(3)}, ${ATRIUM_SKYLIGHT.z.toFixed(2)})) / vec2(12.0, 16.5);
    float daylight = 1.0 - smoothstep(0.16, 1.50, length(skyPool));
    float storefront = smoothstep(7.0, 10.7, abs(p.x)) * (1.0 - smoothstep(11.05, 11.4, abs(p.x)));
    return 0.96 - 0.15 * underBalcony + daylight * atriumDaylight * 0.10 + storefront * atriumFixtureLight * 0.25;
  }
`;

const stoneMapCoordinates = /* glsl */`
  vec2 stoneTile = vec2(atriumFloorPoint.x, -atriumFloorPoint.z) / ${TILE_SIZE};
  vec2 stoneCell = floor(stoneTile);
  vec2 stoneLocal = fract(stoneTile);
  vec4 stoneArea = atriumStoneAreas[int(atriumTileTone(stoneCell + vec2(34.0, 19.0)) * 8.0)];
  vec2 stoneUV = stoneArea.xy + stoneLocal * stoneArea.zw;
  vec2 stoneDu = dFdx(stoneTile) * stoneArea.zw;
  vec2 stoneDv = dFdy(stoneTile) * stoneArea.zw;
  vec2 stoneEdge = min(stoneLocal, 1.0 - stoneLocal) * ${TILE_SIZE};
  float stoneGap = min(stoneEdge.x, stoneEdge.y);
  float stoneSeam = 1.0 - smoothstep(0.005, 0.013 + min(fwidth(stoneGap), 0.027), stoneGap);
`;

function sampleStoneArea(chunk: string, map: string, uv: string) {
  return chunk.replaceAll(`texture2D( ${map}, ${uv} )`, `textureGrad( ${map}, stoneUV, stoneDu, stoneDv )`);
}

export async function createAtriumFloor(scene: Scene) {
  const width = ATRIUM_BOUNDS.maxX - ATRIUM_BOUNDS.minX;
  const depth = ATRIUM_BOUNDS.maxZ - ATRIUM_BOUNDS.minZ;
  const centerZ = (ATRIUM_BOUNDS.minZ + ATRIUM_BOUNDS.maxZ) / 2;
  const loader = new TextureLoader();
  const maps = await Promise.all(['color', 'normal', 'roughness'].map(async kind => {
    const url = `${import.meta.env.BASE_URL}atrium-materials/marble-${kind}.webp`;
    const texture = await loader.loadAsync(url).catch(() => null);
    if (!texture) return null;
    texture.name = `atrium marble ${kind}`;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(width / TILE_SIZE, depth / TILE_SIZE);
    texture.anisotropy = 8;
    if (kind === 'color') texture.colorSpace = SRGBColorSpace;
    return texture;
  }));
  const material = new MeshStandardMaterial({
    color: maps[0] ? 0xf2e8dd : 0xbba58e, map: maps[0], normalMap: maps[1], roughnessMap: maps[2],
    roughness: 0.36, metalness: 0, envMapIntensity: 0.24,
  });
  material.normalScale.set(0.25, 0.25);
  const wallStone = maps[0]?.clone() ?? null;
  wallStone?.repeat.set(0.70, 0.76);
  wallStone?.offset.set(0.08, 0.10);
  const floor = new Mesh(new PlaneGeometry(width, depth), material);
  floor.name = 'atrium-polished-stone';
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = centerZ;
  scene.add(floor);

  const mirrorGeometry = new PlaneGeometry();
  const mirror = new Reflector(mirrorGeometry, { clipBias: 0.0012, multisample: 0, textureWidth: 384, textureHeight: 216 });
  mirror.rotation.x = -Math.PI / 2;
  mirror.position.y = -0.005;
  mirror.updateMatrixWorld(true);
  const mirrorMaterial = mirror.material as ShaderMaterial;
  const mirrorGroup = new Group();
  const target = mirror.getRenderTarget();
  target.texture.generateMipmaps = true;
  target.texture.minFilter = LinearMipmapLinearFilter;
  const floorProjection = new Matrix4();
  const worldToMirror = mirror.matrixWorld.clone().invert();
  const sampled = { value: 0 };
  const lamp = { value: 1 };
  const sky = { value: 1 };
  material.customProgramCacheKey = () => 'atrium-polished-stone';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      atriumMirror: { value: target.texture }, atriumMirrorProjection: { value: floorProjection },
      atriumCaptured: sampled, atriumFixtureLight: lamp, atriumDaylight: sky,
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${floorVertex}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        atriumFloorPoint = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${floorFragment}`)
      .replace('#include <map_fragment>', `${stoneMapCoordinates}\n${sampleStoneArea(ShaderChunk.map_fragment, 'map', 'vMapUv')}`)
      .replace('#include <roughnessmap_fragment>', sampleStoneArea(ShaderChunk.roughnessmap_fragment, 'roughnessMap', 'vRoughnessMapUv'))
      .replace('#include <normal_fragment_maps>', sampleStoneArea(ShaderChunk.normal_fragment_maps, 'normalMap', 'vNormalMapUv'))
      .replace('#include <opaque_fragment>', /* glsl */`
        vec3 toEye = normalize(cameraPosition - atriumFloorPoint);
        float face = clamp(toEye.y, 0.0, 1.0);
        float fresnel = 0.045 + 0.79 * pow(1.0 - face, 4.2);
        vec3 ray = reflect(-toEye, vec3(0.0, 1.0, 0.0));
        vec3 reflected = vec3(0.0);
        float visible = 0.0;
        if (atriumCaptured > 0.5) {
          vec4 projected = atriumMirrorProjection * vec4(atriumFloorPoint, 1.0);
          vec2 mirrorUV = projected.xy / max(0.001, projected.w);
          mirrorUV += (normal.xy - nonPerturbedNormal.xy) * 0.0045;
          vec2 edge = min(mirrorUV, 1.0 - mirrorUV);
          visible = smoothstep(0.002, 0.041, min(edge.x, edge.y)) * step(0.0, projected.w);
          float spread = 0.20 + material.roughness * 2.35 + (1.0 - face) * 0.27 + 0.25 * stoneSeam;
          reflected = texture2DLodEXT(atriumMirror, mirrorUV, spread).rgb * visible;
        }
        if (visible < 0.999) reflected += (1.0 - visible) * atriumReflectedFixtures(atriumFloorPoint, ray);
        vec2 point = atriumFloorPoint.xz;
        vec3 stone = outgoingLight * atriumContact(point) * atriumFloorIrradiance(point)
          * atriumStoneFinish(point, atriumTileTone(stoneCell), stoneSeam);
        float mirrored = fresnel * (1.07 - 0.45 * material.roughness) * (1.0 - 0.36 * stoneSeam);
        outgoingLight = stone * (1.0 - mirrored * 0.70) + reflected * mirrored * vec3(1.0, 0.975, 0.95);
        #include <opaque_fragment>`);
  };

  const planeBounds = new Box3(new Vector3(ATRIUM_BOUNDS.minX, -0.025, ATRIUM_BOUNDS.minZ),
    new Vector3(ATRIUM_BOUNDS.maxX, 0.025, ATRIUM_BOUNDS.maxZ));
  const frustum = new Frustum();
  const viewProjection = new Matrix4();
  const projection = new Matrix4();
  const latestPosition = new Vector3();
  const latestRotation = new Quaternion();
  const viewport = new Vector4();
  const scissor = new Vector4();
  const size = new Vector2();
  let cached = false;
  let quality: CoastQuality = 'light';
  let lastCapture = -Infinity;

  function prepareRender(renderer: WebGLRenderer, camera: PerspectiveCamera) {
    sampled.value = 0;
    if (renderer.xr.isPresenting) {
      cached = false;
      return;
    }
    camera.updateMatrixWorld();
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!frustum.setFromProjectionMatrix(viewProjection).intersectsBox(planeBounds)) return;
    const moving = latestPosition.distanceToSquared(camera.position) > 0.0004
      || Math.abs(latestRotation.dot(camera.quaternion)) < 0.999996;
    const projectedDifferently = !projection.equals(camera.projectionMatrix);
    const now = performance.now();
    if (!cached || projectedDifferently || (moving && now - lastCapture >= 36)) {
      renderer.getDrawingBufferSize(size);
      const maxWidth = quality === 'high' ? 1040 : 620;
      const targetWidth = Math.min(maxWidth, Math.max(320, Math.round(size.x * 0.68)));
      const targetHeight = Math.max(160, Math.min(720, Math.round(targetWidth * size.y / Math.max(1, size.x))));
      if (!renderer.extensions.has('EXT_color_buffer_float')) target.texture.type = UnsignedByteType;
      target.setSize(targetWidth, targetHeight);
      const mainTarget = renderer.getRenderTarget();
      const cubeFace = renderer.getActiveCubeFace();
      const mipLevel = renderer.getActiveMipmapLevel();
      const xrEnabled = renderer.xr.enabled;
      const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
      const scissorTest = renderer.getScissorTest();
      renderer.getViewport(viewport);
      renderer.getScissor(scissor);
      floor.visible = false;
      try {
        mirror.onBeforeRender(renderer, scene, camera, mirrorGeometry, mirrorMaterial, mirrorGroup);
        floorProjection.multiplyMatrices(mirrorMaterial.uniforms.textureMatrix.value as Matrix4, worldToMirror);
        cached = true;
        lastCapture = now;
        latestPosition.copy(camera.position);
        latestRotation.copy(camera.quaternion);
        projection.copy(camera.projectionMatrix);
      } finally {
        floor.visible = true;
        renderer.xr.enabled = xrEnabled;
        renderer.shadowMap.autoUpdate = shadowAutoUpdate;
        renderer.setRenderTarget(mainTarget, cubeFace, mipLevel);
        renderer.setViewport(viewport);
        renderer.setScissor(scissor);
        renderer.setScissorTest(scissorTest);
      }
    }
    sampled.value = Number(cached);
  }

  return {
    wallStone,
    prepareRender,
    setLighting(on: boolean, time: CoastTimeOfDay) {
      lamp.value = Number(on);
      sky.value = time === 'day' ? 1 : 0.105;
      cached = false;
    },
    setQuality(next: CoastQuality) {
      quality = next;
      material.normalScale.setScalar(next === 'high' ? 0.29 : 0.22);
      cached = false;
    },
    dispose() {
      mirror.dispose();
      mirrorGeometry.dispose();
    },
  };
}
