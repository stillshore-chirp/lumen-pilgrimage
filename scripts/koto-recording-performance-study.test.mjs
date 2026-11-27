import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import { prepareRecordingCandidate, noteRecordingCoverage, evaluatePerformancePress } from './koto-recording-performance-study.mjs';
import { decodeMonoWav } from './koto-analysis.mjs';
import { LAKE_KOTO_EVENTS, LAKE_KOTO_TUNING } from '../src/coast/world/lake/kotoPerformance.ts';

const rate = 48000;

test('candidate processing keeps a finite recorded cut with disclosed DC/fades/common gain and correct octave', () => {
  const channel = new Float32Array(Math.round(39.6 * rate));
  const first = Math.round(38.769 * rate), last = Math.round(39.580 * rate);
  for (let i = first; i < last; i += 1) {
    const t = (i - first) / rate;
    channel[i] = 0.0001 + Math.exp(-t) * (0.05 * Math.sin(2 * Math.PI * 240.2 * t)
      + 0.2 * Math.sin(2 * Math.PI * 480.4 * t) + 0.03 * Math.sin(2 * Math.PI * 720.6 * t));
  }
  const result = prepareRecordingCandidate(channel, 0.75);
  assert.equal(result.samples.length, last - first);
  assert.equal(result.metadata.durationSeconds, 0.811);
  assert.ok(Math.abs(result.metadata.rootFrequency - 240.2) < 0.2);
  assert.ok(result.metadata.rootEvidence.fundamentalVsSecondDb < -10);
  assert.ok(result.metadata.rootEvidence.half120VsFundamentalDb < -40);
  assert.equal(Math.abs(result.samples[0]), 0);
  assert.ok(Math.abs(result.samples.at(-1)) < 1e-20);
  assert.ok(result.samples.every(Number.isFinite));
  assert.equal(result.metadata.commonBankGain, 0.75);
  assert.throws(() => prepareRecordingCandidate(Float32Array.of(Number.NaN), 1), RangeError);
});

test('240Hz root covers both missing low pitches without extending or looping exhausted source', () => {
  const root = 240.27;
  const bank = [{ id: 'generated-240-fixture', rootFrequency: root, sampleRate: rate,
    samples: Float32Array.from({ length: 38928 }, (_, i) => 0.1 * Math.exp(-i / rate)
      * Math.sin(2 * Math.PI * root * i / rate)), sourceId: 'generated-test', sourceStartSeconds: 0, sourceEndSeconds: 0.811 }];
  for (const frequency of [220, 440 * 2 ** ((58 - 69) / 12)]) {
    const coverage = noteRecordingCoverage({ frequency, velocity: 0.6, duration: 2 }, bank);
    assert.equal(coverage.supported, true);
    assert.equal(coverage.method, 'sample');
    assert.ok(coverage.maximumTransposeSemitones < 2);
    assert.ok(coverage.lastNonSilentSeconds < 0.9);
  }
});

test('score press acceptance requires every actual press to have finite non-silent correctly pitched evidence', () => {
  const valid = LAKE_KOTO_EVENTS.map((event, eventIndex) => ({ event, eventIndex })).filter(({ event }) => event.pressSemitones)
    .map(({ event, eventIndex }) => ({ eventIndex, pressSemitones: event.pressSemitones,
      pressPlateauEvidence: { windowSeconds: [0.48, 0.48 + 8192 / rate], windowComplete: true,
        nonFiniteCount: 0, rms: 0.01, rmsDbfs: -40,
        pitch: { measuredHz: LAKE_KOTO_TUNING[event.string - 1].frequency * 2 ** (event.pressSemitones / 12) } } }));
  const complete = evaluatePerformancePress(valid);
  assert.equal(complete.requiredCount, 4); assert.equal(complete.passCount, 4); assert.equal(complete.allPass, true);
  for (const mode of ['silence', 'missing', 'nonfinite', 'wrong-pitch']) {
    const bad = structuredClone(valid);
    if (mode === 'silence') bad[0].pressPlateauEvidence.rms = 0;
    if (mode === 'missing') delete bad[0].pressPlateauEvidence;
    if (mode === 'nonfinite') bad[0].pressPlateauEvidence.nonFiniteCount = 1;
    if (mode === 'wrong-pitch') bad[0].pressPlateauEvidence.pitch.measuredHz *= 2 ** (20 / 1200);
    assert.equal(evaluatePerformancePress(bad).allPass, false, mode);
    assert.equal(evaluatePerformancePress(bad).passCount, 3, mode);
  }
});

