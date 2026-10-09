import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from '../../src/session-manager';
import { RegistryManager } from '../../src/registry-manager';
import { coreToolRegistry } from '../../src/entities/core/registry';
import { runWithTokenContext } from '../../src/oauth/token-context';
import { resetHandlersState } from '../../src/handlers';

jest.mock('../../src/config', () => ({
  ...jest.requireActual('../../src/config'),
  GITLAB_SCHEMA_MODE: 'auto',
  GITLAB_READ_ONLY_MODE: false,
}));
jest.mock('../../src/oauth/index', () => ({
  ...jest.requireActual('../../src/oauth/token-context'),
  isOAuthEnabled: () => true,
  isAuthenticationConfigured: () => true,
}));
jest.mock('../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: () => ({
      getInstanceInfo: (url: string) =>
        url.includes('old.')
          ? { version: '16.0.0', tier: 'free' }
          : { version: '19.0.0', tier: 'ultimate' },
      getCurrentInstanceUrl: () => 'https://new.example.com',
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

describe('simultaneous MCP client contracts', () => {
  const clients: Client[] = [];
  let sessions: SessionManager;

  beforeEach(() => {
    resetHandlersState();
    RegistryManager.getInstance().refreshCache();
    sessions = new SessionManager();
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()));
    await sessions.shutdown();
    coreToolRegistry.delete('browse_contract');
    RegistryManager.getInstance().refreshCache();
  });

  async function connect(name: string, protocol: string): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const send = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message, options) => {
      if ('method' in message && message.method === 'initialize' && message.params) {
        message = { ...message, params: { ...message.params, protocolVersion: protocol } };
      }
      return send(message, options);
    };
    await sessions.createSession(name, serverTransport);
    const client = new Client({ name, version: '1.0.0' });
    clients.push(client);
    await client.connect(clientTransport);
    return client;
  }

  function asAccount<T>(scopes: string[], url: string, work: () => Promise<T>): Promise<T> {
    return Promise.resolve(
      runWithTokenContext(
        {
          gitlabToken: 'fixture-only',
          gitlabUserId: scopes.includes('api') ? 1 : 2,
          gitlabUsername: 'fixture',
          sessionId: 'fixture',
          gitlabScopes: scopes,
          apiUrl: url,
        },
        work,
      ),
    );
  }

  it.each([
    ['read_api', 'api'],
    ['api', 'read_api'],
  ])('keeps related hints scoped in order %s then %s', async (first, second) => {
    // A scoped description must not suggest forbidden tools or mutate another account's cached hints.
    const client = await connect('mcp-inspector', '2025-11-25');
    for (const scope of [first, second]) {
      const result = await asAccount([scope], 'https://new.example.com', () => client.listTools());
      const description = result.tools.find(
        (tool) => tool.name === 'browse_pipelines',
      )!.description!;
      expect(description.includes('manage_pipeline')).toBe(scope === 'api');
    }
    const shared = RegistryManager.getInstance().getAllToolDefinitions('https://new.example.com');
    expect(shared.find((tool) => tool.name === 'browse_pipelines')!.description).toContain(
      'manage_pipeline',
    );
  });

  it.each([
    { scopes: [], browse: false, manage: false },
    { scopes: ['read_user'], browse: false, manage: false },
    { scopes: ['read_api'], browse: true, manage: false },
    { scopes: ['api'], browse: true, manage: true },
  ])(
    'filters environment discovery and execution for $scopes',
    async ({ scopes, browse, manage }) => {
      // The real SDK catalog and dispatcher must enforce the same per-account grant.
      const client = await connect('mcp-inspector', '2025-11-25');
      const url = 'https://new.example.com';
      const catalog = await asAccount(scopes, url, () => client.listTools());
      const registry = RegistryManager.getInstance();
      for (const [name, allowed] of [
        ['browse_environments', browse],
        ['manage_environment', manage],
      ] as const) {
        expect(catalog.tools.some((tool) => tool.name === name)).toBe(allowed);
        expect(registry.getTool(name, url, scopes) !== null).toBe(allowed);
        const handler = jest
          .spyOn(registry.getTool(name, url)!, 'handler')
          .mockResolvedValue({ fixture: true });
        try {
          if (allowed)
            await expect(registry.executeTool(name, {}, url, scopes)).resolves.toEqual({
              fixture: true,
            });
          else
            await expect(registry.executeTool(name, {}, url, scopes)).rejects.toThrow('not found');
          expect(handler).toHaveBeenCalledTimes(allowed ? 1 : 0);
        } finally {
          handler.mockRestore();
        }
      }
    },
  );

  it.each([
    ['claude-code', 'mcp-inspector'],
    ['mcp-inspector', 'claude-code'],
  ])(
    'keeps schemas, versions and account grants isolated when %s initializes first',
    async (first, second) => {
      // Real SDK clients initialize in both orders against the production registry/handlers.
      const a = await connect(first, '2024-11-05');
      const b = await connect(second, '2025-11-25');
      const byName = new Map([
        [first, a],
        [second, b],
      ]);
      const claude = byName.get('claude-code')!;
      const inspector = byName.get('mcp-inspector')!;
      const list = (client: Client, grants: string[], url = 'https://new.example.com') =>
        asAccount(grants, url, () => client.listTools());
      const [flat, union] = await Promise.all([
        list(claude, ['read_api']),
        list(inspector, ['api']),
      ]);
      expect(
        flat.tools.find((tool) => tool.name === 'browse_projects')?.inputSchema.oneOf,
      ).toBeUndefined();
      expect(
        union.tools.find((tool) => tool.name === 'browse_projects')?.inputSchema.oneOf,
      ).toBeDefined();
      expect(flat.tools.some((tool) => tool.name === 'manage_project')).toBe(false);
      expect(union.tools.some((tool) => tool.name === 'manage_project')).toBe(true);
      // Diagnostics must count the same account-specific catalog the client sees.
      const stats = await asAccount(['read_api'], 'https://new.example.com', async () =>
        RegistryManager.getInstance().getFilterStats(),
      );
      expect(stats.available).toBe(flat.tools.length);
      expect(flat.tools.find((tool) => tool.name === 'manage_context')?.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      });
      const old = await list(inspector, ['api'], 'https://old.example.com');
      expect(old.tools.some((tool) => tool.name === 'manage_vulnerability')).toBe(false);
      expect(union.tools.some((tool) => tool.name === 'manage_vulnerability')).toBe(true);
      // Refreshing another instance cannot replace this client's cached projection.
      RegistryManager.getInstance().refreshCache('https://old.example.com');
      expect(await list(claude, ['read_api'])).toEqual(flat);
      const denied = await asAccount(['read_api'], 'https://new.example.com', () =>
        claude.callTool({
          name: 'manage_project',
          arguments: { action: 'delete', project_id: 'test/fixture' },
        }),
      );
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toHaveProperty('error');
      const shown = CallToolResultSchema.parse(
        await asAccount(['read_api'], 'https://new.example.com', () =>
          claude.callTool({ name: 'manage_context', arguments: { action: 'show' } }),
        ),
      );
      expect(shown.isError).toBeUndefined();
      expect(shown.structuredContent?.action).toBe('show');
      expect(shown.content).toEqual([
        { type: 'text', text: JSON.stringify(shown.structuredContent?.data, null, 2) },
      ]);
      // SDK clients validate present structuredContent even on isError envelopes.
      const invalid = await asAccount(['read_api'], 'https://new.example.com', () =>
        claude.callTool({ name: 'manage_context', arguments: { action: 'invalid' } }),
      );
      expect(invalid.isError).toBe(true);
      expect(invalid.structuredContent).toHaveProperty('error');
    },
  );

  it('carries full descriptors and native empty output through SDK discovery and execution', async () => {
    // Vendor UI/auth metadata and non-text content must survive every registry projection.
    const envelope = {
      content: [{ type: 'text' as const, text: 'No matches' }],
      structuredContent: { items: [] },
      _meta: { display: 'empty' },
    };
    const metadata = {
      ui: { resourceUri: 'ui://gitlab/settings.html' },
      securitySchemes: [{ type: 'oauth2', scopes: ['api'] }],
    };
    coreToolRegistry.set('browse_contract', {
      name: 'browse_contract',
      title: 'Fixture contract',
      description: 'Contract fixture',
      icons: [{ src: 'https://example.com/icon.svg', mimeType: 'image/svg+xml' }],
      _meta: metadata,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: true,
      },
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        properties: { items: { type: 'array', items: { type: 'integer' } } },
        required: ['items'],
      },
      resultFormat: 'mcp',
      handler: async () => envelope,
    });
    RegistryManager.getInstance().refreshCache();
    const client = await connect('codex', '2025-11-25');
    const catalog = await client.listTools();
    const tool = catalog.tools.find((item) => item.name === 'browse_contract');
    expect(tool?.title).toBe('Fixture contract');
    expect(tool?._meta).toEqual(metadata);
    expect(tool?.icons).toEqual([
      { src: 'https://example.com/icon.svg', mimeType: 'image/svg+xml' },
    ]);
    expect(tool).not.toHaveProperty('handler');
    expect(tool).not.toHaveProperty('resultFormat');
    expect(await client.callTool({ name: 'browse_contract' })).toEqual(envelope);
  });

  it('declares the OAuth scheme on every tool that does not declare its own', async () => {
    // Hosts decide from the descriptor that a call needs the linked account.
    const client = await connect('codex', '2025-11-25');
    const catalog = await asAccount(['api'], 'https://new.example.com', () => client.listTools());
    expect(catalog.tools.length).toBeGreaterThan(0);
    for (const tool of catalog.tools) {
      expect(tool._meta?.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['mcp:tools'] }]);
    }
  });

  it('publishes the account profile tool and returns a schema-valid profile', async () => {
    // The host reads the connection's account from the tool marked openai/profile.
    const profile = await import('../../src/entities/context/profile');
    const resolve = jest.spyOn(profile, 'getAccountProfile').mockResolvedValue({
      id: profile.accountProfileId('https://new.example.com', 1),
      name: 'Fixture User',
      nickname: 'fixture @ new.example.com',
    });
    try {
      const client = await connect('codex', '2025-11-25');
      const catalog = await asAccount(['read_api'], 'https://new.example.com', () =>
        client.listTools(),
      );
      const tool = catalog.tools.find((item) => item.name === 'get_profile');
      expect(tool?._meta?.['openai/profile']).toBe(true);
      expect(tool?.inputSchema).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
      expect(tool?.outputSchema?.required).toEqual(['id']);
      expect(tool?.outputSchema?.additionalProperties).toBe(false);
      expect(tool?.annotations?.readOnlyHint).toBe(true);

      const result = await asAccount(['read_api'], 'https://new.example.com', () =>
        client.callTool({ name: 'get_profile', arguments: {} }),
      );
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(await resolve.mock.results[0].value);
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify(result.structuredContent) },
      ]);
    } finally {
      resolve.mockRestore();
    }
  });

  it('asks the host to reconnect when GitLab rejects the account (401)', async () => {
    // The challenge reaches the client through production dispatch and the SDK.
    coreToolRegistry.set('browse_contract', {
      name: 'browse_contract',
      description: 'Rejected credentials fixture',
      inputSchema: { type: 'object' },
      handler: async () => {
        throw new Error('GitLab API error: 401 Unauthorized - invalid_token');
      },
    });
    RegistryManager.getInstance().refreshCache();
    const oauthConfig = await import('../../src/oauth/config');
    const config = jest
      .spyOn(oauthConfig, 'loadOAuthConfig')
      .mockReturnValue({ issuer: 'https://mcp.example.com' } as ReturnType<
        typeof oauthConfig.loadOAuthConfig
      >);
    try {
      const client = await connect('codex', '2025-11-25');
      const result = await asAccount(['api'], 'https://new.example.com', () =>
        client.callTool({ name: 'browse_contract', arguments: {} }),
      );
      expect(result.isError).toBe(true);
      const challenges = result._meta?.['mcp/www_authenticate'] as string[];
      expect(challenges[0]).toContain('error="invalid_token"');
      expect(challenges[0]).toContain('error_description=');
    } finally {
      config.mockRestore();
    }
  });

  it('delivers non-text content and authorization challenges through the SDK unchanged', async () => {
    // Exercise production dispatch, serialization and SDK validation rather than a result mock.
    const success = {
      content: [
        { type: 'image' as const, data: 'aW1hZ2U=', mimeType: 'image/png' },
        {
          type: 'resource_link' as const,
          uri: 'https://example.com/report',
          name: 'report',
          mimeType: 'text/plain',
        },
      ],
      structuredContent: { items: [] },
      _meta: { ui: { resourceUri: 'ui://gitlab/settings.html' } },
    };
    const challenge = {
      content: [{ type: 'text' as const, text: 'Connect your account' }],
      isError: true,
      _meta: {
        'mcp/www_authenticate': [
          'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
        ],
      },
    };
    const handler = jest.fn().mockResolvedValueOnce(success).mockResolvedValueOnce(challenge);
    coreToolRegistry.set('browse_contract', {
      name: 'browse_contract',
      description: 'Native content fixture',
      inputSchema: { type: 'object' },
      outputSchema: {
        type: 'object',
        properties: { items: { type: 'array', items: { type: 'integer' } } },
        required: ['items'],
      },
      resultFormat: 'mcp',
      handler,
    });
    RegistryManager.getInstance().refreshCache();
    const client = await connect('codex', '2025-11-25');
    await client.listTools();
    expect(await client.callTool({ name: 'browse_contract' })).toEqual(success);
    expect(await client.callTool({ name: 'browse_contract' })).toEqual(challenge);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
