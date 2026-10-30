const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { runtimeRequire, runtimePath } = require('./runtime.cjs');
const { Client } = runtimeRequire('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = runtimeRequire('@modelcontextprotocol/sdk/client/stdio.js');
const { ResultSchema } = runtimeRequire('@modelcontextprotocol/sdk/types.js');

for (const entry of ['main', 'core']) {
  test(
    `the compiled ${entry} entry serves MCP and closes cleanly`,
    { timeout: 15000 },
    async () => {
      // Run the repository entry as well as the separately qualified installed copy, retaining source coverage.
      const { startWorkflowGitLab } = await import('../manual/fixtures/workflow-gitlab.mjs');
      const gitlab = await startWorkflowGitLab();
      const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-entry-'));
      const env = { GITLAB_API_URL: gitlab.url, GITLAB_TOKEN: 'fixture-token', LOG_JSON: 'true' };
      if (process.env.NODE_V8_COVERAGE) env.NODE_V8_COVERAGE = process.env.NODE_V8_COVERAGE;
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          '--enable-source-maps',
          join(runtimePath, `${entry}.js`),
          entry === 'main' ? dir : 'stdio',
        ],
        env,
        stderr: 'pipe',
      });
      let diagnostics = '';
      transport.stderr?.on('data', (chunk) => {
        diagnostics += chunk;
      });
      const client = new Client({ name: 'entry-contract', version: '1' });
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        const name = entry === 'main' ? 'gitlab_plugin_get_settings' : 'get_profile';
        assert(
          tools.tools.some((tool) => tool.name === name),
          diagnostics,
        );
        const response = await client.request(
          { method: 'tools/call', params: { name, arguments: {} } },
          ResultSchema,
        );
        assert.notEqual(response.isError, true, diagnostics);
        assert(response.structuredContent);
        if (entry === 'main') {
          // Host termination must shut down the connector as reliably as closing stdin.
          const closed = new Promise((resolve) => {
            client.onclose = resolve;
          });
          process.kill(transport.pid, 'SIGTERM');
          await closed;
          assert.equal(transport.pid, null);
        }
      } finally {
        await client.close();
        await gitlab.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}

test('the connector rejects an unexpanded host data placeholder', { timeout: 5000 }, async (t) => {
  // A broken launcher must fail before creating a directory or exposing an unusable setup panel.
  const child = spawn(
    process.execPath,
    [
      // Assert the application diagnostic independently of Node's SQLite experiment notice.
      '--disable-warning=ExperimentalWarning',
      '--enable-source-maps',
      join(runtimePath, 'main.js'),
      '${PLUGIN_DATA}',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let diagnostics = '';
  child.stderr.on('data', (chunk) => {
    diagnostics += chunk;
  });
  const [code] = await once(child, 'exit', { signal: t.signal });
  assert.equal(code, 1);
  assert.equal(
    diagnostics,
    'GitLab plugin could not start. Check Node.js 24+ and the plugin data directory.\n',
  );
});
