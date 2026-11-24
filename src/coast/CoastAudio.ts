import type { Vector3 } from 'three';
import type { CoastMovement } from './CoastControls';
import {
  COAST_FALLS, COAST_GROVES, COAST_REST_SITES, coastWaterLevel, forestStreamLevel, groundHeight,
  SEA_LEVEL, smoothstep, UPLAND_FALL, type CoastPoint,
} from './terrain';
import {
  airCutoff, listenerTerrain, REFRACTION_SHELF_HZ, soundReach, terrainArrival, terrainOcclusion,
  thermalLowShelfDb, thermalRayLift, waterReflection,
} from './coastAcoustics';
import {
  buildShorePatches, selectShorePatches, SHORE_RANGE, SHORE_REF_DISTANCE, SHORE_ROLLOFF, SHORE_VOICE_COUNT,
  shorePhase, shoreTransmission, shoreWavePoint, type ShorePatch,
} from './coastShore';
import { CoastFoley } from './CoastFoley';
import { connectExplorationOutput } from './explorationOutput';
import { DEFAULT_EXPLORATION_MIX, explorationSoundGain, type ExplorationMix } from './explorationSound';
import type { CoastTimeOfDay } from './world/coastAtmosphere';
import { COAST_SWELL_PERIOD } from './world/coastSwell';
import { BIRD_CALL_RANGE, type CoastBirdCue, type CoastBirdSpecies } from './coastBirdCue';

type AmbientAsset = 'waves' | 'surf' | 'waterfall' | 'forestBirds' | 'shelterBirds' | 'insects' | 'rivulet';
type AudioAsset = AmbientAsset | CoastBirdSpecies;
type FilterSpec = { type: BiquadFilterType; frequency: number };
type BirdCallTiming = { firstDelay: number; pause: number };
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
  birdCalls?: BirdCallTiming;
  activity?: Record<CoastTimeOfDay, number>;
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
  mixGain: GainNode;
  atmosphere?: BiquadFilterNode;
  activity?: GainNode;
  shore?: ShoreVoice;
  recording?: VariationLoop | BirdCalls;
  reflection?: DelayedArrival & { strength: number };
  rock?: DelayedArrival & { panner: PannerNode };
};
type BirdVoice = {
  input: GainNode;
  panner: PannerNode;
  voice: SpatialVoice;
  call?: { cue: CoastBirdCue; source: AudioBufferSourceNode; startsAt: number; releaseAt: number };
};

function positionOf(point: CoastPoint): [number, number, number] {
  return [point.x, point.y, point.z];
}

function grovePosition(grove: { x: number; z: number }, elevation: number): [number, number, number] {
  return [grove.x, groundHeight(grove.x, grove.z) + elevation, grove.z];
}

const ASSETS: Record<AudioAsset, { file: string; sound: 'water' | 'birds' | 'insects' }> = {
  waves: { file: 'waves.ogg', sound: 'water' },
  surf: { file: 'surf.ogg', sound: 'water' },
  waterfall: { file: 'waterfall.ogg', sound: 'water' },
  forestBirds: { file: 'forest-birds.ogg', sound: 'birds' },
  shelterBirds: { file: 'shelter-birds.ogg', sound: 'birds' },
  insects: { file: 'insects.ogg', sound: 'insects' },
  rivulet: { file: 'rivulet.ogg', sound: 'water' },
  gull: { file: 'gull-calls.ogg', sound: 'birds' },
  whiteEye: { file: 'white-eye-calls.ogg', sound: 'birds' },
  bushWarbler: { file: 'bush-warbler-calls.ogg', sound: 'birds' },
  thrush: { file: 'thrush-calls.ogg', sound: 'birds' },
};

const NOMINAL_MASTER_GAIN = 0.7 * 0.68;

