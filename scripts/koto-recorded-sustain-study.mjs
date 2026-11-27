import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { renderSampleKotoNote } from '../src/coast/world/lake/kotoSampleModel.ts';
import { applyKotoExcitationColor } from '../src/coast/world/lake/kotoExcitationColor.ts';
import { LAKE_KOTO_EVENTS, LAKE_KOTO_TUNING, renderKotoStudyCase } from '../src/coast/world/lake/kotoPerformance.ts';
import { evaluatePerformancePress, noteRecordingCoverage } from './koto-recording-performance-study.mjs';
import { ANALYSIS_RATE, CASES, CRITERIA, analyzeNote, db, decodeMonoWav, encodeWav, fftMagnitudes,
  normalizationPlan, rmsOf, signalStats, spectralPeak, visualization } from './koto-analysis.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RATE = ANALYSIS_RATE;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const FFMPEG = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const FROZEN = {
  'src/coast/world/lake/kotoSampleModel.ts': '6ca104c08eff9885b1e031633f1e11904f26611a2fd15e6c591b9159592aea95',
  'src/coast/world/lake/kotoPhysicalModel.ts': '0f9fe7cd79f40e6e5f117070f59051837b9a74c2e8622d5eb7d3f8912367be2a',
  'src/coast/world/lake/kotoPerformance.ts': '9369a44f18b55e54412301a332e1446c30720bcbbab3fd767b7b73d2440e02bd',
  'assets/lake-audio/history/koto-performance-hybrid96.wav': 'c73976efaa69ff309fdb66e765acad4e46c08770e850f0c3997ad78d909838c2',
  'public/lake-audio/samples/bank.json': '0e7d90f2665021b985809c611d94c5dd4aed1c45e4341b4263cd16f287afc686',
};

/** Bounded offline time modification. It never predicts a recorded future. */
export function finiteRecordedTail(samples, { validEndSeconds, prefixSeconds = 0.12, factor = 3,
  ffmpeg = FFMPEG, minimumTailSeconds = 0.15 } = {}) {
  if (!(samples instanceof Float32Array) || samples.some(value => !Number.isFinite(value))
    || !Number.isFinite(validEndSeconds) || validEndSeconds > samples.length / RATE
    || !Number.isFinite(factor) || factor < 1 || factor > 3 || !Number.isFinite(prefixSeconds)
    || prefixSeconds < .12 || validEndSeconds - prefixSeconds < minimumTailSeconds) {
    throw new RangeError('Insufficient finite recorded tail or unsupported stretch range.');
  }
  const started = performance.now(), first = Math.round(prefixSeconds * RATE), context = Math.round(0.1 * RATE);
  const end = Math.round(validEndSeconds * RATE), input = samples.subarray(context, end);
  const tempo = (1 / Math.sqrt(factor)).toFixed(12);
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', 'pipe:0',
    '-af', `atempo=${tempo},atempo=${tempo}`, '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'];
  const process = spawnSync(ffmpeg, args, { input: Buffer.from(input.buffer, input.byteOffset, input.byteLength),
    maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (process.error || process.status !== 0 || process.stdout.length % 4) throw new Error('Offline finite-tail processing failed.');
  const stretched = Float32Array.from({ length: process.stdout.length / 4 }, (_, i) => process.stdout.readFloatLE(i * 4));
  const overlap = Math.round(0.04 * RATE), limit = Math.min(Math.round(0.1 * RATE), stretched.length - overlap);
  if (limit < 0) throw new Error('Offline finite-tail output is too short.');
  const window = Float64Array.from({ length: overlap }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (overlap - 1)));
  let referenceEnergy = 0;
  for (let i = 0; i < overlap; i += 1) referenceEnergy += samples[first + i] ** 2 * window[i] ** 2;
  let best = { offset: 0, score: -Infinity, correlation: 0, energyRatio: 0 };
  for (let offset = 0; offset <= limit; offset += 1) {
    let numerator = 0, energy = 0;
    for (let i = 0; i < overlap; i += 1) {
      const w2 = window[i] ** 2, value = stretched[offset + i];
      numerator += value * samples[first + i] * w2;
      energy += Math.fround(value * value) * w2;
    }
    const correlation = numerator / Math.sqrt(Math.max(1e-30, energy * referenceEnergy));
    const energyRatio = Math.sqrt(Math.max(1e-30, energy) / Math.max(1e-30, referenceEnergy));
    const score = correlation - 0.01 * Math.abs(Math.log(energyRatio));
    if (score > best.score) best = { offset, score, correlation, energyRatio };
  }
  if (best.correlation < 0.99) throw new Error('Finite-tail phase alignment is unreliable.');
  const length = Math.min(first + stretched.length - best.offset, first + Math.round((end - first) * factor));
  const result = new Float32Array(length); result.set(samples.subarray(0, first));
  result.set(stretched.subarray(best.offset, best.offset + length - first), first);
  for (let i = 0; i < Math.min(overlap, length - first); i += 1) {
    const weight = Math.cos(i / (overlap - 1) * Math.PI / 2) ** 2;
    result[first + i] = Math.fround(Math.fround(samples[first + i] * Math.fround(weight))
      + Math.fround(stretched[best.offset + i] * Math.fround(1 - weight)));
  }
  const endFade = Math.round(0.055 * RATE);
  for (let i = 0; i < endFade; i += 1) {
    result[length - endFade + i] = Math.fround(result[length - endFade + i]
      * Math.fround(Math.cos(i / (endFade - 1) * Math.PI / 2) ** 2));
  }
  let delta = 0, originalDelta = 0;
  for (let i = first - 48; i < first + overlap + 48; i += 1) {
    delta = Math.max(delta, Math.abs(result[i] - result[i - 1]));
    originalDelta = Math.max(originalDelta, Math.abs(samples[i] - samples[i - 1]));
  }
  return { samples: result, diagnostics: { prefixSeconds, validEndSeconds, requestedFactor: factor,
    effectiveTailFactor: (length - first) / (end - first), outputDurationSeconds: length / RATE,
    alignmentOffsetSeconds: best.offset / RATE, alignmentCorrelation: best.correlation,
    alignmentEnergyRatio: best.energyRatio, appliedGain: 1, crossfadeSeconds: overlap / RATE,
    maximumConnectionDelta: delta, originalConnectionDelta: originalDelta,
    first120msBitIdentical: samples.subarray(0, first).every((value, i) => value === result[i]),
    command: [ffmpeg, ...args], renderMs: performance.now() - started,
    interpretation: '実録tailの有限時間加工。自然な未来の再現・物理合成・独立正弦波補完ではありません。' } };
}

