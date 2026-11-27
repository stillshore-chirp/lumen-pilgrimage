import type { Vector3 } from 'three';
import { EYE_HEIGHT, type CoastMovement } from '../../CoastControls';
import { BIRD_CALL_RANGE, type CoastBirdCue, type CoastBirdSpecies } from '../../coastBirdCue';
import { connectExplorationOutput } from '../../explorationOutput';
import { DEFAULT_EXPLORATION_MIX, explorationSoundGain, type ExplorationMix } from '../../explorationSound';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import { createFootfall } from '../residence/residenceAudioSamples';
import {
  createLakeSoundPaths, lakeSoundPaths, lakeSurfaceAt, LAKE_MAX_VENT_DELAY,
  type LakePoint, type LakeSoundPaths, type LakeSurface,
} from './lakeAudioAcoustics';
import { createLakeWater } from './lakeAudioSamples';
import { LakeKoto } from './lakeKoto';
import { LAKE_HALL, LAKE_SPAWN, LAKE_WATER_Y, LAKE_WINDOW_VIEW_X } from './lakeLayout';

const MIX_SOUNDS = ['water', 'birds', 'footsteps'] as const;
type MixSound = typeof MIX_SOUNDS[number];
export const LAKE_AUDIO_MASTER_GAIN = 0.66;
const PROPAGATION_INTERVAL = 0.05;
const PROPAGATION_SMOOTHING = 0.075;
const BIRD_ASSETS = {
  gull: { file: 'gull-calls.ogg', lengths: [1.65, 2.35, 1.85], gain: 0.70 },
  whiteEye: { file: 'white-eye-calls.ogg', lengths: [1.75, 1.55, 2, 1.85], gain: 0.96 },
  bushWarbler: { file: 'bush-warbler-calls.ogg', lengths: [1.45, 2.1, 1.65], gain: 0.92 },
  thrush: { file: 'thrush-calls.ogg', lengths: [2.65, 3.2, 2.75], gain: 1.12 },
} satisfies Record<CoastBirdSpecies, { file: string; lengths: number[]; gain: number }>;
const DISTANT_BIRDS = [
  { species: 'whiteEye', x: -44, y: 14.8, z: -49 },
  { species: 'thrush', x: 41.5, y: 6.2, z: -52.5 },
] as const;
const FOOTSTEPS = {
  tatami: { sample: 'tatami', gain: 0.58, rate: 0.96 },
  wood: { sample: 'balcony', gain: 0.70, rate: 1.04 },
} as const;

interface ArrivalNodes {
  readonly panner: PannerNode;
  readonly filter: BiquadFilterNode;
  readonly level: GainNode;
  readonly delay?: DelayNode;
}

interface ExteriorVoice {
  readonly input: GainNode;
  readonly paths: LakeSoundPaths;
  readonly arrivals: readonly ArrivalNodes[];
}

interface BirdPlayback {
  readonly source: AudioBufferSourceNode;
  readonly shot: LakePoint;
  readonly position: { x: number; y: number; z: number };
  readonly velocity: LakePoint;
  readonly firedAt: number;
  readonly gain: number;
}

function spatialPanner(context: AudioContext): PannerNode {
  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  // Exterior path length, including a possible detour, is applied explicitly.
  panner.rolloffFactor = 0;
  return panner;
}

function placePanner(panner: PannerNode, point: LakePoint, now: number, immediate = false): void {
  follow(panner.positionX, point.x, now, immediate);
  follow(panner.positionY, point.y, now, immediate);
  follow(panner.positionZ, point.z, now, immediate);
}

function follow(param: AudioParam, target: number, now: number, immediate: boolean): void {
  if (immediate) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(target, now);
  } else {
    param.setTargetAtTime(target, now, PROPAGATION_SMOOTHING);
  }
}

function createExteriorVoice(context: AudioContext, bus: GainNode): ExteriorVoice {
  const input = context.createGain();
  const paths = createLakeSoundPaths();
  const arrivals = paths.map((point, index) => {
    const level = context.createGain();
    level.gain.value = 0;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    const panner = spatialPanner(context);
    placePanner(panner, point, context.currentTime, true);
    const delay = index === 0 ? undefined : context.createDelay(LAKE_MAX_VENT_DELAY);
    if (delay) input.connect(delay).connect(filter);
    else input.connect(filter);
    filter.connect(level).connect(panner).connect(bus);
    return { panner, filter, level, delay };
  });
  return { input, paths, arrivals };
}

