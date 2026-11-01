/** HTTP regression coverage for OAuth clients sharing one NAT address. */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { OAuthSession } from '../../src/oauth/types';
import { createJWT } from '../../src/oauth/token-utils';

let mockHttpServer: http.Server;
const mockSessions = new Map<string, OAuthSession>();
const mockTransports = new Map<string, Server>();
const secret = 'fixture-session-secret-at-least-32-characters';
const issuer = 'https://mcp.example.com';
const mockGetSession = jest.fn(async (id: string) => mockSessions.get(id));

jest.mock('../../src/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logDebug: jest.fn(),
  logError: jest.fn(),
  truncateId: (id: string) => id,
}));

jest.mock('http', () => {
  const actual = jest.requireActual<typeof http>('http');
  return {
    ...actual,
    createServer: (...args: Parameters<typeof actual.createServer>) => {
      mockHttpServer = actual.createServer(...args);
      return mockHttpServer;
    },
  };
});
jest.mock('../../src/config', () => ({
  ...jest.requireActual('../../src/config'),
  HOST: '127.0.0.1',
  PORT: '0',
  TRUST_PROXY: 'loopback',
  USE_REGISTRY: false,
  DASHBOARD_ENABLED: true,
  RATE_LIMIT_IP_ENABLED: true,
  RATE_LIMIT_IP_WINDOW_MS: 60000,
  RATE_LIMIT_IP_MAX_REQUESTS: 2,
  RATE_LIMIT_SESSION_ENABLED: false,
  RATE_LIMIT_SESSION_WINDOW_MS: 60000,
  RATE_LIMIT_SESSION_MAX_REQUESTS: 2,
}));
jest.mock('../../src/oauth/config', () => ({
  loadOAuthConfig: () => ({ issuer, sessionSecret: secret, gitlabClientId: 'fixture-app' }),
  isOAuthEnabled: () => true,
}));
jest.mock('../../src/oauth/index', () => ({
  ...jest.requireActual('../../src/oauth/token-context'),
  ...jest.requireMock('../../src/oauth/config'),
  getAuthModeDescription: () => 'OAuth',
  sessionStore: {
    associateMcpSession: jest.fn().mockResolvedValue(undefined),
    removeMcpSessionAssociation: jest.fn().mockResolvedValue(true),
  },
}));
jest.mock('../../src/oauth/session-store', () => ({
  sessionStore: { getSession: (id: string) => mockGetSession(id) },
}));
jest.mock('../../src/oauth/gitlab-token-refresh', () => ({
  withFreshGitLabToken: async (session: OAuthSession) => session,
}));
jest.mock('../../src/oauth/grant-revocation', () => ({ startSessionStore: jest.fn() }));
jest.mock('../../src/oauth/routes', () => ({ registerOAuthEndpoints: jest.fn() }));
jest.mock('../../src/entities/container_registry/regex', () => ({
  warmTagMatchers: jest.fn(),
  closeTagMatchers: jest.fn(),
  resetTagMatchers: jest.fn(),
}));
jest.mock('../../src/dashboard/index.js', () => ({
  dashboardHandler: (_req: unknown, res: import('express').Response) =>
    res.json({ dashboard: true }),
}));
jest.mock('../../src/session-manager', () => ({
  getSessionManager: () => ({
    start: jest.fn(),
    hasSession: (id: string) => mockTransports.has(id),
    touchSession: jest.fn(),
    removeSession: async (id: string) => {
      const server = mockTransports.get(id);
      mockTransports.delete(id);
      await server?.close();
    },
    createSession: async (id: string, transport: Transport) => {
      const server = new Server({ name: 'rate-limit-fixture', version: '1' });
      mockTransports.set(id, server);
      await server.connect(transport);
      return server;
    },
  }),
}));

import { startServer } from '../../src/server';
import { stopCleanup, getRateLimitStats } from '../../src/middleware/rate-limiter';

const settings = jest.requireMock<{ RATE_LIMIT_SESSION_ENABLED: boolean }>('../../src/config');
let baseUrl: string;
let source: string;
let sequence = 0;
let previousPort: string | undefined;

