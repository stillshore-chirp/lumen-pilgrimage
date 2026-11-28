import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { test, after } from 'node:test';
import { PerspectiveCamera } from 'three';

const screeningUrl = new URL('../src/coast/world/cinema/cinemaScreening.ts', import.meta.url).href;
const movieUrl = new URL('../src/coast/world/cinema/cinemaMovieVideo.ts', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === screeningUrl && specifier === './cinemaRoomAudio') {
      return { url: 'data:text/javascript,export function createCinemaRoomAudio(){throw new Error("Unexpected room opening");}', shortCircuit: true };
    }
    if (context.parentURL === screeningUrl && specifier === './cinemaProgram') {
      return { url: 'data:text/javascript,export const CINEMA_SAMPLE_RATE=48000;', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === screeningUrl || url === movieUrl) {
      let source = readFileSync(new URL(url), 'utf8');
      if (url === movieUrl) source = source.replace('class CinemaMovieVideoImpl implements', 'export class CinemaMovieVideoImpl implements');
      return { format: 'module', source: stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: url }), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { CinemaScreeningPlayer } = await import(screeningUrl);
const { CinemaMovieVideoImpl } = await import(movieUrl);
hook.deregister();
const originalDocument = globalThis.document;
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }) };
after(() => { globalThis.document = originalDocument; });

function fixture({ sample = 587904, statusPlaying = true, lag = .184, cursor = 573467.2552993407,
  cacheStart = 279, nextRead = 612000, getTimestamp = true } = {}) {
  const closes = new Map(), requests = [], commands = [], presents = [];
  const samples = Array.from({ length: 384 }, (_, index) => ({ index, presentationTime: index / 24, key: index % 250 === 0 }));
  const picture = new CinemaMovieVideoImpl(new File([], 'clock-fixture'), {
    width: 320, height: 180, duration: 16, samples, presentationOrder: samples.map(s => s.index),
    sampleByTimestamp: new Map(), config: {},
  });
  function populate(start) {
    picture.releaseFrames();
    for (let index = start; index < Math.min(start + 8, samples.length); index++) {
      picture.frames.set(index, { index, frame: { close() { closes.set(index, (closes.get(index) ?? 0) + 1); } } });
    }
  }
  populate(cacheStart);
  picture.lastPresentedIndex = cacheStart + 5;
  // Keep actual Movie.present and its real eight-entry Map. Decoder admission
  // is a recorded dependency here; this fixture measures the player clock.
  picture.requestDecode = target => { requests.push(target); };
  picture.seek = async time => { populate(Math.max(0, Math.min(376, Math.floor(time * 24)))); };
  const nativePresent = picture.present.bind(picture);
  picture.present = time => { const ready = nativePresent(time); presents.push({ time, target: picture.presentationIndex(time), ready }); return ready; };
  const state = { sample, contextTime: 1066.1253333333334, playing: statusPlaying, underruns: 0 };
  const context = { state: 'running', currentTime: state.contextTime - lag };
  if (getTimestamp) context.getOutputTimestamp = () => ({ contextTime: state.contextTime - lag });
  const delay = 587904 - 12.134401152069598 * 48000;
  let roomDisposes = 0;
  const room = {
    update() {}, status: () => ({ ...state }), centerDelaySamples: () => delay, enqueue() {},
    setPlaying(active) { commands.push(active); },
    seek(value) { state.sample = value; state.contextTime = context.currentTime; state.playing = false; },
    dispose() { roomDisposes++; },
  };
  const p = new CinemaScreeningPlayer({ durationSamples: 768000, read: async () => [new Float32Array(12000)] }, picture);
  Object.assign(p, { context, room, requested: true, active: true, nextRead, cursor, reading: true });
  const camera = new PerspectiveCamera(); camera.updateMatrixWorld();
  let textureDisposes = 0; p.texture.addEventListener('dispose', () => { textureDisposes++; });
  return { p, state, picture, presents, commands, requests, closes, context, delay,
    update: () => p.update(camera, .7), populate,
    dispose() { p.dispose(); return { roomDisposes, textureDisposes }; } };
}

test('stopped consumption retains the audible-clock frame instead of jumping beyond an eight-frame cache', () => {
  const playing = fixture(); const stopped = fixture({ statusPlaying: false });
  try {
    playing.update(); stopped.update();
    assert.equal(playing.presents[0].target, 286);
    assert.equal(stopped.presents[0].target, 286);
    assert.equal(stopped.presents[0].time, playing.presents[0].time);
    assert.equal(stopped.presents[0].ready, true);
    assert.deepEqual(stopped.commands, []);
    assert.equal(stopped.picture.frames.size, 8);
  } finally { playing.dispose(); stopped.dispose(); }
});

