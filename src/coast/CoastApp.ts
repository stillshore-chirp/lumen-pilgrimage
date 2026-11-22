import {
  NeutralToneMapping, PCFShadowMap, PerspectiveCamera, Vector3, WebGLRenderer, type Scene,
} from 'three';
import { CoastAudio } from './CoastAudio';
import { CoastControls, type CoastMovement, type CoastNavigation } from './CoastControls';
import type { CoastBirdCue } from './coastBirdCue';
import { EXPLORATION_WORLDS, findDestination, type ExplorationWorldId } from './coastDestinations';
import { createCoastTravelPanel } from './CoastTravelPanel';
import { CoastWorld, type CoastQuality } from './CoastWorld';
import type { CoastTimeOfDay } from './world/coastAtmosphere';
import './coast.css';

const qualitySettings = {
  light: 0.80,
  high: 1.75,
} satisfies Record<CoastQuality, number>;

const movementLabels: Record<CoastMovement, string> = {
  walk: '歩行', wade: '浅瀬', swim: '遊泳', dive: '潜水', flight: '自由飛行',
};

interface ExplorationWorld {
  readonly scene: Scene;
  setQuality(quality: CoastQuality): void;
  setTimeOfDay(time: CoastTimeOfDay): void;
  update(elapsed: number, camera: PerspectiveCamera): readonly CoastBirdCue[];
  diveObstacleHeight?(x: number, z: number): number | undefined;
  dispose(): void;
}

type ExplorationAudio = Pick<CoastAudio, 'start' | 'setLevel' | 'update' | 'dispose'> & {
  setTimeOfDay?(time: CoastTimeOfDay): void;
};

export interface OverlookScene {
  readonly world: ExplorationWorld;
  readonly navigation: CoastNavigation;
  readonly audio: ExplorationAudio;
}

export class CoastApp {
  private readonly renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly world: ExplorationWorld;
  private readonly worldId: ExplorationWorldId;
  private readonly audio: ExplorationAudio;
  private readonly camera: PerspectiveCamera;
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private readonly controls: CoastControls;
  private readonly travel: ReturnType<typeof createCoastTravelPanel>;
  private readonly travelDialog: HTMLDialogElement;
  private readonly resize: ResizeObserver;
  private time: CoastTimeOfDay;
  private quality: CoastQuality = 'light';
  private lastFrame = 0;
  private elapsed = 0;
  private frameId = 0;

