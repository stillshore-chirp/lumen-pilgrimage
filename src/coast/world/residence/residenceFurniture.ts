import { CatmullRomCurve3, DoubleSide, Vector3, type MeshStandardMaterial } from 'three';
import type { ResidenceMaterials } from './residenceMaterials';
import { fixtureFinish } from './residenceFixtureFinish';
import type { ResidenceRect } from './residencePlan';
import { foliage } from './residenceFurnitureDecor';
import { FurnitureModel, type FurniturePiece } from './residenceFurnitureModel';
import { addServiceFurniture } from './residenceFurnitureFixtures';
import { addStudy } from './residenceStudy';
import { addTeaRoom } from './residenceTeaRoom';
import { addResidenceTheater, LIVING_SOFA_BACK_NORTH } from './residenceTheater';

const northFacing = Math.PI;
const eastFacing = Math.PI / 2;
const westFacing = -eastFacing;

function rug(piece: FurniturePiece, body: MeshStandardMaterial, edge: MeshStandardMaterial,
  width: number, depth: number): void {
  piece.slab(edge, 0, .001, 0, width, .008, depth, .041);
  piece.slab(body, 0, .009, 0, width - .026, .006, depth - .026, .035);
  for (const z of [-1, 1]) {
    piece.box(edge, 0, .015, z * (depth / 2 - .046), width - .097, .001, .006);
  }
}

function books(piece: FurniturePiece, cover: MeshStandardMaterial, pages: MeshStandardMaterial,
  x: number, y: number, z: number): void {
  for (const [offsetX, offsetY, offsetZ, width, depth, height] of [
    [0, 0, 0, .255, .195, .026], [.031, .026, -.020, .192, .141, .016],
  ]) {
    const centerX = x + offsetX;
    const base = y + offsetY;
    const centerZ = z + offsetZ;
    for (const face of [base + .001, base + height - .001]) {
      piece.box(cover, centerX, face, centerZ, width, .003, depth, .001);
    }
    piece.box(cover, centerX - width / 2 + .004, base + height / 2, centerZ, .009, height, depth, .003);
    piece.box(pages, centerX + .003, base + height / 2, centerZ, width - .018, height - .006, depth - .008);
    for (const line of [-.004, .001, .005]) {
      piece.box(cover, centerX + .003, base + height / 2 + line, centerZ + depth / 2 - .0039,
        width - .028, .00055, .0006);
    }
  }
}

function tableLamp(piece: FurniturePiece, m: ResidenceMaterials, diffuser: MeshStandardMaterial,
  base: number, height: number): void {
  const shadeWidth = height > 1 ? .282 : .234;
  piece.cylinder(m.darkMetal, 0, base + .010, 0, .085, .020, .091);
  piece.cylinder(m.metal, 0, base + height * .42, 0, height > 1 ? .011 : .007, height * .8);
  piece.cylinder(m.metal, 0, base + height * .57, 0, .017, .024);
  piece.vessel(m.linenShade, 0, base, 0, shadeWidth, shadeWidth, [
    [.962, height * .581], [.989, height * .582], [1, height * .59],
    [.983, height * .606], [.722, height * .993], [.717, height], [.686, height],
    [.683, height * .992], [.942, height * .605], [.962, height * .581],
  ]);
  piece.vessel(diffuser, 0, base, 0, .092, .092, [[0, height * .738], [.92, height * .741],
    [1, height * .766], [.86, height * .795], [0, height * .805]]);
  piece.cylinder(m.linenShade, 0, base + height * .966, 0, shadeWidth * .345, .004);
}

