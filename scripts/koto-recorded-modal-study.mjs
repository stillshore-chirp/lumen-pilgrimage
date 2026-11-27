import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { renderSampleKotoNote } from '../src/coast/world/lake/kotoSampleModel.ts';
import { renderKotoStudyCase } from '../src/coast/world/lake/kotoPerformance.ts';
import { ANALYSIS_RATE, CASES, CRITERIA, analyzeNote, db, decodeMonoWav, encodeWav,
  fftMagnitudes, normalizationPlan, rmsOf, signalStats, spectralPeak, visualization } from './koto-analysis.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = resolve(ROOT, 'artifacts/koto-recorded-modal-trial');
const DEFAULT_EVALUATION = resolve(ROOT, 'artifacts/koto-study');
const RATE = ANALYSIS_RATE;
const HASH = bytes => createHash('sha256').update(bytes).digest('hex');
const FROZEN_INPUTS = {
  'src/coast/world/lake/kotoPhysicalModel.ts': '0f9fe7cd79f40e6e5f117070f59051837b9a74c2e8622d5eb7d3f8912367be2a',
  'src/coast/world/lake/kotoSampleModel.ts': '6ca104c08eff9885b1e031633f1e11904f26611a2fd15e6c591b9159592aea95',
  'src/coast/world/lake/kotoPerformance.ts': '9369a44f18b55e54412301a332e1446c30720bcbbab3fd767b7b73d2440e02bd',
  'public/lake-audio/samples/bank.json': '0e7d90f2665021b985809c611d94c5dd4aed1c45e4341b4263cd16f287afc686',
  'assets/lake-audio/history/koto-performance-hybrid96.wav': 'c73976efaa69ff309fdb66e765acad4e46c08770e850f0c3997ad78d909838c2',
};
export const FIT_CRITERIA = Object.freeze({
  minimumWindowPoints: 6, minimumAmplitudeR2: 0.8, maximumPhaseRmsRadians: 0.35,
  minimumDecayDbPerSecond: 8, maximumDecayDbPerSecond: 500,
  maximumRelativeModeLevelDb: -55, minimumFinalAmplitudeDbfs: -90,
  maximumFrequencyCorrectionCents: 25, maximumReconstructionResidualRatio: 0.5,
  maximumModes: 12, crossfadeSeconds: 0.035,
  maximumExtrapolationFitWindowMultiples: 2, maximumExtrapolationSeconds: 1,
});

/** Bind measured/rendered data to the v1 contract consumed by kotoAudition.ts. */
export function auditionManifestV1(draft, baseline) {
  if (!baseline || !['revision', 'sourcePath', 'sha256'].every(key => typeof baseline[key] === 'string' && baseline[key])) {
    throw new Error('The recorded comparison baseline is required.');
  }
  const clips = draft.clips.map(clip => {
    const frames = clip.measurements.frames;
    const durationSeconds = clip.measurements.durationSeconds;
    const matchGainDb = draft.normalization.anchors[`${clip.method}:notes`].gainDb;
    const commonSafetyGainDb = draft.normalization.commonSafetyGainDb;
    if (!Number.isInteger(frames) || frames < 1 || Math.abs(durationSeconds - frames / draft.sampleRate) > 1e-9
      || !Number.isFinite(matchGainDb) || !Number.isFinite(commonSafetyGainDb)
      || Math.abs(clip.measurements.matched.gainDb - matchGainDb - commonSafetyGainDb) > 1e-9) {
      throw new Error('Measured clip dimensions or applied gain disagree with the comparison metadata.');
    }
    return { ...clip, sampleRate: draft.sampleRate, frames, durationSeconds,
      visualization: clip.visualizationPath, matchGainDb, commonSafetyGainDb };
  });
  return { ...draft, baseline: { ...baseline }, clips };
}

