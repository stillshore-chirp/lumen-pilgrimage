import { ExtrudeGeometry, Float32BufferAttribute, Group, Mesh, PlaneGeometry, Shape } from 'three';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { addLakeHallArrangement } from './lakeHallArrangement';
import { beginLakeHallAssembly, type LakeHallAssembly } from './lakeHallGeometry';
import { createLakeHallMaterials } from './lakeHallMaterials';
import { LAKE_GLAZING, LAKE_HALL, LAKE_TABLE, LAKE_TATAMI, LAKE_VERANDA } from './lakeLayout';

type HallMaterials = ReturnType<typeof createLakeHallMaterials>;

const { halfWidth, frontZ, rearZ, ceilingY } = LAKE_HALL;
const hallWidth = halfWidth * 2;
const hallDepth = rearZ - frontZ;
const hallMidZ = (frontZ + rearZ) / 2;
const { halfWidth: tatamiHalfWidth, frontZ: tatamiFront, rearZ: tatamiRear } = LAKE_TATAMI;
const tatamiColumns = 12;
const tatamiRows = 4;
const matLength = tatamiHalfWidth * 2 / tatamiColumns;
const matWidth = matLength / 2;
const verandaCanopyFrontZ = LAKE_VERANDA.endZ + .70;

function addMat(
  mat: LakeHallAssembly,
  binding: LakeHallAssembly,
  x: number,
  z: number,
  crosswise: boolean,
  tint: number,
): void {
  const edgeWidth = .027;
  const faceSize = matWidth - 2 * edgeWidth - .003;
  const edgeOffset = (matWidth - edgeWidth) / 2;
  mat.box([x, -.020, z], crosswise ? [matLength - .003, .040, faceSize] : [faceSize, .040, matLength - .003],
    crosswise ? 0 : 2, tint, x * .091 + z * .137);
  for (const side of [-1, 1]) {
    binding.box(
      crosswise ? [x, -.0195, z + side * edgeOffset] : [x + side * edgeOffset, -.0195, z],
      crosswise ? [matLength - .003, .039, edgeWidth] : [edgeWidth, .039, matLength - .003],
      crosswise ? 0 : 2,
      tint,
    );
  }
}

function addHallFloor(hall: Group, materials: HallMaterials): void {
  const foundation = beginLakeHallAssembly(hall, 'Basalt plinth and subfloor', materials.foundation, true);
  const boards = beginLakeHallAssembly(hall, 'Oak perimeter floor', materials.boards);
  const mats = beginLakeHallAssembly(hall, 'Alternating tatami mats', materials.tatami);
  const bindings = beginLakeHallAssembly(hall, 'Tatami long-edge bindings', materials.binding);
  foundation.box([0, -.34, hallMidZ], [hallWidth, .59, hallDepth]);
  boards.box([0, -.018, (frontZ + tatamiFront) / 2], [hallWidth, .036, tatamiFront - frontZ]);
  boards.box([0, -.018, (rearZ + tatamiRear) / 2], [hallWidth, .036, rearZ - tatamiRear]);
  for (const side of [-1, 1]) {
    boards.box([side * (halfWidth + tatamiHalfWidth) / 2, -.018, (tatamiFront + tatamiRear) / 2],
      [halfWidth - tatamiHalfWidth, .036, tatamiRear - tatamiFront], 2, .91);
  }

  for (let row = 0; row < tatamiRows; row += 1) {
    for (let column = 0; column < tatamiColumns; column += 1) {
      const x = (column + .5) * matLength - tatamiHalfWidth;
      const z = (row + .5) * matLength + tatamiFront;
      const crosswise = (row + column) % 2 === 1;
      for (const [index, side] of [-1, 1].entries()) {
        const tint = .86 + ((row * 7 + column * 13 + index * 3) % 17) / 100;
        const offset = side * matWidth / 2;
        addMat(mats, bindings, crosswise ? x : x + offset, crosswise ? z + offset : z, crosswise, tint);
      }
    }
  }
  foundation.finish();
  boards.finish();
  mats.finish();
  bindings.finish();
}

