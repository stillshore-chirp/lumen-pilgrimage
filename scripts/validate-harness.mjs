import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const skillRoot = '.agents/skills';
const harnessGuide = 'docs/agent-harness.md';
const currentDocs = [
  'AGENTS.md',
  'README.md',
  harnessGuide,
  'docs/architecture.md',
  'docs/exploration.md',
  'docs/verification.md',
  'plans/README.md',
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

function anchor(heading) {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '').replaceAll(' ', '-');
}

function checkLinks(doc, source) {
  const targets = new Set();
  const withoutFences = source.replace(/^```[^\r\n]*\r?\n[\s\S]*?^```[ \t]*$/gm, (fence) => fence.replace(/[^\r\n]/g, ''));
  for (const [index, line] of withoutFences.split(/\r?\n/).entries()) {
    for (const [, reference] of line.matchAll(/\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)) {
      if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(reference)) {
        continue;
      }
      const description = `${doc}:${index + 1}: invalid repository link`;
      try {
        const url = new URL(reference, pathToFileURL(resolve(root, doc)));
        const target = repositoryPath(fileURLToPath(url));
        const fragment = decodeURIComponent(url.hash.slice(1));
        if (fragment && target.endsWith('.md')) {
          const headings = read(target).matchAll(/^#{1,6}[ \t]+(.+)$/gm);
          if (![...headings].some(([, title]) => anchor(title) === fragment)) {
            errors.push(description);
            continue;
          }
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

function run() {
  const { scripts } = JSON.parse(read('package.json'));
  const skills = existsSync(resolve(root, skillRoot))
    ? readdirSync(repositoryPath(skillRoot), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${skillRoot}/${entry.name}/SKILL.md`)
    : [];

  const links = new Map();
  for (const doc of [...currentDocs, ...skills]) {
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

  for (const [doc, targets] of [['AGENTS.md', [harnessGuide]], [harnessGuide, skills]]) {
    for (const target of targets) {
      if (!links.get(doc)?.has(target)) {
        errors.push(`${doc}: missing link to ${target}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`✓ harness: ${currentDocs.length} current documents and ${skills.length} skills validated`);
}

try {
  run();
} catch {
  console.error('Harness check could not read package.json or the repository skill directory.');
  process.exitCode = 1;
}