function chair(piece: FurniturePiece, m: ResidenceMaterials, fabric: MeshStandardMaterial,
  width = .53, seatDepth = .46, seatY = .45): void {
  const side = width / 2;
  const back = -seatDepth / 2;
  const front = seatDepth / 2;
  piece.box(m.cabinetry, 0, seatY - .037, .004, width - .023, .036, seatDepth - .014, .016);
  piece.upholstered(fabric, 0, seatY, .009, {
    width: width - .010, height: .055, depth: seatDepth - .008, radius: .023,
    crown: [.002, .010, .004], gathers: .002,
  }, { welt: fabric });
  for (const sign of [-1, 1]) {
    const x = sign * (side - .052);
    piece.cylinder(m.darkMetal, x + sign * .018, .008, front - .033, .017, .010);
    piece.cylinder(m.darkMetal, x + sign * .018, .008, back + .01, .017, .010);
    piece.rod(m.cabinetry, [x + sign * .018, .01, front - .033], [x, seatY - .02, front - .055], .017, .025);
    piece.rod(m.cabinetry, [x + sign * .018, .01, back + .01], [x, seatY + .29, back + .026], .017, .027);
  }
  piece.upholstered(fabric, 0, seatY + .255, back + .029, {
    width: width - .058, height: .176, depth: .057, radius: .022,
    crown: [.004, .008, .009], gathers: .001,
  }, { pitch: .12, welt: fabric, vertical: true });
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
  piece.box(m.cabinetry, 0, .288, .015, width - .11, .076, depth - .143, .017);
  piece.upholstered(fabric, 0, .375, .046, {
    width: width - .107, height: .112, depth: depth - .178, radius: .047,
    crown: [.006, .011, .006], gathers: .004, seed: width * 3.2,
  }, { pitch: -.10, welt: fabric });
  piece.upholstered(fabric, 0, .603, -front + .10, {
    width: width - .14, height: .424, depth: .119, radius: .047,
    crown: [.005, .009, .023], gathers: .005, seed: depth * 2.4,
  }, { pitch: -.20, welt: fabric, vertical: true });
  for (const sign of [-1, 1]) {
    const x = sign * (half - .062);
    piece.rod(m.cabinetry, [x + sign * .021, .008, front - .093], [x, .532, front - .129], .018, .027);
    piece.rod(m.cabinetry, [x + sign * .016, .008, -front + .069], [x, .577, -front + .117], .017, .027);
    piece.box(m.cabinetry, x, .554, -.013, .069, .043, depth - .148, .021, -.063);
    piece.box(m.cabinetry, x, .290, -.014, .038, .050, depth - .218, .010);
    piece.rod(m.darkMetal, [x + sign * .019, .302, -.191], [x + sign * .022, .302, -.191], .009);
  }
}

function sofaThrow(piece: FurniturePiece, cloth: MeshStandardMaterial, trim: MeshStandardMaterial): void {
  const drape = new CatmullRomCurve3([
    new Vector3(-.842, .520, .075), new Vector3(-.859, .606, -.128), new Vector3(-.879, .779, -.216),
    new Vector3(-.906, .795, -.337), new Vector3(-.940, .767, -.463), new Vector3(-.976, .695, -.501),
    new Vector3(-1.017, .586, -.536), new Vector3(-1.057, .436, -.539),
  ]);
  const sample = (u: number, v: number): readonly [number, number, number] => {
    const p = drape.getPoint(v);
    const sway = Math.sin(v * 6.8 + u * 3.9) * .010;
    const fold = Math.sin(u * 11.1 + v * 3.6) * .011 + Math.sin(u * 24 - v * 4.0) * .003;
    return [p.x + (u - .5) * (.366 + v * .092) + sway,
      p.y + fold * (1 - v * .72) + (u - .5) * .063 * v ** 6,
      p.z + fold * (.22 + v * .31) + .007 * v * Math.cos(u * 7.4)];
  };
  piece.surface(cloth, .47, .87, 30, 27, sample);
  for (const u of [.019, .981]) {
    piece.tube(trim, Array.from({ length: 24 }, (_, i) => sample(u, i / 23)), .0017);
  }
  piece.tube(trim, Array.from({ length: 23 }, (_, i) => sample(i / 22, .992)), .0019);
  for (let i = 0; i < 33; i++) {
    const [x, y, z] = sample((i + .5) / 33, 1);
    piece.rod(trim, [x, y, z], [x + Math.sin(i * 4.01) * .004, y - .021 - Math.sin(i * 3.24) * .005, z - .004],
      .00075, .00047);
  }
}

