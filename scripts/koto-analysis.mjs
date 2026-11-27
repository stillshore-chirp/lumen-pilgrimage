import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import { KOTO_STUDY_CASES, LAKE_KOTO_TUNING, renderKotoStudyCase } from '../src/coast/world/lake/kotoPerformance.ts';

// Offline diagnostics only. This module is never imported by the production app.
export const ANALYSIS_RATE = 48_000;
export const BASELINE_REVISION = '375c3b7a2d77f3cae2420e5b3ca7c2f4e8bba597';
const sourcePath = 'src/coast/world/lake/lakeKotoScore.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
export const db = value => value > 0 ? 20 * Math.log10(value) : -180;
const gain = value => 10 ** (value / 20);

export const CRITERIA = Object.freeze({
  nonFiniteCount: 0, absoluteDcDbfs: -60, normalPitchErrorCents: 10,
  pressedPitchErrorCents: 15, loopSeamDbfs: -80, final50msRmsDbfs: -70,
  comparisonSamplePeakDbfs: -3, comparisonRmsAnchorDbfs: -24,
  dampedReductionDb: 24, rateConvergencePitchCents: 2,
});

export const CASES = KOTO_STUDY_CASES;

export function signalStats(samples, sampleRate = ANALYSIS_RATE) {
  let peak = 0;
  let sum = 0;
  let square = 0;
  let nonFiniteCount = 0;
  let maxAdjacentDelta = 0;
  let maxDeltaIndex = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i];
    if (!Number.isFinite(value)) { nonFiniteCount += 1; continue; }
    peak = Math.max(peak, Math.abs(value));
    sum += value;
    square += value * value;
    const delta = i ? Math.abs(value - samples[i - 1]) : Math.abs(value);
    if (delta > maxAdjacentDelta) { maxAdjacentDelta = delta; maxDeltaIndex = i; }
  }
  const rms = Math.sqrt(square / Math.max(1, samples.length));
  return { frames: samples.length, durationSeconds: samples.length / sampleRate, nonFiniteCount,
    samplePeak: peak, samplePeakDbfs: db(peak), rms, rmsDbfs: db(rms),
    mean: sum / Math.max(1, samples.length), absoluteDcDbfs: db(Math.abs(sum / Math.max(1, samples.length))),
    crestDb: db(peak / Math.max(rms, 1e-30)), maxAdjacentDelta, maxDeltaAtSeconds: maxDeltaIndex / sampleRate,
    loopSeamDelta: Math.abs((samples.at(-1) ?? 0) - (samples[0] ?? 0)),
    loopSeamDbfs: db(Math.abs((samples.at(-1) ?? 0) - (samples[0] ?? 0))),
    final50msRmsDbfs: db(rmsOf(samples.subarray(Math.max(0, samples.length - Math.round(sampleRate * 0.05))))),
  };
}

export function rmsOf(samples) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.sqrt(energy / Math.max(1, samples.length));
}

// Blackman-windowed sinc; 32 taps on either side. No high-frequency content is recovered.
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples.slice();
  const output = new Float32Array(Math.round(samples.length * toRate / fromRate));
  const radius = 32;
  const cutoff = 0.94 * Math.min(1, toRate / fromRate);
  for (let i = 0; i < output.length; i += 1) {
    const position = i * fromRate / toRate;
    const center = Math.floor(position);
    let total = 0;
    let weights = 0;
    for (let k = center - radius + 1; k <= center + radius; k += 1) {
      const offset = position - k;
      if (Math.abs(offset) >= radius) continue;
      const phase = Math.PI * offset * cutoff;
      const window = 0.42 + 0.5 * Math.cos(Math.PI * offset / radius)
        + 0.08 * Math.cos(2 * Math.PI * offset / radius);
      const weight = (Math.abs(phase) < 1e-12 ? 1 : Math.sin(phase) / phase) * cutoff * window;
      if (k >= 0 && k < samples.length) total += samples[k] * weight;
      weights += weight;
    }
    output[i] = weights ? total / weights : 0;
  }
  return output;
}

export function fftMagnitudes(samples, size = 8192) {
  if (size < 2 || (size & (size - 1))) throw new Error('FFT size must be a power of two');
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  const count = Math.min(size, samples.length);
  let windowSum = 0;
  for (let i = 0; i < count; i += 1) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / Math.max(1, count - 1));
    real[i] = samples[i] * window;
    windowSum += window;
  }
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = -2 * Math.PI / length;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < length / 2; j += 1) {
        const first = start + j;
        const second = first + length / 2;
        const tr = wr * real[second] - wi * imaginary[second];
        const ti = wr * imaginary[second] + wi * real[second];
        real[second] = real[first] - tr;
        imaginary[second] = imaginary[first] - ti;
        real[first] += tr;
        imaginary[first] += ti;
        const next = wr * cosine - wi * sine;
        wi = wr * sine + wi * cosine;
        wr = next;
      }
    }
  }
  return Float64Array.from({ length: size / 2 + 1 }, (_, i) =>
    Math.hypot(real[i], imaginary[i]) * (i === 0 || i === size / 2 ? 1 : 2) / Math.max(1, windowSum));
}