/** A static root group per base pitch: pressing a note never switches its root. */
export function selectSustainBank(note, bank) {
  const id = note.frequency <= 330 ? 'low-240-candidate' : note.frequency <= 500 ? 'mid-452'
    : note.frequency <= 700 ? 'high-640' : 'high-792';
  const selected = bank.filter(sample => sample.id === id);
  if (selected.length !== 1) throw new Error('Required recorded root group is missing.');
  return selected;
}

export function measureSustainPressSupport(samples) {
  const start = Math.round(.48 * RATE), end = Math.ceil((.48 + 8192 / RATE + .020) * RATE);
  let minimum1msRms = Infinity, nonFiniteCount = 0;
  for (let i = start; i < end; i += 48) {
    let energy = 0, count = 0;
    for (let j = i; j < Math.min(i + 48, end); j += 1) {
      const value = samples[j]; count += 1;
      if (!Number.isFinite(value)) nonFiniteCount += 1;
      else energy += value * value;
    }
    minimum1msRms = Math.min(minimum1msRms, Math.sqrt(energy / count));
  }
  return { windowSeconds: [.48, end / RATE], marginSeconds: .020, minimum1msRms,
    minimum1msRmsDbfs: db(minimum1msRms), nonFiniteCount,
    pass: samples.length >= end && nonFiniteCount === 0 && minimum1msRms > 1e-5 };
}

function rootFeatures(samples, rootFrequency, start, end) {
  const first = Math.round(start * RATE), last = Math.min(samples.length, Math.round(end * RATE));
  const spectrum = fftMagnitudes(samples.subarray(first, last), 65536);
  const peaks = Array.from({ length: 8 }, (_, i) => spectralPeak(spectrum, RATE, rootFrequency * (i + 1), 65536, 0.025));
  let power = 0, high = 0, weighted = 0;
  for (let i = 0; i < spectrum.length; i += 1) {
    power += spectrum[i] ** 2; weighted += spectrum[i] ** 2 * i * RATE / 65536;
    if (i * RATE / 65536 >= RATE * 0.45) high += spectrum[i] ** 2;
  }
  return { windowSeconds: [start, last / RATE], fundamentalHz: peaks[0].hz,
    rmsDbfs: db(rmsOf(samples.subarray(first,last))), powerCentroidHz: weighted/Math.max(1e-30,power),
    partialRatioDb: peaks.map((peak, i) => ({ harmonic: i + 1, hz: peak.hz, relativeToFundamentalDb: db(peak.magnitude / Math.max(1e-30, peaks[0].magnitude)) })),
    nearNyquistPowerDb: 10 * Math.log10(Math.max(1e-30, high / Math.max(1e-30, power))) };
}

function connectionPartialChanges(source, changed, frequency, prefixSeconds) {
  const first = Math.round(prefixSeconds * RATE), last = first + Math.round(.04 * RATE), result = [];
  for (let harmonic = 1; harmonic <= 4; harmonic += 1) {
    let reX = 0, imX = 0, reY = 0, imY = 0;
    for (let i = first; i < last; i += 1) {
      const window = .5 - .5 * Math.cos(2 * Math.PI * (i-first) / (last-first-1));
      const phase = 2 * Math.PI * frequency * harmonic * i / RATE;
      const cosine = Math.cos(phase) * window, sine = -Math.sin(phase) * window;
      reX += source[i] * cosine; imX += source[i] * sine; reY += changed[i] * cosine; imY += changed[i] * sine;
    }
    result.push({ harmonic, amplitudeChangeDb: db(Math.hypot(reY,imY)/Math.max(1e-30,Math.hypot(reX,imX))),
      phaseChangeRadians: Math.atan2(imY*reX-reY*imX,reY*reX+imY*imX) });
  }
  return result;
}

function plateausControl(samples) {
  const before = rmsOf(samples.subarray(Math.round(.55 * RATE), Math.round(.65 * RATE)));
  const after = rmsOf(samples.subarray(Math.round(.85 * RATE), Math.round(.95 * RATE)));
  return { beforeRmsDbfs: db(before), afterRmsDbfs: db(after), afterNonSilent: after > 1e-5,
    reductionDb: db(before) - db(after), interpretation: '時間加工後の無制動control。source枯渇で消音gateを通していないか確認します。' };
}

