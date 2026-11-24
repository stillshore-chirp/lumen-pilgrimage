import {
  NeutralToneMapping, PCFShadowMap, PerspectiveCamera, Vector3, WebGLRenderer, type Scene,
} from 'three';
import { CoastAudio } from './CoastAudio';
import { CoastControls, type CoastMovement, type CoastNavigation } from './CoastControls';
import type { MonitorTheater } from '../monitor/monitorObject';
import type { MonitorView } from '../monitor/monitorView';
import type { CoastBirdCue } from './coastBirdCue';
import { EXPLORATION_WORLDS, findDestination, type ExplorationWorldId } from './coastDestinations';
import { decideTravel, readInitialExplorationState, urlForTime } from './explorationRoute';
import { createCoastTravelPanel } from './CoastTravelPanel';
import { CoastWorld, type CoastQuality } from './CoastWorld';
import { createResidenceControlPanel, type ResidenceControlSection } from './ResidenceControlPanel';
import type { CoastTimeOfDay } from './world/coastAtmosphere';
import { createCinemaPanel, type CinemaControls } from './world/cinema/CinemaPanel';
import { createCinemaSeatTransition } from './world/cinema/cinemaSeatTransition';
import './coast.css';

const qualitySettings = {
  light: 0.80,
  high: 1.75,
} satisfies Record<CoastQuality, number>;
const FOV_STORAGE_KEY = 'lumen-pilgrimage:fov';

const movementLabels: Record<CoastMovement, string> = {
  walk: '歩行', crouch: 'しゃがみ', wade: '浅瀬', swim: '遊泳', dive: '潜水', flight: '自由飛行',
};

interface ExplorationWorld {
  readonly scene: Scene;
  readonly theater?: MonitorTheater;
  setQuality(quality: CoastQuality): void;
  setTimeOfDay(time: CoastTimeOfDay): void;
  update(elapsed: number, camera: PerspectiveCamera): readonly CoastBirdCue[];
  prepareRender?(renderer: WebGLRenderer, camera: PerspectiveCamera): void;
  diveObstacleHeight?(x: number, z: number): number | undefined;
  dispose(): void;
}

type ExplorationAudio = Pick<CoastAudio, 'start' | 'isOn' | 'setLevel' | 'update' | 'dispose'> & {
  setTimeOfDay?(time: CoastTimeOfDay): void;
};

interface ExplorationAudioControls {
  startForPreview(): Promise<void>;
  sync(): void;
  dispose(): void;
}

interface ExplorationInteraction {
  label(position: Vector3, facing: Vector3): string | null;
  invoke(): void | { readonly openSection: string };
}

export interface ExplorationScene {
  readonly id: Exclude<ExplorationWorldId, 'coast'>;
  readonly world: ExplorationWorld;
  readonly navigation: CoastNavigation;
  readonly audio: ExplorationAudio;
  readonly interaction?: ExplorationInteraction;
  readonly residenceControls?: readonly ResidenceControlSection[];
  readonly cinemaControls?: CinemaControls;
}

export class CoastApp {
  private readonly renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly world: ExplorationWorld;
  private readonly worldId: ExplorationWorldId;
  private readonly audio: ExplorationAudio;
  private readonly audioControls: ExplorationAudioControls;
  private readonly camera: PerspectiveCamera;
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private readonly controls: CoastControls;
  private readonly travel: ReturnType<typeof createCoastTravelPanel>;
  private readonly travelDialog: HTMLDialogElement;
  private readonly resize: ResizeObserver;
  private readonly interaction?: ExplorationInteraction;
  private readonly interactionButton?: HTMLButtonElement;
  private readonly residencePanel?: ReturnType<typeof createResidenceControlPanel>;
  private readonly cinemaPanel?: ReturnType<typeof createCinemaPanel>;
  private monitor?: MonitorView;
  private readonly seatTransition?: ReturnType<typeof createCinemaSeatTransition>;
  private time: CoastTimeOfDay;
  private quality: CoastQuality = 'light';
  private lastFrame = 0;
  private elapsed = 0;
  private disposed = false;

