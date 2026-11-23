import { EYE_HEIGHT, type CoastMovement } from '../../CoastControls';
import type { CoastBirdCue } from '../../coastBirdCue';
import { coastRandom, type CoastPoint } from '../../terrain';
import type { CoastTimeOfDay } from '../coastAtmosphere';
import {
  BALCONY_DOOR, RESIDENCE_INTERIOR_DOORS, RESIDENCE_ROADS, STREET_REFLECTION,
  residenceReceiver, residenceSoundPath, residenceSurfaceAt, residenceTrafficPath,
  type ResidenceDoorOpenness, type ResidenceSurface,
} from './residenceAcoustics';
import { createResidenceApplianceAudio } from './residenceApplianceAudio';
import type { ResidenceApplianceAudioSource } from './residenceAppliances';
import {
  RESIDENCE_ROOM_RESPONSES, createBreeze, createFootfall, createInteriorDoorSound, createRoomImpulse, createSlider,
  createVehicleSample,
} from './residenceAudioSamples';
import type { ResidenceOpening } from './residencePlan';
import { residenceDoorFraction, residenceOpeningPoint } from './residencePortalAcoustics';

type Point = Readonly<CoastPoint>;
type Receiver = ReturnType<typeof residenceReceiver>;
type TrafficVoice = { filter: BiquadFilterNode; gain: GainNode; wetGain: GainNode; panner: PannerNode };
type FootVoice = { panner: PannerNode; gain: GainNode; busy: boolean };
type DoorMotion = {
  openness: number; direction: number; voice?: TrafficVoice; source?: AudioBufferSourceNode;
};
type Road = typeof RESIDENCE_ROADS[number];
type PassBy = { from: Point; to: Point; start: number; duration: number; level: number };

type Graph = {
  master: GainNode;
  dry: AudioNode;
  wet: AudioNode;
  roomLevels: GainNode[];
  traffic: { road: Road; position: Point; voice: TrafficVoice }[];
  reflected: TrafficVoice;
  reflectionDelay: DelayNode;
  vehicles: { voice: TrafficVoice; pass?: PassBy }[];
  vehicleSamples: AudioBuffer[];
  breeze: GainNode;
  breezeSample: AudioBuffer;
  slider: GainNode;
  sliderSamples: AudioBuffer[];
  doorSamples: AudioBuffer[][];
  feet: FootVoice[];
  appliances?: ReturnType<typeof createResidenceApplianceAudio>;
};

// The existing CC0 loop and its editing history are credited in public/coast-overlook/ATTRIBUTION.md.
const TRAFFIC_FILE = `${import.meta.env?.BASE_URL ?? '/'}coast-overlook/distant-traffic.ogg`;
const OFFSET_SECONDS = [3.5, 30.1, 53.4, 78.7, 15.8, 96.5] as const;
const LISTENER_PERIOD = 0.05;
const FOOTFALL_INTERVAL = 0.52;

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
  const wetGain = context.createGain();
  wetGain.gain.value = 0;
  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  panner.rolloffFactor = 0;
  filter.connect(gain).connect(panner).connect(dry);
  filter.connect(wetGain).connect(wet);
  return { filter, gain, wetGain, panner };
}

function updateArrival(voice: TrafficVoice, receiver: Receiver, source: Point, line: boolean,
  gain: number, now: number, ceiling = Infinity): void {
  const arrival = residenceTrafficPath(receiver, source, line);
  voice.gain.gain.setTargetAtTime(arrival.gain * gain, now, 0.11);
  voice.wetGain.gain.setTargetAtTime(arrival.diffuseGain * gain, now, 0.11);
  voice.filter.frequency.setTargetAtTime(Math.min(ceiling, arrival.cutoff), now, 0.12);
  pointAt(voice.panner, arrival.arrival, now, 0.08);
}

