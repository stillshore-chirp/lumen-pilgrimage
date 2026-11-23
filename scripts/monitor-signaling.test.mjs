import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createVirtualMonitorSignaling } from '../server/virtual-monitor-signaling.mjs';

async function setup(context, options) {
  const signaling = createVirtualMonitorSignaling(options);
  let bodyRead;
  const server = createServer((request, response) => {
    const observed = bodyRead;
    bodyRead = undefined;
    signaling.middleware(request, response, () => response.writeHead(404).end());
    if (observed) request.once('end', observed);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(async () => {
    signaling.dispose();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function post(action, body, { token, method = 'POST', ...override } = {}) {
    const response = await fetch(`${origin}/api/virtual-monitor/${action}`, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...override,
      },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  function act(peer, action, body = {}) {
    return post(action, { sessionId: peer.sessionId, ...body }, { token: peer.token });
  }
  async function checked(result, status = 200) {
    const response = await result;
    assert.equal(response.status, status);
    return response.data;
  }
  async function pollEntered(peer, revision) {
    const read = new Promise(resolve => { bodyRead = resolve; });
    const result = act(peer, 'poll', { revision });
    await read;
    return { result };
  }
  return { post, act, checked, pollEntered, dispose: signaling.dispose };
}

test('signaling enforces the request origin, method, body size and pairing budget', async context => {
  const { post, checked } = await setup(context);
  const denied = await post('create', {}, { Origin: 'http://localhost:1' });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  const preflight = await post('create', {}, { method: 'OPTIONS' });
  assert.equal(preflight.status, 405);
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  await checked(post('create', {}, { Origin: '' }), 403);
  await checked(post('create', {}, { Host: '127.example.test', Origin: 'http://127.example.test' }), 403);
  await checked(post('create', {}, { 'Content-Type': 'text/plain' }), 415);
  await checked(post('create', 'x'.repeat(65_537)), 413);
  await checked(post('create', []), 400);
  await checked(post('create?secret=fixture', {}), 404);
  let result;
  for (let attempt = 0; attempt < 31; attempt++) result = await post('join', { code: '' });
  assert.equal(result.status, 429);
});

test('signaling reserves one viewer and relays SDP only after sender approval', async context => {
  const { post, act, checked, pollEntered } = await setup(context);
  const sender = await checked(post('create', {}));
  assert.ok(/^[0-9A-F]{4}(?:-[0-9A-F]{4}){2}$/.test(sender.code));
  assert.equal(sender.snapshot.phase, 'waiting');
  assert.equal(sender.snapshot.revision, 0);
  const audio = { available: true, output: 'viewer' };
  await checked(act(sender, 'audio', { audio }));
  const results = await Promise.all([
    post('join', { code: sender.code.toLowerCase().replaceAll('-', ' ') }),
    post('join', { code: sender.code }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 404]);
  const viewer = results.find(result => result.status === 200).data;
  assert.ok(viewer.token !== sender.token);
  assert.equal(viewer.snapshot.phase, 'pending');
  assert.deepEqual(viewer.snapshot.audio, audio);
  assert.equal(viewer.snapshot.offer, undefined);
  const pending = await checked(act(sender, 'poll', { revision: 0 }));
  assert.ok(/^\d{6}$/.test(pending.snapshot.verification));
  assert.ok(viewer.snapshot.verification === pending.snapshot.verification);

  const offer = { type: 'offer', sdp: 'v=0\r\n' };
  const answer = { type: 'answer', sdp: 'v=0\r\n' };
  await checked(post('poll', { sessionId: sender.sessionId, revision: 0 }), 401);
  await checked(post('close', { sessionId: sender.sessionId }, { token: 'A'.repeat(32) }), 403);
  await checked(act(sender, 'offer', { description: offer }), 409);
  await checked(act(viewer, 'approve', { accept: true }), 403);
  await checked(act(viewer, 'offer', { description: offer }), 403);
  await checked(act(viewer, 'audio', { audio }), 403);
  const approved = await checked(act(sender, 'approve', { accept: true }));
  assert.equal(approved.snapshot.phase, 'approved');
  assert.equal(approved.snapshot.verification, undefined);
  await checked(act(viewer, 'answer', { description: answer }), 409);
  await checked(act(sender, 'offer', { description: { type: 'offer', sdp: 'x'.repeat(32_769) } }), 413);
  await checked(act(sender, 'offer', { description: offer }));
  const received = await checked(act(viewer, 'poll', { revision: approved.snapshot.revision }));
  assert.deepEqual(received.snapshot.offer, offer);
  await checked(act(sender, 'answer', { description: answer }), 403);
  await checked(act(viewer, 'answer', { description: answer }));
  const negotiated = await checked(act(sender, 'poll', { revision: received.snapshot.revision }));
  assert.deepEqual(negotiated.snapshot.answer, answer);
  const unchanged = await checked(act(sender, 'audio', { audio }));
  assert.equal(unchanged.snapshot.revision, negotiated.snapshot.revision);
  const muted = { available: true, output: 'pc', pcPlaybackSuppressed: true };
  await checked(act(sender, 'audio', { audio: { ...muted, output: 'both' } }), 400);
  await checked(act(sender, 'audio', { audio: muted }));
  const viewerMuted = await checked(act(viewer, 'poll', { revision: unchanged.snapshot.revision }));
  assert.deepEqual(viewerMuted.snapshot.audio, muted);
  const awaitingStop = await pollEntered(viewer, viewerMuted.snapshot.revision);
  await checked(act(sender, 'close'));
  const closed = await checked(awaitingStop.result);
  assert.equal(closed.snapshot.phase, 'closed');
  assert.equal(closed.snapshot.offer, undefined);
  assert.equal(closed.snapshot.answer, undefined);
});

test('rejection and stopping release pending polls and discard session data', async context => {
  const { post, act, checked, pollEntered } = await setup(context);
  for (const closeBySender of [true, false]) {
    const sender = await checked(post('create', {}));
    const viewer = await checked(post('join', { code: sender.code }));
    const pending = await pollEntered(viewer, viewer.snapshot.revision);
    await checked(act(viewer, 'poll', { revision: viewer.snapshot.revision }), 409);
    if (closeBySender) {
      await checked(act(sender, 'approve', { accept: false }));
    } else {
      await checked(act(viewer, 'close'));
    }
    const closed = await checked(pending.result);
    assert.equal(closed.snapshot.phase, 'closed');
    assert.equal(closed.snapshot.verification, undefined);
    assert.equal(closed.snapshot.offer, undefined);
    await checked(act(sender, 'poll', { revision: 0 }), 404);
    await checked(post('join', { code: sender.code }), 404);
  }
});

test('pairing expires and approved sessions require heartbeats from both peers', async context => {
  let time = 0;
  const { post, act, checked } = await setup(context, { now: () => time });
  const expired = await checked(post('create', {}));
  time += 120_000;
  await checked(post('join', { code: expired.code }), 404);
  await checked(act(expired, 'poll', { revision: 0 }), 404);

  const sender = await checked(post('create', {}));
  const viewer = await checked(post('join', { code: sender.code }));
  await checked(act(sender, 'approve', { accept: true }));
  time += 45_000;
  await checked(act(sender, 'poll', { revision: 0 }));
  time += 45_000;
  await checked(act(sender, 'poll', { revision: 0 }), 404);
  await checked(act(viewer, 'poll', { revision: 0 }), 404);
});

test('long polling returns an unchanged revision and signaling disposal wakes active polls', async context => {
  const { post, act, checked, pollEntered, dispose } = await setup(context, { pollWait: 50 });
  const sender = await checked(post('create', {}));
  const unchanged = await checked(act(sender, 'poll', { revision: 0 }));
  assert.equal(unchanged.snapshot.revision, 0);
  const pending = await pollEntered(sender, 0);
  dispose();
  const closed = await checked(pending.result);
  assert.equal(closed.snapshot.phase, 'closed');
  await checked(post('create', {}), 503);
});
