import {
  CanvasTexture, ClampToEdgeWrapping, LatheGeometry, Mesh, MeshPhysicalMaterial, MeshStandardMaterial,
  PlaneGeometry, SRGBColorSpace, Vector2, type Group,
} from 'three';
import { beginLakeHallAssembly, type LakeHallAssembly } from './lakeHallGeometry';
import type { HallMaterials } from './lakeHallMaterials';
import { LAKE_HALL } from './lakeLayout';

const { halfWidth, frontZ, rearZ, ceilingY } = LAKE_HALL;
const sillY = .32;
const headY = 3.77;
const transomY = 5.11;
const postWidth = .24;

type WallSide = 'rear' | 'west' | 'east';
type WallStock = ReturnType<typeof createWallStock>;

function createWallStock(hall: Group, materials: HallMaterials) {
  return {
    plaster: beginLakeHallAssembly(hall, 'Lime plaster infill and recessed backs', materials.plaster, true),
    posts: beginLakeHallAssembly(hall, 'Exposed posts, lintels and rebates', materials.timber, true),
    panel: beginLakeHallAssembly(hall, 'Framed timber plinth and cabinet panels', materials.panel),
    joinery: beginLakeHallAssembly(hall, 'Oiled joinery and grille', materials.joinery),
    paper: beginLakeHallAssembly(hall, 'Off-white paper behind shoji lattice', materials.paper),
    lamp: beginLakeHallAssembly(hall, 'Recessed paper light diffusers', materials.lamp),
    relief: beginLakeHallAssembly(hall, 'Stone-backed display recess', materials.foundation),
  };
}

// A positive depth always points into the hall. Solid backing lies outside the walk limit.
function place(
  stock: LakeHallAssembly, side: WallSide, along: number, y: number, depth: number,
  width: number, height: number, thickness: number, vertical = false, tone = 1,
): void {
  const offset = .23 * along + .59 * y;
  if (side === 'rear') {
    stock.box([along, y, rearZ - depth], [width, height, thickness], vertical ? 1 : 0, tone, offset);
    return;
  }
  const x = side === 'west' ? -halfWidth + depth : halfWidth - depth;
  stock.box([x, y, along], [thickness, height, width], vertical ? 1 : 2, tone, offset);
}

function layWallStructure(parts: WallStock, side: WallSide, start: number, end: number, count: number): void {
  const span = end - start;
  const mid = (start + end) / 2;
  const spacing = span / count;
  place(parts.plaster, side, mid, ceilingY / 2, -.463, span + .84, ceilingY, .144, true, .75);
  place(parts.plaster, side, mid, (transomY + ceilingY) / 2, -.105,
    span, ceilingY - transomY, .224, false, .80);
  place(parts.panel, side, mid, sillY / 2, -.068, span, sillY, .139, false, .76);
  place(parts.posts, side, mid, .075, .044, span, .15, .096, false, .79);
  place(parts.joinery, side, mid, sillY, .030, span, .081, .118, false, .82);
  place(parts.posts, side, mid, headY, .041, span, .169, .156, false, .94);
  place(parts.joinery, side, mid, headY - .114, .067, span, .031, .112, false, .83);
  place(parts.posts, side, mid, transomY, .025, span, .152, .151, false, .79);
  place(parts.posts, side, mid, ceilingY - .127, .071, span, .255, .242, false, .86);
  for (let index = 0; index <= count; index += 1) {
    const along = start + index * spacing;
    const tone = .83 + ((index * 3) % 7) / 28;
    place(parts.posts, side, along, ceilingY / 2, -.094, postWidth, ceilingY, .351, true, tone);
    place(parts.joinery, side, along, ceilingY / 2, .083, postWidth - .036, ceilingY, .033, true, tone);
    place(parts.posts, side, along, .162, .041, postWidth + .019, .105, .104, false, tone * .75);
  }
}

function layShoji(
  parts: WallStock, side: WallSide, along: number, width: number, low: number, high: number, illuminated: boolean,
): void {
  const y = (low + high) / 2;
  const height = high - low;
  const rim = .067;
  if (illuminated) {
    place(parts.lamp, side, along, y, -.216, width, height, .021, true, .89);
  } else {
    place(parts.paper, side, along, y, -.211, width, height, .023, true, .97);
  }
  for (const edge of [-1, 1]) {
    place(parts.posts, side, along + edge * width / 2, y, -.036, .085, height + .069, .367, true, .91);
    place(parts.joinery, side, along, y + edge * height / 2, -.035, width, rim, .338, false, .97);
  }
  const leaves = Math.round(width / 1.08);
  const leafWidth = width / leaves;
  for (let index = 0; index <= leaves; index += 1) {
    const stile = along - width / 2 + index * leafWidth;
    place(parts.joinery, side, stile, y, -.146, .035, height, .108, true, .98);
    if (index === leaves) continue;
    for (let batten = 1; batten < 4; batten += 1) {
      place(parts.joinery, side, stile + batten * leafWidth / 4, y, -.165, .019, height - rim, .062, true, .98);
    }
  }
  const divisions = Math.round(height / .32);
  for (let index = 1; index < divisions; index += 1) {
    const railY = low + index * height / divisions;
    place(parts.joinery, side, along, railY, -.166,
      width - .053, index % 4 === 0 ? .038 : .021, .061, false, .96);
  }
}

