import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const validatorSource = readFileSync(new URL('./validate-harness.mjs', import.meta.url), 'utf8');

function createFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lumen-harness-test-'));
  const files = {
    'package.json': JSON.stringify({ scripts: { serve: 'vite' } }),
    'AGENTS.md': '[Harness](docs/agent-harness.md) [Structure](docs/documentation-structure.md)',
    'README.md': '[Guide](docs/agent-harness.md) [Rules](AGENTS.md)',
    'docs/agent-harness.md': '[Structure](documentation-structure.md)',
    'docs/documentation-structure.md': '# Structure\n',
    'plans/README.md': '# Archive\n',
    'plans/TEMPLATE.md': '# Template\n',
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
      '[Structure](documentation-structure.md)'
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
