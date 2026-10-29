import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openSync, closeSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { launchSync, resolveExecutable, runEvaluation } from './evaluation-process.mjs';
import { recordedCall, historicalResult, clientResult } from './antigravity-contract.mjs';
import { startWorkflowGitLab } from '../tests/manual/fixtures/workflow-gitlab.mjs';
import { startScriptedGemini } from '../tests/manual/fixtures/scripted-gemini.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gemini = {
  version: '0.66.0',
  url: 'https://registry.npmjs.org/@google/gemini-cli-core/-/gemini-cli-core-0.66.0.tgz',
  integrity:
    'sha512-fhrC9UfDY91VK+bCz7fZQE0NBas2TgwYeF099cG2TVYeoxwL2g4FaHC6pPHYfk14i4Sd1xAeboLEtOAPelrcLA==',
  entry: 'package/dist/src/tools/mcp-compliance-transport.js',
};

async function download(url) {
  const response = await fetch(url, { signal: globalThis.AbortSignal.timeout(120000) });
  assert.equal(response.ok, true, `Download failed: HTTP ${response.status}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    assert.ok(length <= 128 * 1024 * 1024, 'Download exceeds fixture limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function digest(bytes, encoding = 'hex') {
  return createHash('sha512').update(bytes).digest(encoding);
}

async function prepare(runtime, archive) {
  assert.ok(
    ['darwin', 'linux'].includes(process.platform),
    'Qualification requires macOS or Linux',
  );
  const architecture = { arm64: 'arm64', x64: 'amd64' }[process.arch];
  assert.ok(architecture, 'Unsupported client architecture');
  const manifestUrl = `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/${process.platform}_${architecture}.json`;
  const manifest = JSON.parse(await download(manifestUrl));
  const bytes = archive ? await readFile(archive) : await download(manifest.url);
  assert.equal(digest(bytes), manifest.sha512, 'AGY archive checksum mismatch');
  const archivePath = join(runtime, 'agy.tgz');
  await writeFile(archivePath, bytes);
  const tar = resolveExecutable('tar');
  const command = join(runtime, 'antigravity');
  const executable = openSync(command, 'wx', 0o755);
  try {
    launchSync(tar, ['-xOf', archivePath, 'antigravity'], {
      stdio: ['ignore', executable, 'pipe'],
      timeout: 30000,
    });
  } finally {
    closeSync(executable);
  }
  const baseline = await download(gemini.url);
  assert.equal(`sha512-${digest(baseline, 'base64')}`, gemini.integrity);
  const baselinePath = join(runtime, 'gemini.tgz');
  await writeFile(baselinePath, baseline);
  const source = launchSync(tar, ['-xOf', baselinePath, gemini.entry], { timeout: 30000 });
  const { McpComplianceTransport } = await import(
    `data:text/javascript;base64,${source.toString('base64')}`
  );
  const monorepo = resolve(root, '../..');
  const yarnConfiguration = parseYaml(await readFile(join(monorepo, '.yarnrc.yml'), 'utf8'));
  assert.equal(typeof yarnConfiguration.yarnPath, 'string');
  const yarn = resolve(monorepo, yarnConfiguration.yarnPath);
  const artifact = join(runtime, 'package.tgz');
  launchSync(process.execPath, [yarn, 'pack', '--out', artifact], {
    cwd: root,
    stdio: 'pipe',
    timeout: 60000,
  });
  await writeFile(
    join(runtime, 'package.json'),
    JSON.stringify({
      name: 'mcp-client-qualification',
      private: true,
      dependencies: { '@structured-world/gitlab-mcp': 'file:./package.tgz' },
    }),
  );
  await writeFile(
    join(runtime, '.yarnrc.yml'),
    'nodeLinker: node-modules\nenableGlobalCache: false\n',
  );
  const installation = await runEvaluation(
    process.execPath,
    [yarn, 'install', '--no-immutable', '--mode=skip-build'],
    {
      cwd: runtime,
      timeoutMs: 120000,
    },
  );
  assert.equal(installation.code, 0, installation.stderr + installation.stdout);
  const installed = join(runtime, 'node_modules/@structured-world/gitlab-mcp');
  const installedPackage = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  const installedSdk = JSON.parse(
    await readFile(join(runtime, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8'),
  );
  return {
    command,
    manifest,
    manifestUrl,
    McpComplianceTransport,
    entry: join(installed, 'dist/src/main.js'),
    artifact: {
      version: installedPackage.version,
      sha512: digest(await readFile(artifact)),
      sdkVersion: installedSdk.version,
      yarnVersion: launchSync(process.execPath, [yarn, '--version'], {
        cwd: runtime,
        encoding: 'utf8',
      }).trim(),
    },
    baseline: { ...gemini, moduleSha512: digest(source) },
  };
}

function isolatedEnvironment(profile) {
  // HOME is the child client's actual isolated home, never a change to the caller's environment.
  const environment = {
    HOME: profile,
    XDG_CONFIG_HOME: join(profile, 'config'),
    XDG_DATA_HOME: join(profile, 'data'),
    GEMINI_API_KEY: 'fixture-only',
  };
  for (const name of ['PATH', 'TMPDIR', 'TMP', 'TEMP'])
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  return environment;
}

async function scenario(runtime, prepared, spec) {
  const workspace = join(runtime, spec.name);
  const profile = join(workspace, 'home');
  await mkdir(join(workspace, '.agents'), { recursive: true });
  await mkdir(profile);
  const environment = isolatedEnvironment(profile);
  const version = await runEvaluation(prepared.command, ['--version'], {
    cwd: workspace,
    env: environment,
    timeoutMs: 30000,
  });
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout.trim(), prepared.manifest.version);
  const fixture = await startWorkflowGitLab({ emptyMergeRequests: spec.empty === true });
  const provider = await startScriptedGemini(spec.call);
  const recording = join(workspace, 'mcp.jsonl');
  let result;
  let records;
  try {
    await writeFile(
      join(workspace, '.agents/mcp_config.json'),
      JSON.stringify({
        mcpServers: {
          gitlab: {
            command: process.execPath,
            args: [
              join(root, 'tests/manual/fixtures/mcp-envelope-recorder.mjs'),
              prepared.entry,
              recording,
            ],
            env: {
              GITLAB_API_URL: fixture.url,
              GITLAB_TOKEN: 'fixture-only',
              OAUTH_ENABLED: 'false',
              LOG_LEVEL: 'error',
              GITLAB_READ_ONLY_MODE: 'true',
            },
            enabledTools: [spec.call.name],
          },
        },
      }),
    );
    const settings = {
      modelProvider: 'gemini',
      trustedWorkspaces: [workspace],
      permissions: { allow: [`mcp(gitlab/${spec.call.name})`] },
      customModelsConfig: {
        customModels: {
          fixture: {
            modelName: 'gemini-api://fixture/models/qualification',
            toolFormatterType: 'TOOL_FORMATTER_TYPE_NONE',
          },
        },
      },
    };
    result = await runEvaluation(
      prepared.command,
      [
        '--settings',
        JSON.stringify(settings),
        '--model',
        'fixture',
        '--print',
        'Run the synthetic MCP qualification.',
        '--output-format',
        'stream-json',
        '--print-timeout',
        '60s',
      ],
      {
        cwd: workspace,
        env: { ...environment, GOOGLE_GEMINI_BASE_URL: provider.url },
        timeoutMs: 75000,
      },
    );
    assert.equal(result.code, 0, result.stderr);
    provider.verify();
    records = (await readFile(recording, 'utf8')).trim().split('\n').map(JSON.parse);
    const call = recordedCall(records, spec.call);
    const events = result.stdout.trim().split('\n').map(JSON.parse);
    const text = call.result.content
      .map(({ type, text }) => {
        assert.equal(type, 'text');
        return text;
      })
      .join('\n');
    const client = clientResult(events, provider.requests, spec.call, text, spec.error === true);
    assert.equal(call.result.isError === true, spec.error === true);
    const data = JSON.parse(text);
    if (spec.empty !== undefined) {
      assert.deepEqual(data, spec.empty ? [] : [fixture.mr]);
      assert.equal(Object.hasOwn(call.result, 'structuredContent'), false);
      assert.equal(Object.hasOwn(call.tool, 'outputSchema'), false);
    }
    if (spec.name === 'object') assert.deepEqual(data, fixture.project);
    if (spec.name === 'native') assert.deepEqual(call.result.structuredContent, data);
    const historical = historicalResult(prepared.McpComplianceTransport, call.result);
    assert.equal(historical.valid, spec.empty === undefined);
    if (spec.name === 'native') assert.deepEqual(historical.result, call.result);
    return {
      name: spec.name,
      status: 'verified',
      ...call,
      clientResult: client,
      historical,
      providerRequests: provider.requests,
      wire: records,
      transcript: events,
      gitlabRequests: fixture.requests,
    };
  } catch (error) {
    throw Object.assign(error, {
      evidence: {
        name: spec.name,
        result,
        wire: records,
        gitlabRequests: fixture.requests,
        providerRequests: provider.requests,
      },
    });
  } finally {
    await provider.close();
    await fixture.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let archive;
  let reportPath;
  while (args.length) {
    const flag = args.shift();
    assert.ok(args.length, `Missing value for ${flag}`);
    if (flag === '--agy-archive') archive = resolve(args.shift());
    else if (flag === '--report') reportPath = resolve(args.shift());
    else throw new Error(`Unknown argument: ${flag}`);
  }
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'gitlab-antigravity-')));
  const runtime = join(directory, 'runtime');
  await mkdir(runtime);
  if (!reportPath) reportPath = join(directory, 'report.json');
  const report = {
    status: 'failed',
    nodeVersion: process.version,
    platform: process.platform,
    sourceCommit: launchSync(resolveExecutable('git'), ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    sourceDirty:
      launchSync(resolveExecutable('git'), ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      }).length > 0,
    scenarios: [],
  };
  try {
    const prepared = await prepare(runtime, archive);
    report.client = {
      version: prepared.manifest.version,
      manifestUrl: prepared.manifestUrl,
      ...prepared.manifest,
    };
    report.artifact = prepared.artifact;
    report.historical = prepared.baseline;
    const list = {
      name: 'browse_merge_requests',
      arguments: { action: 'list', project_id: 'test/backend' },
    };
    for (const spec of [
      { name: 'empty', empty: true, call: list },
      { name: 'single', empty: false, call: list },
      {
        name: 'object',
        call: { name: 'browse_projects', arguments: { action: 'get', project_id: 'test/backend' } },
      },
      { name: 'native', call: { name: 'get_profile', arguments: {} } },
      {
        name: 'error',
        error: true,
        call: { name: 'browse_projects', arguments: { action: 'get', project_id: 'test/denied' } },
      },
    ]) {
      report.scenarios.push(await scenario(runtime, prepared, spec));
      console.log(`${spec.name}: verified`);
    }
    report.status = 'verified';
  } catch (error) {
    report.error = { message: error.message, evidence: error.evidence };
    process.exitCode = 1;
  } finally {
    try {
      await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
      console.log(`${report.status}: ${reportPath}`);
    } finally {
      await rm(runtime, { recursive: true, force: true });
      if (dirname(reportPath) !== directory) await rm(directory, { recursive: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
