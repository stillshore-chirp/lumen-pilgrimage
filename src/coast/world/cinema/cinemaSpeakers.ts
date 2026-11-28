import { CINEMA_SCREEN, CINEMA_SIDE_SURROUNDS } from './cinemaLayout';
import { createCinemaObjectRouter } from './cinemaObjectRouting';
import {
  CINEMA_SAMPLE_RATE, type CinemaChannel, type CinemaPoint, type CinemaProgram,
} from './cinemaProgram';

export type CinemaRenderSpeakerKind = 'screen' | 'side' | 'rear' | 'top' | 'screenSub' | 'surroundSub';

export interface CinemaRenderSpeaker {
  readonly id: string;
  readonly kind: CinemaRenderSpeakerKind;
  readonly position: CinemaPoint;
  /** Unit vector in the speaker's acoustic forward direction. */
  readonly aim: CinemaPoint;
  /** Fixed alignment delay at the R11 calibration seat, in 48 kHz samples. */
  readonly delaySamples: number;
  /** Per-speaker calibration gain expressed as linear amplitude. */
  readonly gain: number;
}

const REFERENCE_LISTENER: CinemaPoint = [0, 5.00, 35.85];
const SOUND_SPEED_METRES_PER_SECOND = 343;
const FRONT_SCREEN_X = [-13.31, -6.655, 0, 6.655, 13.31] as const;
const REAR_COUNT = 12;
const TOP_COUNT = 8;

function point(x: number, y: number, z: number): CinemaPoint {
  return [x, y, z];
}

function normalizedAim(position: CinemaPoint, target: CinemaPoint): CinemaPoint {
  const dx = target[0] - position[0];
  const dy = target[1] - position[1];
  const dz = target[2] - position[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < Number.EPSILON) return [0, 0, 1];
  return [dx / length, dy / length, dz / length];
}

function renderSpeaker(
  id: string,
  kind: CinemaRenderSpeakerKind,
  position: CinemaPoint,
  target: CinemaPoint = REFERENCE_LISTENER,
): CinemaRenderSpeaker {
  return {
    id,
    kind,
    position,
    aim: normalizedAim(position, target),
    delaySamples: 0,
    gain: 1,
  };
}

const screenCenterY = CINEMA_SCREEN.bottom + CINEMA_SCREEN.height * 2 / 3;
const screenDepth = -1.4;
const distanceToReference = (x: number) => Math.hypot(
  x - REFERENCE_LISTENER[0], screenCenterY - REFERENCE_LISTENER[1], screenDepth - REFERENCE_LISTENER[2],
);
const furthestScreen = Math.max(...FRONT_SCREEN_X.map(distanceToReference));
const screenSpeakers = FRONT_SCREEN_X.map((x, index) => {
  const id = ['L', 'LC', 'C', 'RC', 'R'][index];
  const speaker = renderSpeaker(`screen-${id}`, 'screen', point(x, screenCenterY, screenDepth));
  // Align the five modeled first arrivals at R11. Device latency is measured separately.
  const delaySamples = Math.round((furthestScreen - distanceToReference(x))
    * CINEMA_SAMPLE_RATE / SOUND_SPEED_METRES_PER_SECOND);
  return { ...speaker, delaySamples };
});

const sideSpeakers = ([-1, 1] as const).flatMap(sign => CINEMA_SIDE_SURROUNDS.map(({ x, y, z }, index) => {
  const position = point(sign * x, y, z);
  // Side cabinets cover the seat row at their own depth and aim inward/down.
  const target = point(0, 5, z);
  return renderSpeaker(`side-${sign < 0 ? 'L' : 'R'}-${String(index + 1).padStart(2, '0')}`,
    'side', position, target);
}));

const rearSpeakers = Array.from({ length: REAR_COUNT }, (_, index) => {
  const x = -17.60 + index * 35.2 / 11;
  const position = point(x, 12.38, 52.999);
  return renderSpeaker(`rear-${String(index + 1).padStart(2, '0')}`, 'rear', position,
    point(0, 5, 35.85));
});

const topSpeakers = ([-1, 1] as const).flatMap(sign => Array.from({ length: TOP_COUNT }, (_, index) => {
  const z = 8 + index * 6;
  const position = point(sign * 6.655, 20.381, z);
  const target = point(0, 5, z);
  return renderSpeaker(`top-${sign < 0 ? 'L' : 'R'}-${String(index + 1).padStart(2, '0')}`,
    'top', position, target);
}));

