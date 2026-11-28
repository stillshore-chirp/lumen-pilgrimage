import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEventListeners } from 'node:events';
import { Group, PerspectiveCamera } from 'three';
import { MonitorAudio } from '../src/monitor/monitorAudio.ts';

class MockParam {
  value = 0;
  events = [];

  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  setValueAtTime(value, time) { this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); }
}

class MockNode {
  connections = [];
  outputs = [];
  disconnected = false;

  connect(node, output = 0) {
    this.connections.push(node);
    this.outputs.push(output);
    return node;
  }

  disconnect(node) {
    if (node) {
      const index = this.connections.indexOf(node);
      this.connections.splice(index, 1);
      this.outputs.splice(index, 1);
      return;
    }
    this.connections = [];
    this.outputs = [];
    this.disconnected = true;
  }
}

class MockTrack extends EventTarget {
  readyState = 'live';

  constructor(kind) {
    super();
    this.kind = kind;
  }

  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }

  getSettings() { return { channelCount: 2 }; }
}

class MockStream extends EventTarget {
  constructor(tracks) {
    super();
    this.tracks = tracks;
  }

  addTrack(track) {
    this.tracks.push(track);
    this.dispatchEvent(new Event('addtrack'));
  }

  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
}

function poseParams(...groups) {
  return Object.fromEntries(groups.flatMap(group =>
    ['X', 'Y', 'Z'].map(axis => [group + axis, new MockParam()])));
}

function setup(t, { spatial = true, blocked = false } = {}) {
  const contexts = [];
  class MockContext extends EventTarget {
    currentTime = 10;
    state = 'suspended';
    destination = new MockNode();
    listener = poseParams('position', 'forward', 'up');
    sources = [];
    gains = [];
    panners = [];
    splitters = [];
    filters = [];
    compressors = [];
    waveshapers = [];

    constructor() { super(); contexts.push(this); }

    async resume() {
      if (blocked) throw new Error('resume blocked');
      this.state = 'running';
    }

    async close() { this.state = 'closed'; }

    createMediaStreamSource(stream) {
      const source = Object.assign(new MockNode(), { stream });
      this.sources.push(source);
      return source;
    }

    createGain() {
      const gain = Object.assign(new MockNode(), { context: this, numberOfInputs: 1, gain: new MockParam() });
      this.gains.push(gain);
      return gain;
    }

    createPanner() {
      if (!spatial) throw new Error('spatial unavailable');
      const panner = Object.assign(new MockNode(), poseParams('position', 'orientation'));
      this.panners.push(panner);
      return panner;
    }

    createChannelSplitter(channels) {
      const splitter = Object.assign(new MockNode(), { channels });
      this.splitters.push(splitter);
      return splitter;
    }

    createBiquadFilter() {
      const filter = Object.assign(new MockNode(), { frequency: new MockParam(), Q: new MockParam() });
      this.filters.push(filter);
      return filter;
    }

    createDynamicsCompressor() {
      const compressor = Object.assign(new MockNode(), {
        threshold: new MockParam(),
        knee: new MockParam(),
        ratio: new MockParam(),
        attack: new MockParam(),
        release: new MockParam(),
      });
      this.compressors.push(compressor);
      return compressor;
    }

    createWaveShaper() {
      const waveshaper = Object.assign(new MockNode(), { curve: null });
      this.waveshapers.push(waveshaper);
      return waveshaper;
    }
  }

  const savedContext = globalThis.AudioContext;
  const savedStream = globalThis.MediaStream;
  globalThis.AudioContext = MockContext;
  globalThis.MediaStream = MockStream;
  const audio = new MonitorAudio();
  t.after(() => {
    audio.dispose();
    globalThis.AudioContext = savedContext;
    globalThis.MediaStream = savedStream;
  });
  return { audio, contexts };
}

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `expected ${expected}, got ${actual}`);
}

