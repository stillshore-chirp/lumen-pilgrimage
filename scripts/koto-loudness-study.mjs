import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMonoWav, encodeWav, signalStats } from './koto-analysis.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ids = ['legacy', 'physical', 'hybrid', 'production96'];
const ffmpeg = '/usr/local/bin/ffmpeg';
const filters = {
  ebur128: 'ebur128=peak=true:metadata=1:dualmono=false:framelog=verbose,ametadata=mode=print:key=lavfi.r128.I',
  loudnorm: 'loudnorm=I=-24:LRA=7:TP=-3:dual_mono=false:print_format=json',
};

// Supplemental comparison criteria, not thresholds for musical naturalness.
export const LOUDNESS_CRITERIA = Object.freeze({
  comparisonSpreadLu: 0.5, meterAgreementLu: 0.15, truePeakAgreementDb: 0.2,
  calibrationLoudnessToleranceLu: 0.15, calibrationPeakToleranceDb: 0.15,
});

function invoke(args) {
  const result = spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function parseEbur128(text) {
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const integrated = summary.match(/Integrated loudness:[\s\S]*?\bI:\s*(-?[\d.]+)\s+LUFS/);
  const preciseIntegrated = [...text.matchAll(/lavfi\.r128\.I=(-?[\d.]+)/g)].at(-1);
  const peak = summary.match(/True peak:[\s\S]*?Peak:\s*(-?[\d.]+)\s+dBFS/);
  if (!integrated || !peak) throw new Error('EBU meter summary unavailable');
  return { integratedLufs: Number(preciseIntegrated?.[1] ?? integrated[1]),
    integratedSummaryLufs: Number(integrated[1]), truePeakDbtp: Number(peak[1]),
    reportingPrecisionDb: preciseIntegrated ? 0.001 : 0.1, truePeakReportingPrecisionDb: 0.1 };
}

export function parseLoudnorm(text) {
  const match = [...text.matchAll(/\{\s*"input_i"\s*:[\s\S]*?\}/g)].at(-1);
  if (!match) throw new Error('Loudnorm input statistics unavailable');
  const data = JSON.parse(match[0]);
  const result = { integratedLufs: Number(data.input_i), truePeakDbtp: Number(data.input_tp),
    relativeThresholdLufs: Number(data.input_thresh), reportingPrecisionDb: 0.01 };
  if (Object.values(result).some(value => !Number.isFinite(value))) throw new Error('Loudnorm values are not finite');
  return result;
}

async function measure(path, name, output) {
  const meters = {};
  for (const [id, filter] of Object.entries(filters)) {
    const result = invoke(['-nostdin', '-hide_banner', '-nostats', '-loglevel', 'info',
      '-protocol_whitelist', 'file,pipe', '-i', path, '-map', '0:a:0', '-af', filter, '-f', 'null', '-']);
    await writeFile(resolve(output, `${name}.${id}.log`), result.stderr);
    if (result.status !== 0) throw new Error('Loudness measurement failed; raw output is retained locally');
    meters[id] = id === 'ebur128' ? parseEbur128(result.stderr) : parseLoudnorm(result.stderr);
  }
  return { ...meters, agreement: {
    integratedDifferenceLu: meters.ebur128.integratedLufs - meters.loudnorm.integratedLufs,
    truePeakDifferenceDb: meters.ebur128.truePeakDbtp - meters.loudnorm.truePeakDbtp,
    integratedPass: Math.abs(meters.ebur128.integratedLufs - meters.loudnorm.integratedLufs) <= LOUDNESS_CRITERIA.meterAgreementLu,
    truePeakPass: Math.abs(meters.ebur128.truePeakDbtp - meters.loudnorm.truePeakDbtp) <= LOUDNESS_CRITERIA.truePeakAgreementDb,
  } };
}

export async function runLoudnessStudy(directory = '/private/tmp/lumen-koto-evaluation',
  output = resolve(directory, 'loudness')) {
  await mkdir(output, { recursive: true });
  const versionResult = invoke(['-hide_banner', '-version']);
  const version = versionResult.stdout.match(/^ffmpeg version\s+(\S+)/m)?.[1];
  if (versionResult.status !== 0 || !version) throw new Error('FFmpeg version could not be verified');
  const manifestBytes = await readFile(resolve(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));

  // BS.1770 Annex 1 gives -3.01 LKFS for a full-scale 997 Hz sine. Half amplitude
  // adds -6.0206 dB. This tests this configuration, not full meter certification.
  const tone = Float32Array.from({ length: 48_000 * 6 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 997 * i / 48_000));
  const calibrationPath = resolve(output, 'calibration-997hz-half-scale.wav');
  await writeFile(calibrationPath, encodeWav(tone, 48_000, true));
  const calibration = await measure(calibrationPath, 'calibration', output);
  const expectedLufs = -3.01 + 20 * Math.log10(0.5);
  const expectedPeakDbtp = 20 * Math.log10(0.5);
  calibration.expected = { integratedLufs: expectedLufs, truePeakDbtp: expectedPeakDbtp };
  calibration.pass = Object.values({ ebur128: calibration.ebur128, loudnorm: calibration.loudnorm }).every(meter =>
    Math.abs(meter.integratedLufs - expectedLufs) <= LOUDNESS_CRITERIA.calibrationLoudnessToleranceLu
    && Math.abs(meter.truePeakDbtp - expectedPeakDbtp) <= LOUDNESS_CRITERIA.calibrationPeakToleranceDb);
  if (!calibration.pass) throw new Error('Meter configuration failed the 997 Hz calibration check');

  const clips = [];
  for (const id of ids) {
    const clip = manifest.clips.find(candidate => candidate.method === id && candidate.case === 'score-39');
    if (!clip) throw new Error('A required whole-programme comparison is missing');
    for (const kind of ['rawWav', 'matchedWav']) {
      const filename = clip[kind];
      if (typeof filename !== 'string' || filename !== filename.split(/[\\/]/).at(-1)) throw new Error('Unexpected comparison filename');
      const path = resolve(directory, filename);
      const bytes = await readFile(path);
      if (hash(bytes) !== clip.sha256[kind]) throw new Error('Whole-programme WAV hash changed');
      const decoded = decodeMonoWav(bytes);
      if (decoded.sampleRate !== 48000 || decoded.samples.length !== 39 * 48000) throw new Error('Programme layout is not mono 48 kHz / 39 seconds');
      clips.push({ method: id, kind, wav: filename, sha256: hash(bytes),
        stats: signalStats(decoded.samples), meters: await measure(path, `${id}-${kind}`, output) });
    }
  }
  const matched = clips.filter(clip => clip.kind === 'matchedWav');
  const integrated = matched.map(clip => clip.meters.loudnorm.integratedLufs);
  const spreadLu = Math.max(...integrated) - Math.min(...integrated);
  // Only negative fixed-gain corrections are proposed, so existing peak headroom
  // cannot be consumed. The programme's dynamics and the RMS comparison are kept.
  const targetLufs = Math.min(...integrated);
  const proposal = { status: spreadLu > LOUDNESS_CRITERIA.comparisonSpreadLu ? 'proposed-not-applied' : 'not-needed-for-this-threshold',
    targetIntegratedLufs: targetLufs, strategy: 'whole-programme fixed gain only; no limiter or compression',
    originalRmsComparisonRetained: true, productionGainUnchanged: true,
    corrections: matched.map(clip => ({ method: clip.method,
      gainDb: targetLufs - clip.meters.loudnorm.integratedLufs,
      predictedTruePeakDbtp: clip.meters.loudnorm.truePeakDbtp + targetLufs - clip.meters.loudnorm.integratedLufs })),
  };
  const study = { schemaVersion: 1, generatedAt: new Date().toISOString(),
    scope: '39-second dry mono programmes only; no inference of short-note equal loudness or human naturalness',
    manifestSha256: hash(manifestBytes), manifestGeneratedAt: manifest.generatedAt,
    sourceSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    ffmpeg: { path: ffmpeg, version, filters, dualMono: false,
      interpretation: 'ebur128 scanner and loudnorm input JSON; loudnorm output is discarded. Same mono convention for all methods.' },
    criteria: LOUDNESS_CRITERIA, calibration, clips,
    comparison: { rmsMatchedProgrammeLoudnessSpreadLu: spreadLu,
      comparisonThresholdExceeded: spreadLu > LOUDNESS_CRITERIA.comparisonSpreadLu }, proposal,
    limitations: ['No BS.2217 full conformance suite was run; the 997 Hz check is a configuration check only.',
      'Two filters in one FFmpeg build are cross-checks, not independent certified meters.',
      '39 seconds is too short to interpret Loudness Range as a stable programme statistic.',
      'Mono dry-level matching is not HRTF stereo matching or SPL calibration.',
      'Programme LUFS estimates subjective loudness; human listening remains unperformed.'],
    sources: ['https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf',
      'https://tech.ebu.ch/docs/tech/tech3343.pdf', 'https://ffmpeg.org/ffmpeg-filters.html#ebur128',
      'https://ffmpeg.org/ffmpeg-filters.html#loudnorm'],
  };
  await writeFile(resolve(output, 'study.json'), `${JSON.stringify(study, null, 2)}\n`);
  return study;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const directory = process.argv[2] ? resolve(process.argv[2]) : undefined;
    const study = await runLoudnessStudy(directory, process.argv[3] ? resolve(process.argv[3]) : undefined);
    console.log(JSON.stringify({ version: study.ffmpeg.version, calibrationPass: study.calibration.pass,
      programmes: study.clips.length / 2, spreadLu: study.comparison.rmsMatchedProgrammeLoudnessSpreadLu,
      proposal: study.proposal.status, output: resolve(process.argv[3] || resolve(directory || '/private/tmp/lumen-koto-evaluation', 'loudness'), 'study.json') }));
  } catch {
    console.error('Koto loudness study failed; meter logs remain local and no raw diagnostics are forwarded.');
    process.exitCode = 1;
  }
}
