/** Real HTTP admission and body parsing through the production server and SDK transports. */
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { RequestHandler } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

let mockHttpServer: http.Server;
let mockRateLimited = false;
let mockOAuthEnabled = true;
const mockServers = new Map<string, Server>();
const mockToolCall = jest.fn();

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
  USE_REGISTRY: false,
  DASHBOARD_ENABLED: false,
  MCP_REQUEST_BODY_LIMIT: 10 * 1024 * 1024,
}));
jest.mock('../../src/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  logInfo: jest.fn(), logError: jest.fn(), logDebug: jest.fn(), logWarn: jest.fn(),
  truncateId: (id: string) => id,
}));
jest.mock('../../src/dashboard/index.js', () => ({ dashboardHandler: jest.fn() }));
jest.mock('../../src/entities/container_registry/regex', () => ({
  warmTagMatchers: jest.fn(), closeTagMatchers: jest.fn(), resetTagMatchers: jest.fn(),
}));
jest.mock('../../src/oauth/index', () => ({
  loadOAuthConfig: () => mockOAuthEnabled ? { gitlabClientId: 'test-app' } : null,
  isOAuthEnabled: () => mockOAuthEnabled,
  getAuthModeDescription: () => 'test',
  sessionStore: {
    associateMcpSession: jest.fn().mockResolvedValue(undefined),
    removeMcpSessionAssociation: jest.fn().mockResolvedValue(true),
  },
  runWithTokenContext: (_context: unknown, run: () => unknown) => run(),
}));
jest.mock('../../src/oauth/grant-revocation', () => ({ startSessionStore: jest.fn() }));
jest.mock('../../src/oauth/routes', () => ({ registerOAuthEndpoints: jest.fn() }));
jest.mock('../../src/middleware/index', () => ({
  responseWriteTimeoutMiddleware:
    jest.requireActual('../../src/middleware/response-write-timeout').responseWriteTimeoutMiddleware,
  rateLimiterMiddleware: (): RequestHandler => (_req, res, next) => {
    if (mockRateLimited) res.status(429).json({ error: 'rate limited' });
    else next();
  },
  oauthAuthMiddleware: ((req, res, next) => {
    const authorization = req.headers.authorization;
    if (authorization !== 'Bearer owner' && authorization !== 'Bearer other') {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.locals.oauthSessionId = authorization;
    next();
  }) satisfies RequestHandler,
}));
jest.mock('../../src/session-manager', () => ({
  getSessionManager: () => ({
    start: jest.fn(), touchSession: jest.fn(),
    removeSession: async (id: string) => {
      const server = mockServers.get(id);
      mockServers.delete(id);
      await server?.close();
    },
    createSession: async (id: string, transport: Transport) => {
      const server = new Server({ name: 'body-test', version: '1.0.0' }, { capabilities: { tools: {} } });
      server.setRequestHandler(CallToolRequestSchema, async request => {
        mockToolCall(request.params.arguments);
        return { content: [{ type: 'text', text: 'accepted' }] };
      });
      mockServers.set(id, server);
      await server.connect(transport);
      return server;
    },
  }),
}));

import { startServer } from '../../src/server';

const settings = jest.requireMock<{ MCP_REQUEST_BODY_LIMIT: number }>('../../src/config');
const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};
let baseUrl: string;
let previousPort: string | undefined;
const streams: AbortController[] = [];

beforeEach(async () => {
  previousPort = process.env.PORT;
  process.env.PORT = '0';
  mockRateLimited = false;
  mockOAuthEnabled = true;
  settings.MCP_REQUEST_BODY_LIMIT = 10 * 1024 * 1024;
  mockToolCall.mockClear();
});

afterEach(async () => {
  for (const controller of streams.splice(0)) controller.abort();
  const servers = [...mockServers.values()];
  mockServers.clear();
  await Promise.all(servers.map(server => server.close()));
  if (mockHttpServer) {
    mockHttpServer.closeAllConnections();
    await new Promise<void>(resolve => mockHttpServer.close(() => resolve()));
  }
  if (previousPort === undefined) delete process.env.PORT;
  else process.env.PORT = previousPort;
});

