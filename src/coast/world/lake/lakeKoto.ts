import type { LakePoint } from './lakeAudioAcoustics';
import { LAKE_KOTO_ASSET_DURATION, LakeKotoAsset } from './lakeKotoAsset';
import { createLakeKotoSpeakerArray, type LakeKotoSpeakerArray } from './lakeKotoSpeakers';

export { LAKE_KOTO_SPEAKERS, lakeKotoSpeakerGains } from './lakeKotoSpeakers';

const FADE_SECONDS = 0.065;

interface Playback {
  readonly source: AudioBufferSourceNode;
  readonly level: GainNode;
  readonly startedAt: number;
}

export class LakeKoto {
  private readonly asset: LakeKotoAsset;
  private readonly speakers: LakeKotoSpeakerArray;
  private readonly fading = new Set<Playback>();
  private listener: LakePoint = { x: 0, y: 0, z: 0 };
  private current?: Playback;
  private request = 0;
  private disposed = false;

  constructor(private readonly context: BaseAudioContext, output: AudioNode) {
    this.asset = new LakeKotoAsset(context);
    this.speakers = createLakeKotoSpeakerArray(context, output);
  }

  get playing(): boolean {
    return this.current !== undefined;
  }

  async play(listener: LakePoint): Promise<void> {
    if (this.disposed || this.current) return;
    this.listener = listener;
    const request = ++this.request;
    let buffer: AudioBuffer;
    try {
      buffer = await this.asset.load();
    } catch (error) {
      if (request !== this.request || this.disposed) return;
      throw error;
    }
    if (request !== this.request || this.disposed) return;
    const now = this.context.currentTime;
    this.update(this.listener, now, true);
    const source = this.context.createBufferSource();
    const level = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = LAKE_KOTO_ASSET_DURATION;
    level.gain.setValueAtTime(0, now);
    level.gain.linearRampToValueAtTime(1, now + FADE_SECONDS);
    source.connect(level).connect(this.speakers.input);
    const playback = { source, level, startedAt: now };
    source.onended = () => {
      this.releasePlayback(playback);
      if (this.current === playback) this.current = undefined;
    };
    try {
      source.start(now);
      this.current = playback;
    } catch (error) {
      this.releasePlayback(playback);
      throw error;
    }
  }

  stop(): void {
    this.request += 1;
    this.asset.cancel();
    const playback = this.current;
    if (!playback) return;
    this.current = undefined;
    const { source, level } = playback;
    const now = this.context.currentTime;
    this.fading.add(playback);
    level.gain.cancelScheduledValues(now);
    level.gain.setValueAtTime(Math.min(1, Math.max(0, (now - playback.startedAt) / FADE_SECONDS)), now);
    level.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
    source.stop(now + FADE_SECONDS);
  }

  update(listener: LakePoint, now: number, immediate = false): void {
    this.listener = listener;
    if (this.current || immediate) this.speakers.update(listener, now, immediate);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    for (const playback of this.fading) {
      playback.source.stop(this.context.currentTime);
      this.releasePlayback(playback);
    }
    this.speakers.dispose();
    this.asset.dispose();
  }

  private releasePlayback(playback: Playback): void {
    playback.source.onended = null;
    playback.source.disconnect();
    playback.source.buffer = null;
    playback.level.disconnect();
    this.fading.delete(playback);
  }
}
