#!/usr/bin/env node
/**
 * Check that the PostgreSQL backend loads every runtime module it needs.
 *
 * Runs one query against a port where nothing listens: Prisma must load its query
 * compiler and the pg driver and then fail with P1001 (database unreachable). A missing
 * module fails differently, so any other outcome exits non-zero.
 *
 * Usage: node runtime-smoke.cjs [path to the package entry]
 * Without an argument the package is resolved from the current directory.
 */

const entry =
  process.argv[2] ??
  require.resolve('@structured-world/gitlab-mcp-db', {
    paths: [process.cwd()],
  });
const { PostgreSQLStorageBackend } = require(entry);

const backend = new PostgreSQLStorageBackend({
  connectionString: 'postgresql://smoke@127.0.0.1:1/smoke',
});

backend
  .initialize()
  // initialize() is lazy with driver adapters; the query loads the compiler and the driver.
  .then(() => backend.getSession('smoke'))
  .then(
    () => {
      console.error('Unexpected: a query succeeded against a closed port');
      process.exit(1);
    },
    (error) => {
      if (error?.code === 'P1001') {
        console.log('PostgreSQL backend runtime OK (database unreachable as expected)');
        return;
      }
      console.error('PostgreSQL backend runtime is incomplete:', error);
      process.exit(1);
    },
  );