const screenSubs = ([-1, 1] as const).map(sign => {
  const position = point(sign * 4, 1, -1.4);
  return renderSpeaker(`screen-sub-${sign < 0 ? 'L' : 'R'}`, 'screenSub', position);
});

const surroundSubs = ([-1, 1] as const).map(sign => {
  const position = point(sign * 13, 11, 53);
  return renderSpeaker(`surround-sub-${sign < 0 ? 'L' : 'R'}`, 'surroundSub', position);
});

/** Shared output table for the renderer and the auditorium's visible cabinets. */
export const CINEMA_RENDER_SPEAKERS: readonly CinemaRenderSpeaker[] = [
  ...screenSpeakers,
  ...sideSpeakers,
  ...rearSpeakers,
  ...topSpeakers,
  ...screenSubs,
  ...surroundSubs,
];

const speakerIndex = new Map(CINEMA_RENDER_SPEAKERS.map((speaker, index) => [speaker.id, index]));
const fullRangeSpeakers = CINEMA_RENDER_SPEAKERS
  .map((speaker, index) => ({ speaker, index }))
  .filter(({ speaker }) => speaker.kind !== 'screenSub' && speaker.kind !== 'surroundSub');

function linearGain(db: number): number {
  return 10 ** (db / 20);
}

function energyNormalize(weights: readonly { readonly index: number; readonly value: number }[], gain: number) {
  const energy = Math.sqrt(weights.reduce((sum, weight) => sum + weight.value ** 2, 0));
  if (!(energy > 0) || !Number.isFinite(energy) || !Number.isFinite(gain)) return [];
  return weights.map(weight => ({ index: weight.index, value: weight.value * gain / energy }));
}

function speakerGroup(kind: 'side' | 'rear' | 'top', sign?: -1 | 1): readonly { index: number; speaker: CinemaRenderSpeaker }[] {
  return fullRangeSpeakers.filter(({ speaker }) => speaker.kind === kind && (
    sign === undefined || Math.sign(speaker.position[0]) === sign
  ));
}

function channelGroup(channel: CinemaChannel): readonly { index: number; speaker: CinemaRenderSpeaker }[] {
  switch (channel) {
    case 'Ls':
      return fullRangeSpeakers.filter(({ speaker }) => speaker.kind === 'side' && speaker.position[0] < 0)
        .concat(fullRangeSpeakers.filter(({ speaker }) => speaker.kind === 'rear' && speaker.position[0] < 0));
    case 'Rs':
      return fullRangeSpeakers.filter(({ speaker }) => speaker.kind === 'side' && speaker.position[0] > 0)
        .concat(fullRangeSpeakers.filter(({ speaker }) => speaker.kind === 'rear' && speaker.position[0] > 0));
    case 'Bsl':
      return speakerGroup('rear').filter(({ speaker }) => speaker.position[0] < 0 || speaker.position[0] === 0);
    case 'Bsr':
      return speakerGroup('rear').filter(({ speaker }) => speaker.position[0] > 0);
    case 'Ltf':
      return speakerGroup('top', -1).filter(({ speaker }) => speaker.position[2] <= 32);
    case 'Rtf':
      return speakerGroup('top', 1).filter(({ speaker }) => speaker.position[2] <= 32);
    case 'Ltr':
      return speakerGroup('top', -1).filter(({ speaker }) => speaker.position[2] > 32);
    case 'Rtr':
      return speakerGroup('top', 1).filter(({ speaker }) => speaker.position[2] > 32);
    default:
      return [];
  }
}

function screenChannelId(channel: CinemaChannel): string | undefined {
  switch (channel) {
    case 'L': return 'screen-L';
    case 'LC': return 'screen-LC';
    case 'C': return 'screen-C';
    case 'RC': return 'screen-RC';
    case 'R': return 'screen-R';
    default: return undefined;
  }
}

function screenWeights(channel: CinemaChannel, mono: boolean): readonly { index: number; value: number }[] {
  if (channel === 'LFE') {
    return screenSubs.map(({ id }) => ({ index: speakerIndex.get(id)!, value: 1 }));
  }
  const id = mono ? 'screen-C' : screenChannelId(channel);
  const index = id === undefined ? undefined : speakerIndex.get(id);
  return index === undefined ? [] : [{ index, value: 1 }];
}

function bedWeights(channel: CinemaChannel, mono: boolean): readonly { index: number; value: number }[] {
  const screen = screenWeights(channel, mono);
  if (screen.length > 0) return screen;
  return channelGroup(channel).map(({ index }) => ({ index, value: 1 }));
}

