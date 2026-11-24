import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { isIPv4 } from 'node:net';

const API_PREFIX = '/api/virtual-monitor/';
const ACTIONS = new Set(['create', 'join', 'poll', 'approve', 'offer', 'answer', 'audio', 'close']);
const OUTPUTS = new Set(['pc', 'viewer', 'both']);
const DEFAULT_AUDIO = Object.freeze({ available: false, output: 'both' });
const PAIR_TTL = 120_000;
const PEER_IDLE = 90_000;
const SESSION_TTL = 8 * 60 * 60_000;
const POLL_WAIT = 10_000;
const REQUEST_WINDOW = 60_000;
const MAX_ROOMS = 32;
const MAX_CLIENT_ADDRESSES = 256;
const MAX_IN_FLIGHT = 128;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SDP_BYTES = 32 * 1024;

class SignalError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

function sameOrigin(request) {
  const host = request.headers[':authority'] ?? request.headers.host;
  const secure = request.socket.encrypted === true;
  if (!host || !request.headers.origin) return false;
  let url;
  try {
    url = new URL(`${secure ? 'https' : 'http'}://${host}`);
  } catch {
    return false;
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || request.headers.origin !== url.origin) return false;
  if (secure) return true;
  const peer = request.socket.remoteAddress ?? '';
  const loopbackPeer = peer === '::1' || /^(?:::ffff:)?127\./.test(peer);
  const loopbackHost = url.hostname === 'localhost' || url.hostname === '[::1]'
    || (isIPv4(url.hostname) && url.hostname.startsWith('127.'));
  return loopbackPeer && loopbackHost;
}

function reply(response, status, result) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(result));
}

function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new SignalError(415, 'json-required');
  }
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
    throw new SignalError(413, 'body-too-large');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => fail(408, 'body-timeout'), 5000);
    function cleanup() {
      clearTimeout(timer);
      request.off('data', receive).off('end', finish).off('close', disconnect);
    }
    function fail(status, code) {
      cleanup();
      reject(new SignalError(status, code));
    }
    function receive(chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) fail(413, 'body-too-large');
      else chunks.push(chunk);
    }
    function finish() {
      cleanup();
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body === null || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'invalid-body');
        resolve(body);
      } catch {
        reject(new SignalError(400, 'invalid-body'));
      }
    }
    function disconnect() {
      fail(400, 'incomplete-body');
    }
    request.on('data', receive).once('end', finish).once('close', disconnect);
  });
}

function snapshot(room, time) {
  return {
    revision: room.revision,
    phase: room.phase,
    verification: room.verification,
    offer: room.offer,
    answer: room.answer,
    audio: room.audio,
    authorization: room.phase === 'approved' ? {
      approvalRemainingMs: Math.max(0, room.expiresAt - time),
      activityRemainingMs: Math.max(0, Math.min(room.seen.sender, room.seen.viewer) + PEER_IDLE - time),
    } : undefined,
  };
}

