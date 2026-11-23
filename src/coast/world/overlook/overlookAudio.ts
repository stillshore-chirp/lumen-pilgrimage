import { MathUtils, type Vector3 } from 'three';
import { REFRACTION_SHELF_HZ, thermalLowShelfDb, thermalRayLift } from '../../coastAcoustics';
import type { CoastTimeOfDay } from '../coastAtmosphere';

type SoundPoint = Readonly<{ x: number; y: number; z: number }>;
type Corridor = { points: readonly SoundPoint[]; weight: number };
type RoadSection = { point: SoundPoint; length: number };
type TrafficVoice = {
  road: readonly RoadSection[];
  weight: number;
  panner: PannerNode;
  filter: BiquadFilterNode;
  atmosphere: BiquadFilterNode;
  level: GainNode;
};
type CricketVoice = {
  point: SoundPoint;
  filter: BiquadFilterNode;
  level: GainNode;
  patch: typeof CRICKET_PATCHES[number];
  nextCall: number;
  playing: boolean;
};

const ASSET_DIRECTORY = `${import.meta.env.BASE_URL}coast-overlook/`;
const BIRD_PHRASE_SECONDS = 2.5;
const BIRD_PHRASE_COUNT = 4;
// Source activity drops at night. The receiver-side spectrum follows propagation separately.
const TRAFFIC_GAIN = { day: 0.33, night: 0.18 };
const CRICKET_RECORDING_GAIN = 1.7;
// The grass and scrub below the front railing. Each patch has its own slice of the field recording.
const CRICKET_PATCHES = [
  { x: 7, z: -35, clipStart: 2, firstCall: 0.06, rate: 1.00, gain: 0.96 },
  { x: -9, z: -31, clipStart: 12, firstCall: 0.48, rate: 0.95, gain: 0.70 },
  { x: 23, z: -31, clipStart: 22, firstCall: 0.96, rate: 1.04, gain: 0.68 },
  { x: -19, z: -46, clipStart: 32, firstCall: 1.74, rate: 1.07, gain: 0.50 },
  { x: 17, z: -49, clipStart: 42, firstCall: 2.42, rate: 0.98, gain: 0.73 },
];

function roadSections(points: readonly SoundPoint[]): RoadSection[] {
  return points.map((point, i) => {
    const previous = points[i - 1] ?? point;
    const next = points[i + 1] ?? point;
    const length = (Math.hypot(point.x - previous.x, point.z - previous.z)
      + Math.hypot(next.x - point.x, next.z - point.z)) * 0.5;
    return { point, length };
  }).filter(section => section.length > 0);
}

function spatialPanner(context: AudioContext, point: SoundPoint): PannerNode {
  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  panner.rolloffFactor = 0;
  panner.positionX.value = point.x;
  panner.positionY.value = point.y;
  panner.positionZ.value = point.z;
  return panner;
}

export class OverlookAudio {
  private readonly roads: { sections: RoadSection[]; weight: number }[];
  private readonly request = new AbortController();
  private readonly traffic: TrafficVoice[] = [];
  private readonly crickets: CricketVoice[] = [];
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private trafficBus: GainNode | undefined;
  private insectBus: GainNode | undefined;
  private cricketBuffer: AudioBuffer | undefined;
  private birdBus: GainNode | undefined;
  private birdBuffer: AudioBuffer | undefined;
  private readonly birdPerches: PannerNode[] = [];
  private pendingStart: Promise<void> | undefined;
  private volume = 0.7;
  private muted = false;
  private time: CoastTimeOfDay = 'day';
  private nextPropagation = 0;
  private nextBird = 0;
  private birdPhrase = -1;

  constructor(corridors: readonly Corridor[], private readonly heightAt: (x: number, z: number) => number) {
    this.roads = corridors
      .map(({ points, weight }) => ({ sections: roadSections(points), weight }))
      .filter(({ sections, weight }) => sections.length && weight > 0);
  }

