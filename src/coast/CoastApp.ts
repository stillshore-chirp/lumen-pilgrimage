import {
  ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, Vector3, WebGLRenderer,
} from 'three';
import { CoastAudio } from './CoastAudio';
import { CoastControls } from './CoastControls';
import { CoastWorld, type CoastQuality } from './CoastWorld';
import './coast.css';

const qualitySettings = {
  low: { resolution: 0.8, far: 600 },
  normal: { resolution: 1.6, far: 1050 },
} satisfies Record<CoastQuality, { resolution: number; far: number }>;

export class CoastApp {
  private readonly renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly world = new CoastWorld();
  private readonly audio = new CoastAudio();
  private readonly camera = new PerspectiveCamera(56, 1, 0.12);
  private readonly forward = new Vector3();
  private readonly controls: CoastControls;
  private readonly resize: ResizeObserver;
  private quality: CoastQuality = 'low';
  private lastFrame = 0;
  private elapsed = 0;
  private frameId = 0;

  constructor(private readonly mount: HTMLElement) {
    this.mount.classList.add('coast');
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.className = 'coast-view';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '海岸の探索画面');

    const ui = document.createElement('div');
    ui.className = 'coast-ui';
    ui.innerHTML = `
      <header class="coast-header">
        <div class="coast-title">
          <h1>海岸探索</h1>
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
          <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動 <span class="coast-divider">·</span> マウス 視点 <span class="coast-divider">·</span> <kbd>Esc</kbd> 解除</p>
          <p><kbd>F</kbd> 歩行／飛行 <span class="coast-divider">·</span> 飛行中 <kbd>Space</kbd> 上昇 <kbd>C</kbd> 下降</p>
          <details>
            <summary>ゲームパッド</summary>
            <p>左スティック 移動 <span class="coast-divider">·</span> 右スティック 視点</p>
            <p><kbd>Y</kbd> 歩行／飛行 <span class="coast-divider">·</span> 飛行中 <kbd>A</kbd> 上昇 <kbd>B</kbd> 下降</p>
          </details>
          <p class="coast-lock-message" role="status" hidden></p>
        </section>
        <section class="coast-panel coast-settings" aria-label="描画と音">
          <div class="coast-row" role="group" aria-label="描画品質">
            <span class="coast-label">描画</span>
            <button type="button" class="coast-low" aria-pressed="true">ローポリ</button>
            <button type="button" class="coast-normal" aria-pressed="false">通常</button>
          </div>
          <div class="coast-row coast-sound">
            <button type="button" class="coast-audio">環境音を開始</button>
            <button type="button" class="coast-mute" aria-pressed="false">ミュート</button>
            <label class="coast-volume">音量 <input type="range" min="0" max="100" step="1" value="70"></label>
          </div>
          <p class="coast-audio-message" role="status">ボタンを押すと環境音が流れます。ヘッドホン対応。</p>
        </section>
      </div>
    `;
    this.mount.append(canvas, ui);

    const mode = ui.querySelector<HTMLElement>('.coast-mode')!;
    const lock = ui.querySelector<HTMLButtonElement>('.coast-lock')!;
    const flight = ui.querySelector<HTMLButtonElement>('.coast-flight')!;
    const lockMessage = ui.querySelector<HTMLElement>('.coast-lock-message')!;
    this.controls = new CoastControls(this.camera, canvas, {
      onFlightChange: flying => {
        mode.textContent = flying ? '自由飛行' : '歩行';
        flight.setAttribute('aria-pressed', String(flying));
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
    const low = ui.querySelector<HTMLButtonElement>('.coast-low')!;
    const normal = ui.querySelector<HTMLButtonElement>('.coast-normal')!;
    const apply = (quality: CoastQuality) => {
      this.quality = quality;
      const settings = qualitySettings[quality];
      this.world.setQuality(quality);
      this.camera.far = settings.far;
      this.resizeViewport();
      low.setAttribute('aria-pressed', String(quality === 'low'));
      normal.setAttribute('aria-pressed', String(quality === 'normal'));
    };
    low.addEventListener('click', () => apply('low'));
    normal.addEventListener('click', () => apply('normal'));
    apply('low');
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
    const resolution = qualitySettings[this.quality].resolution;
    const pixelRatio = this.quality === 'low'
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
    this.audio.update(this.camera.position, this.forward);
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
    this.renderer.dispose();
  };
}
