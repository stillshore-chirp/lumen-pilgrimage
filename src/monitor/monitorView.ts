import { Group, PerspectiveCamera, Vector2, type Scene, type WebGLRenderer } from 'three';
import { MonitorAudio, type MonitorAudioMode } from './monitorAudio';
import { MonitorDesktop, type MonitorDragMode } from './monitorDesktop';
import { MonitorObject, type MonitorTheater } from './monitorObject';
import { MonitorReceiver, type MonitorConnectionState } from './monitorSession';
import { MonitorXR } from './monitorXR';
import './monitorView.css';

export interface MonitorViewBinding {
  entry: HTMLElement;
  toggle: HTMLButtonElement;
  scene: Scene;
  camera: PerspectiveCamera;
  eyeHeight(): number;
  releaseInput(): void;
}

export class MonitorView {
  private readonly screen = new MonitorObject();
  private readonly desktop = new MonitorDesktop(this.screen);
  private readonly audio = new MonitorAudio();
  private readonly rig = new Group();
  private readonly xrRenderCamera = new PerspectiveCamera();
  private readonly xrViewCamera = new PerspectiveCamera();
  private readonly xr: MonitorXR;
  private readonly receiver: MonitorReceiver;
  private readonly events = new AbortController();
  private readonly pointer = new Vector2();
  private readonly panel = document.createElement('section');
  private readonly canvas: HTMLCanvasElement;
  private readonly video: HTMLVideoElement;
  private readonly displayTargetRow: HTMLElement;
  private readonly displayTarget: HTMLSelectElement;
  private readonly visibilityButton: HTMLButtonElement;
  private readonly editButton: HTMLButtonElement;
  private readonly dragControls: HTMLElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly form: HTMLFormElement;
  private readonly code: HTMLInputElement;
  private readonly connectButton: HTMLButtonElement;
  private readonly verification: HTMLOutputElement;
  private readonly status: HTMLElement;
  private readonly retryVideo: HTMLButtonElement;
  private readonly audioButton: HTMLButtonElement;
  private readonly audioMode: HTMLSelectElement;
  private readonly audioStatus: HTMLElement;
  private readonly xrButton: HTMLButtonElement;
  private readonly xrStatus: HTMLElement;
  private state: MonitorConnectionState = {
    phase: 'idle',
    detail: '配信元の接続コードを入力してください。',
    audio: { available: false, output: 'both' },
  };
  private placed = false;
  private pointerId: number | null = null;
  private dragMode: MonitorDragMode = 'move';
  private editing = false;
  private pendingXRSummon = false;
  private theater: MonitorTheater | null = null;

