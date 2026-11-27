import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { planAffected } from './ci-impact.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const selected = plan => plan.selected.map(gate => gate.id);
const browser = plan => plan.browser.filter(gate => gate.selected).map(gate => gate.id);
async function put(root, path, source) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), source);
}
function git(root, ...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new Error('Fixture Git operation failed'); }
}
async function fixture(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lumen-ci-impact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '--quiet');
  git(root, 'config', 'user.name', 'CI fixture');
  git(root, 'config', 'user.email', 'ci-fixture@example.invalid');
  await put(root, 'package.json', JSON.stringify({ scripts: {} }));
  await put(root, '.gitignore', 'node_modules/\n');
  for (const [path, source] of Object.entries(files)) await put(root, path, source);
  git(root, 'add', '--', 'package.json', '.gitignore', ...Object.keys(files));
  git(root, 'commit', '--quiet', '-m', 'Initial fixture');
  return root;
}
function commit(root, paths) {
  git(root, 'add', '--', ...paths);
  git(root, 'commit', '--quiet', '-m', 'Fixture change');
  return git(root, 'rev-parse', 'HEAD');
}

// These repository cases exercise the actual production import/readFile graph, including
// generated audio that is consumed without a JS import. They do not copy the planner roster.
test('offline koto synthesis and production tools do not acquire world or browser suites', async () => {
  for (const path of ['src/coast/world/lake/kotoPhysicalModel.ts', 'scripts/prepare-koto-performance.mjs', 'scripts/koto-analysis.mjs']) {
    const plan = await planAffected({ root: repository, changedPaths: [path] });
    assert.deepEqual(plan.fallbackReasons, []);
    assert.ok(selected(plan).includes('koto'));
    assert.ok(!selected(plan).some(id => ['coast', 'monitor', 'cinema', 'atrium', 'residence', 'lake'].includes(id)), path);
    assert.deepEqual(browser(plan), [], path);
  }
});

test('distributed audio reaches the loader and audition consumers; samples retain provenance checks', async () => {
  const output = await planAffected({ root: repository, changedPaths: ['public/lake-audio/koto-performance.wav'] });
  assert.deepEqual(output.fallbackReasons, []);
  assert.ok(selected(output).includes('koto') && selected(output).includes('audio-samples'));
  assert.deepEqual(browser(output), ['lake-browser', 'koto-browser']);
  assert.ok(!selected(output).includes('coast'));
  const sample = await planAffected({ root: repository, changedPaths: ['public/lake-audio/samples/bank.json'] });
  assert.ok(selected(sample).includes('koto') && selected(sample).includes('audio-samples'));
  assert.deepEqual(browser(sample), []);
  const metadata = await planAffected({ root: repository, changedPaths: ['assets/lake-audio/production.json'] });
  assert.ok(selected(metadata).includes('koto'));
  assert.deepEqual(browser(metadata), []);
});

test('documentation and binary references run the harness without compilation or world tests', async () => {
  const plan = await planAffected({ root: repository, changedPaths: ['docs/verification.md', 'docs/reference/scene.png', 'public/lake-audio/ATTRIBUTION.md'] });
  assert.deepEqual(selected(plan), ['harness']);
  assert.deepEqual(browser(plan), []);
  assert.ok(plan.skipped.every(gate => gate.reasons.length > 0));
});

test('shared output and XR retain real application consumers', async () => {
  const output = await planAffected({ root: repository, changedPaths: ['src/coast/explorationOutput.ts'] });
  assert.deepEqual(output.fallbackReasons, []);
  assert.ok(selected(output).includes('coast') && selected(output).includes('residence') && selected(output).includes('monitor'));
  assert.ok(browser(output).includes('lake-browser') && browser(output).includes('cinema-browser') && browser(output).includes('koto-browser'));
  const xr = await planAffected({ root: repository, changedPaths: ['src/xr/ImmersiveSession.ts'] });
  assert.ok(selected(xr).includes('monitor'));
  assert.ok(browser(xr).includes('monitor-browser') && browser(xr).includes('coast-browser'));
});

test('audition-only UI and world-only changes have separate browser plans', async () => {
  const audition = await planAffected({ root: repository, changedPaths: ['src/dev/kotoAudition.css'] });
  assert.deepEqual(browser(audition), ['koto-browser']);
  assert.ok(selected(audition).includes('build'));
  assert.ok(!selected(audition).some(id => ['coast', 'monitor', 'cinema', 'atrium', 'residence', 'lake'].includes(id))); // Koto study tests inspect the audition source.
  const lake = await planAffected({ root: repository, changedPaths: ['src/coast/world/lake/lakeWildlifeFish.ts'] });
  assert.deepEqual(lake.fallbackReasons, []);
  assert.ok(browser(lake).includes('lake-browser'));
  assert.ok(!browser(lake).includes('coast-browser'));
});

