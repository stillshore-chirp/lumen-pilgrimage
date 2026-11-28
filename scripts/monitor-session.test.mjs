import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MonitorReceiver, MonitorSender, monitorVideoBitrate } from '../src/monitor/monitorSession.ts';

class Track extends EventTarget {
  readyState = 'live';
  enabled = true;

  constructor(kind) {
    super();
    this.kind = kind;
  }

  getSettings() { return { width: 320, height: 180, frameRate: 60 }; }

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
  function currentSnapshot() {
    return snapshot.phase === 'approved'
      ? { authorization: { approvalRemainingMs: 8 * 60 * 60_000, activityRemainingMs: 90_000 }, ...snapshot }
      : snapshot;
  }

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
    if (overrides[action]) {
      const result = await overrides[action](payload);
      if (result) return result;
    }
    switch (action) {
      case 'create':
        return Response.json({ sessionId: 'session', token: 'sender-token', code: 'AAAA-BBBB-CCCC', snapshot: currentSnapshot() });
      case 'join':
        return Response.json({ sessionId: payload.code, token: 'viewer-token', snapshot: currentSnapshot() });
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
    return Response.json({ snapshot: currentSnapshot() });
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

  assert.deepEqual(peers[0].transceivers[0].options.sendEncodings, [{ maxFramerate: 60, maxBitrate: 2_000_000 }]);
  assert.equal(peers[0].transceivers[1].options.sendEncodings, undefined);
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

for (const { name, terminalStatus, delays, phase } of [
  {
    name: 'session expiry ends playback after repeated transient poll failures',
    terminalStatus: 404, delays: [1_000, 2_000, 4_000, 8_000, 8_000], phase: 'ended',
  },
  { name: 'authorization failure ends playback immediately', terminalStatus: 403, delays: [], phase: 'failed' },
  { name: 'explicit disconnect cancels the scheduled poll retry', terminalStatus: 503, delays: [1_000], phase: 'ended' },
]) {
  test(name, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const peers = installTransport(t);
    const { calls, overrides, publish } = installSignaling(t, { phase: 'approved', offer: { type: 'offer', sdp: 'v=0' } });
    const states = [];
    const streams = [];
    const receiver = new MonitorReceiver({ onState: state => states.push(state), onStream: stream => streams.push(stream) });
    t.after(() => receiver.disconnect());

    await receiver.connect('AAAA-BBBB-CCCC');
    await until(() => peers[0]?.iceGatheringState === 'gathering', 'receiver did not start ICE gathering');
    const [peer] = peers;
    peer.finishIce();
    const video = new Track('video');
    peer.receive(video);
    peer.setConnectionState('connected');
    await until(() => calls.filter(call => call.action === 'poll').length >= 2, 'receiver did not start polling');
    const [stream] = streams;

    const revisions = [];
    overrides.poll = ({ revision }) => {
      revisions.push(revision);
      return new Response(null, { status: revisions.length <= delays.length ? 503 : terminalStatus });
    };
    publish({ audio: { available: true, output: 'viewer' } });
    await until(() => revisions.length === 1, 'receiver did not poll after update');

    for (const [index, delay] of delays.entries()) {
      assert.equal(states.at(-1).phase, 'connected');
      assert.deepEqual(peers, [peer]);
      assert.deepEqual(streams, [stream]);
      assert.equal(video.readyState, 'live');
      t.mock.timers.tick(delay - 1);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(revisions.length, index + 1, 'receiver should wait before polling again');
      t.mock.timers.tick(1);
      await until(() => revisions.length === index + 2, 'receiver did not retry the poll');
    }

    if (terminalStatus === 503) {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(states.at(-1).phase, 'connected');
      receiver.disconnect();
    }
    await until(() => states.at(-1).phase === phase, 'receiver did not end playback');
    t.mock.timers.tick(16_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(revisions.length, delays.length + 1, 'no retry remains after teardown');
    assert.equal(new Set(revisions).size, 1, 'retrying a poll uses the last received revision');
    assert.equal(peer.connectionState, 'closed');
    assert.equal(video.readyState, 'ended');
    assert.deepEqual(streams, [stream, null]);
    assert.equal(calls.filter(call => call.action === 'close').length, terminalStatus === 404 ? 0 : 1);
  });
}

for (const { terminal, expectedPhase, closes } of [
  { terminal: 'stop', expectedPhase: 'ended', closes: 1 },
  { terminal: 404, expectedPhase: 'ended', closes: 0 },
  { terminal: 403, expectedPhase: 'failed', closes: 1 },
]) {
  test(`audio-setting retries end at ${terminal}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const peers = installTransport(t);
    const { calls, overrides, publish } = installSignaling(t);
    const states = [];
    const sender = new MonitorSender({ onState: state => states.push(state) });
    t.after(() => sender.stop());
    const video = new Track('video');
    const audio = new Track('audio');
    await sender.start(new Stream([video, audio]), { available: true, output: 'both' });
    publish({ phase: 'approved' });
    await until(() => peers[0]?.iceGatheringState === 'gathering', 'sender did not start ICE gathering');
    const [peer] = peers;
    peer.finishIce();
    await until(() => calls.some(call => call.action === 'offer'), 'sender did not offer');
    publish({ answer: { type: 'answer', sdp: 'v=0' } });
    await until(() => peer.remoteDescription?.type === 'answer', 'sender did not apply the answer');
    peer.setConnectionState('connected');

    const outputs = [];
    const sequences = [];
    overrides.audio = ({ audio, audioSequence }) => {
      outputs.push(audio.output);
      sequences.push(audioSequence);
      const status = terminal === 403 || (terminal === 404 && outputs.length > 1) ? terminal : 503;
      return new Response(null, { status });
    };
    const first = sender.updateAudio({ available: true, output: 'pc' });
    assert.equal(audio.enabled, false);
    await until(() => outputs.length === 1, 'sender did not send the audio setting');

    if (terminal === 403) {
      await first;
    } else {
      assert.equal(states.at(-1).audioPending, true);
      assert.equal(peer.connectionState, 'connected');
      assert.equal(video.readyState, 'live');
      const newer = sender.updateAudio({ available: true, output: 'both' });
      assert.equal(audio.enabled, true);
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(outputs, ['pc'], 'the new setting waits for the serialized retry');
      if (terminal === 'stop') sender.stop();
      else t.mock.timers.tick(1_000);
      await Promise.all([first, newer]);
    }

    assert.equal(states.at(-1).phase, expectedPhase);
    assert.equal(states.at(-1).audioPending, undefined);
    assert.equal(peer.connectionState, 'closed');
    assert.equal(video.readyState, 'ended');
    assert.equal(audio.readyState, 'ended');
    t.mock.timers.tick(16_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(outputs, terminal === 404 ? ['pc', 'both'] : ['pc']);
    assert.ok(sequences.every(sequence => Number.isSafeInteger(sequence) && sequence > 0));
    if (terminal === 404) assert.equal(sequences[1], sequences[0] + 1);
    assert.equal(calls.filter(call => call.action === 'close').length, closes);
  });
}

for (const { limit, approvalRemainingMs, expiresAt } of [
  { limit: 'peer activity', approvalRemainingMs: 8 * 60 * 60_000, expiresAt: 91_000 },
  { limit: 'original approval', approvalRemainingMs: 5_000, expiresAt: 5_000 },
]) {
  test(`an isolated live receiver releases media at the ${limit} deadline`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    t.mock.method(performance, 'now', () => Date.now());
    const peers = installTransport(t);
    const { calls, overrides, publish } = installSignaling(t, {
      phase: 'approved', offer: { type: 'offer', sdp: 'v=0' },
      authorization: { approvalRemainingMs, activityRemainingMs: 90_000 },
    });
    const states = [];
    const streams = [];
    const receiver = new MonitorReceiver({ onState: state => states.push(state), onStream: stream => streams.push(stream) });
    t.after(() => receiver.disconnect());

    await receiver.connect('AAAA-BBBB-CCCC');
    await until(() => peers[0]?.iceGatheringState === 'gathering', 'receiver did not start ICE gathering');
    const [peer] = peers;
    peer.finishIce();
    const video = new Track('video');
    peer.receive(video);
    peer.setConnectionState('connected');
    await until(() => calls.filter(call => call.action === 'poll').length >= 2, 'receiver did not start polling');
    const [stream] = streams;

    let failed = false;
    overrides.poll = () => {
      failed = true;
      return new Response(null, { status: 503 });
    };
    publish({});
    await until(() => failed, 'receiver did not encounter the signal failure');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(states.at(-1).phase, 'connected');
    assert.equal(video.readyState, 'live');

    // A successful retry refreshes activity; a new response cannot extend the original approval.
    delete overrides.poll;
    publish({ authorization: { approvalRemainingMs: 8 * 60 * 60_000, activityRemainingMs: 90_000 },
      audio: { available: true, output: 'viewer' } });
    t.mock.timers.tick(1_000);
    await until(() => states.at(-1).audio.output === 'viewer', 'receiver did not recover on the same peer');
    assert.deepEqual(peers, [peer]);
    assert.deepEqual(streams, [stream]);

    t.mock.timers.tick(expiresAt - 1_001);
    assert.equal(states.at(-1).phase, 'connected');
    assert.equal(video.readyState, 'live');
    t.mock.timers.tick(1);
    assert.equal(states.at(-1).phase, 'ended');
    assert.equal(peer.connectionState, 'closed');
    assert.equal(video.readyState, 'ended');
    assert.deepEqual(streams, [stream, null]);
    assert.equal(calls.filter(call => call.action === 'close').length, 1);
  });
}

test('a receiver requires expiration information before accepting approved media', async t => {
  const peers = installTransport(t);
  const { publish } = installSignaling(t, { phase: 'pending' });
  const states = [];
  const receiver = new MonitorReceiver({ onState: state => states.push(state), onStream: () => {} });
  t.after(() => receiver.disconnect());

  await receiver.connect('AAAA-BBBB-CCCC');
  publish({ phase: 'approved', authorization: undefined, offer: { type: 'offer', sdp: 'v=0' } });
  await until(() => states.at(-1).phase === 'failed', 'receiver did not reject an approval without expiration');
  assert.match(states.at(-1).detail, /有効期限/);
  assert.deepEqual(peers, []);
});

// Local pairing authenticates the exact launched window before transferring a private port.
const { MonitorLocalPairing, MonitorPairingSource } = await import('../src/monitor/monitorPairing.ts');
const { monitorVideoSnapshot, monitorVideoRates, measureMonitorVideo, describeMonitorVideo } = await import('../src/monitor/monitorVideoMetrics.ts');

function postEvent(host, { source, origin = host.location.origin, data, ports = [] }) {
  host.dispatchEvent(Object.assign(new Event('message'), { source, origin, data, ports }));
}

function localHost() {
  const host = new EventTarget();
  host.location = { origin: 'https://monitor.example' };
  host.opener = null;
  return host;
}

test('local launch accepts one code only from the exact same-origin launched sender', async t => {
  const host = localHost();
  let child;
  const transfers = [];
  const opened = [];
  host.open = (url, target) => {
    opened.push({ url, target });
    child = { postMessage: (data, origin, ports) => transfers.push({ data, origin, ports }) };
    return child;
  };
  const codes = [];
  const pairing = new MonitorLocalPairing(code => codes.push(code), host);
  t.after(() => pairing.cancel());
  const url = new URL('/?monitor=sender', host.location.origin);
  assert.equal(pairing.open(url), true);
  const ready = { type: 'lumen-monitor-sender-ready' };
  postEvent(host, { source: {}, data: ready });
  postEvent(host, { source: child, origin: 'https://other.example', data: ready });
  assert.equal(transfers.length, 0);
  postEvent(host, { source: child, data: ready });
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].origin, host.location.origin);
  const port = transfers[0].ports[0];
  t.after(() => port.close());
  port.postMessage({ type: 'lumen-monitor-pairing-code', code: 'bad' });
  port.postMessage({ type: 'lumen-monitor-pairing-code', code: 'AAAA-BBBB-CCCC' });
  port.postMessage({ type: 'lumen-monitor-pairing-code', code: 'DDDD-EEEE-FFFF' });
  await until(() => codes.length > 0, 'local code was not delivered');
  assert.deepEqual(codes, ['AAAA-BBBB-CCCC']);
  assert.deepEqual(opened, [{ url: url.href, target: '_blank' }]);
  assert.equal(pairing.open(new URL('https://other.example/')), false);
});

test('cancelling a handoff prevents an old channel or window from enrolling a later attempt', async t => {
  const host = localHost();
  const children = [];
  const ports = [];
  host.open = () => {
    const child = { postMessage: (_data, _origin, transfer) => ports.push(transfer[0]) };
    children.push(child);
    return child;
  };
  const codes = [];
  const pairing = new MonitorLocalPairing(code => codes.push(code), host);
  t.after(() => { pairing.cancel(); for (const port of ports) port.close(); });
  const url = new URL('/?monitor=sender', host.location.origin);
  pairing.open(url);
  postEvent(host, { source: children[0], data: { type: 'lumen-monitor-sender-ready' } });
  pairing.cancel();
  pairing.open(url);
  ports[0].postMessage({ type: 'lumen-monitor-pairing-code', code: 'AAAA-BBBB-CCCC' });
  postEvent(host, { source: children[0], data: { type: 'lumen-monitor-sender-ready' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ports.length, 1);
  assert.deepEqual(codes, []);
  host.open = () => null;
  assert.equal(pairing.open(url), false);
});

test('sender detaches opener immediately and sends only a single code over its authenticated port', async t => {
  const host = localHost();
  const ready = [];
  const opener = { postMessage: (data, origin) => ready.push({ data, origin }) };
  host.opener = opener;
  const source = new MonitorPairingSource(host);
  t.after(() => source.dispose());
  assert.equal(host.opener, null);
  assert.deepEqual(ready, [{ data: { type: 'lumen-monitor-sender-ready' }, origin: host.location.origin }]);
  const channel = new MessageChannel();
  t.after(() => { channel.port1.close(); channel.port2.close(); });
  const received = [];
  channel.port1.onmessage = ({ data }) => received.push(data);
  source.publish('AAAA-BBBB-CCCC');
  postEvent(host, { source: {}, data: { type: 'lumen-monitor-pairing-port' }, ports: [channel.port2] });
  postEvent(host, { source: opener, origin: 'https://other.example', data: { type: 'lumen-monitor-pairing-port' }, ports: [channel.port2] });
  assert.deepEqual(received, []);
  postEvent(host, { source: opener, data: { type: 'lumen-monitor-pairing-port' }, ports: [channel.port2] });
  await until(() => received.length > 0, 'sender handoff missing');
  source.publish('DDDD-EEEE-FFFF');
  assert.deepEqual(received, [{ type: 'lumen-monitor-pairing-code', code: 'AAAA-BBBB-CCCC' }]);
});

test('video diagnostics measure each counter interval and preserve missing or reset metrics', () => {
  const report = rows => new Map(rows.map(row => [row.id, row]));
  const source = (frames, timestamp = 1000) => ({ id: 'source', type: 'media-source', kind: 'video', frames, timestamp, width: 640, height: 360, trackIdentifier: 'private-label' });
  const send = (framesSent, timestamp = 1000) => ({ id: 'send', type: 'outbound-rtp', kind: 'video', framesSent, framesEncoded: framesSent, timestamp, qualityLimitationReason: 'cpu', address: 'private-address' });
  const first = monitorVideoSnapshot(report([source(60), send(60)]));
  const second = monitorVideoSnapshot(report([source(240, 4000), send(210, 4000)]));
  const rates = monitorVideoRates(first, second);
  assert.equal(rates.captureFps, 60);
  assert.equal(rates.sentFps, 50);
  assert.equal(rates.encodedFps, 50);
  assert.equal(rates.durationMs, 3000);
  assert.equal(rates.qualityLimitation, 'cpu');
  assert.equal(rates.decodedFps, undefined);
  assert.equal(JSON.stringify(second).includes('private'), false);
  assert.equal(monitorVideoRates(first, monitorVideoSnapshot(report([source(1, 4000)]))).captureFps, undefined);
  assert.equal(monitorVideoRates(first, monitorVideoSnapshot(report([{ ...source(240, 4000), id: 'new-source' }]))).captureFps, undefined);
  assert.equal(monitorVideoRates(first, monitorVideoSnapshot(report([source(60, 4000)]))).captureFps, 0);
});

test('video measurement cancels promptly and never converts absent counters into zero fps', async () => {
  const abort = new AbortController();
  const read = async () => ({ counters: [] });
  const pending = measureMonitorVideo(read, abort.signal, undefined, 10_000);
  await new Promise(resolve => setImmediate(resolve));
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  const result = await measureMonitorVideo(read, new AbortController().signal, undefined, 1);
  assert.equal(result.sentFps, undefined);
  assert.equal(result.presentedFps, undefined);
  assert.match(describeMonitorVideo(result, 'sender'), /取得 未取得.*送信 未取得/);
  assert.match(describeMonitorVideo(result, 'viewer'), /受信 未取得.*デコード 未取得/);
});

test('presentation measurements include frozen time and distinguish zero, one and missing callbacks', async () => {
  async function observe(frames) {
    let callback;
    let handle = 0;
    const video = {
      srcObject: {},
      requestVideoFrameCallback(next) { callback = next; return ++handle; },
      cancelVideoFrameCallback() { callback = undefined; },
    };
    const measured = measureMonitorVideo(async () => ({ counters: [] }), new AbortController().signal, video, 40);
    await new Promise(resolve => setImmediate(resolve));
    for (const presentedFrames of frames) callback?.(performance.now(), { presentedFrames, presentationTime: presentedFrames });
    const result = await measured;
    assert.ok(result.presentationDurationMs >= 35);
    return result;
  }
  const none = await observe([]);
  assert.equal(none.presentedFps, 0);
  assert.equal(none.presentationFrames, 0);
  const one = await observe([1]);
  assert.equal(one.presentationFrames, 1);
  assert.ok(one.presentedFps > 0 && one.presentedFps < 30);
  const burst = await observe([10, 11]);
  assert.equal(burst.presentationFrames, 2);
  assert.ok(burst.presentedFps > 0 && burst.presentedFps < 60, 'frozen time must lower the reported rate');
});

test('a backgrounded video measurement is rejected instead of reporting throttling as source fps', async t => {
  const document = new EventTarget();
  document.visibilityState = 'visible';
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.after(() => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document);
  const pending = measureMonitorVideo(async () => ({ counters: [] }), new AbortController().signal, undefined, 5);
  await new Promise(resolve => setImmediate(resolve));
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  document.visibilityState = 'visible';
  await assert.rejects(pending, /visible page/);
});

test('handoff expiry removes the temporary window and port authority without extending server enrollment', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = localHost();
  const transferred = [];
  const child = { postMessage: (_data, _origin, ports) => transferred.push(ports[0]) };
  host.open = () => child;
  const codes = [];
  const pairing = new MonitorLocalPairing(code => codes.push(code), host);
  t.after(() => pairing.cancel());
  pairing.open(new URL('/?monitor=sender', host.location.origin));
  t.mock.timers.tick(120_000);
  postEvent(host, { source: child, data: { type: 'lumen-monitor-sender-ready' } });
  assert.deepEqual(transferred, []);
  assert.deepEqual(codes, []);

  const sourceHost = localHost();
  const opener = { postMessage() {} };
  sourceHost.opener = opener;
  const source = new MonitorPairingSource(sourceHost);
  t.after(() => source.dispose());
  const channel = new MessageChannel();
  t.after(() => { channel.port1.close(); channel.port2.close(); });
  const received = [];
  channel.port1.onmessage = ({ data }) => received.push(data);
  postEvent(sourceHost, { source: opener, data: { type: 'lumen-monitor-pairing-port' }, ports: [channel.port2] });
  t.mock.timers.tick(120_000);
  source.publish('AAAA-BBBB-CCCC');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(received, []);
});


test('surface supply rates use the surface observation interval and keep the target explicit', async () => {
  let reads = 0;
  const surface = () => ++reads === 1
    ? { renderedFrames: 60, videoFrames: 30, timestamp: 1000, surface: 'floating' }
    : { renderedFrames: 120, videoFrames: 60, timestamp: 2000, surface: 'floating' };
  const result = await measureMonitorVideo(async () => ({ counters: [] }), new AbortController().signal, undefined, 1, surface);
  assert.equal(result.renderedFps, 60);
  assert.equal(result.suppliedFps, 30);
  assert.equal(result.surface, 'floating');
  assert.match(describeMonitorVideo(result, 'viewer'), /景観描画 60.0fps.*景観への映像供給 30.0fps（浮遊面）/);
});


test('video upper budgets scale with source geometry and rate while remaining bounded', () => {
  assert.equal(monitorVideoBitrate({ width: 1280, height: 720, frameRate: 60 }), 5_529_600);
  assert.equal(monitorVideoBitrate({ width: 1280, height: 720, frameRate: 30 }), 2_764_800);
  assert.equal(monitorVideoBitrate({ width: 1280, height: 720, frameRate: 15 }), 2_000_000);
  assert.equal(monitorVideoBitrate({ width: 1920, height: 1080, frameRate: 60 }), 12_000_000);
  assert.equal(monitorVideoBitrate({ width: 10000, height: 10000, frameRate: 240 }), 12_000_000);
  assert.equal(monitorVideoBitrate({ width: NaN, height: -1, frameRate: 0 }), 5_529_600);
});
