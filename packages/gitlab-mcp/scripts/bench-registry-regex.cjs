const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const console = require('node:console');
const process = require('node:process');
const { performance } = require('node:perf_hooks');
const {
  warmTagMatchers,
  withTagMatcher,
  closeTagMatchers,
} = require('../dist/src/entities/container_registry/regex.js');

// Build the package first. Include compilation and both worker messages in every warm call.
async function main() {
  const startup = performance.now();
  await warmTagMatchers();
  console.log(JSON.stringify({ node: process.version, startupMs: performance.now() - startup }));
  try {
    for (const count of [100, 1000]) {
      const names = Array.from({ length: count }, (_, index) => `v${index}-release`);
      const began = performance.now();
      const iterations = 100;
      // Measure single-call latency serially; concurrency would instead measure pool throughput.
      for (let iteration = 0; iteration < iterations; iteration++) {
        const selected = await withTagMatcher('^v[0-9]+-release$', undefined, (match) =>
          match(names),
        );
        assert.equal(selected.length, count);
      }
      const elapsedMs = performance.now() - began;
      console.log(
        JSON.stringify({
          tags: count,
          iterations,
          inputBytes: Buffer.byteLength(JSON.stringify(names)),
          msPerCall: elapsedMs / iterations,
          tagsPerSecond: (count * iterations * 1000) / elapsedMs,
          maxRSSBytes: process.resourceUsage().maxRSS * 1024,
        }),
      );
    }
  } finally {
    await closeTagMatchers();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
