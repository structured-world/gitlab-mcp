import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectionStore } from '../../../../src/plugin/connection-store';
import { DatabaseSync } from 'node:sqlite';

describe('plugin connection storage', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitlab-plugin-store-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects malformed persisted connections without exposing stored values', () => {
    // Another version or a damaged record must not bypass validation or leak credentials.
    const store = new ConnectionStore(dir);
    const database = new DatabaseSync(join(dir, 'connection.sqlite'));
    try {
      for (const value of [
        JSON.stringify({ mode: 'local', url: 'not a URL', token: 'synthetic-secret' }),
        JSON.stringify({ mode: 'local', url: 'https://gitlab.example' }),
        JSON.stringify({ mode: 'remote', url: 'https://mcp.example/mcp', authentication: 'oauth' }),
        '{"synthetic-stored-secret":',
      ]) {
        database.prepare('UPDATE connection SET value=? WHERE id=1').run(value);
        expect(() => store.read()).toThrow('saved connection');
      }
    } finally {
      database.close();
      store.close();
    }
  });

  it('rejects late setup and credential writes across processes', () => {
    // Two chats share one selected connection; an older callback cannot replace it.
    const first = new ConnectionStore(dir);
    const second = new ConnectionStore(dir);
    try {
      const before = first.read();
      const active = second.commit(before.revision, {
        mode: 'local',
        url: 'https://gitlab.example',
        token: 'synthetic-secret',
      });
      expect(active).toBeDefined();
      expect(() =>
        first.commit(before.revision, {
          mode: 'remote',
          url: 'https://mcp.example/mcp',
          authentication: 'none',
        }),
      ).toThrow('changed');
      second.commit(active.revision, null);
      expect(() => first.commit(active.revision, active.connection)).toThrow('changed');
      expect(first.read().connection).toBeNull();
    } finally {
      first.close();
      second.close();
    }
  });

  it('persists privately without retaining disconnected credentials', () => {
    // Restart reads the selected target; disconnect removes its saved secret.
    let store = new ConnectionStore(dir);
    store.commit(0, { mode: 'local', url: 'https://gitlab.example', token: 'synthetic-secret' });
    store.close();
    store = new ConnectionStore(dir);
    try {
      expect(store.read().connection).toMatchObject({ mode: 'local', token: 'synthetic-secret' });
      // Windows inherits the host data directory's ACL; POSIX exposes the file permission bits.
      if (process.platform !== 'win32')
        expect(statSync(join(dir, 'connection.sqlite')).mode & 0o777).toBe(0o600);
      store.commit(store.read().revision, null);
      expect(store.read().connection).toBeNull();
    } finally {
      store.close();
    }
  });

  it('updates independent OAuth fields without changing the selected account', () => {
    // Shared metadata writes preserve newer tokens; an explicit relink fences every older writer.
    const first = new ConnectionStore(dir);
    const second = new ConnectionStore(dir);
    const connection = {
      mode: 'remote' as const,
      url: 'https://mcp.example/mcp',
      authentication: 'oauth' as const,
      authorization: { redirectUrl: 'http://127.0.0.1/callback' },
    };
    try {
      const selected = first.commit(0, connection);
      const tokens = {
        access_token: 'synthetic-new-token',
        token_type: 'Bearer',
        issuer: 'https://issuer.example',
      };
      first.updateAuthorization(selected.revision, { tokens });
      second.updateAuthorization(selected.revision, { client: { client_id: 'synthetic-client' } });
      expect(first.read()).toEqual({
        revision: selected.revision,
        connection: {
          ...connection,
          authorization: {
            ...connection.authorization,
            tokens,
            client: { client_id: 'synthetic-client' },
          },
        },
      });
      second.commit(selected.revision, connection);
      expect(() => first.updateAuthorization(selected.revision, { tokens })).toThrow('changed');
      expect(second.read().connection).toEqual(connection);
    } finally {
      first.close();
      second.close();
    }
  });
});
