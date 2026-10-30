const { test } = require('node:test');
const { AbortController, AbortSignal, DOMException } = globalThis;
const process = require('node:process');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { runtimeRequire } = require('./runtime.cjs');
const { Client } = runtimeRequire('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = runtimeRequire('@modelcontextprotocol/sdk/inMemory.js');
const { StdioClientTransport } = runtimeRequire('@modelcontextprotocol/sdk/client/stdio.js');
const { ResultSchema } = runtimeRequire('@modelcontextprotocol/sdk/types.js');
const { Server } = runtimeRequire('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = runtimeRequire(
  '@modelcontextprotocol/sdk/server/streamableHttp.js',
);
const { createServer } = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { ConnectionStore } = runtimeRequire('./connection-store.js');
const { Connections } = runtimeRequire('./connections.js');
const { createPluginServer } = runtimeRequire('./server.js');

test(
  'cancelling a replacement preserves the saved connection failure',
  { timeout: 5000 },
  async () => {
    // Cancelling proposed setup must not disguise an existing failed target as unconfigured.
    const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-cancel-failure-'));
    const store = new ConnectionStore(dir);
    const target = { mode: 'remote', url: 'https://fixture.invalid/mcp', authentication: 'none' };
    const saved = store.commit(0, target);
    const connections = new Connections(store);
    connections.watcher.close();
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let pending;
    try {
      connections.make = async () => {
        throw new Error('ECONNREFUSED');
      };
      await connections.ready();
      const failure = connections.status().message;
      assert.equal(connections.status().state, 'failed');
      connections.make = async (snapshot) => ({ snapshot, client: { close: async () => {} } });
      connections.qualify = async () => {
        entered.resolve();
        await release.promise;
      };
      pending = connections.connect(target, saved.revision);
      await Promise.race([
        entered.promise,
        pending.then(() => assert.fail('Connection ended before reaching the test boundary.')),
      ]);
      assert.equal(connections.status().message, null);
      await connections.cancel();
      assert.equal(connections.status().state, 'failed');
      assert.equal(connections.status().message, failure);
      assert.equal(connections.status().url, target.url);
    } finally {
      release.resolve();
      try {
        await pending;
      } finally {
        await connections.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
  },
);

test('one SDK deadline bounds paginated connection qualification', async (t) => {
  // Individually successful pages must not let a broken endpoint keep setup running forever.
  const { DEFAULT_REQUEST_TIMEOUT_MSEC } = runtimeRequire(
    '@modelcontextprotocol/sdk/shared/protocol.js',
  );
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-deadline-'));
  const connections = new Connections(new ConnectionStore(dir));
  const controller = new AbortController();
  let timeout;
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    timeout = milliseconds;
    return controller.signal;
  });
  let pages = 0;
  const backend = {
    client: {
      connect: async (_transport, options) => {
        assert.equal(options?.signal, controller.signal);
      },
      listTools: async (_params, options) => {
        assert.equal(options?.signal, controller.signal);
        if (++pages === 2) controller.abort(new DOMException('Setup timed out.', 'TimeoutError'));
        options.signal.throwIfAborted();
        return { tools: [], nextCursor: '' };
      },
    },
  };
  try {
    await assert.rejects(connections.qualify(backend), { name: 'TimeoutError' });
    assert.equal(timeout, DEFAULT_REQUEST_TIMEOUT_MSEC);
    assert.equal(pages, 2);
  } finally {
    await connections.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the local core inherits routing and CA settings but not another server policy', async () => {
  // The child must use the desktop network without inheriting unrelated GitLab restrictions.
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-network-'));
  const connections = new Connections(new ConnectionStore(dir));
  const network = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'GITLAB_CA_CERT_PATH',
  ];
  const names = [...network, 'GITLAB_ALLOWED_PROJECT_IDS'];
  const before = names.map((name) => process.env[name]);
  try {
    for (const name of names) process.env[name] = `synthetic-${name}`;
    const backend = await connections.make(
      {
        revision: 0,
        connection: {
          mode: 'local',
          url: 'https://gitlab.example',
          token: 'synthetic-token',
        },
      },
      true,
    );
    const inherited = backend.transport._serverParams.env;
    for (const name of network) assert.equal(inherited[name], process.env[name]);
    assert.equal(inherited.GITLAB_ALLOWED_PROJECT_IDS, undefined);
    await backend.client.close();
  } finally {
    names.forEach((name, index) => {
      if (before[index] === undefined) delete process.env[name];
      else process.env[name] = before[index];
    });
    await connections.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'restoration cannot detach a replacement accepted while the old backend closes',
  { timeout: 5000 },
  async () => {
    // A restore and a manual connection may overlap during asynchronous child shutdown.
    const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-restore-race-'));
    const store = new ConnectionStore(dir);
    const target = { mode: 'remote', url: 'https://fixture.invalid/mcp', authentication: 'none' };
    const before = store.commit(0, target);
    const connections = new Connections(store);
    connections.watcher.close();
    const closing = Promise.withResolvers();
    const release = Promise.withResolvers();
    const accepted = Promise.withResolvers();
    const replacements = [];
    connections.active = {
      snapshot: before,
      client: {
        close: async () => {
          closing.resolve();
          await release.promise;
        },
      },
    };
    const changed = store.commit(before.revision, target);
    connections.make = async (snapshot) => {
      const backend = {
        snapshot,
        closed: 0,
        client: {
          close: async () => {
            backend.closed++;
          },
        },
      };
      replacements.push(backend);
      return backend;
    };
    connections.qualify = async () => {};
    connections.changed = () => {
      if (connections.active === replacements[0]) accepted.resolve();
    };
    try {
      const restoring = connections.ready();
      await closing.promise;
      const connecting = connections.connect(target, changed.revision);
      await Promise.race([
        accepted.promise,
        connecting.then(() => assert.fail('Connection ended before acceptance.')),
      ]);
      release.resolve();
      await Promise.all([restoring, connecting]);
      assert.equal(connections.active, replacements[0]);
      assert.equal(replacements.length, 1);
      await connections.close();
      assert.equal(replacements[0].closed, 1);
    } finally {
      release.resolve();
      await connections.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

for (const stage of ['connect setup', 'restore setup', 'restore identity', 'connect identity']) {
  test(`discarding ${stage} cannot activate a late backend`, { timeout: 5000 }, async () => {
    // Hold the backend at an asynchronous boundary and cancel before its result can commit.
    const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-cancel-'));
    const store = new ConnectionStore(dir);
    const target = { mode: 'remote', url: 'https://fixture.invalid/mcp', authentication: 'none' };
    const restoring = stage.startsWith('restore');
    const snapshot = restoring ? store.commit(0, target) : store.read();
    const connections = new Connections(store);
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let closed = 0;
    const backend = {
      snapshot,
      client: {
        close: async () => {
          closed++;
        },
      },
    };
    connections.make = async () => {
      if (stage.endsWith('setup')) {
        entered.resolve();
        await release.promise;
      }
      return backend;
    };
    connections.qualify = async () => {
      if (stage.endsWith('identity')) {
        entered.resolve();
        await release.promise;
      }
    };
    try {
      const opening = restoring
        ? connections.ready()
        : connections.connect(target, snapshot.revision);
      await Promise.race([
        entered.promise,
        opening.then(() => assert.fail('Connection ended before reaching the test boundary.')),
      ]);
      if (restoring) await connections.disconnect(snapshot.revision);
      else await connections.cancel();
      release.resolve();
      await opening;
      assert.equal(connections.active, undefined);
      assert.equal(store.revision(), snapshot.revision + (restoring ? 1 : 0));
      assert(closed > 0);
    } finally {
      release.resolve();
      await connections.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('a shared disconnect notifies the process losing its backend', async () => {
  // A second process clears the shared selection; cached host catalogs must be invalidated.
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-shared-'));
  const store = new ConnectionStore(dir);
  const other = new ConnectionStore(dir);
  const connections = new Connections(store);
  let closed = 0;
  let notices = 0;
  try {
    const snapshot = store.commit(0, {
      mode: 'remote',
      url: 'https://fixture.invalid/mcp',
      authentication: 'none',
    });
    connections.active = {
      snapshot,
      client: {
        close: async () => {
          closed++;
        },
      },
    };
    connections.changed = () => {
      notices++;
    };
    other.commit(snapshot.revision, null);
    await connections.ready();
    assert.equal(closed, 1);
    assert.equal(connections.active, undefined);
    assert.equal(notices, 1);
  } finally {
    await connections.close();
    other.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'unconfigured setup, local GitLab read, failed replacement and restart',
  { timeout: 60000 },
  async () => {
    // Exercise the real core process and public MCP envelopes, without live credentials.
    const { startWorkflowGitLab } = await import('../manual/fixtures/workflow-gitlab.mjs');
    const gitlab = await startWorkflowGitLab();
    const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-contract-'));
    const home = join(dir, 'home');
    mkdirSync(join(home, '.config/gitlab-mcp'), { recursive: true });
    writeFileSync(
      join(home, '.config/gitlab-mcp/profiles.yaml'),
      'default_profile: other\nprofiles:\n  other:\n    host: unrelated.invalid\n    api_url: http://127.0.0.1:1\n    auth:\n      type: oauth\n      client_id_env: PATH\n',
    );
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const core = join(process.env.PLUGIN_CONTRACT_ROOT, 'runtime/src/plugin/core.js');
    let connections = new Connections(new ConnectionStore(dir), core);
    let server = createPluginServer(connections);
    const [front, back] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'plugin-contract', version: '1' });
    try {
      await server.connect(back);
      await client.connect(front);
      // Hosts negotiate MCP Apps before rendering the private connection resource.
      assert.deepEqual(client.getServerCapabilities().extensions?.['io.modelcontextprotocol/ui'], {
        mimeTypes: ['text/html;profile=mcp-app'],
      });
      const before = await client.listTools();
      assert(before.tools.some((t) => t.name === 'gitlab_plugin_open_connection'));
      assert(!before.tools.some((t) => t.name === 'browse_merge_requests'));
      const page = await client.readResource({ uri: 'ui://gitlab-mcp-local/connection.html' });
      assert.match(page.contents[0].text, /type="password"/);
      const connected = await connections.connect(
        { mode: 'local', url: gitlab.url, token: 'fixture-token', initTimeoutMs: 30000 },
        0,
      );
      assert.equal(connected.state, 'connected', JSON.stringify(connected));
      assert(!JSON.stringify(connected).includes('fixture-token'));
      const listed = await client.listTools();
      assert(listed.tools.some((t) => t.name === 'browse_merge_requests'));
      const read = await client.request(
        {
          method: 'tools/call',
          params: {
            name: 'browse_merge_requests',
            arguments: { action: 'list', project_id: 'test/backend' },
          },
        },
        ResultSchema,
      );
      assert.notEqual(read.isError, true, JSON.stringify(read));
      assert.match(JSON.stringify(read), /Fix parser bounds/);
      const revision = connected.revision;
      const failed = await connections.connect(
        { mode: 'remote', url: 'http://127.0.0.1:1/mcp', authentication: 'none' },
        revision,
      );
      assert.equal(failed.state, 'failed');
      assert.equal(connections.store.read().revision, revision);
      assert.equal(connections.store.read().connection.mode, 'local');
      await client.close();
      await connections.close();
      connections = new Connections(new ConnectionStore(dir), core);
      server = createPluginServer(connections);
      assert(await connections.ready());
      assert.equal(connections.status().state, 'connected');
      await connections.disconnect(revision);
      assert.equal(connections.status().state, 'unconfigured');
      assert.equal(connections.active, undefined);
    } finally {
      await client.close();
      await server.close();
      await connections.close();
      await gitlab.close();
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'HTTP backend preserves schemas, results, errors and uncertain writes on switch',
  { timeout: 30000 },
  async () => {
    // A delayed write must never be replayed or attributed to a replacement backend.
    const dir = mkdtempSync(join(tmpdir(), 'gitlab-remote-contract-'));
    let writes = 0,
      release;
    let started;
    const began = new Promise((resolve) => {
      started = resolve;
    });
    const delayed = new Promise((resolve) => {
      release = resolve;
    });
    const payload = {
      content: [{ type: 'text', text: '[{"title":"kept exactly"}]' }],
      structuredContent: { items: [{ title: 'kept exactly' }] },
      _meta: { 'mcp/www_authenticate': ['Bearer error="insufficient_scope"'] },
      isError: true,
    };
    let profile = {
      content: [],
      structuredContent: { id: 'remote-account', name: 'Remote fixture' },
    };
    let profileAvailable = true;
    let authorization;
    const http = createServer(async (req, res) => {
      authorization = req.headers.authorization;
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      const backend = new Server(
        { name: 'fixture', version: '1' },
        { capabilities: { tools: {} } },
      );
      backend.fallbackRequestHandler = async (request) => {
        if (request.method === 'tools/list') {
          // Qualification must follow even an empty opaque cursor to find the account tool.
          if (request.params?.cursor === '')
            return {
              tools: profileAvailable
                ? [
                    {
                      name: 'get_profile',
                      description: 'Account identity',
                      inputSchema: { type: 'object' },
                    },
                  ]
                : [],
            };
          return {
            tools: [
              {
                name: 'write_once',
                description: 'Delayed write',
                inputSchema: { type: 'object' },
                annotations: { destructiveHint: true },
              },
              {
                name: 'read_fixture',
                description: 'Read fixture',
                inputSchema: { type: 'object' },
                _meta: { custom: 'preserved' },
              },
            ],
            nextCursor: '',
          };
        }
        if (request.params.name === 'get_profile') return profile;
        if (request.params.name === 'write_once') {
          writes++;
          started();
          await delayed;
          return { content: [{ type: 'text', text: 'written' }] };
        }
        return payload;
      };
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void backend.close();
      });
      try {
        let body = '';
        for await (const chunk of req) body += chunk;
        await backend.connect(transport);
        await transport.handleRequest(req, res, JSON.parse(body));
      } catch {
        if (!res.headersSent) res.writeHead(500).end();
      }
    });
    await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
    const connections = new Connections(new ConnectionStore(dir));
    const damaged = new DatabaseSync(join(dir, 'connection.sqlite'));
    damaged.prepare('UPDATE connection SET value=? WHERE id=1').run('{"synthetic-stored-secret":');
    damaged.close();
    const server = createPluginServer(connections);
    const [front, back] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'remote-contract', version: '1' });
    try {
      await server.connect(back);
      await client.connect(front);
      // Corrupt saved data must preserve onboarding and allow an explicitly verified replacement.
      assert.equal(connections.status().state, 'failed');
      assert(!JSON.stringify(connections.status()).includes('synthetic-stored-secret'));
      assert(
        (await client.listTools()).tools.some(
          (tool) => tool.name === 'gitlab_plugin_open_connection',
        ),
      );
      let status = await connections.connect(
        {
          mode: 'remote',
          url: `http://127.0.0.1:${http.address().port}/mcp`,
          authentication: 'none',
        },
        0,
      );
      assert.equal(status.state, 'connected', JSON.stringify(status));
      const list = await client.listTools();
      assert.deepEqual(list.tools.find((t) => t.name === 'read_fixture')._meta, {
        custom: 'preserved',
      });
      assert.equal(list.nextCursor, '');
      const nextPage = await client.listTools({ cursor: list.nextCursor });
      assert.deepEqual(
        nextPage.tools.map((tool) => tool.name),
        ['get_profile'],
      );
      assert.equal(nextPage.nextCursor, undefined);
      // Exhausting discovery without an identity tool must preserve the selected connection.
      profileAvailable = false;
      const unsupported = await connections.connect(
        {
          mode: 'remote',
          url: `http://127.0.0.1:${http.address().port}/mcp`,
          authentication: 'none',
        },
        status.revision,
      );
      assert.equal(unsupported.state, 'failed');
      assert.match(unsupported.message, /tool discovery/);
      assert.equal(connections.store.revision(), status.revision);
      assert.equal(connections.active.identity.id, 'remote-account');
      profileAvailable = true;
      // A bearer credential must reach the backend without becoming public connection status.
      status = await connections.connect(
        {
          mode: 'remote',
          url: `http://127.0.0.1:${http.address().port}/mcp`,
          authentication: 'bearer',
          token: 'synthetic-bearer-secret',
        },
        status.revision,
      );
      assert.equal(status.state, 'connected', JSON.stringify(status));
      assert.equal(authorization, 'Bearer synthetic-bearer-secret');
      assert(!JSON.stringify(status).includes('synthetic-bearer-secret'));
      await assert.rejects(
        connections.connect(
          { mode: 'remote', url: 'http://127.0.0.1:1/mcp', authentication: 'bearer' },
          status.revision,
        ),
        /Enter the bearer token/,
      );
      await assert.rejects(
        connections.connect(
          { mode: 'remote', url: 'http://127.0.0.1:1/mcp', authentication: 'none' },
          status.revision - 1,
        ),
        /The connection changed/,
      );
      assert.deepEqual(
        await client.request(
          { method: 'tools/call', params: { name: 'read_fixture', arguments: {} } },
          ResultSchema,
        ),
        payload,
      );
      // A replacement must verify the account, preserve the selected backend on failure and sanitize diagnostics.
      const acceptedProfile = profile;
      for (const [error, reason] of [
        [
          { content: [], structuredContent: { id: '' } },
          'Check the address, credentials and server availability.',
        ],
        [
          { content: [{ type: 'text', text: 'CONNECTION_FAILED' }], isError: true },
          'The server is unreachable or did not answer. Check the address and network.',
        ],
        [
          {
            content: [],
            isError: true,
            _meta: { 'mcp/www_authenticate': ['Bearer error="invalid_token"'] },
          },
          'Authentication was rejected. Check the token or reconnect to sign in.',
        ],
        [
          {
            content: [],
            isError: true,
            _meta: { 'mcp/www_authenticate': ['Bearer error="insufficient_scope"'] },
          },
          'The account lacks permission. Check its GitLab token scopes.',
        ],
        [
          { content: [{ type: 'text', text: 'synthetic-provider-secret' }], isError: true },
          'Check the address, credentials and server availability.',
        ],
      ]) {
        profile = error;
        const rejected = await connections.connect(
          {
            mode: 'remote',
            url: `http://127.0.0.1:${http.address().port}/mcp`,
            authentication: 'none',
          },
          status.revision,
        );
        assert.equal(rejected.state, 'failed');
        assert.equal(
          rejected.message,
          `Connection failed during account verification. ${reason} The previous connection is unchanged.`,
        );
        assert.equal(connections.store.revision(), status.revision);
        assert.equal(connections.active.identity.id, 'remote-account');
      }
      profile = acceptedProfile;
      const writing = client.request(
        { method: 'tools/call', params: { name: 'write_once', arguments: {} } },
        ResultSchema,
      );
      const rejected = assert.rejects(writing, /Connection (changed|closed)/i);
      await began;
      await connections.disconnect(status.revision);
      release();
      await rejected;
      assert.equal(writes, 1);
      assert(!(await client.listTools()).tools.some((t) => t.name === 'write_once'));
    } finally {
      release();
      await client.close();
      await server.close();
      await connections.close();
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'packaged plugin starts without endpoint or external dependencies',
  { timeout: 30000 },
  async () => {
    // Moving the output away from the checkout verifies its installed dependency closure.
    const root = process.env.PLUGIN_CONTRACT_ROOT;
    if (!root) throw new Error('Set PLUGIN_CONTRACT_ROOT to the assembled plugin directory.');
    const dir = mkdtempSync(join(tmpdir(), 'gitlab-installed-plugin-'));
    const client = new Client({ name: 'installed-plugin-contract', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'runtime/src/plugin/main.js'), dir],
      cwd: root,
      stderr: 'pipe',
    });
    let diagnostics = '';
    transport.stderr?.on('data', (chunk) => {
      diagnostics += chunk;
    });
    try {
      await client.connect(transport);
      const list = await client.listTools();
      assert.equal(list.tools.length, 4, diagnostics);
      assert(!diagnostics.includes('Cannot find module'));
    } finally {
      await client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
