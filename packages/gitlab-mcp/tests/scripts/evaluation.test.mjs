import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import {
  launch,
  launchSync,
  resolveExecutable,
  isMutationCall,
  runEvaluation,
} from '../../scripts/evaluation-process.mjs';
import { startWorkflowGitLab } from '../manual/fixtures/workflow-gitlab.mjs';

test('evaluation preserves completed results and rejects launch failures', async () => {
  // Moving process ownership must retain transcript/exit codes and release the timeout on spawn errors.
  for (const code of [0, 7]) {
    const result = await runEvaluation(
      process.execPath,
      ['-e', `process.stdout.write('out'); process.stderr.write('err'); process.exitCode=${code};`],
      { cwd: process.cwd(), timeoutMs: 3000 },
    );
    assert.deepEqual(result, { code, stdout: 'out', stderr: 'err' });
  }
  await assert.rejects(
    runEvaluation(join(tmpdir(), 'missing-evaluation-command'), [], {
      cwd: process.cwd(),
      timeoutMs: 3000,
    }),
    /ENOENT/,
  );
});

test('timeout stops the client tree before rejecting the evaluation', async (context) => {
  // Both client and MCP descendant ignore graceful termination and share output pipes.
  const directory = mkdtempSync(join(tmpdir(), 'gitlab-eval-timeout-'));
  const heartbeat = join(directory, 'heartbeat');
  const pids = join(directory, 'pids');
  const descendant = `require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, 'ready');
    process.on('SIGTERM', () => {});
    setInterval(() => require('node:fs').appendFileSync(${JSON.stringify(heartbeat)}, '.'), 20);`;
  const parent = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'inherit'});
    require('node:fs').writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, child.pid]));
    process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
  context.after(() => {
    if (existsSync(pids))
      for (const pid of JSON.parse(readFileSync(pids, 'utf8'))) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
    rmSync(directory, { recursive: true, force: true });
  });
  await assert.rejects(
    runEvaluation(process.execPath, ['-e', parent], { cwd: directory, timeoutMs: 500 }),
    /timed out/,
  );
  const stopped = readFileSync(heartbeat, 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    readFileSync(heartbeat, 'utf8'),
    stopped,
    'descendant still runs after timeout rejection',
  );
});

test('evaluator setup failure closes the loopback server and exits', () => {
  // A failed version check must release the fixture instead of keeping Node alive.
  const directory = mkdtempSync(join(tmpdir(), 'gitlab-eval-setup-'));
  try {
    const shim = process.platform === 'win32' ? 'codex.cmd' : 'codex';
    const body =
      process.platform === 'win32' ? '@echo off\r\nexit /b 7\r\n' : '#!/bin/sh\nexit 7\n';
    writeFileSync(join(directory, shim), body, { mode: 0o755 });
    // Catch the setup exception so process exit cannot mask a leaked listening socket.
    const script = resolve('scripts/evaluate-skills.mjs');
    const entry = `process.argv = [process.execPath, ${JSON.stringify(script)}, 'codex'];
      try { await import(process.argv[1]); }
      catch (error) { console.error(error); process.exitCode = 1; }`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', entry], {
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
        ),
        PATH:
          directory +
          delimiter +
          Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')[1],
      },
      encoding: 'utf8',
      timeout: 3000,
    });
    assert.equal(result.error, undefined, result.stdout + result.stderr);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exited with 7/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the evaluator rejects an executable supplied as a positional argument', () => {
  // An agent-facing invocation selects a known client, never arbitrary executable code.
  const directory = mkdtempSync(join(tmpdir(), 'gitlab-eval-command-'));
  try {
    const marker = join(directory, 'executed');
    const executable = join(
      directory,
      process.platform === 'win32' ? 'unexpected.cmd' : 'unexpected',
    );
    const body =
      process.platform === 'win32'
        ? `@echo off\r\ntype nul > "${marker}"\r\necho fixture\r\n`
        : `#!/bin/sh\ntouch '${marker}'\necho fixture\n`;
    writeFileSync(executable, body, { mode: 0o755 });
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
