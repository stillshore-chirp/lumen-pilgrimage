import type { MeshStandardMaterial } from 'three';
import type { ResidenceMaterials } from './residenceMaterials';
import type { FurnitureModel, FurniturePiece } from './residenceFurnitureModel';

const eastFacing = Math.PI / 2;

function sink(piece: FurniturePiece, finish: MeshStandardMaterial, x: number, y: number,
  z: number, width: number, depth: number): void {
  piece.slab(finish, x, y - .007, z, width + .012, .011, depth + .012, .082, {
    x: 0, z: 0, width: width - .036, depth: depth - .036,
  });
  piece.box(finish, x, y - .137, z, width - .003, .024, depth - .003, .01);
  for (const side of [-1, 1]) {
    piece.box(finish, x + side * (width / 2 - .014), y - .068, z, .028, .134, depth - .045, .01);
    piece.box(finish, x, y - .068, z + side * (depth / 2 - .014), width - .025, .134, .028, .01);
  }
}

function faucet(piece: FurniturePiece, m: ResidenceMaterials, x: number, base: number,
  z: number, tall: boolean): void {
  const rise = tall ? .299 : .134;
  const reach = tall ? .158 : .101;
  piece.cylinder(m.metal, x, base + .014, z, .025, .028);
  piece.tube(m.metal, [
    [x, base + .013, z], [x, base + rise * .72, z], [x, base + rise, z + reach * .39],
    [x, base + rise * .93, z + reach], [x, base + rise * .76, z + reach * 1.09],
  ], .009);
  piece.cylinder(m.darkMetal, x, base + rise * .752, z + reach * 1.09, .010, .011);
  piece.rod(m.metal, [x + .024, base + .027, z], [x + .044, base + .090, z], .0035);
}

function cabinetFront(piece: FurniturePiece, m: ResidenceMaterials, x: number, y: number,
  z: number, width: number, height: number, drawers: boolean, facing = 1): void {
  const tiers = drawers ? 3 : 1;
  const pitch = height / tiers;
  for (let row = 0; row < tiers; row++) {
    const center = y + (row - (tiers - 1) / 2) * pitch;
    piece.box(m.cabinetry, x, center, z, width - .007, pitch - .007, .021, .004);
    piece.box(m.darkMetal, x + (drawers ? 0 : width * .28),
      center + pitch * (drawers ? .34 : .40), z + facing * .012,
      Math.min(width * .42, .202), .011, .009, .002);
  }
}

function addKitchen(model: FurnitureModel, m: ResidenceMaterials): void {
  model.room('Kitchen');
  const island = model.at(15.025, 7.715);
  island.box(m.darkMetal, 0, .044, 0, 2.03, .088, .66, .017);
  island.box(m.cabinetry, 0, .444, -.040, 2.23, .728, .775, .018);
  for (const x of [-.76, 0, .76]) cabinetFront(island, m, x, .438, -.432, .74, .69, true, -1);
  for (let index = -16; index <= 16; index++) {
    island.box(m.cabinetry, index * .065, .439, .356, .047, .716, .037, .015);
  }
  island.slab(m.counterStone, 0, .808, 0, 2.346, .078, .946, .068);
  island.vessel(m.ceramic, -.665, .887, .095, .259, .206, [
    [0, 0], [.71, 0], [.95, .019], [1, .045], [.98, .102], [.90, .105],
    [.88, .085], [.75, .022], [0, .018],
  ]);
  island.box(m.cabinetry, .583, .906, -.031, .303, .037, .202, .016);
  model.footprint(13.85, 7.24, 2.35, .95);

  const counter = model.at(15.145, 9.54);
  counter.box(m.darkMetal, 0, .047, -.029, 4.195, .094, .481);
  counter.box(m.cabinetry, 0, .405, -.014, 4.215, .632, .557);
  const frontWidths = [.61, .67, .67, .99, .63, .36, .30];
  let left = -2.115;
  for (const [i, width] of frontWidths.entries()) {
    const center = left + width / 2;
    if (i === 4) {
      counter.box(m.metal, center, .447, .288, width - .016, .720, .029, .011);
      counter.box(m.darkMetal, center, .432, .300, width - .073, .471, .015, .006);
      counter.box(m.metal, center, .659, .300, width - .11, .019, .019, .008);
      for (const x of [-.16, .16]) {
        counter.rod(m.darkMetal, [center + x, .754, .299], [center + x, .754, .309], .019);
      }
      counter.box(m.lamp, center, .748, .304, .055, .015, .006, .002);
    } else {
      cabinetFront(counter, m, center, .436, .29, width, .696, i < 3 || i > 4);
    }
    left += width;
  }
  counter.box(m.cabinetry, -1.575, .763, -.035, 1.07, .094, .568);
  counter.box(m.cabinetry, .955, .763, -.035, 2.31, .094, .568);
  const sinkX = -.620;
  const sinkZ = .045;
  counter.slab(m.counterStone, 0, .805, 0, 4.226, .083, .616, .014, {
    x: sinkX, z: sinkZ, width: .828, depth: .366,
  });
  sink(counter, m.metal, sinkX, .884, sinkZ, .826, .364);
  counter.cylinder(m.darkMetal, sinkX + .155, .762, sinkZ, .031, .006);
  faucet(counter, m, sinkX, .888, -.203, true);

  const cooktop = model.tone(m.darkMetal, 0x202525);
  cooktop.roughness = .28;
  const burner = model.tone(m.metal, 0x595953);
  counter.box(cooktop, 1.145, .895, .02, .768, .016, .397, .009);
  for (const [x, z, radius] of [[.954, -.077, .087], [1.323, -.09, .075], [.994, .119, .07], [1.315, .092, .081]]) {
    counter.vessel(burner, x, .903, z, radius * 2, radius * 2, [
      [1, 0], [1.0, .001], [.97, .001], [.97, 0],
    ]);
  }

  counter.box(m.stone, 0, 1.197, -.302, 4.23, .618, .033, .007);
  counter.box(m.cabinetry, 0, 1.98, -.174, 4.18, .96, .287, .009);
  for (let i = 0; i < 7; i++) {
    counter.box(m.cabinetry, (i - 3) * .597, 1.989, -.02, .59, .927, .023, .004);
  }
  counter.box(m.metal, 1.147, 1.50, -.109, .787, .043, .292, .006);
  counter.box(m.lamp, -.540, 1.491, .061, 1.47, .007, .014, .002);
  counter.box(m.lamp, 1.07, 1.491, .061, 1.47, .007, .014, .002);
  model.footprint(13.03, 9.23, 4.23, .62);
}

