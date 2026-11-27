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
const worldQualityHeading = 'ワールドの初回提示の品質基準';
const worldWorkflowHeadings = [
  '参考画像の段階的解析',
  'ワールド全域の先行設計',
  '粗い3Dモデルと独立設計レビュー',
  '制作候補と最終版の全方向検証'
];
const worldEvidenceHeading = '参考画像・ワールド制作の工程証拠';
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

function visibleMarkdown(source) {
  const lines = source.split(/(\r\n|\n|\r)/);
  let openFence;
  let inComment = false;
  for (let index = 0; index < lines.length; index += 2) {
    let line = lines[index];
    if (openFence) {
      lines[index] = ' '.repeat(line.length);
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/)?.[1];
      if (closing?.[0] === openFence.character && closing.length >= openFence.length) {
        openFence = undefined;
      }
      continue;
    }

    let cursor = 0;
    while (cursor < line.length) {
      const start = inComment ? cursor : line.indexOf('<!--', cursor);
      if (start < 0) break;
      const closing = line.indexOf('-->', inComment ? start : start + 4);
      const end = closing < 0 ? line.length : closing + 3;
      line = line.slice(0, start) + ' '.repeat(end - start) + line.slice(end);
      inComment = closing < 0;
      cursor = end;
    }
    lines[index] = line;
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) {
      continue;
    }
    openFence = { character: opening[1][0], length: opening[1].length };
    lines[index] = ' '.repeat(line.length);
  }
  return lines.join('');
}

