import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';

let server, browser, origin;
const sampleRate = 48000;
const cases = ['low', 'mid-normal', 'high', 'weak', 'strong', 'press', 'damp', 'chord', 'melody', 'performance'];
const caseLabels = ['低音', '中音・通常強度', '高音', '弱音', '強音', '押し手', '消音', '多弦', '短い旋律', '全曲'];
const screenshotDirectory = process.env.KOTO_AUDITION_SCREENSHOTS;
const studyManifestPath = process.env.KOTO_STUDY_MANIFEST;
const externalOrigin = process.env.KOTO_AUDITION_ORIGIN;
let studyEvidence;
const metrics = { samplePeakDbfs: 6.0206, rmsDbfs: 3.0103, matched: { samplePeakDbfs: -18.42, rmsDbfs: -21.43 } };
const manifest = {
  schemaVersion: 1, sampleRate, channels: 1,
  baseline: { revision: '375c3b7a2d77f3cae2420e5b3ca7c2f4e8bba597', sourcePath: 'src/coast/world/lake/lakeKotoScore.ts', sha256: 'a'.repeat(64), nativeSampleRate: 24000 },
  methods: [{ id: 'legacy', label: '旧音源', status: 'rendered', nativeSampleRate: 24000, sourceHashes: [] },
    { id: 'physics', label: '物理モデル', status: 'rendered', nativeSampleRate: 48000, sourceHashes: [] },
    { id: 'sample', label: '実録音', status: 'unavailable', nativeSampleRate: null, reason: '条件を満たす録音素材なし', sourceHashes: [] },
    { id: 'hybrid', label: 'ハイブリッド', status: 'unavailable', nativeSampleRate: null, reason: '採用可能な実録音素材なし', sourceHashes: [] }],
  cases: cases.map((id, i) => ({ id, label: caseLabels[i], kind: id, durationSeconds: 2, onsetSeconds: 0 })),
  normalization: { kind: 'unweighted-rms-anchor', targetRmsDbfs: -24, peakLimitDbfs: -3, commonSafetyGainDb: 0, anchors: {} },
  clips: ['legacy', 'physics'].flatMap(method => cases.map(id => ({ id: `${method}-${id}`, method, case: id,
    sampleRate, frames: 96000, durationSeconds: 2, rawWav: `raw-${method}.wav`, matchedWav: `matched-${method}.wav`, visualization: 'visualization.json', measurements: metrics,
    matchGainDb: -24.44, commonSafetyGainDb: 0 }))),
  unperformed: ['human-listening', 'headset-listening'],
  unavailableClips: [],
};
const visualization = { schemaVersion: 1, signal: 'raw',
  waveform: { timesSeconds: [0, .25, .5, 1, 1.5, 2], min: [0, -.8, -.6, -.5, -.2, 0], max: [0, .8, .6, .5, .2, 0] },
  spectrum: { frequenciesHz: [20, 100, 220, 440, 1000, 5000, 24000], dbfs: [-90, -60, -6, -16, -35, -65, -95] } };

function wav(amplitude) {
  const frames = sampleRate * 2;
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 4, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(32, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i += 1) bytes.writeFloatLE(amplitude * Math.sin(2 * Math.PI * 220 * i / sampleRate), 44 + i * 4);
  return bytes;
}
const rawWav = wav(2), matchedWav = wav(.12);

before(async () => {
  if (externalOrigin) {
    const url = new URL(externalOrigin);
    assert.equal(url.protocol, 'http:');
    assert.equal(url.hostname, '127.0.0.1');
    origin = url.origin;
  } else {
    server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false,
      ...(studyManifestPath ? { fs: { allow: [process.cwd(), dirname(resolve(studyManifestPath))] } } : {}) } });
    await server.listen();
    origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  }
  browser = await chromium.launch({ channel: process.env.COAST_CHROME_CHANNEL || 'chromium' });
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
});
after(async () => { try { await browser?.close(); } finally { await server?.close(); } });

