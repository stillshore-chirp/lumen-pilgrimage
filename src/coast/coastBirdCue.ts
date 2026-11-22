export type CoastBirdSpecies = 'gull' | 'whiteEye' | 'bushWarbler' | 'thrush';

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
