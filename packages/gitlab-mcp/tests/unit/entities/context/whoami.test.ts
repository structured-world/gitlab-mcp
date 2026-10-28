/**
 * Unit tests for whoami handler
 *
 * Tests token introspection and capability discovery functionality.
 */

import { handleManageContext } from '../../../../src/entities/context/handlers';
import { ContextManager } from '../../../../src/entities/context/context-manager';
import { WhoamiResult } from '../../../../src/entities/context/types';
import { runWithTokenContext } from '../../../../src/oauth/token-context';
import { ContextOutputSchema } from '../../../../src/entities/context/output-schema';
import { GitLabTimeoutError } from '../../../../src/utils/fetch';
import { contextToolRegistry } from '../../../../src/entities/context/registry';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Create mock objects that will be populated in tests
const mockConnectionManager = {
  getTokenScopeInfo: jest.fn(),
  getInstanceInfo: jest.fn(),
  getAdminInfo: jest.fn(),
  refreshTokenScopes: jest.fn(),
};

const mockRegistryManager = {
  getFilterStats: jest.fn(),
  refreshCache: jest.fn(),
};

const mockEnhancedFetch = jest.fn();
const mockSendToolsListChangedNotification = jest.fn();

// Mock dependencies
jest.mock('../../../../src/utils/namespace', () => ({
  detectNamespaceType: jest.fn().mockResolvedValue('group'),
}));

jest.mock('../../../../src/profiles/loader', () => ({
  ProfileLoader: jest.fn().mockImplementation(() => ({
    listProfiles: jest.fn().mockResolvedValue([]),
    loadPreset: jest.fn().mockResolvedValue({
      description: 'Test preset',
      read_only: false,
    }),
    loadProfile: jest.fn().mockResolvedValue({}),
  })),
}));

jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: jest.fn(() => mockConnectionManager),
  },
}));

jest.mock('../../../../src/registry-manager', () => ({
  RegistryManager: {
    getInstance: jest.fn(() => mockRegistryManager),
  },
}));

jest.mock('../../../../src/utils/fetch', () => ({
  ...jest.requireActual('../../../../src/utils/fetch'),
  enhancedFetch: (...args: unknown[]) => mockEnhancedFetch(...args),
}));

jest.mock('../../../../src/server', () => ({
  sendToolsListChangedNotification: () => mockSendToolsListChangedNotification(),
}));

// Mock isOAuthEnabled to check process.env at runtime
jest.mock('../../../../src/oauth/index.js', () => ({
  ...jest.requireActual('../../../../src/oauth/index.js'),
  isOAuthEnabled: () => process.env.OAUTH_ENABLED === 'true',
}));

