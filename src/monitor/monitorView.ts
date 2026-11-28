import { PerspectiveCamera, Vector2, type Raycaster, type Scene, type WebGLRenderer } from 'three';
import { MonitorAudio, type MonitorAudioMode, type WorldMonitorPlaybackFactory } from './monitorAudio';
import { MonitorDesktop, type MonitorDragMode } from './monitorDesktop';
import { MonitorObject, type MonitorTheater } from './monitorObject';
import { MonitorReceiver, type MonitorConnectionState } from './monitorSession';
import { describeMonitorVideo, measureMonitorVideo } from './monitorVideoMetrics';
import { MonitorXR } from './monitorXR';
import type { CoastXR } from '../coast/CoastXR';
import type { DesktopGrabTarget } from '../coast/DesktopGrab';
import { renderImmersiveStatus } from '../xr/ImmersiveSession';
import './monitorView.css';

export interface MonitorViewBinding {
  entry: HTMLElement;
  toggle: HTMLButtonElement;
  scene: Scene;
  camera: PerspectiveCamera;
  releaseInput(): void;
  releaseDesktopGrab?(target: DesktopGrabTarget): void;
  readonly createSpatialAudio?: WorldMonitorPlaybackFactory;
  readonly audioQuality?: () => 'light' | 'high';
}

export class MonitorView {
  private readonly screen = new MonitorObject();
  readonly grabTarget: DesktopGrabTarget = {
    label: '浮遊モニター',
    object: this.screen.group,
    // The default placement can be over 7 m away on a narrow portrait display.
    reach: 7.25,
    available: () => this.panel.hidden && !this.editing && this.xrSession === null
      && !this.renderer.xr.isPresenting && this.screen.isFloating && this.screen.isVisible,
    hitDistance: ray => this.screen.intersect(ray)?.distance,
  };
  private readonly desktop = new MonitorDesktop(this.screen);
  private readonly audio = new MonitorAudio();
  private audioCapabilities = -1;
  private readonly xr: MonitorXR;
  private readonly unsubscribeXR: () => void;
  private xrSession: XRSession | null = null;
  private readonly receiver: MonitorReceiver;
  private measurement: AbortController | undefined;
  private readonly measureVideo: HTMLButtonElement;
  private readonly videoStatistics: HTMLElement;
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
  private summonOnEntry = false;
  private panelOpenOnExit = false;
  private theater: MonitorTheater | null = null;
  private audioPlayback: 'off' | 'on' | 'retry' = 'off';
  private audioStart: Promise<boolean> | null = null;

  constructor(
    private binding: MonitorViewBinding,
    private readonly renderer: WebGLRenderer,
    mediaRoot: HTMLElement,
    private readonly explorationXR: CoastXR,
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
        <button type="button" data-monitor-measure-video disabled>映像の滑らかさを計測</button>
        <p data-monitor-video-statistics role="status"></p>
      </div>
      <div class="monitor-view-section" role="group" aria-label="モニター音声">
        <div class="coast-row">
          <label class="monitor-view-volume">モニター音量
            <input data-monitor-volume type="range" min="0" max="100" step="1" value="75">
          </label>
          <button type="button" data-monitor-sound aria-label="モニター音声" aria-describedby="monitor-audio-status"
            aria-pressed="false" disabled>モニター音声 オフ</button>
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
        <p id="monitor-audio-status" role="status" data-monitor-audio-status></p>
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
    this.measureVideo = query('measure-video');
    this.videoStatistics = query('video-statistics');
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

    scene.add(this.screen.group);
    this.xr = new MonitorXR(renderer.xr, explorationXR.rig, this.screen);
    this.unsubscribeXR = explorationXR.session.observe((status, session) => {
      renderImmersiveStatus(this.xrButton, this.xrStatus, status, 'VRで見る', 'VRを終了');
      if (session === this.xrSession) return;
      this.xrSession = session;
      this.xr.setSession(session);
      this.setXRPresentation(Boolean(session));
    });
    this.receiver = new MonitorReceiver({
      onState: state => this.setConnectionState(state),
      onStream: stream => this.setStream(stream),
    });
    this.bindPanel(query('volume'));
    this.bindPointer();
    this.setConnectionState(this.state);
    this.setOpen(true);
  }