test('literal dynamic imports and readFile/new URL dependencies propagate transitively', async t => {
  const root = await fixture(t, {
    'scripts/coast-controls.test.mjs': "const url = new URL('../src/coast/helper.ts', import.meta.url); await import(url.href);",
    'src/coast/helper.ts': "export { value } from './world/lake/kotoPhysicalModel';",
    'src/coast/world/lake/kotoPhysicalModel.ts': 'export const value = 1;',
    'scripts/monitor-audio.test.mjs': "import { readFile } from 'node:fs/promises'; await readFile(new URL('../src/coast/world/lake/kotoPhysicalModel.ts', import.meta.url));",
  });
  const plan = await planAffected({ root, changedPaths: ['src/coast/world/lake/kotoPhysicalModel.ts'] });
  assert.deepEqual(plan.fallbackReasons, []);
  assert.deepEqual(selected(plan), ['build', 'coast', 'monitor', 'koto']);
});

test('old and new import graphs both protect a deleted dependency', async t => {
  const root = await fixture(t, {
    'scripts/coast-controls.test.mjs': "import '../src/coast/world/lake/kotoPhysicalModel.ts';",
    'src/coast/world/lake/kotoPhysicalModel.ts': 'export const value = 1;',
  });
  const base = git(root, 'rev-parse', 'HEAD');
  await put(root, 'scripts/coast-controls.test.mjs', 'export const replacement = 1;');
  await rm(join(root, 'src/coast/world/lake/kotoPhysicalModel.ts'));
  const head = commit(root, ['scripts/coast-controls.test.mjs', 'src/coast/world/lake/kotoPhysicalModel.ts']);
  const plan = await planAffected({ root, base, head, diffMode: 'direct' });
  assert.deepEqual(plan.fallbackReasons, []);
  assert.ok(selected(plan).includes('coast') && selected(plan).includes('koto'));
  assert.ok(plan.changedPaths.includes('src/coast/world/lake/kotoPhysicalModel.ts'));
});

test('deleted non-imported runtime assets retain old browser consumers', async t => {
  const root = await fixture(t, {
    'src/coast/world/lake/LakeWorld.ts': "import './lakeKotoAsset';",
    'src/coast/world/lake/lakeKotoAsset.ts': "export const asset = 'lake-audio/koto-performance.wav';",
    'public/lake-audio/koto-performance.wav': 'fixture wave',
  });
  const base = git(root, 'rev-parse', 'HEAD');
  await rm(join(root, 'public/lake-audio/koto-performance.wav'));
  const head = commit(root, ['public/lake-audio/koto-performance.wav']);
  const plan = await planAffected({ root, base, head, diffMode: 'direct' });
  assert.deepEqual(plan.fallbackReasons, []);
  assert.ok(browser(plan).includes('lake-browser'));
});

test('audio ledger usage and generator declarations select correspondence checks', async t => {
  const root = await fixture(t, {
    'src/coast/world/lake/lakeAudio.ts': 'export const value = 1;',
    'assets/lake-audio/sample-manifest.json': JSON.stringify({ managedAudioDirectories: ['public/cinema-audio'],
      sources: [{ usage: [{ path: 'src/coast/world/lake/lakeAudio.ts' }] }],
      generatedAssets: [{ path: 'public/cinema-audio/generated.wav', generator: 'scripts/prepare-cinema-hrtf.py' }] }),
  });
  for (const path of ['src/coast/world/lake/lakeAudio.ts', 'scripts/prepare-cinema-hrtf.py', 'public/cinema-audio/new.wav']) {
    const plan = await planAffected({ root, changedPaths: [path] });
    assert.deepEqual(plan.fallbackReasons, []);
    assert.ok(selected(plan).includes('audio-samples'), path);
  }
});

test('Git rename records retain both owners, including whitespace, Unicode and newline paths', async t => {
  const oldPath = 'src/coast/world/lake/koto 名前\nold.ts';
  const newPath = 'src/coast/world/cinema/ renamed 名前\nnew.ts';
  const root = await fixture(t, { [oldPath]: 'export const unchanged = 123456789;' });
  const base = git(root, 'rev-parse', 'HEAD');
  await mkdir(dirname(join(root, newPath)), { recursive: true });
  await rename(join(root, oldPath), join(root, newPath));
  const head = commit(root, [oldPath, newPath]);
  const plan = await planAffected({ root, base, head, diffMode: 'direct' });
  assert.deepEqual(plan.fallbackReasons, []);
  assert.deepEqual(plan.changedPaths, [newPath, oldPath].sort());
  assert.ok(selected(plan).includes('koto') && selected(plan).includes('cinema'));
});