function vanity(piece: FurniturePiece, m: ResidenceMaterials, mirror: MeshStandardMaterial,
  width: number, depth: number): void {
  const bowlWidth = Math.min(.554, width - .09);
  const bowlDepth = Math.min(.295, depth - .12);
  const basinZ = .049;
  const centerY = .862;
  piece.box(m.cabinetry, 0, .520, -.017, width - .02, .316, depth - .041, .018);
  for (const side of [-1, 1]) {
    piece.box(m.cabinetry, side * (width / 2 - .042), .729, -.017, .064, .104, depth - .041, .012);
  }
  piece.box(m.cabinetry, 0, .753, depth / 2 - .039, width - .032, .057, .043, .005);
  cabinetFront(piece, m, 0, .566, depth / 2 - .015, width - .025, .396, true);
  piece.slab(m.counterStone, 0, .779, 0, width - .004, .083, depth - .004, .037, {
    x: 0, z: basinZ, width: bowlWidth, depth: bowlDepth,
  });
  sink(piece, m.ceramic, 0, centerY, basinZ, bowlWidth - .002, bowlDepth - .002);
  piece.cylinder(m.metal, .09, centerY - .124, basinZ, .022, .003);
  faucet(piece, m, 0, centerY, -depth * .24, false);

  const mirrorWidth = Math.min(width - .037, 1.36);
  const mirrorZ = -depth / 2 + .016;
  piece.box(m.metal, 0, 1.459, mirrorZ + .004, mirrorWidth, .867, .030, .014);
  piece.box(mirror, 0, 1.458, mirrorZ + .022, mirrorWidth - .031, .835, .011, .005);
  piece.box(m.lamp, 0, 1.938, mirrorZ + .047, mirrorWidth - .1, .014, .033, .005);
}

function bathtub(piece: FurniturePiece, m: ResidenceMaterials, width: number, depth: number): void {
  piece.vessel(m.ceramic, 0, .012, 0, width, depth, [
    [0, 0], [.65, 0], [.78, .029], [.84, .118], [.94, .44], [.985, .533],
    [1, .561], [.988, .578], [.922, .58], [.886, .564], [.85, .431], [.68, .142],
    [.57, .097], [0, .096],
  ]);
  piece.cylinder(m.metal, 0, .112, .24, .028, .005);
  piece.cylinder(m.metal, width / 2 - .020, .427, -depth * .285, .013, .83);
  piece.cylinder(m.metal, width / 2 - .020, .016, -depth * .285, .032, .03);
  piece.tube(m.metal, [
    [width / 2 - .020, .816, -depth * .285], [width / 2 - .041, .871, -depth * .285],
    [width / 2 - .151, .893, -depth * .285], [width / 2 - .222, .846, -depth * .285],
  ], .012);
}