function spectrumAt(samples, rate, start, duration = 8192 / ANALYSIS_RATE) {
  const first = Math.round(start * rate);
  return fftMagnitudes(samples.subarray(first, first + Math.round(duration * rate)));
}

export function spectralPeak(magnitudes, rate, expected, size = 8192, fraction = 0.045) {
  const lo = Math.max(2, Math.floor(expected * (1 - fraction) * size / rate));
  const hi = Math.min(magnitudes.length - 2, Math.ceil(expected * (1 + fraction) * size / rate));
  let bin = lo;
  for (let i = lo + 1; i <= hi; i += 1) if (magnitudes[i] > magnitudes[bin]) bin = i;
  const left = Math.log(Math.max(1e-20, magnitudes[bin - 1]));
  const center = Math.log(Math.max(1e-20, magnitudes[bin]));
  const right = Math.log(Math.max(1e-20, magnitudes[bin + 1]));
  const offset = Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / (left - 2 * center + right || 1)));
  return { hz: (bin + offset) * rate / size, magnitude: magnitudes[bin] };
}

function spectrumSummary(magnitudes, rate) {
  let power = 0;
  let centroid = 0;
  let nearNyquist = 0;
  for (let i = 1; i < magnitudes.length; i += 1) {
    const value = magnitudes[i] ** 2;
    const hz = i * rate / ((magnitudes.length - 1) * 2);
    power += value;
    centroid += value * hz;
    if (hz > rate * 0.45) nearNyquist += value;
  }
  return { powerCentroidHz: power ? centroid / power : 0,
    above90PercentNyquistPowerDb: power ? 10 * Math.log10(Math.max(nearNyquist / power, 1e-18)) : -180 };
}

export function analyzeNote(samples, sampleRate, note) {
  const early = spectrumAt(samples, sampleRate, 0.12);
  const late = spectrumAt(samples, sampleRate, 0.48);
  const expectedLate = note.expectedHz * 2 ** ((note.pressSemitones ?? 0) / 12);
  const fundamental = spectralPeak(note.pressSemitones ? late : early, sampleRate,
    note.pressSemitones ? expectedLate : note.expectedHz);
  const measurablePitch = fundamental.magnitude > 1e-5;
  const pitchExpected = note.pressSemitones ? expectedLate : note.expectedHz;
  const partialSpectrum = note.pressSemitones ? late : early;
  const partials = Array.from({ length: measurablePitch ? 12 : 0 }, (_, index) => {
    const order = index + 1;
    const peak = spectralPeak(partialSpectrum, sampleRate, pitchExpected * order, 8192, 0.025);
    return { order, earlyHz: peak.hz, earlyAmplitudeDbfs: db(peak.magnitude),
      deviationFromHarmonicCents: 1200 * Math.log2(peak.hz / (fundamental.hz * order)) };
  }).filter(partial => partial.earlyHz < sampleRate * 0.45);
  const frameSeconds = 0.032;
  const decay = [];
  for (let start = 0.03; start + frameSeconds <= Math.min(5, samples.length / sampleRate); start += 0.032) {
    const spectrum = spectrumAt(samples, sampleRate, start, frameSeconds);
    const bands = [[80, 500], [500, 2000], [2000, 8000]].map(([low, high]) => {
      let energy = 0;
      for (let i = Math.ceil(low * 8192 / sampleRate); i <= Math.floor(high * 8192 / sampleRate); i += 1) {
        energy += spectrum[i] ** 2;
      }
      return db(Math.sqrt(energy));
    });
    decay.push({ seconds: start + frameSeconds / 2, bandsDb: bands });
  }
  const decayFits = [0, 1, 2].map(band => {
    const origin = decay[0]?.bandsDb[band] ?? -180;
    const points = decay.filter(frame => frame.seconds > 0.08 && frame.bandsDb[band] <= origin - 5
      && frame.bandsDb[band] >= origin - 25 && frame.bandsDb[band] > -100);
    const xMean = points.reduce((sum, point) => sum + point.seconds, 0) / Math.max(1, points.length);
    const yMean = points.reduce((sum, point) => sum + point.bandsDb[band], 0) / Math.max(1, points.length);
    const numerator = points.reduce((sum, point) => sum + (point.seconds - xMean) * (point.bandsDb[band] - yMean), 0);
    const denominator = points.reduce((sum, point) => sum + (point.seconds - xMean) ** 2, 0);
    const slope = denominator ? numerator / denominator : 0;
    const range = points.length ? Math.max(...points.map(point => point.bandsDb[band]))
      - Math.min(...points.map(point => point.bandsDb[band])) : 0;
    return { bandHz: [[80, 500], [500, 2000], [2000, 8000]][band], fittedDbPerSecond: slope,
      observedRangeDb: range, pointCount: points.length,
      extrapolatedT60Seconds: slope < 0 && range >= 15 ? -60 / slope : null,
      interpretation: 'STFT-band decay fit; T60 is extrapolated, not a measured reverberation time' };
  });
  const block = Math.max(1, Math.round(sampleRate / 1000));
  const envelope = [];
  for (let i = 0; i < sampleRate * 0.1; i += block) envelope.push(rmsOf(samples.subarray(i, i + block)));
  const envelopePeak = Math.max(...envelope);
  const crossing = fraction => envelope.findIndex(value => value >= envelopePeak * fraction);
  let damping = null;
  if (note.dampAt !== undefined) {
    const before = rmsOf(samples.subarray(Math.round((note.dampAt - 0.1) * sampleRate), Math.round(note.dampAt * sampleRate)));
    const after = rmsOf(samples.subarray(Math.round((note.dampAt + 0.2) * sampleRate), Math.round((note.dampAt + 0.3) * sampleRate)));
    damping = { beforeWindowSeconds: [note.dampAt - 0.1, note.dampAt],
      afterWindowSeconds: [note.dampAt + 0.2, note.dampAt + 0.3],
      status: before > 1e-5 ? 'measured' : 'no-pre-damping-signal',
      reductionDb: before > 1e-5 ? db(before) - db(after) : null };
  }
  return { pitch: { expectedHz: pitchExpected, measuredHz: measurablePitch ? fundamental.hz : null,
    status: measurablePitch ? 'measured' : 'no-measurable-fundamental-in-window',
    fundamentalPeakAmplitudeDbfs: db(fundamental.magnitude),
    errorCents: measurablePitch ? 1200 * Math.log2(fundamental.hz / pitchExpected) : null,
    windowSeconds: note.pressSemitones ? [0.48, 0.48 + 8192 / sampleRate] : [0.12, 0.12 + 8192 / sampleRate],
    method: '8192-point Hann FFT, log-parabolic local peak around expected fundamental' },
    attack: { rmsBlockMs: 1, rise10To90Ms: crossing(0.9) - crossing(0.1), peakEnvelopeMs: envelope.indexOf(envelopePeak) },
    damping, earlySpectrum: spectrumSummary(spectrumAt(samples, sampleRate, 0.02), sampleRate),
    tailSpectrum: spectrumSummary(late, sampleRate), partials, decayFits, decay,
    alias: { status: 'not-disambiguated', reason: 'Near-Nyquist energy is not evidence of aliasing; use modal cutoff and a rate-convergence experiment separately.' },
  };
}

