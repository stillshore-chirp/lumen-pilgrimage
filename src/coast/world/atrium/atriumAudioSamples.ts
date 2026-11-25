import { coastRandom } from '../../terrain';
import type { AtriumSurface } from './atriumAcoustics';

const TAU = 2 * Math.PI;

function coefficient(cutoff: number, sampleRate: number): number {
  return 1 - Math.exp(-TAU * cutoff / sampleRate);
}

function softEnvelope(time: number, duration: number, fade = 0.24): number {
  const attack = Math.min(1, time / fade);
  const release = Math.min(1, Math.max(0, (duration - time) / fade));
  return attack * release;
}

function filteredNoise(
  data: Float32Array,
  random: () => number,
  sampleRate: number,
  lowCut: number,
  highCut: number,
  amplitude: (time: number) => number,
): void {
  const lowBand = coefficient(lowCut, sampleRate);
  const highBand = coefficient(highCut, sampleRate);
  let low = 0;
  let high = 0;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / sampleRate;
    const noise = random() * 2 - 1;
    low += (noise - low) * lowBand;
    high += (noise - high) * highBand;
    data[i] = (high - low) * amplitude(time);
  }
}

/** A quiet, non-linguistic crowd bed. Its short envelopes suggest activity without speech. */
export function createAtriumCrowdLoop(context: BaseAudioContext, seed: number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const duration = 11.2;
  const buffer = context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  const random = coastRandom(seed);
  const low = coefficient(135, sampleRate);
  const high = coefficient(1_950, sampleRate);
  let lowBand = 0;
  let highBand = 0;
  const pulses = Array.from({ length: 13 }, (_, index) => ({
    start: 0.30 + index * 0.79 + random() * 0.26,
    duration: 0.18 + random() * 0.44,
    level: 0.20 + random() * 0.26,
  }));
  // A few anonymous voiced grains give the cafe its cadence. Each grain has a
  // fixed, non-linguistic timbre; the randomized onset and short duration keep
  // it from forming words while making it audibly different from HVAC noise.
  const voices = Array.from({ length: 9 }, (_, index) => ({
    start: 0.48 + index * 1.13 + random() * 0.38,
    duration: 0.22 + random() * 0.48,
    f0: 128 + random() * 86,
    f1: 420 + random() * 280,
    f2: 920 + random() * 640,
    level: 0.07 + random() * 0.06,
    phase: random() * TAU,
  }));
  for (let i = 0; i < data.length; i += 1) {
    const time = i / sampleRate;
    const noise = random() * 2 - 1;
    lowBand += (noise - lowBand) * low;
    highBand += (noise - highBand) * high;
    let pulse = 0;
    for (const event of pulses) {
      const age = time - event.start;
      if (age < 0 || age > event.duration) continue;
      const rounded = Math.sin(TAU * (1.4 + 1.7 * age) * age) * 0.10;
      pulse += event.level * (0.66 + rounded) * Math.sin(Math.PI * age / event.duration);
    }
    let voiced = 0;
    for (const voice of voices) {
      const age = time - voice.start;
      if (age < 0 || age > voice.duration) continue;
      const envelope = Math.sin(Math.PI * age / voice.duration) ** 1.15;
      const vibrato = 1 + 0.025 * Math.sin(TAU * 4.1 * age + voice.phase);
      const carrier = Math.sin(voice.phase + TAU * voice.f0 * vibrato * age)
        + 0.36 * Math.sin(voice.phase * 0.7 + TAU * voice.f0 * vibrato * age * 2)
        + 0.17 * Math.sin(voice.phase * 1.3 + TAU * voice.f0 * vibrato * age * 3);
      const formants = 0.42 * Math.sin(TAU * (voice.f1 + 42 * Math.sin(TAU * 2.7 * age)) * age)
        + 0.27 * Math.sin(TAU * (voice.f2 + 68 * Math.sin(TAU * 2.1 * age)) * age);
      voiced += (carrier * 0.08 + formants * 0.055) * voice.level * envelope;
    }
    // Keep the first/last sample quiet for a loop with no hard transient.
    const seam = Math.min(1, time / 0.28, (duration - time) / 0.28);
    data[i] = (lowBand * 0.29 + (highBand - lowBand) * 0.36 + pulse + voiced) * seam * 0.46;
  }
  data[0] = 0;
  data[data.length - 1] = 0;
  return buffer;
}