function toilet(piece: FurniturePiece, m: ResidenceMaterials): void {
  piece.box(m.ceramic, 0, .327, -.187, .399, .655, .193, .057);
  piece.box(m.ceramic, 0, .644, -.183, .407, .028, .199, .013);
  piece.cylinder(m.metal, .058, .660, -.169, .020, .004);
  piece.vessel(m.ceramic, 0, .01, .056, .418, .460, [
    [0, 0], [.68, 0], [.77, .032], [.80, .11], [.67, .191], [.86, .276], [.99, .366],
    [1.0, .391], [.95, .408], [.79, .407], [.76, .375], [.55, .23], [.2, .183], [0, .183],
  ]);
  piece.vessel(m.ceramic, 0, .416, .056, .422, .458, [
    [.79, 0], [.98, 0], [1, .008], [.98, .020], [.75, .021], [.735, .012], [.79, 0],
  ]);
}

function shower(model: FurnitureModel, m: ResidenceMaterials, west: number, south: number,
  width: number, depth: number, wallNorth: number): void {
  const centerE = west + width / 2;
  const centerN = south + depth / 2;
  const shower = model.at(centerE, centerN);
  shower.slab(m.tile, 0, .003, 0, width - .004, .009, depth - .004, .034);
  shower.box(m.metal, 0, .015, -.28, width * .52, .006, .052, .003);
  for (let i = -4; i <= 4; i++) shower.box(m.darkMetal, i * .046, .019, -.28, .025, .002, .026);
  const paneWidth = .34;
  const paneX = -(width - paneWidth) / 2;
  shower.box(m.glass, paneX, 1.04, depth / 2 - .036, paneWidth, 2.04, .012);
  shower.box(m.metal, -width / 2 + .018, 1.04, depth / 2 - .036, .024, 2.048, .021);
  shower.box(m.metal, paneX, .026, depth / 2 - .036, paneWidth, .019, .024);
  const backWall = centerN - wallNorth;
  shower.rod(m.metal, [paneX + .156, 1.983, depth / 2 - .036], [paneX + .156, 1.983, backWall], .009);
  model.footprint(west, south + .03, paneWidth, .020);
  const fixtureZ = backWall + .046;
  for (const height of [1.045, 2.055]) {
    shower.rod(m.metal, [-.18, height, backWall], [-.18, height, fixtureZ], .021, .014);
  }
  shower.cylinder(m.metal, -.18, 1.544, fixtureZ, .013, 1.241);
  shower.tube(m.metal, [
    [-.18, 2.085, fixtureZ], [-.18, 2.226, fixtureZ + .026],
    [-.18, 2.258, fixtureZ + .125], [-.18, 2.254, fixtureZ + .257],
  ], .010);
  shower.cylinder(m.metal, -.18, 2.242, fixtureZ + .257, .103, .019);
  shower.box(m.metal, -.18, .962, fixtureZ + .023, .231, .036, .055, .012);
  shower.tube(m.darkMetal, [
    [-.10, .951, fixtureZ + .026], [-.078, .568, fixtureZ + .031], [.046, .535, fixtureZ + .052],
    [.085, .770, fixtureZ + .056], [.084, 1.467, fixtureZ + .054],
  ], .005);
  shower.rod(m.metal, [.084, 1.467, fixtureZ + .054], [.084, 1.675, fixtureZ + .115], .016, .018);
}

function addBathrooms(model: FurnitureModel, m: ResidenceMaterials): void {
  const mirror = model.tone(m.metal, 0xa6aaa3);
  mirror.metalness = .27;
  mirror.roughness = .14;

  model.room('Shared bath');
  bathtub(model.at(.65, 7.9), m, .86, 1.68);
  vanity(model.at(1.14, 9.4), m, mirror, 1.74, .60);
  toilet(model.at(2.63, 9.58), m);
  model.footprint(.219, 7.06, .862, 1.68);
  model.footprint(.27, 9.1, 1.74, .60);
  model.footprint(2.415, 9.29, .430, .571);

  model.room('Shared shower room');
  shower(model, m, 3.58, 8.85, 1.31, 1.12, 10.13);
  vanity(model.at(5.63, 9.46), m, mirror, .72, .56);
  model.footprint(5.27, 9.18, .72, .56);

  model.room('Primary bath');
  bathtub(model.at(13.515, 14.68), m, .83, 1.30);
  shower(model, m, 13.93, 14.21, .97, 1.10, 15.47);
  vanity(model.at(13.275, 12.814, eastFacing), m, mirror, 1.53, .55);
  model.footprint(13.10, 14.03, .83, 1.30);
  model.footprint(13.00, 12.049, .55, 1.53);

  model.room('Guest WC');
  vanity(model.at(8.45, 10.96, eastFacing), m, mirror, 1.48, .60);
  toilet(model.at(9.50, 11.72), m);
  model.footprint(8.15, 10.22, .60, 1.48);
  model.footprint(9.285, 11.431, .43, .570);
}

