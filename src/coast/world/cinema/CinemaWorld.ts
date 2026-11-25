import { Color, Scene, type Texture } from 'three';
import type { ExplorationScene } from '../../CoastApp';
import type { CoastQuality } from '../../CoastWorld';
import { CinemaAmbience } from './cinemaAmbience';
import { createCinemaAuditorium } from './cinemaAuditorium';
import { cinemaDemo } from './cinemaDemo';
import { createCinemaLighting, type CinemaLightingMode } from './cinemaLighting';
import type { CinemaControls } from './CinemaPanel';
import { openCinemaMovieVideo } from './cinemaMovieVideo';
import { createCinemaPlayback } from './cinemaPlayback';
import { createCinemaPreview } from './cinemaPreview';
import { cinemaNavigation } from './cinemaNavigation';
import { CINEMA_SAMPLE_RATE, type CinemaScreeningAsset } from './cinemaProgram';
import { CinemaScreeningPlayer } from './cinemaScreening';
import { openCinemaScreening } from './cinemaSource';

interface ScreeningBookmark { asset: CinemaScreeningAsset; seconds: number }

// Keep the chosen files and position during travel within this page. A new world opens its own decoder.
let bookmark: ScreeningBookmark | undefined;

function screeningFormat(asset: CinemaScreeningAsset | undefined): string {
  if (!asset) return '';
  const count = asset.program.bed.length;
  const arrangement = { 1: 'モノラル', 2: 'ステレオ', 6: '5.1', 8: '7.1', 12: '7.1.4' }[count];
  const bed = arrangement ?? `${count}チャンネル`;
  return asset.program.objects.length ? `${bed}＋位置付き音源 ${asset.program.objects.length}本` : bed;
}

