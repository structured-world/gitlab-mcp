/**
 * Database migration entry point of the deployments.
 *
 * Waits until PostgreSQL accepts connections (the stack starts the database alongside
 * this one-shot service, and some podman-compose releases hang on a health condition),
 * marks the baseline migration applied on a database created before migrations shipped
 * (Prisma baselining), then applies the pending migrations with `prisma migrate deploy`.
 *
 * Usage: node dist/src/migrate.js (from the package directory); the connection URL comes
 * from OAUTH_STORAGE_POSTGRESQL_URL or DATABASE_URL.
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { Client } from 'pg';

/** Migration that reproduces the schema of releases before migrations shipped. */
const BASELINE_MIGRATION = '0_init';
/** How long to wait for the database to accept connections. */
const WAIT_MS = 60_000;
const RETRY_MS = 1_000;

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

/** Side effects of a migration run, injectable for tests. */
export interface MigrateDeps {
  connect(url: string): Promise<Queryable>;
  /** Run the Prisma CLI with these arguments; returns its exit status. */
  prisma(args: string[]): number;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(message: string): void;
}

async function waitForDatabase(url: string, deps: MigrateDeps): Promise<Queryable | undefined> {
  const deadline = deps.now() + WAIT_MS;
  for (;;) {
    try {
      return await deps.connect(url);
    } catch (error: unknown) {
      if (deps.now() >= deadline) {
        deps.log(`Database is not reachable: ${(error as Error).message}`);
        return undefined;
      }
      await deps.sleep(RETRY_MS);
    }
  }
}

/**
 * Whether the OAuth tables exist without migration history, which is how releases before
 * migrations shipped left the database. Looks in the schema Prisma uses (`schema` URL
 * parameter, default `public`).
 */
async function needsBaseline(client: Queryable, url: string): Promise<boolean> {
  const schema = new URL(url).searchParams.get('schema') ?? 'public';
  const { rows } = await client.query(
    `SELECT to_regclass(quote_ident($1) || '.oauth_sessions') IS NOT NULL AS has_tables,
            to_regclass(quote_ident($1) || '._prisma_migrations') IS NOT NULL AS has_history`,
    [schema],
  );
  const state = rows[0] as { has_tables: boolean; has_history: boolean };
  return state.has_tables && !state.has_history;
}

/** Run the migration; resolves to the process exit status. */
export async function migrate(url: string | undefined, deps: MigrateDeps): Promise<number> {
  if (!url) {
    deps.log('Set OAUTH_STORAGE_POSTGRESQL_URL or DATABASE_URL');
    return 1;
  }
  const client = await waitForDatabase(url, deps);
  if (!client) return 1;
  let baseline: boolean;
  try {
    baseline = await needsBaseline(client, url);
  } finally {
    await client.end();
  }
  if (baseline) {
    deps.log(`Existing tables without migration history: marking ${BASELINE_MIGRATION} applied`);
    const status = deps.prisma(['migrate', 'resolve', '--applied', BASELINE_MIGRATION]);
    if (status !== 0) return status;
  }
  return deps.prisma(['migrate', 'deploy']);
}

/** The package directory, where prisma.config.ts lives (this file is dist/src/migrate.js). */
const PACKAGE_DIR = path.resolve(__dirname, '..', '..');

const defaultDeps: MigrateDeps = {
  async connect(url) {
    const client = new Client({ connectionString: url });
    await client.connect();
    return client;
  },
  prisma(args) {
    const cli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build/index.js');
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: PACKAGE_DIR,
      stdio: 'inherit',
    });
    return result.status ?? 1;
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  log: (message) => console.error(message),
};

if (require.main === module) {
  migrate(process.env.OAUTH_STORAGE_POSTGRESQL_URL ?? process.env.DATABASE_URL, defaultDeps).then(
    (status) => process.exit(status),
    (error: unknown) => {
      console.error('Migration failed:', error);
      process.exit(1);
    },
  );
}
