export type MonitorOutput = 'pc' | 'viewer' | 'both';

export type MonitorSharedAudio = {
  available: boolean;
  output: MonitorOutput;
  pcPlaybackSuppressed?: true;
};

export type MonitorConnectionState = {
  phase: 'idle' | 'waiting' | 'approval' | 'connecting' | 'connected' | 'ended' | 'failed';
  code?: string;
  verification?: string;
  audio: MonitorSharedAudio;
  detail: string;
};

type Description = { type: 'offer' | 'answer'; sdp: string };
type Snapshot = {
  revision: number;
  phase: 'waiting' | 'pending' | 'approved' | 'closed';
  verification?: string;
  offer?: Description;
  answer?: Description;
  audio: MonitorSharedAudio;
};
type Credentials = { sessionId: string; token: string };
type SnapshotResult = { snapshot: Snapshot };
type Enrollment = Credentials & SnapshotResult;
type Endpoint = 'create' | 'join' | 'poll' | 'approve' | 'offer' | 'answer' | 'audio' | 'close';

type Connection = {
  controller: AbortController;
  state: MonitorConnectionState;
  credentials?: Credentials;
  peer?: RTCPeerConnection;
  video?: MediaStreamTrack;
  connectionTimer?: ReturnType<typeof setTimeout>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
};

const SIGNAL_TIMEOUT = 15_000;
const INITIAL_POLL_RETRY_DELAY = 1_000;
const MAX_POLL_RETRY_DELAY = 8_000;
const ICE_TIMEOUT = 8_000;
const CONNECTION_TIMEOUT = 30_000;
const DISCONNECT_GRACE = 5_000;
const CONNECTION_FAILURE = '接続が途切れました。配信元と同じネットワークを確認し、新しいコードで接続してください。';

class SignalError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('Monitor signaling request failed');
    this.status = status;
  }
}

class MonitorFailure extends Error {}

function canRetryPoll(error: unknown): boolean {
  if (error instanceof SignalError) {
    return [408, 409, 429].includes(error.status) || (error.status >= 500 && error.status <= 599);
  }
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');
}

function waitForPollRetry(delay: number, abort: AbortSignal): Promise<void> {
  abort.throwIfAborted();
  return new Promise(resolve => {
    const timer = setTimeout(finish, delay);
    function finish() {
      clearTimeout(timer);
      abort.removeEventListener('abort', finish);
      resolve();
    }
    abort.addEventListener('abort', finish, { once: true });
  });
}

