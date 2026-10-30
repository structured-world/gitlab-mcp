import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { launch } from './evaluation-process.mjs';

/** Read-only qualification with integration configuration, never printed. */
export async function qualifyLiveConnections(pluginRoot) {
  const url = process.env.GITLAB_API_URL;
  const token = process.env.GITLAB_TOKEN;
  if (!url || !token)
    throw new Error('Live qualification requires GITLAB_API_URL and GITLAB_TOKEN.');
  const temporary = mkdtempSync(join(tmpdir(), 'gitlab-plugin-live-'));
  const client = new Client({ name: 'gitlab-plugin-live-check', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(pluginRoot, 'runtime/src/plugin/main.js'), join(temporary, 'data')],
    cwd: pluginRoot,
    stderr: 'ignore',
  });
  let http;
  try {
    await client.connect(transport);
    const connect = async (connection, revision) => {
      const result = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'gitlab_plugin_connection',
            arguments: { action: 'connect', revision, connection },
          },
        },
        ResultSchema,
      );
      assert.equal(result.isError, undefined, 'Connection setup returned an error.');
      assert.equal(
        result.structuredContent.state,
        'connected',
        String(result.structuredContent.message),
      );
      return result.structuredContent;
    };
    const local = await connect({ mode: 'local', url, token, initTimeoutMs: 30000 }, 0);
    const first = await client.request(
      { method: 'tools/call', params: { name: 'get_profile', arguments: {} } },
      ResultSchema,
    );
    assert.equal(first.isError, undefined, 'Local GitLab read failed.');
    assert.equal(typeof first.structuredContent.id, 'string');
    const listener = createServer();
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const environment = {
      ...getDefaultEnvironment(),
      HOME: temporary,
      USERPROFILE: temporary,
      GITLAB_API_URL: url,
      GITLAB_TOKEN: token,
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_JSON: 'true',
      LOG_LEVEL: 'debug',
      GITLAB_INIT_TIMEOUT_MS: '30000',
    };
    for (const name of ['SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS'])
      if (process.env[name] !== undefined) environment[name] = process.env[name];
    http = launch(process.execPath, [join(pluginRoot, 'runtime/src/main.js')], {
      cwd: join(pluginRoot, 'runtime'),
      env: environment,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = createInterface({ input: http.stdout });
    const diagnostics = [];
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Live HTTP core did not start within 30 seconds.')),
          30000,
        );
        const stop = () => {
          clearTimeout(timer);
          reject(new Error('Live HTTP core stopped before startup.'));
        };
        http.once('exit', stop);
        http.once('error', stop);
        lines.on('line', (line) => {
          let entry;
          try {
            entry = JSON.parse(line);
          } catch {
            return;
          }
          if (typeof entry.msg === 'string' && entry.msg.startsWith('Profile:')) {
            const status = /status=(\d{3})/.exec(entry.msg);
            const code =
              /ENOTFOUND|ECONNREFUSED|ECONNRESET|CERT_[A-Z_]+|SELF_SIGNED_CERT_IN_CHAIN|UND_ERR_[A-Z_]+/.exec(
                entry.msg,
              );
            let message = 'GitLab profile could not be read';
            if (status) message = `GitLab HTTP ${status[1]}`;
            else if (code) message = code[0];
            diagnostics.push(message);
          }
          if (entry.msg !== 'GitLab MCP Server running') return;
          clearTimeout(timer);
          http.off('exit', stop);
          http.off('error', stop);
          resolve();
        });
      });
      const remote = await connect(
        { mode: 'remote', url: `http://127.0.0.1:${port}/mcp`, authentication: 'none' },
        local.revision,
      ).catch((error) => {
        throw new Error(`${error.message} ${diagnostics.join('; ')}`);
      });
      const second = await client.request(
        { method: 'tools/call', params: { name: 'get_profile', arguments: {} } },
        ResultSchema,
      );
      assert.equal(second.isError, undefined, 'Remote GitLab read failed.');
      assert.equal(
        second.structuredContent.id,
        first.structuredContent.id,
        'Connection changed the GitLab account.',
      );
      await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'gitlab_plugin_connection',
            arguments: { action: 'disconnect', revision: remote.revision },
          },
        },
        ResultSchema,
      );
      return { local: 'verified', http: 'verified', sameAccount: true };
    } finally {
      lines.close();
    }
  } finally {
    await client.close();
    if (http?.exitCode === null && http.signalCode === null) {
      const closed = once(http, 'close');
      http.kill('SIGTERM');
      const timer = setTimeout(() => http.kill('SIGKILL'), 5000);
      await closed;
      clearTimeout(timer);
    }
    rmSync(temporary, { recursive: true, force: true });
  }
}