function withSpeakerGains(weights: readonly { readonly index: number; readonly value: number }[]) {
  return weights.map(weight => ({
    index: weight.index,
    value: weight.value * CINEMA_RENDER_SPEAKERS[weight.index].gain,
  }));
}

const objectRouter = createCinemaObjectRouter(CINEMA_RENDER_SPEAKERS);

function interpolateNumber(previous: number, next: number, fraction: number): number {
  const difference = next - previous;
  return Number.isFinite(difference)
    ? previous + difference * fraction
    : previous * (1 - fraction) + next * fraction;
}

function buildCinemaRouting(
  program: CinemaProgram,
  sample: number,
  target?: Float32Array,
  objectGainDbTarget?: Float64Array,
): Float32Array {
  const inputCount = program.bed.length + program.objects.length;
  const outputLength = CINEMA_RENDER_SPEAKERS.length * inputCount;
  const output = target ?? new Float32Array(outputLength);
  if (output.length < outputLength) throw new RangeError('Cinema routing target is too small');
  if (objectGainDbTarget && objectGainDbTarget.length < program.objects.length) {
    throw new RangeError('Cinema object dB target is too small');
  }
  output.fill(0);
  objectGainDbTarget?.fill(0);
  if (!Number.isFinite(sample)) return output;

  program.bed.forEach((channel, inputIndex) => {
    const weights = withSpeakerGains(bedWeights(channel, program.bed.length === 1));
    const gain = channel === 'LFE' ? linearGain(program.lfeGainDb) : 1;
    energyNormalize(weights, gain).forEach(({ index, value }) => {
      output[index * inputCount + inputIndex] = value;
    });
  });

  for (let objectIndex = 0; objectIndex < program.objects.length; objectIndex += 1) {
    const keys = program.objects[objectIndex].keys;
    if (keys.length === 0) continue;
    let lower = 0;
    let upper = keys.length - 1;
    if (sample <= keys[0].sample) upper = 0;
    else if (sample >= keys[upper].sample) lower = upper;
    else {
      // Source metadata permits 100,000 keys per track. Endpoint lookup must not
      // scan the whole history at every PCM packet or key split.
      while (upper - lower > 1) {
        const middle = (lower + upper) >>> 1;
        if (keys[middle].sample < sample) lower = middle;
        else upper = middle;
      }
    }
    const previous = keys[lower];
    const next = keys[upper];
    const span = next.sample - previous.sample;
    const fraction = span > 0 ? Math.max(0, Math.min(1, (sample - previous.sample) / span)) : 0;
    const x = interpolateNumber(previous.position[0], next.position[0], fraction);
    const y = interpolateNumber(previous.position[1], next.position[1], fraction);
    const z = interpolateNumber(previous.position[2], next.position[2], fraction);
    const gainDb = interpolateNumber(previous.gainDb, next.gainDb, fraction);
    const inputIndex = program.bed.length + objectIndex;
    const active = objectRouter.write(x, y, z, output, inputCount, inputIndex);
    if (objectGainDbTarget) {
      // Keep the original dB value in Float64: a Float32 linear endpoint would
      // erase e.g. -1000 dB before interpolation back towards audible levels.
      objectGainDbTarget[objectIndex] = active ? gainDb : 0;
    } else {
      const amplitude = linearGain(gainDb);
      const gain = Number.isFinite(amplitude) ? amplitude : 0;
      for (let index = 0; index < CINEMA_RENDER_SPEAKERS.length; index += 1) {
        output[index * inputCount + inputIndex] *= gain;
      }
    }
  }
  return output;
}

/**
 * Build an energy-normalized speaker-by-input matrix including programme gain.
 * Inputs are the declared bed channels, followed by object tracks. Retained for
 * callers and packets that have no separate object dB metadata.
 */
export function createCinemaRouting(
  program: CinemaProgram,
  sample: number,
  target?: Float32Array,
): Float32Array {
  return buildCinemaRouting(program, sample, target);
}

/**
 * Bed columns retain complete gain; object columns contain calibrated unit
 * spatial shapes. objectGainDbTarget receives programme dB in object order.
 * Empty keys or inactive calibration produce zero shapes. The renderer applies
 * programme dB once on the PCM/key clock and never reapplies speaker calibration.
 */
export function createCinemaRoutingShapes(
  program: CinemaProgram,
  sample: number,
  target: Float32Array,
  objectGainDbTarget: Float64Array,
): Float32Array {
  return buildCinemaRouting(program, sample, target, objectGainDbTarget);
}
