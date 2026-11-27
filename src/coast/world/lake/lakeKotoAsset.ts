export const LAKE_KOTO_ASSET = 'lake-audio/koto-performance.wav';
export const LAKE_KOTO_ASSET_DURATION = 39;

interface PendingAsset {
  readonly request: AbortController;
  readonly promise: Promise<AudioBuffer>;
  decoding: boolean;
}

function cancelled(): DOMException {
  return new DOMException('Koto loading was cancelled', 'AbortError');
}

// Each lake owns one decoded buffer. No fetch or synthesis occurs before the first play request.
export class LakeKotoAsset {
  private buffer?: AudioBuffer;
  private pending?: PendingAsset;
  private disposed = false;

  constructor(private readonly context: BaseAudioContext) {}

  load(): Promise<AudioBuffer> {
    if (this.disposed) return Promise.reject(new Error('LakeKotoAsset has been disposed'));
    if (this.buffer) return Promise.resolve(this.buffer);
    if (this.pending) return this.pending.promise;
    const request = new AbortController();
    const pending: PendingAsset = {
      request, decoding: false,
      promise: this.decode(request.signal, () => { pending.decoding = true; }).then(buffer => {
        if (request.signal.aborted || this.disposed) throw cancelled();
        this.buffer = buffer;
        return buffer;
      }).finally(() => {
        if (this.pending === pending) this.pending = undefined;
      }),
    };
    this.pending = pending;
    return pending.promise;
  }

  cancel(): void {
    // Native decoding cannot be aborted. Share its result on the next play instead of decoding twice.
    if (this.pending?.decoding) return;
    this.pending?.request.abort();
    this.pending = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // A late native decode is discarded, even though the decoder itself cannot be cancelled.
    this.pending?.request.abort();
    this.pending = undefined;
    this.buffer = undefined;
  }

  private async decode(signal: AbortSignal, decoding: () => void): Promise<AudioBuffer> {
    const asset = `${import.meta.env?.BASE_URL ?? '/'}${LAKE_KOTO_ASSET}`;
    const response = await fetch(asset, { signal });
    if (!response.ok) throw new Error('Koto audio could not be loaded. Try playing it again.');
    const encoded = await response.arrayBuffer();
    if (signal.aborted) throw cancelled();
    decoding();
    const buffer = await this.context.decodeAudioData(encoded);
    if (signal.aborted) throw cancelled();
    // decodeAudioData resamples to the context rate; duration and mono content remain the asset contract.
    const frames = Math.round(LAKE_KOTO_ASSET_DURATION * buffer.sampleRate);
    if (buffer.numberOfChannels !== 1 || Math.abs(buffer.length - frames) > 1) {
      throw new Error('Koto audio has an unexpected format.');
    }
    if (buffer.length === frames) return buffer;
    // Resamplers may round by one frame. Normalize once so every device loops at exactly 39 seconds.
    const normalized = this.context.createBuffer(1, frames, buffer.sampleRate);
    normalized.copyToChannel(buffer.getChannelData(0).subarray(0, frames), 0);
    return normalized;
  }
}
