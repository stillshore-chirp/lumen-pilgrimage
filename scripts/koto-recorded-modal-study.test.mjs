import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { auditionManifestV1, extendRecordedSample } from './koto-recorded-modal-study.mjs';

const rate = 48000;
const trueWave = time => 0.2 * Math.exp(-4 * time) * Math.cos(2 * Math.PI * 440 * time + 0.7)
  + 0.04 * Math.exp(-6 * time) * Math.cos(2 * Math.PI * 881 * time - 0.3);
const recorded = Float32Array.from({ length: Math.round(rate * 0.6) }, (_, index) => {
  const time = index / rate;
  const fade = time <= 0.5 ? 1 : Math.cos((time - 0.5) / 0.1 * Math.PI / 2) ** 2;
  return trueWave(time) * fade;
});

test('known damped modes retain measured phase, frequency and decay without periodic looping', () => {
  const result = extendRecordedSample(recorded, rate, 440, 0.1, 2);
  const diag = result.diagnostics;
  assert.equal(diag.extensionAvailable, true);
  const fundamental = diag.modes.find(mode => mode.order === 1);
  assert.equal(fundamental.accepted, true);
  assert.ok(Math.abs(fundamental.frequency - 440) < 0.1);
  assert.ok(Math.abs(fundamental.decayDbPerSecond + 4 * 20 / Math.LN10) < 0.4);
  assert.ok(fundamental.phaseRmsRadians < 0.02);
  assert.ok(diag.reconstructionResidualRatio < 0.02);
  let error = 0;
  let reference = 0;
  for (let i = Math.round(0.50 * rate); i < Math.round(0.65 * rate); i += 1) {
    error += (result.samples[i] - trueWave(i / rate)) ** 2;
    reference += trueWave(i / rate) ** 2;
  }
  assert.ok(Math.sqrt(error / reference) < 0.025);
  assert.ok(result.samples[Math.round(0.70 * rate)] !== result.samples[Math.round(0.50 * rate)]);
});

test('the full-band measured prefix is byte-identical and the finite extrapolation cap ends in silence', () => {
  const result = extendRecordedSample(recorded, rate, 440, 0.1, 2);
  const first = Math.round(result.diagnostics.recordedUnchangedUntilSeconds * rate);
  assert.deepEqual(result.samples.subarray(0, first), recorded.subarray(0, first));
  assert.ok(result.diagnostics.maximumConnectionDelta <= result.diagnostics.originalAdjacentDeltaInConnection * 1.1);
  assert.ok(result.diagnostics.synthesizedSupportEndSourceSeconds < 1.15);
  assert.ok(result.samples.subarray(Math.ceil(1.15 * rate)).every(value => value === 0));
  assert.ok(result.samples.every(Number.isFinite));
});

test('growing or unsupported tones are rejected instead of being promoted to a long recorded sustain', () => {
  const growing = Float32Array.from({ length: rate * 0.6 }, (_, i) => 0.1 * Math.exp(i / rate)
    * Math.cos(2 * Math.PI * 440 * i / rate));
  const result = extendRecordedSample(growing, rate, 440, 0.1, 2);
  assert.equal(result.diagnostics.extensionAvailable, false);
  assert.ok(result.diagnostics.modes.find(mode => mode.order === 1).rejectionReasons.includes('decay-outside-conservative-fit-range'));
  assert.deepEqual(result.samples.subarray(0, growing.length), growing);
  assert.ok(result.samples.subarray(growing.length).every(value => value === 0));
  assert.throws(() => extendRecordedSample(Float32Array.of(Number.NaN), rate, 440, 0.1), RangeError);
});

test('producer metadata satisfies the actual audition v1 parser and rejects missing fields or invented gain', async () => {
  const ui = await readFile(new URL('../src/dev/kotoAudition.ts', import.meta.url), 'utf8');
  const source = ts.createSourceFile('kotoAudition.ts', ui, ts.ScriptTarget.Latest, true);
  const needed = new Set(['isRecord', 'record', 'string', 'number', 'list', 'sameOriginUrl', 'parseManifest', 'numbers', 'parseVisualization']);
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && needed.has(node.name?.text));
  assert.equal(declarations.length, needed.size, 'the actual UI parser contract changed');
  const js = ts.transpileModule(declarations.map(node => node.getText(source)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const parser = runInNewContext(`${js}; ({ parseManifest, parseVisualization })`, {
    URL, location: { origin: 'http://127.0.0.1:4191' },
    manifestUrl: new URL('http://127.0.0.1:4191/artifacts/trial/manifest.json'),
  });
  const draft = {
    schemaVersion: 1, sampleRate: rate, channels: 1,
    methods: [{ id: 'generated-fixture', label: 'Generated contract fixture', status: 'rendered', nativeSampleRate: rate }],
    cases: [{ id: 'mid-normal', label: 'Generated case', kind: 'note', durationSeconds: 0.6 }],
    normalization: { anchors: { 'generated-fixture:notes': { gainDb: -2 } }, commonSafetyGainDb: -1 },
    clips: [{ id: 'generated-fixture-mid-normal', method: 'generated-fixture', case: 'mid-normal',
      rawWav: 'fixture.raw.wav', matchedWav: 'fixture.matched.wav', visualizationPath: 'fixture.visualization.json',
      measurements: { frames: recorded.length, durationSeconds: recorded.length / rate,
        matched: { gainDb: -3 } } }], unperformed: ['human-listening'], unavailableClips: [],
  };
  const baselineBytes = await readFile(new URL('./fixtures/lakeKotoLegacy.ts', import.meta.url));
  const { createHash } = await import('node:crypto');
  const baseline = { revision: '375c3b7a2d77f3cae2420e5b3ca7c2f4e8bba597',
    sourcePath: 'scripts/fixtures/lakeKotoLegacy.ts', sha256: createHash('sha256').update(baselineBytes).digest('hex') };
  const manifest = auditionManifestV1(draft, baseline);
  const parsed = parser.parseManifest(manifest);
  assert.equal(parsed.clips.length, 1);
  assert.equal(parsed.clips[0].frames, recorded.length);
  assert.equal(parsed.clips[0].matchGainDb + parsed.clips[0].commonSafetyGainDb, -3);
  for (const key of ['sampleRate', 'frames', 'durationSeconds', 'visualization', 'matchGainDb', 'commonSafetyGainDb']) {
    const broken = structuredClone(manifest); delete broken.clips[0][key];
    assert.throws(() => parser.parseManifest(broken), undefined, `missing ${key} must fail the actual parser`);
  }
  const missingBaseline = structuredClone(manifest); delete missingBaseline.baseline;
  assert.throws(() => parser.parseManifest(missingBaseline));
  const inventedGain = structuredClone(draft); inventedGain.clips[0].measurements.matched.gainDb = -4;
  assert.throws(() => auditionManifestV1(inventedGain, baseline), /gain/);
});
