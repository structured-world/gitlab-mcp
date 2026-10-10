/**
 * Unit tests for ContextManager
 *
 * manage_context acts on the caller of the running tool call and its current session,
 * through the configuration service: presets and scopes are session overrides, another
 * caller's or another session's context never changes, and reset brings back the
 * account settings.
 */

let mockGitLabBaseUrl = 'https://gitlab.example.com';
let mockGitLabReadOnlyMode = false;

jest.mock('../../../../src/config', () => ({
  get GITLAB_BASE_URL() {
    return mockGitLabBaseUrl;
  },
  get GITLAB_READ_ONLY_MODE() {
    return mockGitLabReadOnlyMode;
  },
}));

jest.mock('../../../../src/utils/namespace', () => ({
  detectNamespaceType: jest.fn(),
}));

jest.mock('../../../../src/server', () => ({
  sendToolsListChangedNotification: jest.fn().mockResolvedValue(undefined),
}));

const mockClearNamespaceTierCache = jest.fn();
jest.mock('../../../../src/services/NamespaceTierDetector', () => ({
  clearNamespaceTierCache: () => mockClearNamespaceTierCache(),
  detectNamespaceTier: jest.fn(),
}));

const mockReinitialize = jest.fn();
const mockGetCurrentInstanceUrl = jest.fn().mockReturnValue('https://gitlab.example.com');
jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: () => ({
      reinitialize: mockReinitialize,
      getCurrentInstanceUrl: mockGetCurrentInstanceUrl,
    }),
  },
}));

const mockPresets: Record<string, unknown> = {
  readonly: { description: 'Read-only preset', read_only: true },
  developer: { description: 'Developer preset', read_only: false },
  'multi-projects': { scope: { projects: ['team/project1', 'team/project2', 'team/project3'] } },
  'multi-groups': { scope: { groups: ['team-a', 'team-b'], includeSubgroups: true } },
  'namespace-scope': { scope: { namespace: 'my-namespace', includeSubgroups: true } },
  'single-project-scope': { scope: { projects: ['only-project'] } },
  'single-group-scope': { scope: { groups: ['only-group'] } },
  'empty-scope': { scope: { includeSubgroups: true } },
};

const mockLoadPreset = jest.fn((name: string) =>
  mockPresets[name]
    ? Promise.resolve(mockPresets[name])
    : Promise.reject(new Error(`Preset not found: ${name}`)),
);

jest.mock('../../../../src/profiles/loader', () => ({
  ProfileLoader: jest.fn().mockImplementation(() => ({
    listProfiles: jest.fn().mockResolvedValue([
      { name: 'readonly', readOnly: true, isBuiltIn: true, isPreset: true },
      { name: 'developer', readOnly: false, isBuiltIn: true, isPreset: true },
      {
        name: 'production',
        host: 'gitlab.example.com',
        readOnly: false,
        isBuiltIn: false,
        isPreset: false,
      },
    ]),
    loadPreset: (name: string) => mockLoadPreset(name),
    loadProfile: jest.fn().mockImplementation((name: string) => {
      if (name === 'invalid-profile') {
        return Promise.reject(new Error('Profile not found: invalid-profile'));
      }
      if (name === 'override-api-url') {
        return Promise.resolve({
          host: 'gitlab.example.com',
          api_url: 'https://api.example.com',
          auth: { type: 'pat', token_env: 'GITLAB_TOKEN' },
        });
      }
      return Promise.resolve({
        host: 'gitlab.example.com',
        auth: { type: 'pat', token_env: 'GITLAB_TOKEN' },
      });
    }),
  })),
}));

// A real configuration service over an in-memory store; notifications are recorded.
const mockNotified: string[][] = [];
let mockService: unknown;
jest.mock('../../../../src/configuration', () => {
  const actual = jest.requireActual('../../../../src/configuration/caller');
  return {
    ...actual,
    getConfigurationService: () => mockService,
  };
});

import {
  ContextManager,
  getContextManager,
} from '../../../../src/entities/context/context-manager';
import { detectNamespaceType } from '../../../../src/utils/namespace';
import { sendToolsListChangedNotification } from '../../../../src/server';
import { ConfigurationService } from '../../../../src/configuration/service';
import { runWithCaller, type Caller } from '../../../../src/configuration/caller';
import type { AccountSettingsRecord, AccountSettings } from '../../../../src/configuration/types';

const mockDetectNamespaceType = detectNamespaceType as jest.MockedFunction<
  typeof detectNamespaceType