async function openPage({ viewport = { width: 1440, height: 1080 }, delayedAudio = false, manifestOverride = manifest } = {}) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  const failures = [];
  page.on('pageerror', () => failures.push('Unexpected page error'));
  let releaseAudio;
  const delayed = new Promise(resolve => { releaseAudio = resolve; });
  await page.addInitScript(() => {
    const probe = { started: 0, maximumConnected: 0, connected: new Set(), sources: [], analysers: [], panners: 0 };
    window.audioProbe = probe;
    const connect = AudioNode.prototype.connect;
    const disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (this instanceof AudioBufferSourceNode) {
        probe.connected.add(this);
        probe.maximumConnected = Math.max(probe.maximumConnected, probe.connected.size);
        this.auditionLevel = destination;
      }
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
        probe.analysers.push(analyser);
        connect.call(this, analyser); connect.call(analyser, destination);
        return destination;
      }
      return connect.call(this, destination, ...args);
    };
    AudioNode.prototype.disconnect = function (...args) {
      if (this instanceof AudioBufferSourceNode) probe.connected.delete(this);
      return disconnect.apply(this, args);
    };
    const createSource = BaseAudioContext.prototype.createBufferSource;
    BaseAudioContext.prototype.createBufferSource = function () {
      const source = createSource.call(this);
      probe.sources.push(source);
      const start = source.start;
      source.start = function (...args) { probe.started += 1; source.auditionStartedAt = this.context.currentTime; return start.apply(this, args); };
      return source;
    };
    const Panner = window.PannerNode;
    window.PannerNode = class extends Panner {
      constructor(...args) { super(...args); probe.panners += 1; }
    };
  });
  await page.route('**/artifacts/koto-study/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('manifest.json')) await route.fulfill({ json: manifestOverride });
    else if (path.endsWith('.wav')) {
      if (delayedAudio) await delayed;
      await route.fulfill({ body: path.includes('matched-') ? matchedWav : rawWav, contentType: 'audio/wav' }).catch(() => {});
    } else await route.fulfill({ json: visualization });
  });
  await page.goto(`${origin}/tools/koto-audition.html`);
  const methodCount = manifestOverride.methods.filter(method => manifestOverride.clips.some(clip => clip.method === method.id)).length;
  await page.getByText(`${methodCount}方式 / ${manifestOverride.cases.length}条件 / ${manifestOverride.clips.length}音声。`, { exact: false }).waitFor();
  return { page, failures, releaseAudio };
}
async function status(page, text) { await page.locator('#play-status').filter({ hasText: text }).waitFor(); }
async function samplePeak(page) {
  return page.evaluate(() => {
    const analyser = window.audioProbe.analysers[0];
    const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
    return Math.max(...data.map(Math.abs));
  });
}

test('audition selects real methods, renders figures, preserves honest notes and exports conditions', { timeout: 30000 }, async () => {
  const { page, failures } = await openPage();
  try {
    assert.equal(await page.locator('[data-method="sample"]').isDisabled(), true);
    assert.match(await page.locator('[data-method="sample"]').textContent(), /条件を満たす録音素材なし/);
    assert.equal(await page.locator('#case option').count(), 10);
    await page.locator('#waveform path').first().waitFor({ state: 'attached' });
    assert.match(await page.locator('#data-status').textContent(), /音量整合後/);
    assert.match(await page.locator('#metrics').textContent(), /-18.42 dBFS/);
    assert.equal(await page.locator('#judgement').isDisabled(), true);
    await page.locator('#notes').fill('余韻のざらつきを比較する。まだ聴取はしていない。');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '比較条件とメモを書き出す' }).click();
    const download = await downloadPromise;
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(exported.entries.length, 1);
    assert.equal(exported.entries[0].evaluation.heard, false);
    assert.equal(exported.entries[0].evaluation.judgement, 'unevaluated');
    assert.match(exported.entries[0].evaluation.notes, /まだ聴取/);
    assert.equal(exported.entries[0].condition.loudnessMatched, true);
    await page.locator('#heard').check();
    await page.locator('#judgement').selectOption('concerns');
    await page.locator('#equipment').fill('自動試験の入力例。人間の実評価ではない。');
    await page.getByRole('button', { name: '物理モデル', exact: false }).click();
    assert.equal(await page.locator('#heard').isChecked(), false);
    assert.equal(await page.locator('#notes').inputValue(), '');
    await page.getByRole('button', { name: '旧音源', exact: false }).click();
    assert.equal(await page.locator('#judgement').inputValue(), 'concerns');
    assert.match(await page.locator('#notes').inputValue(), /余韻/);
    await page.locator('#heard').uncheck();
    if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, 'audition-desktop.png'), fullPage: true });
    assert.deepEqual(failures, []);
  } finally { await page.close(); }
});

