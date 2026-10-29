import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { SessionManager } from '../../src/session-manager';
import { RegistryManager } from '../../src/registry-manager';
import { resetHandlersState } from '../../src/handlers';
import { runWithTokenContext } from '../../src/oauth/token-context';

jest.mock('../../src/config', () => ({
  ...jest.requireActual('../../src/config'),
  GITLAB_SCHEMA_MODE: 'auto',
  GITLAB_READ_ONLY_MODE: false,
  GITLAB_ALLOWED_PROJECT_IDS: ['1'],
}));
jest.mock('../../src/oauth/index', () => ({
  ...jest.requireActual('../../src/oauth/token-context'),
  isOAuthEnabled: () => true,
  isAuthenticationConfigured: () => true,
}));
jest.mock('../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: () => ({
      getInstanceInfo: () => ({ version: '16.0.0', tier: 'free' }),
      getCurrentInstanceUrl: () => 'https://old.example.com',
      getTokenScopeInfo: () => null,
      getAdminInfo: () => null,
      isConnected: () => true,
      getClient: () => ({}),
      initialize: async () => undefined,
      ensureIntrospected: async () => undefined,
    }),
  },
}));
jest.mock('../../src/services/HealthMonitor', () => ({
  ...jest.requireActual('../../src/services/HealthMonitor'),
  HealthMonitor: {
    getInstance: () => ({
      initialize: async () => undefined,
      onStateChange: () => undefined,
      getState: () => 'healthy',
      getMonitoredInstances: () => [],
      isAnyInstanceHealthy: () => true,
      isInstanceReachable: () => true,
      reportSuccess: () => undefined,
      reportError: () => undefined,
    }),
  },
}));

describe('artifact files through the public MCP boundary', () => {
  const requests: string[] = [];
  let slowRead: () => void;
  let slowClosed: () => void;
  const api = createServer((request, response) => {
    requests.push(request.url!);
    if (request.url!.endsWith('/slow.txt')) {
      response.on('close', () => slowClosed());
      response.writeHead(200);
      response.write('start');
      slowRead();
      return;
    }
    if (request.url!.endsWith('/binary.bin')) {
      response.end(Buffer.from([0]));
      return;
    }
    if (request.url!.endsWith('/jobs/34')) {
      response.end(JSON.stringify({ web_url: `${url}/test/allowed/-/jobs/34` }));
      return;
    }
    if (request.url === '/api/v4/projects/1') {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          id: 1,
          path_with_namespace: 'test/allowed',
          name_with_namespace: 'Test / allowed',
        }),
      );
    } else response.end('fixture report');
  });
  let url: string;
  let sessions: SessionManager;
  let client: Client;
  beforeAll(async () => {
    api.listen(0, '127.0.0.1');
    await once(api, 'listening');
    url = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    requests.length = 0;
    resetHandlersState();
    RegistryManager.getInstance().refreshCache();
    sessions = new SessionManager();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await sessions.createSession('artifact-fixture', serverTransport);
    client = new Client({ name: 'artifact-fixture', version: '1.0.0' });
    await client.connect(clientTransport);
  });
  afterEach(async () => {
    await client.close();
    await sessions.shutdown();
  });
  afterAll(async () => {
    api.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      api.close((error) => (error ? reject(error) : resolve())),
    );
  });

  function account<T>(work: () => Promise<T>) {
    return runWithTokenContext(
      {
        gitlabToken: 'fixture-only',
        gitlabUserId: 1,
        gitlabUsername: 'fixture',
        sessionId: 'fixture',
        gitlabScopes: ['read_api'],
        apiUrl: url,
      },
      work,
    );
  }

  // GitLab 16 Free and read_api must expose the action and return an MCP-valid text object.
  it('reads an allowed project with the oldest supported instance', async () => {
    const catalog = await account(() => client.listTools());
    const tool = catalog.tools.find((item) => item.name === 'browse_pipelines');
    expect(JSON.stringify(tool?.inputSchema)).toContain('artifact_file');
    const result = CallToolResultSchema.parse(
      await account(() =>
        client.callTool({
          name: 'browse_pipelines',
          arguments: {
            action: 'artifact_file',
            project_id: '1',
            job_id: '34',
            artifact_path: 'reports/result.txt',
          },
        }),
      ),
    );
    expect(result.isError).not.toBe(true);
    if (result.content[0].type !== 'text') throw new Error('Expected JSON text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      text: 'fixture report',
      complete: true,
    });
    expect(requests).toContain('/api/v4/projects/1/jobs/34/artifacts/reports/result.txt');
    expect(requests.every((path) => path.startsWith('/api/v4/projects/1'))).toBe(true);
  });

  // Project B must be denied before the artifact HTTP request when only A is allowed.
  it('enforces the operator project allowlist before I/O', async () => {
    const result = await account(() =>
      client.callTool({
        name: 'browse_pipelines',
        arguments: {
          action: 'artifact_file',
          project_id: '2',
          job_id: '34',
          artifact_path: 'reports/result.txt',
        },
      }),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('not allowed');
    expect(requests).toEqual([]);
  });

  // Structured refusals must survive registry wrapping and reach the MCP client as bounded data.
  it('returns a machine-readable binary refusal through MCP', async () => {
    const result = CallToolResultSchema.parse(
      await account(() =>
        client.callTool({
          name: 'browse_pipelines',
          arguments: {
            action: 'artifact_file',
            project_id: '1',
            job_id: '34',
            artifact_path: 'binary.bin',
          },
        }),
      ),
    );
    expect(result.isError).toBe(true);
    if (result.content[0].type !== 'text') throw new Error('Expected JSON text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error_code: 'ARTIFACT_READ_REFUSED',
      reason: 'not_text',
      artifact_view_url: `${url}/test/allowed/-/jobs/34/artifacts/file/binary.bin`,
    });
  });

  // Repository-only credentials cannot gain CI artifact access through the new action.
  it('preserves the GitLab API scope gate before downloading', async () => {
    const result = await runWithTokenContext(
      {
        gitlabToken: 'fixture-only',
        gitlabUserId: 1,
        gitlabUsername: 'fixture',
        sessionId: 'fixture',
        gitlabScopes: ['read_repository'],
        apiUrl: url,
      },
      () =>
        client.callTool({
          name: 'browse_pipelines',
          arguments: {
            action: 'artifact_file',
            project_id: '1',
            job_id: '34',
            artifact_path: 'report.txt',
          },
        }),
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('not found in any registry');
    // Scope preflight resolves the operator's project identity before registry dispatch.
    expect(requests).toEqual(['/api/v4/projects/1']);
  });

  // MCP cancellation must stop the upstream HTTP transfer, not just reject the client promise.
  it('cancels an in-flight artifact download when the MCP client cancels', async () => {
    const started = new Promise<void>((resolve) => {
      slowRead = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      slowClosed = resolve;
    });
    const cancellation = new AbortController();
    const pending = account(() =>
      client.callTool(
        {
          name: 'browse_pipelines',
          arguments: {
            action: 'artifact_file',
            project_id: '1',
            job_id: '34',
            artifact_path: 'slow.txt',
          },
        },
        CallToolResultSchema,
        { signal: cancellation.signal },
      ),
    );
    await started;
    cancellation.abort();
    await expect(pending).rejects.toThrow();
    await closed;
  });
});
