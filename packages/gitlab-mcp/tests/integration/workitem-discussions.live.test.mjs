// Build the core package, then run this file with node --test from the workspace.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cwd = fileURLToPath(new URL('../../', import.meta.url));

test(
  'reads work item comments and system activity through the live MCP server',
  {
    timeout: 120_000,
  },
  async () => {
    const client = new Client({ name: 'work-item-discussion-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--env-file=.env.test', 'dist/src/main.js', 'stdio'],
      cwd,
      env: { GITLAB_INIT_TIMEOUT_MS: '25000' },
      stderr: 'ignore',
    });
    const name = `workitem-discussions-${randomUUID()}`;
    const namespace = `test/${name}`;
    let projectId;

    async function request(tool, args) {
      const result = await client.callTool({ name: tool, arguments: args }, undefined, {
        timeout: 30_000,
      });
      const body = result.content.find((entry) => entry.type === 'text')?.text;
      assert.equal(typeof body, 'string', `${tool} returned no JSON text`);
      return { error: result.isError, data: JSON.parse(body) };
    }

    async function call(tool, args) {
      const { error, data } = await request(tool, args);
      assert.ok(!error, `${tool} failed: ${JSON.stringify(data)}`);
      return data;
    }

    // Authentication can complete before startup schema introspection. Retry only this read.
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
      const identity = await call('manage_context', { action: 'whoami' });
      assert.equal(identity.userLookup, 'ok');
      const root = await waitForTestNamespace();
      assert.equal(root.full_path, 'test');
      const project = await call('manage_project', {
        action: 'create',
        name,
        namespace: 'test',
        visibility: 'private',
        initialize_with_readme: true,
        jobs_enabled: false,
      });
      assert.equal(project.path_with_namespace, namespace);
      assert.ok(project.id);
      projectId = String(project.id);

      const issue = await call('manage_work_item', {
        action: 'create',
        namespace,
        title: 'Work item discussion fixture',
        workItemType: 'ISSUE',
      });
      assert.ok(issue.id);
      assert.ok(issue.iid);
      const iid = String(issue.iid);
      const comments = ['First fixture comment', 'Second fixture comment'];
      for (const body of comments) {
        const note = await call('manage_mr_discussion', {
          action: 'comment',
          project_id: projectId,
          noteable_type: 'issue',
          noteable_id: iid,
          body,
        });
        assert.equal(note.body, body);
      }
      await call('manage_work_item', {
        action: 'update',
        id: String(issue.id),
        state: 'CLOSE',
      });

      // The old details projection exposes the widget without fetching its notes.
      const details = await call('browse_work_items', { action: 'get', namespace, iid });
      assert.equal(details.state, 'CLOSED');
      assert.equal(details.widgets.find((widget) => widget.type === 'NOTES')?.type, 'NOTES');

      const lookup = { action: 'list_discussions', namespace, iid, first: 1 };
      const first = await call('browse_work_items', lookup);
      assert.equal(first.discussions.length, 1);
      assert.equal(first.hasMore, true);
      assert.ok(first.endCursor);
      const second = await call('browse_work_items', { ...lookup, after: first.endCursor });
      assert.notEqual(second.discussions[0]?.id, first.discussions[0].id);

      const full = await call('browse_work_items', {
        action: 'list_discussions',
        id: String(issue.id),
      });
      assert.equal(full.workItemId, String(issue.id));
      const notes = full.discussions.flatMap((discussion) => discussion.notes.nodes);
      for (const body of comments)
        assert.ok(notes.some((note) => !note.system && note.body === body));
      assert.ok(
        notes.some((note) => note.system && note.body),
        'Expected a GitLab system note',
      );
    } finally {
      try {
        if (projectId) await call('manage_project', { action: 'delete', project_id: projectId });
      } finally {
        await client.close();
      }
    }
  },
);
