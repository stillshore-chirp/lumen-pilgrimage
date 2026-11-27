import { spawn } from 'node:child_process';
import { appendFile, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { planAffected } from './ci-impact.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const sha = value => typeof value === 'string' && /^[a-f\d]{40}$/i.test(value);

/** CI endpoints describe the event, not a mutable remote branch or HEAD's parent. */
export function eventComparison(eventName, event) {
  if (eventName === 'pull_request' && sha(event?.pull_request?.base?.sha) && sha(event?.pull_request?.head?.sha)) {
    return { base: event.pull_request.base.sha, head: event.pull_request.head.sha, diffMode: 'merge-base' };
  }
  if (eventName === 'push' && sha(event?.before) && sha(event?.after) && !/^0+$/.test(event.before)
    && !/^0+$/.test(event.after)) {
    return { base: event.before, head: event.after, diffMode: 'direct' };
  }
  return { forceAllReasons: ['CI event has no usable comparison; execute the full baseline.'] };
}

export function parseArguments(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === '--ci') options.ci = true;
    else if (argument === '--browser') options.browser = true;
    else if (argument === '--plan-only') options.planOnly = true;
    else if (argument === '--full') options.forceAllReasons = ['Explicit full validation requested.'];
    else if (argument === '--direct') options.diffMode = 'direct';
    else if (['--base', '--head', '--output'].includes(argument)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('A comparison/output argument is missing.');
      options[argument.slice(2)] = value;
    } else throw new Error('Unknown affected-check argument.');
  }
  if (options.ci && (options.base || options.head || options.diffMode || options.forceAllReasons)) {
    throw new Error('CI comparison must come only from its event.');
  }
  if (options.head && !options.base) throw new Error('An explicit head needs a base.');
  return options;
}

function tapTotals(text) {
  const totals = {};
  for (const key of ['tests', 'pass', 'fail', 'skipped']) {
    const counts = [...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))];
    if (counts.length) totals[key] = counts.reduce((sum, item) => sum + Number(item[1]), 0);
  }
  return totals;
}

/** Never pass an empty list to node --test: that would discover unrelated tests. */
export async function executeGate(gate, { root, output, npmPath = process.env.npm_execpath } = {}) {
  if (!/^[a-z][a-z\d-]*$/.test(gate.id) || gate.command !== 'npm' || !Array.isArray(gate.args)
    || gate.args.length !== 2 || gate.args[0] !== 'run' || !/^[a-z][a-z\d:-]*$/.test(gate.args[1])) {
    throw new Error('The planner returned an unsupported gate command.');
  }
  await mkdir(output, { recursive: true });
  const logPath = resolve(output, `${gate.id}.log`);
  // npm's own JS entry point works on Windows without executing a .cmd through a shell.
  const command = npmPath ? process.execPath : 'npm';
  if (!npmPath && process.platform === 'win32') throw new Error('Run affected checks through npm on Windows.');
  const args = npmPath ? [npmPath, ...gate.args] : gate.args;
  const started = performance.now();
  let spawnFailed = false;
  const log = await open(logPath, 'w');
  let closed;
  try {
    const child = spawn(command, args, { cwd: root, shell: false, stdio: ['ignore', log.fd, log.fd] });
    closed = await new Promise(resolveClose => {
      child.once('error', () => { spawnFailed = true; });
      child.once('close', (code, signal) => resolveClose({ code, signal }));
    });
  } finally { await log.close(); }
  const text = await readFile(logPath, 'utf8');
  return { id: gate.id, status: !spawnFailed && closed.code === 0 && !closed.signal ? 'passed' : 'failed',
    exitCode: closed.code, signal: closed.signal, spawnFailed,
    seconds: Number(((performance.now() - started) / 1000).toFixed(3)), log: logPath, totals: tapTotals(text) };
}

function markdown(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('`', '\\`')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\r\n]/g, ' ');
}

