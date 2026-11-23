import { Scene, type Vector3 } from 'three';
import type { ExplorationScene } from '../../CoastApp';
import { findDestination } from '../../coastDestinations';
import { ResidenceAudio } from './residenceAudio';
import { createResidenceCity } from './residenceCity';
import { createResidenceFurniture } from './residenceFurniture';
import { createResidenceLighting } from './residenceLighting';
import { createResidenceMaterials } from './residenceMaterials';
import { createResidenceNavigation } from './residenceNavigation';
import { RESIDENCE_BALCONY_DOOR } from './residencePlan';
import { createResidenceReflections } from './residenceReflections';
import { createResidenceShell } from './residenceShell';

const DOOR_SLIDE_SECONDS = 0.55;
const DOOR_REACH = 1.12;
const { e: doorEast, nFrom: doorSouth, nTo: doorNorth } = RESIDENCE_BALCONY_DOOR;

function northDistanceToDoor(z: number): number {
  return Math.max(doorSouth + z, -z - doorNorth, 0);
}

function occupiesDoorway(position: Vector3): boolean {
  return Math.abs(position.x - doorEast) < 0.38 && northDistanceToDoor(position.z) < 0.22;
}

export async function loadResidenceScene(): Promise<ExplorationScene> {
  const city = await createResidenceCity();
  const materials = createResidenceMaterials();
  const shell = createResidenceShell(materials);
  const furniture = createResidenceFurniture(materials);
  const scene = new Scene();
  scene.add(city.group, shell.group, furniture.group);
  const lighting = createResidenceLighting(scene, materials, furniture.obstacles);
  lighting.attachInterior(shell.group, furniture.group);
  const reflections = createResidenceReflections(scene, city.group, shell.group, furniture.group, materials);

  let door = 0;
  let opening = false;
  let previous = 0;
  const navigation = createResidenceNavigation(findDestination('residence', 'living-window')!,
    furniture.obstacles, () => door >= 0.96);
  shell.setBalconyDoor(door);

  return {
    id: 'residence', navigation, audio: new ResidenceAudio({ balconyDoor: () => door }),
    interaction: {
      label(position) {
        const distance = Math.hypot(position.x - doorEast, northDistanceToDoor(position.z));
        if (distance > DOOR_REACH || (opening && occupiesDoorway(position))) return null;
        return opening ? 'バルコニーの引戸を閉める' : 'バルコニーの引戸を開ける';
      },
      invoke() { opening = !opening; },
    },
    world: {
      scene,
      setTimeOfDay(time) {
        city.setTimeOfDay(time);
        shell.setTimeOfDay(time);
        lighting.setTimeOfDay(time);
        reflections.setTimeOfDay(time);
      },
      setQuality(quality) {
        city.setQuality(quality);
        lighting.setQuality(quality);
        reflections.setQuality(quality);
      },
      prepareRender: reflections.prepareRender,
      update(elapsed, camera) {
        const step = (elapsed - previous) / DOOR_SLIDE_SECONDS;
        previous = elapsed;
        if (!opening && door > 0 && occupiesDoorway(camera.position)) opening = true;
        const next = opening ? Math.min(1, door + step) : Math.max(0, door - step);
        if (door !== next) {
          door = next;
          shell.setBalconyDoor(door);
          lighting.invalidateShadows();
          reflections.invalidate();
        }
        city.update(elapsed, camera);
        return [];
      },
      dispose() {
        reflections.dispose();
        lighting.dispose();
        shell.dispose();
        furniture.dispose();
        city.dispose();
        materials.dispose();
      },
    },
  };
}