function addLiving(model: FurnitureModel, m: ResidenceMaterials, flax: MeshStandardMaterial,
  tobacco: MeshStandardMaterial, olive: MeshStandardMaterial): void {
  model.room('Living room');
  const sandWeave = model.tone(m.rug, 0xbab5a2);
  const rugEdge = model.tone(m.rug, 0xa19881);
  const sofaNorth = LIVING_SOFA_BACK_NORTH - .50;
  const sofa = model.at(19.99, sofaNorth);
  const seam = model.tone(m.fabric, 0xa99b89);
  const lining = model.tone(m.fabric, 0xb8ab97);
  const throwBlanket = model.tone(m.bedding, 0x686d65);
  throwBlanket.side = DoubleSide;
  sofa.box(m.cabinetry, 0, .105, -.007, 2.99, .075, .902, .013);
  sofa.box(flax, 0, .231, 0, 3.172, .219, 1.004, .075);
  for (const side of [-1, 1]) {
    sofa.upholstered(flax, side * 1.471, .398, .013, {
      width: .225, height: .353, depth: .975, radius: .087,
      crown: [.010, .011, .009], gathers: .0035, seed: side + 2,
    }, { welt: seam });
    sofa.box(m.darkMetal, side * 1.285, .045, .365, .108, .089, .050, .008);
    sofa.box(m.darkMetal, side * 1.285, .045, -.37, .108, .089, .050, .008);
  }
  sofa.upholstered(lining, 0, .486, -.393, {
    width: 2.934, height: .405, depth: .215, radius: .080,
    crown: [.008, .011, .007], gathers: .0036, seed: 3.4,
  }, { welt: seam, vertical: true });
  for (const [x, z, angle, height, seed] of [
    [-.916, .054, .015, .139, 1.4], [0, .064, -.011, .138, 3.44], [.916, .072, -.007, .141, 7.9],
  ]) {
    sofa.upholstered(flax, x, .412, z, {
      width: .899, height, depth: .796, radius: .058,
      crown: [.009, .018, .012], gathers: .0077, seed,
    }, { yaw: angle, welt: seam });
    sofa.upholstered(flax, x + angle * .62, .595 + angle * .48, -.296, {
      width: .900, height: .307, depth: .173, radius: .067,
      crown: [.007, .021, .018], gathers: .0081, seed: seed + 1.3,
    }, { pitch: -.216, roll: angle * 2, welt: seam, vertical: true });
  }
  sofa.upholstered(olive, -1.22, .598, -.144, {
    width: .352, height: .343, depth: .116, radius: .052,
    crown: [.011, .012, .027], gathers: .009, seed: 2.35,
  }, { pitch: -.371, yaw: .267, roll: -.21, welt: olive, vertical: true });
  sofa.upholstered(tobacco, 1.155, .587, -.161, {
    width: .331, height: .297, depth: .113, radius: .048,
    crown: [.014, .014, .024], gathers: .010, seed: 4.82,
  }, { pitch: -.301, yaw: -.233, roll: .16, welt: tobacco, vertical: true });
  sofaThrow(sofa, throwBlanket, throwBlanket);
  model.footprint(18.4, sofaNorth - .51, 3.18, 1.02);
  rug(model.at(19.56, 1.40), sandWeave, rugEdge, 4.16, 1.87);

  const endTable = model.at(17.97, .90);
  endTable.vessel(m.darkMetal, 0, .012, 0, .346, .346, [
    [0, 0], [.89, 0], [.98, .003], [1, .010], [.982, .022], [.87, .024], [.15, .038], [0, .038],
  ]);
  endTable.vessel(m.metal, 0, .042, 0, .107, .107, [
    [0, 0], [1, 0], [1, .023], [.57, .062], [.48, .398], [.64, .431], [0, .438],
  ]);
  endTable.slab(m.counterStone, 0, .48, 0, .456, .027, .512, .14);
  tableLamp(endTable, m, fixtureFinish(model, m.lamp, 'LD-table'), .507, .34);
  endTable.vessel(m.ceramic, -.120, .508, .115, .086, .073, [
    [0, 0], [.73, 0], [.9, .012], [1, .030], [.91, .031], [.78, .016], [0, .012],
  ]);
  model.footprint(17.74, .64, .46, .52);

  loungeChair(model.at(13.475, 1.33, northFacing + .09), m, olive, .86, .76);
  loungeChair(model.at(14.695, 1.385, northFacing - .14), m, tobacco, .74, .74);
  model.footprint(13.02, .94, .91, .78);
  model.footprint(14.31, 1.00, .77, .77);
  rug(model.at(14.07, 2.14), sandWeave, rugEdge, 3.17, 2.66);
  const coffee = model.at(14.075, 2.515);
  for (const [x, z] of [[-.76, -.29], [-.76, .29], [.76, -.29], [.76, .29]]) {
    coffee.rod(m.cabinetry, [x * 1.07, .014, z * 1.1], [x, .287, z], .025, .046);
    coffee.cylinder(m.darkMetal, x * 1.07, .013, z * 1.1, .023, .008);
  }
  coffee.slab(m.cabinetry, 0, .262, 0, 2.11, .022, .90, .25);
  coffee.slab(m.cabinetry, 0, .281, 0, 2.366, .039, 1.106, .28);
  coffee.vessel(m.ceramic, -.61, .320, -.115, .30, .235, [
    [0, 0], [.51, 0], [.71, .021], [1, .054], [1, .065], [.93, .071],
    [.88, .059], [.59, .034], [0, .021],
  ]);
  books(coffee, olive, m.bedding, .63, .32, .07);
  coffee.vessel(m.ceramic, .01, .320, -.24, .082, .082, [
    [0, 0], [.80, 0], [.90, .009], [.985, .063], [1, .071], [.93, .074],
    [.86, .066], [.77, .017], [0, .017],
  ]);
  coffee.tube(m.ceramic, [[.045, .375, -.24], [.067, .376, -.24], [.074, .356, -.24], [.045, .342, -.24]], .005);
  model.footprint(12.89, 1.96, 2.37, 1.11);
  tableLamp(model.at(12.22, 1.27), m, fixtureFinish(model, m.lamp, 'LD-floor'), .001, 1.42);
  model.footprint(12.125, 1.175, .19, .19);
}

