/**
 * GitLab accounts of a connection: a chat lists them, switches to one and works with it,
 * while other chats keep theirs; an account that cannot be used refuses the call instead
 * of falling back to another account.
 */

let mockOAuth = true;
jest.mock('../../../src/oauth/config', () => ({
  isOAuthEnabled: () => mockOAuth,
  loadOAuthConfig: () => (mockOAuth ? { issuer: 'https://mcp.example.com' } : null),
}));

jest.mock('../../../src/config', () => ({
  GITLAB_BASE_URL: 'https://git.corp.example.com',
  GITLAB_TOKEN: 'corp-token',
}));

jest.mock('../../../src/config/instances-loader', () => ({
  loadInstancesConfig: jest.fn().mockResolvedValue({
    instances: [
      { url: 'https://git.corp.example.com', label: 'Corporate GitLab', insecureSkipVerify: false },
      {
        url: 'https://gitlab.com',
        label: 'GitLab.com',
        tokenEnv: 'COM_TOKEN',
        insecureSkipVerify: false,
      },
      { url: 'https://gl.unset.example.com', tokenEnv: 'UNSET_TOKEN', insecureSkipVerify: false },
    ],
    source: 'file',
    sourceDetails: 'test',
  }),
}));

jest.mock('../../../src/oauth/session-store', () => {
  const { SessionStore } = jest.requireActual('../../../src/oauth/session-store');
  const { MemoryStorageBackend } = jest.requireActual('../../../src/oauth/storage/memory');
  return { sessionStore: new SessionStore(new MemoryStorageBackend({ silent: true })) };
});

jest.mock('../../../src/oauth/gitlab-token-refresh', () => {
  const actual = jest.requireActual('../../../src/oauth/gitlab-token-refresh');
  return { ...actual, withFreshGitLabToken: jest.fn(async (session: unknown) => session) };
});

jest.mock('../../../src/oauth/grant-revocation', () => ({
  liveGitLabAccessToken: jest.fn(
    async (session: { gitlabAccessToken: string }) => session.gitlabAccessToken,
  ),
  revokeGitLabGrant: jest.fn(),
}));

import {
  configuredInstanceFor,
  configuredInstanceToken,
} from '../../../src/accounts/instance-tokens';
import {
  AccountUnavailableError,
  forgetChat,
  listChatAccounts,
  resetChatAccounts,
  switchChatAccount,
  unlinkChatAccount,
  withChatAccount,
} from '../../../src/accounts/chat-accounts';
import { currentTokenAccount } from '../../../src/accounts/token-account';
import { sessionStore } from '../../../src/oauth/session-store';
import { getTokenContext, runWithTokenContext } from '../../../src/oauth/token-context';
import {
  GitLabGrantRevokedError,
  withFreshGitLabToken,
} from '../../../src/oauth/gitlab-token-refresh';
import { liveGitLabAccessToken, revokeGitLabGrant } from '../../../src/oauth/grant-revocation';
import { InstanceRegistry } from '../../../src/services/InstanceRegistry';
import { accountProfileId } from '../../../src/entities/context/profile';
import type { OAuthSession, TokenContext } from '../../../src/oauth/types';

const mockFresh = withFreshGitLabToken as jest.MockedFunction<typeof withFreshGitLabToken>;
const mockRevoke = revokeGitLabGrant as jest.MockedFunction<typeof revokeGitLabGrant>;
const mockLiveToken = liveGitLabAccessToken as jest.MockedFunction<typeof liveGitLabAccessToken>;

