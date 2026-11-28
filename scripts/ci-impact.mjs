import { execFile, spawn } from 'node:child_process';
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, isAbsolute, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';

const exec = promisify(execFile);
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const codeExtension = /\.(?:[cm]?js|tsx?)$/;
const testExtension = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const worlds = ['coast', 'monitor', 'residence', 'cinema', 'atrium', 'lake', 'koto'];
const tests = {
  coast: ['coast-controls', 'coast-terrain', 'coast-acoustics', 'exploration-route'],
  monitor: ['monitor-signaling', 'monitor-session', 'monitor-capture', 'monitor-pose', 'monitor-xr', 'monitor-audio'],
  residence: ['residence-navigation', 'residence-audio', 'residence-street', 'residence-lighting', 'residence-appliances'],
  cinema: ['cinema-navigation', 'cinema-ventilation', 'cinema-lighting', 'cinema-audio', 'cinema-source', 'cinema-routing', 'cinema-reflections-geometry', 'cinema-room-audio'],
  atrium: ['atrium-navigation', 'atrium-audio', 'atrium-facility'],
  lake: ['lake-navigation', 'lake-audio', 'lake-geometry', 'lake-fish', 'lake-vegetation'],
  koto: ['koto-analysis', 'koto-physical', 'koto-sample', 'koto-playback', 'koto-transport', 'koto-score', 'koto-production', 'koto-recorded-modal-study', 'koto-recording-performance-study', 'koto-excitation-color', 'koto-recorded-sustain-study'],
};
const browsers = {
  coast: ['coast-browser'], monitor: ['monitor-browser'],
  residence: ['residence-browser', 'residence-light-motion'],
  cinema: ['cinema-browser', 'cinema-audio', 'cinema-movie-video', 'cinema-screening.browser'],
  atrium: ['atrium-browser', 'atrium-facility-browser'],
  lake: ['lake-browser', 'lake-sky-browser'], koto: ['koto-audition-browser'],
};
const testPaths = names => names.map(name => `scripts/${name}.test.mjs`);
const gate = (id, script, roots = []) => ({ id, command: 'npm', args: ['run', script], roots });
const gates = [
  gate('build', 'build'),
  gate('harness', 'validate:harness', ['scripts/validate-harness.test.mjs', 'scripts/validate-harness.mjs']),
  gate('audio-samples', 'validate:audio-samples', ['scripts/validate-audio-samples.test.mjs', 'scripts/validate-audio-samples.mjs']),
  ...worlds.map(world => gate(world, world === 'lake' ? 'test:lake:unit' : `test:${world}`, testPaths(tests[world]))),
  gate('ci-impact', 'test:ci-impact', ['scripts/ci-impact.test.mjs', 'scripts/check-affected.test.mjs', 'scripts/ci-impact.mjs', 'scripts/check-affected.mjs']),
];
// Browser suites also enter other scenes through actual fast travel, audio and XR tests.
// Keep those consumers explicit instead of treating the suite's name as its only world.
const coastSceneRoots = ['src/coast/CoastWorld.ts', 'src/coast/CoastAudio.ts'];
const overlookSceneRoot = 'src/coast/world/overlook/OverlookWorld.ts';
const residenceSceneRoot = 'src/coast/world/residence/ResidenceWorld.ts';
const cinemaSceneRoot = 'src/coast/world/cinema/CinemaWorld.ts';
const sceneRoots = {
  coast: [...coastSceneRoots, overlookSceneRoot, residenceSceneRoot, cinemaSceneRoot],
  monitor: ['src/monitor/monitorView.ts', 'src/monitor/monitorSender.ts', 'server/virtual-monitor-signaling.mjs',
    ...coastSceneRoots, overlookSceneRoot, residenceSceneRoot, cinemaSceneRoot,
    // The projection-XR shader preparation cases live in the monitor browser suite.
    'src/coast/world/residence/residenceShaderPreparation.ts',
    'src/coast/ResidenceControlPanel.ts', 'src/coast/residenceControlPanel.css', 'src/coast/world/cinema/CinemaPanel.ts'],
  residence: [residenceSceneRoot, ...coastSceneRoots, overlookSceneRoot, 'src/monitor/monitorView.ts'],
  cinema: [cinemaSceneRoot, ...coastSceneRoots], atrium: ['src/coast/world/atrium/AtriumWorld.ts'],
  lake: ['src/coast/world/lake/LakeWorld.ts', overlookSceneRoot],
  koto: ['src/dev/kotoAudition.ts', 'src/dev/kotoAudition.css', 'tools/koto-audition.html'],
};
const browserGates = worlds.map(world => gate(`${world}-browser`, `test:${world}:browser`, [
  ...testPaths(browsers[world]), ...sceneRoots[world],
  ...(world === 'koto' ? [] : ['index.html', 'src/main.ts', 'src/coast/CoastApp.ts']),
]));
const knownTests = new Set([...Object.values(tests), ...Object.values(browsers), ['validate-harness', 'validate-audio-samples', 'ci-impact', 'check-affected']].flatMap(testPaths));
const sharedSources = new Set([
  'CoastApp.ts', 'CoastControls.ts', 'CoastSoundControls.ts', 'CoastTravelPanel.ts', 'CoastXR.ts', 'DesktopGrab.ts',
  'WorldLightingControl.ts', 'WorldXRGrab.ts', 'coast.css', 'coastDestinations.ts', 'desktopGrabOcclusion.ts',
  'disposeSceneDrawables.ts', 'explorationOutput.ts', 'explorationRoute.ts', 'explorationSound.ts', 'floorGrabPosition.ts',
].map(name => `src/coast/${name}`));
// These orchestration modules dispatch to worlds. Their other-world branches are not consumers
// of the world currently under browser test. Cross-world imports inside a scene remain real edges.
const dispatchModules = new Set(['src/main.ts', 'src/coast/CoastApp.ts', 'src/coast/coastDestinations.ts', 'src/coast/explorationRoute.ts']);
const fullInputs = /^(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|index\.html|\.github\/workflows\/|scripts\/(?:ci-impact(?:\.test)?|check-affected)\.mjs$)/;
const docs = path => /\.(?:md|pdf|png|jpe?g|webp|svg)$/i.test(path)
  && /^(?:docs\/|plans\/|references\/|\.agents\/|\.github\/|README|AGENTS)/.test(path)
  || /(?:^|\/)ATTRIBUTION\.md$/.test(path) || /\.md$/.test(path);

