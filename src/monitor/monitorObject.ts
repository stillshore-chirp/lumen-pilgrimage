import * as THREE from 'three';
import type { CinemaPlaybackFactory } from './monitorAudio';

export const MONITOR_MIN_SCALE = 0.25;
export const MONITOR_MAX_SCALE = 5;

const SCREEN_WIDTH = 2.7;
const SCREEN_HEIGHT = SCREEN_WIDTH * 9 / 16;
const DEFAULT_DISTANCE = 3.25;
const MAX_DROP_FROM_EYE = 0.66;
const STATUS_WIDTH = 1024;
const STATUS_HEIGHT = STATUS_WIDTH * 9 / 16;
const INITIAL_STATUS = '映像は未接続です';

type MonitorSurface = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

export interface MonitorTheater {
  screen: MonitorSurface;
  // Web Audio 5.1 channel order is L, R, C, LFE, SL, SR.
  speakers: readonly THREE.Object3D[];
  cinema?: {
    project(texture: THREE.Texture | null, aspect?: number): void;
    createAudio: CinemaPlaybackFactory;
    quality(): 'light' | 'high';
    paused(): boolean;
  };
}

export class MonitorObject {
  readonly group = new THREE.Group();
  readonly audioEmitters = [new THREE.Object3D(), new THREE.Object3D()] as const;
  private readonly screen: MonitorSurface;
  private readonly statusCanvas = document.createElement('canvas');
  private readonly statusTexture: THREE.CanvasTexture;
  private target: MonitorSurface | null = null;
  private status = '';
  private video: HTMLVideoElement | null = null;
  private videoTexture: THREE.VideoTexture | null = null;
  private videoSource: HTMLVideoElement['srcObject'] | string = null;
  private videoWidth = 0;
  private videoHeight = 0;

