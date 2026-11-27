import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateAudioSamples } from './validate-audio-samples.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'audio-ledger-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'public/audio'), { recursive: true });
  await mkdir(join(root, 'src'));
  const bytes = Buffer.from('test audio bytes');
  await writeFile(join(root, 'public/audio/note.wav'), bytes);
  await writeFile(join(root, 'src/player.ts'), 'export const note = "/audio/note.wav";');
  const source = {
    id: 'self-recorded-koto', status: 'adopted',
    nameAndFiles: { title: 'Test note', originalFilename: 'note.wav' },
    roles: { creator: 'Test creator', recordist: 'Test creator', performer: 'Test creator' },
    officialSource: { url: 'https://example.org/recording' },
    license: { spdx: 'CC0-1.0', statementUrl: 'https://example.org/recording',
      legalCodeUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode' },
    checkedDate: '2026-11-27',
    licenseEvidence: { checkedAt: '2026-11-27T12:00:00Z', shortRecord: 'Test-only observed statement',
      observedLicenseHref: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    rights: { affirmer: 'Test creator', confirmedScope: ['Own performance and recording'], basis: 'Test fixture' },
    thirdParty: { composition: 'Single note', performance: 'Own', recording: 'Own',
      otherRights: 'No declared third-party content', intent: 'Instrument samples', conclusion: 'Fixture only' },
    sourceIdentity: { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
      complete: true, kind: 'original-recording' },
    retrievalAndProcessing: { steps: ['Test fixture creation'] },
    distribution: [{ path: 'public/audio/note.wav', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }],
    usage: [{ path: 'src/player.ts', purpose: 'Test instrument playback' }],
    quality: { status: 'technical-test-only', evidence: 'Fixture bytes, no listening claim' }, uncertainties: [],
  };
  return { root, source, manifest: { schemaVersion: 1, casePolicy: { newExternalAudioLicense: 'CC0-1.0' },
    sources: [source], managedAudioDirectories: ['public/audio'] } };
}

test('adopted source evidence points to identical distributed bytes and a real usage path', async t => {
  const { root, manifest } = await fixture(t);
  assert.deepEqual(await validateAudioSamples(root, manifest), { errors: [], files: 1, adoptedSources: 1 });
});

test('changed audio cannot retain a stale hash or byte count', async t => {
  const { root, manifest } = await fixture(t);
  await writeFile(join(root, 'public/audio/note.wav'), 'different wave');
  assert.match((await validateAudioSamples(root, manifest)).errors.join('\n'), /bytes\/hash mismatch/);
});

test('a candidate cannot distribute audio or have active implementation usage', async t => {
  const { root, source, manifest } = await fixture(t);
  source.status = 'candidate';
  assert.match((await validateAudioSamples(root, manifest)).errors.join('\n'), /unadopted candidate/);
});

test('CC0 case constraint does not become a global ban on other licensed cases', async t => {
  const { root, source, manifest } = await fixture(t);
  source.license.spdx = 'CC-BY-4.0';
  source.license.legalCodeUrl = 'https://creativecommons.org/licenses/by/4.0/legalcode';
  assert.match((await validateAudioSamples(root, manifest)).errors.join('\n'), /case policy/);
  delete manifest.casePolicy.newExternalAudioLicense;
  assert.deepEqual((await validateAudioSamples(root, manifest)).errors, []);
});

test('adopted records need observed license and separate performance-rights assessment', async t => {
  const { root, source, manifest } = await fixture(t);
  delete source.thirdParty.performance;
  source.licenseEvidence.observedLicenseHref = 'https://example.org/free';
  const { errors } = await validateAudioSamples(root, manifest);
  assert.match(errors.join('\n'), /CC0 1.0 observation/);
  assert.match(errors.join('\n'), /performance required/);
});

test('distribution and usage cannot escape the repository through traversal or symlinks', async t => {
  const { root, source, manifest } = await fixture(t);
  source.distribution[0].path = '../outside.wav';
  await symlink(tmpdir(), join(root, 'outside-link'));
  source.usage[0].path = 'outside-link';
  const { errors } = await validateAudioSamples(root, manifest);
  assert.match(errors.join('\n'), /path leaves repository/);
  assert.match(errors.join('\n'), /symlink leaves repository/);
});

test('managed audio inventory rejects an unrecorded file and unadopted derivative source', async t => {
  const { root, source, manifest } = await fixture(t);
  await writeFile(join(root, 'public/audio/extra.ogg'), 'unrecorded');
  manifest.generatedAssets = [{ ...source.distribution[0], generator: 'src/player.ts', sourceIds: ['not-adopted'] }];
  const { errors } = await validateAudioSamples(root, manifest);
  assert.match(errors.join('\n'), /no distribution/);
  assert.match(errors.join('\n'), /unadopted source/);
});
