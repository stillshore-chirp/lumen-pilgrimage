import { Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, type BufferGeometry, type Material, type Texture } from 'three';
import { cinemaBoxes, cinemaFinishes, type CinemaBox, type CinemaFinishes } from './cinemaFinishes';
import { CINEMA_COVE_LENS_X, CINEMA_COVE_LENS_Y, CINEMA_EXIT_LAMPS, CINEMA_WALL_FOOTLIGHTS, CINEMA_WALL_LENS_X } from './cinemaFixtureLighting';
import { createCinemaExits } from './cinemaFixtures';
import { createCinemaFloor } from './cinemaFloor';
import {
  CINEMA_BOUNDS, CINEMA_CEILING_BAFFLES, CINEMA_DOOR_HEIGHT, CINEMA_DOOR_WIDTH,
  CINEMA_EXITS, CINEMA_PROJECTION_Y,
  CINEMA_ROOM_HEIGHT, CINEMA_SCREEN, cinemaGroundHeight,
} from './cinemaLayout';
import { createCinemaSeats } from './cinemaSeats';
import { createCinemaSpeakerEquipment } from './cinemaSpeakerEquipment';
import { CINEMA_RETURN_COFFER_BOXES, CINEMA_VENTILATION_PARTS, cinemaVentilationWallBoxes } from './cinemaVentilation';

type CinemaQuality = 'light' | 'high';

const ROOM = CINEMA_BOUNDS;
const HEIGHT = CINEMA_ROOM_HEIGHT;
const SPAN = ROOM.maxX - ROOM.minX;
const LENGTH = ROOM.maxZ - ROOM.minZ;
const MID_Z = (ROOM.minZ + ROOM.maxZ) * 0.5;
const PROJECTION_Y = CINEMA_PROJECTION_Y;
const WINDOWS = [-1.44, 1.44];
const WINDOW_WIDTH = 1.84;
const WINDOW_HEIGHT = 0.99;

