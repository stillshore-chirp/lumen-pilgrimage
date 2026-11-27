import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { validateWorldWorkflow } from './validate-harness.mjs';

const validatorSource = readFileSync(new URL('./validate-harness.mjs', import.meta.url), 'utf8');
const worldGuide = [
  '[Verification](verification.md)',
  '### ワールドの初回提示の品質基準',
  '#### 参考画像の段階的解析',
  '#### ワールド全域の先行設計',
  '#### 粗い3Dモデルと独立設計レビュー',
  '#### 制作候補と最終版の全方向検証'
].join('\n');
const worldLinks = [
  '[Analysis](https://github.com/stillshore-chirp/lumen-pilgrimage/blob/main/docs/agent-harness.md#参考画像の段階的解析)',
  '[Design](https://github.com/stillshore-chirp/lumen-pilgrimage/blob/main/docs/agent-harness.md#ワールド全域の先行設計)',
  '[Model](https://github.com/stillshore-chirp/lumen-pilgrimage/blob/main/docs/agent-harness.md#粗い3dモデルと独立設計レビュー)',
  '[Verification](https://github.com/stillshore-chirp/lumen-pilgrimage/blob/main/docs/agent-harness.md#制作候補と最終版の全方向検証)'
].join('\n');

function worldDocuments() {
  return new Map(Object.entries({
    'AGENTS.md': '[Quality](docs/agent-harness.md#ワールドの初回提示の品質基準) [Design](docs/agent-harness.md#ワールド全域の先行設計)',
    'docs/agent-harness.md': worldGuide,
    'docs/verification.md': '## ワールド制作の検証記録\n### ハーネスの机上適用検証\n',
    '.github/ISSUE_TEMPLATE/change.md': `### 参考画像・ワールド制作の工程証拠\n${worldLinks}`,
    '.github/pull_request_template.md': `### 参考画像・ワールド制作の工程証拠\n${worldLinks}`,
    'plans/TEMPLATE.md': `### 参考画像・ワールド制作の工程証拠\n${worldLinks}`
  }));
}

function createFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lumen-harness-test-'));
  const files = {
    ...Object.fromEntries(worldDocuments()),
    'package.json': JSON.stringify({ scripts: { serve: 'vite' } }),
    'AGENTS.md': `${worldDocuments().get('AGENTS.md')} [Structure](docs/documentation-structure.md)`,
    'README.md': '[Guide](docs/agent-harness.md) [Rules](AGENTS.md) [Issue](.github/ISSUE_TEMPLATE/change.md) [PR](.github/pull_request_template.md) [Plan](plans/TEMPLATE.md)',
    'docs/agent-harness.md': `[Structure](documentation-structure.md)\n${worldGuide}`,
    'docs/documentation-structure.md': '# Structure\n',
    'plans/README.md': '# Archive\n',
    ...overrides
  };
  for (const [path, source] of Object.entries(files)) {
    const destination = join(root, path);
    mkdirSync(join(destination, '..'), { recursive: true });
    writeFileSync(destination, source);
  }
  const validator = join(root, 'scripts/validate-harness.mjs');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(validator, validatorSource);
  return {
    run() {
      return spawnSync(process.execPath, [validator], { cwd: root, encoding: 'utf8' });
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test('checks npm scripts inside fenced runnable instructions', () => {
  const fixture = createFixture({
    'docs/agent-harness.md': '```sh\nnpm run definitely-not-a-script\n```\n[Structure](documentation-structure.md)'
  });
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown npm script definitely-not-a-script/);
  } finally {
    fixture.cleanup();
  }
});

test('accepts longer same-character closing fences and ignores their contents', () => {
  const fixture = createFixture({
    'docs/agent-harness.md': [
      '```md',
      '[broken](missing.md)',
      '# Example heading',
      '````',
      '[Structure](documentation-structure.md)',
      worldGuide
    ].join('\n')
  });
  try {
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fixture.cleanup();
  }
});

test('does not treat a heading inside a fenced example as an anchor', () => {
  const fixture = createFixture({
    'docs/agent-harness.md': '[Structure](documentation-structure.md#example-heading)',
    'docs/documentation-structure.md': '```md\n# Example heading\n````\n'
  });
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid repository link/);
  } finally {
    fixture.cleanup();
  }
});

test('validates repository links in the issue template', () => {
  const fixture = createFixture({
    '.github/ISSUE_TEMPLATE/change.md': '[Missing source](../../docs/missing-source.md)'
  });
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ISSUE_TEMPLATE\/change\.md:1: invalid repository link/);
  } finally {
    fixture.cleanup();
  }
});

