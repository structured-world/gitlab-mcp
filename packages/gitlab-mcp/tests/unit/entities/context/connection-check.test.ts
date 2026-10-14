/**
 * The connection check combines what GitLab reports about the credentials with the
 * caller's effective settings, and tells the user what to do about problems.
 */

jest.mock('../../../../src/config', () => ({ GITLAB_BASE_URL: 'https://gitlab.example.com' }));

const mockWhoami = jest.fn();
jest.mock('../../../../src/entities/context/whoami', () => ({
  executeWhoami: () => mockWhoami(),
}));

// Two tools the registry offers on the instance: one reads GitLab, one changes it.
const mockAvailableToolNames = jest.fn(() => ['browse_wiki', 'manage_wiki']);
jest.mock('../../../../src/registry-manager', () => ({
  RegistryManager: {
    getInstance: () => ({
      getAvailableToolNames: mockAvailableToolNames,
      getToolFacts: (name: string) => ({
        name,
        group: 'wiki',
        readOnly: name.startsWith('browse_'),
      }),
    }),
  },
}));

let mockService: unknown;
jest.mock('../../../../src/configuration', () => ({
  ...jest.requireActual('../../../../src/configuration/caller'),
  getConfigurationService: () => mockService,
}));

import { checkConnection } from '../../../../src/entities/context/connection-check';
import { ConfigurationService } from '../../../../src/configuration/service';
import { runWithCaller, type Caller } from '../../../../src/configuration/caller';
import type { AccountSettingsRecord } from '../../../../src/configuration/types';
import { runWithTokenContext } from '../../../../src/oauth/token-context';

const alice: Caller = {
  accountKey: 'gitlab:https://gitlab.example.com#1',
  sessionKey: 's1',
  accountLabel: 'alice@gitlab.example.com',
  instanceUrl: 'https://gitlab.example.com',
  oauth: true,
};

function whoami(overrides: Record<string, unknown> = {}) {
  return {
    user: { username: 'alice' },
    server: {
      apiUrl: 'https://gitlab.example.com',
      version: '17.4.0',
      tier: 'premium',
      readOnlyMode: false,
    },
    capabilities: { availableToolCount: 42 },
    warnings: ['Token expires in 3 days'],
    recommendations: [{ action: 'renew_token', message: 'Renew the token', priority: 'high' }],
    ...overrides,
  };
}

describe('checkConnection', () => {
  let records: Map<string, AccountSettingsRecord>;

  beforeEach(() => {
    records = new Map();
    mockWhoami.mockResolvedValue(whoami());
    mockService = new ConfigurationService(
      async () => ({
        get: async (key: string) => records.get(key),
        put: async () => undefined,
      }),
      {
        load: async (name: string) => {
          if (name === 'readonly') return { read_only: true };
          if (name === 'several-projects') return { scope: { projects: ['team/app', 'team/api'] } };
          if (name === 'several-groups') return { scope: { groups: ['team', 'ops'] } };
          throw new Error(`Preset not found: ${name}`);
        },
      },
      async () => undefined,
    );
  });

  function save(settings: AccountSettingsRecord['settings']): void {
    records.set(alice.accountKey, {
      accountKey: alice.accountKey,
      settings,
      version: 1,
      updatedAt: 1,
    });
  }

  it("reports the account, GitLab and the caller's restrictions", async () => {
    save({ preset: 'readonly', scope: { type: 'group', path: 'team', includeSubgroups: true } });

    const check = await runWithCaller(alice, () => checkConnection());

    expect(check).toEqual({
      account: 'alice',
      instance: 'https://gitlab.example.com',
      gitlabVersion: '17.4.0',
      tier: 'premium',
      authenticated: true,
      readOnly: true,
      preset: 'readonly',
      scope: 'team',
      // The read-only preset leaves only the reading tool of the two
      availableTools: 1,
      warnings: ['Token expires in 3 days'],
      recommendations: ['Renew the token'],
    });
  });

  // The count is what this caller can call, not what the registry offers everyone.
  it.each([
    [{}, 2],
    [{ readOnly: true }, 1],
    [{ disabledToolGroups: ['wiki'] }, 0],
  ])('counts the tools %j leaves available', async (settings, count) => {
    save(settings);

    const check = await runWithCaller(alice, () => checkConnection());

    expect(check.availableTools).toBe(count);
    expect(mockAvailableToolNames).toHaveBeenCalledWith(alice.instanceUrl);
  });

  // The count matches tools/list: an OAuth token's scopes hide tools it cannot call.
  it("leaves out tools the caller's OAuth token scopes do not allow", async () => {
    const check = await runWithTokenContext(
      {
        gitlabToken: 'token',
        gitlabUserId: 1,
        gitlabUsername: 'alice',
        sessionId: 's1',
        apiUrl: 'https://gitlab.example.com',
        gitlabScopes: ['read_user'],
      },
      () => runWithCaller(alice, () => checkConnection()),
    );

    expect(check.availableTools).toBe(0);
  });

  it('reports a project scope and no preset', async () => {
    save({ scope: { type: 'project', path: 'team/app', includeSubgroups: false } });

    const check = await runWithCaller(alice, () => checkConnection());

    expect(check).toMatchObject({ preset: null, scope: 'team/app', readOnly: false });
  });

  // A preset scope given as a list still restricts calls, so it is reported too.
  it.each([
    ['several-projects', 'team/app'],
    ['several-groups', 'team'],
  ])('reports the scope of preset %s', async (preset, expected) => {
    save({ preset });

    const check = await runWithCaller(alice, () => checkConnection());

    expect(check.scope).toBe(expected);
  });

  it('reports read-only mode of the server', async () => {
    mockWhoami.mockResolvedValue(
      whoami({
        server: {
          apiUrl: 'https://gitlab.example.com',
          version: '17.4.0',
          tier: 'free',
          readOnlyMode: true,
        },
      }),
    );

    expect((await runWithCaller(alice, () => checkConnection())).readOnly).toBe(true);
  });

  // GitLab did not identify anyone with the credentials: shown as not signed in.
  it('reports credentials GitLab does not accept', async () => {
    mockWhoami.mockResolvedValue(whoami({ user: null }));

    const check = await runWithCaller(alice, () => checkConnection());

    expect(check).toMatchObject({
      authenticated: false,
      account: 'alice@gitlab.example.com',
      scope: null,
    });
  });

  it('checks the server connection outside a tool call', async () => {
    const check = await checkConnection();

    expect(check.account).toBe('alice');
  });

  // The saved preset was removed from the server: the chat works read-only, and the
  // check says why and how to get out of it.
  it('explains a saved preset that no longer exists', async () => {
    save({ preset: 'retired' });

    const check = await runWithCaller(alice, () => checkConnection());

    expect(check.readOnly).toBe(true);
    expect(check.warnings).toContain(
      "The saved preset 'retired' no longer exists on this server; tools that change GitLab are off until another preset is chosen.",
    );
    expect(check.recommendations).toContain(
      'Choose another preset in the GitLab settings, or with update_settings.',
    );
  });
});
