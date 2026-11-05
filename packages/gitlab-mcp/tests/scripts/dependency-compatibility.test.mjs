import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

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
