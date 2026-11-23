import { DoubleSide, Vector3, type Material } from 'three';
import type { FurnitureModel, FurniturePiece } from './residenceFurnitureModel';
import type { ResidenceMaterials } from './residenceMaterials';

function gatheredCurtain(piece: FurniturePiece, fabric: Material, track: Material, drop: number,
  trackLength: number, trackOffset: number, seed: number): void {
  piece.box(track, trackOffset, drop, -.018, trackLength, .014, .031, .002);
  const sample = (u: number, v: number): readonly [number, number, number] => {
    const phase = u * (6.30 + .31 * v) * Math.PI * 2 + seed + .39 * v;
    return [
      (u - .5) * (.329 + .048 * v) + Math.sin(u * 14 + v * 3 + seed) * .003 * v,
      drop - .030 - v * (drop - .068) + Math.sin(u * 28 + seed) * .008 * v ** 4,
      Math.sin(phase) * (.024 + .013 * v) + .010 * Math.sin(phase * .51 + v * 4)
        + .007 * v * Math.sin(u * 9.3 + seed),
    ];
  };
  piece.surface(fabric, .61, drop, 53, 20, sample);
  piece.tube(fabric, Array.from({ length: 50 }, (_, i) => sample(i / 49, 1)), .00165);
  for (let i = 0; i < 7; i++) {
    const [x, y, z] = sample((i + .5) / 7, 0);
    piece.rod(track, [x, y - .008, z], [x, drop - .008, -.018], .0014);
  }
}

export function addWindowDressing(model: FurnitureModel, m: ResidenceMaterials): void {
  const linen = model.tone(m.bedding, 0xdbd1c0);
  linen.side = DoubleSide;
  const bedroomLinen = model.tone(m.bedding, 0xb5afa4);
  bedroomLinen.side = DoubleSide;

  model.room('Living room curtains');
  gatheredCurtain(model.at(11.665, .345), linen, m.ceiling, 2.965, 6.24, 2.90, 1.18);
  gatheredCurtain(model.at(22.234, .342), linen, m.ceiling, 2.965, 4.24, -1.94, 3.6);
  gatheredCurtain(model.at(22.448, 6.107, -Math.PI / 2), linen, m.ceiling, 2.965, 5.91, 2.73, 4.2);

  for (const [name, east, north, heading, trackLength, trackOffset, seed] of [
    ['Bedroom 03 curtains', .732, .347, 0, 2.52, 1.031, .74],
    ['Bedroom 04 curtains', 4.402, .347, 0, 2.62, 1.080, 2.23],
    ['Bedroom 05 curtains', 10.206, .347, 0, 2.62, -1.082, 4.84],
    ['Bedroom 02 curtains', 22.449, 9.346, -Math.PI / 2, 2.52, 1.03, 2.39],
    ['Primary bedroom curtains', 20.395, 14.972, -Math.PI / 2, 3.12, 1.34, 5.86],
  ] as const) {
    model.room(name);
    gatheredCurtain(model.at(east, north, heading), bedroomLinen, m.ceiling, 2.771, trackLength, trackOffset, seed);
  }
}

export function foliage(piece: FurniturePiece, stem: Material, leaf: Material, lightLeaf: Material,
  x: number, y: number, z: number, height: number, spread: number, seed = 0): void {
  const base = new Vector3(x, y, z);
  const tip = new Vector3(x + .17 * spread, y + height, z - .13 * spread);
  const shoot = tip.clone().sub(base);
  piece.tube(stem, [
    [x, y, z], [x + .06 * spread, y + height * .33, z + .061 * spread], [tip.x, tip.y, tip.z],
  ], .0037);
  for (let i = 0; i < 13; i++) {
    const angle = i * 2.39996 + seed;
    const progress = (i + 1) / 14;
    const start = base.clone().addScaledVector(shoot, progress * .87 + .11);
    start.z += Math.sin(progress * Math.PI) * .041 * spread;
    const reach = (.26 + Math.sin(progress * Math.PI) * .44) * spread;
    const leafBase = start.clone().add(new Vector3(Math.cos(angle) * reach * .58,
      (1 - progress) * .079 + .026, Math.sin(angle) * reach * .58));
    const bladed = new Vector3(Math.cos(angle + .16) * reach, .030 + .047 * Math.sin(angle * 1.4),
      Math.sin(angle + .16) * reach);
    const side = new Vector3(-Math.sin(angle), Math.sin(angle * 1.77) * .63, Math.cos(angle))
      .multiplyScalar(reach * (.15 + .076 * Math.cos(i * 2.71)));
    const bend = new Vector3(-Math.cos(angle), 1, -Math.sin(angle)).multiplyScalar(.037 * (spread + .09));
    piece.rod(stem, [start.x, start.y, start.z], [leafBase.x, leafBase.y, leafBase.z], .00195, .0011);
    piece.surface(i % 3 ? leaf : lightLeaf, reach, 2 * side.length(), 10, 4, (u, v) => {
      const width = Math.sin(u * Math.PI) ** .79;
      const shape = leafBase.clone().addScaledVector(bladed, u)
        .addScaledVector(side, (v - .5) * 2 * width)
        .addScaledVector(bend, (Math.sin(u * Math.PI * 1.34) - .22 * Math.abs(2 * v - 1)) * width);
      return [shape.x, shape.y, shape.z];
    });
  }
}