function addDining(model: FurnitureModel, m: ResidenceMaterials, flax: MeshStandardMaterial,
  leaves: readonly [MeshStandardMaterial, MeshStandardMaterial]): void {
  model.room('Dining room');
  const dining = model.at(16.025, 4.725);
  for (const x of [-.78, .78]) {
    dining.slab(m.cabinetry, x, .007, 0, .246, .034, .66, .12);
    dining.vessel(m.cabinetry, x, .038, 0, .35, .63, [
      [0, 0], [.76, 0], [.92, .037], [1, .12], [.86, .57], [.81, .665], [0, .665],
    ], 0, true);
  }
  dining.slab(m.cabinetry, 0, .696, 0, 2.56, .025, .88, .22);
  dining.slab(m.cabinetry, 0, .721, 0, 2.746, .04, 1.026, .245);
  const earthenware = model.tone(m.ceramic, 0xbdbaa5);
  dining.vessel(earthenware, .07, .761, -.02, .237, .215, [
    [0, 0], [.68, .003], [.95, .052], [1, .116], [.64, .186], [.51, .211],
    [.47, .211], [.45, .179], [.82, .078], [.68, .023], [0, .022],
  ]);
  foliage(dining, m.cabinetry, leaves[0], leaves[1], .07, .942, -.02, .351, .112, 1.99);
  foliage(dining, m.cabinetry, leaves[0], leaves[1], .092, .937, -.019, .244, .093, 4.39);
  model.footprint(14.65, 4.21, 2.75, 1.03);
  for (const [x, north, heading] of [
    [15.10, 3.95, northFacing + .056], [15.98, 3.926, northFacing - .010],
    [16.86, 3.866, northFacing - .091], [15.10, 5.535, -.047],
    [15.98, 5.548, .041], [16.86, 5.557, -.061],
  ]) {
    chair(model.at(x, north, heading), m, flax, .535, .445);
    model.footprint(x - .27, north - .23, .54, .46);
  }
  const form = model.tone(m.ceramic, 0xb7a895);
  for (const [x, id] of [[15.36, 'LD-pendant-west'], [16.69, 'LD-pendant-east']] as const) {
    const pendant = model.at(x, 4.72);
    pendant.cylinder(m.darkMetal, 0, 2.974, 0, .057, .037);
    pendant.cylinder(m.darkMetal, 0, 2.58, 0, .003, .76);
    pendant.vessel(form, 0, 2.01, 0, .45, .45, [
      [.66, .045], [.88, .061], [1, .121], [.98, .163], [.65, .209],
      [.19, .252], [.15, .238], [.40, .201], [.83, .149], [.84, .100], [.66, .045],
    ]);
    pendant.oval(fixtureFinish(model, m.lamp, id), 0, 2.083, 0, .326, .058, .326);
  }
}

