import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MonitorReceiver, MonitorSender } from '../src/monitor/monitorSession.ts';

class Track extends EventTarget {
  readyState = 'live';
  enabled = true;

  constructor(kind) {
    super();
    this.kind = kind;
  }

  stop() {
    this.readyState = 'ended';
  }

  end() {
    this.stop();
    this.dispatchEvent(new Event('ended'));
  }
}

class Stream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
  addTrack(track) { this.tracks.push(track); }
}

function installTransport(t) {
  const peers = [];
  class Peer extends EventTarget {
    iceGatheringState = 'new';
    connectionState = 'new';
    remoteDescription = null;
    transceivers = [];

    constructor(options) {
      super();
      assert.deepEqual(options, { iceServers: [] });
      peers.push(this);
    }

    addTransceiver(track, options) {
      this.transceivers.push({ track, options });
    }

    async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
    async createAnswer() { return { type: 'answer', sdp: 'v=0' }; }
    async setRemoteDescription(description) { this.remoteDescription = description; }

    async setLocalDescription(description) {
      this.localDescription = description;
      this.iceGatheringState = 'gathering';
    }

    finishIce() {
      this.iceGatheringState = 'complete';
      this.localDescription.sdp += '\r\na=candidate:local';
      this.dispatchEvent(new Event('icegatheringstatechange'));
    }

    receive(track) {
      this.dispatchEvent(Object.assign(new Event('track'), { track }));
    }

    setConnectionState(state) {
      this.connectionState = state;
      this.dispatchEvent(new Event('connectionstatechange'));
    }

    close() { this.setConnectionState('closed'); }
  }

  for (const [name, value] of [['RTCPeerConnection', Peer], ['MediaStream', Stream]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  return peers;
}

function installSignaling(t, initial = {}) {
  let snapshot = { revision: 1, phase: 'waiting', audio: { available: false, output: 'both' }, ...initial };
  const pending = new Set();
  const calls = [];
  const overrides = {};
  function publish(changes) {
    snapshot = { ...snapshot, revision: snapshot.revision + 1, ...changes };
    for (const resume of pending) resume();
    pending.clear();
  }

  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /^\/api\/virtual-monitor\//);
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    const action = url.split('/').pop();
    const payload = JSON.parse(options.body);
    calls.push({ action, payload, options });
    if (overrides[action]) await overrides[action](payload);
    switch (action) {
      case 'create':
        return Response.json({ sessionId: 'session', token: 'sender-token', code: 'AAAA-BBBB-CCCC', snapshot });
      case 'join':
        return Response.json({ sessionId: payload.code, token: 'viewer-token', snapshot });
      case 'audio': publish({ audio: payload.audio }); break;
      case 'approve': publish({ phase: payload.accept ? 'approved' : 'closed' }); break;
      case 'offer': publish({ offer: payload.description }); break;
      case 'answer': publish({ answer: payload.description }); break;
      case 'close': publish({ phase: 'closed' }); break;
      case 'poll':
        options.signal.throwIfAborted();
        if (snapshot.revision === payload.revision) {
          await new Promise((resolve, reject) => {
            const abort = () => {
              pending.delete(resume);
              reject(options.signal.reason);
            };
            const resume = () => {
              options.signal.removeEventListener('abort', abort);
              resolve();
            };
            pending.add(resume);
            options.signal.addEventListener('abort', abort, { once: true });
          });
        }
        break;
    }
    return Response.json({ snapshot });
  });
  return { calls, overrides, publish };
}

