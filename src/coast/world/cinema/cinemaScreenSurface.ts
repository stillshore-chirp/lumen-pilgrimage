import { BoxGeometry } from 'three';
import type { CinemaBox } from './cinemaFinishes';
import { CINEMA_SCREEN } from './cinemaLayout';

// Optical membrane dimensions; the acoustic renderer retains its perforated-screen approximation.
export const CINEMA_SCREEN_SUBSTRATE = {
  thickness: .0012,
  projectionGap: .0005,
  frameLap: .001,
} as const;

export function cinemaScreenSubstrateBox(): CinemaBox {
  const { thickness, projectionGap, frameLap } = CINEMA_SCREEN_SUBSTRATE;
  return [
    0, CINEMA_SCREEN.center, CINEMA_SCREEN.z - projectionGap - thickness / 2,
    CINEMA_SCREEN.width + 2 * frameLap, CINEMA_SCREEN.height + 2 * frameLap, thickness,
  ];
}


export function cinemaScreenSubstrateGeometry(): BoxGeometry {
  const geometry = new BoxGeometry(1, 1, 1);
  // The +Z cap is internal to the separately rendered projection face.
  // Preserve its triangles for the closed volume and Raycaster without drawing it twice.
  const index = geometry.getIndex();
  const front = geometry.groups.find(group => group.materialIndex === 4);
  if (!index || !front || front.count !== 6) throw new Error('Unexpected cinema substrate box topology');
  const source = Array.from(index.array);
  const exterior = source.filter((_, i) => i < front.start || i >= front.start + front.count);
  geometry.setIndex([...exterior, ...source.slice(front.start, front.start + front.count)]);
  geometry.clearGroups();
  geometry.addGroup(0, exterior.length, 0);
  geometry.addGroup(exterior.length, front.count, 1);
  return geometry;
}