  start(): Promise<void> {
    if (this.request.signal.aborted) return Promise.reject(new Error('OverlookAudio has been disposed'));
    if (this.pendingStart) return this.pendingStart;
    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' });
      const context = this.context;
      // Request playback while the user gesture is still active.
      const resume = context.state === 'running' ? Promise.resolve() : context.resume();
      if (this.master) return resume;
      this.pendingStart = Promise.all([
        resume,
        this.load(context, 'distant-traffic.ogg'),
        this.load(context, 'hillside-crickets.ogg'),
        this.load(context, 'hillside-towhee-calls.ogg'),
      ]).then(([, traffic, crickets, birds]) => {
        if (this.request.signal.aborted) throw new Error('OverlookAudio is no longer active');
        this.beginLayers(context, traffic, crickets, birds);
      }).finally(() => { this.pendingStart = undefined; });
      return this.pendingStart;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  setLevel(volume: number, muted: boolean): void {
    this.volume = Number.isFinite(volume) ? MathUtils.clamp(volume, 0, 1) : 0;
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, 0.035);
    }
  }

  setTimeOfDay(time: CoastTimeOfDay): void {
    if (this.time === time) return;
    this.time = time;
    this.nextPropagation = 0;
    const context = this.context;
    if (!context || !this.trafficBus || !this.insectBus || !this.birdBus) return;
    const now = context.currentTime;
    const night = time === 'night';
    this.trafficBus.gain.setTargetAtTime(TRAFFIC_GAIN[time], now, 0.65);
    this.insectBus.gain.setTargetAtTime(night ? 1 : 0, now, 0.24);
    this.birdBus.gain.setTargetAtTime(night ? 0 : 1, now, 0.22);
    if (night) {
      for (const cricket of this.crickets) {
        cricket.nextCall = now + cricket.patch.firstCall + 0.18 * Math.random();
      }
    }
    this.nextBird = now + 5 + 6 * Math.random();
  }

  update(position: Vector3, forward: Vector3, up: Vector3, _elapsed: number): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
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
    if (!this.master) return;
    const now = context.currentTime;
    if (now >= this.nextPropagation) {
      this.nextPropagation = now + 0.24;
      for (const voice of this.traffic) this.updateTraffic(voice, position, now);
      if (this.time === 'night') {
        for (const voice of this.crickets) this.updateCricketPropagation(voice, position, now);
      }
    }
    if (this.time === 'day' && now >= this.nextBird) this.playBird(context, position);
    const crickets = this.cricketBuffer;
    if (this.time === 'night' && crickets) {
      for (const voice of this.crickets) {
        if (!voice.playing && now >= voice.nextCall && voice.level.gain.value > 0.004) {
          this.playCricket(context, crickets, voice);
        }
      }
    }
  }

  dispose(): void {
    if (this.request.signal.aborted) return;
    this.request.abort();
    const context = this.context;
    this.context = undefined;
    this.master?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
    this.master = undefined;
    this.trafficBus = undefined;
    this.insectBus = undefined;
    this.cricketBuffer = undefined;
    this.birdBus = undefined;
    this.birdBuffer = undefined;
    this.traffic.length = 0;
    this.crickets.length = 0;
    this.birdPerches.length = 0;
  }

  private async load(context: AudioContext, file: string): Promise<AudioBuffer> {
    const response = await fetch(ASSET_DIRECTORY + file, { signal: this.request.signal });
    if (!response.ok) throw new Error(`Unable to load local overlook audio (${response.status})`);
    return context.decodeAudioData(await response.arrayBuffer());
  }

  private beginLayers(context: AudioContext, traffic: AudioBuffer, crickets: AudioBuffer, birds: AudioBuffer): void {
    const night = this.time === 'night';
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : this.volume;
    master.connect(context.destination);
    const trafficBus = context.createGain();
    trafficBus.gain.value = TRAFFIC_GAIN[this.time];
    trafficBus.connect(master);
    const insectBus = context.createGain();
    insectBus.gain.value = night ? 1 : 0;
    insectBus.connect(master);
    const birdBus = context.createGain();
    birdBus.gain.value = night ? 0 : 1;
    birdBus.connect(master);
    this.master = master;
    this.trafficBus = trafficBus;
    this.insectBus = insectBus;
    this.cricketBuffer = crickets;
    this.birdBus = birdBus;
    this.birdBuffer = birds;

    for (const [index, { sections, weight }] of this.roads.entries()) {
      const panner = spatialPanner(context, sections[0].point);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1000;
      filter.Q.value = -3;
      const atmosphere = context.createBiquadFilter();
      atmosphere.type = 'lowshelf';
      atmosphere.frequency.value = REFRACTION_SHELF_HZ;
      const level = context.createGain();
      level.gain.value = 0;
      filter.connect(atmosphere).connect(level).connect(panner).connect(trafficBus);
      this.loop(context, traffic, filter, (index * 23.7) % traffic.duration, 1 - index * 0.011);
      this.traffic.push({ road: sections, weight, panner, filter, atmosphere, level });
    }

    for (const patch of CRICKET_PATCHES) {
      const { x, z } = patch;
      const point = { x, y: this.heightAt(x, z) + 0.4, z };
      const panner = spatialPanner(context, point);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = -3;
      const level = context.createGain();
      level.gain.value = 0;
      filter.connect(level).connect(panner).connect(insectBus);
      const nextCall = night ? context.currentTime + patch.firstCall + 0.18 * Math.random() : Infinity;
      this.crickets.push({ point, patch, filter, level, nextCall, playing: false });
    }
    for (const { x, z } of [{ x: -41, z: -9 }, { x: 48, z: -31 }]) {
      const panner = spatialPanner(context, { x, y: this.heightAt(x, z) + 1.15, z });
      panner.rolloffFactor = 1;
      panner.refDistance = 9;
      panner.connect(birdBus);
      this.birdPerches.push(panner);
    }
    this.nextBird = context.currentTime + 5 + 6 * Math.random();
  }

  private loop(
    context: AudioContext, buffer: AudioBuffer, output: AudioNode, offset: number, rate: number,
  ): void {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    source.connect(output);
    source.start(0, offset);
  }

  private updateTraffic(voice: TrafficVoice, listener: SoundPoint, now: number): void {
    let power = 0;
    let x = 0, y = 0, z = 0;
    let cutoff = 0;
    let lowBand = 0;
    for (const { point, length } of voice.road) {
      const horizontal = Math.hypot(point.x - listener.x, point.z - listener.z);
      const distance = Math.max(100, Math.hypot(horizontal, point.y - listener.y));
      const blocked = this.terrainScreen(listener, point, distance, thermalRayLift(horizontal, this.time));
      // Sum acoustic power along the road; a long line loses about 3 dB per distance doubling.
      const contribution = length / distance ** 2 * Math.exp(-distance / 5500) * 0.075 ** blocked;
      power += contribution;
      x += contribution * point.x;
      y += contribution * point.y;
      z += contribution * point.z;
      cutoff += contribution * Math.max(210, 4300 / (1 + distance / 1250) ** 1.12 * 0.25 ** blocked);
      lowBand += contribution * thermalLowShelfDb(distance, this.time, 2300);
    }
    if (power <= 0) return;
    voice.panner.positionX.setTargetAtTime(x / power, now, 0.18);
    voice.panner.positionY.setTargetAtTime(y / power, now, 0.18);
    voice.panner.positionZ.setTargetAtTime(z / power, now, 0.18);
    voice.filter.frequency.setTargetAtTime(cutoff / power, now, 0.18);
    voice.atmosphere.gain.setTargetAtTime(lowBand / power, now, 0.25);
    voice.level.gain.setTargetAtTime(Math.min(0.65, 0.84 * Math.sqrt(460 * power * voice.weight)), now, 0.22);
  }

  private updateCricketPropagation(voice: CricketVoice, listener: SoundPoint, now: number): void {
    const { point, patch, filter, level } = voice;
    const distance = Math.hypot(point.x - listener.x, point.y - listener.y, point.z - listener.z);
    const screen = this.terrainScreen(listener, point, distance, 0, 8);
    const gain = (16 / Math.max(16, distance)) ** 1.3 * Math.exp(-distance / 150);
    level.gain.setTargetAtTime(CRICKET_RECORDING_GAIN * patch.gain * gain * MathUtils.lerp(1, 0.22, screen), now, 0.14);
    filter.frequency.setTargetAtTime(MathUtils.lerp(11000 / (1 + distance / 190), 2800, screen), now, 0.14);
  }

  private playCricket(context: AudioContext, buffer: AudioBuffer, voice: CricketVoice): void {
    const source = context.createBufferSource();
    const envelope = context.createGain();
    const rate = voice.patch.rate * (0.983 + 0.034 * Math.random());
    const offset = voice.patch.clipStart + 3.3 * Math.random();
    const duration = 1.7 + 2.5 * Math.random();
    const start = context.currentTime + 0.025;
    const end = start + duration / rate;
    source.buffer = buffer;
    source.playbackRate.value = rate;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(0.72 + 0.28 * Math.random(), start + 0.14);
    envelope.gain.setTargetAtTime(0, end - 0.36, 0.06);
    source.connect(envelope).connect(voice.filter);
    source.onended = () => {
      source.disconnect();
      envelope.disconnect();
      voice.playing = false;
    };
    source.start(start, offset, duration);
    voice.playing = true;
    voice.nextCall = end + 1.25 + 3.9 * Math.random();
  }

  private terrainScreen(listener: SoundPoint, source: SoundPoint, distance: number, rayLift: number, fullScreenHeight = 23): number {
    let obstruction = 0;
    // Finer sampling near the deck captures sudden rises in the land immediately below the listener.
    const samples = Math.ceil(10 + Math.sqrt(distance) * 0.6);
    for (let i = 1; i < samples; i += 1) {
      const fraction = (i / samples) ** 1.65;
      const x = MathUtils.lerp(listener.x, source.x, fraction);
      const z = MathUtils.lerp(listener.z, source.z, fraction);
      const y = MathUtils.lerp(listener.y, source.y, fraction) + 4 * rayLift * fraction * (1 - fraction);
      obstruction = Math.max(obstruction, this.heightAt(x, z) - y);
    }
    return MathUtils.smoothstep(obstruction, 1, fullScreenHeight);
  }

  private playBird(context: AudioContext, position: SoundPoint): void {
    const buffer = this.birdBuffer;
    if (!buffer) return;
    this.nextBird = context.currentTime + 23 + 24 * Math.random();
    const perch = this.birdPerches[Math.floor(Math.random() * this.birdPerches.length)];
    const distance = Math.hypot(perch.positionX.value - position.x, perch.positionY.value - position.y,
      perch.positionZ.value - position.z);
    if (distance > 95) return;
    this.birdPhrase = (this.birdPhrase + 1 + Math.floor(Math.random() * (BIRD_PHRASE_COUNT - 1))) % BIRD_PHRASE_COUNT;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.97 + 0.06 * Math.random();
    source.connect(perch);
    source.onended = () => source.disconnect();
    source.start(0, this.birdPhrase * BIRD_PHRASE_SECONDS, BIRD_PHRASE_SECONDS);
  }
}
