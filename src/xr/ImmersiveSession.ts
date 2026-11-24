import type { WebXRManager } from 'three';

export interface ImmersiveStatus {
  readonly state: 'checking' | 'available' | 'unavailable' | 'starting' | 'presenting' | 'error';
  readonly message: string;
}
type Observer = (status: ImmersiveStatus, session: XRSession | null) => void;

export class ImmersiveSession {
  private readonly xr: WebXRManager;
  private readonly system = navigator.xr;
  private readonly observers = new Set<Observer>();
  private status: ImmersiveStatus = { state: 'checking', message: 'VRへの対応を確認中です。' };
  private session: XRSession | null = null;
  private check = 0;
  private busy = false;
  private cancelled = false;
  private disposed = false;

  constructor(xr: WebXRManager) {
    this.xr = xr;
    xr.enabled = Boolean(this.system);
    xr.setReferenceSpaceType('local-floor');
    xr.addEventListener('sessionend', this.onEnd);
    this.system?.addEventListener('devicechange', this.onDeviceChange);
  }

  get active(): XRSession | null {
    return this.status.state === 'presenting' ? this.session : null;
  }

  observe(observer: Observer): () => void {
    this.observers.add(observer);
    observer(this.status, this.active);
    return () => this.observers.delete(observer);
  }

  async checkSupport(): Promise<void> {
    if (this.busy || this.session || this.disposed) return;
    const check = ++this.check;
    if (!this.system) {
      const message = globalThis.isSecureContext
        ? 'このブラウザーでは没入型VRを利用できません。'
        : 'VRを使うには、信頼済みのHTTPSでこのページを開いてください。';
      this.publish('unavailable', message);
      return;
    }
    this.publish('checking', 'VRへの対応を確認中です。');
    let supported: boolean;
    try {
      supported = await this.system.isSessionSupported('immersive-vr');
    } catch {
      supported = false;
    }
    if (check !== this.check || this.busy || this.session || this.disposed) return;
    if (supported) this.publish('available', 'VRを開始できます。');
    else this.publish('unavailable', 'この環境では没入型VRを利用できません。');
  }

  async toggle(): Promise<void> {
    if (this.busy || this.disposed || !this.system) return;
    if (this.session) {
      await this.stop();
      return;
    }
    this.busy = true;
    this.cancelled = false;
    ++this.check;
    this.publish('starting', 'VRを開始しています。');
    try {
      // requestSession must run during the button's transient user activation.
      const session = await this.system.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'],
      });
      if (this.cancelled) {
        await session.end();
        return;
      }
      this.session = session;
      await this.xr.setSession(session);
      if (this.cancelled) {
        await session.end();
        return;
      }
      if (this.session === session) this.publish('presenting', 'VRで探索中です。');
    } catch {
      const session = this.session;
      this.session = null;
      if (session) await session.end().catch(() => undefined);
      if (!this.disposed && !this.cancelled) {
        this.publish('error', 'VRを開始できませんでした。機器の接続と許可を確認し、もう一度開始してください。');
      }
    } finally {
      this.busy = false;
      if (this.cancelled) void this.checkSupport();
    }
  }

  async stop(): Promise<void> {
    if (this.busy) {
      if (this.status.state === 'starting') this.cancelled = true;
      return;
    }
    if (!this.session) return;
    this.busy = true;
    try {
      await this.session.end();
    } catch {
      if (!this.disposed) this.publish('presenting', '機器のシステムメニューからVRを終了してください。');
    } finally {
      this.busy = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.observers.clear();
    this.xr.removeEventListener('sessionend', this.onEnd);
    this.system?.removeEventListener('devicechange', this.onDeviceChange);
    void this.stop();
  }

  private readonly onEnd = (): void => {
    if (!this.session) return;
    this.session = null;
    if (!this.disposed) this.publish('available', 'VRを終了しました。');
  };

  private readonly onDeviceChange = (): void => { void this.checkSupport(); };

  private publish(state: ImmersiveStatus['state'], message: string): void {
    if (this.status.state === state && this.status.message === message) return;
    this.status = { state, message };
    for (const observer of this.observers) observer(this.status, this.active);
  }
}

export function renderImmersiveStatus(
  button: HTMLButtonElement, output: HTMLElement, status: ImmersiveStatus,
  start: string, exit: string,
): void {
  const { state, message } = status;
  button.disabled = state === 'unavailable' || state === 'checking' || state === 'starting';
  button.textContent = state === 'presenting' ? exit : start;
  output.textContent = message;
}