/** A higher, sparser diffuse bed with a deliberately narrow band. */
export function createAtriumGalleryLoop(context: BaseAudioContext, seed: number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const duration = 13.6;
  const buffer = context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  const random = coastRandom(seed);
  const low = coefficient(260, sampleRate);
  const high = coefficient(3_600, sampleRate);
  let lowBand = 0;
  let highBand = 0;
  const pulses = Array.from({ length: 8 }, (_, index) => ({
    start: 0.7 + index * 1.55 + random() * 0.62,
    duration: 0.16 + random() * 0.31,
    level: 0.12 + random() * 0.15,
  }));
  for (let i = 0; i < data.length; i += 1) {
    const time = i / sampleRate;
    const noise = random() * 2 - 1;
    lowBand += (noise - lowBand) * low;
    highBand += (noise - highBand) * high;
    let voice = 0;
    for (const event of pulses) {
      const age = time - event.start;
      if (age < 0 || age > event.duration) continue;
      // Randomized vowel-like amplitude is intentionally non-periodic and contains no words.
      voice += event.level * Math.sin(Math.PI * age / event.duration)
        * (0.42 * Math.sin(TAU * 4.8 * age) + 0.58 * Math.sin(TAU * 7.4 * age));
    }
    const seam = Math.min(1, time / 0.32, (duration - time) / 0.32);
    data[i] = (lowBand * 0.20 + (highBand - lowBand) * 0.23 + voice) * seam * 0.34;
  }
  data[0] = 0;
  data[data.length - 1] = 0;
  return buffer;
}

/** HVAC/air-handling loop with a soft, local mid-band rather than a global wind bed. */
export function createAtriumAirLoop(context: BaseAudioContext, seed: number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const duration = 9.4;
  const buffer = context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  const random = coastRandom(seed);
  filteredNoise(data, random, sampleRate, 75, 1_250, time => {
    const seam = Math.min(1, time / 0.34, (duration - time) / 0.34);
    return seam * (0.54 + 0.12 * Math.sin(TAU * 0.17 * time) + 0.06 * Math.sin(TAU * 0.83 * time));
  });
  data[0] = 0;
  data[data.length - 1] = 0;
  return buffer;
}

/** A ceramic/metallic dish contact with no speech or identifiable source recording. */
export function createAtriumDishEvent(context: BaseAudioContext, seed: number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const duration = 0.68;
  const buffer = context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  const random = coastRandom(seed);
  const gritBand = coefficient(2_600, sampleRate);
  let grit = 0;
  const partials = [1_060 + random() * 80, 1_610 + random() * 120, 2_470 + random() * 170];
  const phases = partials.map(() => random() * TAU);
  const secondAt = 0.19 + random() * 0.02;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / sampleRate;
    const noise = random() * 2 - 1;
    grit += (noise - grit) * gritBand;
    const ring = partials.reduce((sum, frequency, index) =>
      sum + Math.sin(phases[index] + TAU * frequency * time) * Math.exp(-time * (8 + index * 3.4)), 0);
    const impact = Math.exp(-time * 46) * (grit * 0.24 + Math.sin(TAU * 115 * time) * 0.09);
    const secondAge = time - secondAt;
    const secondClink = secondAge > 0
      ? Math.exp(-secondAge * 37) * (grit * 0.13 + Math.sin(TAU * 173 * secondAge) * 0.07)
      : 0;
    data[i] = (impact + secondClink + ring * 0.035) * softEnvelope(time, duration, 0.006) * 0.72;
  }
  data[0] = 0;
  data[data.length - 1] = 0;
  return buffer;
}

/** Short, quiet higher-gallery activity; the waveform contains no recognizable words. */
export function createAtriumGalleryEvent(context: BaseAudioContext, seed: number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const duration = 0.94;
  const buffer = context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  const random = coastRandom(seed);
  const low = coefficient(280, sampleRate);
  const high = coefficient(2_800, sampleRate);
  let lowBand = 0;
  let highBand = 0;
  const pitch = 210 + random() * 70;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / sampleRate;
    const noise = random() * 2 - 1;
    lowBand += (noise - lowBand) * low;
    highBand += (noise - highBand) * high;
    const wobble = 1 + 0.08 * Math.sin(TAU * 3.2 * time);
    const tone = Math.sin(TAU * pitch * wobble * time) * 0.11;
    data[i] = (lowBand * 0.24 + (highBand - lowBand) * 0.19 + tone)
      * softEnvelope(time, duration, 0.12) * 0.33;
  }
  data[0] = 0;
  data[data.length - 1] = 0;
  return buffer;
}