export function loadCinemaScene(): ExplorationScene {
  const scene = new Scene();
  scene.background = new Color(0x090d0d);
  const auditorium = createCinemaAuditorium();
  scene.add(auditorium.group);
  const lighting = createCinemaLighting(scene, auditorium.group);
  const audio = new CinemaAmbience();
  const simplePreview = createCinemaPreview();
  let preview: CinemaScreeningPlayer | undefined;
  let local: CinemaScreeningPlayer | undefined;
  let selection = bookmark;
  let context: AudioContext | undefined;
  let request = 0;
  let loading = false;
  let fileError = '';
  let elapsed = 0;
  let mode: CinemaLightingMode = 'arrival';
  let quality: CoastQuality = 'light';
  let sharedTexture: Texture | null = null;
  let sharedAspect: number | undefined;
  const projectionPaused = () => mode === 'service' || mode === 'emergency';
  const blocked = () => Boolean(sharedTexture) || projectionPaused();

  function screeningContext(): AudioContext {
    return context ??= new AudioContext({ latencyHint: 'interactive', sampleRate: CINEMA_SAMPLE_RATE });
  }

  function stopPreview(): void {
    preview?.dispose();
    preview = undefined;
    simplePreview.stop();
    audio.stopDemoCue();
  }

  function applyProjection(): void {
    if (projectionPaused()) lighting.setFrame(null);
    else if (sharedTexture) lighting.setFrame(sharedTexture, sharedAspect);
    else if (preview?.playing) lighting.setFrame(preview.texture, preview.aspect);
    else if (simplePreview.playing) lighting.setFrame(simplePreview.texture, simplePreview.aspect);
    else if (local) lighting.setFrame(local.texture, local.aspect);
    else lighting.setFrame(null);
  }

  function project(texture: Texture | null, aspect?: number): void {
    if (sharedTexture === texture && sharedAspect === aspect) return;
    sharedTexture = texture;
    sharedAspect = aspect;
    if (texture) {
      stopPreview();
      local?.pause();
    }
    local?.setBlocked(blocked());
    applyProjection();
  }

  async function loadPlayer(asset: CinemaScreeningAsset, seconds: number, token: number): Promise<CinemaScreeningPlayer | undefined> {
    const video = await openCinemaMovieVideo(asset.video);
    if (token !== request) {
      video.dispose();
      return undefined;
    }
    const player = new CinemaScreeningPlayer(asset, video, asset.videoStartSample);
    player.seek(seconds);
    player.setBlocked(blocked());
    return player;
  }

  function startSimplePreview(): void {
    simplePreview.start(elapsed);
    simplePreview.update(elapsed, cue => audio.playDemoCue(cue));
  }

  const cinemaControls: CinemaControls = {
    get mode() { return mode; },
    get samplePlaying() { return Boolean(preview?.playing || simplePreview.playing); },
    get canStartSample() { return !blocked() && !local?.playing && !loading; },
    get localScreening() {
      const asset = selection?.asset;
      return {
        loading, available: Boolean(asset), playing: local?.playing ?? false,
        duration: asset ? asset.durationSamples / CINEMA_SAMPLE_RATE : 0,
        position: local?.position ?? selection?.seconds ?? 0,
        format: screeningFormat(asset), error: fileError || local?.error || '', blocked: blocked(),
      };
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      if (projectionPaused()) stopPreview();
      local?.setBlocked(blocked());
      lighting.setMode(mode);
      applyProjection();
    },
    toggleSample() {
      if (this.samplePlaying) {
        stopPreview();
      } else if (this.canStartSample) {
        try {
          const activeContext = screeningContext();
          if (!activeContext.audioWorklet || /OculusBrowser|Quest/i.test(navigator.userAgent)) startSimplePreview();
          else {
            preview = new CinemaScreeningPlayer(cinemaDemo, createCinemaPreview());
            preview.seek(0);
            void preview.play(activeContext);
          }
        } catch {
          startSimplePreview();
        }
      }
      applyProjection();
    },
    async openScreening(files) {
      const token = ++request;
      loading = true;
      fileError = '';
      try {
        const asset = await openCinemaScreening(files);
        if (token !== request) return;
        const player = await loadPlayer(asset, 0, token);
        if (!player) return;
        stopPreview();
        local?.dispose();
        local = player;
        bookmark = selection = { asset, seconds: 0 };
        applyProjection();
      } catch (error) {
        if (token === request) fileError = error instanceof Error ? error.message : '上映素材を開けませんでした。';
      } finally {
        if (token === request) loading = false;
      }
    },
    async toggleScreening() {
      if (local?.playing) { local.pause(); return; }
      if (!selection || blocked() || loading) return;
      fileError = '';
      stopPreview();
      const token = request;
      try {
        const activeContext = screeningContext();
        // A returning visitor can reopen the decoder after unlocking audio on this gesture.
        if (!local) {
          loading = true;
          if (activeContext.state !== 'running') void activeContext.resume().catch(() => undefined);
          const player = await loadPlayer(selection.asset, selection.seconds, token);
          if (!player) return;
          local = player;
        }
        await local.play(activeContext);
        if (token === request) applyProjection();
      } catch (error) {
        if (token === request) fileError = error instanceof Error ? error.message : '上映を再開できませんでした。';
      } finally {
        if (token === request) loading = false;
      }
    },
    seekScreening(seconds) {
      if (!selection || loading || !Number.isFinite(seconds)) return;
      selection.seconds = Math.min(selection.asset.durationSamples / CINEMA_SAMPLE_RATE, Math.max(0, seconds));
      local?.seek(selection.seconds);
    },
    closeScreening() {
      ++request;
      loading = false;
      fileError = '';
      local?.dispose();
      local = undefined;
      if (bookmark === selection) bookmark = undefined;
      selection = undefined;
      applyProjection();
    },
  };

  return {
    id: 'cinema',
    navigation: cinemaNavigation,
    audio,
    cinemaControls,
    world: {
      scene,
      get artificialLightingMode() { return lighting.artificialLightingMode; },
      get artificialLightingUnavailableReason() { return lighting.artificialLightingUnavailableReason; },
      setArtificialLightingMode: lighting.setArtificialLightingMode,
      theater: {
        screen: lighting.screen,
        speakers: [],
        cinema: { project, createAudio: createCinemaPlayback, quality: () => quality, paused: projectionPaused },
      },
      setTimeOfDay() {},
      setQuality(next) {
        quality = next;
        auditorium.setQuality(next);
        lighting.setQuality(next);
      },
      update(now, camera) {
        elapsed = now;
        if (preview) {
          preview.update(camera, audio.screeningGain(true));
          if (!preview.playing) {
            const failed = Boolean(preview.error);
            stopPreview();
            if (failed && !blocked()) startSimplePreview();
            applyProjection();
          }
        }
        if (simplePreview.playing) {
          simplePreview.update(now, cue => audio.playDemoCue(cue));
          if (!simplePreview.playing) {
            audio.stopDemoCue();
            applyProjection();
          }
        }
        local?.update(camera, audio.screeningGain(false));
        if (selection && local) selection.seconds = local.position;
        lighting.update(now, camera);
        return [];
      },
      prepareRender: lighting.prepareRender,
      dispose() {
        ++request;
        stopPreview();
        local?.dispose();
        void context?.close().catch(() => undefined);
        lighting.dispose();
        auditorium.dispose();
        simplePreview.dispose();
        scene.clear();
      },
    },
  };
}
