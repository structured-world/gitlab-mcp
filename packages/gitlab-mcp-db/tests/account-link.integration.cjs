/** Real PostgreSQL transactions across two replicas. Docker owns one isolated test DB;
 * migrations run once, fixtures have unique parents, TRUNCATE CASCADE cleans the suite.
 * Run serially with `yarn workspace @structured-world/gitlab-mcp-db test:integration`.
 */
const { after, before, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const path = require('node:path');
const { Client } = require('pg');
const { PostgreSQLStorageBackend } = require('../dist/src/postgresql.js');

const directory = path.resolve(__dirname, '..');
const container = `gitlab-mcp-account-link-test-${randomUUID()}`;
let created = false;
let connectionString;
let replicas = [];
let parent;
let flow;
let commit;

before(() => {
  const password = randomUUID();
  execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      container,
      '--label',
      'gitlab-mcp.test=account-link',
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_USER=account_link_test',
      '--env',
      `POSTGRES_PASSWORD=${password}`,
      '--env',
      'POSTGRES_DB=account_link_test',
      'postgres:17-alpine',
    ],
    { stdio: 'pipe' },
  );
  created = true;
  const binding = execFileSync('docker', ['port', container, '5432/tcp'], {
    encoding: 'utf8',
  }).trim();
  const url = `postgresql://account_link_test:${password}@${binding}/account_link_test`;
  // Exercise the shipped migration entry rather than constructing a parallel test schema.
  execFileSync(process.execPath, ['dist/src/migrate.js'], {
    cwd: directory,
    env: { ...process.env, OAUTH_STORAGE_POSTGRESQL_URL: url },
    stdio: 'pipe',
  });
  connectionString = url;
  replicas = [
    new PostgreSQLStorageBackend({ connectionString: url }),
    new PostgreSQLStorageBackend({ connectionString: url }),
  ];
});

before(async () => {
  await Promise.all(replicas.map((replica) => replica.initialize()));
});

after(async () => {
  try {
    if (connectionString) {
      const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
      try {
        await client.connect();
        await client.query('TRUNCATE TABLE oauth_sessions CASCADE');
        await client.query('TRUNCATE TABLE oauth_auth_code_flows CASCADE');
      } finally {
        await client.end();
      }
    }
  } finally {
    try {
      await Promise.all(replicas.map((replica) => replica.close()));
    } finally {
      if (created) execFileSync('docker', ['rm', '--force', container], { stdio: 'pipe' });
    }
  }
});

/** Parent fixture shared by the flow and linked-account fixtures of the current test. */
async function primaryFixture() {
  if (parent) return parent;
  const now = Date.now();
  parent = {
    id: randomUUID(),
    mcpAccessToken: randomUUID(),
    mcpRefreshToken: randomUUID(),
    mcpTokenExpiry: now + 3_600_000,
    gitlabAccessToken: randomUUID(),
    gitlabRefreshToken: randomUUID(),
    gitlabTokenExpiry: now + 3_600_000,
    gitlabUserId: 1,
    gitlabUsername: 'primary',
    clientId: randomUUID(),
    scopes: [],
    createdAt: now,
    updatedAt: now,
  };
  await replicas[0].createSession(parent);
  return parent;
}

beforeEach(async () => {
  parent = undefined;
  await primaryFixture();
  const now = Date.now();
  flow = {
    internalState: randomUUID(),
    clientId: parent.clientId,
    codeChallenge: 'challenge',
    codeChallengeMethod: 'S256',
    clientState: randomUUID(),
    clientRedirectUri: 'https://client.example/callback',
    callbackUri: 'https://mcp.example/callback',
    expiresAt: now + 600_000,
    requestedGitlabScopes: undefined,
    selectedInstance: undefined,
    selectedInstanceLabel: undefined,
    scopes: [],
    resource: undefined,
    gitlabTokens: undefined,
    link: { sessionId: parent.id, stage: 'connect', instance: 'https://gitlab.example' },
  };
  commit = {
    internalState: flow.internalState,
    primaryLeaseUntil: now + 30_000,
    account: {
      ...parent,
      id: randomUUID(),
      linkedToSessionId: parent.id,
      mcpAccessToken: '',
      mcpRefreshToken: '',
      mcpTokenExpiry: 0,
      gitlabAccessToken: randomUUID(),
      gitlabRefreshToken: randomUUID(),
      gitlabUsername: 'linked',
      gitlabUserId: 2,
      gitlabScopes: ['read_api'],
    },
  };
  await replicas[0].storeAuthCodeFlow(flow.internalState, flow);
  assert.equal(
    await replicas[0].claimGitLabRefresh(
      parent.id,
      parent.gitlabRefreshToken,
      now,
      commit.primaryLeaseUntil,
    ),
    true,
  );
});