  constructor() {
    this.group.name = 'virtual-monitor';
    this.group.visible = false;

    this.statusCanvas.width = STATUS_WIDTH;
    this.statusCanvas.height = STATUS_HEIGHT;
    this.statusTexture = new THREE.CanvasTexture(this.statusCanvas);
    this.statusTexture.colorSpace = THREE.SRGBColorSpace;
    this.screen = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.statusTexture, toneMapped: false, transparent: true, side: THREE.DoubleSide })
    );
    this.screen.name = 'monitor-surface';
    this.screen.scale.set(SCREEN_WIDTH, SCREEN_HEIGHT, 1);
    this.group.add(this.screen);
    this.audioEmitters.forEach((emitter, index) => {
      emitter.name = index === 0 ? 'monitor-audio-L' : 'monitor-audio-R';
      emitter.position.set(index === 0 ? -0.5 : 0.5, 0, 0.006);
      this.screen.add(emitter);
    });
    this.setStatus(INITIAL_STATUS);
  }

  get isVisible(): boolean {
    return this.target ? this.screen.visible : this.group.visible;
  }

  get isFloating(): boolean {
    return this.target === null;
  }

  get projectedTexture(): THREE.VideoTexture | null {
    return this.videoTexture;
  }

  setTarget(target: MonitorSurface | null, projectInTarget = false): void {
    this.screen.material.visible = !projectInTarget;
    if (this.target === target) return;
    const visible = this.isVisible;
    this.target = target;
    (target ?? this.group).add(this.screen);
    this.screen.position.z = target ? .002 : 0;
    this.resizeFrame();
    this.setVisible(visible);
  }

  setVisible(visible: boolean): void {
    this.group.visible = this.isFloating && visible;
    this.screen.visible = this.isFloating || visible;
    if (visible) this.update();
    else this.clearVideoTexture();
  }

  reset(camera: THREE.Camera): void {
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const nominalDistance = camera instanceof THREE.PerspectiveCamera && camera.aspect < 1
      ? DEFAULT_DISTANCE / Math.max(0.45, camera.aspect)
      : DEFAULT_DISTANCE;
    // Keep the screen on the sightline and large enough to read when looking toward the ground.
    const distance = direction.y < 0 ? Math.min(nominalDistance, MAX_DROP_FROM_EYE / -direction.y) : nominalDistance;
    this.group.position.copy(eye).addScaledVector(direction, distance);
    if (distance === nominalDistance) this.group.position.y = Math.max(this.group.position.y - 0.12, eye.y - MAX_DROP_FROM_EYE);
    this.group.scale.setScalar(Math.max(MONITOR_MIN_SCALE, distance / nominalDistance));
    this.group.lookAt(eye);
  }

  setStatus(text: string): void {
    if (this.status === text) return;
    this.status = text;
    const context = this.statusCanvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, STATUS_WIDTH, STATUS_HEIGHT);
    context.fillStyle = '#102426e6';
    context.fillRect(0, 0, STATUS_WIDTH, STATUS_HEIGHT);

    const centerX = STATUS_WIDTH / 2;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f0f4f0';
    context.font = '600 40px system-ui, sans-serif';
    context.fillText(text, centerX, 260, STATUS_WIDTH - 132);
    context.fillStyle = '#b3c6c3';
    context.font = '26px system-ui, sans-serif';
    context.fillText('仮想モニターのパネルから接続できます', centerX, 326, STATUS_WIDTH - 132);
    this.statusTexture.needsUpdate = true;
  }

  setVideo(video: HTMLVideoElement | null): void {
    if (this.video !== video) {
      this.clearVideoTexture();
      this.video = video;
    }
    this.update();
  }

  update(): void {
    if (!this.isVisible) return;

    const video = this.video;
    if (!video || !this.hasVideoFrame(video)) {
      this.clearVideoTexture();
      return;
    }

    const { videoWidth, videoHeight } = video;
    const source = video.srcObject ?? video.currentSrc;
    if (this.videoTexture && source === this.videoSource
      && videoWidth === this.videoWidth && videoHeight === this.videoHeight) return;

    // WebGL video texture storage is allocated at the dimensions of its first frame.
    this.clearVideoTexture();
    this.videoSource = source;
    this.videoWidth = videoWidth;
    this.videoHeight = videoHeight;
    this.videoTexture = new THREE.VideoTexture(video);
    this.videoTexture.colorSpace = THREE.SRGBColorSpace;
    this.videoTexture.needsUpdate = true;
    this.resizeFrame();
    this.screen.material.map = this.videoTexture;
    this.screen.material.transparent = false;
    this.screen.material.needsUpdate = true;
  }

  intersect(raycaster: THREE.Raycaster): THREE.Intersection | undefined {
    if (!this.group.visible) return undefined;
    this.screen.updateWorldMatrix(true, false);
    return raycaster.intersectObject(this.screen, false)[0];
  }

  dispose(): void {
    this.setVisible(false);
    this.setTarget(null);
    this.video = null;
    this.statusTexture.dispose();
    this.screen.geometry.dispose();
    this.screen.material.dispose();
    this.group.removeFromParent();
  }

  private resizeFrame(): void {
    const { width, height } = this.target?.geometry.parameters ?? { width: SCREEN_WIDTH, height: SCREEN_HEIGHT };
    if (!this.videoTexture) {
      this.screen.scale.set(width, height, 1);
      return;
    }
    const scale = Math.min(width / this.videoWidth, height / this.videoHeight);
    this.screen.scale.set(this.videoWidth * scale, this.videoHeight * scale, 1);
  }

  private hasVideoFrame(video: HTMLVideoElement): boolean {
    if (video.readyState < video.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight
      || video.paused || video.ended || video.error) return false;

    const source = video.srcObject;
    if (source && 'getVideoTracks' in source) {
      return source.getVideoTracks().some(track => track.readyState === 'live' && track.enabled && !track.muted);
    }
    return Boolean(source || video.currentSrc);
  }

  private clearVideoTexture(): void {
    if (!this.videoTexture) return;
    this.videoTexture.dispose();
    this.videoTexture = null;
    this.videoSource = null;
    this.resizeFrame();
    this.screen.material.map = this.statusTexture;
    this.screen.material.transparent = true;
    this.screen.material.needsUpdate = true;
  }
}
