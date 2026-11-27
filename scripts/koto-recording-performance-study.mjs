import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { renderSampleKotoNote, kotoSampleSupports } from '../src/coast/world/lake/kotoSampleModel.ts';
import { LAKE_KOTO_TUNING, LAKE_KOTO_EVENTS, renderKotoStudyCase } from '../src/coast/world/lake/kotoPerformance.ts';
import { ANALYSIS_RATE, CASES, CRITERIA, analyzeNote, db, decodeMonoWav, encodeWav, fftMagnitudes,
  normalizationPlan, signalStats, spectralPeak, visualization } from './koto-analysis.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RATE = ANALYSIS_RATE;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const FROZEN = {
  'src/coast/world/lake/kotoSampleModel.ts': '6ca104c08eff9885b1e031633f1e11904f26611a2fd15e6c591b9159592aea95',
  'src/coast/world/lake/kotoPhysicalModel.ts': '0f9fe7cd79f40e6e5f117070f59051837b9a74c2e8622d5eb7d3f8912367be2a',
  'src/coast/world/lake/kotoPerformance.ts': '9369a44f18b55e54412301a332e1446c30720bcbbab3fd767b7b73d2440e02bd',
  'public/lake-audio/samples/bank.json': '0e7d90f2665021b985809c611d94c5dd4aed1c45e4341b4263cd16f287afc686',
  'assets/lake-audio/history/koto-performance-hybrid96.wav': 'c73976efaa69ff309fdb66e765acad4e46c08770e850f0c3997ad78d909838c2',
};
const SOURCE_SHA = '133eff375b227d0d2480bec544cbaa535994adf8cbeb5708235d8c73c5c47430';
const NEW_CASES = ['low-normal', 'mid-normal', 'high-normal', 'melody', 'press-one', 'press-two', 'damped', 'score-39'];

function decodeStereo16(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Reviewed stereo WAV required');
  let format, data;
  for (let pos = 12; pos + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(pos + 4), start = pos + 8;
    if (start + size > bytes.length) throw new Error('Truncated reviewed source');
    const name = bytes.toString('ascii', pos, pos + 4);
    if (name === 'fmt ') format = { code: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), rate: bytes.readUInt32LE(start + 4), bits: bytes.readUInt16LE(start + 14) };
    if (name === 'data') data = bytes.subarray(start, start + size);
    pos = start + size + size % 2;
  }
  if (!format || !data || format.code !== 1 || format.channels !== 2 || format.rate !== RATE || format.bits !== 16 || data.length % 4) throw new Error('Reviewed stereo PCM16 layout differs');
  return Float32Array.from({ length: data.length / 4 }, (_, i) => data.readInt16LE(i * 4) / 32768);
}

