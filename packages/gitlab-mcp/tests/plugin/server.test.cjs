const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { runtimeRequire } = require('./runtime.cjs');
const { Client } = runtimeRequire('@modelcontextprotocol/sdk/client/index.js');
const { Server } = runtimeRequire('@modelcontextprotocol/sdk/server/index.js');
const { InMemoryTransport } = runtimeRequire('@modelcontextprotocol/sdk/inMemory.js');
const { ResultSchema, McpError, ErrorCode } = runtimeRequire('@modelcontextprotocol/sdk/types.js');
const { Connections } = runtimeRequire('./connections.js');
const { ConnectionStore } = runtimeRequire('./connection-store.js');
const { createPluginServer } = runtimeRequire('./server.js');

test('the bridge preserves pagination, settings, resources, prompts and protocol errors', async () => {
  // Exercise the public protocol on both sides, including an empty opaque cursor and private setup actions.
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-bridge-'));
  const connections = new Connections(new ConnectionStore(dir));
  const plugin = createPluginServer(connections);
  const frontend = new Client(
    { name: 'bridge-contract', version: '1' },
    { capabilities: { sampling: {} } },
  );
  const [front, pluginTransport] = InMemoryTransport.createLinkedPair();
  const backend = new Server(
    { name: 'backend-fixture', version: '1' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
    },
  );
  const backendClient = new Client(
    { name: 'backend-client', version: '1' },
    { capabilities: { sampling: {} } },
  );
  const [bridgeTransport, backendTransport] = InMemoryTransport.createLinkedPair();
  let reserved = false;
  let settingsError = false;
  const settings = {
    schema: { type: 'object', properties: {} },
    values: { theme: 'dark' },
    layout: [],
  };
  const failure = { content: [{ type: 'text', text: 'settings unavailable' }], isError: true };
  backend.fallbackRequestHandler = async (request, extra) => {
    if (request.method === 'tools/list')
      return {
        tools: [
          {
            name: reserved ? 'gitlab_plugin_reserved' : 'get_profile',
            inputSchema: { type: 'object' },
          },
        ],
        nextCursor: 'next-tools',
        _meta: { fixture: 'tools' },
      };
    if (request.method === 'resources/list')
      return {
        resources: [{ uri: 'fixture://document', name: 'Fixture' }],
        nextCursor: 'next-resources',
      };
    if (request.method === 'resources/read')
      return {
        contents: [{ uri: request.params.uri, text: 'fixture content', mimeType: 'text/plain' }],
      };
    if (request.method === 'prompts/list') return { prompts: [{ name: 'fixture-prompt' }] };
    if (request.method === 'prompts/get')
      return { messages: [{ role: 'user', content: { type: 'text', text: 'fixture prompt' } }] };
    if (request.params.name === 'get_settings') {
      if (settingsError === 'rpc') throw new McpError(ErrorCode.InternalError, 'Fixture outage.');
      return settingsError ? failure : { content: [], structuredContent: settings };
    }
    if (request.params.name === 'update_settings')
      return { content: [], structuredContent: request.params.arguments };
    if (request.params.name === 'rpc_error')
      throw new McpError(ErrorCode.InvalidParams, 'Fixture validation.', { fixture: true });
    if (request.params.name === 'progress')
      await extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken: request.params._meta.progressToken, progress: 1, total: 1 },
      });
    return { content: [] };
  };
  const call = (name, args = {}) =>
    frontend.request({ method: 'tools/call', params: { name, arguments: args } }, ResultSchema);
  try {
    await plugin.connect(pluginTransport);
    await frontend.connect(front);
    assert.equal(
      (await call('gitlab_plugin_open_connection'))._meta.ui.resourceUri,
      'ui://gitlab-mcp-local/connection.html',
    );
    assert.equal(
      (await call('gitlab_plugin_get_settings')).structuredContent.layout[0].title,
      'Connection',
    );
    assert.equal((await frontend.listResources()).resources.length, 1);
    assert.deepEqual((await frontend.listPrompts()).prompts, []);
    await frontend.request({ method: 'logging/setLevel', params: { level: 'info' } }, ResultSchema);
    await assert.rejects(call('gitlab_plugin_update_settings', { set: {} }), /Connect GitLab/);
    await assert.rejects(
      call('gitlab_plugin_connection', { action: 'reconnect', revision: 0 }),
      /Configure a connection/,
    );
    await assert.rejects(
      call('gitlab_plugin_connection', { action: 'status', revision: -1 }),
      /Invalid connection revision/,
    );
    await assert.rejects(
      call('gitlab_plugin_connection', { action: 'unknown', revision: 0 }),
      /Unknown connection action/,
    );
    await assert.rejects(call('unknown_backend_tool'), /Open GitLab connection settings/);
    const snapshot = connections.store.commit(0, {
      mode: 'remote',
      url: 'http://127.0.0.1:1/mcp',
      authentication: 'none',
    });
    const selected = { client: backendClient, transport: bridgeTransport, snapshot };
    connections.active = selected;
    connections.wire(selected);
    await backend.connect(backendTransport);
    await backendClient.connect(bridgeTransport);
    // Backward requests and notifications must cross the bridge only for the active backend.
    const sampled = {
      role: 'assistant',
      content: { type: 'text', text: 'fixture' },
      model: 'fixture',
    };
    frontend.fallbackRequestHandler = async () => sampled;
    const sampling = { method: 'sampling/createMessage', params: { messages: [], maxTokens: 1 } };
    assert.deepEqual(await backend.request(sampling, ResultSchema), sampled);
    const toHost = Promise.withResolvers();
    frontend.fallbackNotificationHandler = async (message) => toHost.resolve(message);
    await backend.notification({
      method: 'notifications/fixture',
      params: { direction: 'host' },
    });
    assert.equal((await toHost.promise).params.direction, 'host');
    const toBackend = Promise.withResolvers();
    backend.fallbackNotificationHandler = async (message) => toBackend.resolve(message);
    await frontend.notification({
      method: 'notifications/fixture',
      params: { direction: 'backend' },
    });
    assert.equal((await toBackend.promise).params.direction, 'backend');
    connections.active = undefined;
    await assert.rejects(backend.request(sampling, ResultSchema), /no longer active/);
    connections.active = selected;
    // A transport failure must not disclose its body, and late results must not regain authority.
    const request = backendClient.request;
    try {
      backendClient.request = async () => {
        throw new Error('synthetic-transport-secret');
      };
      await assert.rejects(
        call('fixture'),
        (error) =>
          error.code === ErrorCode.InternalError &&
          error.message.includes('outcome may be unknown') &&
          !error.message.includes('synthetic-transport-secret'),
      );
      backendClient.request = async () => {
        connections.active = undefined;
        return { content: [] };
      };
      await assert.rejects(call('fixture'), /Connection changed while this request was running/);
    } finally {
      backendClient.request = request;
      connections.active = selected;
    }
    const first = await frontend.listTools();
    assert(first.tools.some((tool) => tool.name === 'gitlab_plugin_connection'));
    assert.equal(first.nextCursor, 'next-tools');
    const page = await frontend.listTools({ cursor: '' });
    assert.deepEqual(
      page.tools.map((tool) => tool.name),
      ['get_profile'],
    );
    assert.deepEqual(page._meta, { fixture: 'tools' });
    assert.equal((await frontend.listResources()).resources.length, 2);
    assert.deepEqual(
      (await frontend.listResources({ cursor: '' })).resources.map((resource) => resource.uri),
      ['fixture://document'],
    );
    assert.equal(
      (await frontend.readResource({ uri: 'fixture://document' })).contents[0].text,
      'fixture content',
    );
    assert.equal((await frontend.listPrompts()).prompts[0].name, 'fixture-prompt');
    assert.equal(
      (await frontend.getPrompt({ name: 'fixture-prompt' })).messages[0].content.text,
      'fixture prompt',
    );
    await frontend.request({ method: 'logging/setLevel', params: { level: 'info' } }, ResultSchema);
    assert.deepEqual(
      (await call('gitlab_plugin_get_settings')).structuredContent.values,
      settings.values,
    );
    const patch = { set: { theme: 'light' } };
    assert.deepEqual((await call('gitlab_plugin_update_settings', patch)).structuredContent, patch);
    // Account-setting failures must not remove the local route to reconnect or change targets.
    for (const failureMode of [true, 'rpc']) {
      settingsError = failureMode;
      const unavailable = await call('gitlab_plugin_get_settings');
      assert.notEqual(unavailable.isError, true);
      assert.equal(unavailable.structuredContent?.layout[0].title, 'Connection');
      assert.match(unavailable.structuredContent.layout[0].items[0].description, /unavailable/);
      assert.deepEqual(unavailable.structuredContent.values, {});
    }
    settingsError = false;
    await assert.rejects(
      call('rpc_error'),
      (error) => error.code === ErrorCode.InvalidParams && error.data.fixture,
    );
    const progress = [];
    await frontend.request(
      { method: 'tools/call', params: { name: 'progress', arguments: {} } },
      ResultSchema,
      { onprogress: (value) => progress.push(value) },
    );
    assert.equal(progress[0].progress, 1);
    reserved = true;
    await assert.rejects(frontend.listTools(), /reserved plugin tool names/);
    reserved = false;
    assert.equal(
      (await call('gitlab_plugin_connection', { action: 'status', revision: snapshot.revision }))
        .structuredContent.revision,
      snapshot.revision,
    );
    await call('gitlab_plugin_connection', { action: 'cancel', revision: snapshot.revision });
    assert.equal(
      (
        await call('gitlab_plugin_connection', {
          action: 'reconnect',
          revision: snapshot.revision,
        })
      ).structuredContent.state,
      'failed',
    );
    assert.equal(
      (
        await call('gitlab_plugin_connection', {
          action: 'connect',
          revision: snapshot.revision,
          connection: { mode: 'remote', url: 'http://127.0.0.1:1/mcp', authentication: 'none' },
        })
      ).structuredContent.state,
      'failed',
    );
    await call('gitlab_plugin_connection', { action: 'disconnect', revision: snapshot.revision });
    assert.equal(connections.store.read().connection, null);
  } finally {
    await frontend.close();
    await plugin.close();
    await connections.close();
    await backendClient.close();
    await backend.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
