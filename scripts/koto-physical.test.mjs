import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { fftMagnitudes, spectralPeak, rmsOf } from './koto-analysis.mjs';
import { describePhysicalKotoString, renderPhysicalKotoNote } from '../src/coast/world/lake/kotoPhysicalModel.ts';

// Inspect the numerical kernel without shipping test-only exports in the browser.
const source = await readFile(new URL('../src/coast/world/lake/kotoPhysicalModel.ts', import.meta.url), 'utf8');
const instrumented = ts.transpileModule(`${source}\nexport { createPlane, updatePlane, advancePlane, energy, matchedPole };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { createPlane, updatePlane, advancePlane, energy, matchedPole } =
  await import(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`);

function solveDense(matrix, rhs) {
  const n = rhs.length;
  const rows = matrix.map((row, i) => [...row, rhs[i]]);
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let j = i + 1; j < n; j += 1) {
      if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    }
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    assert.ok(Math.abs(rows[i][i]) > 1e-14);
    const divisor = rows[i][i];
    for (let j = i; j <= n; j += 1) rows[i][j] /= divisor;
    for (let k = 0; k < n; k += 1) {
      if (k === i) continue;
      const scale = rows[k][i];
      for (let j = i; j <= n; j += 1) rows[k][j] -= scale * rows[i][j];
    }
  }
  return rows.map(row => row[n]);
}

test('low-rank string/body step matches a separately assembled dense midpoint system', () => {
  const rate = 48000;
  const h = 1 / rate;
  const plane = createPlane(describePhysicalKotoString(392), rate, 0.12, 0.0015, 0.00004, false, 0, () => 0.5);
  updatePlane(plane, plane.string.tensionN, 0, rate);
  const n = plane.q.length;
  for (let i = 0; i < n; i += 1) plane.v[i] = 0.001 * Math.sin(i * 0.41);
  const q = plane.q.slice();
  const v = plane.v.slice();
  const matrix = Array.from({ length: n }, () => new Float64Array(n));
  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) {
    const mass = (i === j ? 1 : 0) + plane.a[i] * plane.g[j] + plane.g[i] * plane.a[j]
      + plane.constraintMass * plane.g[i] * plane.g[j];
    const stiffness = (i === j ? plane.stiffness[i] : 0) + plane.spring * plane.g[i] * plane.g[j];
    matrix[i][j] = mass + (i === j ? h * plane.damping[i] / 2 : 0) + h ** 2 * stiffness / 4;
    rhs[i] += mass * v[j] - h * stiffness * q[j] / 2;
  }
  const expected = solveDense(matrix, rhs);
  const before = energy(plane);
  advancePlane(plane, rate);
  for (let i = 0; i < n; i += 1) {
    assert.ok(Math.abs(plane.q[i] - q[i] - h * expected[i]) < 1e-12);
    assert.ok(Math.abs(plane.v[i] - (2 * expected[i] - v[i])) < 1e-12);
  }
  assert.ok(energy(plane) <= before * (1 + 1e-12));
});

test('a displaced string transfers energy into an initially still body', () => {
  const plane = createPlane(describePhysicalKotoString(392), 48000, 0.12, 0.0015, 0.00004, false, 0, () => 0.5);
  updatePlane(plane, plane.string.tensionN, 0, 48000);
  assert.ok(plane.q.subarray(plane.stringModes).every(value => value === 0));
  assert.ok(plane.v.subarray(plane.stringModes).every(value => value === 0));
  // x=0 is the player's fixed bridge; a pluck near it has positive first and
  // second displacement modes. Mirroring the pluck at x=L would reverse mode 2.
  assert.ok(plane.q[0] > 0 && plane.q[1] > 0);
  let sum = 0;
  for (let i = 0; i < 64; i += 1) sum += advancePlane(plane, 48000) ** 2;
  assert.ok(sum > 0);
  assert.ok(plane.v.subarray(plane.stringModes).some(value => value !== 0));
});

test('prewarped isolated modes follow their continuous target pitch after midpoint integration', () => {
  const rate = 48000;
  for (const frequency of [220, 8000, 16000]) {
    const omega = 2 * rate * Math.tan(Math.PI * frequency / rate);
    const plane = {
      q: Float64Array.of(1), v: Float64Array.of(0), a: Float64Array.of(0), g: Float64Array.of(0),
      stiffness: Float64Array.of(omega ** 2), damping: Float64Array.of(0),
      inverseDiagonal: new Float64Array(1), work: new Float64Array(1), radiation: new Float64Array(1),
      stringModes: 0, constraintMass: 0, lossScale: 1, string: describePhysicalKotoString(392),
    };
    updatePlane(plane, plane.string.tensionN, 0, rate);
    for (let i = 1; i <= 512; i += 1) {
      advancePlane(plane, rate);
      assert.ok(Math.abs(plane.q[0] - Math.cos(2 * Math.PI * frequency * i / rate)) < 1e-10);
    }
  }
});