export function runAliasFixture(ffmpeg = FFMPEG) {
  const note = { frequency: 100 * 2 ** (5 / 12), velocity: .6, duration: 1 };
  const levels = [];
  for (const hz of [1000, 20000]) {
    const signal = Float32Array.from({ length: 22800 }, (_, i) => .2 * Math.sin(2 * Math.PI * hz * i / RATE));
    const changed = finiteRecordedTail(signal, { validEndSeconds: .405, factor: 3, ffmpeg });
    const bank = [{ id: 'independent-alias-fixture', rootFrequency: 100, sampleRate: RATE, samples: changed.samples,
      sourceId: 'generated-test-sine', sourceStartSeconds: 0, sourceEndSeconds: .475 }];
    const rendered = renderSampleKotoNote(note, bank, RATE).samples;
    levels.push({ inputHz: hz, measuredRmsDbfs: db(rmsOf(rendered.subarray(Math.round(.25 * RATE), Math.round(.65 * RATE)))) });
  }
  const rejectionDb = levels[1].measuredRmsDbfs - levels[0].measuredRmsDbfs;
  return { type: 'known-sine-finite-atempo-plus-sample-upshift', sampleRate: RATE, transposeSemitones: 5,
    levels, rejectionDb, pass: rejectionDb < -70,
    limitation: '20kHzを+5半音で再生する帯域外fixtureの抑圧。実録内のaliasと正当な高域を完全分離する試験ではありません。' };
}

