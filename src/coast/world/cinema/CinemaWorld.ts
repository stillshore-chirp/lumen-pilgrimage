import { Color, MathUtils, Scene, Vector3, type Texture } from 'three';
import type { ExplorationScene } from '../../CoastApp';
import type { CoastQuality } from '../../CoastWorld';
import { CinemaAmbience } from './cinemaAmbience';
import { createCinemaAuditorium } from './cinemaAuditorium';
import { CINEMA_EXITS } from './cinemaLayout';
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
  const doors = CINEMA_EXITS.map(exit => ({
    exit,
    amount: 0,
    openUntil: 0,
    soundOrigin: new Vector3(exit.x, exit.y + 1, exit.z),
  }));

  let elapsed = 0;
  let mode: CinemaLightingMode = 'arrival';
  let quality: CoastQuality = 'light';
  let sharedTexture: Texture | null = null;
  let sharedAspect: number | undefined;
  let currentDoor: typeof doors[number] | undefined;
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
    interaction: {
      label(position, facing) {
        currentDoor = undefined;
        let nearest = 2.35;
        for (const door of doors) {
          const { x, y, z } = door.exit;
          const dx = x - position.x;
          const dz = z - position.z;
          const distance = Math.hypot(dx, dz);
          if (distance >= nearest || position.y < y || position.y > y + 2.4) continue;
          if (dx * facing.x + dz * facing.z < distance * .48) continue;
          nearest = distance;
          currentDoor = door;
        }
        if (!currentDoor) return null;
        const { id } = currentDoor.exit;
        if (currentDoor.amount >= .9) return `${id} からシアターを退出`;
        return currentDoor.openUntil > elapsed ? `${id} を開いています` : `出口 ${id} を開く`;
      },
      invoke() {
        const door = currentDoor;
        if (!door) return;
        if (door.amount >= .9) return { exit: true };
        if (door.openUntil > elapsed) return;
        door.openUntil = elapsed + 8;
        audio.playDoor(door.soundOrigin);
      },
    },
    world: {
      scene,
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
        const dt = now - elapsed;
        elapsed = now;
        if (preview.playing) {
          preview.update(now, cue => audio.playDemoCue(cue));
          if (!preview.playing) {
            audio.stopDemoCue();
            applyProjection();
          }
        }
        for (const door of doors) {
          const sign = door.openUntil > now ? 1 : -1;
          const amount = MathUtils.clamp(door.amount + sign * dt / .62, 0, 1);
          if (door.amount === amount) continue;
          if (sign < 0 && amount === 0) audio.playDoor(door.soundOrigin, true);
          door.amount = amount;
          auditorium.setExitOpen(door.exit.id, amount * amount * (3 - 2 * amount));
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
