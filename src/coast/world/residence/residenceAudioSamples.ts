import { coastRandom, smoothstep } from '../../terrain';
import type { ResidenceSurface } from './residenceAcoustics';
import { RESIDENCE_ROOMS } from './residencePlan';

const SAMPLE_RATE = 24_000;
const TAU = 2 * Math.PI;

type RoomResponse = { size: readonly [number, number, number]; decay: number; damping: number; send: number };

function roomResponse(roomId: string, absorption: number, damping: number, send: number): RoomResponse {
  const room = RESIDENCE_ROOMS.find(room => room.id === roomId)!;
  const [west, south, east, north] = room.rectangles[0];
  const w = east - west;
  const h = room.ceiling!;
  const d = north - south;
  // Effective mid-band absorption includes furniture and open circulation paths.
  const decay = (0.161 * w * h * d) / (2 * (w * h + w * d + h * d) * absorption);
  return { size: [w, h, d], decay, damping, send };
}

export const RESIDENCE_ROOM_RESPONSES: readonly RoomResponse[] = [
  roomResponse('LD', 0.245, 0.47, 0.43),
  roomResponse('01', 0.32, 0.56, 0.31),
  roomResponse('03', 0.35, 0.58, 0.28),
  roomResponse('FO', 0.145, 0.31, 0.52),
  roomResponse('BA', 0.10, 0.20, 0.61),
  roomResponse('04', 0.45, 0.75, 0.23),
  roomResponse('05', 0.39, 0.66, 0.26),
];

function coefficient(cutoff: number, rate = SAMPLE_RATE): number {
  return 1 - Math.exp(-TAU * cutoff / rate);
}

export function createRoomImpulse(context: BaseAudioContext, profile: RoomResponse, seed: number): AudioBuffer {
  const { size, decay, damping } = profile;
  const [width, , depth] = size;
  // Web Audio convolution requires the impulse response to use its context's sample rate.
  const rate = context.sampleRate;
  const buffer = context.createBuffer(2, Math.ceil(rate * (decay + 0.035)), rate);
  const source = [width * 0.35, 0.75, depth * 0.40];
  const diffuseGain = 0.67 / Math.sqrt(rate * decay * 0.074);
  const lowBand = coefficient(720, rate);
  const highBand = coefficient(6_200, rate);
  const mixing = 0.013 + Math.hypot(...size) / 343;
  for (let channel = 0; channel < 2; channel += 1) {
    const random = coastRandom(seed + channel * 71);
    const data = buffer.getChannelData(channel);
    const ear = [width * 0.58 + (channel === 0 ? -0.085 : 0.085), 1.65, depth * 0.55];
    const direct = Math.hypot(...ear.map((value, axis) => value - source[axis]));
    let low = 0;
    let high = 0;
    for (let i = 0; i < data.length; i += 1) {
      const time = i / rate;
      const noise = random() * 2 - 1;
      low += (noise - low) * lowBand;
      high += (noise - high) * highBand;
      const tail = smoothstep(mixing * 0.38, mixing, time) * Math.exp(-Math.log(1000) * time / decay);
      const bright = (high - low) * Math.exp(-Math.log(1000) * damping * time / decay);
      data[i] = (low + bright * 0.48) * tail * diffuseGain;
    }

    // Mirror sources across floor, ceiling and each wall, with a weaker return from each
    // opposite face. Material damping spreads each arrival over a fraction of a millisecond.
    const reflection = 0.67 - damping * 0.35;
    const tapRate = coefficient(5_600 - damping * 5_000, rate);
    for (const [axis, length] of size.entries()) {
      const coordinate = source[axis];
      const images = [-coordinate, 2 * length - coordinate, coordinate - 2 * length, coordinate + 2 * length];
      for (const [order, mirrored] of images.entries()) {
        const image = source.slice();
        image[axis] = mirrored;
        const traveled = Math.hypot(...ear.map((value, index) => value - image[index]));
        const delay = (traveled - direct) / 343;
        const strength = reflection ** (order < 2 ? 1 : 2) * direct / traveled;
        const sample = Math.round(delay * rate);
        for (let i = 0; i < Math.ceil(rate * 0.001); i += 1) {
          data[sample + i] += strength * tapRate * (1 - tapRate) ** i;
        }
      }
    }
  }
  return buffer;
}

const SURFACES = {
  oak: { contact: 0.111, contactCutoff: 330, brush: 0.096, brushCutoff: 1_130 },
  stone: { contact: 0.116, contactCutoff: 430, brush: 0.126, brushCutoff: 1_500 },
  tile: { contact: 0.105, contactCutoff: 480, brush: 0.129, brushCutoff: 1_830 },
  balcony: { contact: 0.135, contactCutoff: 390, brush: 0.155, brushCutoff: 1_420 },
  tatami: { contact: 0.067, contactCutoff: 270, brush: 0.062, brushCutoff: 850 },
  wool: { contact: 0.058, contactCutoff: 235, brush: 0.046, brushCutoff: 650 },
} satisfies Record<ResidenceSurface, Record<string, number>>;