  constructor(private readonly mount: HTMLElement, loaded?: ExplorationScene) {
    this.worldId = loaded?.id ?? 'coast';
    const initialRoute = readInitialExplorationState(this.worldId, location.search);
    const description = EXPLORATION_WORLDS.find(({ id }) => id === this.worldId)!;
    const overlook = this.worldId === 'overlook';
    const residence = this.worldId === 'residence';
    const cinema = this.worldId === 'cinema';
    this.world = loaded?.world ?? new CoastWorld();
    if (cinema) this.seatTransition = createCinemaSeatTransition(this.world.scene);
    this.audio = loaded?.audio ?? new CoastAudio();
    this.interaction = loaded?.interaction;
    this.camera = overlook ? new PerspectiveCamera(54, 1, 0.20, 43500)
      : new PerspectiveCamera(60, 1, residence || cinema ? 0.08 : 0.12, residence ? 43500 : cinema ? 110 : 2500);
    this.time = initialRoute.time;
    const destination = findDestination(this.worldId, initialRoute.placeId);
    this.world.setTimeOfDay(this.time);
    this.audio.setTimeOfDay?.(this.time);
    this.mount.classList.add('coast');
    if (cinema) this.mount.classList.add('coast-cinema');
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.className = 'coast-view';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', residence || cinema ? `${description.label}の探索画面`
      : overlook ? '丘陵の展望デッキの探索画面' : '海岸、森、湖と山の探索画面');

    const ui = document.createElement('div');
    ui.className = 'coast-ui';
    ui.innerHTML = `
      <header class="coast-header">
        <div class="coast-title">
          <h1></h1>
          <span class="coast-mode">歩行</span>
        </div>
        <div class="coast-header-actions"></div>
      </header>
      <div class="coast-reticle" aria-hidden="true"></div>
      <div class="coast-dock">
        <section class="coast-panel coast-guide" aria-label="探索操作">
          <div class="coast-row">
            <button type="button" class="coast-lock">マウス操作を開始</button>
            <button type="button" class="coast-flight" aria-pressed="false">自由飛行</button>
          </div>
          <details>
            <summary>操作方法</summary>
            <p class="coast-guide-description"></p>
            <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動 <span class="coast-divider">·</span> <kbd>Shift</kbd> 加速</p>
            <p>マウス 視点 <span class="coast-divider">·</span> <kbd>Esc</kbd> 解除</p>
            <p class="coast-jump-guide">地上で <kbd>Space</kbd> ジャンプ</p>
            <p><kbd>C</kbd> ${cinema ? '座位／立位' : 'しゃがむ／立つ'}</p>
            <p class="coast-water-guide">泳いでいるとき <kbd>C</kbd> 潜る <kbd>Space</kbd> 浮上</p>
            <p><kbd>T</kbd> ファストトラベル</p>
            <p class="coast-flight-guide"><kbd>F</kbd> 歩行／飛行 <span class="coast-divider">·</span> 飛行中 <kbd>Space</kbd> 上昇 <kbd>C</kbd> 下降</p>
            <details>
              <summary>ゲームパッド</summary>
              <p>左スティック 移動 <span class="coast-divider">·</span> 右スティック 視点</p>
              <p class="coast-flight-guide"><kbd>A</kbd> ジャンプ <span class="coast-divider">·</span> <kbd>Y</kbd> 歩行／飛行</p>
              <p class="coast-water-guide">泳いでいるとき <kbd>B</kbd> 潜る <kbd>A</kbd> 浮上</p>
              <p class="coast-flight-guide">飛行中 <kbd>A</kbd> 上昇 <kbd>B</kbd> 下降</p>
            </details>
          </details>
          <p class="coast-lock-message" role="status" hidden></p>
        </section>
        <section class="coast-panel coast-settings" aria-label="設定">
          <div class="coast-row" role="group" aria-label="描画品質">
            <span class="coast-label">描画</span>
            <button type="button" class="coast-light" aria-pressed="true" title="広域の影と軽い植生描画">軽量</button>
            <button type="button" class="coast-high" aria-pressed="false" title="細かな木漏れ日、地表の凹凸と手前の下草">高品質</button>
          </div>
          <div class="coast-row coast-view-settings">
            <label class="coast-label" for="coast-fov">視野角</label>
            <input id="coast-fov" type="range" min="40" max="95" step="1">
            <span class="coast-fov-value" aria-hidden="true"></span>
            <button type="button" class="coast-fov-reset">既定に戻す</button>
          </div>
          <div class="coast-row coast-sound">
            <button type="button" class="coast-audio">環境音をオン</button>
            <label class="coast-volume">音量 <input type="range" min="0" max="100" step="1" value="70"></label>
          </div>
          <p class="coast-audio-message" role="status"></p>
        </section>
      </div>
    `;
    ui.querySelector('h1')!.textContent = loaded ? description.label : '自然景観探索';
    ui.querySelector('.coast-guide-description')!.textContent = cinema
      ? 'ファストトラベルで席を選べます。上映設定から試映、仮想モニターからスクリーンへ投影できます。'
      : residence
      ? '南の大窓から都心を見下ろせます。主寝室のバルコニーに近づくと、Eキーで引戸を開閉できます。'
      : overlook
      ? '南のデッキから盆地の市街地を見渡せます。東側の階段から2階展望デッキへ上がれます。'
      : '海に向かって左は岩浜、右は潮だまり。浜を背にすると森の入口に休憩所があり、道は湖と稜線へ続きます。';
    if (loaded) {
      ui.querySelectorAll('.coast-water-guide').forEach(node => node.remove());
      ui.querySelector('.coast-light')!.setAttribute('title', '広域の影と軽い描画');
      ui.querySelector('.coast-high')!.setAttribute('title', '近くの影と細かな描画');
    }
    if (loaded?.navigation.jumpEnabled === false) {
      ui.querySelectorAll('.coast-jump-guide').forEach(node => node.remove());
    }
    if (loaded?.navigation.flightEnabled === false) {
      ui.querySelectorAll('.coast-flight-guide').forEach(node => node.remove());
    }
    this.mount.append(canvas, ui);

