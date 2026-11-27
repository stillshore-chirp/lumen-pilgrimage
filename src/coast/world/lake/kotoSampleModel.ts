import type { PhysicalKotoNote } from './kotoPhysicalModel';

/** Decoded once by the offline comparison host; no network or AudioContext here. */
export interface KotoSample {
  readonly id: string;
  readonly rootFrequency: number;
  readonly sampleRate: number;
  readonly samples: Float32Array;
  readonly sourceId: string;
  readonly sourceStartSeconds: number;
  readonly sourceEndSeconds: number;
}

export interface KotoSampleRenderDiagnostics {
  readonly method: 'sample' | 'hybrid' | 'physical-fallback';
  readonly sampleId?: string;
  readonly transposeSemitones?: number;
  readonly maximumTransposeSemitones?: number;
  readonly warnings: readonly string[];
  readonly attackBandHz?: number;
  readonly attackGain?: number;
  readonly highBandCorrelation?: number;
  readonly highBandEnergyRatio?: number;
  readonly handoffStartSeconds?: number;
  readonly handoffEndSeconds?: number;
  readonly crossfadeNormalizationPeak?: number;
}

export interface KotoSampleRenderResult {
  readonly samples: Float32Array<ArrayBuffer>;
  readonly diagnostics: KotoSampleRenderDiagnostics;
}

export type PhysicalKotoRenderer = (note: PhysicalKotoNote, sampleRate: number) => Float32Array;

export class KotoSampleUnavailableError extends RangeError {
  readonly code = 'KOTO_SAMPLE_UNAVAILABLE';

  constructor(readonly frequency: number, readonly pressSemitones: number) {
    super(`No reviewed sample covers ${frequency.toFixed(3)} Hz with ${pressSemitones.toFixed(2)} semitones of press within ±5 semitones.`);
    this.name = 'KotoSampleUnavailableError';
  }
}

const MAX_TRANSPOSE = 5;
const REFERENCE_VELOCITY = 0.6;
const SINC_RADIUS = 32;
const SINC_PHASES = 512;
const SINC_TAPS = 2 * SINC_RADIUS;
const HYBRID_CROSSOVER = 3500;
const HYBRID_FILTER_RADIUS = 64;

function validateNote(note: PhysicalKotoNote, sampleRate: number): number {
  const duration = note.duration ?? 6;
  if (!Number.isInteger(sampleRate) || sampleRate < 24000 || sampleRate > 192000
    || !Number.isFinite(duration) || duration < 0.05 || duration > 30
    || !Number.isFinite(note.frequency) || note.frequency < 80 || note.frequency > 2000
    || !Number.isFinite(note.velocity) || note.velocity < 0 || note.velocity > 1
    || (note.pressSemitones !== undefined && (!Number.isFinite(note.pressSemitones)
      || note.pressSemitones < 0 || note.pressSemitones > 3))
    || (note.dampAt !== undefined && (!Number.isFinite(note.dampAt) || note.dampAt < 0))
    || (note.seed !== undefined && !Number.isFinite(note.seed))
    || (note.pluckPosition !== undefined && (!Number.isFinite(note.pluckPosition)
      || note.pluckPosition < 0.03 || note.pluckPosition > 0.45))) {
    throw new RangeError('Invalid sample koto note parameters.');
  }
  return duration;
}

function validateBank(bank: readonly KotoSample[]): void {
  for (const sample of bank) {
    if (!Number.isFinite(sample.rootFrequency) || sample.rootFrequency <= 0
      || !Number.isInteger(sample.sampleRate) || sample.sampleRate < 24000 || sample.sampleRate > 192000
      || sample.samples.length < 64 || sample.samples.some(value => !Number.isFinite(value))) {
      throw new RangeError('Invalid decoded koto sample bank.');
    }
  }
}

function pressFraction(time: number): number {
  const amount = Math.min(1, Math.max(0, (time - 0.10) / 0.26));
  return amount ** 3 * (10 + amount * (-15 + 6 * amount));
}

function selectSample(note: PhysicalKotoNote, bank: readonly KotoSample[]): KotoSample {
  const press = note.pressSemitones ?? 0;
  let choice: KotoSample | undefined;
  let distance = Infinity;
  for (const sample of bank) {
    const initial = 12 * Math.log2(note.frequency / sample.rootFrequency);
    const maximum = Math.max(Math.abs(initial), Math.abs(initial + press));
    if (maximum <= MAX_TRANSPOSE && maximum < distance) {
      choice = sample;
      distance = maximum;
    }
  }
  if (!choice) throw new KotoSampleUnavailableError(note.frequency, press);
  return choice;
}

export function kotoSampleSupports(note: PhysicalKotoNote, bank: readonly KotoSample[], sampleRate = 48000): boolean {
  validateNote(note, sampleRate);
  validateBank(bank);
  try {
    selectSample(note, bank);
    return true;
  } catch (error) {
    if (error instanceof KotoSampleUnavailableError) return false;
    throw error;
  }
}

