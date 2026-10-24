import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStorageBackend } from '../../../../src/oauth/storage/memory';
import { FileStorageBackend } from '../../../../src/oauth/storage/file';
import type { LinkedAccountCommit } from '../../../../src/oauth/storage/types';
import type {
  AuthCodeFlowState,
  OAuthSession,
  GitLabTokenResponse,
} from '../../../../src/oauth/types';

describe.each(['memory', 'file'] as const)('%s atomic account-link commit', (kind) => {
  let storage: MemoryStorageBackend | FileStorageBackend;
  let directory: string;
  let parent: OAuthSession;
  let flow: AuthCodeFlowState;
  let commit: LinkedAccountCommit;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'account-link-commit-'));
    storage =
      kind === 'memory'
        ? new MemoryStorageBackend({ silent: true })
        : new FileStorageBackend({
            filePath: path.join(directory, 'sessions.json'),
            saveInterval: 60_000,
          });
    await storage.initialize();
    const now = Date.now();
    parent = {
      id: randomUUID(),
      mcpAccessToken: randomUUID(),
      mcpRefreshToken: randomUUID(),
      mcpTokenExpiry: now + 3_600_000,
      gitlabAccessToken: 'primary-access',
      gitlabRefreshToken: 'primary-refresh',
      gitlabTokenExpiry: now + 3_600_000,
      gitlabUserId: 1,
      gitlabUsername: 'primary',
      clientId: 'test-client',
      scopes: [],
      createdAt: now,
      updatedAt: now,
    };
    flow = {
      internalState: randomUUID(),
      clientId: parent.clientId,
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
      clientState: 'state',
      clientRedirectUri: 'https://client.example/callback',
      callbackUri: 'https://mcp.example/callback',
      expiresAt: now + 600_000,
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
        gitlabAccessToken: 'new-access',
        gitlabRefreshToken: 'new-refresh',
        gitlabUserId: 2,
        gitlabUsername: 'linked',
        gitlabScopes: ['read_api'],
      },
    };
    await storage.createSession(parent);
    await storage.storeAuthCodeFlow(flow.internalState, flow);
    expect(
      await storage.claimGitLabRefresh(
        parent.id,
        parent.gitlabRefreshToken,
        now,
        commit.primaryLeaseUntil,
      ),
    ).toBe(true);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await storage.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('rejects a different grant from the one cached by the flow', async () => {
    // Two codes can finish concurrently; consuming one flow must not lose its cached grant.
    await storage.storeAuthCodeFlow(flow.internalState, {
      ...flow,
      gitlabTokens: {
        access_token: 'other-access',
        refresh_token: 'other-refresh',
        token_type: 'Bearer',
        created_at: Math.floor(Date.now() / 1000),
        expires_in: 7200,
      },
    });
    expect(await storage.commitLinkedAccount(commit)).toBe(false);
    expect(await storage.getAuthCodeFlow(flow.internalState)).toBeDefined();
    expect(await storage.getSession(commit.account.id)).toBeUndefined();
  });

  const issued = (): GitLabTokenResponse => ({
    access_token: commit.account.gitlabAccessToken,
    refresh_token: commit.account.gitlabRefreshToken,
    token_type: 'Bearer',
    created_at: Math.floor(parent.createdAt / 1000),
    expires_in: 7200,
  });

  it('caches tokens without replacing current flow metadata and accepts the same grant again', async () => {
    // A retry may carry an older snapshot; only the tokens belong to that write.
    const current = { ...flow, clientState: 'latest-state' };
    await storage.storeAuthCodeFlow(flow.internalState, current);
    expect(await storage.cacheLinkedFlowTokens(flow, issued())).toBe(true);
    expect(await storage.cacheLinkedFlowTokens(flow, issued())).toBe(true);
    expect(await storage.getAuthCodeFlow(flow.internalState)).toEqual({
      ...current,
      gitlabTokens: issued(),
    });
    expect(await storage.commitLinkedAccount(commit)).toBe(true);
  });

  it('keeps late credentials for cleanup without exposing a replayable callback', async () => {
    // Even after restart, a consumed callback stays consumed and its late grant stays recoverable.
    await storage.consumeAuthCodeFlow(flow.internalState);
    expect(await storage.cacheLinkedFlowTokens(flow, issued())).toBe(false);
    expect(await storage.cacheLinkedFlowTokens(flow, issued())).toBe(false);
    if (kind === 'file') {
      await storage.close();
      storage = new FileStorageBackend({ filePath: path.join(directory, 'sessions.json') });
      await storage.initialize();
    }
    expect(await storage.getAuthCodeFlow(flow.internalState)).toBeUndefined();
    expect(await storage.commitLinkedAccount(commit)).toBe(false);
    const cleanup = jest.fn(async (pending: AuthCodeFlowState) => {
      expect(pending.internalState).toMatch(/^cleanup:issued:/);
      expect(await storage.getAuthCodeFlow(pending.internalState)).toBeUndefined();
      expect(await storage.consumeAuthCodeFlow(pending.internalState)).toBeUndefined();
      expect(pending.gitlabTokens).toEqual(issued());
      expect(pending.link).toEqual(flow.link);
    });
    storage.onAbandonedFlowGrant(cleanup, 30_000);
    await storage.cleanup();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('preserves the first cached grant when another code finishes the same flow', async () => {
    // A different issued grant gets its own cleanup record instead of evicting the winner.
    const first = issued();
    const second = { ...first, access_token: 'second-access', refresh_token: 'second-refresh' };
    expect(await storage.cacheLinkedFlowTokens(flow, first)).toBe(true);
    expect(await storage.cacheLinkedFlowTokens(flow, second)).toBe(false);
    expect((await storage.getAuthCodeFlow(flow.internalState))?.gitlabTokens).toEqual(first);
    expect(await storage.commitLinkedAccount(commit)).toBe(true);
    const cleanup = jest.fn(async (pending: AuthCodeFlowState) => {
      expect(pending.gitlabTokens).toEqual(second);
    });
    storage.onAbandonedFlowGrant(cleanup, 30_000);
    await storage.cleanup();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it.each(['expired', 'session', 'stage'] as const)(
    'does not update a changed flow (%s)',
    async (change) => {
      // A delayed write is tied to the original flow owner, stage and lifetime.
      const current = { ...flow, link: { ...flow.link! } };
      if (change === 'expired') current.expiresAt = Date.now() - 1;
      if (change === 'session') current.link.sessionId = 'another-session';
      if (change === 'stage') current.link.stage = 'verify';
      await storage.storeAuthCodeFlow(flow.internalState, current);
      expect(await storage.cacheLinkedFlowTokens(flow, issued())).toBe(false);
      expect(await storage.getAuthCodeFlow(flow.internalState)).toEqual(current);
    },
  );

  it('does not overwrite tokens rotated by the cleanup owner', async () => {
    // Retrying a late write while cleanup holds the record must not restore spent credentials.
    await storage.consumeAuthCodeFlow(flow.internalState);
    await storage.cacheLinkedFlowTokens(flow, issued());
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const rotated = {
      ...issued(),
      access_token: 'rotated-access',
      refresh_token: 'rotated-refresh',
    };
    storage.onAbandonedFlowGrant(async (_pending, persist) => {
      await persist(rotated);
      entered();
      await gate;
      throw new Error('Revocation temporarily unavailable');
    }, 30_000);
    const cleaning = storage.cleanup();
    try {
      await ready;
      expect(await storage.cacheLinkedFlowTokens(flow, issued())).toBe(false);
    } finally {
      release();
      await cleaning;
    }
    const retry = jest.fn(async (pending: AuthCodeFlowState) => {
      expect(pending.gitlabTokens).toEqual(rotated);
    });
    storage.onAbandonedFlowGrant(retry, 30_000);
    await storage.cleanup();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  // A committed link owns its grant exactly once; replay must not create or overwrite a row.
  it('stores the account and spends the flow together, once', async () => {
    expect(await storage.commitLinkedAccount(commit)).toBe(true);
    expect(await storage.getSession(commit.account.id)).toEqual(commit.account);
    expect(await storage.getAuthCodeFlow(flow.internalState)).toBeUndefined();
    expect(await storage.commitLinkedAccount(commit)).toBe(false);
    expect(await storage.getLinkedSessions(parent.id)).toEqual([commit.account]);
    expect((await storage.getSession(parent.id))?.gitlabAccessToken).toBe(parent.gitlabAccessToken);
  });

  async function replacement(unknownScopes: boolean): Promise<OAuthSession> {
    const old: OAuthSession = {
      ...commit.account,
      gitlabAccessToken: 'old-access',
      gitlabRefreshToken: 'old-refresh',
      gitlabScopes: ['api'],
      gitlabUsername: 'old-name',
    };
    if (unknownScopes) delete old.gitlabScopes;
    await storage.createSession(old);
    commit.existing = { refreshToken: old.gitlabRefreshToken, leaseUntil: Date.now() + 15_000 };
    expect(
      await storage.claimGitLabRefresh(
        old.id,
        old.gitlabRefreshToken,
        Date.now(),
        commit.existing.leaseUntil,
      ),
    ).toBe(true);
    return old;
  }

  // Unknown permissions of the new grant cannot inherit the previous grant's broader scopes.
  it('replaces only the leased grant and clears unknown scopes', async () => {
    await replacement(false);
    commit.account.gitlabScopes = undefined;
    expect(await storage.commitLinkedAccount(commit)).toBe(true);
    expect(await storage.getSession(commit.account.id)).toMatchObject({
      gitlabAccessToken: commit.account.gitlabAccessToken,
      gitlabRefreshToken: commit.account.gitlabRefreshToken,
      gitlabUsername: commit.account.gitlabUsername,
      gitlabScopes: undefined,
    });
    expect(await storage.getAuthCodeFlow(flow.internalState)).toBeUndefined();
  });

  // Delays must not turn an expired owner into a writer, even without a successor yet.
  it('rejects an expired primary lease without spending the flow', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(commit.primaryLeaseUntil + 1);
    expect(await storage.commitLinkedAccount(commit)).toBe(false);
    expect(await storage.getSession(commit.account.id)).toBeUndefined();
    expect(await storage.getAuthCodeFlow(flow.internalState)).toEqual(flow);
  });

  // A new primary owner can complete another link while the previous callback is paused.
  it('rejects a displaced primary lease without mutating either record', async () => {
    await storage.releaseGitLabRefresh(parent.id, commit.primaryLeaseUntil);
    await storage.claimGitLabRefresh(
      parent.id,
      parent.gitlabRefreshToken,
      Date.now(),
      commit.primaryLeaseUntil + 1,
    );
    expect(await storage.commitLinkedAccount(commit)).toBe(false);
    expect(await storage.getSession(commit.account.id)).toBeUndefined();
    expect(await storage.getAuthCodeFlow(flow.internalState)).toEqual(flow);
  });

  // The atomic operation checks flow ownership/stage/expiry, not just its caller's read.
  it.each(['missing', 'expired', 'foreign', 'verify'] as const)(
    'rejects a %s flow',
    async (reason) => {
      if (reason === 'missing') await storage.consumeAuthCodeFlow(flow.internalState);
      if (reason === 'expired') flow.expiresAt = Date.now() - 1;
      if (reason === 'foreign') flow.link = { ...flow.link!, sessionId: randomUUID() };
      if (reason === 'verify') flow.link = { ...flow.link!, stage: 'verify' };
      if (reason !== 'missing') await storage.storeAuthCodeFlow(flow.internalState, flow);
      expect(await storage.commitLinkedAccount(commit)).toBe(false);
      expect(await storage.getSession(commit.account.id)).toBeUndefined();
    },
  );

  // Account CAS misses must leave the still-unspent flow available for a fresh attempt.
  it.each(['token', 'lease', 'missing'] as const)(
    'rejects a changed account %s',
    async (reason) => {
      const old = await replacement(false);
      if (reason === 'token')
        await storage.updateSession(old.id, { gitlabRefreshToken: 'rotated' });
      if (reason === 'lease')
        await storage.releaseGitLabRefresh(old.id, commit.existing!.leaseUntil);
      if (reason === 'missing') await storage.deleteSession(old.id);
      const stored = await storage.getSession(old.id);
      const before = stored && { ...stored };
      expect(await storage.commitLinkedAccount(commit)).toBe(false);
      expect(await storage.getSession(old.id)).toEqual(before);
      expect(await storage.getAuthCodeFlow(flow.internalState)).toEqual(flow);
    },
  );

  // Insert is never an upsert; a concurrent link must be reread under a new lease.
  it('does not overwrite a colliding insertion', async () => {
    const old = { ...commit.account, gitlabAccessToken: 'concurrent-access' };
    const expected = { ...old };
    await storage.createSession(old);
    expect(await storage.commitLinkedAccount(commit)).toBe(false);
    expect(await storage.getSession(old.id)).toEqual(expected);
    expect(await storage.getAuthCodeFlow(flow.internalState)).toEqual(flow);
  });

  if (kind === 'file') {
    it.each([false, true])('rolls back a failed token-cache write (spent=%s)', async (spent) => {
      // A failed rename must not leave uncommitted tokens visible or save them on the next write.
      if (spent) await storage.consumeAuthCodeFlow(flow.internalState);
      const before = await storage.getStats();
      const rename = jest
        .spyOn(fs.promises, 'rename')
        .mockRejectedValueOnce(new Error('disk unavailable'));
      await expect(storage.cacheLinkedFlowTokens(flow, issued())).rejects.toThrow(
        'disk unavailable',
      );
      rename.mockRestore();
      expect((await storage.getStats()).authCodeFlows).toBe(before.authCodeFlows);
      expect(await storage.getAuthCodeFlow(flow.internalState)).toEqual(spent ? undefined : flow);
      expect(await storage.cacheLinkedFlowTokens(flow, issued())).toBe(!spent);
    });

    // An expired lease cannot be taken over midway through a write-through commit.
    it('serializes lease takeover after the complete disk transition', async () => {
      const realRename = fs.promises.rename.bind(fs.promises);
      let resume!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const writing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const rename = jest.spyOn(fs.promises, 'rename').mockImplementationOnce(async (...args) => {
        entered();
        await waiting;
        return realRename(...args);
      });
      const pending = storage.commitLinkedAccount(commit);
      await writing;
      let claimed = false;
      const takeover = storage
        .claimGitLabRefresh(
          parent.id,
          parent.gitlabRefreshToken,
          commit.primaryLeaseUntil + 1,
          commit.primaryLeaseUntil + 1_000,
        )
        .then((result) => {
          claimed = true;
          return result;
        });
      try {
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(claimed).toBe(false);
      } finally {
        resume();
        await pending;
        await takeover;
        rename.mockRestore();
      }
      expect(await pending).toBe(true);
      expect(await takeover).toBe(true);
      expect(await storage.getAuthCodeFlow(flow.internalState)).toBeUndefined();
      expect(await storage.getSession(commit.account.id)).toEqual(commit.account);
    });

    // A crash immediately after success must never revive the flow or lose its account.
    it('persists both halves before reporting success', async () => {
      expect(await storage.commitLinkedAccount(commit)).toBe(true);
      const restarted = new FileStorageBackend({ filePath: path.join(directory, 'sessions.json') });
      await restarted.initialize();
      try {
        expect(await restarted.getSession(commit.account.id)).toEqual(commit.account);
        expect(await restarted.getAuthCodeFlow(flow.internalState)).toBeUndefined();
      } finally {
        await restarted.close();
      }
    });

    // The next save must preserve the previous grant, including unknown legacy scopes.
    it.each([
      [false, false],
      [true, false],
      [true, true],
    ])(
      'rolls back account and flow on write failure (replace=%s, unknownScopes=%s)',
      async (replace, unknownScopes) => {
        if (replace) await replacement(unknownScopes);
        const before = { ...(await storage.getSession(commit.account.id)) };
        const rename = jest
          .spyOn(fs.promises, 'rename')
          .mockRejectedValueOnce(new Error('disk unavailable'));
        await expect(storage.commitLinkedAccount(commit)).rejects.toThrow('disk unavailable');
        rename.mockRestore();
        expect(await storage.getSession(commit.account.id)).toEqual(replace ? before : undefined);
        expect(await storage.getAuthCodeFlow(flow.internalState)).toEqual(flow);
        await storage.storeAuthCodeFlow(flow.internalState, flow);
        const restarted = new FileStorageBackend({
          filePath: path.join(directory, 'sessions.json'),
        });
        await restarted.initialize();
        try {
          expect(await restarted.getSession(commit.account.id)).toEqual(
            replace ? before : undefined,
          );
          expect(await restarted.getAuthCodeFlow(flow.internalState)).toEqual(flow);
        } finally {
          await restarted.close();
        }
      },
    );
  }
});
