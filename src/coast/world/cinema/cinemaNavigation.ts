import type { CoastNavigation } from '../../CoastControls';
import {
  CINEMA_BOUNDS, CINEMA_DESTINATIONS, CINEMA_PLACES, CINEMA_ROOM_HEIGHT, CINEMA_ROWS, CINEMA_SCREEN, cinemaGroundHeight,
} from './cinemaLayout';

const seatBacks = CINEMA_ROWS.map(row => ({
  z: row.z,
  chairs: CINEMA_PLACES.filter(place => place.row === row.number && place.kind !== 'wheelchair'),
}));

// The front of each row remains a passage. Chair backs separate it from the row behind.
function blocksWalking(x: number, z: number): boolean {
  if (z < CINEMA_SCREEN.z + .58) return true;
  const back = seatBacks.find(row => z > row.z + .10 && z < row.z + .46);
  return back?.chairs.some(chair => Math.abs(x - chair.x) < .48) ?? false;
}

export const cinemaNavigation: CoastNavigation = {
  bounds: CINEMA_BOUNDS,
  spawn: CINEMA_DESTINATIONS[0],
  groundHeight: cinemaGroundHeight,
  blocksWalking,
  flightCeiling: CINEMA_ROOM_HEIGHT,
  flightEnabled: false,
  jumpEnabled: false,
  walkSpeed: 3.2,
};