function layWoodBay(parts: WallStock, side: WallSide, along: number, width: number): void {
  const height = headY - sillY;
  const centre = (sillY + headY) / 2;
  place(parts.panel, side, along, centre, -.168, width, height, .042, true, .77);
  const boards = Math.round(width / .28);
  const gap = width / boards;
  for (let index = 0; index <= boards; index += 1) {
    place(parts.joinery, side, along - width / 2 + index * gap, centre, -.126,
      .021, height, .054, true, .82 + ((index * 3) % 9) * .025);
  }
  place(parts.joinery, side, along, .88, -.086, width, .043, .085, false, .82);
  place(parts.joinery, side, along, 2.91, -.086, width, .051, .085, false, .86);
}

function layPlasterBay(parts: WallStock, side: WallSide, along: number, width: number): void {
  place(parts.plaster, side, along, (headY + sillY) / 2, -.151, width + .025, headY - sillY, .085, true, 1.02);
  place(parts.panel, side, along, .60, -.084, width + .015, .56, .084, true, .78);
  place(parts.joinery, side, along, .901, -.011, width + .026, .055, .103, false, .87);
}

function layTransom(parts: WallStock, side: WallSide, along: number, width: number): void {
  const height = transomY - headY - .18;
  const y = (transomY + headY) / 2;
  place(parts.plaster, side, along, y, -.22, width, height + .12, .06, false, .75);
  const slats = Math.round(width / .125);
  for (let index = 1; index < slats; index += 1) {
    const x = along + width * (index / slats - .5);
    place(parts.joinery, side, x, y, -.109, .025, height, .086, true, .88 + (index % 5) * .018);
  }
  place(parts.posts, side, along, y - height * .39, -.055, width, .035, .109, false, .85);
  place(parts.posts, side, along, y + height * .39, -.055, width, .035, .109, false, .83);
}

function washDrawing(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 896;
  const paint = canvas.getContext('2d')!;
  paint.fillStyle = '#433a2d';
  paint.fillRect(0, 0, 512, 896);
  paint.fillStyle = '#685846';
  paint.fillRect(11, 17, 490, 862);
  paint.fillStyle = '#b7a685';
  paint.fillRect(42, 51, 428, 796);
  paint.fillStyle = '#c6b798';
  paint.fillRect(58, 151, 396, 590);
  let state = 14193;
  const sample = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let point = 0; point < 6200; point += 1) {
    paint.fillStyle = sample() > .5 ? '#e4d7b4' : '#766451';
    paint.globalAlpha = sample() * .19;
    paint.fillRect(42 + sample() * 428, 53 + sample() * 791, .4 + sample() * 2.5, sample() + .5);
  }
  paint.save();
  paint.beginPath();
  paint.rect(58, 151, 396, 590);
  paint.clip();
  for (let bank = 0; bank < 3; bank += 1) {
    const x0 = 35 + bank * 118;
    const y0 = 472 + bank * 95;
    const pigment = paint.createLinearGradient(0, y0 - 180, 0, y0 + 28);
    pigment.addColorStop(0, ['#69716c', '#525d53', '#45483b'][bank]);
    pigment.addColorStop(1, '#ac9e81');
    paint.globalAlpha = .54 + bank * .11;
    paint.fillStyle = pigment;
    paint.beginPath();
    paint.moveTo(x0, y0 + 36);
    for (let step = 0; step <= 50; step += 1) {
      const x = step / 50;
      const ridge = Math.sin(x * Math.PI) ** 1.2 * (.63 + .21 * Math.cos(x * 18 + bank));
      paint.lineTo(x0 + x * (360 - bank * 39), y0 - ridge * (245 - bank * 37) - sample() * 8);
    }
    paint.lineTo(x0 + 360 - bank * 39, y0 + 36);
    paint.closePath();
    paint.fill();
    for (let stroke = 0; stroke < 160; stroke += 1) {
      const x = sample();
      const ridge = Math.sin(x * Math.PI) ** 1.2 * (.63 + .21 * Math.cos(x * 18 + bank));
      paint.lineWidth = .6 + sample() * 2.1;
      paint.globalAlpha = .03 + sample() * .18;
      paint.strokeStyle = bank === 2 ? '#373d36' : '#62685b';
      const px = x0 + x * (360 - bank * 39);
      const py = y0 - ridge * (245 - bank * 37);
      paint.beginPath();
      paint.moveTo(px, py + sample() * 10);
      paint.lineTo(px - 6 + sample() * 10, py + 11 + sample() * 38);
      paint.stroke();
    }
  }
  paint.restore();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.anisotropy = 8;
  return texture;
}