  get hasActiveConnection(): boolean {
    return this.state.phase === 'approval' || this.state.phase === 'connecting' || this.state.phase === 'connected';
  }

  get blocksSceneInput(): boolean {
    return this.editing;
  }

  get isGrabbing(): boolean { return this.xr.isGrabbing; }

  interceptsGrip(ray: Raycaster, distance: number): boolean {
    const hit = this.screen.intersect(ray);
    return hit !== undefined && hit.distance < distance;
  }

  releaseGrab(): void { this.xr.release(); }

  get displayActionLabel(): string { return this.visibilityButton.textContent ?? ''; }

  get audioActionLabel(): string { return this.audioButton.textContent ?? ''; }

  get canToggleAudio(): boolean { return !this.audioButton.disabled; }

  get canSetFloatingPose(): boolean { return this.screen.isFloating; }

  toggleDisplayInXR(): void {
    this.pendingXRSummon = !this.screen.isVisible;
    if (!this.pendingXRSummon) this.setScreenVisible(false);
  }

  resetDisplayInXR(): void {
    if (!this.screen.isFloating) return;
    this.releaseDesktopGrab();
    this.placed = false;
    this.pendingXRSummon = true;
  }

  togglePanel(): void {
    this.setOpen(this.panel.hidden);
  }

  setMasterVolume(multiplier: number): void {
    this.audio.setMasterVolume(multiplier);
  }

  prepareWorldChange(signal: AbortSignal, factory: WorldMonitorPlaybackFactory | null,
    theater: MonitorTheater | null): Promise<() => void> {
    return this.audio.prepareWorldChange(signal, factory, theater?.speakers ?? null);
  }

  async toggleAudio(): Promise<void> {
    if (this.audioButton.disabled) return;
    if (this.audioStart || (this.audioPlayback === 'on' && this.audio.getStatus() === 'ready')) {
      this.audioStart = null;
      this.audioPlayback = 'off';
    } else {
      this.audioPlayback = 'off';
      this.syncSharedAudio();
      // Starting or resuming the context must happen directly in the user's action.
      const start = this.audio.start();
      this.audioStart = start;
      this.updateAudioStatus();
      const ready = await start;
      if (this.audioStart !== start) return;
      this.audioStart = null;
      this.audioPlayback = ready && this.audio.getStatus() === 'ready' ? 'on' : 'retry';
      this.updateAudioModes();
    }
    this.syncSharedAudio();
    this.updateAudioStatus();
  }

  closePanel(): void {
    this.setOpen(false);
  }

  rebind(binding: MonitorViewBinding, theater: MonitorTheater | null): void {
    this.releaseDesktopGrab();
    this.closePanel();
    this.xr.release();
    this.theater?.cinema?.project(null);
    this.binding = binding;
    binding.entry.append(this.panel);
    binding.toggle.setAttribute('aria-controls', this.panel.id);
    binding.scene.add(this.screen.group);
    this.placed = false;
    this.setTheater(theater, true);
    if (this.renderer.xr.isPresenting) {
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
    this.updateDisplayTarget(!floating && Boolean(cinema) || this.screen.isVisible, false);
    if (!this.screen.isFloating && this.audioMode.value === 'spatial') {
      this.audioMode.value = cinema ? 'cinema' : 'television';
    }
    const source = this.audioMode.value === 'television' ? theater?.screen : this.screen.group;
    this.audio.setPlaybackSpace(this.binding.createSpatialAudio ?? null, theater?.speakers ?? null,
      this.binding.camera, source ?? this.screen.group, this.binding.audioQuality?.() ?? 'light');
    this.audio.setCinema(cinema?.createAudio ?? null);
    this.updateAudioModes();
    this.syncSharedAudio();
  }

  update(viewer: PerspectiveCamera, frame?: XRFrame): void {
    if (frame && this.pendingXRSummon) {
      this.pendingXRSummon = false;
      this.setScreenVisible(true, viewer);
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
    this.audio.setWorldQuality(this.binding.audioQuality?.() ?? 'light');
    this.audio.update(viewer, soundSource ?? this.screen.group);
    if (this.audioMode.value !== this.audio.getMode() || this.audioCapabilities !== this.audioCapabilityState()) {
      this.updateAudioModes();
    }
    if (!this.panel.hidden) this.updateAudioStatus();
  }

  release(): void {
    this.releaseDesktopGrab();
    this.finishDrag();
    this.measurement?.abort();
    this.receiver.disconnect();
    this.audio.stop();
    this.theater?.cinema?.project(null);
    this.xr.release();
  }

  dispose(): void {
    this.release();
    this.events.abort();
    this.unsubscribeXR();
    this.xr.dispose();
    this.audio.dispose();
    this.screen.dispose();
    this.screen.group.removeFromParent();
    this.panel.remove();
    this.video.remove();
  }

  private setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.binding.toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      this.releaseDesktopGrab();
      this.binding.releaseInput();
    } else this.setEditing(false);
  }