export function prepareRecordingCandidate(channel, commonBankGain) {
  const startFrame = Math.round(38.769 * RATE), endFrame = Math.round(39.580 * RATE);
  if (!(channel instanceof Float32Array) || channel.length < endFrame || channel.some(value => !Number.isFinite(value))
    || !Number.isFinite(commonBankGain) || commonBankGain <= 0) throw new RangeError('Invalid source channel or common bank gain');
  const samples = channel.slice(startFrame, endFrame);
  const removedDc = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  for (let i = 0; i < samples.length; i += 1) samples[i] -= removedDc;
  const first = Math.round(0.073 * RATE), last = Math.round(0.253 * RATE);
  const spectrum = fftMagnitudes(samples.subarray(first, last), 131072);
  const root = spectralPeak(spectrum, RATE, 240.23, 131072, 0.02);
  const half = spectralPeak(spectrum, RATE, 120.115, 131072, 0.02);
  const second = spectralPeak(spectrum, RATE, root.hz * 2, 131072, 0.02);
  const third = spectralPeak(spectrum, RATE, root.hz * 3, 131072, 0.02);
  const fadeIn = Math.round(0.0005 * RATE), fadeOut = Math.round(0.055 * RATE);
  for (let i = 0; i < fadeIn; i += 1) samples[i] *= Math.sin(i / (fadeIn - 1) * Math.PI / 2) ** 2;
  for (let i = 0; i < fadeOut; i += 1) samples[samples.length - fadeOut + i] *= Math.cos(i / (fadeOut - 1) * Math.PI / 2) ** 2;
  for (let i = 0; i < samples.length; i += 1) samples[i] *= commonBankGain;
  return { samples, metadata: {
    id: 'low-240-candidate', path: 'low-240-candidate.wav', sourceId: '365242', sourceCreator: 'RutgerMuller',
    sourceUrl: 'https://freesound.org/people/RutgerMuller/sounds/365242/', license: 'CC0-1.0',
    sourceSha256: SOURCE_SHA, sourceStartFrame: startFrame, sourceEndFrameExclusive: endFrame,
    sourceStartSeconds: startFrame / RATE, sourceEndSeconds: endFrame / RATE, channel: 0,
    sampleRate: RATE, rootFrequency: root.hz, frames: samples.length, durationSeconds: samples.length / RATE,
    removedDc, fadeInSeconds: 0.0005, fadeOutSeconds: 0.055, commonBankGain,
    filter: 'none', resampling: 'none during preparation',
    processing: 'Exact channel-0 cut; DC removal; 0.5 ms sine-squared in and55 ms cosine-squared out; same common gain as old five roots; PCM16 quantization.',
    recordingSession: 'Same already-reviewed source365242; recording date, relation to365215 session, instrument identity and mic distance not independently established.',
    rootEvidence: { fundamentalHz: root.hz, secondHz: second.hz, thirdHz: third.hz,
      fundamentalVsSecondDb: db(root.magnitude / second.magnitude), thirdVsSecondDb: db(third.magnitude / second.magnitude),
      half120HzPeakDbfs: db(half.magnitude), half120VsFundamentalDb: db(half.magnitude / root.magnitude),
      autocorrelationFromIndependentSourceScreen: { lag200: 0.99671765889529, lag100: 0.8571764182649084,
        method: 'Normalized direct correlation on source38.84–39.48s, channel0; period240 supported over481,120 has no corresponding strong fundamental/odd series.' },
      outsideHarmonicEnergyPercentObserved: [0.46, 0.24, 0.17], foreignPeakRelativeDbObserved: [-38.1, -39.3, -38.4],
      sourceScreen: '/private/tmp/koto-local-rescreen-20261127T1337/summary.json' },
    limitations: ['Research candidate, not published adoption or human quality approval.',
      'The next202Hz event forces a cut before the complete natural decay ends; fade is disclosed.',
      'Strong second partial; human octave/instrument/third-party contamination listening remains unperformed.',
      'Same CC0 creator/source evidence, not fresh rights inferred from acoustic metrics.'],
  } };
}

export function noteRecordingCoverage(note, bank, samples) {
  const result = renderSampleKotoNote({ ...note, duration: Math.min(note.duration ?? 6, 6) }, bank, RATE);
  const voice = samples ?? result.samples;
  const block = 48, active = [];
  for (let i = 0; i < voice.length; i += block) {
    let energy = 0;
    for (let j = i; j < Math.min(voice.length, i + block); j += 1) energy += voice[j] ** 2;
    if (Math.sqrt(energy / block) > 1e-5) active.push(i / RATE);
  }
  const pressVoiced = note.pressSemitones ? active.filter(t => t >= 0.1 && t < 0.36).length * 0.001 : null;
  const settledVoiced = note.pressSemitones ? active.filter(t => t >= 0.48 && t < 0.651).length * 0.001 : null;
  return { frequency: note.frequency, velocity: note.velocity, pressSemitones: note.pressSemitones ?? 0,
    supported: kotoSampleSupports(note, bank, RATE), ...result.diagnostics,
    firstNonSilentSeconds: active[0] ?? null, lastNonSilentSeconds: active.at(-1) ?? null,
    nonSilentPressTransitionSeconds: pressVoiced, nonSilentPressPlateauWindowSeconds: settledVoiced,
    pressPlateauEvidence: note.pressSemitones ? measurePressPlateau(voice, note) : null,
    interpretation: 'Signal above-100dBFS RMS, not proof of perceptual audibility. Fixed single recorded velocity layer; pitch-rate press changes body spectrum and duration.' };
}

