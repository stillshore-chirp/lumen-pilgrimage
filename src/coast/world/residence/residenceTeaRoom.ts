import type { MeshStandardMaterial } from 'three';
import type { FurnitureModel, FurniturePiece } from './residenceFurnitureModel';
import type { ResidenceMaterials } from './residenceMaterials';
import { fixtureFinish } from './residenceFixtureFinish';
import { addTeaRoomShoji } from './residenceShoji';
import { RESIDENCE_TEA_HEARTH, RESIDENCE_TEA_MATS, RESIDENCE_TEA_TATAMI } from './residencePlan';

function tatami(model: FurnitureModel, m: ResidenceMaterials) {
  const edging = model.tone(m.fabric, 0x575046);
  const variation = [0xfaf5e5, 0xf2ede3, 0xf5f2ea, 0xf3eeda, 0xfaf4e0];
  for (const [index, [west, south, east, north]] of RESIDENCE_TEA_MATS.entries()) {
    const centerE = (west + east) / 2;
    const centerN = (south + north) / 2;
    const turned = north - south > east - west + .01;
    const width = turned ? north - south : east - west;
    const depth = turned ? east - west : north - south;
    const leaf = model.at(centerE, centerN, turned ? Math.PI / 2 : 0);
    const [rw, rs, re, rn] = RESIDENCE_TEA_HEARTH;
    const hole = index === 4 ? {
      x: (rw + re) / 2 - centerE, z: centerN - (rs + rn) / 2,
      width: re - rw, depth: rn - rs, radius: .004,
    } : undefined;
    leaf.slab(model.tone(m.tatami, variation[index]), 0, -.035, 0, width - .006,
      .035, depth - .006, .003, hole);
    for (const side of [-1, 1]) {
      leaf.box(edging, 0, .0002, side * (depth / 2 - .015), width - .005, .0014, .026, .0005);
    }
  }
  const [west, south, east, north] = RESIDENCE_TEA_TATAMI;
  const rim = model.at((west + east) / 2, (south + north) / 2);
  for (const sign of [-1, 1]) {
    rim.box(m.cedar, 0, -.004, sign * ((north - south) / 2 + .014), east - west + .058, .009, .030);
    rim.box(m.cedar, sign * ((east - west) / 2 + .014), -.004, 0, .030, .009, north - south, 0, 0, true);
  }
}

function hearth(model: FurnitureModel, m: ResidenceMaterials) {
  const [west, south, east, north] = RESIDENCE_TEA_HEARTH;
  const ro = model.at((west + east) / 2, (south + north) / 2);
  const castIron = model.tone(m.darkMetal, 0x49453d);
  castIron.roughness = .73;
  castIron.metalness = .52;
  const hearthClay = model.tone(m.core, 0x6a5a47);
  const ash = model.tone(m.core, 0x807c72);
  ro.slab(m.cabinetry, 0, -.016, 0, .459, .017, .459, .004,
    { x: 0, z: 0, width: .375, depth: .375, radius: .003 });
  ro.box(ash, 0, -.139, 0, .371, .015, .371, .004);
  for (const side of [-1, 1]) {
    ro.box(hearthClay, side * .193, -.079, 0, .020, .131, .399, .003);
    ro.box(hearthClay, 0, -.079, side * .193, .378, .131, .020, .003);
  }
  for (let i = 0; i < 10; i++) {
    const angle = 2.39996 * i;
    const radius = .11 + i % 4 * .013;
    ro.oval(castIron, Math.cos(angle) * radius, -.123 + i % 3 * .007,
      Math.sin(angle) * radius, .043 + .010 * (i % 2), .039, .035);
  }
  for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    ro.rod(castIron, [.126 * x, -.126, .126 * z], [.111 * x, -.021, .111 * z], .0062);
  }
  ro.vessel(castIron, 0, -.024, 0, .288, .288, [
    [0, 0], [.67, .003], [.74, .011], [.88, .033], [.98, .070], [1, .092],
    [.985, .121], [.89, .151], [.70, .170], [.65, .177], [.64, .185],
    [.58, .185], [.58, .173], [.54, .171], [0, .171],
  ]);
  ro.vessel(castIron, 0, .154, 0, .175, .175, [
    [0, 0], [.95, 0], [1, .006], [.98, .014], [.76, .023], [.44, .027], [0, .028],
  ]);
  ro.vessel(m.brushedSteel, 0, .180, 0, .036, .036, [
    [0, 0], [.52, .001], [.53, .008], [1, .011], [.88, .019], [0, .022],
  ]);
  for (const side of [-1, 1]) {
    ro.tube(castIron, [[side * .126, .101, 0], [side * .153, .120, 0],
      [side * .164, .079, 0], [side * .143, .070, 0], [side * .131, .091, 0]], .0052, true);
  }
}

