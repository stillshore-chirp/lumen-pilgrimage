import type { CinemaProgram } from './cinemaProgram';
import { CINEMA_RENDER_SPEAKERS, createCinemaRoutingShapes } from './cinemaSpeakers';

/** Pure, self-contained layout; its emitted function is also installed in the worklet. */
function cinemaRoutingPacketLayout(segments: number, routes: number, speakers: number, objects: number) {
  const counts = [segments, segments * (speakers + 1), routes, routes, routes,
    ...Array(7).fill(segments * objects)];
  const widths = [4, 4, 2, 4, 4, 8, 8, 8, 8, 8, 8, 8];
  const offsets: number[] = [];
  let byteLength = 48;
  for (let i = 0; i < counts.length; i++) {
    if (!Number.isSafeInteger(counts[i]) || counts[i] < 0) return null;
    byteLength = Math.ceil(byteLength / widths[i]) * widths[i];
    offsets.push(byteLength);
    byteLength += counts[i] * widths[i];
    if (!Number.isSafeInteger(byteLength)) return null;
  }
  return { counts, offsets, byteLength };
}

/** Own immutable buffer. Main scratch is reused locally and never transferred. */
export function createCinemaRoutingPacket(program: CinemaProgram, start: number, frames: number): ArrayBuffer {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(frames) || frames <= 0
    || !Number.isSafeInteger(start + frames)) throw new RangeError('Invalid cinema routing sample range');
  const speakers = CINEMA_RENDER_SPEAKERS.length, objects = program.objects.length;
  const inputs = program.bed.length + objects;
  if (objects > 32 || inputs < 1 || inputs > 65535) throw new RangeError('Invalid cinema routing channel counts');
  const lengthList: number[] = [];
  const keyIndices = program.objects.map(object => {
    let low = 0, high = object.keys.length;
    while (low < high) { const middle = (low + high) >>> 1;
      if (object.keys[middle].sample <= start) low = middle + 1; else high = middle; }
    return low;
  });
  for (let offset = 0; offset < frames;) {
    const sample = start + offset;
    let end = Math.min(start + frames, sample + 2400);
    program.objects.forEach((object, index) => {
      while (keyIndices[index] < object.keys.length && object.keys[keyIndices[index]].sample <= sample) keyIndices[index]++;
      const key = object.keys[keyIndices[index]];
      if (key && key.sample < end) end = key.sample;
    });
    lengthList.push(end - sample); offset = end - start;
  }
  const lengths = Uint32Array.from(lengthList), segments = lengths.length;
  const offsets = new Uint32Array(segments * (speakers + 1));
  const planes = Array.from({ length: 7 }, () => new Float64Array(segments * objects));
  const first = new Float32Array(speakers * inputs), last = new Float32Array(first.length);
  const firstDb = new Float64Array(objects), lastDb = new Float64Array(objects);
  const e0 = new Float64Array(objects), e1 = new Float64Array(objects), dot = new Float64Array(objects);
  const maxRoutes = segments * speakers * inputs;
  if (!Number.isSafeInteger(maxRoutes)) throw new RangeError('Cinema routing packet exceeds safe bounds');
  let capacity = Math.min(4096, maxRoutes), routes = 0, offset = 0;
  let indices = new Uint16Array(capacity), starts = new Float32Array(capacity), ends = new Float32Array(capacity);
  for (let segment = 0; segment < segments; segment++) {
    const length = lengths[segment], sample = start + offset, end = sample + length;
    createCinemaRoutingShapes(program, sample, first, firstDb);
    if (length > 1) createCinemaRoutingShapes(program, end - 1, last, lastDb);
    const endpoint = length === 1 ? first : last, endpointDb = length === 1 ? firstDb : lastDb;
    e0.fill(0); e1.fill(0); dot.fill(0);
    for (let speaker = 0; speaker < speakers; speaker++) {
      offsets[segment * (speakers + 1) + speaker] = routes;
      for (let input = 0; input < inputs; input++) {
        const at = speaker * inputs + input;
        const a = Number.isFinite(first[at]) ? first[at] : 0;
        const b = Number.isFinite(endpoint[at]) ? endpoint[at] : 0;
        if (Math.abs(a) > 1e-6 || Math.abs(b) > 1e-6) {
          if (routes === capacity) {
            const nextCapacity = Math.min(maxRoutes, capacity * 2);
            const nextIndices = new Uint16Array(nextCapacity), nextStarts = new Float32Array(nextCapacity), nextEnds = new Float32Array(nextCapacity);
            nextIndices.set(indices); nextStarts.set(starts); nextEnds.set(ends);
            indices = nextIndices; starts = nextStarts; ends = nextEnds; capacity = nextCapacity;
          }
          indices[routes] = input; starts[routes] = a; ends[routes] = b; routes++;
          if (input >= program.bed.length) {
            const object = input - program.bed.length;
            e0[object] += a * a; e1[object] += b * b; dot[object] += a * b;
          }
        }
      }
    }
    offsets[(segment + 1) * (speakers + 1) - 1] = routes;
    for (let object = 0; object < objects; object++) {
      let amplitude = -1, inverse = -1;
      if (firstDb[object] === endpointDb[object]) {
        const value = 10 ** (firstDb[object] / 20);
        amplitude = Number.isFinite(value) ? value : 0;
      }
      if (!(e0[object] > 0 && e1[object] > 0)) inverse = 1;
      else if (e0[object] === e1[object] && e0[object] === dot[object]) inverse = 1 / Math.sqrt(e0[object]);
      const at = segment * objects + object;
      planes[0][at] = firstDb[object]; planes[1][at] = endpointDb[object];
      planes[2][at] = e0[object]; planes[3][at] = e1[object]; planes[4][at] = dot[object];
      planes[5][at] = amplitude; planes[6][at] = inverse;
    }
    offset += length;
  }
  if (segments > 0xffffffff || routes > 0xffffffff) throw new RangeError('Cinema routing packet is too large');
  const layout = cinemaRoutingPacketLayout(segments, routes, speakers, objects);
  if (!layout) throw new RangeError('Cinema routing packet exceeds safe bounds');
  const buffer = new ArrayBuffer(layout.byteLength), header = new DataView(buffer);
  [0x43475232, 1, segments, routes, inputs, speakers, program.bed.length, 0]
    .forEach((value, index) => header.setUint32(index * 4, value, true));
  header.setFloat64(32, frames, true); header.setFloat64(40, buffer.byteLength, true);
  new Uint32Array(buffer, layout.offsets[0], layout.counts[0]).set(lengths);
  new Uint32Array(buffer, layout.offsets[1], layout.counts[1]).set(offsets);
  new Uint16Array(buffer, layout.offsets[2], layout.counts[2]).set(indices.subarray(0, routes));
  new Float32Array(buffer, layout.offsets[3], layout.counts[3]).set(starts.subarray(0, routes));
  new Float32Array(buffer, layout.offsets[4], layout.counts[4]).set(ends.subarray(0, routes));
  for (let i = 0; i < planes.length; i++) new Float64Array(buffer, layout.offsets[5 + i], layout.counts[5 + i]).set(planes[i]);
  return buffer;
}

