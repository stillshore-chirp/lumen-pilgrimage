import type { MeshStandardMaterial } from 'three';
import type { ResidenceMaterials } from './residenceMaterials';
import type { ResidenceRect } from './residencePlan';
import { FurnitureModel, type FurniturePiece } from './residenceFurnitureModel';
import { addServiceFurniture } from './residenceFurnitureFixtures';

const northFacing = Math.PI;
const eastFacing = Math.PI / 2;
const westFacing = -eastFacing;

function rug(piece: FurniturePiece, body: MeshStandardMaterial, edge: MeshStandardMaterial,
  width: number, depth: number): void {
  piece.slab(edge, 0, .002, 0, width, .010, depth, .065);
  piece.slab(body, 0, .012, 0, width - .035, .008, depth - .035, .057);
}

function books(piece: FurniturePiece, cover: MeshStandardMaterial, pages: MeshStandardMaterial,
  x: number, y: number, z: number): void {
  piece.box(cover, x, y + .013, z, .215, .026, .154, .003);
  piece.box(pages, x + .001, y + .013, z + .006, .205, .018, .151);
  piece.box(cover, x + .028, y + .038, z - .017, .158, .024, .104, .002);
  piece.box(pages, x + .028, y + .038, z - .014, .151, .016, .104);
}

function tableLamp(piece: FurniturePiece, m: ResidenceMaterials, base: number, height = .39): void {
  piece.cylinder(m.darkMetal, 0, base + .012, 0, .083, .024);
  piece.cylinder(m.metal, 0, base + height * .42, 0, .008, height * .8);
  piece.vessel(m.fabric, 0, base, 0, .234, .234, [
    [.96, height * .58], [1, height * .6], [.72, height], [.66, height],
    [.88, height * .62], [.96, height * .58],
  ]);
  piece.cylinder(m.lamp, 0, base + height * .62, 0, .093, .006);
}

function chair(piece: FurniturePiece, m: ResidenceMaterials, fabric: MeshStandardMaterial,
  width = .53, seatDepth = .46, seatY = .45): void {
  const side = width / 2;
  const back = -seatDepth / 2;
  const front = seatDepth / 2;
  piece.box(m.cabinetry, 0, seatY - .037, .004, width - .023, .036, seatDepth - .014, .016);
  piece.box(fabric, 0, seatY, .009, width - .01, .077, seatDepth - .008, .055);
  for (const sign of [-1, 1]) {
    const x = sign * (side - .052);
    piece.rod(m.cabinetry, [x + sign * .018, .01, front - .033], [x, seatY - .02, front - .055], .017, .025);
    piece.rod(m.cabinetry, [x + sign * .018, .01, back + .01], [x, seatY + .29, back + .026], .017, .027);
  }
  piece.box(fabric, 0, seatY + .255, back + .029, width - .057, .184, .075, .037, .12);
  piece.tube(m.cabinetry, [
    [-side + .026, seatY + .20, back + .034], [-side + .059, seatY + .34, back + .003],
    [0, seatY + .37, back - .006], [side - .059, seatY + .34, back + .003],
    [side - .026, seatY + .20, back + .034],
  ], .014);
}

function loungeChair(piece: FurniturePiece, m: ResidenceMaterials, fabric: MeshStandardMaterial,
  width: number, depth: number): void {
  const half = width / 2;
  const front = depth / 2;
  piece.box(m.cabinetry, 0, .275, .015, width - .11, .110, depth - .143, .04);
  piece.box(fabric, 0, .383, .046, width - .10, .139, depth - .21, .066, -.10);
  piece.box(fabric, 0, .573, -.23, width - .13, .464, .15, .073, .23);
  for (const sign of [-1, 1]) {
    const x = sign * (half - .062);
    piece.rod(m.cabinetry, [x, .015, front - .12], [x, .515, front - .115], .025, .032);
    piece.rod(m.cabinetry, [x, .015, -front + .10], [x, .589, -front + .094], .025, .031);
    piece.tube(m.cabinetry, [
      [x, .56, -front + .06], [x, .535, -.19], [x, .531, .03], [x, .535, front - .064],
    ], .036);
  }
}

