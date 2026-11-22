import type { Vector3 } from 'three';
import { COAST_FALLS, COAST_GROVES, groundHeight, SEA_LEVEL, shoreline, smoothstep, type CoastPoint } from './terrain';
import { terrainOcclusion, waterReflection } from './coastAcoustics';

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
  overWater?: boolean;
};
type SpatialVoice = {
  point: CoastPoint;
  range: number;
  obstruction: BiquadFilterNode;
  direct: GainNode;
  reflection?: { gain: GainNode; delay: DelayNode };
};

function positionOf(point: CoastPoint): [number, number, number] {
  return [point.x, point.y, point.z];
}

function grovePosition(grove: { x: number; z: number }, elevation: number): [number, number, number] {
  return [grove.x, groundHeight(grove.x, grove.z) + elevation, grove.z];
}

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
  private readonly voices: SpatialVoice[] = [];
  private readonly buffers: Partial<Record<AudioAsset, AudioBuffer>> = {};
  private readonly assetLoads: Partial<Record<AudioAsset, Promise<AudioBuffer>>> = {};
  private pendingStart: Promise<void> | undefined;
  private started = false;
  private disposed = false;
  private volume = 0.7;
  private muted = false;
  private nextPropagationUpdate = 0;

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

  update(position: Vector3, forward: Vector3, up: Vector3): void {
    const context = this.context;
    if (!context) return;
    const listener = context.listener;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = up.x;
    listener.upY.value = up.y;
    listener.upZ.value = up.z;
    if (context.state !== 'running' || context.currentTime < this.nextPropagationUpdate) return;
    this.nextPropagationUpdate = context.currentTime + 0.113;
    this.updatePropagation(position, context.currentTime);
  }

  private updatePropagation(listener: CoastPoint, now: number): void {
    for (const voice of this.voices) {
      const distance = Math.hypot(voice.point.x - listener.x, voice.point.y - listener.y, voice.point.z - listener.z);
      const reach = 1 - smoothstep(voice.range * 0.87, voice.range * 1.30, distance);
      const blocked = reach > 0 ? terrainOcclusion(listener, voice.point) : 0;
      voice.obstruction.frequency.setTargetAtTime(17_000 * Math.pow(0.053, blocked), now, 0.12);
      voice.direct.gain.setTargetAtTime(reach * (1 - 0.82 * blocked), now, 0.12);
      if (!voice.reflection) continue;
      const reflection = waterReflection(listener, voice.point);
      voice.reflection.gain.gain.setTargetAtTime(0.19 * reflection.gain * reach * (1 - blocked), now, 0.15);
      voice.reflection.delay.delayTime.setTargetAtTime(reflection.delay, now, 0.15);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const player of this.players) player.dispose();
    this.players.length = 0;
    this.voices.length = 0;
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
    const voiceStart = this.voices.length;
    const [mainFall, westFall] = COAST_FALLS;
    const emitters: EmitterSpec[] = [
      // Foreground surf follows the starting cove; the far point opens toward the sea.
      { asset: 'waves', position: [-19, 0.8, shoreline(-19) - 3.5], gain: 0.72, refDistance: 9, maxDistance: 145, rolloff: 0.8, overWater: true,
        filters: [{ type: 'lowpass', frequency: 6500 }] },
      { asset: 'waves', position: [18, 0.8, -58], gain: 0.34, refDistance: 17, maxDistance: 240, rolloff: 0.72, overWater: true,
        filters: [{ type: 'lowpass', frequency: 4800 }] },
      { asset: 'waterfall', position: positionOf(mainFall.path[mainFall.path.length - 5]), gain: 0.7,
        refDistance: 12, maxDistance: 190, rolloff: 0.82, overWater: true,
        filters: [{ type: 'lowpass', frequency: 8500 }] },
      // A high-passed branch of the fall recording gives the pool a lighter spray layer.
      { asset: 'waterfall', position: [mainFall.impact.x, 2.8, mainFall.impact.z], gain: 0.32,
        refDistance: 5, maxDistance: 74, rolloff: 1.12,
        filters: [{ type: 'highpass', frequency: 580 }, { type: 'lowpass', frequency: 9800 }] },
      { asset: 'waterfall', position: [westFall.impact.x, 3.1, westFall.impact.z], gain: 0.44,
        refDistance: 12, maxDistance: 190, rolloff: 0.82, overWater: true,
        filters: [{ type: 'lowpass', frequency: 8500 }] },
      { asset: 'foliage', position: grovePosition(COAST_GROVES.west, 5), gain: 0.34, refDistance: 10, maxDistance: 96, rolloff: 1.05,
        filters: [{ type: 'highpass', frequency: 420 }, { type: 'lowpass', frequency: 8200 }] },
      { asset: 'foliage', position: grovePosition(COAST_GROVES.east, 5), gain: 0.34, refDistance: 10, maxDistance: 96, rolloff: 1.05,
        filters: [{ type: 'highpass', frequency: 420 }, { type: 'lowpass', frequency: 8200 }] },
      { asset: 'birds', position: grovePosition(COAST_GROVES.west, 9), gain: 0.74, refDistance: 7, maxDistance: 108, rolloff: 0.88,
        filters: [{ type: 'highpass', frequency: 700 }, { type: 'lowpass', frequency: 9200 }] },
      { asset: 'birds', position: grovePosition(COAST_GROVES.east, 12), gain: 0.74, refDistance: 7, maxDistance: 108, rolloff: 0.88,
        filters: [{ type: 'highpass', frequency: 700 }, { type: 'lowpass', frequency: 9200 }] },
      { asset: 'birds', position: grovePosition(COAST_GROVES.shore, 7), gain: 0.53, refDistance: 8, maxDistance: 83, rolloff: 0.94,
        filters: [{ type: 'highpass', frequency: 700 }, { type: 'lowpass', frequency: 9200 }] },
      { asset: 'insects', position: grovePosition(COAST_GROVES.west, 1.8), gain: 0.58, refDistance: 6, maxDistance: 92, rolloff: 0.82,
        filters: [{ type: 'highpass', frequency: 1050 }, { type: 'lowpass', frequency: 7400 }] },
      { asset: 'insects', position: grovePosition(COAST_GROVES.east, 1.8), gain: 0.58, refDistance: 6, maxDistance: 92, rolloff: 0.82,
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
      this.nextPropagationUpdate = 0;
      for (const player of this.players) player.start();
    } catch (error) {
      for (const player of this.players.splice(playerStart)) player.dispose();
      for (const node of this.graphNodes.splice(nodeStart)) node.disconnect();
      this.voices.length = voiceStart;
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

    const point = { x: spec.position[0], y: spec.position[1], z: spec.position[2] };
    const obstruction = context.createBiquadFilter();
    obstruction.type = 'lowpass';
    obstruction.frequency.value = 17_000;
    obstruction.Q.value = 0.1;
    const direct = context.createGain();
    direct.gain.value = 0;
    const panner = this.createPanner(context, spec, point);
    tail.connect(obstruction).connect(direct).connect(panner).connect(this.compressor!);
    this.graphNodes.push(obstruction, direct, panner);

    const voice: SpatialVoice = { point, range: spec.maxDistance, obstruction, direct };
    if (spec.overWater) {
      const reflected = this.createPanner(context, spec, { ...point, y: 2 * SEA_LEVEL - point.y });
      const delay = context.createDelay(0.2);
      const gain = context.createGain();
      gain.gain.value = 0;
      const surface = context.createBiquadFilter();
      surface.type = 'lowpass';
      surface.frequency.value = 3850;
      surface.Q.value = 0.14;
      tail.connect(surface).connect(delay).connect(gain).connect(reflected).connect(this.compressor!);
      this.graphNodes.push(surface, delay, gain, reflected);
      voice.reflection = { gain, delay };
    }
    this.voices.push(voice);
    return input;
  }

  private createPanner(context: AudioContext, spec: EmitterSpec, point: CoastPoint): PannerNode {
    const panner = context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = spec.refDistance;
    panner.maxDistance = spec.maxDistance;
    panner.rolloffFactor = spec.rolloff;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.positionX.value = point.x;
    panner.positionY.value = point.y;
    panner.positionZ.value = point.z;
    return panner;
  }

  private applyMasterLevel(): void {
    if (!this.master || !this.context) return;
    const target = (this.muted ? 0 : this.volume) * 0.68;
    this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.035);
  }
}