  constructor(
    private binding: MonitorViewBinding,
    private readonly renderer: WebGLRenderer,
    mediaRoot: HTMLElement,
  ) {
    const { entry, toggle, scene } = binding;
    this.canvas = renderer.domElement;
    this.panel.id = 'monitor-view-panel';
    this.panel.className = 'coast-panel monitor-view-panel';
    this.panel.setAttribute('aria-label', '仮想モニターの操作');
    this.panel.innerHTML = `
      <div data-monitor-target-row hidden>
        <label class="monitor-view-target">表示先
          <select data-monitor-display-target>
            <option value="floating">浮遊モニター</option>
            <option value="television">リビングのテレビ</option>
          </select>
        </label>
      </div>
      <div class="coast-row">
        <button type="button" data-monitor-visible>モニターを表示</button>
        <button type="button" data-monitor-edit aria-pressed="false" disabled>配置を編集</button>
      </div>
      <div class="monitor-view-drag" data-monitor-drag hidden>
        <div class="coast-row" role="group" aria-label="配置の操作">
          <button type="button" data-monitor-mode="move" aria-pressed="true">移動</button>
          <button type="button" data-monitor-mode="rotate" aria-pressed="false">回転</button>
          <button type="button" data-monitor-mode="scale" aria-pressed="false">拡大縮小</button>
        </div>
        <p>モニターをドラッグして調整します。Escで編集を終了します。</p>
      </div>
      <button type="button" data-monitor-reset disabled>位置・サイズを戻す</button>
      <div class="monitor-view-section">
        <a data-monitor-sender-link target="_blank" rel="noopener">配信画面を開く</a>
        <form data-monitor-form>
          <label for="monitor-join-code">接続コード</label>
          <div class="coast-row">
            <input id="monitor-join-code" type="text" required maxlength="24" autocomplete="off"
              autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX">
            <button type="submit" data-monitor-connect>接続</button>
          </div>
        </form>
        <output data-monitor-verification hidden></output>
        <p data-monitor-status role="status"></p>
        <button type="button" data-monitor-retry-video hidden>映像を再生</button>
      </div>
      <div class="monitor-view-section" role="group" aria-label="モニター音声">
        <div class="coast-row">
          <label class="monitor-view-volume">モニター音量
            <input data-monitor-volume type="range" min="0" max="100" step="1" value="75">
          </label>
          <button type="button" data-monitor-mute aria-pressed="false">モニター音をミュート</button>
        </div>
        <label class="monitor-view-mode">モニターの音響
          <select data-monitor-sound-mode>
            <option value="stereo">ステレオ</option>
            <option value="spatial">空間音響</option>
            <option value="television" hidden disabled>リビングのテレビから</option>
            <option value="surround" hidden disabled>リビングの5.1chスピーカー</option>
            <option value="cinema" hidden disabled>映画館の空間音響</option>
          </select>
        </label>
        <button type="button" data-monitor-sound>モニター音を有効にする</button>
        <p role="status" data-monitor-audio-status></p>
      </div>
      <div class="monitor-view-section">
        <button type="button" data-monitor-xr disabled>VRで見る</button>
        <p role="status" data-monitor-xr-status></p>
      </div>
    `;
    const query = <T extends HTMLElement>(name: string) => this.panel.querySelector<T>(`[data-monitor-${name}]`)!;
    this.displayTargetRow = query('target-row');
    this.displayTarget = query('display-target');
    this.visibilityButton = query('visible');
    this.editButton = query('edit');
    this.dragControls = query('drag');
    this.resetButton = query('reset');
    this.form = query('form');
    this.code = this.panel.querySelector('#monitor-join-code')!;
    this.connectButton = query('connect');
    this.verification = query('verification');
    this.status = query('status');
    this.retryVideo = query('retry-video');
    this.audioButton = query('sound');
    this.audioMode = query('sound-mode');
    this.audioStatus = query('audio-status');
    this.xrButton = query('xr');
    this.xrStatus = query('xr-status');
    const sender = new URL(location.pathname, location.origin);
    sender.searchParams.set('monitor', 'sender');
    query<HTMLAnchorElement>('sender-link').href = sender.href;
    this.video = document.createElement('video');
    this.video.hidden = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('data-monitor-video', '');
    entry.append(this.panel);
    toggle.setAttribute('aria-controls', this.panel.id);
    // Keep the playing element in the document while replacing world controls.
    mediaRoot.append(this.video);

    this.xrRenderCamera.copy(binding.camera);
    this.rig.add(this.xrRenderCamera);
    scene.add(this.rig, this.screen.group);
    this.xr = new MonitorXR(renderer.xr, this.rig, this.screen, {
      onStatusChange: ({ state, message }) => {
        this.xrButton.disabled = state === 'checking' || state === 'unavailable' || state === 'starting';
        this.xrButton.textContent = state === 'presenting' ? 'VRを終了' : 'VRで見る';
        this.xrStatus.textContent = message;
      },
      onSessionChange: (presenting) => this.setXRPresentation(presenting),
    });
    this.receiver = new MonitorReceiver({
      onState: state => this.setConnectionState(state),
      onStream: stream => this.setStream(stream),
    });
    this.bindPanel(query('volume'), query('mute'));
    this.bindPointer();
    this.setConnectionState(this.state);
    this.setOpen(true);
    void this.xr.checkSupport();
  }

  get hasActiveConnection(): boolean {
    return this.state.phase === 'approval' || this.state.phase === 'connecting' || this.state.phase === 'connected';
  }

  get blocksSceneInput(): boolean {
    return this.editing || this.renderer.xr.isPresenting;
  }

  get renderCamera(): PerspectiveCamera {
    return this.renderer.xr.isPresenting ? this.xrRenderCamera : this.binding.camera;
  }

  togglePanel(): void {
    this.setOpen(this.panel.hidden);
  }

  closePanel(): void {
    this.setOpen(false);
  }

  rebind(binding: MonitorViewBinding, theater: MonitorTheater | null): void {
    this.closePanel();
    this.xr.release();
    this.theater?.cinema?.project(null);
    this.binding = binding;
    binding.entry.append(this.panel);
    binding.toggle.setAttribute('aria-controls', this.panel.id);
    binding.scene.add(this.rig, this.screen.group);
    this.placed = false;
    this.setTheater(theater, true);
    if (this.renderer.xr.isPresenting) {
      this.anchorXR();
      this.resizeXRCamera();
      this.pendingXRSummon = this.screen.isVisible || this.pendingXRSummon;
      if (this.pendingXRSummon) this.placed = false;
    }
  }

