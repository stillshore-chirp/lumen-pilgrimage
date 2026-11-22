import type { Vector3 } from 'three';
import { POOL, WATERFALL } from './terrain';

type AudioAsset = 'waves' | 'waterfall' | 'foliage' | 'birds' | 'insects';
type FilterSpec = { type: BiquadFilterType; frequency: number };
type EmitterSpec = {
  asset: AudioAsset;
  position: [number, number, number];
  gain: number;
  refDistance: number;
  maxDistance: number;
  rolloff: number;
  filters: FilterSpec[];
};

const ASSET_FILES: Record<AudioAsset, string> = {
  waves: 'waves.ogg',
  waterfall: 'waterfall.ogg',
  foliage: 'foliage.ogg',
  birds: 'birds.ogg',
  insects: 'insects.ogg',
};

const MAX_SEGMENT_SECONDS = 82;
const SCHEDULE_AHEAD_SECONDS = 92;
const SCHEDULER_INTERVAL_MS = 28_000;

/** Crossfaded, randomly offset excerpts keep a local recording from repeating mechanically. */
class VariationLoop {
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private previousGain: GainNode | undefined;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly voices = new Set<GainNode>();

  constructor(
    private readonly context: AudioContext,
    private readonly buffer: AudioBuffer,
    private readonly input: AudioNode,
    private readonly level: number,
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.cursor = this.context.currentTime + 0.08;
    this.fillAhead();
  }

  dispose(): void {
    this.active = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // The source may already have reached its scheduled end.
      }
      source.disconnect();
    }
    for (const voice of this.voices) voice.disconnect();
    this.sources.clear();
    this.voices.clear();
    this.previousGain = undefined;
  }

  private fillAhead = (): void => {
    if (!this.active || this.context.state === 'closed') return;
    const horizon = this.context.currentTime + SCHEDULE_AHEAD_SECONDS;
    while (this.cursor < horizon) this.scheduleSegment();
    this.timer = setTimeout(this.fillAhead, SCHEDULER_INTERVAL_MS);
  };

  private scheduleSegment(): void {
    const now = this.context.currentTime;
    const duration = Math.min(this.buffer.duration * 0.94, MAX_SEGMENT_SECONDS);
    const fade = Math.min(4.5, duration * 0.14);
    const startAt = Math.max(this.cursor, now + 0.06);
    const offset = Math.random() * Math.max(0, this.buffer.duration - duration);
    const source = this.context.createBufferSource();
    const voice = this.context.createGain();
    source.buffer = this.buffer;
    source.connect(voice);
    voice.connect(this.input);
    voice.gain.setValueCurveAtTime(this.fadeCurve(true, fade), startAt, fade);

    if (this.previousGain) {
      this.previousGain.gain.cancelScheduledValues(startAt);
      this.previousGain.gain.setValueCurveAtTime(this.fadeCurve(false, fade), startAt, fade);
    }

    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      this.voices.delete(voice);
      voice.disconnect();
    };
    this.sources.add(source);
    this.voices.add(voice);
    this.previousGain = voice;
    source.start(startAt, offset, duration);
    this.cursor = startAt + duration - fade;
  }

  private fadeCurve(fadeIn: boolean, seconds: number): Float32Array {
    const count = Math.max(16, Math.ceil(seconds * 12));
    const curve = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const phase = (i / (count - 1)) * Math.PI * 0.5;
      curve[i] = this.level * (fadeIn ? Math.sin(phase) : Math.cos(phase));
    }
    return curve;
  }
}