function owner(path) {
  if (/^src\/coast\/world\/lake\/(?:koto|lakeKoto)/.test(path) || path === 'src/coast/lakeKotoTransport.ts') return 'koto';
  const match = path.match(/^src\/coast\/world\/(residence|cinema|atrium|lake)\//);
  if (match) return match[1];
  if (/^src\/coast\/world\/(?:coast[^/]+|overlook\/)/.test(path)
    || /^src\/coast\/(?:CoastAudio|CoastFoley|CoastWorld|coastAcoustics|coastBirdCue|coastShore|terrain)\.ts$/.test(path)) return 'coast';
  if (/^src\/monitor\//.test(path) || /^server\/virtual-monitor-signaling\.mjs$/.test(path)) return 'monitor';
  if (/^src\/dev\/kotoAudition\./.test(path) || path === 'tools/koto-audition.html') return 'audition';
  if (/^src\/coast\/(?:LakeEnvironmentPanel|lakeEnvironmentPanel)\./.test(path)) return 'lake';
  if (/^src\/coast\/(?:ResidenceControlPanel|residenceControlPanel)\./.test(path)) return 'residence';
  if (sharedSources.has(path) || /^src\/xr\//.test(path) || path === 'src/main.ts') return 'shared';
}

async function git(root, args) {
  try {
    const { stdout } = await exec('git', args, { cwd: root, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch { throw new Error('Git history or repository input is unavailable'); }
}
const nulStrings = bytes => bytes.toString('utf8').split('\0').filter(Boolean);
function statusPaths(bytes) {
  const fields = nulStrings(bytes);
  const paths = [];
  const removedPaths = [];
  for (let i = 0; i < fields.length;) {
    const status = fields[i++];
    if (!/^[ACDMRTUXB][0-9]*$/.test(status) || !fields[i]) throw new Error('Unrecognized Git change status');
    const firstPath = fields[i++];
    paths.push(firstPath);
    if (/^[DR]/.test(status)) removedPaths.push(firstPath);
    if (/^[RC]/.test(status)) {
      if (!fields[i]) throw new Error('Incomplete Git rename');
      paths.push(fields[i++]);
    }
  }
  return { paths, removedPaths };
}
async function revision(root, value) {
  if (!value || /^0+$/.test(value)) throw new Error('Missing or zero Git revision');
  return (await git(root, ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`])).toString().trim();
}
async function changes(root, options, fallbacks) {
  let base = null;
  let head = null;
  let mode = 'files';
  let paths = [];
  const removedPaths = [];
  const addStatuses = bytes => {
    const change = statusPaths(bytes);
    paths.push(...change.paths);
    removedPaths.push(...change.removedPaths);
  };
  if (options.changedPaths !== undefined) {
    for (const change of options.changedPaths) {
      if (typeof change === 'string') paths.push(change);
      else if (change && typeof change === 'object') {
        paths.push(change.path, change.oldPath, change.newPath);
        if (change.oldPath && change.oldPath !== change.newPath) removedPaths.push(change.oldPath);
        if (/^(?:D|R)\d*$/.test(change.status ?? '') || ['deleted', 'removed', 'renamed'].includes(change.status)) {
          if (change.oldPath ?? change.path) removedPaths.push(change.oldPath ?? change.path);
        }
      }
      else fallbacks.push('A changed path has an unsupported representation');
    }
    paths = paths.filter(path => path !== undefined);
  } else {
    try {
      head = await revision(root, options.head ?? 'HEAD');
      const requestedBase = await revision(root, options.base ?? 'origin/main');
      mode = options.diffMode ?? 'merge-base';
      if (!['direct', 'merge-base'].includes(mode)) throw new Error('Unknown diff mode');
      base = mode === 'direct' ? requestedBase
        : (await git(root, ['merge-base', requestedBase, head])).toString().trim();
      addStatuses(await git(root, ['diff', '--name-status', '-z', '--find-renames', base, head, '--']));
    } catch { fallbacks.push('The comparison base/head could not be resolved; all gates are required'); }
  }
  const includeWorkingTree = options.includeWorkingTree ?? (options.changedPaths === undefined && options.base === undefined && options.head === undefined);
  if (includeWorkingTree) {
    try {
      addStatuses(await git(root, ['diff', '--name-status', '-z', '--find-renames', 'HEAD', '--']));
      paths.push(...nulStrings(await git(root, ['ls-files', '--others', '--exclude-standard', '-z']))
        .filter(path => path !== 'node_modules' && !path.startsWith('node_modules/')));
    } catch { fallbacks.push('Working-tree changes could not be inspected; all gates are required'); }
  }
  const valid = [];
  for (const path of paths) {
    if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path)
      || posix.normalize(path).startsWith('../')) fallbacks.push('A changed path is not repository relative');
    else valid.push(posix.normalize(path));
  }
  const normalized = new Set(valid);
  return { base, head, includeWorkingTree, selectionMode: mode, changedPaths: [...normalized].sort(),
    removedPaths: [...new Set(removedPaths.filter(path => typeof path === 'string').map(path => posix.normalize(path)))].filter(path => normalized.has(path)).sort() };
}

async function currentFiles(root) {
  return new Set(nulStrings(await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']))
    .filter(path => !path.startsWith('node_modules/') && path !== 'node_modules'));
}
// Blob IDs, rather than path strings, keep --batch's line protocol safe for newline filenames.
async function previousSnapshot(root, base) {
  const entries = nulStrings(await git(root, ['ls-tree', '-r', '-z', base]));
  const inventory = entries.map(entry => {
    const split = entry.indexOf('\t');
    const header = entry.slice(0, split).split(' ');
    return { id: header[2], path: entry.slice(split + 1), type: header[1] };
  });
  const files = new Set(inventory.map(entry => entry.path));
  const blobs = inventory.filter(entry => entry.type === 'blob' && (/^(?:src|scripts|server)\//.test(entry.path) && codeExtension.test(entry.path)
    || entry.path === 'assets/lake-audio/sample-manifest.json'));
  if (!blobs.length) return { sources: new Map(), files };
  const bytes = await new Promise((resolveOutput, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0;
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on('error', () => reject(new Error('Previous dependency graph could not be read')));
    child.on('close', code => code === 0 ? resolveOutput(Buffer.concat(chunks)) : reject(new Error('Previous dependency graph could not be read')));
    child.stdin.on('error', () => {});
    child.stdin.end(blobs.map(blob => blob.id).join('\n') + '\n');
  });
  const sources = new Map();
  let offset = 0;
  for (const blob of blobs) {
    const end = bytes.indexOf(10, offset);
    const header = bytes.subarray(offset, end).toString().split(' ');
    const size = Number(header[2]);
    if (end < 0 || header[0] !== blob.id || header[1] !== 'blob' || !Number.isSafeInteger(size) || size < 0
      || end + size + 1 >= bytes.length) throw new Error('Previous dependency graph is incomplete');
    sources.set(blob.path, bytes.subarray(end + 1, end + 1 + size).toString('utf8'));
    offset = end + 1 + size + 1;
  }
  return { sources, files };
}
function resolveDependency(from, value, files, required = false) {
  const path = posix.normalize(posix.join(posix.dirname(from), value));
  const candidates = [path, `${path}.ts`, `${path}.tsx`, `${path}.mjs`, `${path}.js`, `${path}/index.ts`];
  const found = candidates.find(candidate => files.has(candidate));
  // Keep deleted targets as edges: the previous graph supplies their former consumers.
  return found ?? (required ? extname(path) ? path : `${path}.ts` : undefined);
}
function dependencies(path, source, files, fallbacks) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, /\.tsx?$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length) fallbacks.push(`Dependency parsing failed: ${path}`);
  const edges = new Map();
  const add = (target, runtime = true) => {
    if (target && !target.startsWith('../')) edges.set(target, (edges.get(target) ?? false) || runtime);
  };
  const string = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
  const readNames = new Set(['readFile', 'readFileSync']);
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const value = string(node.moduleSpecifier);
      if (value?.startsWith('.')) {
        const clause = node.importClause;
        const bindings = clause?.namedBindings;
        const onlyTypes = node.isTypeOnly || clause?.isTypeOnly || clause && !clause.name && bindings
          && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(binding => binding.isTypeOnly);
        add(resolveDependency(path, value, files, true), !onlyTypes);
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const value = string(node.arguments[0]);
      if (value?.startsWith('.')) add(resolveDependency(path, value, files, true));
      else if (!value && path.startsWith('src/')) fallbacks.push(`Computed runtime import cannot be classified: ${path}`);
      // Existing source-transforming tests import their captured local source as data: URLs.
      // Their readFile/new URL edges below describe those inputs instead.
    }
    if (ts.isNewExpression(node) && node.expression.getText(ast) === 'URL' && node.arguments?.length >= 2
      && node.arguments[1].getText(ast) === 'import.meta.url') {
      const value = string(node.arguments[0]);
      if (value?.startsWith('.')) add(resolveDependency(path, value, files));
    }
    if (ts.isCallExpression(node) && readNames.has(node.expression.getText(ast))) {
      const collect = part => {
        const value = string(part);
        if (value && /^(?:src|scripts|public|assets|server)\//.test(value)) add(files.has(value) ? value : undefined);
        ts.forEachChild(part, collect);
      };
      for (const argument of node.arguments) collect(argument);
    }
    // Runtime asset URLs are not JS imports. Also recognize a basename such as a coast bird
    // sample when it is unique among public files; templates compose these at fetch time.
    if (path.startsWith('src/')) {
      const value = string(node);
      if (value && !value.includes('\n')) {
        const asset = value.replace(/^\//, '');
        if (files.has(`public/${asset}`)) add(`public/${asset}`);
        else if (/^[^/]+\.(?:wav|ogg|webp|glb|bin)$/.test(asset)) {
          for (const file of files) if (file.startsWith('public/') && posix.basename(file) === asset) add(file);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return edges;
}
function closure(roots, graph, browserWorld) {
  const seen = new Set();
  const visit = path => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const [target, runtime] of graph.get(path) ?? []) {
      if (browserWorld && !runtime) continue;
      const targetOwner = owner(target);
      if (browserWorld && dispatchModules.has(path) && targetOwner && !['shared', browserWorld].includes(targetOwner)) continue;
      visit(target);
    }
  };
  for (const root of roots) visit(root);
  return seen;
}
function checkTestRoster(paths, packageJson, blockingReasons) {
  for (const path of paths) if (testExtension.test(path) && !knownTests.has(path)) {
    blockingReasons.push(`Unclassified test: ${path}`);
  }
  const scriptRoots = new Map([...gates, ...browserGates].map(item => [item.args[1], item.roots.filter(path => knownTests.has(path))]));
  for (const [script, roots] of scriptRoots) {
    const command = packageJson.scripts?.[script];
    if (command === undefined) {
      if (packageJson.name === 'lumen-pilgrimage') blockingReasons.push(`Required gate script is missing: ${script}`);
      continue;
    }
    const actual = [...command.matchAll(/(?:^|\s)(scripts\/[^\s;&]+\.test\.mjs)(?=\s|$)/g)].map(match => match[1]);
    if (roots.length && [...new Set(actual)].sort().join('\0') !== [...new Set(roots)].sort().join('\0')) {
      blockingReasons.push(`Test roster differs from package script: ${script}`);
    }
  }
  if (packageJson.name === 'lumen-pilgrimage') for (const path of knownTests) {
    if (!paths.has(path)) blockingReasons.push(`Required test root is missing: ${path}`);
  }
}

/** Plan only. Commands contain fixed executable/argument arrays and are never shell fragments. */
export async function planAffected(options = {}) {
  const root = resolve(options.root ?? defaultRoot);
  const fallbackReasons = [...(options.forceAllReasons ?? [])];
  const blockingReasons = [];
  const comparison = await changes(root, options, fallbackReasons);
  const reasons = new Map([...gates, ...browserGates].map(item => [item.id, []]));
  const select = (id, reason) => reasons.get(id)?.push(reason);
  let files = new Set();
  const graph = new Map();
  const audioInputs = new Set();
  const managedAudioDirectories = new Set();
  let executionHead = null;
  try {
    executionHead = await revision(root, 'HEAD');
    files = await currentFiles(root);
    // ls-files retains unstaged deletions. Check the actual target, including explicit path probes.
    const removed = new Set(comparison.removedPaths);
    for (const path of comparison.changedPaths) if (files.has(path)) {
      try { await access(resolve(root, path)); } catch { removed.add(path); }
    }
    comparison.removedPaths = [...removed].sort();
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    checkTestRoster(files, pkg, blockingReasons);
    if (pkg.name === 'lumen-pilgrimage') for (const path of knownTests) {
      if (!files.has(path)) continue;
      try { await readFile(resolve(root, path)); } catch { blockingReasons.push(`Required test root is missing: ${path}`); }
    }
    // Deleted or proposed tests are also inventory changes, even when absent from head.
    for (const path of comparison.changedPaths) if (testExtension.test(path) && !knownTests.has(path)) {
      blockingReasons.push(`Unclassified test: ${path}`);
    }
    const snapshot = comparison.base ? await previousSnapshot(root, comparison.base) : { sources: new Map(), files: new Set() };
    const previous = snapshot.sources;
    const allFiles = new Set([...files, ...snapshot.files]);
    const manifestPath = 'assets/lake-audio/sample-manifest.json';
    const manifests = [];
    if (files.has(manifestPath)) manifests.push(await readFile(resolve(root, manifestPath), 'utf8'));
    if (previous.has(manifestPath)) manifests.push(previous.get(manifestPath));
    for (const text of manifests) {
      const manifest = JSON.parse(text);
      for (const directory of manifest.managedAudioDirectories ?? []) managedAudioDirectories.add(directory);
      for (const item of manifest.sources ?? []) {
        for (const input of [...(item.distribution ?? []), ...(item.usage ?? [])]) if (typeof input.path === 'string') audioInputs.add(input.path);
      }
      for (const input of manifest.generatedAssets ?? []) {
        if (typeof input.path === 'string') audioInputs.add(input.path);
        if (typeof input.generator === 'string') audioInputs.add(input.generator);
      }
    }
    for (const path of allFiles) {
      if (!/^(?:src|scripts|server)\//.test(path) || !codeExtension.test(path) || ['scripts/ci-impact.test.mjs', 'scripts/check-affected.test.mjs'].includes(path)) continue;
      let source;
      try { source = await readFile(resolve(root, path), 'utf8'); } catch {
        if (!previous.has(path) && !comparison.changedPaths.includes(path)) throw new Error('Dependency source cannot be read');
      }
      const edges = source === undefined ? new Map() : dependencies(path, source, allFiles, fallbackReasons);
      if (previous.has(path)) for (const [target, runtime] of dependencies(path, previous.get(path), allFiles, fallbackReasons)) {
        edges.set(target, (edges.get(target) ?? false) || runtime);
      }
      graph.set(path, edges);
    }
  } catch { fallbackReasons.push('The dependency graph or test inventory could not be read'); }
  const closures = new Map(gates.map(item => [item.id, closure(item.roots, graph)]));
  const browserClosures = new Map(browserGates.map(item => [item.id, closure(item.roots, graph, item.id.replace('-browser', ''))]));
  for (const path of comparison.removedPaths) select('harness', `Removed or renamed repository link target: ${path}`);
  for (const path of comparison.changedPaths) {
    if (fullInputs.test(path)) { fallbackReasons.push(`Shared build, dependency or CI configuration changed: ${path}`); continue; }
    if (docs(path)) { select('harness', `Documentation or reference input: ${path}`); continue; }
    let classified = false;
    for (const item of gates) if (closures.get(item.id).has(path)) {
      select(item.id, `Test dependency: ${path}`); classified = true;
    }
    for (const item of browserGates) if (browserClosures.get(item.id).has(path)) {
      select(item.id, `Runtime or browser-test dependency: ${path}`); classified = true;
    }
    if (audioInputs.has(path) || [...managedAudioDirectories].some(directory => path === directory || path.startsWith(`${directory}/`))) {
      select('audio-samples', `Declared audio provenance input: ${path}`); classified = true;
    }
    const sourceOwner = owner(path);
    if (sourceOwner) {
      classified = true;
      select('build', `Application source: ${path}`);
      if (sourceOwner !== 'shared' && sourceOwner !== 'audition') select(sourceOwner, `Owned source: ${path}`);
      if (sourceOwner === 'audition') select('koto-browser', `Audition UI: ${path}`);
    }
    const publicOwner = path.match(/^public\/(coast|residence|cinema|atrium|lake)-(?:audio|materials)\//)?.[1]
      ?? (path.startsWith('public/coast-overlook/') ? 'coast' : undefined);
    if (publicOwner) {
      classified = true;
      select('build', `Distributed asset: ${path}`);
      select(publicOwner === 'lake' && path.startsWith('public/lake-audio/') ? 'koto' : publicOwner, `Asset contract: ${path}`);
      // Explicit directory ownership covers computed asset URLs; literal URLs above additionally
      // retain cross-world consumers, for example the same coast bird recordings in the lake.
      if (!path.startsWith('public/lake-audio/')) select(`${publicOwner}-browser`, `World asset: ${path}`);
      if (path.startsWith('public/lake-audio/')) select('audio-samples', `Managed audio distribution: ${path}`);
    }
    if (path.startsWith('assets/lake-audio/') || /^scripts\/(?:koto-[^/]+|prepare-koto-[^/]+)\.(?:mjs|py)$/.test(path)
      || path.startsWith('scripts/research/koto-identifiability/')) {
      classified = true;
      select('koto', `Offline koto production or evidence input: ${path}`);
      select('audio-samples', `Koto provenance or generator input: ${path}`);
    }
    if (path.startsWith('assets/lake-materials/')) {
      classified = true; select('lake', `Lake material source: ${path}`); select('lake-browser', `Lake material source: ${path}`);
    }
    if (/^scripts\/(?:prepare-overlook-(?:city|elevation))\.py$/.test(path)) {
      classified = true; select('coast', `Coast asset generator: ${path}`); select('coast-browser', `Coast asset generator: ${path}`);
    }
    if (/^scripts\/(?:prepare-cinema-hrtf\.py|cinema-screening-fixture\.mjs)$/.test(path)) {
      classified = true; select('cinema', `Cinema asset or fixture generator: ${path}`); select('cinema-browser', `Cinema fixture input: ${path}`);
    }
    if (/^scripts\/(?:draw-atrium-tenant-interiors|check-atrium-tenant-interiors)\.py$/.test(path)) {
      classified = true; select('atrium', `Atrium asset tooling: ${path}`); select('atrium-browser', `Atrium asset tooling: ${path}`);
    }
    if (/^(?:\.gitignore|\.gitattributes|\.codex\/environments\/environment\.toml)$/.test(path)) {
      classified = true; select('harness', `Repository tooling input: ${path}`);
    }
    if (!classified) fallbackReasons.push(`Unclassified input: ${path}`);
  }
  if (blockingReasons.length) fallbackReasons.push('The test inventory requires correction before any gate result can be accepted');
  const blocking = [...new Set(blockingReasons)];
  const fallback = [...new Set(fallbackReasons)];
  const describe = (item, browser = false) => {
    const why = [...new Set(reasons.get(item.id))];
    if (fallback.length) why.unshift('Conservative fallback: the complete gate set is required');
    const selected = why.length > 0;
    return { id: item.id, command: item.command, args: item.args, ...(browser ? { selected } : {}),
      reasons: selected ? why : ['No changed input occurs in this gate dependency closure or its declared non-imported inputs'] };
  };
  const selected = gates.filter(item => fallback.length || reasons.get(item.id).length).map(item => describe(item));
  const skipped = gates.filter(item => !fallback.length && !reasons.get(item.id).length).map(item => describe(item));
  return { schemaVersion: 1, ...comparison, executionHead, selectionMode: fallback.length ? 'fallback' : comparison.changedPaths.length ? comparison.selectionMode : 'empty',
    selected, skipped, fallbackReasons: fallback, blockingReasons: blocking, browser: browserGates.map(item => describe(item, true)) };
}

async function cli() {
  const options = {};
  let output;
  for (let i = 2; i < process.argv.length; i += 1) {
    const argument = process.argv[i];
    if (argument === '--include-working-tree') options.includeWorkingTree = true;
    else if (['--base', '--head', '--json', '--diff-mode'].includes(argument) && process.argv[i + 1]) {
      const value = process.argv[++i];
      if (argument === '--json') output = resolve(value);
      else options[argument === '--diff-mode' ? 'diffMode' : argument.slice(2)] = value;
    } else throw new Error('Unsupported or incomplete planner option');
  }
  const plan = await planAffected(options);
  const json = JSON.stringify(plan, null, 2) + '\n';
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, json); }
  else process.stdout.write(json);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli().catch(() => { console.error('CI impact planning failed. No gates were executed.'); process.exitCode = 1; });
}
