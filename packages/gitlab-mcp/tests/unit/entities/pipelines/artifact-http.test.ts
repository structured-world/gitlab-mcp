import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { setImmediate } from 'node:timers';

const originalEnv = process.env;
const mockLogs: unknown[] = [];
jest.mock('../../../../src/logger', () => ({
  ...jest.requireActual('../../../../src/logger'),
  logDebug: (...args: unknown[]) => mockLogs.push(args),
  logWarn: (...args: unknown[]) => mockLogs.push(args),
}));

const calls: {
  server: string;
  path: string;
  authorization?: string;
  cookie?: string;
  pat?: string;
}[] = [];
let sourceUrl: string;
let secondUrl: string;
let storageUrl: string;
let bytesSent = 0;
let transferClosed: (() => void) | undefined;
let read: (args: unknown) => Promise<unknown>;
let asAccount: typeof import('../../../../src/oauth/token-context').runWithTokenContext;
let shutdown: () => Promise<void>;
let requestUndecoded: typeof import('../../../../src/utils/fetch').requestUndecoded;
const fixture = Buffer.from('report: A\u20ac\ud83d\ude00 done\n');

function record(server: string, request: IncomingMessage) {
  calls.push({
    server,
    path: request.url!,
    authorization: request.headers.authorization,
    cookie: request.headers.cookie,
    pat: request.headers['private-token'] as string | undefined,
  });
}

