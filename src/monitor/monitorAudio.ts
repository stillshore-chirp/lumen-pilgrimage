import { MathUtils, Quaternion, Vector3, type Camera, type Object3D } from 'three';

export type MonitorAudioMode = 'stereo' | 'spatial';
export type MonitorAudioStatus = 'idle' | 'ready' | 'gesture-required' | 'unavailable' | 'stream-unavailable';

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
    if (target === this.target) return;
    // The current point is known even when the previous ramp is interrupted.
    const current = now >= this.endTime
      ? this.target
      : MathUtils.lerp(this.startValue, this.target, (now - this.startTime) / (this.endTime - this.startTime));
    const gain = this.node.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(current, now);
    gain.linearRampToValueAtTime(target, now + duration);
    this.startValue = current;
    this.startTime = now;
    this.endTime = now + duration;
    this.target = target;
  }
}

interface MonitorGraph {
  source: MediaStreamAudioSourceNode;
  master: FadedGain;
  stereo: FadedGain;
  spatial: { panner: PannerNode; level: FadedGain } | null;
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
  private unavailable = false;
  private streamUnavailable = false;
  private disposed = false;
  private volume = 0.75;
  private muted = false;
  private enabled = true;
  private mode: MonitorAudioMode = 'stereo';

  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();
  private readonly forward = new Vector3();
  private readonly up = new Vector3();

  getStatus(): MonitorAudioStatus {
    if (this.disposed || this.unavailable || typeof AudioContext !== 'function') return 'unavailable';
    if (this.streamUnavailable) return 'stream-unavailable';
    if (!this.context) return 'idle';
    return this.context.state === 'running' ? 'ready' : 'gesture-required';
  }

  supportsSpatial(): boolean {
    if (this.getStatus() === 'unavailable') return false;
    if (this.graph) return this.graph.spatial !== null;
    return !this.context || Boolean(this.context.listener.positionX && typeof this.context.createPanner === 'function');
  }

  // Invoke directly in the viewer's user gesture, before asynchronous pairing.
  start(): Promise<boolean> {
    if (this.disposed || typeof AudioContext !== 'function') return Promise.resolve(false);
    let context: AudioContext;
    try {
      context = this.context ??= new AudioContext({ latencyHint: 'interactive' });
      this.unavailable = false;
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
      this.unavailable = true;
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

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.updateLevel();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.updateLevel();
  }

  setMode(mode: MonitorAudioMode): void {
    this.mode = mode;
    const graph = this.graph;
    if (!graph?.spatial || !this.context) return;
    const spatial = mode === 'spatial' ? 1 : 0;
    const now = this.context.currentTime;
    graph.stereo.fadeTo(1 - spatial, now, MODE_FADE_SECONDS);
    graph.spatial.level.fadeTo(spatial, now, MODE_FADE_SECONDS);
  }

  update(camera: Camera, monitor: Object3D): void {
    const panner = this.graph?.spatial?.panner;
    const listener = this.context?.listener;
    if (!panner || !listener) return;

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

    monitor.getWorldQuaternion(this.rotation);
    this.position.setFromMatrixPosition(monitor.matrixWorld);
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
      const useSpatial = panner !== null && this.mode === 'spatial';
      const stereo = new FadedGain(context.createGain(), useSpatial ? 0 : 1);
      const spatial = panner ? { panner, level: new FadedGain(context.createGain(), useSpatial ? 1 : 0) } : null;

      source.connect(stereo.node).connect(master.node);
      if (spatial) source.connect(spatial.panner).connect(spatial.level.node).connect(master.node);
      master.node.connect(context.destination);
      this.graph = { source, master, stereo, spatial };
      this.streamUnavailable = false;
      this.updateLevel();
    } catch {
      this.streamUnavailable = true;
    }
  };

  private updateLevel(): void {
    if (!this.graph || !this.context) return;
    const level = this.enabled && !this.muted ? this.volume * MAX_GAIN : 0;
    this.graph.master.fadeTo(level, this.context.currentTime, LEVEL_FADE_SECONDS);
  }

  private disconnectGraph(): void {
    const graph = this.graph;
    if (!graph) return;
    graph.master.node.disconnect();
    graph.source.disconnect();
    graph.stereo.node.disconnect();
    graph.spatial?.level.node.disconnect();
    graph.spatial?.panner.disconnect();
    this.graph = null;
  }
}