export function encodeWav(samples, sampleRate = ANALYSIS_RATE, float = false) {
  const bytes = float ? 4 : 2;
  const output = Buffer.alloc(44 + samples.length * bytes);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(float ? 3 : 1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * bytes, 28);
  output.writeUInt16LE(bytes, 32); output.writeUInt16LE(bytes * 8, 34); output.write('data', 36);
  output.writeUInt32LE(samples.length * bytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    if (!Number.isFinite(samples[i])) throw new Error('Non-finite audio cannot be written');
    if (float) output.writeFloatLE(samples[i], 44 + i * 4);
    else {
      if (Math.abs(samples[i]) > 1) throw new Error('PCM audio would clip');
      output.writeInt16LE(Math.round(samples[i] * (samples[i] < 0 ? 32768 : 32767)), 44 + i * 2);
    }
  }
  return output;
}

export function decodeMonoWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid WAV container');
  let format;
  let data;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32LE(offset + 4);
    const first = offset + 8;
    if (first + length > buffer.length) throw new Error('Truncated WAV chunk');
    const name = buffer.toString('ascii', offset, offset + 4);
    if (name === 'fmt ') {
      if (length < 16) throw new Error('Truncated WAV format');
      format = { code: buffer.readUInt16LE(first), channels: buffer.readUInt16LE(first + 2),
        sampleRate: buffer.readUInt32LE(first + 4), bits: buffer.readUInt16LE(first + 14) };
    }
    if (name === 'data') data = buffer.subarray(first, first + length);
    offset = first + length + length % 2;
  }
  if (!format || !data || format.channels !== 1 || !((format.code === 1 && [16, 24].includes(format.bits))
    || (format.code === 3 && format.bits === 32))) throw new Error('Unsupported WAV format');
  const bytes = format.bits / 8;
  if (data.length % bytes || format.sampleRate < 24000 || format.sampleRate > 192000) throw new Error('Invalid WAV frame layout');
  const samples = Float32Array.from({ length: data.length / bytes }, (_, i) => format.code === 3
    ? data.readFloatLE(i * bytes) : format.bits === 24 ? data.readIntLE(i * bytes, 3) / 8388608 : data.readInt16LE(i * bytes) / 32768);
  if (samples.some(value => !Number.isFinite(value))) throw new Error('Non-finite WAV data');
  return { sampleRate: format.sampleRate, samples };
}

export function normalizationPlan(clips) {
  const anchors = {};
  for (const clip of clips) {
    if (clip.case !== 'mid-normal' && clip.case !== 'score-39') continue;
    const key = `${clip.method}:${clip.case === 'score-39' ? 'score' : 'notes'}`;
    const rms = rmsOf(clip.samples.subarray(0, clip.case === 'score-39' ? clip.samples.length : 3 * ANALYSIS_RATE));
    anchors[key] = { case: clip.case, rmsDbfs: db(rms), gainDb: CRITERIA.comparisonRmsAnchorDbfs - db(rms) };
  }
  let largestPeak = 0;
  for (const clip of clips) {
    const key = `${clip.method}:${clip.case === 'score-39' ? 'score' : 'notes'}`;
    const anchor = anchors[key];
    if (!anchor) throw new Error('Missing normalization anchor');
    largestPeak = Math.max(largestPeak, signalStats(clip.samples).samplePeak * gain(anchor.gainDb));
  }
  return { kind: 'unweighted-rms-anchor', targetRmsDbfs: CRITERIA.comparisonRmsAnchorDbfs,
    peakLimitDbfs: CRITERIA.comparisonSamplePeakDbfs,
    commonSafetyGainDb: Math.min(0, CRITERIA.comparisonSamplePeakDbfs - db(largestPeak)), anchors,
    limitation: 'RMS is not LUFS or equal perceived loudness. Dynamics within each method are retained.' };
}

