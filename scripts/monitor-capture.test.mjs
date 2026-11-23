import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureErrorMessage, MonitorCapture } from '../src/monitor/monitorCapture.ts';

function fixture({ surface = 'browser', suppression, audio = true, video = true } = {}) {
  function track(settings) {
    return {
      readyState: 'live',
      getSettings: () => settings,
      stop() { this.readyState = 'ended'; },
    };
  }
  const audioTracks = audio ? [track({ suppressLocalAudioPlayback: suppression })] : [];
  const videoTracks = video ? [track({ displaySurface: surface })] : [];
  return {
    getTracks: () => [...videoTracks, ...audioTracks],
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
  };
}

function captureFor(getDisplayMedia, supported = true) {
  return new MonitorCapture({
    getSupportedConstraints: () => ({ displaySurface: supported, suppressLocalAudioPlayback: supported }),
    getDisplayMedia,
  });
}

test('opens the native chooser immediately with audio requested and no default PC suppression', async () => {
  const stream = fixture({ suppression: false });
  let requested;
  const capture = captureFor(async options => {
    requested = options;
    return stream;
  });
  const started = capture.open('both');
  assert.deepEqual(requested, {
    video: true,
    audio: { suppressLocalAudioPlayback: false },
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
    systemAudio: 'include',
    windowAudio: 'window',
  });
  assert.equal(await started, stream);
  assert.deepEqual(capture.selectAudio('both').audio, { available: true, output: 'both' });
  assert.deepEqual(capture.selectAudio('pc', 'both').audio, { available: true, output: 'pc' });
  capture.stop();
  assert.ok(stream.getTracks().every(track => track.readyState === 'ended'));
});

test('VR-only requires a captured browser tab and reported PC-side playback suppression', async () => {
  for (const [surface, suppression, output] of [
    ['browser', true, 'viewer'],
    ['browser', false, 'both'],
    ['window', true, 'both'],
    ['monitor', true, 'both'],
  ]) {
    const capture = captureFor(async ({ audio }) => {
      assert.deepEqual(audio, { suppressLocalAudioPlayback: true });
      return fixture({ surface, suppression });
    });
    await capture.open('viewer');
    const selection = capture.selectAudio('viewer');
    assert.deepEqual(selection.audio, { available: true, output });
    assert.equal(selection.requiresReselection, undefined);
    assert.match(selection.explanation, output === 'both' ? /「両方」/ : /PC側再生を停止する設定/);
    capture.stop();
  }
});

test('requires a new gesture to change tab suppression and stops transmission for PC-only immediately', async () => {
  let previous;
  const capture = captureFor(async ({ audio }) => {
    previous = fixture({ suppression: audio.suppressLocalAudioPlayback });
    return previous;
  });
  await capture.open('both');
  const enable = capture.selectAudio('viewer', 'both');
  assert.equal(enable.audio.output, 'both');
  assert.equal(enable.requiresReselection, true);
  assert.match(enable.explanation, /選び直して/);

  const original = previous;
  await capture.open('viewer');
  assert.ok(original.getTracks().every(track => track.readyState === 'ended'));
  assert.equal(capture.selectAudio('viewer').audio.output, 'viewer');
  const disable = capture.selectAudio('pc', 'viewer');
  assert.deepEqual(disable.audio, { available: true, output: 'pc', pcPlaybackSuppressed: true });
  assert.equal(disable.requiresReselection, true);
  assert.match(disable.explanation, /選び直して/);

  await capture.open('pc');
  assert.deepEqual(capture.selectAudio('pc').audio, { available: true, output: 'pc' });
  assert.equal(previous.getAudioTracks()[0].getSettings().suppressLocalAudioPlayback, false);
  capture.stop();
});

test('reports video-only sharing for missing or ended audio without exposing raw permission errors', async () => {
  const stream = fixture({ audio: false });
  const capture = captureFor(async ({ audio }) => {
    assert.equal(audio, true);
    return stream;
  }, false);
  await capture.open('viewer');
  assert.equal(capture.hasAudio, false);
  assert.equal(stream.getVideoTracks()[0].readyState, 'live');
  assert.deepEqual(capture.selectAudio('viewer').audio, { available: false, output: 'pc' });
  assert.match(capture.selectAudio('viewer').explanation, /映像のみ/);
  capture.stop();

  const endedAudio = fixture();
  const captureWithAudio = captureFor(async () => endedAudio);
  await captureWithAudio.open('both');
  endedAudio.getAudioTracks()[0].stop();
  assert.equal(captureWithAudio.hasAudio, false);
  assert.equal(captureWithAudio.selectAudio('both').audio.available, false);
  captureWithAudio.stop();

  const denied = new DOMException('browser private details', 'NotAllowedError');
  const deniedCapture = captureFor(async () => { throw denied; });
  await assert.rejects(deniedCapture.open('both'), { name: 'NotAllowedError' });
  assert.match(captureErrorMessage(denied), /キャンセルされたか、許可されませんでした/);
  assert.doesNotMatch(captureErrorMessage(denied), /private details/);
  assert.equal(new MonitorCapture(undefined).supported, false);
});

test('a late chooser cannot re-expose tracks after stopping or collide with a new capture', async () => {
  const staleStream = fixture();
  const currentStream = fixture();
  const resolve = [];
  const capture = captureFor(() => new Promise(resolveCapture => resolve.push(resolveCapture)));
  const stale = capture.open('both');
  capture.stop();
  const current = capture.open('both');
  resolve[1](currentStream);
  assert.equal(await current, currentStream);
  resolve[0](staleStream);
  assert.equal(await stale, null);
  assert.ok(staleStream.getTracks().every(track => track.readyState === 'ended'));
  assert.ok(currentStream.getTracks().every(track => track.readyState === 'live'));
  capture.stop();
  assert.equal(capture.active, false);
  assert.ok(currentStream.getTracks().every(track => track.readyState === 'ended'));
});

test('stops any returned audio when the chooser yields no usable video', async () => {
  const stream = fixture({ video: false });
  const capture = captureFor(async () => stream);
  await assert.rejects(capture.open('both'), { name: 'NotReadableError' });
  assert.equal(capture.active, false);
  assert.equal(stream.getAudioTracks()[0].readyState, 'ended');
});
