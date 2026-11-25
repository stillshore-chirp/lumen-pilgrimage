import { Vector3 } from 'three';
import { groundEyeHeight, type CoastMovement } from '../../CoastControls';
import type { CoastBirdCue } from '../../coastBirdCue';
import { connectExplorationOutput } from '../../explorationOutput';
import { DEFAULT_EXPLORATION_MIX, type ExplorationMix } from '../../explorationSound';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import {
  atriumAirSource,
  atriumCafeSource,
  atriumGallerySources,
  atriumListenerUpdatePeriod,
  atriumSoundPath,
  atriumSurfaceAt,
  type AtriumPoint,
  type AtriumSurface,
} from './atriumAcoustics';
import {
  createAtriumAirLoop,
  createAtriumCrowdLoop,
  createAtriumDishEvent,
  createAtriumFootfall,
  createAtriumGalleryEvent,
  createAtriumGalleryLoop,
  createAtriumRoomTail,
} from './atriumAudioSamples';
import { atriumSupportAt } from './atriumNavigation';

type EnvironmentKind = 'crowd' | 'appliances';
type AtriumBusKind = EnvironmentKind | 'footsteps';
type MixLevels = Readonly<Record<string, number>>;

type ArrivalVoice = {
  readonly filter: BiquadFilterNode;
  readonly delay: DelayNode;
  readonly gain: GainNode;
  readonly panner: PannerNode;
};

type SpatialVoice = {
  readonly kind: EnvironmentKind;
  readonly point: AtriumPoint;
  readonly baseGain: number;
  readonly input: GainNode;
  readonly directFilter: BiquadFilterNode;
  readonly directGain: GainNode;
  readonly panner: PannerNode;
  readonly lateGain: GainNode;
  readonly arrivals: readonly ArrivalVoice[];
  readonly source?: AudioBufferSourceNode;
};

type FootVoice = {
  readonly panner: PannerNode;
  readonly gain: GainNode;
  busy: boolean;
};

type Tail = { input: GainNode; convolver: ConvolverNode };

type Graph = {
  readonly master: GainNode;
  readonly outputNodes: readonly AudioNode[];
  readonly buses: Record<AtriumBusKind, GainNode>;
  readonly tails: Record<EnvironmentKind, Tail>;
  readonly footTail: Tail;
  readonly voices: SpatialVoice[];
  readonly events: SpatialVoice[];
  readonly feet: FootVoice[];
  readonly sources: Set<AudioBufferSourceNode>;
  readonly dishBuffer: AudioBuffer;
  readonly galleryEventBuffer: AudioBuffer;
  readonly footfallSamples: Map<AtriumSurface, readonly AudioBuffer[]>;
};

const NOMINAL_MASTER_GAIN = 0.7 * 0.86;
const PROPAGATION_PERIOD = atriumListenerUpdatePeriod();
const FOOTFALL_INTERVAL = 0.30;
const FOOTFALL_STRIDES: Record<AtriumSurface, number> = {
  stone: 0.72,
  rug: 0.78,
  stair: 0.58,
  gallery: 0.70,
};
const FOOTFALL_GAINS: Record<AtriumSurface, number> = {
  stone: 0.85,
  rug: 0.68,
  stair: 0.92,
  gallery: 0.76,
};

function mixGain(mix: ExplorationMix, kind: AtriumBusKind): number {
  const levels = mix.levels as MixLevels;
  if (kind === 'footsteps') return mix.footstepsOn ? levels.footsteps ?? 1 : 0;
  return mix.environmentOn ? levels[kind] ?? 1 : 0;
}

function setParam(param: AudioParam, value: number, now: number, timeConstant = 0.08): void {
  param.setTargetAtTime(value, now, timeConstant);
}

function setPoint(node: PannerNode, point: AtriumPoint, now: number, glide = 0): void {
  if (glide > 0) {
    setParam(node.positionX, point.x, now, glide);
    setParam(node.positionY, point.y, now, glide);
    setParam(node.positionZ, point.z, now, glide);
  } else {
    node.positionX.setValueAtTime(point.x, now);
    node.positionY.setValueAtTime(point.y, now);
    node.positionZ.setValueAtTime(point.z, now);
  }
}

