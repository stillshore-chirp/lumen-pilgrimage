import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANALYSIS_RATE, CASES, CRITERIA, analyzeNote, decodeMonoWav, encodeWav, fftMagnitudes, normalizationPlan, reusableMethod,
  resample, rmsOf, signalStats, spectralPeak, visualization } from './koto-analysis.mjs';

const sine = (hz, amplitude, rate, seconds) => Float32Array.from({ length: Math.round(rate * seconds) },
  (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / rate));

test('level metrics distinguish RMS, crest, DC, endpoint and non-finite failures', () => {
  const samples = sine(1000, 0.5, ANALYSIS_RATE, 1);
  const stats = signalStats(samples);
  assert.ok(Math.abs(stats.rms - 0.5 / Math.sqrt(2)) < 1e-7);
  assert.ok(Math.abs(stats.crestDb - 3.0102999566) < 1e-6);
  assert.ok(stats.absoluteDcDbfs < -150);
  const invalid = signalStats(Float32Array.of(0, Number.NaN, Infinity));
  assert.equal(invalid.nonFiniteCount, 2);
  const dc = signalStats(Float32Array.of(0.1, 0.1, 0.1));
  assert.ok(Math.abs(dc.absoluteDcDbfs + 20) < 1e-5);
  assert.equal(dc.loopSeamDelta, 0);
});

test('FFT and sub-bin pitch estimator recover an off-bin known sinusoid', () => {
  const hz = 392;
  const spectrum = fftMagnitudes(sine(hz, 0.4, ANALYSIS_RATE, 8192 / ANALYSIS_RATE));
  const peak = spectralPeak(spectrum, ANALYSIS_RATE, hz);
  assert.ok(Math.abs(1200 * Math.log2(peak.hz / hz)) < 1);
  assert.ok(peak.magnitude > 0.37 && peak.magnitude <= 0.4);
  assert.throws(() => fftMagnitudes(Float32Array.of(1, 2), 7));
});

test('bandlimited sample-rate conversion preserves pitch and rejects out-of-band decimation', () => {
  const converted = resample(sine(1000, 0.4, 24000, 1), 24000, 48000);
  assert.equal(converted.length, 48000);
  assert.ok(Math.abs(rmsOf(converted.subarray(100, -100)) - 0.4 / Math.sqrt(2)) < 0.001);
  const aboveNyquist = resample(sine(18000, 0.4, 48000, 1), 48000, 24000);
  assert.ok(rmsOf(aboveNyquist.subarray(100, -100)) < 0.0001);
});

test('normalization uses a shared note gain and one common peak attenuation', () => {
  const clips = ['first', 'second'].flatMap((method, index) => [
    { method, case: 'mid-normal', samples: sine(1000, 0.3 * (index + 1), ANALYSIS_RATE, 3) },
    { method, case: 'mid-soft', samples: sine(1000, 0.15 * (index + 1), ANALYSIS_RATE, 3) },
    { method, case: 'score-39', samples: sine(1000, 0.2 * (index + 1), ANALYSIS_RATE, 3) },
  ]);
  const plan = normalizationPlan(clips);
  assert.ok(Math.abs(plan.anchors['first:notes'].gainDb - plan.anchors['second:notes'].gainDb - 6.020599913) < 1e-6);
  const firstNormal = clips[0].samples;
  const firstSoft = clips[1].samples;
  const common = 10 ** ((plan.anchors['first:notes'].gainDb + plan.commonSafetyGainDb) / 20);
  assert.ok(Math.abs(rmsOf(firstNormal) * common / (rmsOf(firstSoft) * common) - 2) < 1e-7);
});

