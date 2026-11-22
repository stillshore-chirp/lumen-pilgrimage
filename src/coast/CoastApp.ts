import {
  NeutralToneMapping, PCFShadowMap, PerspectiveCamera, Vector3, WebGLRenderer,
} from 'three';
import { CoastAudio } from './CoastAudio';
import { CoastControls, type CoastMovement } from './CoastControls';
import { CoastWorld, type CoastQuality } from './CoastWorld';
import './coast.css';

const qualitySettings = {
  light: 0.80,
  high: 1.75,
} satisfies Record<CoastQuality, number>;

const movementLabels: Record<CoastMovement, string> = {
  walk: '歩行', wade: '浅瀬', swim: '遊泳', dive: '潜水', flight: '自由飛行',
};

export class CoastApp {
  private readonly renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly world = new CoastWorld();
  private readonly audio = new CoastAudio();
  private readonly camera = new PerspectiveCamera(60, 1, 0.12, 2500);
  private readonly forward = new Vector3();
  private readonly up = new Vector3();
  private readonly controls: CoastControls;
  private readonly resize: ResizeObserver;
  private quality: CoastQuality = 'light';
  private lastFrame = 0;
  private elapsed = 0;
  private frameId = 0;

  constructor(private readonly mount: HTMLElement) {
    this.mount.classList.add('coast');
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.className = 'coast-view';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '海岸と密林の探索画面');

    const ui = document.createElement('div');
    ui.className = 'coast-ui';
    ui.innerHTML = `
      <header class="coast-header">
        <div class="coast-title">
          <h1>自然景観探索</h1>
          <span class="coast-mode">歩行</span>
        </div>
        <a class="coast-legacy" href="?scene=expedition">従来のゲームへ <span aria-hidden="true">↗</span></a>
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
            <p>海に向かって左は岩浜、右は潮だまり。浜の背後は沢と岩間へ続きます。</p>
            <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動 <span class="coast-divider">·</span> <kbd>Shift</kbd> 加速</p>
            <p>マウス 視点 <span class="coast-divider">·</span> <kbd>Esc</kbd> 解除</p>
            <p>地上で <kbd>Space</kbd> ジャンプ</p>
            <p>泳いでいるとき <kbd>C</kbd> 潜る <kbd>Space</kbd> 浮上</p>
            <p><kbd>F</kbd> 歩行／飛行 <span class="coast-divider">·</span> 飛行中 <kbd>Space</kbd> 上昇 <kbd>C</kbd> 下降</p>
            <details>
              <summary>ゲームパッド</summary>
              <p>左スティック 移動 <span class="coast-divider">·</span> 右スティック 視点</p>
              <p><kbd>A</kbd> ジャンプ <span class="coast-divider">·</span> <kbd>Y</kbd> 歩行／飛行</p>
              <p>泳いでいるとき <kbd>B</kbd> 潜る <kbd>A</kbd> 浮上</p>
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
    this.mount.append(canvas, ui);

    const mode = ui.querySelector<HTMLElement>('.coast-mode')!;
    const lock = ui.querySelector<HTMLButtonElement>('.coast-lock')!;
    const flight = ui.querySelector<HTMLButtonElement>('.coast-flight')!;
    const lockMessage = ui.querySelector<HTMLElement>('.coast-lock-message')!;
    this.controls = new CoastControls(this.camera, canvas, {
      diveObstacleHeight: (x, z) => this.world.diveObstacleHeight(x, z),
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
    });
    lock.addEventListener('click', () => this.controls.requestLock());
    canvas.addEventListener('click', () => this.controls.requestLock());
    flight.addEventListener('click', () => {
      this.controls.toggleFlight();
      canvas.focus({ preventScroll: true });
    });

    this.bindQuality(ui);
    this.bindAudio(ui);
    this.resize = new ResizeObserver(() => this.resizeViewport());
    this.resize.observe(this.mount);
    this.resizeViewport();
    this.frameId = requestAnimationFrame(this.render);
    window.addEventListener('pagehide', this.onPageHide);
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

  private bindAudio(ui: HTMLElement): void {
    const start = ui.querySelector<HTMLButtonElement>('.coast-audio')!;
    const mute = ui.querySelector<HTMLButtonElement>('.coast-mute')!;
    const volume = ui.querySelector<HTMLInputElement>('.coast-volume input')!;
    const message = ui.querySelector<HTMLElement>('.coast-audio-message')!;
    const setLevel = () => this.audio.setLevel(volume.valueAsNumber / 100, mute.getAttribute('aria-pressed') === 'true');
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
        await this.audio.start();
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
    this.controls.update(dt);
    this.camera.getWorldDirection(this.forward);
    this.up.copy(this.camera.up).applyQuaternion(this.camera.quaternion);
    this.audio.update(this.camera.position, this.forward, this.up, this.elapsed);
    this.world.update(this.elapsed, this.camera);
    this.renderer.render(this.world.scene, this.camera);
    this.frameId = requestAnimationFrame(this.render);
  };

  private readonly onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) return;
    window.removeEventListener('pagehide', this.onPageHide);
    cancelAnimationFrame(this.frameId);
    this.resize.disconnect();
    this.controls.dispose();
    this.audio.dispose();
    this.world.dispose();
    this.renderer.dispose();
  };
}
