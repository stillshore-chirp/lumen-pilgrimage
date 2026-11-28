import { Camera, MathUtils, Object3D, Quaternion, Vector3 } from 'three';
// @ts-expect-error The Node test runner needs the explicit extension for native TypeScript loading.
import { connectExplorationOutput } from '../coast/explorationOutput.ts';

export type MonitorAudioMode = 'stereo' | 'spatial' | 'television' | 'surround' | 'cinema' | 'atrium' | 'cafe';
export type MonitorAudioStatus = 'idle' | 'ready' | 'gesture-required' | 'unavailable' | 'stream-unavailable';

export interface CinemaMonitorPlayback {
  setQuality(quality: 'light' | 'high'): void;
  update(camera: Camera): void;
  dispose(): void;
}

export type CinemaPlaybackFactory = (
  context: AudioContext, source: AudioNode, output: AudioNode, channelCount: number,
) => CinemaMonitorPlayback;

export interface WorldMonitorOutput {
  readonly id: 'atrium' | 'cafe';
  readonly label: string;
  readonly createAudio: CinemaPlaybackFactory;
}

export interface WorldMonitorEmitter {
  readonly id: string;
  readonly object: Object3D;
  readonly band: 'fullrange' | 'lfe';
}

export interface WorldMonitorPlayback {
  readonly inputs: readonly AudioNode[];
  update(listener: Camera): void;
  setQuality(quality: 'light' | 'high'): void;
  dispose(): void;
}

// The world owns these nodes, but never the stream, source, context or mode/master levels.
export type WorldMonitorPlaybackFactory = (
  context: AudioContext, destination: AudioNode, emitters: readonly WorldMonitorEmitter[],
) => WorldMonitorPlayback;

const MAX_GAIN = 0.75;
const LEVEL_FADE_SECONDS = 0.08;
const MODE_FADE_SECONDS = 0.12;
const RESUME_TIMEOUT_MS = 1500;
const WORLD_FADE_SECONDS = 0.024;
const WORLD_FADE_WAIT_MS = 32;

class FadedGain {
  readonly node: GainNode;
  private startValue: number;
  private target: number;
  private startTime = 0;
  private endTime = 0;

  constructor(node: GainNode, initial: number) {
    this.node = node;
    this.startValue = this.target = node.gain.value = initial;
  }

  fadeTo(target: number, now: number, duration: number): void {
    if (target === this.target && (duration > 0 || now >= this.endTime)) return;
    // The current point is known even when the previous ramp is interrupted.
    const current = now >= this.endTime
      ? this.target
      : MathUtils.lerp(this.startValue, this.target, (now - this.startTime) / (this.endTime - this.startTime));
    const gain = this.node.gain;
    gain.cancelScheduledValues(now);
    this.startValue = duration > 0 ? current : target;
    gain.setValueAtTime(this.startValue, now);
    if (duration > 0) gain.linearRampToValueAtTime(target, now + duration);
    this.startTime = now;
    this.endTime = now + duration;
    this.target = target;
  }
}

interface SurroundGraph {
  layout: GainNode;
  splitter: ChannelSplitterNode;
  lowpass: BiquadFilterNode;
  panners: PannerNode[];
  playback: WorldMonitorPlayback | null;
  level: FadedGain;
}

interface SpatialGraph {
  input: AudioNode;
  panner: PannerNode | null;
  playback: WorldMonitorPlayback | null;
  level: FadedGain;
  stereoPanners?: readonly PannerNode[];
  owned?: readonly AudioNode[];
}

interface SpeakerOutputGraph {
  input: GainNode;
  playback: CinemaMonitorPlayback;
  level: FadedGain;
}

interface MonitorGraph {
  source: MediaStreamAudioSourceNode;
  master: FadedGain;
  outputNodes: readonly AudioNode[];
  stereo: FadedGain;
  spatial: SpatialGraph | null;
  surround: SurroundGraph | null;
  cinema: SpeakerOutputGraph | null;
  outputs: Map<WorldMonitorOutput['id'], SpeakerOutputGraph>;
}