async function start(limit = 10 * 1024 * 1024): Promise<void> {
  settings.MCP_REQUEST_BODY_LIMIT = limit;
  await startServer();
  if (!mockHttpServer.listening) await new Promise<void>(resolve => mockHttpServer.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(mockHttpServer.address() as AddressInfo).port}`;
}

async function post(path: string, body: string, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(baseUrl + path, {
    method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer owner', ...extra,
    }, body,
  });
}

async function sseEndpoint(): Promise<string> {
  const controller = new AbortController();
  streams.push(controller);
  const response = await fetch(baseUrl + '/sse', {
    headers: { Authorization: 'Bearer owner' }, signal: controller.signal,
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  let received = '';
  while (!received.includes('\n\n')) {
    const part = await reader.read();
    if (part.done) throw new Error('SSE closed before endpoint');
    received += new TextDecoder().decode(part.value);
  }
  const endpoint = received.match(/data: (\/messages\?sessionId=[^\n]+)/)?.[1];
  if (!endpoint) throw new Error('Missing SSE endpoint');
  return endpoint;
}

function paddedInitialize(bytes: number): string {
  const body = JSON.stringify({ ...initialize, params: { ...initialize.params, padding: '' } });
  return body.replace('"padding":""', `"padding":"${'x'.repeat(bytes - Buffer.byteLength(body))}"`);
}

/** Send no body: a response proves admission did not wait for the JSON parser. */
async function headersOnly(path: string, authorization = 'Bearer owner'): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const request = http.request(baseUrl + path, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', 'Content-Length': 11 * 1024 * 1024,
        Authorization: authorization,
      },
    }, response => {
      resolve(response.statusCode!);
      response.resume();
      request.destroy();
    });
    request.on('error', reject);
    request.setTimeout(2000, () => request.destroy(new Error('Admission waited for the body')));
    request.flushHeaders();
  });
}

describe.each(['streamable', 'sse'] as const)('%s request bodies', mode => {
  async function endpoint(): Promise<string> {
    return mode === 'sse' ? sseEndpoint() : '/mcp';
  }

  // Exact boundaries prevent regressions from either the Express or SDK fallback limit.
  it('accepts exactly the configured number of JSON bytes', async () => {
    await start(512);
    const response = await post(await endpoint(), paddedInitialize(512));
    expect(response.status).toBe(mode === 'sse' ? 202 : 200);
    await response.text();
  });

  // Operators and clients need a protocol error rather than an Express HTML page.
  it('returns a JSON-RPC 413 for one byte above the configured limit', async () => {
    await start(512);
    const response = await post(await endpoint(), paddedInitialize(513));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      jsonrpc: '2.0', id: null,
      error: { code: -32600, message: expect.stringMatching(/512.*MCP_REQUEST_BODY_LIMIT/) },
    });
  });

  // A normal GitLab payload must not hit Express's implicit 100 KiB default.
  it('accepts 102401 JSON bytes with the default configuration', async () => {
    await start();
    const response = await post(await endpoint(), paddedInitialize(102401));
    expect(response.status).toBe(mode === 'sse' ? 202 : 200);
    await response.text();
  });

  // Escaped control characters make a valid 1 MiB note exceed the SDK's 4 MiB fallback.
  it('delivers a 1 MiB escaped note to the tool unchanged', async () => {
    await start();
    const path = await endpoint();
    const initialized = await post(path, JSON.stringify(initialize));
    const sessionId = initialized.headers.get('mcp-session-id');
    await initialized.text();
    const body = '\u0001'.repeat(1024 * 1024 - 3) + '\n"\\';
    expect(Buffer.byteLength(body)).toBe(1024 * 1024);
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'note', arguments: { body } } });
    const response = await post(path, payload, sessionId ? { 'mcp-session-id': sessionId } : {});
    expect(response.status).toBe(mode === 'sse' ? 202 : 200);
    await response.text();
    // SSE dispatch is asynchronous; the handler resolves before its response is emitted.
    expect(mockToolCall).toHaveBeenCalledWith({ body });
  });
});

// Both Streamable paths and legacy messages must reject before reading any bytes.
it.each(['/mcp', '/', '/messages?sessionId=unknown'])('authenticates %s before reading the body', async path => {
  await start();
  expect(await headersOnly(path, '')).toBe(401);
});

// Rate admission applies ahead of body parsing and OAuth work on all MCP POST routes.
it.each(['/mcp', '/', '/messages?sessionId=unknown'])('rate limits %s before reading the body', async path => {
  await start();
  mockRateLimited = true;
  expect(await headersOnly(path)).toBe(429);
});

// A leaked or nonexistent SSE session must never become a body parsing endpoint.
it('rejects unknown and foreign SSE sessions before reading the body', async () => {
  await start();
  const path = await sseEndpoint();
  expect(await headersOnly('/messages?sessionId=unknown')).toBe(404);
  expect(await headersOnly(path, 'Bearer other')).toBe(404);
});

// The root alias must retain the same successful large-request path in static mode.
it('accepts a large request on the root alias without OAuth', async () => {
  mockOAuthEnabled = false;
  await start();
  const response = await post('/', paddedInitialize(102401));
  expect(response.status).toBe(200);
  await response.text();
});