test('floating stereo keeps separate edge channels and reuses the shared owner while moving', async t => {
  const { audio, contexts } = setup(t);
  const monitor = new Group();
  monitor.position.set(3, 2, -4);
  monitor.scale.setScalar(2);
  const edges = [-1.35, 1.35].map(x => {
    const emitter = new Group();
    emitter.position.x = x;
    monitor.add(emitter);
    return emitter;
  });
  audio.setFloatingSpeakers(edges);
  audio.setMode('spatial');
  const track = new MockTrack('audio');
  audio.setStream(new MockStream([track]));
  await audio.start();
  audio.setMode('spatial');
  const [context] = contexts;
  const source = context.sources[0];
  const layout = source.connections.find(node => node.channelCount === 2 && node.channelInterpretation === 'speakers');
  assert.ok(layout);
  const splitter = layout.connections[0];
  assert.equal(splitter.channels, 2);
  assert.deepEqual(splitter.outputs, [0, 1]);
  const feeds = splitter.connections;
  assert.notEqual(feeds[0], feeds[1]);
  assert.ok(feeds.every(node => node.gain.value === Math.SQRT1_2));
  const pans = feeds.map(feed => feed.connections[0]);
  const headphone = source.connections.find(node => node !== layout);
  assert.equal(headphone.gain.value, 0, 'startup does not begin through the head-locked headphone route');
  assert.equal(pans[0].connections[0].gain.value, 1);
  assert.deepEqual(pans.map(pan => pan.positionX.value), [.2999999999999998, 5.7]);
  monitor.position.x += 2;
  audio.setFloatingSpeakers(edges);
  audio.update(new PerspectiveCamera(), monitor);
  near(pans[0].positionX.value, 2.3);
  near(pans[1].positionX.value, 7.7);
  assert.equal(context.sources.length, 1);
  assert.equal(source.stream.getAudioTracks()[0], track);
  assert.equal(track.readyState, 'live');
  audio.stop();
  assert.ok([layout, splitter, ...feeds, ...pans].every(node => node.disconnected));
});

test('world speaker selection and renderer failure keep the same track/source/context', async t => {
  const { audio, contexts } = setup(t);
  const calls = [];
  const definition = id => ({ id, label: id, createAudio(context, source, destination, channels) {
    const input = context.createGain();
    source.connect(input).connect(destination);
    const call = { id, input, upstream: source, destination, channels, disposed: 0, updates: 0, fail: false, throwOnDispose: false };
    calls.push(call);
    return { setQuality() {}, update() { call.updates++; if (call.fail) throw new Error('renderer failure'); },
      dispose() {
        call.disposed++;
        if (call.throwOnDispose) throw new Error('dispose failure');
        source.disconnect(input); input.disconnect();
      } };
  } });
  audio.setWorldOutputs([definition('atrium'), definition('cafe')]);
  audio.setMode('atrium');
  const track = new MockTrack('audio');
  audio.setStream(new MockStream([track]));
  await audio.start();
  const [context] = contexts;
  const source = context.sources[0];
  assert.ok(audio.supportsOutput('atrium') && audio.supportsOutput('cafe'));
  audio.setMode('atrium');
  assert.equal(calls[0].destination.gain.value, 1, 'the selected installation is audible on the initial graph');
  assert.equal(calls[1].destination.gain.value, 0);
  audio.setMode('cafe');
  assert.equal(audio.getMode(), 'cafe');
  calls[1].fail = true;
  calls[1].throwOnDispose = true;
  audio.update(new PerspectiveCamera(), new Group());
  assert.equal(audio.getMode(), 'stereo');
  assert.equal(calls[1].disposed, 1);
  assert.equal(calls[1].upstream.disconnected, true);
  assert.equal(calls[1].destination.disconnected, true);
  assert.equal(source.connections.includes(calls[1].upstream), false);
  assert.equal(calls[0].disposed, 0);
  calls[0].throwOnDispose = true;
  audio.setWorldOutputs([]);
  assert.equal(calls[0].disposed, 1);
  assert.equal(context.sources[0], source);
  assert.equal(contexts.length, 1);
  assert.equal(source.stream.getAudioTracks()[0], track);
  assert.equal(track.readyState, 'live');
});

test('initialization or update plus throwing disposal cannot strand the shared audio owner', async t => {
  const { audio, contexts } = setup(t);
  const calls = [];
  const factory = (id, failure) => (context, upstream, destination) => {
    const input = context.createGain();
    upstream.connect(input).connect(destination);
    const call = { id, upstream, input, destination, disposed: 0 };
    calls.push(call);
    return {
      setQuality() { if (failure === 'quality') throw new Error('quality failure'); },
      update() { if (failure === 'update') throw new Error('update failure'); },
      dispose() {
        call.disposed++;
        if (failure) throw new Error('dispose failure before cleanup');
        upstream.disconnect(input); input.disconnect();
      },
    };
  };
  audio.setCinema(factory('cinema-initial', 'quality'));
  audio.setWorldOutputs([
    { id: 'atrium', label: 'atrium', createAudio: factory('atrium', 'update') },
    { id: 'cafe', label: 'cafe', createAudio: factory('cafe') },
  ]);
  audio.setMode('cinema');
  const track = new MockTrack('audio');
  audio.setStream(new MockStream([track]));
  assert.equal(await audio.start(), true);
  const [context] = contexts;
  const source = context.sources[0];
  assert.equal(audio.getMode(), 'stereo');
  assert.equal(audio.supportsCinema(), false);
  assert.equal(audio.supportsOutput('atrium'), false);
  assert.equal(audio.supportsOutput('cafe'), true);
  for (const call of calls.filter(call => call.id !== 'cafe')) {
    assert.equal(call.disposed, 1);
    assert.equal(call.upstream.disconnected, true);
    assert.equal(call.destination.disconnected, true);
    assert.equal(source.connections.includes(call.upstream), false);
  }
  audio.setCinema(factory('cinema-update', 'update'));
  audio.setMode('cinema');
  audio.update(new PerspectiveCamera(), new Group());
  assert.equal(audio.getMode(), 'stereo');
  assert.equal(calls.at(-1).disposed, 1);
  assert.equal(calls.at(-1).upstream.disconnected, true);
  audio.setMode('cafe');
  assert.equal(audio.getMode(), 'cafe');
  assert.equal(context.sources[0], source);
  assert.equal(contexts.length, 1);
  audio.stop();
  assert.ok(calls.every(call => call.disposed === 1));
  assert.equal(context.state, 'closed');
  assert.equal(source.disconnected, true);
  assert.equal(track.readyState, 'live');
});