export function visualization(samples, sampleRate = ANALYSIS_RATE, onsetSeconds = 0) {
  const count = 700;
  const block = Math.max(1, Math.ceil(samples.length / count));
  const waveform = [];
  for (let start = 0; start < samples.length; start += block) {
    let low = 0;
    let high = 0;
    for (let i = start; i < Math.min(samples.length, start + block); i += 1) {
      low = Math.min(low, samples[i]); high = Math.max(high, samples[i]);
    }
    waveform.push([start / sampleRate, low, high]);
  }
  const rows = 80;
  const frequencies = Array.from({ length: 96 }, (_, i) => 60 * (18000 / 60) ** (i / 95));
  const spectrogram = Array.from({ length: rows }, (_, row) => {
    const start = Math.max(0, (samples.length - 8192) / sampleRate) * row / (rows - 1);
    const spectrum = spectrumAt(samples, sampleRate, start);
    return { seconds: start + 4096 / sampleRate, dbfs: frequencies.map(hz =>
      Math.max(-100, db(spectrum[Math.min(spectrum.length - 1, Math.round(hz * 8192 / sampleRate))]))) };
  });
  const spectrum = spectrumAt(samples, sampleRate, onsetSeconds + 0.02);
  return { schemaVersion: 1, signal: 'raw',
    waveform: { timesSeconds: waveform.map(row => row[0]), min: waveform.map(row => row[1]), max: waveform.map(row => row[2]) },
    spectrum: { frequenciesHz: frequencies, dbfs: frequencies.map(hz =>
      Math.max(-100, db(spectrum[Math.min(spectrum.length - 1, Math.round(hz * 8192 / sampleRate))]))),
      windowSeconds: [onsetSeconds + 0.02, onsetSeconds + 0.02 + 8192 / sampleRate] },
    stft: { fftSize: 8192, window: 'Hann', frequenciesHz: frequencies,
    scale: 'sinusoidal peak-amplitude dBFS, nearest FFT bin', rows: spectrogram } };
}

async function loadBaseline(output) {
  // The committed fixture is a byte copy of the baseline Git blob, not a live implementation.
  const source = await readFile(resolve(root, 'scripts/fixtures/lakeKotoLegacy.ts'), 'utf8');
  await writeFile(resolve(output, 'baseline-source.ts'), source);
  const staging = `${source}\nexport { addPluck, STRING_PITCHES, SCORE };\n`;
  const js = ts.transpileModule(staging, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  return { id: 'legacy', label: '旧加算合成', status: 'rendered', nativeSampleRate: module.LAKE_KOTO_SAMPLE_RATE,
    sourceHashes: { 'scripts/fixtures/lakeKotoLegacy.ts': hash(source) }, module,
    note: item => {
      const samples = new Float32Array(Math.round(item.durationSeconds * module.LAKE_KOTO_SAMPLE_RATE));
      module.addPluck(samples, [0, item.string, item.force, item.pressSemitones], item.index ?? 0);
      return samples;
    }, score: () => module.renderLakeKoto(),
    limitations: ['旧音源に消音のAPIはない。damped caseは無加工の旧音を保存し未対応と記録。', '単音は旧private関数をstaging export。production sourceは変更しない。'] };
}

async function loadPhysical() {
  const physicalPath = resolve(root, 'src/coast/world/lake/kotoPhysicalModel.ts');
  let source;
  try { source = await readFile(physicalPath, 'utf8'); } catch { return null; }
  const src = pathToFileURL(resolve(root, 'src') + '/').href;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(context.parentURL?.startsWith(src) && specifier.startsWith('.') && !extname(specifier)
      ? `${specifier}.ts` : specifier, context);
  } });
  try {
    const module = await import(pathToFileURL(physicalPath).href);
    if (typeof module.renderPhysicalKotoNote !== 'function') return null;
    const performanceSource = await readFile(resolve(root, 'src/coast/world/lake/kotoPerformance.ts'), 'utf8');
    return { id: 'physical', label: '改良物理モデル', status: 'rendered', nativeSampleRate: ANALYSIS_RATE,
      sourceHashes: { 'src/coast/world/lake/kotoPhysicalModel.ts': hash(source),
        'src/coast/world/lake/kotoPerformance.ts': hash(performanceSource) }, module,
      note: item => module.renderPhysicalKotoNote({ frequency: item.expectedHz, velocity: item.force,
        pressSemitones: item.pressSemitones, dampAt: item.dampAt, duration: item.durationSeconds, seed: 197 }, ANALYSIS_RATE),
      renderCase: id => renderKotoStudyCase(id, module.renderPhysicalKotoNote, ANALYSIS_RATE),
      score: true };
  } finally { hooks.deregister(); }
}

