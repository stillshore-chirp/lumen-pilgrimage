import { RESIDENCE_ROOMS } from './residencePlan';

export const RESIDENCE_BALCONY_CROSSFALL = .006;
const decks = RESIDENCE_ROOMS.filter(room => room.floor === 'deck').flatMap(room => room.rectangles);

// The deck falls east from the flush threshold; every other floor is level.
export function residenceFloorHeight(east: number, z: number): number {
  const north = -z;
  const deck = decks.find(([west, south, end, top]) => east >= west && east <= end && north >= south && north <= top);
  return deck ? (deck[0] - east) * RESIDENCE_BALCONY_CROSSFALL : 0;
}
