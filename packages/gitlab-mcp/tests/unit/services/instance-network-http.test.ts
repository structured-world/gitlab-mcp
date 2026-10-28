import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest, type Server, type RequestListener } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { parse } from 'graphql';

const originalEnv = process.env;
const proxyRequests: string[] = [];
const tokens: { host: string | undefined; token: string | string[] | undefined }[] = [];
const sockets = new Set<Socket>();
let certificateDirectory: string;
let plain: Server;
let secure: Server;
let proxy: Server;
let plainUrl: string;
let secureUrl: string;
let proxyUrl: string;

async function listen(server: Server): Promise<string> {
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  certificateDirectory = mkdtempSync(join(tmpdir(), 'gitlab-mcp-network-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-keyout',
      join(certificateDirectory, 'key.pem'),
      '-out',
      join(certificateDirectory, 'ca.pem'),
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-days',
      '1',
    ],
    { stdio: 'ignore', timeout: 10_000 },
  );
  const respond: RequestListener = (request, response) => {
    tokens.push({ host: request.headers.host, token: request.headers['private-token'] });
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify(
        request.url?.endsWith('/api/graphql')
          ? { data: { currentUser: { username: 'fixture' } } }
          : { ok: true },
      ),
    );
  };
  plain = createServer(respond);
  secure = createTlsServer(
    {
      key: readFileSync(join(certificateDirectory, 'key.pem')),
      cert: readFileSync(join(certificateDirectory, 'ca.pem')),
    },
    respond,
  );
  proxy = createServer((request, response) => {
    proxyRequests.push(request.url!);
    const target = new URL(request.url!);
    const upstream = httpRequest(
      {
        hostname: '127.0.0.1',
        port: target.port,
        path: target.pathname + target.search,
        method: request.method,
        headers: request.headers,
      },
      (result) => {
        response.writeHead(result.statusCode!, result.headers);
        result.pipe(response);
      },
    );
    upstream.on('error', () => response.destroy());
    request.pipe(upstream);
  });
  proxy.on('connect', (request, client, head) => {
    proxyRequests.push(request.url!);
    const target = new URL(`http://${request.url}`);
    const upstream = connect(Number(target.port), '127.0.0.1');
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
  });
  plainUrl = await listen(plain);
  secureUrl = (await listen(secure)).replace('http:', 'https:');
  proxyUrl = await listen(proxy);
}, 30_000);

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    [plain, secure, proxy]
      .filter(Boolean)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
  if (certificateDirectory) rmSync(certificateDirectory, { recursive: true, force: true });
});

async function exercise(
  url: string,
  environment: NodeJS.ProcessEnv,
  registered: boolean,
  graphql = false,
  secondUrl?: string,
): Promise<void> {
  proxyRequests.length = 0;
  tokens.length = 0;
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: url,
    GITLAB_TOKEN: 'network-fixture-token',
    GITLAB_PERSONAL_ACCESS_TOKEN: '',
    GITLAB_INSTANCES: '',
    GITLAB_INSTANCES_FILE: '',
    OAUTH_ENABLED: 'false',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    NO_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    no_proxy: '',
    GITLAB_CA_CERT_PATH: '',
    SKIP_TLS_VERIFY: 'false',
    NODE_TLS_REJECT_UNAUTHORIZED: '1',
    ...environment,
  };
  try {
    await jest.isolateModulesAsync(async () => {
      const { InstanceRegistry } = await import('../../../src/services/InstanceRegistry');
      const { enhancedFetch, createFetchOptions, resetDispatcherCache } =
        await import('../../../src/utils/fetch');
      const registry = InstanceRegistry.getInstance();
      try {
        if (registered) await registry.initialize();
        if (secondUrl) {
          const responses = await Promise.all(
            [url, secondUrl].map((base) =>
              enhancedFetch(`${base}/api/v4/version`, { retry: false }),
            ),
          );
          for (const response of responses) expect(await response.json()).toEqual({ ok: true });
        } else if (graphql) {
          const client = registry.getGraphQLClient(url)!;
          await expect(client.request(parse('{ currentUser { username } }'))).resolves.toEqual({
            currentUser: { username: 'fixture' },
          });
        } else {
          const response = await enhancedFetch(`${url}/api/v4/version`, { retry: false });
          expect(await response.json()).toEqual({ ok: true });
        }
        const expected = [{ host: new URL(url).host, token: 'network-fixture-token' }];
        if (secondUrl)
          expected.push({ host: new URL(secondUrl).host, token: 'second-fixture-token' });
        expect(tokens).toHaveLength(expected.length);
        expect(tokens).toEqual(expect.arrayContaining(expected));
        if (registered && (environment.HTTP_PROXY || environment.HTTPS_PROXY)) {
          // Environment proxy dispatchers do not expose native Pool counters.
          expect(registry.getConnectionPoolStats()).toEqual([]);
          expect(registry.getInstancePoolStats(url)).toBeUndefined();
        }
      } finally {
        if (!registered) {
          const dispatcher = createFetchOptions().dispatcher as { destroy(): Promise<void> };
          await dispatcher.destroy();
          resetDispatcherCache();
        }
        await registry.resetWithPools();
      }
    });
  } finally {
    process.env = originalEnv;
  }
}