// Each edited excerpt starts on a fixed boundary, with a silent guard between excerpts.
const BIRD_PHRASE_STRIDE = 3.5;
const BIRD_VOICES_PER_SPECIES = 2;
const BIRD_CALLS: Record<CoastBirdSpecies, {
  lengths: readonly number[]; gain: number; refDistance: number; highpass: number;
}> = {
  gull: { lengths: [1.65, 2.35, 1.85], gain: 0.75, refDistance: 25, highpass: 340 },
  whiteEye: { lengths: [1.75, 1.55, 2.0, 1.85], gain: 0.68, refDistance: 16, highpass: 1550 },
  bushWarbler: { lengths: [1.45, 2.1, 1.65], gain: 0.79, refDistance: 22, highpass: 840 },
  thrush: { lengths: [2.65, 3.2, 2.75], gain: 0.69, refDistance: 19, highpass: 660 },
};
const BIRD_SPECIES = Object.keys(BIRD_CALLS) as CoastBirdSpecies[];

const MAX_SEGMENT_SECONDS = 82;
const SCHEDULE_AHEAD_SECONDS = 2;
const SCHEDULER_INTERVAL_MS = 500;
const SURF_EXCERPT_SECONDS = 4.2;
const SURF_START_PHASE = 0.285;
const SHELTER_PHRASE_SECONDS = 2;
const SHELTER_PHRASE_COUNT = 4;
const BIRD_ACTIVITY = { day: 1, night: 0 };
const INSECT_ACTIVITY = { day: 0.14, night: 0.65 };

function shelterBirdEmitters(): EmitterSpec[] {
  const perch = (
    position: [number, number, number], gain: number, maxDistance: number, timing: BirdCallTiming,
  ): EmitterSpec => ({
    asset: 'shelterBirds', position, gain, maxDistance, refDistance: 11, rolloff: 1.16,
    birdCalls: timing, rockResponse: true, activity: BIRD_ACTIVITY,
    filters: [{ type: 'highpass', frequency: 820 }, { type: 'lowpass', frequency: 5500 }],
  });
  return COAST_REST_SITES.filter(site => site.kind === 'terrace').flatMap(site => {
    const inland = site.id === 'lake-shelter';
    const across = { x: site.x + (inland ? 24 : -27), z: site.z + (inland ? -20 : 21) };
    return [perch(grovePosition(across, 8.7), 0.48, 57, { firstDelay: 9.5, pause: 28 })];
  });
}

