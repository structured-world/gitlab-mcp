/**
 * Migration entry point of the deployments: it waits for PostgreSQL itself (no compose
 * health condition, which hangs on some podman-compose releases), baselines a database
 * created before migrations shipped, then applies the pending migrations.
 */

import { migrate, type MigrateDeps } from '../src/migrate';

type Tables = { has_tables: boolean; has_history: boolean };

function deps(options: { failConnects?: number; tables?: Tables; prismaStatus?: number[] }) {
  let failures = options.failConnects ?? 0;
  let clock = 0;
  const statuses = [...(options.prismaStatus ?? [])];
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const prismaCalls: string[][] = [];
  const closed: boolean[] = [];
  const d: MigrateDeps = {
    connect: async () => {
      if (failures > 0) {
        failures--;
        throw new Error('connect ECONNREFUSED');
      }
      return {
        query: async (text: string, values?: unknown[]) => {
          queries.push({ text, values });
          return { rows: [options.tables ?? { has_tables: false, has_history: false }] };
        },
        end: async () => {
          closed.push(true);
        },
      };
    },
    prisma: (args) => {
      prismaCalls.push(args);
      return statuses.shift() ?? 0;
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: () => undefined,
  };
  return { d, queries, prismaCalls, closed };
}

const URL = 'postgresql://user:secret@db:5432/mcp';

describe('migrate', () => {
  it('applies migrations to a new database', async () => {
    const { d, prismaCalls, closed } = deps({});

    expect(await migrate(URL, d)).toBe(0);
    expect(prismaCalls).toEqual([['migrate', 'deploy']]);
    expect(closed).toEqual([true]);
  });

  // The bundled database starts with the stack: connection refusals are retried.
  it('waits until the database accepts connections', async () => {
    const { d, prismaCalls } = deps({ failConnects: 3 });

    expect(await migrate(URL, d)).toBe(0);
    expect(prismaCalls).toEqual([['migrate', 'deploy']]);
  });

  it('gives up when the database stays unreachable', async () => {
    const { d, prismaCalls } = deps({ failConnects: Number.MAX_SAFE_INTEGER });

    expect(await migrate(URL, d)).toBe(1);
    expect(prismaCalls).toEqual([]);
  });

  // Tables from a release before migrations shipped have no migration history:
  // `migrate deploy` would try to create them again and fail.
  it('marks the baseline applied on a database created before migrations shipped', async () => {
    const { d, prismaCalls } = deps({ tables: { has_tables: true, has_history: false } });

    expect(await migrate(URL, d)).toBe(0);
    expect(prismaCalls).toEqual([
      ['migrate', 'resolve', '--applied', '0_init'],
      ['migrate', 'deploy'],
    ]);
  });

  it('does not baseline a database that already has migration history', async () => {
    const { d, prismaCalls } = deps({ tables: { has_tables: true, has_history: true } });

    expect(await migrate(URL, d)).toBe(0);
    expect(prismaCalls).toEqual([['migrate', 'deploy']]);
  });

  it('stops when the baseline cannot be recorded', async () => {
    const { d, prismaCalls } = deps({
      tables: { has_tables: true, has_history: false },
      prismaStatus: [1],
    });

    expect(await migrate(URL, d)).toBe(1);
    expect(prismaCalls).toEqual([['migrate', 'resolve', '--applied', '0_init']]);
  });

  it('reports a failed deploy', async () => {
    const { d } = deps({ prismaStatus: [1] });

    expect(await migrate(URL, d)).toBe(1);
  });

  // Prisma takes the schema from the URL; the check must look in the same schema.
  it('checks the schema named in the connection URL', async () => {
    const { d, queries } = deps({});

    await migrate(`${URL}?schema=oauth`, d);

    expect(queries[0].values).toEqual(['oauth']);
  });

  it('refuses to run without a connection URL', async () => {
    const { d, prismaCalls } = deps({});

    expect(await migrate(undefined, d)).toBe(1);
    expect(prismaCalls).toEqual([]);
  });
});