    const mode = ui.querySelector<HTMLElement>('.coast-mode')!;
    const lock = ui.querySelector<HTMLButtonElement>('.coast-lock')!;
    const flight = ui.querySelector<HTMLButtonElement>('.coast-flight')!;
    flight.hidden = loaded?.navigation.flightEnabled === false;
    const lockMessage = ui.querySelector<HTMLElement>('.coast-lock-message')!;
    this.controls = new CoastControls(this.camera, canvas, {
      diveObstacleHeight: (x, z) => this.world.diveObstacleHeight?.(x, z),
      onMovementChange: movement => {
        mode.textContent = cinema && movement === 'crouch' ? '座位' : movementLabels[movement];
        flight.setAttribute('aria-pressed', String(movement === 'flight'));
      },
      onLockChange: locked => {
        this.mount.classList.toggle('coast-locked', locked);
        if (locked) lockMessage.hidden = true;
      },
      onLockError: () => {
        lockMessage.hidden = false;
        lockMessage.textContent = '視点操作を開始できませんでした。もう一度ボタンを押してください。';
      },
    }, loaded?.navigation);
    if (destination) this.controls.relocate(destination);
    const lockView = () => {
      if (!this.monitor?.blocksSceneInput) this.controls.requestLock();
    };
    lock.addEventListener('click', lockView);
    canvas.addEventListener('click', lockView);
    flight.addEventListener('click', () => {
      this.controls.toggleFlight();
      canvas.focus({ preventScroll: true });
    });

