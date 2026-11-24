import { Vector3 } from 'three';
import type { CoastMovement } from '../../CoastControls';
import type { CoastBirdCue } from '../../coastBirdCue';
import { connectExplorationOutput } from '../../explorationOutput';
import { DEFAULT_EXPLORATION_MIX, explorationSoundGain, type ExplorationMix } from '../../explorationSound';
import { coastRandom } from '../../terrain';
import { createFootfall } from '../residence/residenceAudioSamples';
import {
  CINEMA_AISLES, CINEMA_BOUNDS, CINEMA_CROSS_AISLES, CINEMA_DESTINATIONS, CINEMA_TREADS, cinemaGroundHeight,
} from './cinemaLayout';
import { CINEMA_SPEAKERS, createCinemaTail } from './cinemaAcoustics';

export type CinemaDemoCue = 'left' | 'right' | 'center' | 'overhead' | 'rear';

const CUE_POSITION: Record<CinemaDemoCue, Vector3> = {
  left: CINEMA_SPEAKERS[0].position,
  right: CINEMA_SPEAKERS[1].position,
  center: CINEMA_SPEAKERS[2].position,
  overhead: new Vector3(6.655, 20.381, 32),
  rear: new Vector3(4.8, 12.38, 52.999),
};

interface Sound {
  source: AudioBufferSourceNode;
  pan: PannerNode;
  gain: GainNode;
  wet?: GainNode;
}

const CINEMA_SOUNDS = ['wind', 'preview', 'footsteps'] as const;
type CinemaSound = typeof CINEMA_SOUNDS[number];

interface CinemaAmbienceGraph {
  master: GainNode;
  outputNodes: readonly AudioNode[];
  buses: Record<CinemaSound, GainNode>;
  reverb: ConvolverNode;
  foot: Record<'wool' | 'stone', readonly AudioBuffer[]>;
  cue: AudioBuffer;
}

interface PreviewGraph {
  output: GainNode;
  reverb: ConvolverNode;
  cleanup?: ReturnType<typeof setTimeout>;
}

function fanLoop(context: BaseAudioContext, seed: number): AudioBuffer {
  const rate = context.sampleRate;
  const duration = 6;
  const buffer = context.createBuffer(1, duration * rate, rate);
  const samples = buffer.getChannelData(0);
  const random = coastRandom(seed);
  const lowPole = 1 - Math.exp(-2 * Math.PI * 70 / rate);
  const highPole = 1 - Math.exp(-2 * Math.PI * 320 / rate);
  let low = 0;
  let air = 0;
  const overlap = Math.floor(rate * 0.2);
  for (let i = 0; i < samples.length; i += 1) {
    const noise = random() * 2 - 1;
    low += (noise - low) * lowPole;
    air += (noise - air) * highPole;
    samples[i] = (air - low) * 0.23 + Math.sin(2 * Math.PI * (44 + (seed % 7) / 6) * i / rate) * 0.015;
  }
  for (let i = 0; i < overlap; i += 1) {
    const index = samples.length - overlap + i;
    const mix = i / (overlap - 1);
    samples[index] = (1 - mix) * samples[index] + mix * samples[i];
  }
  return buffer;
}

function cueTone(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.ceil(rate * 0.7), rate);
  const values = buffer.getChannelData(0);
  const random = coastRandom(81_412);
  let low = 0;
  for (let i = 0; i < values.length; i += 1) {
    const t = i / rate;
    const early = Math.min(1, t / 0.014);
    const end = Math.max(0, Math.min(1, (0.70 - t) * 22));
    const noise = random() * 2 - 1;
    low += (noise - low) * 0.28;
    // A short soft strike with enough bandwidth for the elevation cues in the HRTF.
    values[i] = early * end * (0.23 * Math.sin(2 * Math.PI * 458 * t) * Math.exp(-13 * t)
      + 0.11 * Math.sin(2 * Math.PI * 935 * t) * Math.exp(-18 * t) + (noise - low) * 0.19 * Math.exp(-31 * t));
  }
  return buffer;
}

function stepSurface(position: Vector3): 'wool' | 'stone' {
  if (position.z < CINEMA_CROSS_AISLES[0].z - 1) return 'stone';
  const onStair = CINEMA_AISLES.some(aisle => Math.abs(aisle.x - position.x) < aisle.width * 0.5)
    && CINEMA_TREADS.some(tread => tread.rise > 0 && Math.abs(tread.z - position.z) < 0.12);
  return onStair ? 'stone' : 'wool';
}

