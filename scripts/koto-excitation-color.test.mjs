import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyKotoExcitationColor } from '../src/coast/world/lake/kotoExcitationColor.ts';

const RATE = 48000;
const sine = (frequency, seconds = 0.25, amplitude = 0.1) =>
  Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / RATE));

// Independent least-squares amplitude estimator; handles off-bin frequencies
// without relying on a whole number of cycles or the filter's phase.
function amplitudeAt(samples, frequency, first = 960, last = 10560) {
  let cc = 0; let ss = 0; let cs = 0; let yc = 0; let ys = 0;
  for (let i = first; i < last; i += 1) {
    const phase = 2 * Math.PI * frequency * i / RATE;
    const c = Math.cos(phase); const s = Math.sin(phase);
    cc += c * c; ss += s * s; cs += c * s; yc += samples[i] * c; ys += samples[i] * s;
  }
  const determinant = cc * ss - cs * cs;
  return Math.hypot((yc * ss - ys * cs) / determinant, (ys * cc - yc * cs) / determinant);
}

function frequencyFromCrossings(samples) {
  const crossings = [];
  for (let i = 961; i < samples.length - 960; i += 1) {
    if (samples[i - 1] < 0 && samples[i] >= 0) crossings.push(i - 1 - samples[i - 1] / (samples[i] - samples[i - 1]));
  }
  return (crossings.length - 1) * RATE / (crossings.at(-1) - crossings[0]);
}

test('reference velocity bypass is bit-identical and does not share or mutate input storage', () => {
  const input = Float32Array.of(-0, 0, 1e-40, -1e-40, 0.125, -0.75, 1.25);
  const before = Buffer.from(input.buffer).toString('hex');
  const result = applyKotoExcitationColor(input, 0.6);
  assert.notEqual(result.samples, input);
  assert.equal(Buffer.from(result.samples.buffer).toString('hex'), before);
  assert.equal(Buffer.from(input.buffer).toString('hex'), before);
  assert.equal(result.latencyFrames, 0);
  assert.equal(result.processedFrames, 0);
  assert.equal(result.tailFramesClipped, 0);
  assert.equal(result.bypassed, true);
});

test('known sinusoid gains follow the bounded contact change instead of normalizing note levels', () => {
  const width = velocity => 0.000022 + 0.000080 * (1 - velocity) ** 1.4;
  for (const velocity of [0.3, 0.9]) for (const frequency of [196, 1000, 2000, 4000, 8000]) {
    const input = sine(frequency);
    const result = applyKotoExcitationColor(input, velocity);
    const gainDb = 20 * Math.log10(amplitudeAt(result.samples, frequency) / amplitudeAt(input, frequency));
    const rawDb = -40 * Math.PI ** 2 / Math.LN10 * frequency ** 2 * (width(velocity) ** 2 - width(0.6) ** 2);
    const targetDb = 3 * Math.tanh(rawDb / 3);
    assert.ok(Math.abs(gainDb - targetDb) < 0.55, `${velocity}/${frequency}: ${gainDb} vs ${targetDb}`);
    assert.ok(gainDb >= -3.00001 && gainDb <= 3.00001);
    if (frequency === 8000) assert.ok(velocity < 0.6 ? gainDb < -2.4 : gainDb > 2.6);
    if (frequency === 196) assert.ok(Math.abs(gainDb) < 0.04);
  }
  const quiet = applyKotoExcitationColor(sine(4000, 0.25, 0.05), 0.9).samples;
  const loud = applyKotoExcitationColor(sine(4000, 0.25, 0.1), 0.9).samples;
  assert.ok(Math.abs(amplitudeAt(loud, 4000) / amplitudeAt(quiet, 4000) - 2) < 1e-6);
});