async function until(condition, description) {
  for (let turn = 0; turn < 30; turn += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(description);
}

test('sender waits for one approval and gathers LAN candidates before sharing', async (t) => {
  const peers = installTransport(t);
  const { calls, publish } = installSignaling(t);
  const states = [];
  const sender = new MonitorSender({ onState: (state) => states.push(state) });
  t.after(() => sender.stop());
  const video = new Track('video');
  const audio = new Track('audio');
  await sender.start(new Stream([video, audio]), { available: true, output: 'pc' });
  assert.equal(states.at(-1).code, 'AAAA-BBBB-CCCC');
  assert.equal(audio.enabled, false);
  assert.equal(peers.length, 0);

  publish({ phase: 'pending', verification: '123456' });
  await until(() => states.at(-1).phase === 'approval', 'approval state missing');
  assert.equal(states.at(-1).verification, '123456');
  assert.equal(peers.length, 0);
  await Promise.all([sender.decide(true), sender.decide(false)]);
  assert.deepEqual(calls.filter(({ action }) => action === 'approve').map(({ payload }) => payload.accept), [true]);
  await until(() => peers[0]?.iceGatheringState === 'gathering', 'ICE gathering did not start');
  assert.ok(calls.every(({ action }) => action !== 'offer'));
  assert.deepEqual(peers[0].transceivers.map(({ track, options }) => [track.kind, options.direction]), [
    ['video', 'sendonly'], ['audio', 'sendonly'],
  ]);

  peers[0].finishIce();
  await until(() => calls.some(({ action }) => action === 'offer'), 'offer was not sent');
  const offer = calls.find(({ action }) => action === 'offer');
  assert.match(offer.payload.description.sdp, /a=candidate:/);
  assert.equal(offer.options.headers.Authorization, 'Bearer sender-token');
  publish({ answer: { type: 'answer', sdp: 'v=0' } });
  await until(() => peers[0].remoteDescription?.type === 'answer', 'remote answer was not applied');
  peers[0].setConnectionState('connected');
  assert.equal(states.at(-1).phase, 'connected');

  await sender.updateAudio({ available: true, output: 'viewer' });
  assert.equal(audio.enabled, true);
  audio.end();
  await until(() => calls.filter(({ action }) => action === 'audio').at(-1).payload.audio.available === false, 'audio end was not signaled');
  assert.equal(video.readyState, 'live');

  video.end();
  assert.equal(states.at(-1).phase, 'ended');
  assert.equal(peers[0].connectionState, 'closed');
  assert.equal(calls.at(-1).action, 'close');
  assert.equal(calls.at(-1).options.keepalive, true);
});

test('denying a viewer stops capture and does not open a peer', async (t) => {
  const peers = installTransport(t);
  const { publish } = installSignaling(t);
  const states = [];
  const sender = new MonitorSender({ onState: (state) => states.push(state) });
  t.after(() => sender.stop());
  const video = new Track('video');
  await sender.start(new Stream([video]), { available: true, output: 'both' });
  assert.equal(states.at(-1).audio.available, false);
  publish({ phase: 'pending', verification: '123456' });
  await until(() => states.at(-1).phase === 'approval', 'approval state missing');
  await sender.decide(false);
  assert.equal(states.at(-1).phase, 'ended');
  assert.equal(states.at(-1).verification, undefined);
  assert.equal(video.readyState, 'ended');
  assert.equal(peers.length, 0);
});

test('receiver publishes and releases one stream when track and connection arrive in either order', async (t) => {
  const peers = installTransport(t);
  const { calls, publish } = installSignaling(t, { phase: 'pending', verification: '123456' });
  const states = [];
  const streams = [];
  const receiver = new MonitorReceiver({ onState: (state) => states.push(state), onStream: (stream) => streams.push(stream) });
  t.after(() => receiver.disconnect());

  for (const videoFirst of [true, false]) {
    publish({ phase: 'pending', offer: undefined, verification: '123456' });
    await receiver.connect('AAAA-BBBB-CCCC');
    assert.equal(states.at(-1).phase, 'approval');
    assert.equal(states.at(-1).verification, '123456');
    assert.equal(calls.at(-1).action, 'poll');
    assert.equal(calls.filter(({ action }) => action === 'join').at(-1).payload.code, 'AAAABBBBCCCC');

    publish({ phase: 'approved', offer: { type: 'offer', sdp: 'v=0' } });
    await until(() => peers.at(-1)?.iceGatheringState === 'gathering', 'receiver did not create an answer');
    const peer = peers.at(-1);
    peer.finishIce();
    const video = new Track('video');
    const audio = new Track('audio');
    const streamCount = streams.length;
    peer.receive(audio);
    if (videoFirst) peer.receive(video);
    peer.setConnectionState('connected');
    if (!videoFirst) {
      assert.equal(streams.length, streamCount);
      peer.receive(video);
    }
    assert.equal(states.at(-1).phase, 'connected');
    assert.equal(streams.length, streamCount + 1);
    assert.deepEqual(streams.at(-1).getTracks(), [audio, video]);

    publish({ audio: { available: true, output: 'viewer' } });
    await until(() => states.at(-1).audio.available, 'receiver audio metadata was not updated');
    peer.setConnectionState('connected');
    assert.equal(streams.length, streamCount + 1);
    receiver.disconnect();
    assert.equal(streams.at(-1), null);
    assert.equal(streams.length, streamCount + 2);
    assert.equal(video.readyState, 'ended');
    assert.equal(audio.readyState, 'ended');
  }
});

test('late pairing responses are closed without publishing stale state', async (t) => {
  const peers = installTransport(t);
  const { calls, overrides } = installSignaling(t, { phase: 'pending', verification: '123456' });
  const states = [];
  const receiver = new MonitorReceiver({ onState: (state) => states.push(state), onStream: () => {} });
  t.after(() => receiver.disconnect());
  const allocation = Promise.withResolvers();
  overrides.join = () => allocation.promise;
  const joining = receiver.connect('aaaa bbbb cccc');
  await receiver.connect('AAAA-BBBB-CCCC');
  assert.equal(calls.filter(({ action }) => action === 'join').length, 1);
  receiver.disconnect();
  allocation.resolve();
  await joining;

  assert.deepEqual(states.map(({ phase }) => phase), ['connecting', 'ended']);
  assert.equal(calls.at(-1).action, 'close');
  assert.equal(calls.at(-1).payload.sessionId, 'AAAABBBBCCCC');
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer viewer-token');
  assert.equal(peers.length, 0);
});