function wildlifeEmitters(): EmitterSpec[] {
  const perch = (
    grove: { x: number; z: number }, height: number, gain: number, range: number,
  ): EmitterSpec => ({
    asset: 'forestBirds', position: grovePosition(grove, height), gain, refDistance: 9, maxDistance: range, rolloff: 1.12,
    birdCalls: { firstDelay: 8, pause: 26 }, rockResponse: true, activity: BIRD_ACTIVITY,
    filters: [{ type: 'highpass', frequency: 720 }, { type: 'lowpass', frequency: 9800 }],
  });
  const insectPatch = (grove: { x: number; z: number }, gain: number, range: number, cutoff = 6900): EmitterSpec => ({
    asset: 'insects', position: grovePosition(grove, 1.1), gain, refDistance: 5, maxDistance: range, rolloff: 1.2,
    activity: INSECT_ACTIVITY,
    filters: [{ type: 'highpass', frequency: 1400 }, { type: 'lowpass', frequency: cutoff }],
  });
  const forestInsectPatch = (x: number, z: number, nightGain: number, dayGain = 0): EmitterSpec => ({
    ...insectPatch({ x, z }, nightGain, 45, 8600),
    refDistance: 10,
    activity: { day: dayGain / nightGain, night: 1 },
  });
  return [
    perch({ x: -38, z: 358 }, 10, 0.72, 76),
    perch({ x: 97, z: 458 }, 9, 0.52, 74),
    perch({ x: 37, z: 584 }, 11, 0.54, 82),
    perch({ x: 133, z: 855 }, 9, 0.50, 76),
    ...shelterBirdEmitters(),
    insectPatch(COAST_GROVES.west, 0.16, 36),
    insectPatch(COAST_GROVES.east, 0.17, 38),
    {
      // Keep the calls above the surf from the beach path, especially with the grove behind the listener.
      ...insectPatch(COAST_GROVES.shore, 0.86, 35, 8600),
      refDistance: 11,
      activity: { day: 0.006, night: 1 },
    },
    // Understory between the shore shelter and the fork.
    forestInsectPatch(-45, 117, 0.68),
    forestInsectPatch(-31, 151, 0.62),
    forestInsectPatch(5, 204, 0.65, 0.016),
    // Ravine mouths and ledges toward the high clearing.
    forestInsectPatch(-28, 251, 0.67, 0.020),
    forestInsectPatch(-54, 282, 0.67),
    forestInsectPatch(-68, 324, 0.66),
    forestInsectPatch(-16, 347, 0.62, 0.014),
    forestInsectPatch(-53, 370, 0.55),
    // Dry banks around the ford and headwater.
    forestInsectPatch(42, 252, 0.76, 0.017),
    forestInsectPatch(59, 294, 0.78),
    forestInsectPatch(71, 330, 0.60),
    forestInsectPatch(35, 366, 0.58),
    // Shaded edges of the high clearing and the forested saddle.
    forestInsectPatch(-22, 379, 0.60),
    forestInsectPatch(39, 407, 0.58),
    forestInsectPatch(87, 419, 0.59),
    forestInsectPatch(100, 459, 0.60),
    forestInsectPatch(106, 484, 0.59),
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
    private readonly timing: BirdCallTiming,
    private readonly fixedPhrases: boolean,
  ) {}

  schedule(now: number): void {
    if (!this.audible || this.source) return;
    this.nextCall ??= now + this.timing.firstDelay + Math.random() * 5;
    if (now < this.nextCall) return;
    const source = this.context.createBufferSource();
    const envelope = this.context.createGain();
    const rate = 0.95 + Math.random() * 0.1;
    const duration = Math.min(this.buffer.duration, this.fixedPhrases ? SHELTER_PHRASE_SECONDS : 1.9 + Math.random() * 1.9);
    const offset = this.fixedPhrases ? this.pickPhrase() : Math.random() * (this.buffer.duration - duration);
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
    this.nextCall = end + this.timing.pause + Math.random() * 15;
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
  private readonly birdVoices = new Map<CoastBirdSpecies, BirdVoice[]>();
  private readonly lastBirdPhrase = new Map<CoastBirdSpecies, number>();
  private readonly shoreVoices: ShoreVoice[] = [];
  private shorePatches: ShorePatch[] = [];
  private readonly buffers: Partial<Record<AudioAsset, AudioBuffer>> = {};
  private readonly assetLoads: Partial<Record<AudioAsset, Promise<AudioBuffer>>> = {};
  private readonly assetRequest = new AbortController();
  private pendingStart: Promise<void> | undefined;
  private started = false;
  private disposed = false;
  private mix = DEFAULT_EXPLORATION_MIX;
  private timeOfDay: CoastTimeOfDay = 'day';
  private airExposure = 1;
  private nextPropagationUpdate = 0;
  private nextShoreSelection = 0;
  private lastShoreSelection: CoastPoint | undefined;
  private scheduleTimer: ReturnType<typeof setTimeout> | undefined;

  isRunning(): boolean {
    return this.started && this.context?.state === 'running';
  }

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('CoastAudio has been disposed'));

    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' });
      const context = this.context;
      // A gesture can unlock an earlier start that is still waiting on resume.
      const resume = context.state === 'running' ? Promise.resolve() : context.resume();
      if (this.pendingStart) return Promise.all([resume, this.pendingStart]).then(() => undefined);
      this.ensureGraph(context);
      const start = this.started ? resume : Promise.all([
        resume,
        ...(Object.keys(ASSETS) as AudioAsset[]).map(asset => {
          const load = this.loadAsset(asset, context);
          return asset in BIRD_CALLS ? load.catch(() => undefined) : load;
        }),
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

  setMix(mix: ExplorationMix): void {
    this.mix = mix;
    const context = this.context;
    if (!this.master || !context) return;
    const now = context.currentTime;
    this.master.gain.setTargetAtTime(mix.master * NOMINAL_MASTER_GAIN, now, 0.035);
    const applyChannel = (voice: SpatialVoice) => {
      voice.mixGain.gain.setTargetAtTime(explorationSoundGain(mix, ASSETS[voice.spec.asset].sound), now, 0.035);
    };
    for (const voice of this.voices) applyChannel(voice);
    for (const flock of this.birdVoices.values()) {
      for (const bird of flock) applyChannel(bird.voice);
    }
    this.foley?.setMix(mix);
  }

  setTimeOfDay(time: CoastTimeOfDay): void {
    if (this.timeOfDay === time) return;
    this.timeOfDay = time;
    this.nextPropagationUpdate = 0;
    if (!this.context) return;
    const now = this.context.currentTime;
    const applyActivity = (voice: SpatialVoice) => {
      if (!voice.activity || !voice.spec.activity) return;
      const gain = voice.spec.activity[time];
      voice.activity.gain.setTargetAtTime(gain, now, 0.24);
      if (gain === 0 && voice.recording) voice.recording.audible = false;
    };
    for (const voice of this.voices) applyActivity(voice);
    for (const flock of this.birdVoices.values()) {
      for (const bird of flock) applyActivity(bird.voice);
    }
  }

  update(position: Vector3, forward: Vector3, up: Vector3, elapsed: number, movement?: CoastMovement,
    cues?: readonly CoastBirdCue[],
  ): void {
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
    if (context.state !== 'running') return;
    const now = context.currentTime;
    if (this.timeOfDay === 'day' && cues?.length && this.started) this.playBirdCues(context, position, now, cues);
    if (now < this.nextPropagationUpdate) return;
    this.nextPropagationUpdate = now + 0.113;
    const waterLevel = coastWaterLevel(position.x, position.z);
    const immersion = smoothstep(-0.03, 0.62, waterLevel - position.y);
    this.airExposure = 1 - immersion;
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
    for (const voice of this.voices) this.updateVoicePropagation(voice, listener, terrain, now, elapsed);
    for (const flock of this.birdVoices.values()) {
      for (const bird of flock) {
        const call = bird.call;
        if (!call) continue;
        if (now >= call.releaseAt) {
          bird.call = undefined;
          continue;
        }
        const flight = Math.min(1.5, Math.max(0, now - call.startsAt));
        const { cue } = call;
        const point = bird.voice.point;
        point.x = cue.x + (cue.vx ?? 0) * flight;
        point.y = cue.y + (cue.vy ?? 0) * flight;
        point.z = cue.z + (cue.vz ?? 0) * flight;
        bird.panner.positionX.setTargetAtTime(point.x, now, 0.045);
        bird.panner.positionY.setTargetAtTime(point.y, now, 0.045);
        bird.panner.positionZ.setTargetAtTime(point.z, now, 0.045);
        this.updateVoicePropagation(bird.voice, listener, terrain, now, elapsed);
      }
    }
  }

  private updateVoicePropagation(
    voice: SpatialVoice, listener: CoastPoint, terrain: ReturnType<typeof listenerTerrain>,
    now: number, elapsed: number, onset = false,
  ): void {
    const shore = voice.shore;
    if (shore && !shore.patch) {
      if (voice.recording) voice.recording.audible = false;
      return;
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
    const horizontal = Math.hypot(point.x - listener.x, point.z - listener.z);
    const distance = Math.hypot(horizontal, point.y - listener.y);
    const reach = soundReach(distance, voice.range);
    const lift = thermalRayLift(horizontal, this.timeOfDay) * this.airExposure;
    const blocked = reach > 0 ? terrainOcclusion(listener, point, lift) : 0;
    const canopyLoss = terrain.canopy * smoothstep(14, 140, distance);
    const airLoss = 1 - canopyLoss * 0.58;
    const cutoff = airCutoff(distance) * airLoss;
    const transmission = shore ? shoreTransmission(distance, blocked)
      : { gain: reach * 0.11 ** blocked, cutoff: Math.max(350, cutoff * 0.075 ** blocked) };
    if (voice.recording) {
      voice.recording.audible = reach > 0.012 && shore?.releaseAt === undefined
        && (voice.spec.activity?.[this.timeOfDay] ?? 1) > 0;
    }
    if (shore && reach > 0.012 && shore.releaseAt === undefined) shore.breaker.update(phase, distance, now);
    if (shore && voice.recording) voice.recording.schedule(now);
    const frequency = Math.max(330, transmission.cutoff * (shore ? airLoss : 1));
    const lowBand = thermalLowShelfDb(distance, this.timeOfDay) * this.airExposure;
    if (onset) {
      voice.obstruction.frequency.setValueAtTime(frequency, now);
      voice.direct.gain.setValueAtTime(transmission.gain, now);
      voice.atmosphere?.gain.setValueAtTime(lowBand, now);
    } else {
      voice.obstruction.frequency.setTargetAtTime(frequency, now, 0.12);
      voice.direct.gain.setTargetAtTime(transmission.gain, now, 0.12);
      voice.atmosphere?.gain.setTargetAtTime(lowBand, now, 0.22);
    }

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
    if (!branch) return;
    const reflection = reach > 0 ? waterReflection(listener, point) : { gain: 0, delay: 0 };
    branch.gain.gain.setTargetAtTime(branch.strength * reflection.gain * reach, now, 0.15);
    if (reflection.gain === 0) return;
    branch.delay.delayTime.setTargetAtTime(reflection.delay, now, 0.18);
    branch.surface.frequency.setTargetAtTime(Math.min(3850, cutoff * 0.72), now, 0.15);
  }

  private playBirdCues(context: AudioContext, listener: CoastPoint, now: number, cues: readonly CoastBirdCue[]): void {
    let terrain: ReturnType<typeof listenerTerrain> | undefined;
    for (const cue of cues) {
      const birds = this.birdVoices.get(cue.species);
      const buffer = this.buffers[cue.species];
      const profile = BIRD_CALLS[cue.species];
      if (!birds || !buffer || cue.gain <= 0 || birds.some(bird => bird.call?.cue.id === cue.id)) continue;
      const distance = Math.hypot(cue.x - listener.x, cue.y - listener.y, cue.z - listener.z);
      if (soundReach(distance, BIRD_CALL_RANGE[cue.species]) < 0.018) continue;
      const bird = birds.find(candidate => !candidate.call);
      if (!bird) continue;

      const previous = this.lastBirdPhrase.get(cue.species);
      const count = profile.lengths.length;
      const phrase = previous === undefined ? Math.floor(Math.random() * count)
        : (previous + 1 + Math.floor(Math.random() * (count - 1))) % count;
      const offset = phrase * BIRD_PHRASE_STRIDE;
      const duration = Math.min(profile.lengths[phrase], buffer.duration - offset);
      if (duration <= 0) continue;
      this.lastBirdPhrase.set(cue.species, phrase);

      const { panner, voice } = bird;
      const point = voice.point;
      point.x = cue.x;
      point.y = cue.y;
      point.z = cue.z;
      const { positionX, positionY, positionZ } = panner;
      positionX.cancelScheduledValues(now);
      positionY.cancelScheduledValues(now);
      positionZ.cancelScheduledValues(now);
      positionX.setValueAtTime(point.x, now);
      positionY.setValueAtTime(point.y, now);
      positionZ.setValueAtTime(point.z, now);
      bird.input.gain.value = profile.gain * Math.min(1, cue.gain);
      voice.rock?.gain.gain.setValueAtTime(0, now);
      this.updateVoicePropagation(voice, listener, terrain ??= listenerTerrain(listener), now, 0, true);

      const source = context.createBufferSource();
      const rate = 0.975 + Math.random() * 0.05;
      const startsAt = now + Math.max(0.012, distance / 343);
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.connect(bird.input);
      source.onended = () => { source.disconnect(); };
      bird.call = { source, cue, startsAt, releaseAt: startsAt + duration / rate + 0.25 };
      source.start(startsAt, offset, duration);
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
    for (const flock of this.birdVoices.values()) {
      for (const bird of flock) {
        if (!bird.call) continue;
        const { source } = bird.call;
        source.onended = null;
        source.stop();
        source.disconnect();
      }
    }
    this.birdVoices.clear();
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
    master.gain.value = this.mix.master * NOMINAL_MASTER_GAIN;
    compressor.connect(master);
    const output = connectExplorationOutput(context, master);
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
    this.foley.setMix(this.mix);
    this.graphNodes.push(compressor, master, ...output, medium, mediumLevel, tail, level);
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
    const request = fetch(`${base}coast-audio/${ASSETS[asset].file}`, { signal: this.assetRequest.signal })
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
    const waterfalls: EmitterSpec[] = COAST_FALLS.slice(0, 3).map((fall, index) => ({
      asset: 'waterfall', position: positionOf(fall.path[Math.round((fall.path.length - 1) * 0.65)]),
      gain: 0.81 * 0.68 ** index, refDistance: 28, maxDistance: 900, rolloff: 0.41, waterReflection: 0.27,
      rockResponse: true,
      filters: [{ type: 'lowpass', frequency: 7600 }],
    }));
    for (const fall of COAST_FALLS.slice(3)) {
      const ledge = fall.id === 'shore-ledge';
      const source = ledge ? { ...fall.impact, y: fall.impact.y + 1.1 }
        : fall.path[Math.round((fall.path.length - 1) * 0.72)];
      waterfalls.push({
        asset: 'waterfall', position: positionOf(source),
        gain: ledge ? 0.25 : 0.35, refDistance: ledge ? 8 : 17, maxDistance: ledge ? 93 : 390,
        rolloff: ledge ? 0.95 : 0.54, waterReflection: ledge ? 0.12 : 0.20, rockResponse: true,
        filters: [{ type: 'lowpass', frequency: ledge ? 8300 : 6900 }],
      });
    }
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
        this.voices.push(voice);
        if (emitter.birdCalls) {
          voice.recording = new BirdCalls(context, buffer, input, emitter.birdCalls, emitter.asset === 'shelterBirds');
        } else {
          voice.recording = new VariationLoop(context, buffer, input);
        }
      }
      for (const species of BIRD_SPECIES) {
        if (!this.buffers[species]) continue;
        const profile = BIRD_CALLS[species];
        const flock = Array.from({ length: BIRD_VOICES_PER_SPECIES }, () => this.createEmitter(context, {
          asset: species, position: [0, 0, 0], gain: profile.gain,
          refDistance: profile.refDistance, maxDistance: BIRD_CALL_RANGE[species], rolloff: 1.12,
          rockResponse: true, activity: BIRD_ACTIVITY, filters: [{ type: 'highpass', frequency: profile.highpass }],
        }));
        this.birdVoices.set(species, flock);
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
      this.birdVoices.clear();
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
    this.voices.push(voice);
    this.shoreVoices.push(shore);
  }

  private createEmitter(context: AudioContext, spec: EmitterSpec): {
    input: GainNode;
    panner: PannerNode;
    voice: SpatialVoice;
  } {
    const input = context.createGain();
    input.gain.value = spec.gain;
    const mixGain = context.createGain();
    mixGain.gain.value = explorationSoundGain(this.mix, ASSETS[spec.asset].sound);
    input.connect(mixGain);
    // Direct sound and both reflected paths share the same channel gain.
    let tail: AudioNode = mixGain;
    this.graphNodes.push(input, mixGain);

    let activity: GainNode | undefined;
    if (spec.activity) {
      activity = context.createGain();
      activity.gain.value = spec.activity[this.timeOfDay];
      tail.connect(activity);
      tail = activity;
      this.graphNodes.push(activity);
    }

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
    let atmosphere: BiquadFilterNode | undefined;
    if (spec.maxDistance > 60) {
      atmosphere = context.createBiquadFilter();
      atmosphere.type = 'lowshelf';
      atmosphere.frequency.value = REFRACTION_SHELF_HZ;
      tail.connect(atmosphere).connect(obstruction);
      this.graphNodes.push(atmosphere);
    } else {
      tail.connect(obstruction);
    }
    obstruction.connect(direct).connect(panner).connect(this.medium!.input);
    this.graphNodes.push(obstruction, direct, panner);

    const voice: SpatialVoice = {
      spec, point, range: spec.maxDistance, obstruction, direct, mixGain, atmosphere, activity,
    };
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
}