function createMonitorPanner(context: AudioContext): PannerNode | null {
  if (!context.listener.positionX) return null;
  try {
    const panner = context.createPanner();
    if (!panner.positionX) return null;
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.rolloffFactor = 0.8;
    panner.coneInnerAngle = 100;
    panner.coneOuterAngle = 240;
    panner.coneOuterGain = 0.28;
    return panner.panningModel === 'HRTF' ? panner : null;
  } catch {
    return null;
  }
}

export class MonitorAudio {
  private context: AudioContext | null = null;
  private starting: Promise<boolean> | null = null;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private graph: MonitorGraph | null = null;
  private streamUnavailable = false;
  private disposed = false;
  private volume = 0.75;
  private masterVolume = 1;
  private enabled = true;
  private mode: MonitorAudioMode = 'stereo';
  private theaterSpeakers: readonly Object3D[] | null = null;
  private cinemaPlayback: CinemaPlaybackFactory | null = null;
  private cinemaQuality: 'light' | 'high' = 'light';
  private worldPlayback: WorldMonitorPlaybackFactory | null = null;
  private worldQuality: 'light' | 'high' = 'light';
  private worldOutputs: readonly WorldMonitorOutput[] = [];
  private floatingStereo = false;
  private readonly edgePoses = [new Object3D(), new Object3D()] as const;
  private outputTransition: { finish(): void } | null = null;
  // These plain poses never retain a Camera/Object3D owned by a departed world.
  private readonly listenerPose = new Camera();
  private readonly spatialPose = new Object3D();

  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();

  constructor() {
    this.listenerPose.matrixAutoUpdate = this.spatialPose.matrixAutoUpdate = false;
  }

  getMode(): MonitorAudioMode { return this.mode; }

  getStatus(): MonitorAudioStatus {
    if (this.disposed || typeof AudioContext !== 'function') return 'unavailable';
    if (this.streamUnavailable) return 'stream-unavailable';
    if (!this.context) return 'idle';
    return this.context.state === 'running' ? 'ready' : 'gesture-required';
  }

  supportsSpatial(): boolean {
    if (this.getStatus() === 'unavailable') return false;
    if (this.graph) return this.graph.spatial !== null;
    return !this.context || Boolean(this.context.listener.positionX && typeof this.context.createPanner === 'function');
  }

  supportsSurround(): boolean {
    return this.theaterSpeakers?.length === 6 && (this.graph ? this.graph.surround !== null : this.supportsSpatial());
  }

  supportsCinema(): boolean {
    return this.cinemaPlayback !== null && this.getStatus() !== 'unavailable'
      && (!this.graph || this.graph.cinema !== null);
  }

  supportsOutput(id: WorldMonitorOutput['id']): boolean {
    return this.worldOutputs.some(output => output.id === id) && this.getStatus() !== 'unavailable'
      && (!this.graph || this.graph.outputs.has(id));
  }

  setWorldOutputs(outputs: readonly WorldMonitorOutput[]): void {
    if (this.worldOutputs === outputs) return;
    this.worldOutputs = outputs;
    const { graph, context, track } = this;
    if (!graph || !context || !track) return;
    this.disconnectOutputs(graph);
    graph.outputs = this.createOutputs(context, graph.source, graph.master.node, track);
    this.setMode(this.mode, 0);
  }

  // Only plain matrices are retained; emitter objects stay owned by MonitorObject.
  setFloatingSpeakers(speakers: readonly Object3D[] | null): void {
    const enabled = speakers?.length === 2;
    if (enabled) speakers.forEach((speaker, index) => {
      speaker.updateWorldMatrix(true, false);
      this.edgePoses[index].matrix.copy(speaker.matrixWorld);
      this.edgePoses[index].matrixWorld.copy(speaker.matrixWorld);
      this.edgePoses[index].matrixAutoUpdate = false;
    });
    if (this.floatingStereo === enabled) return;
    this.floatingStereo = enabled;
    if (!this.graph || !this.context) return;
    this.disconnectSpatial(this.graph);
    this.graph.spatial = this.createSpatial(this.context, this.graph.source, this.graph.master.node);
    this.setMode(this.mode, 0);
  }

