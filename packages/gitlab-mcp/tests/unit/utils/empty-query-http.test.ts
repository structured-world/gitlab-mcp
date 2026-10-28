import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const originalEnv = process.env;
const received: { url: string; token: string | string[] | undefined }[] = [];
const server = createServer((request, response) => {
  received.push({ url: request.url!, token: request.headers['private-token'] });
  response.setHeader('Content-Type', 'application/json');
  const query = new URL(request.url!, 'http://localhost').searchParams;
  const empty = [...query.values()].some((value) => value === '');
  response.statusCode = empty ? 400 : 200;
  response.end(JSON.stringify(empty ? { message: 'Empty filters are invalid' } : []));
});
let list: (args: unknown) => Promise<unknown>;
let cleanup: (() => Promise<void>) | undefined;

beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    GITLAB_TOKEN: 'fixture-query-token',
    GITLAB_PERSONAL_ACCESS_TOKEN: '',
    GITLAB_INSTANCES: '',
    GITLAB_INSTANCES_FILE: '',
    GITLAB_DENIED_ACTIONS: '',
    OAUTH_ENABLED: 'false',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
  };
  await jest.isolateModulesAsync(async () => {
    const { mrsToolRegistry } = await import('../../../src/entities/mrs/registry');
    const { InstanceRegistry } = await import('../../../src/services/InstanceRegistry');
    list = mrsToolRegistry.get('browse_merge_requests')!.handler;
    cleanup = () => InstanceRegistry.getInstance().resetWithPools();
  });
}, 30_000);

afterAll(async () => {
  try {
    await cleanup?.();
  } finally {
    process.env = originalEnv;
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }
});

// Exercise schema, handler, shared serializer and authenticated transport together for every list scope.
it.each([
  [{}, '/api/v4/merge_requests'],
  [{ project_id: 'test/project' }, '/api/v4/projects/test%2Fproject/merge_requests'],
  [{ group_id: 'test/subgroup' }, '/api/v4/groups/test%2Fsubgroup/merge_requests'],
] as const)('omits unfilled filters over HTTP for %j', async (scope, path) => {
  received.length = 0;
  await expect(
    list({
      action: 'list',
      ...scope,
      milestone: '',
      search: '',
      author_username: '',
      assignee_username: '',
      reviewer_username: '',
      source_branch: '',
      target_branch: '',
      labels: [],
      approved_by_usernames: [],
      author_id: 0,
      with_labels_details: false,
      per_page: 5,
    }),
  ).resolves.toEqual([]);
  expect(received).toEqual([
    {
      url: `${path}?with_labels_details=false&author_id=0&per_page=5`,
      token: 'fixture-query-token',
    },
  ]);
});
