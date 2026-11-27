import './kotoAudition.css';
import { LAKE_HALL, LAKE_SPAWN } from '../coast/world/lake/lakeLayout';
import { createLakeKotoSpeakerArray } from '../coast/world/lake/lakeKotoSpeakers';
import { LAKE_AUDIO_MASTER_GAIN } from '../coast/world/lake/lakeAudio';
import { connectExplorationOutput } from '../coast/explorationOutput';

interface StudyMethod {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly nativeSampleRate: number | null;
  readonly reason?: string;
  readonly limitations: readonly string[];
  readonly sourceHashes: unknown;
}
interface StudyCase {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly durationSeconds: number;
}
interface StudyClip {
  readonly id: string;
  readonly method: string;
  readonly case: string;
  readonly sampleRate: number;
  readonly frames: number;
  readonly durationSeconds: number;
  readonly rawWav: string;
  readonly matchedWav: string;
  readonly visualization: string;
  readonly measurements: Record<string, unknown>;
  readonly matchGainDb: number;
  readonly commonSafetyGainDb: number;
}
interface StudyManifest {
  readonly schemaVersion: 1;
  readonly sampleRate: number;
  readonly channels: number;
  readonly baseline: { readonly revision: string; readonly sourcePath: string; readonly sha256: string };
  readonly methods: readonly StudyMethod[];
  readonly cases: readonly StudyCase[];
  readonly clips: readonly StudyClip[];
  readonly normalization: Record<string, unknown>;
  readonly unperformed: readonly string[];
  readonly unavailableClips: readonly { readonly method: string; readonly case: string; readonly reason: string }[];
}
interface Visualization {
  readonly waveform: { readonly timesSeconds: readonly number[]; readonly min: readonly number[]; readonly max: readonly number[] };
  readonly spectrum: { readonly frequenciesHz: readonly number[]; readonly dbfs: readonly number[]; readonly windowSeconds: readonly number[] };
}
interface ListeningDraft { heard: boolean; judgement: string; notes: string; equipment: string }
interface ReviewEntry { readonly condition: Record<string, unknown>; readonly evaluation: ListeningDraft }

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing audition root');
root.innerHTML = `
  <header>
    <div><div class="brand">Lumen Pilgrimage / Sound study</div><h1>箏の試聴室</h1>
      <p class="lede">ひとつの音を、同じ条件で。旧音源と研究中の方式を切り替え、音の立ち上がり、余韻、奏法を確かめます。</p></div>
    <nav aria-label="関連する場所"><a href="/?world=lake" id="lake-link">湖畔の広間で聴く ↗</a></nav>
  </header>
  <main id="audition">
    <section class="panel" aria-labelledby="methods-heading">
      <p class="section-label">01 / 音源を選ぶ</p><h2 id="methods-heading">比較する方式</h2>
      <div class="method-grid" id="methods"></div>
      <p id="dataset-status" role="status" aria-live="polite">比較データを読み込んでいます。</p>
      <button id="reload" hidden>データを再読み込み</button>
    </section>
    <div class="workbench">
      <section class="panel" aria-labelledby="playback-heading">
        <p class="section-label">02 / 同じ条件で聴く</p><h2 id="playback-heading">試聴</h2>
        <div class="control-grid">
          <label class="wide"><span>演奏・奏法</span><select id="case" disabled></select></label>
          <label><span>音の経路</span><select id="route"><option value="dry">乾音（空間処理なし）</option><option value="lake">湖畔・天井12スピーカー</option></select></label>
          <label class="check"><input type="checkbox" id="matched" checked><span>音量整合を使う</span></label>
          <label><span>聴く位置</span><select id="position"><option value="center">広間の中央</option><option value="west">西の窓辺</option><option value="east">東の窓辺</option><option value="rear">広間の後方</option></select></label>
          <label><span>顔の向き</span><select id="orientation"><option value="0">湖へ</option><option value="90">西へ</option><option value="180">後方へ</option><option value="270">東へ</option></select></label>
        </div>
        <p><small>単音・奏法・短旋律は中音・通常強度のRMSを基準に方式ごとの共通ゲインを適用し、弱音と強音の差を保ちます。全曲は全39秒のRMSを別に整合します。RMSがそろっても、聴感上の音量が同じとは限りません。</small></p>
        <div class="transport" role="group" aria-label="再生操作"><button id="play" class="primary" aria-describedby="play-status" disabled>再生</button><button id="stop" disabled>停止</button><button id="replay" aria-describedby="play-status" disabled>先頭から</button><button id="use-available-case" hidden>再生できる演奏に戻す</button></div>
        <p class="status" id="play-status" role="status" aria-live="polite">音源を選ぶと再生できます。</p>
        <div class="volume-row"><label for="volume">出力音量</label><input id="volume" type="range" min="0" max="100" value="20"><output for="volume" id="volume-value">20%</output></div>
        <label class="check"><input type="checkbox" id="loop"><span>繰り返し再生</span></label>
        <p><small>方式・奏法・経路・整合条件の変更で停止します。再生は常にひとつです。位置と向きは湖畔経路に適用します。</small></p>
      </section>
      <aside class="panel" aria-labelledby="conditions-heading">
        <p class="section-label">比較の手がかり</p><h2 id="conditions-heading">現在の条件</h2>
        <dl class="conditions" id="conditions"></dl>
        <p class="warning"><small>測定と音質評価は別です。人間が聴いて記録するまで、自然さ・完成音質は未評価です。</small></p>
      </aside>
    </div>
    <section class="panel data-panel" aria-labelledby="data-heading">
      <p class="section-label">03 / 音の形を見る</p><h2 id="data-heading">波形とスペクトル</h2>
      <p id="data-status" class="muted">音源データの読み込み後に表示します。</p>
      <div class="chart-grid">
        <figure><svg id="waveform" class="chart" viewBox="0 0 600 204" role="img" aria-label="波形。横軸は秒、縦軸は振幅、範囲はマイナス1から1。"></svg><figcaption id="wave-caption">波形 / 横軸: 秒 · 縦軸: 振幅 −1〜1</figcaption></figure>
        <figure><svg id="spectrum" class="chart" viewBox="0 0 600 204" role="img" aria-label="周波数スペクトル。横軸はヘルツの対数軸、縦軸はdBFS。"></svg><figcaption id="spectrum-caption">スペクトル / 横軸: Hz（対数） · 縦軸: dBFS</figcaption></figure>
      </div>
      <dl class="metric-grid" id="metrics"></dl>
      <details><summary>測定値とデータの詳細</summary><pre id="measurement-detail">未選択</pre></details>
    </section>
    <section class="panel notes-panel" aria-labelledby="notes-heading">
      <p class="section-label">04 / 聴いたことを残す</p><h2 id="notes-heading">評価メモ</h2>
      <p class="muted">条件ごとにメモを保持します。書き出したJSONには音源・整合・経路・位置・向き・音量と所見が入ります。</p>
      <div class="notes-grid">
        <label class="check wide"><input type="checkbox" id="heard"><span>この条件で、人間が実際に試聴した</span></label>
        <label><span>聴取者の判定</span><select id="judgement" disabled><option value="unevaluated">未評価</option><option value="concerns">気になる点がある</option><option value="acceptable">許容できる</option><option value="candidate">採用候補にしたい</option></select></label>
        <label><span>使用機器・聴く環境</span><input type="text" id="equipment" maxlength="1000" placeholder="例: ヘッドホン、OSとブラウザー、静かな室内"></label>
        <label class="wide"><span>音色・余韻・奏法・定位についての所見</span><textarea id="notes" maxlength="10000" placeholder="何が、どの瞬間に、どう聞こえたかを記録"></textarea></label>
      </div>
      <div class="notes-actions"><button id="export" disabled>比較条件とメモを書き出す</button><span id="note-status" role="status" aria-live="polite">人間の聴感: 未評価</span></div>
      <p><small>メモはこのタブ内で保持し、JSONを端末へ保存します。サーバーへ送信しません。ページを閉じる前に書き出してください。</small></p>
    </section>
  </main>
  <footer>開発用の比較環境。通常の配布ページには含まれません。録音素材の採否と研究結果は比較データの記録を参照してください。</footer>`;

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing audition control');
  return node as T;
}
const controls = {
  methods: element<HTMLDivElement>('methods'), cases: element<HTMLSelectElement>('case'), route: element<HTMLSelectElement>('route'),
  matched: element<HTMLInputElement>('matched'), position: element<HTMLSelectElement>('position'), orientation: element<HTMLSelectElement>('orientation'),
  play: element<HTMLButtonElement>('play'), stop: element<HTMLButtonElement>('stop'), replay: element<HTMLButtonElement>('replay'),
  availableCase: element<HTMLButtonElement>('use-available-case'),
  loop: element<HTMLInputElement>('loop'), volume: element<HTMLInputElement>('volume'), volumeValue: element<HTMLOutputElement>('volume-value'),
  heard: element<HTMLInputElement>('heard'), judgement: element<HTMLSelectElement>('judgement'),
  notes: element<HTMLTextAreaElement>('notes'), equipment: element<HTMLInputElement>('equipment'), export: element<HTMLButtonElement>('export'),
};
let manifest: StudyManifest | undefined;
let manifestUrl: URL;
let selectedMethod = '';
let context: AudioContext | undefined;
let output: GainNode | undefined;
let lakeOutput: GainNode | undefined;
let lakeOutputNodes: readonly AudioNode[] = [];
let source: AudioBufferSourceNode | undefined;
let sourceLevel: GainNode | undefined;
let speakerArray: ReturnType<typeof createLakeKotoSpeakerArray> | undefined;
let stopSettled: Promise<void> = Promise.resolve();
const fading = new Map<AudioBufferSourceNode, () => void>();
let playGeneration = 0;
let playAbort: AbortController | undefined;
let dataGeneration = 0;
let dataAbort: AbortController | undefined;
let disposed = false;
let busy = false;
let currentKey = '';
let currentCondition: Record<string, unknown> = {};
const reviews = new Map<string, ReviewEntry>();
const decodedProtectionDb = new Map<string, number>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Invalid comparison data');
  return value;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4000) throw new Error('Invalid comparison text');
  return value;
}
function number(value: unknown, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid comparison number');
  return value;
}
function list(value: unknown, limit: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error('Invalid comparison list');
  return value;
}
function sameOriginUrl(path: string, base: URL): URL {
  const url = new URL(path, base);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only same-origin comparison data is supported');
  }
  return url;
}
async function fetchJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: 'same-origin', redirect: 'error' });
  if (!response.ok) throw new Error('Comparison data unavailable');
  const text = await response.text();
  if (text.length > 5_000_000) throw new Error('Comparison data too large');
  return JSON.parse(text) as unknown;
}
function parseManifest(value: unknown): StudyManifest {
  const data = record(value);
  if (data.schemaVersion !== 1 || data.channels !== 1) throw new Error('Unsupported comparison schema');
  const methods = list(data.methods, 16).map(value => {
    const item = record(value);
    return { id: string(item.id), label: string(item.label), status: string(item.status),
      nativeSampleRate: item.nativeSampleRate == null ? null : number(item.nativeSampleRate, 8000, 192000),
      reason: item.reason == null ? undefined : string(item.reason), limitations: item.limitations == null ? [] : list(item.limitations, 32).map(string),
      sourceHashes: item.sourceHashes ?? null };
  });
  const cases = list(data.cases, 64).map(value => {
    const item = record(value);
    return { id: string(item.id), label: string(item.label), kind: string(item.kind), durationSeconds: number(item.durationSeconds, 0.001, 300) };
  });
  const clips = list(data.clips, 512).map(value => {
    const item = record(value);
    const clip = { id: string(item.id), method: string(item.method), case: string(item.case), sampleRate: number(item.sampleRate, 8000, 192000),
      frames: number(item.frames, 1, 57_600_000), durationSeconds: number(item.durationSeconds, 0.001, 300),
      rawWav: string(item.rawWav), matchedWav: string(item.matchedWav), visualization: string(item.visualization),
      measurements: record(item.measurements), matchGainDb: number(item.matchGainDb), commonSafetyGainDb: number(item.commonSafetyGainDb) };
    for (const path of [clip.rawWav, clip.matchedWav, clip.visualization]) sameOriginUrl(path, manifestUrl);
    if (!methods.some(method => method.id === clip.method) || !cases.some(testCase => testCase.id === clip.case)) throw new Error('Unknown clip reference');
    return clip;
  });
  if (new Set(methods.map(item => item.id)).size !== methods.length || new Set(cases.map(item => item.id)).size !== cases.length
    || new Set(clips.map(item => item.id)).size !== clips.length || new Set(clips.map(item => `${item.method}/${item.case}`)).size !== clips.length) throw new Error('Duplicate comparison identifier');
  const baseline = record(data.baseline);
  const unavailableClips = data.unavailableClips == null ? [] : list(data.unavailableClips, 512).map(value => {
    const item = record(value);
    return { method: string(item.method), case: string(item.case), reason: string(item.reason) };
  });
  return { schemaVersion: 1, sampleRate: number(data.sampleRate, 8000, 192000), channels: 1,
    baseline: { revision: string(baseline.revision), sourcePath: string(baseline.sourcePath), sha256: string(baseline.sha256) },
    methods, cases, clips, normalization: record(data.normalization), unperformed: list(data.unperformed, 64).map(string), unavailableClips };
}
function selectedClip(): StudyClip | undefined {
  const method = manifest?.methods.find(item => item.id === selectedMethod);
  if (!method || ['unavailable', 'rejected', 'ineligible'].includes(method.status)) return undefined;
  return manifest?.clips.find(clip => clip.method === selectedMethod && clip.case === controls.cases.value);
}
function methodAvailable(method: StudyMethod, data: StudyManifest): boolean {
  return !['unavailable', 'rejected', 'ineligible'].includes(method.status) && data.clips.some(clip => clip.method === method.id);
}
function unavailableReason(): string {
  return manifest?.unavailableClips.find(item => item.method === selectedMethod && item.case === controls.cases.value)?.reason
    ?? 'この組み合わせの音声はありません。別の方式か演奏を選んでください。';
}
function preferredAvailableCase(): StudyCase | undefined {
  if (!manifest) return undefined;
  const method = manifest.methods.find(item => item.id === selectedMethod);
  if (!method || !methodAvailable(method, manifest)) return undefined;
  const available = manifest.cases.filter(item => manifest?.clips.some(clip => clip.method === selectedMethod && clip.case === item.id));
  return available.find(item => item.id === 'mid-normal') ?? available.find(item => item.id === 'score-39') ?? available[0];
}
function ensureAvailableCase(): string | undefined {
  if (selectedClip()) return undefined;
  const next = preferredAvailableCase();
  if (!next) return undefined;
  const previous = manifest?.cases.find(item => item.id === controls.cases.value)?.label ?? controls.cases.value;
  const method = manifest?.methods.find(item => item.id === selectedMethod)?.label ?? 'この方式';
  controls.cases.value = next.id;
  return `「${method}」には「${previous}」の音声がないため、「${next.label}」へ切り替えました。再生を押してください。`;
}
function unavailablePlaybackMessage(): string {
  const method = manifest?.methods.find(item => item.id === selectedMethod)?.label ?? '選択中の方式';
  const testCase = manifest?.cases.find(item => item.id === controls.cases.value)?.label ?? '選択中の演奏';
  const next = preferredAvailableCase();
  const recovery = next ? `「再生できる演奏に戻す」を押すか、「演奏・奏法」で「${next.label}」を選んでください。` : '別の方式を選んでください。';
  return `「${method}」の「${testCase}」は音声がないため再生できません。${recovery} 理由: ${unavailableReason()}`;
}
function text(id: string, value: string): void { element(id).textContent = value; }
function setPlaybackStatus(value: string): void { text('play-status', value); }
function updateButtons(): void {
  const available = selectedClip() !== undefined;
  controls.play.disabled = !available || busy || source !== undefined;
  controls.stop.disabled = !busy && !source;
  controls.replay.disabled = !available;
  controls.export.disabled = !manifest;
  controls.availableCase.hidden = available || preferredAvailableCase() === undefined;
}
function stopPlayback(message = '停止しました。'): void {
  playGeneration += 1;
  playAbort?.abort();
  playAbort = undefined;
  const previous = source;
  const previousLevel = sourceLevel;
  source = undefined;
  sourceLevel = undefined;
  busy = false;
  if (previous && previousLevel && context) {
    const now = context.currentTime;
    const activeLevel = previousLevel.gain.value;
    previousLevel.gain.cancelScheduledValues(now);
    previousLevel.gain.setValueAtTime(activeLevel, now);
    previousLevel.gain.linearRampToValueAtTime(0, now + .012);
    previous.stop(now + .012);
    stopSettled = new Promise(resolve => {
      let timer = 0;
      const finish = () => {
        clearTimeout(timer);
        previous.onended = null;
        previous.disconnect();
        previousLevel.disconnect();
        fading.delete(previous);
        resolve();
      };
      fading.set(previous, finish);
      previous.onended = finish;
      // A suspended context may not dispatch ended. Disconnect before a new play.
      timer = window.setTimeout(finish, 80);
    });
  }
  setPlaybackStatus(message);
  updateButtons();
}
function rawProtectionDb(clip: StudyClip | undefined): number {
  if (clip && decodedProtectionDb.has(clip.id)) return decodedProtectionDb.get(clip.id) ?? 0;
  const peak = clip?.measurements.samplePeakDbfs;
  return typeof peak === 'number' && Number.isFinite(peak) ? Math.min(0, -3 - peak) : 0;
}
function storeReview(): void {
  if (!currentKey) return;
  const heard = controls.heard.checked;
  reviews.set(currentKey, { condition: currentCondition, evaluation: {
    heard, judgement: heard ? controls.judgement.value : 'unevaluated', notes: controls.notes.value, equipment: controls.equipment.value,
  } });
}
function listenerPosition(): { x: number; y: number; z: number } {
  const y = 1.65;
  switch (controls.position.value) {
    case 'west': return { x: -LAKE_HALL.halfWidth + 1.5, y, z: LAKE_SPAWN.z };
    case 'east': return { x: LAKE_HALL.halfWidth - 1.5, y, z: LAKE_SPAWN.z };
    case 'rear': return { x: 0, y, z: LAKE_HALL.rearZ - 2 };
    default: return { x: LAKE_SPAWN.x, y, z: LAKE_SPAWN.z };
  }
}
function refreshReview(): void {
  const clip = selectedClip();
  currentCondition = { clipId: clip?.id ?? null, method: selectedMethod, case: controls.cases.value,
    loudnessMatched: controls.matched.checked, route: controls.route.value,
    position: controls.position.value, listener: listenerPosition(), yawDegrees: Number(controls.orientation.value),
    volumePercent: Number(controls.volume.value), loop: controls.loop.checked,
    audioPath: clip ? (controls.matched.checked ? clip.matchedWav : clip.rawWav) : null,
    matchGainDb: controls.matched.checked ? clip?.matchGainDb ?? null : 0,
    commonSafetyGainDb: controls.matched.checked ? clip?.commonSafetyGainDb ?? null : 0 };
  currentCondition.rawProtectionGainDb = controls.matched.checked ? 0 : rawProtectionDb(clip);
  if (!clip) currentCondition.unavailableReason = unavailableReason();
  currentKey = JSON.stringify([selectedMethod, controls.cases.value, clip?.id, controls.matched.checked, controls.route.value,
    controls.position.value, controls.orientation.value, controls.volume.value, controls.loop.checked]);
  const draft = reviews.get(currentKey)?.evaluation;
  controls.heard.checked = draft?.heard ?? false;
  controls.judgement.value = draft?.judgement ?? 'unevaluated';
  controls.notes.value = draft?.notes ?? '';
  controls.equipment.value = draft?.equipment ?? '';
  updateJudgement();
}
function updateJudgement(): void {
  controls.judgement.disabled = !controls.heard.checked;
  if (!controls.heard.checked) controls.judgement.value = 'unevaluated';
  const label = controls.judgement.selectedOptions[0]?.textContent ?? '未評価';
  text('note-status', `人間の聴感: ${controls.heard.checked ? label : '未評価'}`);
}
function addCondition(label: string, value: string): void {
  const row = document.createElement('div');
  const term = document.createElement('dt'); term.textContent = label;
  const description = document.createElement('dd'); description.textContent = value;
  row.append(term, description); element('conditions').append(row);
}
function refreshConditions(): void {
  const clip = selectedClip();
  const method = manifest?.methods.find(item => item.id === selectedMethod);
  for (const option of controls.cases.options) {
    const testCase = manifest?.cases.find(item => item.id === option.value);
    const available = manifest?.clips.some(item => item.method === selectedMethod && item.case === option.value);
    option.textContent = `${testCase?.label ?? option.value}${available ? '' : '（この方式の音声なし）'}`;
  }
  element('conditions').replaceChildren();
  addCondition('方式 / 演奏', `${method?.label ?? '未選択'} / ${controls.cases.selectedOptions[0]?.textContent ?? '未選択'}`);
  addCondition('音声形式', clip ? `${clip.sampleRate.toLocaleString()} Hz / mono / ${clip.durationSeconds.toFixed(2)} 秒` : `比較音声なし · ${unavailableReason()}`);
  if (clip) {
    const gates = isRecord(clip.measurements.gates) ? clip.measurements.gates : {};
    const labels: Record<string, string> = { pitch: '音高', damping: '消音', performancePress: '曲内の押し手到達',
      finite: '有限値', dc: '直流偏り', duration: '長さ', loopSeam: 'ループ接続', final50ms: '終端' };
    const failures = Object.entries(gates).filter(([, result]) => result === false).map(([key]) => labels[key] ?? key);
    const note = isRecord(clip.measurements.note) ? clip.measurements.note : {};
    const pitch = isRecord(note.pitch) ? note.pitch : {};
    const missingPitch = pitch.measuredHz === null ? ' / 音高: 欠測（null）' : '';
    const result = failures.length ? `不合格: ${failures.join('・')}` : Object.keys(gates).length ? '記録されたgateに不合格なし' : 'gateの判定記録なし';
    addCondition('客観測定（聴感とは別）', `${result}${missingPitch}`);
  }
  addCondition('音量整合', controls.matched.checked ? `ON · 方式 ${clip?.matchGainDb.toFixed(2) ?? '—'} dB / 共通安全 ${clip?.commonSafetyGainDb.toFixed(2) ?? '—'} dB` : `OFF · 元のレンダー + peak保護 ${rawProtectionDb(clip).toFixed(2)} dB`);
  addCondition('ピーク保護', '整合OFF時も −3 dBFSを上限に減衰します。純raw計測値と再生振幅は異なる場合があります。');
  addCondition('経路 / 聴取点', `${controls.route.selectedOptions[0]?.textContent} / ${controls.position.selectedOptions[0]?.textContent} / ${controls.orientation.selectedOptions[0]?.textContent}`);
  if (controls.route.value === 'lake') addCondition('湖畔の最終出力', `本番と共通の12 HRTF・位置ゲイン・マスター${LAKE_AUDIO_MASTER_GAIN}・最終リミッターを通します。環境音は含めません。`);
  addCondition('旧音源の版', manifest?.baseline.revision ?? '未取得');
  addCondition('この比較データの生成時に未実施', manifest?.unperformed.join(' / ') || '記録なし（聴感の評価は下欄へ）');
  controls.position.disabled = controls.route.value === 'dry';
  controls.orientation.disabled = controls.route.value === 'dry';
}
function changeSelection(loadVisualization = true, notice?: string): void {
  storeReview();
  stopPlayback(selectedClip() ? notice ?? '比較条件を変更しました。再生を押すと先頭から聴けます。' : unavailablePlaybackMessage());
  refreshConditions();
  refreshReview();
  updateButtons();
  if (loadVisualization) void loadCharts();
}
async function play(): Promise<void> {
  stopPlayback('音声を準備しています。');
  const clip = selectedClip();
  if (!clip || disposed) return;
  const generation = playGeneration;
  const abort = new AbortController();
  playAbort = abort;
  busy = true;
  updateButtons();
  try {
    // The context is created and resumed by the click, before asynchronous loading.
    context ??= new AudioContext({ sampleRate: manifest?.sampleRate ?? 48000 });
    const audioContext = context;
    await audioContext.resume();
    if (!output) {
      output = audioContext.createGain();
      output.gain.value = Number(controls.volume.value) / 100;
      output.connect(audioContext.destination);
      lakeOutput = audioContext.createGain();
      lakeOutput.gain.value = LAKE_AUDIO_MASTER_GAIN * Number(controls.volume.value) / 100;
      lakeOutputNodes = connectExplorationOutput(audioContext, lakeOutput);
      speakerArray = createLakeKotoSpeakerArray(audioContext, lakeOutput);
    }
    const path = controls.matched.checked ? clip.matchedWav : clip.rawWav;
    const response = await fetch(sameOriginUrl(path, manifestUrl), { signal: abort.signal, credentials: 'same-origin', redirect: 'error' });
    if (!response.ok) throw new Error('Audio unavailable');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 64_000_000) throw new Error('Audio too large');
    const buffer = await audioContext.decodeAudioData(bytes);
    await stopSettled;
    if (disposed || generation !== playGeneration) return;
    const listener = listenerPosition();
    const yaw = Number(controls.orientation.value) * Math.PI / 180;
    if (audioContext.listener.positionX) {
      audioContext.listener.positionX.value = listener.x;
      audioContext.listener.positionY.value = listener.y;
      audioContext.listener.positionZ.value = listener.z;
      audioContext.listener.forwardX.value = -Math.sin(yaw);
      audioContext.listener.forwardY.value = 0;
      audioContext.listener.forwardZ.value = -Math.cos(yaw);
      audioContext.listener.upX.value = 0;
      audioContext.listener.upY.value = 1;
      audioContext.listener.upZ.value = 0;
    } else {
      audioContext.listener.setPosition(listener.x, listener.y, listener.z);
      audioContext.listener.setOrientation(-Math.sin(yaw), 0, -Math.cos(yaw), 0, 1, 0);
    }
    speakerArray?.update(listener, audioContext.currentTime, true);
    let peak = 0;
    if (!controls.matched.checked) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        for (const value of buffer.getChannelData(channel)) {
          if (!Number.isFinite(value)) throw new Error('Nonfinite audio sample');
          peak = Math.max(peak, Math.abs(value));
        }
      }
    }
    const protection = controls.matched.checked ? 1 : Math.min(1, 10 ** (-3 / 20) / Math.max(peak, 1e-12));
    currentCondition.decodedSampleRate = buffer.sampleRate;
    if (!controls.matched.checked) {
      decodedProtectionDb.set(clip.id, 20 * Math.log10(protection));
      currentCondition.rawProtectionGainDb = 20 * Math.log10(protection);
      refreshConditions();
    }
    const next = audioContext.createBufferSource();
    const level = audioContext.createGain();
    level.gain.setValueAtTime(0, audioContext.currentTime);
    level.gain.linearRampToValueAtTime(protection, audioContext.currentTime + .012);
    next.buffer = buffer;
    next.loop = controls.loop.checked;
    next.connect(level).connect(controls.route.value === 'lake' && speakerArray ? speakerArray.input : output);
    source = next;
    sourceLevel = level;
    next.onended = () => {
      if (source !== next) return;
      source = undefined;
      sourceLevel = undefined;
      next.disconnect();
      level.disconnect();
      setPlaybackStatus('最後まで再生しました。人間の聴感は評価メモで記録してください。');
      updateButtons();
    };
    next.start();
    busy = false;
    playAbort = undefined;
    setPlaybackStatus(`${manifest?.methods.find(item => item.id === clip.method)?.label} · ${controls.cases.selectedOptions[0]?.textContent} を再生中${next.loop ? '（繰り返し）' : ''}。`);
    updateButtons();
  } catch {
    if (!disposed && generation === playGeneration) {
      busy = false;
      playAbort = undefined;
      setPlaybackStatus('音声を再生できません。比較音声を生成したか確認し、もう一度再生してください。');
      updateButtons();
    }
  }
}
function numbers(value: unknown): readonly number[] { return list(value, 4096).map(value => number(value)); }
function parseVisualization(value: unknown): Visualization {
  const data = record(value), waveform = record(data.waveform), spectrum = record(data.spectrum);
  if (data.schemaVersion !== 1 || data.signal !== 'raw') throw new Error('Unsupported visualization schema');
  const result = { waveform: { timesSeconds: numbers(waveform.timesSeconds), min: numbers(waveform.min), max: numbers(waveform.max) },
    spectrum: { frequenciesHz: numbers(spectrum.frequenciesHz), dbfs: numbers(spectrum.dbfs), windowSeconds: spectrum.windowSeconds == null ? [] : numbers(spectrum.windowSeconds) } };
  const w = result.waveform, s = result.spectrum;
  if (w.timesSeconds.length < 2 || w.timesSeconds.length !== w.min.length || w.min.length !== w.max.length
    || s.frequenciesHz.length < 2 || s.frequenciesHz.length !== s.dbfs.length) throw new Error('Invalid visualization dimensions');
  return result;
}
function drawChart(id: string, paths: readonly { d: string; color: string }[], labels: readonly string[]): void {
  const svg = document.getElementById(id);
  if (!svg) return;
  svg.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  for (const y of [28, 98, 168]) {
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', `M48 ${y}H580`); line.setAttribute('stroke', '#3c554b'); svg.append(line);
  }
  for (const { d, color } of paths) {
    const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d);
    path.setAttribute('stroke', color); path.setAttribute('fill', 'none'); path.setAttribute('stroke-width', '1.3'); svg.append(path);
  }
  labels.forEach((label, i) => {
    const text = document.createElementNS(ns, 'text'); text.textContent = label;
    text.setAttribute('x', String(48 + i * 266)); text.setAttribute('y', '193');
    text.setAttribute('text-anchor', i === 2 ? 'end' : i === 1 ? 'middle' : 'start'); text.setAttribute('font-size', '13'); text.setAttribute('fill', '#b6c9bf'); svg.append(text);
  });
}
async function loadCharts(): Promise<void> {
  dataAbort?.abort();
  dataAbort = new AbortController();
  const generation = ++dataGeneration;
  const clip = selectedClip();
  element('metrics').replaceChildren();
  document.getElementById('waveform')?.replaceChildren();
  document.getElementById('spectrum')?.replaceChildren();
  text('measurement-detail', clip ? JSON.stringify({ clip, normalization: manifest?.normalization }, null, 2) : 'この組み合わせの音声はありません。');
  if (!clip) { text('data-status', `比較音声なし · ${unavailableReason()}`); return; }
  text('data-status', '波形とスペクトルを読み込んでいます。');
  const stats = controls.matched.checked && isRecord(clip.measurements.matched) ? clip.measurements.matched : clip.measurements;
  const formatted = (value: unknown, unit: string) => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)} ${unit}` : '未測定';
  const metrics: readonly [string, string][] = [['長さ', `${clip.durationSeconds.toFixed(2)} 秒`], ['サンプルレート', `${clip.sampleRate.toLocaleString()} Hz`],
    ['サンプルピーク（乾音）', formatted(stats.samplePeakDbfs, 'dBFS')], ['RMS（乾音）', formatted(stats.rmsDbfs, 'dBFS')]];
  for (const [label, value] of metrics) {
    const div = document.createElement('div'); div.className = 'metric';
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value; div.append(dt, dd); element('metrics').append(div);
  }
  try {
    const data = parseVisualization(await fetchJson(sameOriginUrl(clip.visualization, manifestUrl), dataAbort.signal));
    if (disposed || generation !== dataGeneration) return;
    const gainDb = controls.matched.checked ? clip.matchGainDb + clip.commonSafetyGainDb : 0;
    const gain = 10 ** (gainDb / 20);
    const w = data.waveform, s = data.spectrum;
    const end = Math.max(...w.timesSeconds, .001);
    const extent = Math.max(1, ...w.min.map(value => Math.abs(value * gain)), ...w.max.map(value => Math.abs(value * gain)));
    const waveformPath = w.timesSeconds.map((time, i) => `M${(48 + time / end * 532).toFixed(2)} ${(98 - w.min[i] * gain / extent * 70).toFixed(2)}V${(98 - w.max[i] * gain / extent * 70).toFixed(2)}`).join('');
    drawChart('waveform', [{ d: waveformPath, color: '#c8eddf' }], ['0 秒', `${(end / 2).toFixed(1)} 秒`, `${end.toFixed(1)} 秒`]);
    text('wave-caption', `波形 / 横軸: 秒 · 縦軸: 振幅 −${extent.toFixed(2)}〜${extent.toFixed(2)}`);
    document.getElementById('waveform')?.setAttribute('aria-label', `波形。横軸は秒、縦軸は振幅、範囲はマイナス${extent.toFixed(2)}から${extent.toFixed(2)}。`);
    const minHz = 20, maxHz = clip.sampleRate / 2;
    const topDb = Math.max(0, ...s.dbfs.map(value => value + gainDb));
    const points = s.frequenciesHz.flatMap((hz, i) => hz < minHz || hz > maxHz ? [] : [[48 + Math.log(hz / minHz) / Math.log(maxHz / minHz) * 532, 168 - (Math.max(-100, s.dbfs[i] + gainDb) + 100) / (100 + topDb) * 140]]);
    const spectrumPath = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('');
    drawChart('spectrum', [{ d: spectrumPath, color: '#f0c8a8' }], ['20 Hz', `${Math.round(Math.sqrt(minHz * maxHz))} Hz`, `${(maxHz / 1000).toFixed(0)} kHz`]);
    const windowText = s.windowSeconds.length === 2 ? `解析窓 ${s.windowSeconds[0].toFixed(3)}〜${s.windowSeconds[1].toFixed(3)} 秒。` : '';
    text('data-status', `表示: ${controls.matched.checked ? '音量整合後' : '元のレンダー（再生時のpeak保護前）'}の乾音。出力音量・空間処理は図に含めません。スペクトルの表示範囲は −100〜${topDb.toFixed(1)} dBFS。${windowText}`);
  } catch {
    if (!disposed && generation === dataGeneration) text('data-status', '図のデータを読み込めません。測定の詳細は下の数値から確認できます。');
  }
}
async function loadManifest(): Promise<void> {
  stopPlayback('比較データを読み込んでいます。');
  text('dataset-status', '比較データを読み込んでいます。');
  element<HTMLButtonElement>('reload').hidden = true;
  try {
    const path = new URLSearchParams(location.search).get('manifest') ?? '/artifacts/koto-study/manifest.json';
    manifestUrl = sameOriginUrl(path, new URL(location.href));
    const loaded = parseManifest(await fetchJson(manifestUrl));
    if (disposed) return;
    manifest = loaded;
    selectedMethod = loaded.methods.find(method => methodAvailable(method, loaded))?.id ?? '';
    controls.methods.replaceChildren();
    for (const method of loaded.methods) {
      const available = methodAvailable(method, loaded);
      const button = document.createElement('button'); button.className = 'method';
      button.type = 'button'; button.disabled = !available; button.dataset.method = method.id;
      button.setAttribute('aria-pressed', String(method.id === selectedMethod));
      const name = document.createElement('strong'); name.textContent = method.label;
      const statusLabel = ({ rendered: '研究出力', provisional: '暫定・研究用', 'research-candidate': '暫定・研究候補',
        'technical-selection-human-listening-pending': '技術候補・聴感未評価', unavailable: '利用不可' } as Record<string, string>)[method.status] ?? method.status;
      const status = document.createElement('span'); status.textContent = available ? `${statusLabel} · ${method.nativeSampleRate?.toLocaleString() ?? '—'} Hz` : `利用不可 · ${method.reason ?? method.status}`;
      button.append(name, status);
      const choice = document.createElement('div'); choice.className = 'method-choice';
      choice.append(button); controls.methods.append(choice);
      if (available && (method.reason || method.limitations.length > 0)) {
        const details = document.createElement('details'); details.className = 'method-limitations';
        const summary = document.createElement('summary'); summary.textContent = 'この方式の制約';
        const limitations = document.createElement('p'); limitations.className = 'warning';
        limitations.textContent = [method.reason, ...method.limitations].filter(Boolean).join(' / ');
        details.append(summary, limitations); choice.append(details);
      }
      button.addEventListener('click', () => {
        selectedMethod = method.id;
        const notice = ensureAvailableCase();
        controls.methods.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node === button)));
        changeSelection(true, notice);
      });
    }
    controls.cases.replaceChildren();
    for (const item of loaded.cases) {
      const option = document.createElement('option'); option.value = item.id; option.textContent = item.label;
      controls.cases.append(option);
    }
    controls.cases.value = loaded.cases.find(item => item.id === 'mid-normal')?.id ?? loaded.cases[0]?.id ?? '';
    const notice = ensureAvailableCase();
    controls.cases.disabled = loaded.cases.length === 0;
    text('dataset-status', `${loaded.methods.filter(method => methodAvailable(method, loaded)).length}方式 / ${loaded.cases.length}条件 / ${loaded.clips.length}音声。聴感は未評価から開始します。`);
    refreshConditions(); refreshReview(); updateButtons(); void loadCharts();
    setPlaybackStatus(selectedClip() ? notice ?? '準備できました。再生を押すと先頭から聴けます。' : unavailablePlaybackMessage());
  } catch {
    text('dataset-status', '比較データを読み込めません。音源生成後に開き直すか、同じサーバーのmanifestパスを確認してください。');
    element<HTMLButtonElement>('reload').hidden = false;
    setPlaybackStatus('比較データがないため再生できません。');
  }
}
controls.play.addEventListener('click', () => void play());
controls.replay.addEventListener('click', () => void play());
controls.stop.addEventListener('click', () => stopPlayback());
controls.availableCase.addEventListener('click', () => changeSelection(true, ensureAvailableCase()));
for (const control of [controls.cases, controls.route, controls.matched, controls.position, controls.orientation]) control.addEventListener('change', () => changeSelection());
controls.loop.addEventListener('change', () => {
  storeReview();
  if (source) source.loop = controls.loop.checked;
  refreshReview();
});
controls.volume.addEventListener('input', () => {
  storeReview();
  const value = Number(controls.volume.value);
  controls.volumeValue.value = `${value}%`;
  if (output && context) output.gain.setTargetAtTime(value / 100, context.currentTime, .015);
  if (lakeOutput && context) lakeOutput.gain.setTargetAtTime(LAKE_AUDIO_MASTER_GAIN * value / 100, context.currentTime, .015);
  refreshReview();
});
for (const control of [controls.heard, controls.judgement, controls.notes, controls.equipment]) control.addEventListener('input', () => { updateJudgement(); storeReview(); });
controls.export.addEventListener('click', () => {
  if (!manifest) return;
  storeReview();
  const payload = { schemaVersion: 1, exportedAt: new Date().toISOString(), manifest: manifestUrl.pathname + manifestUrl.search,
    baseline: manifest.baseline, methods: manifest.methods, normalization: manifest.normalization, unperformed: manifest.unperformed,
    evidenceBoundary: 'Human listening and judgement are entered by the listener, never inferred from playback or measurements.',
    entries: [...reviews.values()] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `koto-listening-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  text('note-status', '比較条件とメモを端末へ書き出しました。');
});
element('reload').addEventListener('click', () => void loadManifest());
window.addEventListener('pagehide', () => {
  // A restored BFCache page can create a fresh context on its next user action.
  stopPlayback('ページを離れたため停止しました。');
  for (const finish of [...fading.values()]) finish();
  speakerArray?.dispose(); speakerArray = undefined;
  lakeOutput?.disconnect(); lakeOutput = undefined;
  for (const node of lakeOutputNodes) node.disconnect();
  lakeOutputNodes = [];
  output?.disconnect(); output = undefined;
  void context?.close(); context = undefined;
});
window.addEventListener('beforeunload', () => { disposed = true; dataAbort?.abort(); playAbort?.abort(); });
void loadManifest();
