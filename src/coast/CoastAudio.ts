import type { Vector3 } from 'three';
import type { CoastMovement } from './CoastControls';
import {
  COAST_FALLS, COAST_GROVES, COAST_REST_SITES, coastWaterLevel, forestStreamLevel, groundHeight,
  SEA_LEVEL, smoothstep, UPLAND_FALL, type CoastPoint,
} from './terrain';
import { airCutoff, listenerTerrain, soundReach, terrainArrival, terrainOcclusion, waterReflection } from './coastAcoustics';
import {
  buildShorePatches, selectShorePatches, SHORE_RANGE, SHORE_REF_DISTANCE, SHORE_ROLLOFF, SHORE_VOICE_COUNT,
  shorePhase, shoreTransmission, shoreWavePoint, type ShorePatch,
} from './coastShore';
import { CoastFoley } from './CoastFoley';
import { COAST_SWELL_PERIOD } from './world/coastSwell';

type AudioAsset = 'waves' | 'surf' | 'waterfall' | 'birds' | 'forestBirds' | 'shelterBirds' | 'insects' | 'rivulet';
type FilterSpec = { type: BiquadFilterType; frequency: number };
type ShelterCallTiming = { firstDelay: number; pause: number };
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
  birdCalls?: true | ShelterCallTiming;
};
type DelayedArrival = { gain: GainNode; delay: DelayNode; surface: BiquadFilterNode };
type ShoreVoice = {
  patch?: ShorePatch;
  releaseAt?: number;
  panner: PannerNode;
  level: GainNode;
  washLevel: GainNode;
  breaker: BreakingSurf;
};
type SpatialVoice = {
  spec: EmitterSpec;
  point: CoastPoint;
  range: number;
  obstruction: BiquadFilterNode;
  direct: GainNode;
  shore?: ShoreVoice;
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
  shelterBirds: 'shelter-birds.ogg',
  insects: 'insects.ogg',
  rivulet: 'rivulet.ogg',
};

const MAX_SEGMENT_SECONDS = 82;
const SCHEDULE_AHEAD_SECONDS = 2;
const SCHEDULER_INTERVAL_MS = 500;
const SURF_EXCERPT_SECONDS = 4.2;
const SURF_START_PHASE = 0.285;
const SHELTER_PHRASE_SECONDS = 2;
const SHELTER_PHRASE_COUNT = 4;