// Registered REST and GraphQL calls must use the same configured outbound proxy.
it.each([false, true])('proxies registered instance requests with GraphQL=%s', async (graphql) => {
  await exercise(plainUrl, { HTTP_PROXY: proxyUrl }, true, graphql);
  expect(proxyRequests).toHaveLength(1);
});

// Independent configured instances must retain their own credentials on concurrent proxy requests.
it('routes two configured instances without mixing their tokens', async () => {
  const secondUrl = plainUrl.replace('127.0.0.1', 'localhost');
  await exercise(
    plainUrl,
    {
      HTTP_PROXY: proxyUrl,
      GITLAB_INSTANCES: JSON.stringify({
        instances: [{ url: plainUrl }, { url: secondUrl, tokenEnv: 'NETWORK_SECOND_TOKEN' }],
      }),
      NETWORK_SECOND_TOKEN: 'second-fixture-token',
    },
    true,
    false,
    secondUrl,
  );
  expect(proxyRequests).toHaveLength(2);
});

// Both startup and registered dispatchers must honor bypass rules at the real socket boundary.
it.each([false, true])('honors NO_PROXY for registered=%s', async (registered) => {
  await exercise(
    plainUrl,
    { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: '127.0.0.1' },
    registered,
  );
  expect(proxyRequests).toEqual([]);
});

// Native bypass matching must handle whole-host, suffix, wildcard and port boundaries.
it.each(['*', '.localhost', 'matching-port', 'wrong-port'])(
  'honors NO_PROXY pattern %s',
  async (pattern) => {
    const url = plainUrl.replace('127.0.0.1', 'localhost');
    const noProxy =
      pattern === 'matching-port'
        ? new URL(url).host
        : pattern === 'wrong-port'
          ? 'localhost:1'
          : pattern;
    await exercise(url, { HTTP_PROXY: proxyUrl, NO_PROXY: noProxy }, true);
    expect(proxyRequests).toHaveLength(pattern === 'wrong-port' ? 1 : 0);
  },
);

// HTTPS_PROXY alone must not divert an HTTP instance through an unrelated proxy.
it('selects the proxy by the instance protocol', async () => {
  await exercise(plainUrl, { HTTPS_PROXY: proxyUrl }, true);
  expect(proxyRequests).toEqual([]);
});

// Supplying no CA must not accidentally disable verification while configuring a proxy.
it.each([false, true])('rejects an untrusted certificate with proxy=%s', async (proxied) => {
  await expect(exercise(secureUrl, { HTTPS_PROXY: proxied ? proxyUrl : '' }, true)).rejects.toThrow(
    'fetch failed',
  );
  expect(tokens).toEqual([]);
});

// A private CA must authenticate registered GitLab TLS directly and through a CONNECT tunnel.
it.each([false, true])(
  'trusts a private CA on a registered instance with proxy=%s',
  async (proxied) => {
    await exercise(
      secureUrl,
      {
        GITLAB_CA_CERT_PATH: join(certificateDirectory, 'ca.pem'),
        HTTPS_PROXY: proxied ? proxyUrl : '',
      },
      true,
    );
    expect(proxyRequests).toHaveLength(proxied ? 1 : 0);
  },
);
