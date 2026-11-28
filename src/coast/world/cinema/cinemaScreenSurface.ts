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