export async function runRecordedSustainStudy(output = resolve(ROOT, 'artifacts/koto-recorded-sustain-trial'),
  recordingStudy = resolve(ROOT, 'artifacts/koto-recording-performance-trial'), ffmpeg = FFMPEG, notePostprocess) {
  const started = performance.now(); await mkdir(resolve(output, 'samples'), { recursive: true });
  if (!ffmpeg.includes('/') && !ffmpeg.includes('\\')) {
    const located = spawnSync(process.platform === 'win32' ? 'where' : 'which', [ffmpeg], { encoding: 'utf8', windowsHide: true });
    if (located.status !== 0) throw new Error('Offline FFmpeg executable was not found.');
    ffmpeg = located.stdout.trim().split(/\r?\n/)[0];
  }
  const inputHashes = { ...FROZEN };
  for (const [path, expected] of Object.entries(FROZEN)) if (hash(await readFile(resolve(ROOT, path))) !== expected) throw new Error('Frozen source changed.');
  for (const path of ['scripts/koto-recorded-sustain-study.mjs', 'scripts/koto-recording-performance-study.mjs', 'scripts/koto-analysis.mjs']) inputHashes[path] = hash(await readFile(resolve(ROOT, path)));
  const referenceBytes = await readFile(resolve(recordingStudy, 'manifest.json')), reference = JSON.parse(referenceBytes);
  const bankBytes = await readFile(resolve(recordingStudy, reference.bank.path));
  if (hash(bankBytes) !== reference.bank.sha256) throw new Error('Private six-root input changed.');
  const metadata = JSON.parse(bankBytes), bank = [], originalBank = [], roots = [], rootAudio = [];
  for (const item of metadata.samples) {
    if (item.path !== item.path.split(/[\\/]/).at(-1)) throw new Error('Invalid root path.');
    const bytes = await readFile(resolve(recordingStudy, 'samples', item.path));
    if (hash(bytes) !== item.sha256) throw new Error('Private source root hash mismatch.');
    const decoded = decodeMonoWav(bytes), original = { ...item, ...decoded }; originalBank.push(original);
    let result = decoded.samples, processing = { status: 'unchanged', reason: '十分な元録音を優先し、必要のない根は加工しません。' };
    if (item.id === 'low-240-candidate') {
      const probe = { frequency: LAKE_KOTO_TUNING[4].frequency, velocity: .56, pressSemitones: 1, duration: 6 };
      const originalSupport = measureSustainPressSupport(renderSampleKotoNote(probe, [original], RATE).samples);
      processing = { status: 'unchanged', originalSupport };
      if (!originalSupport.pass) {
        const attempts = [];
        for (let step = 1; step <= 80; step += 1) {
          const factor = Number((1 + step * .025).toFixed(3));
          const changed = finiteRecordedTail(decoded.samples, { validEndSeconds: item.durationSeconds - item.fadeOutSeconds,
            prefixSeconds: .14, factor, ffmpeg });
          const support = measureSustainPressSupport(renderSampleKotoNote(probe, [{ ...original, samples: changed.samples }], RATE).samples);
          attempts.push({ factor, outputDurationSeconds: changed.samples.length / RATE, support });
          if (support.pass) {
            result = changed.samples; processing = { status: 'minimum-grid-finite-time-modified', ...changed.diagnostics,
              originalSupport, support, factorSearchStep: .025, attempts,
              prefixReason: '最大再生rate1.295で通常音頭100msを保持するため、240Hz根のみsource140ms（120ms以上）を保持します。' };
            break;
          }
        }
        if (processing.status === 'unchanged') throw new Error('240Hz root cannot support the fixed press window plus margin within finite stretch limits.');
      }
    } else if (['mid-452', 'high-640'].includes(item.id)) {
      const changed = finiteRecordedTail(decoded.samples, { validEndSeconds: item.durationSeconds - item.fadeOutSeconds, ffmpeg });
      result = changed.samples; processing = { status: 'finite-time-modified', ...changed.diagnostics };
    } else if (item.id === 'mid-319') processing = { status: 'unchanged-not-used', reason: 'fade前tail93msではprefix120ms/最大3倍でもD4押し手の到達窓を支えられません。D4/Eb4は240Hz根へ静的に統一します。' };
    const name = `${item.id}.float.wav`, wav = encodeWav(result, RATE, true);
    await writeFile(resolve(output, 'samples', name), wav);
    bank.push({ ...item, samples: result });
    roots.push({ ...item, path: name, sha256: hash(wav), bytes: wav.length, originalSha256: item.sha256,
      originalDurationSeconds: item.durationSeconds, frames: result.length, durationSeconds: result.length / RATE,
      processing, sourceFeatures: rootFeatures(decoded.samples, item.rootFrequency, .12, Math.min(.29, item.durationSeconds - item.fadeOutSeconds)),
      processedFeatures: rootFeatures(result, item.rootFrequency, .20, Math.min(.50, result.length / RATE - .055)),
      connectionPartialChanges: processing.status.includes('modified') ? connectionPartialChanges(decoded.samples,result,item.rootFrequency,processing.prefixSeconds) : [] });
    rootAudio.push({ path: `samples/${name}`, sha256: hash(wav) });
  }
  const newBank = { schemaVersion: 1, status: 'research-only-not-public-adoption', sampleRate: RATE, velocityLayers: 1,
    samples: roots, selection: 'G3–Eb4:240; G4–Bb4:452; D5–Eb5:638; G5–A5:792。押し手の有無で根を切り替えません。',
    limitation: '録音tailの時間加工であり自然な未来の再現ではありません。151/319根は保持するが現演奏では使用しません。' };
  await writeFile(resolve(output, 'samples/bank.json'), JSON.stringify(newBank, null, 2));
  const sourceCoverage = LAKE_KOTO_TUNING.map(string => ({ ...string,
    ...noteRecordingCoverage({ frequency: string.frequency, velocity: .6, duration: 6 }, selectSustainBank({ frequency: string.frequency }, bank)) }));
  const clips = [], unavailableClips = []; let eventCoverage = [];
  for (const item of CASES) {
    const diagnostics = [], t = performance.now();
    const samples = renderKotoStudyCase(item.id, (note, rate) => {
      const selected = selectSustainBank(note, bank), rendered = renderSampleKotoNote(note, selected, rate);
      // The baseline run has no postprocess. A later named experiment can inject
      // the separately verified expression processor without changing score/root inputs.
      const voice = notePostprocess ? notePostprocess(rendered.samples, note, rate) : rendered.samples;
      if (!(voice instanceof Float32Array) || voice.length !== rendered.samples.length || voice.some(value => !Number.isFinite(value))) throw new Error('Invalid note postprocess output.');
      diagnostics.push({ ...noteRecordingCoverage(note, selected, voice),
        sustainPressSupport: note.pressSemitones ? measureSustainPressSupport(voice) : null }); return voice;
    }, RATE);
    if (item.kind === 'score') eventCoverage = diagnostics.map((diag, eventIndex) => ({ eventIndex,
      seconds: LAKE_KOTO_EVENTS[eventIndex].seconds, string: LAKE_KOTO_EVENTS[eventIndex].string, ...diag }));
    clips.push({ id: `recorded-sustain-${item.id}`, method: 'recorded-sustain', case: item.id, samples,
      renderMs: performance.now() - t, rendererDiagnostics: diagnostics });
  }
  const reused = reference.clips.filter(clip => clip.method === 'recording-six'
    || (['physical', 'production96'].includes(clip.method) && clip.case === 'score-39'));
  for (const clip of reused) {
    const bytes = await readFile(resolve(recordingStudy, clip.rawWav));
    if (hash(bytes) !== clip.sha256.rawWav) throw new Error('Reused comparison WAV hash mismatch.');
    clips.push({ id: clip.id, method: clip.method, case: clip.case, ...decodeMonoWav(bytes),
      reusedFrom: { manifestSha256: hash(referenceBytes), path: clip.rawWav, rawSha256: hash(bytes) },
      previousMeasurements: clip.measurements });
  }
  const normalization = normalizationPlan(clips), attackChecks = [];
  const performancePress = evaluatePerformancePress(eventCoverage);
  const performanceSustain = eventCoverage.filter(event => event.pressSemitones).every(event => event.sustainPressSupport?.pass === true);
  const undamped = clips.find(clip => clip.method === 'recorded-sustain' && clip.case === 'mid-normal').samples;
  const dampControl = plateausControl(undamped);
  for (const item of CASES.filter(item => item.kind === 'note')) {
    const note = { frequency: item.expectedHz, velocity: item.force, pressSemitones: item.pressSemitones,
      dampAt: item.dampAt, duration: item.durationSeconds, seed: 197 };
    const original = renderSampleKotoNote(note, selectSustainBank(note, originalBank), RATE).samples;
    const current = clips.find(clip => clip.method === 'recorded-sustain' && clip.case === item.id).samples;
    attackChecks.push({ case: item.id, reference: '同じ静的選択rootの時間加工前出力',
      first100msBitIdentical: current.subarray(0,4800).every((value, i) => value === original[i]) });
  }
  const alias = runAliasFixture(ffmpeg);
  const heldoutSource = originalBank.find(sample => sample.id === 'high-792');
  const heldoutChanged = finiteRecordedTail(heldoutSource.samples, { validEndSeconds: .45, ffmpeg });
  const heldout = { sourceId: heldoutSource.sourceId, sourceSha256: heldoutSource.sha256,
    processedInputEndSeconds: .45, unusedRecordedFutureExists: true,
    processing: heldoutChanged.diagnostics,
    actualRecordedFuture: rootFeatures(heldoutSource.samples, heldoutSource.rootFrequency, .52, .82),
    timeModifiedSameClock: rootFeatures(heldoutChanged.samples, heldoutSource.rootFrequency, .52, Math.min(.82, heldoutChanged.samples.length/RATE-.055)),
    interpretation: '同じ時計時刻の実録未来とは音色・包絡が異なります。時間加工の損傷対照であり未来の再現ではありません。' };
  for (const clip of clips) {
    const item = CASES.find(value => value.id === clip.case), stats = signalStats(clip.samples);
    const note = item.kind === 'note' ? analyzeNote(clip.samples, RATE, item) : null;
    const gates = { finite: stats.nonFiniteCount === 0, dc: stats.absoluteDcDbfs <= CRITERIA.absoluteDcDbfs,
      duration: Math.abs(stats.durationSeconds-item.durationSeconds) < 1/RATE,
      pitch: note ? note.pitch.status === 'measured' && Math.abs(note.pitch.errorCents) <= (item.pressSemitones ? CRITERIA.pressedPitchErrorCents : CRITERIA.normalPitchErrorCents) : null,
      damping: note?.damping ? note.damping.status === 'measured' && note.damping.reductionDb >= CRITERIA.dampedReductionDb : null,
      loopSeam: item.kind === 'score' ? stats.loopSeamDbfs <= CRITERIA.loopSeamDbfs : null,
      final50ms: stats.final50msRmsDbfs <= CRITERIA.final50msRmsDbfs };
    if (item.kind === 'score' && clip.method === 'recorded-sustain') {
      gates.performancePress = performancePress.allPass && performanceSustain;
      gates.performanceSustain = performanceSustain;
    }
    if (clip.method === 'recording-six' && item.kind === 'score') gates.performancePress = clip.previousMeasurements.gates.performancePress;
    clip.sampleRate=RATE;clip.frames=clip.samples.length;clip.durationSeconds=clip.frames/RATE;
    clip.matchGainDb=normalization.anchors[`${clip.method}:${clip.case==='score-39'?'score':'notes'}`].gainDb;
    clip.commonSafetyGainDb=normalization.commonSafetyGainDb;
    const matched=Float32Array.from(clip.samples,value=>value*10**((clip.matchGainDb+clip.commonSafetyGainDb)/20));
    clip.measurements={...stats,note,gates,rendererDiagnostics:clip.rendererDiagnostics,
      performancePress:clip.method==='recorded-sustain'&&item.kind==='score'?performancePress:clip.previousMeasurements?.performancePress,
      matched:signalStats(matched)};
    gates.comparisonPeak=clip.measurements.matched.samplePeakDbfs<=-3+1e-6;
    clip.rawWav=`${clip.id}.raw.f32.wav`;clip.matchedWav=`${clip.id}.matched.wav`;
    clip.visualization=`${clip.id}.visualization.json`;clip.measurementsFile=`${clip.id}.measurements.json`;
    await writeFile(resolve(output,clip.rawWav),encodeWav(clip.samples,RATE,true));await writeFile(resolve(output,clip.matchedWav),encodeWav(matched,RATE));
    await writeFile(resolve(output,clip.visualization),JSON.stringify(visualization(clip.samples,RATE,item.onsetSeconds)));
    await writeFile(resolve(output,clip.measurementsFile),JSON.stringify(clip.measurements,null,2));
    clip.sha256={rawWav:hash(await readFile(resolve(output,clip.rawWav))),matchedWav:hash(await readFile(resolve(output,clip.matchedWav)))};
    if(clip.reusedFrom&&clip.sha256.rawWav!==clip.reusedFrom.rawSha256)throw new Error('Reused raw changed.');
    delete clip.samples;delete clip.previousMeasurements;
  }
  const sourceDrift=[];for(const[path,expected]of Object.entries(inputHashes))if(hash(await readFile(resolve(ROOT,path)))!==expected)sourceDrift.push(path);
  const ffmpegVersion=spawnSync(ffmpeg,['-version'],{encoding:'utf8'}).stdout?.match(/ffmpeg version ([^ ]+)/)?.[1]??'unverified';
  const manifest={schemaVersion:1,generatedAt:new Date().toISOString(),sampleRate:RATE,channels:1,baseline:reference.baseline,
    status:'research-only-human-timbre-unassessed',inputHashes,sourceDrift,
    sourceStudy:{manifestPath:resolve(recordingStudy,'manifest.json'),sha256:hash(referenceBytes)},
    bank:{path:'samples/bank.json',sha256:hash(await readFile(resolve(output,'samples/bank.json')))},roots,
    criteria:CRITERIA,cases:CASES,normalization,clips,unavailableClips,sourceCoverage,eventCoverage,
    coverage:{strings:sourceCoverage.filter(row=>row.supported).length,totalStrings:13,events:eventCoverage.filter(row=>row.supported).length,totalEvents:48,
      maximumTransposeSemitones:Math.max(...eventCoverage.map(row=>row.maximumTransposeSemitones)),activeRoots:[...new Set(eventCoverage.map(row=>row.sampleId))]},
    experiments:{attackChecks,dampControl,performancePress,performanceSustain,alias,heldout,
      notePostprocessApplied: !!notePostprocess},
    tool:{path:ffmpeg,version:ffmpegVersion,sha256:hash(await readFile(ffmpeg)),license:'GPLv3-or-later;offline tool only;no program/library distribution',
      references:['https://ffmpeg.org/ffmpeg-filters.html#atempo','https://ffmpeg.org/legal.html','https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/COPYING.GPLv3'],
      outputScope:'GPLv3§2:output is covered only when its content is a covered work. Processed CC0 recording contains no FFmpeg program expression; source audio rights remain separate.'},
    methods:[{id:'recorded-sustain',label:'試作・実録＋有限余韻加工',status:'rendered',nativeSampleRate:RATE,sourceHashes:inputHashes,
      limitations:['録音tailの時間加工です。自然な未来の再現ではありません。','単一強弱層です。元録音の収音位置や個々の奏法は未同定です。','音色・箏らしさは未評価で、本番未採用です。','低域は240Hz根へ統一し、押し手の有無でrootを切り替えません。','時間加工により微細な成分の周期性や減衰の速さが変わります。']},
      {id:'recording-six',label:'比較・元の実録6根',status:'reused',nativeSampleRate:RATE,limitations:['曲内4押し手の到達窓が無音となる、前版の比較音声です。全曲の奏法要件は未達です。']},
      {id:'physical',label:'旧物理音源（参考）',status:'reused',nativeSampleRate:RATE,limitations:['既存の出力を再利用した参考音声です。']},
      {id:'production96',label:'旧候補（箏同定未達）',status:'reused',nativeSampleRate:RATE,limitations:['所有者の聴感で箏の楽器同定に未達です。現候補や聴感未評価の扱いにはしません。']}],
    reproduction:'node --experimental-transform-types scripts/koto-recorded-sustain-study.mjs OUTPUT RECORDING_STUDY FFMPEG',
    wallMs:performance.now()-started,unperformed:['人間による箏同定・音色の一貫性・自然さの評価','全音域の実物較正','録音の本来の未来の再現','実録内aliasの完全分離','実機VRでの聴感']};
  await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2));
  await writeFile(resolve(output,'root-audio-hashes.json'),JSON.stringify(rootAudio,null,2));return manifest;
}