export function formatSummary(report) {
  const lines = ['## Change-impact validation', '',
    `Selection: ${markdown(report.plan.selectionMode ?? 'planned')}. Execution tree: ${markdown(report.executionSha ?? 'local')}.`, '',
    `Comparison: ${markdown(report.plan.base ?? 'unavailable')} → ${markdown(report.plan.head ?? 'working tree')}.`, '',
    '| Gate | Result | Reason |', '| --- | --- | --- |'];
  for (const gate of report.plan.selected) {
    const result = report.results.find(item => item.id === gate.id);
    lines.push(`| ${markdown(gate.id)} | ${result?.status ?? (report.planOnly ? 'planned; not executed' : 'not executed')} | ${markdown((gate.reasons ?? [gate.reason ?? 'affected']).join('; '))} |`);
  }
  for (const gate of report.plan.skipped) {
    lines.push(`| ${markdown(gate.id)} | not applicable | ${markdown((gate.reasons ?? [gate.reason ?? 'outside the changed input closure']).join('; '))} |`);
  }
  for (const gate of report.additionalGates ?? []) {
    lines.push(`| ${markdown(gate.id)} | ${report.results.find(item => item.id === gate.id)?.status ?? 'not executed'} | ${markdown(gate.reasons.join('; '))} |`);
  }
  const browsers = report.plan.browser ?? [];
  for (const gate of browsers.filter(item => item.selected)) {
    const result = report.results.find(item => item.id === gate.id);
    lines.push(`| ${markdown(gate.id)} | ${result?.status ?? 'planned browser check; not executed'} | ${markdown((gate.reasons ?? []).join('; '))} |`);
  }
  if (!report.plan.selected.length) lines.push('| application tests | not applicable | No affected standard gates; no bare test discovery was started. |');
  if (report.plan.fallbackReasons?.length) lines.push('', `Full baseline reason: ${markdown(report.plan.fallbackReasons.join('; '))}`);
  if (report.plan.blockingReasons?.length) lines.push('', `Planning blocked: ${markdown(report.plan.blockingReasons.join('; '))}`);
  lines.push('', `Changed paths: ${report.plan.changedPaths.length}. Passed: ${report.results.filter(item => item.status === 'passed').length}; failed: ${report.results.filter(item => item.status === 'failed').length}.`,
    '', 'Not applicable and unexecuted checks are not reported as passed. Browser output and physical-device quality remain distinct.');
  return lines.join('\n') + '\n';
}

export async function checkAffected(options = {}, { root = repository, environment = process.env, planner = planAffected,
  execute = executeGate, print = console.log } = {}) {
  let comparison = options;
  if (options.ci) {
    try { comparison = eventComparison(environment.GITHUB_EVENT_NAME, JSON.parse(await readFile(environment.GITHUB_EVENT_PATH, 'utf8'))); }
    catch { comparison = { forceAllReasons: ['CI event could not be read; execute the full baseline.'] }; }
  }
  const plan = await planner({ root, ...comparison, includeWorkingTree: !options.ci && !options.head });
  if (options.ci && environment.GITHUB_SHA && plan.executionHead && environment.GITHUB_SHA !== plan.executionHead) {
    plan.blockingReasons = [...(plan.blockingReasons ?? []), 'The checkout differs from the CI execution SHA.'];
  }
  const output = resolve(root, options.output ?? 'artifacts/ci');
  await mkdir(output, { recursive: true });
  const report = { schemaVersion: 1, executionSha: plan.executionHead ?? null, expectedCiExecutionSha: environment.GITHUB_SHA ?? null, planOnly: options.planOnly === true,
    browserRequested: options.browser === true, plan, results: [] };
  await writeFile(resolve(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
  print(`Affected checks: ${plan.selected.map(gate => gate.id).join(', ') || 'none (not applicable)'}`);
  if (plan.fallbackReasons?.length) print(`Full baseline: ${plan.fallbackReasons.join('; ')}`);
  if (plan.blockingReasons?.length) print(`Planning blocked: ${plan.blockingReasons.join('; ')}`);
  if (!options.planOnly && !plan.blockingReasons?.length) {
    const gates = [...plan.selected];
    if (options.browser) {
      const browsers = (plan.browser ?? []).filter(item => item.selected);
      if (browsers.length && !gates.some(item => item.id === 'build')) {
        const build = { id: 'build', command: 'npm', args: ['run', 'build'], reasons: ['Selected browser checks require dist/.'] };
        gates.unshift(build);
        report.additionalGates = [build];
      }
      gates.push(...browsers);
    }
    for (const gate of gates) {
      let result;
      try { result = await execute(gate, { root, output, npmPath: environment.npm_execpath }); }
      catch { result = { id: gate.id, status: 'failed', exitCode: null, executionError: true, seconds: 0, totals: {} }; }
      report.results.push(result);
      print(`${result.id}: ${result.status}; ${result.seconds}s; ${JSON.stringify(result.totals)}`);
      if (result.status !== 'passed') break;
    }
  }
  const summary = formatSummary(report);
  await writeFile(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(output, 'summary.md'), summary);
  if (environment.GITHUB_STEP_SUMMARY) await appendFile(environment.GITHUB_STEP_SUMMARY, summary);
  return { report, exitCode: plan.blockingReasons?.length || report.results.some(item => item.status !== 'passed') ? 1 : 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkAffected(parseArguments(process.argv.slice(2)));
    process.exitCode = result.exitCode;
  } catch {
    console.error('Affected validation failed to plan or execute. No successful validation is recorded.');
    process.exitCode = 1;
  }
}