export function createVirtualMonitorSignaling({ now = Date.now, pollWait = POLL_WAIT } = {}) {
  const rooms = new Map();
  const codes = new Map();
  const clients = new Map();
  let inFlight = 0;
  let disposed = false;

  function update(room) {
    room.revision++;
    for (const finish of room.waiters.values()) finish();
  }

  function close(room) {
    rooms.delete(room.id);
    codes.delete(room.code);
    room.roles.clear();
    room.phase = 'closed';
    room.code = undefined;
    room.verification = undefined;
    room.offer = undefined;
    room.answer = undefined;
    room.audio = DEFAULT_AUDIO;
    update(room);
  }

  function expire(time) {
    for (const room of rooms.values()) {
      if (time >= room.expiresAt || (room.phase === 'approved' &&
          (time - room.seen.sender >= PEER_IDLE || time - room.seen.viewer >= PEER_IDLE))) {
        close(room);
      }
    }
    for (const [address, budget] of clients) {
      if (time >= budget.resetAt) clients.delete(address);
    }
  }

  const sweep = setInterval(() => expire(now()), 5000).unref();

  function charge(address, action, time) {
    const pairing = action === 'create' || action === 'join';
    let budget = clients.get(address);
    if (!budget && clients.size < MAX_CLIENT_ADDRESSES) {
      budget = { resetAt: time + REQUEST_WINDOW, requests: 0, pairing: 0 };
      clients.set(address, budget);
    }
    if (!budget || budget.requests >= 180 || (pairing && budget.pairing >= 30)) {
      throw new SignalError(429, 'request-limit');
    }
    budget.requests++;
    if (pairing) budget.pairing++;
  }

  function create(time) {
    if (rooms.size >= MAX_ROOMS) throw new SignalError(429, 'session-limit');
    let code;
    do {
      code = randomBytes(6).toString('hex').toUpperCase();
    } while (codes.has(code));
    const token = randomBytes(24).toString('base64url');
    const room = {
      id: randomUUID(),
      code,
      roles: new Map([[token, 'sender']]),
      phase: 'waiting',
      revision: 0,
      audio: DEFAULT_AUDIO,
      expiresAt: time + PAIR_TTL,
      seen: { sender: time, viewer: time },
      waiters: new Map(),
    };
    rooms.set(room.id, room);
    codes.set(code, room);
    return { sessionId: room.id, token, code: code.match(/.{4}/g).join('-'), snapshot: snapshot(room, time) };
  }

  function join(body, time) {
    const code = typeof body.code === 'string' && body.code.length <= 32
      ? body.code.replace(/[\s-]/g, '').toUpperCase() : '';
    const room = codes.get(code);
    if (!room) throw new SignalError(404, 'session-unavailable');
    const token = randomBytes(24).toString('base64url');
    codes.delete(code);
    room.code = undefined;
    room.roles.set(token, 'viewer');
    room.phase = 'pending';
    room.seen.viewer = time;
    room.verification = String(randomInt(1_000_000)).padStart(6, '0');
    update(room);
    return { sessionId: room.id, token, snapshot: snapshot(room, time) };
  }

  function waitForUpdate(room, role, revision, response, time) {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new SignalError(400, 'invalid-revision');
    if (revision === room.revision && room.waiters.has(role)) throw new SignalError(409, 'poll-in-progress');
    room.seen[role] = time;
    if (revision !== room.revision) return snapshot(room, now());
    return new Promise(resolve => {
      const timer = setTimeout(finish, pollWait);
      function finish() {
        clearTimeout(timer);
        response.off('close', finish);
        room.waiters.delete(role);
        resolve(snapshot(room, now()));
      }
      room.waiters.set(role, finish);
      response.once('close', finish);
      if (response.destroyed) finish();
    });
  }

  function applyAudio(room, body, time) {
    const { available, output, pcPlaybackSuppressed } = body.audio ?? {};
    const { audioSequence } = body;
    if (typeof available !== 'boolean' || !OUTPUTS.has(output)
      || (pcPlaybackSuppressed !== undefined && (pcPlaybackSuppressed !== true || !available || output !== 'pc'))) {
      throw new SignalError(400, 'invalid-audio');
    }
    if (audioSequence !== undefined && (!Number.isSafeInteger(audioSequence) || audioSequence < 1)) {
      throw new SignalError(400, 'invalid-audio-sequence');
    }
    if (room.audioSequence !== undefined && (audioSequence === undefined || audioSequence <= room.audioSequence)) return;
    room.seen.sender = time;
    if (audioSequence !== undefined) room.audioSequence = audioSequence;
    if (room.audio.available === available && room.audio.output === output
      && room.audio.pcPlaybackSuppressed === pcPlaybackSuppressed) return;
    room.audio = pcPlaybackSuppressed ? { available, output, pcPlaybackSuppressed } : { available, output };
    update(room);
  }

  function apply(room, action, body, time) {
    if (action === 'close') {
      close(room);
      return;
    }
    if (action === 'approve') {
      if (typeof body.accept !== 'boolean') throw new SignalError(400, 'invalid-approval');
      if (room.phase !== 'pending') throw new SignalError(409, 'invalid-phase');
      if (!body.accept) {
        close(room);
        return;
      }
      room.phase = 'approved';
      room.verification = undefined;
      room.expiresAt = time + SESSION_TTL;
      room.seen.viewer = time;
    } else {
      if (room.phase !== 'approved' || room[action] || (action === 'answer' && !room.offer)) {
        throw new SignalError(409, 'invalid-phase');
      }
      const { type, sdp } = body.description ?? {};
      if (type !== action || typeof sdp !== 'string' || !sdp) throw new SignalError(400, 'invalid-description');
      if (Buffer.byteLength(sdp, 'utf8') > MAX_SDP_BYTES) throw new SignalError(413, 'description-too-large');
      room[action] = { type, sdp };
    }
    update(room);
  }

  async function handle(request, response, action) {
    try {
      if (disposed) throw new SignalError(503, 'signaling-stopped');
      if (request.method !== 'POST') throw new SignalError(405, 'post-required');
      if (!sameOrigin(request)) throw new SignalError(403, 'origin-denied');
      if (!ACTIONS.has(action)) throw new SignalError(404, 'unknown-action');
      if (inFlight >= MAX_IN_FLIGHT) throw new SignalError(429, 'request-limit');
      inFlight++;
      try {
        const receivedAt = now();
        expire(receivedAt);
        charge(request.socket.remoteAddress, action, receivedAt);
        const body = await readJson(request);
        const time = now();
        expire(time);
        if (disposed) throw new SignalError(503, 'signaling-stopped');
        if (action === 'create') return reply(response, 200, create(time));
        if (action === 'join') return reply(response, 200, join(body, time));
        const token = /^Bearer ([\w-]{32})$/.exec(request.headers.authorization ?? '')?.[1];
        if (!token) throw new SignalError(401, 'bearer-required');
        const room = rooms.get(body.sessionId);
        if (!room) throw new SignalError(404, 'session-unavailable');
        const role = room.roles.get(token);
        if (!role || (action === 'answer' && role !== 'viewer')
            || (['approve', 'offer', 'audio'].includes(action) && role !== 'sender')) {
          throw new SignalError(403, 'role-denied');
        }
        if (action === 'audio') {
          applyAudio(room, body, time);
          return reply(response, 200, { snapshot: snapshot(room, now()) });
        }
        if (action === 'poll') {
          const current = await waitForUpdate(room, role, body.revision, response, time);
          return reply(response, 200, { snapshot: current });
        }
        room.seen[role] = time;
        apply(room, action, body, time);
        return reply(response, 200, { snapshot: snapshot(room, now()) });
      } finally {
        inFlight--;
      }
    } catch (error) {
      request.resume();
      if (error instanceof SignalError) reply(response, error.status, { error: error.message });
      else reply(response, 500, { error: 'signaling-error' });
    }
  }

  return {
    middleware(request, response, next) {
      if (!request.url?.startsWith(API_PREFIX)) return next();
      void handle(request, response, request.url.slice(API_PREFIX.length));
    },
    dispose() {
      disposed = true;
      clearInterval(sweep);
      for (const room of rooms.values()) close(room);
      clients.clear();
    },
  };
}

export function virtualMonitorSignalingPlugin() {
  function install(server) {
    const signaling = createVirtualMonitorSignaling();
    server.middlewares.use(signaling.middleware);
    server.httpServer?.once('close', signaling.dispose);
  }
  return {
    name: 'virtual-monitor-signaling',
    apply: 'serve',
    configureServer: install,
    configurePreviewServer: install,
  };
}
