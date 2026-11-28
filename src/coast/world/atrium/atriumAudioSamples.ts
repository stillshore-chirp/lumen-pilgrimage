import { coastRandom } from '../../terrain';
import { ATRIUM_ROOM_DECAY, type AtriumSurface } from './atriumAcoustics';

const TAU = 2 * Math.PI;

function coefficient(cutoff: number, sampleRate: number): number {
  return 1 - Math.exp(-TAU * cutoff / sampleRate);
}

const EQUIPMENT = {
  air: { seconds: 9.8, highCut: 1_050, lowCut: 82, tone: 0, toneGain: 0 },
  service: { seconds: 12.4, highCut: 420, lowCut: 45, tone: 67, toneGain: 0.006 },
} as const;

/** Duct airflow and the quieter hum leaking from a served space. */
export function createAtriumEquipmentLoop(
  context: BaseAudioContext, seed: number, kind: keyof typeof EQUIPMENT,
): AudioBuffer {
  const profile = EQUIPMENT[kind];
  const sampleRate = context.sampleRate;
  const frames = Math.round(profile.seconds * sampleRate);
  const buffer = context.createBuffer(1, frames, sampleRate);
  const data = buffer.getChannelData(0);
  const random = coastRandom(seed);
  const phase = TAU * random();
  const lowCoefficient = coefficient(profile.lowCut, sampleRate);
  const highCoefficient = coefficient(profile.highCut, sampleRate);
  const tone = Math.round(profile.tone * profile.seconds) / profile.seconds;
  const seam = Math.round(sampleRate * 0.075);
  let low = 0;
  let high = 0;
  for (let i = -seam; i < frames + seam; i += 1) {
    const time = i / sampleRate;
    const noise = random() * 2 - 1;
    low += (noise - low) * lowCoefficient;
    high += (noise - high) * highCoefficient;
    const drift = 0.96 + 0.04 * Math.sin(phase + TAU * time / profile.seconds);
    const motor = profile.toneGain * (Math.sin(TAU * tone * time) + 0.31 * Math.sin(TAU * tone * 2 * time));
    const sample = ((high - low) * 0.34 + low * 0.12) * drift + motor;
    if (i < 0) continue;
    if (i < frames) data[i] = sample;
    else {
      // Blend the continuation into the loop head so airflow never pauses at the seam.
      const offset = i - frames;
      const blend = Math.min(1, offset / Math.max(1, seam - 1));
      data[offset] = sample * Math.sqrt(1 - blend) + data[offset] * Math.sqrt(blend);
    }
  }
  return buffer;
}

const FOOTFALLS: Record<AtriumSurface, {
  contact: number; contactCutoff: number; brush: number; brushCutoff: number; decay: number; gain: number;
}> = {
  stone: { contact: 0.142, contactCutoff: 520, brush: 0.104, brushCutoff: 1_680, decay: 44, gain: 0.62 },
  wood: { contact: 0.126, contactCutoff: 350, brush: 0.082, brushCutoff: 1_120, decay: 32, gain: 0.54 },
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

/** Decorrelated late energy following the finite image arrivals. */
export function createAtriumRoomTail(
  context: BaseAudioContext, seed: number, room: keyof typeof ATRIUM_ROOM_DECAY,
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const rt60 = ATRIUM_ROOM_DECAY[room];
  const buffer = context.createBuffer(2, Math.ceil(sampleRate * (rt60 + 0.14)), sampleRate);
  const sheltered = room === 'sheltered';
  const onset = sheltered ? 0.016 : 0.029;
  const diffusion = sheltered ? 0.016 : 0.035;
  const lowCoefficient = coefficient(710, sampleRate);
  const highCoefficient = coefficient(sheltered ? 4_200 : 6_300, sampleRate);
  const decay = Math.log(1_000) / rt60;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const random = coastRandom(seed + channel * 97);
    const data = buffer.getChannelData(channel);
    let low = 0;
    let high = 0;
    let energy = 0;
    for (let i = Math.ceil(sampleRate * onset); i < data.length; i += 1) {
      const time = i / sampleRate - onset;
      const noise = random() * 2 - 1;
      low += (noise - low) * lowCoefficient;
      high += (noise - high) * highCoefficient;
      const rise = Math.min(1, time / diffusion);
      const release = Math.min(1, (data.length - 1 - i) / (0.04 * sampleRate));
      const lowTail = low * 0.64 * Math.exp(-decay * time);
      const highTail = (high - low) * 0.36 * Math.exp(-decay * 1.75 * time);
      const sample = (lowTail + highTail) * rise * release;
      data[i] = sample;
      energy += sample * sample;
    }
    // Both responses have comparable total energy before the live wet/dry mix.
    const gain = (sheltered ? 0.46 : 0.62) / Math.sqrt(energy);
    for (let i = 0; i < data.length; i += 1) data[i] *= gain;
  }
  return buffer;
}