  private releaseDesktopGrab(): void {
    this.binding.releaseDesktopGrab?.(this.grabTarget);
  }

  private resetScreen(camera: PerspectiveCamera): void {
    this.releaseDesktopGrab();
    this.screen.reset(camera);
    this.placed = true;
  }

  private setScreenVisible(visible: boolean, camera = this.binding.camera): void {
    if (!visible) this.releaseDesktopGrab();
    if (visible && this.screen.isFloating && !this.placed) this.resetScreen(camera);
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

  private updateDisplayTarget(visible: boolean, updateAudio = true): void {
    this.releaseDesktopGrab();
    const target = this.displayTarget.value === 'television' ? this.theater : null;
    this.screen.setTarget(target?.screen ?? null, Boolean(target?.cinema));
    this.setScreenVisible(visible);
    if (updateAudio) {
      this.updateAudioModes();
      this.syncSharedAudio();
    }
  }

  private updateAudioModes(): void {
    const canSpatialize = this.audio.supportsSpatial();
    const floating = this.screen.isFloating;
    const surround = this.audio.supportsSurround();
    const cinema = this.audio.supportsCinema();
    this.audioCapabilities = this.audioCapabilityState();
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
    this.audioMode.value = this.audio.getMode();
  }

  private audioCapabilityState(): number {
    return (this.audio.supportsSpatial() ? 1 : 0) | (this.audio.supportsSurround() ? 2 : 0)
      | (this.audio.supportsCinema() ? 4 : 0);
  }

  private setXRPresentation(presenting: boolean): void {
    if (presenting) {
      this.releaseDesktopGrab();
      this.panelOpenOnExit = !this.panel.hidden;
      this.setOpen(false);
      this.pendingXRSummon = this.summonOnEntry && !this.screen.isVisible
        && (this.screen.isFloating || !this.theater?.cinema);
      if (this.pendingXRSummon) this.placed = false;
    } else {
      this.pendingXRSummon = false;
      this.setOpen(this.panelOpenOnExit);
    }
  }

  private setEditing(editing: boolean): void {
    if (this.editing === editing) return;
    if (editing) this.releaseDesktopGrab();
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
    this.measureVideo.disabled = !!this.measurement || state.phase !== 'connected';
    this.connectButton.textContent = active ? '切断' : '接続';
    this.verification.hidden = !state.verification;
    this.verification.textContent = state.verification ?? '';
    this.verification.setAttribute('aria-label', '配信元と照合する確認番号');
    if (state.phase === 'ended' || state.phase === 'failed') {
      this.measurement?.abort();
      this.measurement = undefined;
      this.measureVideo.disabled = true;
      this.measureVideo.textContent = '映像の滑らかさを計測';
      this.videoStatistics.textContent = '';
      this.audioPlayback = 'off';
      this.audioStart = null;
      this.audio.stop();
    }
    this.syncSharedAudio();
    this.updateAudioModes();
    this.updateAudioStatus();
  }

  private syncSharedAudio(): void {
    const { available, output } = this.state.audio;
    const cinema = this.theater?.cinema;
    const usesCinema = !this.screen.isFloating || this.audioMode.value === 'cinema';
    const videoPlaying = this.screen.isVisible && this.screen.projectedTexture !== null;
    this.audio.setEnabled(this.audioPlayback === 'on' && available && output !== 'pc'
      && (!cinema || !usesCinema || (!cinema.paused() && videoPlaying)));
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
    const canPlay = phase === 'connected' && audio.available && audio.output !== 'pc' && audioStatus !== 'unavailable';
    const on = this.audioPlayback === 'on' && audioStatus === 'ready';
    let message = '';
    if (phase === 'connected') {
      if (!audio.available) message = '配信元から共有音声が取得されていません。';
      else if (audio.pcPlaybackSuppressed) message = '共有音声は停止中です。PC側の再生は配信元で共有対象を選び直すと再開します。';
      else if (audio.output === 'pc') message = '配信元で「PC側のみ」が選ばれているため、視聴側の音声は停止中です。';
      else if (audioStatus === 'unavailable') message = 'この視聴ブラウザで共有音声を再生できません。';
      else if (this.audioStart) message = '共有音声を開始しています。もう一度押すと取り消せます。';
      else if (this.audioPlayback === 'retry' || (this.audioPlayback === 'on' && !on)) {
        message = '共有音声を再生できません。「モニター音声」を押して再試行してください。';
      } else if (audio.output === 'viewer') message = '配信元で「VR側のみ」が選ばれています。';
      else if (on && this.audioMode.value === 'surround') message = 'ステレオ音源は左右のフロントスピーカーから再生します。';
    }
    if (this.audioStatus.textContent !== message) this.audioStatus.textContent = message;
    const pressed = String(canPlay && (on || this.audioStart !== null));
    if (this.audioButton.getAttribute('aria-pressed') !== pressed) this.audioButton.setAttribute('aria-pressed', pressed);
    let buttonState = on ? 'オン' : 'オフ';
    if (this.audioStart) buttonState = '開始待ち';
    if (phase === 'connected' && !canPlay) buttonState = '停止中';
    const label = `モニター音声 ${buttonState}`;
    if (this.audioButton.textContent !== label) this.audioButton.textContent = label;
    const disabled = !canPlay;
    if (this.audioButton.disabled !== disabled) this.audioButton.disabled = disabled;
  }

  private async measureVideoFrames(): Promise<void> {
    if (this.measurement || this.state.phase !== 'connected') return;
    const attempt = new AbortController();
    this.measurement = attempt;
    this.measureVideo.disabled = true;
    this.measureVideo.textContent = '3秒間計測しています…';
    this.videoStatistics.textContent = 'この画面を手前に置き、動きのある映像でお待ちください。';
    try {
      const result = await measureMonitorVideo(() => this.receiver.videoStats(), attempt.signal, this.video);
      if (!attempt.signal.aborted) this.videoStatistics.textContent = describeMonitorVideo(result);
    } catch {
      if (!attempt.signal.aborted) this.videoStatistics.textContent = '映像を計測できませんでした。接続とブラウザーの対応を確認してください。';
    } finally {
      if (this.measurement !== attempt) return;
      this.measurement = undefined;
      this.measureVideo.textContent = '映像の滑らかさを計測';
      this.measureVideo.disabled = !!this.measurement || this.state.phase !== 'connected';
    }
  }

  private bindPanel(volume: HTMLInputElement): void {
    const { signal } = this.events;
    const listen = { signal };
    this.measureVideo.addEventListener('click', () => void this.measureVideoFrames(), listen);
    this.displayTarget.addEventListener('change', () => this.updateDisplayTarget(true), listen);
    this.visibilityButton.addEventListener('click', () => this.setScreenVisible(!this.screen.isVisible), listen);
    this.editButton.addEventListener('click', () => this.setEditing(!this.editing), listen);
    this.resetButton.addEventListener('click', () => {
      this.finishDrag();
      this.resetScreen(this.binding.camera);
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
    this.audioMode.addEventListener('change', () => {
      const source = this.audioMode.value === 'television' ? this.theater?.screen : this.screen.group;
      this.audio.update(this.binding.camera, source ?? this.screen.group);
      this.audio.setMode(this.audioMode.value as MonitorAudioMode);
      this.audioMode.value = this.audio.getMode();
      this.syncSharedAudio();
    }, listen);
    this.audioButton.addEventListener('click', () => void this.toggleAudio(), listen);
    this.xrButton.addEventListener('click', () => {
      this.summonOnEntry = !this.xrSession;
      void this.explorationXR.session.toggle().finally(() => { this.summonOnEntry = false; });
    }, listen);
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