beforeEach(async () => {
  previousPort = process.env.PORT;
  process.env.PORT = '0';
  settings.RATE_LIMIT_SESSION_ENABLED = false;
  source = `192.0.2.${++sequence}`;
  mockGetSession.mockClear();
  await startServer();
  if (!mockHttpServer.listening)
    await new Promise<void>((resolve) => mockHttpServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(mockHttpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await Promise.all([...mockTransports.values()].map((server) => server.close()));
  mockTransports.clear();
  mockSessions.clear();
  mockHttpServer.closeAllConnections();
  await new Promise<void>((resolve) => mockHttpServer.close(() => resolve()));
  stopCleanup();
  if (previousPort === undefined) delete process.env.PORT;
  else process.env.PORT = previousPort;
});

function account(): OAuthSession {
  const id = randomUUID();
  const token = createJWT(
    { iss: issuer, sub: id, aud: issuer, sid: id, scope: 'mcp:tools', gitlab_user: id },
    secret,
    3600,
  );
  const session: OAuthSession = {
    id,
    clientId: 'fixture-app',
    mcpAccessToken: token,
    mcpRefreshToken: randomUUID(),
    mcpTokenExpiry: Date.now() + 3600000,
    gitlabAccessToken: 'fixture-gitlab-token',
    gitlabRefreshToken: 'fixture-refresh-token',
    gitlabTokenExpiry: Date.now() + 7200000,
    gitlabUserId: mockSessions.size + 1,
    gitlabUsername: id,
    scopes: ['mcp:tools'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  mockSessions.set(id, session);
  return session;
}

async function request(token?: string, path = '/mcp', extra: RequestInit = {}): Promise<Response> {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    ...extra,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': source,
      'Mcp-Session-Id': 'lost-after-restart',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...extra.headers,
    },
    body: extra.method === 'GET' || extra.method === 'HEAD' ? undefined : '{}',
  });
  await response.arrayBuffer();
  return response;
}

// A busy anonymous client cannot stop valid clients initializing or recovering on the same IP.
it('admits authorized sessions after the shared anonymous IP quota is exhausted', async () => {
  expect((await request()).status).toBe(401);
  expect((await request()).status).toBe(401);
  expect((await request()).status).toBe(429);
  const a = account();
  const b = account();
  expect((await request(a.mcpAccessToken)).status).toBe(404);
  expect((await request(b.mcpAccessToken, '/')).status).toBe(404);
  expect(mockGetSession).toHaveBeenCalledTimes(2);
  // Fresh initialization has no transport ID at all, but still has the same verified OAuth identity.
  const response = await fetch(baseUrl + '/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'X-Forwarded-For': source,
      Authorization: `Bearer ${a.mcpAccessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'codex', version: '1' },
      },
    }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('Mcp-Session-Id')).toBeTruthy();
  expect(await response.text()).toContain('rate-limit-fixture');
});

// Express accepts these route spellings, so they must not pass through a second anonymous quota.
it.each(['/mcp/', '/MCP', '/MCP/', '//'])(
  'classifies the accepted transport path %s consistently',
  async (path) => {
    await request();
    await request();
    const a = account();
    expect((await request(a.mcpAccessToken, path)).status).toBe(404);
  },
);

// Several transport IDs of one OAuth session share its own optional quota, while B stays independent.
it('uses separate OAuth quotas rather than a common NAT or transport quota', async () => {
  settings.RATE_LIMIT_SESSION_ENABLED = true;
  const a = account();
  const b = account();
  expect((await request(a.mcpAccessToken)).status).toBe(404);
  expect(
    (await request(a.mcpAccessToken, '/mcp', { headers: { 'Mcp-Session-Id': 'other-lost' } }))
      .status,
  ).toBe(404);
  const limited = await request(a.mcpAccessToken, '/messages?sessionId=other-lost');
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect((await request(b.mcpAccessToken)).status).toBe(404);
  const entries = getRateLimitStats().entries;
  expect(entries.find((entry) => entry.key === `session:${a.id}`)?.count).toBe(2);
  expect(entries.find((entry) => entry.key === `session:${b.id}`)?.count).toBe(1);
  expect(entries.some((entry) => entry.key === `ip:${source}`)).toBe(false);
});

// Possessing or guessing a live transport ID proves no OAuth identity.
it('does not exempt a rejected bearer token using another live transport ID', async () => {
  const id = randomUUID();
  mockTransports.set(id, new Server({ name: 'other-client', version: '1' }));
  const extra = { headers: { 'Mcp-Session-Id': id } };
  expect((await request('invalid', '/mcp', extra)).status).toBe(401);
  expect((await request('invalid', '/mcp', extra)).status).toBe(401);
  expect((await request('invalid', '/mcp', extra)).status).toBe(429);
});

// Stream reconnects must reach MCP, not receive a successful dashboard response and reconnect again.
it.each(['/', '//'])(
  'routes streaming GET at %s through OAuth after an anonymous burst',
  async (path) => {
    await request();
    await request();
    const a = account();
    expect(
      (
        await request(a.mcpAccessToken, path, {
          method: 'GET',
          headers: { Accept: 'text/event-stream' },
        })
      ).status,
    ).toBe(404);
  },
);

// A root stream without a token must receive an OAuth challenge, never public dashboard JSON.
it.each(['/', '//'])(
  'challenges an unauthenticated stream at %s before returning any dashboard response',
  async (path) => {
    const response = await request(undefined, path, {
      method: 'GET',
      headers: { Accept: 'text/event-stream', 'Mcp-Session-Id': '' },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
  },
);

// Express serves HEAD through a GET route; ordinary dashboard probes must retain that behavior.
it('preserves public dashboard HEAD requests', async () => {
  expect(
    (
      await request(undefined, '/', {
        method: 'HEAD',
        headers: { Accept: 'application/json', 'Mcp-Session-Id': '' },
      })
    ).status,
  ).toBe(200);
});

// Public dashboard traffic remains anonymous and cannot exhaust an authenticated connection's budget.
it.each(['/', '//'])(
  'keeps ordinary dashboard requests at %s in the anonymous quota',
  async (path) => {
    const extra = { method: 'GET', headers: { Accept: 'application/json', 'Mcp-Session-Id': '' } };
    expect((await request(undefined, path, extra)).status).toBe(200);
    expect((await request(undefined, path, extra)).status).toBe(200);
    expect((await request(undefined, path, extra)).status).toBe(429);
  },
);