function addHallCeiling(hall: Group, materials: HallMaterials): void {
  const eaves = beginLakeHallAssembly(hall, 'Deep roof and eaves', materials.timber, true);
  const ceiling = beginLakeHallAssembly(hall, 'Oiled ceiling boarding', materials.ceiling);
  const battens = beginLakeHallAssembly(hall, 'Carpentered ceiling lattice', materials.lattice);
  eaves.box([0, ceilingY + .30, hallMidZ], [hallWidth + .46, .49, hallDepth + .12]);

  const panels = 124;
  const panelWidth = hallWidth / panels;
  for (let index = 0; index < panels; index += 1) {
    const x = -halfWidth + (index + .5) * panelWidth;
    const tone = .88 + ((index * 19) % 23) / 100;
    ceiling.box([x, ceilingY + .047, hallMidZ], [panelWidth - .004, .094, hallDepth], 2, tone, index * .67);
    if (index > 0) {
      battens.box([x - panelWidth / 2, ceilingY - .020, hallMidZ], [.029, .041, hallDepth], 2, tone * .89, index * .57);
    }
  }
  for (let z = frontZ + .10; z < rearZ; z += .62) {
    battens.box([0, ceilingY - .044, z], [hallWidth, .052, .061], 0, .81 + .08 * Math.cos(z), z * .17);
  }

  const wingWidth = LAKE_VERANDA.outsideX - LAKE_VERANDA.insideX;
  const canopyDepth = frontZ - verandaCanopyFrontZ;
  const wingZ = (verandaCanopyFrontZ + frontZ) / 2;
  for (const side of [-1, 1]) {
    const x = side * (LAKE_VERANDA.outsideX + LAKE_VERANDA.insideX) / 2;
    eaves.box([x, ceilingY + .15, wingZ], [wingWidth + .23, .40, canopyDepth], 2);
    ceiling.box([x, ceilingY - .048, wingZ], [wingWidth, .091, canopyDepth], 2, .82);
    for (let offset = -.5 * wingWidth + .10; offset < .5 * wingWidth; offset += .35) {
      battens.box([x + offset, ceilingY - .11, wingZ], [.071, .070, canopyDepth], 2, .82);
    }
  }
  eaves.finish();
  ceiling.finish();
  battens.finish();
}

function addHallGlazing(hall: Group, materials: HallMaterials): void {
  const frames = beginLakeHallAssembly(hall, 'Full-height lake aperture frames', materials.timber, true);
  const tracks = beginLakeHallAssembly(hall, 'Flush lake aperture sill tracks', materials.rail);
  const apertureX = LAKE_GLAZING.halfWidth;
  const apertureTop = LAKE_GLAZING.headY;
  const mullionX = LAKE_GLAZING.centralPostX;
  const edges = [-apertureX, -mullionX, mullionX, apertureX];
  frames.box([0, (ceilingY + apertureTop) / 2, frontZ + .029], [hallWidth, ceilingY - apertureTop, .34]);
  frames.box([0, apertureTop + .036, frontZ + .188], [hallWidth, .081, .069], 0, .81);
  tracks.box([0, .002, frontZ + .026], [apertureX * 2, .009, .126], 0, .82);
  tracks.box([0, .002, frontZ + .108], [apertureX * 2, .007, .018], 0, .67);
  for (const x of edges) {
    const outside = Math.abs(x) === apertureX;
    frames.box([x, apertureTop / 2, frontZ + .037], [outside ? .157 : .107, apertureTop, .182], 1, outside ? .92 : .75);
    frames.box([x, apertureTop / 2, frontZ + .134], [.049, apertureTop - .012, .020], 1, .83);
  }
  for (let index = 1; index < edges.length; index += 1) {
    const x0 = edges[index - 1];
    const x1 = edges[index];
    const pane = new Mesh(new PlaneGeometry(x1 - x0, apertureTop - .012), materials.glazing);
    pane.name = 'Lake aperture glass';
    pane.position.set((x0 + x1) / 2, apertureTop / 2, frontZ + .040);
    hall.add(pane);
  }
  frames.finish();
  tracks.finish();
}

