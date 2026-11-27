import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { db, decodeMonoWav, encodeWav, signalStats, visualization } from './koto-analysis.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const expectedStudy = '69701b1e43fd09304edb6abf5b720dbb4c6a9f16fdf17ab56a1e4e47d83cc869';
const expectedProduction = 'f03afd345cf9e24e20bdae9c266548a703126541be73b86e748ebea44e05bb0d';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function inside(directory, path) {
  const result = resolve(directory, path);
  const local = relative(directory, result);
  assert.ok(local && !local.startsWith(`..${sep}`) && local !== '..' && !local.startsWith(sep), 'Input path must remain in its declared directory');
  return result;
}

async function actualUiParser() {
  const source = await readFile(resolve(root, 'src/dev/kotoAudition.ts'), 'utf8');
  const ast = ts.createSourceFile('ui.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set(['isRecord', 'record', 'string', 'number', 'list', 'sameOriginUrl', 'parseManifest', 'numbers', 'parseVisualization']);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
  assert.equal(functions.length, names.size);
  const js = ts.transpileModule(functions.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(`${js}; ({parseManifest,parseVisualization})`, {
    URL, location: { origin: 'http://127.0.0.1:4191' },
    manifestUrl: new URL('http://127.0.0.1:4191/artifacts/koto-recorded-sustain-trial/current-manifest.json'),
  });
}

// Packages the frozen comparison and delivery; it never renders the historical methods again.
export async function packageDeliveryAudition(
  source = '/private/tmp/lumen-koto-recorded-sustain-trial',
  output = resolve(root, 'artifacts/koto-recorded-sustain-trial'),
) {
  source = resolve(source); output = resolve(output);
  assert.ok(source !== output && !output.startsWith(source + sep) && !source.startsWith(output + sep));
  const oldBytes = await readFile(resolve(source, 'manifest.json'));
  assert.equal(hash(oldBytes), expectedStudy, 'Historical study must be the frozen 30-clip input');
  const original = JSON.parse(oldBytes);
  assert.equal(original.clips.length, 30);
  assert.ok(!original.methods.some(method => method.id === 'current-delivery'));
  const metadataPath = 'assets/lake-audio/production.json';
  const metadataBytes = await readFile(resolve(root, metadataPath));
  const production = JSON.parse(metadataBytes);
  assert.equal(production.output.path, 'public/lake-audio/koto-performance.wav');
  const productionBytes = await readFile(inside(root, production.output.path));
  assert.equal(hash(productionBytes), expectedProduction);
  assert.equal(production.output.sha256, expectedProduction);
  const inputHashes = { ...production.inputHashes, [metadataPath]: hash(metadataBytes), [production.output.path]: expectedProduction };
  await Promise.all(Object.entries(inputHashes).map(async ([path, expected]) => {
    assert.equal(hash(await readFile(inside(root, path))), expected, `Current delivery input changed: ${path}`);
  }));
  const decoded = decodeMonoWav(productionBytes);
  assert.equal(decoded.sampleRate, 48000); assert.equal(decoded.samples.length, 1872000);
  assert.equal(production.channels, 1); assert.equal(production.pcmBits, 24);
  assert.equal(production.frames, decoded.samples.length);
  const rawStats = signalStats(decoded.samples, decoded.sampleRate);
  const matchGainDb = original.normalization.targetRmsDbfs - rawStats.rmsDbfs;
  assert.ok(Math.abs(matchGainDb) < 1e-6, 'Delivered score must already be RMS-anchored');
  const commonSafetyGainDb = original.normalization.commonSafetyGainDb;
  assert.ok(Number.isFinite(commonSafetyGainDb) && commonSafetyGainDb <= 0);
  const gain = 10 ** ((matchGainDb + commonSafetyGainDb) / 20);
  const matchedSamples = Float32Array.from(decoded.samples, value => value * gain);
  const matchedBytes = encodeWav(matchedSamples, decoded.sampleRate);
  const matched = decodeMonoWav(matchedBytes);
  assert.equal(matched.samples.length, decoded.samples.length); assert.equal(matched.sampleRate, decoded.sampleRate);
  let maximumGainError = 0;
  for (let i = 0; i < decoded.samples.length; i += 1) maximumGainError = Math.max(maximumGainError, Math.abs(matched.samples[i] - decoded.samples[i] * gain));
  assert.ok(maximumGainError <= 2 / 32768, 'Matched PCM must apply exactly the declared gain within 16-bit quantization');
  const matchedStats = signalStats(matched.samples, matched.sampleRate);
  assert.ok(matchedStats.samplePeakDbfs <= original.normalization.peakLimitDbfs + .001);
  const scoreCase = original.cases.find(item => item.id === 'score-39'); assert.ok(scoreCase);
  const plot = visualization(decoded.samples, decoded.sampleRate, scoreCase.onsetSeconds ?? 0);
  const files = { rawWav: 'current-delivery.raw.pcm24.wav', matchedWav: 'current-delivery.matched.wav',
    visualization: 'current-delivery.visualization.json', measurementsFile: 'current-delivery.measurements.json' };
  const measurements = { ...rawStats, matched: matchedStats, gainVerification: { matchGainDb, commonSafetyGainDb, appliedGain: gain,
    maximumAbsoluteError: maximumGainError, quantizationTolerance: 2 / 32768, matchedPcmBits: 16 },
    gates: { finite: rawStats.nonFiniteCount === 0, duration: rawStats.durationSeconds === 39,
      dc: rawStats.absoluteDcDbfs <= -60, loopSeam: rawStats.loopSeamDbfs <= -80,
      comparisonPeak: matchedStats.samplePeakDbfs <= original.normalization.peakLimitDbfs + .001 },
    limitation: 'Technical container/signal checks only. Owner closure is not human quality certification; historical performance gates are not reclassified.' };
  const plotBytes = jsonBytes(plot), measurementBytes = jsonBytes(measurements);
  const clip = { id: 'current-delivery-score-39', method: 'current-delivery', case: 'score-39', sampleRate: decoded.sampleRate,
    frames: decoded.samples.length, durationSeconds: rawStats.durationSeconds, matchGainDb, commonSafetyGainDb,
    ...files, measurements, sha256: { rawWav: expectedProduction, matchedWav: hash(matchedBytes),
      visualization: hash(plotBytes), measurementsFile: hash(measurementBytes) } };
  const method = { id: 'current-delivery', label: '今回の区切りの音源（聴感未評価）',
    status: 'timeboxed-delivery-human-quality-not-certified', nativeSampleRate: decoded.sampleRate, sourceHashes: inputHashes,
    limitations: ['所有者の終了合意による今回の区切りです。音質合格を意味しません。',
      '録音tailには有限の時間加工があります。自然な未来の減衰を実録したものではありません。',
      '相対励振補正は設計上の仮定で、実測の強弱層や楽器同定ではありません。'] };
  const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), sampleRate: decoded.sampleRate, channels: 1,
    baseline: original.baseline, status: 'current-delivery-plus-historical-comparison-human-quality-not-certified',
    inputHashes, sourceDrift: [], methods: [method, ...original.methods], cases: original.cases,
    normalization: { ...original.normalization, anchors: { ...original.normalization.anchors,
      'current-delivery:score': { case: 'score-39', rmsDbfs: rawStats.rmsDbfs, gainDb: matchGainDb } } },
    clips: [clip, ...original.clips], unavailableClips: original.unavailableClips ?? [],
    unperformed: [...new Set([...production.unperformed, ...original.unperformed])],
    currentDelivery: { productionMetadata: metadataPath, productionMetadataSha256: hash(metadataBytes),
      productionWav: production.output.path, productionWavSha256: expectedProduction,
      inputClosureVerified: Object.keys(inputHashes), packagingHelper: 'scripts/koto-delivery-audition.mjs',
      packagingHelperSha256: hash(await readFile(fileURLToPath(import.meta.url))), maximumGainError,
      rawIsByteIdenticalDelivery: true, currentAudioGeneratedHere: false },
    historicalStudy: { manifest: 'manifest.json', sha256: expectedStudy, clips: original.clips.length,
      inputHashesAtOriginalRendering: original.inputHashes, sourceDriftAtOriginalGeneration: original.sourceDrift,
      provenanceScope: 'Original rendering-time metadata only; copied unchanged, not revalidated as current inputs and not rerendered. Archive relocation is not new audio generation.' },
    reproduction: 'node --experimental-transform-types scripts/koto-delivery-audition.mjs /private/tmp/lumen-koto-recorded-sustain-trial artifacts/koto-recorded-sustain-trial' };
  const parser = await actualUiParser();
  parser.parseManifest(manifest); parser.parseVisualization(plot);
  await mkdir(dirname(output), { recursive: true });
  await cp(source, output, { recursive: true });
  assert.equal(hash(await readFile(resolve(output, 'manifest.json'))), expectedStudy);
  const historicalFiles = [...new Set(original.clips.flatMap(item => [item.rawWav, item.matchedWav, item.visualization, item.measurementsFile].filter(Boolean)))];
  await Promise.all(historicalFiles.map(async path => {
    assert.equal(hash(await readFile(inside(output, path))), hash(await readFile(inside(source, path))), `Copied historical file changed: ${path}`);
  }));
  await Promise.all([[files.rawWav, productionBytes], [files.matchedWav, matchedBytes],
    [files.visualization, plotBytes], [files.measurementsFile, measurementBytes]].map(([path, bytes]) => writeFile(inside(output, path), bytes)));
  const currentBytes = jsonBytes(manifest);
  await writeFile(resolve(output, 'current-manifest.json'), currentBytes);
  const written = JSON.parse(await readFile(resolve(output, 'current-manifest.json')));
  assert.equal(written.clips.length, 31); parser.parseManifest(written);
  assert.equal(JSON.stringify(written.clips.slice(1)), JSON.stringify(original.clips));
  assert.equal(JSON.stringify(written.methods.slice(1)), JSON.stringify(original.methods));
  for (const [key, value] of Object.entries(original.normalization.anchors)) assert.deepEqual(written.normalization.anchors[key], value);
  assert.equal(written.normalization.commonSafetyGainDb, original.normalization.commonSafetyGainDb);
  assert.equal(hash(await readFile(resolve(output, files.rawWav))), expectedProduction);
  assert.equal(hash(await readFile(resolve(output, files.matchedWav))), clip.sha256.matchedWav);
  return { manifest: resolve(output, 'current-manifest.json'), manifestSha256: hash(currentBytes), clips: 31,
    historicalManifestSha256: expectedStudy, productionWavSha256: expectedProduction,
    inputClosureFiles: Object.keys(inputHashes).length, historicalFilesPreserved: historicalFiles.length,
    matchGainDb, commonSafetyGainDb, maximumGainError, actualUiParser: 'pass', humanListening: 'not performed' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await packageDeliveryAudition(process.argv[2], process.argv[3]))); }
  catch { console.error('Delivery audition packaging failed; input closure, frozen artifacts or validation did not match. No subprocess output is forwarded.'); process.exitCode = 1; }
}