describe('whoami handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    ContextManager.resetInstance();
    jest.clearAllMocks();

    process.env = {
      ...originalEnv,
      GITLAB_API_URL: 'https://gitlab.example.com',
      GITLAB_READ_ONLY_MODE: 'false',
      OAUTH_ENABLED: 'false',
    };

    // Default mock responses
    mockRegistryManager.getFilterStats.mockReturnValue({
      available: 45,
      total: 45,
      filteredByScopes: 0,
      filteredByReadOnly: 0,
      filteredByTier: 0,
      filteredByDeniedRegex: 0,
      filteredByActionDenial: 0,
      filteredByAdmin: 0,
    });

    mockConnectionManager.getTokenScopeInfo.mockReturnValue({
      name: 'gitlab-mcp',
      scopes: ['api', 'read_user'],
      expiresAt: '2025-12-31',
      active: true,
      tokenType: 'unknown',
      hasGraphQLAccess: true,
      hasWriteAccess: true,
      daysUntilExpiry: 340,
    });

    mockConnectionManager.getInstanceInfo.mockReturnValue({
      version: '17.5.2',
      tier: 'ultimate',
      features: {},
      detectedAt: new Date(),
    });

    mockEnhancedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 123,
        username: 'developer',
        name: 'John Developer',
        email: 'dev@example.com',
        avatar_url: 'https://gitlab.example.com/avatar.png',
        is_admin: false,
        state: 'active',
      }),
    });

    // Default: no scope changes
    mockConnectionManager.refreshTokenScopes.mockResolvedValue(false);
    // Default: admin status unprobed (OAuth/static both tolerate null)
    mockConnectionManager.getAdminInfo.mockReturnValue(null);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('action: whoami', () => {
    it('should return complete WhoamiResult structure', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      // Check top-level structure
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('server');
      expect(result).toHaveProperty('capabilities');
      expect(result).toHaveProperty('context');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('recommendations');
      expect(result).toHaveProperty('scopesRefreshed');

      // Check arrays
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Array.isArray(result.recommendations)).toBe(true);
      expect(typeof result.scopesRefreshed).toBe('boolean');
    });

    it('should return user info when API call succeeds', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.user).not.toBeNull();
      expect(result.user?.id).toBe(123);
      expect(result.user?.username).toBe('developer');
      expect(result.user?.name).toBe('John Developer');
      expect(result.user?.state).toBe('active');
    });

    it('should return null user when API call fails', async () => {
      mockEnhancedFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.user).toBeNull();
      expect(result.userLookup).toBe('rejected');
    });

    // Only 401 and 403 mean GitLab refused the credentials; a server error says nothing
    // about them.
    it.each([
      [403, 'rejected'],
      [500, 'failed'],
      [503, 'failed'],
    ])('classifies a %s answer to the user lookup as %s', async (status, lookup) => {
      mockEnhancedFetch.mockResolvedValue({ ok: false, status });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.user).toBeNull();
      expect(result.userLookup).toBe(lookup);
    });

    it('should return token info from ConnectionManager', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.token).not.toBeNull();
      expect(result.token?.name).toBe('gitlab-mcp');
      expect(result.token?.scopes).toContain('api');
      expect(result.token?.hasWriteAccess).toBe(true);
      expect(result.token?.hasGraphQLAccess).toBe(true);
    });

    // Connection diagnostics must survive Undici's wrapper without copying secrets from errors.
    it.each([
      ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls'],
      ['UNABLE_TO_GET_ISSUER_CERT', 'tls'],
      ['UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'tls'],
      ['SELF_SIGNED_CERT_IN_CHAIN', 'tls'],
      ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
      ['CERT_HAS_EXPIRED', 'tls'],
      ['CERT_NOT_YET_VALID', 'tls'],
      ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
      ['ENOTFOUND', 'dns'],
      ['EAI_AGAIN', 'dns'],
      ['ETIMEDOUT', 'timeout'],
      ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
      ['UND_ERR_HEADERS_TIMEOUT', 'timeout'],
      ['UND_ERR_BODY_TIMEOUT', 'timeout'],
      ['ECONNREFUSED', 'network'],
      ['ECONNRESET', 'network'],
      ['ECONNABORTED', 'network'],
      ['ENETUNREACH', 'network'],
      ['EHOSTUNREACH', 'network'],
      ['EPIPE', 'network'],
      ['UND_ERR_SOCKET', 'network'],
    ])('reports %s as %s', async (code, kind) => {
      const cause = Object.assign(new Error('Authorization: Bearer synthetic-secret'), { code });
      mockEnhancedFetch.mockRejectedValue(new TypeError('fetch failed', { cause }));

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;
      const diagnostic = (result as unknown as Record<string, unknown>).userLookupError;

      expect(result.user).toBeNull();
      expect(result.userLookup).toBe('failed');
      expect(diagnostic).toMatchObject({ kind, code, message: expect.any(String) });
      const parsed = ContextOutputSchema.parse({ action: 'whoami', data: result });
      expect(parsed).toMatchObject({ data: { userLookupError: diagnostic } });
      expect(JSON.stringify(result)).not.toContain('synthetic-secret');
      if (kind === 'tls') {
        expect(diagnostic).toHaveProperty('hint', expect.stringContaining('GITLAB_CA_CERT_PATH'));
        expect(diagnostic).toHaveProperty('hint', expect.stringContaining('NODE_EXTRA_CA_CERTS'));
      }
    });

    // The shared transport wraps native timeouts in a typed error without its own code.
    it.each(['connect', 'headers', 'body'] as const)(
      'reports a wrapped %s timeout',
      async (phase) => {
        mockEnhancedFetch.mockRejectedValue(new GitLabTimeoutError(phase, 100));
        const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;
        expect(result).toMatchObject({ userLookupError: { kind: 'timeout' } });
      },
    );

    // Transport codes can be direct too; a wrapper's unknown code must not hide its cause.
    it.each([{ code: 'ENOTFOUND' }, { code: 'UNKNOWN', cause: { code: 'ENOTFOUND' } }])(
      'recognizes a direct or wrapped DNS code (%j)',
      async (error) => {
        mockEnhancedFetch.mockRejectedValue(error);
        const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;
        expect(result.userLookupError).toMatchObject({ kind: 'dns', code: 'ENOTFOUND' });
      },
    );

    // A TimeoutError signal has no transport code, while caller cancellation is not a timeout.
    it.each([
      [Object.assign(new Error('synthetic-secret'), { name: 'TimeoutError' }), 'timeout'],
      [new TypeError('fetch failed', { cause: new GitLabTimeoutError('connect', 100) }), 'timeout'],
      [Object.assign(new Error('synthetic-secret'), { name: 'AbortError' }), 'network'],
    ] as const)('classifies signals without leaking their text (%s)', async (error, kind) => {
      mockEnhancedFetch.mockRejectedValue(error);
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;
      expect(result.userLookupError).toMatchObject({ kind });
      expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    });

    // HTTP diagnostics must not read an arbitrary provider/proxy response body or status text.
    it.each([401, 403, 429, 500, 503])(
      'reports HTTP %s without response content',
      async (status) => {
        const json = jest.fn();
        mockEnhancedFetch.mockResolvedValue({
          ok: false,
          status,
          statusText: 'synthetic-secret',
          json,
        });
        const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;
        expect(result).toMatchObject({
          userLookupError: {
            kind: 'http',
            status,
            message: expect.stringContaining(String(status)),
          },
        });
        expect(json).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain('synthetic-secret');
      },
    );

    // Parser errors may quote response data; they must retain status, not provider content.
    it('reports an unreadable HTTP response safely', async () => {
      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('synthetic-secret');
        },
      });
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;
      expect(result).toMatchObject({ userLookupError: { kind: 'http', status: 200 } });
      expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    });

    // Neither unknown codes nor arbitrary thrown values belong in public diagnostics.
    it.each([
      Object.assign(new Error('synthetic-secret'), { code: 'synthetic-secret' }),
      { code: 123, message: 'synthetic-secret' },
      { code: 'CERT_HAS_EXPIRED synthetic-secret' },
      'synthetic-secret',
      null,
    ])('keeps unknown failures private (%s)', async (error) => {
      mockEnhancedFetch.mockRejectedValue(error);
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;
      expect(result).toMatchObject({
        userLookupError: { kind: 'network', message: expect.any(String) },
      });
      expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    });

    // Success keeps the released response shape and does not suggest connection repairs.
    it('omits lookup diagnostics after success', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;
      expect(result).not.toHaveProperty('userLookupError');
      expect(result.userLookup).toBe('ok');
    });

    // A real HTTP response must reach both MCP representations with matching, schema-valid diagnostics.
    it.each([401, 503])('exposes HTTP %s through the registered MCP tool', async (status) => {
      const requests: string[] = [];
      const server = createServer((request, response) => {
        requests.push(request.url!);
        response.writeHead(status, { 'content-type': 'text/plain', connection: 'close' });
        response.end('synthetic-secret');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const { port } = server.address() as AddressInfo;
        mockEnhancedFetch.mockImplementationOnce((url: string) => {
          const target = new URL(url);
          return fetch(`http://127.0.0.1:${port}${target.pathname}`);
        });
        const result = (await contextToolRegistry.get('manage_context')!.handler({
          action: 'whoami',
        })) as CallToolResult;
        const content = result.content[0];
        expect(content.type).toBe('text');
        if (content.type !== 'text') throw new Error('Expected the documented text payload');
        const data = JSON.parse(content.text) as WhoamiResult;
        expect(data).toMatchObject({ userLookupError: { kind: 'http', status } });
        expect(result.structuredContent).toEqual({ action: 'whoami', data });
        expect(ContextOutputSchema.parse(result.structuredContent)).toEqual(
          result.structuredContent,
        );
        expect(data.warnings).toContain(data.userLookupError!.message);
        expect(JSON.stringify(result)).not.toContain('synthetic-secret');
        expect(requests).toEqual(['/api/v4/user']);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });

    it('should return server info', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.server).toBeDefined();
      expect(result.server.version).toBe('17.5.2');
      expect(result.server.tier).toBe('ultimate');
      expect(result.server.readOnlyMode).toBe(false);
      expect(result.server.oauthEnabled).toBe(false);
    });

    it('should return capabilities with full access', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.capabilities.canBrowse).toBe(true);
      expect(result.capabilities.canManage).toBe(true);
      expect(result.capabilities.canAccessGraphQL).toBe(true);
      expect(result.capabilities.availableToolCount).toBe(45);
      expect(result.capabilities.totalToolCount).toBe(45);
    });

    it('should return context info', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.context).toBeDefined();
      expect(result.context).toEqual({ activePreset: null, scope: null });
    });

    it('should generate no warnings with full access', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.warnings).toHaveLength(0);
    });

    it('should generate no recommendations with full access', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.recommendations).toHaveLength(0);
    });

    it('should return scopesRefreshed=false when no scope changes', async () => {
      mockConnectionManager.refreshTokenScopes.mockResolvedValue(false);

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.scopesRefreshed).toBe(false);
      expect(mockRegistryManager.refreshCache).not.toHaveBeenCalled();
      expect(mockSendToolsListChangedNotification).not.toHaveBeenCalled();
    });

    it('should return scopesRefreshed=true and refresh registry when scopes change', async () => {
      mockConnectionManager.refreshTokenScopes.mockResolvedValue(true);

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.scopesRefreshed).toBe(true);
      expect(mockRegistryManager.refreshCache).toHaveBeenCalled();
      expect(mockSendToolsListChangedNotification).toHaveBeenCalled();
    });

    it('should handle refreshTokenScopes errors gracefully', async () => {
      mockConnectionManager.refreshTokenScopes.mockRejectedValue(new Error('Refresh failed'));

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      // Should still return valid result even if refresh fails
      expect(result.scopesRefreshed).toBe(false);
      expect(result.server).toBeDefined();
      expect(result.capabilities).toBeDefined();
    });
  });

  describe('whoami with limited token', () => {
    beforeEach(() => {
      // Limited token with only read_user scope
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: 'limited-token',
        scopes: ['read_user'],
        expiresAt: '2025-06-15',
        active: true,
        tokenType: 'unknown',
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: 142,
      });

      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 3,
        total: 45,
        filteredByScopes: 42,
        filteredByReadOnly: 0,
        filteredByTier: 0,
        filteredByDeniedRegex: 0,
        filteredByActionDenial: 0,
      });
    });

    it('should show limited capabilities', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.capabilities.canBrowse).toBe(true);
      expect(result.capabilities.canManage).toBe(false);
      expect(result.capabilities.canAccessGraphQL).toBe(false);
      expect(result.capabilities.availableToolCount).toBe(3);
      expect(result.capabilities.filteredByScopes).toBe(42);
    });

    it('should generate warnings for limited scopes', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('Limited token scopes'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('No GraphQL access'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('No write access'))).toBe(true);
    });

    it('should recommend creating new token', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      const tokenRec = result.recommendations.find((r) => r.action === 'create_new_token');
      expect(tokenRec).toBeDefined();
      expect(tokenRec?.priority).toBe('high');
      expect(tokenRec?.url).toContain('personal_access_tokens');
    });
  });

  describe('whoami with expired token', () => {
    beforeEach(() => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: 'expired-token',
        scopes: ['api'],
        expiresAt: '2024-01-01',
        active: false,
        tokenType: 'unknown',
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: -390,
      });

      // User fetch fails with expired token
      mockEnhancedFetch.mockResolvedValue({
        ok: false,
        status: 401,
      });
    });

    it('should show token as invalid', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.token?.isValid).toBe(false);
      expect(result.token?.daysUntilExpiry).toBe(-390);
    });

    it('should generate expired token warning', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.warnings.some((w) => w.includes('expired'))).toBe(true);
    });

    it('should recommend token renewal', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      const renewRec = result.recommendations.find((r) => r.action === 'renew_token');
      expect(renewRec).toBeDefined();
      expect(renewRec?.priority).toBe('high');
    });
  });

  describe('whoami with expiring soon token', () => {
    beforeEach(() => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: 'expiring-token',
        scopes: ['api'],
        expiresAt: '2025-01-30',
        active: true,
        tokenType: 'unknown',
        hasGraphQLAccess: true,
        hasWriteAccess: true,
        daysUntilExpiry: 5,
      });
    });

    it('should generate expiring soon warning', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.warnings.some((w) => w.includes('expires in 5 day'))).toBe(true);
    });

    it('should recommend renewal with medium priority', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      const renewRec = result.recommendations.find((r) => r.action === 'renew_token');
      expect(renewRec).toBeDefined();
      expect(renewRec?.priority).toBe('medium');
    });
  });

  describe('whoami in OAuth mode', () => {
    beforeEach(() => {
      process.env.OAUTH_ENABLED = 'true';
      ContextManager.resetInstance();

      // In OAuth mode, token scope detection returns null
      mockConnectionManager.getTokenScopeInfo.mockReturnValue(null);
    });

    it.each([
      { scopes: ['read_repository'], browse: true, manage: false },
      { scopes: ['read_registry'], browse: true, manage: false },
      { scopes: ['write_repository'], browse: false, manage: true },
      { scopes: ['write_registry'], browse: false, manage: true },
      { scopes: ['create_runner'], browse: false, manage: true },
      { scopes: ['manage_runner'], browse: false, manage: true },
    ])('reflects specialized tool grants: $scopes', async ({ scopes, browse, manage }) => {
      // Capability flags must use the same requirements as tool discovery, including specialized grants.
      const result = await runWithTokenContext(
        {
          gitlabToken: 'fixture-only',
          gitlabUserId: 2,
          gitlabUsername: 'reader',
          sessionId: 'reader',
          apiUrl: 'https://gitlab.example.com',
          gitlabScopes: scopes,
        },
        async () => (await handleManageContext({ action: 'whoami' })) as WhoamiResult,
      );
      expect(result.capabilities.canBrowse).toBe(browse);
      expect(result.capabilities.canManage).toBe(manage);
      expect(result.capabilities.canAccessGraphQL).toBe(false);
    });

    it('reports no browse access for an explicit empty OAuth grant', async () => {
      // Empty grants are known denials, not the permissive unknown-grant case.
      const result = await runWithTokenContext(
        {
          gitlabToken: 'fixture-only',
          gitlabUserId: 2,
          gitlabUsername: 'reader',
          sessionId: 'reader',
          apiUrl: 'https://gitlab.example.com',
          gitlabScopes: [],
        },
        async () => (await handleManageContext({ action: 'whoami' })) as WhoamiResult,
      );
      expect(result.token?.scopes).toEqual([]);
      expect(result.capabilities.canBrowse).toBe(false);
      expect(result.capabilities.canManage).toBe(false);
      expect(result.capabilities.canAccessGraphQL).toBe(false);
    });

    it('reports the selected OAuth grant instead of assuming full API access', async () => {
      // A shared host must not report the default account's host or permissions.
      const result = await runWithTokenContext(
        {
          gitlabToken: 'fixture-only',
          gitlabUserId: 2,
          gitlabUsername: 'reader',
          sessionId: 'reader',
          apiUrl: 'https://selected.example.com',
          gitlabScopes: ['read_api'],
        },
        async () => (await handleManageContext({ action: 'whoami' })) as WhoamiResult,
      );
      expect(result.token?.scopes).toEqual(['read_api']);
      expect(result.token?.hasWriteAccess).toBe(false);
      expect(result.server.apiUrl).toBe('https://selected.example.com');
      expect(mockEnhancedFetch).toHaveBeenCalledWith('https://selected.example.com/api/v4/user', {
        retry: false,
      });
    });

    it('should return oauth token type', async () => {
      // An OAuth identity is reported only from an actual request grant.
      const result = await runWithTokenContext(
        {
          gitlabToken: 'fixture-only',
          gitlabUserId: 2,
          gitlabUsername: 'reader',
          sessionId: 'reader',
          apiUrl: 'https://gitlab.example.com',
          gitlabScopes: ['api'],
        },
        async () => (await handleManageContext({ action: 'whoami' })) as WhoamiResult,
      );

      expect(result.token?.type).toBe('oauth');
      expect(result.server.oauthEnabled).toBe(true);
    });

    it('keeps unknown OAuth permissions unknown', async () => {
      // A token not reporting scope must not be advertised as full write access.
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;
      expect(result.token).toBeNull();
      expect(result.capabilities.canManage).toBe(false);
    });
  });

  describe('whoami with read-only filtering', () => {
    // Note: We can't easily test server.readOnlyMode because GITLAB_READ_ONLY_MODE
    // is evaluated at import time. Instead, we test the warning generation
    // based on filter stats which works regardless of config timing.
    beforeEach(() => {
      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 20,
        total: 45,
        filteredByScopes: 0,
        filteredByReadOnly: 25,
        filteredByTier: 0,
        filteredByDeniedRegex: 0,
        filteredByActionDenial: 0,
      });
    });

    it('should show filtered tools count in capabilities', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.capabilities.filteredByReadOnly).toBe(25);
      expect(result.capabilities.availableToolCount).toBe(20);
    });

    it('should generate read-only warning when tools are filtered', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.warnings.some((w) => w.includes('Read-only mode'))).toBe(true);
    });
  });

  describe('whoami edge cases', () => {
    it('should handle network errors when fetching user info', async () => {
      // Mock enhancedFetch to throw network error
      mockEnhancedFetch.mockRejectedValue(new Error('Network error'));

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      // User should be null when network error occurs, and the lookup failed rather than
      // the credentials being refused
      expect(result.user).toBeNull();
      expect(result.userLookup).toBe('failed');
      // Other fields should still be populated
      expect(result.server).toBeDefined();
      expect(result.capabilities).toBeDefined();
    });

    it('should handle ConnectionManager not initialized', async () => {
      // Make ConnectionManager throw for both methods
      mockConnectionManager.getTokenScopeInfo.mockImplementation(() => {
        throw new Error('Connection not initialized');
      });
      mockConnectionManager.getInstanceInfo.mockImplementation(() => {
        throw new Error('Connection not initialized');
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      // Should return defaults when connection not initialized
      expect(result.token).toBeNull();
      expect(result.server.version).toBe('unknown');
      expect(result.server.tier).toBe('unknown');
    });

    it('should handle token with no scopes (empty array)', async () => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: 'no-scope-token',
        scopes: [],
        expiresAt: null,
        active: true,
        tokenType: 'unknown',
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: null,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.token?.scopes).toHaveLength(0);
      // A detected empty PAT grant, like an empty OAuth grant, has no browse access.
      expect(result.capabilities.canBrowse).toBe(false);
    });

    it('should handle token expiring today', async () => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: 'today-token',
        scopes: ['api'],
        expiresAt: new Date().toISOString().split('T')[0],
        active: true,
        tokenType: 'unknown',
        hasGraphQLAccess: true,
        hasWriteAccess: true,
        daysUntilExpiry: 0,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.warnings.some((w) => w.includes('expires today'))).toBe(true);
    });

    it('should handle token with null expiry (never expires)', async () => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: 'permanent-token',
        scopes: ['api'],
        expiresAt: null,
        active: true,
        tokenType: 'unknown',
        hasGraphQLAccess: true,
        hasWriteAccess: true,
        daysUntilExpiry: null,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.token?.daysUntilExpiry).toBeNull();
      // Should not generate expiry warnings
      expect(result.warnings.filter((w) => w.includes('expire')).length).toBe(0);
    });

    it('should handle invalid/revoked token', async () => {
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: 'revoked-token',
        scopes: ['api'],
        expiresAt: '2025-12-31',
        active: false,
        tokenType: 'unknown',
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: 340,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.token?.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes('invalid or revoked'))).toBe(true);
    });

    it('should recommend creating new token when no write access', async () => {
      // When token lacks write access AND scopes are filtered,
      // create_new_token is recommended (covers both write and GraphQL)
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: 'read-only-token',
        scopes: ['read_user'],
        expiresAt: '2025-12-31',
        active: true,
        tokenType: 'unknown',
        hasGraphQLAccess: false,
        hasWriteAccess: false,
        daysUntilExpiry: 340,
      });

      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 5,
        total: 45,
        filteredByScopes: 40,
        filteredByReadOnly: 0,
        filteredByTier: 0,
        filteredByDeniedRegex: 0,
        filteredByActionDenial: 0,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      // Should recommend create_new_token, NOT add_scope (avoid duplicate recommendations)
      const createTokenRec = result.recommendations.find((r) => r.action === 'create_new_token');
      expect(createTokenRec).toBeDefined();
      expect(createTokenRec?.message).toContain('api');

      // add_scope should NOT be present (create_new_token covers it)
      const addScopeRec = result.recommendations.find((r) => r.action === 'add_scope');
      expect(addScopeRec).toBeUndefined();
    });

    it('should recommend adding scope when has write but no GraphQL access', async () => {
      // Edge case: token has write access but somehow lacks GraphQL access
      // (rare, but possible with custom token scopes)
      mockConnectionManager.getTokenScopeInfo.mockReturnValue({
        name: 'write-only-token',
        scopes: ['write_repository'],
        expiresAt: '2025-12-31',
        active: true,
        tokenType: 'unknown',
        hasGraphQLAccess: false,
        hasWriteAccess: true, // Has write but no GraphQL
        daysUntilExpiry: 340,
      });

      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 10,
        total: 45,
        filteredByScopes: 35, // write_repository without api filters most tools
        filteredByReadOnly: 0,
        filteredByTier: 0,
        filteredByDeniedRegex: 0,
        filteredByActionDenial: 0,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      // Should recommend add_scope since we have write but need GraphQL
      const addScopeRec = result.recommendations.find((r) => r.action === 'add_scope');
      expect(addScopeRec).toBeDefined();
      expect(addScopeRec?.message).toContain('api');
    });
  });

  describe('whoami with tier restrictions', () => {
    beforeEach(() => {
      mockConnectionManager.getInstanceInfo.mockReturnValue({
        version: '17.5.2',
        tier: 'free',
        features: {},
        detectedAt: new Date(),
      });

      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 30,
        total: 45,
        filteredByScopes: 0,
        filteredByReadOnly: 0,
        filteredByTier: 15,
        filteredByDeniedRegex: 0,
      });
    });

    it('should show tier restrictions', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.server.tier).toBe('free');
      expect(result.capabilities.filteredByTier).toBe(15);
    });

    it('should generate tier warning', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.warnings.some((w) => w.includes('GitLab tier restrictions'))).toBe(true);
    });

    it('should recommend contacting admin', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      const adminRec = result.recommendations.find((r) => r.action === 'contact_admin');
      expect(adminRec).toBeDefined();
      expect(adminRec?.priority).toBe('low');
    });
  });

  describe('whoami with admin-filtered tools', () => {
    beforeEach(() => {
      mockConnectionManager.getInstanceInfo.mockReturnValue({
        version: '17.5.2',
        tier: 'free',
        features: {},
        detectedAt: new Date(),
      });

      mockRegistryManager.getFilterStats.mockReturnValue({
        available: 40,
        total: 45,
        filteredByScopes: 0,
        filteredByReadOnly: 0,
        filteredByTier: 0,
        filteredByDeniedRegex: 0,
        filteredByActionDenial: 0,
        filteredByAdmin: 5,
      });
    });

    it('exposes the admin-filter count in capabilities', async () => {
      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.capabilities.filteredByAdmin).toBe(5);
      // Admin denials must NOT inflate the tier counter (the bug this guards against).
      expect(result.capabilities.filteredByTier).toBe(0);
    });

    it('warns an admin without elevation and recommends enabling admin mode', async () => {
      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 1,
          username: 'root',
          name: 'Admin',
          is_admin: true,
          state: 'active',
        }),
      });
      mockConnectionManager.getAdminInfo.mockReturnValue({ isAdmin: true, adminModeActive: false });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.warnings.some((w) => w.includes('Admin-mode elevation inactive'))).toBe(true);
      // Admin denials must not be reported as a tier restriction.
      expect(result.warnings.some((w) => w.includes('GitLab tier restrictions'))).toBe(false);
      const adminRec = result.recommendations.find((r) => r.action === 'enable_admin_mode');
      expect(adminRec).toBeDefined();
      expect(adminRec?.priority).toBe('medium');
      expect(result.recommendations.find((r) => r.action === 'contact_admin')).toBeUndefined();
    });

    it('tells a non-admin the tools need an admin account, with no enable-admin-mode action', async () => {
      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 2,
          username: 'dev',
          name: 'Dev',
          is_admin: false,
          state: 'active',
        }),
      });
      mockConnectionManager.getAdminInfo.mockReturnValue({
        isAdmin: false,
        adminModeActive: false,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.warnings.some((w) => w.includes('Administrator privileges required'))).toBe(
        true,
      );
      // A non-admin cannot elevate, so the wording must not imply they can.
      expect(result.warnings.some((w) => w.includes('Admin-mode elevation inactive'))).toBe(false);
      expect(result.recommendations.find((r) => r.action === 'enable_admin_mode')).toBeUndefined();
    });

    it('uses the admin probe role when /user omits is_admin', async () => {
      // /user response without is_admin -> userInfo.isAdmin is undefined. The
      // authoritative role comes from the admin probe (getAdminInfo), which says
      // non-admin: the guidance must follow it, not treat undefined as maybe-admin.
      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 3, username: 'svc', name: 'Service', state: 'active' }),
      });
      mockConnectionManager.getAdminInfo.mockReturnValue({
        isAdmin: false,
        adminModeActive: false,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.warnings.some((w) => w.includes('Administrator privileges required'))).toBe(
        true,
      );
      expect(result.recommendations.find((r) => r.action === 'enable_admin_mode')).toBeUndefined();
    });
  });

  describe('whoami admin-mode elevation', () => {
    beforeEach(() => {
      mockEnhancedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 1,
          username: 'root',
          name: 'Admin',
          is_admin: true,
          state: 'active',
        }),
      });
    });

    it('warns when admin role lacks active elevation', async () => {
      mockConnectionManager.getAdminInfo.mockReturnValue({
        isAdmin: true,
        adminModeActive: false,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.user?.adminModeActive).toBe(false);
      expect(result.warnings.some((w) => w.includes('admin mode is not active'))).toBe(true);
    });

    it('does not warn when admin mode is active', async () => {
      mockConnectionManager.getAdminInfo.mockReturnValue({
        isAdmin: true,
        adminModeActive: true,
      });

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.user?.adminModeActive).toBe(true);
      expect(result.warnings.some((w) => w.includes('admin mode is not active'))).toBe(false);
    });

    it('leaves adminModeActive undefined when unprobed (OAuth)', async () => {
      mockConnectionManager.getAdminInfo.mockReturnValue(null);

      const result = (await handleManageContext({ action: 'whoami' })) as WhoamiResult;

      expect(result.user?.adminModeActive).toBeUndefined();
    });
  });
});