/** Decode only after validating the complete fixed header and computed byte layout. */
export const CINEMA_ROUTING_PACKET_PROCESSOR_SOURCE = String.raw`
const cinemaRoutingPacketLayout = ${cinemaRoutingPacketLayout.toString()};
function decodeCinemaRoutingPacket(buffer, speakers, inputs, frames) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 48) return null;
  const h = new DataView(buffer);
  const segments = h.getUint32(8, true), routes = h.getUint32(12, true), objectInputStart = h.getUint32(24, true);
  if (h.getUint32(0, true) !== 0x43475232 || h.getUint32(4, true) !== 1
    || h.getUint32(16, true) !== inputs || h.getUint32(20, true) !== speakers || h.getUint32(28, true) !== 0
    || !Number.isSafeInteger(frames) || frames <= 0 || h.getFloat64(32, true) !== frames
    || h.getFloat64(40, true) !== buffer.byteLength || segments < 1 || segments > frames
    || objectInputStart > inputs || inputs - objectInputStart > 32) return null;
  const objects = inputs - objectInputStart, layout = cinemaRoutingPacketLayout(segments, routes, speakers, objects);
  if (!layout || layout.byteLength !== buffer.byteLength) return null;
  const lengths = new Uint32Array(buffer, layout.offsets[0], layout.counts[0]);
  const offsets = new Uint32Array(buffer, layout.offsets[1], layout.counts[1]);
  const indices = new Uint16Array(buffer, layout.offsets[2], layout.counts[2]);
  const startValues = new Float32Array(buffer, layout.offsets[3], layout.counts[3]);
  const endValues = new Float32Array(buffer, layout.offsets[4], layout.counts[4]);
  const planes = layout.offsets.slice(5).map((offset, i) => new Float64Array(buffer, offset, layout.counts[5 + i]));
  let total = 0, previous = 0;
  for (let i = 0; i < lengths.length; i++) { if (lengths[i] < 1 || lengths[i] > 2400) return null; total += lengths[i]; }
  if (total !== frames || offsets[0] !== 0 || offsets[offsets.length - 1] !== routes) return null;
  for (let segment = 0; segment < segments; segment++) {
    const base = segment * (speakers + 1);
    if (offsets[base] !== previous) return null;
    for (let speaker = 0; speaker <= speakers; speaker++) {
      const next = offsets[base + speaker]; if (next < previous || next > routes) return null; previous = next;
    }
  }
  for (let i = 0; i < routes; i++) {
    if (indices[i] >= inputs || !Number.isFinite(startValues[i]) || !Number.isFinite(endValues[i])) return null;
  }
  const [objectGainDbStart, objectGainDbEnd, normStart, normEnd, normDot, constantAmplitude, inverseNorm] = planes;
  for (let i = 0; i < normStart.length; i++) {
    if (!Number.isFinite(objectGainDbStart[i]) || !Number.isFinite(objectGainDbEnd[i])
      || !Number.isFinite(normStart[i]) || normStart[i] < 0 || !Number.isFinite(normEnd[i]) || normEnd[i] < 0
      || !Number.isFinite(normDot[i]) || !Number.isFinite(constantAmplitude[i]) || !Number.isFinite(inverseNorm[i])) return null;
    let amplitude = -1, inverse = -1;
    if (objectGainDbStart[i] === objectGainDbEnd[i]) {
      const value = 10 ** (objectGainDbStart[i] / 20); amplitude = Number.isFinite(value) ? value : 0;
    }
    if (!(normStart[i] > 0 && normEnd[i] > 0)) inverse = 1;
    else if (normStart[i] === normEnd[i] && normStart[i] === normDot[i]) inverse = 1 / Math.sqrt(normStart[i]);
    if (amplitude !== constantAmplitude[i] || inverse !== inverseNorm[i]) return null;
  }
  return { buffer, segmentCount: segments, lengths, offsets, indices, startValues, endValues, objectInputStart,
    objectGainDbStart, objectGainDbEnd, normStart, normEnd, normDot, constantAmplitude, inverseNorm };
}
`;