  setTheater(theater: MonitorTheater | null, floating = false): void {
    this.theater = theater;
    this.displayTargetRow.hidden = theater === null;
    const cinema = theater?.cinema;
    const screenOption = this.displayTarget.options[1];
    screenOption.textContent = cinema ? '映画館のスクリーン' : 'リビングのテレビ';
    if (floating || !theater) this.displayTarget.value = 'floating';
    if (floating) {
      if (this.audioMode.value !== 'stereo' && this.audioMode.value !== 'spatial') {
        this.audioMode.value = 'stereo';
        // The former room's audio branch is removed immediately below.
        this.audio.setMode('stereo', 0);
      }
    } else if (cinema) {
      this.displayTarget.value = screenOption.value;
      this.audioMode.value = 'cinema';
    }
    this.audio.setTheaterSpeakers(theater?.speakers ?? null);
    this.audio.setCinema(cinema?.createAudio ?? null);
    this.updateDisplayTarget(!floating && Boolean(cinema) || this.screen.isVisible);
  }

  update(frame?: XRFrame): PerspectiveCamera {
    const { camera } = this.binding;
    const { renderer } = this;
    const reference = frame && renderer.xr.getReferenceSpace();
    const pose = reference && frame?.getViewerPose(reference);
    let viewer = camera;
    if (pose) {
      this.rig.updateMatrixWorld();
      this.xrViewCamera.matrix.fromArray(pose.transform.matrix).premultiply(this.rig.matrixWorld);
      this.xrViewCamera.matrix.decompose(this.xrViewCamera.position, this.xrViewCamera.quaternion, this.xrViewCamera.scale);
      viewer = this.xrViewCamera;
      if (this.pendingXRSummon) {
        this.pendingXRSummon = false;
        this.setScreenVisible(true, viewer);
      }
    }
    this.xr.update(frame);
    this.screen.update();
    const cinema = this.theater?.cinema;
    if (cinema) {
      const frameTexture = this.screen.projectedTexture;
      const projected = !this.screen.isFloating && this.screen.isVisible ? frameTexture : null;
      cinema.project(projected, projected ? this.video.videoWidth / this.video.videoHeight : undefined);
      this.audio.setCinemaQuality(cinema.quality());
      this.syncSharedAudio();
    }
    const soundSource = this.audioMode.value === 'television' ? this.theater?.screen : this.screen.group;
    this.audio.update(viewer, soundSource ?? this.screen.group);
    if (!this.panel.hidden) this.updateAudioStatus();
    return viewer;
  }

  relocateViewer(): void {
    if (this.renderer.xr.isPresenting) this.anchorXR();
  }

  private anchorXR(): void {
    const { camera } = this.binding;
    this.rig.position.copy(camera.position);
    this.rig.position.y -= this.binding.eyeHeight();
    this.rig.rotation.set(0, camera.rotation.y, 0);
  }

  release(): void {
    this.finishDrag();
    this.receiver.disconnect();
    this.audio.stop();
    this.theater?.cinema?.project(null);
    this.xr.release();
    const session = this.renderer.xr.getSession();
    if (session) void session.end().catch(() => {});
  }

