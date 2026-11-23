import { Vector3, type Material } from 'three';
import type { FurniturePiece } from './residenceFurnitureModel';

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