test('audition emits audio, keeps one source, stops, loops, replays and shares lake routing', { timeout: 30000 }, async () => {
  const { page, failures } = await openPage();
  try {
    await page.getByRole('button', { name: '再生', exact: true }).click();
    await status(page, 'を再生中');
    await page.waitForFunction(() => {
      const analyser = window.audioProbe.analysers[0];
      const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
      return data.some(value => Math.abs(value) > .005);
    });
    assert.ok(await samplePeak(page) > .005, 'Web Audio output contains the synthetic fixture signal');
    assert.equal(await page.getByRole('button', { name: '再生', exact: true }).isDisabled(), true);
    await page.locator('#loop').check();
    assert.equal(await page.evaluate(() => window.audioProbe.sources.at(-1).loop), true);
    await page.getByRole('button', { name: '先頭から' }).click();
    await status(page, 'を再生中');
    assert.equal(await page.evaluate(() => window.audioProbe.maximumConnected), 1);
    await page.locator('#case').selectOption('press');
    await status(page, '比較条件を変更');
    await page.waitForFunction(() => window.audioProbe.connected.size === 0);
    await page.locator('#matched').uncheck();
    assert.match(await page.locator('#conditions').textContent(), /peak保護 -9.02 dB/);
    await page.getByRole('button', { name: '再生', exact: true }).click();
    await status(page, 'を再生中');
    await page.waitForFunction(() => {
      const source = window.audioProbe.sources.at(-1);
      return source.context.currentTime - source.auditionStartedAt > .03;
    });
    const protectedPeak = await page.evaluate(() => {
      const source = window.audioProbe.sources.at(-1);
      let peak = 0;
      for (const value of source.buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(value));
      return peak * source.auditionLevel.gain.value;
    });
    assert.ok(Math.abs(protectedPeak - 10 ** (-3 / 20)) < .003, `raw peak protected: ${protectedPeak}`);
    await page.locator('#route').selectOption('lake');
    await page.locator('#position').selectOption('west');
    await page.locator('#orientation').selectOption('90');
    await page.getByRole('button', { name: '再生', exact: true }).click();
    await status(page, 'を再生中');
    assert.equal(await page.evaluate(() => window.audioProbe.panners), 12);
    const listener = await page.evaluate(() => {
      const listener = window.audioProbe.analysers[0].context.listener;
      return { x: listener.positionX.value, y: listener.positionY.value, forwardX: listener.forwardX.value };
    });
    assert.ok(listener.x < -15);
    assert.ok(Math.abs(listener.y - 1.65) < .001);
    assert.equal(listener.forwardX, -1);
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.waitForFunction(() => window.audioProbe.connected.size === 0);
    assert.equal(await page.evaluate(() => window.audioProbe.maximumConnected), 1);
    assert.deepEqual(failures, []);
  } finally { await page.close(); }
});

test('stop and selection changes cancel delayed loading and cannot start late audio', { timeout: 30000 }, async () => {
  const { page, releaseAudio, failures } = await openPage({ delayedAudio: true });
  try {
    await page.getByRole('button', { name: '再生', exact: true }).click();
    await status(page, '音声を準備');
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await page.getByRole('button', { name: '物理モデル', exact: false }).click();
    releaseAudio();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.evaluate(() => window.audioProbe.started), 0);
    assert.equal(await page.getByRole('button', { name: '再生', exact: true }).isDisabled(), false);
    assert.deepEqual(failures, []);
  } finally { releaseAudio(); await page.close(); }
});