test('attaches late shared audio to one private graph and frees it on replacement, end and stop', async t => {
  const { audio, contexts } = setup(t);
  const video = new MockTrack('video');
  const first = new MockTrack('audio');
  const stream = new MockStream([video]);
  audio.setStream(stream);
  assert.equal(audio.getStatus(), 'idle');
  assert.deepEqual(contexts, []);
  assert.equal(await audio.start(), true);
  assert.equal(audio.getStatus(), 'ready');
  const [context] = contexts;
  assert.deepEqual(context.sources, []);

  stream.addTrack(first);
  const [source] = context.sources;
  const [master, stereo, spatial] = context.gains;
  const [limiter] = context.compressors;
  const [ceiling] = context.waveshapers;
  const trim = context.gains.at(-1);
  const [panner] = context.panners;
  assert.deepEqual(source.stream.tracks, [first]);
  assert.deepEqual(source.connections, [stereo, panner]);
  assert.deepEqual(panner.connections, [spatial]);
  assert.deepEqual(stereo.connections, [master]);
  assert.deepEqual(spatial.connections, [master]);
  assert.deepEqual(master.connections, [trim]);
  assert.deepEqual(trim.connections, [limiter]);
  assert.deepEqual(limiter.connections, [ceiling]);
  assert.deepEqual(ceiling.connections, [context.destination]);
  assert.equal(master.gain.value, 0);
  assert.deepEqual(master.gain.events.at(-1), ['ramp', 0.5625, 10.08]);
  assert.equal(stereo.gain.value, 1);
  assert.equal(spatial.gain.value, 0);

  audio.setStream(stream);
  assert.equal(await audio.start(), true);
  assert.equal(contexts.length, 1);
  assert.equal(context.sources.length, 1);

  const second = new MockTrack('audio');
  const otherStream = new MockStream([video, second]);
  audio.setStream(otherStream);
  assert.equal(first.readyState, 'live');
  assert.equal(context.sources.length, 2);
  assert.ok([source, master, trim, limiter, ceiling, stereo, panner, spatial].every(node => node.disconnected));
  stream.addTrack(new MockTrack('audio'));
  assert.equal(context.sources.length, 2);

  second.end();
  assert.ok(context.sources[1].disconnected);
  const third = new MockTrack('audio');
  otherStream.addTrack(third);
  audio.stop();
  assert.ok(context.sources[2].disconnected);
  assert.equal(third.readyState, 'live');
  assert.equal(context.state, 'closed');
  assert.equal(audio.getStatus(), 'idle');
  assert.equal(await audio.start(), true);
  assert.equal(contexts.length, 2);
  assert.deepEqual(contexts[1].sources, []);
  audio.dispose();
  assert.equal(contexts[1].state, 'closed');
  assert.equal(await audio.start(), false);
});

function providerFixture({ reject = () => false, invalid = () => false } = {}) {
  const calls = [];
  const factory = (context, destination, emitters) => {
    const inputs = emitters.map(() => context.createGain());
    const dry = context.createGain();
    const late = context.createGain();
    const owned = [...inputs, dry, late];
    inputs.forEach(input => { input.connect(dry); input.connect(late); });
    dry.connect(destination);
    late.connect(destination);
    const call = {
      context, destination, emitters, inputs, owned, qualities: [], poses: [], disposed: 0,
      initialListener: [context.listener.positionX.value, context.listener.positionY.value, context.listener.positionZ.value],
    };
    calls.push(call);
    const playback = {
      inputs: invalid(emitters) ? inputs.slice(1) : inputs,
      setQuality(quality) { call.qualities.push(quality); },
      update(camera) {
        assert.equal(call.disposed, 0);
        const position = camera.getWorldPosition(camera.position.clone());
        call.poses.push(position.toArray());
        assert.equal(inputs.some(input => context.sources[0].connections.includes(input)), false);
      },
      dispose() {
        if (call.disposed) return;
        call.disposed++;
        owned.forEach(node => node.disconnect());
      },
    };
    if (reject(emitters)) { playback.dispose(); throw new Error('provider unavailable'); }
    return playback;
  };
  return { factory, calls };
}

