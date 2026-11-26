import { Box3, Group, Mesh, PlaneGeometry } from 'three';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { addLakeHallArrangement } from './lakeHallArrangement';
import { addHallEnclosure } from './lakeHallEnclosure';
import { beginLakeHallAssembly, type LakeHallAssembly } from './lakeHallGeometry';
import { createLakeHallMaterials, type HallMaterials } from './lakeHallMaterials';
import { LAKE_GLAZING, LAKE_HALL, LAKE_SIDE_VENTS, LAKE_TABLE, LAKE_TATAMI } from './lakeLayout';

const { halfWidth, frontZ, rearZ, ceilingY } = LAKE_HALL;
const hallWidth = halfWidth * 2;
const hallDepth = rearZ - frontZ;
const hallMidZ = (frontZ + rearZ) / 2;
const { halfWidth: tatamiHalfWidth, frontZ: tatamiFront, rearZ: tatamiRear } = LAKE_TATAMI;
const tatamiColumns = 12;
const matLength = tatamiHalfWidth * 2 / tatamiColumns;
const matWidth = matLength / 2;
const tatamiRows = Math.round((tatamiRear - tatamiFront) / matLength);

function addMat(
  mat: LakeHallAssembly,
  binding: LakeHallAssembly,
  x: number,
  z: number,
  crosswise: boolean,
  tint: number,
): void {
  const edgeWidth = .021;
  const faceSize = matWidth - 2 * edgeWidth - .003;
  const edgeOffset = (matWidth - edgeWidth) / 2;
  mat.slab([x, -.020, z], crosswise ? [matLength - .004, .04, faceSize] : [faceSize, .04, matLength - .004],
    .003, crosswise ? 0 : 2, tint, x * .091 + z * .137);
  for (const side of [-1, 1]) {
    binding.box(
      crosswise ? [x, -.0188, z + side * edgeOffset] : [x + side * edgeOffset, -.0188, z],
      crosswise ? [matLength - .004, .038, edgeWidth] : [edgeWidth, .038, matLength - .004],
      crosswise ? 0 : 2, tint,
    );
  }
}

function layBoardCourses(
  boards: LakeHallAssembly, acrossStart: number, acrossEnd: number, alongStart: number, alongEnd: number,
  runsAlongX: boolean,
): void {
  const courses = Math.round((acrossEnd - acrossStart) / .25);
  const courseWidth = (acrossEnd - acrossStart) / courses;
  for (let row = 0; row < courses; row += 1) {
    const course = acrossStart + (row + .5) * courseWidth;
    let joint = alongStart;
    let plank = 0;
    while (joint < alongEnd - .005) {
      const seed = row * 71 + plank * 37;
      const next = Math.min(alongEnd, joint + 2.05 + (seed % 23) * .073);
      const centre = (joint + next) / 2;
      const length = next - joint - .002;
      const tone = .88 + ((seed * 13 + 19) % 21) / 100;
      boards.box(runsAlongX ? [centre, -.018, course] : [course, -.018, centre],
        runsAlongX ? [length, .036, courseWidth - .002] : [courseWidth - .002, .036, length],
        runsAlongX ? 0 : 2, tone, .31 * seed);
      joint = next;
      plank += 1;
    }
  }
}

function addHallFloor(hall: Group, materials: HallMaterials): void {
  const foundation = beginLakeHallAssembly(hall, 'Basalt plinth and subfloor', materials.foundation, true);
  const boards = beginLakeHallAssembly(hall, 'Staggered oak perimeter boards', materials.boards);
  const borders = beginLakeHallAssembly(hall, 'Oak tatami edgings', materials.joinery);
  const mats = beginLakeHallAssembly(hall, 'Beveled alternating tatami mats', materials.tatami);
  const bindings = beginLakeHallAssembly(hall, 'Tatami long-edge bindings', materials.binding);
  foundation.box([0, -.335, hallMidZ + .16], [hallWidth + .72, .597, hallDepth + .32]);
  layBoardCourses(boards, frontZ, tatamiFront, -halfWidth, halfWidth, true);
  layBoardCourses(boards, tatamiRear, rearZ, -halfWidth, halfWidth, true);
  const tatamiMid = (tatamiFront + tatamiRear) / 2;
  for (const side of [-1, 1]) {
    const [start, end] = side < 0 ? [-halfWidth, -tatamiHalfWidth] : [tatamiHalfWidth, halfWidth];
    layBoardCourses(boards, start, end, tatamiFront, tatamiRear, false);
    borders.box([side * (tatamiHalfWidth + .016), -.0082, tatamiMid], [.032, .018, tatamiRear - tatamiFront], 2, .94);
  }
  for (const z of [tatamiFront, tatamiRear]) {
    borders.box([0, -.0082, z + Math.sign(z - tatamiMid) * .016], [tatamiHalfWidth * 2, .018, .032], 0, .91);
  }

  for (let row = 0; row < tatamiRows; row += 1) {
    for (let column = 0; column < tatamiColumns; column += 1) {
      const x = (column + .5) * matLength - tatamiHalfWidth;
      const z = (row + .5) * matLength + tatamiFront;
      const crosswise = (row + column) % 2 === 1;
      for (const [index, side] of [-1, 1].entries()) {
        const tint = .91 + ((row * 7 + column * 13 + index * 3) % 14) / 100;
        const offset = side * matWidth / 2;
        addMat(mats, bindings, crosswise ? x : x + offset, crosswise ? z + offset : z, crosswise, tint);
      }
    }
  }
  for (const assembly of [foundation, boards, borders, mats, bindings]) assembly.finish();
}