function addWalls(group: Group, finish: CinemaFinishes): void {
  const shell: CinemaBox[] = [];
  const lining: CinemaBox[] = [];
  const panels: CinemaBox[] = [];
  const ribs: CinemaBox[] = [];
  const furring: CinemaBox[] = [];
  const bronze: CinemaBox[] = [];
  const houseHoods: CinemaBox[] = [];
  const wallLights: CinemaBox[] = [];
  const sideDoors = CINEMA_EXITS.filter((exit) => exit.side === 'left');
  const halfDoor = CINEMA_DOOR_WIDTH * 0.5;
  const sideEdges = [ROOM.minZ, ...sideDoors.flatMap(({ z }) => [z - halfDoor, z + halfDoor]), ROOM.maxZ];

  shell.push([0, HEIGHT + 0.16, MID_Z, SPAN + 0.5, 0.32, LENGTH + 0.50]);
  shell.push([0, HEIGHT * 0.5, ROOM.minZ - 0.16, SPAN + 0.5, HEIGHT, 0.32]);

  for (const sign of [-1, 1]) {
    for (let i = 0; i < sideEdges.length - 1; i += 1) {
      const [front, rear] = [sideEdges[i], sideEdges[i + 1]];
      const bottom = i % 2 === 0 ? 0 : sideDoors[(i - 1) / 2].y + CINEMA_DOOR_HEIGHT;
      shell.push([sign * 20.14, (HEIGHT + bottom) * 0.5, (front + rear) * 0.5, 0.28, HEIGHT - bottom, rear - front]);
    }

    // The lower panels follow the rake. Short runs leave full-depth jambs at each exit.
    const skirtEdges = [
      ...sideEdges,
      ...Array.from({ length: 22 }, (_, i) => 2.1 + i * 2.32),
    ].sort((a, b) => a - b);
    for (let i = 0; i < skirtEdges.length - 1; i += 1) {
      const [front, rear] = [skirtEdges[i], skirtEdges[i + 1]];
      const depth = rear - front;
      const z = (front + rear) * 0.5;
      if (sideDoors.some((exit) => Math.abs(z - exit.z) < halfDoor)) continue;
      const base = cinemaGroundHeight(0, z);
      lining.push([sign * 19.96, (base + 3.2) * 0.5, z, 0.10, base + 3.2, depth - 0.006]);
      if (depth > 0.12) {
        panels.push([sign * 19.875, base + 2.24, z, 0.124, 1.70, depth - 0.08]);
        furring.push([sign * 19.80, base + 1.382, z, 0.078, 0.04, depth - 0.064]);
      }
    }

    for (let i = 0; i < 17; i += 1) {
      const z = 2.08 + i * 3.02;
      const top = 17.91 + 0.29 * Math.sin(i * 0.62);
      const bottom = 3.4 + cinemaGroundHeight(0, z);
      panels.push(
        [sign * 19.88, (top + bottom) * 0.5, z, 0.14, top - bottom, 2.91],
        [sign * 19.78, top + 1.71, z, 0.14, 2.06, 2.91],
      );
      for (let j = 0; j < 6; j += 1) {
        const end = top - 0.10 + Math.cos(j * 0.72) * 0.09;
        const start = bottom + 0.055 + Math.sin(j * 0.64) * 0.09;
        const depth = 0.083 + 0.030 * Math.sin(j * 1.29 + i * 0.75);
        ribs.push([sign * 19.71, (end + start) * 0.5, z - 1.31 + j * 0.52, 0.25 + (j % 3) * 0.055, end - start, depth]);
      }
      furring.push([sign * 19.73, bottom + 0.01, z, 0.31, 0.09, 2.95]);
      bronze.push([sign * 19.55, bottom + 0.043, z, 0.045, 0.023, 2.84]);
    }

    for (const { z, y } of CINEMA_WALL_FOOTLIGHTS) {
      houseHoods.push(
        [sign * 19.81, y + 0.31, z, 0.080, 0.152, 0.350],
        [sign * 19.75, y + 0.327, z, 0.042, 0.060, 0.336],
      );
      wallLights.push([sign * CINEMA_WALL_LENS_X, y + 0.262, z, 0.018, 0.020, 0.270]);
    }
  }

  const rearHoles = [
    ...CINEMA_EXITS.filter(({ side }) => side === 'rear').map(({ x, y }) => ({
      x, width: CINEMA_DOOR_WIDTH, top: y + CINEMA_DOOR_HEIGHT, bottom: 0,
    })),
    ...WINDOWS.map((x) => ({
      x, width: WINDOW_WIDTH, top: PROJECTION_Y + WINDOW_HEIGHT / 2, bottom: PROJECTION_Y - WINDOW_HEIGHT / 2,
    })),
  ];
  const rearEdges = [ROOM.minX, ...rearHoles.flatMap(({ x, width }) => [x - width / 2, x + width / 2]).sort((a, b) => a - b), ROOM.maxX];
  for (let i = 0; i < rearEdges.length - 1; i += 1) {
    const x = (rearEdges[i] + rearEdges[i + 1]) * 0.5;
    const width = rearEdges[i + 1] - rearEdges[i];
    const opening = rearHoles.find((hole) => Math.abs(hole.x - x) < hole.width * 0.5);
    const materialTop = opening ? opening.top : 0;
    shell.push([x, (materialTop + HEIGHT) * 0.5, ROOM.maxZ + 0.14, width, HEIGHT - materialTop, 0.28]);
    if (opening && opening.bottom > 0) shell.push([x, opening.bottom * 0.5, ROOM.maxZ + 0.14, width, opening.bottom, 0.28]);
  }

  for (let i = 0; i < 14; i += 1) {
    const x = -18.45 + i * 2.84;
    const lowerPanelEdge = cinemaGroundHeight(x, ROOM.maxZ) + CINEMA_DOOR_HEIGHT + 0.645;
    const bottom = Math.abs(x) < 3.0 ? PROJECTION_Y + WINDOW_HEIGHT / 2 + 0.315 : lowerPanelEdge;
    panels.push([x, (19.0 + bottom) * 0.5, 53.83, 2.77, 19.0 - bottom, 0.14]);
    for (let j = -2; j <= 2; j += 1) {
      ribs.push([x + j * 0.54, (19.0 + bottom) * 0.5, 53.67, 0.103, 18.90 - bottom, 0.235]);
    }
    furring.push([x, bottom + 0.043, 53.65, 2.77, 0.087, 0.24]);
  }

  cinemaBoxes(group, 'Isolated auditorium envelope and ceiling', finish.box, finish.shell, cinemaVentilationWallBoxes(shell));
  cinemaBoxes(group, 'Raked dark lower wall lining', finish.box, finish.bulkhead, lining);
  cinemaBoxes(group, 'Perforated acoustic panels', finish.box, finish.acoustic, panels);
  cinemaBoxes(group, 'Vertical sound scattering ribs', finish.box, finish.ribs, ribs);
  cinemaBoxes(group, 'Recessed panel trim and shadow lines', finish.box, finish.protection, furring);
  cinemaBoxes(group, 'Warm anodized panel reveals', finish.box, finish.bronze, bronze);
  cinemaBoxes(group, 'Shielded wall footlight housings', finish.box, finish.darkSteel, houseHoods);
  cinemaBoxes(group, 'Wall footlight lenses', finish.box, new MeshBasicMaterial({ color: 0xcb9459, toneMapped: false }), wallLights);
}

