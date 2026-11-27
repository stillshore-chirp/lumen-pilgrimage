import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkAffected, eventComparison, executeGate, parseArguments } from './check-affected.mjs';

const base = '1'.repeat(40), head = '2'.repeat(40);
const gate = id => ({ id, command: 'npm', args: ['run', id], reasons: ['fixture input changed'] });
const plan = selected => ({ schemaVersion: 1, selectionMode: 'files', base, head,
  changedPaths: ['public/lake-audio/koto-performance.wav'], selected, skipped: [gate('cinema')], browser: [], fallbackReasons: [] });
const temporary = async t => {
  const root = await mkdtemp(join(tmpdir(), 'lumen-affected-runner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

test('PR and push use immutable event endpoints, with different comparison semantics', () => {
  assert.deepEqual(eventComparison('pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }),
    { base, head, diffMode: 'merge-base' });
  assert.deepEqual(eventComparison('push', { before: base, after: head }), { base, head, diffMode: 'direct' });
  for (const [name, event] of [['push', { before: '0'.repeat(40), after: head }], ['pull_request', {}], ['unknown', {}]]) {
    assert.ok(eventComparison(name, event).forceAllReasons.length);
  }
  assert.throws(() => parseArguments(['--ci', '--base', base]));
  assert.throws(() => parseArguments(['--head', head]));
  assert.throws(() => parseArguments(['--output']));
  assert.throws(() => parseArguments(['--unrecognized']));
});

test('empty selection never starts a child or becomes an application-test pass', async t => {
  const root = await temporary(t);
  const result = await checkAffected({}, { root, environment: {}, planner: async () => plan([]),
    execute: async () => { throw new Error('An empty plan must not start test discovery.'); }, print() {} });
  assert.equal(result.exitCode, 0); assert.deepEqual(result.report.results, []);
  const summary = await readFile(join(root, 'artifacts/ci/summary.md'), 'utf8');
  assert.match(summary, /not applicable/); assert.match(summary, /Passed: 0/);
});

test('a failed selected process fails validation and prevents unneeded later commands', async t => {
  const root = await temporary(t);
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: {
    failed: 'node -e "process.exit(7)"', later: 'node -e "process.exit(0)"',
  } }));
  const result = await checkAffected({}, { root, environment: { npm_execpath: process.env.npm_execpath },
    planner: async () => plan([gate('failed'), gate('later')]), print() {} });
  assert.equal(result.exitCode, 1); assert.equal(result.report.results.length, 1);
  assert.equal(result.report.results[0].status, 'failed'); assert.equal(result.report.results[0].exitCode, 7);
  const report = JSON.parse(await readFile(join(root, 'artifacts/ci/results.json')));
  assert.equal(report.results[0].exitCode, 7);
  const summary = await readFile(join(root, 'artifacts/ci/summary.md'), 'utf8');
  assert.match(summary, /later \| not executed/); assert.match(summary, /cinema \| not applicable/);
});

test('spawn errors and exceptions are failures with retained result records', async t => {
  const root = await temporary(t);
  const missing = await executeGate(gate('anything'), { root, output: join(root, 'spawn'), npmPath: join(root, 'missing-npm-cli.mjs') });
  assert.equal(missing.status, 'failed');
  const spawnFailure = await executeGate(gate('anything'), { root: join(root, 'nonexistent'), output: join(root, 'spawn-error') });
  assert.equal(spawnFailure.status, 'failed'); assert.equal(spawnFailure.spawnFailed, true);
  const result = await checkAffected({}, { root, environment: {}, planner: async () => plan([gate('first')]),
    execute: async () => { throw new Error('private diagnostic must not be copied'); }, print() {} });
  assert.equal(result.exitCode, 1); assert.equal(result.report.results[0].executionError, true);
  assert.doesNotMatch(await readFile(join(root, 'artifacts/ci/results.json'), 'utf8'), /private diagnostic/);
});

test('an unregistered test or mismatched execution tree cannot be hidden by passing existing gates', async t => {
  const root = await temporary(t);
  let executed = false;
  const blockedPlan = { ...plan([gate('first')]), blockingReasons: ['A new test has no registered execution command.'] };
  const result = await checkAffected({}, { root, environment: {}, planner: async () => blockedPlan,
    execute: async () => { executed = true; }, print() {} });
  assert.equal(result.exitCode, 1); assert.equal(executed, false); assert.deepEqual(result.report.results, []);
  assert.match(await readFile(join(root, 'artifacts/ci/summary.md'), 'utf8'), /Planning blocked/);
  const event = join(root, 'event.json'); await writeFile(event, JSON.stringify({ before: base, after: head }));
  const mismatch = await checkAffected({ ci: true }, { root,
    environment: { GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event, GITHUB_SHA: head },
    planner: async () => ({ ...plan([]), executionHead: base }), print() {} });
  assert.equal(mismatch.exitCode, 1); assert.equal(mismatch.report.executionSha, base);
});

test('CI event read failure forces baseline, and valid payload never uses local working files', async t => {
  const root = await temporary(t);
  const observed = [];
  const planner = async options => { observed.push(options); return plan([]); };
  await checkAffected({ ci: true, planOnly: true }, { root, environment: { GITHUB_EVENT_PATH: join(root, 'missing') }, planner, print() {} });
  assert.ok(observed[0].forceAllReasons.length); assert.equal(observed[0].includeWorkingTree, false);
  const path = join(root, 'event.json'); await writeFile(path, JSON.stringify({ before: base, after: head }));
  await checkAffected({ ci: true, planOnly: true }, { root, environment: { GITHUB_EVENT_PATH: path, GITHUB_EVENT_NAME: 'push' }, planner, print() {} });
  assert.equal(observed[1].diffMode, 'direct'); assert.equal(observed[1].base, base); assert.equal(observed[1].head, head);
});

test('browser execution is opt-in and adds the required build exactly once', async t => {
  const root = await temporary(t), executed = [];
  const browser = { ...gate('lake-browser'), selected: true };
  const planner = async () => ({ ...plan([]), browser: [browser] });
  const execute = async item => { executed.push(item.id); return { id: item.id, status: 'passed', seconds: 0, totals: {} }; };
  await checkAffected({}, { root, environment: {}, planner, execute, print() {} });
  assert.deepEqual(executed, []);
  const result = await checkAffected({ browser: true }, { root, environment: {}, planner, execute, print() {} });
  assert.equal(result.exitCode, 0); assert.deepEqual(executed, ['build', 'lake-browser']);
  assert.match(await readFile(join(root, 'artifacts/ci/summary.md'), 'utf8'), /build \| passed/);
});