  setCinema(factory: CinemaPlaybackFactory | null): void {
    if (this.cinemaPlayback === factory) return;
    this.cinemaPlayback = factory;
    const { graph, context, track } = this;
    if (!graph || !context || !track) return;
    this.disconnectCinema(graph);
    graph.cinema = this.createCinema(context, graph.source, graph.master.node, track);
    this.setMode(this.mode);
  }

  setCinemaQuality(quality: 'light' | 'high'): void {
    if (this.cinemaQuality === quality) return;
    this.cinemaQuality = quality;
    try { this.graph?.cinema?.playback.setQuality(quality); } catch {
      if (this.graph) this.disconnectCinema(this.graph);
      this.setMode(this.mode, 0);
    }
  }

  setTheaterSpeakers(speakers: readonly Object3D[] | null): void {
    this.setPlaybackSpace(this.worldPlayback, speakers, this.listenerPose, this.spatialPose, this.worldQuality);
  }

  setPlaybackSpace(factory: WorldMonitorPlaybackFactory | null, speakers: readonly Object3D[] | null,
    camera: Camera, monitor: Object3D, quality: 'light' | 'high'): void {
    this.capturePose(camera, monitor);
    this.updateListener();
    const changed = this.worldPlayback !== factory;
    const speakersChanged = this.theaterSpeakers !== speakers;
    this.worldPlayback = factory;
    this.theaterSpeakers = speakers;
    if (changed) this.worldQuality = quality;
    else this.setWorldQuality(quality);
    if (this.graph && this.context) {
      const graph = this.graph;
      if (changed) {
        this.disconnectSpatial(graph);
        graph.spatial = this.createSpatial(this.context, graph.source, graph.master.node);
      }
      if (changed || speakersChanged) {
        this.disconnectSurround(graph);
        graph.surround = this.createSurround(this.context, graph.source, graph.master.node);
      }
      // Availability, effective mode and fallback gains change in the same task.
      if (changed || speakersChanged) this.setMode(this.mode, 0);
    }
  }

  setWorldQuality(quality: 'light' | 'high'): void {
    if (this.worldQuality === quality) return;
    this.worldQuality = quality;
    this.updateWorldPlaybacks(playback => playback.setQuality(quality));
    const graph = this.graph;
    if (graph) {
      let failed = false;
      graph.outputs.forEach((output, id) => {
        try { output.playback.setQuality(quality); } catch {
          this.disconnectOutput(graph, id);
          failed = true;
        }
      });
      if (failed) this.setMode(this.mode, 0);
    }
  }

  prepareWorldChange(signal: AbortSignal, nextFactory: WorldMonitorPlaybackFactory | null = null,
    nextSpeakers: readonly Object3D[] | null = null): Promise<() => void> {
    this.outputTransition?.finish();
    const context = this.context;
    const spatialChanges = this.worldPlayback !== nextFactory;
    const worldRouteChanges = this.mode === 'cinema' || this.mode === 'television'
      || this.mode === 'atrium' || this.mode === 'cafe'
      || this.mode === 'surround' && (spatialChanges || this.theaterSpeakers !== nextSpeakers)
      || this.mode === 'spatial' && spatialChanges;
    if (signal.aborted || !worldRouteChanges || !this.enabled || this.volume === 0 || this.masterVolume === 0
      || !this.graph || !context || context.state !== 'running') {
      return Promise.resolve(() => {});
    }
    // Only an already prepared world transition uses this short handoff. The old
    // renderer remains alive until the caller swaps it, then calls finish in finally.
    return new Promise(resolve => {
      let timeout: ReturnType<typeof setTimeout>;
      const onStateChange = () => { if (context.state !== 'running') transition.finish(); };
      const transition = { finish: () => {
        if (this.outputTransition !== transition) return;
        this.outputTransition = null;
        clearTimeout(timeout);
        signal.removeEventListener('abort', transition.finish);
        context.removeEventListener('statechange', onStateChange);
        this.updateLevel(WORLD_FADE_SECONDS);
        resolve(transition.finish);
      } };
      this.outputTransition = transition;
      this.updateLevel(WORLD_FADE_SECONDS);
      timeout = setTimeout(() => resolve(transition.finish), WORLD_FADE_WAIT_MS);
      signal.addEventListener('abort', transition.finish, { once: true });
      context.addEventListener('statechange', onStateChange);
      if (signal.aborted) transition.finish();
    });
  }

