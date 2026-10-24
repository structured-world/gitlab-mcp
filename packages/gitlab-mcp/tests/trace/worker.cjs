// The isolated process measures the built handler, not the HTTP fixture's memory.
const { performance } = require('node:perf_hooks');
const [url, options] = process.argv.slice(2);
Object.assign(process.env, {
  GITLAB_API_URL: url, GITLAB_TOKEN: 'trace-fixture-only', OAUTH_ENABLED: 'false',
  LOG_LEVEL: 'silent', HTTP_PROXY: '', HTTPS_PROXY: '',
});
const { pipelinesToolRegistry } = require('../../dist/src/entities/pipelines/registry.js');
const handler = pipelinesToolRegistry.get('browse_pipelines').handler;

async function main() {
  await handler({ action: 'logs', project_id: 'test/trace', job_id: '0' });
  global.gc();
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
      action: 'logs', project_id: 'test/trace', job_id: '1', ...JSON.parse(options),
    });
    sample();
    process.stdout.write(JSON.stringify({
      result, baseline, peak, maxRSS: process.resourceUsage().maxRSS * 1024,
      durationMs: performance.now() - began, node: process.version,
    }));
  } finally {
    clearInterval(timer);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