function session(overrides: Partial<OAuthSession>): OAuthSession {
  return {
    id: 'primary',
    mcpAccessToken: 'mcp-access',
    mcpRefreshToken: 'mcp-refresh',
    mcpTokenExpiry: Date.now() + 3600_000,
    gitlabAccessToken: 'corp-gitlab',
    gitlabRefreshToken: 'corp-refresh',
    gitlabTokenExpiry: Date.now() + 3600_000,
    gitlabUserId: 7,
    gitlabUsername: 'alice',
    gitlabApiUrl: 'https://git.corp.example.com',
    instanceLabel: 'Corporate GitLab',
    clientId: 'client',
    scopes: ['mcp:tools'],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

const primary = session({});
const personal = session({
  id: 'linked-com',
  mcpAccessToken: '',
  mcpRefreshToken: '',
  gitlabAccessToken: 'com-gitlab',
  gitlabUserId: 99,
  gitlabUsername: 'alice-personal',
  gitlabApiUrl: 'https://gitlab.com',
  instanceLabel: 'GitLab.com',
  linkedToSessionId: 'primary',
  createdAt: 2000,
});
const personalId = accountProfileId('https://gitlab.com', 99);
const primaryId = accountProfileId('https://git.corp.example.com', 7);

const signedIn: TokenContext = {
  gitlabToken: 'corp-gitlab',
  gitlabUserId: 7,
  gitlabUsername: 'alice',
  sessionId: 'primary',
  apiUrl: 'https://git.corp.example.com',
  instanceLabel: 'Corporate GitLab',
};

function asSignedIn<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTokenContext(signedIn, fn) as Promise<T>;
}

describe('chat accounts with OAuth', () => {
  beforeEach(async () => {
    mockOAuth = true;
    resetChatAccounts();
    sessionStore.clear();
    jest.clearAllMocks();
    await sessionStore.createSession(primary);
    await sessionStore.createSession(personal);
  });

  it('lists the signed-in account first and the linked ones after it', async () => {
    const accounts = await asSignedIn(() => listChatAccounts('chat-1'));

    expect(accounts).toEqual([
      expect.objectContaining({
        id: primaryId,
        label: 'alice @ Corporate GitLab',
        primary: true,
        active: true,
      }),
      expect.objectContaining({
        id: personalId,
        label: 'alice-personal @ GitLab.com',
        instanceUrl: 'https://gitlab.com',
        primary: false,
        active: false,
      }),
    ]);
  });

  // The stored instance of a session is optional (a nullable column): an account stored
  // without one belongs to the server's instance; one without a label is named by its host,
  // or by its stored address when that is not a URL.
  it('lists accounts stored without an instance or a label', async () => {
    await sessionStore.createSession(
      session({
        id: 'linked-no-instance',
        mcpAccessToken: '',
        mcpRefreshToken: '',
        gitlabUserId: 41,
        gitlabUsername: 'bob',
        gitlabApiUrl: undefined,
        instanceLabel: undefined,
        linkedToSessionId: 'primary',
        createdAt: 3000,
      }),
    );
    await sessionStore.createSession(
      session({
        id: 'linked-odd',
        mcpAccessToken: '',
        mcpRefreshToken: '',
        gitlabUserId: 42,
        gitlabUsername: 'carol',
        gitlabApiUrl: 'not-a-url',
        instanceLabel: undefined,
        linkedToSessionId: 'primary',
        createdAt: 4000,
      }),
    );

    const accounts = await asSignedIn(() => listChatAccounts('chat-1'));

    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'bob @ git.corp.example.com',
          instanceUrl: 'https://git.corp.example.com',
        }),
        expect.objectContaining({ label: 'carol @ not-a-url' }),
      ]),
    );
  });

  it('switches one chat to a linked account and leaves the other chats on theirs', async () => {
    const switched = await asSignedIn(() => switchChatAccount('chat-1', personalId));

    expect(switched).toMatchObject({ id: personalId, active: true });
    const chat1 = await asSignedIn(() => listChatAccounts('chat-1'));
    const chat2 = await asSignedIn(() => listChatAccounts('chat-2'));
    expect(chat1.find((a) => a.active)?.id).toBe(personalId);
    expect(chat2.find((a) => a.active)?.id).toBe(primaryId);
  });

  it('runs a switched chat as the linked account, with its token and instance', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));

    const inChat1 = await asSignedIn(() =>
      withChatAccount('chat-1', async () => getTokenContext()),
    );
    const inChat2 = await asSignedIn(() =>
      withChatAccount('chat-2', async () => getTokenContext()),
    );

    expect(inChat1).toMatchObject({
      gitlabToken: 'com-gitlab',
      gitlabUserId: 99,
      gitlabUsername: 'alice-personal',
      apiUrl: 'https://gitlab.com',
      // The MCP session stays the one the connection signed in with.
      sessionId: 'primary',
    });
    expect(inChat2).toMatchObject({
      gitlabToken: 'corp-gitlab',
      apiUrl: 'https://git.corp.example.com',
    });
  });

  it('runs a chat switched back to the signed-in account as that account', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));
    await asSignedIn(() => switchChatAccount('chat-1', primaryId));

    const context = await asSignedIn(() =>
      withChatAccount('chat-1', async () => getTokenContext()),
    );

    expect(context).toMatchObject({ gitlabToken: 'corp-gitlab', gitlabUserId: 7 });
  });

  // No silent fallback: a chat that chose an account never acts as another one.
  it('refuses a call when the chosen account is no longer linked', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));
    await sessionStore.deleteSession('linked-com');
    const fn = jest.fn(async () => 'ran');

    await expect(asSignedIn(() => withChatAccount('chat-1', fn))).rejects.toThrow(
      AccountUnavailableError,
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('asks to link again when GitLab refuses the chosen account', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));
    mockFresh.mockRejectedValueOnce(new GitLabGrantRevokedError('invalid_grant'));

    await expect(asSignedIn(() => withChatAccount('chat-1', async () => 'ran'))).rejects.toThrow(
      'link the account again',
    );
  });

  it('refuses a call with a retry hint when the refresh fails for a temporary reason', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));
    mockFresh.mockRejectedValueOnce(new Error('GitLab returned 502'));

    await expect(asSignedIn(() => withChatAccount('chat-1', async () => 'ran'))).rejects.toThrow(
      /could not be refreshed now \(GitLab returned 502\); try again/,
    );
  });

  // The linked account was removed while its tokens were being refreshed.
  it('refuses a call when the chosen account disappears during its refresh', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));
    mockFresh.mockResolvedValueOnce(undefined);

    await expect(asSignedIn(() => withChatAccount('chat-1', async () => 'ran'))).rejects.toThrow(
      'no longer linked',
    );
  });

  it('names a non-error refresh failure in the retry hint', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));
    mockFresh.mockRejectedValueOnce('socket hang up');

    await expect(asSignedIn(() => withChatAccount('chat-1', async () => 'ran'))).rejects.toThrow(
      /could not be refreshed now \(socket hang up\)/,
    );
  });

  // Without a request context (no signed-in caller) there is no account to switch to.
  it('runs a call without a request context as is', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));

    await expect(withChatAccount('chat-1', async () => getTokenContext())).resolves.toBeUndefined();
    expect(mockFresh).not.toHaveBeenCalled();
  });

  // A request already made as the chosen account needs no switch and no refresh.
  it('runs a request already made as the chosen account directly', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));
    const asPersonal = {
      ...signedIn,
      gitlabToken: 'com-gitlab',
      gitlabUserId: 99,
      apiUrl: 'https://gitlab.com',
    };

    const context = await runWithTokenContext(asPersonal, () =>
      withChatAccount('chat-1', async () => getTokenContext()),
    );

    expect(context).toMatchObject({ gitlabToken: 'com-gitlab', gitlabUserId: 99 });
    expect(mockFresh).not.toHaveBeenCalled();
  });

  // An account without an instance label is labelled with its instance's host.
  it('labels an account without an instance label by its host', async () => {
    await sessionStore.updateSession('linked-com', { instanceLabel: undefined });

    const accounts = await asSignedIn(() => listChatAccounts('chat-1'));

    expect(accounts.find((a) => a.id === personalId)?.label).toBe('alice-personal @ gitlab.com');
  });

  it('refuses to switch to an account the connection does not have', async () => {
    await expect(asSignedIn(() => switchChatAccount('chat-1', 'gitlab:unknown'))).rejects.toThrow(
      'No account "gitlab:unknown"',
    );
  });

  it("never lists another session's linked accounts", async () => {
    await sessionStore.createSession(
      session({ id: 'stranger', gitlabUserId: 50, linkedToSessionId: 'someone-else' }),
    );

    const accounts = await asSignedIn(() => listChatAccounts('chat-1'));

    expect(accounts.map((a) => a.id)).not.toContain(
      accountProfileId('https://git.corp.example.com', 50),
    );
  });

  it('unlinks an account, ends its GitLab grant and refuses the chats that used it', async () => {
    await asSignedIn(() => switchChatAccount('chat-2', personalId));

    const removed = await asSignedIn(() => unlinkChatAccount('chat-1', personalId));

    expect(removed).toMatchObject({ id: personalId });
    expect(await sessionStore.getSession('linked-com')).toBeUndefined();
    expect(mockRevoke).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'linked-com' }),
      'com-gitlab',
      expect.anything(),
    );
    await expect(asSignedIn(() => withChatAccount('chat-2', async () => 'ran'))).rejects.toThrow(
      'no longer linked',
    );
  });

  // A link replaces the account's grant while the unlink is reading it: the grant the row
  // holds when it is removed is the one ended, so no grant stays authorized without a row.
  it('ends the grant a concurrent link stored before the account was removed', async () => {
    mockLiveToken.mockImplementationOnce(async (row) => {
      // Read first: the memory backend hands out the stored record, which the update changes.
      const read = row.gitlabAccessToken;
      await sessionStore.updateSession('linked-com', {
        gitlabAccessToken: 'replaced-token',
        gitlabRefreshToken: 'replaced-refresh',
      });
      return read;
    });

    await asSignedIn(() => unlinkChatAccount('chat-1', personalId));

    expect(await sessionStore.getSession('linked-com')).toBeUndefined();
    expect(mockRevoke).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'linked-com' }),
      'replaced-token',
      expect.anything(),
    );
  });

  // Another chat unlinked the account first, before or during the refresh of its token: it
  // is gone, and that unlink ended its grant.
  it('reports an account another chat unlinked first without ending a grant', async () => {
    const getSession = sessionStore.getSession.bind(sessionStore);
    const lookup = jest
      .spyOn(sessionStore, 'getSession')
      .mockImplementationOnce(getSession)
      .mockImplementationOnce(async () => undefined);
    try {
      await asSignedIn(() => unlinkChatAccount('chat-1', personalId));
    } finally {
      lookup.mockRestore();
    }
    expect(mockRevoke).not.toHaveBeenCalled();

    // The lookup above only pretended the account was gone; now it goes during the refresh.
    mockLiveToken.mockImplementationOnce(async (row) => {
      const read = row.gitlabAccessToken;
      await sessionStore.deleteSession('linked-com');
      return read;
    });
    await asSignedIn(() => unlinkChatAccount('chat-1', personalId));

    expect(mockRevoke).not.toHaveBeenCalled();
  });

  // The account is removed; a lease that cannot be released expires on its own.
  it('unlinks the account when its lease cannot be released', async () => {
    const release = jest
      .spyOn(sessionStore, 'releaseGitLabRefresh')
      .mockRejectedValueOnce(new Error('database unavailable'));
    try {
      await asSignedIn(() => unlinkChatAccount('chat-1', personalId));
    } finally {
      release.mockRestore();
    }

    expect(await sessionStore.getSession('linked-com')).toBeUndefined();
    expect(mockRevoke).toHaveBeenCalled();
  });

  // A link or a token refresh holding the account's lease finishes before the unlink removes
  // the row; one that never lets go makes the unlink ask for a retry and keep the account.
  it('keeps the account when its lease stays held elsewhere', async () => {
    jest.useFakeTimers();
    try {
      await sessionStore.claimGitLabRefresh(
        'linked-com',
        personal.gitlabRefreshToken,
        Date.now(),
        Date.now() + 60_000,
      );
      const unlink = asSignedIn(() => unlinkChatAccount('chat-1', personalId));
      const settled = expect(unlink).rejects.toThrow('being changed elsewhere');
      await jest.runAllTimersAsync();
      await settled;
    } finally {
      jest.useRealTimers();
    }

    expect(await sessionStore.getSession('linked-com')).toBeDefined();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('refuses to unlink the account this chat works with', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));

    await expect(asSignedIn(() => unlinkChatAccount('chat-1', personalId))).rejects.toThrow(
      'switch to another account first',
    );
    expect(await sessionStore.getSession('linked-com')).toBeDefined();
  });

  it('refuses to unlink the account the connection signed in with', async () => {
    await expect(asSignedIn(() => unlinkChatAccount('chat-1', primaryId))).rejects.toThrow(
      'cannot be unlinked',
    );
  });

  // A database package older than the server keeps no linked accounts: the list holds the
  // connection's own account only.
  it('lists only the signed-in account when the storage cannot keep linked accounts', async () => {
    const backend = (sessionStore as unknown as { backend: Record<string, unknown> }).backend;
    backend.getLinkedSessions = undefined;
    try {
      const accounts = await asSignedIn(() => listChatAccounts('chat-1'));

      expect(accounts.map((a) => a.id)).toEqual([primaryId]);
    } finally {
      delete backend.getLinkedSessions;
    }
  });

  // A database package older than the server has no linked accounts; unlinking says so
  // instead of failing on the missing storage method.
  it('refuses to unlink when the session storage cannot keep linked accounts', async () => {
    const backend = (sessionStore as unknown as { backend: Record<string, unknown> }).backend;
    backend.getLinkedSessions = undefined;
    try {
      await expect(asSignedIn(() => unlinkChatAccount('chat-1', personalId))).rejects.toThrow(
        new AccountUnavailableError(
          'The session storage of this server cannot keep linked accounts; update the database package.',
        ),
      );
    } finally {
      delete backend.getLinkedSessions;
    }
  });

  it('forgets the choice of a closed chat', async () => {
    await asSignedIn(() => switchChatAccount('chat-1', personalId));

    forgetChat('chat-1');

    const accounts = await asSignedIn(() => listChatAccounts('chat-1'));
    expect(accounts.find((a) => a.active)?.id).toBe(primaryId);
  });

  it('reports a connection that is not signed in', async () => {
    await expect(listChatAccounts('chat-1')).rejects.toThrow('not signed in');
  });
});

