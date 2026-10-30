import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEvaluation } from '../../scripts/evaluation-process.mjs';

test('live qualification reports a signalled HTTP core without waiting for an old close event', async () => {
  // Closing the MCP client can finish after the HTTP child, so cleanup must preserve that failure.
  const directory = mkdtempSync(join(tmpdir(), 'gitlab-live-signal-'));
  mkdirSync(join(directory, 'runtime'));
  const evaluation = new URL('../../scripts/evaluation-process.mjs', import.meta.url).href;
  const original = evaluation + '?unmocked';
  const live = new URL('../../scripts/codex-plugin-live.mjs', import.meta.url).href;
  const hook = join(directory, 'hook.mjs');
  const client = `
    export class Client {
      async connect() {}
      async request() { return {structuredContent: {state: 'connected', revision: 1, id: 'fixture-user'}}; }
      async close() { await globalThis.fixtureHttpClosed; }
    }
  `;
  const launcher = `
    import * as original from ${JSON.stringify(original)};
    import { once } from 'node:events';
    export * from ${JSON.stringify(original)};
    export function launch(command, _args, options) {
      const child = original.launch(command, ['-e', "process.kill(process.pid, 'SIGTERM')"], options);
      globalThis.fixtureHttpClosed = once(child, 'close');
      return child;
    }
  `;
  writeFileSync(
    hook,
    `
    import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, next) {
      if (url === ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/client/index.js'))})
        return {format: 'module', shortCircuit: true, source: ${JSON.stringify(client)}};
      if (url === ${JSON.stringify(evaluation)})
        return {format: 'module', shortCircuit: true, source: ${JSON.stringify(launcher)}};
      return next(url, context);
    }});
  `,
  );
  const driver = `
    import { qualifyLiveConnections } from ${JSON.stringify(live)};
    try { await qualifyLiveConnections(${JSON.stringify(directory)}); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  `;
  try {
    const result = await runEvaluation(
      process.execPath,
      ['--import', hook, '--input-type=module', '-e', driver],
      {
        cwd: directory,
        timeoutMs: 2000,
        env: {
          ...process.env,
          TMPDIR: directory,
          TMP: directory,
          TEMP: directory,
          GITLAB_API_URL: 'https://gitlab.example.com/api/v4',
          GITLAB_TOKEN: 'fixture-token',
        },
      },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Live HTTP core stopped before startup/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
