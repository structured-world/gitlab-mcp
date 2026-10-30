const { test } = require('node:test');
const { URL, URLSearchParams } = require('node:url');
const { fetch } = globalThis;
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { once } = require('node:events');
const { runtimeRequire } = require('./runtime.cjs');
const { ConnectionStore } = runtimeRequire('./connection-store.js');
const { Connections } = runtimeRequire('./connections.js');

test(
  'remote OAuth validates callbacks, commits only after sign-in, and persists for restart',
  { timeout: 15000 },
  async (t) => {
    // Exercise SDK discovery, registration and PKCE against a synthetic authorization server.
    const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-oauth-'));
    let origin;
    let exchanges = 0;
    let accessToken = 'fixture-access';
    let refreshToken = 'fixture-refresh';
    let blockedRefresh;
    let refreshStarted;
    let releaseRefresh;
    let rejectInitialization = false;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, origin);
      const json = (body, status = 200, headers = {}) => {
        res
          .writeHead(status, { 'Content-Type': 'application/json', ...headers })
          .end(JSON.stringify(body));
      };
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource'))
        return json({
          resource: origin + '/mcp',
          authorization_servers: [origin],
          scopes_supported: ['mcp:tools'],
        });
      if (url.pathname.startsWith('/.well-known/'))
        return json({
          issuer: origin,
          authorization_endpoint: origin + '/authorize',
          token_endpoint: origin + '/token',
          registration_endpoint: origin + '/register',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      let body = '';
      for await (const chunk of req) body += chunk;
      if (url.pathname === '/register')
        return json({ ...JSON.parse(body), client_id: 'fixture-client' }, 201);
      if (url.pathname === '/token') {
        const params = new URLSearchParams(body);
        if (params.get('grant_type') === 'refresh_token') {
          if (params.get('refresh_token') !== refreshToken)
            return json({ error: 'invalid_grant' }, 400);
          // A rotating provider spends the old token before its HTTP response arrives.
          refreshToken = `fixture-refresh-${exchanges}`;
          await new Promise((resolve) => setTimeout(resolve, 20));
        } else {
          assert.equal(params.get('code'), 'fixture-code');
          assert(params.get('code_verifier'));
        }
        exchanges++;
        if (blockedRefresh && params.get('grant_type') === 'refresh_token') {
          refreshStarted();
          await blockedRefresh;
        }
        return json({
          access_token: accessToken,
          refresh_token: refreshToken,
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      if (url.pathname !== '/mcp') return json({}, 404);
      if (req.headers.authorization !== `Bearer ${accessToken}`)
        return json({ error: 'invalid_token' }, 401, {
          'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        });
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      const request = JSON.parse(body);
      if (request.method === 'initialize' && rejectInitialization) {
        rejectInitialization = false;
        return json({ error: 'temporary' }, 503);
      }
      if (request.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      let result;
      if (request.method === 'initialize')
        result = {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'oauth-fixture', version: '1' },
        };
      else if (request.method === 'tools/list')
        result = { tools: [{ name: 'get_profile', inputSchema: { type: 'object' } }] };
      else result = { content: [], structuredContent: { id: 'fixture-oauth-account' } };
      json({ jsonrpc: '2.0', id: request.id, result });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
    let connections = new Connections(new ConnectionStore(dir));
    let other;
    let recovering;
    try {
      const pending = await connections.connect(
        { mode: 'remote', url: origin + '/mcp', authentication: 'oauth' },
        0,
      );
      assert.equal(pending.state, 'connecting', JSON.stringify(pending));
      assert.equal(connections.store.read().revision, 0);
      const authorization = new URL(pending.authorizationUrl);
      const callback = new URL(authorization.searchParams.get('redirect_uri'));
      callback.searchParams.set('state', 'wrong-state');
      callback.searchParams.set('code', 'fixture-code');
      assert.equal((await fetch(callback)).status, 400);
      assert.equal(exchanges, 0);
      callback.searchParams.set('state', authorization.searchParams.get('state'));
      // Correct state does not authorize a code issued by a different authorization server.
      callback.searchParams.set('iss', 'https://another-issuer.example');
      assert.equal((await fetch(callback)).status, 400);
      assert.equal(connections.store.revision(), 0);
      assert.equal(connections.status().state, 'connecting');
      callback.searchParams.set('iss', origin);
      const committed = new Promise((resolve, reject) => {
        connections.changed = resolve;
        t.signal.addEventListener(
          'abort',
          () => reject(Error('OAuth callback did not finish before the test deadline.')),
          { once: true },
        );
      });
      assert.equal((await fetch(callback)).status, 200);
      await committed;
      assert.equal(connections.status().state, 'connected', JSON.stringify(connections.status()));
      assert.equal(exchanges, 1);
      assert(!JSON.stringify(connections.status()).includes('fixture-access'));
      await connections.close();
      connections = new Connections(new ConnectionStore(dir));
      assert(await connections.ready());
      assert.equal(exchanges, 1);
      other = new Connections(new ConnectionStore(dir));
      assert(await other.ready());
      const sharedBackend = other.active;
      const selection = connections.store.read().revision;
      recovering = new Connections(new ConnectionStore(dir));
      rejectInitialization = true;
      assert.equal(await recovering.ready(), undefined);
      assert.equal(recovering.status().state, 'failed');

      // A rejected access token refreshes through the SDK and is saved for this exact selection.
      accessToken = 'fixture-rotated-access';
      await connections.active.client.listTools();
      assert.equal(exchanges, 2);
      // Refreshing credentials must not select a new account or dispose another chat's transport.
      assert.equal(connections.store.read().revision, selection);
      await other.ready();
      assert.equal(other.active, sharedBackend);
      assert.equal(other.active.authorization.tokens().access_token, accessToken);
      // A failed restore retries when shared credentials change without selecting another account.
      assert(await recovering.ready());
      await recovering.close();
      recovering = undefined;
      assert.equal(
        connections.store.read().connection.authorization.tokens.access_token,
        accessToken,
      );
      // Concurrent chats must share one rotation rather than replay a spent refresh token.
      accessToken = 'fixture-concurrent-access';
      await Promise.all([connections.active.client.listTools(), other.active.client.listTools()]);
      assert.equal(exchanges, 3);

      // Cancelling a new sign-in leaves the previous account usable and invalidates its callback.
      const saved = connections.store.read();
      const cancelled = await connections.connect(
        { mode: 'remote', url: origin + '/mcp', authentication: 'oauth' },
        saved.revision,
      );
      const cancelledUrl = new URL(cancelled.authorizationUrl);
      const staleCallback = new URL(cancelledUrl.searchParams.get('redirect_uri'));
      staleCallback.searchParams.set('state', cancelledUrl.searchParams.get('state'));
      staleCallback.searchParams.set('code', 'fixture-code');
      await connections.cancel();
      await assert.rejects(fetch(staleCallback));
      assert.equal(connections.store.read().revision, saved.revision);
      assert(await connections.ready());

      // Provider descriptions cannot escape into diagnostics, and denial does not replace the account.
      const denied = await connections.connect(
        { mode: 'remote', url: origin + '/mcp', authentication: 'oauth' },
        saved.revision,
      );
      const deniedUrl = new URL(denied.authorizationUrl);
      const denialCallback = new URL(deniedUrl.searchParams.get('redirect_uri'));
      denialCallback.searchParams.set('state', deniedUrl.searchParams.get('state'));
      denialCallback.searchParams.set('error', 'access_denied');
      denialCallback.searchParams.set('error_description', 'synthetic-provider-secret');
      const failed = new Promise((resolve) => {
        connections.changed = resolve;
      });
      await fetch(denialCallback);
      await failed;
      assert.equal(connections.status().state, 'failed');
      assert(!JSON.stringify(connections.status()).includes('synthetic-provider-secret'));
      assert.equal(connections.store.read().revision, saved.revision);

      // An external selection wins even if an older authorization callback resumes afterward.
      await connections.connect(
        { mode: 'remote', url: origin + '/mcp', authentication: 'oauth' },
        saved.revision,
      );
      const late = connections.pending.authorization.onCode;
      // Delay change notifications to prove the storage fence rejects a late token response itself.
      await other.close();
      other = undefined;
      connections.watcher.close();
      blockedRefresh = new Promise((resolve) => {
        releaseRefresh = resolve;
      });
      const started = new Promise((resolve) => {
        refreshStarted = resolve;
      });
      accessToken = 'fixture-late-refresh';
      const rejected = assert.rejects(connections.active.client.listTools());
      await started;
      const replacement = new ConnectionStore(dir);
      replacement.commit(saved.revision, null);
      replacement.close();
      releaseRefresh();
      await rejected;
      await connections.cancel();
      await late('fixture-code');
      assert.equal(connections.store.read().connection, null);
      assert.equal(exchanges, 4);
    } finally {
      releaseRefresh?.();
      await recovering?.close();
      await other?.close();
      await connections.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