  // Invoke directly in the viewer's user gesture.
  start(): Promise<boolean> {
    if (this.disposed || typeof AudioContext !== 'function') return Promise.resolve(false);
    let context: AudioContext;
    try {
      context = this.context ??= new AudioContext({ latencyHint: 'interactive' });
      this.syncTrack();
      if (context.state === 'running') return Promise.resolve(true);
      if (this.starting) return this.starting;
      if (globalThis.navigator?.userActivation?.isActive === false) return Promise.resolve(false);
      const resumed = context.resume().then(() => this.context === context && context.state === 'running', () => false);
      // A browser can leave resume pending while autoplay permission is denied.
      let timeout: ReturnType<typeof setTimeout>;
      const expires = new Promise<boolean>(resolve => {
        timeout = setTimeout(() => resolve(false), RESUME_TIMEOUT_MS);
      });
      this.starting = Promise.race([resumed, expires]).finally(() => {
        clearTimeout(timeout);
        if (this.context === context) this.starting = null;
      });
      return this.starting;
    } catch {
      return Promise.resolve(false);
    }
  }

  setStream(stream: MediaStream | null): void {
    if (this.disposed) return;
    if (stream !== this.stream) {
      this.stream?.removeEventListener('addtrack', this.syncTrack);
      this.stream?.removeEventListener('removetrack', this.syncTrack);
      this.stream = stream;
      stream?.addEventListener('addtrack', this.syncTrack);
      stream?.addEventListener('removetrack', this.syncTrack);
    }
    this.syncTrack();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = MathUtils.clamp(volume, 0, 1);
    this.updateLevel();
  }

  setMasterVolume(multiplier: number): void {
    if (!Number.isFinite(multiplier)) return;
    this.masterVolume = MathUtils.clamp(multiplier, 0, 3);
    this.updateLevel();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.updateLevel();
  }

  setMode(mode: MonitorAudioMode, transitionSeconds = MODE_FADE_SECONDS): void {
    this.mode = mode;
    const graph = this.graph;
    if (!graph || !this.context) return;
    const spatial = graph.spatial !== null && (mode === 'spatial' || mode === 'television');
    const surround = graph.surround !== null && mode === 'surround';
    const cinema = graph.cinema !== null && mode === 'cinema';
    const worldOutput = (mode === 'atrium' || mode === 'cafe') && graph.outputs.has(mode);
    if (mode !== 'stereo' && !spatial && !surround && !cinema && !worldOutput) {
      this.mode = 'stereo';
      transitionSeconds = 0;
    }
    const now = this.context.currentTime;
    graph.stereo.fadeTo(spatial || surround || cinema || worldOutput ? 0 : 1, now, transitionSeconds);
    graph.spatial?.level.fadeTo(spatial ? 1 : 0, now, transitionSeconds);
    graph.surround?.level.fadeTo(surround ? 1 : 0, now, transitionSeconds);
    graph.cinema?.level.fadeTo(cinema ? 1 : 0, now, transitionSeconds);
    graph.outputs.forEach((output, id) => output.level.fadeTo(id === mode ? 1 : 0, now, transitionSeconds));
  }

