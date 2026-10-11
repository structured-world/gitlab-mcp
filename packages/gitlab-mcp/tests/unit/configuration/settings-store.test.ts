/**
 * A local server keeps account settings in a directory shared by every local server process.
 * Each write adds the next generation of the settings, created exclusively, so a write made
 * from an older generation fails instead of replacing a newer one; there is no lock to leave
 * behind or to break.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LocalSettingsFile, localSettingsDir } from '../../../src/configuration/settings-store';

// The test setup keeps every test away from the user's own settings.
it('points tests at temporary settings, not the home directory', () => {
  expect(localSettingsDir().startsWith(os.tmpdir())).toBe(true);
  expect(localSettingsDir().startsWith(os.homedir())).toBe(false);
});

// The real location, read without touching it.
it('keeps a server settings in the user configuration directory', () => {
  const actual = jest.requireActual<typeof import('../../../src/configuration/settings-store')>(
    '../../../src/configuration/settings-store',
  );

  expect(actual.localSettingsDir()).toBe(
    path.join(os.homedir(), '.config', 'gitlab-mcp', 'settings'),
  );
});

describe('LocalSettingsFile', () => {
  let root: string;
  let dir: string;
  const generations = (): string[] =>
    fs.readdirSync(dir).filter((name) => /^\d+\.json$/.test(name));
  const writeGeneration = (generation: number, content: string): void => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${generation}.json`), content);
  };
  const errno = (code: string) => Object.assign(new Error(code), { code });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-store-test-'));
    dir = path.join(root, 'nested', 'settings');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('has no settings before the first write', async () => {
    expect(await new LocalSettingsFile(dir).get('acct')).toBeUndefined();
  });

  it('writes the first settings at version 1 and creates the directory', async () => {
    const store = new LocalSettingsFile(dir);

    const stored = await store.put('acct', { readOnly: true }, 0);

    expect(stored).toMatchObject({ accountKey: 'acct', settings: { readOnly: true }, version: 1 });
    expect(await store.get('acct')).toEqual(stored);
  });

  // The files hold account choices only, but stay private to the user like the rest.
  it('writes the settings owner-only', async () => {
    await new LocalSettingsFile(dir).put('acct', { readOnly: true }, 0);

    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(dir, '1.json')).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses a write against a stale version and keeps the newer settings', async () => {
    const store = new LocalSettingsFile(dir);
    await store.put('acct', { preset: 'developer' }, 0);
    await store.put('acct', { preset: 'pm' }, 1);

    expect(await store.put('acct', { preset: 'readonly' }, 1)).toBeUndefined();
    expect((await store.get('acct'))?.settings).toEqual({ preset: 'pm' });
  });

  // Two local server processes: each reads the settings on every call, so the second one
  // sees the first one's write and its stale edit is refused.
  it('shares settings between two stores of one directory', async () => {
    const first = new LocalSettingsFile(dir);
    const second = new LocalSettingsFile(dir);
    await first.put('acct', { readOnly: true }, 0);

    expect((await second.get('acct'))?.settings).toEqual({ readOnly: true });
    expect(await second.put('acct', { readOnly: false }, 0)).toBeUndefined();
  });

  it('lets exactly one of concurrent writes of one version win', async () => {
    const results = await Promise.all([
      new LocalSettingsFile(dir).put('acct', { preset: 'a' }, 0),
      new LocalSettingsFile(dir).put('acct', { preset: 'b' }, 0),
      new LocalSettingsFile(dir).put('acct', { preset: 'c' }, 0),
    ]);

    const winners = results.filter((r) => r !== undefined);
    expect(winners).toHaveLength(1);
    expect((await new LocalSettingsFile(dir).get('acct'))?.settings).toEqual(winners[0]?.settings);
  });

  // Writes of different accounts do not conflict: a lost race is retried from the new state.
  it('keeps every account of concurrent writes', async () => {
    await Promise.all(
      ['one', 'two', 'three', 'four'].map((key) =>
        new LocalSettingsFile(dir).put(key, { preset: key }, 0),
      ),
    );

    const store = new LocalSettingsFile(dir);
    for (const key of ['one', 'two', 'three', 'four']) {
      expect((await store.get(key))?.settings).toEqual({ preset: key });
    }
  });

  it('keeps the settings of other accounts when one account writes', async () => {
    const store = new LocalSettingsFile(dir);
    await store.put('one', { readOnly: true }, 0);
    await store.put('two', { preset: 'pm' }, 0);

    expect((await store.get('one'))?.settings).toEqual({ readOnly: true });
  });

  // A writer that stops in the middle of its write (a suspended process, a laptop put to
  // sleep) for longer than any lock lifetime, while another writer saves a newer version:
  // when it resumes, its write is refused instead of replacing the newer settings.
  it('refuses a write that resumes after a newer one was saved', async () => {
    const store = new LocalSettingsFile(dir);
    await store.put('acct', { preset: 'base' }, 0);
    const realReadFile = fs.promises.readFile.bind(fs.promises);
    let release: () => void = () => undefined;
    let paused: () => void = () => undefined;
    const resumed = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) => (paused = resolve));
    jest
      .spyOn(fs.promises, 'readFile')
      .mockImplementationOnce(async (...args: Parameters<typeof fs.promises.readFile>) => {
        const content = await realReadFile(...args);
        // Long enough for any lock this writer holds to look abandoned.
        for (const name of fs.readdirSync(path.dirname(dir))) {
          if (name.endsWith('.lock')) {
            const longAgo = new Date(Date.now() - 60_000);
            fs.utimesSync(path.join(path.dirname(dir), name), longAgo, longAgo);
          }
        }
        paused();
        await resumed;
        return content;
      });

    const sleeper = new LocalSettingsFile(dir).put('acct', { preset: 'sleeper' }, 1);
    await reached;
    const newer = await new LocalSettingsFile(dir).put('acct', { preset: 'newer' }, 1);
    release();

    expect(newer).toBeDefined();
    expect(await sleeper).toBeUndefined();
    expect((await store.get('acct'))?.settings).toEqual({ preset: 'newer' });
  });

  it('keeps only the newest generation after a write', async () => {
    const store = new LocalSettingsFile(dir);
    await store.put('one', { readOnly: true }, 0);
    await store.put('two', { readOnly: true }, 0);
    await store.put('one', { readOnly: false }, 1);

    expect(generations()).toEqual(['3.json']);
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reads the newest generation and ignores other files', async () => {
    const content = (preset: string) =>
      JSON.stringify({
        version: 1,
        accounts: { acct: { accountKey: 'acct', settings: { preset }, version: 1, updatedAt: 1 } },
      });
    writeGeneration(2, content('old'));
    writeGeneration(10, content('new'));
    fs.writeFileSync(path.join(dir, 'notes.json'), '{ not settings');
    fs.writeFileSync(path.join(dir, '11.json.bak'), '{ not settings');

    expect((await new LocalSettingsFile(dir).get('acct'))?.settings).toEqual({ preset: 'new' });
  });

  // Another process saved a newer generation and removed the one being read.
  it('reads again when the generation it found is removed before it is read', async () => {
    await new LocalSettingsFile(dir).put('acct', { readOnly: true }, 0);
    jest.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(errno('ENOENT'));

    expect((await new LocalSettingsFile(dir).get('acct'))?.settings).toEqual({ readOnly: true });
  });

  // A temporary file of a writer that crashed before saving is cleared by the next write;
  // one of a writer still at work is left alone.
  it('clears temporary files of crashed writers only', async () => {
    fs.mkdirSync(dir, { recursive: true });
    const crashed = path.join(dir, '.4242.crashed.tmp');
    const working = path.join(dir, '.4243.working.tmp');
    fs.writeFileSync(crashed, '{}');
    fs.writeFileSync(working, '{}');
    const longAgo = new Date(Date.now() - 2 * 60 * 60_000);
    fs.utimesSync(crashed, longAgo, longAgo);

    await new LocalSettingsFile(dir).put('acct', { readOnly: true }, 0);

    expect(fs.existsSync(crashed)).toBe(false);
    expect(fs.existsSync(working)).toBe(true);
  });

  // Its temporary file was cleared while it was suspended: the write is prepared again.
  it('prepares the write again when its temporary file is gone', async () => {
    jest.spyOn(fs.promises, 'link').mockRejectedValueOnce(errno('ENOENT'));

    expect(await new LocalSettingsFile(dir).put('acct', { readOnly: true }, 0)).toBeDefined();
    expect(generations()).toEqual(['1.json']);
  });

  it('gives up when other processes keep saving first', async () => {
    jest.spyOn(fs.promises, 'link').mockRejectedValue(errno('EEXIST'));

    await expect(new LocalSettingsFile(dir).put('acct', { readOnly: true }, 0)).rejects.toThrow(
      `Settings are being changed by other processes: ${dir}`,
    );
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('reports a write it cannot save and leaves no temporary file', async () => {
    jest.spyOn(fs.promises, 'link').mockRejectedValueOnce(errno('EACCES'));

    await expect(
      new LocalSettingsFile(dir).put('acct', { readOnly: true }, 0),
    ).rejects.toMatchObject({ code: 'EACCES' });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  // Once the generation is saved, files that cannot be removed (its temporary file, the
  // older generation) do not turn the write into a failure: the newest generation is read.
  it('reports a saved write as saved when nothing can be removed', async () => {
    const store = new LocalSettingsFile(dir);
    await store.put('acct', { preset: 'a' }, 0);
    jest.spyOn(fs.promises, 'rm').mockRejectedValue(errno('EBUSY'));

    expect(await store.put('acct', { preset: 'b' }, 1)).toBeDefined();
    expect(generations().sort()).toEqual(['1.json', '2.json']);
    expect((await store.get('acct'))?.settings).toEqual({ preset: 'b' });
  });

  // Listing the directory for clean-up fails after the save: the write is still saved.
  it('reports a saved write as saved when the clean-up cannot list the directory', async () => {
    jest
      .spyOn(fs.promises, 'readdir')
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(errno('EIO'));

    expect(await new LocalSettingsFile(dir).put('acct', { readOnly: true }, 0)).toBeDefined();
    expect((await new LocalSettingsFile(dir).get('acct'))?.settings).toEqual({ readOnly: true });
  });

  // Without syncing the directory, a crash after saving can lose the new generation.
  it('syncs the directory after saving', async () => {
    if (process.platform === 'win32') return;
    const open = jest.spyOn(fs.promises, 'open');

    await new LocalSettingsFile(dir).put('acct', { readOnly: true }, 0);

    expect(open).toHaveBeenCalledWith(dir, 'r');
  });

  // A hand-edited entry the schema refuses is ignored instead of applied half-valid.
  it('ignores an entry with invalid settings', async () => {
    writeGeneration(
      1,
      JSON.stringify({
        version: 1,
        accounts: {
          bad: { accountKey: 'bad', settings: { readOnly: 'yes' }, version: 1, updatedAt: 1 },
          good: { accountKey: 'good', settings: { readOnly: true }, version: 1, updatedAt: 1 },
        },
      }),
    );
    const store = new LocalSettingsFile(dir);

    expect(await store.get('bad')).toBeUndefined();
    expect((await store.get('good'))?.settings).toEqual({ readOnly: true });
  });

  // One hand-edited entry of the wrong shape must not fail every call of the server.
  it.each([
    ['an entry that is null', { bad: null }],
    ['an entry that is not an object', { bad: 'readOnly' }],
  ])('skips %s and reads the others', async (_label, broken) => {
    writeGeneration(
      1,
      JSON.stringify({
        version: 1,
        accounts: {
          ...broken,
          good: { accountKey: 'good', settings: { readOnly: true }, version: 1, updatedAt: 1 },
        },
      }),
    );
    const store = new LocalSettingsFile(dir);

    expect(await store.get('bad')).toBeUndefined();
    expect((await store.get('good'))?.settings).toEqual({ readOnly: true });
  });

  it('reads accounts that are not an object as none', async () => {
    writeGeneration(1, JSON.stringify({ version: 1, accounts: [{ settings: {} }] }));

    expect(await new LocalSettingsFile(dir).get('0')).toBeUndefined();
  });

  it('reads a generation without accounts as empty', async () => {
    writeGeneration(1, JSON.stringify({ version: 1 }));

    expect(await new LocalSettingsFile(dir).get('acct')).toBeUndefined();
  });

  it.each(['null', '[]', '"text"'])(
    'reports a generation whose content %s is not an object',
    async (content) => {
      writeGeneration(1, content);

      await expect(new LocalSettingsFile(dir).get('acct')).rejects.toThrow(
        `Settings file is not a JSON object: ${path.join(dir, '1.json')}`,
      );
    },
  );

  it('reports a generation that is not JSON instead of treating it as empty', async () => {
    writeGeneration(1, '{ not json');

    await expect(new LocalSettingsFile(dir).get('acct')).rejects.toThrow(SyntaxError);
  });

  // Only missing settings mean "no settings yet"; unreadable ones are an error.
  it('reports a generation it cannot read instead of treating it as empty', async () => {
    fs.mkdirSync(path.join(dir, '1.json'), { recursive: true });

    await expect(new LocalSettingsFile(dir).get('acct')).rejects.toMatchObject({
      code: 'EISDIR',
    });
  });

  it('reports a settings location that is not a directory', async () => {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, '{}');

    await expect(new LocalSettingsFile(dir).get('acct')).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });
});
