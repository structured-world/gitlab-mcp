// Build the core package, then run this file with node --test from the workspace.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { gql } from 'graphql-tag';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const threadBody = 'Fixture thread';
const replyBody = 'Fixture thread reply';

/** Seed a thread using the server's GraphQL client. Work item writes stay inside the test fixture. */
async function createThread(instanceUrl, workItemId) {
  loadEnvFile(new URL('../../.env.test', import.meta.url));
  const { getGitLabBaseUrl } = require('../../dist/src/utils/gitlab-base-url.js');
  const { GraphQLClient } = require('../../dist/src/graphql/client.js');
  const baseUrl = getGitLabBaseUrl();
  assert.equal(baseUrl, instanceUrl, 'Fixture setup must use the same GitLab as the MCP server');
  const graphql = new GraphQLClient(`${baseUrl}/api/graphql`);
  const noteableId = `gid://gitlab/WorkItem/${workItemId}`;
  const { createDiscussion: thread } = await graphql.request(
    gql`
      mutation FixtureThread($input: CreateDiscussionInput!) {
        createDiscussion(input: $input) {
          errors
          note {
            discussion {
              id
            }
          }
        }
      }
    `,
    { input: { noteableId, body: threadBody } },
  );
  assert.deepEqual(thread.errors, []);
  const discussionId = thread.note?.discussion?.id;
  assert.ok(discussionId);
  const { createNote: reply } = await graphql.request(
    gql`
      mutation FixtureReply($input: CreateNoteInput!) {
        createNote(input: $input) {
          errors
          note {
            body
          }
        }
      }
    `,
    { input: { noteableId, discussionId, body: replyBody } },
  );
  assert.deepEqual(reply.errors, []);
  assert.equal(reply.note?.body, replyBody);
  return discussionId;
}

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

    /** Keep MCP application errors separate from transport failures. */
    async function request(tool, args) {
      const result = await client.callTool({ name: tool, arguments: args }, undefined, {
        timeout: 30_000,
      });
      const body = result.content.find((entry) => entry.type === 'text')?.text;
      assert.equal(typeof body, 'string', `${tool} returned no JSON text`);
      return { error: result.isError, data: JSON.parse(body) };
    }

    /** Fixture writes and feature reads must succeed before their results are used. */
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
      const discussionId = await createThread(identity.server.apiUrl, issue.id);
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

      const lookup = { action: 'list_discussions', namespace, iid, first: 1, notes_first: 1 };
      const first = await call('browse_work_items', lookup);
      assert.equal(first.discussions.length, 1);
      assert.equal(first.hasMore, true);
      assert.ok(first.endCursor);
      const thread = first.discussions[0];
      assert.equal(thread.id, discussionId);
      assert.deepEqual(
        thread.notes.nodes.map((note) => note.body),
        [threadBody],
      );
      assert.equal(thread.notes.pageInfo.hasNextPage, true);
      assert.ok(thread.notes.pageInfo.endCursor);

      const continued = await call('browse_work_items', {
        ...lookup,
        discussion_id: discussionId,
        notes_after: thread.notes.pageInfo.endCursor,
      });
      assert.equal(continued.discussions.length, 1);
      assert.equal(continued.discussions[0].id, discussionId);
      assert.deepEqual(
        continued.discussions[0].notes.nodes.map((note) => note.body),
        [replyBody],
      );
      assert.equal(continued.discussions[0].notes.pageInfo.hasNextPage, false);

      const second = await call('browse_work_items', { ...lookup, after: first.endCursor });
      assert.equal(second.discussions.length, 1);
      assert.notEqual(second.discussions[0].id, discussionId);

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