function updateExteriorVoice(
  voice: ExteriorVoice, listener: LakePoint, source: LakePoint, strength: number, now: number, immediate = false,
): void {
  lakeSoundPaths(listener, source, voice.paths);
  for (const [index, arrival] of voice.arrivals.entries()) {
    const path = voice.paths[index];
    follow(arrival.level.gain, strength * path.gain, now, immediate);
    if (path.gain === 0) continue;
    follow(arrival.filter.frequency, path.cutoff, now, immediate);
    if (arrival.delay) follow(arrival.delay.delayTime, path.delay, now, immediate);
    placePanner(arrival.panner, path, now, immediate);
  }
}

export class LakeAudio {
  private readonly request = new AbortController();
  private readonly voices: ExteriorVoice[] = [];
  private readonly water: { point: LakePoint; source: AudioBufferSourceNode; voice: ExteriorVoice }[] = [];
  private readonly birdBuffers = new Map<CoastBirdSpecies, AudioBuffer>();
  private readonly lastPhrase = new Map<CoastBirdSpecies, number>();
  private readonly footfalls = new Map<LakeSurface, readonly AudioBuffer[]>();
  private readonly footsteps = new Set<AudioBufferSourceNode>();
  private context?: AudioContext;
  private koto?: LakeKoto;
  private kotoRequest = 0;
  private listenerPosition: LakePoint = { x: LAKE_SPAWN.x, y: EYE_HEIGHT, z: LAKE_SPAWN.z };
  private master?: GainNode;
  private buses?: Record<MixSound, GainNode>;
  private output: readonly AudioNode[] = [];
  private mix = DEFAULT_EXPLORATION_MIX;
  private time: CoastTimeOfDay = 'day';
  private birdVoice?: ExteriorVoice;
  private playingBird?: BirdPlayback;
  private nextCue = 0;
  private nextDistantBird = Infinity;
  private nextPropagation = 0;
  private previousStep?: { x: number; z: number; elapsed: number };
  private stepTravel = 0;
  private stepIndex = 0;

  isRunning(): boolean {
    return Boolean(this.buses && this.context?.state === 'running');
  }

  get kotoPlaying(): boolean {
    return this.koto?.playing ?? false;
  }

  async setKotoPlaying(value: boolean): Promise<void> {
    const request = ++this.kotoRequest;
    if (!value) {
      this.koto?.stop();
      return;
    }
    await this.start();
    if (request !== this.kotoRequest || this.request.signal.aborted || !this.context || !this.master) return;
    this.koto ??= new LakeKoto(this.context, this.master);
    await this.koto.play(this.listenerPosition);
  }

