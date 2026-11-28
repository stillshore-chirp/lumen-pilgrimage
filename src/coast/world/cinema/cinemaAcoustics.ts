import { Vector3 } from 'three';
import {
  CINEMA_BOUNDS, CINEMA_DESTINATIONS, CINEMA_ROOM_HEIGHT, CINEMA_ROWS, CINEMA_SCREEN,
  CINEMA_SIDE_SURROUNDS,
  cinemaGroundHeight,
} from './cinemaLayout';

import {
  CINEMA_BANDS, CINEMA_SURFACE_GAINS, cinemaSeatingClearance, cinemaSourceBandLoss,
} from './cinemaPropagation';
export { CINEMA_BANDS, CINEMA_SCREEN_BANDS, CINEMA_WOVEN_FABRIC } from './cinemaPropagation';
export const CINEMA_T60 = [1.25, 1.12, 1, 0.92, 0.80, 0.65] as const;
const SOUND_SPEED = 343;
const MAX_REFLECTION_DELAY = 0.080;
const LATE_START = 0.055;

export interface CinemaSpeaker {
  readonly id: 'L' | 'R' | 'C' | 'LFE' | 'SL' | 'SR';
  readonly position: Vector3;
  readonly aim: Vector3;
  readonly screen: boolean;
}

const centerSeat = CINEMA_DESTINATIONS[0];
const referenceSeat = new Vector3(centerSeat.x,
  cinemaGroundHeight(centerSeat.x, centerSeat.z) + centerSeat.seatedEyeHeight, centerSeat.z);
const makeSpeaker = (id: CinemaSpeaker['id'], position: Vector3, screen: boolean): CinemaSpeaker => ({
  id, position, screen, aim: referenceSeat.clone().sub(position).normalize(),
});
const screenSpeaker = (id: CinemaSpeaker['id'], x: number) => makeSpeaker(id,
  new Vector3(x, CINEMA_SCREEN.bottom + CINEMA_SCREEN.height * 2 / 3, CINEMA_SCREEN.z - 1.4), true);

const sideSurround = CINEMA_SIDE_SURROUNDS[6];
// Web Audio speakers order for a verified 5.1 stream.
export const CINEMA_SPEAKERS = [
  screenSpeaker('L', -13.31), screenSpeaker('R', 13.31), screenSpeaker('C', 0),
  makeSpeaker('LFE', new Vector3(2.25, 2, -1.4), false),
  makeSpeaker('SL', new Vector3(-sideSurround.x, sideSurround.y, sideSurround.z), false),
  makeSpeaker('SR', new Vector3(sideSurround.x, sideSurround.y, sideSurround.z), false),
] as const;

export type CinemaQuality = 'light' | 'high';
export const CINEMA_REFLECTION_LIMIT: Record<CinemaQuality, number> = { light: 4, high: 12 };

interface Reflector {
  id: 'left' | 'right' | 'rear' | 'ceiling';
  axis: 'x' | 'y' | 'z';
  at: number;
  gain: readonly number[];
}

const surfaces: readonly Reflector[] = [
  { id: 'left', axis: 'x', at: CINEMA_BOUNDS.minX, gain: CINEMA_SURFACE_GAINS.left },
  { id: 'right', axis: 'x', at: CINEMA_BOUNDS.maxX, gain: CINEMA_SURFACE_GAINS.right },
  { id: 'rear', axis: 'z', at: CINEMA_BOUNDS.maxZ, gain: CINEMA_SURFACE_GAINS.rear },
  { id: 'ceiling', axis: 'y', at: CINEMA_ROOM_HEIGHT, gain: CINEMA_SURFACE_GAINS.ceiling },
];

export interface CinemaReflection {
  readonly surface: Reflector['id'];
  readonly point: Vector3;
  readonly delay: number;
  readonly amplitude: readonly number[];
}

export function cinemaDecibels(db: number): number {
  return 10 ** (db / 20);
}

export function cinemaSeatTrim(listener: Vector3): number {
  const center = CINEMA_SPEAKERS[2].position;
  const ratio = Math.max(1, center.distanceTo(listener)) / center.distanceTo(referenceSeat);
  return Math.max(-1.5, Math.min(1.5, -6.6 * Math.log10(ratio)));
}

export function cinemaSeatDrr(listener: Vector3): number {
  const z = listener.z;
  if (z <= referenceSeat.z) return 16 - 3 * Math.max(0, (z - CINEMA_ROWS[0].z) / (referenceSeat.z - CINEMA_ROWS[0].z));
  const row15 = CINEMA_ROWS[14].z;
  if (z < row15) return 13 - 2 * (z - referenceSeat.z) / (row15 - referenceSeat.z);
  return 11 - Math.min(1, (z - row15) / (CINEMA_ROWS[19].z - row15));
}