function measurePressPlateau(samples, note) {
  const first = Math.round(0.48 * RATE), last = first + 8192;
  let energy = 0, nonFiniteCount = 0;
  for (let i = first; i < Math.min(last, samples.length); i += 1) {
    if (!Number.isFinite(samples[i])) nonFiniteCount += 1;
    else energy += samples[i] ** 2;
  }
  const rms = Math.sqrt(energy / 8192);
  const pitch = analyzeNote(samples, RATE, { expectedHz: note.frequency, pressSemitones: note.pressSemitones }).pitch;
  return { windowSeconds: [first / RATE, last / RATE], windowComplete: samples.length >= last,
    rms, rmsDbfs: db(rms), nonFiniteCount, pitch };
}

export function evaluatePerformancePress(eventCoverage) {
  const required = LAKE_KOTO_EVENTS.map((event, eventIndex) => ({ event, eventIndex })).filter(({ event }) => event.pressSemitones);
  const events = required.map(({ event, eventIndex }) => {
    const observed = eventCoverage.find(item => item.eventIndex === eventIndex);
    const evidence = observed?.pressPlateauEvidence;
    const expectedHz = LAKE_KOTO_TUNING[event.string - 1].frequency * 2 ** (event.pressSemitones / 12);
    const measuredHz = evidence?.pitch?.measuredHz;
    const errorCents = typeof measuredHz === 'number' && Number.isFinite(measuredHz) && measuredHz > 0
      ? 1200 * Math.log2(measuredHz / expectedHz) : null;
    const signalPresent = !!evidence && evidence.windowComplete === true && evidence.nonFiniteCount === 0
      && Number.isFinite(evidence.rms) && evidence.rms > 1e-5;
    const passed = signalPresent && errorCents !== null && Math.abs(errorCents) <= CRITERIA.pressedPitchErrorCents;
    return { eventIndex, string: event.string, seconds: event.seconds, expectedHz, measuredHz: measuredHz ?? null,
      errorCents, windowSeconds: evidence?.windowSeconds ?? [0.48, 0.48 + 8192 / RATE],
      rmsDbfs: evidence?.rmsDbfs ?? null, signalPresent, passed,
      status: !evidence ? 'not-measured' : !signalPresent ? 'no-finite-non-silent-plateau' : errorCents === null ? 'no-measurable-pitch' : passed ? 'passed' : 'pitch-outside-tolerance' };
  });
  return { requiredCount: required.length, passCount: events.filter(event => event.passed).length,
    allPass: required.length > 0 && events.every(event => event.passed), events,
    interpretation: 'Every authored score press must have a complete, finite, non-silent arrival window and pitch within the existing15cent criterion. Coverage alone is insufficient.' };
}

function attachPerformancePress(manifest) {
  const evidence = evaluatePerformancePress(manifest.eventCoverage);
  const score = manifest.clips.find(clip => clip.method === 'recording-six' && clip.case === 'score-39');
  if (!score) throw new Error('Recorded score is required for press acceptance.');
  score.measurements.gates.performancePress = evidence.allPass;
  score.measurements.performancePress = evidence;
  const method = manifest.methods.find(item => item.id === 'recording-six');
  const failure = '曲内4押し手は到達窓で録音が尽き、全曲の奏法要件は未達。比較用で本番未採用';
  const generic = '曲内の押し手到達を全件確認できず、全曲の奏法要件は未達。比較用で本番未採用';
  method.limitations = method.limitations.filter(item => item !== failure && item !== generic);
  if (!evidence.allPass) method.limitations.push(evidence.requiredCount === 4 && evidence.events.every(event => !event.signalPresent) ? failure : generic);
  return evidence;
}