function shelterBirdEmitters(): EmitterSpec[] {
  const perch = (
    position: [number, number, number], gain: number, maxDistance: number, timing: ShelterCallTiming,
  ): EmitterSpec => ({
    asset: 'shelterBirds', position, gain, maxDistance, refDistance: 11, rolloff: 1.16,
    birdCalls: timing, rockResponse: true,
    filters: [{ type: 'highpass', frequency: 820 }, { type: 'lowpass', frequency: 5500 }],
  });
  return COAST_REST_SITES.filter(site => site.kind === 'terrace').flatMap(site => {
    const inland = site.id === 'lake-shelter';
    const close = { x: site.x + (inland ? -11 : 12), z: site.z + 11 };
    const across = { x: site.x + (inland ? 20 : -23), z: site.z + (inland ? -21 : 22) };
    return [
      perch(grovePosition(close, 5.8), 0.75, 39, { firstDelay: 1.2, pause: 13 }),
      perch(grovePosition(across, 8.7), 0.57, 54, { firstDelay: 7.2, pause: 22 }),
    ];
  });
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
    perch('forestBirds', { x: 97, z: 458 }, 9, 0.49, 74),
    perch('forestBirds', { x: 37, z: 584 }, 11, 0.56, 87),
    perch('forestBirds', { x: 133, z: 855 }, 9, 0.58, 85),
    perch('forestBirds', { x: -133, z: 951 }, 8, 0.51, 83),
    perch('forestBirds', { x: -71, z: 1011 }, 10, 0.43, 97),
    ...shelterBirdEmitters(),
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
  const impact = UPLAND_FALL.impact;
  riffles.push({
    asset: 'waterfall', position: [impact.x, impact.y + 0.85, impact.z], gain: 0.46, refDistance: 12,
    maxDistance: 184, rolloff: 0.92, rockResponse: true,
    filters: [{ type: 'highpass', frequency: 280 }, { type: 'lowpass', frequency: 6100 }],
  });
  const cascade = UPLAND_FALL.path[Math.floor(UPLAND_FALL.path.length * 0.52)];
  riffles.push({
    asset: 'waterfall', position: positionOf(cascade), gain: 0.34, refDistance: 21, maxDistance: 555,
    rolloff: 0.73, rockResponse: true, filters: [{ type: 'lowpass', frequency: 4500 }],
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
  ) {
    this.excerptCount = Math.floor(buffer.duration / SURF_EXCERPT_SECONDS + 0.001);
  }

  update(phase: number, distance: number, now: number): void {
    const lead = ((SURF_START_PHASE - phase + 1) % 1) * COAST_SWELL_PERIOD;
    if (!this.source && this.excerptCount > 0 && lead < 0.28) {
      this.play(now + lead + distance / 343);
    }
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
  private nextCall: number | undefined;
  private previousPhrase: number | undefined;
  private source: AudioBufferSourceNode | undefined;
  private envelope: GainNode | undefined;

  constructor(
    private readonly context: AudioContext,
    private readonly buffer: AudioBuffer,
    private readonly input: AudioNode,
    private readonly shelter?: ShelterCallTiming,
  ) {
    if (!shelter) this.nextCall = context.currentTime + 0.3 + Math.random() * 1.8;
  }

  schedule(now: number): void {
    if (!this.audible || this.source) return;
    this.nextCall ??= now + (this.shelter?.firstDelay ?? 0) + Math.random() * 2.1;
    if (now < this.nextCall) return;
    const source = this.context.createBufferSource();
    const envelope = this.context.createGain();
    const rate = 0.95 + Math.random() * 0.1;
    const duration = Math.min(this.buffer.duration, this.shelter ? SHELTER_PHRASE_SECONDS : 2.6 + Math.random() * 2.6);
    const offset = this.shelter ? this.pickPhrase() : Math.random() * (this.buffer.duration - duration);
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
    this.nextCall = end + (this.shelter?.pause ?? 2.1) + Math.random() * (this.shelter ? 11 : 6.9);
    source.start(start, offset, duration);
  }

  private pickPhrase(): number {
    const previous = this.previousPhrase;
    const phrase = previous === undefined ? Math.floor(Math.random() * SHELTER_PHRASE_COUNT)
      : (previous + 1 + Math.floor(Math.random() * (SHELTER_PHRASE_COUNT - 1))) % SHELTER_PHRASE_COUNT;
    this.previousPhrase = phrase;
    return phrase * SHELTER_PHRASE_SECONDS;
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
  private medium: { input: BiquadFilterNode; level: GainNode } | undefined;
  private rockTail: { input: ConvolverNode; level: GainNode } | undefined;
  private foley: CoastFoley | undefined;
  private readonly graphNodes: AudioNode[] = [];
  private readonly voices: SpatialVoice[] = [];
  private readonly shoreVoices: ShoreVoice[] = [];
  private shorePatches: ShorePatch[] = [];
  private readonly buffers: Partial<Record<AudioAsset, AudioBuffer>> = {};
  private readonly assetLoads: Partial<Record<AudioAsset, Promise<AudioBuffer>>> = {};
  private readonly assetRequest = new AbortController();
  private pendingStart: Promise<void> | undefined;
  private started = false;
  private disposed = false;
  private volume = 0.7;
  private muted = false;
  private nextPropagationUpdate = 0;
  private nextShoreSelection = 0;
  private lastShoreSelection: CoastPoint | undefined;
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

  update(position: Vector3, forward: Vector3, up: Vector3, elapsed: number, movement?: CoastMovement): void {
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
    const waterLevel = coastWaterLevel(position.x, position.z);
    const immersion = smoothstep(-0.03, 0.62, waterLevel - position.y);
    this.medium?.input.frequency.setTargetAtTime(19_000 * 0.037 ** immersion, context.currentTime, 0.08);
    this.medium?.level.gain.setTargetAtTime(1 - 0.4 * immersion, context.currentTime, 0.09);
    if (this.started && movement) this.foley?.update(position, waterLevel, movement, elapsed, context.currentTime);
    this.updatePropagation(position, context.currentTime, elapsed);
  }

  private updateShoreSelection(listener: CoastPoint, now: number): void {
    if (now < this.nextShoreSelection || this.shoreVoices.length === 0) return;
    const previousPoint = this.lastShoreSelection;
    if (previousPoint && !this.shoreVoices.some(voice => voice.releaseAt !== undefined)
      && Math.hypot(listener.x - previousPoint.x, listener.y - previousPoint.y, listener.z - previousPoint.z) < 1.2) return;
    this.nextShoreSelection = now + 0.37;
    this.lastShoreSelection = { x: listener.x, y: listener.y, z: listener.z };
    const previous = new Set<ShorePatch>();
    for (const voice of this.shoreVoices) {
      if (voice.releaseAt !== undefined && voice.releaseAt <= now) {
        voice.patch = undefined;
        voice.releaseAt = undefined;
        voice.breaker.dispose();
      }
      if (voice.patch && voice.releaseAt === undefined) previous.add(voice.patch);
    }
    const selected = new Set(selectShorePatches(this.shorePatches, listener, previous));
    for (const voice of this.shoreVoices) {
      if (!voice.patch) continue;
      if (selected.delete(voice.patch)) {
        if (voice.releaseAt === undefined) continue;
        voice.releaseAt = undefined;
        voice.level.gain.setTargetAtTime(1, now, 0.13);
      } else if (voice.releaseAt === undefined) {
        voice.releaseAt = now + 0.62;
        voice.level.gain.setTargetAtTime(0, now, 0.1);
      }
    }
    for (const patch of selected) {
      const voice = this.shoreVoices.find(candidate => !candidate.patch);
      if (!voice) break;
      voice.patch = patch;
      const axes = [voice.panner.positionX, voice.panner.positionY, voice.panner.positionZ];
      positionOf(patch.crest).forEach((value, index) => {
        axes[index].cancelScheduledValues(now);
        axes[index].setValueAtTime(value, now);
      });
      voice.level.gain.setTargetAtTime(1, now, 0.15);
    }
  }

  private updatePropagation(listener: CoastPoint, now: number, elapsed: number): void {
    this.updateShoreSelection(listener, now);
    const terrain = listenerTerrain(listener);
    this.rockTail?.level.gain.setTargetAtTime(terrain.enclosure * 0.78, now, 0.19);
    for (const voice of this.voices) {
      const shore = voice.shore;
      if (shore && !shore.patch) {
        if (voice.recording) voice.recording.audible = false;
        continue;
      }
      let point = voice.point;
      let phase = 0;
      if (shore?.patch) {
        phase = shorePhase(shore.patch, elapsed);
        point = shoreWavePoint(shore.patch, phase);
        shore.panner.positionX.setTargetAtTime(point.x, now, 0.08);
        shore.panner.positionZ.setTargetAtTime(point.z, now, 0.08);
        const wash = 0.64 + 0.28 * smoothstep(0.18, 0.53, phase) * (1 - smoothstep(0.66, 0.97, phase));
        shore.washLevel.gain.setTargetAtTime(wash, now, 0.22);
      }
      const distance = Math.hypot(point.x - listener.x, point.y - listener.y, point.z - listener.z);
      const reach = soundReach(distance, voice.range);
      const blocked = reach > 0 ? terrainOcclusion(listener, point) : 0;
      const canopyLoss = terrain.canopy * smoothstep(14, 140, distance);
      const airLoss = 1 - canopyLoss * 0.58;
      const cutoff = airCutoff(distance) * airLoss;
      const transmission = shore ? shoreTransmission(distance, blocked)
        : { gain: reach * 0.11 ** blocked, cutoff: Math.max(350, cutoff * 0.075 ** blocked) };
      if (voice.recording) voice.recording.audible = reach > 0.012 && shore?.releaseAt === undefined;
      if (shore && reach > 0.012 && shore.releaseAt === undefined) shore.breaker.update(phase, distance, now);
      if (shore && voice.recording) voice.recording.schedule(now);
      voice.obstruction.frequency.setTargetAtTime(Math.max(330, transmission.cutoff * (shore ? airLoss : 1)), now, 0.12);
      voice.direct.gain.setTargetAtTime(transmission.gain, now, 0.12);

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
      voice.shore?.breaker.dispose();
      voice.recording?.dispose();
    }
    this.foley?.dispose();
    this.voices.length = 0;
    this.shoreVoices.length = 0;
    this.shorePatches = [];
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
    this.master = master;
    const medium = context.createBiquadFilter();
    medium.type = 'lowpass';
    medium.frequency.value = 19_000;
    medium.Q.value = 0.2;
    const mediumLevel = context.createGain();
    medium.connect(mediumLevel).connect(compressor);
    this.medium = { input: medium, level: mediumLevel };
    const tail = context.createConvolver();
    const level = context.createGain();
    level.gain.value = 0;
    tail.normalize = false;
    tail.buffer = this.createRockImpulse(context);
    tail.connect(level).connect(medium);
    this.rockTail = { input: tail, level };
    this.foley = new CoastFoley(context, compressor, tail);
    this.graphNodes.push(compressor, master, medium, mediumLevel, tail, level);
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
      for (const voice of this.voices) if (!voice.shore) voice.recording?.schedule(context.currentTime);
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
      ...waterfalls,
      ...wildlifeEmitters(),
      ...streamEmitters(),
    ];

    try {
      const surf = this.buffers.surf;
      const wash = this.buffers.waves;
      if (!surf || !wash) throw new Error('The shoreline recordings are not decoded');
      this.shorePatches = buildShorePatches();
      // The two spare voices let neighbouring patches enter while the previous patch fades away.
      for (let i = 0; i < SHORE_VOICE_COUNT + 2; i += 1) this.createShoreVoice(context, surf, wash);
      for (const emitter of emitters) {
        const buffer = this.buffers[emitter.asset];
        if (!buffer) throw new Error(`The ${emitter.asset} recording is not decoded`);
        const { input, voice } = this.createEmitter(context, emitter);
        if (emitter.birdCalls) {
          const timing = emitter.birdCalls === true ? undefined : emitter.birdCalls;
          voice.recording = new BirdCalls(context, buffer, input, timing);
        } else {
          voice.recording = new VariationLoop(context, buffer, input);
        }
      }
      this.nextPropagationUpdate = 0;
      this.nextShoreSelection = 0;
      this.lastShoreSelection = undefined;
      this.scheduleRecordings();
    } catch (error) {
      for (const voice of this.voices.splice(voiceStart)) {
        voice.shore?.breaker.dispose();
        voice.recording?.dispose();
      }
      this.shoreVoices.length = 0;
      this.shorePatches = [];
      for (const node of this.graphNodes.splice(nodeStart)) node.disconnect();
      throw error;
    }
  }

  private createShoreVoice(context: AudioContext, surf: AudioBuffer, wash: AudioBuffer): void {
    const { input, panner, voice } = this.createEmitter(context, {
      asset: 'surf', position: [0, SEA_LEVEL + 0.44, 0], gain: 0.94,
      refDistance: SHORE_REF_DISTANCE, maxDistance: SHORE_RANGE, rolloff: SHORE_ROLLOFF, rockResponse: true,
      filters: [{ type: 'lowpass', frequency: 12_500 }],
    });
    const level = context.createGain();
    level.gain.value = 0;
    level.connect(input);
    const washLevel = context.createGain();
    washLevel.gain.value = 0.64;
    const washFilter = context.createBiquadFilter();
    washFilter.type = 'lowpass';
    washFilter.frequency.value = 4_900;
    washLevel.connect(washFilter).connect(level);
    this.graphNodes.push(level, washLevel, washFilter);
    const shore = { panner, level, washLevel, breaker: new BreakingSurf(context, surf, level) };
    voice.shore = shore;
    voice.recording = new VariationLoop(context, wash, washLevel);
    this.shoreVoices.push(shore);
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
    tail.connect(obstruction).connect(direct).connect(panner).connect(this.medium!.input);
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
    input.connect(surface).connect(delay).connect(gain).connect(panner).connect(this.medium!.input);
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
