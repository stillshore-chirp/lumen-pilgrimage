import {
  NeutralToneMapping, PCFShadowMap, PerspectiveCamera, Vector3, WebGLRenderer, type Scene,
} from 'three';
import { CoastAudio } from './CoastAudio';
import { CoastXR } from './CoastXR';
import type { ImmersiveMenuItem } from '../xr/ImmersiveMenu';
import { renderImmersiveStatus } from '../xr/ImmersiveSession';
import { CoastControls, type CoastMovement, type CoastNavigation } from './CoastControls';
import type { MonitorTheater } from '../monitor/monitorObject';
import type { MonitorView, MonitorViewBinding } from '../monitor/monitorView';
import type { CoastBirdCue } from './coastBirdCue';
import { EXPLORATION_WORLDS, findDestination, type ExplorationWorldId } from './coastDestinations';
import { decideTravel, parseStartupRoute, readInitialExplorationState, urlForTime } from './explorationRoute';
import { bindCoastSoundControls } from './CoastSoundControls';
import { createCoastTravelPanel } from './CoastTravelPanel';
import { CoastWorld, type CoastQuality } from './CoastWorld';
import { createResidenceControlPanel, type ResidenceControl, type ResidenceControlSection } from './ResidenceControlPanel';
import type { CoastTimeOfDay } from './world/coastAtmosphere';
import { cinemaLightingModes, createCinemaPanel, type CinemaControls } from './world/cinema/CinemaPanel';
import { createCinemaSeatTransition } from './world/cinema/cinemaSeatTransition';
import { disposeSceneDrawables } from './disposeSceneDrawables';
import { bindWorldLightingControl, worldLightingChoices, type WorldLightingControl } from './WorldLightingControl';
import './coast.css';

const qualitySettings = {
  light: 0.80,
  high: 1.75,
} satisfies Record<CoastQuality, number>;
const FOV_STORAGE_KEY = 'lumen-pilgrimage:fov';

const movementLabels: Record<CoastMovement, string> = {
  walk: '歩行', crouch: 'しゃがみ', wade: '浅瀬', swim: '遊泳', dive: '潜水', flight: '自由飛行',
};

interface ExplorationWorld extends WorldLightingControl {
  readonly scene: Scene;
  readonly theater?: MonitorTheater;
  setQuality(quality: CoastQuality): void;
  setTimeOfDay(time: CoastTimeOfDay): void;
  update(elapsed: number, camera: PerspectiveCamera): readonly CoastBirdCue[];
  prepareRender?(renderer: WebGLRenderer, camera: PerspectiveCamera): void;
  diveObstacleHeight?(x: number, z: number): number | undefined;
  dispose(): void;
}

type ExplorationAudio = Pick<CoastAudio, 'start' | 'isRunning' | 'setMix' | 'dispose'> & {
  update(position: Vector3, forward: Vector3, up: Vector3, elapsed: number, movement: CoastMovement,
    birdCues: readonly CoastBirdCue[], grounded: boolean, navigationPosition: Vector3): void;
  setTimeOfDay?(time: CoastTimeOfDay): void;
};

interface ExplorationInteraction {
  label(position: Vector3, facing: Vector3): string | null;
  invoke(): void | { readonly openSection: string };
}

export type ExplorationScene = {
  readonly world: ExplorationWorld;
  readonly audio: ExplorationAudio;
  readonly interaction?: ExplorationInteraction;
  readonly residenceControls?: readonly ResidenceControlSection[];
  readonly cinemaControls?: CinemaControls;
} & (
  | { readonly id: 'coast'; readonly navigation?: never }
  | { readonly id: Exclude<ExplorationWorldId, 'coast'>; readonly navigation: CoastNavigation }
);

export async function loadExplorationScene(worldId: ExplorationWorldId): Promise<ExplorationScene> {
  switch (worldId) {
    case 'residence': return (await import('./world/residence/ResidenceWorld')).loadResidenceScene();
    case 'cinema': return (await import('./world/cinema/CinemaWorld')).loadCinemaScene();
    case 'overlook': return (await import('./world/overlook/OverlookWorld')).loadOverlookScene();
    case 'coast': return { id: 'coast', world: new CoastWorld(), audio: new CoastAudio() };
  }
}

