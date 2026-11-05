import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

// Coverage discovery must include source files while excluding tests and dependencies.
test('test-exclude globSync selects only instrumentable source files', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'gitlab-mcp-coverage-selection-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const files = [
    'src/main.ts',
    'src/nested/helper.js',
    'src/main.test.ts',
    'src/readme.md',
    'tests/setup.ts',
    'node_modules/dependency/index.js',
  ];
  for (const file of files) {
    const target = join(cwd, file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, '');
  }
  const TestExclude = require('test-exclude');
  const selection = new TestExclude({
    cwd,
    include: ['src/**'],
    exclude: ['**/*.test.ts'],
    extension: ['.ts', '.js'],
  });
  assert.deepEqual(selection.globSync().sort(), ['src/main.ts', 'src/nested/helper.js']);
});

// Nx must retain cached project/path selection after minimatch removes regex generation.
test('Nx matches project globs and cached candidates', () => {
  const { getMatchingStringsWithCache } = require('nx/src/utils/find-matching-projects');
  assert.deepEqual(getMatchingStringsWithCache('core-*', ['core-api', 'docs', 'core-ui']), [
    'core-api',
    'core-ui',
  ]);
  assert.deepEqual(getMatchingStringsWithCache('core-*', ['docs', 'core-new', 'core-api']), [
    'core-new',
    'core-api',
  ]);
  assert.deepEqual(getMatchingStringsWithCache('**/src/*.ts', ['.hidden/src/a.ts', 'docs/a.md']), [
    '.hidden/src/a.ts',
  ]);
});

// File discovery must merge virtual creates/deletes without depending on removed makeRe.
test('Nx virtual file globs retain creates and remove deletes', (t) => {
  const context = require('nx/src/utils/workspace-context');
  t.mock.method(context, 'globWithWorkspaceContextSync', () => [
    'src/existing.ts',
    'src/deleted.ts',
  ]);
  const { glob } = require('nx/src/generators/utils/glob');
  const tree = {
    root: '/virtual',
    listChanges: () => [
      { type: 'CREATE', path: 'src/added.ts' },
      { type: 'CREATE', path: 'docs/guide.md' },
      { type: 'DELETE', path: 'src/deleted.ts' },
      { type: 'UPDATE', path: 'src/existing.ts' },
    ],
  };
  assert.deepEqual(glob(tree, ['src/**/*.ts']).sort(), ['src/added.ts', 'src/existing.ts']);
});

// Empty and comment patterns must retain Nx's explicit invalid-pattern error.
for (const pattern of ['', '#ignored']) {
  test(`Nx rejects invalid virtual glob ${JSON.stringify(pattern)}`, (t) => {
    const context = require('nx/src/utils/workspace-context');
    t.mock.method(context, 'globWithWorkspaceContextSync', () => []);
    const { glob } = require('nx/src/generators/utils/glob');
    const tree = {
      root: '/virtual',
      listChanges: () => {
        assert.fail('Invalid patterns must be rejected before reading virtual changes');
      },
    };
    assert.throws(() => glob(tree, [pattern]), {
      message: 'Invalid glob pattern: ' + pattern,
    });
  });

  // Cached project matching must preserve the same invalid-pattern rejection.
  test(`Nx rejects invalid project glob ${JSON.stringify(pattern)}`, () => {
    const { getMatchingStringsWithCache } = require('nx/src/utils/find-matching-projects');
    assert.throws(() => getMatchingStringsWithCache(pattern, ['core-api']), {
      message: 'Invalid glob pattern ' + pattern,
    });
  });
}

// Release branch patterns must still select all-branch versus merged-only tag discovery.
test('Nx release tag discovery honors branch glob policy', async (t) => {
  const command = require('nx/src/command-line/release/utils/exec-command');
  const calls = [];
  t.mock.method(command, 'execCommand', async (_command, args) => {
    calls.push(args);
    return args[0] === 'rev-parse' ? 'release/next\n' : 'v2.0.0\n';
  });
  const { RepoGitTags } = require('nx/src/command-line/release/utils/repository-git-tags');
  assert.deepEqual(await RepoGitTags.create().resolveTags(['release/*']), ['v2.0.0']);
  assert.equal(
    calls.some((args) => args.includes('--merged')),
    false,
  );
  calls.length = 0;
  assert.deepEqual(await RepoGitTags.create().resolveTags(['main']), ['v2.0.0']);
  assert.equal(
    calls.some((args) => args.includes('--merged')),
    true,
  );
});