test('leading dashes and shell-looking filenames are data, never shell commands', async t => {
  const path = '-$(touch SHOULD_NOT_EXIST) 日本語.md';
  const root = await fixture(t);
  const base = git(root, 'rev-parse', 'HEAD');
  await put(root, path, '# Safe fixture');
  const head = commit(root, [path]);
  const plan = await planAffected({ root, base, head, diffMode: 'direct' });
  assert.deepEqual(plan.changedPaths, [path]);
  assert.deepEqual(selected(plan), ['harness']);
  await assert.rejects(readFile(join(root, 'SHOULD_NOT_EXIST')));
});

test('default local comparison uses origin/main plus staged, unstaged and untracked changes', async t => {
  const root = await fixture(t, { 'docs/guide.md': '# Start' });
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  await put(root, 'docs/guide.md', '# Changed');
  await put(root, 'src/coast/world/lake/kotoPhysicalModel.ts', 'export const note = 1;');
  git(root, 'add', '--', 'src/coast/world/lake/kotoPhysicalModel.ts');
  await put(root, 'docs/new note.md', '# Untracked');
  await symlink(repository, join(root, 'node_modules'));
  const plan = await planAffected({ root });
  assert.deepEqual(plan.fallbackReasons, []);
  assert.deepEqual(plan.changedPaths, ['docs/guide.md', 'docs/new note.md', 'src/coast/world/lake/kotoPhysicalModel.ts']);
  assert.deepEqual(selected(plan), ['build', 'harness', 'koto']);
});

test('merge-base PR scope excludes changes that exist only on the target branch', async t => {
  const root = await fixture(t, { 'docs/base.md': '# Base' });
  const branch = git(root, 'branch', '--show-current');
  git(root, 'checkout', '--quiet', '-b', 'feature');
  await put(root, 'src/coast/world/lake/kotoPhysicalModel.ts', 'export const note = 1;');
  const head = commit(root, ['src/coast/world/lake/kotoPhysicalModel.ts']);
  git(root, 'checkout', '--quiet', branch);
  await put(root, 'src/coast/world/cinema/cinemaLayout.ts', 'export const note = 1;');
  const base = commit(root, ['src/coast/world/cinema/cinemaLayout.ts']);
  git(root, 'checkout', '--quiet', 'feature');
  const pr = await planAffected({ root, base, head, diffMode: 'merge-base' });
  assert.deepEqual(pr.changedPaths, ['src/coast/world/lake/kotoPhysicalModel.ts']);
  const push = await planAffected({ root, base, head, diffMode: 'direct' });
  assert.ok(push.changedPaths.includes('src/coast/world/cinema/cinemaLayout.ts'));
  assert.ok(selected(push).includes('cinema'));
});

test('PR merge checkout keeps consumers added to the target after feature divergence', async t => {
  const root = await fixture(t, {
    'src/coast/world/lake/kotoPhysicalModel.ts': 'export const value = 1;',
    'scripts/coast-controls.test.mjs': 'export const original = 1;',
  });
  const target = git(root, 'branch', '--show-current');
  git(root, 'checkout', '--quiet', '-b', 'feature');
  await put(root, 'src/coast/world/lake/kotoPhysicalModel.ts', 'export const value = 2;');
  const head = commit(root, ['src/coast/world/lake/kotoPhysicalModel.ts']);
  git(root, 'checkout', '--quiet', target);
  await put(root, 'scripts/coast-controls.test.mjs', "import '../src/coast/world/lake/kotoPhysicalModel.ts';");
  const base = commit(root, ['scripts/coast-controls.test.mjs']);
  git(root, 'merge', '--quiet', '--no-edit', 'feature');
  const plan = await planAffected({ root, base, head, diffMode: 'merge-base' });
  assert.deepEqual(plan.fallbackReasons, []);
  assert.deepEqual(plan.changedPaths, ['src/coast/world/lake/kotoPhysicalModel.ts']);
  assert.notEqual(plan.executionHead, plan.head);
  assert.ok(selected(plan).includes('coast'), 'new merged consumer must be selected');
});

