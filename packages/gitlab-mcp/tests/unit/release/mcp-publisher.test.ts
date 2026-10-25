import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';

type Step = {
  name?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  run?: string;
};
const workflow = parse(
  readFileSync(
    path.resolve(__dirname, '../../../../../.github/workflows/release-please.yml'),
    'utf8',
  ),
) as { jobs: { 'post-release': { steps: Step[] } } };
const steps = workflow.jobs['post-release'].steps;
const install = steps.find((step) => step.name === 'Install mcp-publisher')!;
const asset = 'mcp-publisher_linux_amd64.tar.gz';
const version = install.env!.MCP_PUBLISHER_VERSION;
const checksums = `registry_${version.slice(1)}_checksums.txt`;

describe('MCP publisher release verification', () => {
  let root: string;
  let work: string;
  let fixtures: string;
  let bin: string;
  let temporary: string;

  function executable(name: string, source: string): void {
    writeFileSync(path.join(bin, name), `#!${process.execPath}\n${source}`, { mode: 0o755 });
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mcp-publisher-verification-'));
    work = path.join(root, 'workspace');
    fixtures = path.join(root, 'fixtures');
    bin = path.join(root, 'bin');
    temporary = path.join(root, 'temporary');
    for (const directory of [work, fixtures, bin, temporary]) mkdirSync(directory);
    writeFileSync(path.join(fixtures, 'mcp-publisher'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const archive = spawnSync('tar', [
      'czf',
      path.join(fixtures, asset),
      '-C',
      fixtures,
      'mcp-publisher',
    ]);
    expect(archive.status).toBe(0);
    const digest = createHash('sha256')
      .update(readFileSync(path.join(fixtures, asset)))
      .digest('hex');
    writeFileSync(path.join(fixtures, checksums), `${digest}  ${asset}\n`);
    writeFileSync(path.join(fixtures, `${checksums}.sigstore.json`), '{}');
    executable(
      'gh',
      `
      const fs = require('node:fs'), path = require('node:path');
      const args = process.argv.slice(2);
      fs.writeFileSync(path.join(process.env.FIXTURES, 'download-args.json'), JSON.stringify(args));
      const destination = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : '.';
      for (let i = 0; i < args.length; i++) if (args[i] === '--pattern') {
        fs.copyFileSync(path.join(process.env.FIXTURES, args[++i]), path.join(destination, args[i]));
      }
    `,
    );
    // Keep the vulnerable download path offline too, so a red test never fetches executable code.
    executable(
      'curl',
      `
      const fs = require('node:fs'), path = require('node:path');
      const args = process.argv.slice(2);
      fs.copyFileSync(path.join(process.env.FIXTURES, '${asset}'), args[args.indexOf('-o') + 1]);
    `,
    );
    executable(
      'cosign',
      `
      const fs = require('node:fs'), path = require('node:path');
      fs.writeFileSync(path.join(process.env.FIXTURES, 'verification-args.json'), JSON.stringify(process.argv.slice(2)));
      process.exit(process.env.REJECT_SIGNATURE === 'true' ? 1 : 0);
    `,
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function run(rejectSignature = false) {
    return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', install.run!], {
      cwd: work,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        FIXTURES: fixtures,
        RUNNER_TEMP: temporary,
        MCP_PUBLISHER_VERSION: version,
        REJECT_SIGNATURE: String(rejectSignature),
      },
      encoding: 'utf8',
      timeout: 5000,
    });
  }

  // The verifier itself must be immutable and installed before the untrusted archive is processed.
  it('pins the cosign installer and version before the publisher install', () => {
    const index = steps.findIndex((step) => step.uses?.startsWith('sigstore/cosign-installer@'));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(steps.indexOf(install));
    expect(steps[index].uses).toMatch(/^sigstore\/cosign-installer@[a-f0-9]{40}$/);
    expect(steps[index].with!['cosign-release']).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  // Exercise the actual YAML shell block, preserving the installed binary and rejecting broad identity matching.
  it('verifies the exact release identity and checksum before installing the publisher', () => {
    const result = run();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(work, 'mcp-publisher'))).toEqual(
      readFileSync(path.join(fixtures, 'mcp-publisher')),
    );
    const args = JSON.parse(
      readFileSync(path.join(fixtures, 'verification-args.json'), 'utf8'),
    ) as string[];
    expect(args).toEqual([
      'verify-blob',
      checksums,
      '--bundle',
      `${checksums}.sigstore.json`,
      '--certificate-identity',
      `https://github.com/modelcontextprotocol/registry/.github/workflows/release.yml@refs/tags/${version}`,
      '--certificate-oidc-issuer',
      'https://token.actions.githubusercontent.com',
    ]);
    const download = JSON.parse(
      readFileSync(path.join(fixtures, 'download-args.json'), 'utf8'),
    ) as string[];
    expect(download.slice(0, 4)).toEqual(['release', 'download', version, '--repo']);
    expect(download[4]).toBe('modelcontextprotocol/registry');
    for (const file of [asset, checksums, `${checksums}.sigstore.json`])
      expect(download).toContain(file);
    expect(readdirSync(temporary)).toEqual([]);
  });

  // A rejected signature must stop the shell before any archive content is extracted.
  it('refuses a rejected signature without installing the publisher', () => {
    expect(run(true).status).not.toBe(0);
    expect(existsSync(path.join(work, 'mcp-publisher'))).toBe(false);
    expect(readdirSync(temporary)).toEqual([]);
  });

  // Even a successfully verified checksum document cannot authorize different archive bytes.
  it('refuses a tampered archive before extraction', () => {
    writeFileSync(path.join(fixtures, asset), 'tampered archive');
    expect(run().status).not.toBe(0);
    expect(existsSync(path.join(work, 'mcp-publisher'))).toBe(false);
    expect(readdirSync(temporary)).toEqual([]);
  });

  // An empty selection or a similar filename must not bypass the archive checksum check.
  it.each(['', `${'0'.repeat(64)}  mcp-publisher_linux_amd64XtarYgz\n`])(
    'refuses checksums without the exact archive entry',
    (contents) => {
      writeFileSync(path.join(fixtures, checksums), contents);
      expect(run().status).not.toBe(0);
      expect(existsSync(path.join(work, 'mcp-publisher'))).toBe(false);
      expect(readdirSync(temporary)).toEqual([]);
    },
  );
});
