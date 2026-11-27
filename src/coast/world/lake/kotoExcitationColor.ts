/**
 * A bounded, relative contact-colour control for an already pitched note.
 * This does not identify a recorded velocity layer or the instrument's body IR.
 */
export interface KotoExcitationColorResult {
  readonly samples: Float32Array<ArrayBuffer>;
  readonly latencyFrames: number;
  /** Output frames actually convolved; validation still scans the whole input. */
  readonly processedFrames: number;
  /** FIR tail that cannot fit in the caller's fixed-length note. */
  readonly tailFramesClipped: number;
  readonly bypassed: boolean;
}

const REFERENCE_VELOCITY = 0.6;
const MAX_COLOR_DB = 3;
const MIN_GAIN = 10 ** (-MAX_COLOR_DB / 20);
const MAX_GAIN = 10 ** (MAX_COLOR_DB / 20);
const LATENCY_SECONDS = 0.00075;

function contactWidth(velocity: number): number {
  // Same finite-contact design assumption as frozen physical source 0f9fe7…;
  // it is not a measurement of the recording's force or contact duration.
  return 0.000022 + 0.000080 * (1 - velocity) ** 1.4;
}

function makeKernel(velocity: number, sampleRate: number, radius: number): Float64Array {
  const intervals = Math.max(256, 4 * radius);
  const magnitude = new Float64Array(intervals + 1);
  const widthDifference = contactWidth(velocity) ** 2 - contactWidth(REFERENCE_VELOCITY) ** 2;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let i = 0; i <= intervals; i += 1) {
    const frequency = i * sampleRate / (2 * intervals);
    const relativeDb = -40 * Math.PI ** 2 / Math.LN10 * frequency ** 2 * widthDifference;
    const boundedDb = MAX_COLOR_DB * Math.tanh(relativeDb / MAX_COLOR_DB);
    const gain = 10 ** (boundedDb / 20);
    magnitude[i] = gain;
    minimum = Math.min(minimum, gain);
    maximum = Math.max(maximum, gain);
  }

  const kernel = new Float64Array(2 * radius + 1);
  for (let lag = 0; lag <= radius; lag += 1) {
    let coefficient = 0.5 * (magnitude[0] + magnitude[intervals] * (lag % 2 ? -1 : 1));
    for (let i = 1; i < intervals; i += 1) {
      coefficient += magnitude[i] * Math.cos(Math.PI * i * lag / intervals);
    }
    // Direct cosine quadrature, not an FFT. The triangular Fejer window makes
    // the zero-phase response a positive weighted average of bounded gains.
    coefficient *= (1 - lag / (radius + 1)) / intervals;
    kernel[radius - lag] = coefficient;
    kernel[radius + lag] = coefficient;
  }

  let dc = 0;
  for (const value of kernel) dc += value;
  // Preserve DC gain=1 as a filter constraint, without normalizing note RMS or
  // peak. Shrinking around the identity keeps the Fejer bound after this shift.
  kernel[radius] += 1 - dc;
  let amount = 1;
  if (maximum > dc) amount = Math.min(amount, (MAX_GAIN - 1) / (maximum - dc));
  if (dc > minimum) amount = Math.min(amount, (1 - MIN_GAIN) / (dc - minimum));
  for (let i = 0; i < kernel.length; i += 1) kernel[i] *= amount;
  kernel[radius] += 1 - amount;
  return kernel;
}

/**
 * Apply only relative spectral colour; the caller retains its macro gain,
 * including velocity-zero silence. Output length equals input length.
 * Non-reference notes use a causal linear-phase FIR with approximately 0.75 ms
 * group delay and 1.5 ms support. No future samples or negative-time shift.
 */
export function applyKotoExcitationColor(
  input: Float32Array, velocity: number, sampleRate = 48000,
): KotoExcitationColorResult {
  if (!(input instanceof Float32Array)) throw new TypeError('Koto colour input must be Float32Array.');
  if (!Number.isFinite(velocity) || velocity < 0 || velocity > 1
    || !Number.isInteger(sampleRate) || sampleRate < 24000 || sampleRate > 192000) {
    throw new RangeError('Invalid koto colour velocity or sample rate.');
  }
  let firstActive = input.length;
  let lastActive = -1;
  for (let i = 0; i < input.length; i += 1) {
    if (!Number.isFinite(input[i])) throw new RangeError('Koto colour input contains a non-finite value.');
    if (input[i] !== 0) {
      firstActive = Math.min(firstActive, i);
      lastActive = i;
    }
  }
  if (velocity === REFERENCE_VELOCITY) return {
    samples: new Float32Array(input), latencyFrames: 0, processedFrames: 0,
    tailFramesClipped: 0, bypassed: true,
  };

  const radius = Math.max(8, Math.round(sampleRate * LATENCY_SECONDS));
  const samples = new Float32Array(input.length);
  if (lastActive < 0) return {
    samples, latencyFrames: radius, processedFrames: 0, tailFramesClipped: 0, bypassed: false,
  };
  const kernel = makeKernel(velocity, sampleRate, radius);
  const finalFrame = Math.min(input.length - 1, lastActive + kernel.length - 1);
  for (let i = firstActive; i <= finalFrame; i += 1) {
    let value = 0;
    const firstTap = Math.max(0, i - lastActive);
    const lastTap = Math.min(kernel.length - 1, i - firstActive);
    for (let tap = firstTap; tap <= lastTap; tap += 1) value += kernel[tap] * input[i - tap];
    samples[i] = value;
    if (!Number.isFinite(samples[i])) {
      throw new RangeError('Koto colour output exceeds the finite Float32 range.');
    }
  }
  return {
    samples, latencyFrames: radius, processedFrames: finalFrame - firstActive + 1,
    tailFramesClipped: Math.max(0, lastActive + kernel.length - input.length), bypassed: false,
  };
}
