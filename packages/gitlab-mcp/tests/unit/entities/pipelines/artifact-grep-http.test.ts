import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

const originalEnv = process.env;
const mockLogs: unknown[] = [];
jest.mock('../../../../src/logger', () => ({
  ...jest.requireActual('../../../../src/logger'),
  logDebug: (...args: unknown[]) => mockLogs.push(args),
  logWarn: (...args: unknown[]) => mockLogs.push(args),
}));

// These tests check where the scan stops by size; a 2 s wall-clock budget would make a
// 20 MiB scan on a loaded machine stop on time instead.
jest.mock('../../../../src/entities/pipelines/pipeline-grep', () => ({
  ...jest.requireActual('../../../../src/entities/pipelines/pipeline-grep'),
  LOG_GREP_BUDGET_MS: 60_000,
}));

const MIB = 1024 * 1024;
const EURO = String.fromCodePoint(0x20ac);
// Multibyte text on both sides of the 64 KiB read size, so matches span transport chunks.
const filler = `${EURO} passed\n`.repeat(9000);
const report = Buffer.from(
  `${filler}FAIL ${EURO}first test\n  at spec.ts:1\n${filler}FAIL second test\n  at spec.ts:2\n`,
);

const calls: {
  server: string;
  path: string;
  authorization?: string;
  pat?: string;
  range?: string;
}[] = [];
let sourceUrl: string;
let storageUrl: string;
let bytesSent = 0;
let read: (args: unknown) => Promise<unknown>;
let shutdown: () => Promise<void>;
let closeWorkers: () => Promise<void>;

/** Serve `body` honouring `bytes=a-b` as a range-capable server does. */
function serveRange(request: IncomingMessage, response: ServerResponse, body: Buffer) {
  const match = request.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
  if (!match) return void response.end(body);
  const start = Number(match[1]);
  if (start >= body.length) {
    response.writeHead(416, { 'Content-Range': `bytes */${body.length}` });
    return void response.end();
  }
  const end = Math.min(Number(match[2]), body.length - 1);
  response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${body.length}` });
  response.end(body.subarray(start, end + 1));
}

/** Stream text lines until the client stops reading, ignoring any Range header. */
function serveEndless(response: ServerResponse) {
  const chunk = Buffer.from('ok line\n'.repeat(8192));
  const send = () => {
    while (!response.destroyed && bytesSent < 200 * MIB) {
      bytesSent += chunk.length;
      if (!response.write(chunk)) return void response.once('drain', send);
    }
    if (!response.destroyed) response.end();
  };
  send();
}

const source = createServer((request, response) => {
  const path = request.url!;
  calls.push({
    server: 'source',
    path,
    authorization: request.headers.authorization,
    pat: request.headers['private-token'] as string | undefined,
    range: request.headers.range,
  });
  if (!path.includes('/artifacts/')) {
    response.setHeader('Content-Type', 'application/json');
    return void response.end(JSON.stringify({ web_url: `${sourceUrl}/test/project/-/jobs/34` }));
  }
  const file = path.split('/artifacts/')[1];
  if (file === 'report.txt') serveRange(request, response, report);
  else if (file === 'empty.txt') serveRange(request, response, Buffer.alloc(0));
  else if (file === 'redirect.txt') {
    response.writeHead(302, { Location: `${storageUrl}/download?signature=fixture-query-secret` });
    response.end();
  } else if (file === 'storage-denied.txt') {
    response.writeHead(302, { Location: `${storageUrl}/denied` });
    response.end();
  } else if (file === 'binary-late.txt')
    serveRange(request, response, Buffer.concat([report, Buffer.from([0x00, 0x0a])]));
  else if (file === 'image.png') {
    response.setHeader('Content-Type', 'image/png');
    response.end('FAIL');
  } else if (file === 'short-range.txt') {
    response.writeHead(206, { 'Content-Range': `bytes 0-4/${report.length}` });
    response.end(report.subarray(0, 5));
  } else if (file === 'short-body.txt') {
    // Announces the whole file but closes after five bytes.
    response.writeHead(206, { 'Content-Range': `bytes 0-${report.length - 1}/${report.length}` });
    response.end(report.subarray(0, 5));
  } else if (file === 'long-body.txt') {
    // Announces a five-byte file but sends the whole report.
    response.writeHead(206, { 'Content-Range': 'bytes 0-4/5' });
    response.end(report);
  } else if (file === 'unsatisfied.txt') {
    // A range from byte 0 refused for a file that is not empty.
    response.writeHead(416, { 'Content-Range': 'bytes */10' });
    response.end();
  } else if (file === 'unknown-total.txt') {
    response.writeHead(206, { 'Content-Range': 'bytes 0-4/*' });
    response.end(report.subarray(0, 5));
  } else if (file === 'endless.txt') serveEndless(response);
  else if (/^(403|404)\.txt$/.test(file)) {
    response.statusCode = Number(file.slice(0, 3));
    response.end('{"message":"Rejected"}');
  } else response.end('unexpected');
});
const storage = createServer((request, response) => {
  calls.push({
    server: 'storage',
    path: request.url!,
    authorization: request.headers.authorization,
    pat: request.headers['private-token'] as string | undefined,
    range: request.headers.range,
  });
  if (request.url === '/denied') {
    response.writeHead(403);
    return void response.end('fixture-storage-secret');
  }
  serveRange(request, response, report);
});

beforeAll(async () => {
  for (const server of [source, storage]) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  const url = (server: typeof source) =>
    `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  sourceUrl = url(source);
  storageUrl = url(storage);
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: sourceUrl,
    GITLAB_TOKEN: 'fixture-pat',
    GITLAB_PERSONAL_ACCESS_TOKEN: '',
    GITLAB_INSTANCES: '',
    GITLAB_INSTANCES_FILE: '',
    GITLAB_AUTH_COOKIE_PATH: '',
    OAUTH_ENABLED: 'false',
    OAUTH_SESSION_SECRET: randomBytes(32).toString('hex'),
    GITLAB_API_RETRY_ENABLED: 'false',
    GITLAB_DENIED_ACTIONS: '',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
  };
  await jest.isolateModulesAsync(async () => {
    const { pipelinesToolRegistry } = await import('../../../../src/entities/pipelines/registry');
    read = pipelinesToolRegistry.get('browse_pipelines')!.handler;
    closeWorkers = (await import('../../../../src/entities/pipelines/line-grep-worker'))
      .closeLineGrepWorkers;
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
});