/** Local, HRTF-positioned environmental audio for the coastal scene. */
export class CoastAudio {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private compressor: DynamicsCompressorNode | undefined;
  private readonly graphNodes: AudioNode[] = [];
  private readonly players: VariationLoop[] = [];
  private readonly buffers: Partial<Record<AudioAsset, AudioBuffer>> = {};
  private readonly assetLoads: Partial<Record<AudioAsset, Promise<AudioBuffer>>> = {};
  private pendingStart: Promise<void> | undefined;
  private started = false;
  private disposed = false;
  private volume = 0.7;
  private muted = false;

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('CoastAudio has been disposed'));
    if (this.pendingStart) return this.pendingStart;

    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' });
      const context = this.context;
      // Calling resume here, before returning the promise, preserves the user's gesture.
      const resume = context.state === 'running' ? Promise.resolve() : context.resume();
      this.ensureGraph(context);
      const start = this.started ? resume : Promise.all([
        resume,
        ...Object.keys(ASSET_FILES).map(asset => this.loadAsset(asset as AudioAsset, context)),
      ]).then(() => {
        if (this.disposed || this.context !== context) throw new Error('CoastAudio is no longer active');
        this.beginLayers(context);
        this.started = true;
      });
      this.pendingStart = start.finally(() => { this.pendingStart = undefined; });
      return this.pendingStart;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  setLevel(volume: number, muted: boolean): void {
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
    this.muted = muted;
    this.applyMasterLevel();
  }

  update(position: Vector3, forward: Vector3): void {
    const listener = this.context?.listener;
    if (!listener) return;
    const length = Math.hypot(forward.x, forward.y, forward.z) || 1;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = forward.x / length;
    listener.forwardY.value = forward.y / length;
    listener.forwardZ.value = forward.z / length;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const player of this.players) player.dispose();
    this.players.length = 0;
    for (const node of this.graphNodes) node.disconnect();
    this.graphNodes.length = 0;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }

  private ensureGraph(context: AudioContext): void {
    if (this.master) return;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 6;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.24;
    const master = context.createGain();
    compressor.connect(master);
    master.connect(context.destination);
    this.compressor = compressor;
    this.master = master;
    this.graphNodes.push(compressor, master);
    this.applyMasterLevel();
  }

  private loadAsset(asset: AudioAsset, context: AudioContext): Promise<AudioBuffer> {
    const cached = this.buffers[asset];
    if (cached) return Promise.resolve(cached);
    const existing = this.assetLoads[asset];
    if (existing) return existing;

    const base = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;
    const request = fetch(`${base}coast-audio/${ASSET_FILES[asset]}`)
      .then(response => {
        if (!response.ok) throw new Error(`Unable to load local ${asset} audio (${response.status})`);
        return response.arrayBuffer();
      })
      .then(data => context.decodeAudioData(data))
      .then(buffer => {
        this.buffers[asset] = buffer;
        return buffer;
      });
    this.assetLoads[asset] = request;
    void request.catch(() => {
      if (this.assetLoads[asset] === request) delete this.assetLoads[asset];
    });
    return request;
  }

  private beginLayers(context: AudioContext): void {
    if (this.started) return;
    const nodeStart = this.graphNodes.length;
    const playerStart = this.players.length;
    const emitters: EmitterSpec[] = [
      // Foreground surf follows the starting cove; the far point opens toward the sea.
      { asset: 'waves', position: [-19, 0.8, 2], gain: 0.72, refDistance: 9, maxDistance: 145, rolloff: 0.8,
        filters: [{ type: 'lowpass', frequency: 6500 }] },
      { asset: 'waves', position: [18, 0.8, -58], gain: 0.34, refDistance: 17, maxDistance: 240, rolloff: 0.72,
        filters: [{ type: 'lowpass', frequency: 4800 }] },
      { asset: 'waterfall', position: [WATERFALL.x, WATERFALL.y, WATERFALL.z], gain: 0.7,
        refDistance: 12, maxDistance: 190, rolloff: 0.82,
        filters: [{ type: 'lowpass', frequency: 8500 }] },
      // A high-passed branch of the fall recording gives the pool a lighter spray layer.
      { asset: 'waterfall', position: [POOL.x + 1.5, 2.8, POOL.z - 1], gain: 0.32,
        refDistance: 5, maxDistance: 74, rolloff: 1.12,
        filters: [{ type: 'highpass', frequency: 580 }, { type: 'lowpass', frequency: 9800 }] },
      { asset: 'foliage', position: [-70, 8, 48], gain: 0.34, refDistance: 10, maxDistance: 96, rolloff: 1.05,
        filters: [{ type: 'highpass', frequency: 420 }, { type: 'lowpass', frequency: 8200 }] },
      { asset: 'foliage', position: [80, 9, 54], gain: 0.34, refDistance: 10, maxDistance: 96, rolloff: 1.05,
        filters: [{ type: 'highpass', frequency: 420 }, { type: 'lowpass', frequency: 8200 }] },
      { asset: 'birds', position: [-64, 12, 42], gain: 0.74, refDistance: 7, maxDistance: 108, rolloff: 0.88,
        filters: [{ type: 'highpass', frequency: 700 }, { type: 'lowpass', frequency: 9200 }] },
      { asset: 'birds', position: [72, 15, 61], gain: 0.74, refDistance: 7, maxDistance: 108, rolloff: 0.88,
        filters: [{ type: 'highpass', frequency: 700 }, { type: 'lowpass', frequency: 9200 }] },
      { asset: 'birds', position: [-27, 7, 32], gain: 0.53, refDistance: 8, maxDistance: 83, rolloff: 0.94,
        filters: [{ type: 'highpass', frequency: 700 }, { type: 'lowpass', frequency: 9200 }] },
      { asset: 'insects', position: [-84, 1.8, 57], gain: 0.58, refDistance: 6, maxDistance: 92, rolloff: 0.82,
        filters: [{ type: 'highpass', frequency: 1050 }, { type: 'lowpass', frequency: 7400 }] },
      { asset: 'insects', position: [58, 1.8, 66], gain: 0.58, refDistance: 6, maxDistance: 92, rolloff: 0.82,
        filters: [{ type: 'highpass', frequency: 1050 }, { type: 'lowpass', frequency: 7400 }] },
    ];

    try {
      for (const emitter of emitters) {
        const buffer = this.buffers[emitter.asset];
        if (!buffer) throw new Error(`The ${emitter.asset} recording is not decoded`);
        const input = this.createEmitter(context, emitter);
        const player = new VariationLoop(context, buffer, input, emitter.gain);
        this.players.push(player);
      }
      for (const player of this.players) player.start();
    } catch (error) {
      for (const player of this.players.splice(playerStart)) player.dispose();
      for (const node of this.graphNodes.splice(nodeStart)) node.disconnect();
      throw error;
    }
  }

  private createEmitter(context: AudioContext, spec: EmitterSpec): GainNode {
    const input = context.createGain();
    let tail: AudioNode = input;
    this.graphNodes.push(input);

    for (const filterSpec of spec.filters) {
      const filter = context.createBiquadFilter();
      filter.type = filterSpec.type;
      filter.frequency.value = filterSpec.frequency;
      tail.connect(filter);
      tail = filter;
      this.graphNodes.push(filter);
    }

    const panner = context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = spec.refDistance;
    panner.maxDistance = spec.maxDistance;
    panner.rolloffFactor = spec.rolloff;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.positionX.value = spec.position[0];
    panner.positionY.value = spec.position[1];
    panner.positionZ.value = spec.position[2];
    tail.connect(panner);
    panner.connect(this.compressor!);
    this.graphNodes.push(panner);
    return input;
  }

  private applyMasterLevel(): void {
    if (!this.master || !this.context) return;
    const target = (this.muted ? 0 : this.volume) * 0.68;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.035);
  }
}
