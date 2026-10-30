const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { URL } = require('node:url');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { runtimeRequire } = require('./runtime.cjs');
const { Connections } = runtimeRequire('./connections.js');
const { ConnectionStore } = runtimeRequire('./connection-store.js');

for (const code of ['invalid_grant', 'invalid_client', 'vendor_failure']) {
  test(
    `OAuth ${code} preserves selection and suppresses provider diagnostics`,
    { timeout: 10000 },
    async () => {
      // Real SDK recovery must not clear a newer selection or expose a provider's arbitrary error text.
      const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-oauth-error-'));
      let origin;
      const metadata = () => ({
        issuer: origin,
        authorization_endpoint: origin + '/authorize',
        token_endpoint: origin + '/token',
        registration_endpoint: origin + '/register',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
      const resource = () => ({ resource: origin + '/mcp', authorization_servers: [origin] });
      const server = createServer(async (request, response) => {
        const json = (body, status = 200, headers = {}) =>
          response
            .writeHead(status, { 'Content-Type': 'application/json', ...headers })
            .end(JSON.stringify(body));
        const url = new URL(request.url, origin);
        if (url.pathname === '/token')
          return json({ error: code, error_description: 'synthetic-provider-secret' }, 400);
        if (url.pathname.startsWith('/.well-known/oauth-protected-resource'))
          return json(resource());
        if (url.pathname.startsWith('/.well-known/')) return json(metadata());
        if (url.pathname === '/register') {
          let body = '';
          for await (const chunk of request) body += chunk;
          return json({ ...JSON.parse(body), client_id: 'replacement-client' }, 201);
        }
        return json({ error: 'invalid_token' }, 401, {
          'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        });
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      origin = `http://127.0.0.1:${server.address().port}`;
      const connections = new Connections(new ConnectionStore(dir));
      try {
        const selected = connections.store.commit(0, {
          mode: 'remote',
          url: origin + '/mcp',
          authentication: 'oauth',
          authorization: {
            redirectUrl: 'http://127.0.0.1/callback',
            client: { client_id: 'fixture-client', issuer: origin },
            tokens: {
              access_token: 'expired-access',
              refresh_token: 'fixture-refresh',
              token_type: 'Bearer',
              issuer: origin,
            },
            discovery: {
              authorizationServerUrl: origin,
              authorizationServerMetadata: metadata(),
              resourceMetadata: resource(),
            },
          },
        });
        assert.equal(await connections.ready(), undefined);
        assert.equal(connections.status().state, 'failed');
        assert(!JSON.stringify(connections.status()).includes('synthetic-provider-secret'));
        const saved = connections.store.read();
        assert.equal(saved.revision, selected.revision);
        assert.equal(
          saved.connection.authorization.tokens === undefined,
          code !== 'vendor_failure',
        );
        // Clearing a failed selection in another chat also clears its stale failure status.
        const other = new ConnectionStore(dir);
        other.commit(saved.revision, null);
        other.close();
        await connections.ready();
        assert.equal(connections.status().state, 'unconfigured');
      } finally {
        await connections.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}
