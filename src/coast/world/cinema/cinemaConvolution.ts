/** Full measured HRIRs, partitioned without adding a render-quantum delay. */
export const CINEMA_CONVOLUTION_HOP = 128;
const FFT_SIZE = CINEMA_CONVOLUTION_HOP * 2;
const FREQUENCIES = FFT_SIZE / 2 + 1;
const HRIR_TAPS = 144;
const MAX_PROPAGATION_TAPS = 512;
const DIRECTIONS = 60;
// Includes the longest supported absolute propagation path, HRIR and interpolation.
export const CINEMA_CONVOLUTION_MAX_DELAY = 24_000;

function fftKernel(re: Float64Array, im: Float64Array, inverse: boolean,
  reverse: Uint16Array, cosine: Float64Array, sine: Float64Array): void {
  const size = re.length;
  for (let i = 0; i < size; i += 1) {
    const j = reverse[i];
    if (j <= i) continue;
    let value = re[i]; re[i] = re[j]; re[j] = value;
    value = im[i]; im[i] = im[j]; im[j] = value;
  }
  for (let length = 2; length <= size; length *= 2) {
    const half = length / 2;
    const step = size / length;
    for (let base = 0; base < size; base += length) {
      for (let i = 0; i < half; i += 1) {
        const phase = i * step;
        const c = cosine[phase];
        const s = inverse ? sine[phase] : -sine[phase];
        const a = base + i, b = a + half;
        const real = re[b] * c - im[b] * s;
        const imaginary = re[b] * s + im[b] * c;
        re[b] = re[a] - real; im[b] = im[a] - imaginary;
        re[a] += real; im[a] += imaginary;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < size; i += 1) { re[i] /= size; im[i] /= size; }
  }
}

function fftPlan(size = FFT_SIZE) {
  const reverse = new Uint16Array(size);
  const cosine = new Float64Array(size / 2);
  const sine = new Float64Array(size / 2);
  const bits = Math.log2(size);
  for (let i = 0; i < size; i += 1) {
    let from = i, to = 0;
    for (let bit = 0; bit < bits; bit += 1) { to = to * 2 + (from & 1); from >>= 1; }
    reverse[i] = to;
  }
  for (let i = 0; i < size / 2; i += 1) {
    cosine[i] = Math.cos(2 * Math.PI * i / size);
    sine[i] = Math.sin(2 * Math.PI * i / size);
  }
  return { reverse, cosine, sine };
}

export interface CinemaConvolutionPath {
  readonly speaker: number;
  readonly delaySamples: number;
  readonly direction: number;
  readonly gain: number;
  readonly send: number;
  /** Immutable control-thread causal propagation FIR, before the complete HRIR. */
  readonly filter?: Float32Array;
}

export interface CinemaConvolutionPacket {
  readonly kernelId?: number;
  readonly speakers: Uint16Array;
  readonly lags: Uint16Array;
  /** Per-partition dry and diffuse gains; the HRIR itself is never normalized. */
  readonly gains: Float32Array;
  /** Partition-major, ear-major, frequency-major, complex real/imaginary. */
  readonly kernels: Float32Array;
  /** Exact causal partitions for short render quanta and partial queue tails. */
  readonly timeKernels: Float32Array;
}

export function cinemaConvolutionPartitionCount(path: CinemaConvolutionPath): number {
  return Math.ceil(((Math.floor(path.delaySamples) % CINEMA_CONVOLUTION_HOP)
    + HRIR_TAPS + (path.filter?.length ?? 1)) / CINEMA_CONVOLUTION_HOP);
}

/** Runs on the control thread, never inside AudioWorkletProcessor.process(). */
export function createCinemaConvolutionPreparer(hrtf: Float32Array) {
  if (hrtf.length !== DIRECTIONS * HRIR_TAPS * 2) throw new RangeError('Invalid cinema HRIR table');
  const plan = fftPlan();
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  // A bounded bank avoids recomputing unchanged distance/HRIR pairs during head turns.
  const cache = new Map<string, { frequency: Float32Array; time: Float32Array }>();
  let filterBank = new WeakMap<Float32Array, { id: number; size: number; re: Float64Array; im: Float64Array; coefficients: Float32Array }>();
  const hrirBank = new Map<string, { re: Float64Array; im: Float64Array }>();
  const largerPlans = new Map<number, ReturnType<typeof fftPlan>>();
  let filterSequence = 0;
  function spectralFilter(filter: Float32Array) {
    let stored = filterBank.get(filter);
    if (stored) {
      if (filter.length !== stored.coefficients.length || filter.some((value, i) => value !== stored!.coefficients[i])) {
        throw new RangeError('Cinema propagation FIR was mutated');
      }
      return stored;
    }
    if (filter.length < 1 || filter.length > MAX_PROPAGATION_TAPS || filter.some(value => !Number.isFinite(value))) {
      throw new RangeError('Invalid cinema propagation FIR');
    }
    const size = 2 ** Math.ceil(Math.log2(filter.length + HRIR_TAPS - 1));
    let larger = largerPlans.get(size);
    if (!larger) { larger = fftPlan(size); largerPlans.set(size, larger); }
    const real = new Float64Array(size), imaginary = new Float64Array(size);
    real.set(filter);
    fftKernel(real, imaginary, false, larger.reverse, larger.cosine, larger.sine);
    stored = { id: ++filterSequence, size, re: real, im: imaginary, coefficients: filter.slice() };
    filterBank.set(filter, stored);
    return stored;
  }
  function combinedImpulses(direction: number, transfer: ReturnType<typeof spectralFilter>) {
    const size = transfer.size;
    const larger = largerPlans.get(size)!;
    const spectra = [0, 1].map(ear => {
      const key = `${size}:${direction}:${ear}`;
      let hrir = hrirBank.get(key);
      if (!hrir) {
        hrir = { re: new Float64Array(size), im: new Float64Array(size) };
        for (let tap = 0; tap < HRIR_TAPS; tap += 1) hrir.re[tap] = hrtf[(direction * HRIR_TAPS + tap) * 2 + ear];
        fftKernel(hrir.re, hrir.im, false, larger.reverse, larger.cosine, larger.sine);
        hrirBank.set(key, hrir);
      }
      return hrir;
    });
    const real = new Float64Array(size), imaginary = new Float64Array(size);
    for (let i = 0; i < size; i += 1) {
      const leftRe = spectra[0].re[i] * transfer.re[i] - spectra[0].im[i] * transfer.im[i];
      const leftIm = spectra[0].re[i] * transfer.im[i] + spectra[0].im[i] * transfer.re[i];
      const rightRe = spectra[1].re[i] * transfer.re[i] - spectra[1].im[i] * transfer.im[i];
      const rightIm = spectra[1].re[i] * transfer.im[i] + spectra[1].im[i] * transfer.re[i];
      real[i] = leftRe - rightIm; imaginary[i] = leftIm + rightRe;
    }
    // One complex inverse carries the two causal real ear responses.
    fftKernel(real, imaginary, true, larger.reverse, larger.cosine, larger.sine);
    return [real, imaginary];
  }
  const prepare = (paths: readonly CinemaConvolutionPath[]): CinemaConvolutionPacket => {
    const accepted = paths.filter(path => Number.isInteger(path.speaker) && path.speaker >= 0 && path.speaker < 57
      && Number.isFinite(path.delaySamples) && path.delaySamples >= 0
      && path.delaySamples <= CINEMA_CONVOLUTION_MAX_DELAY && Number.isFinite(path.direction)
      && Number.isFinite(path.gain) && Number.isFinite(path.send));
    if (accepted.length !== paths.length || paths.length > 105) throw new RangeError('Invalid cinema propagation path');
    const spectra = accepted.map(path => path.filter ? spectralFilter(path.filter) : undefined);
    const count = accepted.reduce((sum, path) => sum + cinemaConvolutionPartitionCount(path), 0);
    const speakers = new Uint16Array(count);
    const lags = new Uint16Array(count);
    const gains = new Float32Array(count * 2);
    const kernels = new Float32Array(count * 2 * FREQUENCIES * 2);
    const timeKernels = new Float32Array(count * 2 * CINEMA_CONVOLUTION_HOP);
    let partition = 0, pathIndex = 0;
    for (const path of accepted) {
      const transfer = spectra[pathIndex++];
      const delay = Math.floor(path.delaySamples);
      const residual = delay % CINEMA_CONVOLUTION_HOP;
      const fraction = path.delaySamples - delay;
      const taps = HRIR_TAPS + (path.filter?.length ?? 1) - 1;
      const parts = cinemaConvolutionPartitionCount(path);
      const direction = Math.max(0, Math.min(DIRECTIONS - 1, Math.trunc(path.direction)));
      const filterId = transfer?.id ?? 0;
      const key = `${direction}:${residual}:${fraction}:${filterId}`;
      let bank = cache.get(key);
      if (!bank) {
        bank = { frequency: new Float32Array(parts * 2 * FREQUENCIES * 2),
          time: new Float32Array(parts * 2 * CINEMA_CONVOLUTION_HOP) };
        const combined = transfer ? combinedImpulses(direction, transfer) : undefined;
        for (let part = 0; part < parts; part += 1) {
          re.fill(0); im.fill(0);
          for (let tap = 0; tap < taps; tap += 1) {
            const index = residual + tap - part * CINEMA_CONVOLUTION_HOP;
            const left = combined ? combined[0][tap] : hrtf[(direction * HRIR_TAPS + tap) * 2];
            const right = combined ? combined[1][tap] : hrtf[(direction * HRIR_TAPS + tap) * 2 + 1];
            if (index >= 0 && index < CINEMA_CONVOLUTION_HOP) {
              re[index] += left * (1 - fraction); im[index] += right * (1 - fraction);
            }
            if (index + 1 >= 0 && index + 1 < CINEMA_CONVOLUTION_HOP) {
              re[index + 1] += left * fraction; im[index + 1] += right * fraction;
            }
          }
          for (let i = 0; i < CINEMA_CONVOLUTION_HOP; i += 1) {
            bank.time[part * 2 * CINEMA_CONVOLUTION_HOP + i] = re[i];
            bank.time[(part * 2 + 1) * CINEMA_CONVOLUTION_HOP + i] = im[i];
          }
          // Pack two real partitions into one complex FFT, then separate spectra.
          fftKernel(re, im, false, plan.reverse, plan.cosine, plan.sine);
          const leftBase = part * 2 * FREQUENCIES * 2, rightBase = leftBase + FREQUENCIES * 2;
          for (let bin = 0; bin < FREQUENCIES; bin += 1) {
            const mirror = (FFT_SIZE - bin) & (FFT_SIZE - 1);
            bank.frequency[leftBase + bin * 2] = (re[bin] + re[mirror]) * .5;
            bank.frequency[leftBase + bin * 2 + 1] = (im[bin] - im[mirror]) * .5;
            bank.frequency[rightBase + bin * 2] = (im[bin] + im[mirror]) * .5;
            bank.frequency[rightBase + bin * 2 + 1] = (re[mirror] - re[bin]) * .5;
          }
        }
        if (cache.size >= 512) cache.delete(cache.keys().next().value!);
        cache.set(key, bank);
      }
      kernels.set(bank.frequency, partition * 2 * FREQUENCIES * 2);
      timeKernels.set(bank.time, partition * 2 * CINEMA_CONVOLUTION_HOP);
      for (let part = 0; part < parts; part += 1) {
        speakers[partition] = path.speaker;
        lags[partition] = Math.floor(delay / CINEMA_CONVOLUTION_HOP) + part;
        gains[partition * 2] = path.gain;
        gains[partition * 2 + 1] = path.send;
        partition += 1;
      }
    }
    return { speakers, lags, gains, kernels, timeKernels };
  };
  return Object.assign(prepare, { assertImmutable: (paths: readonly CinemaConvolutionPath[]) => {
    for (const path of paths) if (path.filter) spectralFilter(path.filter);
  }, clear: () => { cache.clear(); hrirBank.clear(); largerPlans.clear(); filterBank = new WeakMap(); filterSequence = 0; } });
}

export function prepareCinemaConvolution(hrtf: Float32Array,
  paths: readonly CinemaConvolutionPath[]): CinemaConvolutionPacket {
  return createCinemaConvolutionPreparer(hrtf)(paths);
}

export function decodeCinemaHrir(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength !== DIRECTIONS * HRIR_TAPS * 4) throw new RangeError('Invalid cinema HRIR bytes');
  const view = new DataView(buffer);
  const values = new Float32Array(DIRECTIONS * HRIR_TAPS * 2);
  for (let i = 0; i < values.length; i += 1) values[i] = view.getInt16(i * 2, true) / 32768;
  return values;
}