function linearFit(points) {
  const x = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const y = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (const [a, b] of points) { numerator += (a - x) * (b - y); denominator += (a - x) ** 2; }
  const slope = numerator / Math.max(1e-30, denominator);
  const intercept = y - slope * x;
  const residual = points.reduce((sum, [a, b]) => sum + (b - slope * a - intercept) ** 2, 0);
  const variance = points.reduce((sum, [, b]) => sum + (b - y) ** 2, 0);
  return { slope, intercept, r2: 1 - residual / Math.max(1e-30, variance),
    rmsResidual: Math.sqrt(residual / points.length) };
}

function phaseTrack(values) {
  let previous = values[0];
  return values.map((value, index) => {
    if (index) {
      while (value - previous > Math.PI) value -= 2 * Math.PI;
      while (value - previous < -Math.PI) value += 2 * Math.PI;
    }
    previous = value;
    return value;
  });
}

function complexFrames(samples, frequency, sampleRate, startSeconds, endSeconds) {
  const windowFrames = Math.round(Math.min(0.085, (endSeconds - startSeconds) * 0.55) * sampleRate);
  const hop = Math.max(1, Math.round(0.010 * sampleRate));
  const window = Float64Array.from({ length: windowFrames }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (windowFrames - 1)));
  const windowSum = window.reduce((sum, value) => sum + value, 0);
  const output = [];
  const first = Math.round(startSeconds * sampleRate);
  const last = Math.round(endSeconds * sampleRate) - windowFrames;
  const angle = 2 * Math.PI * frequency / sampleRate;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  for (let start = first; start <= last; start += hop) {
    let cos = Math.cos(angle * start);
    let sin = Math.sin(angle * start);
    let re = 0;
    let im = 0;
    for (let i = 0; i < windowFrames; i += 1) {
      const value = samples[start + i] * window[i];
      re += value * cos; im -= value * sin;
      const next = cos * cosine - sin * sine;
      sin = sin * cosine + cos * sine; cos = next;
    }
    output.push({ seconds: (start + (windowFrames - 1) / 2) / sampleRate,
      amplitude: 2 * Math.hypot(re, im) / windowSum, phase: Math.atan2(im, re) });
  }
  return output;
}

function modeAt(mode, time) {
  return mode.amplitudeAtEnd * Math.exp(-mode.decayRate * (time - mode.endSeconds))
    * Math.cos(2 * Math.PI * mode.frequency * time + mode.phaseIntercept);
}

