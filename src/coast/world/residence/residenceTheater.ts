import { Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, type Material } from 'three';
import type { MonitorTheater } from '../../../monitor/monitorObject';
import type { FurnitureModel, FurniturePiece } from './residenceFurnitureModel';
import type { ResidenceMaterials } from './residenceMaterials';

const SCREEN_DIAGONAL = 130 * .0254;
const SCREEN_WIDTH = SCREEN_DIAGONAL * 16 / Math.hypot(16, 9);
const SCREEN_HEIGHT = SCREEN_WIDTH * 9 / 16;
const AXIS = 19.99;
const SCREEN_NORTH = 6.49;
const SCREEN_HEIGHT_ABOVE_FLOOR = 1.45;
export const LIVING_SOFA_BACK_NORTH = 1.81;
const LISTENER = { east: AXIS, north: LIVING_SOFA_BACK_NORTH + .28 };

function addSofa(model: FurnitureModel, m: ResidenceMaterials): void {
  const flax = model.tone(m.fabric, 0xd0c3b2);
  const seam = model.tone(m.fabric, 0xa99b89);
  const sofa = model.at(AXIS, LIVING_SOFA_BACK_NORTH + .48, Math.PI);
  sofa.box(m.cabinetry, 0, .105, -.012, 2.99, .075, .902, .013);
  sofa.box(flax, 0, .231, 0, 3.172, .219, .978, .075);
  sofa.upholstered(flax, 0, .495, -.377, {
    width: 2.934, height: .405, depth: .207, radius: .079,
    crown: [.008, .011, .008], gathers: .004,
  }, { welt: seam, vertical: true });
  for (const x of [-.923, 0, .923]) {
    sofa.upholstered(flax, x, .410, .057, {
      width: .906, height: .146, depth: .767, radius: .061,
      crown: [.008, .018, .012], gathers: .006, seed: 3.6 + x * 1.28,
    }, { welt: seam });
    sofa.upholstered(flax, x, .617, -.274, {
      width: .909, height: .328, depth: .171, radius: .066,
      crown: [.007, .020, .017], gathers: .007, seed: 6.4 + x * 2.80,
    }, { pitch: -.21, welt: seam, vertical: true });
  }
  for (const x of [-1.472, 1.472]) {
    sofa.upholstered(flax, x, .398, 0, {
      width: .226, height: .352, depth: .946, radius: .083,
      crown: [.010, .011, .009], gathers: .004, seed: 3.8 + x,
    }, { welt: seam });
    sofa.box(m.darkMetal, x * .874, .045, .366, .108, .089, .05, .008);
  }
  model.footprint(AXIS - 1.59, LIVING_SOFA_BACK_NORTH - .01, 3.18, .99);

  const rug = model.at(AXIS, 3.59);
  rug.slab(model.tone(m.rug, 0x9a9485), 0, .001, 0, 3.56, .008, 2.40, .056);
  rug.slab(model.tone(m.rug, 0xafaa9d), 0, .009, 0, 3.53, .006, 2.37, .043);
}

type Driver = readonly [x: number, y: number, radius: number];

function addSpeaker(model: FurnitureModel, m: ResidenceMaterials, grille: Material,
  diaphragm: Material, east: number, north: number, bottom: number,
  width: number, height: number, depth: number, drivers: readonly Driver[], pedestal = false): Object3D {
  const heading = Math.atan2(LISTENER.east - east, north - LISTENER.north);
  const speaker = model.at(east, north, heading);
  speaker.box(m.darkMetal, 0, bottom + height / 2, 0, width, height, depth, .017);
  speaker.box(grille, 0, bottom + height / 2, depth / 2 - .004, width - .031, height - .043, .015, .009);
  for (const [x, y, radius] of drivers) {
    const front = depth / 2 + .004;
    const diameter = radius * 2;
    speaker.vessel(m.darkMetal, x, bottom + y, front, diameter, diameter, [
      [.97, 0], [1, .002], [1, .008], [.95, .012], [.88, .012], [.83, .006],
    ], Math.PI / 2);
    speaker.vessel(diaphragm, x, bottom + y, front, diameter, diameter, [
      [.89, .011], [.81, .006], [.38, .003], [.31, .010], [.19, .013], [0, .014],
    ], Math.PI / 2);
  }
  if (pedestal) {
    speaker.slab(m.darkMetal, 0, .012, 0, .217, .025, .228, .026);
    speaker.box(m.darkMetal, 0, bottom / 2, -.005, .045, bottom, .049, .006);
  }
  if (pedestal || bottom < .05) {
    const base = pedestal ? .234 : width;
    const baseDepth = pedestal ? .234 : depth;
    const halfWidth = (Math.abs(Math.cos(heading)) * base + Math.abs(Math.sin(heading)) * baseDepth) / 2;
    const halfDepth = (Math.abs(Math.sin(heading)) * base + Math.abs(Math.cos(heading)) * baseDepth) / 2;
    model.footprint(east - halfWidth, north - halfDepth, 2 * halfWidth, 2 * halfDepth);
  }
  const origin = new Object3D();
  const acousticCenter = drivers[0];
  const face = depth / 2 + .02;
  origin.position.set(east + Math.sin(heading) * face, bottom + acousticCenter[1], -north + Math.cos(heading) * face);
  origin.rotation.y = heading;
  return origin;
}

