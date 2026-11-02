const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setImmediate } = require('node:timers');
const { runtimeRequire } = require('./runtime.cjs');
const { Client } = runtimeRequire('@modelcontextprotocol/sdk/client/index.js');
const { Server } = runtimeRequire('@modelcontextprotocol/sdk/server/index.js');
const { InMemoryTransport } = runtimeRequire('@modelcontextprotocol/sdk/inMemory.js');
const { ErrorCode, McpError, ResourceListChangedNotificationSchema, ResultSchema } = runtimeRequire(
  '@modelcontextprotocol/sdk/types.js',
);
const { Connections } = runtimeRequire('./connections.js');
const { ConnectionStore } = runtimeRequire('./connection-store.js');
const { createPluginServer } = runtimeRequire('./server.js');
const { CONNECTION_PANEL_URI, CONNECTION_PANEL_META } = runtimeRequire('./panel.js');

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-resources-'));
  const connections = new Connections(new ConnectionStore(dir));
  const plugin = createPluginServer(connections);
  const frontend = new Client({ name: 'resource-host', version: '1' });
  const [front, transport] = InMemoryTransport.createLinkedPair();
  const backends = [];
  t.after(async () => {
    await frontend.close();
    await plugin.close();
    await connections.close();
    await Promise.all(
      backends.map(async (backend) => {
        await backend.client.close();
        await backend.server.close();
      }),
    );
    rmSync(dir, { recursive: true, force: true });
  });
  await plugin.connect(transport);
  await frontend.connect(front);
  return {
    frontend,
    connections,
    async select(handler, capabilities = { resources: { listChanged: true } }) {
      const server = new Server({ name: 'resource-backend', version: '1' }, { capabilities });
      const client = new Client({ name: 'resource-bridge', version: '1' });
      const [bridge, provider] = InMemoryTransport.createLinkedPair();
      server.fallbackRequestHandler = handler;
      const snapshot = connections.store.commit(connections.store.revision(), {
        mode: 'remote',
        url: 'http://127.0.0.1:1/mcp',
        authentication: 'none',
      });
      const selected = { server, client, transport: bridge, snapshot };
      backends.push(selected);
      connections.active = selected;
      connections.wire(selected);
      await server.connect(provider);
      await client.connect(bridge);
      connections.changed();
      return selected;
    },
  };
}

// The local immutable panel has no resource subscription implementation.
test('resource capabilities match the unconfigured plugin', async (t) => {
  const { frontend } = await fixture(t);
  assert.deepEqual(frontend.getServerCapabilities().resources, { listChanged: true });
  const listing = await frontend.listResources();
  assert.deepEqual(
    listing.resources.map((resource) => resource.uri),
    [CONNECTION_PANEL_URI],
  );
  const panel = await frontend.readResource({ uri: CONNECTION_PANEL_URI });
  assert.equal(panel.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(panel.contents[0]._meta, CONNECTION_PANEL_META);
  assert.match(panel.contents[0].text, /Your GitLab connection/);
});

// Backend initialization failures must not be consulted for a locally owned URI.
test('local reads and missing-resource errors do not initialize a backend', async (t) => {
  const { frontend, connections } = await fixture(t);
  t.mock.method(connections, 'ready', async () => {
    throw new Error('Backend must not be consulted');
  });
  assert.equal((await frontend.readResource({ uri: CONNECTION_PANEL_URI })).contents.length, 1);
  const uri = 'ui://gitlab-mcp-local/missing.html';
  await assert.rejects(frontend.readResource({ uri }), (error) => {
    assert.equal(error.code, -32002);
    assert.deepEqual(error.data, { uri });
    return true;
  });
});

// A resource capability remains useful without a connected provider or resource templates.
test('unconfigured template discovery is an empty list', async (t) => {
  const { frontend } = await fixture(t);
  assert.deepEqual(await frontend.listResourceTemplates(), { resourceTemplates: [] });
});

// Missing provider resources are distinct from malformed resource-read parameters.
test('unconfigured reads distinguish missing resources from invalid parameters', async (t) => {
  const { frontend } = await fixture(t);
  await assert.rejects(
    frontend.readResource({ uri: 'fixture://missing' }),
    (error) => error.code === -32002,
  );
  await assert.rejects(
    frontend.request(
      {
        method: 'resources/read',
        params: { uri: 42 },
      },
      ResultSchema,
    ),
    (error) => error.code === ErrorCode.InvalidParams,
  );
});

// Invalid pagination must fail before it can start a saved backend connection.
test('invalid resource cursors do not initialize a backend', async (t) => {
  const { frontend, connections } = await fixture(t);
  const ready = t.mock.method(connections, 'ready', async () => {
    throw new Error('Backend must not be consulted');
  });
  await Promise.all(
    ['listResources', 'listResourceTemplates'].map((method) =>
      assert.rejects(
        frontend[method]({ cursor: 42 }),
        (error) => error.code === ErrorCode.InvalidParams,
      ),
    ),
  );
  assert.equal(ready.mock.callCount(), 0);
});

// A raw request cannot opt back into an unsupported subscription through a backend.
test('subscriptions remain unsupported with a subscription-capable backend', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  await f.select(
    async () => {
      calls++;
      return {};
    },
    { resources: { subscribe: true } },
  );
  assert.equal(f.frontend.getServerCapabilities().resources.subscribe, undefined);
  await Promise.all(
    ['subscribeResource', 'unsubscribeResource'].map((method) =>
      assert.rejects(
        f.frontend[method]({ uri: CONNECTION_PANEL_URI }),
        (error) => error.code === ErrorCode.MethodNotFound,
      ),
    ),
  );
  assert.equal(calls, 0);
});

