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

function revoke(body: Record<string, string>) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  };
  return { req: { body } as Request, res: res as unknown as Response & typeof res };
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

  it('answers 503 when storage is unavailable (RFC 7009 2.2.1)', async () => {
    mockStore.getSessionByRefreshToken.mockRejectedValue(new Error('database down'));
    const { req, res } = revoke({ token: 'refresh-1', client_id: 'client-1' });

    await revokeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
  });
});