async function signal<T>(
  endpoint: Endpoint,
  payload: Record<string, unknown>,
  credentials?: Credentials,
  sessionSignal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(SIGNAL_TIMEOUT);
  const response = await fetch(`/api/virtual-monitor/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(credentials && { Authorization: `Bearer ${credentials.token}` }),
    },
    cache: 'no-store',
    body: JSON.stringify(credentials ? { ...payload, sessionId: credentials.sessionId } : payload),
    signal: sessionSignal ? AbortSignal.any([sessionSignal, timeout]) : timeout,
    keepalive: endpoint === 'close',
  });
  if (!response.ok) throw new SignalError(response.status);
  return response.json();
}

function closeRemote(credentials: Credentials): void {
  void signal('close', {}, credentials).catch(() => {});
}

function liveTrack(tracks: MediaStreamTrack[]): MediaStreamTrack | undefined {
  return tracks.find((track) => track.readyState === 'live');
}

function sameAudio(left: MonitorSharedAudio | undefined, right: MonitorSharedAudio): boolean {
  return left?.available === right.available && left.output === right.output
    && left.pcPlaybackSuppressed === right.pcPlaybackSuppressed;
}

function requireWebRTC(): void {
  if (globalThis.isSecureContext === false) {
    throw new MonitorFailure('仮想モニターの接続には HTTPS または localhost で開いたページが必要です。');
  }
  if (typeof RTCPeerConnection === 'undefined' || typeof MediaStream === 'undefined') {
    throw new MonitorFailure('このブラウザでは映像の接続に必要な WebRTC を利用できません。');
  }
}

function waitForIce(peer: RTCPeerConnection, abort: AbortSignal): Promise<void> {
  abort.throwIfAborted();
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', onChange);
      abort.removeEventListener('abort', onAbort);
    };
    const onChange = () => {
      if (peer.iceGatheringState !== 'complete') return;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(abort.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new MonitorFailure(CONNECTION_FAILURE));
    }, ICE_TIMEOUT);
    peer.addEventListener('icegatheringstatechange', onChange);
    abort.addEventListener('abort', onAbort, { once: true });
  });
}

async function localDescription(
  peer: RTCPeerConnection,
  description: RTCSessionDescriptionInit,
  abort: AbortSignal,
): Promise<Description> {
  abort.throwIfAborted();
  await peer.setLocalDescription(description);
  await waitForIce(peer, abort);
  const local = peer.localDescription;
  if ((local?.type !== 'offer' && local?.type !== 'answer') || !local.sdp.includes('a=candidate:')) {
    throw new MonitorFailure(CONNECTION_FAILURE);
  }
  return { type: local.type, sdp: local.sdp };
}

abstract class MonitorSession<Active extends Connection> {
  protected current?: Active;
  private readonly onState: (state: MonitorConnectionState) => void;

  constructor(onState: (state: MonitorConnectionState) => void) {
    this.onState = onState;
  }

  protected begin(connection: Active): void {
    if (this.current) this.release(this.current);
    this.current = connection;
    this.onState(connection.state);
  }

  protected publish(connection: Active, state: MonitorConnectionState): void {
    if (this.current !== connection) return;
    const previous = connection.state;
    if (previous.phase === state.phase && previous.detail === state.detail
      && previous.code === state.code && previous.verification === state.verification
      && sameAudio(previous.audio, state.audio)) return;
    connection.state = state;
    this.onState(state);
  }

  protected bindEnrollment(connection: Active, enrollment: Enrollment): boolean {
    const { sessionId, token } = enrollment;
    if (this.current !== connection) {
      closeRemote({ sessionId, token });
      return false;
    }
    connection.credentials = { sessionId, token };
    return true;
  }

  protected request<T extends SnapshotResult>(
    connection: Active,
    endpoint: Endpoint,
    payload: Record<string, unknown>,
  ): Promise<T> {
    connection.controller.signal.throwIfAborted();
    return signal<T>(endpoint, payload, connection.credentials, connection.controller.signal);
  }

  protected async poll(connection: Active, snapshot: Snapshot, apply: (snapshot: Snapshot) => Promise<void>): Promise<void> {
    try {
      while (this.current === connection) {
        await apply(snapshot);
        if (this.current !== connection) return;
        snapshot = await this.pollSnapshot(connection, snapshot.revision);
      }
    } catch (error) {
      if (error instanceof SignalError && error.status === 404) {
        this.finish(connection, 'ended', '接続の有効期限が切れたか、共有が終了しました。', false);
        return;
      }
      this.fail(connection, error);
    }
  }

  private async pollSnapshot(connection: Active, revision: number): Promise<Snapshot> {
    const abort = connection.controller.signal;
    let delay = INITIAL_POLL_RETRY_DELAY;
    while (true) {
      try {
        const { snapshot } = await this.request(connection, 'poll', { revision });
        return snapshot;
      } catch (error) {
        abort.throwIfAborted();
        // An established peer can keep carrying media during a signaling outage.
        if (connection.state.phase !== 'connected' || connection.video?.readyState !== 'live' || !canRetryPoll(error)) {
          throw error;
        }
        await waitForPollRetry(delay, abort);
        delay = Math.min(delay * 2, MAX_POLL_RETRY_DELAY);
      }
    }
  }

  protected startConnectionTimer(connection: Active): void {
    connection.connectionTimer ??= setTimeout(() => {
      this.finish(connection, 'failed', CONNECTION_FAILURE);
    }, CONNECTION_TIMEOUT);
  }

  protected clearConnectionTimer(connection: Active): void {
    clearTimeout(connection.connectionTimer);
    connection.connectionTimer = undefined;
  }

  protected createPeer(connection: Active, onConnected: () => void): RTCPeerConnection {
    connection.controller.signal.throwIfAborted();
    const peer = new RTCPeerConnection({ iceServers: [] });
    connection.peer = peer;
    peer.addEventListener('connectionstatechange', () => {
      switch (peer.connectionState) {
        case 'connected':
          clearTimeout(connection.disconnectTimer);
          connection.disconnectTimer = undefined;
          onConnected();
          break;
        case 'disconnected':
          connection.disconnectTimer ??= setTimeout(() => {
            this.finish(connection, 'failed', CONNECTION_FAILURE);
          }, DISCONNECT_GRACE);
          break;
        case 'failed':
        case 'closed':
          this.finish(connection, 'failed', CONNECTION_FAILURE);
          break;
      }
    }, { signal: connection.controller.signal });
    return peer;
  }

  protected finish(
    connection: Active,
    phase: 'ended' | 'failed',
    detail: string,
    notifyServer = true,
  ): void {
    if (this.current !== connection) return;
    this.release(connection, notifyServer);
    this.onState({ phase, detail, audio: { available: false, output: connection.state.audio.output } });
  }

  protected fail(connection: Active, error: unknown, detail = '接続を完了できませんでした。新しいコードで接続してください。'): void {
    this.finish(connection, 'failed', error instanceof MonitorFailure ? error.message : detail);
  }

  protected abstract releaseMedia(connection: Active): void;

  private release(connection: Active, notifyServer = true): void {
    this.current = undefined;
    connection.controller.abort();
    clearTimeout(connection.connectionTimer);
    clearTimeout(connection.disconnectTimer);
    connection.peer?.close();
    this.releaseMedia(connection);
    if (notifyServer && connection.credentials) closeRemote(connection.credentials);
  }
}

type SenderConnection = Connection & {
  stream: MediaStream;
  audioTrack?: MediaStreamTrack;
  audioWrite: Promise<void>;
  announcedAudio?: MonitorSharedAudio;
  code?: string;
  decision?: boolean;
};

export class MonitorSender extends MonitorSession<SenderConnection> {
  constructor({ onState }: { onState: (state: MonitorConnectionState) => void }) {
    super(onState);
  }

  async start(stream: MediaStream, audio: MonitorSharedAudio): Promise<void> {
    if (this.current?.stream === stream) return;
    const connection: SenderConnection = {
      stream,
      video: liveTrack(stream.getVideoTracks()),
      audioTrack: liveTrack(stream.getAudioTracks()),
      audioWrite: Promise.resolve(),
      controller: new AbortController(),
      state: {
        phase: 'waiting',
        detail: '共有の準備中です。',
        audio: { available: false, output: audio.output },
      },
    };
    this.begin(connection);
    try {
      requireWebRTC();
      if (!connection.video) throw new MonitorFailure('画面映像を取得できませんでした。共有する画面を選び直してください。');
      const listener = { signal: connection.controller.signal, once: true };
      connection.video.addEventListener('ended', () => {
        this.finish(connection, 'ended', '画面共有が停止されました。');
      }, listener);
      connection.audioTrack?.addEventListener('ended', () => {
        void this.updateAudio({ available: false, output: connection.state.audio.output });
      }, listener);
      await this.updateAudio(audio);
      if (this.current !== connection) return;
      // Allow a late allocation to return its credentials so a canceled attempt can close it.
      const enrollment = await signal<Enrollment & { code: string }>('create', {});
      if (!this.bindEnrollment(connection, enrollment)) return;
      connection.code = enrollment.code;
      connection.announcedAudio = enrollment.snapshot.audio;
      await this.writeAudio(connection);
      if (this.current !== connection) return;
      void this.poll(connection, enrollment.snapshot, (snapshot) => this.apply(connection, snapshot));
    } catch (error) {
      this.fail(connection, error, '画面共有を開始できませんでした。接続先を確認して、共有を開始し直してください。');
    }
  }

  async decide(accept: boolean): Promise<void> {
    const connection = this.current;
    if (!connection || connection.state.phase !== 'approval' || connection.decision !== undefined) return;
    connection.decision = accept;
    try {
      // A rejected request never creates a peer or attaches any media.
      const { snapshot } = await this.request<SnapshotResult>(connection, 'approve', { accept });
      if (snapshot.phase === 'closed') {
        this.finish(connection, 'ended', '接続を拒否し、共有を終了しました。', false);
      }
    } catch (error) {
      this.fail(connection, error, '接続の確認を完了できませんでした。共有を開始し直してください。');
    }
  }

  async updateAudio(audio: MonitorSharedAudio): Promise<void> {
    const connection = this.current;
    if (!connection) return;
    const available = audio.available && connection.audioTrack?.readyState === 'live';
    if (connection.audioTrack) connection.audioTrack.enabled = available && audio.output !== 'pc';
    const effectiveAudio: MonitorSharedAudio = { available, output: audio.output };
    if (available && audio.pcPlaybackSuppressed) effectiveAudio.pcPlaybackSuppressed = true;
    this.publish(connection, { ...connection.state, audio: effectiveAudio });
    if (!connection.credentials) return;
    try {
      await this.writeAudio(connection);
    } catch (error) {
      this.fail(connection, error, '音声の設定を接続先へ送れなかったため、画面共有を終了しました。');
    }
  }

  stop(): void {
    if (this.current) this.finish(this.current, 'ended', '画面共有を停止しました。');
  }

  protected releaseMedia(connection: SenderConnection): void {
    for (const track of connection.stream.getTracks()) track.stop();
  }

  private writeAudio(connection: SenderConnection): Promise<void> {
    // Keep the routing updates in order if an earlier write is still in flight.
    connection.audioWrite = connection.audioWrite.then(async () => {
      const audio = connection.state.audio;
      if (this.current !== connection || sameAudio(connection.announcedAudio, audio)) return;
      await this.request(connection, 'audio', { audio });
      connection.announcedAudio = audio;
    });
    return connection.audioWrite;
  }

  private async apply(connection: SenderConnection, snapshot: Snapshot): Promise<void> {
    const { audio } = connection.state;
    switch (snapshot.phase) {
      case 'closed':
        this.finish(connection, 'ended', connection.decision === false
          ? '接続を拒否し、共有を終了しました。'
          : '接続先が切断したか、共有が終了しました。', false);
        return;
      case 'waiting':
        this.publish(connection, { phase: 'waiting', code: connection.code, audio, detail: '視聴先からの接続を待っています。' });
        return;
      case 'pending':
        this.publish(connection, {
          phase: 'approval', code: connection.code, verification: snapshot.verification, audio,
          detail: '視聴先に表示された確認番号を照合し、接続を許可してください。',
        });
        return;
      case 'approved':
        break;
    }
    const abort = connection.controller.signal;
    let peer = connection.peer;
    if (!peer) {
      if (!connection.video || connection.video.readyState !== 'live') {
        this.finish(connection, 'ended', '画面共有が停止されました。');
        return;
      }
      this.startConnectionTimer(connection);
      this.publish(connection, { phase: 'connecting', audio, detail: '視聴先に接続しています。' });
      peer = this.createPeer(connection, () => {
        this.clearConnectionTimer(connection);
        this.publish(connection, { phase: 'connected', audio: connection.state.audio, detail: '画面を共有しています。' });
      });
      const options: RTCRtpTransceiverInit = { direction: 'sendonly', streams: [connection.stream] };
      peer.addTransceiver(connection.video, options);
      if (connection.audioTrack?.readyState === 'live') peer.addTransceiver(connection.audioTrack, options);
      const offer = await localDescription(peer, await peer.createOffer(), abort);
      await this.request(connection, 'offer', { description: offer });
    }
    if (snapshot.answer && peer.remoteDescription === null) {
      abort.throwIfAborted();
      await peer.setRemoteDescription(snapshot.answer);
    }
  }
}

type ReceiverConnection = Connection & {
  code: string;
  stream?: MediaStream;
  streamPublished: boolean;
};

export class MonitorReceiver extends MonitorSession<ReceiverConnection> {
  private readonly onStream: (stream: MediaStream | null) => void;

  constructor({ onState, onStream }: {
    onState: (state: MonitorConnectionState) => void;
    onStream: (stream: MediaStream | null) => void;
  }) {
    super(onState);
    this.onStream = onStream;
  }

  async connect(code: string): Promise<void> {
    const normalized = code.replace(/[\s-]/g, '').toUpperCase();
    if (this.current?.code === normalized) return;
    const connection: ReceiverConnection = {
      code: normalized,
      streamPublished: false,
      controller: new AbortController(),
      state: {
        phase: 'connecting',
        detail: '接続コードを確認しています。',
        audio: { available: false, output: 'both' },
      },
    };
    this.begin(connection);
    try {
      requireWebRTC();
      if (this.current !== connection) return;
      // Allow a late allocation to return its credentials so a canceled attempt can close it.
      const enrollment = await signal<Enrollment>('join', { code: normalized });
      if (!this.bindEnrollment(connection, enrollment)) return;
      void this.poll(connection, enrollment.snapshot, (snapshot) => this.apply(connection, snapshot));
    } catch (error) {
      const detail = error instanceof SignalError && [400, 404, 409].includes(error.status)
        ? '接続コードを使えません。配信元に表示された新しいコードを入力してください。'
        : '配信元に接続できませんでした。ネットワークを確認して、接続し直してください。';
      this.fail(connection, error, detail);
    }
  }

  disconnect(): void {
    if (this.current) this.finish(this.current, 'ended', '接続を切断しました。');
  }

  protected releaseMedia(connection: ReceiverConnection): void {
    for (const track of connection.stream?.getTracks() ?? []) track.stop();
    if (connection.streamPublished) this.onStream(null);
  }

  private async apply(connection: ReceiverConnection, snapshot: Snapshot): Promise<void> {
    const { audio } = snapshot;
    if (snapshot.phase === 'closed') {
      this.finish(connection, 'ended', '配信元が接続を拒否したか、画面共有を終了しました。', false);
      return;
    }
    if (snapshot.phase === 'pending' || snapshot.phase === 'waiting') {
      this.publish(connection, {
        phase: 'approval', verification: snapshot.verification, audio,
        detail: '確認番号を配信元と照合し、接続の許可を待ってください。',
      });
      return;
    }
    if (connection.state.phase === 'connected') {
      this.publish(connection, { ...connection.state, audio });
      return;
    }
    this.startConnectionTimer(connection);
    this.publish(connection, { phase: 'connecting', audio, detail: '共有映像に接続しています。' });
    if (!snapshot.offer || connection.peer) return;

    const abort = connection.controller.signal;
    const stream = new MediaStream();
    connection.stream = stream;
    const peer = this.createPeer(connection, () => {
      this.publishStream(connection);
    });
    peer.addEventListener('track', ({ track }) => {
      stream.addTrack(track);
      if (track.kind === 'video') {
        track.addEventListener('ended', () => {
          this.finish(connection, 'ended', '共有映像が終了しました。');
        }, { signal: abort, once: true });
      }
      this.publishStream(connection);
    }, { signal: abort });
    await peer.setRemoteDescription(snapshot.offer);
    abort.throwIfAborted();
    const answer = await localDescription(peer, await peer.createAnswer(), abort);
    await this.request(connection, 'answer', { description: answer });
  }

  private publishStream(connection: ReceiverConnection): void {
    const { peer, stream } = connection;
    const video = stream && liveTrack(stream.getVideoTracks());
    if (peer?.connectionState !== 'connected' || !stream || !video) return;
    connection.video = video;
    this.clearConnectionTimer(connection);
    if (!connection.streamPublished) {
      connection.streamPublished = true;
      this.onStream(stream);
    }
    this.publish(connection, { phase: 'connected', audio: connection.state.audio, detail: '共有映像を受信しています。' });
  }
}