function addLiving(model: FurnitureModel, m: ResidenceMaterials, flax: MeshStandardMaterial,
  tobacco: MeshStandardMaterial, olive: MeshStandardMaterial): void {
  model.room('Living room');
  const sandWeave = model.tone(m.rug, 0xb6a592);
  const rugEdge = model.tone(m.rug, 0xa69883);
  const sofa = model.at(19.99, 1.01);
  const seam = model.tone(m.fabric, 0xac9781);
  sofa.box(m.cabinetry, 0, .107, -.01, 2.95, .095, .86, .024);
  sofa.box(flax, 0, .249, 0, 3.18, .271, 1.02, .095);
  for (const side of [-1, 1]) {
    sofa.box(flax, side * 1.478, .402, 0, .224, .347, .97, .108);
    sofa.box(m.darkMetal, side * 1.276, .045, .29, .147, .090, .069, .012);
    sofa.box(m.darkMetal, side * 1.276, .045, -.31, .147, .090, .069, .012);
  }
  sofa.box(flax, 0, .490, -.402, 2.96, .415, .21, .103);
  for (const x of [-.951, 0, .951]) {
    sofa.box(flax, x, .417, .069, .921, .169, .759, .078);
    sofa.tube(seam, [
      [x - .419, .421, .433], [x - .36, .429, .451],
      [x + .36, .429, .451], [x + .419, .421, .433],
    ], .0026);
    sofa.box(flax, x, .577, -.298, .916, .316, .186, .089, .17);
  }
  sofa.box(olive, -1.20, .579, -.234, .395, .331, .121, .058, .34);
  sofa.box(tobacco, 1.245, .539, -.216, .302, .248, .112, .054, .36);
  sofa.box(m.bedding, -1.15, .519, -.019, .348, .030, .368, .014);
  sofa.box(m.bedding, -1.15, .464, .217, .348, .026, .239, .012, .32);
  model.footprint(18.4, .5, 3.18, 1.02);
  rug(model.at(19.56, 1.40), sandWeave, rugEdge, 4.16, 1.87);

  const endTable = model.at(17.97, .90);
  endTable.cylinder(m.darkMetal, 0, .027, 0, .178, .054);
  endTable.cylinder(m.metal, 0, .263, 0, .032, .45);
  endTable.slab(m.counterStone, 0, .48, 0, .456, .027, .512, .14);
  tableLamp(endTable, m, .507, .34);
  model.footprint(17.74, .64, .46, .52);

  loungeChair(model.at(13.475, 1.33, northFacing), m, olive, .86, .76);
  loungeChair(model.at(14.695, 1.385, northFacing), m, tobacco, .74, .74);
  model.footprint(13.02, .94, .91, .78);
  model.footprint(14.31, 1.00, .77, .77);
  rug(model.at(14.07, 2.14), sandWeave, rugEdge, 3.17, 2.66);
  const coffee = model.at(14.075, 2.515);
  for (const x of [-.74, .74]) {
    coffee.vessel(m.cabinetry, x, .01, 0, .38, .58, [
      [0, 0], [.68, 0], [.82, .024], [.91, .104], [.77, .277], [0, .287],
    ]);
  }
  coffee.slab(m.cabinetry, 0, .283, 0, 2.366, .037, 1.106, .28);
  coffee.vessel(m.ceramic, -.61, .320, -.115, .30, .235, [
    [0, 0], [.51, 0], [.71, .021], [1, .054], [1, .065], [.93, .071],
    [.88, .059], [.59, .034], [0, .021],
  ]);
  books(coffee, olive, m.bedding, .63, .32, .07);
  model.footprint(12.89, 1.96, 2.37, 1.11);
  tableLamp(model.at(12.22, 1.27), m, .001, 1.42);
  model.footprint(12.125, 1.175, .19, .19);
}

