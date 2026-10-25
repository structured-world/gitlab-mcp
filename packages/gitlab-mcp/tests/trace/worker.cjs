// The isolated process measures the built handler, not the HTTP fixture's memory.
const { performance } = require('node:perf_hooks');
const process = require('node:process');
const console = require('node:console');
const { setInterval, clearInterval } = require('node:timers');
const { AbortController, AbortSignal } = globalThis;
const [url, options] = process.argv.slice(2);
const parameters = JSON.parse(options);
Object.assign(process.env, {
  GITLAB_API_URL: url,
  GITLAB_TOKEN: parameters.otherUrl ? 'fixture-0' : 'trace-fixture-only',
  OAUTH_ENABLED: 'false',
  LOG_LEVEL: 'silent',
  GITLAB_AUTH_COOKIE_PATH: '',
  HTTP_PROXY: '',
  HTTPS_PROXY: '',
});
const { pipelinesToolRegistry } = require('../../dist/src/entities/pipelines/registry.js');
const handler = pipelinesToolRegistry.get('browse_pipelines').handler;

async function main() {
  if (parameters.otherUrl) {
    // Two simultaneous calls in one process must retain their own instance/token.
    const { runWithTokenAccount } = require('../../dist/src/accounts/token-account.js');
    const results = await Promise.all(
      [url, parameters.otherUrl].map((instanceUrl, index) =>
        runWithTokenAccount({ instanceUrl, token: `fixture-${index}` }, () =>
          handler({ action: 'logs', project_id: 'test/trace', job_id: '1', per_page: 200 }),
        ),
      ),
    );
    process.stdout.write(JSON.stringify(results));
    return;
  }
  if (parameters.failures) {
    const assert = require('node:assert/strict');
    const { enhancedFetch } = require('../../dist/src/utils/fetch.js');
    const { readTracePage } = require('../../dist/src/entities/pipelines/trace.js');
    for (const path of ['disconnect', 'length', 'stall']) {
      const response = await enhancedFetch(`${url}/${path}`, {
        retry: false,
        signal: AbortSignal.timeout(500),
      });
      await assert.rejects(readTracePage(response.body, 200));
      assert.equal(response.body.locked, false);
    }
    const abort = new AbortController();
    const response = await enhancedFetch(`${url}/stall`, { retry: false, signal: abort.signal });
    const reading = readTracePage(response.body, 200);
    abort.abort();
    await assert.rejects(reading);
    assert.equal(response.body.locked, false);
    await assert.rejects(handler({ action: 'logs', project_id: 'test/trace', job_id: '1' }), /403/);
    process.stdout.write(JSON.stringify({ failedReads: 4, httpError: 403 }));
    return;
  }
  await handler({ action: 'logs', project_id: 'test/trace', job_id: '2' });
  globalThis.gc();
  const baseline = process.memoryUsage();
  const peak = { ...baseline };
  const sample = () => {
    const memory = process.memoryUsage();
    for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], memory[key]);
  };
  const timer = setInterval(sample, 2);
  const began = performance.now();
  try {
    const result = await handler({
      action: 'logs',
      project_id: 'test/trace',
      job_id: '1',
      ...parameters,
    });
    sample();
    process.stdout.write(
      JSON.stringify({
        result,
        baseline,
        peak,
        maxRSS: process.resourceUsage().maxRSS * 1024,
        durationMs: performance.now() - began,
        node: process.version,
      }),
    );
  } finally {
    clearInterval(timer);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