function addHallCeiling(hall: Group, materials: HallMaterials): void {
  const roof = beginLakeHallAssembly(hall, 'Closed ceramic-clad roof slab', materials.foundation, true);
  const ceiling = beginLakeHallAssembly(hall, 'Oiled ceiling boarding', materials.ceiling);
  const battens = beginLakeHallAssembly(hall, 'Carpentered ceiling lattice', materials.lattice);
  const beams = beginLakeHallAssembly(hall, 'Rebated roof beams', materials.timber, true);
  roof.box([0, ceilingY + .29, hallMidZ + .08], [hallWidth + 1.05, .55, hallDepth + .69]);
  ceiling.box([0, ceilingY + .054, hallMidZ], [hallWidth, .09, hallDepth], 2, .74);

  const panels = 112;
  const panelWidth = hallWidth / panels;
  for (let index = 0; index < panels; index += 1) {
    const x = -halfWidth + (index + .5) * panelWidth;
    const tone = .86 + ((index * 19) % 27) / 100;
    ceiling.box([x, ceilingY + .012, hallMidZ], [panelWidth - .010, .032, hallDepth], 2, tone, index * .49);
    if (index > 0) {
      battens.box([x - panelWidth / 2, ceilingY - .028, hallMidZ], [.046, .066, hallDepth], 2, tone * .85, index * .63);
    }
  }
  for (let z = frontZ + .18; z < rearZ; z += .65) {
    battens.box([0, ceilingY - .015, z], [hallWidth, .025, .056], 0, .83 + .08 * Math.cos(z), z * .17);
  }
  const beamSpacing = hallDepth / 5;
  for (let index = 1; index < 5; index += 1) {
    const z = frontZ + index * beamSpacing;
    beams.box([0, ceilingY - .095, z], [hallWidth, .19, .23], 0, .88, z * .27);
    battens.box([0, ceilingY - .184, z], [hallWidth, .035, .255], 0, .87, z * .48);
  }
  for (const assembly of [roof, ceiling, battens, beams]) assembly.finish();
}