test('new known-world sources are owned; new worlds or unclassified tests force all gates', async t => {
  const root = await fixture(t);
  const owned = await planAffected({ root, changedPaths: ['src/coast/world/lake/newFish.ts'] });
  assert.deepEqual(selected(owned), ['build', 'lake']);
  for (const path of ['src/coast/world/new-world/main.ts', 'scripts/lake-new.test.mjs', 'tests/unregistered.spec.ts', 'src/unmapped.ts', 'scripts/new-validator.mjs']) {
    const plan = await planAffected({ root, changedPaths: [path] });
    assert.equal(plan.selectionMode, 'fallback');
    assert.equal(plan.skipped.length, 0);
    assert.ok([...plan.fallbackReasons, ...plan.blockingReasons].some(reason => reason.includes(path)));
    assert.ok(plan.browser.every(gate => gate.selected));
    if (/\.(?:test|spec)\./.test(path)) assert.ok(plan.blockingReasons.some(reason => reason.includes(path)));
  }
});

test('validator changes select their own gate, and package/config/roster changes cannot silently skip tests', async t => {
  const validator = await planAffected({ root: repository, changedPaths: ['scripts/validate-audio-samples.mjs'] });
  assert.deepEqual(selected(validator), ['audio-samples']);
  const harness = await planAffected({ root: repository, changedPaths: ['scripts/validate-harness.test.mjs'] });
  assert.deepEqual(selected(harness), ['harness']);
  const root = await fixture(t, {
    'package.json': JSON.stringify({ scripts: { 'test:coast': 'node --test scripts/coast-controls.test.mjs' } }),
  });
  const mismatch = await planAffected({ root, changedPaths: ['docs/guide.md'] });
  assert.ok(mismatch.blockingReasons.some(reason => reason.includes('roster')));
  for (const path of ['package-lock.json', 'vite.config.mjs', '.github/workflows/ci.yml', 'scripts/ci-impact.mjs']) {
    const plan = await planAffected({ root: repository, changedPaths: [path] });
    assert.equal(plan.skipped.length, 0);
    assert.ok(plan.fallbackReasons.length > 0);
  }
});

test('missing registered test roots block acceptance even when another change is documentation only', async t => {
  const root = await fixture(t, { 'package.json': JSON.stringify({ name: 'lumen-pilgrimage', scripts: {} }) });
  const plan = await planAffected({ root, changedPaths: ['docs/guide.md'] });
  assert.ok(plan.blockingReasons.some(reason => reason.includes('Required test root is missing')));
  assert.ok(plan.blockingReasons.some(reason => reason.includes('Required gate script is missing')));
  assert.equal(plan.selectionMode, 'fallback');
});

test('syntax failures and computed runtime imports cannot yield a selective success', async t => {
  for (const source of ['export const = ;', 'export const load = path => import(path);']) {
    const root = await fixture(t, { 'src/coast/world/lake/newFish.ts': source });
    const plan = await planAffected({ root, changedPaths: ['src/coast/world/lake/newFish.ts'] });
    assert.equal(plan.selectionMode, 'fallback');
    assert.equal(plan.skipped.length, 0);
    assert.ok(plan.fallbackReasons.length > 0);
  }
});

test('missing/zero history and caller-forced fallback never produce empty success', async t => {
  const root = await fixture(t);
  for (const base of ['0000000000000000000000000000000000000000', 'missing-history']) {
    const plan = await planAffected({ root, base, head: 'HEAD' });
    assert.equal(plan.selectionMode, 'fallback');
    assert.ok(selected(plan).includes('build') && selected(plan).includes('koto'));
    assert.equal(plan.skipped.length, 0);
  }
  const forced = await planAffected({ root, changedPaths: [], forceAllReasons: ['Unsupported CI event'] });
  assert.ok(forced.fallbackReasons.includes('Unsupported CI event'));
  assert.equal(forced.skipped.length, 0);
  const empty = await planAffected({ root, changedPaths: [] });
  assert.equal(empty.selectionMode, 'empty');
  assert.deepEqual(selected(empty), []);
});

test('object rename input and invalid escaping paths are handled explicitly', async t => {
  const root = await fixture(t);
  const renamed = await planAffected({ root, changedPaths: [{ oldPath: 'src/coast/world/lake/kotoOld.ts', newPath: 'src/coast/world/cinema/new.ts' }] });
  assert.ok(selected(renamed).includes('koto') && selected(renamed).includes('cinema'));
  const invalid = await planAffected({ root, changedPaths: ['../outside.ts'] });
  assert.equal(invalid.selectionMode, 'fallback');
  assert.equal(invalid.skipped.length, 0);
});