test('playing prediction keeps the existing positive and negative bounds', () => {
  for (const lag of [-1, 1, .184]) {
    const f = fixture({ lag, cursor: 0 });
    try {
      f.update();
      const advance = Math.max(-12000, Math.min(1024, Math.round(-lag * 48000)));
      assert.equal(f.presents[0].time, (587904 + advance - f.delay) / 48000);
    } finally { f.dispose(); }
  }
});

test('stopped rebuffering drains toward the last rendered sample without positive extrapolation', () => {
  for (const lag of [.25, .184, 0, -.2]) {
    const f = fixture({ statusPlaying: false, lag, cursor: 0, cacheStart: 279 });
    try {
      f.update();
      const advance = Math.max(-12000, Math.min(0, Math.round(-lag * 48000)));
      assert.equal(f.presents[0].time, (587904 + advance - f.delay) / 48000);
      assert(f.presents[0].time <= (587904 - f.delay) / 48000);
      assert.equal(f.p.requested, true);
    } finally { f.dispose(); }
  }
});

test('a fully rendered stopped end completes even with a persistently lagging output timestamp', () => {
  const f = fixture({ sample: 792000, statusPlaying: false, lag: .184, nextRead: 792000, cursor: 16, cacheStart: 376 });
  try {
    for (let i = 0; i < 20; i++) f.update();
    assert.equal(f.p.requested, false);
    assert.equal(f.p.active, false);
    assert.deepEqual(f.commands, [false]);
    assert.equal(f.p.position, 16);
  } finally { f.dispose(); }
});

test('an incomplete rendered end does not falsely finish while stalled', () => {
  const f = fixture({ sample: 791000, statusPlaying: false, lag: .184, nextRead: 791000, cursor: 16, cacheStart: 376 });
  try { f.update(); assert.equal(f.p.requested, true); } finally { f.dispose(); }
});

test('an unavailable output timestamp uses the same currentTime clock fallback', () => {
  for (const statusPlaying of [true, false]) {
    const f = fixture({ statusPlaying, getTimestamp: false });
    try { f.update(); assert.equal(f.presents[0].target, 286); } finally { f.dispose(); }
  }
});

test('explicit pause and seek keep the requested cursor while output still lags', async () => {
  const f = fixture({ cursor: 240000 });
  try {
    f.p.pause(); await Promise.resolve(); await Promise.resolve();
    assert.equal(f.p.requested, false); assert.equal(f.p.position, 5);
    f.update(); assert.equal(f.presents.at(-1).time, 5);
    f.p.seek(6); await Promise.resolve(); await Promise.resolve();
    f.update(); assert.equal(f.presents.at(-1).time, 6);
    assert.equal(f.p.active, false);
  } finally { f.dispose(); }
});

test('resume after seek preroll restarts at the retained cursor and preserves readiness gating', async () => {
  const f = fixture({ cursor: 240000 });
  try {
    f.p.pause(); await Promise.resolve(); await Promise.resolve();
    await f.p.play(f.context);
    f.state.sample = 240000; f.state.playing = false;
    f.context.getOutputTimestamp = () => ({ contextTime: f.state.contextTime - .184 });
    f.p.nextRead = 252000; f.update();
    assert.equal(f.presents.at(-1).time, 5);
    assert.equal(f.p.active, true); assert.equal(f.p.requested, true);
    assert.equal(f.commands.at(-1), true);
    f.picture.releaseFrames(); f.update();
    assert.equal(f.p.active, false); assert.equal(f.commands.at(-1), false);
  } finally { f.dispose(); }
});

test('a sustained rebuffer holds the current request and resumes after source preroll returns', () => {
  const f = fixture({ statusPlaying: false, nextRead: 588904 });
  try {
    f.p.active = false;
    for (let i = 0; i < 20; i++) {
      f.update();
      assert.equal(f.p.active, false); assert.equal(f.p.requested, true);
      assert.equal(f.presents.at(-1).target, 286);
    }
    f.p.nextRead = 612000; f.update();
    assert.equal(f.p.active, true); assert.deepEqual(f.commands, [true]);
  } finally { f.dispose(); }
});

test('underrun recovery retains the rendered clock and restarts only with ready video', () => {
  const f = fixture({ statusPlaying: false });
  try {
    f.state.underruns = 1; f.update();
    assert.equal(f.presents[0].target, 286); assert.equal(f.p.active, true);
    assert.deepEqual(f.commands, [false, true]);
  } finally { f.dispose(); }
});

test('dispose closes actual cached frame ownership and makes later updates inert', () => {
  const f = fixture(); f.update(); const count = f.presents.length;
  assert.deepEqual(f.dispose(), { roomDisposes: 1, textureDisposes: 1 });
  assert.equal(f.picture.frames.size, 0); assert.equal([...f.closes.values()].reduce((a, b) => a + b, 0), 8);
  f.update(); f.p.seek(5); f.p.pause(); f.p.dispose();
  assert.equal(f.presents.length, count);
});