export async function runRecordingPerformanceStudy(output = resolve(ROOT, 'artifacts/koto-recording-performance-trial'),
  evaluation = resolve(ROOT, 'artifacts/koto-study'), sourcePath) {
  if (!sourcePath) throw new Error('Supply the already-reviewed source365242 decoded WAV as the third argument');
  const started = performance.now();
  await mkdir(resolve(output, 'samples'), { recursive: true });
  const inputHashes = { ...FROZEN };
  for (const [path, expected] of Object.entries(FROZEN)) if (hash(await readFile(resolve(ROOT, path))) !== expected) throw new Error('Frozen study input changed');
  for (const path of ['scripts/koto-recording-performance-study.mjs', 'scripts/koto-analysis.mjs']) inputHashes[path] = hash(await readFile(resolve(ROOT, path)));
  const sourceBytes = await readFile(sourcePath);
  if (hash(sourceBytes) !== SOURCE_SHA) throw new Error('Reviewed source decode hash differs');
  const oldBank = JSON.parse(await readFile(resolve(ROOT, 'public/lake-audio/samples/bank.json')));
  const bank = [], bankMetadata = [];
  for (const item of oldBank.samples) {
    const path = `public/lake-audio/samples/${item.path}`, bytes = await readFile(resolve(ROOT, path));
    if (hash(bytes) !== item.sha256) throw new Error('Original sample hash differs');
    inputHashes[path] = item.sha256;
    await writeFile(resolve(output, 'samples', item.path), bytes);
    bank.push({ ...item, ...decodeMonoWav(bytes) }); bankMetadata.push({ ...item });
  }
  const prepared = prepareRecordingCandidate(decodeStereo16(sourceBytes), oldBank.samples[0].commonBankGain);
  const candidateBytes = encodeWav(prepared.samples, RATE);
  const candidate = { ...prepared.metadata, sha256: hash(candidateBytes), bytes: candidateBytes.length };
  await writeFile(resolve(output, 'samples', candidate.path), candidateBytes);
  bank.push({ ...candidate, ...decodeMonoWav(candidateBytes) }); bankMetadata.push(candidate);
  const bankJson = { schemaVersion: 1, status: 'private-recording-comparison-not-published-adoption', sampleRate: RATE,
    maxTransposeSemitones: 5, velocityLayers: 1, samples: bankMetadata,
    limitation: 'Actual recorded decay only, with disclosed end fades; no periodic loop, modal extension or physical fallback.' };
  await writeFile(resolve(output, 'samples/bank.json'), JSON.stringify(bankJson, null, 2));
  const stringCoverage = LAKE_KOTO_TUNING.map(string => ({ ...string,
    ...noteRecordingCoverage({ frequency: string.frequency, velocity: 0.6, duration: 6 }, bank) }));
  const referenceBytes = await readFile(resolve(evaluation, 'manifest.json')), reference = JSON.parse(referenceBytes);
  if (reference.sourceDrift?.length) throw new Error('Reference study has source drift');
  const cases = CASES.filter(item => NEW_CASES.includes(item.id)), clips = [];
  const unavailableClips = reference.unavailableClips.filter(item => item.method === 'sample' && NEW_CASES.includes(item.case));
  let eventCoverage = [];
  for (const item of cases) {
    const diagnostics = [], t = performance.now();
    const samples = renderKotoStudyCase(item.id, (note, rate) => {
      const rendered = renderSampleKotoNote(note, bank, rate);
      // The independent coverage pass is bounded to existing recorded support;
      // it does not generate physical notes or extend the exhausted wave.
      diagnostics.push(noteRecordingCoverage(note, bank, rendered.samples));
      return rendered.samples;
    }, RATE);
    if (item.id === 'score-39') eventCoverage = diagnostics.map((diag, index) => ({ eventIndex: index,
      seconds: LAKE_KOTO_EVENTS[index].seconds, string: LAKE_KOTO_EVENTS[index].string,
      requestedDampAt: LAKE_KOTO_EVENTS[index].dampAt, ...diag }));
    clips.push({ id: `recording-six-${item.id}`, method: 'recording-six', case: item.id, samples, rendererDiagnostics: diagnostics, renderMs: performance.now() - t });
  }
  const reused = reference.clips.filter(clip => (clip.method === 'sample' && NEW_CASES.includes(clip.case))
    || (['physical', 'production96'].includes(clip.method) && clip.case === 'score-39'));
  for (const item of reused) {
    const bytes = await readFile(resolve(evaluation, item.rawWav));
    if (hash(bytes) !== item.sha256.rawWav) throw new Error('Reference audio hash mismatch');
    clips.push({ id: item.id, method: item.method, case: item.case, ...decodeMonoWav(bytes),
      reusedFrom: { manifestSha256: hash(referenceBytes), rawWav: item.rawWav, rawSha256: hash(bytes) } });
  }
  const normalization = normalizationPlan(clips);
  for (const clip of clips) {
    const item = cases.find(value => value.id === clip.case), stats = signalStats(clip.samples, RATE);
    const note = item.kind === 'note' ? analyzeNote(clip.samples, RATE, item) : null;
    const gates = { finite: stats.nonFiniteCount === 0, dc: stats.absoluteDcDbfs <= CRITERIA.absoluteDcDbfs,
      duration: Math.abs(stats.durationSeconds - item.durationSeconds) < 1 / RATE,
      pitch: note ? note.pitch.status === 'measured' && Math.abs(note.pitch.errorCents) <= (item.pressSemitones ? CRITERIA.pressedPitchErrorCents : CRITERIA.normalPitchErrorCents) : null,
      damping: note?.damping ? note.damping.status === 'measured' && note.damping.reductionDb >= CRITERIA.dampedReductionDb : null,
      loopSeam: item.kind === 'score' ? stats.loopSeamDbfs <= CRITERIA.loopSeamDbfs : null,
      final50ms: stats.final50msRmsDbfs <= CRITERIA.final50msRmsDbfs };
    clip.sampleRate = RATE; clip.frames = clip.samples.length; clip.durationSeconds = clip.samples.length / RATE;
    clip.matchGainDb = normalization.anchors[`${clip.method}:${clip.case === 'score-39' ? 'score' : 'notes'}`].gainDb;
    clip.commonSafetyGainDb = normalization.commonSafetyGainDb;
    const appliedGainDb = clip.matchGainDb + clip.commonSafetyGainDb;
    const matched = Float32Array.from(clip.samples, value => value * 10 ** (appliedGainDb / 20));
    clip.measurements = { ...stats, note, gates, rendererDiagnostics: clip.rendererDiagnostics,
      matched: { ...signalStats(matched, RATE), appliedGainDb } };
    gates.comparisonPeak = clip.measurements.matched.samplePeakDbfs <= CRITERIA.comparisonSamplePeakDbfs + 1e-6;
    clip.rawWav = `${clip.id}.raw.f32.wav`; clip.matchedWav = `${clip.id}.matched.wav`;
    clip.visualization = `${clip.id}.visualization.json`; clip.measurementsFile = `${clip.id}.measurements.json`;
    await writeFile(resolve(output, clip.rawWav), encodeWav(clip.samples, RATE, true));
    await writeFile(resolve(output, clip.matchedWav), encodeWav(matched, RATE));
    await writeFile(resolve(output, clip.visualization), JSON.stringify(visualization(clip.samples, RATE, item.onsetSeconds)));
    await writeFile(resolve(output, clip.measurementsFile), JSON.stringify(clip.measurements, null, 2));
    clip.sha256 = { rawWav: hash(await readFile(resolve(output, clip.rawWav))), matchedWav: hash(await readFile(resolve(output, clip.matchedWav))) };
    if (clip.reusedFrom && clip.sha256.rawWav !== clip.reusedFrom.rawSha256) throw new Error('Reused raw audio changed on serialization');
    delete clip.samples;
  }
  const sourceDrift = [];
  for (const [path, expected] of Object.entries(inputHashes)) if (hash(await readFile(resolve(ROOT, path))) !== expected) sourceDrift.push(path);
  if (hash(await readFile(sourcePath)) !== SOURCE_SHA) sourceDrift.push('reviewed-source365242-decode');
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'research-full-recording-performance-not-production-or-human-approved',
    baseRevision: 'dffe81e', baseline: reference.baseline, sampleRate: RATE, channels: 1,
    environment: { node: process.version, platform: process.platform, architecture: process.arch },
    inputHashes, sourceDrift, sourceDecode: { path: resolve(sourcePath), sha256: SOURCE_SHA, bytes: sourceBytes.length },
    bank: { path: 'samples/bank.json', sha256: hash(await readFile(resolve(output, 'samples/bank.json'))) }, candidate,
    criteria: CRITERIA, cases, normalization, clips, unavailableClips, stringCoverage, eventCoverage,
    coverage: { strings: stringCoverage.filter(item => item.supported).length, totalStrings: 13,
      events: eventCoverage.filter(item => item.supported).length, totalEvents: 48,
      maximumTransposeSemitones: Math.max(...eventCoverage.map(item => item.maximumTransposeSemitones)),
      pressedEvents: eventCoverage.filter(item => item.pressSemitones > 0),
      interpretation: 'Pitch coverage is not a successful sustain/press/instrument-identity acceptance.' },
    methods: [{ id: 'recording-six', label: '研究比較・全帯域実録6根', status: 'rendered', nativeSampleRate: RATE,
      sourceHashes: inputHashes, limitations: ['Only recorded single notes; exhausted cuts become silence, no loop/modal/physical fallback.',
        'Candidate240Hz is from the already-reviewed CC0 source365242, private comparison only; human mixture/instrument identity unresolved.',
        'Short cutoff fades remain; velocity is one amplitude-scaled layer, press changes playback rate/body frequencies/duration.',
        'The six roots are not matched recordings of one calibrated session/instrument/position.'] },
    ...reference.methods.filter(method => ['sample', 'physical', 'production96'].includes(method.id))],
    reproduction: 'node --experimental-transform-types scripts/koto-recording-performance-study.mjs OUTPUT EVALUATION REVIEWED_SOURCE365242_DECODE.wav',
    wallMs: performance.now() - started,
    unperformed: ['human-instrument-identity-and-timbre-consistency', 'human-third-party-audio-contamination-listening',
      'calibrated-velocity-and-positions', 'general-koto-acoustic-calibration', 'browser-and-final-spatial-listening'],
  };
  attachPerformancePress(manifest);
  const score = manifest.clips.find(clip => clip.method === 'recording-six' && clip.case === 'score-39');
  await writeFile(resolve(output, score.measurementsFile), JSON.stringify(score.measurements, null, 2));
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