function routeReaches(node, target, seen = new Set()) {
  if (node === target) return true;
  if (seen.has(node)) return false;
  seen.add(node);
  return node.connections.some(next => routeReaches(next, target, seen));
}

test('world playback owns no media and receives initialized poses/quality before attachment', async t => {
  const { audio, contexts } = setup(t);
  const camera = new PerspectiveCamera();
  camera.position.set(20, 1.6, -3);
  const parent = new Group();
  parent.position.set(17, .1, -5);
  parent.rotation.y = .3;
  const display = new Group();
  display.position.set(2, 1.3, -1);
  parent.add(display);
  const speakers = Array.from({ length: 6 }, (_, i) => {
    const object = new Group(); object.position.set(18 + i, 1.2, -6); return object;
  });
  const fixture = providerFixture();
  audio.setPlaybackSpace(fixture.factory, speakers, camera, display, 'high');
  audio.setMode('television');
  const track = new MockTrack('audio');
  const stream = new MockStream([track]);
  audio.setStream(stream);
  assert.equal(await audio.start(), true);
  const [context] = contexts;
  const [source] = context.sources;
  assert.equal(context.panners.length, 0, 'the legacy distance/HRTF Panners are not in series');
  assert.equal(fixture.calls.length, 2);
  const single = fixture.calls.find(call => call.inputs.length === 1);
  const surround = fixture.calls.find(call => call.inputs.length === 6);
  assert.deepEqual(single.initialListener, camera.position.toArray());
  assert.deepEqual(single.qualities, ['high']);
  assert.deepEqual(single.poses, [camera.position.toArray()]);
  assert.notEqual(single.emitters[0].object, display, 'provider receives a plain pose, not a world-owned object');
  assert.deepEqual(single.emitters[0].object.getWorldPosition(display.position.clone()).toArray(),
    display.getWorldPosition(display.position.clone()).toArray());
  assert.deepEqual(surround.emitters.map(({ id, band }) => [id, band]),
    ['L', 'R', 'C', 'LFE', 'SL', 'SR'].map(id => [id, id === 'LFE' ? 'lfe' : 'fullrange']));
  const mono = source.connections.find(node => node.channelCount === 1);
  const layout = source.connections.find(node => node.channelCount === 6);
  assert.deepEqual([mono.channelCountMode, mono.channelInterpretation], ['explicit', 'speakers']);
  assert.deepEqual([layout.channelCountMode, layout.channelInterpretation], ['explicit', 'speakers']);
  assert.deepEqual(mono.connections, single.inputs);
  const [splitter] = context.splitters;
  const [lfe] = context.filters;
  assert.equal(context.filters.length, 1);
  assert.equal(lfe.frequency.value, 120);
  assert.deepEqual(splitter.outputs, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(splitter.connections, [...surround.inputs.slice(0, 3), lfe, ...surround.inputs.slice(4)]);
  assert.deepEqual(lfe.connections, [surround.inputs[3]]);
  const master = context.gains[0];
  assert.ok(fixture.calls.every(call => call.owned.every(node => routeReaches(node, call.destination))));
  assert.ok(fixture.calls.every(call => routeReaches(call.destination, master)));
  audio.setMasterVolume(0);
  assert.deepEqual(master.gain.events.at(-1), ['ramp', 0, 10.08]);
  audio.setMode('surround');
  assert.deepEqual(surround.destination.gain.events.at(-1), ['ramp', 1, 10.12]);
  assert.deepEqual(single.destination.gain.events.at(-1), ['ramp', 0, 10.12]);
  camera.position.x += 2;
  audio.update(camera, display);
  assert.equal(context.listener.positionX.value, camera.position.x, 'provider-only graph still updates the shared listener');
  assert.ok(fixture.calls.every(call => call.poses.at(-1)[0] === camera.position.x));
  audio.setWorldQuality('light');
  assert.ok(fixture.calls.every(call => call.qualities.at(-1) === 'light'));

  const oldUpdates = fixture.calls.map(call => call.poses.length);
  const next = providerFixture();
  const nextCamera = new PerspectiveCamera(); nextCamera.position.set(-8, 1.5, 6);
  const nextDisplay = new Group(); nextDisplay.position.set(-9, 1.7, 3);
  audio.setPlaybackSpace(next.factory, null, nextCamera, nextDisplay, 'high');
  assert.ok(fixture.calls.every(call => call.disposed === 1 && call.owned.every(node => node.disconnected)));
  assert.deepEqual(fixture.calls.map(call => call.poses.length), oldUpdates);
  assert.deepEqual(next.calls[0].initialListener, nextCamera.position.toArray());
  assert.deepEqual(next.calls[0].qualities, ['high']);
  assert.deepEqual(context.sources, [source]);
  assert.equal(contexts.length, 1);
  assert.equal(source.stream.tracks[0], track);
  assert.equal(track.readyState, 'live');
  assert.equal(context.gains[0], master);
  audio.setPlaybackSpace(next.factory, null, nextCamera, nextDisplay, 'high');
  assert.equal(next.calls.length, 1, 'same binding does not allocate another renderer');
  audio.setPlaybackSpace(null, null, nextCamera, nextDisplay, 'light');
  assert.equal(next.calls[0].disposed, 1);
  assert.equal(context.panners.length, 1, 'other worlds recover the original spatial renderer');
  track.end();
  assert.equal(source.disconnected, true);
});

test('a rejected world branch falls back atomically without discarding a successful sibling', async t => {
  const { audio, contexts } = setup(t);
  const camera = new PerspectiveCamera();
  const display = new Group();
  const speakers = Array.from({ length: 6 }, () => new Group());
  const fixture = providerFixture({ invalid: emitters => emitters.length === 1 });
  audio.setPlaybackSpace(fixture.factory, speakers, camera, display, 'light');
  audio.setMode('television');
  audio.setStream(new MockStream([new MockTrack('audio')]));
  await audio.start();
  const [context] = contexts;
  const source = context.sources[0];
  const stereo = source.connections.find(node => node.channelCount === 2);
  assert.equal(audio.getMode(), 'stereo');
  assert.equal(audio.supportsSpatial(), false);
  assert.equal(audio.supportsSurround(), true);
  assert.equal(stereo.gain.events.at(-1)?.[1] ?? stereo.gain.value, 1);
  const failed = fixture.calls.find(call => call.inputs.length === 1);
  const success = fixture.calls.find(call => call.inputs.length === 6);
  assert.equal(failed.disposed, 1);
  assert.equal(success.disposed, 0);
  audio.setMode('surround');
  assert.equal(audio.getMode(), 'surround');
  assert.deepEqual(success.destination.gain.events.at(-1), ['ramp', 1, 10.12]);
  audio.dispose();
  audio.dispose();
  assert.equal(success.disposed, 1);
  assert.equal(failed.disposed, 1);
});

test('world update failure removes only its owned branch and restores headphone stereo', async t => {
  const { audio, contexts } = setup(t);
  const camera = new PerspectiveCamera();
  const display = new Group();
  const fixture = providerFixture();
  let fail = false;
  const factory = (...args) => {
    const playback = fixture.factory(...args);
    const update = playback.update;
    playback.update = listener => { if (fail) throw new Error('inactive renderer'); update(listener); };
    return playback;
  };
  audio.setPlaybackSpace(factory, null, camera, display, 'light');
  audio.setMode('spatial');
  audio.setStream(new MockStream([new MockTrack('audio')]));
  await audio.start();
  fail = true;
  audio.update(camera, display);
  assert.equal(audio.getMode(), 'stereo');
  assert.equal(audio.supportsSpatial(), false);
  assert.equal(fixture.calls[0].disposed, 1);
  const source = contexts[0].sources[0];
  assert.equal(source.connections.length, 1);
  assert.equal(source.connections[0].channelCount, 2);
  assert.deepEqual(source.connections[0].gain.events.slice(-2), [['cancel', 10], ['set', 1, 10]]);
  assert.equal(source.disconnected, false);
});

test('throwing and foreign-context providers clean partial handles while the stream remains usable', async t => {
  const { audio, contexts } = setup(t);
  const camera = new PerspectiveCamera();
  const display = new Group();
  const speakers = Array.from({ length: 6 }, () => new Group());
  const rejected = providerFixture({ reject: emitters => emitters.length === 6 });
  audio.setPlaybackSpace(rejected.factory, speakers, camera, display, 'light');
  audio.setMode('surround');
  const first = new MockTrack('audio');
  audio.setStream(new MockStream([first]));
  await audio.start();
  assert.equal(audio.getMode(), 'stereo');
  assert.equal(audio.supportsSpatial(), true);
  assert.equal(audio.supportsSurround(), false);
  assert.equal(rejected.calls.find(call => call.inputs.length === 6).disposed, 1);
  assert.equal(rejected.calls.find(call => call.inputs.length === 1).disposed, 0);
  const foreign = providerFixture();
  const factory = (...args) => {
    const handle = foreign.factory(...args);
    handle.inputs[0].context = {};
    return handle;
  };
  audio.setPlaybackSpace(factory, null, camera, display, 'light');
  assert.equal(audio.supportsSpatial(), false);
  assert.equal(foreign.calls[0].disposed, 1);
  assert.equal(contexts[0].sources.length, 1);
  assert.equal(first.readyState, 'live');
  const good = providerFixture();
  audio.setPlaybackSpace(good.factory, null, camera, display, 'light');
  const second = new MockTrack('audio');
  audio.setStream(new MockStream([second]));
  assert.equal(good.calls[0].disposed, 1);
  assert.equal(good.calls[1].disposed, 0);
  assert.equal(first.readyState, 'live');
  second.end();
  assert.equal(good.calls[1].disposed, 1);
  audio.stop();
  assert.ok(good.calls.every(call => call.disposed === 1));
});

test('the optional world renderer leaves cinema ownership and headphone stereo independent', async t => {
  const { audio, contexts } = setup(t);
  const camera = new PerspectiveCamera();
  const display = new Group();
  const world = providerFixture();
  const cinema = [];
  audio.setPlaybackSpace(world.factory, null, camera, display, 'light');
  audio.setCinema((context, source, output, channels) => {
    const input = context.createGain();
    source.connect(input).connect(output);
    const record = { channels, output, disposed: 0 };
    cinema.push(record);
    return { update() {}, setQuality() {}, dispose() { source.disconnect(input); input.disconnect(); record.disposed++; } };
  });
  audio.setStream(new MockStream([new MockTrack('audio')]));
  await audio.start();
  audio.setMode('cinema');
  assert.equal(cinema.length, 1);
  assert.equal(cinema[0].channels, 2);
  assert.equal(audio.getMode(), 'cinema');
  assert.deepEqual(cinema[0].output.gain.events.at(-1), ['ramp', 1, 10.12]);
  audio.setPlaybackSpace(null, null, camera, display, 'high');
  assert.equal(world.calls[0].disposed, 1);
  assert.equal(cinema[0].disposed, 0);
  assert.equal(audio.getMode(), 'cinema');
  const source = contexts[0].sources[0];
  const stereo = source.connections.find(node => node.channelCount === 2);
  audio.setMode('stereo');
  assert.deepEqual(stereo.gain.events.at(-1), ['ramp', 1, 10.12]);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].sources.length, 1);
  audio.dispose();
  assert.equal(cinema[0].disposed, 1);
});