function addConsole(piece: FurniturePiece, m: ResidenceMaterials): void {
  piece.box(m.darkMetal, 0, .045, -.018, 1.53, .09, .29, .007);
  piece.box(m.cabinetry, 0, .231, 0, 1.84, .293, .387, .026);
  piece.slab(m.cabinetry, 0, .377, 0, 1.88, .027, .411, .028);
  for (const x of [-.601, 0, .601]) {
    piece.box(m.cabinetry, x, .226, .20, .590, .255, .027, .010);
    piece.box(m.darkMetal, x, .326, .216, .118, .009, .010, .003);
  }
}

export function addResidenceTheater(model: FurnitureModel, m: ResidenceMaterials): MonitorTheater {
  model.room('Living room home theater');
  addSofa(model, m);

  const cabinetNorth = 6.32;
  addConsole(model.at(AXIS, cabinetNorth), m);
  model.footprint(AXIS - .94, cabinetNorth - .207, 1.88, .414);
  const bezel = model.at(AXIS, SCREEN_NORTH + .027);
  bezel.box(m.darkMetal, 0, SCREEN_HEIGHT_ABOVE_FLOOR, 0, SCREEN_WIDTH + .022, SCREEN_HEIGHT + .024, .049, .006);
  bezel.box(m.brushedSteel, 0, SCREEN_HEIGHT_ABOVE_FLOOR - SCREEN_HEIGHT / 2 - .009, .024,
    SCREEN_WIDTH + .012, .006, .005, .002);
  const screen = new Mesh(new PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT),
    new MeshBasicMaterial({ color: 0x11171b, toneMapped: false }));
  screen.name = 'residence-tv';
  screen.position.set(AXIS, SCREEN_HEIGHT_ABOVE_FLOOR, -SCREEN_NORTH);

  const grille = model.tone(m.felt, 0x303236);
  const diaphragm = model.tone(m.darkMetal, 0x555b5f);
  const towerHeight = 1.64;
  // Keep the tweeter near seated ear height as the cabinet extends upward.
  const tower: readonly Driver[] = [
    [0, 1.125, .034], [0, 1.405, .092], [0, .847, .104], [0, .570, .104], [0, .293, .104],
  ];
  const satellite: readonly Driver[] = [[0, .214, .027], [0, .103, .059]];
  // ITU-R BS.775-4 provides reference bearings for the fronts and surrounds.
  // The front pair is slightly narrower to preserve the outer window path.
  const speakers = [
    addSpeaker(model, m, grille, diaphragm, AXIS - 2.13, 6.30, .022, .296, towerHeight, .345, tower),
    addSpeaker(model, m, grille, diaphragm, AXIS + 2.13, 6.30, .022, .296, towerHeight, .345, tower),
    addSpeaker(model, m, grille, diaphragm, AXIS, 6.36, .405, .59, .167, .230,
      [[0, .089, .029], [-.179, .089, .056], [.179, .089, .056]]),
    addSpeaker(model, m, grille, diaphragm, 21.45, 6.28, .016, .419, .435, .451, [[0, .225, .156]]),
    addSpeaker(model, m, grille, diaphragm, AXIS - 1.68, 1.15, .99, .173, .285, .178, satellite, true),
    addSpeaker(model, m, grille, diaphragm, AXIS + 1.68, 1.15, .99, .173, .285, .178, satellite, true),
  ];
  const layout = ['front-left', 'front-right', 'center', 'subwoofer', 'surround-left', 'surround-right'];
  speakers.forEach((speaker, index) => { speaker.name = layout[index]; });
  return { screen, speakers };
}