/** Re-measure only the four press voices in RAM; never open an output WAV for writing. */
export async function refreshRecordingPerformanceMetadata(output) {
  const manifestPath = resolve(output, 'manifest.json'), oldBytes = await readFile(manifestPath);
  const manifest = JSON.parse(oldBytes);
  for (const [path, expected] of Object.entries(FROZEN)) if (hash(await readFile(resolve(ROOT, path))) !== expected) throw new Error('Frozen source changed during metadata refresh');
  const bankBytes = await readFile(resolve(output, manifest.bank.path));
  if (hash(bankBytes) !== manifest.bank.sha256) throw new Error('Private bank metadata changed');
  const metadata = JSON.parse(bankBytes), bank = [], audioBefore = {};
  for (const item of metadata.samples) {
    if (item.path !== item.path.split(/[\\/]/).at(-1)) throw new Error('Invalid private bank path');
    const path = `samples/${item.path}`, bytes = await readFile(resolve(output, path));
    if (hash(bytes) !== item.sha256) throw new Error('Private sample changed');
    audioBefore[path] = hash(bytes); bank.push({ ...item, ...decodeMonoWav(bytes) });
  }
  for (const clip of manifest.clips) for (const path of [clip.rawWav, clip.matchedWav]) audioBefore[path] = hash(await readFile(resolve(output, path)));
  const score = manifest.clips.find(clip => clip.method === 'recording-six' && clip.case === 'score-39');
  try { await writeFile(resolve(output, 'manifest-before-performance-press.json'), oldBytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  try { await writeFile(resolve(output, 'score-measurements-before-performance-press.json'), await readFile(resolve(output, score.measurementsFile)), { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  for (const observed of manifest.eventCoverage.filter(event => event.pressSemitones)) {
    const event = LAKE_KOTO_EVENTS[observed.eventIndex];
    const note = { frequency: LAKE_KOTO_TUNING[event.string - 1].frequency, velocity: event.force,
      pressSemitones: event.pressSemitones, pluckPosition: event.pluckPosition, dampAt: event.dampAt,
      duration: Math.min(8, 39 - event.seconds), seed: 197 + observed.eventIndex * 3923 };
    const voice = renderSampleKotoNote(note, bank, RATE).samples;
    observed.pressPlateauEvidence = measurePressPlateau(voice, note);
    if (score.rendererDiagnostics?.[observed.eventIndex]) score.rendererDiagnostics[observed.eventIndex].pressPlateauEvidence = observed.pressPlateauEvidence;
  }
  score.measurements.rendererDiagnostics = score.rendererDiagnostics;
  manifest.coverage.pressedEvents = manifest.eventCoverage.filter(event => event.pressSemitones);
  const evidence = attachPerformancePress(manifest);
  manifest.inputHashes['scripts/koto-recording-performance-study.mjs'] = hash(await readFile(resolve(ROOT, 'scripts/koto-recording-performance-study.mjs')));
  const audioChanged = [];
  for (const [path, expected] of Object.entries(audioBefore)) if (hash(await readFile(resolve(output, path))) !== expected) audioChanged.push(path);
  if (audioChanged.length) throw new Error('Output audio changed during metadata-only refresh');
  manifest.metadataRefresh = { generatedAt: new Date().toISOString(), previousManifestSha256: hash(oldBytes),
    preservedManifest: 'manifest-before-performance-press.json', kind: 'four-press-acceptance-measurement-only', audioFilesChecked: Object.keys(audioBefore).length, audioChanged };
  await writeFile(resolve(output, score.measurementsFile), JSON.stringify(score.measurements, null, 2));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(resolve(output, 'performance-press-refresh.json'), JSON.stringify({ ...manifest.metadataRefresh, evidence, audioHashes: audioBefore }, null, 2));
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const metadataOnly = process.argv[2] === '--refresh-metadata';
    const output = metadataOnly ? process.argv[3] : process.argv[2];
    const result = metadataOnly ? await refreshRecordingPerformanceMetadata(output)
      : await runRecordingPerformanceStudy(output, process.argv[3], process.argv[4]);
    console.log(JSON.stringify({ clips: result.clips.length, coverage: result.coverage, sourceDrift: result.sourceDrift,
      wallMs: result.wallMs, manifest: resolve(output ?? resolve(ROOT, 'artifacts/koto-recording-performance-trial'), 'manifest.json') }));
    if (result.sourceDrift.length) process.exitCode = 2;
  } catch {
    console.error('Recording performance study failed; verify the frozen inputs and explicit reviewed source decode.');
    process.exitCode = 1;
  }
}
