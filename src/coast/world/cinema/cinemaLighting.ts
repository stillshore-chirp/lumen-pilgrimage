import {
  Camera, ColorManagement, DataTexture, FloatType, LinearFilter, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, NearestFilter, PlaneGeometry, RedFormat, RGBAFormat, Scene, ShaderMaterial,
  SRGBTransfer, UnsignedByteType, Vector2, Vector3, VideoTexture, WebGLRenderTarget,
  type Group, type Texture, type WebGLRenderer,
} from 'three';
import type { WorldLightingMode } from '../../WorldLightingControl';
import { CINEMA_WALL_FOOTLIGHTS } from './cinemaFixtureLighting';
import { CINEMA_BOUNDS, CINEMA_CROSS_AISLES, CINEMA_SCREEN, CINEMA_TREADS } from './cinemaLayout';
import {
  CINEMA_LIGHT_META, CINEMA_REFERENCE_WHITE, CINEMA_ROOM_RETURN,
  CINEMA_SCREENING_SPILL, bakeCinemaLightTransport, cinemaLightQuality,
  cinemaPictureOpening, type CinemaLightingQuality,
} from './cinemaLightTransport';
import {
  cinemaPassVertex, cinemaRoomFragment, cinemaRoomPars, cinemaRoomVertex, cinemaScreenFragment,
  cinemaScreenPars, cinemaTilesFragment, cinemaTransportFragment,
} from './cinemaLightShaders';

export type CinemaLightingMode = 'arrival' | 'screening' | 'service' | 'emergency';

const lampLevels: Record<CinemaLightingMode, readonly [number, number, number]> = {
  arrival: [0.92, 0, 0],
  screening: [0, 0, 0],
  service: [0.12, 1.12, 0],
  emergency: [0, 0, 0.96],
};
const DISPLAY_WHITE = 0.74;
const HISTORY_MIN_CD = 0.001;

function makeTreadProfile(): DataTexture {
  const width = 2048;
  const maxFloorY = CINEMA_CROSS_AISLES[3].y;
  const data = new Uint8Array(width * 4);
  let tread = 0;
  for (let index = 0; index < width; index += 1) {
    const z = CINEMA_BOUNDS.minZ + (CINEMA_BOUNDS.maxZ - CINEMA_BOUNDS.minZ) * (index + 0.5) / width;
    while (tread + 1 < CINEMA_TREADS.length && CINEMA_TREADS[tread + 1].z <= z) tread += 1;
    const { z: nose, y, rise } = CINEMA_TREADS[tread];
    data[4 * index] = Math.round(y / maxFloorY * 255);
    const next = CINEMA_TREADS[tread + 1];
    data[4 * index + 1] = rise > 0 ? Math.round(Math.exp(-13 * (z - nose)) * 255) : 0;
    data[4 * index + 2] = Math.round(255 * CINEMA_WALL_FOOTLIGHTS.reduce((level, light) => (
      Math.max(level, Math.exp(-((z - light.z) ** 2) / 0.38))
    ), 0));
    data[4 * index + 3] = next ? Math.round(Math.exp(-4.8 * (next.z - z)) * 255) : 0;
  }
  const texture = new DataTexture(data, width, 1);
  texture.name = 'Cinema tread elevations and shielded step light';
  texture.needsUpdate = true;
  return texture;
}

function frameAspect(texture: Texture): number {
  const image = texture.image as { videoWidth?: number; videoHeight?: number; width?: number; height?: number };
  return (image?.videoWidth ?? image?.width ?? 0) / (image?.videoHeight ?? image?.height ?? 0);
}