  update(camera: Camera, monitor: Object3D): void {
    this.capturePose(camera, monitor);
    this.updateListener();
    if (this.mode === 'cinema' && this.enabled) {
      try { this.graph?.cinema?.playback.update(camera); } catch {
        if (this.graph) this.disconnectCinema(this.graph);
        this.setMode('stereo', 0);
      }
    }
    if ((this.mode === 'atrium' || this.mode === 'cafe') && this.enabled) {
      try { this.graph?.outputs.get(this.mode)?.playback.update(camera); } catch {
        if (this.graph) this.disconnectOutput(this.graph, this.mode);
        this.setMode('stereo', 0);
      }
    }
    const panner = this.graph?.spatial?.panner;
    if (panner) this.updatePanner(panner, this.spatialPose);
    this.graph?.spatial?.stereoPanners?.forEach((panner, index) => this.updatePanner(panner, this.edgePoses[index]));
    this.updateWorldPlaybacks(playback => playback.update(this.listenerPose));
  }

  private capturePose(camera: Camera, monitor: Object3D): void {
    camera.updateWorldMatrix(true, false);
    monitor.updateWorldMatrix(true, false);
    this.listenerPose.matrix.copy(camera.matrixWorld);
    this.listenerPose.matrixWorld.copy(camera.matrixWorld);
    this.listenerPose.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.spatialPose.matrix.copy(monitor.matrixWorld);
    this.spatialPose.matrixWorld.copy(monitor.matrixWorld);
  }

  private updateListener(): void {
    const listener = this.context?.listener;
    if (!listener?.positionX) return;
    this.listenerPose.getWorldQuaternion(this.rotation);
    this.position.setFromMatrixPosition(this.listenerPose.matrixWorld);
    this.forward.set(0, 0, -1).applyQuaternion(this.rotation);
    this.up.set(0, 1, 0).applyQuaternion(this.rotation);
    listener.positionX.value = this.position.x;
    listener.positionY.value = this.position.y;
    listener.positionZ.value = this.position.z;
    listener.forwardX.value = this.forward.x;
    listener.forwardY.value = this.forward.y;
    listener.forwardZ.value = this.forward.z;
    listener.upX.value = this.up.x;
    listener.upY.value = this.up.y;
    listener.upZ.value = this.up.z;

  }

  private updateWorldPlaybacks(apply: (playback: WorldMonitorPlayback) => void): void {
    const graph = this.graph;
    if (!graph) return;
    let failed = false;
    for (const kind of ['spatial', 'surround'] as const) {
      const playback = graph[kind]?.playback;
      if (!playback) continue;
      try { apply(playback); } catch {
        if (kind === 'spatial') this.disconnectSpatial(graph);
        else this.disconnectSurround(graph);
        failed = true;
      }
    }
    if (failed) this.setMode(this.mode, 0);
  }

  private updatePanner(panner: PannerNode, source: Object3D): void {
    source.getWorldQuaternion(this.rotation);
    this.position.setFromMatrixPosition(source.matrixWorld);
    this.forward.set(0, 0, 1).applyQuaternion(this.rotation);
    panner.positionX.value = this.position.x;
    panner.positionY.value = this.position.y;
    panner.positionZ.value = this.position.z;
    panner.orientationX.value = this.forward.x;
    panner.orientationY.value = this.forward.y;
    panner.orientationZ.value = this.forward.z;
  }