function artwork(piece: FurniturePiece, m: ResidenceMaterials, silk: MeshStandardMaterial,
  ink: MeshStandardMaterial, wash: MeshStandardMaterial, seal: MeshStandardMaterial) {
  piece.box(silk, 0, 1.339, .008, .386, .814, .008, .002);
  piece.box(m.washi, -.007, 1.365, .014, .324, .556, .006, .001);
  for (const y of [.928, 1.753]) piece.rod(m.cedar, [-.213, y, .011], [.213, y, .011], .010, .009);
  piece.tube(m.darkMetal, [[-.107, 1.756, .003], [0, 1.864, .002], [.107, 1.756, .003]], .00165);
  const ridge = (u: number) => (Math.sin(u * 8.8 + .25) * .053 + Math.sin(u * 18.1 + 1.93) * .021
    + Math.sin(u * 40.1 + .63) * .0098) * Math.sin(Math.PI * u) ** .58;
  piece.surface(wash, .297, .172, 49, 3, (u, v) => {
    const top = 1.451 + ridge(1 - u) * .69 + Math.sin(u * 3.6) * .015;
    const pooled = Math.max(.011, top - 1.392) * Math.sin(u * Math.PI) ** .43;
    return [(u - .5) * .285, top - v * pooled, .0188];
  });
  piece.surface(ink, .288, .172, 55, 3, (u, v) => {
    const top = 1.328 + ridge(u) * .67 + .061 * Math.sin(Math.PI * u) * (1 - u * .32);
    const pooled = Math.max(.012, top - 1.298) * Math.sin(u * Math.PI) ** .55;
    return [(u - .5) * .277 - .006, top - v * pooled, .0192];
  });
  piece.box(seal, .103, 1.162, .0195, .022, .024, .002, .0005);
  piece.box(m.washi, .103, 1.162, .0206, .013, .002, .001);
  piece.box(m.washi, .101, 1.162, .0206, .002, .015, .001);
}

function alcove(model: FurnitureModel, m: ResidenceMaterials, plaster: MeshStandardMaterial) {
  const recess = model.at(4.70, 4.625);
  recess.slab(m.cedar, 0, .003, 0, 1.540, .102, .610, .010);
  recess.box(m.cabinetry, 0, .102, .285, 1.538, .030, .034, .005);
  recess.box(plaster, 0, 1.173, -.290, 1.528, 2.154, .026, .004);
  recess.box(plaster, -.756, 1.176, -.067, .024, 2.142, .439, .003);
  recess.box(m.cedar, 0, 2.205, -.027, 1.548, .112, .570, .012);
  recess.box(fixtureFinish(model, m.lamp, '04-alcove'), 0, 2.150, -.166, 1.132, .006, .024, .002);
  recess.rod(m.cedar, [.735, .110, .240], [.753, 2.166, .242], .044, .038);
  const silk = model.tone(m.bedding, 0xaaa28a);
  const ink = model.tone(m.ceiling, 0x4b5452);
  const wash = model.tone(m.ceiling, 0x9da097);
  const seal = model.tone(m.ceiling, 0x944332);
  artwork(model.at(4.591, 4.866), m, silk, ink, wash, seal);

  const vase = model.at(5.109, 4.476);
  const glaze = model.tone(m.ceramic, 0x555c4a);
  vase.vessel(glaze, 0, .105, 0, .134, .115, [
    [0, 0], [.70, 0], [.83, .009], [1, .061], [.83, .127], [.47, .173], [.42, .211],
    [.45, .246], [.40, .249], [.33, .245], [.30, .210], [.16, .099], [0, .079],
  ]);
  const branch = model.tone(m.cedar, 0x796b50);
  vase.tube(branch, [[0, .308, 0], [.027, .376, -.019], [.071, .458, -.010],
    [.112, .506, .003], [.181, .533, .032]], .0036);
  vase.rod(branch, [.069, .447, -.013], [.033, .527, -.006], .0025, .0015);
  const flower = model.tone(m.ceramic, 0xe8d8b9);
  for (const [x, y, z, size] of [[.174, .534, .021, .034], [.032, .526, -.001, .024], [.105, .499, .018, .022]]) {
    for (let petal = 0; petal < 5; petal++) {
      const angle = petal * Math.PI * 2 / 5;
      vase.oval(flower, x + Math.cos(angle) * size * .26, y + Math.sin(angle) * size * .26,
        z, size * .48, size * .45, size * .31, -.3);
    }
  }
  model.footprint(3.93, 4.32, 1.54, .61);
}

