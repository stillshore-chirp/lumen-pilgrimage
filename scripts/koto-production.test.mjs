import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { encodePcm24, decodePcm24 } from './prepare-koto-performance.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('PCM24 preserves a known signal within two quantization steps with reproducible TPDF', () => {
  const samples = Float32Array.from({ length: 48000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 997 * i / 48000));
  const encoded = encodePcm24(samples, 48000);
  assert.deepEqual(encodePcm24(samples, 48000), encoded);
  const decoded = decodePcm24(encoded);
  assert.equal(decoded.sampleRate, 48000);
  let energy = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const error = decoded.samples[i] - samples[i];
    assert.ok(Math.abs(error) <= 2 / 8388608);
    energy += error ** 2;
  }
  assert.ok(10 * Math.log10(energy / samples.length) < -140);
  assert.throws(() => encodePcm24(Float32Array.of(1.1), 48000), /headroom/);
  assert.throws(() => encodePcm24(Float32Array.of(NaN), 48000), /finite/);
});

test('the distributed performance matches its recorded inputs, hash, duration and signal gates', async () => {
  const evidence = JSON.parse(await readFile(resolve(root, 'assets/lake-audio/production.json')));
  assert.equal(evidence.qualityStatus, 'timeboxed-delivery-human-quality-not-certified');
  assert.equal(evidence.method, 'sample-sustain-color');
  assert.equal(evidence.diagnosticsSummary.notes, 48);
  assert.equal(evidence.diagnosticsSummary.physicalFallbackNotes, 0);
  assert.equal(evidence.diagnosticsSummary.clippedFilterTails, 0);
  for (const [path, expected] of Object.entries(evidence.inputHashes)) {
    assert.equal(hash(await readFile(resolve(root, path))), expected, `production input changed: ${path}`);
  }
  const bytes = await readFile(resolve(root, evidence.output.path));
  assert.equal(hash(bytes), evidence.output.sha256);
  assert.equal(bytes.length, evidence.output.bytes);
  const { samples, sampleRate } = decodePcm24(bytes);
  assert.equal(sampleRate, 48000);
  assert.equal(samples.length, 39 * 48000);
  let peak = 0;
  let energy = 0;
  let dc = 0;
  for (const value of samples) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); energy += value * value; dc += value; }
  assert.ok(20 * Math.log10(peak) <= -3 + 0.001);
  assert.ok(Math.abs(10 * Math.log10(energy / samples.length) + 24) < 0.1);
  assert.ok(Math.abs(dc / samples.length) < 0.001);
  assert.ok(Math.abs(samples[0] - samples.at(-1)) < 0.0001);
  assert.ok(evidence.quantization.maximumAbsoluteError <= 2 / 8388608);
  assert.ok(evidence.quantization.rmsErrorDbfs < -140);
});