    this.travel = createCoastTravelPanel({
      worlds: EXPLORATION_WORLDS, worldId: this.worldId, time: this.time, showTime: !cinema,
      onOpen: () => {
        this.monitor?.closePanel();
        this.controls.releaseInput();
      },
      onTravel: (worldId, placeId) => this.goTo(worldId, placeId),
      onTimeOfDay: time => this.setTimeOfDay(time),
    });
    this.travel.setPlace(this.worldId, destination?.id ?? description.places[0].id);
    this.travelDialog = this.travel.element.querySelector('dialog')!;
    const actions = ui.querySelector('.coast-header-actions')!;
    actions.prepend(this.travel.element);
    this.bindMonitor(actions);
    this.audioControls = this.bindAudio(ui, this.audio);
    if (loaded?.cinemaControls) {
      this.cinemaPanel = createCinemaPanel(loaded.cinemaControls, () => {
        this.monitor?.closePanel();
        this.controls.releaseInput();
      }, this.audioControls.startForPreview);
      actions.append(this.cinemaPanel.element);
    }
    if (loaded?.residenceControls?.length) {
      this.residencePanel = createResidenceControlPanel(loaded.residenceControls, () => {
        this.monitor?.closePanel();
        this.controls.releaseInput();
      });
      actions.append(this.residencePanel.element);
    }
    if (this.interaction) {
      this.interactionButton = document.createElement('button');
      this.interactionButton.type = 'button';
      this.interactionButton.className = 'coast-interact';
      this.interactionButton.hidden = true;
      this.interactionButton.setAttribute('aria-keyshortcuts', 'E');
      this.interactionButton.addEventListener('click', () => {
        if (this.invokeInteraction() && !this.residencePanel?.dialog.open) canvas.focus({ preventScroll: true });
      });
      ui.append(this.interactionButton);
    }
    window.addEventListener('keydown', this.onSceneKey);

