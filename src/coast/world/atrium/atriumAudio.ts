import { Vector3 } from 'three';
import { groundEyeHeight, type CoastMovement } from '../../CoastControls';
import type { CoastBirdCue } from '../../coastBirdCue';
import { connectExplorationOutput } from '../../explorationOutput';
import { DEFAULT_EXPLORATION_MIX, explorationSoundGain, type ExplorationMix } from '../../explorationSound';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import {
  ATRIUM_AIR_SOURCES,
  ATRIUM_REFLECTION_MAX_DELAY,
  ATRIUM_SERVICE_SOURCES,
  atriumLocalTailMix,
  atriumSoundPath,
  atriumSurfaceAt,
  createAtriumSoundPath,
  type AtriumPoint,
  type AtriumSurface,
} from './atriumAcoustics';
import { createAtriumEquipmentLoop, createAtriumFootfall, createAtriumRoomTail } from './atriumAudioSamples';
import { atriumSupportAt } from './atriumNavigation';

type EnvironmentKind = 'air' | 'service';
type AtriumBusKind = EnvironmentKind | 'footsteps';
type AtriumReflection = ReturnType<typeof atriumSoundPath>['reflections'][number];

type ArrivalVoice = {
  readonly filter: BiquadFilterNode;
  readonly delay: DelayNode;
  readonly gain: GainNode;
  readonly panner: PannerNode;
  surface?: AtriumReflection['surface'];
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
  readonly arrivals: readonly [ArrivalVoice, ArrivalVoice];
};

type FootVoice = {
  readonly panner: PannerNode;
  readonly gain: GainNode;
  readonly arrival: ArrivalVoice;
  availableAt: number;
};

type RoomResponse = { gain: GainNode; convolver: ConvolverNode };
type Tail = { input: GainNode; open: RoomResponse; sheltered: RoomResponse };
type Graph = {
  readonly master: GainNode;
  readonly outputNodes: readonly AudioNode[];
  readonly buses: Record<AtriumBusKind, GainNode>;
  readonly tails: Record<AtriumBusKind, Tail>;
  readonly voices: SpatialVoice[];
  readonly feet: FootVoice[];
  readonly footfallSamples: Map<AtriumSurface, readonly AudioBuffer[]>;
};

const BUS_KINDS = ['service', 'air', 'footsteps'] as const;
// Keep the existing saved volume slots when repurposing the atrium sound sources.
const MIX_CHANNEL = { service: 'crowd', air: 'appliances', footsteps: 'footsteps' } as const;

const NOMINAL_MASTER_GAIN = 0.7 * 0.86;
const PROPAGATION_PERIOD = 0.075;
const PROPAGATION_MIN_MOVEMENT = 0.02;
const FOOTFALL_ROOM_SEND = 0.64;
const FOOTFALL_INTERVAL = 0.30;
const FOOTFALL_STRIDES: Record<AtriumSurface, number> = {
  stone: 0.72,
  rug: 0.78,
  stair: 0.58,
  gallery: 0.70,
};
const MIN_FOOTFALL_STRIDE = Math.min(...Object.values(FOOTFALL_STRIDES));
const FOOTFALL_GAINS: Record<AtriumSurface, number> = {
  stone: 0.85,
  rug: 0.68,
  stair: 0.92,
  gallery: 0.76,
};

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

function createTail(context: AudioContext, output: AudioNode, open: AudioBuffer, sheltered: AudioBuffer): Tail {
  const input = context.createGain();
  const connectResponse = (buffer: AudioBuffer): RoomResponse => {
    const convolver = context.createConvolver();
    convolver.normalize = false;
    convolver.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = 0;
    input.connect(convolver).connect(gain).connect(output);
    return { gain, convolver };
  };
  return { input, open: connectResponse(open), sheltered: connectResponse(sheltered) };
}

function createArrival(context: AudioContext, input: AudioNode, output: AudioNode, point: AtriumPoint): ArrivalVoice {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 4_000;
  filter.Q.value = -3;
  const delay = context.createDelay(ATRIUM_REFLECTION_MAX_DELAY + 0.01);
  const gain = context.createGain();
  gain.gain.value = 0;
  const panner = spatialPanner(context, point);
  input.connect(filter).connect(delay).connect(gain).connect(panner).connect(output);
  return { filter, delay, gain, panner };
}

function setArrival(arrival: ArrivalVoice, reflection: AtriumReflection, level: number, now: number, glide: number): void {
  arrival.surface = reflection.gain > 0 ? reflection.surface : undefined;
  if (glide > 0) {
    setParam(arrival.gain.gain, level * reflection.gain, now, glide);
    if (!reflection.gain) return;
    setParam(arrival.delay.delayTime, reflection.delay, now, glide);
    setParam(arrival.filter.frequency, reflection.cutoff, now, glide);
  } else {
    arrival.gain.gain.setValueAtTime(level * reflection.gain, now);
    if (!reflection.gain) return;
    arrival.delay.delayTime.setValueAtTime(reflection.delay, now);
    arrival.filter.frequency.setValueAtTime(reflection.cutoff, now);
  }
  setPoint(arrival.panner, reflection.point, now, glide);
}