>;
const mockSendToolsListChangedNotification =
  sendToolsListChangedNotification as jest.MockedFunction<typeof sendToolsListChangedNotification>;

function memoryStore() {
  const records = new Map<string, AccountSettingsRecord>();
  return {
    records,
    get: async (key: string) => records.get(key),
    put: async (key: string, settings: AccountSettings, expected: number) => {
      const version = records.get(key)?.version ?? 0;
      if (version !== expected) return undefined;
      const record = { accountKey: key, settings, version: version + 1, updatedAt: 1 };
      records.set(key, record);
      return record;
    },
  };
}

function caller(accountKey: string, sessionKey: string): Caller {
  return {
    accountKey,
    sessionKey,
    accountLabel: accountKey,
    instanceUrl: 'https://gitlab.example.com',
    oauth: false,
  };
}

const alice1 = caller('alice', 's1');
const alice2 = caller('alice', 's2');
const bob = caller('bob', 's3');

describe('ContextManager', () => {
  const originalEnv = process.env;
  let store: ReturnType<typeof memoryStore>;
  let service: ConfigurationService;

  beforeEach(() => {
    ContextManager.resetInstance();
    jest.clearAllMocks();
    mockNotified.length = 0;
    mockGitLabBaseUrl = 'https://gitlab.example.com';
    mockGitLabReadOnlyMode = false;
    mockReinitialize.mockReset();
    process.env = { ...originalEnv, OAUTH_ENABLED: 'false' };
    store = memoryStore();
    service = new ConfigurationService(
      async () => store,
      { load: (name) => mockLoadPreset(name) },
      async (keys) => {
        mockNotified.push([...keys]);
      },
    );
    mockService = service;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('singleton pattern', () => {
    it('returns the same instance until reset', () => {
      const first = ContextManager.getInstance();
      expect(ContextManager.getInstance()).toBe(first);
      expect(getContextManager()).toBe(first);
      ContextManager.resetInstance();
      expect(ContextManager.getInstance()).not.toBe(first);
    });
  });

  describe('getContext', () => {
    it('reports the operator configuration for a caller without settings', async () => {
      const context = await runWithCaller(alice1, () => getContextManager().getContext());

      expect(context).toMatchObject({
        host: 'gitlab.example.com',
        apiUrl: 'https://gitlab.example.com',
        readOnly: false,
        oauthMode: false,
        presetName: undefined,
        scope: undefined,
      });
      expect(context.initialContext).toEqual({
        host: 'gitlab.example.com',
        apiUrl: 'https://gitlab.example.com',
        readOnly: false,
        oauthMode: false,
      });
    });

    it('reports the operator read-only mode', async () => {
      mockGitLabReadOnlyMode = true;

      expect((await getContextManager().getContext()).readOnly).toBe(true);
    });

    it('reports OAuth mode', async () => {
      process.env.OAUTH_ENABLED = 'true';

      expect((await getContextManager().getContext()).oauthMode).toBe(true);
    });

    it('uses the server instance outside a tool call', async () => {
      mockGitLabBaseUrl = 'https://other.example.com';

      expect((await getContextManager().getContext()).host).toBe('other.example.com');
    });

    // A configured instance that is not a URL is shown as configured rather than failing.
    it('shows an instance that is not a URL as it is', async () => {
      const context = await runWithCaller({ ...alice1, instanceUrl: 'gitlab-internal' }, () =>
        getContextManager().getContext(),
      );

      expect(context.host).toBe('gitlab-internal');
    });

    it('reports the account settings of the caller', async () => {
      await service.updateAccount(alice1, { preset: 'readonly' });

      const context = await runWithCaller(alice2, () => getContextManager().getContext());

      expect(context).toMatchObject({ presetName: 'readonly', readOnly: true });
    });
  });

  describe('listPresets and listProfiles', () => {
    it('lists the presets', async () => {
      const presets = await getContextManager().listPresets();

      expect(presets.map((p) => p.name)).toEqual(['readonly', 'developer']);
    });

    it('refuses to list profiles outside OAuth mode', async () => {
      await expect(getContextManager().listProfiles()).rejects.toThrow(
        'only available in OAuth mode',
      );
    });

    it('lists only full profiles in OAuth mode', async () => {
      process.env.OAUTH_ENABLED = 'true';

      const profiles = await getContextManager().listProfiles();

      expect(profiles.map((p) => p.name)).toEqual(['production']);
    });
  });

  describe('switchPreset', () => {
    it('switches the current session and reports the previous preset', async () => {
      const manager = getContextManager();

      await runWithCaller(alice1, () => manager.switchPreset('developer'));
      const result = await runWithCaller(alice1, () => manager.switchPreset('readonly'));

      expect(result).toEqual({
        success: true,
        previous: 'developer',
        current: 'readonly',
        message: "Switched this session to preset 'readonly'",
      });
    });

    // The defect this replaces: a preset switched in one chat applied to every user.
    it('changes only the calling session', async () => {
      const manager = getContextManager();

      await runWithCaller(alice1, () => manager.switchPreset('readonly'));

      expect((await runWithCaller(alice1, () => manager.getContext())).readOnly).toBe(true);
      expect((await runWithCaller(alice2, () => manager.getContext())).readOnly).toBe(false);
      expect((await runWithCaller(bob, () => manager.getContext())).presetName).toBeUndefined();
    });

    it('notifies only the calling session', async () => {
      await runWithCaller(alice1, () => getContextManager().switchPreset('readonly'));

      expect(mockNotified).toEqual([['s1']]);
      expect(mockSendToolsListChangedNotification).not.toHaveBeenCalled();
    });

    it('keeps the account default for other sessions', async () => {
      await service.updateAccount(alice1, { preset: 'developer' });

      await runWithCaller(alice1, () => getContextManager().switchPreset('readonly'));

      expect(store.records.get('alice')?.settings).toEqual({ preset: 'developer' });
    });

    it('refuses an unknown preset and changes nothing', async () => {
      await expect(
        runWithCaller(alice1, () => getContextManager().switchPreset('invalid-preset')),
      ).rejects.toThrow("Failed to switch to preset 'invalid-preset'");

      expect(
        (await runWithCaller(alice1, () => getContextManager().getContext())).presetName,
      ).toBeUndefined();
    });

    it('drops the preset scope when switching to a preset without one', async () => {
      const manager = getContextManager();
      await runWithCaller(alice1, () => manager.switchPreset('multi-groups'));
      await runWithCaller(alice1, () => manager.switchPreset('readonly'));

      expect((await runWithCaller(alice1, () => manager.getContext())).scope).toBeUndefined();
    });
  });

  describe('switchProfile and getCurrentProfileUrl', () => {
    it('refuses to switch profiles outside OAuth mode', async () => {
      await expect(getContextManager().switchProfile('production')).rejects.toThrow(
        'only available in OAuth mode',
      );
    });

    it('switches the session profile in OAuth mode and resolves its URL', async () => {
      process.env.OAUTH_ENABLED = 'true';
      const manager = getContextManager();

      const result = await runWithCaller(alice1, () => manager.switchProfile('production'));

      expect(result).toMatchObject({ success: true, current: 'production' });
      await expect(runWithCaller(alice1, () => manager.getCurrentProfileUrl())).resolves.toBe(
        'https://gitlab.example.com',
      );
      await expect(runWithCaller(alice2, () => manager.getCurrentProfileUrl())).resolves.toBeNull();
    });

    it('prefers the profile api_url over the host', async () => {
      process.env.OAUTH_ENABLED = 'true';
      const manager = getContextManager();
      await runWithCaller(alice1, () => manager.switchProfile('override-api-url'));

      await expect(runWithCaller(alice1, () => manager.getCurrentProfileUrl())).resolves.toBe(
        'https://api.example.com',
      );
    });

    it('refuses an unknown profile', async () => {
      process.env.OAUTH_ENABLED = 'true';

      await expect(getContextManager().switchProfile('invalid-profile')).rejects.toThrow(
        "Failed to switch to profile 'invalid-profile'",
      );
    });
  });

  describe('setScope', () => {
    it.each([
      ['group', 'my-group', true, { type: 'group', path: 'my-group', includeSubgroups: true }],
      ['group', 'my-group', false, { type: 'group', path: 'my-group', includeSubgroups: false }],
      ['project', 'g/p', true, { type: 'project', path: 'g/p', includeSubgroups: false }],
    ] as const)(
      'sets a detected %s scope for the session',
      async (type, namespace, includeSubgroups, expected) => {
        mockDetectNamespaceType.mockResolvedValue(type);
        const manager = getContextManager();

        const result = await runWithCaller(alice1, () =>
          manager.setScope(namespace, includeSubgroups),
        );

        expect(result.scope).toEqual({ ...expected, detected: true });
        expect((await runWithCaller(alice1, () => manager.getContext())).scope).toEqual({
          ...expected,
          detected: true,
        });
        expect((await runWithCaller(alice2, () => manager.getContext())).scope).toBeUndefined();
      },
    );

    it('reports a namespace that cannot be resolved', async () => {
      mockDetectNamespaceType.mockRejectedValue(new Error('API error'));

      await expect(getContextManager().setScope('missing')).rejects.toThrow(
        "Failed to set scope for 'missing': API error",
      );
    });
  });

  describe('reset', () => {
    it('drops the session overrides and keeps the account settings', async () => {
      mockDetectNamespaceType.mockResolvedValue('group');
      await service.updateAccount(alice1, { preset: 'developer' });
      const manager = getContextManager();
      await runWithCaller(alice1, () => manager.switchPreset('readonly'));
      await runWithCaller(alice1, () => manager.setScope('my-group'));

      const result = await runWithCaller(alice1, () => manager.reset());

      expect(result.success).toBe(true);
      expect(result.context).toMatchObject({ presetName: 'developer', scope: undefined });
    });
  });

  describe('scopes of presets', () => {
    it.each([
      [
        'multi-projects',
        {
          type: 'project',
          path: 'team/project1',
          additionalPaths: ['team/project2', 'team/project3'],
        },
      ],
      [
        'multi-groups',
        { type: 'group', path: 'team-a', additionalPaths: ['team-b'], includeSubgroups: true },
      ],
      ['namespace-scope', { type: 'group', path: 'my-namespace', includeSubgroups: true }],
      [
        'single-project-scope',
        { type: 'project', path: 'only-project', additionalPaths: undefined },
      ],
      ['single-group-scope', { type: 'group', path: 'only-group', additionalPaths: undefined }],
    ])('shows the scope of preset %s', async (preset, expected) => {
      const manager = getContextManager();
      await runWithCaller(alice1, () => manager.switchPreset(preset));

      const context = await runWithCaller(alice1, () => manager.getContext());

      expect(context.scope).toMatchObject({ ...expected, detected: false });
    });

    it('reports a preset scope without any target', async () => {
      const manager = getContextManager();
      await runWithCaller(alice1, () => manager.switchPreset('empty-scope'));

      await expect(runWithCaller(alice1, () => manager.getContext())).rejects.toThrow(
        'Invalid scope configuration',
      );
    });
  });

  describe('switchInstance', () => {
    it('refuses in OAuth mode', async () => {
      process.env.OAUTH_ENABLED = 'true';

      await expect(getContextManager().switchInstance('https://other.example.com')).rejects.toThrow(
        'Cannot switch instances in OAuth mode',
      );
    });

    it('refuses an instance that is not configured', async () => {
      await expect(
        getContextManager().switchInstance('https://unknown-gitlab.com'),
      ).rejects.toThrow('Instance not configured');
    });

    it('switches, notifies every session and clears the session scope', async () => {
      const { InstanceRegistry } = await import('../../../../src/services/InstanceRegistry');
      InstanceRegistry.getInstance().register({
        url: 'https://success-gitlab.example.com',
        label: 'Success GitLab',
        insecureSkipVerify: false,
      });
      mockReinitialize.mockResolvedValue(undefined);
      mockDetectNamespaceType.mockResolvedValue('group');
      const manager = getContextManager();
      await runWithCaller(alice1, () => manager.setScope('my-group'));

      const result = await runWithCaller(alice1, () =>
        manager.switchInstance('https://success-gitlab.example.com'),
      );

      expect(result).toMatchObject({
        success: true,
        previous: 'https://gitlab.example.com',
        current: 'https://success-gitlab.example.com',
      });
      expect(result.message).toContain('Success GitLab');
      expect(mockClearNamespaceTierCache).toHaveBeenCalled();
      expect(mockReinitialize).toHaveBeenCalledWith('https://success-gitlab.example.com');
      expect(mockSendToolsListChangedNotification).toHaveBeenCalled();
      expect((await runWithCaller(alice1, () => manager.getContext())).scope).toBeUndefined();
    });

    it('reports a failed reconnection', async () => {
      const { InstanceRegistry } = await import('../../../../src/services/InstanceRegistry');
      InstanceRegistry.getInstance().register({
        url: 'https://broken-gitlab.example.com',
        label: 'Broken',
        insecureSkipVerify: false,
      });
      mockReinitialize.mockRejectedValue(new Error('unreachable'));

      await expect(
        getContextManager().switchInstance('https://broken-gitlab.example.com'),
      ).rejects.toThrow("Failed to switch to instance 'https://broken-gitlab.example.com'");
    });
  });
});
