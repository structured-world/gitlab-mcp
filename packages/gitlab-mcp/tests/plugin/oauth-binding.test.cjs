const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { URLSearchParams } = require('node:url');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { runtimeRequire } = require('./runtime.cjs');
const { ConnectionStore } = runtimeRequire('./connection-store.js');
const { ConnectionAuthorization } = runtimeRequire('./authorization.js');

test('expired browser sign-in closes its callback and reports failure once', async (t) => {
  // An abandoned browser flow must release the listener without committing credentials.
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-oauth-expiry-'));
  const provider = new ConnectionAuthorization(
    { redirectUrl: 'http://127.0.0.1/callback' },
    () => assert.fail('Expired sign-in must not save credentials.'),
    { current: () => undefined, lockPath: join(dir, 'lock.sqlite') },
  );
  let failures = 0;
  provider.onFailure = () => {
    failures++;
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await provider.listen();
    const listener = provider.callback;
    assert.equal(listener.listening, true);
    t.mock.timers.tick(5 * 60_000);
    assert.equal(listener.listening, false);
    assert.equal(failures, 1);
    t.mock.timers.tick(5 * 60_000);
    assert.equal(failures, 1);
  } finally {
    await provider.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('staged OAuth invalidation clears only the requested SDK credentials', async () => {
  // A registration or verifier failure must not erase unrelated staged credentials.
  const dir = mkdtempSync(join(tmpdir(), 'gitlab-staged-grant-'));
  const initial = {
    redirectUrl: 'http://127.0.0.1/callback',
    client: { client_id: 'fixture-client' },
    tokens: {
      access_token: 'fixture-access',
      token_type: 'Bearer',
      issuer: 'https://issuer.example',
    },
    discovery: { authorizationServerUrl: 'https://issuer.example' },
  };
  try {
    for (const scope of ['client', 'tokens', 'discovery', 'verifier', 'all']) {
      let saved;
      const provider = new ConnectionAuthorization(
        { ...initial },
        (patch) => {
          saved = patch;
        },
        {
          current: () => undefined,
          lockPath: join(dir, 'lock.sqlite'),
        },
      );
      try {
        provider.saveCodeVerifier('fixture-verifier');
        provider.invalidateCredentials(scope);
        const expected = {};
        for (const field of ['client', 'tokens', 'discovery']) {
          const cleared = scope === 'all' || scope === field;
          if (cleared) expected[field] = undefined;
          assert.deepEqual(provider.data[field], cleared ? undefined : initial[field]);
        }
        assert.deepEqual(saved, expected);
        if (scope === 'all' || scope === 'verifier')
          assert.throws(() => provider.codeVerifier(), /Sign-in expired/);
        else assert.equal(provider.codeVerifier(), 'fixture-verifier');
      } finally {
        await provider.dispose();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'a refresh retains its grant issuer when shared discovery changes',
  { timeout: 10000 },
  async () => {
    // A remote discovery update must not relabel credentials issued by another authorization server.
    const dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-issuer-'));
    const server = createServer((_request, response) =>
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          access_token: 'refreshed-access',
          refresh_token: 'refreshed-grant',
          token_type: 'Bearer',
        }),
      ),
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const issuer = `http://127.0.0.1:${server.address().port}`;
    const store = new ConnectionStore(dir);
    const selected = store.commit(0, {
      mode: 'remote',
      url: issuer + '/mcp',
      authentication: 'oauth',
      authorization: {
        redirectUrl: 'http://127.0.0.1/callback',
        tokens: {
          access_token: 'expired-access',
          refresh_token: 'original-grant',
          token_type: 'Bearer',
          issuer,
        },
        discovery: { authorizationServerUrl: issuer },
      },
    });
    const provider = new ConnectionAuthorization(
      selected.connection.authorization,
      (patch) => store.updateAuthorization(selected.revision, patch),
      {
        current: () => store.readAuthorization(selected.revision),
        lockPath: store.refreshLockPath,
      },
    );
    try {
      store.updateAuthorization(selected.revision, {
        discovery: { authorizationServerUrl: 'https://changed-issuer.example' },
      });
      const response = await provider.fetch(issuer + '/token', {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'original-grant' }),
      });
      assert.equal(response.status, 200);
      assert.equal(store.readAuthorization(selected.revision).tokens.issuer, issuer);
      assert.equal(
        store.readAuthorization(selected.revision).tokens.access_token,
        'refreshed-access',
      );
    } finally {
      await provider.dispose();
      store.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
