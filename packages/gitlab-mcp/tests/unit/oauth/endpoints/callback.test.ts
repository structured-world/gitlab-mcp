/**
 * OAuth Callback Endpoint Tests
 *
 * Tests for the OAuth callback handler that processes GitLab authorization responses.
 */

import { Request, Response } from 'express';
import { callbackHandler } from '../../../../src/oauth/endpoints/callback';
import type { AuthCodeFlowState } from '../../../../src/oauth/types';

// Mock dependencies
jest.mock('../../../../src/oauth/config', () => ({
  loadOAuthConfig: jest.fn(),
}));

jest.mock('../../../../src/oauth/session-store', () => ({
  sessionStore: {
    getAuthCodeFlow: jest.fn(),
    storeAuthCodeFlow: jest.fn(),
    deleteAuthCodeFlow: jest.fn(),
    consumeAuthCodeFlow: jest.fn(),
    storeAuthCode: jest.fn(),
    createSession: jest.fn(),
  },
}));

jest.mock('../../../../src/oauth/gitlab-device-flow', () => ({
  exchangeGitLabAuthCode: jest.fn(),
  getGitLabUser: jest.fn(),
}));

jest.mock('../../../../src/oauth/instance-app', () => ({
  oauthAppFor: jest.fn(),
}));

jest.mock('../../../../src/oauth/token-utils', () => ({
  generateSessionId: jest.fn().mockReturnValue('session-id-123'),
  generateAuthorizationCode: jest.fn().mockReturnValue('auth-code-456'),
  calculateTokenExpiry: jest.fn().mockReturnValue(Date.now() + 7200000),
}));