  stop(): void {
    this.outputTransition?.finish();
    this.setStream(null);
    const context = this.context;
    this.context = null;
    this.starting = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private createWorldPlayback(context: AudioContext, destination: AudioNode,
    emitters: readonly WorldMonitorEmitter[]): WorldMonitorPlayback | null {
    if (!this.worldPlayback || !context.listener.positionX) return null;
    let playback: WorldMonitorPlayback | undefined;
    try {
      this.updateListener();
      playback = this.worldPlayback(context, destination, emitters);
      if (playback.inputs.length !== emitters.length || new Set(playback.inputs).size !== emitters.length
        || playback.inputs.some(input => input.context !== context || input.numberOfInputs < 1)) {
        throw new Error('Invalid world monitor inputs');
      }
      playback.setQuality(this.worldQuality);
      playback.update(this.listenerPose);
      return playback;
    } catch {
      this.disposeWorldPlayback(playback);
      return null;
    }
  }

  private createSpatial(context: AudioContext, source: AudioNode, master: GainNode,
    initial = 0, legacyPanner?: PannerNode | null): SpatialGraph | null {
    if (this.floatingStereo) return this.createFloatingSpatial(context, source, master, initial);
    const panner = this.worldPlayback ? null : legacyPanner === undefined ? createMonitorPanner(context) : legacyPanner;
    if (!this.worldPlayback && !panner) return null;
    const level = new FadedGain(context.createGain(), initial);
    let playback: WorldMonitorPlayback | null = null;
    let input: AudioNode | undefined = panner ?? undefined;
    try {
      if (this.worldPlayback) {
        playback = this.createWorldPlayback(context, level.node,
          [{ id: 'monitor', object: this.spatialPose, band: 'fullrange' }]);
        if (!playback) { level.node.disconnect(); return null; }
        const mono = context.createGain();
        input = mono;
        mono.channelCount = 1;
        mono.channelCountMode = 'explicit';
        mono.channelInterpretation = 'speakers';
        mono.connect(playback.inputs[0]);
      } else if (panner) {
        this.updatePanner(panner, this.spatialPose);
        panner.connect(level.node);
      }
      if (!input) return null;
      level.node.connect(master);
      source.connect(input);
      return { input, panner, playback, level };
    } catch {
      input?.disconnect();
      level.node.disconnect();
      this.disposeWorldPlayback(playback);
      return null;
    }
  }

  private createFloatingSpatial(context: AudioContext, source: AudioNode, master: GainNode,
    initial: number): SpatialGraph | null {
    const owned: AudioNode[] = [];
    let playback: WorldMonitorPlayback | null = null;
    try {
      const layout = context.createGain();
      owned.push(layout);
      layout.channelCount = 2;
      layout.channelCountMode = 'explicit';
      layout.channelInterpretation = 'speakers';
      const splitter = context.createChannelSplitter(2);
      owned.push(splitter);
      const level = new FadedGain(context.createGain(), initial);
      owned.push(level.node);
      const stereoPanners: PannerNode[] = [];
      if (this.worldPlayback) {
        playback = this.createWorldPlayback(context, level.node, this.edgePoses.map((object, index) => ({
          id: index === 0 ? 'monitor-L' : 'monitor-R', object, band: 'fullrange',
        })));
        if (!playback) throw new Error('Floating playback unavailable');
      }
      for (let index = 0; index < 2; index += 1) {
        const feed = context.createGain();
        owned.push(feed);
        feed.gain.value = Math.SQRT1_2;
        splitter.connect(feed, index);
        if (playback) feed.connect(playback.inputs[index]);
        else {
          const panner = createMonitorPanner(context);
          if (!panner) throw new Error('Floating panner unavailable');
          owned.push(panner);
          stereoPanners.push(panner);
          this.updatePanner(panner, this.edgePoses[index]);
          feed.connect(panner).connect(level.node);
        }
      }
      layout.connect(splitter);
      source.connect(layout);
      level.node.connect(master);
      return { input: layout, panner: null, playback, level, stereoPanners, owned };
    } catch {
      owned.forEach(node => node.disconnect());
      this.disposeWorldPlayback(playback);
      return null;
    }
  }

  private createSurround(context: AudioContext, source: MediaStreamAudioSourceNode, master: GainNode): SurroundGraph | null {
    if (this.theaterSpeakers?.length !== 6) return null;
    const panners: PannerNode[] = [];
    if (!this.worldPlayback) {
      for (const speaker of this.theaterSpeakers) {
        const panner = createMonitorPanner(context);
        if (!panner) { panners.forEach(node => node.disconnect()); return null; }
        this.updatePanner(panner, speaker);
        panners.push(panner);
      }
    }

    // Speaker interpretation applies the Web Audio mixing rules before the discrete split.
    // Stereo stays on L/R, mono plays from C, and a 5.1 stream retains all six channels.
    const layout = context.createGain();
    layout.channelCount = 6;
    layout.channelCountMode = 'explicit';
    layout.channelInterpretation = 'speakers';
    const splitter = context.createChannelSplitter(6);
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 120;
    lowpass.Q.value = Math.SQRT1_2;
    const level = new FadedGain(context.createGain(), 0);
    const ids = ['L', 'R', 'C', 'LFE', 'SL', 'SR'];
    this.theaterSpeakers.forEach(object => object.updateWorldMatrix(true, false));
    const playback = this.worldPlayback ? this.createWorldPlayback(context, level.node,
      this.theaterSpeakers.map((object, channel) => ({ id: ids[channel], object,
        band: channel === 3 ? 'lfe' : 'fullrange' }))) : null;
    if (this.worldPlayback && !playback) {
      [layout, splitter, lowpass, level.node].forEach(node => node.disconnect());
      return null;
    }
    try {
      layout.connect(splitter);
      (playback?.inputs ?? panners).forEach((input, channel) => {
        if (channel === 3) splitter.connect(lowpass, channel).connect(input);
        else splitter.connect(input, channel);
        if (!playback) input.connect(level.node);
      });
      level.node.connect(master);
      source.connect(layout);
      return { layout, splitter, lowpass, panners, playback, level };
    } catch {
      [layout, splitter, lowpass, level.node, ...panners].forEach(node => node.disconnect());
      this.disposeWorldPlayback(playback);
      return null;
    }
  }

  private createCinema(context: AudioContext, source: AudioNode, master: GainNode, track: MediaStreamTrack) {
    if (!this.cinemaPlayback || !context.listener.positionX) return null;
    const input = context.createGain();
    input.channelCountMode = 'max';
    input.channelInterpretation = 'discrete';
    const level = new FadedGain(context.createGain(), this.mode === 'cinema' ? 1 : 0);
    const channelCount = track.getSettings().channelCount ?? 2;
    let playback: CinemaMonitorPlayback | undefined;
    try {
      playback = this.cinemaPlayback(context, input, level.node, channelCount);
      playback.setQuality(this.cinemaQuality);
      level.node.connect(master);
      source.connect(input);
      return { input, playback, level };
    } catch {
      // Keep headphone stereo available if this browser cannot build the cinema graph.
      this.disposeSpeakerPlayback(playback);
      input.disconnect();
      level.node.disconnect();
      return null;
    }
  }

  private createOutputs(context: AudioContext, source: AudioNode, master: GainNode,
    track: MediaStreamTrack): MonitorGraph['outputs'] {
    const outputs: MonitorGraph['outputs'] = new Map();
    for (const definition of this.worldOutputs) {
      const input = context.createGain();
      input.channelCountMode = 'max';
      input.channelInterpretation = 'discrete';
      const level = new FadedGain(context.createGain(), this.mode === definition.id ? 1 : 0);
      let playback: CinemaMonitorPlayback | undefined;
      try {
        playback = definition.createAudio(context, input, level.node, track.getSettings().channelCount ?? 2);
        playback.setQuality(this.worldQuality);
        playback.update(this.listenerPose);
        level.node.connect(master);
        source.connect(input);
        outputs.set(definition.id, { input, playback, level });
      } catch {
        this.disposeSpeakerPlayback(playback);
        input.disconnect();
        level.node.disconnect();
      }
    }
    return outputs;
  }

  private readonly syncTrack = (): void => {
    const track = this.stream?.getAudioTracks().find(candidate => candidate.readyState === 'live') ?? null;
    if (track !== this.track) {
      this.track?.removeEventListener('ended', this.syncTrack);
      this.disconnectGraph();
      this.streamUnavailable = false;
      this.track = track;
      track?.addEventListener('ended', this.syncTrack);
    }
    const context = this.context;
    if (!context || !track || this.graph) return;
    try {
      const source = context.createMediaStreamSource(new MediaStream([track]));
      const master = new FadedGain(context.createGain(), 0);
      this.updateListener();
      const panner = this.worldPlayback || this.floatingStereo ? null : createMonitorPanner(context);
      const surround = this.createSurround(context, source, master.node);
      const cinema = this.createCinema(context, source, master.node, track);
      const outputs = this.createOutputs(context, source, master.node, track);
      const useSpatial = (this.worldPlayback !== null || panner !== null || this.floatingStereo)
        && (this.mode === 'spatial' || this.mode === 'television');
      const useSurround = surround !== null && this.mode === 'surround';
      const useCinema = cinema !== null && this.mode === 'cinema';
      const useWorldOutput = (this.mode === 'atrium' || this.mode === 'cafe') && outputs.has(this.mode);
      const stereo = new FadedGain(context.createGain(), useSpatial || useSurround || useCinema || useWorldOutput ? 0 : 1);
      stereo.node.channelCount = 2;
      stereo.node.channelCountMode = 'explicit';
      source.connect(stereo.node).connect(master.node);
      const spatial = this.createSpatial(context, source, master.node, useSpatial ? 1 : 0, panner);
      const outputNodes = connectExplorationOutput(context, master.node);
      this.graph = { source, master, outputNodes, stereo, spatial, surround, cinema, outputs };
      this.streamUnavailable = false;
      this.setMode(this.mode);
      this.updateLevel();
    } catch {
      this.streamUnavailable = true;
    }
  };

  private updateLevel(transitionSeconds = LEVEL_FADE_SECONDS): void {
    if (!this.graph || !this.context) return;
    const level = this.enabled && !this.outputTransition ? this.volume * this.masterVolume * MAX_GAIN : 0;
    this.graph.master.fadeTo(level, this.context.currentTime, transitionSeconds);
  }

  private disconnectGraph(): void {
    const graph = this.graph;
    if (!graph) return;
    this.disconnectSurround(graph);
    this.disconnectSpatial(graph);
    this.disconnectCinema(graph);
    this.disconnectOutputs(graph);
    graph.master.node.disconnect();
    graph.outputNodes.forEach(node => node.disconnect());
    graph.source.disconnect();
    graph.stereo.node.disconnect();
    this.graph = null;
  }

  private disconnectSpatial(graph: MonitorGraph): void {
    const spatial = graph.spatial;
    if (!spatial) return;
    graph.spatial = null;
    graph.source.disconnect(spatial.input);
    spatial.input.disconnect();
    spatial.owned?.forEach(node => node.disconnect());
    this.disposeWorldPlayback(spatial.playback);
    spatial.level.node.disconnect();
  }

  private disconnectCinema(graph: MonitorGraph): void {
    const output = graph.cinema;
    if (!output) return;
    graph.cinema = null;
    graph.source.disconnect(output.input);
    output.input.disconnect();
    this.disposeSpeakerPlayback(output.playback);
    output.level.node.disconnect();
  }

  private disconnectOutputs(graph: MonitorGraph): void {
    graph.outputs.forEach((_output, id) => this.disconnectOutput(graph, id));
  }

  private disconnectOutput(graph: MonitorGraph, id: WorldMonitorOutput['id']): void {
    const output = graph.outputs.get(id);
    if (!output) return;
    graph.outputs.delete(id);
    graph.source.disconnect(output.input);
    output.input.disconnect();
    this.disposeSpeakerPlayback(output.playback);
    output.level.node.disconnect();
  }

  private disposeSpeakerPlayback(playback: CinemaMonitorPlayback | null | undefined): void {
    try { playback?.dispose(); } catch { /* The owner releases both sides of this branch independently. */ }
  }

  private disconnectSurround(graph: MonitorGraph): void {
    const surround = graph.surround;
    if (!surround) return;
    graph.surround = null;
    graph.source.disconnect(surround.layout);
    surround.layout.disconnect();
    surround.splitter.disconnect();
    surround.lowpass.disconnect();
    for (const panner of surround.panners) panner.disconnect();
    this.disposeWorldPlayback(surround.playback);
    surround.level.node.disconnect();
  }

  private disposeWorldPlayback(playback: WorldMonitorPlayback | null | undefined): void {
    // A broken renderer must not prevent the shared owner from releasing other branches.
    try { playback?.dispose(); } catch { /* Its upstream and mode output are disconnected by their owner. */ }
  }
}