  start(): Promise<void> {
    if (this.request.signal.aborted) return Promise.reject(new Error('LakeAudio has been disposed'));
    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' });
      const context = this.context;
      const resume = context.state === 'running' ? Promise.resolve() : context.resume();
      try {
        if (!this.buses) this.beginLayers(context);
      } catch (error) {
        void resume.catch(() => undefined);
        this.release();
        return Promise.reject(error);
      }
      return resume;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  setMix(mix: ExplorationMix): void {
    this.mix = mix;
    if (this.context) this.updateMix(this.context.currentTime);
  }

  setTimeOfDay(time: CoastTimeOfDay): void {
    if (time === this.time) return;
    this.time = time;
    const now = this.context?.currentTime ?? 0;
    this.nextDistantBird = time === 'day' ? now + 9 + 8 * Math.random() : Infinity;
    this.updateMix(now);
  }

  update(position: Vector3, forward: Vector3, up: Vector3, elapsed: number, movement: CoastMovement,
    birdCues: readonly CoastBirdCue[], grounded: boolean, navigationPosition: Vector3): void {
    this.listenerPosition = position;
    const context = this.context;
    const buses = this.buses;
    if (!buses || !context || context.state !== 'running') return;
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

    const now = context.currentTime;
    if (now >= this.nextPropagation) {
      this.nextPropagation = now + PROPAGATION_INTERVAL;
      this.koto?.update(position, now);
      const waterStrength = this.time === 'day' ? 0.87 : 0.67;
      for (const { voice, point } of this.water) updateExteriorVoice(voice, position, point, waterStrength, now);
      const call = this.playingBird;
      if (this.birdVoice && call) {
        const t = now - call.firedAt;
        call.position.x = call.shot.x + call.velocity.x * t;
        call.position.y = call.shot.y + call.velocity.y * t;
        call.position.z = call.shot.z + call.velocity.z * t;
        updateExteriorVoice(this.birdVoice, position, call.position, call.gain, now);
      }
    }
    this.updateBirds(context, position, birdCues);
    this.updateFootsteps(context, buses.footsteps, navigationPosition, elapsed, movement, grounded);
  }

  dispose(): void {
    if (this.request.signal.aborted) return;
    this.request.abort();
    this.release();
  }

  private beginLayers(context: AudioContext): void {
    const master = context.createGain();
    this.master = master;
    this.output = connectExplorationOutput(context, master);
    const createBus = () => {
      const bus = context.createGain();
      bus.gain.value = 0;
      bus.connect(master);
      return bus;
    };
    const buses = { water: createBus(), birds: createBus(), footsteps: createBus() };
    this.buses = buses;
    this.updateMix(context.currentTime, true);
    for (const [index, side] of [-1, 1].entries()) {
      const point = {
        x: side * LAKE_WINDOW_VIEW_X,
        y: LAKE_WATER_Y,
        z: LAKE_HALL.frontZ - 9.2 - index * 0.4,
      };
      const voice = this.addExteriorVoice(context, buses.water);
      const source = context.createBufferSource();
      source.buffer = createLakeWater(context, 4583 + index * 727);
      source.loop = true;
      source.playbackRate.value = 0.986 + 0.027 * index;
      source.connect(voice.input);
      this.water.push({ source, point, voice });
      source.start(0, 3 + index * 6.1);
    }
    this.birdVoice = this.addExteriorVoice(context, buses.birds);
    this.nextDistantBird = context.currentTime + 9 + 9 * Math.random();
    for (const species of Object.keys(BIRD_ASSETS) as CoastBirdSpecies[]) void this.loadBird(context, species);
  }

  private addExteriorVoice(context: AudioContext, bus: GainNode): ExteriorVoice {
    const voice = createExteriorVoice(context, bus);
    this.voices.push(voice);
    return voice;
  }

  private async loadBird(context: AudioContext, species: CoastBirdSpecies): Promise<void> {
    try {
      const asset = `${import.meta.env.BASE_URL}coast-audio/${BIRD_ASSETS[species].file}`;
      const response = await fetch(asset, { signal: this.request.signal });
      if (!response.ok || this.context !== context) return;
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (this.context === context) this.birdBuffers.set(species, buffer);
    } catch {
      // Water and footsteps remain available if a local recording cannot be decoded.
    }
  }

  private updateMix(now: number, immediate = false): void {
    if (!this.master || !this.buses) return;
    const setGain = (param: AudioParam, target: number) => {
      if (immediate) param.value = target;
      else param.setTargetAtTime(target, now, 0.04);
    };
    setGain(this.master.gain, this.mix.master * LAKE_AUDIO_MASTER_GAIN);
    for (const kind of MIX_SOUNDS) {
      const activity = kind === 'birds' && this.time === 'night' ? 0.44 : 1;
      setGain(this.buses[kind].gain, activity * explorationSoundGain(this.mix, kind));
    }
  }

  private updateBirds(context: AudioContext, listener: LakePoint, cues: readonly CoastBirdCue[]): void {
    const now = context.currentTime;
    if (this.playingBird || now < this.nextCue
      || !explorationSoundGain(this.mix, 'birds')) return;
    let nearest: CoastBirdCue | undefined;
    let bestStrength = 0;
    for (const cue of cues) {
      if (!this.birdBuffers.has(cue.species)) continue;
      const distance = Math.hypot(listener.x - cue.x, listener.y - cue.y, listener.z - cue.z);
      if (distance >= BIRD_CALL_RANGE[cue.species]) continue;
      const strength = cue.gain / (8 + distance);
      if (strength > bestStrength) {
        nearest = cue;
        bestStrength = strength;
      }
    }
    if (nearest) {
      this.playBird(context, listener, nearest.species, nearest, Math.min(1, nearest.gain), nearest);
    } else if (this.time === 'day' && now >= this.nextDistantBird) {
      const perches = DISTANT_BIRDS.filter(({ species }) => this.birdBuffers.has(species));
      const perch = perches[Math.floor(Math.random() * perches.length)];
      if (perch) this.playBird(context, listener, perch.species, perch, 0.84);
    }
  }

  private playBird(context: AudioContext, listener: LakePoint, species: CoastBirdSpecies, point: LakePoint,
    strength: number, cue?: CoastBirdCue): void {
    const buffer = this.birdBuffers.get(species);
    const voice = this.birdVoice;
    if (!buffer || !voice) return;
    const profile = BIRD_ASSETS[species];
    const count = profile.lengths.length;
    const previous = this.lastPhrase.get(species);
    const phrase = previous === undefined ? Math.floor(Math.random() * count)
      : (previous + 1 + Math.floor(Math.random() * (count - 1))) % count;
    // Prepared local recordings place the start of each phrase 3.5 seconds apart.
    const offset = phrase * 3.5;
    const length = Math.min(profile.lengths[phrase], buffer.duration - offset);
    if (length <= 0) return;
    this.lastPhrase.set(species, phrase);
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = profile.gain * strength;
    updateExteriorVoice(voice, listener, point, gain, now, true);
    source.connect(voice.input);
    source.onended = () => {
      source.disconnect();
      if (this.playingBird?.source === source) this.playingBird = undefined;
    };
    const shot = { x: point.x, y: point.y, z: point.z };
    this.playingBird = {
      source, shot, position: { ...shot }, gain, firedAt: now,
      velocity: { x: cue?.vx ?? 0, y: cue?.vy ?? 0, z: cue?.vz ?? 0 },
    };
    source.start(now, offset, length);
    this.nextCue = now + (this.time === 'day' ? 14 + 11 * Math.random() : 54 + 34 * Math.random());
    this.nextDistantBird = now + 33 + 26 * Math.random();
  }

  private updateFootsteps(context: AudioContext, bus: GainNode, position: LakePoint, elapsed: number,
    movement: CoastMovement, grounded: boolean): void {
    const previous = this.previousStep;
    const { x, z } = position;
    const walking = grounded && (movement === 'walk' || movement === 'crouch')
      && explorationSoundGain(this.mix, 'footsteps') > 0;
    this.previousStep = walking ? { x, z, elapsed } : undefined;
    if (!previous || !walking || elapsed - previous.elapsed > 0.26 || elapsed <= previous.elapsed) {
      this.stepTravel = 0;
      return;
    }
    const dx = x - previous.x;
    const dz = z - previous.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001 || distance > 1.4) {
      this.stepTravel = 0;
      return;
    }
    const crouching = movement === 'crouch';
    const stride = crouching ? 0.52 : 0.83;
    this.stepTravel += distance;
    if (this.stepTravel < stride) return;
    this.stepTravel %= stride;

    const lateral = (this.stepIndex % 2 ? -0.13 : 0.13) / distance;
    const point = { x: x - dz * lateral, y: 0.04, z: z + dx * lateral };
    const surface = lakeSurfaceAt(point.x, point.z) ?? lakeSurfaceAt(x, z);
    if (!surface) return;
    const profile = FOOTSTEPS[surface];
    let samples = this.footfalls.get(surface);
    if (!samples) {
      samples = [347, 589, 1093, 2053, 4177].map(seed => createFootfall(context, profile.sample, seed));
      this.footfalls.set(surface, samples);
    }
    const source = context.createBufferSource();
    source.buffer = samples[this.stepIndex % samples.length];
    source.playbackRate.value = profile.rate * (0.97 + 0.06 * Math.random());
    const level = context.createGain();
    level.gain.value = profile.gain * (crouching ? 0.65 : 1);
    const panner = spatialPanner(context);
    panner.rolloffFactor = 0.72;
    panner.refDistance = 1.15;
    placePanner(panner, point, context.currentTime, true);
    source.connect(level).connect(panner).connect(bus);
    source.onended = () => {
      source.disconnect();
      level.disconnect();
      panner.disconnect();
      this.footsteps.delete(source);
    };
    this.footsteps.add(source);
    source.start();
    this.stepIndex += 1;
  }

  private release(): void {
    const context = this.context;
    this.context = undefined;
    for (const { source } of this.water) {
      source.stop();
      source.disconnect();
    }
    this.playingBird?.source.stop();
    for (const source of this.footsteps) source.stop();
    this.footsteps.clear();
    for (const voice of this.voices) {
      voice.input.disconnect();
      for (const { panner, filter, level, delay } of voice.arrivals) {
        delay?.disconnect();
        filter.disconnect();
        level.disconnect();
        panner.disconnect();
      }
    }
    this.koto?.dispose();
    this.koto = undefined;
    this.master?.disconnect();
    for (const node of this.output) node.disconnect();
    if (this.buses) for (const kind of MIX_SOUNDS) this.buses[kind].disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    this.voices.length = 0;
    this.water.length = 0;
    this.birdVoice = undefined;
    this.playingBird = undefined;
    this.birdBuffers.clear();
    this.lastPhrase.clear();
    this.footfalls.clear();
    this.master = undefined;
    this.buses = undefined;
    this.output = [];
  }
}
