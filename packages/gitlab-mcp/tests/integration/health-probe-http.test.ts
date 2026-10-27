import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Health probe did not complete')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const originalEnv = process.env;
let userStatus = 403;
let probes = 0;
let resolveRepeated!: () => void;
const repeated = new Promise<void>((resolve) => {
  resolveRepeated = resolve;
});
const tokens: (string | string[] | undefined)[] = [];
const tree = [{ id: 'fixture-blob', name: 'README.md', type: 'blob', path: 'README.md' }];
let runScenario: () => Promise<void>;
let cleanupServices: (() => Promise<void>) | undefined;

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/v4/user') {
    tokens.push(request.headers['private-token']);
    response.statusCode = userStatus;
    response.end(JSON.stringify({ message: `${userStatus} profile unavailable` }));
    if (request.method === 'HEAD' && ++probes >= 3) resolveRepeated();
  } else if (request.url === '/api/v4/personal_access_tokens/self') {
    response.end(
      JSON.stringify({
        id: 1,
        name: 'repository-reader',
        scopes: ['read_repository'],
        expires_at: null,
        active: true,
        revoked: false,
      }),
    );
  } else if (request.url === '/api/v4/version') {
    response.end(JSON.stringify({ version: '16.0.0', revision: 'fixture', enterprise: false }));
  } else if (request.url?.startsWith('/api/v4/projects/test%2Fproject/repository/tree')) {
    tokens.push(request.headers['private-token']);
    response.end(JSON.stringify(tree));
  } else {
    response.statusCode = 404;
    response.end();
  }
});

// Load and initialize the registry in the setup hook; probe deadlines measure HTTP work.
beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: url,
    GITLAB_TOKEN: 'fixture-token',
    GITLAB_PERSONAL_ACCESS_TOKEN: '',
    GITLAB_INSTANCES: '',
    GITLAB_INSTANCES_FILE: '',
    GITLAB_HEALTH_CHECK_INTERVAL_MS: '50',
    GITLAB_INIT_TIMEOUT_MS: '2000',
    OAUTH_ENABLED: 'false',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    USE_FILES: 'true',
  };
  await jest.isolateModulesAsync(async () => {
    const { HealthMonitor } = await import('../../src/services/HealthMonitor');
    const { ConnectionManager } = await import('../../src/services/ConnectionManager');
    const { InstanceRegistry } = await import('../../src/services/InstanceRegistry');
    const { RegistryManager } = await import('../../src/registry-manager');
    const { filesToolRegistry } = await import('../../src/entities/files/registry');
    const monitor = HealthMonitor.getInstance();
    cleanupServices = async () => {
      HealthMonitor.resetInstance();
      ConnectionManager.getInstance().reset();
      await InstanceRegistry.getInstance().resetWithPools();
    };
    const registry = RegistryManager.getInstance();
    runScenario = async () => {
      await monitor.initialize(url);
      await within(repeated);
      expect(monitor.getState(url)).toBe('degraded');
      expect(monitor.isInstanceReachable(url)).toBe(true);
      expect(registry.getAvailableToolNames(url)).toContain('browse_files');
      await expect(
        filesToolRegistry.get('browse_files')!.handler({
          action: 'tree',
          project_id: 'test/project',
        }),
      ).resolves.toEqual(tree);
      expect(tokens.length).toBeGreaterThan(3);
      expect(tokens.every((token) => token === 'fixture-token')).toBe(true);

      const failed = new Promise<void>((resolve) => {
        monitor.onStateChange((_instance, _from, to) => {
          if (to === 'failed') resolve();
        });
      });
      userStatus = 401;
      await within(failed);
      expect(monitor.isInstanceReachable(url)).toBe(false);
      expect(registry.getAvailableToolNames(url)).not.toContain('browse_files');
    };
  });
}, 30_000);

afterAll(async () => {
  try {
    await cleanupServices?.();
  } finally {
    process.env = originalEnv;
    server.closeAllConnections();
    if (server.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});

// A real HTTP permission denial must preserve tool discovery and repository reads;
// a later revoked token must still remove those tools from discovery.
it('keeps tools usable after /user 403 and disables them after /user 401 over HTTP', async () => {
  await runScenario();
});
