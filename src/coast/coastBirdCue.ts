export type CoastBirdSpecies = 'gull' | 'whiteEye' | 'bushWarbler' | 'thrush';

// The world and the audio graph share the fade-out limit, independent of model visibility.
export const BIRD_CALL_RANGE: Readonly<Record<CoastBirdSpecies, number>> = {
  gull: 248,
  whiteEye: 118,
  bushWarbler: 150,
  thrush: 138,
};

export interface CoastBirdCue {
  id: number;
  species: CoastBirdSpecies;
  x: number;
  y: number;
  z: number;
  gain: number;
  vx?: number;
  vy?: number;
  vz?: number;
}
