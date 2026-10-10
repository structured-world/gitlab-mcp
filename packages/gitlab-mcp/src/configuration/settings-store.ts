/**
 * Where account settings are kept: in the session storage when it can keep them, otherwise
 * in a file in the configuration directory of the user running the server, shared by every
 * server process of that user.
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

const LOCK_RETRY_MS = 25;
const LOCK_ATTEMPTS = 200;
/** A lock older than this was left by a process that died while holding it. */
const STALE_LOCK_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    const parsed: unknown = JSON.parse(content);
    if (!isPlainObject(parsed)) {
      throw new Error(`Settings file is not a JSON object: ${this.filePath}`);
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
        logWarn('Ignoring invalid saved settings', { file: this.filePath });
      }
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

  /**
   * Removes a lock left by a dead process; true when the lock can be taken again at once.
   * The lock is claimed by an atomic rename and checked again, because between the age check
   * and the removal another process may have replaced the dead lock with a fresh one; that
   * one is put back instead of removed. The claimed lock must still be old: an inode check
   * alone cannot tell, as Linux reuses a freed inode number at once.
   */
  private async removeStaleLock(lockPath: string): Promise<boolean> {
    let seen: fs.Stats;
    try {
      seen = await fs.promises.stat(lockPath);
    } catch {
      // Released meanwhile: try again at once.
      return true;
    }
    if (Date.now() - seen.mtimeMs < STALE_LOCK_MS) return false;
    const claimed = `${lockPath}.${process.pid}.${randomUUID()}.stale`;
    try {
      await fs.promises.rename(lockPath, claimed);
    } catch {
      // Another process removed or claimed it first.
      return true;
    }
    const taken = await fs.promises.stat(claimed);
    const sameLock = taken.ino === seen.ino && taken.dev === seen.dev;
    if (!sameLock || Date.now() - taken.mtimeMs < STALE_LOCK_MS) {
      // A fresh lock taken after the age check: hand it back to its holder. If the path was
      // taken again meanwhile, that newer lock stays and this one is dropped.
      await fs.promises.link(claimed, lockPath).catch(() => undefined);
      await fs.promises.rm(claimed, { force: true });
      return false;
    }
    await fs.promises.rm(claimed, { force: true });
    return true;
  }
}

/** Default location of a local server's settings. */
export function localSettingsPath(): string {
  return path.join(os.homedir(), '.config', 'gitlab-mcp', 'settings.json');
}
