/**
 * The configuration service keeps each account's settings and each session's overrides
 * apart, validates before it writes, merges concurrent edits of different fields, and
 * notifies only the sessions a change affects.
 */

import type { Caller } from '../../../src/configuration/caller';
import {
  ConfigurationError,
  ConfigurationService,
  type PresetSource,
} from '../../../src/configuration/service';
import type { SettingsStore } from '../../../src/configuration/settings-store';
import type { AccountSettings, AccountSettingsRecord } from '../../../src/configuration/types';
import type { Preset } from '../../../src/profiles/types';

/** In-memory compare-and-set store, with a hook to interleave a competing write. */
class FakeStore implements SettingsStore {
  records = new Map<string, AccountSettingsRecord>();
  beforePut?: () => Promise<void>;
  failPut = false;

  async get(accountKey: string): Promise<AccountSettingsRecord | undefined> {
    const record = this.records.get(accountKey);
    return record ? structuredClone(record) : undefined;
  }

  async put(
    accountKey: string,
    settings: AccountSettings,
    expectedVersion: number,
  ): Promise<AccountSettingsRecord | undefined> {
    const hook = this.beforePut;
    this.beforePut = undefined;
    await hook?.();
    if (this.failPut) throw new Error('database down');
    const version = this.records.get(accountKey)?.version ?? 0;
    if (version !== expectedVersion) return undefined;
    const record = { accountKey, settings, version: version + 1, updatedAt: 1 };
    this.records.set(accountKey, record);
    return structuredClone(record);
  }
}

const PRESETS: Record<string, Preset> = {
  readonly: { read_only: true },
  developer: { features: { wiki: false } },
};

const presets: PresetSource = {
  load: async (name) => {
    const preset = PRESETS[name];
    if (!preset) throw new Error('not found');
    return preset;
  },
};

function caller(accountKey: string, sessionKey: string): Caller {
  return {
    accountKey,
    sessionKey,
    accountLabel: accountKey,
    instanceUrl: 'https://gitlab.example.com',
    oauth: true,
  };
}