function renderTarget(width: number, height: number, linear: boolean): WebGLRenderTarget {
  return new WebGLRenderTarget(width, height, {
    minFilter: linear ? LinearFilter : NearestFilter,
    magFilter: linear ? LinearFilter : NearestFilter,
    format: RGBAFormat,
    type: UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

function transportResources(quality: CinemaLightingQuality) {
  const { columns, rows, probeRows } = cinemaLightQuality[quality];
  const baked = bakeCinemaLightTransport(quality);
  const transfer = new DataTexture(baked.weights, baked.count, baked.width * baked.height, RedFormat, FloatType);
  transfer.name = 'Cinema screen to room form factors';
  transfer.needsUpdate = true;
  const tiles = renderTarget(columns, rows, false);
  const first = renderTarget(baked.width, probeRows, true);
  const second = renderTarget(baked.width, probeRows, true);
  return { transfer, tiles, first, second, write: first, dispose() {
    transfer.dispose();
    tiles.dispose();
    first.dispose();
    second.dispose();
  } };
}

export function createCinemaLighting(scene: Scene, auditorium: Group) {
  const black = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  black.needsUpdate = true;
  const treads = makeTreadProfile();
  const input = {
    cinemaSource: { value: black as Texture },
    cinemaOpening: { value: new Vector2(1, 1) },
    cinemaDecodeVideo: { value: 0 },
  };
  const atlas = {
    cinemaLightPrev: { value: black as Texture },
    cinemaLightNext: { value: black as Texture },
    cinemaLightBlend: { value: 1 },
    cinemaLive: { value: 0 },
    cinemaProbes: { value: new Vector2() },
    cinemaLamps: { value: new Vector3(...lampLevels.arrival) },
  };
  const lighting = {
    cinemaProjectorWhite: { value: DISPLAY_WHITE * (CINEMA_REFERENCE_WHITE - CINEMA_SCREENING_SPILL)
      / (CINEMA_REFERENCE_WHITE * (1 + CINEMA_ROOM_RETURN)) },
    cinemaSpill: { value: 0 },
  };

  const litFixtureScales = { cove: 0, service: 1, emergency: 2 } as const;
  const fixtures = new Map<MeshBasicMaterial, {
    scale: number; color: MeshBasicMaterial['color']; toneMapped: boolean;
  }>();
  const restore: (() => void)[] = [];
  const receivers = new Set<MeshStandardMaterial>();
  auditorium.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const fixture = object.userData.cinemaLightFixture as keyof typeof litFixtureScales | undefined;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof MeshBasicMaterial && fixture !== undefined && Object.hasOwn(litFixtureScales, fixture)) {
        if (fixtures.has(material)) continue;
        fixtures.set(material, { scale: litFixtureScales[fixture], color: material.color.clone(), toneMapped: material.toneMapped });
        material.toneMapped = false;
        material.needsUpdate = true;
      }
      if (!(material instanceof MeshStandardMaterial) || receivers.has(material)) continue;
      receivers.add(material);
      const compile = material.onBeforeCompile;
      const programKey = material.customProgramCacheKey;
      const key = programKey.call(material);
      const toneMapped = material.toneMapped;
      // The outdoor curve compresses neutral values near black. Preserve the theater's fixed response.
      material.toneMapped = false;
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        Object.assign(shader.uniforms, atlas, lighting, { cinemaSteps: { value: treads } });
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 cinemaWorld;')
          .replace('#include <project_vertex>', cinemaRoomVertex);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n' + cinemaRoomPars)
          .replace('#include <opaque_fragment>', cinemaRoomFragment + '\n#include <opaque_fragment>');
      };
      material.customProgramCacheKey = () => key + '|cinema-lit-surfaces-v1';
      material.needsUpdate = true;
      restore.push(() => {
        material.onBeforeCompile = compile;
        material.customProgramCacheKey = programKey;
        material.toneMapped = toneMapped;
        material.needsUpdate = true;
      });
    }
  });

  const screen = new Mesh(
    new PlaneGeometry(CINEMA_SCREEN.width, CINEMA_SCREEN.height),
    new MeshBasicMaterial({ map: black, toneMapped: false }),
  );
  screen.name = 'Thirty-metre cinema projection screen';
  screen.position.set(0, CINEMA_SCREEN.center, CINEMA_SCREEN.z);
  screen.material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, input, atlas, lighting);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\n' + cinemaScreenPars)
      .replace('#include <map_fragment>', cinemaScreenFragment);
  };
  scene.add(screen);

  const fullscreen = new PlaneGeometry(2, 2);
  const passCamera = new Camera();
  const pass = new Scene();
  const dimensions = { value: new Vector2() };
  const tileUniforms = { ...input, cinemaTiles: dimensions, cinemaSamples: { value: 4 } };
  const transportUniforms = {
    cinemaTiles: dimensions,
    cinemaTileColors: { value: black as Texture },
    cinemaWeights: { value: black as Texture },
    cinemaProbes: atlas.cinemaProbes,
    cinemaAccurateBounce: { value: 0 },
    cinemaEye: { value: new Vector3() },
    cinemaView: { value: new Vector3() },
  };
  const tilePass = new ShaderMaterial({
    uniforms: tileUniforms, vertexShader: cinemaPassVertex, fragmentShader: cinemaTilesFragment,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const transportPass = new ShaderMaterial({
    uniforms: transportUniforms, vertexShader: cinemaPassVertex, fragmentShader: cinemaTransportFragment,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new Mesh(fullscreen, tilePass);
  quad.frustumCulled = false;
  pass.add(quad);

  let quality: CinemaLightingQuality = 'light';
  let mode: CinemaLightingMode = 'arrival';
  let lightingMode: WorldLightingMode = 'auto';
  let resources: ReturnType<typeof transportResources> | null = null;
  let frame: Texture | null = null;
  let elapsed = 0;
  let lastElapsed: number | null = null;
  let ready = false;
  let lastSample = -Infinity;
  let lastPrepare = -Infinity;
  let lastMeter = -Infinity;
  let screenPeak = HISTORY_MIN_CD;
  let history = Math.log2(CINEMA_REFERENCE_WHITE * 0.05);
  let meterPending = false;
  let frameGeneration = 0;
  let disposed = false;
  const modeLamps = atlas.cinemaLamps.value.clone();
  const transitionFrom = modeLamps.clone();
  const transitionTo = transitionFrom.clone();
  let transitionStart = 0;
  let transitionDuration = 0;

  function projectorOn(): boolean {
    return frame !== null && (mode === 'arrival' || mode === 'screening');
  }

  function invalidateFrame(): void {
    frameGeneration += 1;
    ready = false;
    atlas.cinemaLive.value = 0;
    screenPeak = HISTORY_MIN_CD;
    lastSample = lastMeter = -Infinity;
  }

  function applyLamps(): void {
    const levels = atlas.cinemaLamps.value.copy(modeLamps);
    if (lightingMode !== 'auto' && mode !== 'emergency') {
      levels.x = lightingMode === 'on' ? lampLevels.arrival[0] : 0;
    }
    for (const [material, { scale, color }] of fixtures) {
      material.color.copy(color).multiplyScalar(levels.getComponent(scale));
    }
    const { x: arrival, y: service, z: emergency } = levels;
    const spill = CINEMA_SCREENING_SPILL + arrival * 0.27 + service * 2.2 + emergency * 0.25;
    lighting.cinemaSpill.value = DISPLAY_WHITE * spill / CINEMA_REFERENCE_WHITE;
  }
  applyLamps();

  function prepareRender(renderer: WebGLRenderer, camera: Camera): void {
    if (disposed || !projectorOn()) return;
    const config = cinemaLightQuality[quality];
    const interval = 1 / config.updatesPerSecond;
    const now = performance.now();
    const resumed = now - lastPrepare >= 300;
    lastPrepare = now;
    if (ready && !resumed && elapsed - lastSample + 0.00001 < interval) {
      atlas.cinemaLightBlend.value = Math.min(1, (elapsed - lastSample) / (0.5 * interval));
      return;
    }
    resources ??= transportResources(quality);
    const { tiles, transfer, write, first, second } = resources;
    atlas.cinemaProbes.value.set(config.probeColumns, config.probeRows);
    dimensions.value.set(config.columns, config.rows);
    tileUniforms.cinemaSamples.value = quality === 'high' ? 8 : 6;
    transportUniforms.cinemaTileColors.value = tiles.texture;
    transportUniforms.cinemaWeights.value = transfer;
    transportUniforms.cinemaAccurateBounce.value = Number(quality === 'high');
    camera.getWorldPosition(transportUniforms.cinemaEye.value);
    camera.getWorldDirection(transportUniforms.cinemaView.value);

    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const xrEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false;
    try {
      quad.material = tilePass;
      renderer.setRenderTarget(tiles);
      renderer.render(pass, passCamera);
      quad.material = transportPass;
      renderer.setRenderTarget(write);
      renderer.render(pass, passCamera);
    } finally {
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.xr.enabled = xrEnabled;
    }

    const interpolate = ready && !resumed;
    atlas.cinemaLightPrev.value = interpolate ? atlas.cinemaLightNext.value : write.texture;
    atlas.cinemaLightNext.value = write.texture;
    atlas.cinemaLightBlend.value = interpolate ? 0 : 1;
    atlas.cinemaLive.value = 1;
    resources.write = write === first ? second : first;
    ready = true;
    lastSample = elapsed;

    if (elapsed - lastMeter >= 0.25 && !meterPending) {
      meterPending = true;
      lastMeter = elapsed;
      const generation = frameGeneration;
      // The renderer and the projection passes both require WebGL 2.
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const previousPack = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
      const measurement = renderer.readRenderTargetPixelsAsync(write, config.probeColumns * CINEMA_LIGHT_META,
        0, 1, 1, new Uint8Array(4));
      // The async reader rebinds its buffer when its fence completes.
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previousPack);
      void measurement.then(result => {
        if (!disposed && generation === frameGeneration) {
          screenPeak = Math.max(HISTORY_MIN_CD, (result[3] / 255) ** 2 * CINEMA_REFERENCE_WHITE);
        }
      }).catch(() => {
        // The transition keeps its ambient estimate if readback is interrupted by a context change.
      }).finally(() => { meterPending = false; });
    }
  }

  return {
    screen,
    setFrame(texture: Texture | null, aspect?: number): void {
      if (disposed) return;
      const opening = texture ? cinemaPictureOpening(aspect ?? frameAspect(texture)) : [1, 1] as const;
      if (texture === frame && input.cinemaOpening.value.x === opening[0] && input.cinemaOpening.value.y === opening[1]) return;
      frame = texture;
      input.cinemaSource.value = texture ?? black;
      input.cinemaOpening.value.set(...opening);
      if (texture instanceof VideoTexture && texture.version === 0
        && texture.image.readyState >= texture.image.HAVE_CURRENT_DATA) {
        // A paused or static source may already have a valid frame before its first callback.
        texture.needsUpdate = true;
      }
      input.cinemaDecodeVideo.value = Number(
        texture instanceof VideoTexture && ColorManagement.getTransfer(texture.colorSpace) === SRGBTransfer,
      );
      invalidateFrame();
    },
    setQuality(next: CinemaLightingQuality): void {
      if (disposed || quality === next) return;
      quality = next;
      invalidateFrame();
      atlas.cinemaLightPrev.value = atlas.cinemaLightNext.value = black;
      transportUniforms.cinemaTileColors.value = transportUniforms.cinemaWeights.value = black;
      resources?.dispose();
      resources = null;
    },
    get artificialLightingMode() { return lightingMode; },
    get artificialLightingUnavailableReason() {
      return mode === 'emergency' ? '非常点検中は照明の一括操作を利用できません。' : undefined;
    },
    setArtificialLightingMode(next: WorldLightingMode): void {
      if (disposed || mode === 'emergency') return;
      lightingMode = next;
      applyLamps();
    },
    setMode(next: CinemaLightingMode): void {
      if (disposed || mode === next) return;
      const wasProjecting = projectorOn();
      mode = next;
      if (wasProjecting !== projectorOn()) invalidateFrame();
      transitionFrom.copy(modeLamps);
      transitionTo.set(...lampLevels[next]);
      transitionStart = elapsed;
      if (next === 'arrival') {
        const extraStops = Math.max(0, Math.log2(2.5) - history);
        transitionDuration = Math.min(5, 2 + 0.45 * extraStops);
      } else if (next === 'screening' && transitionFrom.y === 0 && transitionFrom.z === 0) {
        transitionDuration = 8;
      } else if (next === 'emergency') {
        transitionDuration = 0;
        modeLamps.copy(transitionTo);
        applyLamps();
      } else {
        transitionDuration = 0.65;
      }
    },
    update(time: number, _camera: Camera): void {
      if (disposed) return;
      const delta = lastElapsed === null ? 0 : Math.max(0, Math.min(time - lastElapsed, 0.25));
      lastElapsed = elapsed = time;
      if (transitionDuration > 0) {
        const u = Math.min(1, Math.max(0, (elapsed - transitionStart) / transitionDuration));
        modeLamps.lerpVectors(transitionFrom, transitionTo, u * u * (3 - 2 * u));
        applyLamps();
        if (u === 1) transitionDuration = 0;
      }
      const luminance = Math.max(screenPeak, 0.02 + 2.5 * atlas.cinemaLamps.value.x
        + 6 * atlas.cinemaLamps.value.y + 2.0 * atlas.cinemaLamps.value.z);
      const stops = Math.log2(luminance);
      history += (stops - history) * (1 - Math.exp(-delta / (stops > history ? 0.6 : 4)));
    },
    prepareRender,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      frame = null;
      input.cinemaSource.value = black;
      invalidateFrame();
      resources?.dispose();
      resources = null;
      scene.remove(screen);
      screen.geometry.dispose();
      screen.material.dispose();
      fullscreen.dispose();
      tilePass.dispose();
      transportPass.dispose();
      treads.dispose();
      black.dispose();
      for (const reset of restore) reset();
      for (const [material, { color, toneMapped }] of fixtures) {
        material.color.copy(color);
        material.toneMapped = toneMapped;
        material.needsUpdate = true;
      }
    },
  };
}
