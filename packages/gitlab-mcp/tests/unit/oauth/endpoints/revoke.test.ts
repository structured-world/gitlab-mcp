/**
 * Token revocation (RFC 7009): disconnecting an account ends the MCP session on every
 * replica and the linked GitLab grant.
 */

import { Request, Response } from 'express';
import { revokeHandler } from '../../../../src/oauth/endpoints/revoke';
import { loadOAuthConfig } from '../../../../src/oauth/config';
import { sessionStore } from '../../../../src/oauth/session-store';
import { oauthAppFor } from '../../../../src/oauth/instance-app';
import { revokeGitLabToken } from '../../../../src/oauth/gitlab-device-flow';
import { withFreshGitLabToken } from '../../../../src/oauth/gitlab-token-refresh';
import { getRegisteredClient } from '../../../../src/oauth/endpoints/register';
import type { OAuthSession } from '../../../../src/oauth/types';

jest.mock('../../../../src/oauth/config', () => ({ loadOAuthConfig: jest.fn() }));
jest.mock('../../../../src/oauth/session-store', () => ({
  sessionStore: {
    getSessionByRefreshToken: jest.fn(),
    getSessionByToken: jest.fn(),
    deleteSession: jest.fn(),
  },
}));
jest.mock('../../../../src/oauth/instance-app', () => ({ oauthAppFor: jest.fn() }));
jest.mock('../../../../src/oauth/gitlab-device-flow', () => ({ revokeGitLabToken: jest.fn() }));
jest.mock('../../../../src/oauth/gitlab-token-refresh', () => ({
  withFreshGitLabToken: jest.fn(async (s: unknown) => s),
}));
jest.mock('../../../../src/oauth/endpoints/register', () => ({
  getRegisteredClient: jest.fn(),
}));
jest.mock('../../../../src/logger', () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  truncateId: (id: string) => id,
}));

const mockConfig = loadOAuthConfig as jest.MockedFunction<typeof loadOAuthConfig>;
const mockStore = sessionStore as jest.Mocked<typeof sessionStore>;
const mockAppFor = oauthAppFor as jest.MockedFunction<typeof oauthAppFor>;
const mockRevokeGitLab = revokeGitLabToken as jest.MockedFunction<typeof revokeGitLabToken>;
const mockFresh = withFreshGitLabToken as jest.MockedFunction<typeof withFreshGitLabToken>;
const mockRegistered = getRegisteredClient as jest.MockedFunction<typeof getRegisteredClient>;