// fftKernel has no captured state. Binding its runtime source under a fixed local
// name keeps this valid after TypeScript compilation and bundler symbol renaming.
export const CINEMA_CONVOLUTION_PROCESSOR_SOURCE = `
const cinemaFft = (${fftKernel.toString()});
const CONV_HOP = 128;
const CONV_SIZE = 256;
const CONV_BINS = 129;
const CONV_HISTORY = 256;
const CONV_MAX_LAG = Math.floor((24000 + 144 + 512 - 1) / CONV_HOP);
const CONV_FADE_SAMPLES = 720;
class CinemaPartitionedConvolver {
  constructor(speakers) {
    this.reverse = new Uint16Array(CONV_SIZE);
    this.cosine = new Float64Array(CONV_SIZE / 2);
    this.sine = new Float64Array(CONV_SIZE / 2);
    for (let i = 0; i < CONV_SIZE; i++) {
      let from = i, to = 0;
      for (let bit = 0; bit < 8; bit++) { to = to * 2 + (from & 1); from >>= 1; }
      this.reverse[i] = to;
    }
    for (let i = 0; i < CONV_SIZE / 2; i++) {
      this.cosine[i] = Math.cos(2 * Math.PI * i / CONV_SIZE);
      this.sine[i] = Math.sin(2 * Math.PI * i / CONV_SIZE);
    }
    this.tags = Array.from({ length: speakers }, () => new Float64Array(CONV_HISTORY).fill(-1));
    this.history = Array.from({ length: speakers }, () =>
      new Float32Array(CONV_HISTORY * CONV_BINS * 2));
    this.re = new Float64Array(CONV_SIZE);
    this.im = new Float64Array(CONV_SIZE);
    this.real = Array.from({ length: 3 }, () => new Float64Array(CONV_SIZE));
    this.imaginary = Array.from({ length: 3 }, () => new Float64Array(CONV_SIZE));
    this.currentOutput = Array.from({ length: 3 }, () => new Float64Array(CONV_HOP));
    this.previousOutput = Array.from({ length: 3 }, () => new Float64Array(CONV_HOP));
    this.current = null;
    this.previous = null;
    this.pending = null;
    this.fade = CONV_FADE_SAMPLES;
    this.latestKernelId = 0;
    this.latestBankStateId = 0;
    this.latestBankState = null;
  }
  setPacket(packet) {
    if (!packet) return;
    if (packet.banks) {
      if (packet.banks.length > 105 || packet.gains.length !== packet.banks.length * 2) return;
    } else if (!packet.speakers || packet.speakers.length > 735
      || packet.lags.length !== packet.speakers.length
      || packet.gains.length !== packet.speakers.length * 2
      || packet.kernels.length !== packet.speakers.length * 2 * CONV_BINS * 2
      || !packet.timeKernels || packet.timeKernels.length !== packet.speakers.length * 2 * CONV_HOP) return;
    if (Number.isInteger(packet.kernelId)) {
      if (packet.kernelId < this.latestKernelId) return;
      this.latestKernelId = packet.kernelId;
    }
    if (this.previous) { this.pending = packet; return; }
    this.previous = this.current;
    this.current = packet;
    this.fade = this.previous ? 0 : CONV_FADE_SAMPLES;
  }
  setBankState(data) {
    const count = data.pathCount;
    if (!Number.isSafeInteger(data.stateId) || data.stateId <= this.latestBankStateId || data.stateId <= this.latestKernelId
      || !Number.isInteger(count) || count < 0 || count > 105
      || !(data.gains instanceof Float32Array) || data.gains.length !== count * 2
      || data.gains.some(value => !Number.isFinite(value))
      || !Array.isArray(data.updates) || data.updates.length > count) return false;
    const full = data.baseStateId === null;
    if (!full && (!this.latestBankState || data.baseStateId !== this.latestBankStateId
      || this.latestBankState.banks.length !== count)) return false;
    const banks = full ? new Array(count) : this.latestBankState.banks.slice();
    const seen = new Uint8Array(count);
    for (const update of data.updates) {
      const index = update.index, bank = update.bank;
      if (!Number.isInteger(index) || index < 0 || index >= count || seen[index] || !bank
        || !Number.isInteger(bank.speaker) || bank.speaker < 0 || bank.speaker >= this.tags.length
        || !(bank.lags instanceof Uint16Array) || bank.lags.length < 1 || bank.lags.length > 7
        || bank.lags.some(lag => lag > CONV_MAX_LAG)
        || !(bank.kernels instanceof Float32Array) || bank.kernels.length !== bank.lags.length * 2 * CONV_BINS * 2
        || !(bank.timeKernels instanceof Float32Array) || bank.timeKernels.length !== bank.lags.length * 2 * CONV_HOP) return false;
      seen[index] = 1; banks[index] = bank;
    }
    if (full && seen.some(value => value === 0)) return false;
    const state = { kernelId: data.stateId, banks, gains: data.gains };
    this.latestBankState = state; this.latestBankStateId = data.stateId;
    this.setPacket(state);
    return true;
  }
  setGains(kernelId, gains) {
    const base = this.pending && this.pending.kernelId === kernelId ? this.pending
      : this.current && this.current.kernelId === kernelId ? this.current : null;
    if (!Number.isInteger(kernelId) || kernelId !== this.latestKernelId || !base || base.banks || !gains
      || gains.length !== base.gains.length || gains.some(value => !Number.isFinite(value))) return;
    // Legacy flat packets only. Bank states, including gain-only updates, use setBankState.
    // A new state enters exactly the same fade/pending timeline as a full packet.
    this.setPacket({ kernelId, speakers: base.speakers, lags: base.lags, gains,
      kernels: base.kernels, timeKernels: base.timeKernels });
  }
  reset() {
    for (let i = 0; i < this.tags.length; i++) this.tags[i].fill(-1);
    this.previous = null;
    if (this.pending) this.current = this.pending;
    this.pending = null;
    this.fade = CONV_FADE_SAMPLES;
  }
  analyze(speaker, lag, rings, write, end) {
    const at = end - lag * CONV_HOP;
    const slot = ((Math.floor(at / CONV_HOP) % CONV_HISTORY) + CONV_HISTORY) % CONV_HISTORY;
    const offset = slot * CONV_BINS * 2;
    if (this.tags[speaker][slot] === at) return offset;
    const first = speaker & ~1, mate = first + 1;
    if (mate < rings.length && mate < this.tags.length) {
      const leftRing = rings[first], rightRing = rings[mate];
      for (let i = 0; i < CONV_SIZE; i++) {
        const sample = at - CONV_SIZE + i;
        const index = write - lag * CONV_HOP - CONV_SIZE + i;
        this.re[i] = sample < 0 ? 0 : leftRing[index & (leftRing.length - 1)];
        this.im[i] = sample < 0 ? 0 : rightRing[index & (rightRing.length - 1)];
      }
      cinemaFft(this.re, this.im, false, this.reverse, this.cosine, this.sine);
      const left = this.history[first], right = this.history[mate];
      for (let bin = 0; bin < CONV_BINS; bin++) {
        const mirror = (CONV_SIZE - bin) & (CONV_SIZE - 1);
        left[offset + bin * 2] = (this.re[bin] + this.re[mirror]) * .5;
        left[offset + bin * 2 + 1] = (this.im[bin] - this.im[mirror]) * .5;
        right[offset + bin * 2] = (this.im[bin] + this.im[mirror]) * .5;
        right[offset + bin * 2 + 1] = (this.re[mirror] - this.re[bin]) * .5;
      }
      this.tags[first][slot] = at; this.tags[mate][slot] = at;
      return offset;
    }
    // An unpaired final speaker retains the original single-real transform.
    const ring = rings[speaker];
    for (let i = 0; i < CONV_SIZE; i++) {
      const sample = at - CONV_SIZE + i;
      this.re[i] = sample < 0 ? 0 : ring[(write - lag * CONV_HOP - CONV_SIZE + i) & (ring.length - 1)];
      this.im[i] = 0;
    }
    cinemaFft(this.re, this.im, false, this.reverse, this.cosine, this.sine);
    const history = this.history[speaker];
    for (let bin = 0; bin < CONV_BINS; bin++) {
      history[offset + bin * 2] = this.re[bin]; history[offset + bin * 2 + 1] = this.im[bin];
    }
    this.tags[speaker][slot] = at;
    return offset;
  }
  evaluate(packet, rings, write, end, output) {
    for (let channel = 0; channel < 3; channel++) {
      this.real[channel].fill(0); this.imaginary[channel].fill(0);
    }
    const left = this.real[0], leftIm = this.imaginary[0];
    const right = this.real[1], rightIm = this.imaginary[1];
    const send = this.real[2], sendIm = this.imaginary[2];
    if (packet.banks) {
      for (let index = 0; index < packet.banks.length; index++) {
        this.accumulateBank(packet.banks[index], packet.gains[index * 2], packet.gains[index * 2 + 1] * .5,
          rings, write, end);
      }
    } else for (let part = 0; part < packet.speakers.length; part++) {
      const speaker = packet.speakers[part];
      if (speaker >= rings.length) continue;
      const lag = packet.lags[part];
      if (end - lag * CONV_HOP <= 0) continue;
      const offset = this.analyze(speaker, lag, rings, write, end);
      const history = this.history[speaker];
      const leftBase = part * 2 * CONV_BINS * 2;
      const rightBase = leftBase + CONV_BINS * 2;
      const gain = packet.gains[part * 2], wet = packet.gains[part * 2 + 1] * .5;
      for (let bin = 0; bin < CONV_BINS; bin++) {
        const at = bin * 2;
        const xr = history[offset + at], xi = history[offset + at + 1];
        const lr = packet.kernels[leftBase + at], li = packet.kernels[leftBase + at + 1];
        const rr = packet.kernels[rightBase + at], ri = packet.kernels[rightBase + at + 1];
        const l = xr * lr - xi * li, lim = xr * li + xi * lr;
        const r = xr * rr - xi * ri, rim = xr * ri + xi * rr;
        left[bin] += l * gain; leftIm[bin] += lim * gain;
        right[bin] += r * gain; rightIm[bin] += rim * gain;
        send[bin] += (l + r) * wet; sendIm[bin] += (lim + rim) * wet;
      }
    }
    // Two real output spectra share one complex inverse; keep send independent.
    for (let bin = 0; bin < CONV_BINS; bin++) {
      const lr = left[bin], li = leftIm[bin], rr = right[bin], ri = rightIm[bin];
      left[bin] = lr - ri; leftIm[bin] = li + rr;
      if (bin > 0 && bin < CONV_BINS - 1) {
        left[CONV_SIZE - bin] = lr + ri;
        leftIm[CONV_SIZE - bin] = -li + rr;
      }
    }
    cinemaFft(left, leftIm, true, this.reverse, this.cosine, this.sine);
    for (let bin = 1; bin < CONV_BINS - 1; bin++) {
      send[CONV_SIZE - bin] = send[bin]; sendIm[CONV_SIZE - bin] = -sendIm[bin];
    }
    cinemaFft(send, sendIm, true, this.reverse, this.cosine, this.sine);
    for (let i = 0; i < CONV_HOP; i++) {
      output[0][i] = left[CONV_HOP + i]; output[1][i] = leftIm[CONV_HOP + i];
      output[2][i] = send[CONV_HOP + i];
    }
  }
  accumulateBank(bank, gain, wet, rings, write, end) {
    if (bank.speaker >= rings.length) return;
    const speaker = bank.speaker, history = this.history[speaker];
    const left = this.real[0], leftIm = this.imaginary[0];
    const right = this.real[1], rightIm = this.imaginary[1];
    const send = this.real[2], sendIm = this.imaginary[2];
    for (let part = 0; part < bank.lags.length; part++) {
      const lag = bank.lags[part];
      if (end - lag * CONV_HOP <= 0) continue;
      const offset = this.analyze(speaker, lag, rings, write, end);
      const leftBase = part * 2 * CONV_BINS * 2, rightBase = leftBase + CONV_BINS * 2;
      for (let bin = 0; bin < CONV_BINS; bin++) {
        const at = bin * 2, xr = history[offset + at], xi = history[offset + at + 1];
        const lr = bank.kernels[leftBase + at], li = bank.kernels[leftBase + at + 1];
        const rr = bank.kernels[rightBase + at], ri = bank.kernels[rightBase + at + 1];
        const l = xr * lr - xi * li, lim = xr * li + xi * lr;
        const r = xr * rr - xi * ri, rim = xr * ri + xi * rr;
        left[bin] += l * gain; leftIm[bin] += lim * gain;
        right[bin] += r * gain; rightIm[bin] += rim * gain;
        send[bin] += (l + r) * wet; sendIm[bin] += (lim + rim) * wet;
      }
    }
  }
  accumulateBankShort(bank, gain, wet, rings, write, count, output) {
    if (bank.speaker >= rings.length) return;
    const ring = rings[bank.speaker], mask = ring.length - 1;
    for (let part = 0; part < bank.lags.length; part++) {
      const delay = bank.lags[part] * CONV_HOP, base = part * 2 * CONV_HOP;
      for (let frame = 0; frame < count; frame++) {
        const at = write - count + frame - delay;
        let left = 0, right = 0;
        for (let tap = 0; tap < CONV_HOP; tap++) {
          const sample = ring[(at - tap) & mask];
          left += sample * bank.timeKernels[base + tap];
          right += sample * bank.timeKernels[base + CONV_HOP + tap];
        }
        output[0][frame] += left * gain; output[1][frame] += right * gain;
        output[2][frame] += (left + right) * wet;
      }
    }
  }
  evaluateShort(packet, rings, write, count, output) {
    for (let channel = 0; channel < 3; channel++) output[channel].fill(0);
    if (packet.banks) {
      for (let index = 0; index < packet.banks.length; index++) {
        this.accumulateBankShort(packet.banks[index], packet.gains[index * 2], packet.gains[index * 2 + 1] * .5,
          rings, write, count, output);
      }
      return;
    }
    for (let part = 0; part < packet.speakers.length; part++) {
      const speaker = packet.speakers[part];
      if (speaker >= rings.length) continue;
      const ring = rings[speaker], mask = ring.length - 1;
      const delay = packet.lags[part] * CONV_HOP;
      const base = part * 2 * CONV_HOP;
      const gain = packet.gains[part * 2], wet = packet.gains[part * 2 + 1] * .5;
      for (let frame = 0; frame < count; frame++) {
        const at = write - count + frame - delay;
        let left = 0, right = 0;
        for (let tap = 0; tap < CONV_HOP; tap++) {
          const sample = ring[(at - tap) & mask];
          left += sample * packet.timeKernels[base + tap];
          right += sample * packet.timeKernels[base + CONV_HOP + tap];
        }
        output[0][frame] += left * gain; output[1][frame] += right * gain;
        output[2][frame] += (left + right) * wet;
      }
    }
  }
  render(rings, write, end, count = CONV_HOP) {
    if (count === CONV_HOP) this.evaluate(this.current, rings, write, end, this.currentOutput);
    else this.evaluateShort(this.current, rings, write, count, this.currentOutput);
    if (!this.previous) return this.currentOutput;
    if (count === CONV_HOP) this.evaluate(this.previous, rings, write, end, this.previousOutput);
    else this.evaluateShort(this.previous, rings, write, count, this.previousOutput);
    for (let i = 0; i < count; i++) {
      const mix = Math.min(1, this.fade / CONV_FADE_SAMPLES);
      for (let channel = 0; channel < 3; channel++) {
        this.currentOutput[channel][i] = this.previousOutput[channel][i] * (1 - mix)
          + this.currentOutput[channel][i] * mix;
      }
      this.fade++;
    }
    if (this.fade >= CONV_FADE_SAMPLES) {
      this.previous = null;
      if (this.pending) { const pending = this.pending; this.pending = null; this.setPacket(pending); }
    }
    return this.currentOutput;
  }
}
`;