// Empty opaque cursors are real continuation pages, and metadata belongs to the provider.
test('resource pages preserve metadata and include the local panel only once', async (t) => {
  const f = await fixture(t);
  const resource = {
    uri: 'fixture://document',
    name: 'Document',
    title: 'Title',
    mimeType: 'text/plain',
    annotations: { audience: ['user'], priority: 0.8 },
    _meta: { fixture: { private: true } },
  };
  const seen = [];
  await f.select(async (request) => {
    seen.push(request.params?.cursor);
    return request.params?.cursor === undefined
      ? { resources: [], nextCursor: '', _meta: { page: 'first' } }
      : { resources: [resource], _meta: { page: 'last' } };
  });
  const first = await f.frontend.listResources();
  assert.deepEqual(
    first.resources.map((r) => r.uri),
    [CONNECTION_PANEL_URI],
  );
  assert.equal(first.nextCursor, '');
  assert.deepEqual(first._meta, { page: 'first' });
  assert.deepEqual(await f.frontend.listResources({ cursor: first.nextCursor }), {
    resources: [resource],
    _meta: { page: 'last' },
  });
  assert.deepEqual(seen, [undefined, '']);
});

// Protocol extension data must survive the bridge, not just the standard resource fields.
test('raw resource responses retain provider extension metadata', async (t) => {
  const f = await fixture(t);
  const resource = {
    uri: 'ui://gitlab-mcp/settings.html',
    name: 'Backend settings',
    vendorExtension: { nested: ['fixture'] },
    _meta: { ui: { prefersBorder: true } },
  };
  await f.select(async () => ({ resources: [resource], vendorCatalog: { revision: 'fixture' } }));
  const page = await f.frontend.request({ method: 'resources/list' }, ResultSchema);
  assert.deepEqual(page.resources[1], resource);
  assert.deepEqual(page.vendorCatalog, { revision: 'fixture' });
});

// A provider cannot publish an identifier owned by the plugin on any listing page.
for (const cursor of [undefined, '']) {
  test(`reserved resource collisions are rejected for cursor ${JSON.stringify(cursor)}`, async (t) => {
    const f = await fixture(t);
    await f.select(async () => ({ resources: [{ uri: CONNECTION_PANEL_URI, name: 'Collision' }] }));
    await assert.rejects(
      f.frontend.listResources({ cursor }),
      (error) => error.code === ErrorCode.InvalidRequest,
    );
  });
}

// The plugin owns its UI authority, including local names not present in its catalog.
test('backend resources cannot occupy the local UI namespace', async (t) => {
  const f = await fixture(t);
  await f.select(async () => ({
    resources: [{ uri: 'ui://gitlab-mcp-local/other.html', name: 'Shadowed' }],
  }));
  await assert.rejects(
    f.frontend.listResources(),
    (error) => error.code === ErrorCode.InvalidRequest,
  );
});

// Providers without resources do not receive discovery methods they cannot implement.
test('a backend without resource capabilities leaves the local catalog available', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  await f.select(async () => {
    calls++;
    return {};
  }, {});
  assert.deepEqual(await f.frontend.listResourceTemplates(), { resourceTemplates: [] });
  assert.deepEqual(
    (await f.frontend.listResources()).resources.map((r) => r.uri),
    [CONNECTION_PANEL_URI],
  );
  await assert.rejects(
    f.frontend.readResource({ uri: 'fixture://missing' }),
    (error) => error.code === -32002,
  );
  assert.equal(calls, 0);
});

