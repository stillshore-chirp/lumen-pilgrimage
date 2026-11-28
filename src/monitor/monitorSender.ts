import { MonitorPairingSource } from './monitorPairing';
import { describeMonitorVideo, measureMonitorVideo } from './monitorVideoMetrics';
import { captureErrorMessage, MonitorCapture } from './monitorCapture';
import { MonitorSender, type MonitorConnectionState, type MonitorOutput } from './monitorSession';
import './monitorSender.css';

export function mountMonitorSender(mount: HTMLElement): () => void {
  const view = document.createElement('main');
  view.className = 'monitor-sender';
  view.dataset.monitorSender = '';
  view.innerHTML = `
    <div class="monitor-sender__content">
      <header class="monitor-sender__header">
        <h1>仮想モニターへの画面共有</h1>
        <a data-viewer-link target="_blank" rel="noopener noreferrer">視聴画面を開く</a>
      </header>
      <div class="monitor-sender__panel">
        <p class="monitor-sender__status" role="status"></p>
        <label for="monitor-sender-output">音声の出力先</label>
        <select id="monitor-sender-output" aria-describedby="monitor-sender-audio-help">
          <option value="pc">PC側のみ</option>
          <option value="viewer">VR側のみ</option>
          <option value="both" selected>両方</option>
        </select>
        <p id="monitor-sender-audio-help">
          「VR側のみ」は対応ブラウザの共有タブに適用されます。PCのスピーカーやヘッドホンはOSの設定に従います。
        </p>
        <p data-monitor-capture-audio aria-live="polite" hidden></p>
        <div class="monitor-sender__actions">
          <button type="button" data-share-button>画面共有を開始</button>
          <button type="button" data-restart-button hidden>共有対象を選び直す</button>
        </div>
        <p>映像は動きの滑らかさを優先し、最大60fpsを要求します。</p>
        <button type="button" data-monitor-measure-video disabled>映像の滑らかさを計測</button>
        <p data-monitor-video-statistics role="status"></p>
        <section data-pairing hidden>
          <h2>ペアリングコード</h2>
          <code data-monitor-pair-code></code>
          <p>この端末の視聴画面から開いた場合は、コードを自動で渡します。別端末ではこのコードを入力してください。有効時間は発行から2分です。</p>
        </section>
        <section data-approval hidden>
          <h2>接続の確認</h2>
          <p>視聴先の確認番号と一致した相手だけを許可してください。</p>
          <code data-monitor-verification></code>
          <div class="monitor-sender__actions">
            <button type="button" data-approve>接続を許可</button>
            <button type="button" data-reject>接続を拒否</button>
          </div>
        </section>
      </div>
    </div>`;
  mount.replaceChildren(view);

  const viewerLink = view.querySelector<HTMLAnchorElement>('[data-viewer-link]')!;
  const viewerUrl = new URL(window.location.origin);
  viewerUrl.pathname = window.location.pathname;
  viewerLink.href = viewerUrl.href;
  const status = view.querySelector<HTMLElement>('[role="status"]')!;
  const output = view.querySelector<HTMLSelectElement>('#monitor-sender-output')!;
  const audioHelp = view.querySelector<HTMLElement>('[data-monitor-capture-audio]')!;
  const share = view.querySelector<HTMLButtonElement>('[data-share-button]')!;
  const restart = view.querySelector<HTMLButtonElement>('[data-restart-button]')!;
  const pairing = view.querySelector<HTMLElement>('[data-pairing]')!;
  const pairCode = view.querySelector<HTMLElement>('[data-monitor-pair-code]')!;
  const approval = view.querySelector<HTMLElement>('[data-approval]')!;
  const verification = view.querySelector<HTMLElement>('[data-monitor-verification]')!;
  const approve = view.querySelector<HTMLButtonElement>('[data-approve]')!;
  const reject = view.querySelector<HTMLButtonElement>('[data-reject]')!;

  const measure = view.querySelector<HTMLButtonElement>('[data-monitor-measure-video]')!;
  const statistics = view.querySelector<HTMLElement>('[data-monitor-video-statistics]')!;
  const localPairing = new MonitorPairingSource();
  let measurement: AbortController | undefined;

  const capture = new MonitorCapture(navigator.mediaDevices);
  const events = new AbortController();
  const unsupported = !window.isSecureContext
    ? '画面共有にはHTTPSまたはlocalhostで開いたページが必要です。'
    : !capture.supported || typeof RTCPeerConnection === 'undefined'
      ? 'このブラウザは画面共有に対応していません。PCの対応ブラウザで開いてください。'
      : '';
  let state: MonitorConnectionState | undefined;
  let preferredOutput: MonitorOutput = 'both';
  let message = '';
  let audioExplanation = '';
  let audioReselection = false;
  let generation = 0;
  let choosing = false;
  let deciding = false;

  const sender = new MonitorSender({
    onState(next) {
      if (events.signal.aborted) return;
      if (next.phase !== 'approval') deciding = false;
      if (next.phase === 'ended' || next.phase === 'failed') {
        localPairing.dispose();
        measurement?.abort();
        measurement = undefined;
        statistics.textContent = '';
        delete statistics.dataset.monitorVideoMeasurement;
        generation += 1;
        capture.stop();
        choosing = false;
      }
      state = next;
      render();
    },
  });

  function render() {
    const active = capture.active;
    const hasAudio = capture.hasAudio;
    const stoppable = choosing || active;
    let currentStatus = state?.detail || '共有する画面を選ぶと、ペアリングコードを表示します。';
    if (choosing) currentStatus = 'ブラウザのダイアログで画面、ウィンドウ、またはタブを選んでください。';
    if (active) {
      const detail = state?.phase === 'connected' ? '視聴先と接続しています。' : state?.detail || '接続を準備しています。';
      const pending = state?.audioPending ? '音声の設定を視聴先に反映中です。' : '';
      currentStatus = `共有中。${detail}${pending}`;
    }
    const text = unsupported || message || currentStatus;
    if (status.textContent !== text) status.textContent = text;
    status.dataset.active = String(active);
    share.textContent = stoppable ? '共有を停止' : '画面共有を開始';
    share.disabled = !!unsupported;
    restart.hidden = !active;
    restart.disabled = deciding;
    output.disabled = !!unsupported || choosing;
    output.value = active && hasAudio && !audioReselection ? state?.audio.output ?? preferredOutput : preferredOutput;
    let explanation = '';
    if (active) {
      explanation = hasAudio ? audioExplanation : capture.selectAudio(preferredOutput).explanation;
      if (hasAudio && capture.sharesFullDisplay && state?.audio.output !== 'pc') {
        const preventFeedback = '同じPCで視聴する場合は、音の回り込みを防ぐため、視聴側の「モニター音声」をオフにしてください。';
        explanation = explanation ? `${explanation} ${preventFeedback}` : preventFeedback;
      }
    }
    audioHelp.hidden = !explanation;
    if (audioHelp.textContent !== explanation) audioHelp.textContent = explanation;
    measure.disabled = !!measurement || state?.phase !== 'connected';
    measure.textContent = measurement ? '3秒間計測しています…' : '映像の滑らかさを計測';
    localPairing.publish(state?.phase === 'waiting' ? state.code : undefined);
    pairCode.textContent = state?.phase === 'waiting' ? state.code ?? '' : '';
    pairing.hidden = !pairCode.textContent;
    const restoreFocus = approval.contains(document.activeElement);
    verification.textContent = state?.phase === 'approval' ? state.verification ?? '' : '';
    approval.hidden = !verification.textContent;
    approve.disabled = reject.disabled = deciding;
    if (restoreFocus && approval.hidden) share.focus();
  }

  function release() {
    generation += 1;
    measurement?.abort();
    measurement = undefined;
    statistics.textContent = '';
    delete statistics.dataset.monitorVideoMeasurement;
    capture.stop();
    choosing = false;
    deciding = false;
    audioExplanation = '';
    audioReselection = false;
    sender.stop();
    state = undefined;
  }

  function stop() {
    if (!capture.active && !choosing) return;
    localPairing.dispose();
    release();
    message = '画面共有を停止しました。';
    render();
  }

  async function start() {
    if (unsupported || choosing || events.signal.aborted) return;
    release();
    message = '';
    choosing = true;
    const attempt = generation;
    const requested = preferredOutput;
    render();
    let stream: MediaStream | null;
    try {
      // Run the chooser directly in the button's activation.
      stream = await capture.open(requested);
    } catch (error) {
      if (attempt !== generation) return;
      choosing = false;
      message = captureErrorMessage(error);
      render();
      return;
    }
    if (attempt !== generation || !stream) return;
    if (!view.isConnected) {
      dispose();
      return;
    }
    choosing = false;
    const selection = capture.selectAudio(requested);
    audioExplanation = selection.explanation;
    audioReselection = !!selection.requiresReselection;
    if (selection.audio.available && !audioReselection) preferredOutput = selection.audio.output;
    await sender.start(stream, selection.audio);
  }

  function decide(accepted: boolean) {
    if (deciding || state?.phase !== 'approval' || !state.verification) return;
    deciding = true;
    render();
    void sender.decide(accepted);
  }

  function changeAudio() {
    preferredOutput = output.value as MonitorOutput;
    if (!capture.active) return;
    const selection = capture.selectAudio(preferredOutput, state?.audio.output);
    audioExplanation = selection.explanation;
    audioReselection = !!selection.requiresReselection;
    if (selection.audio.available && !audioReselection) preferredOutput = selection.audio.output;
    if (!selection.audio.available || selection.audio.output === state?.audio.output) {
      render();
      return;
    }
    void sender.updateAudio(selection.audio);
  }

  function dispose() {
    events.abort();
    localPairing.dispose();
    release();
    view.remove();
  }

  const listeners = { signal: events.signal };
  share.addEventListener('click', () => {
    if (capture.active || choosing) stop();
    else void start();
  }, listeners);
  restart.addEventListener('click', () => { void start(); }, listeners);
  approve.addEventListener('click', () => { decide(true); }, listeners);
  reject.addEventListener('click', () => { decide(false); }, listeners);
  output.addEventListener('change', changeAudio, listeners);
  measure.addEventListener('click', async () => {
    if (measurement || state?.phase !== 'connected') return;
    const attempt = new AbortController();
    measurement = attempt;
    delete statistics.dataset.monitorVideoMeasurement;
    statistics.textContent = 'この画面を手前に置き、動きのある映像でお待ちください。';
    render();
    try {
      const result = await measureMonitorVideo(() => sender.videoStats(), attempt.signal);
      if (!attempt.signal.aborted) {
        statistics.dataset.monitorVideoMeasurement = JSON.stringify(result);
        statistics.textContent = describeMonitorVideo(result, 'sender');
      }
    } catch {
      if (!attempt.signal.aborted) statistics.textContent = '映像を計測できませんでした。接続とブラウザーの対応を確認してください。';
    } finally {
      if (measurement === attempt) measurement = undefined;
      if (!events.signal.aborted) render();
    }
  }, listeners);
  window.addEventListener('pagehide', () => { localPairing.dispose(); stop(); }, listeners);
  render();
  return dispose;
}
