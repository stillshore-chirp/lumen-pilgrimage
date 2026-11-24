import { Color, Scene, type Texture } from 'three';
import type { ExplorationScene } from '../../CoastApp';
import type { CoastQuality } from '../../CoastWorld';
import { CinemaAmbience } from './cinemaAmbience';
import { createCinemaAuditorium } from './cinemaAuditorium';
import { createCinemaLighting, type CinemaLightingMode } from './cinemaLighting';
import type { CinemaControls } from './CinemaPanel';
import { createCinemaPlayback } from './cinemaPlayback';
import { createCinemaPreview } from './cinemaPreview';
import { cinemaNavigation } from './cinemaNavigation';

export function loadCinemaScene(): ExplorationScene {
  const scene = new Scene();
  scene.background = new Color(0x090d0d);
  const auditorium = createCinemaAuditorium();
  scene.add(auditorium.group);
  const lighting = createCinemaLighting(scene, auditorium.group);
  const audio = new CinemaAmbience();
  const preview = createCinemaPreview();
  let elapsed = 0;
  let mode: CinemaLightingMode = 'arrival';
  let quality: CoastQuality = 'light';
  let sharedTexture: Texture | null = null;
  let sharedAspect: number | undefined;
  const projectionPaused = () => mode === 'service' || mode === 'emergency';

  function stopPreview(): void {
    preview.stop();
    audio.stopDemoCue();
  }

  function applyProjection(): void {
    if (projectionPaused()) lighting.setFrame(null);
    else if (sharedTexture) lighting.setFrame(sharedTexture, sharedAspect);
    else if (preview.playing) lighting.setFrame(preview.texture, preview.aspect);
    else lighting.setFrame(null);
  }

  function project(texture: Texture | null, aspect?: number): void {
    if (sharedTexture === texture && sharedAspect === aspect) return;
    sharedTexture = texture;
    sharedAspect = aspect;
    if (texture && preview.playing) stopPreview();
    applyProjection();
  }

  const cinemaControls: CinemaControls = {
    get mode() { return mode; },
    get samplePlaying() { return preview.playing; },
    get canStartSample() { return !sharedTexture && !projectionPaused(); },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      if (projectionPaused()) stopPreview();
      lighting.setMode(mode);
      applyProjection();
    },
    toggleSample() {
      if (preview.playing) {
        stopPreview();
        applyProjection();
      } else if (this.canStartSample) {
        preview.start(elapsed);
        preview.update(elapsed, cue => audio.playDemoCue(cue));
        applyProjection();
      }
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
        if (preview.playing) {
          preview.update(now, cue => audio.playDemoCue(cue));
          if (!preview.playing) {
            audio.stopDemoCue();
            applyProjection();
          }
        }
        lighting.update(now, camera);
        return [];
      },
      prepareRender: lighting.prepareRender,
      dispose() {
        lighting.dispose();
        auditorium.dispose();
        preview.dispose();
        scene.clear();
      },
    },
  };
}
