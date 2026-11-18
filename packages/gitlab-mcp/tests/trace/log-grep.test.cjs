const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const process = require('node:process');
const { Buffer } = require('node:buffer');
const { test } = require('node:test');

const client = require.resolve('./grep-client.cjs');
const MIB = 1024 * 1024;
const TRACE_MIB = 256;
const LINE = 1024;
const MARKER_EVERY = 4096;
const MARKER_AT = 7;

/** 1 KiB lines; every MARKER_EVERY-th line carries a match for the fixture pattern. */
function line(index) {
  const head = `row ${String(index).padStart(8, '0')} `;
  const marker = index % MARKER_EVERY === MARKER_AT ? 'a0123456789012x' : '';
  // 'b' keeps [a-q] candidates alive at every byte, defeating the lazy DFA; each 'x' is
  // preceded by 'y', so padding never matches, but it also defeats a literal prefilter.
  return Buffer.from(`${head}${marker}`.padEnd(LINE - 1, 'bbbbbbbbbbbbbbbbbbbyx') + '\n', 'latin1');
}

async function withServer(megabytes, run) {
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const server = createServer(async (request, response) => {
    if (request.url === '/release') {
      release();
      return response.end();
    }
    if (request.url.endsWith('/jobs/3/trace')) {
      // Holds a worker lease open until the test releases it.
      response.write('held\n');
      await released;
      return response.end();
    }
    try {
      const lines = (megabytes * MIB) / LINE;
      for (let index = 0; index < lines && !response.destroyed; index += 64) {
        const batch = Buffer.concat(Array.from({ length: 64 }, (_, k) => line(index + k)));
        await new Promise((resolve, reject) =>
          response.write(batch, (error) => (error ? reject(error) : resolve())),
        );
      }
      response.end();
    } catch {
      response.destroy();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runClient(url, mode, options = {}) {
  const child = spawn(process.execPath, [client, url, mode, JSON.stringify(options)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
  });
  let output = '';
  let errors = '';
  child.stdout.setEncoding('utf8').on('data', (data) => {
    output += data;
  });
  child.stderr.setEncoding('utf8').on('data', (data) => {
    errors += data;
  });
  const [status, signal] = await once(child, 'close');
  assert.equal(status, 0, `Client failed (${signal}): ${errors}`);
  return JSON.parse(output);
}

test(
  'built log_grep: budgeted scans of a 256 MiB trace resume to every match exactly once',
  { timeout: 300000 },
  async (t) => {
    // More source than one 2 s budget can scan; the cursor must lose and repeat nothing.
    await withServer(TRACE_MIB, async (url) => {
      // Eight overlapping DFA-hostile patterns in one set keep the matcher busy per byte.
      const patterns = Array.from(
        { length: 8 },
        (_, k) => `[a-${String.fromCharCode(0x71 - k)}][^u-z]{${13 - k}}x`,
      );
      const report = await runClient(url, 'resume', { patterns, max_matches: 500 });
      const total = (TRACE_MIB * MIB) / LINE + 1;
      t.diagnostic(
        JSON.stringify({
          calls: report.calls.map(({ matches, ...call }) => ({ ...call, found: matches.length })),
          maxGapMs: report.maxGapMs,
        }),
      );
      const expected = [];
      for (let index = MARKER_AT; index < total - 1; index += MARKER_EVERY) expected.push(index);
      assert.deepEqual(
        report.calls.flatMap((call) => call.matches),
        expected,
      );
      assert.ok(report.calls.some((call) => call.truncated === 'budget'));
      for (const call of report.calls.slice(0, -1)) assert.equal(call.total_lines, null);
      assert.deepEqual(report.calls.at(-1), {
        ...report.calls.at(-1),
        truncated: null,
        resume_from: null,
        total_lines: total,
      });
      // The main thread only moves bytes; matching never stalls its event loop.
      assert.ok(report.maxGapMs < 250, `event loop stalled for ${report.maxGapMs} ms`);
    });
  },
);

test('built log_grep: a call beyond the worker pool fails fast', { timeout: 60000 }, async () => {
  await withServer(1, async (url) => {
    const report = await runClient(url, 'capacity');
    assert.match(report.extra, /at capacity/);
    assert.deepEqual(
      report.held,
      Array.from({ length: report.workers }, () => ({ ok: 1 })),
    );
  });
});