const config = { issuer: 'https://mcp.example.com' } as ReturnType<typeof loadOAuthConfig>;
const app = { baseUrl: 'https://gitlab.example.com', clientId: 'app', scopes: 'api' };
const session: OAuthSession = {
  id: 'session-1',
  mcpAccessToken: 'access-1',
  mcpRefreshToken: 'refresh-1',
  mcpTokenExpiry: Date.now() + 3600000,
  gitlabAccessToken: 'gl-access',
  gitlabRefreshToken: 'gl-refresh',
  gitlabTokenExpiry: Date.now() + 7200000,
  gitlabUserId: 1,
  gitlabUsername: 'u',
  gitlabApiUrl: 'https://gitlab.example.com',
  clientId: 'client-1',
  scopes: ['mcp:tools'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function revoke(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };
  return { req: { body, headers } as Request, res: res as unknown as Response & typeof res };
}

describe('revokeHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.mockReturnValue(config);
    mockStore.getSessionByRefreshToken.mockResolvedValue(undefined);
    mockStore.getSessionByToken.mockResolvedValue(undefined);
    mockStore.deleteSession.mockResolvedValue(true);
    mockAppFor.mockResolvedValue(app);
    mockRevokeGitLab.mockResolvedValue(undefined);
    mockRegistered.mockResolvedValue(undefined);
  });

  // RFC 7009 section 2.1: the client authenticates as at the token endpoint. A client
  // registered with a secret sends it in the Authorization header without client_id, and
  // a request naming it without the secret must not end its user's session.
  describe('client authentication', () => {
    const confidential = {
      client_id: 'client-1',
      client_secret: 's3cret',
      created_at: 0,
      redirect_uris: ['https://client.example.com/cb'],
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    };
    const basic = `Basic ${Buffer.from('client-1:s3cret').toString('base64')}`;

    beforeEach(() => {
      mockRegistered.mockResolvedValue(confidential);
      mockStore.getSessionByRefreshToken.mockResolvedValue(session);
    });

    it('revokes for a client authenticated by the Authorization header', async () => {
      const { req, res } = revoke({ token: 'refresh-1' }, { authorization: basic });

      await revokeHandler(req, res);

      expect(mockStore.deleteSession).toHaveBeenCalledWith('session-1');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    // RFC 6749 section 5.2: a client that tried the Authorization header gets the scheme.
    it('challenges a client whose Authorization header carries the wrong secret', async () => {
      const wrong = `Basic ${Buffer.from('client-1:wrong').toString('base64')}`;
      const { req, res } = revoke({ token: 'refresh-1' }, { authorization: wrong });

      await revokeHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.set).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="gitlab-mcp"');
      expect(mockStore.deleteSession).not.toHaveBeenCalled();
    });

    it('refuses a confidential client without its secret', async () => {
      const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

      await revokeHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_client',
        error_description: 'Client authentication failed',
      });
      expect(mockStore.deleteSession).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['refresh token', 'refresh-1', 'getSessionByRefreshToken'],
    ['access token', 'access-1', 'getSessionByToken'],
  ] as const)('ends the session when its %s is revoked', async (_kind, token, lookup) => {
    mockStore[lookup].mockResolvedValue(session);
    const { req, res } = revoke({ token, client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(mockStore.deleteSession).toHaveBeenCalledWith('session-1');
    expect(mockRevokeGitLab).toHaveBeenCalledWith('gl-access', config, app);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // RFC 6749 section 3.2: parameters must not repeat. A repeated token matched no session
  // and was answered as revoked while the session stayed active.
  it.each(['token', 'client_id'])('rejects a repeated %s before any lookup', async (name) => {
    const { req, res } = revoke({
      token: 'refresh-1',
      client_id: 'client-1',
      [name]: ['a', 'b'],
    });

    await revokeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: `${name} must not be repeated`,
    });
    expect(mockStore.getSessionByRefreshToken).not.toHaveBeenCalled();
  });

  it('answers 200 for an unknown or already revoked token (RFC 7009 2.2)', async () => {
    const { req, res } = revoke({ token: 'unknown', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockStore.deleteSession).not.toHaveBeenCalled();
  });

  it('refuses to revoke a token issued to another client (RFC 7009 2.1)', async () => {
    mockStore.getSessionByRefreshToken.mockResolvedValue(session);
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'other-client' });

    await revokeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockStore.deleteSession).not.toHaveBeenCalled();
  });

  it.each([
    [{ client_id: 'client-1' }, 'Missing token'],
    [{ token: 'refresh-1' }, 'Missing client_id'],
  ])('rejects an incomplete request %j', async (body, description) => {
    const { req, res } = revoke(body);

    await revokeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'invalid_request',
      error_description: description,
    });
  });

  it('keeps the MCP revocation when GitLab cannot be reached', async () => {
    mockStore.getSessionByRefreshToken.mockResolvedValue(session);
    mockRevokeGitLab.mockRejectedValue(new Error('fetch failed'));
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(mockStore.deleteSession).toHaveBeenCalledWith('session-1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // GitLab does not revoke an expired access token, and its refresh token stays usable:
  // the grant is refreshed first so the revocation reaches a live token.
  it('refreshes an expired GitLab grant and revokes the fresh token', async () => {
    const expired = { ...session, gitlabTokenExpiry: Date.now() - 1000 };
    mockStore.getSessionByRefreshToken.mockResolvedValue(expired);
    mockFresh.mockResolvedValueOnce({ ...expired, gitlabAccessToken: 'gl-fresh' });
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(mockFresh).toHaveBeenCalledWith(expired, config);
    expect(mockRevokeGitLab).toHaveBeenCalledWith('gl-fresh', config, app);
    expect(mockStore.deleteSession).toHaveBeenCalledWith('session-1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still disconnects when the expired grant cannot be refreshed', async () => {
    const expired = { ...session, gitlabTokenExpiry: Date.now() - 1000 };
    mockStore.getSessionByRefreshToken.mockResolvedValue(expired);
    mockFresh.mockRejectedValueOnce(new Error('GitLab refused the refresh token'));
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(mockStore.deleteSession).toHaveBeenCalledWith('session-1');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // A concurrent revocation removed the session during the refresh: the token at hand is
  // still revoked at GitLab.
  it('revokes the known GitLab token when the session vanished during the refresh', async () => {
    mockStore.getSessionByRefreshToken.mockResolvedValue(session);
    mockFresh.mockResolvedValueOnce(undefined);
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(mockRevokeGitLab).toHaveBeenCalledWith('gl-access', config, app);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('answers 500 when OAuth is not configured', async () => {
    mockConfig.mockReturnValue(null);
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(mockStore.deleteSession).not.toHaveBeenCalled();
  });

  // The session ends even when its instance is gone; there is no GitLab grant to revoke
  // through another instance's application.
  it('ends the session without calling GitLab when its instance is no longer configured', async () => {
    mockStore.getSessionByRefreshToken.mockResolvedValue(session);
    mockAppFor.mockResolvedValue(undefined);
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(mockStore.deleteSession).toHaveBeenCalledWith('session-1');
    expect(mockRevokeGitLab).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // A failed delete must not be reported as revoked: the tokens would stay usable.
  it('answers 503 when the session cannot be deleted', async () => {
    mockStore.getSessionByRefreshToken.mockResolvedValue(session);
    mockStore.deleteSession.mockRejectedValue(new Error('database down'));
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(mockRevokeGitLab).not.toHaveBeenCalled();
  });

  it('answers 200 when a concurrent revocation already removed the session', async () => {
    mockStore.getSessionByRefreshToken.mockResolvedValue(session);
    mockStore.deleteSession.mockResolvedValue(false);
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('answers 503 when storage is unavailable (RFC 7009 2.2.1)', async () => {
    mockStore.getSessionByRefreshToken.mockRejectedValue(new Error('database down'));
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });
});
