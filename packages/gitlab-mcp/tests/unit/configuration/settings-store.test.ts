/**
 * A local server keeps account settings in a file shared by every local server process.
 * Writes are compare-and-set against the file itself, so processes do not lose each
 * other's edits, and a lock left by a crashed process does not block forever.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalSettingsFile, localSettingsPath } from '../../../src/configuration/settings-store';

// The test setup keeps every test away from the user's own settings file.
it('points tests at a temporary settings file, not the home directory', () => {
  expect(localSettingsPath().startsWith(os.tmpdir())).toBe(true);
  expect(localSettingsPath().startsWith(os.homedir())).toBe(false);
});

// The real location, read without touching it.
it('keeps a server settings in the user configuration directory', () => {
  const actual = jest.requireActual<typeof import('../../../src/configuration/settings-store')>(
    '../../../src/configuration/settings-store',
  );

  expect(actual.localSettingsPath()).toBe(
    path.join(os.homedir(), '.config', 'gitlab-mcp', 'settings.json'),
  );
});

describe('LocalSettingsFile', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-store-test-'));
    filePath = path.join(dir, 'nested', 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('has no settings before the first write', async () => {
    expect(await new LocalSettingsFile(filePath).get('acct')).toBeUndefined();
  });

  it('writes the first settings at version 1 and creates the directory', async () => {
    const store = new LocalSettingsFile(filePath);

    const stored = await store.put('acct', { readOnly: true }, 0);

    expect(stored).toMatchObject({ accountKey: 'acct', settings: { readOnly: true }, version: 1 });
    expect(await store.get('acct')).toEqual(stored);
  });

  // The file holds account choices only, but stays private to the user like the rest.
  it('writes the file owner-only', async () => {
    await new LocalSettingsFile(filePath).put('acct', { readOnly: true }, 0);

    if (process.platform !== 'win32') {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses a write against a stale version and keeps the newer settings', async () => {
    const store = new LocalSettingsFile(filePath);
    await store.put('acct', { preset: 'developer' }, 0);
    await store.put('acct', { preset: 'pm' }, 1);

    expect(await store.put('acct', { preset: 'readonly' }, 1)).toBeUndefined();
    expect((await store.get('acct'))?.settings).toEqual({ preset: 'pm' });
  });

  // Two local server processes: each reads the file on every call, so the second one
  // sees the first one's write and its stale edit is refused.
  it('shares settings between two stores of one file', async () => {
    const first = new LocalSettingsFile(filePath);
    const second = new LocalSettingsFile(filePath);
    await first.put('acct', { readOnly: true }, 0);

    expect((await second.get('acct'))?.settings).toEqual({ readOnly: true });
    expect(await second.put('acct', { readOnly: false }, 0)).toBeUndefined();
  });

  it('lets exactly one of concurrent writes of one version win', async () => {
    const results = await Promise.all([
      new LocalSettingsFile(filePath).put('acct', { preset: 'a' }, 0),
      new LocalSettingsFile(filePath).put('acct', { preset: 'b' }, 0),
      new LocalSettingsFile(filePath).put('acct', { preset: 'c' }, 0),
    ]);

    expect(results.filter((r) => r !== undefined)).toHaveLength(1);
    expect(fs.existsSync(`${filePath}.lock`)).toBe(false);
  });

  it('keeps the settings of other accounts when one account writes', async () => {
    const store = new LocalSettingsFile(filePath);
    await store.put('one', { readOnly: true }, 0);
    await store.put('two', { preset: 'pm' }, 0);

    expect((await store.get('one'))?.settings).toEqual({ readOnly: true });
  });

  // Two writers see the same dead lock; one removes it and a third process takes a fresh
  // lock before the second writer acts. The fresh lock must survive, or two writers would
  // be inside the read-compare-write at once.
  it('does not remove a fresh lock taken after the dead one was seen', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const lock = `${filePath}.lock`;
    fs.writeFileSync(lock, '');
    const longAgo = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, longAgo, longAgo);
    const realStat = fs.promises.stat.bind(fs.promises);
    jest.spyOn(fs.promises, 'stat').mockImplementationOnce(async (target) => {
      const dead = await realStat(target);
      // Another process replaced the dead lock with its own meanwhile.
      fs.rmSync(lock);
      fs.writeFileSync(lock, 'fresh');
      return dead;
    });

    try {
      const write = new LocalSettingsFile(filePath).put('acct', { readOnly: true }, 0);
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(fs.readFileSync(lock, 'utf-8')).toBe('fresh');
      fs.rmSync(lock);
      expect(await write).toBeDefined();
    } finally {
      jest.restoreAllMocks();
    }
  });

  // Another writer claimed the dead lock first: the rename fails and the lock is tried again.
  it('tries again when another writer claimed the dead lock first', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const lock = `${filePath}.lock`;
    fs.writeFileSync(lock, '');
    const longAgo = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, longAgo, longAgo);
    jest
      .spyOn(fs.promises, 'rename')
      .mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    try {
      expect(
        await new LocalSettingsFile(filePath).put('acct', { readOnly: true }, 0),
      ).toBeDefined();
    } finally {
      jest.restoreAllMocks();
    }
  });

  // The fresh lock could not be handed back because a newer one took the path: that newer
  // lock stays, and the claimed copy is not left behind.
  it('keeps a newer lock when a fresh one cannot be handed back', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const lock = `${filePath}.lock`;
    fs.writeFileSync(lock, '');
    const longAgo = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, longAgo, longAgo);
    const realStat = fs.promises.stat.bind(fs.promises);
    jest.spyOn(fs.promises, 'stat').mockImplementationOnce(async (target) => {
      const dead = await realStat(target);
      fs.rmSync(lock);
      fs.writeFileSync(lock, 'fresh');
      return dead;
    });
    jest
      .spyOn(fs.promises, 'link')
      .mockRejectedValueOnce(Object.assign(new Error('EEXIST'), { code: 'EEXIST' }));

    try {
      expect(
        await new LocalSettingsFile(filePath).put('acct', { readOnly: true }, 0),
      ).toBeDefined();
      expect(fs.readdirSync(path.dirname(filePath)).filter((f) => f.endsWith('.stale'))).toEqual(
        [],
      );
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('removes a lock left by a process that died while holding it', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const lock = `${filePath}.lock`;
    fs.writeFileSync(lock, '');
    const longAgo = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, longAgo, longAgo);

    expect(await new LocalSettingsFile(filePath).put('acct', { readOnly: true }, 0)).toBeDefined();
  });

  // A hand-edited entry the schema refuses is ignored instead of applied half-valid.
  it('ignores an entry with invalid settings', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        accounts: {
          bad: { accountKey: 'bad', settings: { readOnly: 'yes' }, version: 1, updatedAt: 1 },
          good: { accountKey: 'good', settings: { readOnly: true }, version: 1, updatedAt: 1 },
        },
      }),
    );
    const store = new LocalSettingsFile(filePath);

    expect(await store.get('bad')).toBeUndefined();
    expect((await store.get('good'))?.settings).toEqual({ readOnly: true });
  });

  // One hand-edited entry of the wrong shape must not fail every call of the server.
  it.each([
    ['an entry that is null', { bad: null }],
    ['an entry that is not an object', { bad: 'readOnly' }],
  ])('skips %s and reads the others', async (_label, broken) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        accounts: {
          ...broken,
          good: { accountKey: 'good', settings: { readOnly: true }, version: 1, updatedAt: 1 },
        },
      }),
    );
    const store = new LocalSettingsFile(filePath);

    expect(await store.get('bad')).toBeUndefined();
    expect((await store.get('good'))?.settings).toEqual({ readOnly: true });
  });

  it('reads accounts that are not an object as none', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, accounts: [{ settings: {} }] }));

    expect(await new LocalSettingsFile(filePath).get('0')).toBeUndefined();
  });

  it.each(['null', '[]', '"text"'])(
    'reports a file whose content %s is not an object',
    async (content) => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);

      await expect(new LocalSettingsFile(filePath).get('acct')).rejects.toThrow(
        `Settings file is not a JSON object: ${filePath}`,
      );
    },
  );

  it('reports a file that is not JSON instead of treating it as empty', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{ not json');

    await expect(new LocalSettingsFile(filePath).get('acct')).rejects.toThrow(SyntaxError);
  });

  // Without syncing the directory, a crash after the rename can bring the old file back.
  it('syncs the directory after replacing the file', async () => {
    if (process.platform === 'win32') return;
    const open = jest.spyOn(fs.promises, 'open');
    try {
      await new LocalSettingsFile(filePath).put('acct', { readOnly: true }, 0);

      expect(open).toHaveBeenCalledWith(path.dirname(filePath), 'r');
    } finally {
      open.mockRestore();
    }
  });

  it('reads a file without accounts as empty', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ version: 1 }));

    expect(await new LocalSettingsFile(filePath).get('acct')).toBeUndefined();
  });

  // Only a missing file means "no settings yet"; an unreadable one is an error.
  it('reports a file it cannot read instead of treating it as empty', async () => {
    fs.mkdirSync(filePath, { recursive: true });

    await expect(new LocalSettingsFile(filePath).get('acct')).rejects.toMatchObject({
      code: 'EISDIR',
    });
  });

  describe('lock', () => {
    const errno = (code: string) => Object.assign(new Error(code), { code });

    afterEach(() => {
      jest.restoreAllMocks();
      jest.useRealTimers();
    });

    it('reports a lock it cannot create for a reason other than contention', async () => {
      jest.spyOn(fs.promises, 'open').mockRejectedValueOnce(errno('EACCES'));

      await expect(
        new LocalSettingsFile(filePath).put('acct', { readOnly: true }, 0),
      ).rejects.toMatchObject({ code: 'EACCES' });
    });

    // The holder released the lock between the failed create and the age check.
    it('retries at once when the lock disappears while being checked', async () => {
      jest.spyOn(fs.promises, 'open').mockRejectedValueOnce(errno('EEXIST'));
      jest.spyOn(fs.promises, 'stat').mockRejectedValueOnce(errno('ENOENT'));

      expect(
        await new LocalSettingsFile(filePath).put('acct', { readOnly: true }, 0),
      ).toBeDefined();
    });

    // A live process holding the lock for longer than the wait: give up with a clear error.
    it('gives up on a lock another live process keeps holding', async () => {
      jest.useFakeTimers();
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      jest.spyOn(fs.promises, 'open').mockRejectedValue(errno('EEXIST'));
      jest
        .spyOn(fs.promises, 'stat')
        .mockResolvedValue({ mtimeMs: Date.now() } as unknown as fs.Stats);

      const write = new LocalSettingsFile(filePath).put('acct', { readOnly: true }, 0);
      const outcome = expect(write).rejects.toThrow(
        `Settings file is locked by another process: ${filePath}.lock`,
      );
      await jest.advanceTimersByTimeAsync(10_000);
      await outcome;
    });
  });
});
