import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const skillRoot = '.agents/skills';
const harnessGuide = 'docs/agent-harness.md';
const documentationStructure = 'docs/documentation-structure.md';
const repositoryWebRoot = 'https://github.com/stillshore-chirp/lumen-pilgrimage/blob/main/';
const historicalDocs = new Set(['docs/residence/residence-50f-design.md']);
const preservedDocs = ['plans/README.md'];
const workflowTemplates = [
  '.github/ISSUE_TEMPLATE/change.md',
  '.github/pull_request_template.md',
  'plans/TEMPLATE.md'
];
const errors = [];

function repositoryPath(path) {
  const realPath = realpathSync(resolve(root, path));
  const repoRelative = relative(root, realPath);
  if (isAbsolute(repoRelative) || repoRelative === '..' || repoRelative.startsWith(`..${sep}`)) {
    throw new Error('Path resolves outside the repository');
  }
  return realPath;
}

function read(path) {
  return readFileSync(repositoryPath(path), 'utf8');
}

function markdownFiles(directory) {
  if (!existsSync(resolve(root, directory))) {
    return [];
  }
  const files = [];
  function visit(current) {
    for (const entry of readdirSync(repositoryPath(current), { withFileTypes: true })) {
      const path = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(path);
      }
    }
  }
  visit(directory);
  return files.sort();
}

function anchor(heading) {
  return heading.toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function withoutFencedCode(source) {
  const lines = source.split(/(\r\n|\n|\r)/);
  let openFence;
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    if (openFence) {
      lines[index] = ' '.repeat(line.length);
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/)?.[1];
      if (closing?.[0] === openFence.character && closing.length >= openFence.length) {
        openFence = undefined;
      }
      continue;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) {
      continue;
    }
    openFence = { character: opening[1][0], length: opening[1].length };
    lines[index] = ' '.repeat(line.length);
  }
  return lines.join('');
}

function headingAnchors(source) {
  const anchors = new Set();
  const counts = new Map();
  for (const [, heading] of withoutFencedCode(source).matchAll(/^#{1,6}[ \t]+(.+)$/gm)) {
    const base = anchor(heading);
    const count = counts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return anchors;
}

function linkDestination(raw) {
  const trimmed = raw.trim();
  const angle = trimmed.match(/^<([^<>]+)>(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/);
  const plain = trimmed.match(/^([^\s<>]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/);
  return angle?.[1] ?? plain?.[1] ?? '';
}

function checkLinks(doc, source) {
  const targets = new Set();
  for (const [index, line] of withoutFencedCode(source).split(/\r?\n/).entries()) {
    const starts = /!?\[[^\]\n]*\]\(/g;
    for (const start of line.matchAll(starts)) {
      const destinationStart = start.index + start[0].length;
      const destinationEnd = line.indexOf(')', destinationStart);
      const description = `${doc}:${index + 1}: invalid repository link`;
      if (destinationEnd < 0) {
        errors.push(description);
        continue;
      }
      const reference = linkDestination(line.slice(destinationStart, destinationEnd));
      if (!reference) {
        errors.push(description);
        continue;
      }
      const repositoryWebLink = reference.startsWith(repositoryWebRoot);
      if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(reference) && !repositoryWebLink) {
        continue;
      }
      try {
        // Conversation templates need absolute GitHub links after insertion.
        // Validate this repository's main links against the candidate local tree.
        const url = repositoryWebLink
          ? new URL(reference.slice(repositoryWebRoot.length), pathToFileURL(root + sep))
          : new URL(reference, pathToFileURL(resolve(root, doc)));
        const target = repositoryPath(fileURLToPath(url));
        const fragment = decodeURIComponent(url.hash.slice(1));
        if (fragment && target.endsWith('.md') && !headingAnchors(read(target)).has(fragment)) {
          errors.push(description);
          continue;
        }
        targets.add(relative(root, target).split(sep).join('/'));
      } catch {
        errors.push(description);
      }
    }
  }
  return targets;
}

function field(frontmatter, key) {
  const fields = [...frontmatter.matchAll(new RegExp(`^${key}:[ \\t]*(.*)$`, 'gm'))];
  return fields.length === 1 ? fields[0][1].trim().replace(/^(['"])(.*)\1$/, '$2').trim() : '';
}

function checkSkill(doc, source) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
  const folder = doc.split('/').at(-2);
  const name = field(frontmatter, 'name');
  if (name !== folder || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !field(frontmatter, 'description')) {
    errors.push(`${doc}: expected frontmatter with a name matching its folder and a nonempty description`);
  }
}

function reachableDocuments(start, links, currentDocs) {
  const reachable = new Set([start]);
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    for (const target of links.get(queue[index]) ?? []) {
      if (currentDocs.has(target) && !reachable.has(target)) {
        reachable.add(target);
        queue.push(target);
      }
    }
  }
  return reachable;
}

function run() {
  const { scripts } = JSON.parse(read('package.json'));
  const discoveredDocs = markdownFiles('docs');
  const assetCredits = markdownFiles('public').filter((doc) => doc.endsWith('/ATTRIBUTION.md'));
  const currentDocs = [
    'AGENTS.md',
    'README.md',
    ...workflowTemplates,
    ...discoveredDocs.filter((doc) => !historicalDocs.has(doc)),
    ...assetCredits
  ];
  const supplementaryDocs = [
    ...discoveredDocs.filter((doc) => historicalDocs.has(doc)),
    ...preservedDocs
  ];
  const skills = existsSync(resolve(root, skillRoot))
    ? readdirSync(repositoryPath(skillRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${skillRoot}/${entry.name}/SKILL.md`)
    : [];

  const links = new Map();
  for (const doc of [...currentDocs, ...supplementaryDocs, ...skills]) {
    let source;
    try {
      source = read(doc);
    } catch {
      errors.push(`${doc}: cannot read required document`);
      continue;
    }
    links.set(doc, checkLinks(doc, source));
    for (const [, name] of source.matchAll(/\bnpm run ([\w:-]+)/g)) {
      if (!Object.hasOwn(scripts, name)) {
        errors.push(`${doc}: unknown npm script ${name}`);
      }
    }
    if (doc.startsWith(`${skillRoot}/`)) {
      checkSkill(doc, source);
    }
  }

  for (const [doc, targets] of [
    ['AGENTS.md', [harnessGuide, documentationStructure]],
    [harnessGuide, [documentationStructure, ...skills]]
  ]) {
    for (const target of targets) {
      if (!links.get(doc)?.has(target)) {
        errors.push(`${doc}: missing link to ${target}`);
      }
    }
  }

  const reachableFromReadme = reachableDocuments('README.md', links, new Set(currentDocs));
  for (const doc of currentDocs) {
    if (!reachableFromReadme.has(doc)) {
      errors.push(`README.md: maintained document is not reachable: ${doc}`);
    }
  }

  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`✓ harness: ${currentDocs.length} maintained documents, ${supplementaryDocs.length} historical/plan documents and ${skills.length} skills validated`);
}

try {
  run();
} catch {
  console.error('Harness check could not read package.json or the repository skill directory.');
  process.exitCode = 1;
}