function addScreenSurround(group: Group, finish: CinemaFinishes): void {
  const { width, height, bottom, center } = CINEMA_SCREEN;
  const half = width * 0.5;
  const top = bottom + height;
  const masks: CinemaBox[] = [
    [0, bottom * 0.5, -0.235, width + 0.062, bottom, 0.208],
    [0, (top + HEIGHT) * 0.5, -0.235, width + 0.062, HEIGHT - top, 0.208],
    [0, 0.074, 0.018, 38.0, 0.148, 0.34],
  ];
  const drapes: CinemaBox[] = [];
  const frame: CinemaBox[] = [
    [0, bottom - 0.104, 0.009, width + 0.42, 0.208, 0.26],
    [0, top + 0.104, 0.009, width + 0.42, 0.208, 0.26],
    [0, top + 0.38, -0.096, 33.92, 0.19, 0.39],
  ];
  const reveal: CinemaBox[] = [
    [0, bottom - 0.273, 0.079, width + 0.62, 0.027, 0.068],
    [0, top + 0.272, 0.068, width + 0.62, 0.017, 0.052],
  ];

  for (const sign of [-1, 1]) {
    masks.push([sign * 17.63, 10.93, -0.20, 4.8, 21.86, 0.38]);
    frame.push(
      [sign * (half + 0.106), center, 0.013, 0.212, height, 0.26],
      [sign * 18.91, 9.34, 0.023, 0.59, 18.69, 0.97],
      [sign * 19.38, 9.34, -0.19, 0.38, 18.69, 0.84],
    );
    reveal.push([sign * (half + 0.28), center, 0.07, 0.03, height + 0.55, 0.061]);
    for (let i = 0; i < 14; i += 1) {
      const x = sign * (15.42 + i * 0.215);
      const depth = 0.17 + 0.10 * Math.cos(i * 1.24);
      drapes.push([x, 9.37, 0.09 + depth * 0.23, 0.204, 18.68, depth]);
    }
  }

  cinemaBoxes(group, 'Black acoustic masking around the screen opening', finish.box, finish.matte, masks);
  cinemaBoxes(group, 'Side drapery and folds', finish.box, finish.drape, drapes);
  cinemaBoxes(group, 'Low-reflection proscenium and screen frame', finish.box, finish.protection, frame);
  cinemaBoxes(group, 'Hairline proscenium edge', finish.box, finish.darkSteel, reveal);
}

function addOverhead(group: Group, finish: CinemaFinishes): void {
  const housings: CinemaBox[] = [];
  const cove: CinemaBox[] = [];
  const service: CinemaBox[] = [];
  const emergency: CinemaBox[] = [];

  for (let i = 0; i < 5; i += 1) {
    const z = ROOM.minZ + (i + 0.5) * LENGTH / 5;
    for (const side of [-1, 1]) {
      housings.push([side * 19.14, 18.862, z, 0.135, 0.055, 11.12]);
      cove.push([side * CINEMA_COVE_LENS_X, CINEMA_COVE_LENS_Y, z, 0.044, 0.017, 10.96]);
    }
  }

  for (let i = 0; i < 7; i += 1) {
    const z = 5.50 + 6.40 * i;
    for (const sign of [-1, 1]) {
      housings.push([sign * 10.90, 21.57, z, 0.37, 0.42, 0.37]);
      service.push([sign * 10.90, 21.352, z, 0.255, 0.017, 0.255]);
    }
  }
  for (const { x, y, z } of CINEMA_EXIT_LAMPS) {
    housings.push([x, y + 0.051, z, 0.37, 0.088, 0.19]);
    emergency.push([x, y, z, 0.21, 0.014, 0.12]);
  }

  cinemaBoxes(group, 'Four ceiling smoke baffles', finish.box, finish.protection, CINEMA_CEILING_BAFFLES);
  cinemaBoxes(group, 'Ceiling coffers and cove returns', finish.box, finish.bulkhead, CINEMA_RETURN_COFFER_BOXES);
  for (const kind of ['frame', 'liner', 'duct', 'support'] as const) {
    cinemaBoxes(group, 'Cinema return ventilation ' + kind, finish.box, kind === 'liner' ? finish.matte : finish.darkSteel,
      CINEMA_VENTILATION_PARTS.filter(part => part.kind === kind).map(part => part.box));
  }
  cinemaBoxes(group, 'Light housings', finish.box, finish.darkSteel, housings);
  for (const [name, color, locations] of [
    ['cove', 0xe4b678, cove], ['service', 0xe1e0d6, service], ['emergency', 0xeeeee5, emergency],
  ] as const) {
    const fixture = cinemaBoxes(group, name + ' diffusers', finish.box,
      new MeshBasicMaterial({ color, toneMapped: false }), locations);
    fixture.userData.cinemaLightFixture = name;
  }
}