function wardrobe(piece: FurniturePiece, m: ResidenceMaterials, width: number, depth: number,
  height: number): void {
  const panels = Math.max(2, Math.round(width / .53));
  const pitch = (width - .065) / panels;
  piece.box(m.darkMetal, 0, .039, .005, width - .10, .078, depth - .10);
  piece.box(m.cabinetry, 0, height / 2 + .026, -.018, width, height - .054, depth - .036, .012, 0, true);
  for (let i = 0; i < panels; i++) {
    const x = (i - (panels - 1) / 2) * pitch;
    piece.box(m.cabinetry, x, height * .5 + .027, depth / 2 - .015, pitch - .006,
      height - .080, .030, .004, 0, true);
    const handleX = x + pitch * (i % 2 === 0 ? .34 : -.34);
    for (const y of [.942, 1.093]) piece.box(m.metal, handleX, y, depth / 2 + .013, .013, .013, .028, .002);
    piece.box(m.metal, handleX, 1.017, depth / 2 + .029, .011, .176, .008, .003);
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

const bedrooms: readonly (Bedroom & { readonly lampId: string })[] = [
  { name: 'Bedroom 03', lampId: '03-bed', bed: [.49, 1.18, 1.56, 2.12], textile: 0x9d896e, headboard: 0xcab29c, rug: 0xb7ab90 },
  { name: 'Bedroom 02', lampId: '02-bed', bed: [19.53, 7.27, 1.55, 2.07], textile: 0x7d8272, headboard: 0xb3ad97, rug: 0xa6a690 },
  { name: 'Primary bedroom', lampId: '01-bed-east', bed: [17.82, 13.35, 1.83, 2.10], textile: 0xb8a586, headboard: 0x9c8170, rug: 0xb4a395 },
];

function makeBed(model: FurnitureModel, m: ResidenceMaterials, bedroom: Bedroom): void {
  const [west, south, width, depth] = bedroom.bed;
  const centerE = west + width / 2;
  const centerN = south + depth / 2;
  const quilt = model.tone(m.bedding, bedroom.textile);
  quilt.side = DoubleSide;
  const headboard = model.tone(m.fabric, bedroom.headboard);
  const binding = model.tone(m.bedding, 0xe3d9c4);
  binding.side = DoubleSide;
  const bed = model.at(centerE, centerN);
  bed.box(m.darkMetal, 0, .078, -.044, width - .19, .137, depth - .23, .028);
  bed.box(m.cabinetry, 0, .212, .006, width - .018, .19, depth - .037, .047);
  bed.box(m.cabinetry, 0, .655, -depth / 2 + .065, width, 1.045, .135, .028);
  bed.upholstered(headboard, 0, .693, -depth / 2 + .124, {
    width: width - .054, height: .904, depth: .076, radius: .037,
    crown: [.002, .003, .008], gathers: .002,
  }, { welt: headboard, vertical: true });
  bed.upholstered(m.bedding, 0, .376, .033, {
    width: width - .043, height: .174, depth: depth - .202, radius: .061,
    crown: [.008, .010, .005],
  }, { welt: m.bedding });
  const phase = centerE * 1.7 + centerN;
  const quiltTop = (u: number, v: number): readonly [number, number, number] => {
    const side = Math.abs(2 * u - 1);
    const foot = Math.max(0, (v - .90) / .10);
    const hang = Math.max(0, (side - .86) / .14);
    const tuck = Math.min(1, Math.max(hang, foot));
    const rumple = Math.sin(u * 22.1 + v * 5.7 + phase) * .010 + Math.sin(u * 39.7 - v * 9.1) * .0048;
    const waves = rumple * (.4 + .65 * Math.sin(v * Math.PI)) + (hang + foot) * rumple * .8;
    const fold = .017 * Math.exp(-18 * v) + .009 * Math.sin(u * 8.8 + phase) * Math.exp(-5 * v);
    return [
      (u - .5) * (width + .073) + v * .019 + .020 * tuck * Math.sin(v * 15.8 + u * 6.1),
      .502 - .174 * tuck ** 1.73 + waves + fold,
      -.553 + v * (depth / 2 + .598) + .011 * Math.sin(u * 4.8 + phase) * (1 - v) + .009 * tuck * Math.sin(u * 33.1),
    ];
  };
  bed.surface(quilt, width + .06, depth / 2 + .60, 37, 39, quiltTop);
  bed.surface(binding, width + .06, .144, 37, 7, (u, v) => {
    const [x, y, z] = quiltTop(u, v * .092);
    return [x, y + .0035 + .0065 * (1 - v) ** 2, z - (1 - v) * .021];
  });
  for (const u of [0, 1]) {
    bed.tube(quilt, Array.from({ length: 33 }, (_, i) => quiltTop(u, i / 32)), .0018);
  }
  bed.tube(quilt, Array.from({ length: 35 }, (_, i) => quiltTop(i / 34, 1)), .0018);
  for (const x of width >= 1.42 ? [-width * .238, width * .241] : [0]) {
    bed.upholstered(m.bedding, x, .509 + x * .016, -depth / 2 + .296 + x * .054, {
      width: width * (width > 1.42 ? .449 : .55), height: .108, depth: .389, radius: .050,
      crown: [.011, .027, .016], gathers: .008, seed: phase + x * 3,
    }, { pitch: .105, yaw: x * .20 - .048, welt: binding });
  }
  if (width > 1.79) {
    bed.upholstered(headboard, -.39, .585, -depth / 2 + .514, {
      width: .368, height: .246, depth: .102, radius: .048,
      crown: [.008, .010, .026], gathers: .009, seed: 6.7,
    }, { pitch: -.484, yaw: -.12, roll: .075, welt: headboard, vertical: true });
  }
  model.footprint(west, south, width, depth);
  const carpet = model.tone(m.rug, bedroom.rug);
  rug(model.at(centerE + .18, centerN - .29), carpet, carpet, width + .70, depth + .50);
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
    const nightstand = model.at(nightstandE, nightstandN + .057);
    tableLamp(nightstand, m, fixtureFinish(model, m.lamp, bedroom.lampId), .487, .32);
    if (bedroom.name === 'Primary bedroom') {
      books(nightstand, model.tone(m.fabric, bedroom.headboard), m.bedding, -.012, .486, .123);
    } else {
      nightstand.vessel(m.ceramic, .060, .486, .121, .087, .087, [
        [0, 0], [.74, 0], [.86, .009], [1, .049], [.988, .062],
        [.91, .066], [.85, .059], [.68, .018], [0, .016],
      ]);
    }
    model.footprint(nightstandE - .221, nightstandN - .222, .442, .434);

    if (bedroom.name === 'Bedroom 03') {
      loungeChair(model.at(2.945, .75, westFacing), m, tobacco, .68, .73);
      model.footprint(2.55, .394, .79, .71);
    }
    if (bedroom.name === 'Bedroom 02') {
      wardrobe(model.at(17.763, 7.875, eastFacing), m, 1.91, .554, 2.32);
      model.footprint(17.48, 6.92, .575, 1.91);
      loungeChair(model.at(22.025, 7.91, westFacing), m, olive, .63, .60);
      model.footprint(21.72, 7.557, .61, .706);
    }
    if (bedroom.name === 'Primary bedroom') {
      bedside(model.at(17.51, 15.162), m, .37, .432);
      tableLamp(model.at(17.49, 15.218), m, fixtureFinish(model, m.lamp, '01-bed-west'), .487, .35);
      model.footprint(17.325, 14.936, .37, .452);
      const windowSeat = model.at(19.96, 10.66);
      windowSeat.box(m.cabinetry, 0, .315, 0, 1.2, .23, .58, .05);
      windowSeat.upholstered(flax, 0, .454, 0, {
        width: 1.144, height: .078, depth: .53, radius: .035,
        crown: [.009, .012, .005], gathers: .0036, seed: 5.62,
      }, { welt: flax });
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
  leaves: readonly [MeshStandardMaterial, MeshStandardMaterial]): void {
  model.room('Balcony');
  loungeChair(model.at(21.36, 15.00), m, flax, .645, .62);
  model.footprint(21.02, 14.68, .68, .64);
  const planter = model.at(21.725, 12.08);
  planter.slab(m.counterStone, 0, .009, 0, .805, .046, .399, .086);
  planter.slab(m.counterStone, 0, .054, 0, .846, .265, .439, .087, {
    x: 0, z: 0, width: .777, depth: .369,
  });
  const soil = model.tone(m.stone, 0x4a4035);
  planter.slab(soil, 0, .250, 0, .776, .015, .367, .082);
  for (const [x, z, height, spread, seed] of [
    [-.235, -.040, .321, .137, 1.6], [-.072, .085, .266, .127, 4.3],
    [.027, -.030, .409, .162, 3.2], [.173, .041, .328, .135, 5.14],
    [.279, -.054, .254, .108, .81],
  ]) {
    foliage(planter, m.cabinetry, leaves[0], leaves[1], x, .268, z, height, spread, seed);
  }
  model.footprint(21.30, 11.86, .85, .44);
}

export function createResidenceFurniture(materials: ResidenceMaterials): {
  group: FurnitureModel['group'];
  obstacles: readonly ResidenceRect[];
  appliances: ReturnType<typeof addServiceFurniture>;
  shoji: ReturnType<typeof addTeaRoom>;
  theater: ReturnType<typeof addResidenceTheater>;
  dispose(): void;
} {
  const model = new FurnitureModel();
  const flax = model.tone(materials.fabric, 0xd0c3b2);
  const tobacco = model.tone(materials.fabric, 0xa06d51);
  const olive = model.tone(materials.fabric, 0x727965);
  const leaves = [model.tone(materials.ceramic, 0x40534a), model.tone(materials.ceramic, 0x69765b)] as const;
  for (const material of leaves) {
    material.side = DoubleSide;
    material.roughness = .48;
  }
  addLiving(model, materials, flax, tobacco, olive);
  addDining(model, materials, flax, leaves);
  addBedrooms(model, materials, olive, tobacco, flax);
  const shoji = addTeaRoom(model, materials);
  addStudy(model, materials);
  chair(model.at(8.63, 2.39, westFacing - .10), materials, olive, .513, .465);
  model.footprint(8.38, 2.10, .495, .572);
  loungeChair(model.at(9.54, 1.08, -.435), materials, flax, .741, .763);
  model.footprint(9.06, .57, .959, 1.018);
  addBalcony(model, materials, flax, leaves);
  const appliances = addServiceFurniture(model, materials);
  const theater = addResidenceTheater(model, materials);
  model.group.add(theater.screen);
  model.finish();
  return { group: model.group, obstacles: model.obstacles, appliances, shoji, theater, dispose() {
    appliances.dispose();
    shoji.dispose();
    theater.screen.geometry.dispose();
    theater.screen.material.dispose();
    model.dispose();
  } };
}
