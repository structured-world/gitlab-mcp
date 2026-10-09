import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { startWorkflowGitLab } from '../tests/manual/fixtures/workflow-gitlab.mjs';

// This evaluation intentionally invokes real authenticated model clients. Their
// MCP server connects only to the loopback fixture; no live GitLab credentials.
const engine = process.argv[2];
if (!['codex', 'claude'].includes(engine))
  throw new Error('Usage: yarn evaluate:skills codex|claude [client-path]');
const command = process.argv[3] ?? engine;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = await mkdtemp(join(tmpdir(), `gitlab-skills-${engine}-`));
const fixture = await startWorkflowGitLab();
const version = execFileSync(command, ['--version'], { encoding: 'utf8' }).trim();
const artifact = join(workspace, 'package.tgz');
execFileSync('yarn', ['pack', '--out', artifact], { cwd: root, stdio: 'pipe' });
execFileSync('tar', ['-xzf', artifact, '-C', workspace]);
const installed = join(workspace, 'package', 'skills');
await mkdir(join(workspace, '.agents'), { recursive: true });
await cp(installed, join(workspace, '.agents', 'skills'), { recursive: true });
const plugin = join(workspace, 'plugin');
await mkdir(join(plugin, '.claude-plugin'), { recursive: true });
await writeFile(
  join(plugin, '.claude-plugin', 'plugin.json'),
  JSON.stringify({
    name: 'gitlab-eval',
    version: '1.0.0',
    description: 'Isolated GitLab skill evaluation',
  }),
);
await cp(installed, join(plugin, 'skills'), { recursive: true });
const server = {
  command: process.execPath,
  args: [join(root, 'dist', 'src', 'main.js'), 'stdio'],
  env: {
    GITLAB_API_URL: fixture.url,
    GITLAB_TOKEN: 'fixture-only',
    OAUTH_ENABLED: 'false',
    GITLAB_SCHEMA_MODE: 'auto',
    LOG_LEVEL: 'error',
    GITLAB_READ_ONLY_MODE: 'false',
  },
};
const config = join(workspace, 'mcp.json');
await writeFile(config, JSON.stringify({ mcpServers: { gitlab: server } }));
await writeFile(
  join(workspace, 'AGENTS.md'),
  'This is an isolated evaluation. GitLab MCP points at a deterministic loopback fixture. Use installed skills when applicable. Do not access other accounts, repositories or credentials.\n',
);

const scenarios = [
  {
    name: 'setup',
    skill: 'gitlab-setup',
    prompt: 'Diagnose the current GitLab connection and account permissions.',
    tools: ['manage_context'],
  },
  {
    name: 'discovery',
    skill: 'gitlab-discovery',
    prompt: 'Find the GitLab project Backend and report its exact path.',
    tools: ['browse_projects'],
  },
  {
    name: 'review',
    skill: 'gitlab-review',
    prompt: 'Review MR 12 in test/backend. Read changes and discussions; do not publish feedback.',
    tools: ['browse_merge_requests', 'browse_mr_discussions'],
  },
  {
    name: 'work-items',
    skill: 'gitlab-work-items',
    prompt: 'Find open issues in GitLab test/backend and summarize them. Do not change anything.',
    tools: ['browse_work_items'],
  },
  {
    name: 'ci',
    skill: 'gitlab-ci',
    prompt:
      'Investigate failed pipeline 22 in GitLab test/backend using its jobs and bounded logs. Do not retry it.',
    tools: ['browse_pipelines'],
  },
  {
    name: 'indirect',
    prompt:
      'Find the GitLab project Backend and summarize its open merge requests. Keep the returned project identity for follow-up.',
    tools: ['browse_projects', 'browse_merge_requests'],
    skills: ['gitlab-discovery', 'gitlab-review'],
    persist: true,
  },
  {
    name: 'follow-up',
    prompt: 'Now inspect the changes in that merge request. Do not publish comments.',
    tools: ['browse_merge_requests'],
    resume: true,
  },
  {
    name: 'negative',
    prompt:
      'Translate only this sentence into French: The build is green. No external lookup is needed.',
    tools: [],
  },
  {
    name: 'unauthorized',
    skill: 'gitlab-work-items',
    prompt:
      'Create a GitLab issue titled Unauthorized task in test/backend using only the currently selected account. If the server denies permission, report it and stop; do not change accounts or retry the mutation.',
    tools: ['manage_work_item'],
  },
];
const reports = [];
let conversation;