test('a short world output handoff preserves media and restores the latest user mix', async t => {
  const { audio, contexts } = setup(t);
  const camera = new PerspectiveCamera(), display = new Group();
  const original = providerFixture();
  audio.setPlaybackSpace(original.factory, null, camera, display, 'light');
  audio.setMode('spatial');
  const track = new MockTrack('audio'); audio.setStream(new MockStream([track]));
  await audio.start();
  const context = contexts[0], source = context.sources[0], master = context.gains[0];
  context.currentTime = 11;
  const pending = audio.prepareWorldChange(new AbortController().signal);
  assert.deepEqual(master.gain.events.at(-1), ['ramp', 0, 11.024]);
  assert.equal(original.calls[0].disposed, 0, 'the old renderer remains valid until the synchronous swap');
  audio.setVolume(.4); audio.setMasterVolume(1.5);
  assert.equal(master.gain.events.at(-1)[1], 0);
  const finish = await pending;
  const next = providerFixture();
  context.currentTime = 11.032;
  audio.setPlaybackSpace(next.factory, null, camera, display, 'high');
  assert.equal(original.calls[0].disposed, 1);
  assert.equal(context.sources[0], source);
  assert.equal(context.gains[0], master);
  finish(); finish();
  const event = master.gain.events.at(-1);
  assert.equal(event[0], 'ramp'); near(event[1], .4 * 1.5 * .75); near(event[2], 11.056);
  assert.equal(track.readyState, 'live');
  assert.equal(contexts.length, 1);
});