function teaUtensils(piece: FurniturePiece, m: ResidenceMaterials, bowl: MeshStandardMaterial) {
  piece.slab(m.cedar, 0, .005, 0, .382, .016, .238, .040);
  piece.vessel(bowl, -.092, .021, .019, .128, .121, [
    [0, 0], [.52, 0], [.64, .006], [.70, .022], [.93, .049], [1, .059], [1, .064],
    [.93, .064], [.87, .051], [.60, .023], [.43, .013], [0, .012],
  ]);
  piece.vessel(m.ceramic, .096, .021, -.019, .101, .101, [
    [0, 0], [.70, 0], [.91, .013], [1, .076], [.92, .088], [.72, .095], [0, .095],
  ]);
  piece.vessel(m.cabinetry, .096, .114, -.019, .083, .083, [
    [0, 0], [1, 0], [.96, .006], [.30, .011], [.13, .024], [0, .026],
  ]);
  piece.rod(m.cedar, [-.100, .026, .089], [.053, .032, .063], .0035, .0022);
}

export function addTeaRoom(model: FurnitureModel, m: ResidenceMaterials) {
  model.room('Tea room 04');
  const plaster = model.tone(m.wall, 0xd0bba0);
  const ceiling = model.tone(m.ceiling, 0xe3d4bc);
  const clay = model.at(5.47, 2.80);
  clay.box(plaster, -1.737, 1.411, .266, .026, 2.679, 4.77);
  clay.box(plaster, 1.737, 1.411, .624, .023, 2.679, 4.074);
  clay.box(plaster, -.582, 1.420, -2.124, 2.286, 2.72, .018);
  clay.box(ceiling, -.036, 2.494, .727, 3.025, .030, 3.034);
  for (const x of [-1.526, 1.456]) clay.box(m.cedar, x, 2.466, .727, .056, .046, 3.087, .004, 0, true);
  for (const z of [-.785, .727, 2.248]) clay.box(m.cedar, -.036, 2.459, z, 3.037, .063, .052, .004);

  tatami(model, m);
  hearth(model, m);
  alcove(model, m, plaster);
  const shoji = addTeaRoomShoji(model, m);

  const storage = model.at(3.859, 2.56, Math.PI / 2);
  storage.box(m.cedar, 0, .261, -.006, 1.563, .480, .255, .011);
  storage.slab(m.cedar, 0, .502, 0, 1.584, .022, .268, .018);
  for (const x of [-.387, .387]) {
    storage.box(m.cedar, x, .268, .126, .758, .432, .022, .004);
    storage.box(m.cabinetry, x - .244, .322, .139, .044, .064, .008, .002);
  }
  model.footprint(3.725, 1.77, .268, 1.58);

  const bowl = model.tone(m.ceramic, 0xa48c74);
  bowl.roughness = .57;
  teaUtensils(model.at(4.561, 2.515, Math.PI / 2), m, bowl);
  const cushion = model.tone(m.fabric, 0x7e7560);
  for (const [east, north, heading] of [[6.355, 1.790, -.09], [5.629, 3.002, .11]]) {
    model.at(east, north, heading).upholstered(cushion, 0, .031, 0,
      { width: .449, height: .051, depth: .433, radius: .023, crown: [.003, .007, .004], gathers: .004 },
      { welt: cushion });
  }
  const lantern = model.at(6.672, 3.414);
  lantern.box(m.cabinetry, 0, .032, 0, .216, .038, .216, .007);
  lantern.box(m.linenShade, 0, .275, 0, .171, .392, .171, .007);
  lantern.box(m.cabinetry, 0, .478, 0, .208, .026, .208, .004);
  for (const x of [-.090, .090]) for (const z of [-.090, .090]) {
    lantern.box(m.cabinetry, x, .270, z, .012, .442, .012, .002, 0, true);
  }
  const threshold = model.at(6.490, 4.930);
  threshold.box(m.cedar, 0, -.006, 0, .929, .013, .058, .002);
  return shoji;
}
