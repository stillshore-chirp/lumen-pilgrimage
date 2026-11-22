import type { Vector3 } from 'three';
import {
  COAST_FALLS, COAST_GROVES, forestStreamLevel, groundHeight, SEA_LEVEL, shoreline, smoothstep, type CoastPoint,
} from './terrain';
import { airCutoff, listenerTerrain, soundReach, terrainArrival, terrainOcclusion, waterReflection } from './coastAcoustics';
import { COAST_SWELL_PERIOD, coastSwellPhase } from './world/coastSwell';

type AudioAsset = 'waves' | 'surf' | 'waterfall' | 'birds' | 'forestBirds' | 'insects' | 'rivulet';
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
  rockResponse?: boolean;
  birdCalls?: boolean;
  runupZ?: number;
};
type DelayedArrival = { gain: GainNode; delay: DelayNode; surface: BiquadFilterNode };
type SpatialVoice = {
  spec: EmitterSpec;
  point: CoastPoint;
  range: number;
  obstruction: BiquadFilterNode;
  direct: GainNode;
  surf?: BreakingSurf;
  recording?: VariationLoop | BirdCalls;
  reflection?: DelayedArrival & { strength: number };
  rock?: DelayedArrival & { panner: PannerNode };
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
  birds: 'birds.ogg',
  forestBirds: 'forest-birds.ogg',
  insects: 'insects.ogg',
  rivulet: 'rivulet.ogg',
};

const MAX_SEGMENT_SECONDS = 82;
const SCHEDULE_AHEAD_SECONDS = 2;
const SCHEDULER_INTERVAL_MS = 500;
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

function wildlifeEmitters(): EmitterSpec[] {
  const perch = (
    asset: 'birds' | 'forestBirds', grove: { x: number; z: number }, height: number, gain: number, range: number,
  ): EmitterSpec => ({
    asset, position: grovePosition(grove, height), gain, refDistance: 9, maxDistance: range, rolloff: 1.12,
    birdCalls: true, rockResponse: true,
    filters: [{ type: 'highpass', frequency: 720 }, { type: 'lowpass', frequency: 9800 }],
  });
  const insectPatch = (grove: { x: number; z: number }, gain: number, range: number): EmitterSpec => ({
    asset: 'insects', position: grovePosition(grove, 1.1), gain, refDistance: 5, maxDistance: range, rolloff: 1.2,
    filters: [{ type: 'highpass', frequency: 1400 }, { type: 'lowpass', frequency: 6900 }],
  });
  return [
    perch('birds', COAST_GROVES.west, 8, 1.46, 114),
    perch('birds', COAST_GROVES.east, 12, 1.38, 106),
    perch('birds', COAST_GROVES.shore, 6, 1.12, 87),
    perch('birds', { x: -87, z: 124 }, 5, 1.23, 79),
    perch('forestBirds', { x: -25, z: 193 }, 9, 0.84, 78),
    perch('forestBirds', { x: -52, z: 245 }, 15, 1.14, 88),
    perch('forestBirds', { x: 20, z: 231 }, 10, 0.92, 77),
    perch('forestBirds', { x: 52, z: 274 }, 9, 0.88, 75),
    perch('forestBirds', { x: -45, z: 329 }, 7, 1.0, 79),
    perch('forestBirds', { x: 13, z: 369 }, 8, 0.9, 73),
    insectPatch(COAST_GROVES.west, 0.16, 36),
    insectPatch(COAST_GROVES.east, 0.17, 38),
    insectPatch({ x: 5, z: 204 }, 0.29, 36),
    insectPatch({ x: -28, z: 251 }, 0.35, 35),
    insectPatch({ x: 42, z: 252 }, 0.30, 34),
    insectPatch({ x: -16, z: 347 }, 0.25, 39),
  ];
}

