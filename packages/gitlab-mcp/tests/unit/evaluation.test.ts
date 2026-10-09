import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

it('verifies the installed-workflow evaluator and its real loopback fixture', () => {
  // Run ESM helpers in their native Node runtime rather than a CommonJS Jest transform.
  const output = execFileSync(process.execPath, ['--test', 'tests/scripts/evaluation.test.mjs'], {
    cwd: resolve(__dirname, '../..'),
    encoding: 'utf8',
  });
  expect(output).toMatch(/fail 0/);
});
