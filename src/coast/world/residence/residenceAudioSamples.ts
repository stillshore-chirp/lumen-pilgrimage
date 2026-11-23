import { coastRandom, smoothstep } from '../../terrain';
import type { ResidenceSurface } from './residenceAcoustics';

const SAMPLE_RATE = 24_000;
const TAU = 2 * Math.PI;

type RoomResponse = { decay: number; cutoff: number; reflections: readonly number[]; send: number };

export const RESIDENCE_ROOM_RESPONSES: readonly RoomResponse[] = [
  { decay: 0.52, cutoff: 2_900, reflections: [0.011, 0.022, 0.036], send: 0.42 },
  { decay: 0.29, cutoff: 1_670, reflections: [0.007, 0.013, 0.020], send: 0.30 },
  { decay: 0.65, cutoff: 4_200, reflections: [0.008, 0.014, 0.027], send: 0.59 },
];

function coefficient(cutoff: number, rate = SAMPLE_RATE): number {
  return 1 - Math.exp(-TAU * cutoff / rate);
}

export function createRoomImpulse(context: BaseAudioContext, profile: RoomResponse, seed: number): AudioBuffer {
  const { decay, cutoff, reflections } = profile;
  // Web Audio convolution requires the impulse response to use its context's sample rate.
  const rate = context.sampleRate;
  const buffer = context.createBuffer(2, Math.ceil(rate * (decay + 0.035)), rate);
  const diffuseGain = 1.25 / Math.sqrt(rate * decay * 0.074);
  const damping = coefficient(cutoff, rate);
  for (let channel = 0; channel < 2; channel += 1) {
    const random = coastRandom(seed + channel * 71);
    const data = buffer.getChannelData(channel);
    let filtered = 0;
    for (let i = 0; i < data.length; i += 1) {
      const time = i / rate;
      filtered += (random() * 2 - 1 - filtered) * damping;
      const tail = smoothstep(0.010, 0.031, time) * Math.exp(-Math.log(1000) * time / decay);
      data[i] = filtered * tail * diffuseGain;
    }
    for (const [index, delay] of reflections.entries()) {
      const sample = Math.round((delay + channel * (index % 2 ? 0.0019 : 0.0011)) * rate);
      const level = (0.41 - index * 0.072) * (index % 2 ? -1 : 1);
      data[sample] += level;
      data[sample + 1] += level * 0.32;
    }
  }
  return buffer;
}

const SURFACES = {
  oak: { duration: 0.16, body: 0.30, pitch: 116, texture: 0.22, cutoff: 1_480, tap: 0.12 },
  stone: { duration: 0.15, body: 0.23, pitch: 158, texture: 0.23, cutoff: 3_520, tap: 0.41 },
  tile: { duration: 0.14, body: 0.19, pitch: 192, texture: 0.25, cutoff: 4_550, tap: 0.50 },
  balcony: { duration: 0.17, body: 0.25, pitch: 130, texture: 0.40, cutoff: 2_580, tap: 0.25 },
} satisfies Record<ResidenceSurface, Record<string, number>>;

export function createFootfall(context: BaseAudioContext, surface: ResidenceSurface, seed: number): AudioBuffer {
  const { duration, body, pitch, texture, cutoff, tap } = SURFACES[surface];
  const random = coastRandom(seed);
  const toeAt = 0.042 + 0.025 * random();
  const tone = pitch * (0.89 + random() * 0.22);
  const damping = coefficient(cutoff);
  const buffer = context.createBuffer(1, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  let filtered = 0;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / SAMPLE_RATE;
    const noise = random() * 2 - 1;
    filtered += (noise - filtered) * damping;
    const heel = Math.min(1, time * 680) * Math.exp(-time * 51);
    const toeAge = Math.max(0, time - toeAt);
    const toe = Math.min(1, toeAge * 260) * Math.exp(-toeAge * 56);
    const pressure = Math.sin(TAU * tone * time) * body * heel;
    const scuff = filtered * texture * (heel * 0.68 + toe * 0.49);
    const click = (noise - filtered) * tap * (Math.exp(-time * 360) + 0.28 * toe);
    data[i] = (pressure + scuff + click * Math.min(1, time * 1800)) * (1 - smoothstep(duration - 0.025, duration, time));
  }
  return buffer;
}

export function createVehicleSample(context: BaseAudioContext, seed: number): AudioBuffer {
  const duration = 9.2;
  const random = coastRandom(seed);
  const heavy = seed % 2 === 0;
  const bodyDamping = coefficient(heavy ? 145 : 205);
  const treadDamping = coefficient(heavy ? 1_120 : 2_100);
  const buffer = context.createBuffer(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  const idle = heavy ? 43 : 62;
  let phase = 0;
  let body = 0;
  let tread = 0;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / SAMPLE_RATE;
    const noise = 2 * random() - 1;
    body += (noise - body) * bodyDamping;
    tread += (noise - tread) * treadDamping;
    const throttle = 0.65 + 0.35 * smoothstep(0.5, 4.7, time);
    phase += (idle + 23 * throttle + 2.9 * Math.sin(time * 1.09)) * TAU / SAMPLE_RATE;
    const motor = (Math.sin(phase) + 0.31 * Math.sin(phase * 2) + 0.10 * Math.sin(phase * 3))
      * (heavy ? 0.081 : 0.039) * throttle;
    const rolling = (tread - body) * 0.38 + body * (heavy ? 0.71 : 0.35);
    const envelope = smoothstep(0, 2.6, time) * (1 - smoothstep(duration - 3.0, duration, time));
    data[i] = (motor + rolling) * envelope;
  }
  return buffer;
}

export function createBreeze(context: BaseAudioContext): AudioBuffer {
  const duration = 3.5;
  const random = coastRandom(2821);
  const buffer = context.createBuffer(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  const soft = coefficient(385);
  const bass = coefficient(65);
  let low = 0;
  let air = 0;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / SAMPLE_RATE;
    const noise = random() * 2 - 1;
    low += (noise - low) * bass;
    air += (noise - air) * soft;
    const gust = smoothstep(0, 1.18, time) * (1 - smoothstep(1.3, duration, time));
    data[i] = (air - low) * gust * (0.77 + 0.23 * Math.sin(time * 8.3));
  }
  return buffer;
}