function addHallGlazing(hall: Group, materials: HallMaterials): void {
  const frames = beginLakeHallAssembly(hall, 'Full-height lake aperture frames', materials.timber, true);
  const fascia = beginLakeHallAssembly(hall, 'Oiled glazing head casing', materials.lattice);
  const tracks = beginLakeHallAssembly(hall, 'Flush lake aperture sill tracks', materials.rail);
  const piers = beginLakeHallAssembly(hall, 'Glazing flank piers', materials.plaster, true);
  const ventBox = beginLakeHallAssembly(hall, 'Dark louver duct backing and lining', materials.foundation);
  const ventGrille = beginLakeHallAssembly(hall, 'Directional bronze louver blades', materials.rail);
  const apertureX = LAKE_GLAZING.halfWidth;
  const apertureTop = LAKE_GLAZING.headY;
  const mullionX = LAKE_GLAZING.centralPostX;
  const edges = [-apertureX, -13.6, -mullionX, mullionX, 13.6, apertureX];
  const vent = LAKE_SIDE_VENTS;
  frames.box([0, (ceilingY + apertureTop) / 2, frontZ + .020], [hallWidth, ceilingY - apertureTop, .41]);
  frames.box([0, apertureTop + .041, frontZ + .224], [hallWidth, .086, .081], 0, .83);
  fascia.box([0, apertureTop + .220, frontZ + .230], [hallWidth, .194, .027], 0, .76);
  fascia.box([0, apertureTop + .111, frontZ + .247], [hallWidth, .026, .035], 0, .94);
  tracks.box([0, .002, frontZ + .026], [apertureX * 2, .010, .137], 0, .82);
  tracks.box([0, .002, frontZ + .113], [apertureX * 2, .007, .020], 0, .75);
  tracks.box([0, apertureTop - .013, frontZ + .104], [apertureX * 2, .026, .056]);
  for (const x of edges) {
    const jamb = Math.abs(x) === apertureX;
    frames.box([x, apertureTop / 2, frontZ + .040], [jamb ? .168 : .107, apertureTop, .197], 1, jamb ? .88 : .75);
    tracks.box([x, apertureTop / 2, frontZ + .145], [.038, apertureTop - .012, .019], 1, .82);
  }
  for (const side of [-1, 1]) {
    const pierWidth = halfWidth - apertureX + .02;
    const pierX = side * (halfWidth + apertureX) / 2;
    const lower = vent.y - vent.height / 2;
    const upper = vent.y + vent.height / 2;
    const flankWidth = (pierWidth - vent.width) / 2;
    const x = side * vent.x;
    piers.box([pierX, lower / 2, frontZ + .037], [pierWidth, lower, .412]);
    piers.box([pierX, (upper + apertureTop) / 2, frontZ + .037], [pierWidth, apertureTop - upper, .412]);
    for (const edge of [-1, 1]) {
      piers.box([x + edge * (vent.width + flankWidth) / 2, vent.y, frontZ + .037], [flankWidth, vent.height, .412]);
      ventGrille.box([x + edge * vent.width / 2, vent.y, vent.z + .256], [.020, vent.height + .026, .045], 1, .87);
      ventGrille.box([x, vent.y + edge * vent.height / 2, vent.z + .258], [vent.width + .019, .019, .047], 0, .86);
    }
    ventBox.box([x, vent.y, vent.z - .099], [vent.width, vent.height, .12], 1, .43);
    for (let index = 0; index < 7; index += 1) {
      const y = lower + .025 + index * .050;
      ventGrille.box([x, y, vent.z + .238], [vent.width - .016, .013, .088], 0, .83);
      ventGrille.box([x, y - .007, vent.z + .270], [vent.width - .016, .019, .019], 0, .91);
    }
  }
  for (let index = 1; index < edges.length; index += 1) {
    const x0 = edges[index - 1];
    const x1 = edges[index];
    const pane = new Mesh(new PlaneGeometry(x1 - x0, apertureTop - .012), materials.glazing);
    pane.name = 'Lake aperture glass';
    pane.position.set((x0 + x1) / 2, apertureTop / 2, frontZ + .041);
    hall.add(pane);
  }
  for (const assembly of [frames, fascia, tracks, piers, ventBox, ventGrille]) assembly.finish();
}

function addLowTable(hall: Group, materials: HallMaterials): Box3 {
  const { x, z, width, depth, topY } = LAKE_TABLE;
  const base = beginLakeHallAssembly(hall, 'Low table solid wood legs and apron', materials.timber, true);
  const top = beginLakeHallAssembly(hall, 'Oiled charcoal table top', materials.table, true);
  const thickness = .067;
  const underside = topY - thickness;
  top.slab([x, topY - thickness / 2, z], [width, thickness, depth], .007, 0, 1, .31);
  for (const side of [-1, 1]) {
    const legX = x + side * width * .335;
    base.box([legX, underside / 2, z], [.270, underside, depth * .68], 1, .92, .3 * side);
    base.box([legX, underside - .018, z], [.313, .036, depth * .73], 0, .85);
  }
  base.box([x, underside - .034, z], [width * .70, .068, depth * .63], 0, .86);
  base.finish();
  top.finish();
  const arrangement = new Group();
  arrangement.name = 'Lake tabletop arrangement';
  hall.add(arrangement);
  addLakeHallArrangement(arrangement);
  return new Box3().setFromObject(arrangement, true);
}

export function buildLakeHall(root: Group) {
  const hall = new Group();
  hall.name = 'Enclosed lakeside hall';
  root.add(hall);
  const materials = createLakeHallMaterials();
  addHallFloor(hall, materials);
  addHallCeiling(hall, materials);
  addHallGlazing(hall, materials);
  addHallEnclosure(hall, materials);
  const arrangementBounds = addLowTable(hall, materials);

  return {
    arrangementBounds,
    setTimeOfDay(time: CoastTimeOfDay, lampsOn = time === 'night'): void {
      const night = time === 'night';
      materials.ceiling.emissiveIntensity = night ? .024 : .38;
      materials.lattice.emissiveIntensity = night ? .016 : .22;
      materials.windowLight.value = night ? .045 : 1;
      materials.glazing.opacity = night ? .011 : .018;
      materials.lamp.emissiveIntensity = lampsOn ? .48 : 0;
    },
  };
}