test('method-only selection recovers a sparse method while explicit unsupported cases remain inspectable', { timeout: 30000 }, async () => {
  const production = { ...manifest.methods[1], id: 'production96', label: '本番候補', status: 'technical-selection-human-listening-pending' };
  const sparse = { ...manifest, methods: [...manifest.methods, production], clips: [...manifest.clips,
    { ...manifest.clips.find(clip => clip.method === 'physics' && clip.case === 'performance'), id: 'production-performance', method: production.id }] };
  const { page } = await openPage({ manifestOverride: sparse });
  try {
    assert.equal(await page.locator('#case').inputValue(), 'mid-normal');
    await page.locator('[data-method="production96"]').click();
    assert.equal(await page.locator('#case').inputValue(), 'performance');
    assert.equal(await page.locator('#play').isDisabled(), false);
    assert.match(await page.locator('#play-status').textContent(), /音声がないため.*切り替えました/);
    await page.locator('#case').selectOption('low');
    assert.equal(await page.locator('#play').isDisabled(), true);
    assert.match(await page.locator('#case option:checked').textContent(), /この方式の音声なし/);
    assert.match(await page.locator('#play-status').textContent(), /音声がないため再生できません.*再生できる演奏に戻す/);
    await page.locator('#use-available-case').click();
    assert.equal(await page.locator('#case').inputValue(), 'performance');
    assert.equal(await page.locator('#play').isDisabled(), false);
    assert.equal(await page.locator('#use-available-case').isVisible(), false);
    await page.locator('#play').click();
    await status(page, 'を再生中');
    await page.locator('#stop').click();
  } finally { await page.close(); }
});

test('375px and landscape layouts fit, keyboard focus remains visible, external manifests are rejected', { timeout: 30000 }, async () => {
  const { page, failures } = await openPage({ viewport: { width: 375, height: 812 } });
  try {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '試聴操作へ移動');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none');
    await page.locator('#waveform path').first().waitFor({ state: 'attached' });
    if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, 'audition-375.png'), fullPage: true });
    await page.setViewportSize({ width: 812, height: 375 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goto(`${origin}/tools/koto-audition.html?manifest=https%3A%2F%2Fexample.com%2Fmanifest.json`);
    await page.locator('#dataset-status').filter({ hasText: '比較データを読み込めません' }).waitFor();
    assert.equal(await page.locator('#play').isDisabled(), true);
    assert.deepEqual(failures, []);
  } finally { await page.close(); }
});

test('malformed visualization is shown as unavailable while valid audio remains usable', { timeout: 30000 }, async () => {
  const { page } = await openPage();
  try {
    await page.route('**/artifacts/koto-study/visualization.json', route => route.fulfill({ json: { waveform: { timesSeconds: [1], min: [], max: [] } } }));
    await page.locator('#case').selectOption('high');
    await page.locator('#data-status').filter({ hasText: '図のデータを読み込めません' }).waitFor();
    assert.equal(await page.locator('#play').isDisabled(), false);
  } finally { await page.close(); }
});