for (const reason of [undefined, null]) test(`aborted/stale world handoffs preserve mute and stop with ${reason === null ? 'null' : 'default'} reason`, async t => {
  const { audio, contexts } = setup(t);
  audio.setPlaybackSpace(providerFixture().factory, null, new PerspectiveCamera(), new Group(), 'light');
  audio.setMode('spatial');
  const track = new MockTrack('audio'), stream = new MockStream([track]);
  audio.setStream(stream); await audio.start();
  const context = contexts[0], master = context.gains[0], source = context.sources[0];
  context.currentTime = 11;
  const first = audio.prepareWorldChange(new AbortController().signal);
  const abort = new AbortController();
  const second = audio.prepareWorldChange(abort.signal);
  const staleFinish = await first;
  const before = master.gain.events.length;
  staleFinish();
  assert.equal(master.gain.events.length, before, 'an older caller cannot release the current handoff');
  audio.setEnabled(false);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 1);
  assert.equal(getEventListeners(context, 'statechange').length, 1);
  abort.abort(reason);
  const finish = await second; finish();
  assert.equal(abort.signal.aborted, true);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  assert.equal(getEventListeners(context, 'statechange').length, 0);
  if (reason === null) assert.equal(abort.signal.reason, null);
  else assert.equal(abort.signal.reason.name, 'AbortError');
  assert.equal(master.gain.events.at(-1)[1], 0, 'cancelled world loading preserves a user mute');
  assert.equal(context.sources[0], source);
  assert.equal(source.stream.getAudioTracks()[0], track);
  assert.equal(track.readyState, 'live');
  assert.equal(contexts.length, 1);
  audio.setEnabled(true);
  const last = audio.prepareWorldChange(new AbortController().signal);
  audio.stop();
  const afterStop = master.gain.events.length;
  (await last)();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(master.gain.events.length, afterStop);
  assert.equal(context.state, 'closed');
});