function addLaundry(model: FurnitureModel, m: ResidenceMaterials): void {
  model.room('Laundry');
  const centerE = 6.699;
  for (const north of [8.557, 9.224]) {
    const machine = model.at(centerE, north, eastFacing);
    machine.box(m.ceramic, 0, .422, -.017, .642, .821, .603, .020);
    machine.box(m.darkMetal, 0, .722, .292, .536, .068, .013, .004);
    machine.box(m.lamp, -.13, .721, .300, .154, .024, .005, .002);
    machine.rod(m.metal, [.175, .722, .291], [.175, .722, .313], .024);
    machine.vessel(m.darkMetal, 0, .378, .292, .356, .356, [
      [0, 0], [1, 0], [1, .011], [.85, .015], [.48, .020], [0, .021],
    ], Math.PI / 2);
    machine.vessel(m.metal, 0, .378, .289, .411, .411, [
      [.84, -.001], [1, 0], [1, .016], [.97, .028], [.85, .032], [.79, .025], [.84, -.001],
    ], Math.PI / 2);
    model.footprint(centerE - .32, north - .323, .641, .646);
  }
  const fittings = model.at(centerE, 9.51, eastFacing);
  fittings.slab(m.counterStone, 0, .848, 0, 2.534, .042, .642, .035);
  fittings.box(m.cabinetry, .936, 1.612, -.032, .657, 1.44, .568, .015);
  cabinetFront(fittings, m, .936, 1.612, .256, .638, 1.415, false);
  fittings.box(m.cabinetry, .935, .439, -.018, .657, .812, .590, .018);
  fittings.box(m.cabinetry, -.92, 1.67, -.138, .685, .69, .343, .01);
  model.footprint(6.378, 9.564, .644, 1.215);
}

function addEntryStorage(model: FurnitureModel, m: ResidenceMaterials): void {
  model.room('Entry storage');
  const coats = model.at(8.471, 13.785, eastFacing);
  coats.box(m.darkMetal, 0, .045, -.024, 2.55, .088, .454);
  coats.box(m.cabinetry, 0, 1.228, -.024, 2.70, 2.266, .501, .018);
  for (const x of [-1.014, -.338, .338, 1.014]) {
    cabinetFront(coats, m, x, 1.237, .249, .676, 2.225, false);
  }
  model.footprint(8.197, 12.433, .585, 2.704);
  const bench = model.at(12.18, 14.84);
  bench.box(m.cabinetry, 0, .302, 0, .473, .250, .604, .046);
  bench.box(m.fabric, 0, .458, -.015, .474, .105, .569, .048);
  for (const z of [-.221, .221]) bench.box(m.darkMetal, 0, .092, z, .381, .173, .039, .01);
  model.footprint(11.94, 14.53, .51, .62);

  model.room('Utility storage');
  const shelving = model.at(8.415, 8.526, eastFacing);
  shelving.box(m.cabinetry, 0, 1.21, -.246, 1.867, 2.390, .049);
  for (const x of [-.912, 0, .912]) shelving.box(m.cabinetry, x, 1.207, 0, .043, 2.396, .537, .006);
  for (const y of [.10, .59, 1.07, 1.51, 1.94, 2.39]) {
    shelving.box(m.cabinetry, 0, y, 0, 1.86, .035, .54, .005);
  }
  for (const y of [.12, 1.087]) {
    shelving.box(m.fabric, -.464, y + .112, 0, .492, .209, .412, .031);
    shelving.box(m.darkMetal, -.464, y + .149, .204, .087, .014, .010, .004);
    shelving.box(m.bedding, .43, y + .081, -.010, .482, .056, .371, .017);
    shelving.box(m.bedding, .48, y + .038, .013, .506, .052, .377, .016);
  }
  model.footprint(8.145, 7.59, .54, 1.87);
}

export function addServiceFurniture(model: FurnitureModel, materials: ResidenceMaterials): void {
  addKitchen(model, materials);
  addBathrooms(model, materials);
  addLaundry(model, materials);
  addEntryStorage(model, materials);
}
