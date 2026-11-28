import { CINEMA_CONVOLUTION_PROCESSOR_SOURCE } from './cinemaConvolution';
import { CINEMA_ROUTING_PACKET_PROCESSOR_SOURCE } from './cinemaRoutingPacket';

/**
 * Source for the cinema room AudioWorklet.
 *
 * The worklet deliberately owns the playback clock.  Messages only contain
 * PCM blocks and immutable routing/spatial snapshots; the render callback does
 * not allocate, sort, or wait for the main thread.
 */
export const CINEMA_ROOM_PROCESSOR_SOURCE = String.raw`
${CINEMA_CONVOLUTION_PROCESSOR_SOURCE}
${CINEMA_ROUTING_PACKET_PROCESSOR_SOURCE}
const SAMPLE_RATE = 48000;
const RING_LENGTH = 32768;
const RING_MASK = RING_LENGTH - 1;
// [leftDelay, rightDelay, fallbackLeft, fallbackRight, reflectionSend,
//  distanceGain, KEMAR direction index].
const SPATIAL_STRIDE = 7;
const STATUS_INTERVAL = 1024;
const HRTF_DIRECTION_COUNT = 60;
const HRTF_TAP_COUNT = 144;
// Preserve the complete measured head response. The independent room network
// models the room tail; it cannot replace omitted HRIR taps.
const HRTF_DIRECT_TAPS = 144;
const HRTF_REFLECTION_TAPS = 144;
const HRTF_SAMPLE_SCALE = 1 / 32768;
const MAX_REFLECTION_PATHS = 48;
const HRTF_REFLECTION_LIMIT = 48;
const SPATIAL_SETTLE_SAMPLES = 4096;
const EARLY_DELAYS = [317, 541, 809, 1151, 1613, 2203];
const EARLY_WEIGHTS = [0.18, 0.15, 0.12, 0.09, 0.065, 0.04];
const BAND_CUTOFFS = [125, 250, 500, 1000, 2000, 4000];
const BAND_ALPHAS = BAND_CUTOFFS.map(cutoff => 1 - Math.exp(-2 * Math.PI * cutoff / SAMPLE_RATE));
const BAND_MIX = [0.34, 0.27, 0.20, 0.13, 0.07, 0.035];
const BAND_DECAY = [0.99984, 0.99972, 0.99954, 0.99925, 0.99885, 0.99825];
const BASS_SEND_ALPHA = 1 - Math.exp(-2 * Math.PI * 80 / SAMPLE_RATE);
const LFE_LOW_PASS_ALPHA = 1 - Math.exp(-2 * Math.PI * 120 / SAMPLE_RATE);
const LATE_DELAYS = [1493, 1619, 1733, 1877, 1999, 2137, 2269, 2381,
  2539, 2671, 2797, 2917, 3061, 3191, 3319, 3467];
const LATE_LOW_DECAY = LATE_DELAYS.map(delay => 10 ** (-3 * delay / (SAMPLE_RATE * 1.12)));
const LATE_HIGH_DECAY = LATE_DELAYS.map(delay => 10 ** (-3 * delay / (SAMPLE_RATE * 0.65)));
const LATE_LOW_ALPHA = 1 - Math.exp(-2 * Math.PI * 1600 / SAMPLE_RATE);

function asFloat32Array(value) {
  if (value instanceof Float32Array) return value;
  if (value instanceof ArrayBuffer) return new Float32Array(value);
  return Float32Array.from(value || []);
}

function readRing(ring, write, delay) {
  const bounded = Math.max(0, Math.min(RING_LENGTH - 2, delay));
  const whole = Math.floor(bounded);
  const fraction = bounded - whole;
  const a = ring[(write - whole) & RING_MASK];
  const b = ring[(write - whole - 1) & RING_MASK];
  return a + (b - a) * fraction;
}

class CinemaRoomProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = options.processorOptions || {};
    this.speakerCount = settings.speakerCount | 0;
    this.inputCount = settings.inputCount | 0;
    this.kinds = Uint8Array.from(settings.kinds || []);
    this.lfeIndex = settings.lfeIndex | 0;
    this.lfeGain = Number.isFinite(settings.lfeGain) ? settings.lfeGain : 1;
    this.speakerRings = Array.from({ length: this.speakerCount }, () => new Float32Array(RING_LENGTH));
    this.lowpass = new Float32Array(this.speakerCount);
    this.lfeState = 0;
    this.speakerValues = new Float32Array(this.speakerCount);
    this.objectScales = new Float64Array(this.inputCount);
    this.renderedLeft = 0;
    this.renderedRight = 0;
    this.spatial = new Float32Array(this.speakerCount * SPATIAL_STRIDE);
    this.targetSpatial = new Float32Array(this.speakerCount * SPATIAL_STRIDE);
    this.hrtf = null;
    this.directKernels = new Float32Array(this.speakerCount * HRTF_DIRECT_TAPS * 2);
    this.reflectionKernels = new Float32Array(HRTF_REFLECTION_LIMIT * HRTF_REFLECTION_TAPS * 2);
    this.spatialRemaining = 0;
    this.reflectionCount = 0;
    this.reflectionSpeaker = new Uint16Array(MAX_REFLECTION_PATHS);
    this.reflectionDelay = new Float32Array(MAX_REFLECTION_PATHS);
    this.reflectionGain = new Float32Array(MAX_REFLECTION_PATHS);
    this.reflectionHighGain = new Float32Array(MAX_REFLECTION_PATHS);
    this.reflectionLeft = new Float32Array(MAX_REFLECTION_PATHS);
    this.reflectionRight = new Float32Array(MAX_REFLECTION_PATHS);
    this.reflectionDirection = new Uint16Array(MAX_REFLECTION_PATHS);
    this.hrtfLeft = 0;
    this.hrtfRight = 0;
    this.earlyRings = BAND_CUTOFFS.map(() => new Float32Array(RING_LENGTH));
    this.bandState = new Float32Array(BAND_CUTOFFS.length);
    this.lateRings = LATE_DELAYS.map(delay => new Float32Array(delay));
    this.lateIndex = new Uint32Array(LATE_DELAYS.length);
    this.lateDamp = new Float32Array(LATE_DELAYS.length);
    this.lateFeedback = new Float32Array(LATE_DELAYS.length);
    this.queue = [];
    this.queueHead = 0;
    this.playhead = 0;
    this.seekGeneration = 0;
    this.haveClock = false;
    this.playing = false;
    this.disposed = false;
    this.blockConsumed = false;
    this.underruns = 0;
    this.wasUnderrun = false;
    this.writeIndex = 0;
    this.writeTotal = 0;
    this.bankResyncSent = false;
    this.convolver = new CinemaPartitionedConvolver(this.speakerCount);
    this.renderedSinceStatus = 0;
    this.lastConsumedContextTime = 0;
    this.lastBlockFrames = 0;
    this.mixRangeError = false;
    this.port.onmessage = event => this.receive(event.data || {});
  }

  receive(data) {
    if (this.disposed) return;
    switch (data.type) {
      case 'enqueue':
        this.receiveEnqueue(data);
        break;
      case 'pose':
        this.receiveSpatial(data.spatial, data.reflections);
        break;
      case 'filters':
        this.convolver.setPacket(data.packet);
        break;
      case 'bank-state':
        if (this.convolver.setBankState(data)) this.bankResyncSent = false;
        else if (!this.bankResyncSent) {
          this.bankResyncSent = true;
          this.port.postMessage({ type: 'bank-resync', expectedStateId: this.convolver.latestBankStateId });
        }
        break;
      case 'filter-gains':
        this.convolver.setGains(data.kernelId, data.gains);
        break;
      case 'hrtf':
        this.receiveHrtf(data.buffer);
        break;
      case 'seek':
        this.receiveSeek(Number(data.sample), data.generation);
        break;
      case 'playing':
        this.playing = Boolean(data.active) && !this.mixRangeError;
        if (!this.playing) {
          this.blockConsumed = false;
          this.wasUnderrun = false;
        }
        this.postStatus(true);
        break;
      case 'dispose':
        this.disposed = true;
        this.queue = [];
        this.queueHead = 0;
        this.resetDsp();
        this.convolver.latestBankState = null;
        this.convolver.latestBankStateId = 0;
        this.convolver.current = null;
        this.convolver.previous = null;
        this.convolver.pending = null;
        this.playing = false;
        this.postStatus(true);
        this.port.onmessage = null;
        break;
      default:
        break;
    }
  }

  receiveEnqueue(data) {
    if (this.mixRangeError) return;
    const channels = (data.channels || []).map(asFloat32Array);
    const start = Math.trunc(Number(data.startSample));
    const frames = channels.length === 0 ? 0 : channels[0].length;
    if (frames <= 0) return;
    let packed = null, segments = [];
    if (data.packedRouting !== undefined) {
      if (channels.length === this.inputCount && channels.every(channel => channel.length === frames)
        && Number.isSafeInteger(start) && Number.isSafeInteger(start + frames)
        && data.routingSegments === undefined && data.objectInputStart === undefined && data.routing === undefined) {
        packed = decodeCinemaRoutingPacket(data.packedRouting, this.speakerCount, this.inputCount, frames);
      }
      if (!packed) {
        this.port.postMessage({ type: 'error', message: 'Invalid cinema packed routing' });
        return;
      }
    } else {
      const routeSegments = data.routingSegments || [{
        offset: 0,
        length: frames,
        start: data.routing,
        end: data.routing,
      }];
      const hasObjectDb = data.objectInputStart !== undefined
        || routeSegments.some(segment => segment.objectGainDbStart !== undefined || segment.objectGainDbEnd !== undefined);
      const objectStart = hasObjectDb ? data.objectInputStart : -1;
      const objectCount = hasObjectDb ? this.inputCount - objectStart : 0;
      if (hasObjectDb && (!Number.isInteger(objectStart) || objectStart < 0 || objectStart > this.inputCount || objectCount > 32
        || routeSegments.some(segment => !(segment.objectGainDbStart instanceof Float64Array)
          || !(segment.objectGainDbEnd instanceof Float64Array)
          || segment.objectGainDbStart.length !== objectCount || segment.objectGainDbEnd.length !== objectCount
          || segment.objectGainDbStart.some(value => !Number.isFinite(value))
          || segment.objectGainDbEnd.some(value => !Number.isFinite(value))))) {
        this.port.postMessage({ type: 'error', message: 'Invalid cinema object gain envelope' });
        return;
      }
      segments = routeSegments.map(segment => this.makeRouteSegment(
        asFloat32Array(segment.start), asFloat32Array(segment.end || segment.start),
        Math.max(1, Math.min(frames, Number(segment.length) || frames)), objectStart,
        segment.objectGainDbStart, segment.objectGainDbEnd,
      ));
    }
    const activeSpeakers = new Uint8Array(this.speakerCount);
    let fullRangeActive = false;
    for (let segmentIndex = 0; segmentIndex < (packed ? packed.segmentCount : segments.length); segmentIndex++) {
      const segment = packed || segments[segmentIndex], base = packed ? segmentIndex * (this.speakerCount + 1) : 0;
      for (let speaker = 0; speaker < this.speakerCount; speaker += 1) {
        if (segment.offsets[base + speaker] < segment.offsets[base + speaker + 1]) {
          activeSpeakers[speaker] = 1;
          if ((this.kinds[speaker] || 0) === 0) fullRangeActive = true;
        }
      }
    }
    if (fullRangeActive) {
      for (let speaker = 0; speaker < this.speakerCount; speaker += 1) {
        if ((this.kinds[speaker] || 0) !== 0) activeSpeakers[speaker] = 1;
      }
    }
    const chunk = {
      start,
      end: start + frames,
      channels,
      segments,
      packed,
      activeSpeakers,
      segmentHead: 0,
      segmentStart: 0,
    };
    if (!this.haveClock) {
      this.playhead = start;
      this.haveClock = true;
    }
    this.queue.push(chunk);
    this.queue.sort((a, b) => a.start - b.start);
    if (this.queueHead > 32) {
      this.queue.splice(0, this.queueHead);
      this.queueHead = 0;
    }
  }

  makeRouteSegment(start, end, length, objectInputStart = -1, objectGainDbStart, objectGainDbEnd) {
    const objectCount = objectInputStart >= 0 ? this.inputCount - objectInputStart : 0;
    const normStart = new Float64Array(objectCount), normEnd = new Float64Array(objectCount);
    const normDot = new Float64Array(objectCount);
    const offsets = new Uint32Array(this.speakerCount + 1);
    const indices = [];
    const startValues = [];
    const endValues = [];
    for (let speaker = 0; speaker < this.speakerCount; speaker += 1) {
      const base = speaker * this.inputCount;
      for (let channel = 0; channel < this.inputCount; channel += 1) {
        const startValue = Number.isFinite(start[base + channel]) ? start[base + channel] : 0;
        const endValue = Number.isFinite(end[base + channel]) ? end[base + channel] : 0;
        if (Math.abs(startValue) > 1e-6 || Math.abs(endValue) > 1e-6) {
          indices.push(channel);
          startValues.push(startValue);
          endValues.push(endValue);
          if (objectInputStart >= 0 && channel >= objectInputStart) {
            const object = channel - objectInputStart;
            normStart[object] += startValue * startValue;
            normEnd[object] += endValue * endValue;
            normDot[object] += startValue * endValue;
          }
        }
      }
      offsets[speaker + 1] = indices.length;
    }
    const constantAmplitude = new Float64Array(objectCount).fill(-1);
    const inverseNorm = new Float64Array(objectCount).fill(-1);
    for (let object = 0; object < objectCount; object++) {
      if (objectGainDbStart[object] === objectGainDbEnd[object]) {
        const amplitude = 10 ** (objectGainDbStart[object] / 20);
        constantAmplitude[object] = Number.isFinite(amplitude) ? amplitude : 0;
      }
      if (!(normStart[object] > 0 && normEnd[object] > 0)) inverseNorm[object] = 1;
      else if (normStart[object] === normEnd[object] && normStart[object] === normDot[object]) {
        inverseNorm[object] = 1 / Math.sqrt(normStart[object]);
      }
    }
    return {
      length,
      offsets,
      indices: Uint16Array.from(indices),
      startValues: Float32Array.from(startValues),
      endValues: Float32Array.from(endValues),
      objectInputStart, objectGainDbStart, objectGainDbEnd, normStart, normEnd, normDot, constantAmplitude, inverseNorm,
    };
  }

  receiveSpatial(value, reflections) {
    const spatial = asFloat32Array(value);
    for (let index = 0; index < this.targetSpatial.length; index += 1) {
      const next = spatial[index] || 0;
      if (next === this.targetSpatial[index]) continue;
      this.targetSpatial[index] = next;
      this.spatialRemaining = SPATIAL_SETTLE_SAMPLES;
    }
    const paths = Array.isArray(reflections) ? reflections : [];
    this.reflectionCount = Math.min(MAX_REFLECTION_PATHS, paths.length);
    for (let i = 0; i < this.reflectionCount; i += 1) {
      const path = paths[i] || {};
      this.reflectionSpeaker[i] = Math.max(0, Math.min(this.speakerCount - 1, Math.trunc(path.speaker || 0)));
      this.reflectionDelay[i] = Math.max(0, Number(path.delaySamples) || 0);
      this.reflectionGain[i] = Math.max(0, Number(path.gain) || 0);
      this.reflectionHighGain[i] = Math.max(0, Math.min(1, Number(path.highGain) || 0));
      this.reflectionLeft[i] = Number(path.leftGain) || 0;
      this.reflectionRight[i] = Number(path.rightGain) || 0;
      this.reflectionDirection[i] = Math.max(0, Math.min(HRTF_DIRECTION_COUNT - 1,
        Math.trunc(path.direction || 0)));
    }
  }

  receiveHrtf(value) {
    const bytes = value instanceof ArrayBuffer ? value : value && value.buffer;
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < HRTF_DIRECTION_COUNT * HRTF_TAP_COUNT * 4) return;
    const view = new DataView(bytes);
    const kernels = new Float32Array(HRTF_DIRECTION_COUNT * HRTF_TAP_COUNT * 2);
    for (let index = 0; index < kernels.length; index += 1) {
      kernels[index] = view.getInt16(index * 2, true) * HRTF_SAMPLE_SCALE;
    }
    this.hrtf = kernels;
  }

  receiveSeek(sample, generation) {
    this.playhead = Number.isFinite(sample) ? Math.trunc(sample) : 0;
    this.seekGeneration = Number.isInteger(generation) ? generation : this.seekGeneration + 1;
    this.haveClock = true;
    this.playing = false;
    this.blockConsumed = false;
    this.queue = [];
    this.queueHead = 0;
    this.wasUnderrun = false;
    this.mixRangeError = false;
    this.lastConsumedContextTime = typeof currentTime === 'number' ? currentTime : 0;
    this.resetDsp();
    this.postStatus(true);
  }

  resetDsp() {
    this.writeIndex = 0;
    this.writeTotal = 0;
    this.convolver.reset();
    this.lowpass.fill(0);
    this.speakerValues.fill(0);
    this.objectScales.fill(0);
    this.bandState.fill(0);
    this.lateIndex.fill(0);
    this.lateDamp.fill(0);
    for (const ring of this.speakerRings) ring.fill(0);
    for (const ring of this.earlyRings) ring.fill(0);
    for (const ring of this.lateRings) ring.fill(0);
    this.lfeState = 0;
  }

  smoothSpatial() {
    if (this.spatialRemaining === 0) return;
    for (let i = 0; i < this.spatial.length; i += 1) {
      this.spatial[i] += (this.targetSpatial[i] - this.spatial[i]) * 0.002;
    }
    if (--this.spatialRemaining === 0) this.spatial.set(this.targetSpatial);
  }

  smoothSpatialQuantum(frames) {
    if (this.spatialRemaining === 0) return;
    const amount = 1 - Math.pow(.998, frames);
    for (let i = 0; i < this.spatial.length; i++) {
      this.spatial[i] += (this.targetSpatial[i] - this.spatial[i]) * amount;
    }
    this.spatialRemaining = Math.max(0, this.spatialRemaining - frames);
    if (this.spatialRemaining === 0) this.spatial.set(this.targetSpatial);
  }

  updateKernels(frames) {
    const amount = 1 - Math.exp(-frames / (SAMPLE_RATE * 0.015));
    for (let speaker = 0; speaker < this.speakerCount; speaker += 1) {
      this.blendKernel(this.directKernels, speaker * HRTF_DIRECT_TAPS * 2, HRTF_DIRECT_TAPS,
        this.targetSpatial[speaker * SPATIAL_STRIDE + 6], amount);
    }
    const measuredPaths = Math.min(this.reflectionCount, HRTF_REFLECTION_LIMIT);
    for (let path = 0; path < measuredPaths; path += 1) {
      this.blendKernel(this.reflectionKernels, path * HRTF_REFLECTION_TAPS * 2, HRTF_REFLECTION_TAPS,
        this.reflectionDirection[path], amount);
    }
  }

  blendKernel(kernels, start, taps, direction, amount) {
    // The table index is a lookup, so interpolate the filter coefficients.
    // Interpolating the index could cross the table's elevation and azimuth boundaries.
    const source = Math.max(0, Math.min(HRTF_DIRECTION_COUNT - 1, direction | 0)) * HRTF_TAP_COUNT * 2;
    for (let i = 0; i < taps * 2; i += 1) {
      const index = start + i;
      kernels[index] += (this.hrtf[source + i] - kernels[index]) * amount;
    }
  }

  currentChunk() {
    while (this.queueHead < this.queue.length && this.playhead >= this.queue[this.queueHead].end) {
      this.queueHead += 1;
    }
    const chunk = this.queue[this.queueHead];
    if (!chunk || this.playhead < chunk.start) return null;
    return chunk;
  }

  sampleFromChunk(chunk) {
    if (!chunk || this.mixRangeError) return;
    const offset = this.playhead - chunk.start;
    if (offset < 0 || offset >= chunk.end - chunk.start) return;
    let segmentIndex = chunk.segmentHead || 0, segmentStart = chunk.segmentStart || 0;
    if (offset < segmentStart) { segmentIndex = 0; segmentStart = 0; }
    const packed = chunk.packed, segmentCount = packed ? packed.segmentCount : chunk.segments.length;
    while (segmentIndex + 1 < segmentCount && offset - segmentStart >= (packed ? packed.lengths[segmentIndex] : chunk.segments[segmentIndex].length)) {
      segmentStart += packed ? packed.lengths[segmentIndex] : chunk.segments[segmentIndex].length; segmentIndex++;
    }
    chunk.segmentHead = segmentIndex; chunk.segmentStart = segmentStart;
    const segment = packed || chunk.segments[segmentIndex], segmentOffset = offset - segmentStart;
    const length = packed ? packed.lengths[segmentIndex] : segment.length;
    const objectCount = segment.objectInputStart >= 0 ? this.inputCount - segment.objectInputStart : 0;
    const objectBase = packed ? segmentIndex * objectCount : 0, speakerBase = packed ? segmentIndex * (this.speakerCount + 1) : 0;
    const fraction = length > 1 ? Math.min(1, segmentOffset / (length - 1)) : 0;
    if (segment.objectInputStart >= 0) {
      const oneMinus = 1 - fraction;
      for (let object = 0; object < objectCount; object++) {
        const at = objectBase + object;
        const first = segment.normStart[at], last = segment.normEnd[at];
        let scale = 0;
        if (first > 0 || last > 0) {
          // Active shapes are normalized; a zero endpoint retains its continuous activation fade.
          let inverse = segment.inverseNorm[at];
          if (inverse < 0) {
            const energy = oneMinus * oneMinus * first + 2 * oneMinus * fraction * segment.normDot[at] + fraction * fraction * last;
            inverse = energy > 0 ? 1 / Math.sqrt(energy) : 0;
          }
          let amplitude = segment.constantAmplitude[at];
          if (amplitude < 0) {
            const startDb = segment.objectGainDbStart[at], endDb = segment.objectGainDbEnd[at];
            const difference = endDb - startDb;
            const db = Number.isFinite(difference) ? startDb + difference * fraction : startDb * oneMinus + endDb * fraction;
            amplitude = 10 ** (db / 20);
          }
          if (Number.isFinite(amplitude)) scale = amplitude * inverse;
        }
        this.objectScales[segment.objectInputStart + object] = Number.isFinite(scale) ? scale : 0;
      }
    }
    let lfeSample = 0;
    const lfeChannel = chunk.channels[this.lfeIndex];
    if (lfeChannel && offset < lfeChannel.length) lfeSample = lfeChannel[offset];
    this.lfeState += (lfeSample - this.lfeState) * LFE_LOW_PASS_ALPHA;
    for (let speaker = 0; speaker < this.speakerCount; speaker += 1) {
      let sum = 0;
      const begin = segment.offsets[speakerBase + speaker];
      const end = segment.offsets[speakerBase + speaker + 1];
      for (let route = begin; route < end; route += 1) {
        const channelIndex = segment.indices[route];
        const channel = chunk.channels[channelIndex];
        let coefficient = segment.startValues[route]
          + (segment.endValues[route] - segment.startValues[route]) * fraction;
        if (segment.objectInputStart >= 0 && channelIndex >= segment.objectInputStart) {
          // Match the finite Float32 routing-coefficient boundary; overflow silences only this route.
          coefficient = Math.fround(coefficient * this.objectScales[channelIndex]);
          if (!Number.isFinite(coefficient)) coefficient = 0;
        }
        if (channelIndex === this.lfeIndex) sum += this.lfeState * coefficient;
        else if (channel && offset < channel.length) sum += channel[offset] * coefficient;
      }
      // Assignment already rounds to Float32; inspect that same value before
      // it can overflow persistent low-pass/FFT/ring state.
      const stored = Math.fround(sum);
      if (!Number.isFinite(stored)) {
        this.failMixRange();
        return;
      }
      this.speakerValues[speaker] = stored;
    }
  }

  failMixRange() {
    if (this.mixRangeError) return;
    this.mixRangeError = true;
    this.playing = false;
    this.blockConsumed = false;
    this.queue = [];
    this.queueHead = 0;
    this.wasUnderrun = false;
    this.resetDsp();
    this.port.postMessage({ type: 'error', message: 'Cinema mixed signal exceeds the Float32 range' });
    this.postStatus(true);
  }

  convolveHrtf(ring, write, delay, kernels, offset, taps) {
    const boundedDelay = Math.max(0, Math.min(RING_LENGTH - taps - 2, delay));
    const wholeDelay = boundedDelay | 0;
    const delayFraction = boundedDelay - wholeDelay;
    let readIndex = (write - wholeDelay) & RING_MASK;
    let left = 0;
    let right = 0;
    for (let tap = 0; tap < taps; tap += 1) {
      const current = ring[readIndex];
      const previous = ring[(readIndex - 1) & RING_MASK];
      const sample = current + (previous - current) * delayFraction;
      const coefficients = offset + tap * 2;
      left += sample * kernels[coefficients];
      right += sample * kernels[coefficients + 1];
      readIndex = (readIndex - 1) & RING_MASK;
    }
    this.hrtfLeft = left;
    this.hrtfRight = right;
  }

  writeSpeakerRings() {
    let roomLow = 0;
    for (let speaker = 0; speaker < this.speakerCount; speaker += 1) {
      const kind = this.kinds[speaker] || 0;
      if (kind === 0) {
        const state = this.lowpass[speaker]
          + (this.speakerValues[speaker] - this.lowpass[speaker]) * BASS_SEND_ALPHA;
        const stored = Math.fround(state);
        if (!Number.isFinite(stored)) { this.failMixRange(); return; }
        this.lowpass[speaker] = stored;
        roomLow += state;
      }
    }
    for (let speaker = 0; speaker < this.speakerCount; speaker++) {
      const kind = this.kinds[speaker] || 0;
      let value = this.speakerValues[speaker];
      if (kind === 1) value += roomLow * 0.16;
      else if (kind === 2) value += roomLow * 0.20;
      const stored = Math.fround(value);
      if (!Number.isFinite(stored)) { this.failMixRange(); return; }
      this.speakerRings[speaker][this.writeIndex] = stored;
    }
  }

  renderSample(chunk) {
    this.writeSpeakerRings();
    if (this.mixRangeError) return;
    let reflection = 0;
    let directLeft = 0;
    let directRight = 0;
    const write = this.writeIndex;
    for (let speaker = 0; speaker < this.speakerCount; speaker += 1) {
      const base = speaker * SPATIAL_STRIDE;
      const spatial = this.spatial;
      const ring = this.speakerRings[speaker];
      if (!chunk.activeSpeakers[speaker]) continue;
      if (this.hrtf) {
        const delay = Math.min(spatial[base], spatial[base + 1]);
        this.convolveHrtf(ring, write, delay, this.directKernels, speaker * HRTF_DIRECT_TAPS * 2, HRTF_DIRECT_TAPS);
        directLeft += this.hrtfLeft * spatial[base + 5];
        directRight += this.hrtfRight * spatial[base + 5];
        reflection += (this.hrtfLeft + this.hrtfRight) * 0.5 * spatial[base + 4];
      } else {
        const delayedLeft = readRing(ring, write, spatial[base]);
        const delayedRight = readRing(ring, write, spatial[base + 1]);
        directLeft += delayedLeft * spatial[base + 2];
        directRight += delayedRight * spatial[base + 3];
        reflection += (delayedLeft + delayedRight) * 0.5 * spatial[base + 4];
      }
    }
    for (let pathIndex = 0; pathIndex < this.reflectionCount; pathIndex += 1) {
      const speaker = this.reflectionSpeaker[pathIndex];
      if (!chunk.activeSpeakers[speaker]) continue;
      const ring = this.speakerRings[speaker];
      const pathGain = this.reflectionGain[pathIndex]
        * (0.12 + 0.18 * this.reflectionHighGain[pathIndex]);
      let pathLeft;
      let pathRight;
      if (this.hrtf && pathIndex < HRTF_REFLECTION_LIMIT) {
        this.convolveHrtf(ring, write, this.reflectionDelay[pathIndex], this.reflectionKernels,
          pathIndex * HRTF_REFLECTION_TAPS * 2, HRTF_REFLECTION_TAPS);
        pathLeft = this.hrtfLeft * pathGain;
        pathRight = this.hrtfRight * pathGain;
      } else {
        const delayed = readRing(ring, write, this.reflectionDelay[pathIndex]);
        pathLeft = delayed * this.reflectionLeft[pathIndex] * pathGain;
        pathRight = delayed * this.reflectionRight[pathIndex] * pathGain;
      }
      directLeft += pathLeft;
      directRight += pathRight;
      reflection += (pathLeft + pathRight) * 0.5;
    }

    this.renderRoom(reflection, directLeft, directRight);
  }

  renderRoom(reflection, directLeft, directRight) {
    const write = this.writeIndex;
    let early = 0;
    for (let band = 0; band < BAND_CUTOFFS.length; band += 1) {
      const state = this.bandState[band] + (reflection - this.bandState[band]) * BAND_ALPHAS[band];
      this.bandState[band] = state * BAND_DECAY[band];
      const ring = this.earlyRings[band];
      ring[write] = this.bandState[band];
      let bandEarly = 0;
      for (let tap = 0; tap < EARLY_DELAYS.length; tap += 1) {
        bandEarly += ring[(write - EARLY_DELAYS[tap]) & RING_MASK] * EARLY_WEIGHTS[tap];
      }
      early += bandEarly * BAND_MIX[band];
    }

    const lateInput = reflection * 0.055 + early * 0.17;
    let lateLeft = 0;
    let lateRight = 0;
    let feedbackSum = 0;
    for (let line = 0; line < this.lateRings.length; line += 1) {
      const previous = this.lateRings[line][this.lateIndex[line]];
      const low = this.lateDamp[line] + (previous - this.lateDamp[line]) * LATE_LOW_ALPHA;
      this.lateDamp[line] = low;
      const feedback = low * LATE_LOW_DECAY[line] + (previous - low) * LATE_HIGH_DECAY[line];
      this.lateFeedback[line] = feedback;
      feedbackSum += feedback;
      const signLeft = (line & 1) === 0 ? 1 : -1;
      const signRight = ((line >> 1) & 1) === 0 ? 1 : -1;
      lateLeft += previous * signLeft;
      lateRight += previous * signRight;
    }
    // A Householder reflection mixes all delay lines while preserving energy
    // before the frequency-dependent attenuation applied above.
    const coupling = 2 * feedbackSum / this.lateRings.length;
    for (let line = 0; line < this.lateRings.length; line += 1) {
      const ring = this.lateRings[line];
      const index = this.lateIndex[line];
      const sign = (line & 4) === 0 ? 1 : -1;
      ring[index] = sign * lateInput + this.lateFeedback[line] - coupling;
      this.lateIndex[line] = index + 1 === ring.length ? 0 : index + 1;
    }
    this.renderedLeft = directLeft + early * 0.52 + lateLeft * 0.12;
    this.renderedRight = directRight + early * 0.52 + lateRight * 0.12;
  }

  availableFrames(limit) {
    let sample = this.playhead;
    const end = sample + limit;
    let index = this.queueHead;
    while (index < this.queue.length && sample < end) {
      const chunk = this.queue[index];
      if (sample < chunk.start) break;
      if (sample < chunk.end) sample = Math.min(end, chunk.end);
      index++;
    }
    return sample - this.playhead;
  }

  renderQuantum(left, right, offset, count) {
    const first = this.writeIndex;
    this.smoothSpatialQuantum(count);
    for (let frame = 0; frame < count; frame++) {
      const chunk = this.currentChunk();
      this.sampleFromChunk(chunk);
      if (this.mixRangeError) return;
      this.writeSpeakerRings();
      if (this.mixRangeError) return;
      this.playhead++;
      this.writeTotal++;
      this.writeIndex = (this.writeIndex + 1) & RING_MASK;
    }
    const end = this.writeIndex;
    const rendered = this.convolver.render(this.speakerRings, end, this.writeTotal, count);
    for (let frame = 0; frame < count; frame++) {
      this.writeIndex = (first + frame) & RING_MASK;
      this.renderRoom(rendered[2][frame], rendered[0][frame], rendered[1][frame]);
      left[offset + frame] = Math.max(-1, Math.min(1, this.renderedLeft * .78));
      if (right !== left) right[offset + frame] = Math.max(-1, Math.min(1, this.renderedRight * .78));
    }
    this.writeIndex = end;
  }

  postStatus(force) {
    if (!force && this.renderedSinceStatus < STATUS_INTERVAL) return;
    this.renderedSinceStatus = 0;
    this.port.postMessage({
      type: 'status',
      generation: this.seekGeneration,
      sample: Math.trunc(this.playhead),
      contextTime: this.lastConsumedContextTime,
      playing: this.blockConsumed,
      underruns: this.underruns,
    });
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output[1] || output[0];
    left.fill(0);
    if (right !== left) right.fill(0);
    if (this.disposed) return false;
    this.blockConsumed = false;
    if (!this.playing) {
      this.lastBlockFrames = left.length;
      this.renderedSinceStatus += left.length;
      this.postStatus(false);
      return true;
    }
    let sawGap = false;
    let consumedFrames = 0;
    if (this.hrtf && !this.convolver.current) this.updateKernels(left.length);
    for (let frame = 0; frame < left.length; frame += 1) {
      const count = this.hrtf && this.convolver.current
        ? this.availableFrames(Math.min(CONV_HOP, left.length - frame)) : 0;
      if (count > 0) {
        this.renderQuantum(left, right, frame, count);
        if (this.mixRangeError) {
          left.fill(0); if (right !== left) right.fill(0);
          return true;
        }
        this.blockConsumed = true;
        consumedFrames += count;
        frame += count - 1;
        continue;
      }
      // The no-HRIR fallback and genuine queue gaps retain the original clock contract.
      this.smoothSpatial();
      const chunk = this.currentChunk();
      if (chunk) {
        this.sampleFromChunk(chunk);
        if (this.mixRangeError) {
          left.fill(0); if (right !== left) right.fill(0);
          return true;
        }
        this.blockConsumed = true;
      } else {
        this.speakerValues.fill(0);
        if (!sawGap && !this.wasUnderrun) this.resetDsp();
        sawGap = true;
        // Keep the playback clock on the missing sample. The next queued
        // block must resume at this exact position instead of being skipped.
        continue;
      }
      this.renderSample(chunk);
      if (this.mixRangeError) {
        left.fill(0); if (right !== left) right.fill(0);
        return true;
      }
      left[frame] = Math.max(-1, Math.min(1, this.renderedLeft * 0.78));
      if (right !== left) right[frame] = Math.max(-1, Math.min(1, this.renderedRight * 0.78));
      this.playhead += 1;
      this.writeIndex = (this.writeIndex + 1) & RING_MASK;
      this.writeTotal += 1;
      consumedFrames += 1;
    }
    if (sawGap && !this.wasUnderrun) this.underruns += 1;
    this.wasUnderrun = sawGap;
    this.lastBlockFrames = left.length;
    if (consumedFrames > 0) {
      const blockTime = typeof currentTime === 'number' ? currentTime : 0;
      this.lastConsumedContextTime = blockTime + consumedFrames / SAMPLE_RATE;
    }
    this.renderedSinceStatus += left.length;
    this.postStatus(false);
    return true;
  }
}

registerProcessor('cinema-room-processor', CinemaRoomProcessor);
`;
