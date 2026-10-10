/**
 * Unit tests for OAuth Dynamic Client Registration endpoint
 */

import { Request, Response } from 'express';
import {
  registerHandler,
  getRegisteredClient,
  isValidRedirectUri,
  REGISTRATIONS_PER_SOURCE_PER_HOUR,
} from '../../../../src/oauth/endpoints/register';
import { sessionStore } from '../../../../src/oauth/session-store';
import { loadOAuthConfig } from '../../../../src/oauth/config';

jest.mock('../../../../src/oauth/config', () => ({
  loadOAuthConfig: jest.fn(() => ({ sessionSecret: 'test-session-secret-at-least-32-chars!' })),
}));

// Mock logger (registrations go through the real session storage, which also logs)
jest.mock('../../../../src/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
  logDebug: jest.fn(),
  truncateId: (id: string) => id,
}));

describe('OAuth Dynamic Client Registration', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonFn: jest.Mock;
  let statusFn: jest.Mock;

  beforeEach(() => {
    jsonFn = jest.fn();
    statusFn = jest.fn().mockReturnValue({ json: jsonFn });

    mockReq = {
      body: {},
    };
    mockRes = {
      status: statusFn,
      json: jsonFn,
    };

    jest.clearAllMocks();
  });

  describe('registerHandler', () => {
    async function registerFrom(ip: string): Promise<string> {
      const json = jest.fn();
      await registerHandler(
        { ip, body: { redirect_uris: ['https://example.com/callback'] } } as unknown as Request,
        { status: jest.fn().mockReturnValue({ json }) } as unknown as Response,
      );
      return (json.mock.calls[0][0] as { client_id: string }).client_id;
    }

    // The source of a registration is keyed with the session secret: without OAuth
    // configuration nothing is registered.
    it('answers server_error when OAuth is not configured', async () => {
      (loadOAuthConfig as jest.Mock).mockReturnValueOnce(null);

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(500);
      expect(jsonFn).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'OAuth not configured',
      });
    });

    // Anonymous registrations are durable: each records a keyed hash of its source and
    // expires unless the client completes an authorization.
    it('records the source and an expiry of a registration', async () => {
      const id = await registerFrom('198.51.100.7');

      const stored = await sessionStore.getClient(id);
      expect(stored?.registeredFrom).toMatch(/^[\w-]{16,}$/);
      expect(stored?.registeredFrom).not.toContain('198.51.100.7');
      expect(stored?.expiresAt).toBeGreaterThan(Date.now() + 23 * 3600_000);
      expect(
        await registerFrom('198.51.100.7').then((other) => sessionStore.getClient(other)),
      ).toMatchObject({ registeredFrom: stored?.registeredFrom });
    });

    // Over its hourly limit a source is refused rather than losing registrations: a client
    // that registered earlier (possibly behind the same proxy or NAT, and still signing in)
    // is never removed by someone else's registrations.
    it('refuses registrations beyond the hourly limit of a source and keeps earlier ones', async () => {
      const first = await registerFrom('203.0.113.9');
      for (let i = 1; i < REGISTRATIONS_PER_SOURCE_PER_HOUR; i++) {
        await registerFrom('203.0.113.9');
      }
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const set = jest.fn();

      await registerHandler(
        {
          ip: '203.0.113.9',
          body: { redirect_uris: ['https://example.com/callback'] },
        } as unknown as Request,
        { status, set } as unknown as Response,
      );

      expect(status).toHaveBeenCalledWith(429);
      expect(set).toHaveBeenCalledWith('Retry-After', '3600');
      expect(json).toHaveBeenCalledWith({
        error: 'temporarily_unavailable',
        error_description: 'Too many client registrations from this address; retry later',
      });
      expect(await sessionStore.getClient(first)).toBeDefined();
      expect(await registerFrom('203.0.113.10')).toEqual(expect.any(String));
    });

    it('treats an expired unused registration as unknown', async () => {
      const id = await registerFrom('192.0.2.44');
      const stored = await sessionStore.getClient(id);
      await sessionStore.storeClient({ ...stored!, expiresAt: Date.now() - 1 });

      expect(await getRegisteredClient(id)).toBeUndefined();
    });

    it('should register a public client successfully', async () => {
      mockReq.body = {
        redirect_uris: ['https://example.com/callback'],
        client_name: 'Test Client',
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(201);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: expect.any(String),
          redirect_uris: ['https://example.com/callback'],
          client_name: 'Test Client',
          token_endpoint_auth_method: 'none',
        }),
      );
      // Public clients should not have client_secret
      expect(jsonFn.mock.calls[0][0].client_secret).toBeUndefined();
    });

    it('should register a confidential client with secret', async () => {
      mockReq.body = {
        redirect_uris: ['https://example.com/callback'],
        client_name: 'Confidential Client',
        token_endpoint_auth_method: 'client_secret_post',
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(201);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: expect.any(String),
          client_secret: expect.any(String),
          token_endpoint_auth_method: 'client_secret_post',
        }),
      );
    });

    // RFC 7591 section 3.2.2: a method the token endpoint cannot authenticate is refused
    // instead of registering a client whose credentials would never be checked.
    it('rejects an unsupported token endpoint auth method', async () => {
      mockReq.body = {
        redirect_uris: ['https://example.com/callback'],
        token_endpoint_auth_method: 'private_key_jwt',
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({
        error: 'invalid_client_metadata',
        error_description:
          'token_endpoint_auth_method must be one of none, client_secret_basic, client_secret_post',
      });
    });

    it('should reject missing redirect_uris', async () => {
      mockReq.body = {
        client_name: 'Test Client',
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris is required and must be a non-empty array',
      });
    });

    it('should reject empty redirect_uris array', async () => {
      mockReq.body = {
        redirect_uris: [],
        client_name: 'Test Client',
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris is required and must be a non-empty array',
      });
    });

    it('should reject non-array redirect_uris', async () => {
      mockReq.body = {
        redirect_uris: 'not-an-array',
        client_name: 'Test Client',
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({
        error: 'invalid_client_metadata',
        error_description: 'redirect_uris is required and must be a non-empty array',
      });
    });

    it('should reject invalid redirect URI', async () => {
      mockReq.body = {
        redirect_uris: ['not-a-valid-url'],
        client_name: 'Test Client',
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(400);
      expect(jsonFn).toHaveBeenCalledWith({
        error: 'invalid_redirect_uri',
        error_description: 'Invalid redirect URI: not-a-valid-url',
      });
    });

    it('should use default grant_types and response_types', async () => {
      mockReq.body = {
        redirect_uris: ['https://example.com/callback'],
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(201);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        }),
      );
    });

    it('should handle multiple redirect_uris', async () => {
      mockReq.body = {
        redirect_uris: ['https://example.com/callback', 'https://example.com/oauth/callback'],
      };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(201);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          redirect_uris: ['https://example.com/callback', 'https://example.com/oauth/callback'],
        }),
      );
    });

    it('should handle unexpected errors', async () => {
      // Create a getter that throws on access to body
      const badReq = {
        get body() {
          throw new Error('Unexpected error');
        },
      } as unknown as Request;

      await registerHandler(badReq, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(500);
      expect(jsonFn).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Failed to register client',
      });
    });
  });

  describe('getRegisteredClient', () => {
    it('should return undefined for unregistered client', async () => {
      const client = await getRegisteredClient('non-existent-client-id');
      expect(client).toBeUndefined();
    });

    it('should return registered client data', async () => {
      mockReq.body = {
        redirect_uris: ['https://example.com/callback'],
        client_name: 'Lookup Test Client',
      };

      await registerHandler(mockReq as Request, mockRes as Response);
      const registeredClientId = jsonFn.mock.calls[0][0].client_id;

      const client = await getRegisteredClient(registeredClientId);
      expect(client).toBeDefined();
      expect(client?.client_name).toBe('Lookup Test Client');
    });

    it('should keep the registration in the shared session storage', async () => {
      // Another replica or a restarted process resolves the client from the backend.
      mockReq.body = { redirect_uris: ['https://example.com/callback'] };

      await registerHandler(mockReq as Request, mockRes as Response);
      const registeredClientId = jsonFn.mock.calls[0][0].client_id;

      expect((await sessionStore.getClient(registeredClientId))?.redirectUris).toEqual([
        'https://example.com/callback',
      ]);
    });

    it('should fail the registration when it cannot be stored', async () => {
      // Never hand out a client_id that no replica will recognise.
      jest.spyOn(sessionStore, 'storeClient').mockRejectedValueOnce(new Error('database down'));
      mockReq.body = { redirect_uris: ['https://example.com/callback'] };

      await registerHandler(mockReq as Request, mockRes as Response);

      expect(statusFn).toHaveBeenCalledWith(500);
    });
  });

  describe('isValidRedirectUri', () => {
    it('should return true for unregistered client (backward compatibility)', async () => {
      const isValid = await isValidRedirectUri('unknown-client', 'https://any-uri.com/callback');
      expect(isValid).toBe(true);
    });

    it('should return true for valid redirect URI', async () => {
      mockReq.body = {
        redirect_uris: ['https://valid.com/callback'],
      };

      await registerHandler(mockReq as Request, mockRes as Response);
      const registeredClientId = jsonFn.mock.calls[0][0].client_id;

      const isValid = await isValidRedirectUri(registeredClientId, 'https://valid.com/callback');
      expect(isValid).toBe(true);
    });

    it('should return false for invalid redirect URI', async () => {
      mockReq.body = {
        redirect_uris: ['https://valid.com/callback'],
      };

      await registerHandler(mockReq as Request, mockRes as Response);
      const registeredClientId = jsonFn.mock.calls[0][0].client_id;

      const isValid = await isValidRedirectUri(
        registeredClientId,
        'https://different.com/callback',
      );
      expect(isValid).toBe(false);
    });
  });
});
