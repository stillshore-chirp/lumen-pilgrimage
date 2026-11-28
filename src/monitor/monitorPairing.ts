const READY = 'lumen-monitor-sender-ready';
const PORT = 'lumen-monitor-pairing-port';
const CODE = 'lumen-monitor-pairing-code';
const HANDOFF_TIMEOUT = 120_000;
const codePattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function messageType(data: unknown, type: string): boolean {
  return typeof data === 'object' && data !== null && 'type' in data && data.type === type;
}

/** One explicit launch, one private channel, one single-use server code. */
export class MonitorLocalPairing {
  private cancelAttempt: (() => void) | undefined;

  private readonly onCode: (code: string) => void;
  private readonly host: Window;

  constructor(onCode: (code: string) => void, host: Window = window) {
    this.onCode = onCode;
    this.host = host;
  }

  open(url: URL): boolean {
    this.cancel();
    if (url.origin !== this.host.location.origin) return false;
    let child: Window | null = null;
    let port: MessagePort | undefined;
    const abort = new AbortController();
    const finish = () => {
      clearTimeout(timer);
      abort.abort();
      port?.close();
      child = null;
      if (this.cancelAttempt === finish) this.cancelAttempt = undefined;
    };
    const timer = setTimeout(finish, HANDOFF_TIMEOUT);
    this.cancelAttempt = finish;
    this.host.addEventListener('message', event => {
      if (!child || event.source !== child || event.origin !== url.origin || !messageType(event.data, READY) || port) return;
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (abort.signal.aborted) return;
        if (!messageType(data, CODE) || !('code' in (data as object))) return;
        const code = (data as { code: unknown }).code;
        if (typeof code !== 'string' || !codePattern.test(code)) return;
        finish();
        this.onCode(code);
      };
      child.postMessage({ type: PORT }, url.origin, [channel.port2]);
      child = null;
    }, { signal: abort.signal });
    child = this.host.open(url.href, '_blank');
    if (!child) finish();
    return child !== null;
  }

  cancel(): void { this.cancelAttempt?.(); }
}

/** The opener is used only to authenticate a port; it never receives role tokens. */
export class MonitorPairingSource {
  private port: MessagePort | undefined;
  private code: string | undefined;
  private sent = false;
  private readonly events = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(host: Window = window) {
    const opener: Window | null = host.opener;
    // Detach public opener access; the captured reference authenticates this handshake only.
    host.opener = null;
    this.timer = setTimeout(() => this.dispose(), HANDOFF_TIMEOUT);
    if (!opener) return;
    host.addEventListener('message', event => {
      if (this.port || this.sent || event.source !== opener || event.origin !== host.location.origin
        || !messageType(event.data, PORT) || event.ports.length !== 1) return;
      this.port = event.ports[0];
      this.flush();
    }, { signal: this.events.signal });
    opener.postMessage({ type: READY }, host.location.origin);
  }

  publish(code: string | undefined): void {
    if (this.events.signal.aborted) return;
    this.code = code && codePattern.test(code) ? code : undefined;
    this.flush();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.events.abort();
    this.code = undefined;
    this.port?.close();
    this.port = undefined;
  }

  private flush(): void {
    if (!this.port || !this.code || this.sent || this.events.signal.aborted) return;
    this.port.postMessage({ type: CODE, code: this.code });
    this.sent = true;
    this.dispose();
  }
}