export function createFootfall(context: BaseAudioContext, surface: ResidenceSurface, seed: number): AudioBuffer {
  const { contact, contactCutoff, brush, brushCutoff } = SURFACES[surface];
  const random = coastRandom(seed);
  const rise = 0.026 + 0.010 * random();
  const rollAt = 0.059 + 0.025 * random();
  const duration = rollAt + 0.121 + 0.023 * random();
  const weight = 0.88 + 0.24 * random();
  const contactBand = coefficient(contactCutoff);
  const brushBand = coefficient(brushCutoff);
  const lowBand = coefficient(85);
  const buffer = context.createBuffer(1, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  let contactInput = 0;
  let sole = 0;
  let low = 0;
  let brushInput = 0;
  let cloth = 0;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / SAMPLE_RATE;
    const noise = random() * 2 - 1;
    contactInput += (noise - contactInput) * contactBand;
    sole += (contactInput - sole) * contactBand;
    low += (sole - low) * lowBand;
    brushInput += (noise - brushInput) * brushBand;
    cloth += (brushInput - cloth) * brushBand;
    // Let the sole compress, then brush across the floor as the weight rolls forward.
    const compression = smoothstep(0, rise, time) * (1 - smoothstep(rise, rollAt + 0.047, time));
    const scuff = smoothstep(0.016, rollAt, time) * (1 - smoothstep(rollAt, duration, time));
    data[i] = weight * ((sole - low) * contact * compression + (cloth - sole) * brush * scuff);
  }
  return buffer;
}

export function createVehicleSample(context: BaseAudioContext, seed: number): AudioBuffer {
  const duration = 12;
  const random = coastRandom(seed);
  const heavy = seed % 2 === 0;
  const bodyDamping = coefficient(heavy ? 145 : 205);
  const treadDamping = coefficient(heavy ? 1_120 : 2_100);
  const buffer = context.createBuffer(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  const idle = heavy ? 42 : 58;
  let phase = 0;
  let body = 0;
  let tread = 0;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / SAMPLE_RATE;
    const noise = 2 * random() - 1;
    body += (noise - body) * bodyDamping;
    tread += (noise - tread) * treadDamping;
    const throttle = 0.57 + 0.43 * smoothstep(1, 7.4, time);
    phase += (idle + 16 * throttle + 1.4 * Math.sin(time * 1.09)) * TAU / SAMPLE_RATE;
    const motor = (Math.sin(phase) + 0.24 * Math.sin(phase * 2) + 0.10 * Math.sin(phase * 3))
      * (heavy ? 0.039 : 0.014) * throttle;
    const rolling = (tread - body) * 0.38 + body * (heavy ? 0.76 : 0.38);
    const envelope = smoothstep(0, 3.2, time) * (1 - smoothstep(duration - 3.5, duration, time));
    data[i] = (motor + rolling) * envelope;
  }
  return buffer;
}

export function createSlider(context: BaseAudioContext, closing: boolean): AudioBuffer {
  const duration = 0.58;
  const random = coastRandom(closing ? 871 : 2046);
  const buffer = context.createBuffer(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  const bearing = coefficient(240);
  const rail = coefficient(1_820);
  let low = 0;
  let grit = 0;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / SAMPLE_RATE;
    const noise = random() * 2 - 1;
    low += (noise - low) * bearing;
    grit += (noise - grit) * rail;
    const roll = smoothstep(0.015, 0.11, time) * (1 - smoothstep(0.36, 0.52, time));
    const end = time - 0.48;
    const latch = end < 0 ? 0 : Math.min(1, end * 900) * Math.exp(-end * 86);
    data[i] = (low * 0.22 + (grit - low) * 0.056) * roll
      + (low * 0.45 + Math.sin(TAU * (closing ? 119 : 161) * end) * 0.12)
      * latch * (closing ? 0.75 : 0.41) * (1 - smoothstep(0.54, duration, time));
  }
  return buffer;
}

export function createInteriorDoorSound(context: BaseAudioContext, sliding: boolean, closing: boolean): AudioBuffer {
  const duration = 0.55;
  const random = coastRandom(sliding ? 705 : 1048);
  const buffer = context.createBuffer(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  const grain = coefficient(sliding ? 820 : 1_470);
  const weight = coefficient(220);
  let detail = 0;
  let low = 0;
  for (let i = 0; i < data.length; i += 1) {
    const time = i / SAMPLE_RATE;
    const noise = random() * 2 - 1;
    detail += (noise - detail) * grain;
    low += (noise - low) * weight;
    const moving = smoothstep(0.008, 0.080, time) * (1 - smoothstep(0.36, 0.47, time));
    const contact = time - (closing ? 0.47 : 0.036);
    const settle = smoothstep(0, 0.009, contact) * Math.exp(-Math.max(0, contact) * 54);
    const latch = Math.sin(TAU * (sliding ? 142 : 184) * contact) * 0.037 + low * 0.087;
    const slide = low * 0.12 + (detail - low) * 0.061;
    const swing = low * 0.047 + (detail - low) * (0.011 + 0.022 * Math.sin(TAU * 5.8 * time) ** 2);
    data[i] = ((sliding ? slide : swing) * moving + latch * settle * (closing ? 1 : 0.64))
      * (1 - smoothstep(0.52, duration, time));
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
