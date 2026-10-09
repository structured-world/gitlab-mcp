/**
 * Unit tests for OAuth metadata endpoint
 * Tests the /.well-known/oauth-authorization-server endpoint
 */

import { Request, Response } from 'express';
import {
  metadataHandler,
  protectedResourceHandler,
  getBaseUrl,
} from '../../../../src/oauth/endpoints/metadata';
import { loadOAuthConfig } from '../../../../src/oauth/config';

// Mock config
jest.mock('../../../../src/config', () => ({
  HOST: 'localhost',
  PORT: 3333,
}));

jest.mock('../../../../src/oauth/config', () => ({
  loadOAuthConfig: jest.fn(),
}));

const mockLoadOAuthConfig = loadOAuthConfig as jest.MockedFunction<typeof loadOAuthConfig>;

beforeEach(() => {
  mockLoadOAuthConfig.mockReturnValue({
    issuer: 'http://localhost:3333',
  } as ReturnType<typeof loadOAuthConfig>);
});

describe('OAuth Metadata Endpoint', () => {
  // Helper to create mock request
  const createMockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
    protocol: 'http',
    get: jest.fn((header: string): string | undefined => {
      if (header === 'host') return 'localhost:3333';
      return undefined;
    }) as Request['get'],
    ...overrides,
  });

  // Helper to create mock response
  const createMockResponse = (): Partial<Response> => {
    const res: Partial<Response> = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
    };
    return res;
  };

  describe('getBaseUrl', () => {
    it('should return base URL from request', () => {
      const req = createMockRequest() as Request;
      const baseUrl = getBaseUrl(req);
      expect(baseUrl).toBe('http://localhost:3333');
    });

    it('should use X-Forwarded-Proto header when present', () => {
      const req = createMockRequest({
        get: jest.fn((header: string): string | undefined => {
          if (header === 'x-forwarded-proto') return 'https';
          if (header === 'host') return 'localhost:3333';
          return undefined;
        }) as Request['get'],
      }) as Request;

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).toBe('https://localhost:3333');
    });

    it('should use X-Forwarded-Host header when present', () => {
      const req = createMockRequest({
        get: jest.fn((header: string): string | undefined => {
          if (header === 'x-forwarded-proto') return 'https';
          if (header === 'x-forwarded-host') return 'example.com';
          if (header === 'host') return 'localhost:3333';
          return undefined;
        }) as Request['get'],
      }) as Request;

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).toBe('https://example.com');
    });

    it('should use config defaults when headers are missing', () => {
      const req = createMockRequest({
        protocol: 'http',
        get: jest.fn(() => undefined),
      }) as Request;

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).toBe('http://localhost:3333');
    });

    it('should handle reverse proxy scenario', () => {
      const req = createMockRequest({
        protocol: 'http', // Original is HTTP
        get: jest.fn((header: string): string | undefined => {
          if (header === 'x-forwarded-proto') return 'https'; // But proxy says HTTPS
          if (header === 'x-forwarded-host') return 'api.example.com';
          return undefined;
        }) as Request['get'],
      }) as Request;

      const baseUrl = getBaseUrl(req);
      expect(baseUrl).toBe('https://api.example.com');
    });
  });

  describe('metadataHandler', () => {
    it('should return OAuth metadata JSON', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      metadataHandler(req, res);

      expect(res.json).toHaveBeenCalledTimes(1);
      const metadata = (res.json as jest.Mock).mock.calls[0][0];

      expect(metadata.issuer).toBe('http://localhost:3333');
      expect(metadata.authorization_endpoint).toBe('http://localhost:3333/authorize');
      expect(metadata.token_endpoint).toBe('http://localhost:3333/token');
    });

    it('should include required OAuth 2.0 fields', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      metadataHandler(req, res);

      const metadata = (res.json as jest.Mock).mock.calls[0][0];

      // Required fields per RFC 8414
      expect(metadata.issuer).toBeDefined();
      expect(metadata.authorization_endpoint).toBeDefined();
      expect(metadata.token_endpoint).toBeDefined();
    });

    it('should include supported response types', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      metadataHandler(req, res);

      const metadata = (res.json as jest.Mock).mock.calls[0][0];
      expect(metadata.response_types_supported).toEqual(['code']);
    });

    it('should include supported grant types', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      metadataHandler(req, res);

      const metadata = (res.json as jest.Mock).mock.calls[0][0];
      expect(metadata.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
    });

    it('should include PKCE code challenge methods', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      metadataHandler(req, res);

      const metadata = (res.json as jest.Mock).mock.calls[0][0];
      expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    });

    it('should include token endpoint auth methods', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      metadataHandler(req, res);

      const metadata = (res.json as jest.Mock).mock.calls[0][0];
      expect(metadata.token_endpoint_auth_methods_supported).toEqual(['none']);
    });

    it('should include supported scopes', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      metadataHandler(req, res);

      const metadata = (res.json as jest.Mock).mock.calls[0][0];
      expect(metadata.scopes_supported).toEqual(['mcp:tools', 'mcp:resources']);
    });

    it('should advertise the revocation endpoint (RFC 8414 section 2, RFC 7009)', () => {
      const res = createMockResponse() as Response;
      metadataHandler(createMockRequest() as Request, res);
      const metadata = (res.json as jest.Mock).mock.calls[0][0];
      expect(metadata.revocation_endpoint).toBe('http://localhost:3333/revoke');
      expect(metadata.revocation_endpoint_auth_methods_supported).toEqual(['none']);
    });

    it('should advertise iss in authorization responses (RFC 9207 section 3)', () => {
      const res = createMockResponse() as Response;
      metadataHandler(createMockRequest() as Request, res);
      const metadata = (res.json as jest.Mock).mock.calls[0][0];
      expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
    });

    it('should include MCP version', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      metadataHandler(req, res);

      const metadata = (res.json as jest.Mock).mock.calls[0][0];
      expect(metadata.mcp_version).toBe('2025-03-26');
    });

    it('should take the issuer from OAUTH_ISSUER and ignore forwarded headers', () => {
      // A client-controlled Host header must not choose the issuer tokens are minted for.
      mockLoadOAuthConfig.mockReturnValue({
        issuer: 'https://mcp.example.com',
      } as ReturnType<typeof loadOAuthConfig>);
      const req = createMockRequest({
        get: jest.fn((header: string): string | undefined => {
          if (header === 'x-forwarded-proto') return 'https';
          if (header === 'x-forwarded-host') return 'attacker.example';
          return undefined;
        }) as Request['get'],
      }) as Request;
      const res = createMockResponse() as Response;

      metadataHandler(req, res);

      const metadata = (res.json as jest.Mock).mock.calls[0][0];
      expect(metadata.issuer).toBe('https://mcp.example.com');
      expect(metadata.authorization_endpoint).toBe('https://mcp.example.com/authorize');
      expect(metadata.token_endpoint).toBe('https://mcp.example.com/token');
    });

    it('should answer 500 when OAuth is not configured', () => {
      mockLoadOAuthConfig.mockReturnValue(null);
      const res = createMockResponse() as Response;
      metadataHandler(createMockRequest() as Request, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('protectedResourceHandler', () => {
    it.each([
      ['/.well-known/oauth-protected-resource', 'http://localhost:3333'],
      ['/.well-known/oauth-protected-resource/mcp', 'http://localhost:3333/mcp'],
    ])('serves %s with resource %s (RFC 9728 section 3.3)', (path, resource) => {
      const res = createMockResponse() as Response;
      protectedResourceHandler(createMockRequest({ path } as Partial<Request>) as Request, res);
      const metadata = (res.json as jest.Mock).mock.calls[0][0];
      expect(metadata.resource).toBe(resource);
      expect(metadata.authorization_servers).toEqual(['http://localhost:3333']);
    });

    // An issuer with a path serves its documents at path-inserted URLs (RFC 9728 3.1).
    it.each([
      ['/.well-known/oauth-protected-resource/gitlab', 'https://mcp.example.com/gitlab'],
      ['/.well-known/oauth-protected-resource/gitlab/mcp', 'https://mcp.example.com/gitlab/mcp'],
    ])('serves %s of an issuer with a path as %s', (path, resource) => {
      mockLoadOAuthConfig.mockReturnValue({
        issuer: 'https://mcp.example.com/gitlab',
      } as ReturnType<typeof loadOAuthConfig>);
      const res = createMockResponse() as Response;
      protectedResourceHandler(createMockRequest({ path } as Partial<Request>) as Request, res);
      expect((res.json as jest.Mock).mock.calls[0][0].resource).toBe(resource);
    });

    // The root forms stay mounted for a path issuer too and describe its two resources.
    it.each([
      ['/.well-known/oauth-protected-resource', 'https://mcp.example.com/gitlab'],
      ['/.well-known/oauth-protected-resource/mcp', 'https://mcp.example.com/gitlab/mcp'],
    ])('serves the root form %s of an issuer with a path as %s', (path, resource) => {
      mockLoadOAuthConfig.mockReturnValue({
        issuer: 'https://mcp.example.com/gitlab',
      } as ReturnType<typeof loadOAuthConfig>);
      const res = createMockResponse() as Response;
      protectedResourceHandler(createMockRequest({ path } as Partial<Request>) as Request, res);
      expect((res.json as jest.Mock).mock.calls[0][0].resource).toBe(resource);
    });

    it('answers 500 when OAuth is not configured', () => {
      mockLoadOAuthConfig.mockReturnValue(null);
      const res = createMockResponse() as Response;
      protectedResourceHandler(
        createMockRequest({ path: '/x' } as Partial<Request>) as Request,
        res,
      );
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // NOTE: healthHandler tests removed - handler was replaced by simple /health endpoint in server.ts
  // MCP metadata is now available via dashboard (GET / with Accept: application/json)
});