function addDining(model: FurnitureModel, m: ResidenceMaterials, flax: MeshStandardMaterial,
  olive: MeshStandardMaterial): void {
  model.room('Dining room');
  const dining = model.at(16.025, 4.725);
  for (const x of [-.78, .78]) {
    dining.slab(m.cabinetry, x, .007, 0, .246, .034, .66, .12);
    dining.vessel(m.cabinetry, x, .038, 0, .35, .63, [
      [0, 0], [.76, 0], [.92, .037], [1, .12], [.86, .57], [.81, .665], [0, .665],
    ]);
  }
  dining.slab(m.cabinetry, 0, .696, 0, 2.56, .025, .88, .22);
  dining.slab(m.cabinetry, 0, .721, 0, 2.746, .04, 1.026, .245);
  dining.vessel(m.ceramic, .07, .761, -.02, .287, .247, [
    [0, 0], [.68, .003], [.95, .052], [1, .116], [.64, .186], [.51, .211],
    [.47, .211], [.45, .179], [.82, .078], [.68, .023], [0, .022],
  ]);
  model.footprint(14.65, 4.21, 2.75, 1.03);
  for (const [north, heading] of [[3.94, northFacing], [5.535, 0]]) {
    for (const x of [15.10, 15.98, 16.86]) {
      chair(model.at(x, north, heading), m, flax, .535, .445);
      model.footprint(x - .27, north - .23, .54, .46);
    }
  }
  const form = model.tone(m.ceramic, 0xb7a895);
  for (const x of [15.36, 16.69]) {
    const pendant = model.at(x, 4.72);
    pendant.cylinder(m.darkMetal, 0, 2.974, 0, .057, .037);
    pendant.cylinder(m.darkMetal, 0, 2.58, 0, .003, .76);
    pendant.vessel(form, 0, 2.01, 0, .45, .45, [
      [.66, .045], [.88, .061], [1, .121], [.98, .163], [.65, .209],
      [.19, .252], [.15, .238], [.40, .201], [.83, .149], [.84, .100], [.66, .045],
    ]);
    pendant.oval(m.lamp, 0, 2.083, 0, .326, .058, .326);
  }
  const console = model.at(21.16, 5.94);
  console.box(m.cabinetry, 0, .32, 0, 1.82, .48, .405, .034);
  console.slab(m.counterStone, 0, .558, 0, 1.856, .022, .426, .038);
  for (const x of [-.64, .64]) {
    console.box(m.darkMetal, x, .043, 0, .065, .084, .31, .007);
  }
  console.box(m.darkMetal, 0, .329, .204, .008, .38, .004);
  books(console, olive, m.bedding, .52, .58, 0);
  model.footprint(20.23, 5.725, 1.86, .43);
}

function wardrobe(piece: FurniturePiece, m: ResidenceMaterials, width: number, depth: number,
  height: number): void {
  const panels = Math.max(2, Math.round(width / .53));
  const pitch = (width - .065) / panels;
  piece.box(m.darkMetal, 0, .039, .005, width - .10, .078, depth - .10);
  piece.box(m.cabinetry, 0, height / 2 + .026, -.018, width, height - .054, depth - .036, .012);
  for (let i = 0; i < panels; i++) {
    const x = (i - (panels - 1) / 2) * pitch;
    piece.box(m.cabinetry, x, height * .5 + .027, depth / 2 - .015, pitch - .006,
      height - .080, .030, .006);
    piece.box(m.metal, x + pitch * .33, 1.01, depth / 2 + .013, .018, .192, .020, .005);
  }
}

function bedside(piece: FurniturePiece, m: ResidenceMaterials, width: number, depth: number): void {
  piece.box(m.cabinetry, 0, .293, 0, width, .388, depth, .033);
  piece.box(m.cabinetry, 0, .341, depth / 2 - .001, width - .076, .186, .019, .008);
  piece.box(m.darkMetal, 0, .393, depth / 2 + .008, .097, .010, .010);
  for (const x of [-.30, .30]) {
    for (const z of [-.31, .31]) {
      piece.rod(m.cabinetry, [x * width * 1.12, .01, z * depth * 1.12], [x * width, .13, z * depth], .012, .021);
    }
  }
}

type Bedroom = {
  name: string;
  bed: readonly [west: number, south: number, width: number, depth: number];
  textile: number;
  headboard: number;
  rug: number;
};

const bedrooms: readonly Bedroom[] = [
  { name: 'Bedroom 03', bed: [.49, 1.18, 1.56, 2.12], textile: 0x9d896e, headboard: 0xcab29c, rug: 0xb7ab90 },
  { name: 'Bedroom 04', bed: [4.09, 1.18, 1.50, 2.12], textile: 0x646b6c, headboard: 0x939f99, rug: 0xa39d93 },
  { name: 'Bedroom 05', bed: [7.69, 1.11, 1.37, 2.10], textile: 0x876862, headboard: 0xa98574, rug: 0xaf9285 },
  { name: 'Bedroom 02', bed: [19.53, 7.27, 1.55, 2.07], textile: 0x7d8272, headboard: 0xb3ad97, rug: 0xa6a690 },
  { name: 'Primary bedroom', bed: [17.82, 13.35, 1.83, 2.10], textile: 0xb8a586, headboard: 0x9c8170, rug: 0xb4a395 },
];

