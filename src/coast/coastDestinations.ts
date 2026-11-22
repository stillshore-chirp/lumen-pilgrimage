import type { CoastPose } from './CoastControls';
import { SPAWN } from './terrain';

export type ExplorationWorldId = 'coast' | 'overlook';

export interface CoastDestination extends CoastPose {
  readonly id: string;
  readonly label: string;
}

export const EXPLORATION_WORLDS = [
  {
    id: 'coast',
    label: '入り江と山道',
    places: [
      { id: 'inlet', label: '入り江の浜', ...SPAWN },
      { id: 'forest', label: '密林の休憩所', x: -28.05, z: 108.65, yaw: 0.21, pitch: 0.025 },
      { id: 'lake', label: '湖畔', x: 86.8, z: 701.5, yaw: -2.07, pitch: 0.07 },
      { id: 'vermilion', label: '朱の参道', x: 209, z: 904, yaw: -2.55, pitch: 0.15 },
      { id: 'ridge', label: '稜線', x: -109.9, z: 973.7, yaw: -2.61, pitch: 0.025 },
    ],
  },
  {
    id: 'overlook',
    label: '丘陵展望台',
    places: [
      { id: 'main-deck', label: '中央展望デッキ', x: -7, z: -20.9, yaw: -0.64, pitch: -0.16 },
      { id: 'west-terrace', label: '西テラス', x: -29, z: -21.2, yaw: 0.07, pitch: -0.10 },
      { id: 'east-terrace', label: '東テラス', x: 29, z: -21.2, yaw: -0.82, pitch: -0.10 },
      { id: 'upper-deck', label: '2階展望デッキ', x: 17.4, z: 13.35, yaw: -0.42, pitch: -0.16 },
    ],
  },
] as const satisfies readonly { id: ExplorationWorldId; label: string; places: readonly CoastDestination[] }[];

export function findDestination(worldId: string, placeId: string | null): CoastDestination | undefined {
  return EXPLORATION_WORLDS.find(world => world.id === worldId)?.places.find(place => place.id === placeId);
}