test('raw float WAV retains overload while PCM WAV refuses to clip silently', () => {
  const raw = encodeWav(Float32Array.of(0, 1.25, -1.5), 48000, true);
  assert.equal(raw.readUInt16LE(20), 3);
  assert.equal(raw.readFloatLE(48), 1.25);
  assert.equal(raw.readFloatLE(52), -1.5);
  assert.throws(() => encodeWav(Float32Array.of(1.01)));
  assert.throws(() => encodeWav(Float32Array.of(Number.NaN), 48000, true));
  const pcm = encodeWav(Float32Array.of(-1, 0, 1));
  assert.equal(pcm.readUInt16LE(20), 1);
  assert.equal(pcm.readInt16LE(44), -32768);
  assert.equal(pcm.readInt16LE(48), 32767);
  const decoded = decodeMonoWav(raw);
  assert.equal(decoded.sampleRate, 48000);
  assert.deepEqual([...decoded.samples], [0, 1.25, -1.5]);
  assert.throws(() => decodeMonoWav(Buffer.from('not audio')));
  assert.throws(() => decodeMonoWav(raw.subarray(0, -1)));
  const pcm24 = Buffer.alloc(53);
  pcm.copy(pcm24, 0, 0, 44);
  pcm24.writeUInt32LE(45, 4); pcm24.writeUInt32LE(48000 * 3, 28);
  pcm24.writeUInt16LE(3, 32); pcm24.writeUInt16LE(24, 34); pcm24.writeUInt32LE(9, 40);
  pcm24.writeIntLE(-4194304, 44, 3); pcm24.writeIntLE(0, 47, 3); pcm24.writeIntLE(4194304, 50, 3);
  assert.deepEqual([...decodeMonoWav(pcm24).samples], [-0.5, 0, 0.5]);
});

test('reuse follows the actual DSP input closure and rejects changed criteria, cases or sample data', () => {
  const current = { id: 'sample', bank: { sha256: 'bank-a' }, sourceHashes: { sample: 'same', performance: 'same' } };
  const old = { ...current, sourceHashes: { ...current.sourceHashes, physical: 'obsolete-independent-engine' } };
  const previous = { methods: [old], criteria: CRITERIA, cases: CASES };
  assert.equal(reusableMethod(previous, current), true);
  assert.equal(reusableMethod(previous, { ...current, sourceHashes: { ...current.sourceHashes, sample: 'changed' } }), false);
  assert.equal(reusableMethod(previous, { ...current, bank: { sha256: 'bank-b' } }), false);
  assert.equal(reusableMethod(previous, current, { ...CRITERIA, normalPitchErrorCents: 20 }), false);
  assert.equal(reusableMethod(previous, current, CRITERIA, CASES.slice(1)), false);
});

test('note analysis separates pitch, decay evidence and unmeasured aliasing', () => {
  const hz = 440;
  const tone = sine(hz, 0.4, ANALYSIS_RATE, 6);
  for (let i = 0; i < tone.length; i += 1) tone[i] *= Math.exp(-i / (ANALYSIS_RATE * 0.3));
  const metrics = analyzeNote(tone, ANALYSIS_RATE, { expectedHz: hz });
  assert.ok(Math.abs(metrics.pitch.errorCents) < 1);
  assert.equal(metrics.alias.status, 'not-disambiguated');
  const lowBand = metrics.decayFits[0];
  assert.ok(Math.abs(lowBand.extrapolatedT60Seconds - Math.log(1000) * 0.3) < 0.08);
  const visual = visualization(tone);
  assert.equal(visual.schemaVersion, 1);
  assert.ok(visual.waveform.timesSeconds.length <= 700);
  assert.equal(visual.spectrum.frequenciesHz.length, visual.spectrum.dbfs.length);
  assert.equal(visual.stft.rows.length, 80);
  const silent = analyzeNote(new Float32Array(ANALYSIS_RATE * 6), ANALYSIS_RATE,
    { expectedHz: hz, pressSemitones: 2, dampAt: 0.65 });
  assert.equal(silent.pitch.status, 'no-measurable-fundamental-in-window');
  assert.equal(silent.pitch.measuredHz, null);
  assert.equal(silent.pitch.errorCents, null);
  assert.equal(silent.damping.status, 'no-pre-damping-signal');
  assert.equal(silent.damping.reductionDb, null);
});