/** The credentials issued for an account, shared by cache and commit assertions. */
function issued(account = commit.account) {
  return {
    access_token: account.gitlabAccessToken,
    refresh_token: account.gitlabRefreshToken,
    token_type: 'Bearer',
    created_at: Math.floor(account.createdAt / 1000),
    expires_in: 7200,
  };
}

// A late cache retry with a fresh lease must not restore a grant displaced by a newer link.
test('keeps a completed flow spent after another replica replaces its grant', async () => {
  assert.equal(await replicas[0].cacheLinkedFlowTokens(flow, issued()), true);
  assert.equal(await replicas[0].commitLinkedAccount(commit), true);
  await replicas[0].releaseGitLabRefresh(parent.id, commit.primaryLeaseUntil);
  const next = {
    ...commit,
    internalState: randomUUID(),
    primaryLeaseUntil: Date.now() + 40_000,
    account: {
      ...commit.account,
      gitlabAccessToken: randomUUID(),
      gitlabRefreshToken: randomUUID(),
    },
    existing: { refreshToken: commit.account.gitlabRefreshToken, leaseUntil: Date.now() + 20_000 },
  };
  assert.equal(
    await replicas[1].claimGitLabRefresh(
      parent.id,
      parent.gitlabRefreshToken,
      Date.now(),
      next.primaryLeaseUntil,
    ),
    true,
  );
  assert.equal(
    await replicas[1].claimGitLabRefresh(
      commit.account.id,
      commit.account.gitlabRefreshToken,
      Date.now(),
      next.existing.leaseUntil,
    ),
    true,
  );
  const nextFlow = { ...flow, internalState: next.internalState };
  await replicas[1].storeAuthCodeFlow(next.internalState, nextFlow);
  assert.equal(await replicas[1].cacheLinkedFlowTokens(nextFlow, issued(next.account)), true);
  assert.equal(await replicas[1].commitLinkedAccount(next), true);
  await replicas[1].releaseGitLabRefresh(parent.id, next.primaryLeaseUntil);
  await replicas[1].releaseGitLabRefresh(commit.account.id, next.existing.leaseUntil);

  const late = {
    ...commit,
    primaryLeaseUntil: Date.now() + 50_000,
    existing: { refreshToken: next.account.gitlabRefreshToken, leaseUntil: Date.now() + 25_000 },
  };
  assert.equal(
    await replicas[0].claimGitLabRefresh(
      parent.id,
      parent.gitlabRefreshToken,
      Date.now(),
      late.primaryLeaseUntil,
    ),
    true,
  );
  assert.equal(
    await replicas[0].claimGitLabRefresh(
      commit.account.id,
      next.account.gitlabRefreshToken,
      Date.now(),
      late.existing.leaseUntil,
    ),
    true,
  );
  assert.equal(await replicas[0].cacheLinkedFlowTokens(flow, issued()), false);
  assert.equal(await replicas[1].getAuthCodeFlow(flow.internalState), undefined);
  assert.equal(await replicas[0].commitLinkedAccount(late), false);
  assert.equal(
    (await replicas[1].getSession(commit.account.id)).gitlabAccessToken,
    next.account.gitlabAccessToken,
  );
});

// Concurrent retries create one cleanup record, inaccessible through the callback API.
test('retains one recovery record for concurrent late writes across replicas', async () => {
  await replicas[0].consumeAuthCodeFlow(flow.internalState);
  assert.deepEqual(
    await Promise.all(replicas.map((replica) => replica.cacheLinkedFlowTokens(flow, issued()))),
    [false, false],
  );
  const recovered = [];
  replicas[0].onAbandonedFlowGrant(async (pending) => {
    if (pending.link.sessionId !== parent.id) return;
    recovered.push(pending);
    assert.deepEqual(pending.gitlabTokens, issued());
    assert.equal(await replicas[1].getAuthCodeFlow(pending.internalState), undefined);
    assert.equal(await replicas[1].consumeAuthCodeFlow(pending.internalState), undefined);
  }, 30_000);
  await replicas[0].cleanup();
  assert.equal(recovered.length, 1);
});