function gitlabResponse(label: string, request: IncomingMessage, response: ServerResponse) {
  record(label, request);
  if (request.url!.endsWith('/timeout.txt') || request.url!.endsWith('/timeout-unread.txt')) {
    const notify = transferClosed;
    response.once('close', () => notify?.());
    response.writeHead(200);
    if (request.url!.endsWith('/timeout-unread.txt')) response.flushHeaders();
    else response.write('start');
    return;
  }
  if (request.url!.endsWith('/unread.txt')) {
    const notify = transferClosed;
    response.once('close', () => notify?.());
    response.writeHead(200);
    response.flushHeaders();
    return;
  }
  if (request.url!.endsWith('/broken.txt')) {
    response.writeHead(200);
    response.write('start');
    setImmediate(() => response.destroy());
    return;
  }
  const path = request.url!;
  if (!path.includes('/artifacts/')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ web_url: `${sourceUrl}/test/project/-/jobs/34` }));
  } else if (path.endsWith('/redirect.txt')) {
    response.writeHead(302, { Location: `${storageUrl}/download?signature=fixture-query-secret` });
    response.end();
  } else if (path.endsWith('/return.txt')) {
    response.writeHead(302, { Location: `${storageUrl}/return` });
    response.end();
  } else if (path.endsWith('/storage-auth.txt')) {
    response.writeHead(302, {
      Location: `${storageUrl}/unauthorized?signature=fixture-query-secret`,
    });
    response.end();
  } else if (path.endsWith('/unsafe.txt')) {
    response.writeHead(302, { Location: 'file:///etc/passwd' });
    response.end();
  } else if (path.endsWith('/loop.txt')) {
    response.writeHead(302, { Location: 'loop.txt' });
    response.end();
  } else if (path.endsWith('/missing-location.txt')) {
    response.writeHead(302);
    response.end();
  } else if (path.endsWith('/binary.bin')) {
    response.end(Buffer.from([0, 1, 255]));
  } else if (path.endsWith('/gzip.txt')) {
    response.setHeader('Content-Encoding', 'gzip');
    response.end(gzipSync(Buffer.alloc(1024 * 1024, 65)));
  } else if (/\/(204|205|304|401|403|404|429)\.txt$/.test(path)) {
    response.statusCode = Number(path.match(/(\d{3})\.txt$/)![1]);
    response.setHeader('Retry-After', '30');
    if ([204, 205, 304].includes(response.statusCode)) response.end();
    else response.end('{"message":"Rejected"}');
  } else if (path.endsWith('/huge.txt')) {
    const chunk = Buffer.alloc(64 * 1024, 65);
    const send = () => {
      while (!response.destroyed && bytesSent < 200 * 1024 * 1024) {
        bytesSent += chunk.length;
        if (!response.write(chunk)) {
          response.once('drain', send);
          return;
        }
      }
      if (!response.destroyed) response.end();
    };
    send();
  } else if (path.endsWith('/range.txt')) {
    const match = request.headers.range!.match(/^bytes=(\d+)-(\d+)$/)!;
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), fixture.length - 1);
    response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${fixture.length}` });
    response.end(fixture.subarray(start, end + 1));
  } else {
    response.end(label === 'second' ? 'second instance' : fixture);
  }
}

const source = createServer((req, res) => gitlabResponse('source', req, res));
const second = createServer((req, res) => gitlabResponse('second', req, res));
const storage = createServer((request, response) => {
  record('storage', request);
  if (request.url === '/return') {
    response.writeHead(302, {
      Location: `${sourceUrl}/api/v4/projects/test%2Fproject/jobs/34/artifacts/final.txt`,
      'Set-Cookie': ['storage=fixture; HttpOnly; Secure', 'other=fixture; HttpOnly; Secure'],
    });
    response.end();
  } else if (request.url?.startsWith('/unauthorized')) {
    response.writeHead(401);
    response.end('fixture-storage-secret');
  } else response.end('signed storage text');
});
let directory: string;

beforeAll(async () => {
  for (const server of [source, second, storage]) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  const url = (server: typeof source) =>
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  sourceUrl = url(source);
  secondUrl = url(second);
  storageUrl = url(storage);
  directory = mkdtempSync(join(tmpdir(), 'artifact-http-'));
  const cookieFile = join(directory, 'cookies.txt');
  writeFileSync(cookieFile, '127.0.0.1\tFALSE\t/\tFALSE\t0\tsession\tfixture-cookie\n');
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: sourceUrl,
    GITLAB_TOKEN: 'fixture-pat',
    GITLAB_PERSONAL_ACCESS_TOKEN: '',
    GITLAB_INSTANCES: '',
    GITLAB_INSTANCES_FILE: '',
    GITLAB_AUTH_COOKIE_PATH: cookieFile,
    OAUTH_ENABLED: 'true',
    OAUTH_ISSUER: 'https://mcp.example.com',
    OAUTH_CLIENT_ID: 'fixture-client-id',
    OAUTH_SESSION_SECRET: randomBytes(32).toString('hex'),
    GITLAB_API_RETRY_ENABLED: 'false',
    GITLAB_API_BODY_TIMEOUT_MS: '100',
    GITLAB_DENIED_ACTIONS: '',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
  };
  await jest.isolateModulesAsync(async () => {
    requestUndecoded = (await import('../../../../src/utils/fetch')).requestUndecoded;
    const { pipelinesToolRegistry } = await import('../../../../src/entities/pipelines/registry');
    const { runWithTokenContext } = await import('../../../../src/oauth/token-context');
    asAccount = runWithTokenContext;
    read = pipelinesToolRegistry.get('browse_pipelines')!.handler;
    const { InstanceRegistry } = await import('../../../../src/services/InstanceRegistry');
    const registry = InstanceRegistry.getInstance();
    await registry.initialize();
    shutdown = () => registry.resetWithPools();
  });
}, 30_000);

beforeEach(() => {
  calls.length = 0;
  mockLogs.length = 0;
  bytesSent = 0;
  transferClosed = undefined;
});
afterAll(async () => {
  try {
    await shutdown?.();
  } finally {
    process.env = originalEnv;
    for (const server of [source, second, storage]) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    if (directory) rmSync(directory, { recursive: true });
  }
});

const args = { action: 'artifact_file', project_id: 'test/project', job_id: '34' };
const call = (
  path: string,
  extra: Record<string, unknown> = {},
  instance = sourceUrl,
  token = 'first-token',
) =>
  asAccount(
    {
      gitlabToken: token,
      gitlabUserId: 1,
      gitlabUsername: 'fixture',
      sessionId: 'fixture',
      apiUrl: instance,
    },
    () => read({ ...args, artifact_path: path, ...extra }),
  );

// Real HTTP tests the credential injection boundary, including redirects back to GitLab.
it.each(['redirect.txt', 'return.txt'])(
  'never forwards or reinjects credentials for %s',
  async (path) => {
    await expect(call(path)).resolves.toMatchObject({ complete: true });
    expect(calls[0].authorization).toBe('Bearer first-token');
    expect(calls[0].cookie).toBe('session=fixture-cookie');
    for (const request of calls.slice(1)) {
      expect(request.authorization).toBeUndefined();
      expect(request.cookie).toBeUndefined();
      expect(request.pat).toBeUndefined();
    }
    expect(JSON.stringify(mockLogs)).not.toContain('fixture-query-secret');
  },
);

// Different request contexts must not exchange their instance, token or result.
it('keeps concurrent instances isolated', async () => {
  const [first, other] = await Promise.all([
    call('plain.txt'),
    call('plain.txt', {}, secondUrl, 'second-token'),
  ]);
  expect(first).toMatchObject({ text: fixture.toString() });
  expect(other).toMatchObject({ text: 'second instance' });
  expect(calls.find((r) => r.server === 'source')!.authorization).toBe('Bearer first-token');
  expect(calls.find((r) => r.server === 'second')!.authorization).toBe('Bearer second-token');
});

// Range and sequential responses must reconstruct the same file without UTF-8 loss.
it.each(['plain.txt', 'range.txt'])('reconstructs %s through byte continuations', async (path) => {
  let offset = 0;
  let text = '';
  for (;;) {
    const page = (await call(path, { byte_offset: offset, byte_limit: 4 })) as {
      text: string;
      next_byte_offset: number | null;
    };
    text += page.text;
    if (page.next_byte_offset === null) break;
    expect(page.next_byte_offset).toBeGreaterThan(offset);
    offset = page.next_byte_offset;
  }
  expect(text).toBe(fixture.toString());
});

// Cancellation bounds bytes accepted from a streaming server, independently of Content-Length.
it('cancels a synthetic 200 MiB file after a small window', async () => {
  expect(await call('huge.txt', { byte_limit: 200 })).toMatchObject({
    text: 'A'.repeat(200),
    truncated: true,
  });
  expect(bytesSent).toBeLessThan(20 * 1024 * 1024);
});

// Refusals retain machine-readable reasons and a canonical view link for binary data.
it('refuses binary bytes with bounded metadata', async () => {
  await expect(call('binary.bin')).rejects.toMatchObject({
    structuredError: {
      error_code: 'ARTIFACT_READ_REFUSED',
      reason: 'not_text',
      artifact_path: 'binary.bin',
      artifact_view_url: `${sourceUrl}/test/project/-/jobs/34/artifacts/file/binary.bin`,
    },
  });
});

// Raw HTTP must reject a compressed response before the fetch layer can inflate it.
it('rejects an unexpected compressed response', async () => {
  await expect(call('gzip.txt')).rejects.toMatchObject({
    structuredError: { reason: 'unsupported_encoding' },
  });
});

// The HTTP adapter must preserve gzip bytes rather than allocating their inflated content.
it('retains the original content encoding and bytes at the raw transport boundary', async () => {
  const response = await requestUndecoded(
    `${sourceUrl}/api/v4/projects/1/jobs/34/artifacts/gzip.txt`,
    {},
    undefined,
  );
  expect(response.headers.get('content-encoding')).toBe('gzip');
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(Array.from(bytes.subarray(0, 2))).toEqual([31, 139]);
  expect(bytes.byteLength).toBeLessThan(2048);
});

// Object-storage authentication failure must not initiate GitLab account reauthentication.
it('distinguishes storage access errors from GitLab token errors', async () => {
  await expect(call('storage-auth.txt')).rejects.toMatchObject({
    structuredError: {
      error_code: 'ARTIFACT_READ_REFUSED',
      reason: 'storage_http_error',
      http_status: 401,
    },
  });
  expect(JSON.stringify(mockLogs)).not.toContain('fixture-query-secret');
  expect(JSON.stringify(mockLogs)).not.toContain('fixture-storage-secret');
});

// An idle body must abort the socket and preserve the established structured timeout type.
it('preserves an artifact body timeout', async () => {
  await expect(call('timeout.txt')).rejects.toMatchObject({
    name: 'GitLabTimeoutError',
    phase: 'body',
    timeoutMs: 100,
  });
});

// Cancellation before the first pull must still destroy the underlying HTTP request.
it('closes an unread response immediately on cancellation', async () => {
  const closed = new Promise<void>((resolve) => {
    transferClosed = resolve;
  });
  const response = await requestUndecoded(
    `${sourceUrl}/api/v4/projects/1/jobs/34/artifacts/unread.txt`,
    {},
    undefined,
  );
  await response.body!.cancel();
  await closed;
  expect(response.bodyUsed).toBe(true);
});

// An error before the first pull must remain observable without an unhandled Node error.
it('propagates a timeout that occurs before reading begins', async () => {
  const closed = new Promise<void>((resolve) => {
    transferClosed = resolve;
  });
  const response = await requestUndecoded(
    `${sourceUrl}/api/v4/projects/1/jobs/34/artifacts/timeout-unread.txt`,
    {},
    undefined,
  );
  await closed;
  const reader = response.body!.getReader();
  try {
    await expect(reader.read()).rejects.toMatchObject({ code: 'UND_ERR_BODY_TIMEOUT' });
  } finally {
    reader.releaseLock();
  }
});

// A disconnected producer must not turn the received prefix into successful partial text.
it('propagates a mid-transfer socket failure', async () => {
  await expect(call('broken.txt')).rejects.toMatchObject({ code: 'UND_ERR_SOCKET' });
});

// API failures must retain the status used by MCP authentication and rate-limit conversion.
it.each([401, 403, 404, 429])('preserves HTTP %i', async (status) => {
  await expect(call(`${status}.txt`)).rejects.toMatchObject({ status });
});

// Redirect responses cannot select a non-HTTP target or create an unbounded request chain.
it.each(['unsafe.txt', 'loop.txt'])('refuses redirect %s', async (path) => {
  await expect(call(path)).rejects.toThrow(/unsafe redirect|redirect limit/);
  expect(calls.length).toBeLessThanOrEqual(21);
});

// A broken redirect must fail explicitly rather than retry the same authenticated URL.
it('refuses a redirect without Location', async () => {
  await expect(call('missing-location.txt')).rejects.toThrow('no Location');
  expect(calls).toHaveLength(1);
});

// Statuses that prohibit content must not construct a body or leave an unhandled Node error.
it.each([204, 205, 304])('adapts empty HTTP %i safely', async (status) => {
  const response = await requestUndecoded(
    `${sourceUrl}/api/v4/projects/1/jobs/34/artifacts/${status}.txt`,
    {},
    undefined,
  );
  expect(response.status).toBe(status);
  expect(response.body).toBeNull();
  expect(await response.text()).toBe('');
});
