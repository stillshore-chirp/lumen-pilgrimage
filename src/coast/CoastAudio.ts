import type { Vector3 } from 'three';
import { COAST_FALLS, COAST_GROVES, groundHeight, SEA_LEVEL, shoreline, smoothstep, type CoastPoint } from './terrain';
import { airCutoff, soundReach, terrainOcclusion, waterReflection } from './coastAcoustics';
import { COAST_SWELL_PERIOD, coastSwellPhase } from './world/coastSwell';

type AudioAsset = 'waves' | 'surf' | 'waterfall' | 'foliage' | 'birds' | 'insects';
type FilterSpec = { type: BiquadFilterType; frequency: number };
type EmitterSpec = {
  asset: AudioAsset;
  position: [number, number, number];
  gain: number;
  refDistance: number;
  maxDistance: number;
  rolloff: number;
  filters: FilterSpec[];
  waterReflection?: number;
  runupZ?: number;
};
type SpatialVoice = {
  point: CoastPoint;
  range: number;
  obstruction: BiquadFilterNode;
  direct: GainNode;
  surf?: BreakingSurf;
  reflection?: { gain: GainNode; delay: DelayNode; surface: BiquadFilterNode; strength: number };
};

function positionOf(point: CoastPoint): [number, number, number] {
  return [point.x, point.y, point.z];
}

function grovePosition(grove: { x: number; z: number }, elevation: number): [number, number, number] {
  return [grove.x, groundHeight(grove.x, grove.z) + elevation, grove.z];
}

const ASSET_FILES: Record<AudioAsset, string> = {
  waves: 'waves.ogg',
  surf: 'surf.ogg',
  waterfall: 'waterfall.ogg',
  foliage: 'foliage.ogg',
  birds: 'birds.ogg',
  insects: 'insects.ogg',
};

const MAX_SEGMENT_SECONDS = 82;
const SCHEDULE_AHEAD_SECONDS = 92;
const SCHEDULER_INTERVAL_MS = 28_000;
const SURF_EXCERPT_SECONDS = 4.2;
const SURF_START_PHASE = 0.285;

/** Locate the surf on the actual shallows, including where the cliffs change the coastline. */
function shoreEmitters(): EmitterSpec[] {
  const emitters: EmitterSpec[] = [];
  for (const x of [-89, -64, -44, -16, 13, 40, 66, 94]) {
    const shore = shoreline(x);
    let runupZ = shore;
    for (let z = shore; z > shore - 190; z -= 0.75) {
      const depth = SEA_LEVEL - groundHeight(x, z);
      if (depth < 0.25) runupZ = z - 0.75;
      if (runupZ - z < 7.5 || depth < 0.8) continue;
      emitters.push({
        asset: 'surf', position: [x, SEA_LEVEL + 0.34, runupZ - 4.5], runupZ,
        gain: 0.83, refDistance: 11, maxDistance: 116, rolloff: 1.32,
        filters: [{ type: 'lowpass', frequency: 11_000 }],
      });
      break;
    }
  }
  return emitters;
}

/** Start a real break on the local incoming crest and let its wash trail off. */
class BreakingSurf {
  private source: AudioBufferSourceNode | undefined;
  private previousExcerpt = -1;
  private readonly excerptCount: number;

  constructor(
    private readonly context: AudioContext,
    private readonly buffer: AudioBuffer,
    private readonly input: AudioNode,
    private readonly panner: PannerNode,
    private readonly crest: CoastPoint,
    private readonly runupZ: number,
    private readonly range: number,
  ) {
    this.excerptCount = Math.floor(buffer.duration / SURF_EXCERPT_SECONDS + 0.001);
  }

  update(listener: CoastPoint, elapsed: number, now: number): CoastPoint {
    const phase = coastSwellPhase(elapsed, this.crest.x, this.crest.z);
    const advance = smoothstep(0.16, 0.54, phase) * (1 - smoothstep(0.63, 0.98, phase));
    const z = this.crest.z - 2.8 + (this.runupZ - this.crest.z + 2.8) * advance;
    this.panner.positionZ.setTargetAtTime(z, now, 0.08);
    const distance = Math.hypot(this.crest.x - listener.x, this.crest.y - listener.y, z - listener.z);
    const lead = ((SURF_START_PHASE - phase + 1) % 1) * COAST_SWELL_PERIOD;
    if (!this.source && this.excerptCount > 0 && distance < this.range && lead < 0.24) {
      this.play(now + lead + distance / 343);
    }
    return { ...this.crest, z };
  }

  dispose(): void {
    const source = this.source;
    if (!source) return;
    this.source = undefined;
    source.onended = null;
    source.stop();
    source.disconnect();
  }

