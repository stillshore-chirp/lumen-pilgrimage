import { CINEMA_EXITS, cinemaGroundHeight } from './cinemaLayout';

// Mounting dimensions in metres. The lenses and their light use the same origins.
export const CINEMA_COVE_LENS_X = 19.113;
export const CINEMA_COVE_LENS_Y = 18.829;
export const CINEMA_WALL_LENS_X = 19.760;
export const CINEMA_STEP_MARKER_INSET = 0.29;

export const CINEMA_WALL_FOOTLIGHTS = Array.from({ length: 11 }, (_, index) => 6.5 + index * 4.15)
  .filter(z => !CINEMA_EXITS.some(exit => exit.side === 'left' && Math.abs(exit.z - z) < 1.27))
  .map(z => ({ z, y: cinemaGroundHeight(0, z) }));

export const CINEMA_EXIT_LAMPS = CINEMA_EXITS.map(exit => ({
  x: exit.side === 'rear' ? exit.x : exit.x * 0.97,
  y: exit.y + 2.909,
  z: exit.side === 'rear' ? exit.z - 0.59 : exit.z,
}));