function spatialPanner(context: BaseAudioContext, point: AtriumPoint): PannerNode {
  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.2;
  panner.maxDistance = 85;
  // Propagation computes the attenuation once; panner remains HRTF-only.
  panner.rolloffFactor = 0;
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 360;
  panner.positionX.value = point.x;
  panner.positionY.value = point.y;
  panner.positionZ.value = point.z;
  return panner;
}

function createTail(context: AudioContext, output: AudioNode, seed: number): Tail {
  const input = context.createGain();
  input.gain.value = 1;
  const convolver = context.createConvolver();
  convolver.normalize = false;
  convolver.buffer = createAtriumRoomTail(context, seed);
  input.connect(convolver).connect(output);
  return { input, convolver };
}

export class AtriumAudio {
  private readonly request = new AbortController();
  private readonly random = (() => {
    let state = 38_157;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 4_294_967_296;
    };
  })();
  private readonly sources = new Set<AudioBufferSourceNode>();
  private context: AudioContext | undefined;
  private graph: Graph | undefined;
  private pendingStart: Promise<void> | undefined;
  private mix = DEFAULT_EXPLORATION_MIX;
  private time: CoastTimeOfDay = 'day';
  private nextPropagation = 0;
  private nextDish = 0;
  private nextGalleryEvent = 0;
  private previousStep: { x: number; y: number; z: number; elapsed: number } | undefined;
  private traveled = 0;
  private side = 1;
  private lastFootstep = -Infinity;

  isRunning(): boolean {
    return Boolean(this.graph && this.context?.state === 'running');
  }

  start(): Promise<void> {
    if (this.request.signal.aborted) return Promise.reject(new Error('AtriumAudio has been disposed'));
    try {
      if (this.context?.state === 'closed') this.releaseContext();
      const context = this.context ??= new AudioContext({ latencyHint: 'interactive' });
      const resume = context.state === 'running' ? Promise.resolve() : context.resume();
      if (this.pendingStart) {
        void resume.catch(() => undefined);
        return this.pendingStart;
      }
      if (this.graph) return resume;
      this.pendingStart = resume.then(() => {
        if (this.request.signal.aborted || this.context !== context) {
          throw new Error('AtriumAudio is no longer active');
        }
        this.graph = this.buildGraph(context);
      }).catch((error: unknown) => {
        if (!this.graph && this.context === context) this.releaseContext();
        throw error;
      }).finally(() => { this.pendingStart = undefined; });
      return this.pendingStart;
    } catch (error) {
      if (!this.graph) this.releaseContext();
      return Promise.reject(error);
    }
  }

  setMix(mix: ExplorationMix): void {
    this.mix = mix;
    const graph = this.graph;
    const context = this.context;
    if (!graph || !context) return;
    const now = context.currentTime;
    setParam(graph.master.gain, mix.master * NOMINAL_MASTER_GAIN, now, 0.035);
    for (const kind of ['crowd', 'appliances', 'footsteps'] as const) {
      setParam(graph.buses[kind].gain, mixGain(mix, kind), now, 0.035);
    }
  }

  setTimeOfDay(time: CoastTimeOfDay): void {
    if (this.time === time) return;
    this.time = time;
    this.nextPropagation = 0;
    const context = this.context;
    if (context && this.graph) {
      const now = context.currentTime;
      this.nextDish = now + (time === 'night' ? 10 : 3.4);
      this.nextGalleryEvent = now + (time === 'night' ? 8 : 5);
    }
  }

  setTime(time: CoastTimeOfDay): void {
    this.setTimeOfDay(time);
  }

  update(position: Vector3, forward: Vector3, up: Vector3, elapsed: number, movement: CoastMovement,
    _birdCues: readonly CoastBirdCue[], grounded: boolean, navigationPosition: Vector3): void {
    const { context, graph } = this;
    if (!context || context.state !== 'running' || !graph) return;
    const { listener, currentTime: now } = context;
    listener.positionX.value = position.x;
    listener.positionY.value = position.y;
    listener.positionZ.value = position.z;
    listener.forwardX.value = forward.x;
    listener.forwardY.value = forward.y;
    listener.forwardZ.value = forward.z;
    listener.upX.value = up.x;
    listener.upY.value = up.y;
    listener.upZ.value = up.z;
    this.updateFootsteps(context, graph, navigationPosition, elapsed, movement, grounded, now);
    if (now >= this.nextPropagation) {
      this.nextPropagation = now + PROPAGATION_PERIOD;
      for (const voice of graph.voices) this.updateVoice(voice, position, now);
      for (const voice of graph.events) this.updateVoice(voice, position, now);
    }
    this.scheduleEvents(context, graph, position, now);
  }

  dispose(): void {
    if (this.request.signal.aborted) return;
    this.request.abort();
    this.releaseContext();
  }

  private buildGraph(context: AudioContext): Graph {
    const master = context.createGain();
    master.gain.value = this.mix.master * NOMINAL_MASTER_GAIN;
    const outputNodes = connectExplorationOutput(context, master);
    const createBus = (kind: AtriumBusKind): GainNode => {
      const bus = context.createGain();
      bus.gain.value = mixGain(this.mix, kind);
      bus.connect(master);
      return bus;
    };
    const buses = {
      crowd: createBus('crowd'),
      appliances: createBus('appliances'),
      footsteps: createBus('footsteps'),
    };
    const tails = {
      crowd: createTail(context, buses.crowd, 10_731),
      appliances: createTail(context, buses.appliances, 10_893),
    };
    const footTail = createTail(context, buses.footsteps, 11_109);
    const voices: SpatialVoice[] = [];
    const sources = new Set<AudioBufferSourceNode>();
    const crowd = createAtriumCrowdLoop(context, 1_731);
    const gallery = createAtriumGalleryLoop(context, 2_417);
    const air = createAtriumAirLoop(context, 3_811);
    const addLoop = (kind: EnvironmentKind, point: AtriumPoint, baseGain: number, buffer: AudioBuffer): void => {
      const voice = this.createVoice(context, kind, point, baseGain, tails, buses[kind]);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.connect(voice.input);
      source.start();
      sources.add(source);
      voices.push({ ...voice, source });
    };
    addLoop('crowd', atriumCafeSource(), 0.72, crowd);
    const galleryPoints = atriumGallerySources();
    addLoop('crowd', galleryPoints[0], 0.20, gallery);
    addLoop('crowd', galleryPoints[1], 0.17, gallery);
    addLoop('appliances', atriumAirSource(), 0.34, air);

    const feet = Array.from({ length: 4 }, (): FootVoice => {
      const panner = spatialPanner(context, { x: 0, y: 0, z: 0 });
      panner.refDistance = 0.95;
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(panner).connect(buses.footsteps);
      gain.connect(footTail.input);
      return { panner, gain, busy: false };
    });
    const now = context.currentTime;
    this.nextPropagation = 0;
    this.nextDish = now + 2.1;
    this.nextGalleryEvent = now + 4.8;
    const graph: Graph = {
      master, outputNodes, buses, tails, footTail, voices, events: [], feet, sources,
      dishBuffer: createAtriumDishEvent(context, 4_771),
      galleryEventBuffer: createAtriumGalleryEvent(context, 5_311),
      footfallSamples: new Map(),
    };
    return graph;
  }

  private createVoice(
    context: AudioContext, kind: EnvironmentKind, point: AtriumPoint, baseGain: number,
    tails: Record<EnvironmentKind, Tail>, output: AudioNode,
  ): Omit<SpatialVoice, 'source'> {
    const input = context.createGain();
    input.gain.value = 1;
    const directFilter = context.createBiquadFilter();
    directFilter.type = 'lowpass';
    directFilter.frequency.value = 17_500;
    directFilter.Q.value = -3;
    const directGain = context.createGain();
    directGain.gain.value = 0;
    const panner = spatialPanner(context, point);
    input.connect(directFilter).connect(directGain).connect(panner).connect(output);
    const lateGain = context.createGain();
    lateGain.gain.value = 0;
    input.connect(lateGain).connect(tails[kind].input);
    const arrivals = [0, 1].map(() => {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 4_000;
      filter.Q.value = -3;
      const delay = context.createDelay(0.24);
      const gain = context.createGain();
      gain.gain.value = 0;
      const arrivalPanner = spatialPanner(context, point);
      input.connect(filter).connect(delay).connect(gain).connect(arrivalPanner).connect(output);
      return { filter, delay, gain, panner: arrivalPanner };
    });
    return { kind, point, baseGain, input, directFilter, directGain, panner, lateGain, arrivals };
  }

  private updateVoice(voice: SpatialVoice, listener: AtriumPoint, now: number): void {
    const path = atriumSoundPath(listener, voice.point);
    const night = this.time === 'night' && voice.kind === 'crowd' ? 0.56 : 1;
    setParam(voice.directGain.gain, voice.baseGain * path.gain * night, now, 0.12);
    setParam(voice.directFilter.frequency, path.cutoff, now, 0.14);
    setPoint(voice.panner, voice.point, now, 0.12);
    setParam(voice.lateGain.gain, voice.baseGain * path.lateSend * night * 0.56, now, 0.16);
    for (let index = 0; index < voice.arrivals.length; index += 1) {
      const arrival = voice.arrivals[index];
      const reflection = path.reflections[index];
      if (!reflection) {
        setParam(arrival.gain.gain, 0, now, 0.14);
        continue;
      }
      setParam(arrival.gain.gain, voice.baseGain * reflection.gain * night, now, 0.14);
      setParam(arrival.delay.delayTime, reflection.delay, now, 0.14);
      setParam(arrival.filter.frequency, reflection.cutoff, now, 0.16);
      setPoint(arrival.panner, reflection.point, now, 0.12);
    }
  }

  private scheduleEvents(context: AudioContext, graph: Graph, listener: AtriumPoint, now: number): void {
    const crowdGain = mixGain(this.mix, 'crowd');
    if (crowdGain > 0 && now >= this.nextDish && graph.events.length < 3) {
      const cafe = atriumCafeSource();
      this.playEvent(context, graph, 'crowd', {
        x: cafe.x + (this.random() - 0.5) * 1.2,
        y: cafe.y - 0.12,
        z: cafe.z + (this.random() - 0.5) * 2.4,
      }, 0.34, graph.dishBuffer, listener);
      this.nextDish = now + (this.time === 'night' ? 12 : 5.4) + this.random() * 8.8;
    }
    if (crowdGain > 0 && now >= this.nextGalleryEvent && graph.events.length < 3) {
      const points = atriumGallerySources();
      const point = points[Math.floor(this.random() * points.length)];
      this.playEvent(context, graph, 'crowd', point, 0.18, graph.galleryEventBuffer, listener);
      this.nextGalleryEvent = now + (this.time === 'night' ? 16 : 9.5) + this.random() * 9;
    }
  }

  private playEvent(
    context: AudioContext, graph: Graph, kind: EnvironmentKind, point: AtriumPoint, baseGain: number,
    buffer: AudioBuffer, listener: AtriumPoint,
  ): void {
    const voice = this.createVoice(context, kind, point, baseGain, graph.tails, graph.buses[kind]);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.94 + this.random() * 0.12;
    source.connect(voice.input);
    const active = { ...voice, source };
    graph.events.push(active);
    graph.sources.add(source);
    source.onended = () => {
      const index = graph.events.indexOf(active);
      if (index >= 0) graph.events.splice(index, 1);
      graph.sources.delete(source);
      this.disconnectVoice(active);
    };
    source.start(context.currentTime + 0.018);
    this.updateVoice(active, listener, context.currentTime);
  }

  private updateFootsteps(
    context: AudioContext, graph: Graph, position: Vector3, elapsed: number,
    movement: CoastMovement, grounded: boolean, now: number,
  ): void {
    const walking = grounded && (movement === 'walk' || movement === 'crouch')
      && mixGain(this.mix, 'footsteps') > 0;
    const previous = this.previousStep;
    if (!walking) {
      this.previousStep = undefined;
      this.traveled = 0;
      return;
    }
    this.previousStep = { x: position.x, y: position.y, z: position.z, elapsed };
    if (!previous || elapsed <= previous.elapsed || elapsed - previous.elapsed > 0.28) {
      this.traveled = 0;
      return;
    }
    const dx = position.x - previous.x;
    const dz = position.z - previous.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.001 || distance > 1.6) {
      this.traveled = 0;
      return;
    }
    const floorY = atriumSupportAt(position.x, position.z, position.y - groundEyeHeight(movement) + 0.07);
    const surface = atriumSurfaceAt(position.x, position.z, floorY);
    this.traveled += distance;
    const crouchScale = movement === 'crouch' ? 0.70 : 1;
    const stride = FOOTFALL_STRIDES[surface] * crouchScale;
    if (this.traveled < stride || elapsed - this.lastFootstep < FOOTFALL_INTERVAL) return;
    this.traveled -= stride;
    this.lastFootstep = elapsed;
    const foot = graph.feet.find(candidate => !candidate.busy);
    if (!foot) return;
    this.side *= -1;
    const lateral = this.side * 0.16 / distance;
    const impact = { x: position.x - dz * lateral, y: floorY + 0.045, z: position.z + dx * lateral };
    setPoint(foot.panner, impact, now);
    const samples = this.footfallSamples(graph, context, surface);
    const sample = samples[Math.floor(this.random() * samples.length)];
    const source = context.createBufferSource();
    source.buffer = sample;
    source.playbackRate.value = (0.94 + this.random() * 0.12) * (movement === 'crouch' ? 0.93 : 1);
    const gain = FOOTFALL_GAINS[surface] * (0.88 + this.random() * 0.12);
    foot.gain.gain.setValueAtTime(gain, now);
    source.connect(foot.gain);
    foot.busy = true;
    graph.sources.add(source);
    source.onended = () => {
      source.disconnect();
      graph.sources.delete(source);
      foot.busy = false;
      foot.gain.gain.setTargetAtTime(0, context.currentTime, 0.025);
    };
    source.start(now);
  }

  private footfallSamples(graph: Graph, context: AudioContext, surface: AtriumSurface): readonly AudioBuffer[] {
    const existing = graph.footfallSamples.get(surface);
    if (existing) return existing;
    const samples = [81, 375, 1_019].map(seed => createAtriumFootfall(context, surface, seed));
    graph.footfallSamples.set(surface, samples);
    return samples;
  }

  private disconnectVoice(voice: SpatialVoice): void {
    voice.input.disconnect();
    voice.directFilter.disconnect();
    voice.directGain.disconnect();
    voice.panner.disconnect();
    voice.lateGain.disconnect();
    for (const arrival of voice.arrivals) {
      arrival.filter.disconnect();
      arrival.delay.disconnect();
      arrival.gain.disconnect();
      arrival.panner.disconnect();
    }
  }

  private releaseContext(): void {
    const graph = this.graph;
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* The source may have failed to start. */ }
      source.disconnect();
    }
    this.sources.clear();
    if (graph) {
      for (const source of graph.sources) {
        source.onended = null;
        try { source.stop(); } catch { /* The source may have failed to start. */ }
        source.disconnect();
      }
      for (const voice of graph.voices) this.disconnectVoice(voice);
      for (const voice of graph.events) this.disconnectVoice(voice);
      for (const foot of graph.feet) {
        foot.panner.disconnect();
        foot.gain.disconnect();
      }
      for (const bus of Object.values(graph.buses)) bus.disconnect();
      for (const tail of Object.values(graph.tails)) {
        tail.input.disconnect();
        tail.convolver.disconnect();
      }
      graph.footTail.input.disconnect();
      graph.footTail.convolver.disconnect();
      graph.master.disconnect();
      for (const node of graph.outputNodes) node.disconnect();
    }
    this.graph = undefined;
    const context = this.context;
    this.context = undefined;
    this.previousStep = undefined;
    this.traveled = 0;
    this.nextPropagation = 0;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
}
