/**
 * Settings across server processes. Every replica loads its own module graph (its own
 * configuration service, session overrides and caches) and shares only the storage
 * backend, like processes behind a load balancer sharing a database. Account settings
 * saved on one replica apply on the others and survive a restart; chat overrides and other
 * accounts stay apart.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SessionStorageBackend } from '../../../src/oauth/storage/types';
import type { Caller } from '../../../src/configuration/caller';
import type { ConfigurationService } from '../../../src/configuration/service';
import { MemoryStorageBackend } from '../../../src/oauth/storage/memory';
import { FileStorageBackend } from '../../../src/oauth/storage/file';

interface Replica {
  service: ConfigurationService;
  close(): Promise<void>;
}

async function startReplica(shared: SessionStorageBackend): Promise<Replica> {
  let replica: Replica | undefined;
  // Without it a later replica can get a storage mock instantiated for an earlier one.
  jest.resetModules();
  await jest.isolateModulesAsync(async () => {
    jest.doMock('../../../src/oauth/storage/factory', () => ({
      createStorageBackend: () => shared,
    }));
    const { getConfigurationService } = await import('../../../src/configuration');
    const { sessionStore } = await import('../../../src/oauth/session-store');
    const service = getConfigurationService();
    // The premise of every test here: the replica stores through the shared backend.
    if ((sessionStore as unknown as { backend: unknown }).backend !== shared) {
      throw new Error('The replica does not use the shared storage backend');
    }
    replica = {
      service,
      close: async () => {
        sessionStore.stopCleanupInterval();
        await shared.close();
      },
    };
  });
  return replica!;
}

function caller(gitlabUserId: number, sessionKey: string): Caller {
  return {
    accountKey: `gitlab:https://gitlab.example.com#${gitlabUserId}`,
    sessionKey,
    accountLabel: `user-${gitlabUserId}`,
    instanceUrl: 'https://gitlab.example.com',
    oauth: true,
  };
}

const alice = (session: string) => caller(1, session);
const bob = (session: string) => caller(2, session);

describe('settings across replicas', () => {
  const originalStorage = process.env.OAUTH_STORAGE_TYPE;
  let dir: string;

  beforeEach(() => {
    // A configured session storage keeps settings with the sessions, shared by replicas.
    process.env.OAUTH_STORAGE_TYPE = 'file';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-replicas-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalStorage === undefined) delete process.env.OAUTH_STORAGE_TYPE;
    else process.env.OAUTH_STORAGE_TYPE = originalStorage;
  });

  it('applies account settings saved on one replica on another, for that account only', async () => {
    const shared = new MemoryStorageBackend({ silent: true });
    const first = await startReplica(shared);
    const second = await startReplica(shared);

    await first.service.updateAccount(alice('chat-1'), { preset: 'readonly' });

    const aliceElsewhere = await second.service.resolve(alice('chat-2'));
    const bobElsewhere = await second.service.resolve(bob('chat-3'));
    expect(aliceElsewhere.policy).toMatchObject({ presetName: 'readonly', readOnly: true });
    expect(bobElsewhere.policy).toMatchObject({ presetName: undefined, readOnly: false });
    await first.close();
  });

  it('keeps a chat override in its chat, on its replica', async () => {
    const shared = new MemoryStorageBackend({ silent: true });
    const first = await startReplica(shared);
    const second = await startReplica(shared);

    await first.service.updateSession(alice('chat-1'), { readOnly: true });

    expect((await first.service.resolve(alice('chat-1'))).policy.readOnly).toBe(true);
    expect((await first.service.resolve(alice('chat-2'))).policy.readOnly).toBe(false);
    expect((await second.service.resolve(alice('chat-1'))).policy.readOnly).toBe(false);
    expect((await first.service.resolve(bob('chat-1'))).policy.readOnly).toBe(false);
    await first.close();
  });

  // Two replicas save different settings of one account at the same time: both are kept.
  it('keeps concurrent edits of different settings from two replicas', async () => {
    const shared = new MemoryStorageBackend({ silent: true });
    const first = await startReplica(shared);
    const second = await startReplica(shared);

    await Promise.all([
      first.service.updateAccount(alice('chat-1'), { readOnly: true }),
      second.service.updateAccount(alice('chat-2'), { disabledToolGroups: ['wiki'] }),
    ]);

    expect((await first.service.resolve(alice('chat-3'))).account).toEqual({
      readOnly: true,
      disabledToolGroups: ['wiki'],
    });
    await first.close();
  });

  it('keeps account settings across a restart, and not chat overrides', async () => {
    const filePath = path.join(dir, 'sessions.json');
    const before = await startReplica(new FileStorageBackend({ filePath }));
    await before.service.updateAccount(alice('chat-1'), {
      scope: { type: 'group', path: 'team', includeSubgroups: true },
    });
    await before.service.updateSession(alice('chat-1'), { readOnly: true });
    await before.close();

    const after = await startReplica(new FileStorageBackend({ filePath }));
    const resolved = await after.service.resolve(alice('chat-1'));

    expect(resolved.account.scope).toEqual({ type: 'group', path: 'team', includeSubgroups: true });
    expect(resolved.accountVersion).toBe(1);
    expect(resolved.session).toEqual({});
    expect(resolved.policy.readOnly).toBe(false);
    await after.close();
  });
});