  dispose(): void {
    this.release();
    this.events.abort();
    this.xr.dispose();
    this.audio.dispose();
    this.screen.dispose();
    this.binding.scene.remove(this.rig, this.screen.group);
    this.panel.remove();
    this.video.remove();
  }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.binding.toggle.setAttribute('aria-expanded', String(open));
    if (open) this.binding.releaseInput();
    else this.setEditing(false);
  }

  private setScreenVisible(visible: boolean, camera = this.binding.camera): void {
    if (visible && this.screen.isFloating && !this.placed) {
      this.screen.reset(camera);
      this.placed = true;
    }
    this.screen.setVisible(visible);
    this.visibilityButton.textContent = this.screen.isFloating
      ? (visible ? 'モニターを隠す' : 'モニターを表示')
      : this.theater?.cinema
        ? (visible ? '投影を止める' : 'スクリーンに映す')
        : (visible ? 'テレビの表示を切る' : 'テレビに表示');
    const canEdit = visible && this.screen.isFloating;
    this.editButton.disabled = this.resetButton.disabled = !canEdit;
    if (!canEdit) this.setEditing(false);
  }

  private updateDisplayTarget(visible: boolean): void {
    const target = this.displayTarget.value === 'television' ? this.theater : null;
    this.screen.setTarget(target?.screen ?? null, Boolean(target?.cinema));
    this.setScreenVisible(visible);
    this.updateAudioModes();
    this.syncSharedAudio();
  }

  private updateAudioModes(): void {
    const canSpatialize = this.audio.supportsSpatial();
    const floating = this.screen.isFloating;
    const surround = this.audio.supportsSurround();
    const cinema = this.audio.supportsCinema();
    for (const option of this.audioMode.options) {
      if (option.value === 'spatial') {
        option.hidden = !floating;
        option.disabled = !floating || !canSpatialize;
      } else if (option.value === 'television' || option.value === 'surround') {
        option.hidden = !this.theater || Boolean(this.theater.cinema);
        option.disabled = option.hidden || (option.value === 'television' ? !canSpatialize : !surround);
      } else if (option.value === 'cinema') {
        option.hidden = !this.theater?.cinema;
        option.disabled = !cinema;
      }
    }
    if (this.audioMode.value === 'spatial' && !floating && canSpatialize) {
      this.audioMode.value = cinema ? 'cinema' : 'television';
    }
    if (this.audioMode.selectedOptions[0]?.disabled) this.audioMode.value = 'stereo';
    this.audioMode.disabled = !canSpatialize && !surround && !cinema;
    this.audioMode.title = this.audioMode.disabled ? 'このブラウザで空間音響を利用できません。' : '';
    this.audio.setMode(this.audioMode.value as MonitorAudioMode);
  }

  private resizeXRCamera(): void {
    const { near, far } = this.binding.camera;
    this.xrRenderCamera.near = near;
    this.xrRenderCamera.far = far;
  }

  private setXRPresentation(presenting: boolean): void {
    this.setOpen(!presenting);
    if (presenting) {
      this.binding.releaseInput();
      this.anchorXR();
      this.resizeXRCamera();
      this.pendingXRSummon = !this.screen.isVisible && (this.screen.isFloating || !this.theater?.cinema);
      if (this.pendingXRSummon) this.placed = false;
    } else {
      this.pendingXRSummon = false;
    }
  }

  private setEditing(editing: boolean): void {
    if (this.editing === editing) return;
    this.editing = editing;
    this.editButton.setAttribute('aria-pressed', String(editing));
    this.dragControls.hidden = !editing;
    this.canvas.classList.toggle('monitor-editing', editing);
    this.binding.releaseInput();
    if (!editing) this.finishDrag();
  }

  private setConnectionState(state: MonitorConnectionState): void {
    this.state = state;
    this.status.textContent = state.detail;
    this.screen.setStatus(state.detail);
    const active = this.hasActiveConnection;
    this.code.disabled = active;
    this.code.required = !active;
    this.connectButton.textContent = active ? '切断' : '接続';
    this.verification.hidden = !state.verification;
    this.verification.textContent = state.verification ?? '';
    this.verification.setAttribute('aria-label', '配信元と照合する確認番号');
    this.syncSharedAudio();
    if (state.phase === 'ended' || state.phase === 'failed') this.audio.stop();
    this.updateAudioModes();
    this.updateAudioStatus();
  }

  private syncSharedAudio(): void {
    const { available, output } = this.state.audio;
    const cinema = this.theater?.cinema;
    const usesCinema = !this.screen.isFloating || this.audioMode.value === 'cinema';
    const videoPlaying = this.screen.isVisible && this.screen.projectedTexture !== null;
    this.audio.setEnabled(available && output !== 'pc' && (!cinema || !usesCinema || (!cinema.paused() && videoPlaying)));
  }

  private setStream(stream: MediaStream | null): void {
    this.retryVideo.hidden = true;
    this.video.pause();
    this.video.srcObject = stream;
    this.screen.setVideo(stream ? this.video : null);
    this.audio.setStream(stream);
    this.updateAudioModes();
    if (stream) void this.playVideo(stream);
  }

  private async playVideo(stream: MediaStream): Promise<void> {
    try {
      await this.video.play();
      if (this.video.srcObject === stream) this.retryVideo.hidden = true;
    } catch {
      if (this.video.srcObject !== stream) return;
      this.retryVideo.hidden = false;
      this.screen.setStatus('パネルの「映像を再生」を押してください。');
    }
  }

  private updateAudioStatus(): void {
    const audioStatus = this.audio.getStatus();
    const { phase, audio } = this.state;
    let message = '';
    if (audioStatus === 'unavailable' || audioStatus === 'stream-unavailable') {
      message = 'この視聴ブラウザで共有音声を再生できません。';
    } else if (phase === 'connected') {
      if (!audio.available) message = '配信元から共有音声が取得されていません。';
      else if (audio.pcPlaybackSuppressed) message = '共有音声は停止中です。PC側の再生は配信元で共有対象を選び直すと再開します。';
      else if (audio.output === 'pc') message = '配信元で「PC側のみ」が選ばれています。';
      else if (audioStatus !== 'ready') message = '視聴側でも聞くには、モニター音を有効にしてください。';
      else if (audio.output === 'viewer') message = '配信元で「VR側のみ」が選ばれています。';
      else if (this.audioMode.value === 'surround') message = 'ステレオ音源は左右のフロントスピーカーから再生します。';
    }
    if (this.audioStatus.textContent !== message) this.audioStatus.textContent = message;
    this.audioButton.disabled = audioStatus === 'ready' || audioStatus === 'unavailable';
  }

  private bindPanel(volume: HTMLInputElement, mute: HTMLButtonElement): void {
    const { signal } = this.events;
    const listen = { signal };
    this.displayTarget.addEventListener('change', () => this.updateDisplayTarget(true), listen);
    this.visibilityButton.addEventListener('click', () => this.setScreenVisible(!this.screen.isVisible), listen);
    this.editButton.addEventListener('click', () => this.setEditing(!this.editing), listen);
    this.resetButton.addEventListener('click', () => {
      this.finishDrag();
      this.screen.reset(this.binding.camera);
    }, listen);
    const modes = this.dragControls.querySelectorAll<HTMLButtonElement>('[data-monitor-mode]');
    for (const button of modes) {
      button.addEventListener('click', () => {
        this.finishDrag();
        this.dragMode = button.dataset.monitorMode as MonitorDragMode;
        for (const other of modes) other.setAttribute('aria-pressed', String(other === button));
      }, listen);
    }
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      if (this.code.disabled) this.receiver.disconnect();
      else {
        this.setScreenVisible(true);
        const code = this.code.value;
        this.code.value = '';
        void this.receiver.connect(code);
      }
    }, listen);
    this.retryVideo.addEventListener('click', () => {
      if (this.video.srcObject instanceof MediaStream) void this.playVideo(this.video.srcObject);
    }, listen);
    volume.addEventListener('input', () => this.audio.setVolume(volume.valueAsNumber / 100), listen);
    mute.addEventListener('click', () => {
      const muted = mute.getAttribute('aria-pressed') !== 'true';
      mute.setAttribute('aria-pressed', String(muted));
      this.audio.setMuted(muted);
    }, listen);
    this.audioMode.addEventListener('change', () => {
      this.audio.setMode(this.audioMode.value as MonitorAudioMode);
      this.syncSharedAudio();
    }, listen);
    this.audioButton.addEventListener('click', async () => {
      this.audioButton.disabled = true;
      await this.audio.start();
      this.updateAudioModes();
      this.updateAudioStatus();
    }, listen);
    this.xrButton.addEventListener('click', () => void this.xr.toggleSession(), listen);
    this.panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (this.editing) this.setEditing(false);
        else {
          this.setOpen(false);
          this.binding.toggle.focus();
        }
      }
      event.stopPropagation();
    }, listen);
  }

  private bindPointer(): void {
    const { signal } = this.events;
    const listen = { signal };
    const canvas = this.canvas;
    const position = ({ clientX, clientY }: PointerEvent) => {
      const area = canvas.getBoundingClientRect();
      return this.pointer.set(2 * (clientX - area.left) / area.width - 1, 1 - 2 * (clientY - area.top) / area.height);
    };
    canvas.addEventListener('pointerdown', event => {
      if (!this.editing || this.pointerId !== null || event.button !== 0) return;
      if (!this.desktop.begin(this.binding.camera, position(event), this.dragMode,
        event.pointerId, event.clientX, event.clientY)) return;
      this.pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
      event.preventDefault();
    }, listen);
    canvas.addEventListener('pointermove', event => {
      if (this.pointerId !== event.pointerId) return;
      this.desktop.move(this.binding.camera, position(event), event.pointerId, event.clientX, event.clientY);
    }, listen);
    const finish = (event: PointerEvent) => {
      if (this.pointerId === event.pointerId) this.finishDrag();
    };
    canvas.addEventListener('pointerup', finish, listen);
    canvas.addEventListener('pointercancel', finish, listen);
    canvas.addEventListener('lostpointercapture', finish, listen);
    canvas.addEventListener('keydown', event => {
      if (!this.editing) return;
      if (event.key === 'Escape') this.setEditing(false);
      event.stopPropagation();
    }, listen);
    window.addEventListener('blur', () => this.finishDrag(), listen);
  }

  private finishDrag(): void {
    if (this.pointerId === null) return;
    const id = this.pointerId;
    this.pointerId = null;
    this.desktop.end(id);
    if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
  }
}
