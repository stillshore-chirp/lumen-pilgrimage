import { MathUtils } from 'three';
import type { LakePoint } from './lakeAudioAcoustics';
import { LAKE_HALL } from './lakeLayout';

const { halfWidth, frontZ, rearZ, ceilingY } = LAKE_HALL;
const COLUMNS = [-0.75, -0.25, 0.25, 0.75] as const;
const ROWS = [1 / 6, 1 / 2, 5 / 6] as const;
const ARRAY_GAIN = 0.66;

export const LAKE_KOTO_SPEAKERS: readonly LakePoint[] = ROWS.flatMap(row =>
  COLUMNS.map(column => ({
    x: halfWidth * column,
    y: ceilingY - 0.12,
    z: MathUtils.lerp(frontZ, rearZ, row),
  })),
);

export function lakeKotoSpeakerGains(
  listener: LakePoint, gains = new Float64Array(LAKE_KOTO_SPEAKERS.length),
): Float64Array {
  const wallDistance = Math.min(halfWidth - Math.abs(listener.x), listener.z - frontZ, rearZ - listener.z,
    listener.y, ceilingY - listener.y);
  const room = MathUtils.smoothstep(wallDistance, 0, 0.85);
  let sum = 0;
  let nearest = Infinity;
  LAKE_KOTO_SPEAKERS.forEach((speaker, index) => {
    const distance = Math.hypot(speaker.x - listener.x, speaker.y - listener.y, speaker.z - listener.z);
    const weight = (1 + (distance / 5.5) ** 2) ** -2.5;
    gains[index] = weight;
    sum += weight;
    nearest = Math.min(nearest, distance);
  });

  // Shared mono playback can add coherently; this bounds the gains before HRTF filtering.
  const scale = ARRAY_GAIN * room / ((1 + nearest / 10) * sum);
  for (let i = 0; i < LAKE_KOTO_SPEAKERS.length; i += 1) gains[i] *= scale;
  return gains;
}

export interface LakeKotoSpeakerArray {
  readonly input: GainNode;
  update(listener: LakePoint, now: number, immediate?: boolean): void;
  dispose(): void;
}

// Production and dry/spatial comparisons use the same routing. The owner updates context.listener.
export function createLakeKotoSpeakerArray(context: BaseAudioContext, output: AudioNode): LakeKotoSpeakerArray {
  const input = context.createGain();
  input.channelCount = 1;
  input.channelCountMode = 'explicit';
  const gains = new Float64Array(LAKE_KOTO_SPEAKERS.length);
  const speakers = LAKE_KOTO_SPEAKERS.map(({ x, y, z }) => {
    const level = context.createGain();
    level.gain.value = 0;
    // The distance weighting is applied above, so the PannerNode must not apply it twice.
    const panner = new PannerNode(context, {
      panningModel: 'HRTF', rolloffFactor: 0, positionX: x, positionY: y, positionZ: z,
    });
    input.connect(level).connect(panner).connect(output);
    return { level, panner };
  });
  let disposed = false;
  return {
    input,
    update(listener, now, immediate = false) {
      if (disposed) return;
      lakeKotoSpeakerGains(listener, gains);
      speakers.forEach(({ level }, index) => {
        if (immediate) {
          level.gain.cancelScheduledValues(now);
          level.gain.setValueAtTime(gains[index], now);
        } else {
          level.gain.setTargetAtTime(gains[index], now, 0.075);
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      input.disconnect();
      for (const { level, panner } of speakers) {
        level.disconnect();
        panner.disconnect();
      }
    },
  };
}
