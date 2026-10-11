/**
 * Where account settings are kept: in the session storage when it can keep them, otherwise
 * in a directory in the configuration directory of the user running the server, shared by
 * every server process of that user.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AccountSettings, AccountSettingsRecord } from './types';
import { AccountSettingsSchema } from './types';
import { logWarn } from '../logger';
import { syncDirectory } from '../utils/sync-directory';

export interface SettingsStore {
  get(accountKey: string): Promise<AccountSettingsRecord | undefined>;
  /** Compare-and-set write; undefined when another write changed the settings first. */
  put(
    accountKey: string,
    settings: AccountSettings,
    expectedVersion: number,
  ): Promise<AccountSettingsRecord | undefined>;
}

interface SettingsFile {
  version: 1;
  accounts: Record<string, AccountSettingsRecord>;
}

/** The settings as of one generation; generation 0 is the empty state before any write. */
interface Snapshot {
  generation: number;
  file: SettingsFile;
}

/** How many lost races a write retries before it gives up. */
const SAVE_ATTEMPTS = 100;
/** A temporary file older than this belongs to a writer that died before saving it. */
const ABANDONED_TEMP_MS = 60 * 60_000;
const GENERATION_FILE = /^(\d+)\.json$/;
const TEMP_SUFFIX = '.tmp';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

/**
 * Settings of a local server as numbered generations in one directory. A write saves the
 * next generation with an exclusive link, which fails when another write saved it first; the
 * write then reads the new state and checks its version again. There is no lock, so a
 * process that dies or is suspended mid-write cannot block others or overwrite newer
 * settings when it resumes.
 */
export class LocalSettingsFile implements SettingsStore {
  constructor(private readonly dir: string) {}

  async get(accountKey: string): Promise<AccountSettingsRecord | undefined> {
    return (await this.latest()).file.accounts[accountKey];
  }

  async put(
    accountKey: string,
    settings: AccountSettings,
    expectedVersion: number,
  ): Promise<AccountSettingsRecord | undefined> {
    await fs.promises.mkdir(this.dir, { recursive: true });
    // Each attempt depends on the state the previous one lost to.
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const { generation, file } = await this.latest();
      const current = file.accounts[accountKey]?.version ?? 0;
      if (current !== expectedVersion) return undefined;
      const record: AccountSettingsRecord = {
        accountKey,
        settings,
        version: current + 1,
        updatedAt: Date.now(),
      };
      file.accounts[accountKey] = record;
      if (await this.save(generation + 1, file)) {
        await this.prune(generation + 1);
        return record;
      }
    }
    throw new Error(`Settings are being changed by other processes: ${this.dir}`);
  }

  /** The newest generation, or the empty state when none was saved yet. */
  private async latest(): Promise<Snapshot> {
    // A generation found can be pruned by a newer write before it is read: read again.
    for (;;) {
      const generation = await this.newestGeneration();
      if (generation === 0) return { generation, file: { version: 1, accounts: {} } };
      const filePath = this.generationPath(generation);
      try {
        return {
          generation,
          file: this.parse(await fs.promises.readFile(filePath, 'utf-8'), filePath),
        };
      } catch (error: unknown) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
    }
  }

  private async newestGeneration(): Promise<number> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.dir);
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') return 0;
      throw error;
    }
    let newest = 0;
    for (const name of names) {
      const match = GENERATION_FILE.exec(name);
      if (match) newest = Math.max(newest, Number(match[1]));
    }
    return newest;
  }

  private parse(content: string, filePath: string): SettingsFile {
    const parsed: unknown = JSON.parse(content);
    if (!isPlainObject(parsed)) {
      throw new Error(`Settings file is not a JSON object: ${filePath}`);
    }
    const accounts: Record<string, AccountSettingsRecord> = {};
    const stored = isPlainObject(parsed.accounts) ? parsed.accounts : {};
    for (const [key, record] of Object.entries(stored)) {
      // A hand-edited entry of the wrong shape, or settings the schema refuses, is ignored
      // rather than applied half-valid or failing every call.
      const settings = isPlainObject(record)
        ? AccountSettingsSchema.safeParse(record.settings)
        : undefined;
      if (settings?.success) {
        accounts[key] = {
          ...(record as Omit<AccountSettingsRecord, 'settings'>),
          settings: settings.data,
        };
      } else {
        logWarn('Ignoring invalid saved settings', { file: filePath });
      }
    }
    return { version: 1, accounts };
  }

  /**
   * Saves a generation unless another write saved it first (false). The content is written
   * and synced in a temporary file, then linked under the generation's name: the link is
   * atomic and fails when the name exists, so a generation is saved once, complete.
   */
  private async save(generation: number, file: SettingsFile): Promise<boolean> {
    const temp = path.join(this.dir, `.${process.pid}.${randomUUID()}${TEMP_SUFFIX}`);
    const handle = await fs.promises.open(temp, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(file, null, 2), 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.promises.link(temp, this.generationPath(generation));
    } catch (error: unknown) {
      // EEXIST: another write saved this generation. ENOENT: the temporary file was cleared
      // as abandoned while this process was suspended. Either way, prepare the write again.
      const code = errorCode(error);
      if (code === 'EEXIST' || code === 'ENOENT') return false;
      throw error;
    } finally {
      // Once linked the generation is saved: a temporary file left behind must not report
      // the write as failed. A later write prunes it as abandoned.
      await fs.promises.rm(temp, { force: true }).catch(() => undefined);
    }
    await syncDirectory(this.dir);
    return true;
  }

  /**
   * Removes generations older than the one just saved and temporary files of writers that
   * died before saving. Best effort: a leftover is never read as the current settings.
   */
  private async prune(saved: number): Promise<void> {
    const names = await fs.promises.readdir(this.dir).catch(() => [] as string[]);
    const now = Date.now();
    await Promise.all(
      names.map(async (name) => {
        const target = path.join(this.dir, name);
        try {
          const match = GENERATION_FILE.exec(name);
          if (match && Number(match[1]) < saved) {
            await fs.promises.rm(target, { force: true });
          } else if (name.endsWith(TEMP_SUFFIX)) {
            const { mtimeMs } = await fs.promises.stat(target);
            if (now - mtimeMs > ABANDONED_TEMP_MS) await fs.promises.rm(target, { force: true });
          }
        } catch {
          // Removed by another writer meanwhile, or not removable now: the next write retries.
        }
      }),
    );
  }

  private generationPath(generation: number): string {
    return path.join(this.dir, `${generation}.json`);
  }
}

/** Default location of a local server's settings. */
export function localSettingsDir(): string {
  return path.join(os.homedir(), '.config', 'gitlab-mcp', 'settings');
}