const artifactDirectory = process.env.KOTO_RECORDING_STUDY_OUTPUT;
test('real output meets the actual UI parser, measured PCM dimensions, hashes and applied gain', { skip: !artifactDirectory }, async () => {
  const ui = await readFile(new URL('../src/dev/kotoAudition.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('ui.ts', ui, ts.ScriptTarget.Latest, true);
  const names = new Set(['isRecord', 'record', 'string', 'number', 'list', 'sameOriginUrl', 'parseManifest', 'numbers', 'parseVisualization']);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
  assert.equal(functions.length, names.size);
  const js = ts.transpileModule(functions.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const parser = runInNewContext(`${js}; ({parseManifest,parseVisualization})`, {
    URL, location: { origin: 'http://127.0.0.1:4191' }, manifestUrl: new URL('http://127.0.0.1:4191/artifacts/recording/manifest.json'),
  });
  const original = JSON.parse(await readFile(resolve(artifactDirectory, 'manifest.json')));
  const parsed = parser.parseManifest(original);
  assert.equal(original.coverage.strings, 13);
  assert.equal(original.coverage.events, 48);
  assert.equal(original.eventCoverage.length, 48);
  assert.deepEqual(original.sourceDrift, []);
  assert.ok(original.clips.some(clip => clip.method === 'recording-six' && clip.case === 'score-39'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const clip of parsed.clips) {
    const rawBytes = await readFile(resolve(artifactDirectory, clip.rawWav));
    const matchedBytes = await readFile(resolve(artifactDirectory, clip.matchedWav));
    const provenance = original.clips.find(candidate => candidate.id === clip.id);
    assert.equal(hash(rawBytes), provenance.sha256.rawWav);
    assert.equal(hash(matchedBytes), provenance.sha256.matchedWav);
    const raw = decodeMonoWav(rawBytes), matched = decodeMonoWav(matchedBytes);
    assert.equal(raw.sampleRate, clip.sampleRate); assert.equal(matched.sampleRate, clip.sampleRate);
    assert.equal(raw.samples.length, clip.frames); assert.equal(matched.samples.length, clip.frames);
    assert.equal(clip.frames / clip.sampleRate, clip.durationSeconds);
    const gain = 10 ** ((clip.matchGainDb + clip.commonSafetyGainDb) / 20);
    let maximumError = 0;
    for (let i = 0; i < clip.frames; i += 1) maximumError = Math.max(maximumError, Math.abs(matched.samples[i] - raw.samples[i] * gain));
    assert.ok(maximumError <= 2 / 32768, 'manifest gain must match the actual PCM quantization');
    parser.parseVisualization(JSON.parse(await readFile(resolve(artifactDirectory, clip.visualization))));
  }
  const pressed = original.clips.filter(clip => clip.method === 'recording-six' && ['press-one', 'press-two'].includes(clip.case));
  assert.ok(pressed.every(clip => clip.measurements.gates.pitch === false));
  assert.equal(original.clips.find(clip => clip.method === 'recording-six' && clip.case === 'damped').measurements.gates.damping, false);
  const score = original.clips.find(clip => clip.method === 'recording-six' && clip.case === 'score-39');
  const actualPress = evaluatePerformancePress(original.eventCoverage);
  assert.equal(score.measurements.gates.performancePress, actualPress.allPass);
  assert.equal(score.measurements.gates.performancePress, false);
  assert.equal(actualPress.requiredCount, 4); assert.equal(actualPress.passCount, 0);
  assert.ok(actualPress.events.every(event => event.status === 'no-finite-non-silent-plateau'));
  assert.ok(original.methods.find(method => method.id === 'recording-six').limitations.includes('曲内4押し手は到達窓で録音が尽き、全曲の奏法要件は未達。比較用で本番未採用'));
});