function addDisplayAlcove(hall: Group, parts: WallStock, width: number): void {
  const height = headY - sillY;
  place(parts.plaster, 'rear', 0, (headY + sillY) / 2, -.349, width, height, .075, false, .82);
  place(parts.relief, 'rear', 0, .216, -.142, width + .108, .44, .528, false, .84);
  place(parts.joinery, 'rear', 0, .433, -.114, width + .16, .067, .621, false, .94);
  for (const side of [-1, 1]) {
    place(parts.panel, 'rear', side * (width / 2 - .083), (headY + sillY) / 2, -.147,
      .157, height, .387, true, .82);
    place(parts.posts, 'rear', side * (width / 2 - .018), (headY + sillY) / 2, .033,
      .092, height, .132, true, .95);
  }
  place(parts.joinery, 'rear', 0, headY - .29, -.089, width, .114, .343, false, .88);
  place(parts.lamp, 'rear', 0, headY - .382, -.162, width * .75, .032, .042, false, .51);

  const pictureSize = [1.62, 2.60] as const;
  const pictureY = 1.91;
  const drawing = new Mesh(new PlaneGeometry(...pictureSize),
    new MeshStandardMaterial({ map: washDrawing(), color: 0xd4cab8, roughness: .96 }));
  drawing.name = 'Mounted ink washes in the rear display alcove';
  drawing.rotation.y = Math.PI;
  drawing.position.set(.21, pictureY, rearZ + .260);
  drawing.receiveShadow = true;
  hall.add(drawing);
  for (const y of [pictureY - pictureSize[1] / 2, pictureY + pictureSize[1] / 2]) {
    place(parts.joinery, 'rear', .21, y, -.256, pictureSize[0] + .087, .036, .040, false, .86);
  }

  const potProfile = [
    [0, 0], [.10, 0], [.115, .018], [.137, .070], [.158, .136], [.155, .204], [.132, .268],
    [.096, .322], [.076, .351], [.072, .392], [.077, .405], [.067, .411], [.060, .398], [.061, .361],
    [.079, .310], [0, .289],
  ];
  const pot = new Mesh(new LatheGeometry(potProfile.map(([x, y]) => new Vector2(x, y)), 36),
    new MeshPhysicalMaterial({ name: 'Burnished green-gray stoneware', color: 0x3b453e,
      roughness: .54, clearcoat: .25, clearcoatRoughness: .41 }));
  pot.name = 'Stoneware in the display alcove';
  pot.position.set(-1.25, .466, rearZ + .067);
  pot.castShadow = pot.receiveShadow = true;
  hall.add(pot);
}

export function addHallEnclosure(hall: Group, materials: HallMaterials): void {
  const parts = createWallStock(hall, materials);
  const rearBays = 9;
  const rearSpacing = halfWidth * 2 / rearBays;
  layWallStructure(parts, 'rear', -halfWidth, halfWidth, rearBays);
  for (let index = 0; index < rearBays; index += 1) {
    const x = -halfWidth + (index + .5) * rearSpacing;
    const width = rearSpacing - postWidth;
    if (index === 4) addDisplayAlcove(hall, parts, width);
    else if (index === 1 || index === 3 || index === 5 || index === 7) {
      layShoji(parts, 'rear', x, width, sillY + .050, headY - .134, index === 3 || index === 5);
    } else if (index === 0 || index === 8) layWoodBay(parts, 'rear', x, width);
    else layPlasterBay(parts, 'rear', x, width);
    layTransom(parts, 'rear', x, width);
  }

  const sideBays = 5;
  const spacing = (rearZ - frontZ) / sideBays;
  for (const side of ['west', 'east'] as const) {
    layWallStructure(parts, side, frontZ, rearZ, sideBays);
    for (let index = 0; index < sideBays; index += 1) {
      const z = frontZ + (index + .5) * spacing;
      const width = spacing - postWidth;
      if (index === 0 || index === 4) layPlasterBay(parts, side, z, width);
      else if (index === 2) layWoodBay(parts, side, z, width);
      else layShoji(parts, side, z, width, sillY + .050, headY - .134, true);
      layTransom(parts, side, z, width);
    }
  }
  for (const assembly of Object.values(parts)) assembly.finish();
}
