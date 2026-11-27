import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLakeKotoTransport } from '../src/coast/lakeKotoTransport.ts';

test('preparation can be cancelled and an old failure cannot overwrite a newer successful play', async () => {
  const attempts = [];
  const calls = [];
  let playing = false;
  const transport = createLakeKotoTransport({
    get kotoPlaying() { return playing; },
    setKotoPlaying(value) {
      calls.push(value);
      if (!value) { playing = false; return Promise.resolve(); }
      return new Promise((resolve, reject) => attempts.push({ resolve: () => { playing = true; resolve(); }, reject }));
    },
  });
  const first = transport.toggle();
  assert.equal(transport.pending, true);
  await transport.toggle();
  assert.equal(transport.pending, false);
  const latest = transport.toggle();
  attempts[0].reject(new Error('old request cancelled'));
  await first;
  assert.equal(transport.pending, true);
  assert.equal(transport.failed, false);
  attempts[1].resolve();
  await latest;
  assert.deepEqual(calls, [true, false, true]);
  assert.equal(transport.playing, true);
  assert.equal(transport.pending, false);
  await transport.toggle();
  assert.equal(transport.playing, false);
});

test('a current failed load is reported and a retry clears it', async () => {
  let attempt = 0;
  const transport = createLakeKotoTransport({ kotoPlaying: false,
    setKotoPlaying: async () => { if (++attempt === 1) throw new Error('load failed'); } });
  await transport.toggle();
  assert.equal(transport.failed, true);
  await transport.toggle();
  assert.equal(transport.failed, false);
  assert.equal(transport.pending, false);
});