test('checks runnable npm commands in the PR template', () => {
  const fixture = createFixture({
    '.github/pull_request_template.md': '```sh\nnpm run missing-check\n```'
  });
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pull_request_template\.md: unknown npm script missing-check/);
  } finally {
    fixture.cleanup();
  }
});

test('requires a workflow template to remain reachable from the entry point', () => {
  const fixture = createFixture({
    'README.md': '[Guide](docs/agent-harness.md) [Rules](AGENTS.md) [Issue](.github/ISSUE_TEMPLATE/change.md) [PR](.github/pull_request_template.md)'
  });
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /maintained document is not reachable: plans\/TEMPLATE\.md/);
  } finally {
    fixture.cleanup();
  }
});

test('accepts repository main URLs from a conversation template', () => {
  const fixture = createFixture({
    '.github/ISSUE_TEMPLATE/change.md': `${worldDocuments().get('.github/ISSUE_TEMPLATE/change.md')}\n[Rules](https://github.com/stillshore-chirp/lumen-pilgrimage/blob/main/docs/documentation-structure.md#structure)`
  });
  try {
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fixture.cleanup();
  }
});

test('accepts world workflow wiring with repository-relative and encoded links', () => {
  const documents = worldDocuments();
  documents.set('plans/TEMPLATE.md', `### 参考画像・ワールド制作の工程証拠\n${worldLinks
    .replaceAll('https://github.com/stillshore-chirp/lumen-pilgrimage/blob/main/', '../')
    .replace('#参考画像の段階的解析', `#${encodeURIComponent('参考画像の段階的解析')}`)}`);
  assert.deepEqual(validateWorldWorkflow(documents), []);
});

test('requires the entry point to link directly to quality and advance design', () => {
  const documents = worldDocuments();
  documents.set('AGENTS.md', '[Harness](docs/agent-harness.md)');
  const failures = validateWorldWorkflow(documents);
  assert.equal(failures.length, 2);
  assert.ok(failures.every(failure => failure.startsWith('AGENTS.md: missing world workflow link')));
});

test('requires each world subsection inside the canonical quality section', () => {
  for (const replacement of ['', '### ワールド全域の先行設計', '## Elsewhere\n#### ワールド全域の先行設計']) {
    const documents = worldDocuments();
    documents.set('docs/agent-harness.md', worldGuide.replace('#### ワールド全域の先行設計', replacement));
    assert.ok(validateWorldWorkflow(documents).some(failure => failure.includes('missing world workflow subsection ワールド全域の先行設計')));
  }
});

test('requires a world evidence section in every maintained workflow template', () => {
  for (const doc of ['.github/ISSUE_TEMPLATE/change.md', '.github/pull_request_template.md', 'plans/TEMPLATE.md']) {
    const documents = worldDocuments();
    documents.set(doc, worldLinks);
    assert.ok(validateWorldWorkflow(documents).includes(`${doc}: missing world workflow heading 参考画像・ワールド制作の工程証拠`));
  }
});

test('reports missing world workflow wiring through the repository CLI', () => {
  const fixture = createFixture({ 'plans/TEMPLATE.md': worldLinks });
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /plans\/TEMPLATE\.md: missing world workflow heading/);
  } finally {
    fixture.cleanup();
  }
});

test('requires all four canonical links inside the template evidence section', () => {
  for (const link of worldLinks.split('\n')) {
    const documents = worldDocuments();
    documents.set('plans/TEMPLATE.md', `### 参考画像・ワールド制作の工程証拠\n${worldLinks.replace(link, '')}\n## Other\n${link}`);
    const failures = validateWorldWorkflow(documents);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^plans\/TEMPLATE\.md: missing world workflow link/);
  }
});

test('does not accept example, image, external, escaped or wrong-anchor wiring', () => {
  for (const substitute of [
    `<!-- ${worldLinks} -->`,
    `~~~md\n${worldLinks}\n~~~~`,
    worldLinks.split('\n').map(link => `\`\`${link}\`\``).join('\n'),
    worldLinks.replaceAll('[', '!['),
    worldLinks.replaceAll('[', '\\['),
    worldLinks.replaceAll('https://github.com/stillshore-chirp/lumen-pilgrimage/blob/main/', 'https://example.com/'),
    worldLinks.replaceAll('#', '#missing-')
  ]) {
    const documents = worldDocuments();
    documents.set('plans/TEMPLATE.md', `### 参考画像・ワールド制作の工程証拠\n${substitute}`);
    assert.equal(validateWorldWorkflow(documents).length, 4);
  }
  for (const wrap of [source => `<!--\n${source}\n-->`, source => `\`\`\`md\n${source}\n\`\`\``]) {
    const documents = worldDocuments();
    documents.set('docs/agent-harness.md', wrap(worldGuide));
    assert.equal(validateWorldWorkflow(documents).filter(failure => failure.startsWith('docs/agent-harness.md:')).length, 5);
  }
});

