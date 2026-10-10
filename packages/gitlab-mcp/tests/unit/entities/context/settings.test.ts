/**
 * Native settings (OpenAI structured settings): the page lists every setting with a value,
 * a patch changes only the fields it names, nothing is saved when any value is invalid,
 * and nothing the operator configured can be loosened from the page.
 */

let mockReadOnlyMode = false;
jest.mock('../../../../src/config', () => ({
  GITLAB_BASE_URL: 'https://gitlab.example.com',
  get GITLAB_READ_ONLY_MODE() {
    return mockReadOnlyMode;
  },
}));

let mockService: unknown;
jest.mock('../../../../src/configuration', () => ({
  ...jest.requireActual('../../../../src/configuration/caller'),
  ConfigurationError: jest.requireActual('../../../../src/configuration/service')
    .ConfigurationError,
  getConfigurationService: () => mockService,
}));

const mockRegistryKeys = jest.fn();
jest.mock('../../../../src/registry-manager', () => ({
  RegistryManager: { getInstance: () => ({ getRegistryKeys: mockRegistryKeys }) },
}));

jest.mock('../../../../src/entities/context/context-manager', () => ({
  getContextManager: () => ({
    listPresets: async () => [
      { name: 'readonly', readOnly: true, isBuiltIn: true },
      { name: 'developer', readOnly: false, isBuiltIn: true },
    ],
  }),
}));

const mockDetect = jest.fn();
jest.mock('../../../../src/utils/namespace', () => ({
  detectNamespaceType: (path: string) => mockDetect(path),
}));

import { ConfigurationService } from '../../../../src/configuration/service';
import { runWithCaller, type Caller } from '../../../../src/configuration/caller';
import type { AccountSettings, AccountSettingsRecord } from '../../../../src/configuration/types';
import { readSettings, updateSettings } from '../../../../src/entities/context/settings';

const alice: Caller = {
  accountKey: 'alice',
  sessionKey: 's1',
  accountLabel: 'alice',
  instanceUrl: 'https://gitlab.example.com',
  oauth: true,
};

