import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

const originalEnv = process.env;
const requests: { method: string | undefined; path: string | undefined; body: string }[] = [];
let head: string;
let requireSha = true;
let changeHeadAfterRead = false;
let merge: (args: unknown) => Promise<unknown>;
let cleanup: (() => Promise<void>) | undefined;

const server = createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk: string) => {
    body += chunk;
  });
  request.on('end', () => {
    requests.push({ method: request.method, path: request.url, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.headers['private-token'] !== 'merge-fixture-token') {
      response.writeHead(401);
      response.end(JSON.stringify({ message: 'Unauthorized' }));
    } else if (request.method === 'GET') {
      response.end(JSON.stringify({ sha: head, detailed_merge_status: 'ci_still_running' }));
      if (changeHeadAfterRead) head = randomBytes(20).toString('hex');
    } else {
      const sha = new URLSearchParams(body).get('sha');
      if (requireSha && !sha) {
        response.writeHead(400);
        response.end(JSON.stringify({ message: 'SHA must be provided when merging' }));
      } else if (sha && sha !== head) {
        response.writeHead(409);
        response.end(JSON.stringify({ message: 'SHA does not match HEAD of source branch' }));
      } else {
        response.end(
          JSON.stringify({ state: 'opened', merge_when_pipeline_succeeds: true, sha: head }),
        );
      }
    }
  });
});

beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    GITLAB_TOKEN: 'merge-fixture-token',
    GITLAB_PERSONAL_ACCESS_TOKEN: '',
    GITLAB_INSTANCES: '',
    GITLAB_INSTANCES_FILE: '',
    GITLAB_DENIED_ACTIONS: '',
    OAUTH_ENABLED: 'false',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
  };
  await jest.isolateModulesAsync(async () => {
    const { mrsToolRegistry } = await import('../../../../src/entities/mrs/registry');
    const { InstanceRegistry } = await import('../../../../src/services/InstanceRegistry');
    const registry = InstanceRegistry.getInstance();
    cleanup = () => registry.resetWithPools();
    await registry.initialize();
    merge = mrsToolRegistry.get('manage_merge_request')!.handler;
  });
}, 30_000);

beforeEach(() => {
  head = randomBytes(20).toString('hex');
  requireSha = true;
  changeHeadAfterRead = false;
  requests.length = 0;
});

afterAll(async () => {
  try {
    await cleanup?.();
  } finally {
    process.env = originalEnv;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

const args = {
  action: 'merge',
  project_id: 'test/project',
  merge_request_iid: '1',
  merge_when_pipeline_succeeds: true,
};

// Exercise schema, authentication and form encoding with optional and required GitLab SHA policies.
it.each([false, true])('pins auto-merge over HTTP when requireSha=%s', async (required) => {
  requireSha = required;
  const expectedHead = head;
  await expect(merge(args)).resolves.toEqual({
    state: 'opened',
    merge_when_pipeline_succeeds: true,
    sha: expectedHead,
  });
  expect(requests).toEqual([
    { method: 'GET', path: '/api/v4/projects/test%2Fproject/merge_requests/1', body: '' },
    {
      method: 'PUT',
      path: '/api/v4/projects/test%2Fproject/merge_requests/1/merge',
      body: new URLSearchParams({
        sha: expectedHead,
        merge_when_pipeline_succeeds: 'true',
      }).toString(),
    },
  ]);
});

// A caller's expected head bypasses discovery without changing its compare-and-merge meaning.
it('sends an explicit SHA unchanged with one HTTP request', async () => {
  await merge({ ...args, sha: head });
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('PUT');
  expect(new URLSearchParams(requests[0].body).get('sha')).toBe(head);
});

// GitLab must reject a head that moves between discovery and scheduling; never silently retry a newer head.
it('propagates a head race without scheduling against a newer commit', async () => {
  const oldHead = head;
  changeHeadAfterRead = true;
  await expect(merge(args)).rejects.toThrow('409');
  expect(requests).toHaveLength(2);
  expect(new URLSearchParams(requests[1].body).get('sha')).toBe(oldHead);
  expect(head).not.toBe(oldHead);
});

// An explicit stale SHA must remain stale, so GitLab enforces the caller's optimistic concurrency guard.
it('does not replace an explicit stale SHA after a conflict', async () => {
  const staleHead = randomBytes(20).toString('hex');
  await expect(merge({ ...args, sha: staleHead })).rejects.toThrow('409');
  expect(requests).toHaveLength(1);
  expect(new URLSearchParams(requests[0].body).get('sha')).toBe(staleHead);
});