function makeBed(model: FurnitureModel, m: ResidenceMaterials, bedroom: Bedroom): void {
  const [west, south, width, depth] = bedroom.bed;
  const centerE = west + width / 2;
  const centerN = south + depth / 2;
  const quilt = model.tone(m.bedding, bedroom.textile);
  const headboard = model.tone(m.fabric, bedroom.headboard);
  const binding = model.tone(m.bedding, 0xe3d9c4);
  const bed = model.at(centerE, centerN);
  bed.box(m.darkMetal, 0, .078, -.044, width - .19, .137, depth - .23, .028);
  bed.box(m.cabinetry, 0, .212, .006, width - .018, .19, depth - .037, .047);
  bed.box(headboard, 0, .656, -depth / 2 + .066, width, 1.05, .132, .064);
  bed.box(m.bedding, 0, .376, .033, width - .045, .177, depth - .20, .07);
  bed.box(quilt, 0, .473, .250, width - .022, .121, depth - .57, .057);
  bed.box(quilt, 0, .419, depth / 2 - .053, width - .035, .19, .092, .04);
  bed.box(binding, 0, .534, -.469, width - .071, .034, .20, .016);
  for (const x of width >= 1.42 ? [-width * .23, width * .23] : [0]) {
    bed.box(m.bedding, x, .511, -depth / 2 + .319, width * .432, .129, .321, .063, .105);
  }
  bed.box(binding, width * .286, .546, .465, width * .245, .029, .591, .013);
  model.footprint(west, south, width, depth);
  const carpet = model.tone(m.rug, bedroom.rug);
  rug(model.at(centerE + .18, centerN - .29), carpet, carpet, width + .70, depth + .50);
}

function desk(piece: FurniturePiece, m: ResidenceMaterials, laptop: boolean): void {
  piece.slab(m.cabinetry, 0, .716, 0, 1.276, .036, .615, .069);
  for (const side of [-1, 1]) {
    const x = side * .531;
    piece.rod(m.cabinetry, [x * 1.055, .01, .239], [x, .72, .227], .024, .035);
    piece.rod(m.cabinetry, [x * 1.055, .01, -.232], [x, .72, -.220], .024, .035);
    piece.box(m.cabinetry, x, .608, .002, .048, .059, .46, .012);
  }
  piece.box(m.cabinetry, .29, .662, -.01, .476, .107, .474, .020);
  piece.box(m.metal, .29, .665, .221, .123, .014, .010, .004);
  piece.slab(m.darkMetal, .045, .751, .03, .455, .006, .289, .017);
  if (laptop) {
    piece.box(m.darkMetal, .065, .917, -.104, .446, .304, .019, .008, -.10);
    piece.box(m.metal, .065, .769, .031, .446, .025, .267, .008);
  } else {
    books(piece, m.fabric, m.bedding, .064, .757, .03);
  }
  piece.cylinder(m.darkMetal, -.454, .765, -.152, .079, .026);
  piece.rod(m.metal, [-.454, .765, -.152], [-.489, 1.025, -.176], .006);
  piece.rod(m.metal, [-.489, 1.025, -.176], [-.420, 1.108, .008], .006);
  piece.vessel(m.darkMetal, -.420, 1.07, .017, .175, .175, [
    [.92, 0], [1, .009], [.68, .068], [.40, .085], [0, .086],
  ]);
  piece.cylinder(m.lamp, -.420, 1.08, .017, .076, .010);
}