/** Append only three corrected renders; retain all baseline PCM byte-for-byte. */
export async function appendExcitationStudy(output, recordingStudy) {
  const colorPath='src/coast/world/lake/kotoExcitationColor.ts';
  const colorHash=hash(await readFile(resolve(ROOT,colorPath)));
  if(colorHash!=='8041c5a7307769857809310951b3105263219613edd485da0e6e4f81c1b47bb5')throw new Error('Verified excitation processor changed.');
  const previousBytes=await readFile(resolve(output,'manifest.json')),manifest=JSON.parse(previousBytes);
  if(manifest.clips.some(clip=>clip.method==='recorded-sustain-color'))throw new Error('Excitation variant is already frozen.');
  await writeFile(resolve(output,'manifest-before-excitation.json'),previousBytes);
  const preserved=manifest.clips.map(clip=>({id:clip.id,...clip.sha256}));
  const activeIds=['low-240-candidate','mid-452','high-640','high-792'];
  const bank=await Promise.all(manifest.roots.filter(root=>activeIds.includes(root.id)).map(async root=>{
    const bytes=await readFile(resolve(output,'samples',root.path));if(hash(bytes)!==root.sha256)throw new Error('Processed stem changed.');
    return {...root,...decodeMonoWav(bytes)};
  }));
  const selectionChecks=[];
  for(const string of LAKE_KOTO_TUNING){
    const note={frequency:string.frequency,velocity:.6,duration:.05};
    const automatic=renderSampleKotoNote(note,bank,RATE),group=renderSampleKotoNote(note,selectSustainBank(note,bank),RATE);
    selectionChecks.push({string:string.string,automatic:automatic.diagnostics.sampleId,group:group.diagnostics.sampleId,
      identical:automatic.samples.every((value,i)=>value===group.samples[i])});
  }
  const method='recorded-sustain-color',newClips=[];let eventCoverage=[];
  for(const id of ['mid-soft','mid-hard','score-39']){
    const item=CASES.find(value=>value.id===id),diagnostics=[],started=performance.now();
    const samples=renderKotoStudyCase(id,(note,rate)=>{
      const original=renderSampleKotoNote(note,bank,rate),group=renderSampleKotoNote(note,selectSustainBank(note,bank),rate);
      if(original.diagnostics.sampleId!==group.diagnostics.sampleId||!original.samples.every((value,i)=>value===group.samples[i]))throw new Error('Four-root automatic selection differs from study root group.');
      const processed=applyKotoExcitationColor(original.samples,note.velocity,rate);
      diagnostics.push({...noteRecordingCoverage(note,bank,processed.samples),
        sustainPressSupport:note.pressSemitones?measureSustainPressSupport(processed.samples):null,
        excitation:{latencyFrames:processed.latencyFrames,processedFrames:processed.processedFrames,
          tailFramesClipped:processed.tailFramesClipped,bypassed:processed.bypassed},automaticRootEqualsStaticGroup:true});
      return processed.samples;
    },RATE);
    if(item.kind==='score')eventCoverage=diagnostics.map((row,eventIndex)=>({eventIndex,
      seconds:LAKE_KOTO_EVENTS[eventIndex].seconds,string:LAKE_KOTO_EVENTS[eventIndex].string,...row}));
    newClips.push({id:`${method}-${id}`,method,case:id,samples,renderMs:performance.now()-started,rendererDiagnostics:diagnostics});
  }
  const mid=manifest.clips.find(clip=>clip.method==='recorded-sustain'&&clip.case==='mid-normal');
  const midBytes=await readFile(resolve(output,mid.rawWav)),midPcm=decodeMonoWav(midBytes).samples;
  const bypass=applyKotoExcitationColor(midPcm,.6,RATE);
  const referenceBitIdentical=bypass.bypassed&&bypass.latencyFrames===0&&bypass.samples.every((value,i)=>value===midPcm[i]);
  if(!referenceBitIdentical)throw new Error('Reference velocity must remain bit-identical.');
  const normalReference={...mid,id:`${method}-mid-normal`,method,reusedFrom:{path:mid.rawWav,rawSha256:mid.sha256.rawWav},referenceBypass:true};
  const damped=manifest.clips.find(clip=>clip.method==='recorded-sustain'&&clip.case==='damped');
  const dampPcm=decodeMonoWav(await readFile(resolve(output,damped.rawWav))).samples;
  const dampBypass=applyKotoExcitationColor(dampPcm,.6,RATE);
  const dampBitIdentical=dampBypass.samples.every((value,i)=>value===dampPcm[i]);
  const performancePress=evaluatePerformancePress(eventCoverage);
  const performanceSustain=eventCoverage.filter(row=>row.pressSemitones).every(row=>row.sustainPressSupport.pass);
  const normalGain=manifest.normalization.anchors['recorded-sustain:notes'].gainDb;
  manifest.normalization.anchors[`${method}:notes`]={...manifest.normalization.anchors['recorded-sustain:notes'],referenceBitIdentical};
  const score=newClips.find(clip=>clip.case==='score-39'),scoreRms=db(rmsOf(score.samples));
  manifest.normalization.anchors[`${method}:score`]={case:'score-39',rmsDbfs:scoreRms,gainDb:-24-scoreRms};
  for(const clip of newClips){
    const item=CASES.find(value=>value.id===clip.case),stats=signalStats(clip.samples),note=item.kind==='note'?analyzeNote(clip.samples,RATE,item):null;
    clip.sampleRate=RATE;clip.frames=clip.samples.length;clip.durationSeconds=clip.frames/RATE;
    clip.matchGainDb=item.kind==='score'?-24-scoreRms:normalGain;clip.commonSafetyGainDb=manifest.normalization.commonSafetyGainDb;
    const matched=Float32Array.from(clip.samples,value=>value*10**((clip.matchGainDb+clip.commonSafetyGainDb)/20));
    const matchedStats=signalStats(matched),gates={finite:stats.nonFiniteCount===0,dc:stats.absoluteDcDbfs<=CRITERIA.absoluteDcDbfs,
      duration:Math.abs(stats.durationSeconds-item.durationSeconds)<1/RATE,
      pitch:note?note.pitch.status==='measured'&&Math.abs(note.pitch.errorCents)<=CRITERIA.normalPitchErrorCents:null,
      damping:null,loopSeam:item.kind==='score'?stats.loopSeamDbfs<=CRITERIA.loopSeamDbfs:null,
      final50ms:stats.final50msRmsDbfs<=CRITERIA.final50msRmsDbfs,comparisonPeak:matchedStats.samplePeakDbfs<=-3+1e-6,
      excitationTailRetained:clip.rendererDiagnostics.every(row=>row.excitation.tailFramesClipped===0)};
    if(item.kind==='score'){gates.performancePress=performancePress.allPass&&performanceSustain;gates.performanceSustain=performanceSustain;}
    clip.measurements={...stats,note,gates,matched:matchedStats,rendererDiagnostics:clip.rendererDiagnostics,
      performancePress:item.kind==='score'?performancePress:undefined};
    clip.rawWav=`${clip.id}.raw.f32.wav`;clip.matchedWav=`${clip.id}.matched.wav`;
    clip.visualization=`${clip.id}.visualization.json`;clip.measurementsFile=`${clip.id}.measurements.json`;
    await writeFile(resolve(output,clip.rawWav),encodeWav(clip.samples,RATE,true));await writeFile(resolve(output,clip.matchedWav),encodeWav(matched,RATE));
    await writeFile(resolve(output,clip.visualization),JSON.stringify(visualization(clip.samples,RATE,item.onsetSeconds)));
    await writeFile(resolve(output,clip.measurementsFile),JSON.stringify(clip.measurements,null,2));
    clip.sha256={rawWav:hash(await readFile(resolve(output,clip.rawWav))),matchedWav:hash(await readFile(resolve(output,clip.matchedWav)))};delete clip.samples;
  }
  const newFailures=newClips.flatMap(clip=>Object.entries(clip.measurements.gates).filter(([,pass])=>pass===false).map(([gate])=>`${clip.id}:${gate}`));
  if(!dampBitIdentical||!damped.measurements.gates.damping||!manifest.experiments.dampControl.afterNonSilent)newFailures.push('reference-damping-or-non-silent-control');
  if(selectionChecks.some(row=>!row.identical))newFailures.push('four-root-selection');
  manifest.clips.push(normalReference,...newClips);
  manifest.methods.push({id:method,label:'試作・実録＋有限余韻加工＋相対励振補正',status:'rendered',nativeSampleRate:RATE,
    sourceHashes:{[colorPath]:colorHash},limitations:['録音tailの有限時間加工です。自然な未来の再現ではありません。',
      '単一強弱層へ相対励振フィルタを適用しています。実録の強弱層ではありません。','通常強度0.6は同一波形です。元録音の収音や奏法は未同定です。','音色・箏らしさは未評価です。終了の合意を品質合格とは扱いません。']});
  manifest.experiments.excitation={sourcePath:colorPath,sha256:colorHash,referenceBitIdentical,dampBitIdentical,
    damping:damped.measurements.note.damping,dampControl:manifest.experiments.dampControl,selectionChecks,eventCoverage,performancePress,performanceSustain,
    failures:newFailures,status:newFailures.length?'technical-failure-use-uncorrected':'technical-gates-pass-timbre-unassessed',
    macroGain:'existing sampler velocity/0.6 retained; no added velocity gain',maximumLatencyFrames:Math.max(...eventCoverage.map(row=>row.excitation.latencyFrames))};
  for(const old of preserved){const clip=manifest.clips.find(value=>value.id===old.id);
    if(hash(await readFile(resolve(output,clip.rawWav)))!==old.rawWav||hash(await readFile(resolve(output,clip.matchedWav)))!==old.matchedWav)throw new Error('Baseline PCM changed.');}
  manifest.inputHashes['scripts/koto-recorded-sustain-study.mjs']=hash(await readFile(fileURLToPath(import.meta.url)));
  delete manifest.inputHashes['public/lake-audio/koto-performance.wav'];
  manifest.inputHashes['assets/lake-audio/history/koto-performance-hybrid96.wav']=FROZEN['assets/lake-audio/history/koto-performance-hybrid96.wav'];
  manifest.inputHashes[colorPath]=colorHash;
  manifest.experiments.preExcitationManifestSha256=hash(previousBytes);manifest.experiments.preserved26ClipHashes=preserved;
  manifest.reproduction='node --experimental-transform-types scripts/koto-recorded-sustain-study.mjs OUTPUT RECORDING_STUDY FFMPEG';
  manifest.generatedAt=new Date().toISOString();manifest.sourceDrift=[];
  for(const[path,expected]of Object.entries(manifest.inputHashes))if(hash(await readFile(resolve(ROOT,path)))!==expected)manifest.sourceDrift.push(path);
  // Shipping input closure: unmodified six-root inputs are separate from processed four-root stems.
  await mkdir(resolve(output,'handoff/sustain'),{recursive:true});await mkdir(resolve(output,'handoff/original'),{recursive:true});
  const originalBank=JSON.parse(await readFile(resolve(recordingStudy,'samples/bank.json')));
  for(const item of originalBank.samples){const bytes=await readFile(resolve(recordingStudy,'samples',item.path));if(hash(bytes)!==item.sha256)throw new Error('Original bank changed.');
    if(item.id==='low-240-candidate'){await writeFile(resolve(output,'handoff/original/low-240.wav'),bytes);item.path='low-240.wav';}}
  await writeFile(resolve(output,'handoff/original/recorded-bank.json'),JSON.stringify(originalBank,null,2));
  const shippingRoots=[];
  for(const root of manifest.roots.filter(row=>activeIds.includes(row.id))){const bytes=await readFile(resolve(output,'samples',root.path));await writeFile(resolve(output,'handoff/sustain',root.path),bytes);
    const samples=decodeMonoWav(bytes).samples,stats=signalStats(samples);
    shippingRoots.push({...root,fadeOutSeconds:root.processing.status.includes('modified')?.055:root.fadeOutSeconds,
      peakDbfs:stats.samplePeakDbfs,rmsDbfs:stats.rmsDbfs,processing:root.processing});}
  const shippingBank={schemaVersion:1,status:'technical-delivery-candidate-timbre-unassessed',sampleRate:RATE,maxTransposeSemitones:5,
    velocityLayers:1,samples:shippingRoots,selection:'既存nearest samplerの4根選択と全13弦/48eventで一致。',
    limitation:'有限時間加工された録音tail。実録の自然な未来・物理合成・複数強弱層ではありません。'};
  await writeFile(resolve(output,'handoff/sustain/bank.json'),JSON.stringify(shippingBank,null,2));
  manifest.handoff={originalBank:'handoff/original/recorded-bank.json',original240:'handoff/original/low-240.wav',
    processedBank:'handoff/sustain/bank.json',processedBankSha256:hash(await readFile(resolve(output,'handoff/sustain/bank.json'))),
    selectedScore:newFailures.length?'recorded-sustain-score-39':`${method}-score-39`,
    renderContract:'renderKotoStudyCase("score-39",(note,rate)=>applyKotoExcitationColor(renderSampleKotoNote(note,fourRootBank,rate).samples,note.velocity,rate).samples,48000); no extra macro gain',
    note:'未加工6根を再加工の入力とする。処理済み4根をatempoへ再投入しない。最終24bit配布encodeはmain担当。'};
  await writeFile(resolve(output,'manifest.json'),JSON.stringify(manifest,null,2));return manifest;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const appendOnly=process.argv[2]==='--append-excitation';const output=resolve(appendOnly?process.argv[3]??resolve(ROOT,'artifacts/koto-recorded-sustain-trial'):process.argv[2]??resolve(ROOT,'artifacts/koto-recorded-sustain-trial'));const source=resolve(appendOnly?process.argv[4]??resolve(ROOT,'artifacts/koto-recording-performance-trial'):process.argv[3]??resolve(ROOT,'artifacts/koto-recording-performance-trial'));
    if(!appendOnly)await runRecordedSustainStudy(output,source,process.argv[4]);
    const m=await appendExcitationStudy(output,source);console.log(JSON.stringify({clips:m.clips.length,coverage:m.coverage,excitation:m.experiments.excitation.status,sourceDrift:m.sourceDrift,selectedScore:m.handoff.selectedScore}));if(m.sourceDrift.length)process.exitCode=2;}
  catch{console.error('Recorded sustain study failed; verify frozen inputs, private six-root study and offline FFmpeg.');process.exitCode=1;}
}