test('impulse response is causal, finite, DC-preserving and bounded at all supported rates', () => {
  for (const sampleRate of [24000, 48000, 96000, 192000]) for (const velocity of [0, 0.3, 0.9, 1]) {
    const start = 31;
    const impulse = new Float32Array(Math.round(sampleRate * 0.01)); impulse[start] = 1;
    const result = applyKotoExcitationColor(impulse, velocity, sampleRate);
    assert.equal(result.samples.length, impulse.length);
    assert.ok(result.samples.subarray(0, start).every(value => value === 0));
    assert.ok(result.samples.subarray(start + 2 * result.latencyFrames + 1).every(value => value === 0));
    assert.ok(result.samples.every(Number.isFinite));
    assert.ok(result.latencyFrames / sampleRate <= 0.00077);
    assert.equal(result.tailFramesClipped, 0);
    const taps = result.samples.subarray(start, start + 2 * result.latencyFrames + 1);
    assert.ok(Math.abs(taps.reduce((sum, value) => sum + value, 0) - 1) < 2e-7);
    for (let i = 0; i < taps.length; i += 1) assert.equal(taps[i], taps[taps.length - 1 - i]);
    for (let bin = 0; bin <= 512; bin += 1) {
      let real = 0; let imaginary = 0;
      for (let i = 0; i < taps.length; i += 1) {
        const angle = Math.PI * bin * i / 512;
        real += taps[i] * Math.cos(angle); imaginary -= taps[i] * Math.sin(angle);
      }
      const gain = Math.hypot(real, imaginary);
      assert.ok(gain >= 10 ** (-3 / 20) - 2e-7 && gain <= 10 ** (3 / 20) + 2e-7);
    }
  }
});

test('an off-bin tone retains frequency after the declared constant latency', () => {
  const frequency = 392.4;
  for (const velocity of [0.3, 0.9]) {
    const result = applyKotoExcitationColor(sine(frequency), velocity);
    const observed = frequencyFromCrossings(result.samples);
    assert.ok(Math.abs(1200 * Math.log2(observed / frequency)) < 0.01);
    assert.equal(result.latencyFrames, 36);
  }
});

test('trailing zero padding stays zero and only the active span is convolved', () => {
  const input = new Float32Array(RATE * 6);
  input.set(sine(1000, 0.2));
  const before = input.slice();
  const result = applyKotoExcitationColor(input, 0.9);
  assert.deepEqual(input, before);
  assert.ok(result.processedFrames < RATE * 0.21);
  assert.equal(result.tailFramesClipped, 0);
  assert.ok(result.samples.subarray(Math.round(RATE * 0.202)).every(value => value === 0));
  assert.ok(result.samples.every(Number.isFinite));
  const boundary = new Float32Array(100); boundary[99] = 1;
  const clipped = applyKotoExcitationColor(boundary, 0.9);
  assert.equal(clipped.tailFramesClipped, 72);
});

test('silence and empty buffers remain silent without FIR work', () => {
  for (const velocity of [0, 0.3, 0.6, 0.9]) for (const length of [0, 288000]) {
    const result = applyKotoExcitationColor(new Float32Array(length), velocity);
    assert.equal(result.samples.length, length);
    assert.ok(result.samples.every(value => value === 0));
    assert.equal(result.processedFrames, 0);
    assert.equal(result.tailFramesClipped, 0);
  }
});

test('invalid input is rejected, including non-finite values on the reference path', () => {
  const input = Float32Array.of(0, 1, 0);
  for (const velocity of [NaN, Infinity, -0.01, 1.01]) assert.throws(() => applyKotoExcitationColor(input, velocity), RangeError);
  for (const rate of [0, 23999, 192001, 48000.5, NaN]) assert.throws(() => applyKotoExcitationColor(input, 0.3, rate), RangeError);
  for (const velocity of [0.3, 0.6]) for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => applyKotoExcitationColor(Float32Array.of(0, value), velocity), RangeError);
  }
  assert.throws(() => applyKotoExcitationColor([0, 1], 0.3), TypeError);
});
