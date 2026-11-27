export const CINEMA_SAMPLE_RATE = 48_000;
export const CINEMA_CHANNELS = [
  'L', 'R', 'C', 'LFE', 'Ls', 'Rs', 'Bsl', 'Bsr', 'Ltf', 'Rtf', 'Ltr', 'Rtr', 'LC', 'RC',
] as const;

export type CinemaChannel = typeof CINEMA_CHANNELS[number];
export type CinemaPoint = readonly [x: number, y: number, z: number];

export interface CinemaObjectKey {
  readonly sample: number;
  readonly position: CinemaPoint;
  readonly gainDb: number;
}

export interface CinemaProgram {
  readonly bed: readonly CinemaChannel[];
  readonly lfeGainDb: 0 | 10;
  /** Object key times are relative to the screening, in 48 kHz samples. */
  readonly objects: readonly { readonly keys: readonly CinemaObjectKey[] }[];
}

export interface CinemaAudioAsset {
  readonly durationSamples: number;
  readonly program: CinemaProgram;
  /** Planar PCM in bed order, followed by one plane for each object. */
  read(startSample: number, count: number): Promise<Float32Array[]>;
}

export interface CinemaScreeningAsset extends CinemaAudioAsset {
  readonly video: File;
  readonly videoStartSample: number;
}
