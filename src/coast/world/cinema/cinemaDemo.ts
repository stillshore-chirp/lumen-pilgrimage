import { CINEMA_PREVIEW_DURATION } from './cinemaPreview';
import { CINEMA_CHANNELS, CINEMA_SAMPLE_RATE, type CinemaAudioAsset, type CinemaObjectKey } from './cinemaProgram';

const rate = CINEMA_SAMPLE_RATE;
const bed = CINEMA_CHANNELS.slice(0, 12);
const movement: readonly CinemaObjectKey[] = [
  { sample: 5.6 * rate, position: [-13.31, 12.6125, -1.4], gainDb: 0 },
  { sample: 9.2 * rate, position: [13.31, 12.6125, -1.4], gainDb: 0 },
  { sample: 15.6 * rate, position: [6.655, 20.381, 14], gainDb: 0 },
  { sample: 19.3 * rate, position: [6.655, 20.381, 50], gainDb: 0 },
];

function strike(sample: number, from: number, pitch: number): number {
  const time = sample / rate - from;
  if (time < 0 || time >= 0.65) return 0;
  const attack = Math.min(1, time / 0.018, (0.65 - time) / 0.06);
  const noise = ((Math.imul(sample ^ (sample >>> 5), 747_796_405) >>> 8) / 8_388_608 - 1);
  const phase = time * pitch * Math.PI * 2;
  return attack * (0.42 * Math.sin(phase) * Math.exp(-9 * time)
    + 0.21 * Math.sin(phase * 2.13) * Math.exp(-20 * time)
    + noise * 0.1 * Math.exp(-22 * time));
}

/** The built-in preview uses the same bed and moving-object inputs as an imported film. */
export const cinemaDemo: CinemaAudioAsset = {
  durationSamples: CINEMA_PREVIEW_DURATION * rate,
  program: { bed, lfeGainDb: 0, objects: [{ keys: movement }] },
  async read(start, count) {
    const tracks = Array.from({ length: bed.length + 1 }, () => new Float32Array(count));
    for (let index = 0; index < count; ++index) {
      const sample = start + index;
      tracks[2][index] = strike(sample, 0.6, 403);
      tracks[0][index] = strike(sample, 5.6, 458) * 0.65;
      tracks[1][index] = strike(sample, 10.6, 519);
      tracks[6][index] = strike(sample, 20.6, 301);
      tracks[7][index] = strike(sample, 21.5, 354);
      tracks[3][index] = strike(sample, 22.3, 46) * 0.3;
      tracks[12][index] = 0.8 * (strike(sample, 6.8, 407) + strike(sample, 7.6, 435)
        + strike(sample, 8.4, 490) + strike(sample, 15.6, 680) + strike(sample, 16.5, 610)
        + strike(sample, 17.4, 554) + strike(sample, 18.4, 490));
    }
    return tracks;
  },
};
