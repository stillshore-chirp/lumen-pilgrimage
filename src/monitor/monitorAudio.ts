import { MathUtils, Quaternion, Vector3, type Camera, type Object3D } from 'three';
// @ts-expect-error The Node test runner needs the explicit extension for native TypeScript loading.
import { connectExplorationOutput } from '../coast/explorationOutput.ts';

export type MonitorAudioMode = 'stereo' | 'spatial' | 'television' | 'surround' | 'cinema';
export type MonitorAudioStatus = 'idle' | 'ready' | 'gesture-required' | 'unavailable' | 'stream-unavailable';

export interface CinemaMonitorPlayback {
  setQuality(quality: 'light' | 'high'): void;
  update(camera: Camera): void;
  dispose(): void;
}

export type CinemaPlaybackFactory = (
  context: AudioContext, source: AudioNode, output: AudioNode, channelCount: number,
) => CinemaMonitorPlayback;

const MAX_GAIN = 0.75;
const LEVEL_FADE_SECONDS = 0.08;
const MODE_FADE_SECONDS = 0.12;
const RESUME_TIMEOUT_MS = 1500;

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
  level: FadedGain;
}

interface MonitorGraph {
  source: MediaStreamAudioSourceNode;
  master: FadedGain;
  outputNodes: readonly AudioNode[];
  stereo: FadedGain;
  spatial: { panner: PannerNode; level: FadedGain } | null;
  surround: SurroundGraph | null;
  cinema: { playback: CinemaMonitorPlayback; level: FadedGain } | null;
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

  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();

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
    this.graph?.cinema?.playback.setQuality(quality);
  }

  setTheaterSpeakers(speakers: readonly Object3D[] | null): void {
    if (this.theaterSpeakers === speakers) return;
    this.theaterSpeakers = speakers;
    if (this.graph && this.context) {
      this.disconnectSurround(this.graph);
      this.graph.surround = this.createSurround(this.context, this.graph.source, this.graph.master.node);
      this.setMode(this.mode);
    }
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
    const now = this.context.currentTime;
    graph.stereo.fadeTo(spatial || surround || cinema ? 0 : 1, now, transitionSeconds);
    graph.spatial?.level.fadeTo(spatial ? 1 : 0, now, transitionSeconds);
    graph.surround?.level.fadeTo(surround ? 1 : 0, now, transitionSeconds);
    graph.cinema?.level.fadeTo(cinema ? 1 : 0, now, transitionSeconds);
  }

  update(camera: Camera, monitor: Object3D): void {
    if (this.mode === 'cinema' && this.enabled) this.graph?.cinema?.playback.update(camera);
    const panner = this.graph?.spatial?.panner;
    const listener = this.context?.listener;
    if ((!panner && !this.graph?.surround) || !listener) return;

    camera.getWorldQuaternion(this.rotation);
    this.position.setFromMatrixPosition(camera.matrixWorld);
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

    if (panner) this.updatePanner(panner, monitor);
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

  private createSurround(context: AudioContext, source: MediaStreamAudioSourceNode, master: GainNode): SurroundGraph | null {
    if (this.theaterSpeakers?.length !== 6) return null;
    const panners: PannerNode[] = [];
    for (const speaker of this.theaterSpeakers) {
      const panner = createMonitorPanner(context);
      if (!panner) return null;
      this.updatePanner(panner, speaker);
      panners.push(panner);
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
    source.connect(layout).connect(splitter);
    panners.forEach((panner, channel) => {
      if (channel === 3) splitter.connect(lowpass, channel).connect(panner);
      else splitter.connect(panner, channel);
      panner.connect(level.node);
    });
    level.node.connect(master);
    return { layout, splitter, lowpass, panners, level };
  }

  private createCinema(context: AudioContext, source: AudioNode, master: GainNode, track: MediaStreamTrack) {
    if (!this.cinemaPlayback || !context.listener.positionX) return null;
    const level = new FadedGain(context.createGain(), this.mode === 'cinema' ? 1 : 0);
    const channelCount = track.getSettings().channelCount ?? 2;
    try {
      const playback = this.cinemaPlayback(context, source, level.node, channelCount);
      playback.setQuality(this.cinemaQuality);
      level.node.connect(master);
      return { playback, level };
    } catch {
      // Keep headphone stereo available if this browser cannot build the cinema graph.
      level.node.disconnect();
      return null;
    }
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
      const panner = createMonitorPanner(context);
      const surround = this.createSurround(context, source, master.node);
      const cinema = this.createCinema(context, source, master.node, track);
      const useSpatial = panner !== null && (this.mode === 'spatial' || this.mode === 'television');
      const useSurround = surround !== null && this.mode === 'surround';
      const useCinema = cinema !== null && this.mode === 'cinema';
      const stereo = new FadedGain(context.createGain(), useSpatial || useSurround || useCinema ? 0 : 1);
      stereo.node.channelCount = 2;
      stereo.node.channelCountMode = 'explicit';
      const spatial = panner ? { panner, level: new FadedGain(context.createGain(), useSpatial ? 1 : 0) } : null;

      source.connect(stereo.node).connect(master.node);
      if (spatial) source.connect(spatial.panner).connect(spatial.level.node).connect(master.node);
      const outputNodes = connectExplorationOutput(context, master.node);
      this.graph = { source, master, outputNodes, stereo, spatial, surround, cinema };
      this.streamUnavailable = false;
      this.setMode(this.mode);
      this.updateLevel();
    } catch {
      this.streamUnavailable = true;
    }
  };

  private updateLevel(): void {
    if (!this.graph || !this.context) return;
    const level = this.enabled ? this.volume * this.masterVolume * MAX_GAIN : 0;
    this.graph.master.fadeTo(level, this.context.currentTime, LEVEL_FADE_SECONDS);
  }

  private disconnectGraph(): void {
    const graph = this.graph;
    if (!graph) return;
    this.disconnectSurround(graph);
    this.disconnectCinema(graph);
    graph.master.node.disconnect();
    graph.outputNodes.forEach(node => node.disconnect());
    graph.source.disconnect();
    graph.stereo.node.disconnect();
    graph.spatial?.level.node.disconnect();
    graph.spatial?.panner.disconnect();
    this.graph = null;
  }

  private disconnectCinema(graph: MonitorGraph): void {
    graph.cinema?.playback.dispose();
    graph.cinema?.level.node.disconnect();
    graph.cinema = null;
  }

  private disconnectSurround(graph: MonitorGraph): void {
    const surround = graph.surround;
    if (!surround) return;
    graph.source.disconnect(surround.layout);
    surround.layout.disconnect();
    surround.splitter.disconnect();
    surround.lowpass.disconnect();
    for (const panner of surround.panners) panner.disconnect();
    surround.level.node.disconnect();
    graph.surround = null;
  }
}
