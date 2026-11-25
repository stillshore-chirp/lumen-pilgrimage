import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

const sourceRoot = new URL('../src/', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    const internal = context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && !specifier.endsWith('.ts');
    return nextResolve(internal ? `${specifier}.ts` : specifier, context);
  },
});
const { openCinemaScreening } = await import('../src/coast/world/cinema/cinemaSource.ts');
hook.deregister();

const FileClass = globalThis.File;
const SAMPLE_RATE = 48_000;
const PCM_GUID = [
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00,
  0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
];

function encodeAscii(value) {
  return Uint8Array.from([...value].map(character => character.charCodeAt(0)));
}

function chunk(id, body, sizeOverride) {
  const bytes = new Uint8Array(8 + body.length + (body.length & 1));
  bytes.set(encodeAscii(id), 0);
  new DataView(bytes.buffer).setUint32(4, sizeOverride ?? body.length, true);
  bytes.set(body, 8);
  return bytes;
}

function concat(...parts) {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function int24(value) {
  const sample = Math.max(-1, Math.min(0.99999988, value)) <= -1
    ? -0x800000
    : Math.round(Math.max(-1, Math.min(0.99999988, value)) * 0x7fffff);
  const unsigned = sample < 0 ? sample + 0x1000000 : sample;
  return [unsigned & 0xff, (unsigned >>> 8) & 0xff, (unsigned >>> 16) & 0xff];
}

function pcmData(channels, frames) {
  const bytes = new Uint8Array(channels.length * frames.length * 3);
  let offset = 0;
  for (const frame of frames) {
    assert.equal(frame.length, channels.length);
    for (const value of frame) {
      bytes.set(int24(value), offset);
      offset += 3;
    }
  }
  return bytes;
}

function fmtBody(channels, { extensibleMask } = {}) {
  const blockAlign = channels.length * 3;
  const avgBytesPerSecond = SAMPLE_RATE * blockAlign;
  if (extensibleMask === undefined) {
    const body = new Uint8Array(16);
    const view = new DataView(body.buffer);
    view.setUint16(0, 1, true);
    view.setUint16(2, channels.length, true);
    view.setUint32(4, SAMPLE_RATE, true);
    view.setUint32(8, avgBytesPerSecond, true);
    view.setUint16(12, blockAlign, true);
    view.setUint16(14, 24, true);
    return body;
  }
  const body = new Uint8Array(40);
  const view = new DataView(body.buffer);
  view.setUint16(0, 0xfffe, true);
  view.setUint16(2, channels.length, true);
  view.setUint32(4, SAMPLE_RATE, true);
  view.setUint32(8, avgBytesPerSecond, true);
  view.setUint16(12, blockAlign, true);
  view.setUint16(14, 24, true);
  view.setUint16(16, 22, true);
  view.setUint16(18, 24, true);
  view.setUint32(20, extensibleMask, true);
  body.set(PCM_GUID, 24);
  return body;
}

function waveFile(name, channels, frames, options = {}) {
  const fmt = chunk('fmt ', fmtBody(channels, options));
  const data = chunk('data', pcmData(channels, frames), options.container === undefined || options.container === 'RIFF' ? undefined : 0xffff_ffff);
  const payload = concat(fmt, data);
  let body;
  if (options.container === 'RF64' || options.container === 'BW64') {
    const ds64Body = new Uint8Array(28);
    const ds64View = new DataView(ds64Body.buffer);
    ds64View.setBigUint64(0, BigInt(4 + 8 + 28 + (28 & 1) + payload.length), true);
    ds64View.setBigUint64(8, BigInt(pcmData(channels, frames).length), true);
    ds64View.setBigUint64(16, BigInt(frames.length), true);
    ds64View.setUint32(24, 0, true);
    body = concat(chunk('ds64', ds64Body), payload);
  } else {
    body = payload;
  }
  const output = new Uint8Array(12 + body.length);
  output.set(encodeAscii(options.container ?? 'RIFF'), 0);
  new DataView(output.buffer).setUint32(4, options.container ? 0xffff_ffff : output.length - 8, true);
  output.set(encodeAscii('WAVE'), 8);
  output.set(body, 12);
  return new FileClass([output], name, { type: 'audio/wav' });
}

function manifestFile(value, name = 'screening.json') {
  return new FileClass([JSON.stringify(value)], name, { type: 'application/json' });
}

function videoFile(name = 'film.mp4') {
  return new FileClass([new Uint8Array([0, 1, 2])], name, { type: 'video/mp4' });
}

class SliceTrackingFile extends FileClass {
  ranges = [];

  slice(start, end, contentType) {
    this.ranges.push([start ?? 0, end ?? this.size]);
    return super.slice(start, end, contentType);
  }
}

test('opens a version-1 manifest, preserves exact filenames, and returns silent gaps in planar order', async () => {
  const bed = new SliceTrackingFile([waveFile('bed.wav', ['C'], [[0.25], [-0.5], [0.75]])], 'bed.wav', { type: 'audio/wav' });
  const object = waveFile('object.wav', ['C'], [[0.1], [0.2]]);
  const manifest = manifestFile({
    version: 1,
    durationSamples: 6,
    video: { file: 'film.mp4', startSample: -1 },
    bed: { file: 'bed.wav', startSample: 1, channels: ['C'], lfeGainDb: 0 },
    objects: [{ file: 'object.wav', startSample: 3, keys: [{ sample: 0, position: [0, 1, 2], gainDb: -3 }] }],
  });
  const asset = await openCinemaScreening([manifest, videoFile(), bed, object]);
  assert.equal(asset.video.name, 'film.mp4');
  assert.equal(asset.videoStartSample, -1);
  assert.deepEqual(asset.program.bed, ['C']);
  const [bedPlane, objectPlane] = await asset.read(0, 6);
  assert.deepEqual([...bedPlane.slice(0, 1)], [0]);
  assert.ok(Math.abs(bedPlane[1] - 0.25) < 1e-6);
  assert.ok(Math.abs(bedPlane[2] + 0.5) < 1e-6);
  assert.ok(Math.abs(bedPlane[3] - 0.75) < 1e-6);
  assert.deepEqual([...bedPlane.slice(4)], [0, 0]);
  assert.deepEqual([...objectPlane.slice(0, 3)], [0, 0, 0]);
  assert.ok(Math.abs(objectPlane[3] - 0.1) < 1e-6);
  assert.ok(Math.abs(objectPlane[4] - 0.2) < 1e-6);
  assert.equal(objectPlane[5], 0);
  assert.ok(bed.ranges.some(([start, end]) => start > 12 && end < bed.size));
});

test('checks extensible mask order and accepts RF64 and BW64 ds64 sizes', async () => {
  for (const container of ['RF64', 'BW64']) {
    const manifest = manifestFile({
      version: 1,
      durationSamples: 2,
      video: { file: `${container}.mp4`, startSample: 0 },
      bed: { file: `${container}.wav`, startSample: 0, channels: ['L', 'R'], lfeGainDb: 0 },
    });
    const bed = waveFile(`${container}.wav`, ['L', 'R'], [[0.1, -0.2], [0.3, -0.4]], { container, extensibleMask: 0x3 });
    const asset = await openCinemaScreening([manifest, videoFile(`${container}.mp4`), bed]);
    const [left, right] = await asset.read(0, 2);
    assert.ok(left[0] > 0 && right[0] < 0);
    assert.ok(left[1] > 0 && right[1] < 0);
  }
  const manifest = manifestFile({
    version: 1,
    durationSamples: 1,
    video: { file: 'film.mp4', startSample: 0 },
    bed: { file: 'bad.wav', startSample: 0, channels: ['L', 'R'], lfeGainDb: 0 },
  });
  const bad = waveFile('bad.wav', ['L', 'R'], [[0, 0]], { extensibleMask: 0x3f });
  await assert.rejects(() => openCinemaScreening([manifest, videoFile(), bad]), /channel mask/);
});

test('rejects malformed, ambiguous, and unsafe manifests before reading PCM', async () => {
  const base = {
    version: 1,
    durationSamples: 2,
    video: { file: 'film.mp4', startSample: 0 },
    bed: { file: 'bed.wav', startSample: 0, channels: ['C'], lfeGainDb: 0 },
  };
  await assert.rejects(() => openCinemaScreening([manifestFile({ ...base, bed: { ...base.bed, channels: ['L'] } }), videoFile(), waveFile('bed.wav', ['C'], [[0], [0]])]), /bed.channels/);
  await assert.rejects(() => openCinemaScreening([manifestFile({ ...base, bed: { ...base.bed, channels: ['C'], lfeGainDb: 6 } }), videoFile(), waveFile('bed.wav', ['C'], [[0], [0]])]), /lfeGainDb/);
  await assert.rejects(() => openCinemaScreening([manifestFile({ ...base, objects: [{ file: 'bed.wav', startSample: 0, keys: [{ sample: 1, position: [0, 0, 0], gainDb: 0 }, { sample: 1, position: [0, 0, 0], gainDb: 0 }] }] }), videoFile(), waveFile('bed.wav', ['C'], [[0], [0]])]), /ascending/);
  const rf64WithoutDs64 = new FileClass([new Uint8Array([
    0x52, 0x46, 0x36, 0x34, 0xff, 0xff, 0xff, 0xff, 0x57, 0x41, 0x56, 0x45,
    0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00,
  ])], 'broken.wav', { type: 'audio/wav' });
  await assert.rejects(() => openCinemaScreening([manifestFile({ ...base, bed: { ...base.bed, file: 'broken.wav' } }), videoFile(), rf64WithoutDs64]), /ds64/);
  const stereoObjectManifest = manifestFile({
    ...base,
    objects: [{ file: 'object.wav', startSample: 0, keys: [{ sample: 0, position: [0, 0, 0], gainDb: 0 }] }],
  });
  await assert.rejects(() => openCinemaScreening([
    stereoObjectManifest, videoFile(), waveFile('bed.wav', ['C'], [[0], [0]]), waveFile('object.wav', ['L', 'R'], [[0, 0]]),
  ]), /モノPCM/);
});