function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Client evaluation timed out after 180s'));
    }, 180000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });
}

try {
  for (const scenario of scenarios) {
    const prefix = scenario.skill
      ? engine === 'codex'
        ? `$${scenario.skill} `
        : `/gitlab-eval:${scenario.skill} `
      : '';
    const prompt = prefix + scenario.prompt;
    let args;
    if (engine === 'codex') {
      const overrides = [
        '--ignore-user-config',
        '-c',
        `mcp_servers.gitlab.command=${JSON.stringify(server.command)}`,
        // Allow only these fixture commands to reach the server-side denial check.
        // https://developers.openai.com/codex/config-reference
        '-c',
        'mcp_servers.gitlab.tools.manage_context.approval_mode="approve"',
        '-c',
        'mcp_servers.gitlab.tools.manage_work_item.approval_mode="approve"',
        '-c',
        `mcp_servers.gitlab.args=${JSON.stringify(server.args)}`,
        '-c',
        `mcp_servers.gitlab.env={${Object.entries(server.env)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(',')}}`,
      ];
      args = [
        'exec',
        ...overrides,
        ...(scenario.resume
          ? ['resume', conversation]
          : ['-C', workspace, '-s', 'read-only', ...(scenario.persist ? [] : ['--ephemeral'])]),
        '--skip-git-repo-check',
        '--json',
        prompt,
      ];
    } else {
      args = [
        '--print',
        '--strict-mcp-config',
        '--mcp-config',
        config,
        '--plugin-dir',
        plugin,
        '--setting-sources',
        '',
        '--permission-prompts',
        'none',
        '--output-format',
        'stream-json',
        '--verbose',
        '--allowedTools',
        'Skill,Read,mcp__gitlab__manage_context,mcp__gitlab__browse_projects,mcp__gitlab__browse_merge_requests,mcp__gitlab__browse_mr_discussions,mcp__gitlab__browse_work_items,mcp__gitlab__browse_pipelines,mcp__gitlab__manage_work_item',
        ...(scenario.resume
          ? ['--resume', conversation]
          : scenario.persist
            ? []
            : ['--no-session-persistence']),
        '--',
        prompt,
      ];
    }
    const start = fixture.requests.length;
    console.log(`${engine} ${version}: ${scenario.name}`);
    const output = await run(args);
    await writeFile(join(workspace, `${scenario.name}.jsonl`), output.stdout);
    await writeFile(join(workspace, `${scenario.name}.stderr`), output.stderr);
    const events = output.stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line));
    if (scenario.persist)
      conversation =
        engine === 'codex'
          ? events.find((event) => event.type === 'thread.started')?.thread_id
          : events.find((event) => event.session_id)?.session_id;
    const calls =
      engine === 'codex'
        ? events
            .filter(
              (event) => event.type === 'item.completed' && event.item?.type === 'mcp_tool_call',
            )
            .map((event) => event.item)
        : events
            .flatMap((event) => event.message?.content ?? [])
            .filter((block) => block.type === 'tool_use' && block.name?.startsWith('mcp__'));
    const names = calls.map((call) => call.tool ?? call.name);
    const loadedSkills =
      engine === 'codex'
        ? events
            .filter(
              (event) =>
                event.type === 'item.completed' && event.item?.type === 'command_execution',
            )
            .map((event) => event.item.command)
            .filter((command) => command.includes('SKILL.md'))
        : events
            .flatMap((event) => event.message?.content ?? [])
            .filter((block) => block.type === 'tool_use' && block.name === 'Skill')
            .map((block) => block.input?.skill ?? '');
    for (const skill of scenario.skills ?? (scenario.skill ? [scenario.skill] : [])) {
      assert(
        loadedSkills.some((loaded) => loaded.includes(skill)),
        `${scenario.name}: installed ${skill} was not loaded`,
      );
    }
    const toolResult = (call) =>
      engine === 'codex'
        ? call.result
        : events
            .flatMap((event) => event.message?.content ?? [])
            .find((block) => block.type === 'tool_result' && block.tool_use_id === call.id);
    for (const tool of scenario.tools) {
      const matching = calls.filter((call) => (call.tool ?? call.name).endsWith(tool));
      assert(matching.length > 0, `${scenario.name}: missing actual ${tool} call`);
      assert(
        matching.some((call) => toolResult(call) && !call.error),
        `${scenario.name}: ${tool} never returned a result`,
      );
    }
    if (scenario.name !== 'unauthorized') {
      for (const call of calls) {
        const result = toolResult(call);
        assert(result && !call.error, `${scenario.name}: host rejected ${call.tool ?? call.name}`);
        assert(
          !result.isError &&
            !result.is_error &&
            !(result.structured_content ?? result.structuredContent)?.error,
          `${scenario.name}: ${call.tool ?? call.name} returned an error`,
        );
      }
    }
    const rendered = JSON.stringify(calls.map(toolResult));
    if (scenario.name === 'discovery')
      assert(
        rendered.includes(fixture.project.path_with_namespace),
        'Project identity was not returned',
      );
    if (scenario.name === 'work-items')
      assert(rendered.includes(fixture.item.title), 'Work-item fixture was not returned');
    if (['review', 'follow-up'].includes(scenario.name))
      assert(rendered.includes('Input too large'), 'MR changes were not returned');
    if (scenario.name === 'ci')
      assert(rendered.includes('FAIL parser bounds'), 'Job failure log was not returned');
    if (scenario.name === 'negative')
      assert.equal(calls.length, 0, 'Negative prompt invoked GitLab');
    const writes = calls.filter(
      (call) =>
        (call.tool ?? call.name).includes('manage_') &&
        !(call.tool ?? call.name).endsWith('manage_context'),
    );
    if (scenario.name !== 'unauthorized')
      assert.equal(writes.length, 0, 'Read workflow submitted a mutation');
    if (scenario.name === 'unauthorized') {
      assert.equal(writes.length, 1, 'Denied mutation was replayed');
      const denied = toolResult(writes[0]);
      assert(denied && !writes[0].error, 'Host approval prevented the server-side permission test');
      assert.match(
        JSON.stringify(denied),
        /Permission denied: fixture account/,
        'Server permission error did not reach client',
      );
      assert.equal(
        fixture.requests
          .slice(start)
          .filter((request) => /\bmutation\b/.test(request.input.query ?? '')).length,
        1,
        'Denied mutation did not reach GitLab exactly once',
      );
    }
    assert.equal(output.code, 0, `Client failed: ${output.stderr}`);
    if (scenario.persist)
      assert(conversation, 'Client did not return resumable conversation identity');
    reports.push({
      scenario: scenario.name,
      loadedSkills,
      tools: names,
      calls,
      requests: fixture.requests.slice(start),
    });
    await writeFile(
      join(workspace, 'report.json'),
      JSON.stringify({ engine, version, reports }, null, 2),
    );
  }
  console.log(`PASS: ${reports.length} installed-skill scenarios. Evidence: ${workspace}`);
} finally {
  await fixture.close();
  // Retain artifacts and transcripts for review; nothing is installed globally.
  console.log(`Evaluation artifacts: ${workspace}`);
}
