import { Scene, type Vector3 } from 'three';
import type { ExplorationScene } from '../../CoastApp';
import { findDestination } from '../../coastDestinations';
import { ResidenceAudio } from './residenceAudio';
import { createResidenceCity } from './residenceCity';
import { bindResidenceCityVisibility } from './residenceCityVisibility';
import { createResidenceCurtains } from './residenceCurtains';
import { createResidenceFurniture } from './residenceFurniture';
import { createResidenceLighting } from './residenceLighting';
import { createResidenceMaterials } from './residenceMaterials';
import { createResidenceMonitorPlaybackFactory } from './residenceMonitorAudio';
import { createResidenceNavigation } from './residenceNavigation';
import { RESIDENCE_BALCONY_DOOR, RESIDENCE_DOORWAYS } from './residencePlan';
import { createResidenceReflections } from './residenceReflections';
import { createResidenceShell } from './residenceShell';
import { createResidenceTheaterLights } from './residenceTheaterLights';

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
  const curtains = createResidenceCurtains(materials);
  furniture.group.add(curtains.group);
  const scene = new Scene();
  scene.add(city.group, shell.group, furniture.group);
  bindResidenceCityVisibility(scene, city.group, city.regionalCity);
  const invalidateReflections = () => reflections.invalidate();
  const theaterLights = createResidenceTheaterLights(furniture.theater.screen, invalidateReflections);
  const lighting = createResidenceLighting(scene, materials, furniture.obstacles, invalidateReflections, theaterLights);
  lighting.attachInterior(shell.group, furniture.group);
  const reflections = createResidenceReflections(scene, city.group, shell.group, furniture.group, materials);

  let door = 0;
  let opening = false;
  let previous = 0;
  let invokeNearby: (() => void | { openSection: string }) | undefined;
  const navigation = createResidenceNavigation(findDestination('residence', 'living-window')!,
    furniture.obstacles, () => door >= 0.96, shell.doors);
  shell.setBalconyDoor(door);
  function updateDoorLighting() {
    for (const { id } of RESIDENCE_DOORWAYS) lighting.setDoorOpenness(id, shell.doors.openness(id));
  }
  updateDoorLighting();
  const { shoji } = furniture;
  const teaCurtain = curtains.daylight.find(room => room.roomId === '04')!;
  const curtainControls = curtains.sections.map(section => section.id === 'curtains-04'
    ? { ...section, controls: [...section.controls, shoji.control] }
    : section);
  let paperLight = .32;
  function updateShojiPaper() { shoji.setPaperLight(paperLight * teaCurtain.transmission()); }
  updateShojiPaper();

  return {
    id: 'residence', navigation,
    audio: new ResidenceAudio({ balconyDoor: () => door, doorOpenness: shell.doors.opennessFor,
      appliances: furniture.appliances.audioSources }),
    residenceControls: [...lighting.sections, ...curtainControls, ...furniture.appliances.sections],
    interaction: {
      label(position, facing) {
        const distance = Math.hypot(position.x - doorEast, northDistanceToDoor(position.z));
        const curtain = curtains.nearby(position);
        const roomDoor = shell.doors.nearby(position);
        const windowShoji = shoji.nearby(position);
        const windowSwitch = windowShoji && (!curtain || windowShoji.distance < curtain.distance) ? windowShoji : curtain;
        const localLights = windowSwitch ? null : lighting.nearby(position, facing);
        const localSwitch = windowSwitch ?? localLights;
        const canUseDoor = distance <= DOOR_REACH && !(opening && occupiesDoorway(position));
        if (canUseDoor && (!localSwitch || distance <= localSwitch.distance)) {
          invokeNearby = () => { opening = !opening; };
          return opening ? 'バルコニーの引戸を閉める' : 'バルコニーの引戸を開ける';
        }
        // A switch mounted against the jamb stays easy to pick from inside its room.
        if (roomDoor && (!localSwitch || roomDoor.distance + .12 < localSwitch.distance)) {
          invokeNearby = roomDoor.invoke;
          return roomDoor.label;
        }
        const appliance = furniture.appliances.nearby(position);
        if (localSwitch && (localSwitch !== localLights || !appliance || localSwitch.distance <= appliance.distance)) {
          invokeNearby = localSwitch.invoke;
          return localSwitch.label;
        }
        invokeNearby = appliance ? () => ({ openSection: appliance.sectionId }) : undefined;
        return appliance?.label ?? null;
      },
      invoke() { return invokeNearby?.(); },
    },
    world: {
      scene,
      monitorAudio: createResidenceMonitorPlaybackFactory({
        doorOpenness: shell.doors.opennessFor, balconyDoor: () => door,
      }),
      theater: furniture.theater,
      get artificialLightingMode() { return lighting.artificialLightingMode; },
      setArtificialLightingMode: lighting.setArtificialLightingMode,
      setTimeOfDay(time) {
        city.setTimeOfDay(time);
        shell.setTimeOfDay(time);
        lighting.setTimeOfDay(time);
        paperLight = time === 'day' ? .32 : .018;
        updateShojiPaper();
        reflections.setTimeOfDay(time);
      },
      setQuality(quality) {
        city.setQuality(quality);
        lighting.setQuality(quality);
        reflections.setQuality(quality);
      },
      prepareRender(renderer, camera) {
        lighting.bindRenderer(renderer);
        reflections.prepareRender(renderer, camera);
      },
      update(elapsed, camera) {
        const dt = elapsed - previous;
        const step = dt / DOOR_SLIDE_SECONDS;
        previous = elapsed;
        furniture.appliances.update(dt);
        if (!opening && door > 0 && occupiesDoorway(camera.position)) opening = true;
        const next = opening ? Math.min(1, door + step) : Math.max(0, door - step);
        const doorMoved = door !== next;
        if (doorMoved) {
          door = next;
          shell.setBalconyDoor(door);
        }
        const curtainsMoved = curtains.update(dt);
        const shojiMoved = shoji.update(dt);
        if (shojiMoved) lighting.setTeaShojiOpenness(shoji.openness());
        const roomDoorsMoved = shell.doors.update(dt, camera.position);
        if (roomDoorsMoved) updateDoorLighting();
        if (curtainsMoved) {
          for (const room of curtains.daylight) lighting.setDaylightTransmission(room.roomId, room.transmission());
          updateShojiPaper();
        }
        if (doorMoved || curtainsMoved || roomDoorsMoved || shojiMoved) {
          lighting.invalidateShadows();
          reflections.invalidate();
        }
        city.update(elapsed, camera);
        return [];
      },
      dispose() {
        reflections.dispose();
        lighting.dispose();
        theaterLights.dispose();
        shell.dispose();
        curtains.dispose();
        furniture.dispose();
        city.dispose();
        materials.dispose();
      },
    },
  };
}
