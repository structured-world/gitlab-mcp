/**
 * Unit tests for OAuth token endpoint
 * Tests the /token endpoint for authorization_code and refresh_token grants
 */

import { Request, Response } from 'express';
import { tokenHandler } from '../../../../src/oauth/endpoints/token';

// Mock dependencies
jest.mock('../../../../src/oauth/config', () => ({
  loadOAuthConfig: jest.fn(),
}));

jest.mock('../../../../src/oauth/session-store', () => ({
  sessionStore: {
    getAuthCode: jest.fn(),
    deleteAuthCode: jest.fn(),
    getSession: jest.fn(),
    updateSession: jest.fn(),
    getSessionByRefreshToken: jest.fn(),
  },
}));

jest.mock('../../../../src/oauth/token-utils', () => ({
  verifyCodeChallenge: jest.fn(),
  createJWT: jest.fn(() => 'mcp-access-token-jwt'),
  generateRefreshToken: jest.fn(() => 'mcp-refresh-token-abc'),
  calculateTokenExpiry: jest.fn((seconds: number) => Date.now() + seconds * 1000),
  isTokenExpiringSoon: jest.fn(),
  generateUUID: jest.fn(() => 'token-jti'),
}));

jest.mock('../../../../src/oauth/gitlab-device-flow', () => ({
  refreshGitLabToken: jest.fn(),
}));

jest.mock('../../../../src/oauth/endpoints/metadata', () => ({
  getBaseUrl: jest.fn(() => 'http://localhost:3333'),
}));

jest.mock('../../../../src/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
  // Real implementation - pure function with no side effects
  truncateId: (id: string) => (id.length <= 10 ? id : id.substring(0, 4) + '..' + id.slice(-4)),
}));

import { loadOAuthConfig } from '../../../../src/oauth/config';
import { sessionStore } from '../../../../src/oauth/session-store';
import {
  verifyCodeChallenge,
  isTokenExpiringSoon,
  createJWT,
} from '../../../../src/oauth/token-utils';
import { refreshGitLabToken } from '../../../../src/oauth/gitlab-device-flow';

const mockLoadOAuthConfig = loadOAuthConfig as jest.MockedFunction<typeof loadOAuthConfig>;
const mockSessionStore = sessionStore as jest.Mocked<typeof sessionStore>;
const mockVerifyCodeChallenge = verifyCodeChallenge as jest.MockedFunction<
  typeof verifyCodeChallenge
>;
const mockIsTokenExpiringSoon = isTokenExpiringSoon as jest.MockedFunction<
  typeof isTokenExpiringSoon
>;
const mockRefreshGitLabToken = refreshGitLabToken as jest.MockedFunction<typeof refreshGitLabToken>;