/** Fit/extrapolate damped modes; this is measured-constrained synthesis, not recorded sustain. */
export function extendRecordedSample(sample, sampleRate, rootFrequency, fadeOutSeconds, duration = 6) {
  if (!(sample instanceof Float32Array) || sample.length < 64 || sample.some(value => !Number.isFinite(value))
    || !Number.isFinite(rootFrequency) || rootFrequency <= 0 || sampleRate !== RATE
    || !Number.isFinite(fadeOutSeconds) || fadeOutSeconds < 0 || fadeOutSeconds >= sample.length / sampleRate
    || !Number.isFinite(duration) || duration < sample.length / sampleRate || duration > 10) {
    throw new RangeError('Invalid recorded-modal study input.');
  }
  const started = performance.now();
  const validEnd = sample.length / sampleRate - fadeOutSeconds;
  const fitStart = Math.max(0.035, validEnd - 0.32);
  const fitEnd = validEnd - 0.004;
  const fftStart = Math.round(fitStart * sampleRate);
  const fftEnd = Math.round(fitEnd * sampleRate);
  const fft = fftMagnitudes(sample.subarray(fftStart, fftEnd), 65536);
  const spectrumPeaks = Array.from({ length: Math.min(FIT_CRITERIA.maximumModes, Math.floor(sampleRate * 0.42 / rootFrequency)) }, (_, i) => {
    const order = i + 1;
    return { order, ...spectralPeak(fft, sampleRate, rootFrequency * order, 65536, 0.018) };
  });
  const strongest = Math.max(...spectrumPeaks.map(peak => peak.magnitude));
  const fitted = [];
  for (const peak of spectrumPeaks) {
    let frames = complexFrames(sample, peak.hz, sampleRate, fitStart, fitEnd);
    const firstPhase = linearFit(frames.map((frame, i) => [frame.seconds, phaseTrack(frames.map(value => value.phase))[i]]));
    const frequency = peak.hz + firstPhase.slope / (2 * Math.PI);
    const correctionCents = 1200 * Math.log2(frequency / peak.hz);
    frames = complexFrames(sample, frequency, sampleRate, fitStart, fitEnd);
    const amplitude = linearFit(frames.map(frame => [frame.seconds, db(frame.amplitude)]));
    const phases = phaseTrack(frames.map(frame => frame.phase));
    const phase = linearFit(frames.map((frame, i) => [frame.seconds, phases[i]]));
    const phaseIntercept = phases.reduce((sum, value) => sum + value, 0) / phases.length;
    const phaseRms = Math.sqrt(phases.reduce((sum, value) => sum + (value - phaseIntercept) ** 2, 0) / phases.length);
    const finalAmplitude = 10 ** ((amplitude.intercept + amplitude.slope * validEnd) / 20);
    const reasons = [];
    if (frames.length < FIT_CRITERIA.minimumWindowPoints) reasons.push('short-fit-window');
    if (amplitude.r2 < FIT_CRITERIA.minimumAmplitudeR2) reasons.push('unstable-amplitude-decay');
    if (phaseRms > FIT_CRITERIA.maximumPhaseRmsRadians) reasons.push('unstable-phase-or-beating');
    if (-amplitude.slope < FIT_CRITERIA.minimumDecayDbPerSecond || -amplitude.slope > FIT_CRITERIA.maximumDecayDbPerSecond) reasons.push('decay-outside-conservative-fit-range');
    if (db(peak.magnitude / strongest) < FIT_CRITERIA.maximumRelativeModeLevelDb
      || db(finalAmplitude) < FIT_CRITERIA.minimumFinalAmplitudeDbfs) reasons.push('mode-below-reliable-level');
    if (Math.abs(correctionCents) > FIT_CRITERIA.maximumFrequencyCorrectionCents) reasons.push('unstable-frequency');
    fitted.push({ order: peak.order, frequency, spectralPeakHz: peak.hz, correctionCents,
      amplitudeAtEnd: finalAmplitude, amplitudeAtEndDbfs: db(finalAmplitude),
      phaseIntercept, phaseDriftRadiansPerSecond: phase.slope, phaseRmsRadians: phaseRms,
      decayDbPerSecond: amplitude.slope, decayRate: -amplitude.slope * Math.LN10 / 20,
      amplitudeR2: amplitude.r2, amplitudeFitResidualDb: amplitude.rmsResidual,
      pointCount: frames.length, endSeconds: validEnd, accepted: reasons.length === 0, rejectionReasons: reasons });
  }
  const accepted = fitted.filter(mode => mode.accepted);
  const crossfadeEnd = validEnd;
  const crossfadeStart = Math.max(fitStart, crossfadeEnd - FIT_CRITERIA.crossfadeSeconds);
  const first = Math.round(crossfadeStart * sampleRate);
  const last = Math.round(crossfadeEnd * sampleRate);
  let error = 0;
  let reference = 0;
  let phaseError = 0;
  for (let index = first; index < last; index += 1) {
    const model = accepted.reduce((sum, mode) => sum + modeAt(mode, index / sampleRate), 0);
    error += (sample[index] - model) ** 2; reference += sample[index] ** 2;
    phaseError = Math.max(phaseError, Math.abs(sample[index] - model));
  }
  const reconstructionResidualRatio = Math.sqrt(error / Math.max(1e-30, reference));
  const extensionAvailable = accepted.length > 0 && reconstructionResidualRatio <= FIT_CRITERIA.maximumReconstructionResidualRatio;
  const result = new Float32Array(Math.round(duration * sampleRate));
  // Confidence in a short local regression does not identify a multi-second
  // sustain. This conservative research cap is an explicit design assumption.
  const extensionEndSeconds = Math.min(duration,
    validEnd + Math.min(FIT_CRITERIA.maximumExtrapolationSeconds,
      (fitEnd - fitStart) * FIT_CRITERIA.maximumExtrapolationFitWindowMultiples));
  if (!extensionAvailable) {
    result.set(sample);
  } else {
    result.set(sample.subarray(0, first));
    const extensionEndFrame = Math.round(extensionEndSeconds * sampleRate);
    for (let index = first; index < extensionEndFrame; index += 1) {
      const time = index / sampleRate;
      const model = accepted.reduce((sum, mode) => sum + modeAt(mode, time), 0);
      const fraction = Math.min(1, Math.max(0, (index - first) / Math.max(1, last - first)));
      const recordingWeight = Math.cos(fraction * Math.PI / 2) ** 2;
      result[index] = model * (1 - recordingWeight) + (index < sample.length ? sample[index] * recordingWeight : 0);
    }
    const endFade = Math.round(Math.min(0.060, (extensionEndSeconds - validEnd) * 0.20) * sampleRate);
    for (let i = 0; i < endFade; i += 1) result[extensionEndFrame - 1 - i] *= Math.sin(i / endFade * Math.PI / 2) ** 2;
  }
  let maximumConnectionDelta = 0;
  let originalAdjacentDeltaInConnection = 0;
  for (let i = Math.max(1, first - 48); i < Math.min(result.length, last + 48); i += 1) {
    maximumConnectionDelta = Math.max(maximumConnectionDelta, Math.abs(result[i] - result[i - 1]));
    originalAdjacentDeltaInConnection = Math.max(originalAdjacentDeltaInConnection, Math.abs((sample[i] ?? 0) - (sample[i - 1] ?? 0)));
  }
  return { samples: result, diagnostics: {
    extensionAvailable, recordedUnchangedUntilSeconds: extensionAvailable ? crossfadeStart : sample.length / sampleRate,
    recordedSourceValidUntilSeconds: validEnd, transitionSourceSeconds: extensionAvailable ? [crossfadeStart, crossfadeEnd] : null,
    synthesizedOnlyAfterSourceSeconds: extensionAvailable ? crossfadeEnd : null,
    synthesizedSupportEndSourceSeconds: extensionAvailable ? extensionEndSeconds : null,
    extrapolationLimitInterpretation: 'At most two observed fit-window lengths, capped at one second; research assumption, not a measured natural sustain duration.',
    fitWindowSourceSeconds: [fitStart, fitEnd], reconstructionResidualRatio, maximumRawModelMismatch: phaseError,
    maximumConnectionDelta, maximumConnectionDeltaDbfs: db(maximumConnectionDelta),
    originalAdjacentDeltaInConnection,
    connectionBoundaryDeltas: extensionAvailable ? {
      start: Math.abs(result[first] - result[first - 1]), end: Math.abs(result[last] - result[last - 1]),
    } : null,
    modes: fitted, acceptedModes: accepted.map(mode => mode.order), renderMs: performance.now() - started,
    limitation: extensionAvailable
      ? 'Independent damped-mode continuation fitted to one lossy take; not recorded sustain, coupled physical model or general koto calibration.'
      : 'No extension: reliable-mode reconstruction failed; original short recording and original fade remain.',
  } };
}