async function loadSamples(physical, bankPath) {
  if (!physical || !bankPath) return [];
  let source;
  let bankBytes;
  try {
    [source, bankBytes] = await Promise.all([readFile(resolve(root, 'src/coast/world/lake/kotoSampleModel.ts'), 'utf8'), readFile(bankPath)]);
  } catch { return []; }
  const bankMetadata = JSON.parse(bankBytes.toString('utf8'));
  if (!Array.isArray(bankMetadata.samples)) throw new Error('Invalid sample bank metadata');
  const inputArtifacts = [{ path: bankPath, sha256: hash(bankBytes), snapshot: 'sample-bank/bank.json' }];
  const bank = [];
  for (const item of bankMetadata.samples) {
    if (typeof item.path !== 'string' || item.path !== item.path.split(/[\\/]/).at(-1)) throw new Error('Sample bank path must be a filename');
    const path = resolve(dirname(bankPath), item.path);
    const bytes = await readFile(path);
    if (hash(bytes) !== item.sha256) throw new Error('Sample bank hash mismatch');
    const decoded = decodeMonoWav(bytes);
    bank.push({ ...item, ...decoded });
    inputArtifacts.push({ path, sha256: item.sha256, snapshot: `sample-bank/${item.path}` });
  }
  // The model has type-only imports and constructor parameter properties; transpile
  // in staging so the CLI does not need Node's experimental transform-types flag.
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } }).outputText;
  const module = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  return ['sample', 'hybrid'].map(id => {
    const method = { id, label: id === 'sample' ? '実録音の研究候補' : 'ハイブリッドの研究候補',
      status: 'research-candidate', nativeSampleRate: ANALYSIS_RATE,
      sourceHashes: { ...(id === 'hybrid' ? physical.sourceHashes
        : { 'src/coast/world/lake/kotoPerformance.ts': physical.sourceHashes['src/coast/world/lake/kotoPerformance.ts'] }),
      'src/coast/world/lake/kotoSampleModel.ts': hash(source) },
      inputArtifacts, bank: { sha256: hash(bankBytes), status: bankMetadata.status,
        sourceKind: bankMetadata.sourceKind, instrumentStringCount: bankMetadata.instrumentStringCount },
      limitations: bankMetadata.limitations, diagnostics: [], score: true,
    };
    method.renderCase = id => {
      method.diagnostics = [];
      return renderKotoStudyCase(id, (note, rate) => {
        const result = method.id === 'sample' ? module.renderSampleKotoNote(note, bank, rate)
          : module.renderHybridKotoNote(note, bank, physical.module.renderPhysicalKotoNote, rate);
        method.diagnostics.push({ input: note, ...result.diagnostics });
        return result.samples;
      });
    };
    return method;
  });
}

function measureRender(render) {
  const memoryBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  const samples = render();
  const wallMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage();
  return { samples, performance: { wallMs, cpuUserMs: cpu.user / 1000, cpuSystemMs: cpu.system / 1000,
    arrayBuffersDeltaBytes: memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
    heapUsedDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed, rssDeltaBytes: memoryAfter.rss - memoryBefore.rss,
    retainedPcmBytes: samples.byteLength, limitation: 'One offline render, GC/allocation noise; not browser realtime CPU or retained heap.' } };
}

export function reusableMethod(previous, current, criteria = CRITERIA, cases = CASES) {
  const old = previous?.methods?.find(method => method.id === current.id);
  if (!old || JSON.stringify(previous.criteria) !== JSON.stringify(criteria)
    || JSON.stringify(previous.cases) !== JSON.stringify(cases)) return false;
  if (current.bank?.sha256 !== old.bank?.sha256) return false;
  return Object.entries(current.sourceHashes).every(([path, digest]) => old.sourceHashes[path] === digest);
}