function readHistoryIndex(state: unknown): number {
  if (state && typeof state === 'object' && 'coastWorldIndex' in state
    && typeof state.coastWorldIndex === 'number') return state.coastWorldIndex;
  return 0;
}

export class CoastApp {
  private readonly world: ExplorationWorld;
  private readonly worldId: ExplorationWorldId;
  private readonly pcVR: boolean;
  private readonly audio: ExplorationAudio;
  private readonly audioControls: ReturnType<typeof bindCoastSoundControls>;
  private readonly syncLightingControl: () => void;
  private readonly camera: PerspectiveCamera;
  private readonly canvasLabel: string;
  private readonly ui: HTMLElement;
  private readonly events = new AbortController();
  private readonly travelStatus = document.createElement('p');
  private readonly monitorBinding: MonitorViewBinding;
  private readonly xr: CoastXR;
  private readonly bindXRStatus: () => () => void;
  private unsubscribeXR?: () => void;
  private readonly lockView: () => void;
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
  private readonly cinemaControls?: CinemaControls;
  private readonly residenceControls: readonly ResidenceControlSection[];
  private loadingTravel = false;
  private showTravelStatusUntil = 0;
  private monitor?: MonitorView;
  private readonly seatTransition?: ReturnType<typeof createCinemaSeatTransition>;
  private time: CoastTimeOfDay;
  private quality: CoastQuality;
  private lastFrame = 0;
  private elapsed = 0;
  private disposed = false;
  private travelRequest = 0;
  private restoringHistory = false;