function markdownHeadings(source) {
  const headings = [];
  const counts = new Map();
  for (const match of visibleMarkdown(source).matchAll(/^(#{1,6})[ \t]+(.+)$/gm)) {
    const heading = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
    const base = anchor(heading);
    const count = counts.get(base) ?? 0;
    headings.push({
      title: heading, level: match[1].length, index: match.index,
      end: match.index + match[0].length, anchor: count === 0 ? base : `${base}-${count}`
    });
    counts.set(base, count + 1);
  }
  return headings;
}

function headingAnchors(source) {
  return new Set(markdownHeadings(source).map(heading => heading.anchor));
}

function markdownSection(source, title, level) {
  const headings = markdownHeadings(source);
  const heading = headings.find(candidate => candidate.title === title && candidate.level === level);
  if (!heading) return undefined;
  const next = headings.find(candidate => candidate.index > heading.index && candidate.level <= level);
  return source.slice(heading.end, next?.index ?? source.length);
}

function linkDestination(raw) {
  const trimmed = raw.trim();
  const angle = trimmed.match(/^<([^<>]+)>(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/);
  const plain = trimmed.match(/^([^\s<>]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/);
  return angle?.[1] ?? plain?.[1] ?? '';
}

function withoutInlineCode(source) {
  const delimiters = [...source.matchAll(/`+/g)];
  let visible = source;
  for (let index = 0; index < delimiters.length; index += 1) {
    const opening = delimiters[index];
    const closingIndex = delimiters.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate[0] === opening[0]);
    if (closingIndex < 0) continue;
    const closing = delimiters[closingIndex];
    const end = closing.index + closing[0].length;
    visible = visible.slice(0, opening.index)
      + visible.slice(opening.index, end).replace(/[^\r\n]/g, ' ') + visible.slice(end);
    index = closingIndex;
  }
  return visible;
}

function indentation(whitespace, start = 0) {
  let column = start;
  for (const character of whitespace) column += character === '\t' ? 4 - column % 4 : 1;
  return column - start;
}

function withoutIndentedCode(source) {
  // Maintained documents use paragraphs, ATX headings and ordinary bullet/numbered
  // lists. List content indentation is relative to its marker; four spaces alone
  // do not make a code block while a paragraph is continuing.
  const lines = source.split(/(\r\n|\n|\r)/);
  const listIndents = [];
  let paragraph = false;
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index];
    if (!line.trim()) {
      paragraph = false;
      continue;
    }
    const whitespace = line.match(/^[ \t]*/)[0];
    const indent = indentation(whitespace);
    const content = line.slice(whitespace.length);
    const marker = content.match(/^([-+*]|\d{1,9}[.)])([ \t]+|$)/);
    const heading = /^#{1,6}(?:[ \t]+|$)/.test(content);
    const separator = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|=+[ \t]*)$/.test(content);
    const wasInList = listIndents.length > 0;
    // An unindented line may continue a list paragraph without repeating its indent.
    if (!(paragraph && !marker && !heading && !separator)) {
      while (listIndents.length && indent < listIndents.at(-1)) listIndents.pop();
    }
    const relativeIndent = indent - (listIndents.at(-1) ?? 0);
    if (relativeIndent >= 4 && !paragraph) {
      lines[index] = ' '.repeat(line.length);
      continue;
    }
    if (relativeIndent >= 4) continue;
    if (heading || separator) {
      paragraph = false;
      continue;
    }
    const body = marker ? content.slice(marker[0].length) : '';
    const mayStartList = marker && (!paragraph || wasInList
      || (body && (/^[-+*]$/.test(marker[1]) || /^1[.)]$/.test(marker[1]))));
    if (mayStartList) {
      const padding = indentation(marker[2], indent + marker[1].length) || 1;
      listIndents.push(indent + marker[1].length + (padding > 4 ? 1 : padding));
      if (padding > 4 && body) lines[index] = ' '.repeat(line.length);
      paragraph = Boolean(body) && padding <= 4 && !/^#{1,6}(?:[ \t]+|$)/.test(body);
    } else {
      paragraph = true;
    }
  }
  return lines.join('');
}

function* markdownLinks(source) {
  const visible = withoutInlineCode(withoutIndentedCode(visibleMarkdown(source)));
  for (const [index, line] of visible.split(/\r?\n/).entries()) {
    const starts = /!?\[[^\]\n]*\]\(/g;
    for (const start of line.matchAll(starts)) {
      if ((line.slice(0, start.index).match(/\\+$/)?.[0].length ?? 0) % 2 === 1) continue;
      const destinationStart = start.index + start[0].length;
      const destinationEnd = line.indexOf(')', destinationStart);
      yield {
        reference: destinationEnd < 0 ? '' : linkDestination(line.slice(destinationStart, destinationEnd)),
        line: index + 1, image: start[0].startsWith('!')
      };
    }
  }
}

function checkLinks(doc, source) {
  const targets = new Set();
  for (const { reference, line } of markdownLinks(source)) {
    const description = `${doc}:${line}: invalid repository link`;
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
  return targets;
}

function hasSectionLink(doc, source, target, heading) {
  const base = 'https://harness.invalid/repository/';
  for (const { reference, image } of markdownLinks(source)) {
    if (!reference || image) continue;
    const repositoryWebLink = reference.startsWith(repositoryWebRoot);
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(reference) && !repositoryWebLink) continue;
    try {
      const url = repositoryWebLink
        ? new URL(reference.slice(repositoryWebRoot.length), base)
        : new URL(reference, new URL(doc, base));
      if (url.origin === new URL(base).origin && decodeURIComponent(url.pathname) === `/repository/${target}`
        && decodeURIComponent(url.hash.slice(1)) === anchor(heading)) return true;
    } catch { /* Malformed destinations are reported by the repository link check. */ }
  }
  return false;
}

// This checks the maintained workflow's structure and navigation, not its evidence or quality.
export function validateWorldWorkflow(documents) {
  const failures = [];
  const quality = markdownSection(documents.get(harnessGuide) ?? '', worldQualityHeading, 3);
  if (quality === undefined) failures.push(`${harnessGuide}: missing world workflow heading ${worldQualityHeading}`);
  for (const heading of worldWorkflowHeadings) {
    if (markdownSection(quality ?? '', heading, 4) === undefined) {
      failures.push(`${harnessGuide}: missing world workflow subsection ${heading}`);
    }
  }
  for (const heading of [worldQualityHeading, worldWorkflowHeadings[1]]) {
    if (!hasSectionLink('AGENTS.md', documents.get('AGENTS.md') ?? '', harnessGuide, heading)) {
      failures.push(`AGENTS.md: missing world workflow link to ${harnessGuide}#${anchor(heading)}`);
    }
  }
  for (const doc of workflowTemplates) {
    const evidence = markdownSection(documents.get(doc) ?? '', worldEvidenceHeading, 3);
    if (evidence === undefined) failures.push(`${doc}: missing world workflow heading ${worldEvidenceHeading}`);
    for (const heading of worldWorkflowHeadings) {
      if (!hasSectionLink(doc, evidence ?? '', harnessGuide, heading)) {
        failures.push(`${doc}: missing world workflow link to ${harnessGuide}#${anchor(heading)}`);
      }
    }
  }
  const verification = markdownSection(documents.get('docs/verification.md') ?? '', 'ワールド制作の検証記録', 2);
  if (verification === undefined) failures.push('docs/verification.md: missing world workflow heading ワールド制作の検証記録');
  if (markdownSection(verification ?? '', 'ハーネスの机上適用検証', 3) === undefined) {
    failures.push('docs/verification.md: missing world workflow subsection ハーネスの机上適用検証');
  }
  return failures;
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
  const documents = new Map();
  for (const doc of [...currentDocs, ...supplementaryDocs, ...skills]) {
    let source;
    try {
      source = read(doc);
    } catch {
      errors.push(`${doc}: cannot read required document`);
      continue;
    }
    documents.set(doc, source);
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
  errors.push(...validateWorldWorkflow(documents));

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

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    run();
  } catch {
    console.error('Harness check could not read package.json or the repository skill directory.');
    process.exitCode = 1;
  }
}