describe('OAuth Token Endpoint', () => {
  const mockConfig = {
    enabled: true as const,
    issuer: 'https://gitlab-mcp.example.com',
    sessionSecret: 'a'.repeat(32),
    gitlabClientId: 'test-client-id',
    gitlabScopes: 'api,read_user',
    tokenTtl: 3600,
    refreshTokenTtl: 604800,
    devicePollInterval: 5,
    deviceTimeout: 300,
  };

  // Helper to create mock request
  const createMockRequest = (body: Record<string, string | undefined> = {}): Partial<Request> => ({
    body,
    protocol: 'http',
    get: jest.fn((header: string): string | undefined => {
      if (header === 'host') return 'localhost:3333';
      return undefined;
    }) as Request['get'],
  });

  // Helper to create mock response
  const createMockResponse = (): Partial<Response> => {
    const res: Partial<Response> = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadOAuthConfig.mockReturnValue(mockConfig);
    // The caller that removes the code is the one that redeems it.
    mockSessionStore.deleteAuthCode.mockReturnValue(true);
  });

  describe('tokenHandler - General', () => {
    it('should return 500 when OAuth is not configured', async () => {
      mockLoadOAuthConfig.mockReturnValue(null);

      const req = createMockRequest({ grant_type: 'authorization_code' }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'OAuth not configured',
      });
    });

    it('should return error for unsupported grant type', async () => {
      const req = createMockRequest({ grant_type: 'client_credentials' }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unsupported_grant_type',
        error_description: 'Grant type "client_credentials" is not supported',
      });
    });

    it('should return error for missing grant type', async () => {
      const req = createMockRequest({}) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unsupported_grant_type',
        error_description: 'Grant type "undefined" is not supported',
      });
    });
  });

  describe('tokenHandler - Authorization Code Grant', () => {
    it('should return error when code is missing', async () => {
      const req = createMockRequest({
        grant_type: 'authorization_code',
        code_verifier: 'verifier',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing authorization code',
      });
    });

    it('should return error when code_verifier is missing', async () => {
      const req = createMockRequest({
        grant_type: 'authorization_code',
        code: 'auth-code-123',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing code_verifier (PKCE required)',
      });
    });

    it('should return error for invalid authorization code', async () => {
      mockSessionStore.getAuthCode.mockReturnValue(undefined);

      const req = createMockRequest({
        grant_type: 'authorization_code',
        code: 'invalid-code',
        code_verifier: 'verifier',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Invalid or expired authorization code',
      });
    });

    it('should return error for expired authorization code', async () => {
      mockSessionStore.getAuthCode.mockReturnValue({
        code: 'expired-code',
        sessionId: 'session-123',
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() - 1000, // Expired
      });

      const req = createMockRequest({
        grant_type: 'authorization_code',
        code: 'expired-code',
        code_verifier: 'verifier',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(mockSessionStore.deleteAuthCode).toHaveBeenCalledWith('expired-code');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Authorization code has expired',
      });
    });

    it('should return error for invalid code_verifier', async () => {
      mockSessionStore.getAuthCode.mockReturnValue({
        code: 'valid-code',
        sessionId: 'session-123',
        clientId: 'test-client',
        codeChallenge: 'original-challenge',
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
      });
      mockVerifyCodeChallenge.mockReturnValue(false);

      const req = createMockRequest({
        grant_type: 'authorization_code',
        code: 'valid-code',
        code_verifier: 'wrong-verifier',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(mockVerifyCodeChallenge).toHaveBeenCalledWith(
        'wrong-verifier',
        'original-challenge',
        'S256',
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Invalid code_verifier',
      });
    });

    it('should return error when redirect_uri does not match', async () => {
      mockSessionStore.getAuthCode.mockReturnValue({
        code: 'valid-code',
        sessionId: 'session-123',
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
        redirectUri: 'https://original-callback.example.com',
      });
      mockVerifyCodeChallenge.mockReturnValue(true);

      const req = createMockRequest({
        grant_type: 'authorization_code',
        code: 'valid-code',
        code_verifier: 'correct-verifier',
        redirect_uri: 'https://different-callback.example.com',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'redirect_uri does not match',
      });
    });

    it('should return error when session not found', async () => {
      mockSessionStore.getAuthCode.mockReturnValue({
        code: 'valid-code',
        sessionId: 'missing-session',
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
      });
      mockVerifyCodeChallenge.mockReturnValue(true);
      mockSessionStore.getSession.mockReturnValue(undefined);

      const req = createMockRequest({
        grant_type: 'authorization_code',
        code: 'valid-code',
        code_verifier: 'correct-verifier',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Session not found',
      });
    });

    it('should return tokens for valid authorization code exchange', async () => {
      mockSessionStore.getAuthCode.mockReturnValue({
        code: 'valid-code',
        sessionId: 'session-123',
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
      });
      mockVerifyCodeChallenge.mockReturnValue(true);
      mockSessionStore.getSession.mockReturnValue({
        id: 'session-123',
        mcpAccessToken: '',
        mcpRefreshToken: '',
        mcpTokenExpiry: 0,
        gitlabAccessToken: 'gitlab-token',
        gitlabRefreshToken: 'gitlab-refresh',
        gitlabTokenExpiry: Date.now() + 7200000,
        gitlabUserId: 12345,
        gitlabUsername: 'testuser',
        clientId: 'test-client',
        scopes: ['mcp:tools', 'mcp:resources'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const req = createMockRequest({
        grant_type: 'authorization_code',
        code: 'valid-code',
        code_verifier: 'correct-verifier',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(mockSessionStore.updateSession).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          mcpAccessToken: 'mcp-access-token-jwt',
          mcpRefreshToken: 'mcp-refresh-token-abc',
          resource: 'https://gitlab-mcp.example.com/mcp',
        }),
      );
      expect(mockSessionStore.deleteAuthCode).toHaveBeenCalledWith('valid-code');
      // RFC 8707: the audience is the protected resource, not the client.
      expect(createJWT).toHaveBeenCalledWith(
        expect.objectContaining({
          iss: 'https://gitlab-mcp.example.com',
          aud: 'https://gitlab-mcp.example.com/mcp',
          client_id: 'test-client',
          jti: 'token-jti',
        }),
        mockConfig.sessionSecret,
        3600,
      );

      expect(res.json).toHaveBeenCalledWith({
        access_token: 'mcp-access-token-jwt',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'mcp-refresh-token-abc',
        scope: 'mcp:tools mcp:resources',
      });
    });

    describe('client, resource and single-use binding', () => {
      const code = {
        code: 'valid-code',
        sessionId: 'session-123',
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
      };
      const session = {
        id: 'session-123',
        mcpAccessToken: '',
        mcpRefreshToken: '',
        mcpTokenExpiry: 0,
        gitlabAccessToken: 'gitlab-token',
        gitlabRefreshToken: 'gitlab-refresh',
        gitlabTokenExpiry: Date.now() + 7200000,
        gitlabUserId: 12345,
        gitlabUsername: 'testuser',
        clientId: 'test-client',
        scopes: ['mcp:tools', 'mcp:resources'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const exchange = (extra: Record<string, string>) =>
        createMockRequest({
          grant_type: 'authorization_code',
          code: 'valid-code',
          code_verifier: 'correct-verifier',
          client_id: 'test-client',
          ...extra,
        }) as Request;

      beforeEach(() => {
        mockSessionStore.getAuthCode.mockReturnValue(code);
        mockVerifyCodeChallenge.mockReturnValue(true);
        mockSessionStore.getSession.mockReturnValue(session);
      });

      it('rejects an exchange without client_id (RFC 6749 4.1.3)', async () => {
        const res = createMockResponse() as Response;
        await tokenHandler(
          createMockRequest({
            grant_type: 'authorization_code',
            code: 'c',
            code_verifier: 'v',
          }) as Request,
          res,
        );
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_request',
          error_description: 'Missing client_id',
        });
      });

      it('rejects a code presented by another client', async () => {
        const res = createMockResponse() as Response;
        await tokenHandler(exchange({ client_id: 'other-client' }), res);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_grant',
          error_description: 'Authorization code was issued to another client',
        });
        expect(mockSessionStore.updateSession).not.toHaveBeenCalled();
      });

      it('lets only the caller that consumed the code redeem it', async () => {
        // A concurrent exchange already removed the code.
        mockSessionStore.deleteAuthCode.mockReturnValue(false);
        const res = createMockResponse() as Response;
        await tokenHandler(exchange({}), res);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_grant',
          error_description: 'Invalid or expired authorization code',
        });
        expect(createJWT).not.toHaveBeenCalled();
      });

      it('consumes the code even when PKCE verification fails', async () => {
        mockVerifyCodeChallenge.mockReturnValue(false);
        await tokenHandler(exchange({}), createMockResponse() as Response);
        expect(mockSessionStore.deleteAuthCode).toHaveBeenCalledWith('valid-code');
      });

      it.each([
        ['https://gitlab-mcp.example.com', 'https://gitlab-mcp.example.com'],
        ['https://gitlab-mcp.example.com/', 'https://gitlab-mcp.example.com'],
        ['https://gitlab-mcp.example.com/mcp', 'https://gitlab-mcp.example.com/mcp'],
      ])('issues a token for resource %s with audience %s', async (resource, audience) => {
        await tokenHandler(exchange({ resource }), createMockResponse() as Response);
        expect(createJWT).toHaveBeenCalledWith(
          expect.objectContaining({ aud: audience }),
          expect.any(String),
          3600,
        );
      });

      it.each([
        ['another server', undefined, 'https://other.example.com/mcp'],
        [
          'a different resource than authorized',
          'https://gitlab-mcp.example.com',
          'https://gitlab-mcp.example.com/mcp',
        ],
      ])('rejects a resource naming %s (RFC 8707 2)', async (_c, bound, resource) => {
        mockSessionStore.getSession.mockReturnValue({ ...session, resource: bound });
        const res = createMockResponse() as Response;
        await tokenHandler(exchange({ resource }), res);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_target',
          error_description: 'resource does not match the authorization',
        });
        expect(createJWT).not.toHaveBeenCalled();
      });
    });
  });

  describe('tokenHandler - Refresh Token Grant', () => {
    it('should return error when refresh_token is missing', async () => {
      const req = createMockRequest({
        grant_type: 'refresh_token',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing refresh_token',
      });
    });

    it('should return error for invalid refresh token', async () => {
      mockSessionStore.getSessionByRefreshToken.mockReturnValue(undefined);

      const req = createMockRequest({
        grant_type: 'refresh_token',
        refresh_token: 'invalid-refresh-token',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Invalid refresh token',
      });
    });

    it('should return new tokens for valid refresh token', async () => {
      const existingSession = {
        id: 'session-123',
        mcpAccessToken: 'old-access-token',
        mcpRefreshToken: 'valid-refresh-token',
        mcpTokenExpiry: Date.now() + 1000,
        gitlabAccessToken: 'gitlab-token',
        gitlabRefreshToken: 'gitlab-refresh',
        gitlabTokenExpiry: Date.now() + 7200000, // Not expiring soon
        gitlabUserId: 12345,
        gitlabUsername: 'testuser',
        clientId: 'test-client',
        scopes: ['mcp:tools', 'mcp:resources'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockSessionStore.getSessionByRefreshToken.mockReturnValue(existingSession);
      mockIsTokenExpiringSoon.mockReturnValue(false);

      const req = createMockRequest({
        grant_type: 'refresh_token',
        refresh_token: 'valid-refresh-token',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(mockSessionStore.updateSession).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          mcpAccessToken: 'mcp-access-token-jwt',
          mcpRefreshToken: 'mcp-refresh-token-abc',
        }),
      );

      expect(res.json).toHaveBeenCalledWith({
        access_token: 'mcp-access-token-jwt',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'mcp-refresh-token-abc',
        scope: 'mcp:tools mcp:resources',
      });
    });

    it.each([undefined, '', 'read_api', 'api read_user'])(
      'refreshes the upstream grant independently of MCP scopes: %s',
      async (scope) => {
        // A refresh without scope must not overwrite the existing GitLab grant.
        const existingSession = {
          id: 'session-123',
          mcpAccessToken: 'old-access-token',
          mcpRefreshToken: 'valid-refresh-token',
          mcpTokenExpiry: Date.now() + 1000,
          gitlabAccessToken: 'expiring-gitlab-token',
          gitlabRefreshToken: 'gitlab-refresh',
          gitlabTokenExpiry: Date.now() + 60000, // Expiring soon
          gitlabUserId: 12345,
          gitlabUsername: 'testuser',
          clientId: 'test-client',
          scopes: ['mcp:tools', 'mcp:resources'],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        mockSessionStore.getSessionByRefreshToken.mockReturnValue(existingSession);
        mockIsTokenExpiringSoon.mockReturnValue(true);
        mockRefreshGitLabToken.mockResolvedValue({
          access_token: 'new-gitlab-token',
          refresh_token: 'new-gitlab-refresh',
          token_type: 'Bearer',
          expires_in: 7200,
          scope,
          created_at: Date.now(),
        });
        mockSessionStore.getSession.mockReturnValue({
          ...existingSession,
          gitlabAccessToken: 'new-gitlab-token',
          gitlabRefreshToken: 'new-gitlab-refresh',
        });

        const req = createMockRequest({
          grant_type: 'refresh_token',
          refresh_token: 'valid-refresh-token',
          client_id: 'test-client',
        }) as Request;
        const res = createMockResponse() as Response;

        await tokenHandler(req, res);

        expect(mockRefreshGitLabToken).toHaveBeenCalledWith('gitlab-refresh', mockConfig);
        const grantUpdate = mockSessionStore.updateSession.mock.calls[0][1];
        if (scope === undefined) expect(grantUpdate).not.toHaveProperty('gitlabScopes');
        else expect(grantUpdate.gitlabScopes).toEqual(scope.split(/\s+/).filter(Boolean));
        expect(mockSessionStore.updateSession).toHaveBeenCalledWith(
          'session-123',
          expect.objectContaining({
            gitlabAccessToken: 'new-gitlab-token',
            gitlabRefreshToken: 'new-gitlab-refresh',
          }),
        );

        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            access_token: 'mcp-access-token-jwt',
            token_type: 'Bearer',
          }),
        );
      },
    );

    describe('refresh binding', () => {
      const session = {
        id: 'session-123',
        mcpAccessToken: 'old-access-token',
        mcpRefreshToken: 'valid-refresh-token',
        mcpTokenExpiry: Date.now() + 1000,
        gitlabAccessToken: 'gitlab-token',
        gitlabRefreshToken: 'gitlab-refresh',
        gitlabTokenExpiry: Date.now() + 7200000,
        gitlabUserId: 12345,
        gitlabUsername: 'testuser',
        clientId: 'test-client',
        scopes: ['mcp:tools', 'mcp:resources'],
        resource: 'https://gitlab-mcp.example.com',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const refresh = (extra: Record<string, string | undefined>) =>
        createMockRequest({
          grant_type: 'refresh_token',
          refresh_token: 'valid-refresh-token',
          client_id: 'test-client',
          ...extra,
        }) as Request;

      beforeEach(() => {
        mockSessionStore.getSessionByRefreshToken.mockReturnValue(session);
        mockIsTokenExpiringSoon.mockReturnValue(false);
      });

      it.each([
        ['missing', undefined, 'invalid_request', 'Missing client_id'],
        [
          'another client',
          'other-client',
          'invalid_grant',
          'Refresh token was issued to another client',
        ],
      ])('rejects a refresh with %s client_id', async (_c, clientId, error, description) => {
        const res = createMockResponse() as Response;
        await tokenHandler(refresh({ client_id: clientId }), res);
        expect(res.json).toHaveBeenCalledWith({ error, error_description: description });
        expect(mockSessionStore.updateSession).not.toHaveBeenCalled();
      });

      it('keeps the audience the session was bound to', async () => {
        await tokenHandler(refresh({}), createMockResponse() as Response);
        expect(createJWT).toHaveBeenCalledWith(
          expect.objectContaining({ aud: 'https://gitlab-mcp.example.com' }),
          expect.any(String),
          3600,
        );
      });

      it('rejects a refresh that names another resource', async () => {
        const res = createMockResponse() as Response;
        await tokenHandler(refresh({ resource: 'https://gitlab-mcp.example.com/mcp' }), res);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_target',
          error_description: 'resource does not match the authorization',
        });
      });

      it('narrows the scope on request (RFC 6749 6)', async () => {
        const res = createMockResponse() as Response;
        await tokenHandler(refresh({ scope: 'mcp:tools' }), res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ scope: 'mcp:tools' }));
      });

      it('rejects a scope beyond the original grant', async () => {
        mockSessionStore.getSessionByRefreshToken.mockReturnValue({
          ...session,
          scopes: ['mcp:tools'],
        });
        const res = createMockResponse() as Response;
        await tokenHandler(refresh({ scope: 'mcp:tools mcp:resources' }), res);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_scope',
          error_description: 'scope exceeds the original grant',
        });
      });
    });

    it('should return error when GitLab token refresh fails', async () => {
      const existingSession = {
        id: 'session-123',
        mcpAccessToken: 'old-access-token',
        mcpRefreshToken: 'valid-refresh-token',
        mcpTokenExpiry: Date.now() + 1000,
        gitlabAccessToken: 'expiring-gitlab-token',
        gitlabRefreshToken: 'gitlab-refresh',
        gitlabTokenExpiry: Date.now() + 60000,
        gitlabUserId: 12345,
        gitlabUsername: 'testuser',
        clientId: 'test-client',
        scopes: ['mcp:tools', 'mcp:resources'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockSessionStore.getSessionByRefreshToken.mockReturnValue(existingSession);
      mockIsTokenExpiringSoon.mockReturnValue(true);
      mockRefreshGitLabToken.mockRejectedValue(new Error('GitLab refresh failed'));

      const req = createMockRequest({
        grant_type: 'refresh_token',
        refresh_token: 'valid-refresh-token',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Failed to refresh underlying GitLab token',
      });
    });

    it('should return error when session lost during GitLab refresh', async () => {
      const existingSession = {
        id: 'session-123',
        mcpAccessToken: 'old-access-token',
        mcpRefreshToken: 'valid-refresh-token',
        mcpTokenExpiry: Date.now() + 1000,
        gitlabAccessToken: 'expiring-gitlab-token',
        gitlabRefreshToken: 'gitlab-refresh',
        gitlabTokenExpiry: Date.now() + 60000,
        gitlabUserId: 12345,
        gitlabUsername: 'testuser',
        clientId: 'test-client',
        scopes: ['mcp:tools', 'mcp:resources'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockSessionStore.getSessionByRefreshToken.mockReturnValue(existingSession);
      mockIsTokenExpiringSoon.mockReturnValue(true);
      mockRefreshGitLabToken.mockResolvedValue({
        access_token: 'new-gitlab-token',
        refresh_token: 'new-gitlab-refresh',
        token_type: 'Bearer',
        expires_in: 7200,
        created_at: Date.now(),
      });
      mockSessionStore.getSession.mockReturnValue(undefined); // Session lost

      const req = createMockRequest({
        grant_type: 'refresh_token',
        refresh_token: 'valid-refresh-token',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Session lost during refresh',
      });
    });
  });
});
