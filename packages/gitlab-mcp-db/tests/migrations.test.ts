/**
 * Databases created by a release before migrations shipped are baselined as 0_init without
 * running it. Every 0_init column such a release did not create must be added by a later
 * migration, or Prisma queries columns that do not exist after a "successful" upgrade.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(__dirname, '..', 'prisma', 'migrations');

/** 0_init columns missing from released schemas: no release had the scope columns, and releases before multi-instance support had no instance columns either. */
const MISSING_FROM_RELEASES: Record<string, string[]> = {
  oauth_sessions: ['gitlab_api_url', 'instance_label', 'gitlab_scopes'],
  oauth_device_flows: ['requested_gitlab_scopes'],
  oauth_auth_code_flows: ['requested_gitlab_scopes'],
};

function laterMigrations(): string {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '0_init')
    .map((entry) => readFileSync(join(MIGRATIONS, entry.name, 'migration.sql'), 'utf8'))
    .join('\n');
}

describe('migrations after the baseline', () => {
  const sql = laterMigrations();

  it.each(
    Object.entries(MISSING_FROM_RELEASES).flatMap(([table, columns]) =>
      columns.map((column) => [table, column]),
    ),
  )('add %s.%s where a released database lacks it', (table, column) => {
    const statement = new RegExp(`ALTER TABLE "${table}"[^;]*ADD COLUMN IF NOT EXISTS "${column}"`);
    expect(sql).toMatch(statement);
  });
});
