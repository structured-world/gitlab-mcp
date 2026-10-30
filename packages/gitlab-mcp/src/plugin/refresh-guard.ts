import { DatabaseSync } from 'node:sqlite';
import { openSync, closeSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js';

const SQLITE_BUSY = 5;

/** An empty database supplies an OS-owned mutex, independently of connection state writes. */
export class RefreshGuard {
  private readonly db: DatabaseSync;
  private tail: Promise<void> = Promise.resolve();
  private closing = false;

  constructor(path: string) {
    closeSync(openSync(path, 'a', 0o600));
    this.db = new DatabaseSync(path, { timeout: 0 });
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      await this.acquire();
      try {
        return await operation();
      } finally {
        if (!this.closing) this.db.exec('ROLLBACK');
      }
    });
    this.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async acquire(): Promise<void> {
    const deadline = performance.now() + DEFAULT_REQUEST_TIMEOUT_MSEC;
    while (!this.closing) {
      try {
        this.db.exec('BEGIN IMMEDIATE');
        return;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('errcode' in error) ||
          error.errcode !== SQLITE_BUSY ||
          performance.now() >= deadline
        )
          throw new Error('Could not acquire the shared OAuth refresh lock.', { cause: error });
        await setTimeout(10);
      }
    }
    throw new Error('OAuth connection closed.');
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.db.close();
    await this.tail;
  }
}
