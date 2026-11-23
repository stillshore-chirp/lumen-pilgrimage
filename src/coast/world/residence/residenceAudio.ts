import { EYE_HEIGHT, type CoastMovement } from '../../CoastControls';
import type { CoastBirdCue } from '../../coastBirdCue';
import { coastRandom, type CoastPoint } from '../../terrain';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import {
  RESIDENCE_ROADS, STREET_REFLECTION, residenceReceiver, residenceSurfaceAt, residenceTrafficPath,
  type ResidenceSurface,
} from './residenceAcoustics';
import {
  RESIDENCE_ROOM_RESPONSES, createBreeze, createFootfall, createRoomImpulse, createVehicleSample,
} from './residenceAudioSamples';

type Point = Readonly<CoastPoint>;
type Receiver = ReturnType<typeof residenceReceiver>;
type TrafficVoice = { filter: BiquadFilterNode; gain: GainNode; panner: PannerNode };
type FootVoice = { panner: PannerNode; gain: GainNode; busy: boolean };
type Road = typeof RESIDENCE_ROADS[number];
type PassBy = { from: Point; to: Point; start: number; duration: number; level: number };

type Graph = {
  master: GainNode;
  roomLevels: GainNode[];
  traffic: { road: Road; voice: TrafficVoice }[];
  reflected: TrafficVoice;
  reflectionDelay: DelayNode;
  vehicle: TrafficVoice;
  vehicleSamples: AudioBuffer[];
  breeze: GainNode;
  breezeSample: AudioBuffer;
  feet: FootVoice[];
};

// The existing CC0 loop and its editing history are credited in public/coast-overlook/ATTRIBUTION.md.
const TRAFFIC_FILE = `${import.meta.env?.BASE_URL ?? '/'}coast-overlook/distant-traffic.ogg`;
const OFFSET_SECONDS = [3.5, 38.3, 78.7] as const;
const LISTENER_PERIOD = 0.05;

function pointAt(node: PannerNode, point: Point, time: number, glide = 0): void {
  const { positionX, positionY, positionZ } = node;
  if (glide > 0) {
    positionX.setTargetAtTime(point.x, time, glide);
    positionY.setTargetAtTime(point.y, time, glide);
    positionZ.setTargetAtTime(point.z, time, glide);
  } else {
    positionX.setValueAtTime(point.x, time);
    positionY.setValueAtTime(point.y, time);
    positionZ.setValueAtTime(point.z, time);
  }
}

function spatialVoice(context: AudioContext, dry: AudioNode, wet: AudioNode): TrafficVoice {
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = -3;
  filter.frequency.value = 260;
  const gain = context.createGain();
  gain.gain.value = 0;
  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  panner.rolloffFactor = 0;
  filter.connect(gain).connect(panner).connect(dry);
  panner.connect(wet);
  return { filter, gain, panner };
}

function updateArrival(voice: TrafficVoice, receiver: Receiver, source: Point, line: boolean,
  gain: number, now: number, ceiling = Infinity): void {
  const arrival = residenceTrafficPath(receiver, source, line);
  voice.gain.gain.setTargetAtTime(arrival.gain * gain, now, 0.11);
  voice.filter.frequency.setTargetAtTime(Math.min(ceiling, arrival.cutoff), now, 0.12);
  pointAt(voice.panner, arrival.arrival, now, 0.08);
}

export class ResidenceAudio {
  private readonly request = new AbortController();
  private readonly random = coastRandom(48167);
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly footfalls = new Map<ResidenceSurface, AudioBuffer[]>();
  private context: AudioContext | undefined;
  private graph: Graph | undefined;
  private pendingStart: Promise<void> | undefined;
  private time: CoastTimeOfDay = 'day';
  private volume = 0.7;
  private muted = false;
  private nextUpdate = 0;
  private nextPass = 0;
  private nextBreeze = 0;
  private pass: PassBy | undefined;
  private previousStep: (Point & { elapsed: number; movement: CoastMovement }) | undefined;
  private traveled = 0;
  private side = 1;

  constructor(private readonly options: { readonly balconyDoor: () => number }) {}

  start(): Promise<void> {
    if (this.request.signal.aborted) return Promise.reject(new Error('The residence audio has been disposed'));
    if (this.pendingStart) return this.pendingStart;
    try {
      if (this.context?.state === 'closed') this.releaseContext();
      const context = this.context ??= new AudioContext({ latencyHint: 'interactive' });
      // Resume during the button's user gesture before fetching or decoding the recording.
      const resume = context.state === 'running' ? Promise.resolve() : context.resume();
      this.pendingStart = (this.graph ? resume : Promise.all([resume, this.load(context)]).then(([, buffer]) => {
        if (this.request.signal.aborted || this.context !== context) throw new Error('The residence audio is inactive');
        this.graph = this.buildGraph(context, buffer);
      })).catch((error: unknown) => {
        if (!this.graph && this.context === context) this.releaseContext();
        throw error;
      }).finally(() => { this.pendingStart = undefined; });
      return this.pendingStart;
    } catch (error) {
      if (!this.graph) this.releaseContext();
      return Promise.reject(error);
    }
  }