// Different codes must not evict each other's single-use grants or consume the wrong one.
test('fences completion to the cached grant and retains a competing grant for cleanup', async () => {
  const other = { ...issued(), access_token: randomUUID(), refresh_token: randomUUID() };
  const results = await Promise.all([
    replicas[0].cacheLinkedFlowTokens(flow, issued()),
    replicas[1].cacheLinkedFlowTokens(flow, other),
  ]);
  assert.deepEqual(
    results.toSorted((left, right) => Number(left) - Number(right)),
    [false, true],
  );
  const cached = (await replicas[0].getAuthCodeFlow(flow.internalState)).gitlabTokens;
  const winner = cached.access_token === other.access_token ? other : issued();
  const loser = winner.access_token === other.access_token ? issued() : other;
  assert.equal(
    await replicas[1].commitLinkedAccount({
      ...commit,
      account: {
        ...commit.account,
        gitlabAccessToken: loser.access_token,
        gitlabRefreshToken: loser.refresh_token,
      },
    }),
    false,
  );
  assert.equal(
    await replicas[0].commitLinkedAccount({
      ...commit,
      account: {
        ...commit.account,
        gitlabAccessToken: winner.access_token,
        gitlabRefreshToken: winner.refresh_token,
      },
    }),
    true,
  );
  const recovered = [];
  replicas[0].onAbandonedFlowGrant(async (pending) => {
    if (pending.link.sessionId === parent.id) recovered.push(pending.gitlabTokens);
  }, 30_000);
  await replicas[0].cleanup();
  assert.deepEqual(recovered, [loser]);
});

// Retrying the original write cannot reset a cleanup lease or replace its rotated pair.
test('preserves cleanup ownership and rotated credentials during a late retry', async () => {
  await replicas[0].consumeAuthCodeFlow(flow.internalState);
  await replicas[0].cacheLinkedFlowTokens(flow, issued());
  let enter;
  let release;
  const ready = new Promise((resolve) => {
    enter = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const rotated = { ...issued(), access_token: randomUUID(), refresh_token: randomUUID() };
  let recovery;
  replicas[0].onAbandonedFlowGrant(async (pending, persist) => {
    if (pending.link.sessionId !== parent.id) return;
    recovery = pending;
    await persist(rotated);
    enter();
    await gate;
    throw new Error('Revocation temporarily unavailable');
  }, 30_000);
  const cleaning = replicas[0].cleanup();
  try {
    await ready;
    assert.equal(await replicas[1].cacheLinkedFlowTokens(flow, issued()), false);
    const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
    try {
      await client.connect();
      const { rows } = await client.query(
        'SELECT gitlab_tokens, expires_at FROM oauth_auth_code_flows WHERE internal_state = $1',
        [recovery.internalState],
      );
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0].gitlab_tokens, rotated);
      assert.equal(Number(rows[0].expires_at), recovery.expiresAt);
    } finally {
      await client.end();
    }
  } finally {
    release();
    await cleaning;
  }
});

// Both replicas may have passed the browser/preflight checks; only one may spend the flow.
test('concurrent deliveries commit exactly one account and consume the flow once', async () => {
  const results = await Promise.all(replicas.map((replica) => replica.commitLinkedAccount(commit)));
  assert.deepEqual(
    results.toSorted((left, right) => Number(left) - Number(right)),
    [false, true],
  );
  assert.equal(
    (await replicas[1].getSession(commit.account.id)).gitlabAccessToken,
    commit.account.gitlabAccessToken,
  );
  assert.equal(await replicas[1].getAuthCodeFlow(flow.internalState), undefined);
  assert.equal((await replicas[1].getLinkedSessions(parent.id)).length, 1);
});

// A callback that resumes after takeover must never restore its earlier grant.
test('rejects a stale primary owner after another replica completes the link', async () => {
  await replicas[0].releaseGitLabRefresh(parent.id, commit.primaryLeaseUntil);
  const lease = Date.now() + 30_001;
  assert.equal(
    await replicas[1].claimGitLabRefresh(parent.id, parent.gitlabRefreshToken, Date.now(), lease),
    true,
  );
  const winner = {
    ...commit,
    primaryLeaseUntil: lease,
    account: {
      ...commit.account,
      gitlabAccessToken: randomUUID(),
      gitlabRefreshToken: randomUUID(),
    },
  };
  assert.equal(await replicas[1].commitLinkedAccount(winner), true);
  assert.equal(await replicas[0].commitLinkedAccount(commit), false);
  assert.equal(
    (await replicas[0].getSession(commit.account.id)).gitlabAccessToken,
    winner.account.gitlabAccessToken,
  );
});