  private play(when: number): void {
    const chooseFrom = this.excerptCount - Number(this.previousExcerpt >= 0 && this.excerptCount > 1);
    let excerpt = Math.floor(Math.random() * chooseFrom);
    if (chooseFrom < this.excerptCount && excerpt >= this.previousExcerpt) excerpt += 1;
    this.previousExcerpt = excerpt;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = 0.94 + 0.12 * Math.random();
    source.connect(this.input);
    source.onended = () => {
      source.disconnect();
      this.source = undefined;
    };
    source.start(when, excerpt * SURF_EXCERPT_SECONDS, SURF_EXCERPT_SECONDS);
    this.source = source;
  }
}

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
    const fadeIn = this.previousGain ? fade : Math.min(0.65, fade);
    voice.gain.setValueCurveAtTime(this.fadeCurve(true, fadeIn), startAt, fadeIn);

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
      curve[i] = fadeIn ? Math.sin(phase) : Math.cos(phase);
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

  update(position: Vector3, forward: Vector3, up: Vector3, elapsed: number): void {
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
    this.updatePropagation(position, context.currentTime, elapsed);
  }

  private updatePropagation(listener: CoastPoint, now: number, elapsed: number): void {
    for (const voice of this.voices) {
      const point = voice.surf?.update(listener, elapsed, now) ?? voice.point;
      const distance = Math.hypot(point.x - listener.x, point.y - listener.y, point.z - listener.z);
      const reach = soundReach(distance, voice.range);
      const blocked = reach > 0 ? terrainOcclusion(listener, point) : 0;
      const cutoff = airCutoff(distance);
      const transmission = 0.18 ** blocked;
      voice.obstruction.frequency.setTargetAtTime(Math.max(350, cutoff * transmission), now, 0.12);
      voice.direct.gain.setTargetAtTime(reach * transmission, now, 0.12);
      const branch = voice.reflection;
      if (!branch) continue;
      const reflection = reach > 0 ? waterReflection(listener, point) : { gain: 0, delay: 0 };
      branch.gain.gain.setTargetAtTime(branch.strength * reflection.gain * reach, now, 0.15);
      if (reflection.gain === 0) continue;
      branch.delay.delayTime.setTargetAtTime(reflection.delay, now, 0.18);
      branch.surface.frequency.setTargetAtTime(Math.min(3850, cutoff * 0.72), now, 0.15);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const player of this.players) player.dispose();
    this.players.length = 0;
    for (const voice of this.voices) voice.surf?.dispose();
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
    const waterfalls: EmitterSpec[] = COAST_FALLS.map((fall, index) => ({
      asset: 'waterfall', position: positionOf(fall.path[Math.round((fall.path.length - 1) * 0.65)]),
      gain: 0.72 * 0.69 ** index, refDistance: 26, maxDistance: 840, rolloff: 0.42, waterReflection: 0.27,
      filters: [{ type: 'lowpass', frequency: 7600 }],
    }));
    for (const fall of COAST_FALLS.slice(0, 2)) {
      // Close spray stays at the impact while the bulk of the falling water carries across the bay.
      waterfalls.push({
        asset: 'waterfall', position: [fall.impact.x, SEA_LEVEL + 2.8, fall.impact.z], gain: 0.36,
        refDistance: 5.5, maxDistance: 74, rolloff: 1.10,
        filters: [{ type: 'highpass', frequency: 650 }, { type: 'lowpass', frequency: 10_000 }],
      });
    }
    const emitters: EmitterSpec[] = [
      ...shoreEmitters(),
      // The quieter wash continues between individual breaking crests.
      { asset: 'waves', position: [-19, 0.72, -32], gain: 0.46, refDistance: 35, maxDistance: 490, rolloff: 0.63,
        waterReflection: 0.17, filters: [{ type: 'lowpass', frequency: 3600 }] },
      { asset: 'waves', position: [49, 0.7, -127], gain: 0.53, refDistance: 52, maxDistance: 540, rolloff: 0.67,
        filters: [{ type: 'lowpass', frequency: 4400 }] },
      ...waterfalls,
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
        const { input, panner, voice } = this.createEmitter(context, emitter);
        if (emitter.runupZ === undefined) {
          this.players.push(new VariationLoop(context, buffer, input));
        } else {
          voice.surf = new BreakingSurf(context, buffer, input, panner, voice.point, emitter.runupZ, voice.range);
        }
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

  private createEmitter(context: AudioContext, spec: EmitterSpec): {
    input: GainNode;
    panner: PannerNode;
    voice: SpatialVoice;
  } {
    const input = context.createGain();
    input.gain.value = spec.gain;
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
    if (spec.waterReflection !== undefined) {
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
      voice.reflection = { gain, delay, surface, strength: spec.waterReflection };
    }
    this.voices.push(voice);
    return { input, panner, voice };
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
