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
    consumeAuthCode: jest.fn(),
    getSession: jest.fn(),
    updateSession: jest.fn(),
    rotateSession: jest.fn(),
    getSessionByRefreshToken: jest.fn(),
    claimGitLabRefresh: jest.fn(),
    releaseGitLabRefresh: jest.fn(),
    markClientUsed: jest.fn(),
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
  GitLabOAuthHttpError: jest.requireActual('../../../../src/oauth/gitlab-device-flow')
    .GitLabOAuthHttpError,
}));

jest.mock('../../../../src/oauth/instance-app', () => ({
  oauthAppFor: jest.fn(),
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
import { refreshGitLabToken, GitLabOAuthHttpError } from '../../../../src/oauth/gitlab-device-flow';

const mockLoadOAuthConfig = loadOAuthConfig as jest.MockedFunction<typeof loadOAuthConfig>;
const mockSessionStore = sessionStore as jest.Mocked<typeof sessionStore>;
const mockVerifyCodeChallenge = verifyCodeChallenge as jest.MockedFunction<
  typeof verifyCodeChallenge
>;
const mockIsTokenExpiringSoon = isTokenExpiringSoon as jest.MockedFunction<
  typeof isTokenExpiringSoon
>;
const mockRefreshGitLabToken = refreshGitLabToken as jest.MockedFunction<typeof refreshGitLabToken>;
import { oauthAppFor } from '../../../../src/oauth/instance-app';
const mockOauthAppFor = oauthAppFor as jest.MockedFunction<typeof oauthAppFor>;
const sessionApp = {
  baseUrl: 'https://gitlab.example.com',
  clientId: 'test-client-id',
  scopes: 'api,read_user',
};

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
  const createMockRequest = (body: Record<string, unknown> = {}): Partial<Request> => ({
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
    // Storage writes succeed and this caller wins every compare-and-set by default.
    mockSessionStore.updateSession.mockResolvedValue(true);
    mockSessionStore.rotateSession.mockResolvedValue(true);
    mockSessionStore.claimGitLabRefresh.mockResolvedValue(true);
    mockSessionStore.releaseGitLabRefresh.mockResolvedValue(undefined);
    mockSessionStore.markClientUsed.mockResolvedValue(undefined);
    mockOauthAppFor.mockResolvedValue(sessionApp);
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

    // A request without a parsed form body (wrong content type) has no grant at all.
    it('answers unsupported_grant_type for a request without a form body', async () => {
      const req = { ...createMockRequest(), body: undefined } as unknown as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unsupported_grant_type',
        error_description: 'Grant type "undefined" is not supported',
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
      mockSessionStore.consumeAuthCode.mockResolvedValue(undefined);

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
      mockSessionStore.consumeAuthCode.mockResolvedValue({
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

      expect(mockSessionStore.consumeAuthCode).toHaveBeenCalledWith('expired-code');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'Authorization code has expired',
      });
    });

    it('should return error for invalid code_verifier', async () => {
      mockSessionStore.consumeAuthCode.mockResolvedValue({
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
      mockSessionStore.consumeAuthCode.mockResolvedValue({
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
      mockSessionStore.consumeAuthCode.mockResolvedValue({
        code: 'valid-code',
        sessionId: 'missing-session',
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
      });
      mockVerifyCodeChallenge.mockReturnValue(true);
      mockSessionStore.getSession.mockResolvedValue(undefined);

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
      mockSessionStore.consumeAuthCode.mockResolvedValue({
        code: 'valid-code',
        sessionId: 'session-123',
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        expiresAt: Date.now() + 600000,
      });
      mockVerifyCodeChallenge.mockReturnValue(true);
      mockSessionStore.getSession.mockResolvedValue({
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
      expect(mockSessionStore.consumeAuthCode).toHaveBeenCalledWith('valid-code');
      // A client that completed an authorization keeps its registration.
      expect(mockSessionStore.markClientUsed).toHaveBeenCalledWith('test-client');
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
      const exchange = (extra: Record<string, unknown>) =>
        createMockRequest({
          grant_type: 'authorization_code',
          code: 'valid-code',
          code_verifier: 'correct-verifier',
          client_id: 'test-client',
          ...extra,
        }) as Request;

      beforeEach(() => {
        mockSessionStore.consumeAuthCode.mockResolvedValue(code);
        mockVerifyCodeChallenge.mockReturnValue(true);
        mockSessionStore.getSession.mockResolvedValue(session);
      });

      // The session was revoked between the code being issued and redeemed.
      it('rejects the exchange when the session is gone by the time tokens are stored', async () => {
        mockSessionStore.updateSession.mockResolvedValueOnce(false);
        const res = createMockResponse() as Response;

        await tokenHandler(exchange({}), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_grant',
          error_description: 'Session not found',
        });
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
        // A concurrent exchange on any replica already took the code.
        mockSessionStore.consumeAuthCode.mockResolvedValue(undefined);
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
        expect(mockSessionStore.consumeAuthCode).toHaveBeenCalledWith('valid-code');
      });

      it('reports a storage failure as a server error, not as a granted token', async () => {
        mockSessionStore.consumeAuthCode.mockRejectedValue(new Error('database down'));
        const res = createMockResponse() as Response;
        await tokenHandler(exchange({}), res);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          error: 'server_error',
          error_description: 'Token service is temporarily unavailable',
        });
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

      // RFC 6749 section 3.2: request parameters must not repeat. A repeated code_verifier
      // crashed PKCE with a 500 after the code was already spent; it is refused before.
      it.each(['code', 'code_verifier', 'client_id', 'redirect_uri'])(
        'rejects a repeated %s before the code is consumed',
        async (name) => {
          const res = createMockResponse() as Response;
          await tokenHandler(exchange({ [name]: ['a', 'b'] }), res);
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_request',
            error_description: `${name} must not be repeated`,
          });
          expect(mockSessionStore.consumeAuthCode).not.toHaveBeenCalled();
        },
      );

      // Recording the client as used only stops its registration from expiring: a storage
      // failure there must not withhold tokens the exchange already issued.
      it('issues the tokens when the client use cannot be recorded', async () => {
        mockSessionStore.markClientUsed.mockRejectedValueOnce(new Error('database down'));
        const res = createMockResponse() as Response;
        await tokenHandler(exchange({}), res);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ access_token: 'mcp-access-token-jwt' }),
        );
      });

      // RFC 8707 section 2: resource may repeat; values naming one target bind it once.
      it('accepts a resource repeated with the same target', async () => {
        await tokenHandler(
          exchange({
            resource: ['https://gitlab-mcp.example.com/mcp', 'https://gitlab-mcp.example.com/mcp'],
          }),
          createMockResponse() as Response,
        );
        expect(createJWT).toHaveBeenCalledWith(
          expect.objectContaining({ aud: 'https://gitlab-mcp.example.com/mcp' }),
          expect.any(String),
          3600,
        );
      });

      it('rejects repeated resources naming different targets before the code is consumed', async () => {
        const res = createMockResponse() as Response;
        await tokenHandler(
          exchange({
            resource: ['https://gitlab-mcp.example.com', 'https://gitlab-mcp.example.com/mcp'],
          }),
          res,
        );
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_target',
          error_description: 'resource must name one resource of this server',
        });
        expect(mockSessionStore.consumeAuthCode).not.toHaveBeenCalled();
      });

      it.each([
        [
          'another server',
          undefined,
          'https://other.example.com/mcp',
          'resource must name one resource of this server',
        ],
        [
          'a different resource than authorized',
          'https://gitlab-mcp.example.com',
          'https://gitlab-mcp.example.com/mcp',
          'resource does not match the authorization',
        ],
      ])('rejects a resource naming %s (RFC 8707 2)', async (_c, bound, resource, description) => {
        mockSessionStore.getSession.mockResolvedValue({ ...session, resource: bound });
        const res = createMockResponse() as Response;
        await tokenHandler(exchange({ resource }), res);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_target',
          error_description: description,
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
      mockSessionStore.getSessionByRefreshToken.mockResolvedValue(undefined);

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

      mockSessionStore.getSessionByRefreshToken.mockResolvedValue(existingSession);
      mockIsTokenExpiringSoon.mockReturnValue(false);

      const req = createMockRequest({
        grant_type: 'refresh_token',
        refresh_token: 'valid-refresh-token',
        client_id: 'test-client',
      }) as Request;
      const res = createMockResponse() as Response;

      await tokenHandler(req, res);

      // Rotation is a compare-and-set on the presented refresh token.
      expect(mockSessionStore.rotateSession).toHaveBeenCalledWith(
        'session-123',
        'valid-refresh-token',
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

        mockSessionStore.getSessionByRefreshToken.mockResolvedValue(existingSession);
        mockIsTokenExpiringSoon.mockReturnValue(true);
        mockRefreshGitLabToken.mockResolvedValue({
          access_token: 'new-gitlab-token',
          refresh_token: 'new-gitlab-refresh',
          token_type: 'Bearer',
          expires_in: 7200,
          scope,
          created_at: Date.now(),
        });
        mockSessionStore.getSession.mockResolvedValue({
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

        expect(mockRefreshGitLabToken).toHaveBeenCalledWith(
          'gitlab-refresh',
          mockConfig,
          sessionApp,
        );
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

    describe('GitLab refresh failures', () => {
      const expiringSession = {
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
      const refreshRequest = () =>
        createMockRequest({
          grant_type: 'refresh_token',
          refresh_token: 'valid-refresh-token',
          client_id: 'test-client',
        }) as Request;

      beforeEach(() => {
        mockSessionStore.getSessionByRefreshToken.mockResolvedValue(expiringSession);
        // The stored session is unchanged: no other request refreshed it meanwhile.
        mockSessionStore.getSession.mockResolvedValue(expiringSession);
        mockIsTokenExpiringSoon.mockReturnValue(true);
      });

      // A GitLab outage must not spend the client's refresh token: rotating first and then
      // failing left the client without the new token and with the old one already spent.
      it('keeps the refresh token usable when GitLab is temporarily unavailable', async () => {
        mockRefreshGitLabToken.mockRejectedValue(new Error('connect ETIMEDOUT'));
        const res = createMockResponse() as Response;

        await tokenHandler(refreshRequest(), res);

        expect(mockSessionStore.rotateSession).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.json).toHaveBeenCalledWith({
          error: 'temporarily_unavailable',
          error_description: 'GitLab is temporarily unavailable; retry the refresh',
        });
      });

      it('reports invalid_grant without rotating when GitLab rejects the grant', async () => {
        mockRefreshGitLabToken.mockRejectedValue(
          new GitLabOAuthHttpError('Failed to refresh token: 400 invalid_grant', 400),
        );
        const res = createMockResponse() as Response;

        await tokenHandler(refreshRequest(), res);

        expect(mockSessionStore.rotateSession).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_grant',
          error_description: 'GitLab no longer accepts this account; sign in again',
        });
      });

      it('rotates only after GitLab tokens are refreshed', async () => {
        const order: string[] = [];
        mockRefreshGitLabToken.mockImplementation(async () => {
          order.push('gitlab');
          return {
            access_token: 'new-gitlab-token',
            refresh_token: 'new-gitlab-refresh',
            token_type: 'Bearer',
            expires_in: 7200,
            created_at: Date.now(),
          };
        });
        mockSessionStore.rotateSession.mockImplementation(async () => {
          order.push('rotate');
          return true;
        });
        const res = createMockResponse() as Response;

        await tokenHandler(refreshRequest(), res);

        expect(order).toEqual(['gitlab', 'rotate']);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ refresh_token: 'mcp-refresh-token-abc' }),
        );
      });
    });

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
      const refresh = (extra: Record<string, unknown>) =>
        createMockRequest({
          grant_type: 'refresh_token',
          refresh_token: 'valid-refresh-token',
          client_id: 'test-client',
          ...extra,
        }) as Request;

      beforeEach(() => {
        mockSessionStore.getSessionByRefreshToken.mockResolvedValue(session);
        mockIsTokenExpiringSoon.mockReturnValue(false);
      });

      it('lets only one of concurrent refreshes with the same token rotate', async () => {
        // Another replica rotated first: the presented refresh token is spent.
        mockSessionStore.rotateSession.mockResolvedValue(false);
        const res = createMockResponse() as Response;
        await tokenHandler(refresh({}), res);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_grant',
          error_description: 'Invalid refresh token',
        });
        expect(mockRefreshGitLabToken).not.toHaveBeenCalled();
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
        expect(mockSessionStore.rotateSession).not.toHaveBeenCalled();
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

      // A repeated scope crashed the handler (split of an array) with a 500.
      it.each(['refresh_token', 'client_id', 'scope'])(
        'rejects a repeated %s with invalid_request',
        async (name) => {
          const res = createMockResponse() as Response;
          await tokenHandler(refresh({ [name]: ['a', 'b'] }), res);
          expect(res.status).toHaveBeenCalledWith(400);
          expect(res.json).toHaveBeenCalledWith({
            error: 'invalid_request',
            error_description: `${name} must not be repeated`,
          });
          expect(mockSessionStore.getSessionByRefreshToken).not.toHaveBeenCalled();
        },
      );

      it('narrows the scope on request (RFC 6749 6)', async () => {
        const res = createMockResponse() as Response;
        await tokenHandler(refresh({ scope: 'mcp:tools' }), res);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ scope: 'mcp:tools' }));
      });

      it('rejects a scope beyond the original grant', async () => {
        mockSessionStore.getSessionByRefreshToken.mockResolvedValue({
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

    it('refreshes with the application of the session instance and fails when it is gone', async () => {
      // An account on a removed instance is never refreshed through another one.
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
        gitlabApiUrl: 'https://removed.example.com',
        clientId: 'test-client',
        scopes: ['mcp:tools', 'mcp:resources'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      mockSessionStore.getSessionByRefreshToken.mockResolvedValue(existingSession);
      mockIsTokenExpiringSoon.mockReturnValue(true);
      mockOauthAppFor.mockResolvedValue(undefined);
      const res = createMockResponse() as Response;

      await tokenHandler(
        createMockRequest({
          grant_type: 'refresh_token',
          refresh_token: 'valid-refresh-token',
          client_id: 'test-client',
        }) as Request,
        res,
      );

      expect(mockOauthAppFor).toHaveBeenCalledWith(mockConfig, 'https://removed.example.com');
      expect(mockRefreshGitLabToken).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_grant',
        error_description: 'GitLab no longer accepts this account; sign in again',
      });
    });

    it('should return invalid_grant when GitLab rejects the refresh with 401', async () => {
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

      mockSessionStore.getSessionByRefreshToken.mockResolvedValue(existingSession);
      mockIsTokenExpiringSoon.mockReturnValue(true);
      mockRefreshGitLabToken.mockRejectedValue(
        new GitLabOAuthHttpError('Failed to refresh token: 401 invalid_client', 401),
      );

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
        error_description: 'GitLab no longer accepts this account; sign in again',
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

      mockSessionStore.getSessionByRefreshToken.mockResolvedValue(existingSession);
      mockIsTokenExpiringSoon.mockReturnValue(true);
      mockRefreshGitLabToken.mockResolvedValue({
        access_token: 'new-gitlab-token',
        refresh_token: 'new-gitlab-refresh',
        token_type: 'Bearer',
        expires_in: 7200,
        created_at: Date.now(),
      });
      mockSessionStore.getSession.mockResolvedValue(undefined); // Session lost

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