export async function runRecordedModalStudy(output = DEFAULT_OUTPUT, evaluation = DEFAULT_EVALUATION) {
  await mkdir(output, { recursive: true });
  const started = performance.now();
  const inputHashes = { ...FROZEN_INPUTS };
  for (const [path, expected] of Object.entries(FROZEN_INPUTS)) {
    if (HASH(await readFile(resolve(ROOT, path))) !== expected) throw new Error(`Frozen input changed: ${path}`);
  }
  for (const path of ['scripts/koto-recorded-modal-study.mjs', 'scripts/koto-analysis.mjs']) inputHashes[path] = HASH(await readFile(resolve(ROOT, path)));
  const referenceManifestBytes = await readFile(resolve(evaluation, 'manifest.json'));
  const referenceManifest = JSON.parse(referenceManifestBytes);
  if (referenceManifest.sourceDrift?.length
    || referenceManifest.methods.find(method => method.id === 'physical')?.sourceHashes?.['src/coast/world/lake/kotoPhysicalModel.ts']
      !== FROZEN_INPUTS['src/coast/world/lake/kotoPhysicalModel.ts']) {
    throw new Error('Existing comparison is not the frozen physical reference.');
  }
  const bank = JSON.parse(await readFile(resolve(ROOT, 'public/lake-audio/samples/bank.json'), 'utf8'));
  const fittedBank = [];
  const rootFits = [];
  for (const item of bank.samples) {
    const path = `public/lake-audio/samples/${item.path}`;
    const bytes = await readFile(resolve(ROOT, path));
    if (HASH(bytes) !== item.sha256) throw new Error('Sample input hash mismatch');
    inputHashes[path] = item.sha256;
    const decoded = decodeMonoWav(bytes);
    const fitted = extendRecordedSample(decoded.samples, decoded.sampleRate, item.rootFrequency, item.fadeOutSeconds);
    fittedBank.push({ ...item, samples: fitted.samples });
    rootFits.push({ id: item.id, rootFrequency: item.rootFrequency, ...fitted.diagnostics });
  }
  const selectedCases = CASES.filter(item => ['low-normal', 'mid-normal', 'high-normal', 'melody'].includes(item.id));
  const clips = [];
  const unavailableClips = [];
  for (const item of selectedCases) {
    const diagnostics = [];
    const start = performance.now();
    const samples = renderKotoStudyCase(item.id, (note, rate) => {
      const result = renderSampleKotoNote(note, fittedBank, rate);
      const fit = rootFits.find(root => root.id === result.diagnostics.sampleId);
      diagnostics.push({ ...result.diagnostics, method: 'recorded-modal', modalFitRoot: fit.id,
        extensionAvailable: fit.extensionAvailable, sourceTransitionSeconds: fit.transitionSourceSeconds });
      return result.samples;
    }, RATE);
    clips.push({ id: `recorded-modal-${item.id}`, method: 'recorded-modal', case: item.id, label: item.label,
      samples, rendererDiagnostics: diagnostics, renderMs: performance.now() - start });
    for (const method of ['sample', 'physical', 'hybrid']) {
      const path = resolve(evaluation, `${method}-${item.id}.raw.f32.wav`);
      const bytes = await readFile(path);
      const provenance = referenceManifest.clips.find(clip => clip.method === method && clip.case === item.id);
      if (!provenance || provenance.sha256.rawWav !== HASH(bytes)) throw new Error('Existing comparison WAV provenance mismatch.');
      const decoded = decodeMonoWav(bytes);
      if (decoded.sampleRate !== RATE) throw new Error('Reference rate mismatch');
      clips.push({ id: `${method}-${item.id}`, method, case: item.id, label: item.label,
        samples: decoded.samples, reusedRaw: { path, sha256: HASH(bytes) } });
    }
  }
  const normalization = normalizationPlan(clips);
  for (const clip of clips) {
    const item = selectedCases.find(value => value.id === clip.case);
    const stats = signalStats(clip.samples, RATE);
    const pureReference = clips.find(candidate => candidate.method === 'sample' && candidate.case === clip.case)?.samples;
    const first150msRawMatchesSample = clip.method === 'recorded-modal'
      ? clip.samples.subarray(0, Math.round(0.150 * RATE)).every((value, index) => value === pureReference[index]) : null;
    const note = item.kind === 'note' ? analyzeNote(clip.samples, RATE, item) : null;
    const key = `${clip.method}:notes`;
    const gainDb = normalization.anchors[key].gainDb + normalization.commonSafetyGainDb;
    const matched = Float32Array.from(clip.samples, value => value * 10 ** (gainDb / 20));
    clip.rawWav = `${clip.id}.raw.f32.wav`; clip.matchedWav = `${clip.id}.matched.wav`;
    clip.visualizationPath = `${clip.id}.visualization.json`;
    clip.measurements = { ...stats, note, first150msRawMatchesSample, matched: { gainDb, ...signalStats(matched, RATE) },
      gates: { finite: stats.nonFiniteCount === 0, peak: signalStats(matched).samplePeakDbfs <= -3 + 1e-6,
        dc: stats.absoluteDcDbfs <= -60, pitch: note ? note.pitch.measuredHz !== null && Math.abs(note.pitch.errorCents) <= 10 : null },
      limitation: 'Research waveform metrics; instrument identity and naturalness require human listening.' };
    await writeFile(resolve(output, clip.rawWav), encodeWav(clip.samples, RATE, true));
    await writeFile(resolve(output, clip.matchedWav), encodeWav(matched, RATE));
    await writeFile(resolve(output, clip.visualizationPath), JSON.stringify(visualization(clip.samples, RATE), null, 2));
    await writeFile(resolve(output, `${clip.id}.measurements.json`), JSON.stringify(clip.measurements, null, 2));
    clip.sha256 = { rawWav: HASH(await readFile(resolve(output, clip.rawWav))), matchedWav: HASH(await readFile(resolve(output, clip.matchedWav))) };
    delete clip.samples;
  }
  const sourceDrift = [];
  for (const [path, expected] of Object.entries(inputHashes)) if (HASH(await readFile(resolve(ROOT, path))) !== expected) sourceDrift.push(path);
  const manifest = auditionManifestV1({ schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'research-trial-not-production-or-human-approved',
    sampleRate: RATE, channels: 1, baseRevision: '8d022fa', environment: { node: process.version, platform: process.platform, architecture: process.arch },
    rationale: 'Owner identified the frozen production candidate as guitar; preserve full-band recording and its low partials beyond 150ms instead of a high-band-only attack.',
    inputHashes, sourceDrift, fitCriteria: FIT_CRITERIA, rootFits, criteria: CRITERIA,
    reusedEvaluation: { manifestPath: resolve(evaluation, 'manifest.json'), sha256: HASH(referenceManifestBytes) },
    reproduction: 'node --experimental-transform-types scripts/koto-recorded-modal-study.mjs',
    methods: [{ id: 'recorded-modal', label: '試作・全帯域実録＋測定モード延長', status: 'rendered', nativeSampleRate: RATE,
      limitations: ['Extension is independent damped-mode synthesis, not recorded sustain or the coupled physical engine.',
        'One uncontrolled lossy take per root, unverified 13-string instrument, no calibrated velocity layers.',
        'Unreliable roots/modes are not extrapolated; ±5 semitone and A3/Bb3 unavailability remain.'] },
    ...['sample', 'physical', 'hybrid'].map(id => ({ id, label: id, status: 'reused-existing-raw', nativeSampleRate: RATE }))],
    cases: selectedCases, normalization, clips, unavailableClips,
    wallMs: performance.now() - started,
    unperformed: ['human-instrument-identity-and-naturalness', 'blind-listening', 'full39-performance', 'browser-or-spatial-realtime', 'general-instrument-calibration'],
  }, referenceManifest.baseline);
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = await runRecordedModalStudy(process.argv[2], process.argv[3]);
    console.log(JSON.stringify({ clips: manifest.clips.length, rootsWithExtension: manifest.rootFits.filter(root => root.extensionAvailable).map(root => root.id),
      sourceDrift: manifest.sourceDrift, wallMs: manifest.wallMs, manifest: resolve(process.argv[2] ?? DEFAULT_OUTPUT, 'manifest.json') }));
    if (manifest.sourceDrift.length) process.exitCode = 2;
  } catch {
    console.error('Recorded-modal study failed; inspect reviewed inputs and reproduction arguments.');
    process.exitCode = 1;
  }
}
