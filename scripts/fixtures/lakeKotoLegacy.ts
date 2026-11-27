type Pluck = readonly [seconds: number, string: number, force: number, pressSemitones?: 1 | 2];

// Hirajōshi in D. The first and fifth strings share a pitch.
const STRING_PITCHES = [62, 55, 57, 58, 62, 63, 67, 69, 70, 74, 75, 79, 81] as const;
export const LAKE_KOTO_DURATION = 39;
export const LAKE_KOTO_SAMPLE_RATE = 24_000;
const TAU = 2 * Math.PI;

const SCORE: readonly Pluck[] = [
  // A low answer follows each appearance of the three-note figure.
  [0.09, 5, 0.70], [0.85, 7, 0.70], [1.32, 8, 0.61], [2.21, 9, 0.65, 1],
  [3.76, 7, 0.53], [4.03, 4, 0.39], [4.83, 5, 0.60],
  [6.91, 2, 0.65], [7.46, 6, 0.47], [7.92, 7, 0.56], [8.45, 8, 0.70],
  [9.37, 10, 0.64], [9.78, 9, 0.49], [10.18, 7, 0.58], [11.16, 5, 0.56, 1],
  // A higher reply, then a short sweep and a pause.
  [13.28, 10, 0.66], [13.63, 11, 0.47], [14.31, 12, 0.58], [15.26, 10, 0.61],
  [16.29, 8, 0.68, 2], [17.64, 7, 0.50], [17.73, 5, 0.43],
  [19.15, 5, 0.45], [19.23, 6, 0.42], [19.31, 7, 0.49], [19.41, 8, 0.52],
  [19.52, 9, 0.60], [19.66, 10, 0.62], [20.81, 13, 0.56], [21.47, 12, 0.50],
  [22.26, 11, 0.46], [23.18, 10, 0.61], [23.21, 3, 0.38],
  // The opening returns with a lower register and a staggered unison at the cadence.
  [25.14, 2, 0.65], [25.78, 5, 0.56], [26.36, 7, 0.60], [26.88, 8, 0.50],
  [27.63, 9, 0.60, 1], [28.77, 7, 0.56], [29.85, 6, 0.47], [30.41, 3, 0.42],
  [32.37, 4, 0.47], [32.83, 7, 0.56], [33.40, 6, 0.52], [34.24, 5, 0.64],
  [34.30, 1, 0.34], [35.28, 2, 0.46], [36.03, 5, 0.59],
];

// Lightly damped soundboard modes. The two lowest represent the air and wood.
const BODY_MODES = [
  [85, 0.070, 0.040], [100, 0.083, 0.052], [208, 0.100, 0.071],
  [355, 0.066, 0.059], [545, 0.042, 0.058], [865, 0.030, 0.040],
] as const;

function pressAmount(time: number): number {
  const phase = Math.min(1, Math.max(0, (time - 0.078) / 0.19));
  return phase * phase * (3 - 2 * phase);
}

function addPluck(samples: Float32Array, pluck: Pluck, index: number): void {
  const [seconds, string, force, press = 0] = pluck;
  const start = Math.round(seconds * LAKE_KOTO_SAMPLE_RATE);
  const frequency = 440 * 2 ** ((STRING_PITCHES[string - 1] - 69 + 0.018 * Math.sin(string * 8.3)) / 12);
  const pluckPosition = 0.095 + 0.044 * (1 - force) + 0.018 * Math.sin(index * 2.39);
  const length = Math.min(samples.length - start, Math.round(2.9 * LAKE_KOTO_SAMPLE_RATE));
  const voice = new Float32Array(length);
  const fadeLength = Math.round(0.26 * LAKE_KOTO_SAMPLE_RATE);
  const fadeStart = length - fadeLength;

  // Bridge force is weighted by the modes of a string displaced at the pluck point.
  // Higher modes disappear faster, so the attack is bright while the tail keeps the pitch.
  for (let partial = 1; partial <= 18; partial += 1) {
    const mode = frequency * partial * Math.sqrt(1 + 0.000095 * (partial * partial - 1));
    if (mode * 2 ** (press / 12) >= LAKE_KOTO_SAMPLE_RATE * 0.45) break;
    const decay = (0.48 + 0.33 * (220 / frequency) ** 0.42)
      / (1 + 0.49 * (partial - 1) ** 0.97);
    const stringGain = Math.sin(Math.PI * partial * pluckPosition) / partial ** 0.8;
    const damping = Math.exp(-1 / (LAKE_KOTO_SAMPLE_RATE * decay));
    const modeLength = Math.min(length, Math.ceil(8 * decay * LAKE_KOTO_SAMPLE_RATE));
    let level = force * stringGain;
    let a = 0;
    let b = 1;
    const step = TAU * mode / LAKE_KOTO_SAMPLE_RATE;
    const blockSize = press ? 48 : modeLength;
    for (let block = 0; block < modeLength; block += blockSize) {
      const ratio = 2 ** (press * pressAmount(block / LAKE_KOTO_SAMPLE_RATE) / 12);
      const cosStep = Math.cos(step * ratio);
      const sinStep = Math.sin(step * ratio);
      const end = Math.min(block + blockSize, modeLength);
      for (let i = block; i < end; i += 1) {
        voice[i] += a * level;
        const next = a * cosStep + b * sinStep;
        b = b * cosStep - a * sinStep;
        a = next;
        level *= damping;
      }
    }
  }

  for (const [mode, decay, gain] of BODY_MODES) {
    const step = TAU * mode / LAKE_KOTO_SAMPLE_RATE;
    const damping = Math.exp(-1 / (LAKE_KOTO_SAMPLE_RATE * decay));
    let level = force * gain * (1 + 0.20 * Math.sin(mode * string));
    const duration = Math.min(length, Math.round(7 * decay * LAKE_KOTO_SAMPLE_RATE));
    for (let i = 0; i < duration; i += 1) {
      voice[i] += Math.sin(step * i) * level;
      level *= damping;
    }
  }

  // Release noise from a hard plectrum is brief and changes with the touch of each note.
  let noiseState = 197 + index * 3923;
  let previous = 0;
  const noiseLength = Math.min(length, Math.round(LAKE_KOTO_SAMPLE_RATE * 0.022));
  for (let i = 0; i < noiseLength; i += 1) {
    noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
    const noise = noiseState / 0x80000000 - 1;
    const envelope = Math.min(1, i / 11) * Math.exp(-i / (LAKE_KOTO_SAMPLE_RATE * 0.0038));
    voice[i] += (noise - 0.68 * previous) * envelope * force ** 1.7 * 0.20;
    previous = noise;
  }

  for (let i = 0; i < length; i += 1) {
    const attack = Math.min(1, i / 18);
    const endFade = i > fadeStart ? (length - i) / fadeLength : 1;
    samples[start + i] += voice[i] * attack * endFade;
  }
}

export function renderLakeKoto(): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(LAKE_KOTO_DURATION * LAKE_KOTO_SAMPLE_RATE);
  SCORE.forEach((pluck, index) => addPluck(samples, pluck, index));
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const gain = 0.76 / peak;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= gain;
  return samples;
}