test('complex pole matching preserves isolated high-mode decay as well as frequency', () => {
  for (const frequency of [85, 196, 880, 7040, 14080]) for (const rate of [48000, 96000, 192000]) {
    const sigma = frequency === 85 ? Math.PI * frequency / 8
      : 0.70 + 0.00028 * frequency + 2.2e-7 * frequency ** 2;
    const [stiffness, damping] = matchedPole(frequency, sigma, rate);
    const real = -damping / 2;
    const imaginary = Math.sqrt(stiffness - real ** 2);
    const x = real / (2 * rate);
    const y = imaginary / (2 * rate);
    const denominator = (1 - x) ** 2 + y ** 2;
    const zReal = (1 - x ** 2 - y ** 2) / denominator;
    const zImaginary = 2 * y / denominator;
    const expectedMagnitude = Math.exp(-sigma / rate);
    const expectedAngle = Math.sqrt((2 * Math.PI * frequency) ** 2 - sigma ** 2) / rate;
    assert.ok(stiffness > 0 && damping > 0);
    assert.ok(Math.abs(Math.hypot(zReal, zImaginary) - expectedMagnitude) < 1e-13);
    assert.ok(Math.abs(Math.atan2(zImaginary, zReal) - expectedAngle) < 1e-12);
  }
});

test('fixed-tension low, middle and high notes remain passive and preserve absolute dynamics', () => {
  for (const frequency of [196, 392, 880]) {
    const levels = [];
    for (const velocity of [0.30, 0.85]) {
      const diagnostics = {};
      const samples = renderPhysicalKotoNote({ frequency, velocity, duration: 0.8, seed: 275, diagnostics });
      assert.ok(samples.every(Number.isFinite));
      assert.ok(diagnostics.maximumRelativeEnergyRise <= 1e-10);
      assert.ok(diagnostics.maximumEnergyJ <= diagnostics.initialEnergyJ * (1 + 1e-10));
      assert.ok(diagnostics.finalEnergyJ < diagnostics.initialEnergyJ);
      levels.push({ energy: diagnostics.initialEnergyJ, rms: rmsOf(samples) });
    }
    assert.ok(levels[1].energy > levels[0].energy * 4);
    assert.ok(levels[1].rms > levels[0].rms * 1.8);
  }
});

test('normal and pressed notes reach their target pitch without resetting the state', () => {
  const rate = 48000;
  for (const pressSemitones of [0, 1, 2]) {
    const samples = renderPhysicalKotoNote({ frequency: 392, velocity: 0.7, pressSemitones, duration: 0.8, seed: 275 });
    const target = 392 * 2 ** (pressSemitones / 12);
    const offset = Math.round((pressSemitones ? 0.48 : 0.12) * rate);
    const spectrum = fftMagnitudes(samples.subarray(offset), 8192);
    const observed = spectralPeak(spectrum, rate, target);
    assert.ok(Math.abs(1200 * Math.log2(observed.hz / target)) < (pressSemitones ? 15 : 10));
    assert.ok(samples.every(Number.isFinite));
  }
});

test('hand damping removes string energy while preserving a decaying body tail', () => {
  const rate = 48000;
  const samples = renderPhysicalKotoNote({ frequency: 392, velocity: 0.7, dampAt: 0.4, duration: 1.2, seed: 275 });
  const before = rmsOf(samples.subarray(0.30 * rate, 0.40 * rate));
  const after = rmsOf(samples.subarray(0.60 * rate, 0.70 * rate));
  assert.ok(20 * Math.log10(after / before) < -24);
  assert.ok(samples.subarray(0.41 * rate, 0.42 * rate).some(value => value !== 0));
  assert.ok(samples.at(-1) === 0);
});

test('the matched-pole hand-damping ramp does not create energy at fixed tension', () => {
  for (const frequency of [196, 392, 880]) for (const dampAt of [0, 0.12, 0.4]) {
    const diagnostics = {};
    const samples = renderPhysicalKotoNote({ frequency, velocity: 1, dampAt, duration: 0.8, seed: 275, diagnostics });
    assert.ok(samples.every(Number.isFinite));
    assert.ok(diagnostics.maximumRelativeEnergyRise <= 1e-10);
  }
});

test('rate and maximum-pressure boundaries stay finite and seed repetition is reproducible', () => {
  for (const sampleRate of [24000, 48000, 96000]) for (const frequency of [196, 880, 2000]) {
    const samples = renderPhysicalKotoNote({ frequency, velocity: 1, pressSemitones: 3,
      dampAt: 0.12, duration: 0.25, seed: 275 }, sampleRate);
    assert.ok(samples.every(Number.isFinite));
    assert.ok(samples[0] === 0 && samples.at(-1) === 0);
  }
  const note = { frequency: 392, velocity: 0.7, duration: 0.1, seed: 275 };
  const first = renderPhysicalKotoNote(note);
  assert.deepEqual(first, renderPhysicalKotoNote(note));
  assert.notDeepEqual(first, renderPhysicalKotoNote({ ...note, seed: 276 }));
  const diagnostics = {};
  assert.ok(renderPhysicalKotoNote({ ...note, velocity: 0, diagnostics }).every(value => value === 0));
  assert.equal(diagnostics.initialEnergyJ, 0);
});

test('invalid physical inputs are rejected before allocating the waveform', () => {
  const note = { frequency: 392, velocity: 0.7, duration: 0.1 };
  for (const invalid of [{ frequency: NaN }, { frequency: 0 }, { velocity: Infinity },
    { velocity: -1 }, { duration: 31 }, { pressSemitones: 4 }, { dampAt: -1 },
    { pluckPosition: 0.001 }, { seed: NaN }]) {
    assert.throws(() => renderPhysicalKotoNote({ ...note, ...invalid }), RangeError);
  }
  assert.throws(() => renderPhysicalKotoNote(note, 0), RangeError);
});