function addAuditoriumEquipment(group: Group, finish: CinemaFinishes) {
  const cabinets: CinemaBox[] = [];
  const speakerFinishes = createCinemaSpeakerEquipment(group);
  const surrounds: CinemaBox[] = [];
  const inner: CinemaBox[] = [];
  const panes: CinemaBox[] = [];
  const lenses: CinemaBox[] = [];

  for (const x of WINDOWS) {
    for (const sign of [-1, 1]) {
      surrounds.push(
        [x + sign * (WINDOW_WIDTH * 0.5 + 0.044), PROJECTION_Y, 53.85, 0.088, WINDOW_HEIGHT + 0.18, 0.230],
        [x, PROJECTION_Y + sign * (WINDOW_HEIGHT * 0.5 + 0.042), 53.85, WINDOW_WIDTH, 0.084, 0.23],
      );
    }
    inner.push([x, PROJECTION_Y, 54.35, WINDOW_WIDTH + 0.08, WINDOW_HEIGHT + 0.06, 0.11]);
    cabinets.push([x, PROJECTION_Y - 0.07, 54.19, 0.90, 0.47, 0.29]);
    lenses.push([x, PROJECTION_Y, 54.033, 0.315, 0.224, 0.026]);
    panes.push([x, PROJECTION_Y, 53.998, WINDOW_WIDTH, WINDOW_HEIGHT, 0.016]);
  }
  cinemaBoxes(group, 'Projection equipment cabinets', finish.box, finish.darkSteel, cabinets);
  cinemaBoxes(group, 'Recessed projection window frames', finish.box, finish.darkSteel, surrounds);
  cinemaBoxes(group, 'Dark projection booth wall', finish.box, finish.matte, inner);
  const glass = new MeshStandardMaterial({ color: 0x64838c, roughness: 0.21, metalness: 0.24, transparent: true, opacity: 0.28, depthWrite: false });
  cinemaBoxes(group, 'Glazed projection ports', finish.box, glass, panes);
  const lens = new MeshBasicMaterial({ color: 0x283f45, toneMapped: false });
  cinemaBoxes(group, 'Projection optics behind glazing', finish.box, lens, lenses);
  return speakerFinishes;
}

export function createCinemaAuditorium() {
  const group = new Group();
  group.name = 'Large cinema auditorium';
  const finish = cinemaFinishes();
  createCinemaFloor(group, finish);
  const chairDetails = createCinemaSeats(group, finish);
  addWalls(group, finish);
  addScreenSurround(group, finish);
  addOverhead(group, finish);
  const speakerFinishes = addAuditoriumEquipment(group, finish);
  createCinemaExits(group, finish);
  chairDetails.visible = false;
  let disposed = false;

  return {
    group,
    setQuality(quality: CinemaQuality) {
      if (disposed) return;
      const high = quality === 'high';
      chairDetails.visible = high;
      finish.setHighDetail(high);
      speakerFinishes.setHighDetail(high);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();
      const textures = new Set<Texture>(speakerFinishes.textures);
      group.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        if (object instanceof InstancedMesh) object.dispose();
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          if (material instanceof MeshStandardMaterial || material instanceof MeshBasicMaterial) {
            if (material.map) textures.add(material.map);
            if (material instanceof MeshStandardMaterial && material.bumpMap) textures.add(material.bumpMap);
          }
        }
      });
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
      group.clear();
    },
  };
}