function addHallEnclosure(hall: Group, materials: HallMaterials): void {
  const walls = beginLakeHallAssembly(hall, 'Mineral-plastered outer walls', materials.plaster, true);
  const frames = beginLakeHallAssembly(hall, 'Posts and perimeter beam', materials.timber, true);
  const panels = beginLakeHallAssembly(hall, 'Smoked timber wainscot', materials.panel);
  const lamps = beginLakeHallAssembly(hall, 'Recessed kozo paper lanterns', materials.lamp);
  const baseY = 1.12;

  walls.box([0, ceilingY / 2, rearZ + .16], [hallWidth + .52, ceilingY, .32]);
  panels.box([0, baseY / 2, rearZ - .034], [hallWidth, baseY, .065], 1, .95);
  frames.box([0, baseY, rearZ - .079], [hallWidth, .052, .083]);
  frames.box([0, 2.89, rearZ - .046], [hallWidth, .102, .095]);
  frames.box([0, ceilingY - .165, rearZ - .111], [hallWidth, .33, .21]);
  for (let x = -20.4; x <= 20.4; x += 3.4) {
    frames.box([x, ceilingY / 2, rearZ - .055], [.146, ceilingY, .116], 1, .85);
  }

  for (const side of [-1, 1]) {
    walls.box([side * (halfWidth + .16), ceilingY / 2, hallMidZ], [.32, ceilingY, hallDepth]);
    panels.box([side * (halfWidth - .034), baseY / 2, hallMidZ], [.065, baseY, hallDepth], 1);
    frames.box([side * (halfWidth - .079), baseY, hallMidZ], [.083, .052, hallDepth], 2);
    frames.box([side * (halfWidth - .046), 2.89, hallMidZ], [.095, .102, hallDepth], 2);
    frames.box([side * (halfWidth - .111), ceilingY - .165, hallMidZ], [.21, .33, hallDepth], 2);
    for (const z of [frontZ + .18, -2.5, 1.4, 5.3, 9.2, rearZ - .2]) {
      frames.box([side * (halfWidth - .023), ceilingY / 2, z], [.115, ceilingY, .15], 1, .84);
    }

    const lampZ = 10.6;
    frames.box([side * (halfWidth - .077), .85, lampZ], [.15, .62, .276], 1, .95);
    lamps.box([side * (halfWidth - .153), .85, lampZ], [.010, .526, .198], 1);
    for (const offset of [-.135, 0, .135]) {
      frames.box([side * (halfWidth - .165), .85 + offset, lampZ], [.012, .012, .218], 2, .92);
    }
  }
  walls.finish();
  frames.finish();
  panels.finish();
  lamps.finish();
}