const defaultSeat = CINEMA_DESTINATIONS[0];
const FOOTFALL_INTERVAL = 0.48;

export class CinemaAmbience {
  private context?: AudioContext;
  private graph?: CinemaAmbienceGraph;
  private pendingStart?: Promise<void>;
  private disposed = false;
  private mix = DEFAULT_EXPLORATION_MIX;
  private listener = new Vector3(defaultSeat.x,
    cinemaGroundHeight(defaultSeat.x, defaultSeat.z) + defaultSeat.seatedEyeHeight, defaultSeat.z);
  private lastStepFrame?: { position: Vector3; elapsed: number };
  private stepTravel = 0;
  private lastFootfall = -Infinity;
  private stepIndex = 0;
  private readonly voices = new Set<Sound>();
  private readonly previews = new Set<PreviewGraph>();
  private preview?: PreviewGraph;
  private lastPreview?: Sound;

  isRunning(): boolean {
    return Boolean(this.graph && this.context?.state === 'running');
  }

  start(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('CinemaAmbience has been disposed'));
    try {
      const context = this.context ??= new AudioContext({ latencyHint: 'interactive' });
      // A click can unlock a resume request left pending by navigation.
      const resume = context.state === 'running' ? Promise.resolve() : context.resume();
      if (this.pendingStart) {
        void resume.catch(() => undefined);
        return this.pendingStart;
      }
      this.pendingStart = resume.then(() => {
        if (this.disposed || this.context !== context) return;
        if (!this.graph) this.begin(context);
      }).finally(() => { this.pendingStart = undefined; });
      return this.pendingStart;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  setMix(mix: ExplorationMix): void {
    this.mix = mix;
    const { context, graph } = this;
    if (!context || !graph) return;
    const now = context.currentTime;
    graph.master.gain.setTargetAtTime(mix.master * 0.7, now, 0.035);
    for (const kind of CINEMA_SOUNDS) {
      graph.buses[kind].gain.setTargetAtTime(explorationSoundGain(mix, kind), now, 0.035);
    }
  }

  update(position: Vector3, forward: Vector3, up: Vector3, elapsed: number, movement?: CoastMovement,
    _birdCues?: readonly CoastBirdCue[], grounded = true, navigationPosition = position): void {
    this.listener.copy(position);
    const context = this.context;
    if (!context || !this.graph || context.state !== 'running') return;
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
    const previous = this.lastStepFrame;
    const walking = grounded && (movement === 'walk' || movement === 'crouch');
    this.lastStepFrame = walking ? { position: navigationPosition.clone(), elapsed } : undefined;
    if (!previous || !walking
      || elapsed <= previous.elapsed || elapsed - previous.elapsed > 0.26) {
      this.stepTravel = 0;
      return;
    }
    const { x, z } = navigationPosition;
    const distance = Math.hypot(x - previous.position.x, z - previous.position.z);
    if (distance > 1.4) { this.stepTravel = 0; return; }
    if (distance < 0.001) return;
    this.stepTravel += distance;
    const minimumTravel = movement === 'crouch' ? 0.43 : 0.65;
    if (this.stepTravel < minimumTravel || elapsed - this.lastFootfall < FOOTFALL_INTERVAL) return;
    this.stepTravel = 0;
    this.lastFootfall = elapsed;
    const offset = this.stepIndex % 2 ? -0.14 : 0.14;
    const foot = new Vector3(x - forward.z * offset, 0, z + forward.x * offset);
    foot.y = cinemaGroundHeight(foot.x, foot.z) + 0.05;
    const samples = this.graph.foot[stepSurface(foot)];
    this.playAt('footsteps', samples[this.stepIndex % samples.length], foot, movement === 'crouch' ? 0.34 : 0.55, 0.11);
    this.stepIndex += 1;
  }

  playDemoCue(kind: CinemaDemoCue): void {
    if (!this.graph || !this.context) return;
    this.fadePreviewVoice(this.context.currentTime);
    const preview = this.preview ??= this.beginPreview(this.context, this.graph);
    this.lastPreview = this.playAt('preview', this.graph.cue, CUE_POSITION[kind], 0.34, 0.13, undefined, 10, preview);
  }

  stopDemoCue(): void {
    const preview = this.preview;
    if (!preview || !this.context) return;
    const now = this.context.currentTime;
    this.preview = undefined;
    this.fadePreviewVoice(now);
    preview.output.gain.setTargetAtTime(0, now, 0.012);
    preview.cleanup = setTimeout(() => this.releasePreview(preview), 90);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const sound of this.voices) {
      sound.source.onended = null;
      sound.source.stop();
      this.release(sound);
    }
    this.lastPreview = undefined;
    this.preview = undefined;
    this.previews.forEach(preview => this.releasePreview(preview));
    if (this.graph) {
      this.graph.master.disconnect();
      this.graph.outputNodes.forEach(node => node.disconnect());
      this.graph.reverb.disconnect();
      for (const kind of CINEMA_SOUNDS) this.graph.buses[kind].disconnect();
    }
    void this.context?.close().catch(() => undefined);
    this.graph = undefined;
    this.context = undefined;
  }