function streamEmitters(): EmitterSpec[] {
  const riffles = [
    { x: 77, z: 286, gain: 0.70, range: 47 },
    { x: 39, z: 261, gain: 1.11, range: 57 },
    { x: -19, z: 241, gain: 1.02, range: 48 },
  ].flatMap(({ x, z, gain, range }): EmitterSpec[] => {
    const surface = forestStreamLevel(x, z);
    if (surface === undefined) return [];
    return [{
      asset: 'rivulet', position: [x, surface + 0.42, z], gain, refDistance: 7, maxDistance: range,
      rolloff: 1.1, rockResponse: true, filters: [{ type: 'lowpass', frequency: 9600 }],
    }];
  });
  const x = 85;
  const z = 297.5;
  const plunge = forestStreamLevel(x, z);
  if (plunge === undefined) return riffles;
  return [
    { asset: 'waterfall', position: [x, plunge + 2.0, z], gain: 0.56, refDistance: 10,
      maxDistance: 140, rolloff: 0.78, rockResponse: true,
      filters: [{ type: 'highpass', frequency: 220 }, { type: 'lowpass', frequency: 5900 }] },
    ...riffles,
  ];
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
  private endAt = 0;
  audible = false;
  private previousGain: GainNode | undefined;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly voices = new Set<GainNode>();

  constructor(
    private readonly context: AudioContext,
    private readonly buffer: AudioBuffer,
    private readonly input: AudioNode,
  ) {}

  schedule(now: number): void {
    if (!this.audible || this.cursor > now + SCHEDULE_AHEAD_SECONDS) return;
    this.scheduleSegment(now);
  }

  dispose(): void {
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

  private scheduleSegment(now: number): void {
    const duration = Math.min(this.buffer.duration * 0.94, MAX_SEGMENT_SECONDS);
    const fade = Math.min(4.5, duration * 0.14);
    const startAt = Math.max(this.cursor, now + 0.06);
    const offset = Math.random() * Math.max(0, this.buffer.duration - duration);
    const source = this.context.createBufferSource();
    const voice = this.context.createGain();
    source.buffer = this.buffer;
    source.connect(voice);
    voice.connect(this.input);
    const crossfade = this.previousGain && this.endAt - startAt > 0.05;
    const fadeIn = crossfade ? Math.min(fade, this.endAt - startAt) : Math.min(0.35, fade);
    voice.gain.setValueCurveAtTime(this.fadeCurve(true, fadeIn), startAt, fadeIn);

    if (crossfade && this.previousGain) {
      this.previousGain.gain.cancelScheduledValues(startAt);
      this.previousGain.gain.setValueCurveAtTime(this.fadeCurve(false, fadeIn), startAt, fadeIn);
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
    this.endAt = startAt + duration;
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

/** A perch plays a short field-recorded phrase, then pauses before the next call. */
class BirdCalls {
  audible = false;
  private nextCall: number;
  private source: AudioBufferSourceNode | undefined;
  private envelope: GainNode | undefined;

  constructor(
    private readonly context: AudioContext,
    private readonly buffer: AudioBuffer,
    private readonly input: AudioNode,
  ) {
    this.nextCall = context.currentTime + 0.3 + Math.random() * 1.8;
  }

  schedule(now: number): void {
    if (!this.audible || this.source || now < this.nextCall) return;
    const source = this.context.createBufferSource();
    const envelope = this.context.createGain();
    const rate = 0.95 + Math.random() * 0.1;
    const duration = Math.min(this.buffer.duration, 2.6 + Math.random() * 2.6);
    const offset = Math.random() * (this.buffer.duration - duration);
    const start = now + 0.05;
    const end = start + duration / rate;
    source.buffer = this.buffer;
    source.playbackRate.value = rate;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(1, start + 0.12);
    envelope.gain.setValueAtTime(1, end - 0.24);
    envelope.gain.linearRampToValueAtTime(0, end);
    source.connect(envelope).connect(this.input);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      this.source = undefined;
      this.envelope = undefined;
    };
    this.source = source;
    this.envelope = envelope;
    this.nextCall = end + 2.1 + Math.random() * 6.9;
    source.start(start, offset, duration);
  }

  dispose(): void {
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop();
    this.source.disconnect();
    this.envelope?.disconnect();
    this.source = undefined;
    this.envelope = undefined;
  }
}

/** Local, HRTF-positioned environmental audio for the coastal scene. */
export class CoastAudio {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private compressor: DynamicsCompressorNode | undefined;
  private rockTail: { input: ConvolverNode; level: GainNode } | undefined;
  private readonly graphNodes: AudioNode[] = [];
  private readonly voices: SpatialVoice[] = [];
  private readonly buffers: Partial<Record<AudioAsset, AudioBuffer>> = {};
  private readonly assetLoads: Partial<Record<AudioAsset, Promise<AudioBuffer>>> = {};
  private readonly assetRequest = new AbortController();
  private pendingStart: Promise<void> | undefined;
  private started = false;
  private disposed = false;
  private volume = 0.7;
  private muted = false;
  private nextPropagationUpdate = 0;
  private scheduleTimer: ReturnType<typeof setTimeout> | undefined;

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
    const terrain = listenerTerrain(listener);
    this.rockTail?.level.gain.setTargetAtTime(terrain.enclosure * 0.52, now, 0.19);
    for (const voice of this.voices) {
      const point = voice.surf?.update(listener, elapsed, now) ?? voice.point;
      const distance = Math.hypot(point.x - listener.x, point.y - listener.y, point.z - listener.z);
      const reach = soundReach(distance, voice.range);
      const blocked = reach > 0 ? terrainOcclusion(listener, point) : 0;
      const canopyLoss = terrain.canopy * smoothstep(14, 140, distance);
      const cutoff = airCutoff(distance) * (1 - canopyLoss * 0.58);
      const transmission = 0.11 ** blocked;
      if (voice.recording) voice.recording.audible = reach > 0.012;
      voice.obstruction.frequency.setTargetAtTime(Math.max(350, cutoff * 0.075 ** blocked), now, 0.12);
      voice.direct.gain.setTargetAtTime(reach * transmission, now, 0.12);

      const rock = voice.rock;
      if (rock) {
        const arrival = reach > 0 ? terrainArrival(listener, point, terrain, distance, blocked) : undefined;
        let gain = 0;
        if (arrival) {
          const { refDistance, rolloff } = voice.spec;
          const falloff = refDistance / (refDistance + rolloff * Math.max(0, arrival.distance - refDistance));
          gain = reach * arrival.gain * falloff;
          rock.panner.positionX.setTargetAtTime(arrival.point.x, now, 0.12);
          rock.panner.positionY.setTargetAtTime(arrival.point.y, now, 0.12);
          rock.panner.positionZ.setTargetAtTime(arrival.point.z, now, 0.12);
          rock.delay.delayTime.setTargetAtTime(arrival.delay, now, 0.12);
          rock.surface.frequency.setTargetAtTime(arrival.cutoff, now, 0.12);
        }
        rock.gain.gain.setTargetAtTime(gain, now, 0.14);
      }
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
    this.assetRequest.abort();
    if (this.scheduleTimer !== undefined) clearTimeout(this.scheduleTimer);
    for (const voice of this.voices) {
      voice.surf?.dispose();
      voice.recording?.dispose();
    }
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
    const tail = context.createConvolver();
    const level = context.createGain();
    level.gain.value = 0;
    tail.normalize = false;
    tail.buffer = this.createRockImpulse(context);
    tail.connect(level).connect(compressor);
    this.rockTail = { input: tail, level };
    this.graphNodes.push(compressor, master, tail, level);
    this.applyMasterLevel();
  }

  private createRockImpulse(context: AudioContext): AudioBuffer {
    const sampleRate = context.sampleRate;
    const impulse = context.createBuffer(2, Math.ceil(sampleRate * 0.41), sampleRate);
    const startsAt = Math.ceil(sampleRate * 0.023);
    const normalization = 0.86 / Math.sqrt(sampleRate * 0.07);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      let filtered = 0;
      for (let i = startsAt; i < data.length; i += 1) {
        const noise = Math.random() * 2 - 1;
        filtered += (noise - filtered) * 0.31;
        const seconds = (i - startsAt) / sampleRate;
        const envelope = Math.min(1, seconds / 0.015) * Math.exp(-seconds / 0.073);
        data[i] = filtered * normalization * envelope;
      }
    }
    return impulse;
  }

  private scheduleRecordings = (): void => {
    const context = this.context;
    if (!context || this.disposed || context.state === 'closed') return;
    if (context.state === 'running') {
      for (const voice of this.voices) voice.recording?.schedule(context.currentTime);
    }
    this.scheduleTimer = setTimeout(this.scheduleRecordings, SCHEDULER_INTERVAL_MS);
  };

  private loadAsset(asset: AudioAsset, context: AudioContext): Promise<AudioBuffer> {
    const cached = this.buffers[asset];
    if (cached) return Promise.resolve(cached);
    const existing = this.assetLoads[asset];
    if (existing) return existing;

    const base = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;
    const request = fetch(`${base}coast-audio/${ASSET_FILES[asset]}`, { signal: this.assetRequest.signal })
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
    const voiceStart = this.voices.length;
    const waterfalls: EmitterSpec[] = COAST_FALLS.map((fall, index) => ({
      asset: 'waterfall', position: positionOf(fall.path[Math.round((fall.path.length - 1) * 0.65)]),
      gain: 0.81 * 0.68 ** index, refDistance: 28, maxDistance: 900, rolloff: 0.41, waterReflection: 0.27,
      rockResponse: true,
      filters: [{ type: 'lowpass', frequency: 7600 }],
    }));
    for (const fall of COAST_FALLS.slice(0, 2)) {
      // Close spray stays at the impact while the bulk of the falling water carries across the bay.
      waterfalls.push({
        asset: 'waterfall', position: [fall.impact.x, SEA_LEVEL + 2.8, fall.impact.z], gain: 0.36,
        refDistance: 5.5, maxDistance: 74, rolloff: 1.10, rockResponse: true,
        filters: [{ type: 'highpass', frequency: 650 }, { type: 'lowpass', frequency: 10_000 }],
      });
    }
    const emitters: EmitterSpec[] = [
      ...shoreEmitters(),
      // The quieter wash continues between individual breaking crests.
      { asset: 'waves', position: [-19, 0.72, -32], gain: 0.46, refDistance: 35, maxDistance: 490, rolloff: 0.63,
        waterReflection: 0.17, rockResponse: true, filters: [{ type: 'lowpass', frequency: 3600 }] },
      { asset: 'waves', position: [49, 0.7, -127], gain: 0.53, refDistance: 52, maxDistance: 540, rolloff: 0.67,
        rockResponse: true, filters: [{ type: 'lowpass', frequency: 4400 }] },
      ...waterfalls,
      ...wildlifeEmitters(),
      ...streamEmitters(),
    ];

    try {
      for (const emitter of emitters) {
        const buffer = this.buffers[emitter.asset];
        if (!buffer) throw new Error(`The ${emitter.asset} recording is not decoded`);
        const { input, panner, voice } = this.createEmitter(context, emitter);
        if (emitter.runupZ !== undefined) {
          voice.surf = new BreakingSurf(context, buffer, input, panner, voice.point, emitter.runupZ, voice.range);
        } else if (emitter.birdCalls) {
          voice.recording = new BirdCalls(context, buffer, input);
        } else {
          voice.recording = new VariationLoop(context, buffer, input);
        }
      }
      this.nextPropagationUpdate = 0;
      this.scheduleRecordings();
    } catch (error) {
      for (const voice of this.voices.splice(voiceStart)) {
        voice.surf?.dispose();
        voice.recording?.dispose();
      }
      for (const node of this.graphNodes.splice(nodeStart)) node.disconnect();
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

    const voice: SpatialVoice = { spec, point, range: spec.maxDistance, obstruction, direct };
    if (spec.waterReflection !== undefined) {
      const reflected = this.createPanner(context, spec, { ...point, y: 2 * SEA_LEVEL - point.y });
      voice.reflection = { ...this.createArrival(context, tail, reflected, 3850), strength: spec.waterReflection };
    }
    if (spec.rockResponse) {
      const echoPanner = this.createPanner(context, spec, point);
      echoPanner.rolloffFactor = 0;
      const arrival = this.createArrival(context, tail, echoPanner, 4800);
      arrival.gain.connect(this.rockTail!.input);
      voice.rock = { ...arrival, panner: echoPanner };
    }
    this.voices.push(voice);
    return { input, panner, voice };
  }

  private createArrival(context: AudioContext, input: AudioNode, panner: PannerNode, cutoff: number): DelayedArrival {
    const delay = context.createDelay(0.24);
    const gain = context.createGain();
    gain.gain.value = 0;
    const surface = context.createBiquadFilter();
    surface.type = 'lowpass';
    surface.frequency.value = cutoff;
    surface.Q.value = 0.14;
    input.connect(surface).connect(delay).connect(gain).connect(panner).connect(this.compressor!);
    this.graphNodes.push(surface, delay, gain, panner);
    return { gain, delay, surface };
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