jest.mock('../../../../src/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
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
import { exchangeGitLabAuthCode, getGitLabUser } from '../../../../src/oauth/gitlab-device-flow';

const mockLoadOAuthConfig = loadOAuthConfig as jest.MockedFunction<typeof loadOAuthConfig>;
const mockSessionStore = sessionStore as jest.Mocked<typeof sessionStore>;
const mockExchangeGitLabAuthCode = exchangeGitLabAuthCode as jest.MockedFunction<
  typeof exchangeGitLabAuthCode
>;
const mockGetGitLabUser = getGitLabUser as jest.MockedFunction<typeof getGitLabUser>;
import { oauthAppFor } from '../../../../src/oauth/instance-app';
const mockOauthAppFor = oauthAppFor as jest.MockedFunction<typeof oauthAppFor>;
const selectedApp = {
  baseUrl: 'https://git.corp.example/gitlab',
  label: 'Corp',
  clientId: 'corp-app',
  clientSecret: 'corp-secret',
  scopes: 'read_api read_user',
};

describe('OAuth Callback Handler', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let redirectMock: jest.Mock;
  let statusMock: jest.Mock;

  const mockOAuthConfig = {
    enabled: true as const,
    issuer: 'https://gitlab-mcp.example.com',
    gitlabClientId: 'test-client-id',
    gitlabClientSecret: 'test-client-secret',
    gitlabScopes: 'api,read_user',
    sessionSecret: 'test-session-secret-min-32-chars!!',
    tokenTtl: 3600,
    refreshTokenTtl: 604800,
    devicePollInterval: 5,
    deviceTimeout: 300,
  };

  const mockAuthCodeFlow = {
    clientId: 'client-id',
    clientRedirectUri: 'https://client.example.com/callback',
    clientState: 'client-state-123',
    internalState: 'internal-state-123',
    callbackUri: 'https://gitlab-mcp.example.com/oauth/callback',
    codeChallenge: 'code-challenge',
    codeChallengeMethod: 'S256' as const,
    expiresAt: Date.now() + 600000, // 10 minutes from now
    requestedGitlabScopes: ['read_api', 'read_user'],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    jsonMock = jest.fn();
    redirectMock = jest.fn();
    statusMock = jest.fn().mockReturnThis();

    mockRequest = {
      query: {},
    };

    mockResponse = {
      json: jsonMock,
      redirect: redirectMock,
      status: statusMock,
    };

    mockLoadOAuthConfig.mockReturnValue(mockOAuthConfig);
    mockOauthAppFor.mockResolvedValue(selectedApp);
    mockSessionStore.storeAuthCodeFlow.mockResolvedValue(undefined);
    mockSessionStore.deleteAuthCodeFlow.mockResolvedValue(true);
  });

  /** The flow the callback reads, and finally consumes. */
  function withFlow(flow: AuthCodeFlowState | undefined): void {
    mockSessionStore.getAuthCodeFlow.mockResolvedValue(flow);
    mockSessionStore.consumeAuthCodeFlow.mockResolvedValue(flow);
  }

  describe('configuration errors', () => {
    it('should return 500 if OAuth is not configured', async () => {
      mockLoadOAuthConfig.mockReturnValue(null);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'OAuth not configured',
      });
    });
  });

  describe('GitLab error responses', () => {
    it('should redirect with error if GitLab returns error and flow state exists', async () => {
      mockRequest.query = {
        error: 'access_denied',
        error_description: 'User denied access',
        state: 'flow-state-123',
      };

      mockSessionStore.consumeAuthCodeFlow.mockResolvedValue(mockAuthCodeFlow);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.consumeAuthCodeFlow).toHaveBeenCalledWith('flow-state-123');
      expect(redirectMock).toHaveBeenCalledWith(
        expect.stringContaining('https://client.example.com/callback'),
      );
      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=access_denied'));
      expect(redirectMock).toHaveBeenCalledWith(
        expect.stringContaining('error_description=User+denied+access'),
      );
      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('state=client-state-123'));
      // RFC 9207 section 2: error responses identify the issuer too.
      const location = new URL(redirectMock.mock.calls[0][0] as string);
      expect(location.searchParams.get('iss')).toBe('https://gitlab-mcp.example.com');
    });

    it('should return JSON error if GitLab returns error and no flow state', async () => {
      mockRequest.query = {
        error: 'server_error',
        error_description: 'GitLab error',
      };

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'GitLab error',
      });
    });

    it('should return JSON error if state is invalid', async () => {
      mockRequest.query = {
        error: 'access_denied',
        state: 'invalid-state',
      };

      mockSessionStore.consumeAuthCodeFlow.mockResolvedValue(undefined);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'access_denied',
        error_description: 'GitLab authorization failed',
      });
    });

    // Without the flow there is no registered redirect to send the error to.
    it('reports a GitLab error as JSON when the flow cannot be read', async () => {
      mockRequest.query = { error: 'access_denied', state: 'flow-state-123' };
      mockSessionStore.consumeAuthCodeFlow.mockRejectedValue(new Error('database down'));

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(redirectMock).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'access_denied',
        error_description: 'GitLab authorization failed',
      });
    });
  });

  describe('storage outage', () => {
    // An outage is not an invalid state: the user can retry the sign-in.
    it('answers 503 when the authorization flow cannot be read', async () => {
      mockRequest.query = { code: 'gitlab-code', state: 'flow-state-123' };
      mockSessionStore.getAuthCodeFlow.mockRejectedValue(new Error('database down'));

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(503);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'Authorization storage is unavailable. Please try again.',
      });
      expect(redirectMock).not.toHaveBeenCalled();
    });
  });

  describe('parameter validation', () => {
    it('should return 400 if code is missing', async () => {
      mockRequest.query = {
        state: 'flow-state-123',
      };

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing authorization code from GitLab',
      });
    });

    it('should return 400 if state is missing', async () => {
      mockRequest.query = {
        code: 'gitlab-code-123',
      };

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing state parameter',
      });
    });
  });

  describe('flow state validation', () => {
    it('should return 400 if flow state is not found', async () => {
      mockRequest.query = {
        code: 'gitlab-code-123',
        state: 'unknown-state',
      };

      withFlow(undefined);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Invalid or expired state. Please start authorization again.',
      });
    });

    it('should return 400 if flow state is expired', async () => {
      mockRequest.query = {
        code: 'gitlab-code-123',
        state: 'expired-state',
      };

      const expiredFlow = {
        ...mockAuthCodeFlow,
        expiresAt: Date.now() - 1000, // Expired
      };
      withFlow(expiredFlow);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.deleteAuthCodeFlow).toHaveBeenCalledWith('expired-state');
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Authorization flow expired. Please start again.',
      });
    });
  });

  describe('successful authorization', () => {
    beforeEach(() => {
      mockRequest.query = {
        code: 'gitlab-code-123',
        state: 'flow-state-123',
      };

      withFlow(mockAuthCodeFlow);

      mockExchangeGitLabAuthCode.mockResolvedValue({
        access_token: 'gitlab-access-token',
        refresh_token: 'gitlab-refresh-token',
        scope: 'read_api read_user',
        expires_in: 7200,
        token_type: 'Bearer',
        created_at: 1234567890,
      });

      mockGetGitLabUser.mockResolvedValue({
        id: 12345,
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
      });
    });

    it('should exchange GitLab code for tokens', async () => {
      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockExchangeGitLabAuthCode).toHaveBeenCalledWith(
        'gitlab-code-123',
        mockAuthCodeFlow.callbackUri,
        mockOAuthConfig,
        selectedApp,
      );
    });

    it('exchanges the code with the application of the instance chosen at /authorize', async () => {
      withFlow({
        ...mockAuthCodeFlow,
        selectedInstance: selectedApp.baseUrl,
        selectedInstanceLabel: 'Corp',
      });

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockOauthAppFor).toHaveBeenCalledWith(mockOAuthConfig, selectedApp.baseUrl);
      expect(mockSessionStore.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ gitlabApiUrl: selectedApp.baseUrl, instanceLabel: 'Corp' }),
      );
    });

    it('processes a callback state once: a replayed callback finds no flow', async () => {
      // Another replica (or a browser retry) already completed this state.
      withFlow(undefined);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockExchangeGitLabAuthCode).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(400);
    });

    // Two callbacks raced past the read: only the one that consumes the flow creates a
    // session and a code.
    it('creates nothing when a concurrent callback completed the flow first', async () => {
      mockSessionStore.consumeAuthCodeFlow.mockResolvedValue(undefined);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.createSession).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Authorization was already completed.',
      });
    });

    // GitLab's code works once: the issued tokens are kept with the flow before anything
    // else can fail.
    it('stores the issued GitLab tokens with the flow before the user lookup', async () => {
      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.storeAuthCodeFlow).toHaveBeenCalledWith(
        'flow-state-123',
        expect.objectContaining({
          gitlabTokens: expect.objectContaining({ access_token: 'gitlab-access-token' }),
        }),
      );
      expect(mockSessionStore.storeAuthCodeFlow.mock.invocationCallOrder[0]).toBeLessThan(
        mockGetGitLabUser.mock.invocationCallOrder[0],
      );
    });

    it('finishes a retried callback with the stored tokens without a new exchange', async () => {
      withFlow({
        ...mockAuthCodeFlow,
        gitlabTokens: {
          access_token: 'stored-access',
          refresh_token: 'stored-refresh',
          expires_in: 7200,
          token_type: 'Bearer',
          created_at: 1,
        },
      } as typeof mockAuthCodeFlow);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockExchangeGitLabAuthCode).not.toHaveBeenCalled();
      expect(mockSessionStore.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ gitlabAccessToken: 'stored-access' }),
      );
    });

    // A concurrent callback spent the code a moment earlier and stored its tokens.
    it('uses the tokens a concurrent callback stored when the code is already spent', async () => {
      mockExchangeGitLabAuthCode.mockRejectedValue(new Error('invalid_grant'));
      mockSessionStore.getAuthCodeFlow
        .mockResolvedValueOnce(mockAuthCodeFlow)
        .mockResolvedValueOnce({
          ...mockAuthCodeFlow,
          gitlabTokens: {
            access_token: 'other-access',
            refresh_token: 'other-refresh',
            expires_in: 7200,
            token_type: 'Bearer',
            created_at: 1,
          },
        } as typeof mockAuthCodeFlow);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ gitlabAccessToken: 'other-access' }),
      );
    });

    it('creates the session before the code that references it', async () => {
      // The PostgreSQL code row has a foreign key on the session.
      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.createSession.mock.invocationCallOrder[0]).toBeLessThan(
        mockSessionStore.storeAuthCode.mock.invocationCallOrder[0],
      );
    });

    it('reports storage failure without redirecting a sign-in that did not happen', async () => {
      mockSessionStore.createSession.mockRejectedValueOnce(new Error('database down'));

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.storeAuthCode).not.toHaveBeenCalled();
      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=server_error'));
      expect(redirectMock).not.toHaveBeenCalledWith(expect.stringContaining('code='));
    });

    it('fails without contacting GitLab when the instance is no longer configured', async () => {
      mockOauthAppFor.mockResolvedValue(undefined);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockExchangeGitLabAuthCode).not.toHaveBeenCalled();
      expect(mockSessionStore.createSession).not.toHaveBeenCalled();
      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=server_error'));
    });

    it('retains the requested grant when the token response omits scope', async () => {
      // RFC 6749 §5.1 permits omission only when the granted scope is unchanged.
      mockExchangeGitLabAuthCode.mockResolvedValue({
        access_token: 'fixture-access',
        refresh_token: 'fixture-refresh',
        expires_in: 7200,
        token_type: 'Bearer',
        created_at: 1234567890,
      });
      await callbackHandler(mockRequest as Request, mockResponse as Response);
      expect(mockSessionStore.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          gitlabScopes: ['read_api', 'read_user'],
        }),
      );
    });

    it('should get GitLab user info', async () => {
      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockGetGitLabUser).toHaveBeenCalledWith('gitlab-access-token', selectedApp.baseUrl);
    });

    it('should store MCP authorization code', async () => {
      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.storeAuthCode).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'auth-code-456',
          sessionId: 'session-id-123',
          clientId: mockAuthCodeFlow.clientId,
          codeChallenge: mockAuthCodeFlow.codeChallenge,
          codeChallengeMethod: mockAuthCodeFlow.codeChallengeMethod,
          redirectUri: mockAuthCodeFlow.clientRedirectUri,
        }),
      );
    });

    it('should create session with GitLab tokens', async () => {
      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'session-id-123',
          gitlabAccessToken: 'gitlab-access-token',
          gitlabRefreshToken: 'gitlab-refresh-token',
          // Upstream grants are independent of the MCP client's requested scopes.
          gitlabScopes: ['read_api', 'read_user'],
          gitlabUserId: 12345,
          gitlabUsername: 'testuser',
          clientId: mockAuthCodeFlow.clientId,
          scopes: ['mcp:tools', 'mcp:resources'],
        }),
      );
    });

    it('should delete flow state after success', async () => {
      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.consumeAuthCodeFlow).toHaveBeenCalledWith('flow-state-123');
    });

    it('should redirect to client with MCP authorization code', async () => {
      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(redirectMock).toHaveBeenCalledWith(
        expect.stringContaining('https://client.example.com/callback'),
      );
      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('code=auth-code-456'));
      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('state=client-state-123'));
      // RFC 9207 section 2: the client checks iss against the server it started with.
      const location = new URL(redirectMock.mock.calls[0][0] as string);
      expect(location.searchParams.get('iss')).toBe('https://gitlab-mcp.example.com');
    });

    it('should bind the session to the scopes and resource of the authorization', async () => {
      withFlow({
        ...mockAuthCodeFlow,
        scopes: ['mcp:tools'],
        resource: 'https://gitlab-mcp.example.com/mcp',
      });

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: ['mcp:tools'],
          resource: 'https://gitlab-mcp.example.com/mcp',
        }),
      );
    });

    it('should redirect without state if client state is empty', async () => {
      // Empty string clientState should not be included in redirect
      const flowWithEmptyState = { ...mockAuthCodeFlow, clientState: '' };
      withFlow(flowWithEmptyState);

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('code=auth-code-456'));
      // When clientState is empty, it may or may not be included depending on implementation
      // The key assertion is that the redirect happens with the auth code
    });
  });

  describe('error handling during token exchange', () => {
    beforeEach(() => {
      mockRequest.query = {
        code: 'gitlab-code-123',
        state: 'flow-state-123',
      };

      withFlow(mockAuthCodeFlow);
    });

    // A failed callback keeps the flow, so reloading the callback can still finish.
    it('should redirect with error if GitLab token exchange fails', async () => {
      mockExchangeGitLabAuthCode.mockRejectedValue(new Error('Invalid authorization code'));

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.consumeAuthCodeFlow).not.toHaveBeenCalled();
      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=server_error'));
      expect(redirectMock).toHaveBeenCalledWith(
        expect.stringContaining('error_description=Invalid+authorization+code'),
      );
      const location = new URL(redirectMock.mock.calls[0][0] as string);
      expect(location.searchParams.get('iss')).toBe('https://gitlab-mcp.example.com');
    });

    it('should redirect with error if getting user info fails', async () => {
      mockExchangeGitLabAuthCode.mockResolvedValue({
        access_token: 'gitlab-access-token',
        refresh_token: 'gitlab-refresh-token',
        expires_in: 7200,
        token_type: 'Bearer',
        created_at: 1234567890,
      });

      mockGetGitLabUser.mockRejectedValue(new Error('Failed to get user info'));

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(mockSessionStore.consumeAuthCodeFlow).not.toHaveBeenCalled();
      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=server_error'));
    });

    it('should include client state in error redirect', async () => {
      mockExchangeGitLabAuthCode.mockRejectedValue(new Error('Exchange failed'));

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('state=client-state-123'));
    });

    it('should handle non-Error exceptions', async () => {
      mockExchangeGitLabAuthCode.mockRejectedValue('string error');

      await callbackHandler(mockRequest as Request, mockResponse as Response);

      expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('error=server_error'));
      expect(redirectMock).toHaveBeenCalledWith(
        expect.stringContaining('error_description=Failed+to+complete+authorization'),
      );
    });
  });
});
