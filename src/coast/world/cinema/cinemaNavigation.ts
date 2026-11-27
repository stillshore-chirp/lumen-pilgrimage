import type { CoastNavigation } from '../../CoastControls';
import {
  CINEMA_BOUNDS, CINEMA_CEILING_BAFFLES, CINEMA_CEILING_COFFERS, CINEMA_DESTINATIONS, CINEMA_PLACES,
  CINEMA_ROOM_HEIGHT, CINEMA_ROWS, CINEMA_SCREEN, CINEMA_SEAT_BACK_CUSHION, CINEMA_SEAT_BACK_SHELL, cinemaGroundHeight,
} from './cinemaLayout';
import { cinemaSpeakerEquipmentBlocked } from './cinemaSpeakerGeometry';

const seatBacks = CINEMA_ROWS.map(row => ({
  z: row.z,
  y: row.y,
  chairs: CINEMA_PLACES.filter(place => place.row === row.number && place.kind !== 'wheelchair'),
}));

const seatBackHeight = Math.max(...[CINEMA_SEAT_BACK_SHELL, CINEMA_SEAT_BACK_CUSHION]
  .map(([, y, , , height, depth, tilt]) => y + (height * Math.cos(tilt) + depth * Math.sin(tilt)) / 2));
const ceilingPanels = [...CINEMA_CEILING_BAFFLES, ...CINEMA_CEILING_COFFERS];
const ceilingEdgeClearance = .22;

// The front of each row remains a passage. A chair back stops walking,
// but supports landing from above instead of trapping a walker inside it.
function chairTop(x: number, z: number): number {
  const back = seatBacks.find(row => z > row.z + .10 && z < row.z + .46);
  return back?.chairs.some(chair => Math.abs(x - chair.x) < .48) ? back.y + seatBackHeight : -Infinity;
}

export const cinemaNavigation: CoastNavigation = {
  bounds: CINEMA_BOUNDS,
  spawn: CINEMA_DESTINATIONS[0],
  groundHeight: (x, z) => Math.max(cinemaGroundHeight(x, z), chairTop(x, z)),
  blocksWalking: (x, z, foot) => z < CINEMA_SCREEN.z + .58 || foot < chairTop(x, z),
  blocksFlight: (x, z, eyeY?: number, clearance = .25) => z < CINEMA_SCREEN.z + .58
    || (eyeY !== undefined && cinemaSpeakerEquipmentBlocked(x, eyeY, z, clearance)),
  flightCeiling: CINEMA_ROOM_HEIGHT,
  ceilingHeight(x, z) {
    let ceiling = CINEMA_ROOM_HEIGHT;
    for (const [cx, y, cz, width, height, depth] of ceilingPanels) {
      if (Math.abs(x - cx) < width / 2 + ceilingEdgeClearance
        && Math.abs(z - cz) < depth / 2 + ceilingEdgeClearance) {
        ceiling = Math.min(ceiling, y - height / 2);
      }
    }
    return ceiling;
  },
  walkSpeed: 3.2,
};
