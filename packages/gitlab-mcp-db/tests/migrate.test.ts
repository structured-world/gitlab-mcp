/**
 * Migration entry point of the deployments: it waits for PostgreSQL itself (no compose
 * health condition, which hangs on some podman-compose releases), baselines a database
 * created before migrations shipped, then applies the pending migrations.
 */

import * as net from 'node:net';
import { connectPostgres, migrate, type MigrateDeps } from '../src/migrate';

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

  // An address that neither accepts nor refuses leaves a connection attempt pending: each
  // attempt is bounded by what remains of the wait, so the migration gives up in time.
  it('bounds every connection attempt by the remaining wait', async () => {
    let clock = 0;
    const timeouts: number[] = [];
    const { d } = deps({});
    d.now = () => clock;
    d.sleep = async (ms) => {
      clock += ms;
    };
    d.connect = async (_url, timeoutMs) => {
      timeouts.push(timeoutMs);
      clock += timeoutMs;
      throw new Error('timeout expired');
    };

    expect(await migrate(URL, d)).toBe(1);
    expect(timeouts[0]).toBe(60_000);
    expect(timeouts.every((t) => t > 0 && t <= 60_000)).toBe(true);
    expect(clock).toBeLessThanOrEqual(61_000);
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

describe('connectPostgres', () => {
  // A server that accepts TCP and never answers: without a timeout the attempt never ends.
  it('rejects an attempt the server never answers within the timeout', async () => {
    const sockets: net.Socket[] = [];
    const server = net.createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      await expect(
        connectPostgres(`postgresql://user:secret@127.0.0.1:${port}/mcp`, 200),
      ).rejects.toThrow();
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 5_000);
});