// The native transaction must reject expiry even if no replacement owner has claimed yet.
test('rejects an expired primary lease and retains the unspent flow', async () => {
  await replicas[0].releaseGitLabRefresh(parent.id, commit.primaryLeaseUntil);
  commit.primaryLeaseUntil = Date.now() + 30;
  assert.equal(
    await replicas[0].claimGitLabRefresh(
      parent.id,
      parent.gitlabRefreshToken,
      Date.now(),
      commit.primaryLeaseUntil,
    ),
    true,
  );
  await delay(Math.max(0, commit.primaryLeaseUntil - Date.now() + 5));
  assert.equal(await replicas[0].commitLinkedAccount(commit), false);
  assert.equal(await replicas[0].getSession(commit.account.id), undefined);
  assert.deepEqual(await replicas[0].getAuthCodeFlow(flow.internalState), flow);
});

async function replacement() {
  await primaryFixture();
  const old = {
    ...commit.account,
    gitlabAccessToken: randomUUID(),
    gitlabRefreshToken: randomUUID(),
    gitlabScopes: ['api'],
  };
  await replicas[0].createSession(old);
  commit.existing = { refreshToken: old.gitlabRefreshToken, leaseUntil: Date.now() + 15_000 };
  assert.equal(
    await replicas[0].claimGitLabRefresh(
      old.id,
      old.gitlabRefreshToken,
      Date.now(),
      commit.existing.leaseUntil,
    ),
    true,
  );
  return old;
}

// Account CAS failure occurs after deleting the flow inside the transaction: rollback
// must restore that flow, not just return false to the caller.
test('rolls back flow consumption when another replica owns the account lease', async () => {
  const old = await replacement();
  await replicas[0].releaseGitLabRefresh(old.id, commit.existing.leaseUntil);
  assert.equal(
    await replicas[1].claimGitLabRefresh(
      old.id,
      old.gitlabRefreshToken,
      Date.now(),
      commit.existing.leaseUntil + 1,
    ),
    true,
  );
  assert.equal(await replicas[0].commitLinkedAccount(commit), false);
  assert.equal((await replicas[1].getSession(old.id)).gitlabAccessToken, old.gitlabAccessToken);
  assert.deepEqual(await replicas[1].getAuthCodeFlow(flow.internalState), flow);
});

// Flow JSON filters must reject other parents, stages, expiry and cleanup reservations.
for (const reason of ['foreign', 'verify', 'expired', 'cleanup']) {
  test(`rejects a ${reason} flow without consuming it`, async () => {
    if (reason === 'foreign') flow.link.sessionId = randomUUID();
    if (reason === 'verify') flow.link.stage = 'verify';
    if (reason === 'expired') flow.expiresAt = Date.now() - 1;
    if (reason === 'cleanup') {
      await replicas[0].deleteAuthCodeFlow(flow.internalState);
      flow.internalState = `cleanup:${flow.internalState}`;
      commit.internalState = flow.internalState;
    }
    await replicas[0].storeAuthCodeFlow(flow.internalState, flow);
    assert.equal(await replicas[1].commitLinkedAccount(commit), false);
    assert.equal(await replicas[0].getSession(commit.account.id), undefined);
    assert.equal(await replicas[0].deleteAuthCodeFlow(flow.internalState), true);
  });
}

// Even a matching account lease cannot authorize replacing a credential that changed.
test('rolls back when the stored account refresh token changed', async () => {
  const old = await replacement();
  const rotated = randomUUID();
  await replicas[1].updateSession(old.id, { gitlabRefreshToken: rotated });
  assert.equal(await replicas[0].commitLinkedAccount(commit), false);
  assert.equal((await replicas[1].getSession(old.id)).gitlabRefreshToken, rotated);
  assert.deepEqual(await replicas[1].getAuthCodeFlow(flow.internalState), flow);
});

// A uniqueness error must roll back the flow deletion before the caller retries as replace.
test('rolls back a colliding insertion without changing the account', async () => {
  const old = { ...commit.account, gitlabAccessToken: randomUUID() };
  await replicas[0].createSession(old);
  assert.equal(await replicas[1].commitLinkedAccount(commit), false);
  assert.equal((await replicas[0].getSession(old.id)).gitlabAccessToken, old.gitlabAccessToken);
  assert.deepEqual(await replicas[0].getAuthCodeFlow(flow.internalState), flow);
});

// A newly linked grant with unknown permissions cannot inherit the displaced grant's scopes.
test('replaces the leased grant and clears its previous permissions', async () => {
  await replacement();
  commit.account.gitlabScopes = undefined;
  assert.equal(await replicas[0].commitLinkedAccount(commit), true);
  const stored = await replicas[1].getSession(commit.account.id);
  assert.equal(stored.gitlabAccessToken, commit.account.gitlabAccessToken);
  assert.equal(stored.gitlabScopes, undefined);
  assert.equal(await replicas[1].getAuthCodeFlow(flow.internalState), undefined);
});