// One finite Blackman-windowed sinc table per note. Its cutoff accounts for
// the largest playback increment, including press, before samples are skipped.
function interpolationTable(cutoff: number): Float64Array {
  const table = new Float64Array((SINC_PHASES + 1) * SINC_TAPS);
  for (let phase = 0; phase <= SINC_PHASES; phase += 1) {
    let sum = 0;
    for (let tap = 0; tap < SINC_TAPS; tap += 1) {
      const distance = phase / SINC_PHASES + SINC_RADIUS - 1 - tap;
      const window = 0.42 + 0.5 * Math.cos(Math.PI * distance / SINC_RADIUS)
        + 0.08 * Math.cos(2 * Math.PI * distance / SINC_RADIUS);
      const x = Math.PI * cutoff * distance;
      const weight = Math.abs(distance) < SINC_RADIUS
        ? cutoff * (Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x) * window : 0;
      table[phase * SINC_TAPS + tap] = weight;
      sum += weight;
    }
    for (let tap = 0; tap < SINC_TAPS; tap += 1) table[phase * SINC_TAPS + tap] /= sum;
  }
  return table;
}

function renderSelectedSample(note: PhysicalKotoNote, sample: KotoSample, sampleRate: number, duration: number): Float32Array<ArrayBuffer> {
  const result = new Float32Array(Math.round(sampleRate * duration));
  if (note.velocity === 0) return result;
  const initialRate = sample.sampleRate / sampleRate * note.frequency / sample.rootFrequency;
  const press = note.pressSemitones ?? 0;
  const maximumRate = initialRate * 2 ** (press / 12);
  const table = interpolationTable(0.90 / Math.max(1, maximumRate));
  const level = note.velocity / REFERENCE_VELOCITY;
  let position = 0;
  for (let index = 0; index < result.length && position < sample.samples.length; index += 1) {
    const center = Math.floor(position);
    const phase = (position - center) * SINC_PHASES;
    const phaseIndex = Math.floor(phase);
    const fraction = phase - phaseIndex;
    let value = 0;
    for (let tap = 0; tap < SINC_TAPS; tap += 1) {
      const input = center - SINC_RADIUS + 1 + tap;
      if (input < 0 || input >= sample.samples.length) continue;
      const offset = phaseIndex * SINC_TAPS + tap;
      const coefficient = table[offset] * (1 - fraction) + table[offset + SINC_TAPS] * fraction;
      value += sample.samples[input] * coefficient;
    }
    const time = index / sampleRate;
    // Smooth touch attenuation is an amplitude approximation, not a recording
    // of hand contact or a newly excited body resonance.
    const damp = note.dampAt !== undefined && time > note.dampAt
      ? Math.exp(-Math.log(1000) * (time - note.dampAt) / 0.10) : 1;
    result[index] = value * level * damp;
    position += initialRate * 2 ** (press * pressFraction(time) / 12);
  }
  const fade = Math.min(Math.round(0.025 * sampleRate), Math.floor(result.length / 4));
  for (let index = 0; index < fade; index += 1) {
    result[result.length - 1 - index] *= Math.sin(index / fade * Math.PI / 2) ** 2;
  }
  return result;
}

export function renderSampleKotoNote(note: PhysicalKotoNote, bank: readonly KotoSample[], sampleRate = 48000): KotoSampleRenderResult {
  const duration = validateNote(note, sampleRate);
  validateBank(bank);
  const sample = selectSample(note, bank);
  const transpose = 12 * Math.log2(note.frequency / sample.rootFrequency);
  return {
    samples: renderSelectedSample(note, sample, sampleRate, duration),
    diagnostics: {
      method: 'sample', sampleId: sample.id, transposeSemitones: transpose,
      maximumTransposeSemitones: Math.max(Math.abs(transpose), Math.abs(transpose + (note.pressSemitones ?? 0))),
      warnings: ['Lossy preview, unverified string count, one velocity layer, short tails; human listening not performed.',
        ...(note.pressSemitones ? ['Press is variable-rate sample playback; body modes and duration shift together.'] : []),
        ...(note.pluckPosition === undefined ? [] : ['Sample pluck position is fixed by the recording.'])],
    },
  };
}

function lowpassPrefix(input: Float32Array, prefixFrames: number, sampleRate: number): Float32Array {
  const result = new Float32Array(prefixFrames);
  const kernel = new Float64Array(2 * HYBRID_FILTER_RADIUS + 1);
  const cutoff = 2 * HYBRID_CROSSOVER / sampleRate;
  let sum = 0;
  for (let index = 0; index < kernel.length; index += 1) {
    const distance = index - HYBRID_FILTER_RADIUS;
    const x = Math.PI * cutoff * distance;
    kernel[index] = cutoff * (distance === 0 ? 1 : Math.sin(x) / x)
      * (0.42 + 0.5 * Math.cos(Math.PI * distance / HYBRID_FILTER_RADIUS)
        + 0.08 * Math.cos(2 * Math.PI * distance / HYBRID_FILTER_RADIUS));
    sum += kernel[index];
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] /= sum;
  // Offline symmetric convolution compensates the 64-frame group delay. The
  // high band is x-low(x), so low+high reconstructs exactly the same physics.
  for (let index = 0; index < prefixFrames; index += 1) {
    let value = 0;
    for (let tap = 0; tap < kernel.length; tap += 1) {
      const source = index + tap - HYBRID_FILTER_RADIUS;
      if (source >= 0 && source < input.length) value += input[source] * kernel[tap];
    }
    result[index] = value;
  }
  return result;
}