test('unchanged stereo/spatial routes and inaudible playback skip the world handoff', async t => {
  const { audio, contexts } = setup(t);
  const camera = new PerspectiveCamera(), display = new Group();
  const signal = new AbortController().signal;
  (await audio.prepareWorldChange(signal))();
  assert.equal(contexts.length, 0);
  const fixture = providerFixture();
  audio.setPlaybackSpace(fixture.factory, null, camera, display, 'light');
  audio.setStream(new MockStream([new MockTrack('audio')])); await audio.start();
  const master = contexts[0].gains[0];
  const noNewAutomation = async (factory = null) => {
    const count = master.gain.events.length;
    (await audio.prepareWorldChange(signal, factory))();
    assert.equal(master.gain.events.length, count);
  };
  await noNewAutomation();
  audio.setMode('spatial'); await noNewAutomation(fixture.factory);
  audio.setEnabled(false); await noNewAutomation();
  audio.setEnabled(true); audio.setVolume(0); await noNewAutomation();
  audio.setVolume(1); audio.setMasterVolume(0); await noNewAutomation();
  audio.setMasterVolume(1); audio.setPlaybackSpace(null, null, camera, display, 'light');
  audio.setMode('spatial'); await noNewAutomation();
});

test('level and playback enablement ramp independently of the complementary mode fade', async t => {
  const { audio, contexts } = setup(t);
  audio.setStream(new MockStream([new MockTrack('audio')]));
  await audio.start();
  const [context] = contexts;
  const [master, stereo, spatial] = context.gains.map(node => node.gain);

  context.currentTime = 11;
  audio.setMasterVolume(2);
  near(master.events.at(-1)[1], 1.125);
  audio.setVolume(0.8);
  near(master.events.at(-1)[1], 1.2);
  context.currentTime += 0.04;
  audio.setEnabled(false);
  near(master.events.at(-2)[1], (0.5625 + 1.2) / 2);
  assert.equal(master.events.at(-1)[1], 0);
  audio.setVolume(2);
  assert.equal(master.events.at(-1)[1], 0);

  audio.setEnabled(true);
  assert.equal(master.events.at(-1)[1], 1.5);
  audio.setMasterVolume(1);
  assert.equal(master.events.at(-1)[1], 0.75);
  const masterEvents = master.events.length;

  context.currentTime = 12;
  audio.setMode('spatial');
  assert.deepEqual(stereo.events.at(-1), ['ramp', 0, 12.12]);
  assert.deepEqual(spatial.events.at(-1), ['ramp', 1, 12.12]);
  context.currentTime += 0.06;
  audio.setMode('stereo');
  near(stereo.events.at(-2)[1], 0.5);
  near(spatial.events.at(-2)[1], 0.5);
  assert.equal(stereo.events.at(-1)[1], 1);
  assert.equal(spatial.events.at(-1)[1], 0);
  assert.equal(master.events.length, masterEvents);
});

test('master multiplier is clamped, composes with local volume and survives late stream attachment', async t => {
  const { audio, contexts } = setup(t);
  audio.setMasterVolume(2);
  audio.setVolume(0.4);
  audio.setStream(new MockStream([new MockTrack('audio')]));
  await audio.start();
  const [context] = contexts;
  const master = context.gains[0].gain;
  near(master.events.at(-1)[1], 0.6);

  audio.setMasterVolume(4);
  near(master.events.at(-1)[1], 0.9);
  audio.setEnabled(false);
  assert.equal(master.events.at(-1)[1], 0);
  audio.setMasterVolume(0.5);
  assert.equal(master.events.at(-1)[1], 0);
  audio.setEnabled(true);
  near(master.events.at(-1)[1], 0.15);
  audio.setMasterVolume(Number.POSITIVE_INFINITY);
  near(master.events.at(-1)[1], 0.15);
  audio.setMasterVolume(-1);
  assert.equal(master.events.at(-1)[1], 0);
});