  setLevel(volume: number, muted: boolean): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
    this.muted = muted;
    if (!this.context || !this.graph) return;
    this.graph.master.gain.setTargetAtTime(this.masterLevel(), this.context.currentTime, 0.035);
  }

  setTimeOfDay(time: CoastTimeOfDay): void {
    if (this.time === time) return;
    this.time = time;
    this.nextUpdate = 0;
    if (this.context && this.graph) {
      const now = this.context.currentTime;
      const previousEnd = this.pass ? this.pass.start + this.pass.duration : now;
      this.nextPass = Math.max(now, previousEnd) + this.passGap(true);
    }
  }

  update(position: Point, forward: Point, up: Point, elapsed: number, movement: CoastMovement,
    _birdCues?: readonly CoastBirdCue[]): void {
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
    this.updateFootfalls(context, graph, position, elapsed, movement, now);
    if (now < this.nextUpdate) return;
    this.nextUpdate = now + LISTENER_PERIOD;
    const receiver = residenceReceiver(position, this.options.balconyDoor());
    for (const { road, voice } of graph.traffic) {
      updateArrival(voice, receiver, road.bed, true, road.activity[this.time], now);
    }
    const east = RESIDENCE_ROADS[2];
    const direct = Math.hypot(position.x - east.bed.x, position.y - east.bed.y, position.z - east.bed.z);
    const reflected = Math.hypot(position.x - STREET_REFLECTION.x, position.y - STREET_REFLECTION.y,
      position.z - STREET_REFLECTION.z);
    graph.reflectionDelay.delayTime.setTargetAtTime(Math.max(0.004, (reflected - direct) / 343), now, 0.15);
    updateArrival(graph.reflected, receiver, STREET_REFLECTION, false, east.activity[this.time] * 0.19, now, 1_650);
    for (const [index, level] of graph.roomLevels.entries()) {
      level.gain.setTargetAtTime(receiver.wet[index] * RESIDENCE_ROOM_RESPONSES[index].send, now, 0.16);
    }
    this.updatePassBy(context, graph, receiver, now);
    graph.breeze.gain.setTargetAtTime(receiver.exterior ** 2 * 0.19, now, 0.11);
    if (receiver.exterior > 0.62 && now >= this.nextBreeze) {
      this.nextBreeze = now + 20 + 23 * this.random();
      this.play(context, graph.breezeSample, graph.breeze, now);
    }
  }

  dispose(): void {
    this.request.abort();
    this.releaseContext();
  }

  private masterLevel(): number {
    return this.muted ? 0 : this.volume * 0.86;
  }

  private async load(context: AudioContext): Promise<AudioBuffer> {
    const response = await fetch(TRAFFIC_FILE, { signal: this.request.signal });
    if (!response.ok) throw new Error('The residence traffic recording could not be loaded');
    return context.decodeAudioData(await response.arrayBuffer());
  }

  private buildGraph(context: AudioContext, buffer: AudioBuffer): Graph {
    const now = context.currentTime;
    const master = context.createGain();
    master.gain.value = this.masterLevel();
    const dry = context.createDynamicsCompressor();
    dry.threshold.value = -15;
    dry.ratio.value = 4;
    dry.connect(master).connect(context.destination);
    const wet = context.createGain();
    const roomLevels = RESIDENCE_ROOM_RESPONSES.map((profile, index) => {
      const room = context.createConvolver();
      room.normalize = false;
      room.buffer = createRoomImpulse(context, profile, 713 + 217 * index);
      const level = context.createGain();
      level.gain.value = 0;
      wet.connect(room).connect(level).connect(dry);
      return level;
    });
    const traffic = RESIDENCE_ROADS.map(road => ({ road, voice: spatialVoice(context, dry, wet) }));
    const reflected = spatialVoice(context, dry, wet);
    const reflectionDelay = context.createDelay(0.16);
    reflectionDelay.delayTime.value = 0.015;
    reflectionDelay.connect(reflected.filter);
    const vehicle = spatialVoice(context, dry, wet);
    const vehicleSamples = [createVehicleSample(context, 711), createVehicleSample(context, 198)];
    const breeze = context.createGain();
    breeze.gain.value = 0;
    const breezePoint = context.createPanner();
    breezePoint.panningModel = 'HRTF';
    breezePoint.rolloffFactor = 0;
    pointAt(breezePoint, { x: 24.2, y: 1.62, z: -13.48 }, now);
    breeze.connect(breezePoint).connect(dry);
    const breezeSample = createBreeze(context);
    const feet = Array.from({ length: 3 }, (): FootVoice => {
      const panner = context.createPanner();
      panner.panningModel = 'HRTF';
      panner.refDistance = 1.35;
      panner.rolloffFactor = 0.85;
      const gain = context.createGain();
      gain.connect(panner).connect(dry);
      panner.connect(wet);
      return { panner, gain, busy: false };
    });
    for (const [index, { voice }] of traffic.entries()) {
      const source = this.play(context, buffer, voice.filter, now, 1, OFFSET_SECONDS[index] % buffer.duration, true);
      if (index === 2) source.connect(reflectionDelay);
    }
    this.nextUpdate = 0;
    this.nextPass = now + this.passGap(true);
    this.nextBreeze = now + 15 + this.random() * 11;
    return { master, roomLevels, traffic, reflected, reflectionDelay, vehicle, vehicleSamples, breeze, breezeSample, feet };
  }

  private passGap(initial: boolean): number {
    if (this.time === 'day') return initial ? 2.8 + this.random() * 2.4 : 5.8 + this.random() * 5.6;
    return (initial ? 9.5 : 18.5) + this.random() * 12;
  }

  private updatePassBy(context: AudioContext, graph: Graph, receiver: Receiver, now: number): void {
    if (now >= this.nextPass) {
      const index = Math.floor(this.random() * RESIDENCE_ROADS.length);
      const road = RESIDENCE_ROADS[index];
      const reverse = this.random() < 0.5;
      const speed = (index === 2 ? 9.5 : 14.5) + 3.5 * this.random();
      const duration = Math.hypot(road.from.x - road.to.x, road.from.z - road.to.z) / speed;
      const heavy = this.random() < (this.time === 'day' ? 0.20 : 0.35);
      const buffer = graph.vehicleSamples[Number(heavy)];
      this.pass = { from: reverse ? road.to : road.from, to: reverse ? road.from : road.to,
        start: now, duration, level: heavy ? 0.83 : 0.68 };
      this.nextPass = now + duration + this.passGap(false);
      this.play(context, buffer, graph.vehicle.filter, now, buffer.duration / duration);
    }
    const pass = this.pass;
    if (!pass) return;
    const phase = (now - pass.start) / pass.duration;
    if (phase >= 1) {
      this.pass = undefined;
      return;
    }
    const position = {
      x: pass.from.x + (pass.to.x - pass.from.x) * phase,
      y: pass.from.y,
      z: pass.from.z + (pass.to.z - pass.from.z) * phase,
    };
    updateArrival(graph.vehicle, receiver, position, false, pass.level, now);
  }

  private updateFootfalls(context: AudioContext, graph: Graph, position: Point, elapsed: number,
    movement: CoastMovement, now: number): void {
    const previous = this.previousStep;
    this.previousStep = { ...position, elapsed, movement };
    if (!previous || movement !== 'walk' || previous.movement !== 'walk'
      || Math.abs(position.y - EYE_HEIGHT) > 0.18 || Math.abs(previous.y - EYE_HEIGHT) > 0.18) {
      this.traveled = 0;
      return;
    }
    const dx = position.x - previous.x;
    const dz = position.z - previous.z;
    const distance = Math.hypot(dx, dz);
    const seconds = elapsed - previous.elapsed;
    if (distance > 1.4 || seconds <= 0 || seconds > 0.25) {
      this.traveled = 0;
      return;
    }
    if (distance < 0.001) return;
    const stride = Math.max(0.66, distance / seconds * 0.285);
    this.traveled += distance;
    if (this.traveled < stride) return;
    this.traveled -= stride;
    const foot = graph.feet.find(voice => !voice.busy);
    if (!foot) return;
    this.side = -this.side;
    const lateral = this.side * 0.17 / distance;
    const impact = { x: position.x - dz * lateral, y: 0.035, z: position.z + dx * lateral };
    const surface = residenceSurfaceAt(position);
    let samples = this.footfalls.get(surface);
    if (!samples) {
      samples = [81, 375, 1019].map(seed => createFootfall(context, surface, seed));
      this.footfalls.set(surface, samples);
    }
    pointAt(foot.panner, impact, now);
    foot.gain.gain.setValueAtTime(0.50 + this.random() * 0.12, now);
    const sample = samples[Math.floor(this.random() * samples.length)];
    this.play(context, sample, foot.gain, now, 0.93 + this.random() * 0.17, 0, false, () => { foot.busy = false; });
    foot.busy = true;
  }

  private play(context: AudioContext, buffer: AudioBuffer, input: AudioNode, start: number,
    rate = 1, offset = 0, loop = false, done?: () => void): AudioBufferSourceNode {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.loop = loop;
    source.connect(input);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      done?.();
    };
    this.sources.add(source);
    source.start(start, offset);
    return source;
  }

  private releaseContext(): void {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* The source may have failed to start. */ }
      source.disconnect();
    }
    this.sources.clear();
    this.footfalls.clear();
    this.graph?.master.disconnect();
    this.graph = undefined;
    this.pass = undefined;
    this.previousStep = undefined;
    this.traveled = 0;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
}