const FOOTFALLS: Record<AtriumSurface, {
  contact: number; contactCutoff: number; brush: number; brushCutoff: number; decay: number; gain: number;
}> = {
  stone: { contact: 0.142, contactCutoff: 520, brush: 0.104, brushCutoff: 1_680, decay: 44, gain: 0.62 },
  rug: { contact: 0.046, contactCutoff: 255, brush: 0.038, brushCutoff: 720, decay: 19, gain: 0.38 },
  stair: { contact: 0.176, contactCutoff: 620, brush: 0.122, brushCutoff: 2_040, decay: 39, gain: 0.69 },
  gallery: { contact: 0.108, contactCutoff: 430, brush: 0.069, brushCutoff: 1_260, decay: 31, gain: 0.53 },
};

export function createAtriumFootfall(
  context: BaseAudioContext, surface: AtriumSurface, seed: number,
): AudioBuffer {
  const profile = FOOTFALLS[surface];
  const sampleRate = context.sampleRate;
  const duration = 0.19 + (surface === 'rug' ? 0.025 : 0.055);
  const buffer = context.createBuffer(1, Math.ceil(duration * sampleRate), sampleRate);
  const data = buffer.getChannelData(0);
  const random = coastRandom(seed);
  const contactBand = coefficient(profile.contactCutoff, sampleRate);
  const brushBand = coefficient(profile.brushCutoff, sampleRate);
  const lowBand = coefficient(90, sampleRate);
  const rise = 0.018 + random() * 0.011;
  const rollAt = 0.045 + random() * 0.023;
  let contact = 0;
  let sole = 0;
  let low = 0;
  let brush = 0;
  let cloth = 0;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / sampleRate;
    const noise = random() * 2 - 1;
    contact += (noise - contact) * contactBand;
    sole += (contact - sole) * contactBand;
    low += (sole - low) * lowBand;
    brush += (noise - brush) * brushBand;
    cloth += (brush - cloth) * brushBand;
    const compression = Math.min(1, time / rise) * (1 - Math.min(1, Math.max(0, (time - rise) / rollAt)));
    const scuff = Math.min(1, time / 0.014) * (1 - Math.min(1, Math.max(0, (time - rollAt) / 0.10)));
    const tail = Math.exp(-profile.decay * Math.max(0, time - rollAt));
    data[i] = profile.gain * ((sole - low) * profile.contact * compression
      + (cloth - sole) * profile.brush * scuff * tail);
  }
  data[0] = 0;
  data[data.length - 1] = 0;
  return buffer;
}

/** Stereo void tail: 1.86 s T60 with modest decorrelation and deterministic energy. */
export function createAtriumRoomTail(context: BaseAudioContext, seed: number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const duration = 1.96;
  const buffer = context.createBuffer(2, Math.ceil(sampleRate * duration), sampleRate);
  const t60 = 1.86;
  const lowCoefficient = coefficient(660, sampleRate);
  const highCoefficient = coefficient(5_900, sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const random = coastRandom(seed + channel * 97);
    const data = buffer.getChannelData(channel);
    let low = 0;
    let high = 0;
    for (let i = 0; i < data.length; i += 1) {
      const time = i / sampleRate;
      const noise = random() * 2 - 1;
      low += (noise - low) * lowCoefficient;
      high += (noise - high) * highCoefficient;
      const delayGate = Math.min(1, Math.max(0, (time - 0.010) / 0.012));
      const decay = Math.exp(-Math.log(1000) * time / t60);
      const asymmetry = channel === 0 ? 0.96 : 1.04;
      data[i] = (low * 0.64 + (high - low) * 0.32) * decay * delayGate
        * asymmetry * 0.053;
    }
    const taps = channel === 0
      ? [[0.014, 0.48], [0.028, 0.31], [0.046, 0.19]]
      : [[0.016, 0.43], [0.032, 0.28], [0.051, 0.22]];
    for (const [time, amplitude] of taps) {
      const index = Math.round(time * sampleRate);
      if (index < data.length) data[index] += amplitude * 0.011;
    }
  }
  return buffer;
}