test('HRTF uses the camera and monitor world positions and their respective viewing axes', async t => {
  const { audio, contexts } = setup(t);
  audio.setStream(new MockStream([new MockTrack('audio')]));
  await audio.start();
  const [context] = contexts;
  const [panner] = context.panners;
  assert.equal(panner.panningModel, 'HRTF');
  assert.equal(panner.distanceModel, 'inverse');
  assert.ok(panner.refDistance > 0 && panner.coneOuterGain < 1);

  const rig = new Group();
  rig.position.set(20, 5, -10);
  rig.rotation.y = Math.PI / 2;
  const camera = new PerspectiveCamera();
  camera.position.set(1, 2, 3);
  rig.add(camera);
  const monitor = new Group();
  monitor.position.set(-2, 1, 0);
  rig.add(monitor);

  audio.update(camera, monitor);
  const listener = context.listener;
  near(listener.positionX.value, 23);
  near(listener.positionY.value, 7);
  near(listener.positionZ.value, -11);
  near(listener.forwardX.value, -1);
  near(listener.forwardZ.value, 0);
  near(listener.upY.value, 1);
  near(panner.positionX.value, 20);
  near(panner.positionY.value, 6);
  near(panner.positionZ.value, -8);
  near(panner.orientationX.value, 1);
  near(panner.orientationZ.value, 0);
});

test('reports a blocked context and keeps stereo available when HRTF is unavailable', async t => {
  const { audio, contexts } = setup(t, { spatial: false, blocked: true });
  audio.setMode('spatial');
  audio.setStream(new MockStream([new MockTrack('audio')]));
  assert.equal(await audio.start(), false);
  assert.equal(audio.getStatus(), 'gesture-required');
  assert.equal(audio.supportsSpatial(), false);
  const [context] = contexts;
  audio.setMasterVolume(2);
  assert.equal(context.state, 'suspended');
  assert.equal(audio.getStatus(), 'gesture-required');
  const [master, stereo] = context.gains;
  assert.equal(stereo.gain.value, 1);
  assert.deepEqual(context.sources[0].connections, [stereo]);
  assert.deepEqual(stereo.connections, [master]);
  context.resume = async () => { context.state = 'running'; };
  assert.equal(await audio.start(), true);
  assert.equal(audio.getStatus(), 'ready');
});

test('routes L, R, C, LFE, SL and SR to the fixed speakers and frees them on departure', async t => {
  const { audio, contexts } = setup(t);
  const speakers = Array.from({ length: 6 }, (_, index) => {
    const object = new Group();
    object.position.set(index + 1, 1.2, -2 * index);
    return object;
  });
  audio.setStream(new MockStream([new MockTrack('audio')]));
  await audio.start();
  const [context] = contexts;
  const [source] = context.sources;
  const [master, stereo, spatial] = context.gains;
  const [screen] = context.panners;
  audio.setTheaterSpeakers(speakers);
  assert.equal(audio.supportsSurround(), true);
  const [layout, surround] = context.gains.slice(4);
  const [splitter] = context.splitters;
  const [filter] = context.filters;
  const positions = context.panners.slice(1);
  assert.equal(layout.channelCount, 6);
  assert.equal(layout.channelCountMode, 'explicit');
  assert.equal(layout.channelInterpretation, 'speakers');
  assert.deepEqual(layout.connections, [splitter]);
  assert.equal(splitter.channels, 6);
  assert.deepEqual(splitter.outputs, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(splitter.connections, [...positions.slice(0, 3), filter, ...positions.slice(4)]);
  assert.equal(filter.type, 'lowpass');
  assert.equal(filter.frequency.value, 120);
  assert.deepEqual(filter.connections, [positions[3]]);
  assert.deepEqual(positions.map(panner => [panner.positionX.value, panner.positionY.value, panner.positionZ.value]),
    speakers.map(speaker => speaker.position.toArray()));
  assert.ok(positions.every(panner => panner.panningModel === 'HRTF' && panner.connections[0] === surround));
  assert.deepEqual(surround.connections, [master]);

  audio.setMode('surround');
  assert.deepEqual(surround.gain.events.at(-1), ['ramp', 1, 10.12]);
  assert.deepEqual(stereo.gain.events.at(-1), ['ramp', 0, 10.12]);
  assert.equal(spatial.gain.value, 0);

  context.currentTime = 11;
  audio.setMode('television');
  assert.deepEqual(spatial.gain.events.at(-1), ['ramp', 1, 11.12]);
  assert.deepEqual(surround.gain.events.at(-1), ['ramp', 0, 11.12]);
  audio.setMode('surround');
  const masterEvents = master.gain.events.length;
  audio.setMode('stereo', 0);
  audio.setTheaterSpeakers(null);
  assert.equal(audio.supportsSurround(), false);
  assert.ok([layout, splitter, filter, ...positions, surround].every(node => node.disconnected));
  assert.deepEqual(source.connections, [stereo, screen]);
  assert.deepEqual(stereo.gain.events.slice(-2), [['cancel', 11], ['set', 1, 11]]);
  assert.equal(master.gain.events.length, masterEvents);
  assert.deepEqual(context.sources, [source]);
});
