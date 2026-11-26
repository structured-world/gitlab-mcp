import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

const originalEnv = process.env;

interface Call {
  server: string;
  path: string;
  range?: string;
  authorization?: string;
}
const calls: Call[] = [];
let sourceUrl: string;
let storageUrl: string;
let read: (args: unknown) => Promise<unknown>;
let asAccount: typeof import('../../../../src/oauth/token-context').runWithTokenContext;
let shutdown: () => Promise<void>;

const junit = Buffer.from(
  '<testsuite name="A€😀">\n<testcase name="first"/>\n<failure>boom</failure>\n</testsuite>\n',
);
const second = Buffer.from('<testsuite name="second">\n<failure>later</failure>\n</testsuite>\n');
const sast = Buffer.from(
  `{"version":"15.0.0","vulnerabilities":[${'"finding",'.repeat(40)}"last"]}\n`,
);
const archiveEntry = Buffer.from('{"entry":"from the archive"}\n');
// 64 MiB of text in about 64 KiB of gzip.
const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, 65));

/** The stored file each fixture job serves for a report type, as GitLab stores it. */
const stored: Record<string, Buffer> = {
  // One gzip member, as for a single collected file.
  '40': gzipSync(junit),
  // One member per collected file, concatenated.
  '41': Buffer.concat([gzipSync(junit), gzipSync(second)]),
  '42': bomb,
  // Stored uncompressed.
  '43': sast,
  '44': Buffer.alloc(0),
  // A valid member cut short, and bytes that only look like gzip.
  '45': gzipSync(junit).subarray(0, 40),
  '46': Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), randomBytes(64)]),
  // The whole archive, as an instance answers that ignores the report type.
  '47': Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), randomBytes(64)]),
  '48': gzipSync(Buffer.from([0, 1, 2, 255])),
};

function record(server: string, request: IncomingMessage): void {
  calls.push({
    server,
    path: request.url!,
    range: request.headers.range,
    authorization: request.headers.authorization,
  });
}

function sendWhole(response: ServerResponse, body: Buffer): void {
  // A large body is written in pieces so a cancelled read stops the transfer.
  const piece = 16 * 1024;
  let offset = 0;
  const send = (): void => {
    while (!response.destroyed && offset < body.length) {
      const chunk = body.subarray(offset, offset + piece);
      offset += chunk.length;
      if (!response.write(chunk)) {
        response.once('drain', send);
        return;
      }
    }
    if (!response.destroyed) response.end();
  };
  send();
}