test('generated study manifest connects actual figures and dry/lake audio without marking human listening', {
  timeout: 30000, skip: !studyManifestPath,
}, async () => {
  const studySource = await readFile(studyManifestPath, 'utf8');
  const study = JSON.parse(studySource);
  studyEvidence = { manifestSha256: createHash('sha256').update(studySource).digest('hex'),
    generatedAt: study.generatedAt ?? null, clips: study.clips.length,
    methods: study.methods.map(item => ({ id: item.id, status: item.status, sourceHashes: item.sourceHashes })), cases: study.cases.map(item => item.id) };
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  try {
    await page.addInitScript(() => {
      window.studyAnalysers = [];
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (destination, ...args) {
        if (destination instanceof AudioDestinationNode) {
          const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
          window.studyAnalysers.push(analyser);
          connect.call(this, analyser); connect.call(analyser, destination);
          return destination;
        }
        return connect.call(this, destination, ...args);
      };
    });
    const path = externalOrigin ? '/artifacts/koto-study/manifest.json' : `/@fs${resolve(studyManifestPath)}`;
    if (externalOrigin) {
      const response = await page.request.get(`${origin}${path}`);
      assert.equal(response.status(), 200);
      const servedManifest = await response.body();
      assert.equal(createHash('sha256').update(servedManifest).digest('hex'), studyEvidence.manifestSha256);
    }
    await page.goto(`${origin}/tools/koto-audition.html?manifest=${encodeURIComponent(path)}`);
    await page.locator('#dataset-status').filter({ hasText: `${study.clips.length}音声` }).waitFor();
    assert.equal(await page.locator('#play').isDisabled(), false, 'Initial method/case can be played');
    const method = study.methods.find(method => method.id !== 'legacy' && study.clips.some(clip => clip.method === method.id && clip.case === 'mid-normal'));
    assert.ok(method, 'A new method has a real mid-normal clip');
    await page.locator(`[data-method="${method.id}"]`).click();
    await page.locator('#case').selectOption('mid-normal');
    await page.locator('#data-status').filter({ hasText: '表示:' }).waitFor();
    assert.ok(await page.locator('#waveform path').count() >= 4);
    for (const route of ['dry', 'lake']) {
      await page.locator('#route').selectOption(route);
      await page.locator('#play').click();
      await status(page, 'を再生中');
      await page.waitForFunction(route => {
        const analyser = window.studyAnalysers[route === 'dry' ? 0 : 1];
        if (!analyser) return false;
        const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
        return data.some(value => Math.abs(value) > 1e-5);
      }, route);
      await page.locator('#stop').click();
    }
    if (study.methods.some(item => item.id === 'sample')) {
      await page.locator('[data-method="sample"]').click();
      await page.locator('#case').selectOption('press-two');
      await page.locator('#conditions').filter({ hasText: '音高: 欠測（null）' }).waitFor();
      assert.match(await page.locator('#conditions').textContent(), /不合格:.*音高/);
      await page.locator('#case').selectOption('score-39');
      assert.equal(await page.locator('#play').isDisabled(), true);
      const missing = study.unavailableClips.find(item => item.method === 'sample' && item.case === 'score-39');
      assert.ok(missing, 'Unavailable sample score has an explicit recorded reason');
      assert.ok((await page.locator('#conditions').textContent()).includes(missing.reason));
      if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, 'audition-study-sample-unavailable.png'), fullPage: true });
      await page.locator(`[data-method="${method.id}"]`).click();
      await page.locator('#case').selectOption('mid-normal');
      await page.locator('#data-status').filter({ hasText: '表示:' }).waitFor();
    }
    if (study.methods.some(item => item.id === 'production96')) {
      assert.match(await page.locator('[data-method="production96"]').textContent(), /技術候補・聴感未評価/);
      await page.locator('[data-method="production96"]').click();
      assert.equal(await page.locator('#case').inputValue(), 'score-39', 'Clicking only the production method selects its available score');
      assert.equal(await page.locator('#play').isDisabled(), false, 'Production is playable without knowing a second selection');
      assert.match(await page.locator('#play-status').textContent(), /切り替えました/);
      await page.locator('#data-status').filter({ hasText: '表示:' }).waitFor();
      await page.locator('#route').selectOption('lake');
      await page.locator('#play').click();
      await status(page, 'を再生中');
      await page.waitForFunction(() => {
        const analyser = window.studyAnalysers[1];
        const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
        return data.some(value => Math.abs(value) > 1e-5);
      });
      await page.locator('#stop').click();
    }
    assert.equal(await page.locator('#heard').isChecked(), false);
    assert.equal(await page.locator('#judgement').inputValue(), 'unevaluated');
    if (screenshotDirectory) {
      await page.screenshot({ path: join(screenshotDirectory, 'audition-study-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.evaluate(() => { scrollTo(0, 0); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: join(screenshotDirectory, 'audition-study-375.png'), fullPage: true });
    }
  } finally { await page.close(); }
});

// A compact environment record accompanies screenshots without treating fixtures as human listening.
after(async () => {
  if (screenshotDirectory && browser) await writeFile(join(screenshotDirectory, 'verification.json'), JSON.stringify({
    browser: browser.version(), fixtures: 'generated 48kHz mono sine; not the research render',
    humanListening: 'not performed', origin, generatedStudyIncluded: Boolean(studyManifestPath), study: studyEvidence,
    viewports: ['1440x1080', '375x812', '812x375'],
  }, null, 2));
});
