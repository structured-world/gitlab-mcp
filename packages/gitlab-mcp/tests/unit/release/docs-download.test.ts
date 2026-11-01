import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

// Execute the production workflow step offline: component tags must produce usable asset versions.
test.each(['13.1.0', '13.2.0'])(
  'docs download resolves release %s from its component tag',
  (version) => {
    const workflow = parse(
      readFileSync(join(__dirname, '../../../../../.github/workflows/docs.yml'), 'utf8'),
    );
    const step = workflow.jobs.build.steps.find(
      (candidate: { id?: string }) => candidate.id === 'mcpb',
    );
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
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output },
        encoding: 'utf8',
        timeout: 10000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(readFileSync(output, 'utf8')).toBe(`version=${version}\n`);
      expect(
        readFileSync(join(root, 'docs/public/downloads', `gitlab-mcp-${version}.mcpb`), 'utf8'),
      ).toBe('fixture bundle');
      expect(result.stdout).toContain(`MCPB bundle included: ${version}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