  constructor(
    private readonly mount: HTMLElement,
    loaded: ExplorationScene,
    private currentUrl = new URL(location.href),
    private readonly renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }),
    private currentHistoryIndex = readHistoryIndex(history.state),
    xr?: CoastXR,
    pcQuality?: CoastQuality,
  ) {
    this.worldId = loaded.id;
    this.pcVR = currentUrl.searchParams.get('vr') === 'pc';
    this.quality = this.pcVR ? pcQuality ?? 'high' : 'light';
    this.xr = xr ?? new CoastXR(this.renderer.xr);
    this.cinemaControls = loaded.cinemaControls;
    this.residenceControls = loaded.residenceControls ?? [];
    const initialRoute = readInitialExplorationState(this.worldId, currentUrl.search);
    const description = EXPLORATION_WORLDS.find(({ id }) => id === this.worldId)!;
    const overlook = this.worldId === 'overlook';
    const residence = this.worldId === 'residence';
    const cinema = this.worldId === 'cinema';
    this.world = loaded.world;
    if (cinema) this.seatTransition = createCinemaSeatTransition(this.world.scene);
    this.audio = loaded.audio;
    this.interaction = loaded.interaction;
    this.camera = overlook ? new PerspectiveCamera(54, 1, 0.20, 43500)
      : new PerspectiveCamera(60, 1, residence || cinema ? 0.08 : 0.12, residence ? 43500 : cinema ? 110 : 2500);
    this.time = initialRoute.time;
    const destination = findDestination(this.worldId, initialRoute.placeId);
    this.world.setTimeOfDay(this.time);
    this.audio.setTimeOfDay?.(this.time);
    this.world.setQuality(this.quality);
    this.canvasLabel = residence || cinema ? `${description.label}の探索画面`
      : overlook ? '丘陵の展望デッキの探索画面' : '海岸、森、湖と山の探索画面';
    const canvas = this.renderer.domElement;

    const ui = this.ui = document.createElement('div');
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
            <p>地上で <kbd>Space</kbd> ジャンプ</p>
            <p><kbd>C</kbd> ${cinema ? '座位／立位' : 'しゃがむ／立つ'}</p>
            <p class="coast-water-guide">泳いでいるとき <kbd>C</kbd> 潜る <kbd>Space</kbd> 浮上</p>
            <p><kbd>T</kbd> ファストトラベル</p>
            <p><kbd>F</kbd> 歩行／飛行 <span class="coast-divider">·</span> 飛行中 <kbd>Space</kbd> 上昇 <kbd>C</kbd> 下降</p>
            <details>
              <summary>ゲームパッド</summary>
              <p>左スティック 移動 <span class="coast-divider">·</span> 右スティック 視点</p>
              <p><kbd>A</kbd> ジャンプ <span class="coast-divider">·</span> <kbd>Y</kbd> 歩行／飛行</p>
              <p class="coast-water-guide">泳いでいるとき <kbd>B</kbd> 潜る <kbd>A</kbd> 浮上</p>
              <p>飛行中 <kbd>A</kbd> 上昇 <kbd>B</kbd> 下降</p>
            </details>
          </details>
          <p class="coast-lock-message" role="status" hidden></p>
        </section>
        <section class="coast-panel coast-settings" aria-label="設定">
          <div class="coast-row coast-world-lighting" role="group" aria-label="ワールド照明">
            <span class="coast-label">照明</span>
          </div>
          <div class="coast-row" role="group" aria-label="描画品質">
            <span class="coast-label">描画</span>
            <button type="button" class="coast-light" aria-pressed="${this.quality === 'light'}" title="広域の影と軽い植生描画">軽量</button>
            <button type="button" class="coast-high" aria-pressed="${this.quality === 'high'}" title="細かな木漏れ日、地表の凹凸と手前の下草">高品質</button>
          </div>
          <div class="coast-view-settings coast-setting-row">
            <label class="coast-label" for="coast-fov">視野角</label>
            <input id="coast-fov" type="range" min="40" max="95" step="1">
            <span class="coast-fov-value coast-setting-value" aria-hidden="true"></span>
            <button type="button" class="coast-fov-reset">既定に戻す</button>
          </div>
        </section>
      </div>
    `;
    ui.querySelector('h1')!.textContent = loaded.id === 'coast' ? '自然景観探索' : description.label;
    ui.querySelector('.coast-guide-description')!.textContent = cinema
      ? 'ファストトラベルで席を選べます。上映設定から試映、仮想モニターからスクリーンへ投影できます。'
      : residence
      ? '南の大窓から都心を見下ろせます。主寝室のバルコニーに近づくと、Eキーで引戸を開閉できます。'
      : overlook
      ? '南のデッキから盆地の市街地を見渡せます。東側の階段から2階展望デッキへ上がれます。'
      : '海に向かって左は岩浜、右は潮だまり。浜を背にすると森の入口に休憩所があり、道は湖と稜線へ続きます。';
    if (loaded.id !== 'coast') {
      ui.querySelectorAll('.coast-water-guide').forEach(node => node.remove());
      ui.querySelector('.coast-light')!.setAttribute('title', '広域の影と軽い描画');
      ui.querySelector('.coast-high')!.setAttribute('title', '近くの影と細かな描画');
    }

    const mode = ui.querySelector<HTMLElement>('.coast-mode')!;
    const lock = ui.querySelector<HTMLButtonElement>('.coast-lock')!;
    const flight = ui.querySelector<HTMLButtonElement>('.coast-flight')!;
    const lockMessage = ui.querySelector<HTMLElement>('.coast-lock-message')!;
    this.controls = new CoastControls(this.camera, canvas, {
      diveObstacleHeight: (x, z) => this.world.diveObstacleHeight?.(x, z),
      onMovementChange: movement => {
        mode.textContent = cinema && movement === 'crouch' ? '座位' : movementLabels[movement];
        flight.setAttribute('aria-pressed', String(movement === 'flight'));
      },
      onLockChange: locked => {
        if (ui.isConnected) this.mount.classList.toggle('coast-locked', locked);
        if (locked) lockMessage.hidden = true;
      },
      onLockError: () => {
        lockMessage.hidden = false;
        lockMessage.textContent = '視点操作を開始できませんでした。もう一度ボタンを押してください。';
      },
    }, loaded.navigation);
    if (destination) this.controls.relocate(destination);
    this.lockView = () => {
      if (!this.renderer.xr.isPresenting && !this.monitor?.blocksSceneInput) this.controls.requestLock();
    };
    lock.addEventListener('click', this.lockView);
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
    const vr = document.createElement('div');
    vr.className = 'coast-travel-panel coast-xr-entry';
    vr.innerHTML = '<button type="button" disabled aria-describedby="coast-xr-status">VRを開始</button>'
      + '<p class="coast-panel coast-xr-status" id="coast-xr-status" role="status"></p>';
    actions.append(vr);
    const vrButton = vr.querySelector('button')!;
    const vrStatus = vr.querySelector('p')!;
    if (this.pcVR) {
      vrStatus.className = 'coast-pcvr-status';
      ui.querySelector('.coast-guide')!.append(vrStatus);
    }
    let recheck = false;
    vrButton.addEventListener('click', () => {
      if (recheck) void this.xr.session.checkSupport();
      else void this.xr.session.toggle();
    }, { signal: this.events.signal });
    this.bindXRStatus = () => this.xr.session.observe(status => {
      const unavailable = status.state === 'unavailable' && window.isSecureContext;
      recheck = this.pcVR && unavailable && Boolean(navigator.xr);
      renderImmersiveStatus(vrButton, vrStatus, status, unavailable ? 'VR非対応' : 'VRを開始', 'VRを終了');
      vrButton.title = unavailable && !this.pcVR ? status.message : '';
      vrStatus.hidden = status.state === 'presenting' || (!this.pcVR && (status.state === 'available' || unavailable));
      if (recheck) {
        vrButton.disabled = false;
        vrButton.textContent = 'VRの接続を再確認';
        vrStatus.textContent = 'Meta Horizon Link で Quest を接続し、OpenXR ランタイムを確認してから再確認してください。';
      } else if (this.pcVR && status.state === 'available') {
        vrStatus.textContent = 'Quest を Meta Horizon Link で接続したら、Windows の Chrome でこのページの「VRを開始」を押してください。';
      } else if (this.pcVR && status.state === 'error') {
        vrStatus.textContent = `${status.message} Windows の Meta Horizon Link で Quest を接続し、OpenXR ランタイムを確認してください。`;
      } else if (this.pcVR && unavailable) {
        vrStatus.textContent = `${status.message} Windows の Chrome でページを開いてください。`;
      }
    });
    this.travelStatus.className = 'coast-panel coast-travel-status';
    this.travelStatus.setAttribute('role', 'status');
    this.travelStatus.hidden = true;
    this.travel.element.append(this.travelStatus);
    this.audioControls = bindCoastSoundControls(
      ui.querySelector<HTMLElement>('.coast-settings')!, this.worldId, this.audio,
      master => this.monitor?.setMasterVolume(master),
    );
    if (loaded.cinemaControls) {
      this.cinemaPanel = createCinemaPanel(loaded.cinemaControls, () => {
        this.monitor?.closePanel();
        this.controls.releaseInput();
      }, this.audioControls.startForPreview);
      actions.append(this.cinemaPanel.element);
    }
    if (loaded.residenceControls?.length) {
      this.residencePanel = createResidenceControlPanel(loaded.residenceControls, () => {
        this.monitor?.closePanel();
        this.controls.releaseInput();
      });
      actions.append(this.residencePanel.element);
    }
    this.monitorBinding = this.bindMonitor(actions);
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
    this.syncLightingControl = bindWorldLightingControl(ui.querySelector<HTMLElement>('.coast-world-lighting')!, this.world);
    this.bindQuality(ui);
    this.bindFieldOfView(ui);
    this.resize = new ResizeObserver(() => this.resizeViewport());
  }

  start(previous?: CoastApp): void {
    const canvas = this.renderer.domElement;
    this.mount.classList.add('coast');
    this.mount.classList.toggle('coast-cinema', this.worldId === 'cinema');
    this.mount.classList.toggle('coast-locked', document.pointerLockElement === canvas);
    canvas.setAttribute('aria-label', this.canvasLabel);
    if (previous) {
      previous.ui.replaceWith(this.ui);
    } else {
      this.renderer.toneMapping = NeutralToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = PCFShadowMap;
      canvas.className = 'coast-view';
      canvas.tabIndex = 0;
      this.mount.replaceChildren(canvas, this.ui);
    }
    this.unsubscribeXR = this.bindXRStatus();
    this.xr.bind({
      scene: this.world.scene, camera: this.camera, controls: this.controls,
      openMenu: () => this.openXRMenu(),
      onMenuOpen: () => {
        this.monitor?.closePanel();
        this.monitor?.releaseGrab();
        this.controls.releaseInput();
      },
      interaction: viewer => this.interactionLabel(viewer),
      interact: viewer => this.invokeInteraction(viewer),
      blocking: () => this.sceneDialogOpen() || Boolean(this.seatTransition?.active)
        || Boolean(this.monitor?.isGrabbing) || this.loadingTravel,
      status: () => this.loadingTravel || performance.now() < this.showTravelStatusUntil
        ? this.travelStatus.textContent ?? '' : '',
    });
    this.resize.observe(this.mount);
    this.resizeViewport();
    if (previous) {
      this.monitor = previous.monitor;
      this.monitor?.rebind(this.monitorBinding, this.world.theater ?? null);
      this.monitor?.setMasterVolume(this.audioControls.masterVolume);
      previous.monitor = undefined;
      previous.disposeWorld();
      this.controls.releaseInput();
      canvas.focus({ preventScroll: true });
    }
    const listeners = { signal: this.events.signal };
    canvas.addEventListener('click', this.lockView, listeners);
    window.addEventListener('keydown', this.onSceneKey, listeners);
    window.addEventListener('popstate', this.onPopState, listeners);
    window.addEventListener('pagehide', this.onPageHide, listeners);
    window.addEventListener('pageshow', this.onPageShow, listeners);
    this.renderer.xr.addEventListener('sessionend', this.onXRSessionEnd);
    // Replacing the renderer loop during XR would also start the desktop animation loop.
    if (this.renderer.xr.isPresenting) this.renderer.xr.setAnimationLoop(this.render);
    else this.renderer.setAnimationLoop(this.render);
  }

  private readonly onXRSessionEnd = (): void => {
    this.lastFrame = 0;
    this.resizeViewport();
    this.renderer.setAnimationLoop(this.render);
  };

  private readonly onSceneKey = (event: KeyboardEvent): void => {
    if (this.renderer.xr.isPresenting || (event.code !== 'KeyT' && event.code !== 'KeyE') || event.repeat
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

  private interactionLabel(viewer = this.camera): string | null {
    if (this.sceneDialogOpen() || this.monitor?.blocksSceneInput) return null;
    return this.interaction?.label(viewer.position, viewer.getWorldDirection(this.forward)) ?? null;
  }

  private invokeInteraction(viewer = this.camera): boolean {
    if (!this.interaction || !this.interactionLabel(viewer)) return false;
    const action = this.interaction.invoke();
    if (action && 'openSection' in action) {
      if (viewer === this.camera) this.residencePanel?.open(action.openSection, this.renderer.domElement);
      else {
        const section = this.residenceControls.find(({ id }) => id === action.openSection);
        if (section) this.openXRResidenceSection(section);
      }
    }
    return true;
  }

  private openXRMenu(): void {
    const worlds = EXPLORATION_WORLDS.map(world => ({
      label: world.label,
      invoke: () => this.xr.openMenu(world.label, [
        ...world.places.map(place => ({
          label: place.label,
          invoke: () => { this.xr.closeMenu(); this.goTo(world.id, place.id); },
        })),
        { label: '探索メニューに戻る', invoke: () => this.openXRMenu() },
      ]),
    }));
    this.xr.openMenu('ファストトラベル', [
      ...worlds,
      { label: '設定', invoke: () => this.openXRSettings() },
      { label: 'VRを終了', invoke: () => void this.xr.session.stop() },
    ]);
  }

  private openXRSettings(): void {
    const world = this.world;
    const items: ImmersiveMenuItem[] = [
      { label: () => this.audioControls.environmentLabel, invoke: () => this.audioControls.toggleEnvironment() },
      { label: () => this.audioControls.footstepsLabel, invoke: () => this.audioControls.toggleFootsteps() },
    ];
    if (this.worldId !== 'cinema') items.push(
      { label: () => this.time === 'day' ? '昼（選択中）' : '昼', invoke: () => this.setTimeOfDay('day') },
      { label: () => this.time === 'night' ? '夜（選択中）' : '夜', invoke: () => this.setTimeOfDay('night') },
    );
    items.push({
      label: 'ワールド照明',
      invoke: () => this.xr.openMenu(world.artificialLightingUnavailableReason ?? 'ワールド照明', [
        ...worldLightingChoices.map(({ mode, label }) => ({
          label: () => world.artificialLightingMode === mode ? `${label}（選択中）` : label,
          enabled: () => world.artificialLightingUnavailableReason === undefined,
          invoke: () => world.setArtificialLightingMode(mode),
        })),
        { label: '設定に戻る', invoke: () => this.openXRSettings() },
      ]),
    });
    const monitor = this.monitor;
    if (monitor) items.push({
      label: '仮想モニター',
      invoke: () => this.xr.openMenu('仮想モニター', [
        {
          label: () => monitor.displayActionLabel,
          invoke: () => { monitor.toggleDisplayInXR(); this.xr.closeMenu(); },
        },
        {
          label: '視界の前に置き直す', enabled: () => monitor.canSetFloatingPose,
          invoke: () => { monitor.resetDisplayInXR(); this.xr.closeMenu(); },
        },
        {
          label: () => monitor.audioActionLabel, enabled: () => monitor.canToggleAudio,
          invoke: () => void monitor.toggleAudio(),
        },
        { label: '設定に戻る', invoke: () => this.openXRSettings() },
      ]),
    });
    const cinema = this.cinemaControls;
    if (cinema) items.push({
      label: '上映設定',
      invoke: () => this.xr.openMenu('上映設定', [
        ...cinemaLightingModes.map(([mode, label]) => ({
          label: () => cinema.mode === mode ? `${label}（選択中）` : label,
          invoke: () => cinema.setMode(mode),
        })),
        {
          label: () => cinema.samplePlaying ? '試映を停止' : '試映を再生',
          enabled: () => cinema.canStartSample || cinema.samplePlaying,
          invoke: () => {
            cinema.toggleSample();
            if (cinema.samplePlaying) {
              void this.audioControls.startForPreview();
              this.xr.closeMenu();
            }
          },
        },
        { label: '設定に戻る', invoke: () => this.openXRSettings() },
      ]),
    });
    items.push({ label: '探索メニューに戻る', invoke: () => this.openXRMenu() });
    this.xr.openMenu('設定', items);
  }

  private openXRResidenceSection(section: ResidenceControlSection): void {
    const items = section.controls.flatMap<ImmersiveMenuItem>(control => this.residenceXRItem(section, control));
    this.xr.openMenu(section.title, [...items, { label: '閉じる', invoke: () => this.xr.closeMenu() }]);
  }

  private residenceXRItem(section: ResidenceControlSection, control: ResidenceControl): ImmersiveMenuItem[] {
    switch (control.kind) {
      case 'output': return [{ label: () => `${control.label}  ${control.read()}` }];
      case 'toggle': return [{
        label: () => `${control.label}  ${control.get() ? 'ON' : 'OFF'}`,
        invoke: () => control.set(!control.get()),
        enabled: () => !control.disabled?.(),
      }];
      case 'button': return [{ label: control.label, invoke: control.invoke, enabled: () => !control.disabled?.() }];
      case 'select': return [{
        label: () => `${control.label}  ${control.options.find(option => option.value === control.get())?.label ?? ''}`,
        enabled: () => !control.disabled?.(),
        invoke: () => this.xr.openMenu(control.label, [
          ...control.options.map(({ value, label }) => ({
            label: () => control.get() === value ? `${label}（選択中）` : label,
            invoke: () => { if (!control.disabled?.()) control.set(value); this.openXRResidenceSection(section); },
          })),
          { label: '戻る', invoke: () => this.openXRResidenceSection(section) },
        ]),
      }];
      case 'color': return [];
    }
  }

  private sceneDialogOpen(): boolean {
    return this.travelDialog.open || this.residencePanel?.dialog.open === true || this.cinemaPanel?.dialog.open === true;
  }

  private goTo(worldId: string, placeId: string): void {
    const decision = decideTravel({
      href: this.currentUrl.href,
      currentWorldId: this.worldId,
      targetWorldId: worldId,
      destination: findDestination(worldId, placeId),
      time: this.time,
    });
    if (decision.kind === 'invalid') return;
    if (decision.kind === 'navigate') {
      if (this.pcVR || this.renderer.xr.isPresenting || this.monitor?.hasActiveConnection) {
        void this.changeWorld(decision.url);
      } else {
        ++this.travelRequest;
        location.assign(decision.url);
      }
      return;
    }
    ++this.travelRequest;
    this.showTravelStatus('');
    const relocate = () => {
      this.controls.relocate(decision.destination);
      this.monitor?.releaseGrab();
      this.xr.relocate();
      this.travel.setPlace(worldId, placeId);
      this.replaceUrl(decision.url);
    };
    if (!this.seatTransition || (!this.renderer.xr.isPresenting && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      relocate();
      return;
    }
    this.controls.releaseInput();
    this.seatTransition.start(relocate);
  }

  private readonly onPopState = (): void => {
    const url = new URL(location.href);
    const index = readHistoryIndex(history.state);
    const returning = this.restoringHistory && index === this.currentHistoryIndex && url.href === this.currentUrl.href;
    this.restoringHistory = false;
    if (returning) return;
    const { worldId } = parseStartupRoute(url.search);
    if (worldId !== this.worldId) {
      void this.changeWorld(url, index);
      return;
    }
    ++this.travelRequest;
    this.seatTransition?.cancel();
    this.showTravelStatus('');
    this.currentHistoryIndex = index;
    if (url.href === this.currentUrl.href) return;
    const { placeId, time } = readInitialExplorationState(worldId, url.search);
    const description = EXPLORATION_WORLDS.find(({ id }) => id === worldId)!;
    const destination = findDestination(worldId, placeId) ?? description.places[0];
    this.controls.releaseInput();
    this.controls.relocate(destination);
    this.monitor?.releaseGrab();
    this.xr.relocate();
    this.travel.setPlace(worldId, destination.id);
    this.applyTimeOfDay(time);
    this.currentUrl = url;
  };

  private async changeWorld(url: URL, historyIndex?: number): Promise<void> {
    const request = ++this.travelRequest;
    const { worldId } = parseStartupRoute(url.search);
    const label = EXPLORATION_WORLDS.find(({ id }) => id === worldId)!.label;
    this.travel.close();
    this.seatTransition?.cancel();
    this.controls.releaseInput();
    this.monitor?.closePanel();
    this.showTravelStatus(`${label}を読み込んでいます。`, true);
    let loaded: ExplorationScene | undefined;
    let next: CoastApp;
    let targetHistoryIndex: number;
    try {
      loaded = await loadExplorationScene(worldId);
      if (request !== this.travelRequest || this.disposed) {
        loaded.audio.dispose();
        loaded.world.dispose();
        return;
      }
      targetHistoryIndex = historyIndex ?? readHistoryIndex(history.state) + 1;
      next = new CoastApp(this.mount, loaded, url, this.renderer, targetHistoryIndex, this.xr,
        this.pcVR ? this.quality : undefined);
    } catch {
      loaded?.audio.dispose();
      loaded?.world.dispose();
      if (request === this.travelRequest && !this.disposed) {
        if (historyIndex !== undefined && historyIndex !== this.currentHistoryIndex) {
          // Return to the displayed world's entry and leave the failed entry available to retry.
          this.restoringHistory = true;
          history.go(this.currentHistoryIndex - historyIndex);
        }
        this.showTravelStatus(`${label}を読み込めませんでした。もう一度移動を試してください。`);
      }
      return;
    }
    if (historyIndex === undefined) history.pushState({ coastWorldIndex: targetHistoryIndex }, '', url);
    next.start(this);
  }

  private showTravelStatus(message: string, loading = false): void {
    this.loadingTravel = loading;
    this.showTravelStatusUntil = message ? performance.now() + 6500 : 0;
    this.travelStatus.textContent = message;
    this.travelStatus.hidden = !message;
  }

  private replaceUrl(url: URL): void {
    const cursor = readHistoryIndex(history.state);
    if (cursor === this.currentHistoryIndex) history.replaceState(history.state, '', url);
    else {
      // A new in-world action can supersede an outstanding Back/Forward load.
      this.currentHistoryIndex = cursor + 1;
      history.pushState({ coastWorldIndex: this.currentHistoryIndex }, '', url);
    }
    this.currentUrl = url;
  }

  private applyTimeOfDay(time: CoastTimeOfDay): void {
    this.time = time;
    this.world.setTimeOfDay(time);
    this.audio.setTimeOfDay?.(time);
    this.travel.setTimeOfDay(time);
  }

  private setTimeOfDay(time: CoastTimeOfDay): void {
    ++this.travelRequest;
    this.showTravelStatus('');
    this.applyTimeOfDay(time);
    this.replaceUrl(urlForTime(this.currentUrl.href, time));
  }

  private bindMonitor(actions: Element): MonitorViewBinding {
    const entry = document.createElement('div');
    entry.className = 'coast-travel-panel monitor-entry';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = '仮想モニター';
    toggle.setAttribute('aria-expanded', 'false');
    entry.append(toggle);
    actions.append(entry);
    const binding = {
      entry, toggle, scene: this.world.scene, camera: this.camera,
      releaseInput: () => this.controls.releaseInput(),
    };
    toggle.addEventListener('click', async () => {
      if (this.monitor) {
        this.monitor.togglePanel();
        return;
      }
      toggle.disabled = true;
      try {
        const { MonitorView } = await import('../monitor/monitorView');
        if (this.disposed) return;
        this.monitor = new MonitorView(binding, this.renderer, this.mount, this.xr);
        this.monitor.setTheater(this.world.theater ?? null);
        this.monitor.setMasterVolume(this.audioControls.masterVolume);
      } catch {
        toggle.textContent = '仮想モニターを再読み込み';
      } finally {
        toggle.disabled = false;
      }
    });
    return binding;
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
    const immersive = this.renderer.xr.isPresenting;
    if (!immersive && !this.sceneDialogOpen() && !this.monitor?.blocksSceneInput
      && !this.seatTransition?.active) this.controls.update(dt);
    this.seatTransition?.update(dt);
    const viewer = this.xr.update(frame, dt);
    const allowGrab = this.xr.hasTracking && !this.xr.menuOpen && !this.sceneDialogOpen()
      && !this.loadingTravel && !this.seatTransition?.active;
    if (!allowGrab) this.monitor?.releaseGrab();
    this.monitor?.update(viewer, allowGrab ? frame : undefined);
    const birdCues = this.world.update(this.elapsed, viewer);
    this.syncLightingControl();
    this.residencePanel?.sync();
    if (this.cinemaPanel?.dialog.open) this.cinemaPanel.sync();
    if (this.interactionButton) {
      const label = immersive ? null : this.interactionLabel();
      this.interactionButton.hidden = !label;
      if (label && label !== this.interactionButton.textContent) this.interactionButton.textContent = label;
    }
    viewer.getWorldDirection(this.forward);
    this.up.copy(viewer.up).applyQuaternion(viewer.quaternion);
    const movement = this.controls.currentMovement;
    this.audio.update(viewer.position, this.forward, this.up, this.elapsed,
      viewer !== this.camera && movement === 'crouch' ? 'walk' : movement, birdCues, this.controls.isGrounded,
      this.camera.position);
    this.world.prepareRender?.(this.renderer, viewer);
    this.renderer.render(this.world.scene, immersive ? this.xr.camera : this.camera);
  };

  private readonly onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted && location.href !== this.currentUrl.href) this.onPopState();
  };

  private readonly onPageHide = (event: PageTransitionEvent): void => {
    ++this.travelRequest;
    if (event.persisted) {
      this.showTravelStatus('');
      void this.xr.session.stop();
      // A cached document can resume with its existing receiver and media.
      return;
    }
    this.renderer.setAnimationLoop(null);
    this.monitor?.dispose();
    this.renderer.xr.removeEventListener('sessionend', this.onXRSessionEnd);
    this.xr.dispose();
    this.disposeWorld();
    this.renderer.dispose();
  };

  private disposeWorld(): void {
    this.disposed = true;
    this.events.abort();
    this.unsubscribeXR?.();
    this.renderer.xr.removeEventListener('sessionend', this.onXRSessionEnd);
    this.audioControls.dispose();
    this.seatTransition?.dispose();
    this.resize.disconnect();
    this.controls.dispose();
    this.audio.dispose();
    this.world.dispose();
    disposeSceneDrawables(this.world.scene);
    this.renderer.renderLists.dispose();
  }
}
