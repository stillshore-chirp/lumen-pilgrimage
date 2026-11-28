import { CINEMA_BANDS, CINEMA_SCREEN_BANDS, CINEMA_WOVEN_FABRIC, cinemaBandShelves } from './cinemaPropagation';

export interface CinemaPropagationTransfer {
  /** Absolute amplitude transfer in dB; the first band is retained, not normalized. */
  readonly bandDb: readonly number[];
  readonly screenCrossings: number;
}

export interface CinemaShelfCoefficients {
  readonly b: readonly [number, number, number];
  /** Normalized denominator coefficients after its leading one. */
  readonly a: readonly [number, number];
}

/** W3C Audio EQ Cookbook high shelf, S=1 (Web Audio high-shelf definition). */
export function cinemaHighShelfCoefficients(frequency: number, gainDb: number,
  sampleRate = 48_000): CinemaShelfCoefficients {
  if (!(frequency > 0 && frequency < sampleRate / 2) || !Number.isFinite(gainDb)) {
    throw new RangeError('Invalid cinema high shelf');
  }
  const amplitude = 10 ** (gainDb / 40);
  const omega = 2 * Math.PI * frequency / sampleRate;
  const cosine = Math.cos(omega);
  const alpha = Math.sin(omega) / Math.SQRT2;
  const root = 2 * Math.sqrt(amplitude) * alpha;
  const a0 = amplitude + 1 - (amplitude - 1) * cosine + root;
  return {
    b: [
      amplitude * (amplitude + 1 + (amplitude - 1) * cosine + root) / a0,
      -2 * amplitude * (amplitude - 1 + (amplitude + 1) * cosine) / a0,
      amplitude * (amplitude + 1 + (amplitude - 1) * cosine - root) / a0,
    ],
    a: [2 * (amplitude - 1 - (amplitude + 1) * cosine) / a0,
      (amplitude + 1 - (amplitude - 1) * cosine - root) / a0],
  };
}

export function cinemaPropagationSections(transfer: CinemaPropagationTransfer, sampleRate = 48_000) {
  if (transfer.bandDb.length !== CINEMA_BANDS.length || transfer.bandDb.some(db => !Number.isFinite(db))) {
    throw new RangeError('Invalid cinema propagation transfer');
  }
  const shelves = cinemaBandShelves(CINEMA_BANDS, transfer.bandDb);
  if (!Number.isInteger(transfer.screenCrossings) || transfer.screenCrossings < 0 || transfer.screenCrossings > 3) {
    throw new RangeError('Invalid cinema screen crossings');
  }
  for (let pass = 0; pass < transfer.screenCrossings; pass += 1) {
    shelves.push(...cinemaBandShelves(CINEMA_SCREEN_BANDS, CINEMA_WOVEN_FABRIC));
  }
  return shelves.map(({ frequency, gainDb }) => cinemaHighShelfCoefficients(frequency, gainDb, sampleRate));
}

/**
 * Control-thread causal FIR approximation of the shared band transfer.
 * No linear-phase delay, HRIR truncation, energy normalization or seat-dip model.
 * The caller chooses length only after response/PCM/error and cost evaluation.
 */
export function cinemaPropagationImpulse(transfer: CinemaPropagationTransfer, length: number,
  sampleRate = 48_000): Float32Array {
  if (!Number.isInteger(length) || length < 1 || length > 2_048) throw new RangeError('Invalid cinema FIR length');
  const sections = cinemaPropagationSections(transfer, sampleRate);
  let input = new Float64Array(length);
  input[0] = 10 ** (transfer.bandDb[0] / 20);
  for (const { b, a } of sections) {
    const output = new Float64Array(length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < length; i += 1) {
      const value = b[0] * input[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      output[i] = value;
      x2 = x1; x1 = input[i]; y2 = y1; y1 = value;
    }
    input = output;
  }
  return Float32Array.from(input);
}