    this.bindQuality(ui);
    this.bindFieldOfView(ui);
    this.resize = new ResizeObserver(() => this.resizeViewport());
    this.resize.observe(this.mount);
    this.resizeViewport();
    this.renderer.setAnimationLoop(this.render);
    window.addEventListener('pagehide', this.onPageHide);
  }

  private readonly onSceneKey = (event: KeyboardEvent): void => {
    if ((event.code !== 'KeyT' && event.code !== 'KeyE') || event.repeat
      || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.sceneDialogOpen() || (event.target instanceof Element
      && event.target.closest('input, textarea, select, [contenteditable]'))) return;
    if (event.code === 'KeyT') {
      event.preventDefault();
      this.travel.open();
    } else if (this.invokeInteraction()) {
      event.preventDefault();
    }
  };

  private interactionLabel(): string | null {
    if (this.sceneDialogOpen() || this.monitor?.blocksSceneInput) return null;
    return this.interaction?.label(this.camera.position, this.camera.getWorldDirection(this.forward)) ?? null;
  }

  private invokeInteraction(): boolean {
    if (!this.interaction || !this.interactionLabel()) return false;
    const action = this.interaction.invoke();
    if (action && 'openSection' in action) this.residencePanel?.open(action.openSection, this.renderer.domElement);
    return true;
  }

  private sceneDialogOpen(): boolean {
    return this.travelDialog.open || this.residencePanel?.dialog.open === true || this.cinemaPanel?.dialog.open === true;
  }

  private goTo(worldId: string, placeId: string): void {
    const decision = decideTravel({
      href: location.href,
      currentWorldId: this.worldId,
      targetWorldId: worldId,
      destination: findDestination(worldId, placeId),
      time: this.time,
    });
    if (decision.kind === 'invalid') return;
    if (decision.kind === 'navigate') {
      location.assign(decision.url);
      return;
    }
    const relocate = () => {
      this.controls.relocate(decision.destination);
      this.monitor?.relocateViewer();
      this.travel.setPlace(worldId, placeId);
      history.replaceState(null, '', decision.url);
    };
    if (!this.seatTransition || (!this.renderer.xr.isPresenting && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      relocate();
      return;
    }
    this.controls.releaseInput();
    this.seatTransition.start(relocate);
  }

  private setTimeOfDay(time: CoastTimeOfDay): void {
    this.time = time;
    this.world.setTimeOfDay(time);
    this.audio.setTimeOfDay?.(time);
    this.travel.setTimeOfDay(time);
    history.replaceState(null, '', urlForTime(location.href, time));
  }

  private bindMonitor(actions: Element): void {
    const entry = document.createElement('div');
    entry.className = 'coast-travel-panel monitor-entry';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = '仮想モニター';
    toggle.setAttribute('aria-expanded', 'false');
    entry.append(toggle);
    actions.append(entry);
    toggle.addEventListener('click', async () => {
      if (this.monitor) {
        this.monitor.togglePanel();
        return;
      }
      toggle.disabled = true;
      try {
        const { MonitorView } = await import('../monitor/monitorView');
        if (this.disposed) return;
        this.monitor = new MonitorView({
          entry, toggle, renderer: this.renderer, scene: this.world.scene, camera: this.camera,
          eyeHeight: () => this.controls.eyeHeight, releaseInput: () => this.controls.releaseInput(),
        });
        this.monitor.setTheater(this.world.theater ?? null);
        toggle.setAttribute('aria-controls', 'monitor-view-panel');
      } catch {
        toggle.textContent = '仮想モニターを再読み込み';
      } finally {
        toggle.disabled = false;
      }
    });
  }

  private bindQuality(ui: HTMLElement): void {
    const light = ui.querySelector<HTMLButtonElement>('.coast-light')!;
    const high = ui.querySelector<HTMLButtonElement>('.coast-high')!;
    if (this.worldId === 'residence') {
      light.title = '標準の影と反射';
      high.title = '家具が床に落とす細かい影と、床に映る窓や室内';
    }
    if (this.worldId === 'cinema') {
      light.title = '客席の形を維持し、映写の反射と初期反射を軽く処理';
      high.title = '張り地、近くの反射光、頭部に追従する反射音を細かく処理';
    }
    const apply = (quality: CoastQuality) => {
      this.quality = quality;
      this.world.setQuality(quality);
      this.resizeViewport();
      light.setAttribute('aria-pressed', String(quality === 'light'));
      high.setAttribute('aria-pressed', String(quality === 'high'));
    };
    light.addEventListener('click', () => apply('light'));
    high.addEventListener('click', () => apply('high'));
    apply('light');
  }

  private bindFieldOfView(ui: HTMLElement): void {
    const slider = ui.querySelector<HTMLInputElement>('#coast-fov')!;
    const value = ui.querySelector<HTMLElement>('.coast-fov-value')!;
    const reset = ui.querySelector<HTMLButtonElement>('.coast-fov-reset')!;
    const defaultFov = this.camera.fov;
    let initialFov = defaultFov;
    try {
      const saved = Number(window.localStorage.getItem(FOV_STORAGE_KEY));
      if (Number.isInteger(saved) && saved >= Number(slider.min) && saved <= Number(slider.max)) initialFov = saved;
    } catch {
      // Storage can be unavailable in restricted browser contexts.
    }

    const apply = (fov: number) => {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      slider.valueAsNumber = fov;
      slider.setAttribute('aria-valuetext', `${fov}度`);
      value.textContent = `${fov}°`;
    };
    const save = (fov: number | null) => {
      try {
        if (fov === null) window.localStorage.removeItem(FOV_STORAGE_KEY);
        else window.localStorage.setItem(FOV_STORAGE_KEY, String(fov));
      } catch {
        // Adjustments remain available for the current page.
      }
    };
    slider.addEventListener('input', () => apply(slider.valueAsNumber));
    slider.addEventListener('change', () => save(slider.valueAsNumber));
    reset.addEventListener('click', () => {
      apply(defaultFov);
      save(null);
    });
    apply(initialFov);
  }

  private bindAudio(ui: HTMLElement, audio: ExplorationAudio): ExplorationAudioControls {
    const start = ui.querySelector<HTMLButtonElement>('.coast-audio')!;
    const volume = ui.querySelector<HTMLInputElement>('.coast-volume input')!;
    const message = ui.querySelector<HTMLElement>('.coast-audio-message')!;
    let muted = false;
    let pending = false;
    let disposed = false;
    let pendingStart: Promise<boolean> | undefined;
    const setLevel = () => audio.setLevel(volume.valueAsNumber / 100, muted);
    const sync = () => {
      if (disposed) return;
      const on = audio.isOn();
      const label = on ? '環境音をオフ' : '環境音をオン';
      if (start.textContent !== label) start.textContent = label;
      if (start.disabled !== pending) start.disabled = pending;
    };
    setLevel();
    async function startAudio(): Promise<boolean> {
      if (disposed) return false;
      if (pendingStart) return pendingStart;
      pending = true;
      message.textContent = '環境音を準備しています。';
      sync();
      let request: Promise<void>;
      try {
        // Invoke resume synchronously while the click still carries user activation.
        request = audio.start();
      } catch {
        request = Promise.reject(new Error('Audio start failed'));
      }
      const operation = request.then(() => {
        if (disposed) return false;
        message.textContent = audio.isOn() || muted
          ? ''
          : '環境音を開始できませんでした。もう一度ボタンを押してください。';
        return true;
      }).catch(() => {
        if (disposed) return false;
        message.textContent = '環境音を開始できませんでした。もう一度ボタンを押してください。';
        return false;
      }).finally(() => {
        pending = false;
        pendingStart = undefined;
        sync();
      });
      pendingStart = operation;
      return operation;
    }
    const toggleAudio = () => {
      if (disposed || pending) return;
      if (audio.isOn()) {
        muted = true;
        setLevel();
        message.textContent = '';
        sync();
        return;
      }
      void startAudio().then(started => {
        if (!started || disposed) return;
        muted = false;
        setLevel();
        message.textContent = audio.isOn()
          ? ''
          : '環境音を開始できませんでした。もう一度ボタンを押してください。';
        sync();
      });
    };
    const changeVolume = () => {
      if (disposed) return;
      setLevel();
      sync();
    };
    const startForPreview = async () => { await startAudio(); };
    start.addEventListener('click', toggleAudio);
    volume.addEventListener('input', changeVolume);
    sync();
    return {
      startForPreview,
      sync,
      dispose() {
        disposed = true;
        start.removeEventListener('click', toggleAudio);
        volume.removeEventListener('input', changeVolume);
        start.disabled = true;
      },
    };
  }

  private resizeViewport(): void {
    if (this.renderer.xr.isPresenting) return;
    const width = Math.max(1, this.mount.clientWidth);
    const height = Math.max(1, this.mount.clientHeight);
    const resolution = qualitySettings[this.quality];
    const pixelRatio = this.quality === 'light'
      ? Math.min(window.devicePixelRatio, 1) * resolution
      : Math.min(window.devicePixelRatio, resolution);
    if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private readonly render = (now: number, frame?: XRFrame): void => {
    const dt = this.lastFrame === 0 ? 0 : Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.elapsed += dt;
    this.audioControls.sync();
    if (!this.sceneDialogOpen() && !this.monitor?.blocksSceneInput
      && !this.seatTransition?.active) this.controls.update(dt);
    this.seatTransition?.update(dt);
    const viewer = this.monitor?.update(frame) ?? this.camera;
    const birdCues = this.world.update(this.elapsed, viewer);
    this.residencePanel?.sync();
    if (this.cinemaPanel?.dialog.open) this.cinemaPanel.sync();
    if (this.interactionButton) {
      const label = this.interactionLabel();
      this.interactionButton.hidden = !label;
      if (label && label !== this.interactionButton.textContent) this.interactionButton.textContent = label;
    }
    viewer.getWorldDirection(this.forward);
    this.up.copy(viewer.up).applyQuaternion(viewer.quaternion);
    const movement = this.controls.currentMovement;
    this.audio.update(viewer.position, this.forward, this.up, this.elapsed,
      viewer !== this.camera && movement === 'crouch' ? 'walk' : movement, birdCues);
    const view = this.monitor?.renderCamera ?? this.camera;
    this.world.prepareRender?.(this.renderer, view);
    this.renderer.render(this.world.scene, view);
  };

  private readonly onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) {
      this.monitor?.release();
      return;
    }
    this.disposed = true;
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('keydown', this.onSceneKey);
    this.renderer.setAnimationLoop(null);
    this.audioControls.dispose();
    this.seatTransition?.dispose();
    this.resize.disconnect();
    this.monitor?.dispose();
    this.controls.dispose();
    this.audio.dispose();
    this.world.dispose();
    this.renderer.dispose();
  };
}
