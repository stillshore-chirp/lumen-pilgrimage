import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { registerHooks } from 'node:module';
// Expose the private implementation only in this test module. Production keeps
// the openCinemaMovieVideo API and is not given a testing entry point.
const movieUrl = new URL('../src/coast/world/cinema/cinemaMovieVideo.ts', import.meta.url).href;
const hook = registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    return url === movieUrl
      ? { ...loaded, source: loaded.source.toString().replace('class CinemaMovieVideoImpl implements', 'export class CinemaMovieVideoImpl implements') }
      : loaded;
  },
});
const { CinemaMovieVideoImpl } = await import(movieUrl);
hook.deregister();
const original = { document: globalThis.document, VideoDecoder: globalThis.VideoDecoder, EncodedVideoChunk: globalThis.EncodedVideoChunk, window: globalThis.window };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() { } }) }) };
globalThis.window = globalThis;
globalThis.EncodedVideoChunk = class {
  constructor(data) { Object.assign(this, data); }
};
function make({ length = 120, depth = 0, bframes = false, delay = 0, acceptFirst = false, outputDelay = 0 } = {}) {
  let movie;
  const c = { maxPendingObserved: 0, decoders: 0, closed: 0, inputs: 0, outputs: 0, frameCloses: 0, flushes: 0, maxQueue: 0, duplicateCloses: 0 };
  globalThis.VideoDecoder = class extends EventTarget {
    constructor(init) { super(); this.init = init; this.decodeQueueSize = 0; this.state = 'unconfigured'; this.buffer = []; this.jobs = new Set(); c.decoders++; }
    configure() { this.state = 'configured'; this.keyRequired = true; }
    decode(chunk) { assert.equal(this.state, 'configured'); if (this.keyRequired)
      assert.equal(chunk.type, 'key'); this.keyRequired = false; c.inputs++; c.maxPendingObserved = Math.max(c.maxPendingObserved, movie?.pendingFrames?.size ?? 0); this.decodeQueueSize++; c.maxQueue = Math.max(c.maxQueue, this.decodeQueueSize); const job = setTimeout(() => { this.jobs.delete(job); if (this.state === 'closed')
      return; this.decodeQueueSize--; this.dispatchEvent(new Event('dequeue')); const produce = () => { if (this.state === 'closed')
      return; this.buffer.push(chunk); if (this.buffer.length > depth)
      this.emit(); }; if (acceptFirst) {
      const outputJob = setTimeout(() => { this.jobs.delete(outputJob); produce(); }, outputDelay);
      this.jobs.add(outputJob);
    }
    else
      produce(); }, delay); this.jobs.add(job); }
    emit() { this.buffer.sort((a, b) => a.timestamp - b.timestamp); const chunk = this.buffer.shift(); let closed = false; c.outputs++; this.init.output({ timestamp: chunk.timestamp, close() { if (closed)
        c.duplicateCloses++;
      else {
        closed = true;
        c.frameCloses++;
      } } }); }
    async flush() { c.flushes++; while (this.jobs.size && this.state !== 'closed')
      await new Promise(r => setTimeout(r, 1)); while (this.buffer.length)
      this.emit(); this.keyRequired = true; }
    close() { if (this.state === 'closed')
      throw new Error('closed'); this.state = 'closed'; for (const j of this.jobs)
      clearTimeout(j); this.jobs.clear(); this.buffer = []; this.decodeQueueSize = 0; c.closed++; }
  };
  const order = Array.from({ length }, (_, i) => i);
  if (bframes)
    for (let i = 1; i + 1 < length; i += 3)
      [order[i], order[i + 1]] = [order[i + 1], order[i]];
  const samples = Array.from({ length }, (_, i) => ({ index: i, offset: i, size: 1, key: i % 30 === 0, presentationTime: order.indexOf(i) / 24, outputTimestamp: order.indexOf(i) * 41667, outputDuration: 41667 }));
  const video = { width: 320, height: 180, duration: length / 24, samples, presentationOrder: order, sampleByTimestamp: new Map(samples.map(s => [s.outputTimestamp, s.index])), config: {} };
  movie = new CinemaMovieVideoImpl(new File([new Uint8Array(length)], 'fixture'), video);
  return { movie, c, order };
}
test('sequential asynchronous output reuses one decoder, no intermediate flush, bounded cache and four-slot queue', async () => { const { movie, c } = make({ length: 180, delay: 1 }); for (let i = 0; i < 140; i++) {
  movie.presentationTarget = i;
  movie.lastPresentedIndex = i - 1;
  await movie.decodeTo(i, false);
  assert(movie.frames.has(i));
  assert(movie.frames.size <= 8);
} assert.equal(c.decoders, 1); assert.equal(c.flushes, 0); assert(c.inputs <= 145); assert(c.maxQueue <= 4); movie.dispose(); assert.equal(c.closed, 1); assert.equal(c.duplicateCloses, 0); assert.equal(c.outputs, c.frameCloses); });
test('B-frame delayed output continues feeding and flushes only at EOF, then permits reverse seek with key restart', async () => { const { movie, c, order } = make({ length: 48, depth: 2, bframes: true }); for (const i of order) {
  movie.presentationTarget = i;
  movie.lastPresentedIndex = -1;
  await movie.decodeTo(i, false);
  assert(movie.frames.has(i));
  assert(movie.frames.size <= 8);
} assert.equal(c.decoders, 1); assert.equal(c.flushes, 1); assert.equal(c.inputs, 48); await movie.seek(1 / 24); assert(movie.frames.has(order[1])); assert.equal(c.decoders, 2); movie.dispose(); assert.equal(c.closed, 2); assert.equal(c.duplicateCloses, 0); assert.equal(c.outputs, c.frameCloses); });
test('pending input is not mistaken for a reverse seek and active prefetch target survives out-of-order cache pressure', async () => { const { movie, c } = make({ length: 64, depth: 2 }); movie.presentationTarget = 0; await movie.decodeTo(0, false); const pending = [...movie.pendingFrames][0]; assert(Number.isInteger(pending)); const generation = movie.decoderGeneration; movie.presentationTarget = pending; await movie.decodeTo(pending, false); assert.equal(movie.decoderGeneration, generation); assert(movie.frames.has(pending)); movie.presentationTarget = 40; await movie.decodeTo(40, false); assert(movie.frames.has(40)); assert(movie.frames.size <= 8); assert.equal(movie.activeDecodeTarget, null); movie.dispose(); assert.equal(c.outputs, c.frameCloses); });
test('dispose cancels in-flight generation and releases pending ownership without decoding into a closed decoder', async () => { const { movie, c } = make({ length: 60, delay: 5 }); const pending = movie.decodeTo(0, false); setTimeout(() => movie.dispose(), 1); await pending; assert.equal(movie.pendingFrames.size, 0); assert.equal(movie.frames.size, 0); assert.equal(movie.activeDecodeTarget, null); assert.equal(c.closed, 1); assert.equal(c.outputs, c.frameCloses); });
test('actual present -> prefetch circulation retains future outputs within eight frames without routine forward restart', async () => { for (const depth of [0, 2]) {
  const { movie, c, order } = make({ length: 180, depth, bframes: depth > 0, delay: 1 });
  await movie.seek(0);
  let notReady = 0;
  for (let i = 0; i < 120; i++) {
    if (!movie.present(i / 24))
      notReady++;
    await movie.operation;
    await new Promise(r => setTimeout(r, 2));
    assert(movie.frames.size <= 8);
    assert([...movie.frames.keys(), ...movie.pendingFrames].filter(index => movie.video.samples[index].presentationTime > movie.video.samples[movie.presentationTarget].presentationTime).length <= 7);
  }
  assert.equal(notReady, 0);
  assert.equal(c.decoders, 1);
  assert.equal(c.flushes, 0);
  assert(c.inputs <= 132);
  movie.dispose();
  assert.equal(c.outputs, c.frameCloses);
  assert.equal(c.duplicateCloses, 0);
} });
test('discarded future prefetch is not treated as a reverse user seek; a required uncached target can reconstruct', async () => { const { movie, c } = make({ length: 80 }); await movie.seek(0); movie.presentationTarget = 0; movie.pendingFrames.delete(20); movie.decodeCursor = 24; const generation = movie.decoderGeneration; await movie.decodeTo(20, false); assert.equal(movie.decoderGeneration, generation); assert.equal(movie.decoderNeedsKeyframe, false); movie.presentationTarget = 20; await movie.decodeTo(20, false); assert.equal(movie.decoderGeneration, generation + 1); assert(movie.frames.has(20)); movie.dispose(); assert.equal(c.outputs, c.frameCloses); });
test('a stale queued prefetch yields when the presentation target advances during its asynchronous read', async () => { const { movie, c } = make({ length: 100, delay: 3 }); await movie.seek(0); movie.presentationTarget = 0; const pending = movie.decodeTo(10, false); movie.presentationTarget = 40; await pending; assert.equal(movie.activeDecodeTarget, null); assert.equal(c.decoders, 1); assert(c.inputs < 16); assert.equal(c.flushes, 0); movie.dispose(); assert.equal(c.outputs, c.frameCloses); });
test('dequeue-before-output circulation bounds future admission and resumes after capacity deferral', async () => { for (const depth of [0, 2]) {
  const { movie, c } = make({ length: 180, depth, bframes: depth > 0, acceptFirst: true, outputDelay: 8 });
  await movie.seek(0);
  for (let i = 0; i < 20; i++) {
    assert(movie.present(0));
    await movie.operation;
    await new Promise(r => setTimeout(r, 2));
  }
  const heldInputs = c.inputs, heldDecoders = c.decoders;
  for (let i = 0; i < 30; i++) {
    assert(movie.present(0));
    await movie.operation;
  }
  assert.equal(c.inputs, heldInputs);
  assert.equal(c.decoders, heldDecoders);
  let notReady = 0;
  for (let i = 1; i < 120; i++) {
    if (!movie.present(i / 24))
      notReady++;
    await movie.operation;
    await new Promise(r => setTimeout(r, 15));
    assert(movie.frames.size <= 8);
  }
  assert.equal(notReady, 0);
  assert(c.decoders <= 2);
  assert(c.flushes <= 1);
  assert(c.inputs <= 145);
  movie.dispose();
  assert.equal(c.outputs, c.frameCloses);
  assert.equal(c.duplicateCloses, 0);
  assert(c.maxPendingObserved <= 12);
} });
after(() => { for (const [k, v] of Object.entries(original)) {
  if (v === undefined)
    delete globalThis[k];
  else
    globalThis[k] = v;
} });