  constructor(private readonly mount: HTMLElement, overlook?: OverlookScene) {
    const path = new URLSearchParams(location.search);
    const description = EXPLORATION_WORLDS[overlook ? 1 : 0];
    this.worldId = description.id;
    this.world = overlook?.world ?? new CoastWorld();
    this.audio = overlook?.audio ?? new CoastAudio();
    this.camera = overlook ? new PerspectiveCamera(54, 1, 0.20, 43500) : new PerspectiveCamera(60, 1, 0.12, 2500);
    this.time = path.get('time') === 'night' ? 'night' : 'day';
    const destination = findDestination(this.worldId, path.get('place'));
    this.world.setTimeOfDay(this.time);
    this.audio.setTimeOfDay?.(this.time);
    this.mount.classList.add('coast');
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.className = 'coast-view';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', overlook ? '丘陵の展望デッキの探索画面' : '海岸、森、湖と山の探索画面');

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
            <p>地上で <kbd>Space</kbd> ジャンプ</p>
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
        <section class="coast-panel coast-settings" aria-label="描画と音">
          <div class="coast-row" role="group" aria-label="描画品質">
            <span class="coast-label">描画</span>
            <button type="button" class="coast-light" aria-pressed="true" title="広域の影と軽い植生描画">軽量</button>
            <button type="button" class="coast-high" aria-pressed="false" title="細かな木漏れ日、地表の凹凸と手前の下草">高品質</button>
          </div>
          <div class="coast-row coast-sound">
            <button type="button" class="coast-audio">環境音を開始</button>
            <button type="button" class="coast-mute" aria-pressed="false">ミュート</button>
            <label class="coast-volume">音量 <input type="range" min="0" max="100" step="1" value="70"></label>
          </div>
          <p class="coast-audio-message" role="status"></p>
        </section>
      </div>
    `;
    ui.querySelector('h1')!.textContent = overlook ? description.label : '自然景観探索';
    ui.querySelector('.coast-guide-description')!.textContent = overlook
      ? '南のデッキから盆地の市街地を見渡せます。東側の階段から2階展望デッキへ上がれます。'
      : '海に向かって左は岩浜、右は潮だまり。浜を背にすると森の入口に休憩所があり、道は湖と稜線へ続きます。';
    if (overlook) {
      ui.querySelectorAll('.coast-water-guide').forEach(node => node.remove());
      ui.querySelector('.coast-light')!.setAttribute('title', '広域の影と軽い描画');
      ui.querySelector('.coast-high')!.setAttribute('title', '近くの影と細かな描画');
    }
    this.mount.append(canvas, ui);

    const mode = ui.querySelector<HTMLElement>('.coast-mode')!;
    const lock = ui.querySelector<HTMLButtonElement>('.coast-lock')!;
    const flight = ui.querySelector<HTMLButtonElement>('.coast-flight')!;
    const lockMessage = ui.querySelector<HTMLElement>('.coast-lock-message')!;
    this.controls = new CoastControls(this.camera, canvas, {
      diveObstacleHeight: (x, z) => this.world.diveObstacleHeight?.(x, z),
      onMovementChange: movement => {
        mode.textContent = movementLabels[movement];
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
    }, overlook?.navigation);
    if (destination) this.controls.relocate(destination);
    lock.addEventListener('click', () => this.controls.requestLock());
    canvas.addEventListener('click', () => this.controls.requestLock());
    flight.addEventListener('click', () => {
      this.controls.toggleFlight();
      canvas.focus({ preventScroll: true });
    });

    this.travel = createCoastTravelPanel({
      worlds: EXPLORATION_WORLDS, worldId: this.worldId, time: this.time,
      onOpen: () => this.controls.releaseInput(),
      onTravel: (worldId, placeId) => this.goTo(worldId, placeId),
      onTimeOfDay: time => this.setTimeOfDay(time),
    });
    this.travel.setPlace(this.worldId, destination?.id ?? description.places[0].id);
    this.travelDialog = this.travel.element.querySelector('dialog')!;
    const actions = ui.querySelector('.coast-header-actions')!;
    actions.prepend(this.travel.element);
    window.addEventListener('keydown', this.onTravelKey);

    this.bindQuality(ui);
    this.bindAudio(ui, this.audio);
    this.resize = new ResizeObserver(() => this.resizeViewport());
    this.resize.observe(this.mount);
    this.resizeViewport();
    this.frameId = requestAnimationFrame(this.render);
    window.addEventListener('pagehide', this.onPageHide);
  }

  private readonly onTravelKey = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyT' || event.repeat || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.travelDialog.open || (event.target instanceof Element
      && event.target.closest('input, textarea, select, [contenteditable]'))) return;
    event.preventDefault();
    this.travel.open();
  };

  private goTo(worldId: string, placeId: string): void {
    const place = findDestination(worldId, placeId);
    if (!place) return;
    const address = new URL(location.href);
    address.searchParams.set('world', worldId);
    address.searchParams.set('place', placeId);
    address.searchParams.set('time', this.time);
    if (worldId !== this.worldId) {
      location.assign(address);
      return;
    }
    this.controls.relocate(place);
    this.travel.setPlace(worldId, placeId);
    history.replaceState(null, '', address);
  }

  private setTimeOfDay(time: CoastTimeOfDay): void {
    this.time = time;
    this.world.setTimeOfDay(time);
    this.audio.setTimeOfDay?.(time);
    this.travel.setTimeOfDay(time);
    const address = new URL(location.href);
    address.searchParams.set('time', time);
    history.replaceState(null, '', address);
  }

  private bindQuality(ui: HTMLElement): void {
    const light = ui.querySelector<HTMLButtonElement>('.coast-light')!;
    const high = ui.querySelector<HTMLButtonElement>('.coast-high')!;
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

  private bindAudio(ui: HTMLElement, audio: ExplorationAudio): void {
    const start = ui.querySelector<HTMLButtonElement>('.coast-audio')!;
    const mute = ui.querySelector<HTMLButtonElement>('.coast-mute')!;
    const volume = ui.querySelector<HTMLInputElement>('.coast-volume input')!;
    const message = ui.querySelector<HTMLElement>('.coast-audio-message')!;
    const setLevel = () => audio.setLevel(volume.valueAsNumber / 100, mute.getAttribute('aria-pressed') === 'true');
    setLevel();
    mute.addEventListener('click', () => {
      mute.setAttribute('aria-pressed', String(mute.getAttribute('aria-pressed') !== 'true'));
      setLevel();
    });
    volume.addEventListener('input', setLevel);
    start.addEventListener('click', async () => {
      start.disabled = true;
      message.textContent = '環境音を準備しています。';
      try {
        await audio.start();
        start.textContent = '環境音を再開';
        message.textContent = '環境音を開始しました。';
      } catch {
        message.textContent = '環境音を開始できませんでした。もう一度ボタンを押してください。';
      } finally {
        start.disabled = false;
      }
    });
  }

  private resizeViewport(): void {
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

  private readonly render = (now: number): void => {
    const dt = this.lastFrame === 0 ? 0 : Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.elapsed += dt;
    if (!this.travelDialog.open) this.controls.update(dt);
    const birdCues = this.world.update(this.elapsed, this.camera);
    this.camera.getWorldDirection(this.forward);
    this.up.copy(this.camera.up).applyQuaternion(this.camera.quaternion);
    this.audio.update(this.camera.position, this.forward, this.up, this.elapsed, this.controls.currentMovement, birdCues);
    this.renderer.render(this.world.scene, this.camera);
    this.frameId = requestAnimationFrame(this.render);
  };

  private readonly onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) return;
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('keydown', this.onTravelKey);
    cancelAnimationFrame(this.frameId);
    this.resize.disconnect();
    this.controls.dispose();
    this.audio.dispose();
    this.world.dispose();
    this.renderer.dispose();
  };
}
