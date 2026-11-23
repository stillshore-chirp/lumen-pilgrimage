import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  disconnected = false;

  connect(node) {
    this.connections.push(node);
    return node;
  }

  disconnect() {
    this.connections = [];
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
  class MockContext {
    currentTime = 10;
    state = 'suspended';
    destination = new MockNode();
    listener = poseParams('position', 'forward', 'up');
    sources = [];
    gains = [];
    panners = [];

    constructor() { contexts.push(this); }

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
      const gain = Object.assign(new MockNode(), { gain: new MockParam() });
      this.gains.push(gain);
      return gain;
    }

    createPanner() {
      if (!spatial) throw new Error('spatial unavailable');
      const panner = Object.assign(new MockNode(), poseParams('position', 'orientation'));
      this.panners.push(panner);
      return panner;
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
  const [panner] = context.panners;
  assert.deepEqual(source.stream.tracks, [first]);
  assert.deepEqual(source.connections, [stereo, panner]);
  assert.deepEqual(panner.connections, [spatial]);
  assert.deepEqual(stereo.connections, [master]);
  assert.deepEqual(spatial.connections, [master]);
  assert.deepEqual(master.connections, [context.destination]);
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
  assert.ok([source, master, stereo, panner, spatial].every(node => node.disconnected));
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

test('level, mute and output routing ramp independently of the complementary mode fade', async t => {
  const { audio, contexts } = setup(t);
  audio.setStream(new MockStream([new MockTrack('audio')]));
  await audio.start();
  const [context] = contexts;
  const [master, stereo, spatial] = context.gains.map(node => node.gain);

  context.currentTime = 11;
  audio.setVolume(0.8);
  near(master.events.at(-1)[1], 0.6);
  context.currentTime += 0.04;
  audio.setMuted(true);
  near(master.events.at(-2)[1], (0.5625 + 0.6) / 2);
  assert.equal(master.events.at(-1)[1], 0);
  audio.setVolume(2);
  assert.equal(master.events.at(-1)[1], 0);

  audio.setEnabled(false);
  audio.setMuted(false);
  assert.equal(master.events.at(-1)[1], 0);
  audio.setEnabled(true);
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
  const [master, stereo] = context.gains;
  assert.equal(stereo.gain.value, 1);
  assert.deepEqual(context.sources[0].connections, [stereo]);
  assert.deepEqual(stereo.connections, [master]);
  context.resume = async () => { context.state = 'running'; };
  assert.equal(await audio.start(), true);
  assert.equal(audio.getStatus(), 'ready');
});
