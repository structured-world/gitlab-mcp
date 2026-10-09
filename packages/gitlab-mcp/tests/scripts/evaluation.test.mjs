import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  launch,
  launchSync,
  resolveExecutable,
  isMutationCall,
} from '../../scripts/evaluation-process.mjs';
import { startWorkflowGitLab } from '../manual/fixtures/workflow-gitlab.mjs';

test('the evaluator rejects an executable supplied as a positional argument', () => {
  // An agent-facing invocation selects a known client, never arbitrary executable code.
  const directory = mkdtempSync(join(tmpdir(), 'gitlab-eval-command-'));
  try {
    const marker = join(directory, 'executed');
    const executable = join(directory, 'unexpected');
    writeFileSync(executable, `#!/bin/sh\ntouch '${marker}'\necho fixture\n`, { mode: 0o755 });
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/evaluate-skills.mjs'), 'codex', executable],
      {
        timeout: 3000,
        encoding: 'utf8',
      },
    );
    assert.equal(existsSync(marker), false);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('launch preserves metacharacters as arguments in synchronous and asynchronous calls', async () => {
  // Prompts contain shell syntax; launching a client must never interpret it.
  const argument = '" & echo unexpected | $(echo unexpected) %PATH% ^ >';
  const args = ['-e', 'process.stdout.write(process.argv[1])', argument];
  assert.equal(launchSync(process.execPath, args, { encoding: 'utf8' }), argument);
  const child = launch(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  await new Promise((done, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? done() : reject(new Error(`Exit ${code}`))));
  });
  assert.equal(output, argument);
});

test('resolves Windows npm shims to absolute paths and rejects missing executables', () => {
  // Resolution must not depend on the later temporary workspace's current directory.
  const directory = mkdtempSync(join(tmpdir(), 'gitlab-eval-shim-'));
  try {
    writeFileSync(join(directory, 'codex.cmd'), '@echo fixture');
    assert.equal(
      resolveExecutable('codex', { Path: directory }, 'win32'),
      realpathSync(join(directory, 'codex.cmd')),
    );
    assert.throws(() => resolveExecutable('missing', { PATH: directory }), /not found/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('context changes count as mutations in both installed-client event formats', () => {
  // A read scenario must fail on profile/preset/scope changes, including a missing action.
  for (const action of [
    'switch_profile',
    'switch_preset',
    'set_scope',
    'reset',
    'unknown',
    undefined,
  ]) {
    assert.equal(isMutationCall({ tool: 'manage_context', arguments: { action } }), true);
    assert.equal(isMutationCall({ name: 'mcp__gitlab__manage_context', input: { action } }), true);
  }
  for (const action of ['show', 'whoami', 'list_profiles', 'list_presets']) {
    assert.equal(
      isMutationCall({ tool: 'manage_context', arguments: JSON.stringify({ action }) }),
      false,
    );
  }
  assert.equal(isMutationCall({ tool: 'manage_work_item', arguments: { action: 'create' } }), true);
  assert.equal(isMutationCall({ tool: 'browse_projects', arguments: { action: 'list' } }), false);
});

test('the GitLab fixture refuses requests for an unrelated project or namespace', async () => {
  // A model choosing the wrong target must not receive the expected project's data.
  const fixture = await startWorkflowGitLab();
  try {
    for (const path of [
      '/api/v4/projects/999/merge_requests/12/changes',
      '/api/v4/projects/wrong/project/pipelines/22/jobs',
    ]) {
      const response = await fetch(fixture.url + path);
      assert.equal(response.status, 404);
    }
    const response = await fetch(fixture.url + '/api/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query:
          'query($namespacePath: ID!) { namespace(fullPath: $namespacePath) { workItems { nodes { title } } } }',
        variables: { namespacePath: 'wrong/project' },
      }),
    });
    assert.equal((await response.json()).data.namespace, null);
  } finally {
    await fixture.close();
  }
});