const source = createServer((request, response) => {
  record('source', request);
  const url = new URL(request.url!, 'http://fixture');
  const job = url.pathname.match(/\/jobs\/(\d+)/)![1];
  if (url.pathname.includes('/artifacts/')) {
    // An archive entry, served as the byte range asked for.
    const [, first, last] = request.headers.range!.match(/^bytes=(\d+)-(\d+)$/)!;
    const end = Math.min(Number(last), archiveEntry.length - 1);
    response.writeHead(206, {
      'Content-Range': `bytes ${first}-${end}/${archiveEntry.length}`,
    });
    response.end(archiveEntry.subarray(Number(first), end + 1));
    return;
  }
  if (!url.pathname.endsWith('/artifacts')) {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ web_url: `${sourceUrl}/test/project/-/jobs/${job}` }));
    return;
  }
  if (['401', '403', '404'].includes(job)) {
    response.statusCode = Number(job);
    response.end('{"message":"Rejected"}');
    return;
  }
  if (job === '50') {
    response.writeHead(302, { Location: `${storageUrl}/junit.xml.gz?signature=fixture-secret` });
    response.end();
    return;
  }
  const body = stored[job];
  const range = request.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
  if (range) {
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), body.length - 1);
    response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${body.length}` });
    response.end(body.subarray(start, end + 1));
    return;
  }
  // GitLab names the stored file; the headers say nothing about the report inside.
  response.setHeader('Content-Type', 'application/octet-stream');
  sendWhole(response, body);
});
const storage = createServer((request, response) => {
  record('storage', request);
  response.setHeader('Content-Type', 'application/gzip');
  response.end(gzipSync(junit));
});

beforeAll(async () => {
  for (const server of [source, storage]) {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  const url = (server: typeof source): string =>
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
    OAUTH_ENABLED: 'true',
    OAUTH_ISSUER: 'https://mcp.example.com',
    OAUTH_CLIENT_ID: 'fixture-client-id',
    OAUTH_SESSION_SECRET: randomBytes(32).toString('hex'),
    GITLAB_API_RETRY_ENABLED: 'false',
    GITLAB_DENIED_ACTIONS: '',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
  };
  await jest.isolateModulesAsync(async () => {
    const { pipelinesToolRegistry } = await import('../../../../src/entities/pipelines/registry');
    const { runWithTokenContext } = await import('../../../../src/oauth/token-context');
    asAccount = runWithTokenContext;
    read = pipelinesToolRegistry.get('browse_pipelines')!.handler;
    const { InstanceRegistry } = await import('../../../../src/services/InstanceRegistry');
    const registry = InstanceRegistry.getInstance();
    await registry.initialize();
    const { closeLineGrepWorkers } =
      await import('../../../../src/entities/pipelines/line-grep-worker');
    shutdown = async () => {
      await closeLineGrepWorkers();
      await registry.resetWithPools();
    };
  });
}, 30_000);

beforeEach(() => {
  calls.length = 0;
});

afterAll(async () => {
  try {
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

const invoke = async (args: Record<string, unknown>): Promise<unknown> =>
  await asAccount(
    {
      gitlabToken: 'first-token',
      gitlabUserId: 1,
      gitlabUsername: 'fixture',
      sessionId: 'fixture',
      apiUrl: sourceUrl,
    },
    () => read(args),
  );
const call = (
  action: 'artifact_file' | 'artifact_grep',
  job: string,
  extra: Record<string, unknown> = {},
): Promise<unknown> =>
  invoke({ action, project_id: 'test/project', job_id: job, report_type: 'junit', ...extra });
const file = (job: string, extra: Record<string, unknown> = {}): Promise<unknown> =>
  call('artifact_file', job, extra);
const downloads = (): Call[] => calls.filter((item) => item.path.includes('/artifacts'));

// The report is requested by type from the artifacts endpoint, whole, and returned inflated.
it('reads a gzip report by type as its own text', async () => {
  await expect(file('40')).resolves.toEqual({
    project_id: 'test/project',
    job_id: '40',
    report_type: 'junit',
    text: junit.toString(),
    byte_start: 0,
    byte_end: junit.length,
    next_byte_offset: null,
    total_bytes: junit.length,
    complete: true,
    truncated: false,
  });
  expect(downloads()).toEqual([
    {
      server: 'source',
      path: '/api/v4/projects/test%2Fproject/jobs/40/artifacts?file_type=junit',
      range: undefined,
      authorization: 'Bearer first-token',
    },
  ]);
});

// Offsets and limits count the report's bytes, not the stored gzip: paging in 4-byte
// windows must rebuild the text without splitting a multi-byte character.
it('pages through a gzip report by decoded byte offsets', async () => {
  let offset: number | null = 0;
  let text = '';
  while (offset !== null) {
    const page = (await file('40', { byte_offset: offset, byte_limit: 4 })) as {
      text: string;
      byte_start: number;
      byte_end: number;
      next_byte_offset: number | null;
    };
    expect(page.byte_start).toBe(offset);
    expect(page.byte_end - page.byte_start).toBe(Buffer.byteLength(page.text));
    text += page.text;
    if (page.next_byte_offset !== null) expect(page.next_byte_offset).toBeGreaterThan(offset);
    offset = page.next_byte_offset;
  }
  expect(text).toBe(junit.toString());
  // Never a range of the compressed file: its bytes are not the report's.
  expect(downloads().every((item) => item.range === undefined)).toBe(true);
});

// The runner writes one gzip member per collected file; stopping after the first would
// report a complete read of half the report.
it('reads every gzip member of a report', async () => {
  const text = junit.toString() + second.toString();
  await expect(file('41')).resolves.toMatchObject({
    text,
    total_bytes: Buffer.byteLength(text),
    complete: true,
  });
});

// A small gzip must not expand past the window that was asked for.
it('bounds a highly compressed report by the decoded window', async () => {
  await expect(file('42', { byte_limit: 200 })).resolves.toMatchObject({
    text: 'A'.repeat(200),
    byte_end: 200,
    next_byte_offset: 200,
    total_bytes: null,
    complete: false,
    truncated: true,
  });
});

// The largest offset still reads a decoded window, and a file continuing past the reach of
// byte_offset says so instead of offering an offset the schema refuses.
it('reports the continuation limit of a report longer than the largest offset', async () => {
  const limit = 20 * 1024 * 1024;
  await expect(file('42', { byte_offset: limit, byte_limit: 100 })).resolves.toMatchObject({
    text: 'A'.repeat(100),
    byte_start: limit,
    next_byte_offset: null,
    complete: false,
    truncated: true,
    continuation_limit: { reason: 'byte_offset_limit', max_byte_offset: limit },
  });
});

describe('a report GitLab stores uncompressed', () => {
  const sastFile = (extra: Record<string, unknown> = {}): Promise<unknown> =>
    file('43', { report_type: 'sast', ...extra });

  // From the start it is read like any report: whole, with the format taken from the bytes.
  it('is read whole from the first byte', async () => {
    await expect(sastFile()).resolves.toMatchObject({ text: sast.toString(), complete: true });
    expect(downloads()).toMatchObject([
      {
        path: '/api/v4/projects/test%2Fproject/jobs/43/artifacts?file_type=sast',
        range: undefined,
      },
    ]);
  });

  // Further in, only the window is transferred: the stored bytes are the report's.
  it('requests only the window past the start', async () => {
    await expect(sastFile({ byte_offset: 100, byte_limit: 50 })).resolves.toMatchObject({
      text: sast.subarray(100, 150).toString(),
      byte_start: 100,
      byte_end: 150,
      total_bytes: sast.length,
      next_byte_offset: 150,
    });
    expect(downloads()).toMatchObject([{ range: 'bytes=100-153' }]);
  });

  // The same window of a gzip type cannot be a range of the stored file.
  it('is the only kind read by range', async () => {
    await file('40', { byte_offset: 10, byte_limit: 4 });
    expect(downloads()).toMatchObject([{ range: undefined }]);
  });
});

// An empty report is a complete empty text; that is its content, not a failure.
it('reads an empty report as complete empty text', async () => {
  await expect(file('44')).resolves.toMatchObject({
    text: '',
    total_bytes: 0,
    complete: true,
    next_byte_offset: null,
  });
});

// A missing or expired report, a hidden job and a denial are errors with GitLab's status,
// never an empty report.
it.each([
  ['404', 404],
  ['403', 403],
  ['401', 401],
])('fails with HTTP %s instead of an empty result', async (job, status) => {
  await expect(file(job)).rejects.toMatchObject({ status });
  await expect(call('artifact_grep', job, { patterns: ['x'] })).rejects.toMatchObject({ status });
});

it('names the missing report in the 404', async () => {
  await expect(file('404')).rejects.toThrow(
    'no junit report artifact for job 404: the job did not upload one, it expired, or the job is not accessible',
  );
});

// A stored file cut short or damaged yields a refusal, not the text inflated before the fault.
it.each(['45', '46'])('refuses the damaged gzip of job %s', async (job) => {
  await expect(file(job)).rejects.toMatchObject({
    structuredError: {
      error_code: 'ARTIFACT_READ_REFUSED',
      reason: 'invalid_compression',
      report_type: 'junit',
      job_id: job,
    },
  });
  await expect(call('artifact_grep', job, { patterns: ['x'] })).rejects.toMatchObject({
    structuredError: { reason: 'invalid_compression', action: 'artifact_grep' },
  });
});

// An instance older than the report-type parameter ignores it and sends the whole archive.
// That must not be read as the report.
it('refuses the artifacts archive sent in place of a report', async () => {
  await expect(file('47')).rejects.toMatchObject({
    structuredError: {
      reason: 'report_type_unsupported',
      message: expect.stringContaining('requires GitLab 19.4+'),
    },
  });
});

// A report that is not text is refused with the browser download of that report.
it('refuses a binary report with its download link', async () => {
  const refusal = file('48').catch((error: unknown) => error);
  await expect(refusal).resolves.toMatchObject({
    structuredError: {
      error_code: 'ARTIFACT_READ_REFUSED',
      reason: 'not_text',
      report_type: 'junit',
      artifact_view_url: `${sourceUrl}/test/project/-/jobs/48/artifacts/download?file_type=junit`,
    },
  });
  expect((await refusal) as { structuredError: object }).not.toHaveProperty(
    'structuredError.artifact_path',
  );
});

// The redirect to object storage carries no GitLab credentials for a report either.
it('does not forward credentials to object storage', async () => {
  await expect(file('50')).resolves.toMatchObject({ text: junit.toString(), complete: true });
  expect(calls.map((item) => item.server)).toEqual(['source', 'storage']);
  expect(calls[1].authorization).toBeUndefined();
});

describe('artifact_grep on a report', () => {
  // The search runs over the report's text and its byte offsets read back with artifact_file.
  it('finds lines in every gzip member with offsets artifact_file accepts', async () => {
    const result = (await call('artifact_grep', '41', {
      patterns: ['<failure>'],
      before: 0,
      after: 0,
    })) as { hunks: { byte_offset: number; lines: string[] }[] };
    expect(result).toMatchObject({
      report_type: 'junit',
      match_count: 2,
      truncated: null,
      scan_limit_reached: false,
      scanned_bytes: junit.length + second.length,
    });
    expect(result.hunks.map((hunk) => hunk.lines)).toEqual([
      ['<failure>boom</failure>'],
      ['<failure>later</failure>'],
    ]);
    const back = (await file('41', { byte_offset: result.hunks[1].byte_offset })) as {
      text: string;
    };
    expect(back.text.startsWith('<failure>later</failure>')).toBe(true);
  });

  // A report longer than the search reach is searched up to it and says the search stopped.
  it('stops at the search limit of a highly compressed report', async () => {
    await expect(
      call('artifact_grep', '42', { patterns: ['B'], before: 0, after: 0 }),
    ).resolves.toMatchObject({ match_count: 0, scan_limit_reached: true });
  }, 60_000);

  // No pattern can match nothing silently when the bytes were not a report at all.
  it('refuses the artifacts archive sent in place of a report', async () => {
    await expect(call('artifact_grep', '47', { patterns: ['x'] })).rejects.toMatchObject({
      structuredError: { reason: 'report_type_unsupported', action: 'artifact_grep' },
    });
  });
});

// The archive path is unchanged: an entry is still requested by path, as a byte range.
it('keeps reading an archive entry by path', async () => {
  await expect(
    invoke({
      action: 'artifact_file',
      project_id: 'test/project',
      job_id: '43',
      artifact_path: 'reports/result.json',
    }),
  ).resolves.toMatchObject({
    artifact_path: 'reports/result.json',
    text: archiveEntry.toString(),
    total_bytes: archiveEntry.length,
    complete: true,
  });
  expect(downloads()).toMatchObject([
    {
      path: '/api/v4/projects/test%2Fproject/jobs/43/artifacts/reports/result.json',
      range: 'bytes=0-65539',
    },
  ]);
});