describe('native settings', () => {
  let records: Map<string, AccountSettingsRecord>;

  const saved = () => records.get('alice')?.settings;
  const read = () => runWithCaller(alice, () => readSettings());
  const update = (set: Record<string, string | number | boolean>) =>
    runWithCaller(alice, () => updateSettings(set));

  beforeEach(() => {
    mockReadOnlyMode = false;
    mockRegistryKeys.mockReturnValue(['core', 'context', 'mrs', 'wiki', 'job-token-scope']);
    mockDetect.mockReset();
    records = new Map();
    mockService = new ConfigurationService(
      async () => ({
        get: async (key: string) => records.get(key),
        put: async (key: string, settings: AccountSettings, expected: number) => {
          const version = records.get(key)?.version ?? 0;
          if (version !== expected) return undefined;
          const record = { accountKey: key, settings, version: version + 1, updatedAt: 1 };
          records.set(key, record);
          return record;
        },
      }),
      {
        load: async (name: string) => {
          if (name !== 'readonly' && name !== 'developer') throw new Error('not found');
          return name === 'readonly' ? { read_only: true } : {};
        },
      },
      async () => undefined,
    );
  });

  describe('readSettings', () => {
    it('lists every setting with a value and marks all of them required', async () => {
      const page = await read();
      const names = Object.keys(page.schema.properties);

      expect(names).toEqual([
        'preset',
        'readOnly',
        'scope',
        'scopeIncludeSubgroups',
        'tools_mrs',
        'tools_wiki',
        'tools_ci_tokens',
      ]);
      expect(page.schema.required).toEqual(names);
      expect(Object.keys(page.values).sort()).toEqual([...names].sort());
      expect(page.values).toEqual({
        preset: 'none',
        readOnly: false,
        scope: '',
        scopeIncludeSubgroups: true,
        tools_mrs: true,
        tools_wiki: true,
        tools_ci_tokens: true,
      });
    });

    // Outside a tool call (a local server's own startup) the server's token account is used.
    it('reads the settings of the server account outside a tool call', async () => {
      const page = await readSettings();

      expect(page.layout[0].title).toBe(
        'Connection: Configured access token on gitlab.example.com',
      );
    });

    it('names an instance that is not a URL as configured', async () => {
      const page = await runWithCaller({ ...alice, instanceUrl: 'gitlab-internal' }, () =>
        readSettings(),
      );

      expect(page.layout[0].title).toBe('Connection: alice on gitlab-internal');
    });

    it('offers the presets of the server and no preset', async () => {
      expect((await read()).schema.properties.preset.enum).toEqual([
        'none',
        'readonly',
        'developer',
      ]);
    });

    // Only primitive settings exist; the layout references real properties and tools.
    it('lays out the settings and the connection actions', async () => {
      const page = await read();

      expect(page.layout.map((g) => g.title)).toEqual([
        'Connection: alice on gitlab.example.com',
        'Defaults for new chats',
        'Tool groups (groups the server administrator turned off are not listed)',
      ]);
      const properties = page.layout.flatMap((g) =>
        g.items.filter((i) => i.kind === 'property').map((i) => i.property),
      );
      expect(new Set(properties)).toEqual(new Set(Object.keys(page.schema.properties)));
      expect(page.layout[0].items.map((i) => i.tool)).toEqual([
        'check_connection',
        'open_settings_panel',
      ]);
      for (const property of Object.values(page.schema.properties)) {
        expect(['string', 'boolean']).toContain(property.type);
      }
    });

    it('shows read-only on and explains it when the operator set it', async () => {
      mockReadOnlyMode = true;

      const page = await read();

      expect(page.values.readOnly).toBe(true);
      expect(page.schema.properties.readOnly.description).toContain('server administrator');
    });

    // The saved preset was removed: the page still shows it and says what happens.
    it('keeps a removed saved preset visible and explains the read-only fallback', async () => {
      records.set('alice', {
        accountKey: 'alice',
        settings: { preset: 'gone' },
        version: 1,
        updatedAt: 1,
      });

      const page = await read();

      expect(page.values.preset).toBe('gone');
      expect(page.schema.properties.preset.enum).toContain('gone');
      expect(page.schema.properties.preset.description).toContain('no longer exists');
    });
  });

  describe('updateSettings', () => {
    it('saves the changed fields and returns the saved values', async () => {
      const result = await update({ preset: 'readonly', tools_wiki: false });

      expect(saved()).toEqual({ preset: 'readonly', disabledToolGroups: ['wiki'] });
      expect(result.values).toMatchObject({
        preset: 'readonly',
        tools_wiki: false,
        readOnly: false,
      });
    });

    it('keeps the fields a patch leaves out', async () => {
      await update({ readOnly: true });
      await update({ tools_mrs: false });

      expect(saved()).toEqual({ readOnly: true, disabledToolGroups: ['mrs'] });
    });

    it('clears the preset with none and turns a group back on', async () => {
      await update({ preset: 'developer', tools_wiki: false });

      await update({ preset: 'none', tools_wiki: true });

      expect(saved()).toEqual({});
    });

    // A group the operator hid since keeps the account's choice.
    it('keeps the choice for a group the server no longer offers', async () => {
      await update({ tools_wiki: false });
      mockRegistryKeys.mockReturnValue(['core', 'context', 'mrs']);

      await update({ tools_mrs: false });

      expect(saved()?.disabledToolGroups).toEqual(['mrs', 'wiki']);
    });

    it('saves a group scope with its subgroup choice after GitLab confirms it', async () => {
      mockDetect.mockResolvedValue('group');

      const result = await update({ scope: 'team', scopeIncludeSubgroups: false });

      expect(mockDetect).toHaveBeenCalledWith('team');
      expect(saved()?.scope).toEqual({ type: 'group', path: 'team', includeSubgroups: false });
      expect(result.values).toMatchObject({ scope: 'team', scopeIncludeSubgroups: false });
    });

    it('saves a project scope without subgroups', async () => {
      mockDetect.mockResolvedValue('project');

      await update({ scope: '  team/app  ' });

      expect(saved()?.scope).toEqual({
        type: 'project',
        path: 'team/app',
        includeSubgroups: false,
      });
    });

    it('changes the subgroup choice of the saved group scope', async () => {
      mockDetect.mockResolvedValue('group');
      await update({ scope: 'team', scopeIncludeSubgroups: true });

      await update({ scopeIncludeSubgroups: false });

      expect(saved()?.scope).toEqual({ type: 'group', path: 'team', includeSubgroups: false });
    });

    it('clears the scope with an empty path', async () => {
      mockDetect.mockResolvedValue('group');
      await update({ scope: 'team' });

      await update({ scope: '' });

      expect(saved()?.scope).toBeUndefined();
    });

    it.each([
      [{ bogus: true }, 'Unknown setting: bogus'],
      [{ readOnly: 'yes' }, 'Setting readOnly must be a boolean'],
      [{ preset: 'nonexistent' }, 'Setting preset must be one of: none, readonly, developer'],
      [{ tools_mrs: 1 }, 'Setting tools_mrs must be a boolean'],
    ])('refuses %j and saves nothing, also the valid field beside it', async (set, message) => {
      await expect(update({ tools_wiki: false, ...set })).rejects.toThrow(message);

      expect(saved()).toBeUndefined();
    });

    it('refuses a path GitLab does not know and saves nothing', async () => {
      mockDetect.mockRejectedValue(new Error('404 Not Found'));

      await expect(update({ scope: 'typo', readOnly: true })).rejects.toThrow(
        "No project or group 'typo' was found: 404 Not Found",
      );
      expect(saved()).toBeUndefined();
    });

    it('reports a lookup failure that is not an Error', async () => {
      mockDetect.mockRejectedValue('lookup aborted');

      await expect(update({ scope: 'team' })).rejects.toThrow(
        "No project or group 'team' was found: lookup aborted",
      );
    });

    it('refuses to turn off read-only mode the operator set', async () => {
      mockReadOnlyMode = true;

      await expect(update({ readOnly: false })).rejects.toThrow(
        'Read-only mode is set by the server administrator and cannot be turned off',
      );
      expect(saved()).toBeUndefined();
    });
  });
});