export function cinemaSpeakerLoss(speaker: CinemaSpeaker, point: Vector3, distance: number): number[] {
  return cinemaSourceBandLoss({
    position: [speaker.position.x, speaker.position.y, speaker.position.z],
    aim: [speaker.aim.x, speaker.aim.y, speaker.aim.z], subwoofer: speaker.id === 'LFE',
  }, [point.x, point.y, point.z], distance);
}

function insideRoom(point: Vector3): boolean {
  const margin = 1e-6;
  return point.x >= CINEMA_BOUNDS.minX - margin && point.x <= CINEMA_BOUNDS.maxX + margin
    && point.z >= CINEMA_BOUNDS.minZ - margin && point.z <= CINEMA_BOUNDS.maxZ + margin
    && point.y >= cinemaGroundHeight(point.x, point.z) - margin && point.y <= CINEMA_ROOM_HEIGHT + margin;
}

function blockedBySeating(from: Vector3, to: Vector3): boolean {
  return cinemaSeatingClearance([from.x, from.y, from.z], [to.x, to.y, to.z]).blocked;
}

export function cinemaReflectionTaper(seconds: number): number {
  if (seconds <= 0.050) return 1;
  if (seconds >= MAX_REFLECTION_DELAY) return 0;
  return (1 + Math.cos(Math.PI * (seconds - 0.050) / 0.030)) * 0.5;
}

export function cinemaReflections(speaker: CinemaSpeaker, listener: Vector3): CinemaReflection[] {
  const source = speaker.position;
  const direct = source.distanceTo(listener);
  if (direct < 0.01 || !insideRoom(listener) || speaker.id === 'LFE') return [];
  return surfaces.flatMap(surface => {
    const image = source.clone();
    image[surface.axis] = 2 * surface.at - source[surface.axis];
    const factor = (surface.at - listener[surface.axis]) / (image[surface.axis] - listener[surface.axis]);
    if (!(factor > 0 && factor < 1)) return [];
    const point = listener.clone().lerp(image, factor);
    if (!insideRoom(point) || blockedBySeating(source, point) || blockedBySeating(point, listener)) return [];
    const path = image.distanceTo(listener);
    const delay = (path - direct) / SOUND_SPEED;
    if (delay <= 0) return [];
    const losses = cinemaSpeakerLoss(speaker, point, path);
    const amplitude = surface.gain.map((gain, i) => cinemaDecibels(losses[i]) * direct / path * gain);
    return [{ surface: surface.id, point, delay, amplitude }];
  });
}

export function createCinemaTail(context: BaseAudioContext, seed: number): AudioBuffer {
  const rate = context.sampleRate;
  const late = Math.ceil(LATE_START * rate);
  const length = late + Math.ceil(1.43 * rate);
  const result = context.createBuffer(2, length, rate);
  for (let side = 0; side < result.numberOfChannels; side += 1) {
    const target = result.getChannelData(side);
    let random = (seed + 31 * side) >>> 0;
    let energy = 0;
    const damping = CINEMA_BANDS.map(hz => 1 - Math.exp(-2 * Math.PI * Math.SQRT2 * hz / rate));
    const decay = CINEMA_T60.map(seconds => 10 ** (-3 / (rate * seconds)));
    const envelope = CINEMA_T60.map(() => 1);
    const state = CINEMA_BANDS.map(() => 0);
    for (let i = late; i < length; i += 1) {
      random = (Math.imul(1664525, random) + 1013904223) >>> 0;
      const noise = random / 2 ** 31 - 1;
      let sample = 0;
      let lower = 0;
      for (let band = 0; band < CINEMA_BANDS.length; band += 1) {
        state[band] += (noise - state[band]) * damping[band];
        sample += (state[band] - lower) * envelope[band];
        lower = state[band];
        envelope[band] *= decay[band];
      }
      // Retain the short, bright tail above the top modelled octave. This
      // prevents normalization of the IR from over-emphasizing its low bands.
      sample += 0.68 * (noise - lower) * envelope[envelope.length - 1];
      const ramp = Math.min(1, (i - late) / (0.020 * rate));
      target[i] = sample * ramp * ramp;
      energy += target[i] ** 2;
    }
    const gain = 1 / Math.sqrt(2 * energy);
    for (let i = late; i < length; i += 1) target[i] *= gain;
  }
  return result;
}
