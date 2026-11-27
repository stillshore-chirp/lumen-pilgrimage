import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { renderPhysicalKotoNote } from '../src/coast/world/lake/kotoPhysicalModel.ts';
import { renderHybridKotoNote, renderSampleKotoNote } from '../src/coast/world/lake/kotoSampleModel.ts';
import { applyKotoExcitationColor } from '../src/coast/world/lake/kotoExcitationColor.ts';
import { renderKotoPerformance } from '../src/coast/world/lake/kotoPerformance.ts';
import { decodeMonoWav, resample, signalStats } from './koto-analysis.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** TPDF at one 24-bit step; deterministic seed keeps the distributed waveform reproducible. */
export function encodePcm24(samples, sampleRate, seed = 0x6b6f746f) {
  const wav = Buffer.alloc(44 + samples.length * 3);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 3, 28);
  wav.writeUInt16LE(3, 32); wav.writeUInt16LE(24, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples.length * 3, 40);
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
  for (let i = 0; i < samples.length; i += 1) {
    if (!Number.isFinite(samples[i]) || Math.abs(samples[i]) > 0.99) throw new RangeError('Production PCM needs finite samples and headroom.');
    const quantized = Math.round(samples[i] * 8388608 + random() - random());
    wav.writeIntLE(quantized, 44 + i * 3, 3);
  }
  return wav;
}

export function decodePcm24(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.readUInt16LE(20) !== 1
    || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 24 || wav.toString('ascii', 36, 40) !== 'data') {
    throw new Error('Unexpected production WAV header.');
  }
  const frames = wav.readUInt32LE(40) / 3;
  if (!Number.isInteger(frames) || wav.length !== 44 + frames * 3) throw new Error('Unexpected production WAV size.');
  return { sampleRate: wav.readUInt32LE(24), samples: Float32Array.from({ length: frames }, (_, i) => wav.readIntLE(44 + i * 3, 3) / 8388608) };
}

