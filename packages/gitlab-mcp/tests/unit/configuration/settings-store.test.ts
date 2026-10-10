/**
 * A local server keeps account settings in a file shared by every local server process.
 * Writes are compare-and-set against the file itself, so processes do not lose each
 * other's edits, and a lock left by a crashed process does not block forever.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalSettingsFile } from '../../../src/configuration/settings-store';

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

  it('reports a file that is not JSON instead of treating it as empty', async () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{ not json');

    await expect(new LocalSettingsFile(filePath).get('acct')).rejects.toThrow(SyntaxError);
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