export class ResidenceAudio {
  private readonly request = new AbortController();
  private readonly random = coastRandom(48167);
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly footfalls = new Map<ResidenceSurface, AudioBuffer[]>();
  private readonly doorMotions = new Map<ResidenceOpening, DoorMotion>();
  private context: AudioContext | undefined;
  private graph: Graph | undefined;
  private pendingStart: Promise<void> | undefined;
  private time: CoastTimeOfDay = 'day';
  private volume = 0.7;
  private muted = false;
  private nextUpdate = 0;
  private nextPass = 0;
  private nextBreeze = 0;
  private previousDoor: number | undefined;
  private doorDirection = 0;
  private doorSource: AudioBufferSourceNode | undefined;
  private previousStep: (Point & { elapsed: number; movement: CoastMovement }) | undefined;
  private traveled = 0;
  private side = 1;
  private readonly appliancePath = (listener: Point, source: Point) =>
    residenceSoundPath(listener, source, this.options.doorOpenness);

  constructor(private readonly options: {
    readonly balconyDoor: () => number;
    readonly doorOpenness?: ResidenceDoorOpenness;
    readonly appliances?: readonly ResidenceApplianceAudioSource[];
  }) {}

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
      this.nextPass = now + this.passGap(true);
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
    const opening = this.options.balconyDoor();
    this.updateSlider(context, graph, opening, now);
    this.updateInteriorDoors(context, graph, position, now);
    this.updateFootfalls(context, graph, position, elapsed, movement, now);
    if (now < this.nextUpdate) return;
    this.nextUpdate = now + LISTENER_PERIOD;
    graph.appliances?.update(position, this.appliancePath);
    const receiver = residenceReceiver(position, opening, this.options.doorOpenness);
    for (const [index, { road, position: emitter, voice }] of graph.traffic.entries()) {
      const flow = 0.92 + 0.08 * Math.sin(now * (0.17 + 0.014 * index) + 3 * index);
      updateArrival(voice, receiver, emitter, true, road.activity[this.time] * flow * Math.SQRT1_2, now);
    }
    const east = RESIDENCE_ROADS[2];
    const eastEmitter = east.patches[1];
    const direct = Math.hypot(position.x - eastEmitter.x, position.y - eastEmitter.y, position.z - eastEmitter.z);
    const reflected = Math.hypot(position.x - STREET_REFLECTION.x, position.y - STREET_REFLECTION.y,
      position.z - STREET_REFLECTION.z);
    graph.reflectionDelay.delayTime.setTargetAtTime(Math.max(0.004, (reflected - direct) / 343), now, 0.15);
    updateArrival(graph.reflected, receiver, STREET_REFLECTION, false, east.activity[this.time] * 0.14, now, 1_450);
    for (const [index, level] of graph.roomLevels.entries()) {
      level.gain.setTargetAtTime(receiver.wet[index] * RESIDENCE_ROOM_RESPONSES[index].send, now, 0.16);
    }
    this.updatePassBy(context, graph, receiver, now);
    graph.breeze.gain.setTargetAtTime(receiver.exterior ** 2 * 0.064, now, 0.11);
    if (receiver.exterior > 0.62 && now >= this.nextBreeze) {
      this.nextBreeze = now + 38 + 34 * this.random();
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
      wet.connect(level).connect(room).connect(dry);
      return level;
    });
    const traffic = RESIDENCE_ROADS.flatMap(road => road.patches.map(position =>
      ({ road, position, voice: spatialVoice(context, dry, wet) })));
    const reflected = spatialVoice(context, dry, wet);
    const reflectionDelay = context.createDelay(0.16);
    reflectionDelay.delayTime.value = 0.015;
    reflectionDelay.connect(reflected.filter);
    const vehicles = Array.from({ length: 2 }, () => ({ voice: spatialVoice(context, dry, wet) }));
    const vehicleSamples = [createVehicleSample(context, 711), createVehicleSample(context, 198)];
    const breeze = context.createGain();
    breeze.gain.value = 0;
    const breezePoint = context.createPanner();
    breezePoint.panningModel = 'HRTF';
    breezePoint.rolloffFactor = 0;
    pointAt(breezePoint, { x: 24.2, y: 1.62, z: -13.48 }, now);
    breeze.connect(breezePoint).connect(dry);
    const breezeSample = createBreeze(context);
    const slider = context.createGain();
    slider.gain.value = 0.24;
    const sliderPoint = context.createPanner();
    sliderPoint.panningModel = 'HRTF';
    sliderPoint.refDistance = 0.8;
    pointAt(sliderPoint, { ...BALCONY_DOOR, y: 0.28 }, now);
    slider.connect(sliderPoint).connect(dry);
    sliderPoint.connect(wet);
    const sliderSamples = [createSlider(context, false), createSlider(context, true)];
    const doorSamples = this.options.doorOpenness ? [false, true].map(sliding =>
      [false, true].map(closing => createInteriorDoorSound(context, sliding, closing))) : [];
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
      if (index === traffic.length - 1) source.connect(reflectionDelay);
    }
    this.nextUpdate = 0;
    this.nextPass = now + this.passGap(true);
    this.nextBreeze = now + 24 + this.random() * 18;
    const appliances = this.options.appliances?.length
      ? createResidenceApplianceAudio(context, dry, wet, this.options.appliances) : undefined;
    return { master, dry, wet, roomLevels, traffic, reflected, reflectionDelay, vehicles, vehicleSamples, breeze,
      breezeSample, slider, sliderSamples, doorSamples, feet, appliances };
  }

  private passGap(initial: boolean): number {
    if (this.time === 'day') return initial ? 3.6 + this.random() * 2.4 : 6.6 + this.random() * 6.8;
    return (initial ? 10.5 : 16.5) + this.random() * 17;
  }

  private updatePassBy(context: AudioContext, graph: Graph, receiver: Receiver, now: number): void {
    const available = now >= this.nextPass ? graph.vehicles.find(vehicle => !vehicle.pass) : undefined;
    if (available) {
      const index = [0, 2, 1, 0, 2][Math.floor(this.random() * 5)];
      const road = RESIDENCE_ROADS[index];
      const reverse = this.random() < 0.5;
      const speed = (index === 2 ? 9.3 : 12.5) + 4.8 * this.random();
      const roadLength = Math.hypot(road.from.x - road.to.x, road.from.z - road.to.z);
      const distance = Math.min(roadLength, 175 + this.random() * 70);
      const duration = distance / speed;
      const startOffset = (roadLength - distance) * this.random() / roadLength;
      const roadPoint = (fraction: number) => ({ x: road.from.x + (road.to.x - road.from.x) * fraction,
        y: road.from.y, z: road.from.z + (road.to.z - road.from.z) * fraction });
      const from = roadPoint(startOffset);
      const to = roadPoint(startOffset + distance / roadLength);
      const heavy = this.random() < (this.time === 'day' ? 0.20 : 0.35);
      const buffer = graph.vehicleSamples[Number(heavy)];
      available.pass = { from: reverse ? to : from, to: reverse ? from : to, start: now, duration,
        level: heavy ? 0.50 : 0.40 };
      this.nextPass = now + this.passGap(false);
      this.play(context, buffer, available.voice.filter, now, buffer.duration / duration);
    }
    for (const vehicle of graph.vehicles) {
      const { pass, voice } = vehicle;
      if (!pass) continue;
      const phase = (now - pass.start) / pass.duration;
      if (phase >= 1) {
        vehicle.pass = undefined;
        voice.gain.gain.setTargetAtTime(0, now, 0.10);
        voice.wetGain.gain.setTargetAtTime(0, now, 0.10);
        continue;
      }
      const position = {
        x: pass.from.x + (pass.to.x - pass.from.x) * phase,
        y: pass.from.y,
        z: pass.from.z + (pass.to.z - pass.from.z) * phase,
      };
      updateArrival(voice, receiver, position, false, pass.level, now);
    }
  }

  private updateSlider(context: AudioContext, graph: Graph, openness: number, now: number): void {
    const delta = openness - (this.previousDoor ?? openness);
    this.previousDoor = openness;
    if (Math.abs(delta) < 0.001) return;
    const direction = Math.sign(delta);
    if (direction === this.doorDirection) return;
    this.doorDirection = direction;
    this.doorSource?.stop(now);
    const remaining = direction > 0 ? 1 - openness : openness;
    const sample = graph.sliderSamples[Number(direction < 0)];
    const offset = (1 - remaining) * sample.duration;
    const source = this.play(context, sample, graph.slider, now, sample.duration / 0.55, offset,
      false, () => { if (this.doorSource === source) this.doorSource = undefined; });
    this.doorSource = source;
  }

  private updateInteriorDoors(context: AudioContext, graph: Graph, listener: Point, now: number): void {
    const { doorOpenness } = this.options;
    if (!doorOpenness) return;
    for (const { wall, opening } of RESIDENCE_INTERIOR_DOORS) {
      const openness = residenceDoorFraction(doorOpenness(wall, opening));
      let motion = this.doorMotions.get(opening);
      if (!motion) {
        motion = { openness, direction: 0 };
        this.doorMotions.set(opening, motion);
        continue;
      }
      const before = motion.openness;
      const direction = Math.sign(openness - before);
      motion.openness = openness;
      const sliding = opening.kind === 'fusuma';
      const point = residenceOpeningPoint(wall, (opening.from + opening.to) * 0.5, sliding ? 0.68 : 0.96);
      if (direction === 0 && motion.direction !== 0 && openness > 0 && openness < 1 && motion.source) {
        // The animation can pause while the player occupies the swing path.
        const voice = motion.voice!;
        voice.gain.gain.setTargetAtTime(0, now, 0.010);
        voice.wetGain.gain.setTargetAtTime(0, now, 0.010);
        motion.direction = 0;
        motion.source.stop(now + 0.045);
        continue;
      }
      if (direction !== 0 && direction !== motion.direction) {
        motion.direction = direction;
        motion.source?.stop(now);
        motion.voice ??= spatialVoice(context, graph.dry, graph.wet);
        const sample = graph.doorSamples[Number(sliding)][Number(direction < 0)];
        const offset = (direction > 0 ? before : 1 - before) * sample.duration;
        const active = motion;
        const source = this.play(context, sample, motion.voice.filter, now, 1, offset, false,
          () => { if (active.source === source) active.source = undefined; });
        motion.source = source;
      }
      if (!motion.source || !motion.voice || motion.direction === 0) continue;
      const path = residenceSoundPath(listener, point, (pathWall, gap) =>
        gap.kind === 'balcony-door' ? this.options.balconyDoor() : doorOpenness(pathWall, gap));
      motion.voice.gain.gain.setTargetAtTime(path.gain * 0.24, now, 0.020);
      motion.voice.wetGain.gain.setTargetAtTime(path.diffuseGain * 0.18, now, 0.030);
      motion.voice.filter.frequency.setTargetAtTime(path.cutoff, now, 0.040);
      pointAt(motion.voice.panner, path.arrival, now, 0.025);
    }
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
    const stride = Math.max(0.82, distance / seconds * FOOTFALL_INTERVAL);
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
    foot.gain.gain.setValueAtTime(0.24 + this.random() * 0.07, now);
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
    this.doorMotions.clear();
    this.graph?.appliances?.dispose();
    this.graph?.master.disconnect();
    this.graph = undefined;
    this.previousDoor = undefined;
    this.doorDirection = 0;
    this.doorSource = undefined;
    this.previousStep = undefined;
    this.traveled = 0;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
}