function disconnectArrival(arrival: ArrivalVoice): void {
  arrival.filter.disconnect();
  arrival.delay.disconnect();
  arrival.gain.disconnect();
  arrival.panner.disconnect();
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
  private roomMix = -1;
  private readonly propagation = createAtriumSoundPath();
  private readonly propagationPosition = new Vector3();
  private readonly previousStep = { x: 0, z: 0, elapsed: -Infinity };
  private readonly impact = { x: 0, y: 0, z: 0 };
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
    for (const kind of BUS_KINDS) {
      setParam(graph.buses[kind].gain, explorationSoundGain(mix, MIX_CHANNEL[kind]), now, 0.035);
    }
  }

  setTimeOfDay(time: CoastTimeOfDay): void {
    if (this.time === time) return;
    this.time = time;
    this.nextPropagation = 0;
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
    this.updateFootsteps(context, graph, position, navigationPosition, elapsed, movement, grounded, now);
    if (now >= this.nextPropagation && (this.nextPropagation === 0
      || this.propagationPosition.distanceToSquared(position) >= PROPAGATION_MIN_MOVEMENT ** 2)) {
      this.nextPropagation = now + PROPAGATION_PERIOD;
      this.propagationPosition.copy(position);
      for (const voice of graph.voices) this.updateVoice(voice, position, now);
      this.updateRoom(graph.tails, position, now);
    }
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
      bus.gain.value = explorationSoundGain(this.mix, MIX_CHANNEL[kind]);
      bus.connect(master);
      return bus;
    };
    const buses = {
      service: createBus('service'),
      air: createBus('air'),
      footsteps: createBus('footsteps'),
    };
    const open = createAtriumRoomTail(context, 10_731, 'void');
    const sheltered = createAtriumRoomTail(context, 10_893, 'sheltered');
    const tails = {
      service: createTail(context, buses.service, open, sheltered),
      air: createTail(context, buses.air, open, sheltered),
      footsteps: createTail(context, buses.footsteps, open, sheltered),
    };
    tails.footsteps.input.gain.value = FOOTFALL_ROOM_SEND;
    const voices: SpatialVoice[] = [];
    const addLoops = (kind: EnvironmentKind, positions: readonly AtriumPoint[], levels: readonly number[]): void => {
      const buffer = createAtriumEquipmentLoop(context, kind === 'air' ? 3_811 : 1_731, kind);
      for (let index = 0; index < positions.length; index += 1) {
        const voice = this.createVoice(context, kind, positions[index], levels[index], tails[kind].input, buses[kind]);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(voice.input);
        this.sources.add(source);
        source.start(0, buffer.duration * index / positions.length);
        voices.push(voice);
      }
    };
    addLoops('air', ATRIUM_AIR_SOURCES, [0.23, 0.22, 0.20]);
    addLoops('service', ATRIUM_SERVICE_SOURCES, [0.17, 0.16]);

    const feet = Array.from({ length: 4 }, (): FootVoice => {
      const origin = { x: 0, y: 0, z: 0 };
      const panner = spatialPanner(context, origin);
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(panner).connect(buses.footsteps);
      gain.connect(tails.footsteps.input);
      const arrival = createArrival(context, gain, buses.footsteps, origin);
      return { panner, gain, arrival, availableAt: 0 };
    });
    this.nextPropagation = 0;
    return { master, outputNodes, buses, tails, voices, feet, footfallSamples: new Map() };
  }

  private createVoice(
    context: AudioContext, kind: EnvironmentKind, point: AtriumPoint, baseGain: number,
    tailInput: AudioNode, output: AudioNode,
  ): SpatialVoice {
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
    input.connect(lateGain).connect(tailInput);
    const arrivals = [createArrival(context, input, output, point), createArrival(context, input, output, point)] as const;
    return { kind, point, baseGain, input, directFilter, directGain, panner, lateGain, arrivals };
  }

  private updateVoice(voice: SpatialVoice, listener: AtriumPoint, now: number): void {
    const path = atriumSoundPath(listener, voice.point, this.propagation);
    const level = voice.baseGain * (this.time === 'night' && voice.kind === 'service' ? 0.64 : 1);
    setParam(voice.directGain.gain, level * path.gain, now, 0.12);
    setParam(voice.directFilter.frequency, path.cutoff, now, 0.14);
    setParam(voice.lateGain.gain, level * path.lateSend, now, 0.16);
    const [first, second] = path.reflections;
    const [front, back] = voice.arrivals;
    // Preserve each delay's continuity when the same two reflections trade strength.
    const swap = first.surface !== second.surface
      && ((second.gain > 0 && front.surface === second.surface) || (first.gain > 0 && back.surface === first.surface));
    setArrival(front, swap ? second : first, level, now, 0.13);
    setArrival(back, swap ? first : second, level, now, 0.13);
  }

  private updateRoom(tails: Graph['tails'], listener: AtriumPoint, now: number): void {
    const local = atriumLocalTailMix(listener);
    if (Math.abs(local - this.roomMix) < 0.01) return;
    this.roomMix = local;
    const openWeight = Math.sqrt(1 - local);
    const shelteredWeight = Math.sqrt(local);
    for (const kind of BUS_KINDS) {
      setParam(tails[kind].open.gain.gain, openWeight, now, 0.18);
      setParam(tails[kind].sheltered.gain.gain, shelteredWeight, now, 0.18);
    }
  }

  private updateFootsteps(
    context: AudioContext, graph: Graph, listener: AtriumPoint, position: Vector3, elapsed: number,
    movement: CoastMovement, grounded: boolean, now: number,
  ): void {
    const walking = grounded && (movement === 'walk' || movement === 'crouch')
      && explorationSoundGain(this.mix, 'footsteps') > 0;
    const previous = this.previousStep;
    if (!walking) {
      previous.elapsed = -Infinity;
      this.traveled = 0;
      return;
    }
    const dt = elapsed - previous.elapsed;
    const dx = position.x - previous.x;
    const dz = position.z - previous.z;
    previous.x = position.x;
    previous.z = position.z;
    previous.elapsed = elapsed;
    const distance = Math.hypot(dx, dz);
    if (dt <= 0 || dt > 0.28 || distance < 0.001 || distance > 1.6) {
      this.traveled = 0;
      return;
    }
    this.traveled += distance;
    const crouchScale = movement === 'crouch' ? 0.70 : 1;
    if (this.traveled < MIN_FOOTFALL_STRIDE * crouchScale || elapsed - this.lastFootstep < FOOTFALL_INTERVAL) return;
    const floorY = atriumSupportAt(position.x, position.z, position.y - groundEyeHeight(movement) + 0.07);
    const surface = atriumSurfaceAt(position.x, position.z, floorY);
    const stride = FOOTFALL_STRIDES[surface] * crouchScale;
    if (this.traveled < stride) return;
    this.traveled -= stride;
    this.lastFootstep = elapsed;
    const foot = graph.feet.find(candidate => now >= candidate.availableAt);
    if (!foot) return;
    this.side *= -1;
    const lateral = this.side * 0.16 / distance;
    const impact = this.impact;
    impact.x = position.x - dz * lateral;
    impact.y = floorY + 0.045;
    impact.z = position.z + dx * lateral;
    setPoint(foot.panner, impact, now);
    const samples = this.footfallSamples(graph, context, surface);
    const sample = samples[Math.floor(this.random() * samples.length)];
    const source = context.createBufferSource();
    source.buffer = sample;
    const rate = (0.94 + this.random() * 0.12) * (movement === 'crouch' ? 0.93 : 1);
    source.playbackRate.value = rate;
    const gain = FOOTFALL_GAINS[surface] * (0.88 + this.random() * 0.12);
    foot.gain.gain.setValueAtTime(gain, now);
    const [first, second] = atriumSoundPath(listener, impact, this.propagation).reflections;
    const reflection = first.delay >= 0.002 && first.gain > 0 ? first : second;
    const reflected = reflection.delay >= 0.002 && reflection.gain > 0;
    setArrival(foot.arrival, reflection, reflected ? 1 : 0, now, 0);
    foot.availableAt = now + sample.duration / rate + (reflected ? reflection.delay + 0.020 : 0);
    source.connect(foot.gain);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
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
    for (const arrival of voice.arrivals) disconnectArrival(arrival);
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
      for (const voice of graph.voices) this.disconnectVoice(voice);
      for (const foot of graph.feet) {
        foot.panner.disconnect();
        foot.gain.disconnect();
        disconnectArrival(foot.arrival);
      }
      for (const kind of BUS_KINDS) {
        graph.buses[kind].disconnect();
        const tail = graph.tails[kind];
        tail.input.disconnect();
        tail.open.gain.disconnect();
        tail.open.convolver.disconnect();
        tail.sheltered.gain.disconnect();
        tail.sheltered.convolver.disconnect();
      }
      graph.master.disconnect();
      for (const node of graph.outputNodes) node.disconnect();
    }
    this.graph = undefined;
    const context = this.context;
    this.context = undefined;
    this.previousStep.elapsed = -Infinity;
    this.traveled = 0;
    this.nextPropagation = 0;
    this.roomMix = -1;
    this.lastFootstep = -Infinity;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
}