async function loadProduction(evidencePath, physical) {
  if (!evidencePath) return null;
  const bytes = await readFile(evidencePath);
  const evidence = JSON.parse(bytes.toString('utf8'));
  const modelPath = 'src/coast/world/lake/kotoPhysicalModel.ts';
  if (evidence.internalSampleRate !== 96000 || evidence.sampleRate !== ANALYSIS_RATE
    || evidence.durationSeconds !== 39 || evidence.inputHashes?.[modelPath] !== physical?.sourceHashes[modelPath]) {
    throw new Error('Production evidence does not match the current 96 kHz candidate');
  }
  const historical = evidence.historicalRecord;
  const expectedOutput = historical ? 'assets/lake-audio/history/koto-performance-hybrid96.wav'
    : 'public/lake-audio/koto-performance.wav';
  if (evidence.output?.path !== expectedOutput) throw new Error('Unexpected production audio path');
  const sourceHashes = {};
  for (const [path, digest] of Object.entries(evidence.inputHashes)) {
    const actualPath = historical?.inputSnapshots?.[path] ?? path;
    if (path.startsWith('/') || path.split(/[\\/]/).includes('..')
      || actualPath.startsWith('/') || actualPath.split(/[\\/]/).includes('..')
      || hash(await readFile(resolve(root, actualPath))) !== digest) throw new Error('Production input closure changed');
    sourceHashes[actualPath] = digest;
  }
  const wavPath = resolve(root, evidence.output.path);
  const wav = await readFile(wavPath);
  if (hash(wav) !== evidence.output.sha256) throw new Error('Production WAV hash mismatch');
  const decoded = decodeMonoWav(wav);
  if (decoded.sampleRate !== ANALYSIS_RATE || decoded.samples.length !== ANALYSIS_RATE * 39) {
    throw new Error('Production WAV layout does not match the study');
  }
  const method = { id: 'production96', label: historical ? '旧候補・ハイブリッド（箏の同定未達）'
    : `本番候補・${evidence.method}・96 kHz内部→48 kHz配布`,
    status: historical ? 'previous-candidate-instrument-identity-unmet' : evidence.qualityStatus,
    nativeSampleRate: ANALYSIS_RATE, internalSampleRate: 96000,
    sourceHashes, onlyCases: ['score-39'], score: true,
    productionEvidence: { path: evidencePath, sha256: hash(bytes), deliveredWavSha256: evidence.output.sha256,
      pcmBits: evidence.pcmBits, gainDb: evidence.gainDb, unperformed: evidence.unperformed },
    inputArtifacts: [{ path: evidencePath, sha256: hash(bytes), snapshot: 'production/production.json' },
      { path: wavPath, sha256: hash(wav), snapshot: 'production/koto-performance.wav' }],
    renderCase: () => decoded.samples.slice(),
    performanceEvidence: { ...evidence.performance, origin: 'offline-production-generation',
      cpuUserMs: evidence.performance.cpu.user / 1000, cpuSystemMs: evidence.performance.cpu.system / 1000 },
    limitations: historical ? ['所有者の試聴でギターとして知覚された旧候補。最終版の音質合格を示す音声ではありません。']
      : ['Delivered 24-bit PCM including its fixed gain and dither; matched playback uses the same score RMS/peak rules. Human listening remains pending.'],
  };
  return method;
}

async function rateConvergence(physical, output) {
  if (!physical) return { status: 'not-performed' };
  const cases = [];
  for (const frequency of [196, 392, 880]) {
    const note = { frequency, velocity: 0.6, duration: 1.2, seed: 197 };
    const native = physical.module.renderPhysicalKotoNote(note, ANALYSIS_RATE);
    const high = physical.module.renderPhysicalKotoNote(note, ANALYSIS_RATE * 2);
    const reference = resample(high, ANALYSIS_RATE * 2, ANALYSIS_RATE);
    const first = Math.round(0.12 * ANALYSIS_RATE);
    const last = Math.round(0.8 * ANALYSIS_RATE);
    const difference = Float32Array.from(native.subarray(first, last), (value, index) => value - reference[first + index]);
    const nativePeak = spectralPeak(spectrumAt(native, ANALYSIS_RATE, 0.12), ANALYSIS_RATE, frequency);
    const referencePeak = spectralPeak(spectrumAt(reference, ANALYSIS_RATE, 0.12), ANALYSIS_RATE, frequency);
    const pitchDifferenceCents = 1200 * Math.log2(nativePeak.hz / referencePeak.hz);
    const model = physical.module.describePhysicalKotoString(frequency);
    cases.push({ frequency, nativeSampleRate: ANALYSIS_RATE, referenceSampleRate: ANALYSIS_RATE * 2,
      input: note, comparedWindowSeconds: [0.12, 0.8], pitchDifferenceCents,
      relativeWaveformErrorDb: db(rmsOf(difference) / Math.max(1e-30, rmsOf(reference.subarray(first, last)))),
      fundamentalAmplitudeDifferenceDb: db(nativePeak.magnitude / referencePeak.magnitude),
      pitchGate: Math.abs(pitchDifferenceCents) <= CRITERIA.rateConvergencePitchCents, string: model });
    await writeFile(resolve(output, `physical-${frequency}hz-rate96-reference.raw.f32.wav`), encodeWav(reference, ANALYSIS_RATE, true));
  }
  return { status: 'measured', cases,
    interpretation: '48/96 kHz convergence includes integrator, filter and resampler error; residual is not an isolated alias level. Unpressed, same seed, no alignment or gain fitting.' };
}

