import { createHash } from 'node:crypto';
import { readFile, realpath, readdir } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const audioExtensions = new Set(['.wav', '.ogg', '.flac', '.mp3', '.aif', '.aiff']);
const hashPattern = /^[a-f0-9]{64}$/;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const webUrl = value => {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
};

/** Checks provenance record structure and file correspondence, never legal or perceptual validity. */
export async function validateAudioSamples(root, manifest) {
  const errors = [];
  const inventory = new Map();
  const sourceIds = new Set();
  const adoptedIds = new Set();
  const rootReal = await realpath(root);
  const fail = (id, message) => errors.push(`${id}: ${message}`);
  async function inside(path, id) {
    if (!nonempty(path) || isAbsolute(path)) { fail(id, 'expected repository-relative path'); return; }
    const resolved = resolve(rootReal, path);
    const rel = relative(rootReal, resolved);
    if (rel === '..' || rel.startsWith(`..${sep}`)) { fail(id, 'path leaves repository'); return; }
    try {
      const actual = await realpath(resolved);
      const realRel = relative(rootReal, actual);
      if (realRel === '..' || realRel.startsWith(`..${sep}`)) { fail(id, 'symlink leaves repository'); return; }
      return actual;
    } catch { fail(id, 'referenced path is missing'); }
  }
  async function outputFile(file, id) {
    if (!record(file)) { fail(id, 'invalid distribution record'); return; }
    const path = await inside(file.path, id);
    if (!hashPattern.test(file.sha256 ?? '') || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) {
      fail(id, 'distribution hash and positive byte count required');
    }
    if (!path) return;
    let data;
    try { data = await readFile(path); } catch { fail(id, 'distribution is not a readable file'); return; }
    const actual = createHash('sha256').update(data).digest('hex');
    if (actual !== file.sha256 || data.length !== file.bytes) fail(id, 'distribution bytes/hash mismatch');
    const previous = inventory.get(file.path);
    if (previous && previous !== actual) fail(id, 'conflicting distribution records');
    inventory.set(file.path, actual);
  }
  if (!record(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources)) {
    return { errors: ['manifest: schemaVersion 1 and sources array required'], files: 0, adoptedSources: 0 };
  }
  for (const source of manifest.sources) {
    const id = nonempty(source?.id) ? source.id : '(missing source id)';
    if (sourceIds.has(id)) fail(id, 'duplicate source id');
    sourceIds.add(id);
    if (!['candidate', 'adopted', 'rejected'].includes(source?.status)) fail(id, 'unknown adoption status');
    const outputs = Array.isArray(source?.distribution) ? source.distribution : [];
    const usage = Array.isArray(source?.usage) ? source.usage : [];
    if (source?.status !== 'adopted') {
      if (outputs.length || usage.length) fail(id, 'unadopted candidate has distributed files or active usage');
      continue;
    }
    adoptedIds.add(id);
    const required = ['nameAndFiles', 'roles', 'officialSource', 'license', 'checkedDate', 'licenseEvidence',
      'rights', 'thirdParty', 'sourceIdentity', 'retrievalAndProcessing', 'distribution', 'usage', 'quality', 'uncertainties'];
    for (const field of required) if (!(field in source)) fail(id, `missing evidence field ${field}`);
    if (!nonempty(source.nameAndFiles?.title) || !nonempty(source.nameAndFiles?.originalFilename)) {
      fail(id, 'material name and acquired/original filename required');
    }
    for (const role of ['creator', 'recordist', 'performer']) {
      if (!nonempty(source.roles?.[role])) fail(id, `role ${role} assessment required`);
    }
    if (!webUrl(source.officialSource?.url) || !webUrl(source.license?.statementUrl)
      || !webUrl(source.license?.legalCodeUrl)) fail(id, 'source, license statement and legal-code URLs required');
    if (!nonempty(source.license?.spdx)) fail(id, 'license identifier required');
    const requiredLicense = manifest.casePolicy?.newExternalAudioLicense;
    if (requiredLicense && source.license?.spdx !== requiredLicense) fail(id, 'license conflicts with case policy');
    if (source.license?.spdx === 'CC0-1.0'
      && !/^https?:\/\/(?:www\.)?creativecommons\.org\/publicdomain\/zero\/1\.0\//.test(source.licenseEvidence?.observedLicenseHref ?? '')) {
      fail(id, 'CC0 1.0 observation link required');
    }
    if (!/^\d{4}-\d\d-\d\d$/.test(source.checkedDate ?? '')
      || !Number.isFinite(Date.parse(source.licenseEvidence?.checkedAt))
      || !nonempty(source.licenseEvidence?.shortRecord)) fail(id, 'dated license observation record required');
    if (!hashPattern.test(source.sourceIdentity?.sha256 ?? '') || !(source.sourceIdentity?.bytes > 0)
      || typeof source.sourceIdentity?.complete !== 'boolean' || !nonempty(source.sourceIdentity?.kind)) {
      fail(id, 'acquired source hash, bytes, kind and completeness required');
    }
    if (!nonempty(source.rights?.affirmer) || !Array.isArray(source.rights?.confirmedScope)
      || !source.rights.confirmedScope.length || !nonempty(source.rights?.basis)) fail(id, 'rights scope and basis required');
    for (const field of ['composition', 'performance', 'recording', 'otherRights', 'intent', 'conclusion']) {
      if (!nonempty(source.thirdParty?.[field])) fail(id, `third-party assessment ${field} required`);
    }
    if (!nonempty(source.quality?.status) || !nonempty(source.quality?.evidence)
      || !Array.isArray(source.uncertainties)) fail(id, 'quality evidence and explicit uncertainty list required');
    if (!Array.isArray(source.retrievalAndProcessing?.steps) || !source.retrievalAndProcessing.steps.length) {
      fail(id, 'retrieval/processing steps required');
    }
    if (!outputs.length || !usage.length) fail(id, 'adopted source needs distribution and usage');
    for (const output of outputs) await outputFile(output, id);
    for (const use of usage) {
      await inside(use?.path, id);
      if (!nonempty(use?.purpose)) fail(id, 'usage purpose required');
    }
  }
  for (const generated of manifest.generatedAssets ?? []) {
    for (const id of generated.sourceIds ?? []) if (!adoptedIds.has(id)) fail(generated.path, 'generated asset refers to unadopted source');
    if (!nonempty(generated.generator)) fail(generated.path, 'generated asset needs generator reference');
    else await inside(generated.generator, generated.path);
    await outputFile(generated, 'generated asset');
  }
  async function walk(directory) {
    const path = await inside(directory, directory);
    if (!path) return;
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); } catch { fail(directory, 'managed directory cannot be read'); return; }
    for (const entry of entries) {
      const child = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else if (audioExtensions.has(extname(entry.name).toLowerCase()) && !inventory.has(child)) {
        fail(child, 'managed audio file has no distribution or generated-asset record');
      }
    }
  }
  for (const directory of manifest.managedAudioDirectories ?? []) await walk(directory);
  return { errors, files: inventory.size, adoptedSources: adoptedIds.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const manifest = JSON.parse(await readFile(resolve(root, 'assets/lake-audio/sample-manifest.json'), 'utf8'));
    const result = await validateAudioSamples(root, manifest);
    if (result.errors.length) { for (const error of result.errors) console.error(error); process.exitCode = 1; }
    else console.log(`Audio sample correspondence: ${result.adoptedSources} adopted sources, ${result.files} files checked. Rights and listening require substantive review.`);
  } catch { console.error('Audio sample correspondence check could not read its inputs.'); process.exitCode = 1; }
}
