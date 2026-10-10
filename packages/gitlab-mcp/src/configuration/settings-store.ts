/**
 * Where account settings are kept. With OAuth or an explicitly configured session storage
 * they live in that backend, shared by every replica. A local single-user server keeps
 * them in a file in the user's configuration directory.
 */

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

const LOCK_RETRY_MS = 25;
const LOCK_ATTEMPTS = 200;
/** A lock older than this was left by a process that died while holding it. */
const STALE_LOCK_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Settings of a local server in one JSON file. Every read goes to the file, and a write
 * holds a lock file around read-compare-write, so several local server processes (one per
 * client) share the settings without losing each other's edits.
 */
export class LocalSettingsFile implements SettingsStore {
  constructor(private readonly filePath: string) {}

  async get(accountKey: string): Promise<AccountSettingsRecord | undefined> {
    return (await this.read()).accounts[accountKey];
  }

  async put(
    accountKey: string,
    settings: AccountSettings,
    expectedVersion: number,
  ): Promise<AccountSettingsRecord | undefined> {
    return this.withLock(async () => {
      const file = await this.read();
      const current = file.accounts[accountKey]?.version ?? 0;
      if (current !== expectedVersion) return undefined;
      const record: AccountSettingsRecord = {
        accountKey,
        settings,
        version: current + 1,
        updatedAt: Date.now(),
      };
      file.accounts[accountKey] = record;
      await this.write(file);
      return record;
    });
  }

  private async read(): Promise<SettingsFile> {
    let content: string;
    try {
      content = await fs.promises.readFile(this.filePath, 'utf-8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, accounts: {} };
      throw error;
    }
    const parsed = JSON.parse(content) as Partial<SettingsFile>;
    const accounts: Record<string, AccountSettingsRecord> = {};
    for (const [key, record] of Object.entries(parsed.accounts ?? {})) {
      // A hand-edited entry the schema refuses is ignored rather than applied half-valid.
      const settings = AccountSettingsSchema.safeParse(record.settings);
      if (settings.success) accounts[key] = { ...record, settings: settings.data };
      else logWarn('Ignoring invalid saved settings', { file: this.filePath });
    }
    return { version: 1, accounts };
  }

  private async write(file: SettingsFile): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    const handle = await fs.promises.open(temp, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(file, null, 2), 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temp, this.filePath);
    await syncDirectory(path.dirname(this.filePath));
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockPath = `${this.filePath}.lock`;
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    for (let attempt = 0; ; attempt++) {
      try {
        const handle = await fs.promises.open(lockPath, 'wx', 0o600);
        await handle.close();
        break;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (await this.removeStaleLock(lockPath)) continue;
        if (attempt >= LOCK_ATTEMPTS) {
          throw new Error(`Settings file is locked by another process: ${lockPath}`, {
            cause: error,
          });
        }
        await sleep(LOCK_RETRY_MS);
      }
    }
    try {
      return await fn();
    } finally {
      await fs.promises.rm(lockPath, { force: true });
    }
  }

  private async removeStaleLock(lockPath: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(lockPath);
      if (Date.now() - stat.mtimeMs < STALE_LOCK_MS) return false;
      await fs.promises.rm(lockPath, { force: true });
      return true;
    } catch {
      // Released meanwhile: try again at once.
      return true;
    }
  }
}

/** Default location of a local server's settings. */
export function localSettingsPath(): string {
  return path.join(os.homedir(), '.config', 'gitlab-mcp', 'settings.json');
}
