import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runEvaluation } from '../../scripts/evaluation-process.mjs';

const require = createRequire(import.meta.url);
const { buildPlugin } = require('../../dist/src/cli/plugin/build.js');
const { createZip } = require('../../dist/src/cli/plugin/zip.js');

test(
  'the release script exports an archive qualified with a caller-relative Codex executable',
  { timeout: 30000 },
  async () => {
    // The lifecycle child runs in the package directory, not beside an operator's relative CLI path.
    const directory = mkdtempSync(join(tmpdir(), 'gitlab-codex-relative-'));
    const name = process.platform === 'win32' ? 'fixture-codex.cmd' : 'fixture-codex';
    const executable = join(directory, 'bin', name);
    mkdirSync(join(directory, 'bin'));
    writeFileSync(
      executable,
      process.platform === 'win32'
        ? '@echo off\r\necho fixture-codex\r\n'
        : '#!/bin/sh\nprintf fixture-codex\n',
      { mode: 0o755 },
    );
    const receipt = join(directory, 'paths.json');
    const evaluation = new URL('../../scripts/evaluation-process.mjs', import.meta.url).href;
    const original = evaluation + '?unmocked';
    const runnerSource = `
    import * as original from ${JSON.stringify(original)};
    import { writeFileSync } from 'node:fs';
    export * from ${JSON.stringify(original)};
    export async function runEvaluation(command, args, options) {
      if (args[0] === 'scripts/codex-plugin-lifecycle.mjs') {
        writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({lifecycle: args[2]}));
        return original.runEvaluation(args[2], ['--version'], options);
      }
      return original.runEvaluation(command, args, options);
    }
  `;
    const hook = join(directory, 'hook.mjs');
    writeFileSync(
      hook,
      `
    import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, next) {
      if (url === ${JSON.stringify(evaluation)})
        return {format: 'module', shortCircuit: true, source: ${JSON.stringify(runnerSource)}};
      return next(url, context);
    }});
  `,
    );
    try {
      const build = fileURLToPath(new URL('../../scripts/build-codex-plugin.mjs', import.meta.url));
      const release = join(directory, 'release');
      const built = await runEvaluation(process.execPath, [build, release], {
        cwd: directory,
        env: process.env,
        timeoutMs: 15000,
      });
      assert.equal(built.code, 0, built.stdout + built.stderr);
      const removedCommand = await runEvaluation(
        process.execPath,
        [join(release, 'plugins/gitlab-mcp/runtime/src/main.js'), 'plugin', 'build'],
        { cwd: directory, env: process.env, timeoutMs: 5000 },
      );
      assert.equal(removedCommand.code, 1, removedCommand.stdout + removedCommand.stderr);
      assert.match(removedCommand.stderr, /Unknown command: plugin/);
      const script = fileURLToPath(
        new URL('../../scripts/qualify-codex-plugin.mjs', import.meta.url),
      );
      const result = await runEvaluation(
        process.execPath,
        [
          '--import',
          hook,
          script,
          '--archive',
          join(release, 'gitlab-mcp-codex.zip'),
          '--codex',
          './bin/' + name,
        ],
        { cwd: directory, env: process.env, timeoutMs: 25000 },
      );
      assert.equal(result.code, 0, result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')), {
        lifecycle: realpathSync(executable),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test(
  'release qualification executes the supplied runtime rather than the checkout',
  { timeout: 30000 },
  async () => {
    // A validly checksummed ZIP with broken connection behavior must fail even when checkout code is healthy.
    const directory = mkdtempSync(join(tmpdir(), 'gitlab-artifact-contract-'));
    try {
      const artifact = buildPlugin({
        flavor: 'private',
        marketplaceZip: true,
        outDir: directory,
        packageRoot: process.cwd(),
      });
      const connection = join(artifact.pluginDir, 'runtime/src/plugin/connections.js');
      writeFileSync(
        connection,
        readFileSync(connection, 'utf8') +
          '\nexports.Connections.prototype.connect = async () => { throw new Error("Synthetic modified runtime."); };\n',
      );
      const entries = artifact.files.map((path) => ({
        path: 'plugins/gitlab-mcp/' + path,
        data: readFileSync(join(artifact.pluginDir, path)),
      }));
      entries.push({
        path: '.agents/plugins/marketplace.json',
        data: readFileSync(artifact.marketplacePath),
      });
      const zip = createZip(entries);
      writeFileSync(artifact.zipPath, zip);
      writeFileSync(
        artifact.checksumPath,
        `${createHash('sha256').update(zip).digest('hex')}  gitlab-mcp-codex.zip\n`,
      );
      const result = await runEvaluation(
        process.execPath,
        ['scripts/qualify-codex-plugin.mjs', '--archive', artifact.zipPath],
        { cwd: process.cwd(), env: process.env, timeoutMs: 20000 },
      );
      assert.equal(result.code, 1, result.stdout + result.stderr);
      assert.match(result.stdout + result.stderr, /Synthetic modified runtime/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