describe('ConfigurationService', () => {
  let store: FakeStore;
  let notified: string[][];
  let service: ConfigurationService;

  beforeEach(() => {
    store = new FakeStore();
    notified = [];
    service = new ConfigurationService(
      async () => store,
      presets,
      async (keys) => {
        notified.push([...keys].sort());
      },
    );
  });

  it('resolves a caller without settings to an unrestricted policy', async () => {
    const resolved = await service.resolve(caller('alice', 's1'));

    expect(resolved.account).toEqual({});
    expect(resolved.accountVersion).toBe(0);
    expect(resolved.policy.readOnly).toBe(false);
  });

  it('applies saved account settings to every session of the account', async () => {
    await service.updateAccount(caller('alice', 's1'), { preset: 'readonly' });

    const other = await service.resolve(caller('alice', 's2'));

    expect(other.policy).toMatchObject({ presetName: 'readonly', readOnly: true });
  });

  // Two users of one server: one account's settings never reach the other.
  it('keeps the settings of two accounts apart', async () => {
    await service.updateAccount(caller('alice', 's1'), { readOnly: true });

    expect((await service.resolve(caller('bob', 's2'))).policy.readOnly).toBe(false);
  });

  // Two chats of one user: a session override stays in its session.
  it('keeps a session override in its own session', async () => {
    await service.updateSession(caller('alice', 's1'), { readOnly: true });

    expect((await service.resolve(caller('alice', 's1'))).policy.readOnly).toBe(true);
    expect((await service.resolve(caller('alice', 's2'))).policy.readOnly).toBe(false);
  });

  // A session id is not a capability: another account presenting it gets nothing.
  it('does not share a session override with another account using the same session id', async () => {
    await service.updateSession(caller('alice', 'shared'), { preset: 'readonly' });

    expect((await service.resolve(caller('bob', 'shared'))).session).toEqual({});
  });

  it('keeps fields the patch leaves out and removes fields set to null', async () => {
    await service.updateAccount(caller('alice', 's1'), {
      preset: 'developer',
      disabledToolGroups: ['pipelines'],
    });

    const stored = await service.updateAccount(caller('alice', 's1'), {
      readOnly: true,
      preset: null,
    });

    expect(stored.settings).toEqual({ disabledToolGroups: ['pipelines'], readOnly: true });
  });

  // Another session saved a different field between this edit's read and its write:
  // the edit is re-applied on top, and neither change is lost.
  it('merges an edit with a concurrent edit of another field', async () => {
    store.beforePut = async () => {
      await store.put('alice', { readOnly: true }, 0);
    };

    const stored = await service.updateAccount(caller('alice', 's1'), { preset: 'developer' });

    expect(stored.settings).toEqual({ readOnly: true, preset: 'developer' });
    expect(stored.version).toBe(2);
  });

  it('reports settings that keep changing instead of looping forever', async () => {
    const put = store.put.bind(store);
    store.put = async () => undefined;

    await expect(service.updateAccount(caller('alice', 's1'), { readOnly: true })).rejects.toThrow(
      'The settings kept changing meanwhile; try again',
    );
    store.put = put;
  });

  it.each([
    [{ preset: 'nonexistent' }, /Unknown preset 'nonexistent'/],
    [{ disabledToolGroups: ['wiki', 'bogus'] }, /Unknown tool group: bogus/],
    [{ scope: { type: 'project' as const, path: '', includeSubgroups: false } }, /.+/],
  ])('refuses %j without writing anything', async (patch, message) => {
    await expect(service.updateAccount(caller('alice', 's1'), patch)).rejects.toThrow(message);

    expect(store.records.size).toBe(0);
    expect(notified).toEqual([]);
  });

  it('refuses an unknown preset for the session without changing it', async () => {
    await expect(
      service.updateSession(caller('alice', 's1'), { preset: 'nonexistent' }),
    ).rejects.toBeInstanceOf(ConfigurationError);

    expect((await service.resolve(caller('alice', 's1'))).session).toEqual({});
  });

  // A failed write is reported, never as saved settings.
  it('propagates a failed write without notifying anyone', async () => {
    store.failPut = true;

    await expect(service.updateAccount(caller('alice', 's1'), { readOnly: true })).rejects.toThrow(
      'database down',
    );
    expect(notified).toEqual([]);
  });

  it('notifies every session of the account on an account change, and only those', async () => {
    await service.resolve(caller('alice', 's1'));
    await service.resolve(caller('alice', 's2'));
    await service.resolve(caller('bob', 's3'));

    await service.updateAccount(caller('alice', 's1'), { readOnly: true });

    expect(notified).toEqual([['s1', 's2']]);
  });

  it('notifies only the session a session change affects', async () => {
    await service.resolve(caller('alice', 's2'));

    await service.updateSession(caller('alice', 's1'), { readOnly: true });

    expect(notified).toEqual([['s1']]);
  });

  it('drops the session overrides on reset', async () => {
    await service.updateSession(caller('alice', 's1'), { preset: 'readonly' });

    await service.resetSession(caller('alice', 's1'));

    expect((await service.resolve(caller('alice', 's1'))).session).toEqual({});
  });

  it('forgets a closed session and its overrides', async () => {
    await service.updateSession(caller('alice', 's1'), { readOnly: true });

    service.forgetSession('s1');
    await service.updateAccount(caller('alice', 's2'), { preset: 'developer' });

    expect(notified.at(-1)).toEqual(['s2']);
    expect((await service.resolve(caller('alice', 's1'))).session).toEqual({});
  });

  // The selected preset was deleted after it was saved: the caller keeps working read-only
  // and can still open the settings to choose another one.
  it('falls back to read-only when the selected preset is gone', async () => {
    store.records.set('alice', {
      accountKey: 'alice',
      settings: { preset: 'deleted' },
      version: 1,
      updatedAt: 1,
    });

    const resolved = await service.resolve(caller('alice', 's1'));

    expect(resolved.presetUnavailable).toBe('deleted');
    expect(resolved.policy).toMatchObject({ readOnly: true, presetName: 'deleted' });
  });
});