  private begin(context: AudioContext): void {
    const master = context.createGain();
    master.gain.value = 0;
    const outputNodes = connectExplorationOutput(context, master);
    const createBus = (kind: CinemaSound) => {
      const bus = context.createGain();
      bus.gain.value = explorationSoundGain(this.mix, kind);
      bus.connect(master);
      return bus;
    };
    const buses = { wind: createBus('wind'), preview: createBus('preview'), footsteps: createBus('footsteps') };
    const reverb = context.createConvolver();
    reverb.normalize = false;
    reverb.buffer = createCinemaTail(context, 85_213);
    reverb.connect(buses.footsteps);
    this.graph = {
      master, outputNodes, buses, reverb,
      foot: {
        wool: [601, 731, 947, 211, 6019].map(seed => createFootfall(context, 'wool', seed)),
        stone: [461, 317, 199, 827, 367].map(seed => createFootfall(context, 'stone', seed)),
      },
      cue: cueTone(context),
    };
    this.setMix(this.mix);
    [new Vector3(-14, 19.8, 19), new Vector3(14, 19.8, 19), new Vector3(-14, 19.9, 43), new Vector3(14, 19.9, 43)]
      .forEach((position, i) => this.playAt('wind', fanLoop(context, 2_173 + i * 977), position, 0.17, 0, 0.5 + 0.95 * i, 7));
  }

  private beginPreview(context: AudioContext, graph: CinemaAmbienceGraph): PreviewGraph {
    const output = context.createGain();
    const reverb = context.createConvolver();
    reverb.normalize = false;
    reverb.buffer = graph.reverb.buffer;
    reverb.connect(output).connect(graph.buses.preview);
    const preview = { output, reverb };
    this.previews.add(preview);
    return preview;
  }

  private fadePreviewVoice(now: number): void {
    const voice = this.lastPreview;
    if (!voice) return;
    this.lastPreview = undefined;
    voice.gain.gain.setTargetAtTime(0, now, 0.012);
    voice.wet?.gain.setTargetAtTime(0, now, 0.012);
    voice.source.stop(now + 0.06);
  }

  private releasePreview(preview: PreviewGraph): void {
    clearTimeout(preview.cleanup);
    this.previews.delete(preview);
    preview.output.disconnect();
    preview.reverb.disconnect();
  }

  private playAt(kind: CinemaSound, buffer: AudioBuffer, position: Vector3, level: number, wet: number, loopOffset?: number,
    refDistance = 2.5, preview?: PreviewGraph,
  ): Sound | undefined {
    const context = this.context;
    const graph = this.graph;
    if (!context || !graph || context.state !== 'running' || this.disposed) return;
    const loop = loopOffset !== undefined;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.loopStart = loop ? 0.2 : 0;
    const pan = context.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = refDistance;
    pan.rolloffFactor = loop ? 0.8 : 1;
    pan.positionX.value = Math.max(CINEMA_BOUNDS.minX, Math.min(position.x, CINEMA_BOUNDS.maxX));
    pan.positionY.value = position.y;
    pan.positionZ.value = position.z;
    const gain = context.createGain();
    gain.gain.value = level;
    source.connect(gain).connect(pan).connect(preview?.output ?? graph.buses[kind]);
    const sound: Sound = { source, pan, gain };
    if (wet > 0) {
      const send = context.createGain();
      send.gain.value = level * wet / Math.max(1, position.distanceTo(this.listener) / refDistance);
      source.connect(send).connect(preview?.reverb ?? graph.reverb);
      sound.wet = send;
    }
    source.onended = () => this.release(sound);
    this.voices.add(sound);
    source.start(context.currentTime + (loop ? 0 : position.distanceTo(this.listener) / 343), loopOffset ?? 0);
    return sound;
  }

  private release(sound: Sound): void {
    this.voices.delete(sound);
    if (this.lastPreview === sound) this.lastPreview = undefined;
    sound.source.disconnect();
    sound.pan.disconnect();
    sound.gain.disconnect();
    sound.wet?.disconnect();
  }
}