test('does not count space- or tab-indented code as world workflow links', () => {
  for (const [lead, prefix] of [
    ['', '    '], ['', '\t'], ['', ' \t'], ['Paragraph\n\n', '    '],
    ['- Parent\n\n', '      '], ['- Parent\n  - Child\n\n', '        '], ['', '-     ']
  ]) {
    const documents = worldDocuments();
    const block = worldLinks.split('\n').map(link => `${prefix}${link}`).join('\n');
    documents.set('plans/TEMPLATE.md', `### 参考画像・ワールド制作の工程証拠\n\n${lead}${block}`);
    assert.equal(validateWorldWorkflow(documents).length, 4, JSON.stringify({ prefix, lead }));
  }
});

test('keeps normal lists, nested lists and indented paragraph continuations navigable', () => {
  for (const block of [
    worldLinks.split('\n').map(link => `- ${link}`).join('\n'),
    worldLinks.split('\n').map((link, index) => `${index + 1}. ${link}`).join('\n'),
    `- Parent\n${worldLinks.split('\n').map(link => `    - ${link}`).join('\n')}`,
    `1. Parent\n\n${worldLinks.split('\n').map(link => `   - ${link}`).join('\n')}`,
    `- Parent\n\n${worldLinks.split('\n').map(link => `    ${link}`).join('\n')}`,
    `Paragraph\n${worldLinks.split('\n').map(link => `    ${link}`).join('\n')}`,
    `- Paragraph\n${worldLinks.split('\n').map(link => `      ${link}`).join('\n')}`
  ]) {
    const documents = worldDocuments();
    documents.set('plans/TEMPLATE.md', `### 参考画像・ワールド制作の工程証拠\n\n${block}`);
    assert.deepEqual(validateWorldWorkflow(documents), [], block);
  }
});

test('ignores broken links in indented code and still validates list content links', () => {
  for (const code of ['    [broken](missing.md)', '\t[broken](missing.md)', '- Parent\n\n      [broken](missing.md)']) {
    const fixture = createFixture({
      'docs/documentation-structure.md': `# Structure\n\n${code}\n`
    });
    try {
      const result = fixture.run();
      assert.equal(result.status, 0, result.stderr);
    } finally {
      fixture.cleanup();
    }
  }
  const fixture = createFixture({
    'docs/documentation-structure.md': '# Structure\n\n- Parent\n    - [broken](missing.md)\n'
  });
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /documentation-structure\.md:4: invalid repository link/);
  } finally {
    fixture.cleanup();
  }
});

test('requires desk verification within the world verification record', () => {
  const documents = worldDocuments();
  documents.set('docs/verification.md', '## ワールド制作の検証記録\n## Other\n### ハーネスの机上適用検証');
  assert.deepEqual(validateWorldWorkflow(documents), ['docs/verification.md: missing world workflow subsection ハーネスの机上適用検証']);
});

test('does not judge evidence prose or require world fields in unrelated documents', () => {
  const documents = worldDocuments();
  documents.set('docs/ordinary-change.md', '# Ordinary change\n');
  documents.set('plans/TEMPLATE.md', `${documents.get('plans/TEMPLATE.md')}\n適用理由: N/A\n`);
  assert.deepEqual(validateWorldWorkflow(documents), []);
  documents.set('plans/TEMPLATE.md', `${documents.get('plans/TEMPLATE.md')}\n未検証の工程と参照先を記録する。\n`);
  assert.deepEqual(validateWorldWorkflow(documents), []);
});

test('does not use commented links for maintained-document reachability', () => {
  const fixture = createFixture({
    'README.md': '[Guide](docs/agent-harness.md) [Rules](AGENTS.md) [Issue](.github/ISSUE_TEMPLATE/change.md) [PR](.github/pull_request_template.md) <!-- [Plan](plans/TEMPLATE.md) -->'
  });
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /maintained document is not reachable: plans\/TEMPLATE\.md/);
  } finally {
    fixture.cleanup();
  }
});

test('checks main URL anchors against the candidate tree without network access', () => {
  const fixture = createFixture({
    '.github/pull_request_template.md': '[Rules](https://github.com/stillshore-chirp/lumen-pilgrimage/blob/main/docs/documentation-structure.md#missing-section)'
  });
  try {
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pull_request_template\.md:1: invalid repository link/);
  } finally {
    fixture.cleanup();
  }
});
