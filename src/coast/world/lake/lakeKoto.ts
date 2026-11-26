import { MathUtils } from 'three';
import type { LakePoint } from './lakeAudioAcoustics';
import { LAKE_HALL } from './lakeLayout';
import { LAKE_KOTO_SAMPLE_RATE, renderLakeKoto } from './lakeKotoScore';

const { halfWidth, frontZ, rearZ, ceilingY } = LAKE_HALL;
const COLUMNS = [-0.75, -0.25, 0.25, 0.75] as const;
const ROWS = [1 / 6, 1 / 2, 5 / 6] as const;
const ARRAY_GAIN = 0.66;
const FADE_SECONDS = 0.065;

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

  // The playback is shared, so cap the sum of amplitudes even when the signals add coherently.
  const scale = ARRAY_GAIN * room / ((1 + nearest / 10) * sum);
  for (let i = 0; i < LAKE_KOTO_SPEAKERS.length; i += 1) gains[i] *= scale;
  return gains;
}

interface Speaker {
  readonly level: GainNode;
  readonly panner: PannerNode;
}

interface Playback {
  readonly source: AudioBufferSourceNode;
  readonly level: GainNode;
  readonly startedAt: number;
}

export class LakeKoto {
  private readonly buffer: AudioBuffer;
  private readonly speakers: readonly Speaker[];
  private readonly gains = new Float64Array(LAKE_KOTO_SPEAKERS.length);
  private readonly fading = new Set<Playback>();
  private current?: Playback;

  constructor(private readonly context: AudioContext, output: AudioNode) {
    const samples = renderLakeKoto();
    this.buffer = context.createBuffer(1, samples.length, LAKE_KOTO_SAMPLE_RATE);
    this.buffer.copyToChannel(samples, 0);
    this.speakers = LAKE_KOTO_SPEAKERS.map(({ x, y, z }) => {
      const level = context.createGain();
      level.gain.value = 0;
      const panner = new PannerNode(context, {
        panningModel: 'HRTF', rolloffFactor: 0, positionX: x, positionY: y, positionZ: z,
      });
      level.connect(panner).connect(output);
      return { level, panner };
    });
  }

  get playing(): boolean {
    return this.current !== undefined;
  }

  play(listener: LakePoint): void {
    if (this.current) return;
    const now = this.context.currentTime;
    this.update(listener, now, true);
    const source = this.context.createBufferSource();
    const level = this.context.createGain();
    source.buffer = this.buffer;
    source.loop = true;
    level.gain.setValueAtTime(0, now);
    level.gain.linearRampToValueAtTime(1, now + FADE_SECONDS);
    source.connect(level);
    for (const speaker of this.speakers) level.connect(speaker.level);
    const playback = { source, level, startedAt: now };
    source.onended = () => {
      source.disconnect();
      level.disconnect();
      this.fading.delete(playback);
    };
    source.start(now);
    this.current = playback;
  }

  stop(): void {
    const playback = this.current;
    if (!playback) return;
    this.current = undefined;
    const { source, level } = playback;
    const now = this.context.currentTime;
    this.fading.add(playback);
    level.gain.cancelScheduledValues(now);
    level.gain.setValueAtTime(Math.min(1, (now - playback.startedAt) / FADE_SECONDS), now);
    level.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
    source.stop(now + FADE_SECONDS);
  }

  update(listener: LakePoint, now: number, immediate = false): void {
    lakeKotoSpeakerGains(listener, this.gains);
    this.speakers.forEach(({ level }, index) => {
      if (immediate) {
        level.gain.cancelScheduledValues(now);
        level.gain.setValueAtTime(this.gains[index], now);
      } else {
        level.gain.setTargetAtTime(this.gains[index], now, 0.075);
      }
    });
  }

  dispose(): void {
    this.stop();
    for (const { source, level } of this.fading) {
      source.onended = null;
      source.disconnect();
      level.disconnect();
    }
    this.fading.clear();
    for (const { level, panner } of this.speakers) {
      level.disconnect();
      panner.disconnect();
    }
  }
}