export function renderHybridKotoNote(
  note: PhysicalKotoNote, bank: readonly KotoSample[], physicalRenderer: PhysicalKotoRenderer, sampleRate = 48000,
): KotoSampleRenderResult {
  validateNote(note, sampleRate);
  validateBank(bank);
  const physical = physicalRenderer(note, sampleRate);
  let selected: KotoSample;
  try {
    selected = selectSample(note, bank);
  } catch (error) {
    if (!(error instanceof KotoSampleUnavailableError)) throw error;
    return { samples: new Float32Array(physical), diagnostics: {
      method: 'physical-fallback', warnings: [error.message, 'No recorded attack is present for this note.'],
    } };
  }
  const sampleResult = renderSampleKotoNote(note, bank, sampleRate);
  const sampleDuration = selected.samples.length / selected.sampleRate
    * selected.rootFrequency / note.frequency / 2 ** ((note.pressSemitones ?? 0) / 12);
  const endSeconds = Math.min(0.145, sampleDuration * 0.55, physical.length / sampleRate);
  const startSeconds = endSeconds * 0.52;
  const prefixFrames = Math.min(physical.length, Math.ceil(endSeconds * sampleRate));
  const physicalLow = lowpassPrefix(physical, prefixFrames, sampleRate);
  const sampleLow = lowpassPrefix(sampleResult.samples, prefixFrames, sampleRate);
  let physicalEnergy = 0;
  let sampleEnergy = 0;
  let crossEnergy = 0;
  const compareStart = Math.round(0.004 * sampleRate);
  const compareEnd = Math.min(prefixFrames, Math.round(startSeconds * sampleRate));
  for (let index = compareStart; index < compareEnd; index += 1) {
    const p = physical[index] - physicalLow[index];
    const s = sampleResult.samples[index] - sampleLow[index];
    physicalEnergy += p * p;
    sampleEnergy += s * s;
    crossEnergy += p * s;
  }
  const correlation = crossEnergy / Math.sqrt(Math.max(1e-30, physicalEnergy * sampleEnergy));
  // Calibrate only the exchanged high band. Bounded gain prevents an almost
  // absent recorded band becoming amplified microphone/codec noise.
  const attackGain = Math.min(4, Math.sqrt(physicalEnergy / Math.max(sampleEnergy, 1e-30)));
  const result = new Float32Array(physical);
  let crossfadeNormalizationPeak = 1;
  for (let index = 0; index < prefixFrames; index += 1) {
    const time = index / sampleRate;
    const fraction = Math.max(0, Math.min(1, (time - startSeconds) / Math.max(1 / sampleRate, endSeconds - startSeconds)));
    const weight = Math.cos(fraction * Math.PI / 2) ** 2;
    const p = physical[index] - physicalLow[index];
    const s = sampleResult.samples[index] - sampleLow[index];
    const rho = Math.max(-0.95, Math.min(0.95, correlation));
    // The measured bands are largely uncorrelated. A linear fade would create
    // a high-band energy dip; this bounded covariance correction removes that
    // expected dip without trying to phase-lock the recorded fundamental.
    const normalization = 1 / Math.sqrt(Math.max(0.25,
      (1 - weight) ** 2 + weight ** 2 + 2 * rho * weight * (1 - weight)));
    crossfadeNormalizationPeak = Math.max(crossfadeNormalizationPeak, normalization);
    result[index] = physicalLow[index] + normalization * ((1 - weight) * p + weight * attackGain * s);
  }
  const fadeInFrames = Math.min(prefixFrames, Math.round(0.0005 * sampleRate));
  for (let index = 0; index < fadeInFrames; index += 1) {
    result[index] *= Math.sin(index / fadeInFrames * Math.PI / 2) ** 2;
  }
  return { samples: result, diagnostics: {
    ...sampleResult.diagnostics, method: 'hybrid', attackBandHz: HYBRID_CROSSOVER, attackGain,
    highBandCorrelation: correlation, highBandEnergyRatio: sampleEnergy * attackGain ** 2 / Math.max(physicalEnergy, 1e-30),
    handoffStartSeconds: startSeconds, handoffEndSeconds: endSeconds, crossfadeNormalizationPeak,
    warnings: [...sampleResult.diagnostics.warnings,
      'Complementary high-band attack replacement; physical fundamental/body/tail retained. Not calibrated commuted synthesis.',
      ...(attackGain === 4 ? ['Attack gain reached its safety bound; recorded high-band energy differs.'] : [])],
  } };
}
