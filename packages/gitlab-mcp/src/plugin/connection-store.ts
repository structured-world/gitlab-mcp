import { mkdirSync, openSync, closeSync, chmodSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  OAuthClientInformationSchema,
  OAuthClientInformationFullSchema,
  OAuthTokensSchema,
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';

// The SDK stamps saved tokens with their issuer; shared cache updates must retain that binding.
export const SavedOAuthTokens = OAuthTokensSchema.extend({ issuer: z.string().min(1) });

export interface RemoteAuthorization {
  client?: OAuthClientInformationMixed;
  tokens?: z.infer<typeof SavedOAuthTokens>;
  discovery?: OAuthDiscoveryState;
  redirectUrl: string;
}

const address = z
  .string()
  .max(4096)
  .refine((raw) => {
    try {
      const url = new URL(raw);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, 'Use an HTTP or HTTPS address without credentials, query or fragment');

export const ConnectionInput = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('local'),
      url: address,
      token: z.string().min(1).max(16384),
      initTimeoutMs: z.number().int().min(1000).max(45000).optional(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('remote'),
      url: address,
      authentication: z.enum(['oauth', 'bearer', 'none']),
      token: z.string().min(1).max(16384).optional(),
    })
    .strict(),
]);

export type Connection = z.infer<typeof ConnectionInput> & { authorization?: RemoteAuthorization };
export interface ConnectionSnapshot {
  revision: number;
  connection: Connection | null;
}

const SavedConnection = z
  .discriminatedUnion('mode', [
    ConnectionInput.options[0],
    ConnectionInput.options[1].extend({
      authorization: z
        .object({
          redirectUrl: z.url(),
          client: z
            .union([OAuthClientInformationFullSchema, OAuthClientInformationSchema])
            .optional(),
          tokens: SavedOAuthTokens.optional(),
          discovery: z
            .object({
              authorizationServerUrl: z.url(),
              authorizationServerMetadata: OAuthMetadataSchema.optional(),
              resourceMetadata: OAuthProtectedResourceMetadataSchema.optional(),
              resourceMetadataUrl: z.url().optional(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .optional(),
    }),
  ])
  .refine((connection) => {
    if (connection.mode === 'local') return true;
    if (connection.authentication === 'oauth') return connection.authorization !== undefined;
    if (connection.authorization !== undefined) return false;
    return connection.authentication !== 'bearer' || connection.token !== undefined;
  });

export class InvalidSavedConnection extends Error {
  constructor(readonly revision: number) {
    super('The saved connection data is invalid. Configure the connection again.');
  }
}

/** One private, transactional selection shared by all plugin processes of this user.
 * The host supplies its PLUGIN_DATA directory through launcher configuration, not tool arguments.
 */
export class ConnectionStore {
  private readonly db: DatabaseSync;

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const path = join(dir, 'connection.sqlite');
    closeSync(openSync(path, 'a', 0o600));
    chmodSync(path, 0o600);
    this.db = new DatabaseSync(path, { timeout: 5000 });
    // DELETE journaling keeps no old credential history after a committed disconnect.
    this.db.exec(
      'PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS connection (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, value TEXT); INSERT OR IGNORE INTO connection VALUES(1,0,NULL)',
    );
  }

  read(): ConnectionSnapshot {
    const row = this.db.prepare('SELECT revision, value FROM connection WHERE id=1').get();
    if (!row) throw new Error('The saved connection record is missing.');
    const revision = Number(row.revision);
    try {
      return {
        revision,
        connection:
          row.value === null ? null : SavedConnection.parse(JSON.parse(String(row.value))),
      };
    } catch {
      // Parser diagnostics may contain credentials from the damaged record.
      throw new InvalidSavedConnection(revision);
    }
  }

  revision(): number {
    const row = this.db.prepare('SELECT revision FROM connection WHERE id=1').get();
    if (!row) throw new Error('The saved connection record is missing.');
    return Number(row.revision);
  }

  get refreshLockPath(): string {
    return join(this.dir, 'oauth-refresh.sqlite');
  }

  readAuthorization(expected: number): RemoteAuthorization {
    return this.authorized(expected).authorization;
  }

  private authorized(expected: number) {
    const saved = this.read();
    if (
      saved.revision !== expected ||
      saved.connection?.mode !== 'remote' ||
      saved.connection.authentication !== 'oauth' ||
      !saved.connection.authorization
    )
      throw new Error('The connection changed. Open settings again.');
    return { connection: saved.connection, authorization: saved.connection.authorization };
  }

  commit(expected: number, connection: Connection | null): ConnectionSnapshot {
    const result = this.db
      .prepare('UPDATE connection SET revision=revision+1,value=? WHERE id=1 AND revision=?')
      .run(connection === null ? null : JSON.stringify(connection), expected);
    if (result.changes !== 1)
      throw new Error('The connection changed in another window. Open settings again.');
    return { revision: expected + 1, connection };
  }

  updateAuthorization(expected: number, patch: Partial<RemoteAuthorization>): RemoteAuthorization {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const { connection, authorization: previous } = this.authorized(expected);
      const authorization = { ...previous, ...patch };
      this.db.prepare('UPDATE connection SET value=? WHERE id=1').run(
        JSON.stringify({
          ...connection,
          authorization,
        }),
      );
      this.db.exec('COMMIT');
      return authorization;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  watchChanges(changed: () => void): FSWatcher {
    return watch(this.dir, (_event, name) => {
      if (name === null || String(name) === 'connection.sqlite') changed();
    });
  }
}
