/**
 * Unit tests for enhanced fetch utilities
 * Tests the native fetch-based implementation with GitLab-specific features
 */

import { enhancedFetch, createFetchOptions, DEFAULT_HEADERS } from '../../../src/utils/fetch';

// Mock dependencies
jest.mock('fs');
jest.mock('https');
jest.mock('http-proxy-agent');
jest.mock('https-proxy-agent');
jest.mock('socks-proxy-agent');
jest.mock('../../../src/logger');

// Mock the global fetch function
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock config values
jest.mock('../../../src/config', () => ({
  SKIP_TLS_VERIFY: false,
  GITLAB_AUTH_COOKIE_PATH: '',
  GITLAB_CA_CERT_PATH: '',
  HTTP_PROXY: '',
  HTTPS_PROXY: '',
  NODE_TLS_REJECT_UNAUTHORIZED: '',
  GITLAB_TOKEN: 'test-token'
}));

describe('Enhanced Fetch Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  describe('DEFAULT_HEADERS', () => {
    it('should include basic headers', () => {
      expect(DEFAULT_HEADERS['User-Agent']).toBe('GitLab MCP Server');
      expect(DEFAULT_HEADERS['Content-Type']).toBe('application/json');
      expect(DEFAULT_HEADERS['Accept']).toBe('application/json');
    });

    it('should include Authorization header when GITLAB_TOKEN is set', () => {
      expect(DEFAULT_HEADERS.Authorization).toBe('Bearer test-token');
    });
  });

  describe('createFetchOptions', () => {
    it('should return basic options when no special config is set', () => {
      const options = createFetchOptions();
      expect(options).toBeDefined();
      expect(typeof options).toBe('object');
    });
  });

  describe('enhancedFetch', () => {
    it('should call native fetch with merged options', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ success: true })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await enhancedFetch('https://example.com');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'GitLab MCP Server',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Bearer test-token'
          })
        })
      );
      expect(result).toBe(mockResponse);
    });

    it('should merge custom headers with default headers', async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch('https://example.com', {
        headers: { 'X-Custom-Header': 'custom-value' }
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'GitLab MCP Server',
            'X-Custom-Header': 'custom-value',
            'Authorization': 'Bearer test-token'
          })
        })
      );
    });

    it('should handle Headers object in options', async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValue(mockResponse);

      const headers = new Headers();
      headers.set('X-Custom-Header', 'custom-value');
      headers.set('Another-Header', 'another-value');

      await enhancedFetch('https://example.com', { headers });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-custom-header': 'custom-value',
            'another-header': 'another-value'
          })
        })
      );
    });

    it('should merge options correctly', async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch('https://example.com', {
        method: 'POST',
        body: JSON.stringify({ test: 'data' })
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'POST',
          body: '{"test":"data"}',
          headers: expect.any(Object)
        })
      );
    });

    it('should handle fetch errors', async () => {
      const fetchError = new Error('Network error');
      mockFetch.mockRejectedValue(fetchError);

      await expect(enhancedFetch('https://example.com')).rejects.toThrow('Network error');
    });

    it('should return the response from fetch', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: jest.fn()
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await enhancedFetch('https://example.com');

      expect(result).toBe(mockResponse);
    });
  });

  describe('Additional Edge Cases', () => {
    it('should handle undefined headers', async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValue(mockResponse);

      // Test with undefined headers
      await enhancedFetch('https://example.com', { headers: undefined });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'GitLab MCP Server'
          })
        })
      );
    });

    it('should handle array-like headers', async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValue(mockResponse);

      // Test with array-like headers
      await enhancedFetch('https://example.com', {
        headers: [['X-Custom', 'value'], ['Another-Header', 'value2']]
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.any(Object)
        })
      );
    });

    it('should preserve custom HTTP methods', async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch('https://example.com', { method: 'PATCH' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'PATCH'
        })
      );
    });

    it('should handle request timeout option', async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch('https://example.com', {
        signal: AbortSignal.timeout(5000)
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      );
    });

    it('should handle different request body types', async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValue(mockResponse);

      const formData = new FormData();
      formData.append('key', 'value');

      await enhancedFetch('https://example.com', {
        method: 'POST',
        body: formData
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'POST',
          body: formData
        })
      );
    });

    it('should handle empty options object', async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch('https://example.com', {});

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'GitLab MCP Server'
          })
        })
      );
    });

    it('should handle undefined options', async () => {
      const mockResponse = { ok: true, status: 200 };
      mockFetch.mockResolvedValue(mockResponse);

      await enhancedFetch('https://example.com', undefined);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'GitLab MCP Server'
          })
        })
      );
    });
  });
});