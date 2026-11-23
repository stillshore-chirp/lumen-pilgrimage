import { CanvasTexture, SRGBColorSpace, type MeshStandardMaterial } from 'three';
import { coastRandom } from '../../terrain';
import type { FurnitureModel, FurniturePiece } from './residenceFurnitureModel';
import type { ResidenceMaterials } from './residenceMaterials';
import { RESIDENCE_STUDY_RUG } from './residencePlan';

const spineTitles = ['水辺の地図', '街並みの輪郭', '木の継ぎ手', '庭と石',
  'City Margins', 'Notes on Light', 'Tidal Atlas', 'Paper and Timber'];

function spinePrint(model: FurnitureModel): MeshStandardMaterial | null {
  if (typeof document === 'undefined') return null;
  const atlas = document.createElement('canvas');
  atlas.width = 256;
  atlas.height = 512;
  const paper = atlas.getContext('2d');
  if (!paper) return null;
  paper.textBaseline = 'middle';
  paper.fillStyle = '#ffffff';
  for (const [i, title] of spineTitles.entries()) {
    const x = i % 4 * 64;
    const y = Math.floor(i / 4) * 256;
    if (i < 4) {
      paper.font = '21px "Hiragino Mincho ProN", serif';
      paper.textAlign = 'center';
      for (const [letter, glyph] of [...title].entries()) paper.fillText(glyph, x + 32, y + 49 + letter * 26);
    } else {
      paper.save();
      paper.translate(x + 32, y + 37);
      paper.rotate(Math.PI / 2);
      paper.font = 'bold 21px Georgia, serif';
      paper.textAlign = 'left';
      paper.fillText(title, 0, 0, 177);
      paper.restore();
    }
    paper.fillRect(x + 17, y + 221, 30, 2);
  }
  const texture = new CanvasTexture(atlas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return model.printed(texture);
}

function uprightBook(piece: FurniturePiece, cover: MeshStandardMaterial, pages: MeshStandardMaterial,
  title: MeshStandardMaterial, x: number, floor: number, front: number, width: number, h: number, depth: number,
  bands: boolean) {
  const height = floor + h / 2;
  const center = front - depth / 2;
  piece.box(pages, x, height, center - .004, width - .007, h - .011, depth - .012);
  for (const edge of [-1, 1]) {
    piece.box(cover, x + edge * (width / 2 - .002), height, center, .0038, h, depth);
  }
  piece.box(cover, x, height, front - .003, width, h, .008, .003);
  piece.box(title, x, floor + h * .18, front + .0013, width * .66, .004, .0012);
  if (bands) {
    for (const y of [.13, .24, .88]) piece.box(title, x, floor + h * y, front + .0013, width * .83, .0012, .001);
  }
}

function horizontalBook(piece: FurniturePiece, cover: MeshStandardMaterial, pages: MeshStandardMaterial,
  x: number, base: number, z: number, width: number, depth: number, h: number) {
  piece.box(pages, x + .002, base + h / 2, z, width - .011, h - .007, depth - .009, .001);
  for (const y of [base + .0015, base + h - .0015]) piece.box(cover, x, y, z, width, .003, depth, .0015);
  piece.box(cover, x - width / 2 + .003, base + h / 2, z, .007, h - .003, depth, .002);
}

function bookshelf(model: FurnitureModel, m: ResidenceMaterials, timber: MeshStandardMaterial) {
  const builtIn = model.at(10.752, 3.275, -Math.PI / 2);
  const back = model.tone(m.cabinetry, 0xa99786);
  const cloth = [0xc7baa1, 0x766353, 0x657461, 0xa7795d, 0x525d61, 0x958f7d, 0x6e514c, 0x777579]
    .map(color => model.tone(m.fabric, color));
  const pages = model.tone(m.washi, 0xe3d7bb);
  const letters = model.tone(m.washi, 0xcbb894);
  const lining = model.tone(m.felt, 0x92908a);
  const titles = spinePrint(model);
  const brass = model.tone(m.metal, 0xa89c80);
  const jar = model.tone(m.ceramic, 0x989180);
  const edges = [-1.370, -.634, .044, .730, 1.366];
  const shelves = [.437, .886, 1.263, 1.622, 1.995, 2.439];
  builtIn.box(m.darkMetal, 0, .037, -.033, 2.709, .071, .279, .008);
  builtIn.box(back, 0, 1.251, -.151, 2.763, 2.366, .038, .004, 0, true);
  builtIn.box(timber, 0, 2.474, 0, 2.789, .067, .350, .005);
  for (const x of edges) builtIn.box(timber, x, 1.260, -.006, .034, 2.404, .340, .004, 0, true);
  for (const [bay, right] of edges.slice(1).entries()) {
    const left = edges[bay];
    const width = right - left - .030;
    const center = (left + right) / 2;
    builtIn.box(timber, center, .247, .139, width - .009, .324, .047, .004);
    builtIn.box(m.darkMetal, center, .362, .169, .096, .011, .026, .003);
    for (const y of shelves) {
      builtIn.box(timber, center, y, -.001, width, .029, .336, .004);
      builtIn.box(timber, center, y + .003, .170, width, .019, .021, .002);
    }
    if (bay === 2) {
      builtIn.box(lining, center, 2.412, .109, width - .036, .013, .068, .002);
      builtIn.box(m.lamp, center, 2.404, .105, width - .083, .005, .016, .001);
    }
  }

  const random = coastRandom(22581);
  for (const [bay, right] of edges.slice(1).entries()) {
    const left = edges[bay];
    for (const [tier, bottom] of shelves.slice(0, -1).entries()) {
      const base = bottom + .0145;
      if ((bay === 2 && tier === 3) || (bay === 0 && tier === 4) || (bay === 3 && tier === 0)) {
        horizontalBook(builtIn, cloth[(bay + 1) % cloth.length], pages, left + .199, base, .002, .262, .198, .034);
        horizontalBook(builtIn, cloth[tier], pages, left + .218, base + .035, .018, .212, .159, .024);
        horizontalBook(builtIn, cloth[tier + 3], pages, left + .214, base + .060, .024, .188, .145, .022);
        builtIn.vessel(jar, right - .156, base, -.021, .126, .127, [
          [0, 0], [.77, 0], [.94, .014], [1, .061], [.91, .105], [.73, .121],
          [.66, .138], [.59, .139], [.57, .132], [.73, .102], [.83, .032], [0, .021],
        ]);
        continue;
      }
      const inner = right - (.082 + random() * .124);
      let x = left + .058 + random() * .028;
      const hMax = shelves[tier + 1] - bottom - .052;
      let book = 0;
      while (x < inner) {
        const width = .025 + random() * .037;
        const height = Math.min(hMax, .168 + random() * .186);
        const color = cloth[Math.floor(random() * cloth.length)];
        const depth = .142 + random() * .095;
        const front = .127 - random() * .043;
        const centerX = x + width / 2;
        uprightBook(builtIn, color, pages, letters, centerX, base, front, width, height, depth, random() > .55);
        if (titles && width > .033 && (book + tier + bay * 2) % 3 === 0) {
          const index = (book + tier * 3 + bay) % spineTitles.length;
          const left = index % 4 / 4;
          const bottom = index < 4 ? .5 : 0;
          builtIn.print(titles, centerX, base + height / 2, front + .0021, width * .83, height * .82,
            [left, bottom, left + .25, bottom + .50]);
        }
        x += width + .005 + random() * .005;
        book++;
      }
      builtIn.box(brass, x + .008, base + .054, .054, .009, .101, .125, .002);
      builtIn.box(brass, x + .050, base + .004, .054, .089, .008, .125, .002);
    }
  }
  model.footprint(10.577, 1.88, .351, 2.79);
}

function readingLamp(piece: FurniturePiece, m: ResidenceMaterials): void {
  piece.vessel(m.darkMetal, 0, .007, 0, .233, .233, [
    [0, 0], [.96, 0], [1, .006], [.97, .020], [.84, .028], [.19, .035], [0, .035],
  ]);
  piece.rod(m.darkMetal, [0, .033, 0], [0, 1.247, 0], .010);
  piece.tube(m.brushedSteel, [[0, 1.238, 0], [0, 1.317, -.017], [0, 1.349, -.116],
    [0, 1.330, -.209]], .008);
  piece.vessel(m.darkMetal, 0, 1.264, -.214, .207, .177, [
    [.91, 0], [.98, .002], [1, .012], [.82, .054], [.48, .089], [.28, .095],
    [.23, .087], [.46, .079], [.75, .047], [.90, .012], [.91, 0],
  ]);
  piece.cylinder(m.lamp, 0, 1.273, -.214, .085, .006);
}

function desk(model: FurnitureModel, m: ResidenceMaterials, timber: MeshStandardMaterial): void {
  const piece = model.at(8.040, 2.385, Math.PI / 2);
  const pad = model.tone(m.felt, 0x686964);
  const leather = model.tone(m.fabric, 0x7a6857);
  const paper = model.tone(m.washi, 0xeee5d1);
  const lead = model.tone(m.ceiling, 0x77746d);
  piece.slab(timber, 0, .723, 0, 1.81, .037, .64, .059);
  piece.slab(m.cabinetry, 0, .695, 0, 1.724, .032, .586, .047);
  for (const x of [-.755, .755]) {
    for (const z of [-.217, .221]) {
      piece.rod(timber, [x * 1.04, .010, z * 1.08], [x, .712, z], .019, .028);
    }
    piece.box(timber, x, .543, 0, .044, .047, .450, .005);
  }
  piece.box(timber, .448, .645, -.004, .571, .091, .495, .013);
  piece.box(m.darkMetal, .445, .657, .246, .144, .011, .006, .002);
  piece.slab(pad, -.107, .760, .081, .683, .007, .382, .028);
  piece.slab(leather, -.112, .767, .064, .376, .009, .253, .018);
  const notebook = (u: number, v: number): readonly [number, number, number] => {
    const bend = .010 * Math.exp(-((u - .5) ** 2) / .004) - .007 * Math.sin(Math.PI * u) ** 2;
    return [-.112 + (u - .5) * .363, .784 + bend + .002 * Math.sin(v * 7.4), .066 + (v - .5) * .239];
  };
  piece.surface(paper, .363, .239, 30, 9, notebook);
  for (const u of [.19, .68]) for (const v of [.25, .34, .44, .53, .62, .71, .80]) {
    const [x, y, z] = notebook(u, v);
    const length = .073 + .023 * Math.sin(10.3 * v + u * 7.9);
    piece.rod(lead, [x - .030, y + .001, z], [x + length - .030, y + .0009, z - .001], .00042);
  }
  piece.rod(m.darkMetal, [.160, .782, .146], [.219, .784, .059], .0037);
  piece.rod(m.cedar, [.219, .784, .059], [.224, .784, .051], .0037, .0008);

  piece.cylinder(m.darkMetal, -.620, .771, -.116, .083, .025);
  const pivots = [[-.620, .782, -.116], [-.638, .950, -.172], [-.522, 1.173, -.161], [-.360, 1.119, -.035]] as const;
  for (let i = 1; i < pivots.length; i++) piece.rod(m.brushedSteel, pivots[i - 1], pivots[i], .007);
  for (const [x, y, z] of pivots.slice(1, -1)) {
    piece.rod(m.darkMetal, [x, y, z - .017], [x, y, z + .017], .015);
  }
  piece.vessel(m.darkMetal, -.360, 1.081, -.035, .182, .167, [
    [.93, 0], [1, .008], [.87, .041], [.51, .078], [.28, .079],
    [.24, .073], [.47, .069], [.80, .035], [.89, .010], [.93, 0],
  ]);
  piece.cylinder(m.lamp, -.360, 1.092, -.035, .076, .007);
  horizontalBook(piece, leather, paper, .547, .760, -.059, .254, .202, .031);
  horizontalBook(piece, pad, paper, .560, .792, -.076, .213, .157, .023);
  model.footprint(7.72, 1.48, .640, 1.810);
}

export function addStudy(model: FurnitureModel, m: ResidenceMaterials): void {
  model.room('Study 05');
  const timber = model.tone(m.cabinetry, 0xc3ae99);
  const [west, south, east, north] = RESIDENCE_STUDY_RUG;
  const rug = model.at((west + east) / 2, (south + north) / 2);
  const wool = model.tone(m.rug, 0xa9a69a);
  const binding = model.tone(m.rug, 0x777a6e);
  rug.slab(binding, 0, .0005, 0, east - west, .012, north - south, .042);
  rug.slab(wool, 0, .0115, 0, east - west - .029, .006, north - south - .029, .032);
  bookshelf(model, m, timber);
  desk(model, m, timber);
  readingLamp(model.at(10.140, 1.297, .86), m);
  model.footprint(10.08, 1.18, .23, .23);
  const table = model.at(10.163, .737);
  table.slab(timber, 0, .434, 0, .417, .028, .401, .194);
  for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    table.rod(timber, [x * .168, .009, z * .168], [x * .119, .439, z * .119], .014, .019);
  }
  const clay = model.tone(m.ceramic, 0x937563);
  table.vessel(clay, -.053, .463, -.053, .088, .088, [
    [0, 0], [.77, 0], [.91, .010], [.93, .064], [1, .082], [.98, .088],
    [.89, .089], [.86, .081], [.74, .018], [0, .015],
  ]);
  table.tube(clay, [[-.015, .529, -.053], [.011, .529, -.053], [.016, .502, -.053],
    [-.014, .489, -.053]], .005);
  horizontalBook(table, model.tone(m.fabric, 0x6b7371), m.washi, .064, .462, .055, .179, .121, .020);
  model.footprint(9.949, .531, .425, .407);
}
