import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

it('verifies the installed-workflow evaluator and its real loopback fixture', () => {
  // Run ESM helpers in their native Node runtime rather than a CommonJS Jest transform.
  const result = spawnSync(process.execPath, ['--test', 'tests/scripts/evaluation.test.mjs'], {
    cwd: resolve(__dirname, '../..'),
    encoding: 'utf8',
  });
  // The node:test report names the failing case; keep it in the failure message.
  expect({ status: result.status, report: result.stdout + result.stderr }).toMatchObject({
    status: 0,
    report: expect.stringMatching(/fail 0/),
  });
});
