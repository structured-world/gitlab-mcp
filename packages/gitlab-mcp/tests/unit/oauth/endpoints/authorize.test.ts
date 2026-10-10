/**
 * Unit tests for OAuth authorization endpoint
 * Tests the /authorize endpoint and device flow polling
 */

import { Request, Response } from 'express';
import { authorizeHandler, pollHandler } from '../../../../src/oauth/endpoints/authorize';

// Mock dependencies
jest.mock('../../../../src/oauth/config', () => ({
  loadOAuthConfig: jest.fn(),
}));

jest.mock('../../../../src/oauth/session-store', () => ({
  sessionStore: {
    storeDeviceFlow: jest.fn(),
    storeAuthCodeFlow: jest.fn(),
    getDeviceFlow: jest.fn(),
    deleteDeviceFlow: jest.fn(),
    consumeDeviceFlow: jest.fn(),
    claimDevicePoll: jest.fn(),
    storeAuthCode: jest.fn(),
    createSession: jest.fn(),
    deleteSession: jest.fn().mockResolvedValue(true),
    deleteAuthCode: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../../../src/oauth/gitlab-device-flow', () => ({
  initiateDeviceFlow: jest.fn(),
  pollDeviceFlowOnce: jest.fn(),
  pollDeviceFlowStep: jest.fn(),
  getGitLabUser: jest.fn(),
  // Mock captures the state parameter (3rd argument) and includes it in the URL for verification
  // Actual signature: buildGitLabAuthUrl(config, callbackUri, internalState)
  buildGitLabAuthUrl: jest.fn(
    (_config, _callbackUri: string, state: string) =>
      `https://gitlab.example.com/oauth/authorize?state=${state}`,
  ),
  GitLabOAuthHttpError: jest.requireActual('../../../../src/oauth/gitlab-device-flow')
    .GitLabOAuthHttpError,
}));

jest.mock('../../../../src/oauth/token-utils', () => ({
  generateRandomString: jest.fn(() => 'random-string-32-chars-long-here'),
  generateSessionId: jest.fn(() => 'session-id-123'),
  generateAuthorizationCode: jest.fn(() => 'auth-code-abc'),
  calculateTokenExpiry: jest.fn((seconds: number) => Date.now() + seconds * 1000),
}));

jest.mock('../../../../src/oauth/endpoints/metadata', () => ({
  getBaseUrl: jest.fn(() => 'http://localhost:3333'),
}));

jest.mock('../../../../src/oauth/endpoints/register', () => ({
  getRegisteredClient: jest.fn(),
}));

jest.mock('../../../../src/oauth/instance-app', () => ({
  oauthAppFor: jest.fn(),
  selectableOAuthApps: jest.fn(),
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

jest.mock('../../../../src/config', () => ({
  HOST: 'localhost',
  PORT: 3333,
  CONNECT_TIMEOUT_MS: 10000,
  HEADERS_TIMEOUT_MS: 10000,
  BODY_TIMEOUT_MS: 30000,
}));

import { loadOAuthConfig } from '../../../../src/oauth/config';
import { sessionStore } from '../../../../src/oauth/session-store';
import {
  initiateDeviceFlow,
  pollDeviceFlowStep,
  getGitLabUser,
  GitLabOAuthHttpError,
} from '../../../../src/oauth/gitlab-device-flow';

const mockPollDeviceFlowStep = pollDeviceFlowStep as jest.MockedFunction<typeof pollDeviceFlowStep>;
import { getRegisteredClient } from '../../../../src/oauth/endpoints/register';
import { GITLAB_REQUEST_MAX_MS } from '../../../../src/oauth/gitlab-request-bound';
import { oauthAppFor, selectableOAuthApps } from '../../../../src/oauth/instance-app';

const mockOauthAppFor = oauthAppFor as jest.MockedFunction<typeof oauthAppFor>;
const mockSelectableOAuthApps = selectableOAuthApps as jest.MockedFunction<
  typeof selectableOAuthApps
>;
const defaultApp = {
  baseUrl: 'https://gitlab.example.com',
  clientId: 'test-client-id',
  scopes: 'api,read_user',
};
const otherApp = {
  baseUrl: 'https://git.corp.example/gitlab',
  label: 'Corp <GitLab>',
  clientId: 'corp-app',
  scopes: 'read_api',
};

const mockGetRegisteredClient = getRegisteredClient as jest.MockedFunction<
  typeof getRegisteredClient
>;
const registeredClient = {
  client_id: 'test-client',
  redirect_uris: ['https://callback.example.com'],
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  created_at: 0,
};

const mockLoadOAuthConfig = loadOAuthConfig as jest.MockedFunction<typeof loadOAuthConfig>;
const mockInitiateDeviceFlow = initiateDeviceFlow as jest.MockedFunction<typeof initiateDeviceFlow>;
const mockGetGitLabUser = getGitLabUser as jest.MockedFunction<typeof getGitLabUser>;
const mockSessionStore = sessionStore as jest.Mocked<typeof sessionStore>;

describe('OAuth Authorization Endpoint', () => {
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
  const createMockRequest = (query: Record<string, string | undefined> = {}): Partial<Request> => ({
    query,
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
      setHeader: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
    };
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadOAuthConfig.mockReturnValue(mockConfig);
    mockGetRegisteredClient.mockResolvedValue(registeredClient);
    // This poller is the one that completes the flow unless a test says otherwise.
    mockSessionStore.consumeDeviceFlow.mockImplementation((state) =>
      mockSessionStore.getDeviceFlow(state),
    );
    // The poll reservation follows the stored flow's schedule, as the backends do.
    mockSessionStore.claimDevicePoll.mockImplementation(async (state, now, nextPollAt) => {
      const flow = await mockSessionStore.getDeviceFlow(state);
      if (!flow || (flow.nextPollAt !== undefined && flow.nextPollAt > now)) return undefined;
      return { ...flow, nextPollAt };
    });
    mockSelectableOAuthApps.mockResolvedValue([defaultApp]);
    mockOauthAppFor.mockResolvedValue(defaultApp);
  });

  describe('authorizeHandler', () => {
    it('should return 500 when OAuth is not configured', async () => {
      mockLoadOAuthConfig.mockReturnValue(null);

      const req = createMockRequest({
        response_type: 'code',
        client_id: 'test-client',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      }) as Request;
      const res = createMockResponse() as Response;

      await authorizeHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'OAuth not configured',
      });
    });

    it('should return error for invalid response_type', async () => {
      const req = createMockRequest({
        response_type: 'token', // Invalid - only "code" is supported
        client_id: 'test-client',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      }) as Request;
      const res = createMockResponse() as Response;

      await authorizeHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unsupported_response_type',
        error_description: 'Only "code" response type is supported',
      });
    });

    it('should return error when client_id is missing', async () => {
      const req = createMockRequest({
        response_type: 'code',
        // client_id missing
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      }) as Request;
      const res = createMockResponse() as Response;

      await authorizeHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'client_id is required',
      });
    });

    it('should return error when code_challenge is missing', async () => {
      const req = createMockRequest({
        response_type: 'code',
        client_id: 'test-client',
        // code_challenge missing
        code_challenge_method: 'S256',
      }) as Request;
      const res = createMockResponse() as Response;

      await authorizeHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'code_challenge is required (PKCE)',
      });
    });

    it('should return error when code_challenge_method is not S256', async () => {
      const req = createMockRequest({
        response_type: 'code',
        client_id: 'test-client',
        code_challenge: 'challenge',
        code_challenge_method: 'plain', // Invalid - only S256 is supported
      }) as Request;
      const res = createMockResponse() as Response;

      await authorizeHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'code_challenge_method must be "S256"',
      });
    });

    it('should initiate device flow and return HTML when no redirect_uri', async () => {
      mockInitiateDeviceFlow.mockResolvedValue({
        device_code: 'device-code-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://gitlab.example.com/oauth/authorize',
        verification_uri_complete: 'https://gitlab.example.com/oauth/authorize?user_code=ABCD-1234',
        expires_in: 600,
        interval: 5,
      });

      const req = createMockRequest({
        response_type: 'code',
        client_id: 'test-client',
        code_challenge: 'challenge-abc',
        code_challenge_method: 'S256',
        // No redirect_uri - triggers Device Flow
        state: 'csrf-state-123',
      }) as Request;
      const res = createMockResponse() as Response;

      await authorizeHandler(req, res);

      expect(mockInitiateDeviceFlow).toHaveBeenCalledWith(mockConfig, defaultApp);
      expect(mockSessionStore.storeDeviceFlow).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(res.send).toHaveBeenCalled();

      // Verify HTML contains user code
      const htmlContent = (res.send as jest.Mock).mock.calls[0][0];
      expect(htmlContent).toContain('ABCD-1234');
    });

    it('should redirect to GitLab when redirect_uri is present (Authorization Code Flow)', async () => {
      const req = createMockRequest({
        response_type: 'code',
        client_id: 'test-client',
        code_challenge: 'challenge-abc',
        code_challenge_method: 'S256',
        redirect_uri: 'https://callback.example.com',
        state: 'csrf-state-123',
      }) as Request;
      const res = createMockResponse() as Response;

      await authorizeHandler(req, res);

      // Should NOT initiate device flow
      expect(mockInitiateDeviceFlow).not.toHaveBeenCalled();
      // Should store auth code flow state
      expect(mockSessionStore.storeAuthCodeFlow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          clientId: 'test-client',
          codeChallenge: 'challenge-abc',
          codeChallengeMethod: 'S256',
          clientState: 'csrf-state-123',
          clientRedirectUri: 'https://callback.example.com',
        }),
      );
      // Should redirect to GitLab with the same state that was stored
      // Verify state consistency: the state stored in session must match the state in redirect URL
      const storedState = (mockSessionStore.storeAuthCodeFlow as jest.Mock).mock.calls[0][0];
      expect(res.redirect).toHaveBeenCalledWith(
        `https://gitlab.example.com/oauth/authorize?state=${storedState}`,
      );
    });

    describe('client, redirect and resource binding', () => {
      const codeFlow = (extra: Record<string, string>) =>
        createMockRequest({
          response_type: 'code',
          client_id: 'test-client',
          code_challenge: 'challenge-abc',
          code_challenge_method: 'S256',
          redirect_uri: 'https://callback.example.com',
          state: 'csrf-state-123',
          ...extra,
        }) as Request;

      // RFC 6749 4.1.2.1: never redirect to an unverified URI.
      it.each([
        ['an unknown client', undefined, 'Unknown client_id; register the client via /register'],
        [
          'an unregistered redirect_uri',
          { ...registeredClient, redirect_uris: ['https://other.example.com/cb'] },
          'redirect_uri is not registered for this client',
        ],
      ])('reports %s without redirecting', async (_c, client, description) => {
        mockGetRegisteredClient.mockResolvedValue(client);
        const res = createMockResponse() as Response;

        await authorizeHandler(codeFlow({}), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_request',
          error_description: description,
        });
        expect(res.redirect).not.toHaveBeenCalled();
        expect(mockSessionStore.storeAuthCodeFlow).not.toHaveBeenCalled();
      });

      it('redirects invalid_target with state and iss for a foreign resource (RFC 8707 2, RFC 9207 2)', async () => {
        const res = createMockResponse() as Response;

        await authorizeHandler(codeFlow({ resource: 'https://other.example.com/mcp' }), res);

        const location = new URL((res.redirect as jest.Mock).mock.calls[0][0] as string);
        expect(location.origin + location.pathname).toBe('https://callback.example.com/');
        expect(location.searchParams.get('error')).toBe('invalid_target');
        expect(location.searchParams.get('state')).toBe('csrf-state-123');
        expect(location.searchParams.get('iss')).toBe('https://gitlab-mcp.example.com');
        expect(mockSessionStore.storeAuthCodeFlow).not.toHaveBeenCalled();
      });

      it('stores the requested resource and supported scopes with the flow', async () => {
        await authorizeHandler(
          codeFlow({ resource: 'https://gitlab-mcp.example.com/', scope: 'mcp:tools offline' }),
          createMockResponse() as Response,
        );

        expect(mockSessionStore.storeAuthCodeFlow).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            resource: 'https://gitlab-mcp.example.com',
            scopes: ['mcp:tools'],
          }),
        );
      });

      it('rejects a foreign resource on the device flow with a JSON error', async () => {
        const res = createMockResponse() as Response;

        await authorizeHandler(
          createMockRequest({
            response_type: 'code',
            client_id: 'cli-client',
            code_challenge: 'challenge',
            code_challenge_method: 'S256',
            resource: 'https://other.example.com',
          }) as Request,
          res,
        );

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_target',
          error_description: 'resource must name this MCP server',
        });
        expect(mockInitiateDeviceFlow).not.toHaveBeenCalled();
      });

      it('keeps the device flow open to clients without a registration', async () => {
        // Device flow has no redirect, so it does not depend on DCR (unchanged behaviour).
        mockGetRegisteredClient.mockResolvedValue(undefined);
        mockInitiateDeviceFlow.mockResolvedValue({
          device_code: 'device-code',
          user_code: 'WXYZ-0000',
          verification_uri: 'https://gitlab.example.com/oauth/authorize',
          expires_in: 600,
          interval: 5,
        });
        const res = createMockResponse() as Response;

        await authorizeHandler(
          createMockRequest({
            response_type: 'code',
            client_id: 'cli-client',
            code_challenge: 'challenge',
            code_challenge_method: 'S256',
          }) as Request,
          res,
        );

        expect(res.send).toHaveBeenCalled();
        expect(mockSessionStore.storeDeviceFlow).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            clientId: 'cli-client',
            scopes: ['mcp:tools', 'mcp:resources'],
          }),
        );
      });
    });

    describe('instance selection', () => {
      const codeFlow = (extra: Record<string, string>) =>
        createMockRequest({
          response_type: 'code',
          client_id: 'test-client',
          code_challenge: 'challenge-abc',
          code_challenge_method: 'S256',
          redirect_uri: 'https://callback.example.com',
          state: 'csrf-state-123',
          ...extra,
        }) as Request;

      beforeEach(() => {
        mockSelectableOAuthApps.mockResolvedValue([defaultApp, otherApp]);
      });

      it('offers every configured instance, keeping the rest of the request', async () => {
        const res = createMockResponse() as Response;

        await authorizeHandler(codeFlow({}), res);

        const html = (res.send as jest.Mock).mock.calls[0][0] as string;
        expect(html).toContain('instance=https%3A%2F%2Fgitlab.example.com');
        expect(html).toContain('instance=https%3A%2F%2Fgit.corp.example%2Fgitlab');
        expect(html).toContain('code_challenge=challenge-abc');
        // Labels come from configuration and are escaped.
        expect(html).toContain('Corp &lt;GitLab&gt;');
        expect(mockSessionStore.storeAuthCodeFlow).not.toHaveBeenCalled();
      });

      it('binds the chosen instance and its application to the flow', async () => {
        const res = createMockResponse() as Response;

        await authorizeHandler(codeFlow({ instance: 'https://git.corp.example/gitlab/' }), res);

        expect(mockSessionStore.storeAuthCodeFlow).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            selectedInstance: 'https://git.corp.example/gitlab',
            selectedInstanceLabel: 'Corp <GitLab>',
            requestedGitlabScopes: ['read_api'],
          }),
        );
        const { buildGitLabAuthUrl } = jest.requireMock<{ buildGitLabAuthUrl: jest.Mock }>(
          '../../../../src/oauth/gitlab-device-flow',
        );
        expect(buildGitLabAuthUrl).toHaveBeenCalledWith(
          mockConfig,
          'https://gitlab-mcp.example.com/oauth/callback',
          expect.any(String),
          otherApp,
        );
      });

      it('rejects an instance that is not configured instead of contacting it', async () => {
        const res = createMockResponse() as Response;

        await authorizeHandler(codeFlow({ instance: 'https://attacker.example' }), res);

        const location = new URL((res.redirect as jest.Mock).mock.calls[0][0] as string);
        expect(location.searchParams.get('error')).toBe('invalid_request');
        expect(location.searchParams.get('iss')).toBe('https://gitlab-mcp.example.com');
        expect(mockSessionStore.storeAuthCodeFlow).not.toHaveBeenCalled();
        expect(mockInitiateDeviceFlow).not.toHaveBeenCalled();
      });

      it('starts the device flow on the chosen instance', async () => {
        mockInitiateDeviceFlow.mockResolvedValue({
          device_code: 'device-code',
          user_code: 'CORP-0001',
          verification_uri: 'https://git.corp.example/gitlab/oauth/device',
          expires_in: 600,
          interval: 5,
        });

        await authorizeHandler(
          createMockRequest({
            response_type: 'code',
            client_id: 'cli-client',
            code_challenge: 'challenge',
            code_challenge_method: 'S256',
            instance: 'https://git.corp.example/gitlab',
          }) as Request,
          createMockResponse() as Response,
        );

        expect(mockInitiateDeviceFlow).toHaveBeenCalledWith(mockConfig, otherApp);
        expect(mockSessionStore.storeDeviceFlow).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ selectedInstance: 'https://git.corp.example/gitlab' }),
        );
      });
    });

    it('should store device flow state correctly when no redirect_uri', async () => {
      mockInitiateDeviceFlow.mockResolvedValue({
        device_code: 'device-code-456',
        user_code: 'EFGH-5678',
        verification_uri: 'https://gitlab.example.com/oauth/authorize',
        expires_in: 600,
        interval: 5,
      });

      const req = createMockRequest({
        response_type: 'code',
        client_id: 'my-client-id',
        code_challenge: 'my-challenge',
        code_challenge_method: 'S256',
        // No redirect_uri - triggers Device Flow
        state: 'my-state',
      }) as Request;
      const res = createMockResponse() as Response;

      await authorizeHandler(req, res);

      expect(mockSessionStore.storeDeviceFlow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          deviceCode: 'device-code-456',
          userCode: 'EFGH-5678',
          clientId: 'my-client-id',
          codeChallenge: 'my-challenge',
          codeChallengeMethod: 'S256',
          state: 'my-state',
          redirectUri: undefined,
        }),
      );
    });

    it.each([
      // [GitLab interval, OAUTH_DEVICE_POLL_INTERVAL, GitLab expires_in, OAUTH_DEVICE_TIMEOUT, interval, lifetime]
      [2, 5, 900, 300, 5, 300],
      [8, 5, 120, 300, 8, 120],
    ])(
      'polls every max(%i, %i)s and ends after min(%i, %i)s',
      async (gitlabInterval, minInterval, gitlabExpiry, maxLifetime, interval, lifetime) => {
        // OAUTH_DEVICE_POLL_INTERVAL is a floor, OAUTH_DEVICE_TIMEOUT a ceiling.
        mockLoadOAuthConfig.mockReturnValue({
          ...mockConfig,
          devicePollInterval: minInterval,
          deviceTimeout: maxLifetime,
        });
        mockInitiateDeviceFlow.mockResolvedValue({
          device_code: 'device-code',
          user_code: 'WXYZ-0000',
          verification_uri: 'https://gitlab.example.com/oauth/authorize',
          expires_in: gitlabExpiry,
          interval: gitlabInterval,
        });
        const res = createMockResponse() as Response;
        const before = Date.now();

        await authorizeHandler(
          createMockRequest({
            response_type: 'code',
            client_id: 'cli-client',
            code_challenge: 'challenge',
            code_challenge_method: 'S256',
          }) as Request,
          res,
        );

        const stored = mockSessionStore.storeDeviceFlow.mock.calls[0][1];
        expect(stored.interval).toBe(interval);
        expect(stored.expiresAt).toBeGreaterThanOrEqual(before + lifetime * 1000);
        expect(stored.expiresAt).toBeLessThanOrEqual(Date.now() + lifetime * 1000);
        const html = (res.send as jest.Mock).mock.calls[0][0] as string;
        expect(html).toContain(`let pollInterval = ${interval * 1000};`);
        expect(html).toContain(`<span id="countdown">${lifetime}</span>`);
      },
    );

    it('should handle device flow initiation failure', async () => {
      mockInitiateDeviceFlow.mockRejectedValue(new Error('GitLab unavailable'));

      const req = createMockRequest({
        response_type: 'code',
        client_id: 'test-client',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      }) as Request;
      const res = createMockResponse() as Response;

      await authorizeHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Failed to initiate authentication',
      });
    });

    // GitLab has the device grant from 17.2 (behind a flag, on by default from 17.3);
    // older supported instances answer 404. Without redirect_uri there is no other flow,
    // so the client is told what is missing instead of getting a server error.
    it('explains that the instance has no device authorization', async () => {
      mockInitiateDeviceFlow.mockRejectedValue(
        new GitLabOAuthHttpError('Failed to initiate device flow: 404 Not Found', 404),
      );

      const req = createMockRequest({
        response_type: 'code',
        client_id: 'test-client',
        code_challenge: 'challenge',
        code_challenge_method: 'S256',
      }) as Request;
      const res = createMockResponse() as Response;

      await authorizeHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description:
          'This GitLab instance does not support device authorization (GitLab 17.3 or later); ' +
          'authorize with a redirect_uri instead',
      });
    });
  });

  describe('pollHandler', () => {
    it('should return 500 when OAuth is not configured', async () => {
      mockLoadOAuthConfig.mockReturnValue(null);

      const req = createMockRequest({ flow_state: 'test-state' }) as Request;
      const res = createMockResponse() as Response;

      await pollHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'server_error' });
    });

    it('should return error when flow_state is missing', async () => {
      const req = createMockRequest({}) as Request;
      const res = createMockResponse() as Response;

      await pollHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        status: 'failed',
        error: 'Missing flow_state',
      });
    });

    it('should return expired when flow not found', async () => {
      mockSessionStore.getDeviceFlow.mockResolvedValue(undefined);

      const req = createMockRequest({ flow_state: 'unknown-state' }) as Request;
      const res = createMockResponse() as Response;

      await pollHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        status: 'expired',
        error: 'Flow not found',
      });
    });

    it('should return expired when device flow has expired', async () => {
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() - 1000, // Expired
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: 'state',
      });

      const req = createMockRequest({ flow_state: 'expired-flow' }) as Request;
      const res = createMockResponse() as Response;

      await pollHandler(req, res);

      expect(mockSessionStore.deleteDeviceFlow).toHaveBeenCalledWith('expired-flow');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        status: 'expired',
        error: 'Device code expired',
      });
    });

    it('should return pending when authorization not complete', async () => {
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000, // Not expired
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: 'state',
      });
      mockPollDeviceFlowStep.mockResolvedValue({ status: 'pending' }); // Still pending

      const req = createMockRequest({ flow_state: 'pending-flow' }) as Request;
      const res = createMockResponse() as Response;

      await pollHandler(req, res);

      expect(res.json).toHaveBeenCalledWith({ status: 'pending', interval: 5 });
    });

    it.each(['read_api', undefined])(
      'completes device authorization with token scope %s',
      async (scope) => {
        // Omitted scope retains the grant requested at flow creation, not a later config.
        mockSessionStore.getDeviceFlow.mockResolvedValue({
          deviceCode: 'device-code',
          userCode: 'USER-CODE',
          verificationUri: 'https://gitlab.example.com/oauth/authorize',
          expiresAt: Date.now() + 600000,
          interval: 5,
          clientId: 'test-client',
          codeChallenge: 'challenge',
          codeChallengeMethod: 'S256',
          state: 'csrf-state',
          redirectUri: 'https://callback.example.com',
          requestedGitlabScopes: ['read_api'],
        });

        mockPollDeviceFlowStep.mockResolvedValue({
          status: 'complete',
          tokens: {
            access_token: 'gitlab-access-token',
            refresh_token: 'gitlab-refresh-token',
            scope,
            token_type: 'Bearer',
            expires_in: 7200,
            created_at: Date.now(),
          },
        });

        mockGetGitLabUser.mockResolvedValue({
          id: 12345,
          username: 'testuser',
          name: 'Test User',
          email: 'test@example.com',
        });

        const req = createMockRequest({ flow_state: 'success-flow' }) as Request;
        const res = createMockResponse() as Response;

        await pollHandler(req, res);

        expect(mockGetGitLabUser).toHaveBeenCalledWith('gitlab-access-token', defaultApp.baseUrl);
        expect(mockSessionStore.storeAuthCode).toHaveBeenCalled();
        // Persist the grant GitLab returned, not the scopes requested by the MCP client.
        expect(mockSessionStore.createSession).toHaveBeenCalledWith(
          expect.objectContaining({ gitlabScopes: ['read_api'] }),
        );
        // The completed flow is taken (removed) atomically by this poller.
        expect(mockSessionStore.consumeDeviceFlow).toHaveBeenCalledWith('success-flow');

        expect(res.json).toHaveBeenCalledWith({
          status: 'complete',
          redirect_uri: 'https://callback.example.com',
          code: 'auth-code-abc',
          state: 'csrf-state',
          // RFC 9207: the page appends iss to the client redirect.
          iss: 'https://gitlab-mcp.example.com',
        });
      },
    );

    it('should handle terminal errors from GitLab', async () => {
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000,
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: 'state',
      });

      mockPollDeviceFlowStep.mockRejectedValue(new Error('Authorization denied by user'));

      const req = createMockRequest({ flow_state: 'denied-flow' }) as Request;
      const res = createMockResponse() as Response;

      await pollHandler(req, res);

      expect(mockSessionStore.deleteDeviceFlow).toHaveBeenCalledWith('denied-flow');
      expect(res.json).toHaveBeenCalledWith({
        status: 'failed',
        error: 'Authorization denied by user',
      });
    });

    it('should treat transient errors as pending', async () => {
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000,
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: 'state',
      });

      mockPollDeviceFlowStep.mockRejectedValue(new Error('Network timeout'));

      const req = createMockRequest({ flow_state: 'transient-error-flow' }) as Request;
      const res = createMockResponse() as Response;

      await pollHandler(req, res);

      // Should NOT delete flow for transient errors
      expect(mockSessionStore.deleteDeviceFlow).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ status: 'pending', interval: 5 });
    });

    it('should omit state from response when not provided', async () => {
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000,
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: '', // Empty state
        redirectUri: 'https://callback.example.com',
      });

      mockPollDeviceFlowStep.mockResolvedValue({
        status: 'complete',
        tokens: {
          access_token: 'gitlab-access-token',
          refresh_token: 'gitlab-refresh-token',
          token_type: 'Bearer',
          expires_in: 7200,
          created_at: Date.now(),
        },
      });

      mockGetGitLabUser.mockResolvedValue({
        id: 12345,
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
      });

      const req = createMockRequest({ flow_state: 'no-state-flow' }) as Request;
      const res = createMockResponse() as Response;

      await pollHandler(req, res);

      expect(res.json).toHaveBeenCalledWith({
        status: 'complete',
        redirect_uri: 'https://callback.example.com',
        code: 'auth-code-abc',
        state: undefined, // State should be undefined when empty
        iss: 'https://gitlab-mcp.example.com',
      });
    });

    describe('polling cadence (RFC 8628 3.4, 3.5)', () => {
      const pendingFlow = {
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000,
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: '',
      };

      it('does not poll GitLab before the interval has passed', async () => {
        mockSessionStore.getDeviceFlow.mockResolvedValue({
          ...pendingFlow,
          nextPollAt: Date.now() + 3000,
        });
        const res = createMockResponse() as Response;

        await pollHandler(createMockRequest({ flow_state: 'early' }) as Request, res);

        expect(mockPollDeviceFlowStep).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ status: 'pending', interval: 5 });
      });

      it('schedules the next poll one interval later while pending', async () => {
        mockSessionStore.getDeviceFlow.mockResolvedValue({ ...pendingFlow });
        mockPollDeviceFlowStep.mockResolvedValue({ status: 'pending' });
        const res = createMockResponse() as Response;
        const before = Date.now();

        await pollHandler(createMockRequest({ flow_state: 'pending' }) as Request, res);

        const stored = mockSessionStore.storeDeviceFlow.mock.calls[0][1];
        expect(stored.interval).toBe(5);
        expect(stored.nextPollAt).toBeGreaterThanOrEqual(before + 5000);
        expect(res.json).toHaveBeenCalledWith({ status: 'pending', interval: 5 });
      });

      // The reservation covers the GitLab request: a replica polling the same device code
      // while it is in flight could get invalid_grant and end the approved flow.
      it('reserves the flow until the GitLab request can no longer be running', async () => {
        mockSessionStore.getDeviceFlow.mockResolvedValue({ ...pendingFlow });
        mockPollDeviceFlowStep.mockResolvedValue({ status: 'pending' });
        const before = Date.now();

        await pollHandler(
          createMockRequest({ flow_state: 'reserved' }) as Request,
          createMockResponse() as Response,
        );

        const [, now, reservedUntil] = mockSessionStore.claimDevicePoll.mock.calls[0];
        expect(now).toBeGreaterThanOrEqual(before);
        expect(reservedUntil - now).toBeGreaterThanOrEqual(GITLAB_REQUEST_MAX_MS);
      });

      it('returns to the interval after a temporary failure', async () => {
        mockSessionStore.getDeviceFlow.mockResolvedValue({ ...pendingFlow });
        mockPollDeviceFlowStep.mockRejectedValue(new Error('Network timeout'));
        const before = Date.now();

        await pollHandler(
          createMockRequest({ flow_state: 'transient' }) as Request,
          createMockResponse() as Response,
        );

        const stored = mockSessionStore.storeDeviceFlow.mock.calls[0][1];
        expect(stored.nextPollAt).toBeGreaterThanOrEqual(before + 5000);
        expect(stored.nextPollAt).toBeLessThan(before + GITLAB_REQUEST_MAX_MS);
      });

      // The flow completed or expired on another replica while this poll failed: it is
      // not written back.
      it('does not recreate a flow removed during a failed poll', async () => {
        // The flow disappears once GitLab has been polled (the reservation reads it too).
        mockSessionStore.getDeviceFlow.mockImplementation(async () =>
          mockPollDeviceFlowStep.mock.calls.length > 0 ? undefined : { ...pendingFlow },
        );
        mockPollDeviceFlowStep.mockRejectedValue(new Error('Network timeout'));

        await pollHandler(
          createMockRequest({ flow_state: 'gone' }) as Request,
          createMockResponse() as Response,
        );

        expect(mockPollDeviceFlowStep).toHaveBeenCalled();
        expect(mockSessionStore.storeDeviceFlow).not.toHaveBeenCalled();
      });

      // Rescheduling is best effort: the reservation expires on its own.
      it('still answers the poll when the next poll cannot be scheduled', async () => {
        mockSessionStore.getDeviceFlow.mockResolvedValue({ ...pendingFlow });
        mockPollDeviceFlowStep.mockRejectedValue(new Error('Network timeout'));
        mockSessionStore.storeDeviceFlow.mockRejectedValueOnce(new Error('database down'));
        const res = createMockResponse() as Response;

        await pollHandler(createMockRequest({ flow_state: 'unscheduled' }) as Request, res);

        expect(res.json).toHaveBeenCalled();
      });

      it('adds 5 seconds to the interval on slow_down', async () => {
        mockSessionStore.getDeviceFlow.mockResolvedValue({ ...pendingFlow });
        mockPollDeviceFlowStep.mockResolvedValue({ status: 'slow_down' });
        const res = createMockResponse() as Response;
        const before = Date.now();

        await pollHandler(createMockRequest({ flow_state: 'slow' }) as Request, res);

        const stored = mockSessionStore.storeDeviceFlow.mock.calls[0][1];
        expect(stored.interval).toBe(10);
        expect(stored.nextPollAt).toBeGreaterThanOrEqual(before + 10000);
        expect(res.json).toHaveBeenCalledWith({ status: 'pending', interval: 10 });
      });
    });

    it('creates one session when another poller completed the flow first', async () => {
      // Two polls saw GitLab complete; only the poller that takes the flow signs in.
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000,
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: '',
      });
      mockSessionStore.consumeDeviceFlow.mockResolvedValue(undefined);
      mockPollDeviceFlowStep.mockResolvedValue({
        status: 'complete',
        tokens: {
          access_token: 'gitlab-access-token',
          refresh_token: 'gitlab-refresh-token',
          token_type: 'Bearer',
          expires_in: 7200,
          created_at: Date.now(),
        },
      });
      const res = createMockResponse() as Response;

      await pollHandler(createMockRequest({ flow_state: 'raced-flow' }) as Request, res);

      // The loser's session and code are removed again; only the winner's remain.
      const sessionId = mockSessionStore.createSession.mock.calls[0][0].id;
      const code = mockSessionStore.storeAuthCode.mock.calls[0][0].code;
      expect(mockSessionStore.deleteSession).toHaveBeenCalledWith(sessionId);
      expect(mockSessionStore.deleteAuthCode).toHaveBeenCalledWith(code);
      expect(res.json).toHaveBeenCalledWith({ status: 'pending', interval: 5 });
    });

    // Removing the loser's records is best effort: its code expires unexchanged anyway.
    it('answers the losing poll when its records cannot be removed', async () => {
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000,
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: '',
      });
      mockSessionStore.consumeDeviceFlow.mockResolvedValue(undefined);
      mockSessionStore.deleteAuthCode.mockRejectedValueOnce(new Error('database down'));
      mockPollDeviceFlowStep.mockResolvedValue({
        status: 'complete',
        tokens: {
          access_token: 'gitlab-access-token',
          refresh_token: 'gitlab-refresh-token',
          token_type: 'Bearer',
          expires_in: 7200,
          created_at: Date.now(),
        },
      });
      const res = createMockResponse() as Response;

      await pollHandler(createMockRequest({ flow_state: 'raced-flow' }) as Request, res);

      expect(res.json).toHaveBeenCalledWith({ status: 'pending', interval: 5 });
    });

    // GitLab's tokens are kept with the flow until the session and code exist, so a
    // storage failure while creating them is retried by the next poll.
    it('keeps an approved flow when the session cannot be created', async () => {
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000,
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: '',
      });
      mockPollDeviceFlowStep.mockResolvedValue({
        status: 'complete',
        tokens: {
          access_token: 'gitlab-access-token',
          refresh_token: 'gitlab-refresh-token',
          token_type: 'Bearer',
          expires_in: 7200,
          created_at: Date.now(),
        },
      });
      mockGetGitLabUser.mockResolvedValue({ id: 1, username: 'u' });
      mockSessionStore.createSession.mockRejectedValueOnce(new Error('database down'));
      const res = createMockResponse() as Response;

      await pollHandler(createMockRequest({ flow_state: 'storage-down' }) as Request, res);

      expect(mockSessionStore.consumeDeviceFlow).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ status: 'pending', interval: 5 });
    });

    it('creates the session before the code that references it', async () => {
      // The PostgreSQL code row has a foreign key on the session.
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000,
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: '',
      });
      mockPollDeviceFlowStep.mockResolvedValue({
        status: 'complete',
        tokens: {
          access_token: 'gitlab-access-token',
          refresh_token: 'gitlab-refresh-token',
          token_type: 'Bearer',
          expires_in: 7200,
          created_at: Date.now(),
        },
      });
      mockGetGitLabUser.mockResolvedValue({ id: 1, username: 'u' });

      await pollHandler(
        createMockRequest({ flow_state: 'ordered-flow' }) as Request,
        createMockResponse() as Response,
      );

      expect(mockSessionStore.createSession.mock.invocationCallOrder[0]).toBeLessThan(
        mockSessionStore.storeAuthCode.mock.invocationCallOrder[0],
      );
    });

    it('fails the flow when its instance is no longer configured', async () => {
      // Never falls back to another instance with the user's device code.
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000,
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: '',
        selectedInstance: 'https://removed.example.com',
      });
      mockOauthAppFor.mockResolvedValue(undefined);
      const res = createMockResponse() as Response;

      await pollHandler(createMockRequest({ flow_state: 'orphan-flow' }) as Request, res);

      expect(mockOauthAppFor).toHaveBeenCalledWith(mockConfig, 'https://removed.example.com');
      expect(mockPollDeviceFlowStep).not.toHaveBeenCalled();
      expect(mockSessionStore.deleteDeviceFlow).toHaveBeenCalledWith('orphan-flow');
      expect(res.json).toHaveBeenCalledWith({
        status: 'failed',
        error: 'GitLab instance is no longer configured',
      });
    });

    it('creates the session with the scopes and resource bound at /authorize', async () => {
      mockSessionStore.getDeviceFlow.mockResolvedValue({
        deviceCode: 'device-code',
        userCode: 'USER-CODE',
        verificationUri: 'https://gitlab.example.com/oauth/authorize',
        expiresAt: Date.now() + 600000,
        interval: 5,
        clientId: 'test-client',
        codeChallenge: 'challenge',
        codeChallengeMethod: 'S256',
        state: '',
        scopes: ['mcp:tools'],
        resource: 'https://gitlab-mcp.example.com',
      });
      mockPollDeviceFlowStep.mockResolvedValue({
        status: 'complete',
        tokens: {
          access_token: 'gitlab-access-token',
          refresh_token: 'gitlab-refresh-token',
          token_type: 'Bearer',
          expires_in: 7200,
          created_at: Date.now(),
        },
      });
      mockGetGitLabUser.mockResolvedValue({ id: 12345, username: 'testuser' });

      await pollHandler(
        createMockRequest({ flow_state: 'bound-flow' }) as Request,
        createMockResponse() as Response,
      );

      expect(mockSessionStore.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: ['mcp:tools'],
          resource: 'https://gitlab-mcp.example.com',
        }),
      );
    });
  });

  // Storage outages and malformed parameters end in an error response, never in a
  // redirect to an unchecked target or a crash.
  describe('failure and malformed input paths', () => {
    const codeRequest = (extra: Record<string, unknown> = {}): Request =>
      ({
        ...createMockRequest(),
        query: {
          response_type: 'code',
          client_id: 'test-client',
          code_challenge: 'challenge',
          code_challenge_method: 'S256',
          redirect_uri: 'https://callback.example.com',
          state: 'client-state',
          ...extra,
        },
      }) as unknown as Request;

    // Without a redirect_uri there is no client to send the error to: answer directly.
    it('rejects an unconfigured instance in the device flow with a JSON error', async () => {
      const res = createMockResponse() as Response;
      const req = codeRequest({ instance: 'https://unknown.example.com' });
      delete (req.query as Record<string, unknown>).redirect_uri;

      await authorizeHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'instance is not a configured GitLab instance',
      });
      expect(mockInitiateDeviceFlow).not.toHaveBeenCalled();
    });

    it('answers 500 when the client registration cannot be read', async () => {
      mockGetRegisteredClient.mockRejectedValueOnce(new Error('database down'));
      const res = createMockResponse() as Response;

      await authorizeHandler(codeRequest(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('rejects repeated resources when one is foreign', async () => {
      const res = createMockResponse() as Response;

      await authorizeHandler(
        codeRequest({ resource: ['https://gitlab-mcp.example.com', 'https://other.example'] }),
        res,
      );

      const location = new URL((res.redirect as jest.Mock).mock.calls[0][0] as string);
      expect(location.searchParams.get('error')).toBe('invalid_target');
    });

    // RFC 8707 section 2: resource may repeat. A token here has one audience, so values
    // naming the same resource are accepted and bound once.
    it('accepts a resource repeated with the same target', async () => {
      const res = createMockResponse() as Response;

      await authorizeHandler(
        codeRequest({
          resource: ['https://gitlab-mcp.example.com/mcp', 'https://gitlab-mcp.example.com/mcp'],
        }),
        res,
      );

      expect(mockSessionStore.storeAuthCodeFlow).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ resource: 'https://gitlab-mcp.example.com/mcp' }),
      );
    });

    // Two different resources of this server cannot share one audience: RFC 8707 section 2
    // lets the server refuse what it cannot issue with invalid_target.
    it('rejects repeated resources naming two different targets of this server', async () => {
      const res = createMockResponse() as Response;

      await authorizeHandler(
        codeRequest({
          resource: ['https://gitlab-mcp.example.com', 'https://gitlab-mcp.example.com/mcp'],
        }),
        res,
      );

      const location = new URL((res.redirect as jest.Mock).mock.calls[0][0] as string);
      expect(location.searchParams.get('error')).toBe('invalid_target');
      expect(mockSessionStore.storeAuthCodeFlow).not.toHaveBeenCalled();
    });

    // RFC 6749 section 3.1: parameters must not repeat. A repeated scope crashed the
    // handler; a repeated redirect_uri must not be redirected to either.
    it.each(['scope', 'redirect_uri', 'state', 'client_id', 'instance'])(
      'rejects a repeated %s with invalid_request',
      async (name) => {
        const res = createMockResponse() as Response;

        await authorizeHandler(codeRequest({ [name]: ['a', 'b'] }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_request',
          error_description: `${name} must not be repeated`,
        });
        expect(res.redirect).not.toHaveBeenCalled();
      },
    );

    it('sends the client back with temporarily_unavailable when the flow cannot be stored', async () => {
      mockSessionStore.storeAuthCodeFlow.mockRejectedValueOnce(new Error('database down'));
      const res = createMockResponse() as Response;

      await authorizeHandler(codeRequest(), res);

      const location = new URL((res.redirect as jest.Mock).mock.calls[0][0] as string);
      expect(location.origin + location.pathname).toBe('https://callback.example.com/');
      expect(location.searchParams.get('error')).toBe('temporarily_unavailable');
      expect(location.searchParams.get('state')).toBe('client-state');
      expect(location.searchParams.get('iss')).toBe(mockConfig.issuer);
    });

    it('keeps the device page polling when the flow cannot be read', async () => {
      mockSessionStore.getDeviceFlow.mockRejectedValueOnce(new Error('database down'));
      const res = createMockResponse() as Response;

      await pollHandler(
        { ...createMockRequest(), query: { flow_state: 'flow' } } as unknown as Request,
        res,
      );

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ status: 'pending' });
    });

    it('drops repeated query values from the instance chooser links', async () => {
      mockSelectableOAuthApps.mockResolvedValueOnce([defaultApp, otherApp]);
      const res = createMockResponse() as Response;
      const req = codeRequest({ ui_locales: ['en', 'de'] });
      delete (req.query as Record<string, unknown>).redirect_uri;

      await authorizeHandler(req, res);

      const html = (res.send as jest.Mock).mock.calls[0][0] as string;
      expect(html).toContain('instance=');
      expect(html).not.toContain('ui_locales=');
    });
  });
});
