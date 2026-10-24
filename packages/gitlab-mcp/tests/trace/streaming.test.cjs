const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const process = require('node:process');
const { Buffer } = require('node:buffer');
const { setImmediate } = require('node:timers');
const { test } = require('node:test');

const MiB = 1024 * 1024;
const worker = require.resolve('./worker.cjs');

async function fixture(megabytes, singleLine, run) {
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({ path: request.url, token: request.headers['private-token'] });
    if (request.url.endsWith('/jobs/0/trace')) return response.end('warmup');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    // No Content-Length: the reader must work with real chunked HTTP responses.
    const chunk = Buffer.alloc(64 * 1024, 120);
    try {
      for (let position = 0; position < megabytes * MiB; position += chunk.length) {
        if (response.destroyed) break;
        if (!singleLine) {
          for (let offset = 0; offset < chunk.length; offset += 1024) {
            chunk.write(`line-${String((position + offset) / 1024).padStart(8, '0')}:`, offset);
            chunk[offset + 1023] = 10;
          }
        }
        await new Promise((resolve, reject) => {
          response.write(chunk, (error) => (error ? reject(error) : resolve()));
        });
      }
      response.end();
    } catch {
      response.destroy();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, requests);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function measure(url, options) {
  // A 32 MiB JS heap is enough for the loaded server plus the bounded page. It
  // also makes V8 collect discarded transport buffers during the measurement.
  const child = spawn(
    process.execPath,
    ['--expose-gc', '--max-old-space-size=32', worker, url, JSON.stringify(options)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    },
  );
  let output = '';
  let errors = '';
  child.stdout.setEncoding('utf8').on('data', (data) => {
    output += data;
  });
  child.stderr.setEncoding('utf8').on('data', (data) => {
    errors += data;
  });
  const [status, signal] = await once(child, 'close');
  assert.equal(status, 0, `Worker failed (${signal}): ${errors}`);
  return JSON.parse(output);
}

function expectedTrace(total, start, perPage) {
  const count = Math.min(perPage, total - start);
  const lines = [];
  for (let index = start; index < start + count; index++) {
    lines.push(
      index === total - 1 ? '' : `line-${String(index).padStart(8, '0')}:`.padEnd(1023, 'x'),
    );
  }
  if (count < total)
    lines.unshift(
      `[LOG TRUNCATED: Showing ${start + count === total ? `last ${count} of ${total} lines (lines ${start}-${start + count - 1})` : `lines ${start}-${start + count - 1} of ${total}`}]`,
    );
  return lines.join('\n');
}

test(
  'built trace handler: 200-line pages from a 200 MiB HTTP trace use bounded memory',
  { timeout: 120000 },
  async (t) => {
    // Isolated processes exclude the generator and compare equal-sized returned pages.
    const small = await fixture(4, false, (url) => measure(url, { per_page: 200 }));
    await fixture(200, false, async (url, requests) => {
      const total = 200 * 1024 + 1;
      for (const options of [
        { per_page: 200 },
        { per_page: 200, start: 0 },
        { per_page: 200, start: 100000 },
        { per_page: 200, start: -500 },
      ]) {
        const report = await measure(url, options);
        t.diagnostic(
          JSON.stringify({
            options,
            node: report.node,
            durationMs: report.durationMs,
            baseline: report.baseline,
            peak: report.peak,
            maxRSS: report.maxRSS,
            smallMaxRSS: small.maxRSS,
          }),
        );
        const start =
          options.start === undefined || options.start < 0 ? total - 200 : options.start;
        assert.deepEqual(report.result, {
          trace: expectedTrace(total, start, 200),
          totalLines: total,
          shownLines: 200,
          startLine: start,
          hasMore: start + 200 < total,
          nextStart: start + 200 < total ? start + 200 : null,
        });
        // A 1 MiB byte ring, bounded output and transport buffers leave substantial
        // headroom for V8/Undici JIT and GC variation without allowing a 200 MiB copy.
        assert.ok(report.peak.heapUsed - report.baseline.heapUsed < 32 * MiB);
        assert.ok(report.peak.external - report.baseline.external < 40 * MiB);
        assert.ok(report.maxRSS - report.baseline.rss < 80 * MiB);
        assert.ok(report.maxRSS - small.maxRSS < 64 * MiB);
      }
      assert.ok(requests.every((request) => request.token === 'trace-fixture-only'));
      assert.ok(
        requests.every((request) => request.path.startsWith('/api/v4/projects/test%2Ftrace/jobs/')),
      );
    });
  },
);

test(
  'built trace handler: a 200 MiB single line is clipped explicitly',
  { timeout: 60000 },
  async (t) => {
    // A bounded number of lines alone cannot protect against an enormous line.
    await fixture(200, true, async (url) => {
      const report = await measure(url, { per_page: 200 });
      t.diagnostic(
        JSON.stringify({
          node: report.node,
          durationMs: report.durationMs,
          baseline: report.baseline,
          peak: report.peak,
          maxRSS: report.maxRSS,
        }),
      );
      assert.deepEqual(report.result, {
        trace:
          '[LOG CONTENT TRUNCATED: 1 source lines are incomplete due to byte limits. See truncation.lines; line pagination cannot recover omitted bytes.]\n' +
          'x'.repeat(16384),
        totalLines: 1,
        shownLines: 1,
        startLine: 0,
        hasMore: false,
        nextStart: null,
        truncation: {
          reason: 'byte_limits',
          maxLineBytes: 16384,
          maxPageBytes: MiB,
          lines: [{ line: 0, omittedPrefixBytes: 0, omittedSuffixBytes: 200 * MiB - 16384 }],
        },
      });
      assert.ok(report.maxRSS - report.baseline.rss < 80 * MiB);
      assert.ok(report.peak.heapUsed - report.baseline.heapUsed < 32 * MiB);
    });
  },
);

test(
  'concurrent trace reads keep instance credentials and pages separate',
  { timeout: 60000 },
  async () => {
    // Different trace lengths identify the response, and each server checks its token.
    await fixture(4, false, async (first, requestsA) => {
      await fixture(8, false, async (second, requestsB) => {
        const results = await measure(first, { otherUrl: second });
        assert.deepEqual(
          results.map((page) => page.totalLines),
          [4097, 8193],
        );
        assert.deepEqual(
          results.map((page) => page.startLine),
          [3897, 7993],
        );
        assert.equal(requestsA.length, 1);
        assert.equal(requestsB.length, 1);
        assert.equal(requestsA[0].token, 'fixture-0');
        assert.equal(requestsB[0].token, 'fixture-1');
      });
    });
  },
);

test(
  'transport errors, dishonest length, timeout and abort never return partial success',
  { timeout: 60000 },
  async () => {
    // Exercise real response bodies so cancellation reaches the socket as well as the reader.
    const closed = [];
    const server = createServer((request, response) => {
      response.on('close', () => closed.push(request.url));
      if (request.url.startsWith('/api/')) response.statusCode = 403;
      if (request.url === '/length') response.setHeader('Content-Length', '10000');
      response.write('partial\n');
      if (request.url === '/disconnect') setImmediate(() => response.destroy());
      if (request.url === '/length') response.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      assert.deepEqual(
        await measure(`http://127.0.0.1:${server.address().port}`, { failures: true }),
        { failedReads: 4, httpError: 403 },
      );
      assert.equal(closed.length, 5);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
