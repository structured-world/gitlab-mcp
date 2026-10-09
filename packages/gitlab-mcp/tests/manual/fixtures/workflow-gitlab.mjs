import { createServer } from 'node:http';
import { parse, visit, Kind } from 'graphql';

/** Deterministic GitLab fixture for real-client evaluations; no live credentials. */
export async function startWorkflowGitLab() {
  const requests = [];
  const user = {
    id: 1,
    username: 'fixture-reader',
    name: 'Fixture Reader',
    state: 'active',
    is_admin: false,
  };
  const project = {
    id: 71,
    name: 'Backend',
    path: 'backend',
    path_with_namespace: 'test/backend',
    web_url: 'https://gitlab.example.com/test/backend',
    default_branch: 'main',
  };
  const mr = {
    id: 91,
    iid: 12,
    title: 'Fix parser bounds',
    state: 'opened',
    source_branch: 'fix/parser',
    target_branch: 'main',
    sha: 'abc123',
    web_url: 'https://gitlab.example.com/test/backend/-/merge_requests/12',
    description: 'Reject oversized input',
  };
  const job = {
    id: 34,
    name: 'test',
    stage: 'test',
    status: 'failed',
    pipeline: { id: 22 },
    web_url: 'https://gitlab.example.com/test/backend/-/jobs/34',
  };
  const item = {
    id: 'gid://gitlab/WorkItem/51',
    iid: '3',
    title: 'Add parser limits',
    state: 'OPEN',
    description: 'Reject oversized input before allocation',
    workItemType: { id: 'gid://gitlab/WorkItems::Type/1', name: 'Issue' },
    widgets: [],
    webUrl: 'https://gitlab.example.com/test/backend/-/work_items/3',
  };
  function graphQL(input, json) {
    const query = input.query ?? '';
    if (/\bmutation\b/.test(query))
      return json({
        errors: [{ message: 'Permission denied: fixture account cannot mutate work items' }],
      });
    if (query.includes('__schema'))
      return json({ errors: [{ message: 'Introspection unavailable in fixture' }] });
    if (query.includes('metadata'))
      return json({
        data: {
          metadata: { version: '19.0.0', enterprise: true, revision: 'fixture' },
          currentUser: user,
        },
      });
    if (query.includes('currentLicense'))
      return json({ data: { currentLicense: { plan: 'ultimate' } } });
    const invalidTargets = validateGraphQLTargets(query, input.variables);
    if (invalidTargets.length)
      return json({ data: Object.fromEntries(invalidTargets.map((name) => [name, null])) });
    const namespace = {
      workItems: { nodes: [item], pageInfo: { hasNextPage: false, endCursor: null } },
      workItem: item,
      workItemTypes: { nodes: [{ id: 'gid://gitlab/WorkItems::Type/1', name: 'Issue' }] },
    };
    return json({
      data: {
        namespace,
        project: namespace,
        group: namespace,
        workItem: item,
        currentUser: user,
      },
    });
  }

  function rest(request, path, response, json) {
    if (request.method !== 'GET') return json({ message: 'Fixture account is read-only' }, 403);
    if (path.includes('/test/denied')) return json({ message: 'Forbidden' }, 403);
    if (path === '/api/v4/user') return json(user);
    if (path === '/api/v4/version' || path === '/api/v4/metadata')
      return json({ version: '19.0.0', enterprise: true, revision: 'fixture' });
    if (path === '/api/v4/personal_access_tokens/self')
      return json({
        id: 1,
        name: 'fixture-only',
        scopes: ['api'],
        active: true,
        revoked: false,
        expires_at: null,
      });
    if (path === '/api/v4/projects') return json([project]);
    if (/^\/api\/v4\/projects\/(?:71|test\/backend)$/.test(path)) return json(project);
    if (path === '/api/v4/groups/test') return json({ id: 9, full_path: 'test' });
    const projectRoute = /^\/api\/v4\/projects\/(?:71|test\/backend)(\/.*)$/.exec(path);
    if (!projectRoute) return json({ message: 'Project route not found' }, 404);
    return projectRest(projectRoute[1], response, json);
  }

  function projectRest(path, response, json) {
    if (path.endsWith('/merge_requests')) return json([mr]);
    if (path.endsWith('/merge_requests/12/changes'))
      return json({
        ...mr,
        changes: [
          {
            old_path: 'parser.ts',
            new_path: 'parser.ts',
            new_file: false,
            deleted_file: false,
            renamed_file: false,
            diff: '@@ -1 +1 @@\n-parse(input)\n+if (input.length > 4096) throw new Error("Input too large")',
          },
        ],
      });
    if (path.endsWith('/merge_requests/12/discussions')) return json([]);
    if (path.endsWith('/merge_requests/12')) return json(mr);
    if (path.endsWith('/pipelines/22/jobs')) return json([job]);
    if (path.endsWith('/jobs/34/trace')) {
      response.writeHead(200, { 'content-type': 'text/plain' });
      return response.end(
        'Running unit tests\nFAIL parser bounds\nExpected oversized input rejection, received success\nJob failed: exit code 1\n',
      );
    }
    if (path.endsWith('/jobs/34')) return json(job);
    if (path.endsWith('/pipelines'))
      return json([{ id: 22, status: 'failed', ref: 'fix/parser', sha: 'abc123' }]);
    if (path.endsWith('/pipelines/22'))
      return json({ id: 22, status: 'failed', ref: 'fix/parser', sha: 'abc123' });
    if (path.endsWith('/repository/files/.gitlab-ci.yml/raw')) {
      response.writeHead(200, { 'content-type': 'text/plain' });
      return response.end('test:\n  script: yarn test\n');
    }
    if (path.endsWith('/repository/files/parser.ts/raw')) {
      response.writeHead(200, { 'content-type': 'text/plain' });
      return response.end(
        'export function parse(input: string) {\n  if (input.length > 4096) throw new Error("Input too large");\n  return JSON.parse(input);\n}\n',
      );
    }
    if (path.endsWith('/repository/tree'))
      return json([
        {
          id: 'abc123',
          name: '.gitlab-ci.yml',
          path: '.gitlab-ci.yml',
          type: 'blob',
          mode: '100644',
        },
      ]);
    return json({ message: `Unimplemented fixture route ${path}` }, 404);
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = body ? JSON.parse(body) : {};
    requests.push({
      method: request.method,
      path,
      query: Object.fromEntries(url.searchParams),
      input,
    });
    function json(value, status = 200) {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    }
    if (path === '/api/graphql') return graphQL(input, json);
    return rest(request, path, response, json);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    project,
    mr,
    item,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** Inspect the query's actual target arguments, including inline literals. */
function validateGraphQLTargets(query, variables = {}) {
  const invalid = [];
  visit(parse(query), {
    Field(node) {
      for (const argument of node.arguments ?? []) {
        if (!['fullPath', 'id', 'iid'].includes(argument.name.value)) continue;
        const value =
          argument.value.kind === Kind.VARIABLE
            ? variables[argument.value.name.value]
            : argument.value.value;
        if (argument.name.value === 'fullPath' && value !== 'test/backend') {
          invalid.push(node.alias?.value ?? node.name.value);
        }
        if (argument.name.value === 'iid' && String(value) !== '3') {
          invalid.push(node.alias?.value ?? node.name.value);
        }
        if (
          node.name.value === 'workItem' &&
          argument.name.value === 'id' &&
          value !== 'gid://gitlab/WorkItem/51'
        ) {
          invalid.push(node.alias?.value ?? node.name.value);
        }
      }
    },
  });
  return invalid;
}