afterAll(async () => {
  try {
    await closeWorkers?.();
    await shutdown?.();
  } finally {
    process.env = originalEnv;
    for (const server of [source, storage]) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});

interface GrepResult {
  hunks: Array<{ start_line: number; byte_offset: number; lines: string[] }>;
  match_count: number;
  total_lines: number | null;
  scanned_bytes: number;
  truncated: string | null;
  resume_from: number | null;
  scan_limit_reached: boolean;
}

const grep = (path: string, extra: Record<string, unknown> = {}) =>
  read({
    action: 'artifact_grep',
    project_id: 'test/project',
    job_id: '34',
    artifact_path: path,
    patterns: ['^FAIL'],
    before: 0,
    after: 1,
    ...extra,
  }) as Promise<GrepResult>;

// Matches past the first transport chunk keep absolute lines and offsets, and the whole file
// is requested once as one range from byte 0.
it('finds matches across transport chunks with absolute positions', async () => {
  const result = await grep('report.txt');
  expect(result).toMatchObject({
    match_count: 2,
    total_lines: 18005,
    scanned_bytes: report.length,
    truncated: null,
    resume_from: null,
    scan_limit_reached: false,
    hunks: [
      { start_line: 9000, lines: [`FAIL ${EURO}first test`, '  at spec.ts:1'] },
      { start_line: 18002, lines: ['FAIL second test', '  at spec.ts:2'] },
    ],
  });
  expect(calls.filter((call) => call.path.includes('/artifacts/'))).toEqual([
    expect.objectContaining({ range: `bytes=0-${20 * MIB}` }),
  ]);
});

// The acceptance contract: a reported byte_offset reads the same hunk back with artifact_file.
it('reports byte offsets that artifact_file reads back as the same hunk', async () => {
  const result = await grep('report.txt');
  for (const hunk of result.hunks) {
    const window = (await read({
      action: 'artifact_file',
      project_id: 'test/project',
      job_id: '34',
      artifact_path: 'report.txt',
      byte_offset: hunk.byte_offset,
      byte_limit: 256,
    })) as { text: string };
    expect(window.text.startsWith(hunk.lines.join('\n'))).toBe(true);
  }
});

// Signed object-storage URLs never receive the GitLab credential.
it('follows a redirect to object storage without forwarding credentials', async () => {
  await expect(grep('redirect.txt')).resolves.toMatchObject({ match_count: 2 });
  expect(calls[0]).toMatchObject({ server: 'source', pat: 'fixture-pat' });
  const download = calls.find((call) => call.server === 'storage')!;
  expect(download.authorization).toBeUndefined();
  expect(download.pat).toBeUndefined();
  expect(download.range).toBe(`bytes=0-${20 * MIB}`);
  expect(JSON.stringify(mockLogs)).not.toContain('fixture-query-secret');
});

// A NUL after 190 KiB of text refuses the file with artifact_file's typed reason.
it('refuses binary content found mid-stream with a view link', async () => {
  await expect(grep('binary-late.txt')).rejects.toMatchObject({
    structuredError: {
      error_code: 'ARTIFACT_READ_REFUSED',
      reason: 'not_text',
      action: 'artifact_grep',
      artifact_path: 'binary-late.txt',
      artifact_view_url: `${sourceUrl}/test/project/-/jobs/34/artifacts/file/binary-late.txt`,
    },
  });
});

// A binary media type is refused from the headers, before any byte is searched.
it('refuses a binary media type', async () => {
  await expect(grep('image.png')).rejects.toMatchObject({
    structuredError: { reason: 'not_text', action: 'artifact_grep' },
  });
});

// A server that ignores Range is read only to the scan limit, and the cut is explicit.
it('stops at 20 MiB and reports the scan limit', async () => {
  const result = await grep('endless.txt', { patterns: ['FAIL'] });
  expect(result).toMatchObject({
    match_count: 0,
    total_lines: null,
    truncated: 'scan_limit',
    resume_from: null,
    scan_limit_reached: true,
    scanned_bytes: 20 * MIB,
  });
  expect(bytesSent).toBeLessThan(40 * MIB);
}, 30_000);

// An empty file answers a range from byte 0 with 416; it is an empty search, not an error.
// Lines are counted as logs counts them (String.split), so the empty text is one empty line.
it('searches an empty file', async () => {
  await expect(grep('empty.txt')).resolves.toMatchObject({
    match_count: 0,
    total_lines: 1,
    scanned_bytes: 0,
    truncated: null,
  });
});

// A partial response shorter than the file would leave bytes unsearched.
it('refuses a range shorter than requested', async () => {
  await expect(grep('short-range.txt')).rejects.toMatchObject({
    structuredError: { reason: 'invalid_range', action: 'artifact_grep' },
  });
});

// A body that ends before or runs past its Content-Range is not the announced file: a short
// one would be reported as a complete search of bytes never received.
it.each(['short-body.txt', 'long-body.txt'])(
  'refuses a body that disagrees with its Content-Range (%s)',
  async (path) => {
    await expect(grep(path)).rejects.toMatchObject({
      structuredError: { reason: 'invalid_range', action: 'artifact_grep' },
    });
  },
);

// Only an empty file cannot satisfy a range from byte 0; any other 416 is a broken answer.
it('refuses an unsatisfied range for a file that is not empty', async () => {
  await expect(grep('unsatisfied.txt')).rejects.toMatchObject({
    structuredError: { reason: 'invalid_range', action: 'artifact_grep' },
  });
});

// With an unknown total, a range shorter than requested may end anywhere in the file.
it('refuses a short range of unknown total', async () => {
  await expect(grep('unknown-total.txt')).rejects.toMatchObject({
    structuredError: { reason: 'invalid_range', action: 'artifact_grep' },
  });
});

// GitLab permission failures keep their status for the MCP error mapping.
it.each([403, 404])('preserves GitLab HTTP %i', async (status) => {
  await expect(grep(`${status}.txt`)).rejects.toMatchObject({ status });
});

// Object storage denials are refusals, not GitLab token errors, and leak no body.
it('reports an object storage denial as a refusal', async () => {
  await expect(grep('storage-denied.txt')).rejects.toMatchObject({
    structuredError: { reason: 'storage_http_error', http_status: 403 },
  });
  expect(JSON.stringify(mockLogs)).not.toContain('fixture-storage-secret');
});

// An invalid pattern costs no GitLab request.
it('rejects an invalid pattern before requesting the file', async () => {
  await expect(grep('report.txt', { patterns: ['('] })).rejects.toThrow();
  expect(calls).toHaveLength(0);
});
