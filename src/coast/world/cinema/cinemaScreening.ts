import { CanvasTexture, LinearFilter, SRGBColorSpace, Vector3, type Camera } from 'three';
import type { CinemaMovieVideo } from './cinemaMovieVideo';
import { CINEMA_SAMPLE_RATE, type CinemaAudioAsset } from './cinemaProgram';
import { createCinemaRoomAudio } from './cinemaRoomAudio';

const PREROLL_SAMPLES = CINEMA_SAMPLE_RATE / 4;
const READ_AHEAD_SAMPLES = CINEMA_SAMPLE_RATE / 2;
const END_PADDING = CINEMA_SAMPLE_RATE / 2;
type RoomAudio = Awaited<ReturnType<typeof createCinemaRoomAudio>>;

function secondsToSample(seconds: number): number {
  return Math.round(seconds * CINEMA_SAMPLE_RATE);
}

/** One timestamped screening. Projection follows the audio device's playback clock. */
export class CinemaScreeningPlayer {
  readonly texture: CanvasTexture;
  private readonly previousEye = new Vector3();
  private readonly eye = new Vector3();
  private hasEye = false;
  private context?: AudioContext;
  private volume?: GainNode;
  private room?: RoomAudio;
  private roomOpening?: Promise<void>;
  private generation = 0;
  private nextRead = 0;
  private reading = false;
  private seeking = false;
  private requested = false;
  private active = false;
  private blocked = false;
  private disposed = false;
  private frameVersion = -1;
  private cursor = 0;
  private startSample = 0;
  private level = -1;
  private lastUnderruns = 0;
  private fault = '';

  constructor(
    readonly asset: CinemaAudioAsset,
    private readonly picture: CinemaMovieVideo,
    private readonly videoStartSample = 0,
  ) {
    this.texture = new CanvasTexture(picture.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
  }

  get duration(): number { return this.asset.durationSamples / CINEMA_SAMPLE_RATE; }
  get position(): number { return this.cursor / CINEMA_SAMPLE_RATE; }
  get playing(): boolean { return this.requested; }
  get error(): string { return this.fault; }
  get aspect(): number { return this.picture.canvas.width / this.picture.canvas.height; }
  private get endSample(): number { return this.asset.durationSamples + END_PADDING; }

  async play(context: AudioContext): Promise<void> {
    if (this.disposed || this.blocked) return;
    if (this.cursor >= this.asset.durationSamples) this.seek(0);
    this.requested = true;
    this.fault = '';
    try {
      this.context = context;
      // Resume is called before awaiting a decoder or worklet on the user's gesture.
      await (context.state === 'running' ? Promise.resolve() : context.resume());
      if (this.disposed || !this.requested) return;
      this.roomOpening ??= this.openRoom(context).finally(() => { this.roomOpening = undefined; });
      await this.roomOpening;
    } catch (error) {
      this.fail(error, '上映音を開始できませんでした。');
    }
  }

  pause(): void {
    if (!this.requested) return;
    this.requested = false;
    this.seek(this.position);
  }

  seek(seconds: number): void {
    if (this.disposed || !Number.isFinite(seconds)) return;
    const sample = Math.max(0, Math.min(this.asset.durationSamples, secondsToSample(seconds)));
    const token = ++this.generation;
    this.stopConsuming();
    this.startSample = this.cursor = this.nextRead = sample;
    this.reading = false;
    this.room?.seek(sample);
    this.seeking = true;
    void this.picture.seek(this.videoTime(sample)).then(() => {
      if (token !== this.generation) return;
      this.seeking = false;
      this.updateTexture();
    }).catch(error => {
      if (token !== this.generation) return;
      this.seeking = false;
      this.fail(error, '上映位置を変更できませんでした。');
    });
  }

  setBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    if (blocked) this.seek(this.position);
  }