// Static-resource servers can omit the optional template method entirely.
test('an unsupported backend template method produces an empty template catalog', async (t) => {
  const f = await fixture(t);
  await f.select(async () => {
    throw new McpError(ErrorCode.MethodNotFound, 'No templates');
  });
  assert.deepEqual(await f.frontend.listResourceTemplates(), { resourceTemplates: [] });
});

// Template pagination and annotations cross the same selected connection as resource reads.
test('backend templates and binary resource contents pass through unchanged', async (t) => {
  const f = await fixture(t);
  const template = {
    uriTemplate: 'fixture://document/{id}',
    name: 'Document',
    annotations: { priority: 0.5 },
    _meta: { owner: 'fixture' },
  };
  const contents = [
    { uri: 'fixture://document/1', mimeType: 'application/octet-stream', blob: 'AAEC' },
  ];
  await f.select(async (request) =>
    request.method === 'resources/templates/list'
      ? {
          resourceTemplates: [template],
          ...(request.params?.cursor === undefined ? { nextCursor: '' } : {}),
          _meta: { cursor: request.params?.cursor ?? 'initial' },
        }
      : { contents, _meta: { fixture: 'read' } },
  );
  const first = await f.frontend.listResourceTemplates();
  assert.deepEqual(first.resourceTemplates, [template]);
  assert.equal(first.nextCursor, '');
  const next = await f.frontend.listResourceTemplates({ cursor: first.nextCursor });
  assert.deepEqual(next, { resourceTemplates: [template], _meta: { cursor: '' } });
  assert.deepEqual(await f.frontend.readResource({ uri: contents[0].uri }), {
    contents,
    _meta: { fixture: 'read' },
  });
});

// Not-found and permission errors must keep their JSON-RPC code and structured data.
for (const method of ['listResources', 'listResourceTemplates', 'readResource']) {
  test(`${method} preserves backend errors`, async (t) => {
    const f = await fixture(t);
    const code = method === 'readResource' ? -32002 : -32003;
    const data = { fixture: 'permission', detail: { required: 'read' } };
    await f.select(async () => {
      throw new McpError(code, 'Fixture denial', data);
    });
    await assert.rejects(f.frontend[method]({ uri: 'fixture://private' }), (error) => {
      assert.equal(error.code, code);
      assert.deepEqual(error.data, data);
      assert.match(error.message, /Fixture denial/);
      return true;
    });
  });
}

// Changed catalogs must be observable, while obsolete providers cannot notify the current host.
test('catalogs and notifications follow connection changes and reconnection', async (t) => {
  const f = await fixture(t);
  let notifications = 0;
  f.frontend.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
    notifications++;
  });
  const select = (uri) => f.select(async () => ({ resources: [{ uri, name: uri }] }));
  const first = await select('fixture://first');
  const second = await select('fixture://second');
  assert.equal((await f.frontend.listResources()).resources[1].uri, 'fixture://second');
  const before = notifications;
  await first.server.notification({ method: 'notifications/resources/list_changed' });
  await new Promise(setImmediate);
  assert.equal(notifications, before);
  await second.server.notification({ method: 'notifications/resources/list_changed' });
  await new Promise(setImmediate);
  assert.equal(notifications, before + 1);
  await f.connections.disconnect(f.connections.store.revision());
  assert.deepEqual(
    (await f.frontend.listResources()).resources.map((r) => r.uri),
    [CONNECTION_PANEL_URI],
  );
  await select('fixture://first');
  assert.equal((await f.frontend.listResources()).resources[1].uri, 'fixture://first');
  assert(notifications >= before + 3);
});

// A result from an old connection cannot become a page in the newly selected catalog.
test('an in-flight listing is rejected after switching backends', async (t) => {
  const f = await fixture(t);
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  await f.select(async () => {
    started.resolve();
    return finish.promise;
  });
  const pending = assert.rejects(
    f.frontend.listResources(),
    (error) => error.code === ErrorCode.InvalidRequest,
  );
  await started.promise;
  await f.select(async () => ({ resources: [] }));
  finish.resolve({ resources: [{ uri: 'fixture://old', name: 'Old' }] });
  await pending;
});

// An obsolete unsupported-method response cannot become a successful empty current catalog.
test('template fallback rejects an obsolete backend result', async (t) => {
  const f = await fixture(t);
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  await f.select(async () => {
    started.resolve();
    return finish.promise;
  });
  const pending = assert.rejects(
    f.frontend.listResourceTemplates(),
    (error) => error.code === ErrorCode.InvalidRequest,
  );
  await started.promise;
  await f.select(async () => ({ resourceTemplates: [] }));
  finish.reject(new McpError(ErrorCode.MethodNotFound, 'No old templates'));
  await pending;
});