export async function runAnalysis(output = '/private/tmp/lumen-koto-evaluation', bankPath = resolve(root, 'public/lake-audio/samples/bank.json'),
  { reuseFrom, reuseMethods = ['legacy', 'sample'], productionEvidencePath } = {}) {
  await mkdir(output, { recursive: true });
  const baseline = await loadBaseline(output);
  const physical = await loadPhysical();
  const methods = [baseline, physical, ...await loadSamples(physical, bankPath),
    await loadProduction(productionEvidencePath, physical)].filter(Boolean);
  const previousBytes = reuseFrom ? await readFile(resolve(reuseFrom, 'manifest.json')) : null;
  const previous = previousBytes ? JSON.parse(previousBytes.toString('utf8')) : null;
  const reusedMethods = [];
  for (const method of methods) if (reuseMethods.includes(method.id) && previous) {
    if (!reusableMethod(previous, method)) throw new Error('Requested reuse has changed input closure');
    reusedMethods.push(method.id);
  }
  const inputSnapshots = {};
  for (const path of new Set(['scripts/koto-analysis.mjs', 'src/coast/world/lake/kotoPerformance.ts',
    ...methods.flatMap(method => Object.keys(method.sourceHashes))])) {
    const content = await readFile(resolve(root, path));
    const destination = resolve(output, 'sources', path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
    inputSnapshots[path] = { sha256: hash(content), snapshot: `sources/${path}` };
  }
  for (const artifact of new Map(methods.flatMap(method => method.inputArtifacts ?? []).map(item => [item.snapshot, item])).values()) {
    const destination = resolve(output, artifact.snapshot);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(artifact.path));
    inputSnapshots[artifact.snapshot] = { sha256: artifact.sha256, snapshot: artifact.snapshot, sourcePath: artifact.path };
  }
  const clips = [];
  const unavailableClips = [];
  for (const method of methods) for (const item of CASES) {
    if (method.onlyCases && !method.onlyCases.includes(item.id)) continue;
    if (item.kind === 'score' && !method.score) continue;
    if (reusedMethods.includes(method.id)) {
      const old = previous.clips.find(clip => clip.method === method.id && clip.case === item.id);
      if (!old) {
        const unavailable = previous.unavailableClips.find(clip => clip.method === method.id && clip.case === item.id);
        if (!unavailable) throw new Error('Reusable study case has no recorded outcome');
        unavailableClips.push(structuredClone(unavailable));
        continue;
      }
      const raw = await readFile(resolve(reuseFrom, old.rawWav));
      if (hash(raw) !== old.sha256.rawWav) throw new Error('Reusable raw audio hash mismatch');
      const decoded = decodeMonoWav(raw);
      if (decoded.sampleRate !== ANALYSIS_RATE || decoded.samples.length !== old.frames) throw new Error('Reusable raw audio layout mismatch');
      clips.push({ ...structuredClone(old), samples: decoded.samples,
        reusedFrom: { manifestSha256: hash(previousBytes), generatedAt: previous.generatedAt,
          rawWavSha256: old.sha256.rawWav, measurementAlgorithmSha256: previous.inputSnapshots['scripts/koto-analysis.mjs'].sha256 } });
      continue;
    }
    let measured;
    try { measured = measureRender(() => {
      if (method.renderCase) return method.renderCase(item.id);
      if (item.kind === 'score') return method.score();
      if (item.kind === 'note') return method.note(item);
      const sum = new Float32Array(item.durationSeconds * method.nativeSampleRate);
      for (const [index, [seconds, string, force, pressSemitones]] of item.notes.entries()) {
        const note = method.note({ string, force, pressSemitones, index,
          expectedHz: LAKE_KOTO_TUNING[string - 1].frequency, durationSeconds: 6 });
        const start = Math.round(seconds * method.nativeSampleRate);
        for (let i = 0; i < note.length && i + start < sum.length; i += 1) sum[start + i] += note[i];
      }
      return sum;
    }); } catch (error) {
      if (error?.code !== 'KOTO_SAMPLE_UNAVAILABLE') throw error;
      unavailableClips.push({ method: method.id, case: item.id, code: 'KOTO_SAMPLE_UNAVAILABLE',
        frequency: error.frequency, pressSemitones: error.pressSemitones,
        reason: 'No reviewed root covers every note and press within ±5 semitones; no substitute waveform was invented.' });
      continue;
    }
    if (method.performanceEvidence) measured.performance = method.performanceEvidence;
    const samples = resample(measured.samples, method.nativeSampleRate, ANALYSIS_RATE);
    const stats = signalStats(samples);
    const note = item.kind === 'note' ? analyzeNote(samples, ANALYSIS_RATE, item) : null;
    if (note && physical && (method.id === 'physical' || method.id === 'hybrid')) {
      const string = physical.module.describePhysicalKotoString(item.expectedHz);
      const ratio = 2 ** ((item.pressSemitones ?? 0) / 12);
      const bendingTension = Math.PI ** 2 * string.bendingStiffnessNm2 / string.lengthM ** 2;
      const pressedTension = (string.tensionN + bendingTension) * ratio ** 2 - bendingTension;
      const inharmonicity = Math.PI ** 2 * string.bendingStiffnessNm2 / (pressedTension * string.lengthM ** 2);
      note.theory = { string, pressedTensionN: pressedTension,
        isolatedStringModes: note.partials.map(({ order }) => ({ order,
          frequencyHz: note.pitch.expectedHz * order * Math.sqrt((1 + inharmonicity * order ** 2) / (1 + inharmonicity)) })),
        limitation: 'Isolated stiff-string prediction; the coupled radiated local peak can differ. No body-mode identification is inferred.' };
    }
    const gates = { finite: stats.nonFiniteCount === 0, dc: stats.absoluteDcDbfs <= CRITERIA.absoluteDcDbfs,
      duration: Math.abs(stats.durationSeconds - item.durationSeconds) < 1 / ANALYSIS_RATE,
      pitch: note ? note.pitch.status === 'measured' && Math.abs(note.pitch.errorCents)
        <= (item.pressSemitones ? CRITERIA.pressedPitchErrorCents : CRITERIA.normalPitchErrorCents) : null,
      loopSeam: item.kind === 'score' ? stats.loopSeamDbfs <= CRITERIA.loopSeamDbfs : null,
      final50ms: stats.final50msRmsDbfs <= CRITERIA.final50msRmsDbfs,
      damping: note?.damping && method.id !== 'legacy' ? note.damping.reductionDb >= CRITERIA.dampedReductionDb : null };
    clips.push({ id: `${method.id}-${item.id}`, method: method.id, case: item.id, samples,
      sampleRate: ANALYSIS_RATE, frames: samples.length, durationSeconds: samples.length / ANALYSIS_RATE,
      measurements: { ...stats, note, gates, performance: measured.performance,
        rendererDiagnostics: method.diagnostics?.slice(),
        unsupported: method.id === 'legacy' && item.dampAt ? ['dampAt'] : [] } });
  }
  const normalization = normalizationPlan(clips);
  for (const clip of clips) {
    const key = `${clip.method}:${clip.case === 'score-39' ? 'score' : 'notes'}`;
    clip.commonSafetyGainDb = normalization.commonSafetyGainDb;
    clip.matchGainDb = normalization.anchors[key].gainDb;
    const matched = Float32Array.from(clip.samples, value => value * gain(clip.matchGainDb + clip.commonSafetyGainDb));
    clip.rawWav = `${clip.id}.raw.f32.wav`;
    clip.matchedWav = `${clip.id}.matched.wav`;
    clip.visualization = `${clip.id}.visualization.json`;
    clip.measurementsFile = `${clip.id}.measurements.json`;
    clip.measurements.matched = signalStats(matched);
    clip.measurements.gates.comparisonPeak = clip.measurements.matched.samplePeakDbfs <= CRITERIA.comparisonSamplePeakDbfs + 1e-6;
    await writeFile(resolve(output, clip.rawWav), encodeWav(clip.samples, ANALYSIS_RATE, true));
    await writeFile(resolve(output, clip.matchedWav), encodeWav(matched));
    await writeFile(resolve(output, clip.visualization), JSON.stringify(visualization(clip.samples, ANALYSIS_RATE,
      CASES.find(item => item.id === clip.case).onsetSeconds)));
    await writeFile(resolve(output, clip.measurementsFile), JSON.stringify(clip.measurements, null, 2));
    clip.sha256 = { rawWav: hash(await readFile(resolve(output, clip.rawWav))), matchedWav: hash(await readFile(resolve(output, clip.matchedWav))) };
    delete clip.samples;
  }
  const experiments = { sampleRateConvergence: await rateConvergence(physical, output) };
  const sourceDrift = [];
  for (const [path, snapshot] of Object.entries(inputSnapshots)) {
    const currentPath = snapshot.sourcePath ?? resolve(root, path);
    if (hash(await readFile(currentPath)) !== snapshot.sha256) sourceDrift.push(path);
  }
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), sampleRate: ANALYSIS_RATE, channels: 1,
    environment: { node: process.version, platform: process.platform, architecture: process.arch },
    baseline: { revision: BASELINE_REVISION, sourcePath, sha256: baseline.sourceHashes['scripts/fixtures/lakeKotoLegacy.ts'], nativeSampleRate: baseline.nativeSampleRate },
    criteria: CRITERIA, inputSnapshots, sourceDrift, experiments,
    reuse: previous ? { from: resolve(reuseFrom, 'manifest.json'), manifestSha256: hash(previousBytes), methods: reusedMethods } : null,
    methods: methods.map(({ id, label, status, nativeSampleRate, internalSampleRate, sourceHashes, limitations, bank, productionEvidence }) =>
      ({ id, label, status, nativeSampleRate, internalSampleRate, sourceHashes, limitations, bank, productionEvidence })), cases: CASES, normalization, clips, unavailableClips,
    unperformed: ['human-listening', 'physical-headphone-or-loudspeaker-calibration', 'browser-realtime-cpu-and-memory', 'final-spatial-output', 'empirical-alias-isolation'],
  };
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const flags = process.argv.slice(4);
    const option = name => flags.includes(name) ? flags[flags.indexOf(name) + 1] : undefined;
    const reusePath = option('--reuse');
    const productionPath = option('--production');
    const manifest = await runAnalysis(process.argv[2] ? resolve(process.argv[2]) : undefined,
      process.argv[3] ? resolve(process.argv[3]) : undefined, {
        reuseFrom: reusePath ? resolve(reusePath) : undefined,
        reuseMethods: option('--reuse-methods')?.split(','),
        productionEvidencePath: productionPath ? resolve(productionPath) : undefined,
      });
    console.log(JSON.stringify({ clips: manifest.clips.length, methods: manifest.methods.map(method => method.id), sourceDrift: manifest.sourceDrift,
      failures: manifest.clips.flatMap(clip => Object.entries(clip.measurements.gates)
        .filter(([, passed]) => passed === false).map(([gate]) => `${clip.id}:${gate}`)),
      manifest: resolve(process.argv[2] || '/private/tmp/lumen-koto-evaluation', 'manifest.json') }));
    if (manifest.sourceDrift.length) process.exitCode = 2;
  } catch {
    console.error('Koto analysis failed. Inspect the selected inputs locally; no subprocess output is forwarded.');
    process.exitCode = 1;
  }
}
