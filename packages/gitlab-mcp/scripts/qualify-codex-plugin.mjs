import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEvaluation, resolveExecutable } from './evaluation-process.mjs';
import { qualifyLiveConnections } from './codex-plugin-live.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { buildPlugin } = require('../dist/src/cli/plugin/build.js');
const contracts = [
  'tests/plugin/connection.test.cjs',
  'tests/plugin/oauth.test.cjs',
  'tests/plugin/lifecycle.test.cjs',
  'tests/plugin/refresh-lock.test.cjs',
  'tests/plugin/server.test.cjs',
  'tests/plugin/bootstrap.test.cjs',
  'tests/plugin/oauth-errors.test.cjs',
  'tests/plugin/oauth-binding.test.cjs',
];

async function checkContracts(pluginDir, runtimeRoot, output, coverage) {
  const summaryFile = join(output, coverage ? 'source-summary.json' : 'artifact-summary.json');
  const coverageFile = join(root, 'coverage/plugin.lcov.info');
  const coverageDirectory = join(output, 'coverage');
  if (coverage) mkdirSync(dirname(coverageFile), { recursive: true });
  const environment = {
    ...process.env,
    PLUGIN_CONTRACT_ROOT: pluginDir,
    PLUGIN_RUNTIME_ROOT: runtimeRoot,
    PLUGIN_TEST_SUMMARY: summaryFile,
  };
  // This is an independent runner, including when qualification is invoked by a regression test.
  delete environment.NODE_TEST_CONTEXT;
  const result = await runEvaluation(
    process.execPath,
    [
      ...(coverage
        ? [
            require.resolve('c8/bin/c8.js'),
            '--all',
            '--src=dist/src/plugin',
            '--include=dist/src/plugin/*.js',
            '--include=src/plugin/*.ts',
            '--exclude-after-remap',
            '--reporter=text',
            '--reporter=lcovonly',
            `--reports-dir=${coverageDirectory}`,
            `--temp-directory=${join(output, 'v8')}`,
            process.execPath,
          ]
        : []),
      '--test',
      '--test-reporter=./scripts/plugin-test-summary.mjs',
      '--test-reporter-destination=stdout',
      ...(coverage ? ['--enable-source-maps'] : []),
      ...contracts,
      ...(coverage ? [] : ['tests/scripts/codex-live.test.mjs']),
    ],
    { cwd: root, env: environment, timeoutMs: 120000 },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.code === null) throw new Error('Plugin contract runner terminated by a signal.');
  if (result.code !== 0) return result.code;
  const report = JSON.parse(readFileSync(summaryFile, 'utf8'));
  assert(
    report.success && report.counts.tests > 0 && report.counts.passed === report.counts.tests,
    'Plugin contracts did not all execute successfully.',
  );
  if (coverage) copyFileSync(join(coverageDirectory, 'lcov.info'), coverageFile);
  return 0;
}
const output = mkdtempSync(join(tmpdir(), 'gitlab-plugin-qualification-'));
try {
  const codexAt = process.argv.indexOf('--codex');
  let codex;
  if (codexAt !== -1) {
    const requested = process.argv[codexAt + 1];
    if (!requested || requested.startsWith('--'))
      throw new Error('--codex requires an executable path.');
    codex = resolveExecutable(requested);
  }
  const archiveAt = process.argv.indexOf('--archive');
  const suppliedArchive = process.argv[archiveAt + 1];
  if (archiveAt !== -1 && (!suppliedArchive || suppliedArchive.startsWith('--')))
    throw new Error('--archive requires a release ZIP path.');
  const artifact =
    archiveAt === -1
      ? buildPlugin({ flavor: 'private', marketplaceZip: true, outDir: output, packageRoot: root })
      : { zipPath: resolve(suppliedArchive), checksumPath: resolve(suppliedArchive) + '.sha256' };
  const checksum = createHash('sha256').update(readFileSync(artifact.zipPath)).digest('hex');
  assert.equal(readFileSync(artifact.checksumPath, 'utf8'), `${checksum}  gitlab-mcp-codex.zip\n`);
  const marketplace = join(output, 'extracted');
  mkdirSync(marketplace);
  const extraction = await runEvaluation('unzip', ['-q', artifact.zipPath, '-d', marketplace], {
    cwd: root,
    env: process.env,
    timeoutMs: 30000,
  });
  if (extraction.code !== 0)
    throw new Error(`Release archive extraction failed: ${extraction.stderr}`);
  const pluginDir = join(marketplace, 'plugins/gitlab-mcp');
  const coverage = process.argv.includes('--coverage');
  let code = await checkContracts(pluginDir, join(pluginDir, 'runtime/src/plugin'), output, false);
  if (code === 0 && coverage)
    code = await checkContracts(pluginDir, join(root, 'dist/src/plugin'), output, true);
  if (code !== 0) process.exitCode = code;
  else {
    if (codex) {
      const lifecycle = await runEvaluation(
        process.execPath,
        ['scripts/codex-plugin-lifecycle.mjs', '--codex', codex, marketplace],
        { cwd: root, env: process.env, timeoutMs: 120000 },
      );
      process.stdout.write(lifecycle.stdout);
      process.stderr.write(lifecycle.stderr);
      if (lifecycle.code !== 0) throw new Error('Installed Codex plugin lifecycle failed.');
    }
    const live = process.argv.includes('--live')
      ? await qualifyLiveConnections(pluginDir)
      : undefined;
    console.log(
      JSON.stringify({
        status: 'verified',
        node: process.version,
        sha256: checksum,
        live,
      }),
    );
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
