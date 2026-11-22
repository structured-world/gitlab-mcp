// Build the core package, then run this file with node --test from the workspace.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
// Jobs of a pipeline exist as soon as it is created, so no runner has to pick them up.
const CI = `stages: [build, test]
compile:
  stage: build
  script: [echo compile]
unit:
  stage: test
  script: [echo unit]
lint:
  stage: test
  script: [echo lint]
`;
const MR_TITLES = ['Fix flaky retry', 'Add feature'];

test(
  'projects read results with JMESPath through the live MCP server',
  { timeout: 180_000 },
  async (t) => {
    const client = new Client({ name: 'jmespath-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--env-file=.env.test', 'dist/src/main.js', 'stdio'],
      cwd,
      env: { GITLAB_INIT_TIMEOUT_MS: '25000' },
      stderr: 'ignore',
    });
    let projectId;

    /** The parsed text payload of one call, with MCP application errors kept apart. */
    async function request(tool, args) {
      const result = await client.callTool({ name: tool, arguments: args }, undefined, {
        timeout: 30_000,
      });
      const body = result.content.find((entry) => entry.type === 'text')?.text;
      assert.equal(typeof body, 'string', `${tool} returned no JSON text`);
      return { error: result.isError === true, data: JSON.parse(body) };
    }

    async function call(tool, args) {
      const { error, data } = await request(tool, args);
      assert.ok(!error, `${tool} failed: ${JSON.stringify(data)}`);
      return data;
    }

    /** Authentication can complete before startup schema introspection. Retry only this read. */
    async function waitForTestNamespace() {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const { error, data } = await request('browse_namespaces', {
          action: 'get',
          namespace_id: 'test',
        });
        if (!error) return data;
        assert.equal(data.error_code, 'CONNECTION_FAILED');
        await delay(1000);
      }
      throw new Error('Test GitLab did not become ready');
    }

    try {
      await client.connect(transport);
      assert.equal((await waitForTestNamespace()).full_path, 'test');
      const project = await call('manage_project', {
        action: 'create',
        name: `jmespath-${randomUUID()}`,
        namespace: 'test',
        visibility: 'private',
        initialize_with_readme: true,
      });
      projectId = String(project.id);
      await call('manage_files', {
        action: 'single',
        project_id: projectId,
        file_path: '.gitlab-ci.yml',
        branch: 'main',
        content: CI,
        commit_message: 'Add CI fixture',
      });
      const pipeline = await call('manage_pipeline', {
        action: 'create',
        project_id: projectId,
        ref: 'main',
      });
      for (const [index, title] of MR_TITLES.entries()) {
        const branch = `fixture-${index}`;
        await call('manage_ref', {
          action: 'create_branch',
          project_id: projectId,
          branch,
          ref: 'main',
        });
        await call('manage_files', {
          action: 'single',
          project_id: projectId,
          file_path: `${branch}.txt`,
          branch,
          content: title,
          commit_message: title,
        });
        await call('manage_merge_request', {
          action: 'create',
          project_id: projectId,
          source_branch: branch,
          target_branch: 'main',
          title,
        });
      }

      const jobsCall = {
        action: 'jobs',
        project_id: projectId,
        pipeline_id: String(pipeline.id),
        per_page: 100,
        page: 1,
      };

      await t.test(
        'browse_pipelines jobs keeps the selected fields of the matching jobs',
        async () => {
          const jobs = await call('browse_pipelines', jobsCall);
          assert.equal(jobs.length, 3);
          const projected = await call('browse_pipelines', {
            ...jobsCall,
            jmespath: "[?stage=='test'].{id: id, name: name, stage: stage}",
          });
          assert.deepEqual(
            projected.data,
            jobs
              .filter((job) => job.stage === 'test')
              .map((job) => ({ id: job.id, name: job.name, stage: job.stage })),
          );
          assert.equal(projected.data.length, 2);
          assert.deepEqual(
            { input: projected.jmespath.input_items, output: projected.jmespath.output_items },
            { input: 3, output: 2 },
          );

          // A filter nothing passes says so instead of returning a bare empty list.
          const none = await call('browse_pipelines', {
            ...jobsCall,
            jmespath: "[?stage=='deploy']",
          });
          assert.deepEqual(none.data, []);
          assert.equal(none.jmespath.note, 'Nothing matched out of 3 input items.');
        },
      );

      await t.test('browse_merge_requests list filters with an RE2 function', async () => {
        const listed = await call('browse_merge_requests', {
          action: 'list',
          project_id: projectId,
          state: 'opened',
          jmespath: "[?re_test(title, '(?i)flaky')].title",
        });
        assert.deepEqual(listed.data, ['Fix flaky retry']);
        assert.equal(listed.jmespath.input_items, 2);
      });

      await t.test('refuses an invalid expression and an action without projection', async () => {
        const syntax = await request('browse_pipelines', { ...jobsCall, jmespath: '[?stage==' });
        assert.equal(syntax.error, true);
        assert.match(syntax.data.error, /^Invalid jmespath expression: Syntax error/);

        const action = await request('browse_pipelines', {
          action: 'get',
          project_id: projectId,
          pipeline_id: String(pipeline.id),
          jmespath: 'id',
        });
        assert.equal(action.error, true);
        assert.equal(
          action.data.error,
          "'browse_pipelines get' does not accept 'jmespath'; list and search actions do.",
        );
      });
    } finally {
      try {
        if (projectId) await call('manage_project', { action: 'delete', project_id: projectId });
      } finally {
        await client.close();
      }
    }
  },
);
