const { test } = require('node:test');
const process = require('node:process');
const { setTimeout, clearTimeout } = require('node:timers');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { runtimeRequire, runtimePath } = require('./runtime.cjs');
const { ConnectionStore } = runtimeRequire('./connection-store.js');

test('closing the host input terminates the installed connector', { timeout: 8000 }, async () => {
  // SDK stdio transport has no EOF handler; a live watcher must not keep an uninstalled plugin running.
  const data = mkdtempSync(join(tmpdir(), 'gitlab-plugin-eof-'));
  const child = spawn(
    process.execPath,
    [join(process.env.PLUGIN_CONTRACT_ROOT, 'runtime/src/plugin/main.js'), data],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const lines = createInterface({ input: child.stdout });
  const initialized = once(lines, 'line');
  const exited = once(child, 'exit');
  let timer;
  try {
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'lifecycle-check', version: '1' },
        },
      }) + '\n',
    );
    const [response] = await initialized;
    assert(JSON.parse(response).result);
    child.stdin.end();
    const [code] = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Connector survived host EOF.')), 3000);
      }),
    ]);
    assert.equal(code, 0);
  } finally {
    clearTimeout(timer);
    lines.close();
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    rmSync(data, { recursive: true, force: true });
  }
});

test('host EOF cancels a selected backend still initializing', { timeout: 8000 }, async () => {
  // Closing Codex must cancel an in-flight restore rather than wait for a remote initialization timeout.
  const data = mkdtempSync(join(tmpdir(), 'gitlab-plugin-opening-'));
  let began;
  const initializing = new Promise((resolve) => {
    began = resolve;
  });
  const backend = createServer(async (request, response) => {
    if (request.method !== 'POST') return response.writeHead(405).end();
    let body = '';
    for await (const chunk of request) body += chunk;
    if (JSON.parse(body).method === 'initialize') began();
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const store = new ConnectionStore(data);
  store.commit(0, {
    mode: 'remote',
    url: `http://127.0.0.1:${backend.address().port}/mcp`,
    authentication: 'none',
  });
  store.close();
  const child = spawn(
    process.execPath,
      ['--enable-source-maps', join(runtimePath, 'main.js'), data],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  const lines = createInterface({ input: child.stdout });
  const initialized = once(lines, 'line');
  const exited = once(child, 'exit');
  let timer;
  try {
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'opening-contract', version: '1' },
        },
      }) + '\n',
    );
    assert(JSON.parse((await initialized)[0]).result);
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    );
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    await initializing;
    child.stdin.end();
    const [code] = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Connector waited for its unfinished backend.')),
          1500,
        );
      }),
    ]);
    assert.equal(code, 0);
  } finally {
    clearTimeout(timer);
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
    rmSync(data, { recursive: true, force: true });
  }
});
