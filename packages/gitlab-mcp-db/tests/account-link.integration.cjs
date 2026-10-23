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

// Both replicas may have passed the browser/preflight checks; only one may spend the flow.
test('concurrent deliveries commit exactly one account and consume the flow once', async () => {
  const results = await Promise.all(replicas.map((replica) => replica.commitLinkedAccount(commit)));
  assert.deepEqual(results.toSorted(), [false, true]);
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
