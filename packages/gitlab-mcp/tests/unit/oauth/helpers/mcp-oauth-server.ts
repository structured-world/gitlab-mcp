/**
 * Real HTTP OAuth server for tests: the production OAuth routes and middleware mounted on
 * express, listening on a random port. Every replica loads its own module graph (its own
 * singletons and caches) and shares only the storage backend, like processes behind a
 * load balancer sharing PostgreSQL.
 */

import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import type { SessionStorageBackend } from '../../../../src/oauth/storage/types';
import type { SessionStore } from '../../../../src/oauth/session-store';

export const ISSUER = 'https://mcp.example.com';
export const SESSION_SECRET = 'test-session-secret-at-least-32-characters';
export const GITLAB_APP_ID = 'gitlab-app';

export interface McpReplica {
  url: string;
  sessionStore: SessionStore;
  close(): Promise<void>;
}

/** Environment for OAuth mode against `gitlabUrl`; extra keys are merged. */
export function oauthEnv(gitlabUrl: string, extra: Record<string, string> = {}): void {
  process.env.OAUTH_ENABLED = 'true';
  process.env.OAUTH_ISSUER = ISSUER;
  process.env.OAUTH_SESSION_SECRET = SESSION_SECRET;
  process.env.OAUTH_CLIENT_ID = GITLAB_APP_ID;
  delete process.env.OAUTH_CLIENT_SECRET;
  process.env.OAUTH_SCOPES = 'api read_user';
  process.env.GITLAB_API_URL = gitlabUrl;
  delete process.env.GITLAB_INSTANCES;
  delete process.env.GITLAB_INSTANCES_FILE;
  delete process.env.GITLAB_TOKEN;
  Object.assign(process.env, extra);
}

/** Start one replica; the protected route echoes the authenticated request context. */
export async function startReplica(shared: SessionStorageBackend): Promise<McpReplica> {
  let replica: McpReplica | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock('../../../../src/oauth/storage/factory', () => ({
      createStorageBackend: () => shared,
    }));
    const { default: express } = await import('express');
    const { registerOAuthEndpoints } = await import('../../../../src/oauth/routes');
    const { oauthAuthMiddleware } = await import('../../../../src/middleware/oauth-auth');
    const { authenticateMcpTransports } =
      await import('../../../../src/middleware/mcp-auth-routes');
    const { sessionStore } = await import('../../../../src/oauth/session-store');

    await sessionStore.initialize();
    sessionStore.stopCleanupInterval();

    const app = express();
    registerOAuthEndpoints(app);
    authenticateMcpTransports(app, oauthAuthMiddleware);
    app.all(['/', '/mcp'], (_req, res) => {
      res.json({ ...res.locals });
    });

    const server = http.createServer(app as http.RequestListener);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    replica = {
      url: `http://127.0.0.1:${port}`,
      sessionStore,
      close: () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
  });
  return replica!;
}