  update(camera: Camera, level: number): void {
    if (this.disposed) return;
    camera.getWorldPosition(this.eye);
    if (this.hasEye && this.eye.distanceToSquared(this.previousEye) > 9 && this.requested) {
      this.seek(this.position);
    }
    this.previousEye.copy(this.eye);
    this.hasEye = true;

    const room = this.room;
    const context = this.context;
    room?.update(camera);
    if (this.volume && context && level !== this.level) {
      this.level = level;
      this.volume.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), context.currentTime, 0.035);
    }
    if (this.seeking || this.blocked || this.fault) return;
    if (!room || !context || !this.requested) {
      this.present(this.cursor);
      return;
    }

    const status = room.status();
    if (status.error) {
      this.fail(new Error(status.error), '上映音を続けられませんでした。');
      return;
    }
    if (status.underruns > this.lastUnderruns) {
      this.lastUnderruns = status.underruns;
      this.stopConsuming();
    }
    this.fill(room, status.sample);
    const outputTime = context.getOutputTimestamp?.().contextTime ?? context.currentTime;
    // Stopping consumption does not make already rendered samples audible.
    // Keep the negative output-clock offset while the device drains them, but
    // never extrapolate beyond the last consumed sample while stopped.
    const advance = Math.max(-PREROLL_SAMPLES,
      Math.min(status.playing ? 1024 : 0, secondsToSample(outputTime - status.contextTime)));
    const rendered = Math.min(this.nextRead, status.sample);
    const consumed = Math.min(this.nextRead, status.sample + advance);
    const presentation = Math.max(this.cursor, Math.min(this.asset.durationSamples,
      consumed - room.centerDelaySamples()));
    const videoReady = this.present(presentation);
    if (videoReady) this.cursor = presentation;
    const primed = this.nextRead >= Math.min(this.endSample, status.sample + PREROLL_SAMPLES);
    // A stopped, fully rendered end must finish even if the output timestamp
    // remains behind. Preserve the rendered-end completion used before the
    // output clock was also applied to stopped presentation.
    const finished = (status.playing ? consumed : rendered) >= this.endSample - 1;
    if (finished) this.requested = false;
    const play = videoReady && (this.active || primed) && !finished && context.state === 'running';
    if (this.active !== play) {
      room.setPlaying(play);
      this.active = play;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    this.room?.dispose();
    this.volume?.disconnect();
    this.picture.dispose();
    this.texture.dispose();
  }

  private async openRoom(context: AudioContext): Promise<void> {
    if (this.room) return;
    const volume = context.createGain();
    volume.gain.value = 0;
    const room = await createCinemaRoomAudio(context, volume, this.asset.program);
    if (this.disposed) {
      room.dispose();
      return;
    }
    this.volume = volume;
    this.room = room;
    this.level = -1;
    volume.connect(context.destination);
    room.seek(this.startSample);
  }

  private videoTime(sample: number): number {
    return Math.max(0, Math.min(this.picture.duration,
      (sample - this.videoStartSample) / CINEMA_SAMPLE_RATE));
  }

  private updateTexture(): void {
    if (this.picture.frameVersion === this.frameVersion) return;
    this.frameVersion = this.picture.frameVersion;
    this.texture.needsUpdate = true;
  }

  private present(sample: number): boolean {
    try {
      if (!this.picture.present(this.videoTime(sample))) return false;
      this.updateTexture();
      return true;
    } catch (error) {
      this.fail(error, '上映映像を続けられませんでした。');
      return false;
    }
  }

  private stopConsuming(): void {
    if (!this.active) return;
    this.active = false;
    this.room?.setPlaying(false);
  }

  private fill(room: RoomAudio, sample: number): void {
    if (this.reading || this.nextRead >= Math.min(this.endSample, sample + READ_AHEAD_SAMPLES)) return;
    const start = this.nextRead;
    const count = Math.min(PREROLL_SAMPLES, this.endSample - start);
    const token = this.generation;
    this.reading = true;
    void this.asset.read(start, count).then(channels => {
      if (token !== this.generation) return;
      room.enqueue(start, channels);
      this.nextRead += count;
    }).catch(error => {
      if (token === this.generation) this.fail(error, '上映素材を読み込めませんでした。');
    }).finally(() => {
      if (token === this.generation) this.reading = false;
    });
  }

  private fail(error: unknown, fallback: string): void {
    if (this.disposed) return;
    this.requested = false;
    this.stopConsuming();
    this.fault = error instanceof Error && error.message ? error.message : fallback;
  }
}
