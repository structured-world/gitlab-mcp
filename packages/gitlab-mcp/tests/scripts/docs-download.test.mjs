import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

// Execute the Linux publishing workflow's Bash step, independently of portable unit tests.
for (const version of ['13.1.0', '13.2.0']) {
  test(`docs download resolves component release ${version}`, () => {
    const workflow = parse(
      readFileSync(new URL('../../../../.github/workflows/docs.yml', import.meta.url), 'utf8'),
    );
    const step = workflow.jobs.build.steps.find((candidate) => candidate.id === 'mcpb');
    const root = mkdtempSync(join(tmpdir(), 'gitlab-docs-release-'));
    const bin = join(root, 'bin');
    const output = join(root, 'output');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'gh'),
      `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
if (args[0] !== 'release') throw new Error('Unexpected GitHub request');
if (args[1] === 'view') console.log('gitlab-mcp-v${version}');
else if (args[1] === 'download') {
  if (args[2] !== 'gitlab-mcp-v${version}') throw new Error('Wrong release');
  const destination = args[args.indexOf('--dir') + 1];
  fs.writeFileSync(path.join(destination, 'gitlab-mcp-${version}.mcpb'), 'fixture bundle');
} else throw new Error('Unexpected GitHub command');
`,
      { mode: 0o755 },
    );
    try {
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          GITHUB_OUTPUT: output,
        },
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0);
      assert.equal(readFileSync(output, 'utf8'), `version=${version}\n`);
      assert.equal(
        readFileSync(join(root, 'docs/public/downloads', `gitlab-mcp-${version}.mcpb`), 'utf8'),
        'fixture bundle',
      );
      assert.ok(result.stdout.includes(`MCPB bundle included: ${version}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
