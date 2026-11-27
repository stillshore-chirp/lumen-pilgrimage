type RGB8 = readonly [number, number, number];
type RGBA = readonly [number, number, number, number];
interface Rectangle { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
interface Patch { readonly id: string; readonly rgb: RGB8 }
interface PatchRectangle extends Patch { readonly rectangle: Rectangle }
interface SampleInput {
  readonly id: string;
  readonly inputRGB8: RGB8;
  readonly clearRGBA: RGBA;
  readonly referenceRGBA8If8BitUnorm: RGBA;
  readonly rectangle: Rectangle;
  readonly sample: Rectangle;
}
type SampleResult = SampleInput & (
  | { readonly status: 'obtained'; readonly reason: null; readonly pixelsRGBA8: readonly number[];
    readonly maxAbsoluteDifferenceFromReference: number }
  | { readonly status: 'unavailable'; readonly reason: string; readonly pixelsRGBA8: null;
    readonly maxAbsoluteDifferenceFromReference: null }
);
interface ViewInput {
  readonly eye: string;
  readonly viewport: Rectangle;
  readonly origin: 'bottom-left';
  readonly patches: readonly SampleResult[];
  readonly framebufferStatus?: string;
  readonly metadata?: ReturnType<typeof metadata>;
}
type ViewResult = ViewInput & (
  | { readonly status: 'obtained'; readonly reason: null;
    readonly referenceComparison: 'within-one-code-of-8bit-reference' | 'differs-from-8bit-reference' }
  | { readonly status: 'unavailable' | 'inconclusive'; readonly reason: string;
    readonly referenceComparison: 'not-evaluated' }
);
interface Report {
  readonly schema: 'lumen-xr-color-probe/1';
  readonly mode: 'desktop-default-framebuffer' | 'xr-legacy-webgl-layer';
  readonly startedAt: string;
  status: 'pending' | 'obtained' | 'unavailable' | 'inconclusive';
  reason: string | null;
  endedAt: string | null;
  views: ViewResult[];
  readonly scope: string;
  readonly secureContext: boolean;
  readonly referenceToleranceCodes: number;
  readonly referenceMeaning: string;
  layer?: { readonly type: 'default canvas framebuffer'; readonly width: number; readonly height: number }
    | { readonly type: 'XRWebGLLayer'; readonly requestedFramebufferScaleFactor: number;
      readonly width: number; readonly height: number; readonly antialias: boolean;
      readonly requestedAlpha: boolean; readonly referenceSpace: 'viewer'; readonly projectionLayerComparison: 'not-performed' };
  requestedDurationSeconds?: number;
  sessionEnded?: boolean;
  endReason?: string;
  endRequestedAt?: string;
  endFailure?: string;
  frameCount?: number;
  measuredFrame?: number;
}
interface XRState {
  readonly session: XRSession;
  readonly report: Report;
  readonly started: number;
  finalized: boolean;
  ending: boolean;
  canvas?: HTMLCanvasElement;
  gl?: WebGLRenderingContext;
  timeout?: number;
  endWatchdog?: number;
  frameHandle?: number;
}
interface StartRequest { cancelled: boolean }

const PATCHES: readonly Patch[] = [
  ...[0, 4, 8, 12, 17, 24, 32, 48, 64, 128, 255].map((value): Patch => ({
    id: `gray-${value}`, rgb: [value, value, value],
  })),
  { id: 'dark-blue', rgb: [17, 23, 27] },
  { id: 'dark-brown', rgb: [32, 16, 8] },
];
const HISTORY_LIMIT = 10;
const reports: Report[] = [];
let desktopGL: WebGLRenderingContext | undefined;
let current: XRState | null = null;
let requesting: StartRequest | null = null;
let supported = false;
let supportGeneration = 0;

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error('Required diagnostic element is missing');
  return found;
}
function button(id: string): HTMLButtonElement {
  const found = element(id);
  if (!(found instanceof HTMLButtonElement)) throw new Error('Required diagnostic button is missing');
  return found;
}
function enumName(value: number): string {
  const names: Readonly<Record<number, string>> = {
    0: 'NO_ERROR', 0x0500: 'INVALID_ENUM', 0x0501: 'INVALID_VALUE', 0x0502: 'INVALID_OPERATION',
    0x0505: 'OUT_OF_MEMORY', 0x0506: 'INVALID_FRAMEBUFFER_OPERATION', 0x9242: 'CONTEXT_LOST_WEBGL',
    0x8cd5: 'FRAMEBUFFER_COMPLETE', 0x8cdd: 'FRAMEBUFFER_UNSUPPORTED',
  };
  return names[value] ?? `GL_0x${value.toString(16)}`;
}
function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return ['NotSupportedError', 'SecurityError', 'NotAllowedError', 'InvalidStateError',
    'OperationError', 'AbortError', 'TypeError'].includes(name) ? name : 'UnclassifiedError';
}
function errors(gl: WebGLRenderingContext): string[] {
  const result: string[] = [];
  for (let index = 0; index < 8; ++index) {
    const value = gl.getError();
    if (!value) break;
    result.push(enumName(value));
    if (value === gl.CONTEXT_LOST_WEBGL) break;
  }
  return result;
}
function context(canvas: HTMLCanvasElement): WebGLRenderingContext {
  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power',
  });
  if (!gl) throw new DOMException('', 'NotSupportedError');
  if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = 'srgb';
  gl.disable(gl.DITHER);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.colorMask(true, true, true, true);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    if (current?.gl === gl) {
      current.report.reason = 'WebGL context lost';
      void endXR('context-lost');
    }
  });
  return gl;
}
function metadata(gl: WebGLRenderingContext) {
  return {
    api: 'WebGL 1', version: String(gl.getParameter(gl.VERSION)),
    contextAttributes: gl.getContextAttributes(),
    requestedDrawingBufferColorSpace: 'srgb',
    reportedDrawingBufferColorSpace: 'drawingBufferColorSpace' in gl ? gl.drawingBufferColorSpace : null,
    drawingBufferColorSpaceNote: 'Property refers to the context drawing buffer, not a measurement of XR compositor/display output.',
    channelBits: { red: Number(gl.getParameter(gl.RED_BITS)), green: Number(gl.getParameter(gl.GREEN_BITS)),
      blue: Number(gl.getParameter(gl.BLUE_BITS)), alpha: Number(gl.getParameter(gl.ALPHA_BITS)) },
    defaultDrawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
    readFormat: 'RGBA', readType: 'UNSIGNED_BYTE', dither: false, blending: false,
    toneMapping: false, textureUpload: false, shaders: false,
    xrCompositorEncoding: 'XRWebGLLayer spec treats RGB/RGBA backing values as sRGB encoded; no compositor readback is available here.',
    xrAttachmentEncodingQuery: { status: 'unavailable', reason: 'Opaque XR framebuffer attachments must not be inspected; no attachment query is made.' },
  };
}
function rectangles(viewport: Rectangle): PatchRectangle[] {
  const { x, y, width, height } = viewport;
  return PATCHES.map((patch, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x0 = x + Math.floor(column * width / 4);
    const x1 = x + Math.floor((column + 1) * width / 4);
    const y0 = y + height - Math.floor((row + 1) * height / 4);
    const y1 = y + height - Math.floor(row * height / 4);
    return { ...patch, rectangle: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
  });
}
function paint(gl: WebGLRenderingContext, viewport: Rectangle): void {
  gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(viewport.x, viewport.y, viewport.width, viewport.height);
  gl.clearColor(96 / 255, 96 / 255, 96 / 255, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  for (const patch of rectangles(viewport)) {
    const r = patch.rectangle;
    gl.scissor(r.x, r.y, r.width, r.height);
    gl.clearColor(patch.rgb[0] / 255, patch.rgb[1] / 255, patch.rgb[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.disable(gl.SCISSOR_TEST);
}
function readPatch(gl: WebGLRenderingContext, patch: PatchRectangle): SampleResult {
  const r = patch.rectangle;
  const sample = { x: r.x + Math.floor(r.width / 2) - 1, y: r.y + Math.floor(r.height / 2) - 1, width: 3, height: 3 };
  const input: SampleInput = { id: patch.id, inputRGB8: patch.rgb,
    clearRGBA: [patch.rgb[0] / 255, patch.rgb[1] / 255, patch.rgb[2] / 255, 1],
    referenceRGBA8If8BitUnorm: [...patch.rgb, 255], rectangle: r, sample };
  const unavailable = (reason: string): SampleResult => ({ ...input, status: 'unavailable', reason,
    pixelsRGBA8: null, maxAbsoluteDifferenceFromReference: null });
  if (r.width < 5 || r.height < 5) return unavailable('Viewport too small for an interior 3x3 sample');
  const pixels = new Uint8Array(3 * 3 * 4).fill(165);
  try {
    gl.readPixels(sample.x, sample.y, sample.width, sample.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const readErrors = errors(gl);
    if (readErrors.length) return unavailable(`readPixels: ${readErrors.join(', ')}`);
    if (pixels.every(value => value === 165)) return unavailable('Read destination unchanged');
    if (gl.isContextLost()) return unavailable('Context lost during readback');
    return { ...input, status: 'obtained', reason: null, pixelsRGBA8: [...pixels],
      maxAbsoluteDifferenceFromReference: Math.max(...pixels.map((value, index) =>
        Math.abs(value - input.referenceRGBA8If8BitUnorm[index % 4]))) };
  } catch (error) { return unavailable(`readPixels exception: ${errorName(error)}`); }
}
function measure(gl: WebGLRenderingContext, viewport: Rectangle, eye: string): ViewResult {
  const input: ViewInput = { eye,
    viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
    origin: 'bottom-left', patches: [] };
  const unavailable = (reason: string): ViewResult => ({ ...input, status: 'unavailable', reason, referenceComparison: 'not-evaluated' });
  if (gl.isContextLost()) return unavailable('WebGL context lost');
  const before = errors(gl);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  const statusErrors = errors(gl);
  const framebufferStatus = enumName(status);
  if (before.length || statusErrors.length || status !== gl.FRAMEBUFFER_COMPLETE) {
    return { ...unavailable(`Framebuffer/draw unavailable: ${[...before, ...statusErrors, framebufferStatus].join(', ')}`), framebufferStatus };
  }
  const info = metadata(gl);
  const metadataErrors = errors(gl);
  if (metadataErrors.length) return unavailable(`Metadata query failed: ${metadataErrors.join(', ')}`);
  const patches = rectangles(viewport).map(patch => readPatch(gl, patch));
  const measured = { ...input, patches, framebufferStatus, metadata: info };
  const all = patches.length === PATCHES.length && patches.every(patch => patch.status === 'obtained');
  const white = patches.find(patch => patch.id === 'gray-255');
  const hasWhiteControl = white?.status === 'obtained'
    && white.pixelsRGBA8.some((value, index) => index % 4 !== 3 && value > 0);
  if (all && hasWhiteControl) {
    return { ...measured, status: 'obtained', reason: null,
      referenceComparison: patches.every(patch => patch.status === 'obtained' && patch.maxAbsoluteDifferenceFromReference <= 1)
        ? 'within-one-code-of-8bit-reference' : 'differs-from-8bit-reference' };
  }
  return { ...measured, status: all ? 'inconclusive' : 'unavailable', referenceComparison: 'not-evaluated',
    reason: all ? 'White control returned all-zero RGB; readback integrity is not established' : 'One or more required patch samples unavailable' };
}
function newReport(mode: Report['mode']): Report {
  const report: Report = { schema: 'lumen-xr-color-probe/1', mode, startedAt: new Date().toISOString(),
    status: 'pending', reason: 'No render frame measured', endedAt: null, views: [],
    scope: 'Application GL framebuffer only; no HMD display, compositor output, lens, camera, photo, or contrast-setting measurement.',
    secureContext: isSecureContext, referenceToleranceCodes: 1,
    referenceMeaning: 'Expected unsigned-normalized 8bit RGB/RGBA storage for gl.clearColor(RGB8/255, alpha=1); actual storage/readback is recorded separately. No linear-to-sRGB conversion is applied by this tool.',
  };
  reports.unshift(report);
  reports.splice(HISTORY_LIMIT);
  return report;
}
function updateControls(): void {
  button('start-xr').disabled = !supported || requesting !== null || current !== null;
  button('stop-xr').disabled = requesting === null && current === null;
  button('measure-desktop').disabled = current !== null || requesting !== null;
  button('save-json').disabled = reports.length === 0;
}
function renderResults(): void {
  element('results').replaceChildren();
  element('result-summary').textContent = reports.length ? `${reports.length}回の記録。最新: ${reports[0].mode} / ${reports[0].status}` : '測定結果はありません。';
  for (const report of reports) {
    const section = document.createElement('section');
    const title = document.createElement('h3');
    title.textContent = `${report.mode} — ${report.status}`;
    const note = document.createElement('p');
    note.textContent = [report.reason, report.endReason && `終了理由: ${report.endReason}`,
      report.views.map(view => `${view.eye}: ${view.status} / ${view.referenceComparison}`).join('、')].filter(Boolean).join(' · ');
    section.append(title, note);
    const wrap = document.createElement('div'); wrap.className = 'table-wrap';
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const label of ['眼/対象', '色', '入力RGB', '8bit予測RGBA', '実測先頭RGBA', '最大差', '取得状態/理由']) {
      const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; head.append(cell);
    }
    const body = table.createTBody();
    for (const view of report.views) for (const patch of view.patches) {
      const row = body.insertRow();
      for (const value of [view.eye, patch.id, patch.inputRGB8.join('/'), patch.referenceRGBA8If8BitUnorm.join('/'),
        patch.pixelsRGBA8?.slice(0, 4).join('/') ?? '未取得', patch.maxAbsoluteDifferenceFromReference ?? '—',
        patch.status === 'obtained' ? '取得済み（表示品質判定なし）' : `未取得: ${patch.reason}`]) row.insertCell().textContent = String(value);
    }
    wrap.append(table); section.append(wrap);
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = '測定条件・全画素・JSON';
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify(report, null, 2);
    details.append(summary, pre); section.append(details); element('results').append(section);
  }
  updateControls();
}
function desktop(): void {
  const report = newReport('desktop-default-framebuffer');
  try {
    const canvas = element('chart');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Diagnostic canvas is missing');
    desktopGL ??= context(canvas);
    desktopGL.bindFramebuffer(desktopGL.FRAMEBUFFER, null);
    const viewport = { x: 0, y: 0, width: desktopGL.drawingBufferWidth, height: desktopGL.drawingBufferHeight };
    paint(desktopGL, viewport);
    report.views = [measure(desktopGL, viewport, 'canvas')];
    report.status = report.views[0].status;
    report.reason = report.views[0].reason;
    report.layer = { type: 'default canvas framebuffer', width: viewport.width, height: viewport.height };
  } catch (error) { report.status = 'unavailable'; report.reason = `Canvas setup: ${errorName(error)}`; }
  report.endedAt = new Date().toISOString(); renderResults();
}
async function checkSupport(): Promise<void> {
  const generation = ++supportGeneration;
  supported = false; updateControls();
  if (!isSecureContext || !navigator.xr) {
    element('support').textContent = !isSecureContext ? 'VR未対応: 信頼済みHTTPSまたはlocalhostで開いてください。' : 'VR未対応: WebXR APIがありません。';
    return;
  }
  element('support').textContent = 'VR対応を確認しています。';
  try {
    const result = await navigator.xr.isSessionSupported('immersive-vr');
    if (generation !== supportGeneration) return;
    supported = result;
    element('support').textContent = result ? 'VR開始を要求できます。許可と実際の接続は開始時に確認します。' : '現在は没入型VRを利用できません。接続後に再確認できます。';
  } catch (error) {
    if (generation !== supportGeneration) return;
    element('support').textContent = `VR対応の確認に失敗: ${errorName(error)}。接続・権限を確認して再試行できます。`;
  }
  updateControls();
}
function finalize(state: XRState): void {
  if (state.finalized) return;
  state.finalized = true;
  window.clearTimeout(state.timeout); window.clearTimeout(state.endWatchdog);
  if (state.frameHandle !== undefined) state.session.cancelAnimationFrame(state.frameHandle);
  state.report.endedAt = new Date().toISOString();
  state.report.sessionEnded = true;
  if (!state.report.views.length) { state.report.status = 'unavailable'; state.report.reason ??= 'No XR frame sample obtained before end'; }
  if (current === state) current = null;
  // The context belongs only to this diagnostic session, never to the game.
  state.gl?.getExtension('WEBGL_lose_context')?.loseContext();
  state.canvas?.remove();
  element('session-status').textContent = 'VRを終了しました。結果はこの画面に保持しています。';
  renderResults();
}
async function endXR(reason: string): Promise<void> {
  const state = current;
  if (!state) {
    if (requesting) {
      requesting.cancelled = true;
      element('session-status').textContent = 'VR開始を取り消しました。許可ダイアログを閉じてください。後から許可された場合も直ちに終了を要求します。';
    }
    return;
  }
  if (state.ending || state.finalized) return;
  state.ending = true;
  state.report.endReason ??= reason;
  state.report.endRequestedAt = new Date().toISOString();
  if (state.frameHandle !== undefined) state.session.cancelAnimationFrame(state.frameHandle);
  element('session-status').textContent = 'VRの終了を要求しています。';
  state.endWatchdog = window.setTimeout(() => {
    if (state.finalized) return;
    state.report.sessionEnded = false;
    state.report.endFailure = 'End confirmation not received within 3 seconds';
    state.ending = false;
    element('session-status').textContent = '終了の完了を確認できません。本体の終了操作を使うか、終了を再試行してください。';
    renderResults();
  }, 3000);
  try { await state.session.end(); finalize(state); }
  catch (error) {
    if (state.finalized) return;
    window.clearTimeout(state.endWatchdog); state.ending = false;
    state.report.endFailure = errorName(error); state.report.sessionEnded = false;
    element('session-status').textContent = `終了要求に失敗: ${errorName(error)}。本体の終了操作を使うか再試行してください。`;
    renderResults();
  }
}
async function startXR(): Promise<void> {
  const system = navigator.xr;
  if (requesting || current || !supported || !system) return;
  const request: StartRequest = { cancelled: false };
  requesting = request; updateControls();
  const report = newReport('xr-legacy-webgl-layer'); renderResults();
  const selector = element('duration');
  const duration = Math.max(5, Math.min(15, Number(selector instanceof HTMLSelectElement ? selector.value : 10) || 10));
  report.requestedDurationSeconds = duration;
  element('session-status').textContent = 'VRの開始を要求しています。';
  let session: XRSession | undefined;
  const requestTimer = window.setTimeout(() => {
    request.cancelled = true;
    report.reason = 'VR request did not resolve within 20 seconds; any late session will be ended';
    element('session-status').textContent = 'VR許可の応答がありません。許可ダイアログを閉じてください。後から開始された場合も終了を要求します。';
    renderResults();
  }, 20000);
  try {
    // Keep requestSession in the click activation, before any awaited work.
    session = await system.requestSession('immersive-vr', { requiredFeatures: [] });
    window.clearTimeout(requestTimer);
    const state: XRState = { session, report, finalized: false, ending: false, started: performance.now() };
    current = state;
    if (requesting === request) requesting = null;
    session.addEventListener('end', () => finalize(state), { once: true });
    session.addEventListener('select', () => void endXR('controller-select'));
    session.addEventListener('visibilitychange', () => {
      if (state.session.visibilityState === 'hidden') void endXR('session-hidden');
    });
    state.timeout = window.setTimeout(() => void endXR('duration-timer'), duration * 1000);
    report.sessionEnded = false; updateControls();
    if (request.cancelled) { await endXR('request-cancelled'); return; }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    canvas.hidden = true; document.body.append(canvas); state.canvas = canvas;
    const gl = context(canvas); state.gl = gl;
    if (typeof gl.makeXRCompatible !== 'function') throw new DOMException('', 'NotSupportedError');
    await gl.makeXRCompatible();
    if (state.finalized || state.ending) return;
    const layer = new XRWebGLLayer(session, gl, { alpha: false, antialias: false, depth: false,
      stencil: false, ignoreDepthValues: true, framebufferScaleFactor: 0.35 });
    if (!layer.framebuffer) throw new DOMException('', 'OperationError');
    session.updateRenderState({ baseLayer: layer });
    const reference = await session.requestReferenceSpace('viewer');
    if (state.finalized || state.ending) return;
    report.layer = { type: 'XRWebGLLayer', requestedFramebufferScaleFactor: 0.35,
      width: layer.framebufferWidth, height: layer.framebufferHeight, antialias: layer.antialias,
      requestedAlpha: false, referenceSpace: 'viewer', projectionLayerComparison: 'not-performed' };
    report.frameCount = 0;
    element('session-status').textContent = `VR表示中。${duration}秒で終了を要求します。選択操作でも終了できます。`;
    const frame: XRFrameRequestCallback = (_time, xrFrame) => {
      if (state.finalized || state.ending || current !== state) return;
      if (performance.now() - state.started >= duration * 1000) { void endXR('duration-frame-deadline'); return; }
      report.frameCount = (report.frameCount ?? 0) + 1;
      try {
        const pose = xrFrame.getViewerPose(reference);
        if (pose?.views.length) {
          // Opaque XR framebuffer access is confined to this XR animation callback.
          gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
          const shouldMeasure = report.views.length === 0;
          const views: ViewResult[] = [];
          for (const view of pose.views) {
            const viewport = layer.getViewport(view);
            if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
              views.push({ eye: view.eye, viewport: { x: 0, y: 0, width: 0, height: 0 }, origin: 'bottom-left',
                status: 'unavailable', reason: 'No usable eye viewport', patches: [], referenceComparison: 'not-evaluated' });
              continue;
            }
            paint(gl, viewport);
            if (shouldMeasure) views.push(measure(gl, viewport, view.eye));
          }
          if (shouldMeasure) {
            report.views = views; report.measuredFrame = report.frameCount;
            report.status = views.length > 0 && views.every(view => view.status === 'obtained') ? 'obtained' : 'unavailable';
            report.reason = report.status === 'obtained' ? null : 'One or more eye readbacks unavailable or inconclusive';
            renderResults();
          }
        } else if (!report.views.length && report.reason !== 'No viewer pose/views supplied yet') {
          report.reason = 'No viewer pose/views supplied yet'; renderResults();
        }
      } catch (error) {
        report.status = 'unavailable'; report.reason = `XR frame: ${errorName(error)}`;
        void endXR('frame-error'); return;
      }
      state.frameHandle = state.session.requestAnimationFrame(frame);
    };
    state.frameHandle = session.requestAnimationFrame(frame);
  } catch (error) {
    report.status = 'unavailable'; report.reason = `VR startup: ${errorName(error)}`;
    element('session-status').textContent = `VR開始に失敗: ${errorName(error)}。接続・許可を確認して再試行できます。`;
    if (session && current?.session === session) await endXR('startup-error');
    else report.endedAt = new Date().toISOString();
  } finally {
    window.clearTimeout(requestTimer);
    if (requesting === request) requesting = null;
    renderResults();
  }
}

for (const patch of PATCHES) {
  const li = document.createElement('li');
  const swatch = document.createElement('span'); swatch.className = 'swatch';
  swatch.style.background = `rgb(${patch.rgb.join(' ')})`;
  li.append(swatch, document.createTextNode(`${patch.id}: ${patch.rgb.join('/')}`)); element('patch-key').append(li);
}
button('measure-desktop').addEventListener('click', desktop);
button('check-xr').addEventListener('click', () => void checkSupport());
button('start-xr').addEventListener('click', () => void startXR());
button('stop-xr').addEventListener('click', () => void endXR('page-button'));
document.addEventListener('keydown', event => { if (event.key === 'Escape') void endXR('escape'); });
window.addEventListener('pagehide', () => {
  void endXR('page-hide');
  desktopGL?.getExtension('WEBGL_lose_context')?.loseContext();
});
button('save-json').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ tool: 'lumen-xr-color-probe', version: 1, reports }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `xr-color-probe-${new Date().toISOString().replaceAll(':', '-')}.json`;
  link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});
desktop();
void checkSupport();

export {};