function addBedrooms(model: FurnitureModel, m: ResidenceMaterials, olive: MeshStandardMaterial,
  tobacco: MeshStandardMaterial, flax: MeshStandardMaterial): void {
  for (const bedroom of bedrooms) {
    model.room(bedroom.name);
    makeBed(model, m, bedroom);
    const [west, south, width, depth] = bedroom.bed;
    if (west < 9) {
      const closetE = west - .22 + 1.015;
      wardrobe(model.at(closetE, 4.615), m, 2.03, .585, 2.37);
      model.footprint(closetE - 1.015, 4.32, 2.03, .60);
    }
    const nightstandE = west + width + .255;
    const nightstandN = south + depth - .23;
    bedside(model.at(nightstandE, nightstandN), m, .44, .423);
    tableLamp(model.at(nightstandE, nightstandN + .057), m, .487, .32);
    model.footprint(nightstandE - .221, nightstandN - .222, .442, .434);

    if (bedroom.name === 'Bedroom 03') {
      loungeChair(model.at(2.945, .75, westFacing), m, tobacco, .68, .73);
      model.footprint(2.55, .394, .79, .71);
    }
    if (bedroom.name === 'Bedroom 04') {
      desk(model.at(6.765, .872, westFacing), m, false);
      chair(model.at(6.30, .79, eastFacing), m, olive, .47, .43);
      model.footprint(6.438, .232, .64, 1.28);
      model.footprint(6.075, .55, .45, .48);
    }
    if (bedroom.name === 'Bedroom 05') {
      desk(model.at(10.21, .94, westFacing), m, true);
      chair(model.at(9.752, .85, eastFacing), m, tobacco, .48, .44);
      model.footprint(9.895, .30, .63, 1.28);
      model.footprint(9.526, .602, .452, .496);
    }
    if (bedroom.name === 'Bedroom 02') {
      wardrobe(model.at(17.763, 7.875, eastFacing), m, 1.91, .554, 2.32);
      model.footprint(17.48, 6.92, .575, 1.91);
      loungeChair(model.at(22.025, 7.91, westFacing), m, olive, .63, .60);
      model.footprint(21.72, 7.557, .61, .706);
    }
    if (bedroom.name === 'Primary bedroom') {
      bedside(model.at(17.51, 15.162), m, .37, .432);
      tableLamp(model.at(17.49, 15.218), m, .487, .35);
      model.footprint(17.325, 14.936, .37, .452);
      const windowSeat = model.at(19.96, 10.66);
      windowSeat.box(m.cabinetry, 0, .315, 0, 1.2, .23, .58, .05);
      windowSeat.box(flax, 0, .454, 0, 1.144, .08, .53, .039);
      for (const x of [-.49, .49]) {
        windowSeat.box(m.darkMetal, x, .103, 0, .027, .205, .45, .01);
      }
      model.footprint(19.36, 10.37, 1.20, .58);
    }
  }

  model.room('Walk-in closet');
  wardrobe(model.at(15.586, 14.40, eastFacing), m, 2.16, .56, 2.37);
  model.footprint(15.30, 13.32, .57, 2.16);
  wardrobe(model.at(16.425, 15.204), m, 1, .551, 2.37);
  model.footprint(15.925, 14.923, 1, .556);
}

function addBalcony(model: FurnitureModel, m: ResidenceMaterials, flax: MeshStandardMaterial,
  leaves: MeshStandardMaterial): void {
  model.room('Balcony');
  loungeChair(model.at(21.36, 15.00), m, flax, .645, .62);
  model.footprint(21.02, 14.68, .68, .64);
  const planter = model.at(21.725, 12.08);
  planter.box(m.counterStone, 0, .162, 0, .85, .32, .44, .07);
  planter.slab(m.darkMetal, 0, .317, 0, .72, .013, .33, .059);
  for (const [x, z, height] of [[-.21, -.055, .60], [.01, .048, .69], [.235, -.06, .53]]) {
    planter.rod(leaves, [x, .325, z], [x + .057, height, z - .02], .0048);
    planter.oval(leaves, x - .046, height - .09, z + .029, .18, .049, .083, -.39);
    planter.oval(leaves, x + .105, height - .05, z - .039, .16, .052, .074, .54);
    planter.oval(leaves, x + .058, height, z - .048, .105, .063, .074, .73);
  }
  model.footprint(21.30, 11.86, .85, .44);
}

export function createResidenceFurniture(materials: ResidenceMaterials): {
  group: FurnitureModel['group'];
  obstacles: readonly ResidenceRect[];
  dispose(): void;
} {
  const model = new FurnitureModel();
  const flax = model.tone(materials.fabric, 0xc9b8a4);
  const tobacco = model.tone(materials.fabric, 0x9c6d51);
  const olive = model.tone(materials.fabric, 0x777b64);
  addLiving(model, materials, flax, tobacco, olive);
  addDining(model, materials, flax, olive);
  addBedrooms(model, materials, olive, tobacco, flax);
  addBalcony(model, materials, flax, olive);
  addServiceFurniture(model, materials);
  model.finish();
  return { group: model.group, obstacles: model.obstacles, dispose: () => model.dispose() };
}
