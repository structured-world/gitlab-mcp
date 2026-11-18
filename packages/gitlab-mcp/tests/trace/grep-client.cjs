// Runs the built log_grep handler with real worker threads in an isolated process.
const process = require('node:process');
const { availableParallelism } = require('node:os');
const { performance } = require('node:perf_hooks');
const { setInterval, clearInterval } = require('node:timers');
const { fetch } = globalThis;
const [url, mode, options] = process.argv.slice(2);
const parameters = JSON.parse(options);
Object.assign(process.env, {
  GITLAB_API_URL: url,
  GITLAB_TOKEN: 'grep-fixture-only',
  OAUTH_ENABLED: 'false',
  LOG_LEVEL: 'silent',
  GITLAB_AUTH_COOKIE_PATH: '',
  HTTP_PROXY: '',
  HTTPS_PROXY: '',
});
const { pipelinesToolRegistry } = require('../../dist/src/entities/pipelines/registry.js');
const { closeLineGrepWorkers } = require('../../dist/src/entities/pipelines/line-grep-worker.js');
const handler = pipelinesToolRegistry.get('browse_pipelines').handler;
const grep = (args) =>
  handler({ action: 'log_grep', project_id: 'test/trace', before: 0, after: 0, ...args });

async function resume() {
  // Any stall of the main thread shows up as a late interval tick.
  let maxGapMs = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxGapMs = Math.max(maxGapMs, now - last);
    last = now;
  }, 5);
  const calls = [];
  try {
    // Each page starts where the previous one stopped, so the calls are sequential.
    let start = 0;
    for (let page = 0; page < 40; page++) {
      const result = await grep({ job_id: '1', ...parameters, start_line: start });
      calls.push({
        truncated: result.truncated,
        resume_from: result.resume_from,
        scanned_lines: result.scanned_lines,
        total_lines: result.total_lines,
        matches: result.hunks.flatMap((hunk) => hunk.matches.map((match) => match.line)),
      });
      if (result.resume_from === null) break;
      start = result.resume_from;
    }
  } finally {
    clearInterval(timer);
  }
  return { calls, maxGapMs };
}

async function capacity() {
  const workers = Math.max(1, Math.min(4, availableParallelism() - 1));
  const held = Array.from({ length: workers }, () =>
    grep({ job_id: '3', patterns: ['held'] }).then(
      (result) => ({ ok: result.match_count }),
      (error) => ({ error: error.message }),
    ),
  );
  // Leases are taken synchronously, so the extra call already sees a full pool.
  const extra = await grep({ job_id: '3', patterns: ['held'] }).then(
    () => 'accepted',
    (error) => error.message,
  );
  await fetch(`${url}/release`);
  return { workers, extra, held: await Promise.all(held) };
}

(mode === 'resume' ? resume() : capacity())
  .then((report) => process.stdout.write(JSON.stringify(report)))
  .catch((error) => {
    process.stderr.write(String(error?.stack));
    process.exitCode = 1;
  })
  .finally(() => closeLineGrepWorkers());