describe('chat accounts with a static token', () => {
  const originalEnv = process.env;

  beforeAll(async () => {
    InstanceRegistry.getInstance().reset();
    await InstanceRegistry.getInstance().initialize();
  });

  beforeEach(() => {
    mockOAuth = false;
    resetChatAccounts();
    process.env = { ...originalEnv, COM_TOKEN: 'com-pat' };
  });

  afterAll(() => {
    process.env = originalEnv;
    InstanceRegistry.getInstance().reset();
  });

  it('lists the server token first and each configured instance with a set token', async () => {
    const accounts = await listChatAccounts(undefined);

    expect(accounts).toEqual([
      expect.objectContaining({
        id: 'https://git.corp.example.com',
        // The server's instance carries the label it is configured with.
        label: 'Corporate GitLab',
        primary: true,
        active: true,
      }),
      expect.objectContaining({ id: 'https://gitlab.com', label: 'GitLab.com', primary: false }),
    ]);
  });

  // Before the instance configuration is loaded only the server's own token is known, named
  // by its host.
  it('lists only the server token before the instances are configured', async () => {
    InstanceRegistry.getInstance().reset();
    try {
      const accounts = await listChatAccounts(undefined);

      expect(accounts).toEqual([
        expect.objectContaining({
          id: 'https://git.corp.example.com',
          label: 'git.corp.example.com',
          primary: true,
        }),
      ]);
    } finally {
      await InstanceRegistry.getInstance().initialize();
    }
  });

  it('runs a switched chat with the configured instance and its token', async () => {
    await switchChatAccount('chat-1', 'https://gitlab.com');

    const inChat1 = await withChatAccount('chat-1', async () => currentTokenAccount());
    const inChat2 = await withChatAccount('chat-2', async () => currentTokenAccount());

    expect(inChat1).toEqual({ instanceUrl: 'https://gitlab.com', token: 'com-pat' });
    expect(inChat2).toBeUndefined();
  });

  it('refuses a call when the switched-to instance lost its token', async () => {
    await switchChatAccount('chat-1', 'https://gitlab.com');
    delete process.env.COM_TOKEN;

    await expect(withChatAccount('chat-1', async () => 'ran')).rejects.toThrow(
      'no longer configured with a token',
    );
  });

  it('gives each instance its own token', () => {
    expect(configuredInstanceToken('https://git.corp.example.com/')).toBe('corp-token');
    expect(configuredInstanceToken('https://gitlab.com')).toBe('com-pat');
    expect(configuredInstanceToken('https://gl.unset.example.com')).toBeUndefined();
    expect(configuredInstanceToken('https://unknown.example.com')).toBeUndefined();
  });

  // A token variable that is set but empty holds no token: the instance is not offered and
  // its requests carry none.
  it('gives no token to an instance whose token variable is empty', async () => {
    process.env.COM_TOKEN = '';

    expect(configuredInstanceToken('https://gitlab.com')).toBeUndefined();
    const accounts = await listChatAccounts(undefined);
    expect(accounts.map((account) => account.id)).toEqual(['https://git.corp.example.com']);
  });

  // A request belongs to the configured instance its URL starts with, segment-wise, so a
  // look-alike host or path never borrows another instance's token.
  it('finds the configured instance of a request URL', () => {
    expect(configuredInstanceFor('https://gitlab.com/api/v4/version')).toBe('https://gitlab.com');
    expect(configuredInstanceFor('https://git.corp.example.com')).toBe(
      'https://git.corp.example.com',
    );
    expect(configuredInstanceFor('https://gitlab.com?private_token=x')).toBe('https://gitlab.com');
    expect(configuredInstanceFor('https://gitlab.com.evil.example/api/v4')).toBeUndefined();
    expect(configuredInstanceFor('https://gitlab.community/api/v4')).toBeUndefined();
    expect(configuredInstanceFor('https://unknown.example.com/api/v4')).toBeUndefined();
  });

  it('has no linked accounts to unlink', async () => {
    await expect(unlinkChatAccount(undefined, 'https://gitlab.com')).rejects.toThrow(
      'static token has no linked accounts',
    );
  });
});
