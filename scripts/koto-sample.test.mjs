import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
import { test } from 'node:test';

const src = new URL('../src/', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.startsWith(src) && specifier.startsWith('.') && !extname(specifier)
    ? `${specifier}.ts` : specifier, context);
} });
const { renderSampleKotoNote, renderHybridKotoNote, kotoSampleSupports, KotoSampleUnavailableError }
  = await import('../src/coast/world/lake/kotoSampleModel.ts');
hooks.deregister();

const rate = 48000;
const makeSample = (rootFrequency, waveform, duration = 1) => ({
  id: 'generated-test-fixture', rootFrequency, sampleRate: rate,
  samples: Float32Array.from({ length: rate * duration }, (_, index) => waveform(index / rate)),
  sourceId: 'generated-test-fixture', sourceStartSeconds: 0, sourceEndSeconds: duration,
});
const rms = samples => Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);

test('sample coverage rejects unsupported notes without concealing malformed inputs', () => {
  const bank = [makeSample(319.53, time => 0.1 * Math.sin(2 * Math.PI * 319.53 * time))];
  assert.equal(kotoSampleSupports({ frequency: 293.6648, velocity: 0.6 }, bank), true);
  assert.equal(kotoSampleSupports({ frequency: 220, velocity: 0.6 }, bank), false);
  assert.throws(() => renderSampleKotoNote({ frequency: 220, velocity: 0.6 }, bank), error =>
    error instanceof KotoSampleUnavailableError && error.code === 'KOTO_SAMPLE_UNAVAILABLE');
  assert.equal(kotoSampleSupports({ frequency: 400, velocity: 0.6, pressSemitones: 3 }, bank), false);
  assert.throws(() => kotoSampleSupports({ frequency: Number.NaN, velocity: 0.6 }, bank), RangeError);
  assert.throws(() => renderSampleKotoNote({ frequency: 320, velocity: 0.6 }, [{ ...bank[0], samples: Float32Array.of(Number.NaN) }]), RangeError);
});

test('sample playback attenuates a transposition alias instead of folding full-energy high frequencies', () => {
  const note = { frequency: 100 * 2 ** (5 / 12), velocity: 0.6, duration: 0.8 };
  const renderSine = hz => renderSampleKotoNote(note,
    [makeSample(100, time => 0.2 * Math.sin(2 * Math.PI * hz * time))], rate).samples.subarray(4800, 24000);
  const passbandRms = rms(renderSine(1000));
  const stopbandRms = rms(renderSine(20000));
  assert.ok(20 * Math.log10(stopbandRms / passbandRms) < -70);
  assert.ok(Math.abs(20 * Math.log10(rms(renderSine(15000)) / passbandRms)) < 1);
});

test('hybrid replaces a real high-band attack, preserves the physical tail and reveals fallback', () => {
  const note = { frequency: 440, velocity: 0.6, duration: 1 };
  const bank = [makeSample(440, time => Math.exp(-3 * time)
    * (0.05 * Math.sin(2 * Math.PI * 440 * time) + 0.1 * Math.sin(2 * Math.PI * 6000 * time)))];
  const physical = Float32Array.from({ length: rate }, (_, index) => {
    const time = index / rate;
    return Math.exp(-2 * time) * (0.1 * Math.sin(2 * Math.PI * 440 * time)
      + 0.02 * Math.sin(2 * Math.PI * 7000 * time));
  });
  const result = renderHybridKotoNote(note, bank, () => physical, rate);
  assert.equal(result.diagnostics.method, 'hybrid');
  assert.deepEqual(result.samples.subarray(7200), physical.subarray(7200));
  assert.notDeepEqual(result.samples.subarray(480, 2400), physical.subarray(480, 2400));
  assert.equal(result.samples[0], 0);
  assert.ok(result.samples.every(Number.isFinite));
  assert.ok(Math.abs(result.diagnostics.highBandEnergyRatio - 1) < 1e-10);
  assert.ok(result.diagnostics.attackGain < 0.25, 'weak physical attack must not be amplified by a gain floor');
  const fallback = renderHybridKotoNote({ ...note, frequency: 220 }, bank, () => physical, rate);
  assert.equal(fallback.diagnostics.method, 'physical-fallback');
  assert.deepEqual(fallback.samples, physical);
});

test('sample and hybrid zero velocity are silent and the sampler never loops an exhausted cut', () => {
  const bank = [makeSample(440, time => 0.1 * Math.sin(2 * Math.PI * 440 * time), 0.2)];
  const zero = { frequency: 440, velocity: 0, duration: 1 };
  const silent = new Float32Array(rate);
  assert.deepEqual(renderSampleKotoNote(zero, bank, rate).samples, silent);
  assert.deepEqual(renderHybridKotoNote(zero, bank, () => silent, rate).samples, silent);
  const rendered = renderSampleKotoNote({ ...zero, velocity: 0.6 }, bank, rate).samples;
  assert.ok(rendered.subarray(10000).every(value => value === 0));
});