function addVerandas(hall: Group, materials: HallMaterials): void {
  const veranda = beginLakeHallAssembly(hall, 'Lakeside veranda boards', materials.veranda);
  const supports = beginLakeHallAssembly(hall, 'Veranda columns, rails and joists', materials.timber, true);
  const balusters = beginLakeHallAssembly(hall, 'Slender veranda balusters', materials.rail);
  const { insideX, outsideX, endZ } = LAKE_VERANDA;
  const width = outsideX - insideX;
  const depth = frontZ - endZ;
  const centreZ = (frontZ + endZ) / 2;
  const inset = .13;
  const railTop = 1.04;
  const railFoot = .144;
  const balusterY = (railFoot + railTop) / 2;
  const balusterHeight = railTop - railFoot - .036;

  for (const side of [-1, 1]) {
    const centreX = side * (insideX + outsideX) / 2;
    const courses = 27;
    const boardWidth = width / courses;
    for (let index = 0; index < courses; index += 1) {
      const x = side * (insideX + (index + .5) * boardWidth);
      const tone = .82 + ((index * 13 + 3) % 26) / 100;
      veranda.box([x, -.034, centreZ], [boardWidth - .004, .068, depth], 2, tone, index * .31);
    }
    supports.box([centreX, -.124, endZ + .065], [width, .245, .13], 0, .88);
    supports.box([centreX, railTop, endZ + inset], [width - 2 * inset + .10, .086, .099], 0, .89);
    supports.box([centreX, railFoot, endZ + inset], [width - 2 * inset + .10, .044, .069], 0, .76);
    for (let x = insideX + .29; x < outsideX - .24; x += .18) {
      balusters.box([side * x, balusterY, endZ + inset], [.014, balusterHeight, .026], 1);
    }
    for (const x of [insideX + inset, outsideX - inset]) {
      supports.box([side * x, -.141, centreZ], [.165, .251, depth], 2, .91);
      supports.box([side * x, railTop, centreZ + inset / 2], [.093, .086, depth - inset], 2, .89);
      supports.box([side * x, railFoot, centreZ + inset / 2], [.065, .044, depth - inset], 2, .76);
      for (let z = endZ + .31; z < frontZ - .14; z += .18) {
        balusters.box([side * x, balusterY, z], [.026, balusterHeight, .014], 1);
      }
      supports.box([side * x, (ceilingY - 1.75) / 2, verandaCanopyFrontZ + .14],
        [.171, ceilingY + 1.75, .171], 1, .94);
      for (const z of [endZ + inset, centreZ, frontZ - .12]) {
        supports.box([side * x, railTop / 2, z], [.091, railTop, .091], 1, .91);
      }
    }
  }
  veranda.finish();
  supports.finish();
  balusters.finish();
}

function addLowTable(hall: Group, materials: HallMaterials): void {
  const { x, z, width, depth, topY } = LAKE_TABLE;
  const base = beginLakeHallAssembly(hall, 'Low table solid wood legs and apron', materials.timber, true);
  const edge = .008;
  const thickness = .052;
  const underside = topY - thickness - 2 * edge;
  const shape = new Shape();
  const halfX = width / 2 - edge;
  const halfZ = depth / 2 - edge;
  shape.moveTo(-halfX, -halfZ);
  shape.lineTo(halfX, -halfZ);
  shape.lineTo(halfX, halfZ);
  shape.lineTo(-halfX, halfZ);
  shape.closePath();
  const topGeometry = new ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelThickness: edge, bevelSize: edge, bevelSegments: 2,
  });
  const tint = new Float32Array(topGeometry.attributes.position.count * 3).fill(1);
  topGeometry.setAttribute('color', new Float32BufferAttribute(tint, 3));
  topGeometry.rotateX(-Math.PI / 2);
  const top = new Mesh(topGeometry, materials.table);
  top.name = 'Low table chamfered top';
  top.position.set(x, underside + edge, z);
  top.castShadow = top.receiveShadow = true;
  hall.add(top);

  for (const side of [-1, 1]) {
    base.box([x + side * width * .33, underside / 2, z], [.273, underside, depth * .66], 1, .98);
  }
  base.box([x, underside - .044, z], [width * .78, .092, depth * .69], 0, .73);
  base.finish();
  addLakeHallArrangement(hall);
}

export function buildLakeHall(root: Group) {
  const hall = new Group();
  hall.name = 'Lakeside hall and verandas';
  root.add(hall);
  const materials = createLakeHallMaterials();
  addHallFloor(hall, materials);
  addHallCeiling(hall, materials);
  addHallGlazing(hall, materials);
  addHallEnclosure(hall, materials);
  addVerandas(hall, materials);
  addLowTable(hall, materials);

  return {
    setTimeOfDay(time: CoastTimeOfDay, lampsOn = time === 'night'): void {
      const night = time === 'night';
      materials.ceiling.emissiveIntensity = night ? .030 : .26;
      materials.lattice.emissiveIntensity = night ? .025 : .22;
      materials.table.emissiveIntensity = night ? .018 : .18;
      materials.tableWindowLight.value = night ? .09 : 1;
      materials.glazing.opacity = night ? .016 : .032;
      materials.lamp.emissiveIntensity = lampsOn ? 1.28 : .02;
    },
  };
}