export async function prepareKotoPerformance({ method = 'sample-sustain-color', internalSampleRate = 48000, sampleBankPath } = {}) {
  const recorded = method === 'sample-sustain' || method === 'sample-sustain-color';
  if (!['physical', 'hybrid', 'sample-sustain', 'sample-sustain-color'].includes(method)
    || ![48000, 96000].includes(internalSampleRate) || (recorded && internalSampleRate !== 48000)) {
    throw new RangeError('Choose a supported method and its validated internal rate.');
  }
  const inputs = ['scripts/prepare-koto-performance.mjs', 'scripts/koto-analysis.mjs',
    'src/coast/world/lake/kotoPerformance.ts'];
  if (!recorded) inputs.push('src/coast/world/lake/kotoPhysicalModel.ts');
  if (method === 'sample-sustain-color') inputs.push('src/coast/world/lake/kotoExcitationColor.ts');
  const bank = [];
  const sourceIds = new Set();
  if (method === 'hybrid' || recorded) {
    const bankPath = sampleBankPath ?? (recorded
      ? 'public/lake-audio/samples/sustain/bank.json' : 'public/lake-audio/samples/bank.json');
    if (bankPath.startsWith('/') || bankPath.split(/[\\/]/).includes('..')
      || !bankPath.startsWith('public/lake-audio/samples/')) throw new Error('Invalid production bank path.');
    inputs.push('src/coast/world/lake/kotoSampleModel.ts', bankPath);
    const ledger = JSON.parse(await readFile(resolve(root, 'assets/lake-audio/sample-manifest.json')));
    const metadata = JSON.parse(await readFile(resolve(root, bankPath)));
    if (!Array.isArray(metadata.samples) || metadata.samples.length === 0) throw new Error('Empty production bank.');
    for (const item of metadata.samples) {
      if (item.path !== item.path.split(/[\\/]/).at(-1)) throw new Error('Invalid sample path.');
      const path = `${dirname(bankPath).replaceAll('\\', '/')}/${item.path}`;
      const bytes = await readFile(resolve(root, path));
      if (hash(bytes) !== item.sha256) throw new Error('Sample bank input changed.');
      const sourceId = String(item.sourceId).startsWith('freesound-') ? item.sourceId : `freesound-${item.sourceId}`;
      if (!ledger.sources.some(source => source.id === sourceId && source.status === 'adopted' && source.license.spdx === 'CC0-1.0')) {
        throw new Error('Production input is not an adopted CC0 source.');
      }
      sourceIds.add(sourceId); inputs.push(path);
      bank.push({ ...item, ...decodeMonoWav(bytes) });
    }
  }
  const inputHashes = Object.fromEntries(await Promise.all(inputs.map(async path => [path, hash(await readFile(resolve(root, path)))])));
  const diagnostics = [];
  const renderer = method === 'physical' ? renderPhysicalKotoNote : (note, rate) => {
    const result = recorded ? renderSampleKotoNote(note, bank, rate)
      : renderHybridKotoNote(note, bank, renderPhysicalKotoNote, rate);
    if (method !== 'sample-sustain-color') {
      diagnostics.push(result.diagnostics);
      return result.samples;
    }
    const color = applyKotoExcitationColor(result.samples, note.velocity, rate);
    diagnostics.push({ ...result.diagnostics, relativeExcitation: {
      bypassed: color.bypassed, latencyFrames: color.latencyFrames,
      processedFrames: color.processedFrames, tailFramesClipped: color.tailFramesClipped,
    } });
    return color.samples;
  };
  const start = performance.now();
  const cpu = process.cpuUsage();
  const beforeMemory = process.memoryUsage();
  const generated = renderKotoPerformance(renderer, internalSampleRate);
  const rendered = resample(generated, internalSampleRate, 48000);
  const raw = signalStats(rendered);
  // Preserve the old performance's average level, with a hard -3 dBFS sample-peak ceiling.
  const gain = Math.min(10 ** (-24 / 20) / raw.rms, 10 ** (-3 / 20) / raw.samplePeak);
  const levelled = Float32Array.from(rendered, value => value * gain);
  const wav = encodePcm24(levelled, 48000);
  const decoded = decodePcm24(wav);
  let errorEnergy = 0;
  let maximumError = 0;
  for (let i = 0; i < levelled.length; i += 1) {
    const error = decoded.samples[i] - levelled[i];
    maximumError = Math.max(maximumError, Math.abs(error)); errorEnergy += error * error;
  }
  const changed = [];
  for (const [path, expected] of Object.entries(inputHashes)) if (hash(await readFile(resolve(root, path))) !== expected) changed.push(path);
  if (changed.length) throw new Error('Production inputs changed during rendering.');
  const output = 'public/lake-audio/koto-performance.wav';
  const evidence = {
    schemaVersion: 1, method, qualityStatus: recorded
      ? 'timeboxed-delivery-human-quality-not-certified' : 'historical-model-comparison-only',
    internalSampleRate, sampleRate: 48000, channels: 1, frames: decoded.samples.length,
    durationSeconds: 39, pcmBits: 24, dither: { type: 'TPDF', seed: 0x6b6f746f },
    targetRmsDbfs: -24, samplePeakLimitDbfs: -3, gain, gainDb: 20 * Math.log10(gain),
    inputHashes, sourceIds: [...sourceIds].sort(),
    output: { path: output, sha256: hash(wav), bytes: wav.length },
    raw, delivered: signalStats(decoded.samples),
    quantization: { maximumAbsoluteError: maximumError, rmsErrorDbfs: 10 * Math.log10(errorEnergy / levelled.length) },
    diagnosticsSummary: { notes: diagnostics.length,
      physicalFallbackNotes: diagnostics.filter(item => item.method === 'physical-fallback').length,
      relativeExcitationNotes: diagnostics.filter(item => item.relativeExcitation && !item.relativeExcitation.bypassed).length,
      clippedFilterTails: diagnostics.reduce((sum, item) => sum + (item.relativeExcitation?.tailFramesClipped ?? 0), 0) },
    performance: { wallMs: performance.now() - start, cpu: process.cpuUsage(cpu),
      retainedPcmBytes: rendered.byteLength, arrayBuffersDeltaBytes: process.memoryUsage().arrayBuffers - beforeMemory.arrayBuffers },
    limitations: recorded ? ['Recorded tails include bounded offline time modification, not the original future decay.',
      'Relative contact colour is a design assumption, not measured velocity layers or body identification.'] : [],
    unperformed: ['human-listening-of-final-delivery', 'verified-thirteen-string-recording-identity', 'physical-headphone-calibration'],
  };
  await mkdir(resolve(root, 'public/lake-audio'), { recursive: true });
  await writeFile(resolve(root, output), wav);
  await writeFile(resolve(root, 'assets/lake-audio/production.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareKotoPerformance({ method: process.argv[2] ?? 'sample-sustain-color',
      internalSampleRate: Number(process.argv[3] ?? 48000), sampleBankPath: process.argv[4] });
    console.log(JSON.stringify({ method: result.method, internalSampleRate: result.internalSampleRate,
      output: result.output, delivered: { peakDbfs: result.delivered.samplePeakDbfs, rmsDbfs: result.delivered.rmsDbfs },
      qualityStatus: result.qualityStatus, wallMs: result.performance.wallMs }));
  } catch { console.error('Koto performance preparation failed; inspect the fixed local inputs.'); process.exitCode = 1; }
}
