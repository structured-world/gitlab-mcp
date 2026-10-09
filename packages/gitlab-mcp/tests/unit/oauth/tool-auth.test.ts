/**
 * Tool-level authorization contract: which failures ask the host to reconnect the account
 * and what the challenge carries.
 */

import { loadOAuthConfig } from '../../../src/oauth/config';
import { runWithTokenContext } from '../../../src/oauth/token-context';
import {
  OAUTH_SECURITY_SCHEMES,
  isGitLabAuthFailure,
  isGitLabInsufficientScope,
  withReauthChallenge,
} from '../../../src/oauth/tool-auth';
import { StructuredToolError } from '../../../src/utils/error-handler';
import type { GitLabStructuredError } from '../../../src/utils/error-handler';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

jest.mock('../../../src/oauth/config', () => ({
  loadOAuthConfig: jest.fn(),
}));

const mockLoadOAuthConfig = loadOAuthConfig as jest.MockedFunction<typeof loadOAuthConfig>;

const errorResult: CallToolResult = {
  content: [{ type: 'text', text: '{"error":"x"}' }],
  isError: true,
  _meta: { existing: true },
};

const unauthorized = new Error('GitLab API error: 401 Unauthorized - invalid_token');

describe('tool authorization contract', () => {
  beforeEach(() => {
    mockLoadOAuthConfig.mockReturnValue({
      issuer: 'https://mcp.example.com',
    } as ReturnType<typeof loadOAuthConfig>);
  });

  it('declares an OAuth token with mcp:tools for every tool', () => {
    expect(OAUTH_SECURITY_SCHEMES).toEqual([{ type: 'oauth2', scopes: ['mcp:tools'] }]);
  });

  describe('isGitLabAuthFailure', () => {
    it.each([
      ['a GitLab 401', unauthorized, true],
      [
        'a 401 wrapped by the dispatcher',
        new Error("Failed to execute tool 'browse_projects': x", { cause: unauthorized }),
        true,
      ],
      [
        'a structured 401',
        new StructuredToolError({
          error_code: 'API_ERROR',
          http_status: 401,
        } as unknown as GitLabStructuredError),
        true,
      ],
      // 403 is a permission problem of this request, not dead credentials.
      ['a GitLab 403', new Error('GitLab API error: 403 Forbidden'), false],
      ['a GitLab 404', new Error('GitLab API error: 404 Not Found'), false],
      ['a network failure', new Error('fetch failed'), false],
      ['a non-error value', '401', false],
    ])('classifies %s as %s', (_case, error, expected) => {
      expect(isGitLabAuthFailure(error)).toBe(expected);
    });
  });

  describe('isGitLabInsufficientScope', () => {
    it.each([
      [
        'a 403 naming insufficient_scope',
        new Error('GitLab API error: 403 Forbidden - {"error":"insufficient_scope"}'),
        true,
      ],
      // A plain 403 is a project permission, which a reconnect cannot fix.
      ['a plain 403', new Error('GitLab API error: 403 Forbidden - 403 Forbidden'), false],
      ['a 401', unauthorized, false],
    ])('classifies %s as %s', (_case, error, expected) => {
      expect(isGitLabInsufficientScope(error)).toBe(expected);
    });
  });

  describe('withReauthChallenge', () => {
    it('adds an RFC 6750 challenge with error and error_description for a 401', () => {
      const result = withReauthChallenge(errorResult, unauthorized);

      const challenges = result._meta?.['mcp/www_authenticate'] as string[];
      expect(challenges).toHaveLength(1);
      expect(challenges[0]).toMatch(
        /^Bearer resource_metadata="https:\/\/mcp\.example\.com\/\.well-known\/oauth-protected-resource\/mcp", error="invalid_token", error_description="[^"]+"$/,
      );
      expect(result.isError).toBe(true);
      expect(result._meta?.existing).toBe(true);
      expect(result.content).toBe(errorResult.content);
    });

    it('points at the metadata of the resource the client called (RFC 9728 5.1)', async () => {
      const result = await runWithTokenContext(
        {
          gitlabToken: 'fixture-only',
          gitlabUserId: 1,
          gitlabUsername: 'fixture',
          sessionId: 'session',
          apiUrl: 'https://gitlab.example.com',
          resource: 'https://mcp.example.com',
        },
        async () => withReauthChallenge(errorResult, unauthorized),
      );

      expect((result._meta?.['mcp/www_authenticate'] as string[])[0]).toContain(
        'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
      );
    });

    it('asks for a reconnect with the needed scope on 403 insufficient_scope (RFC 6750 3.1)', () => {
      const insufficient = new Error(
        'GitLab API error: 403 Forbidden - {"error":"insufficient_scope","scope":"api"}',
      );

      const challenge = (
        withReauthChallenge(errorResult, insufficient)._meta?.['mcp/www_authenticate'] as string[]
      )[0];

      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toContain('scope="mcp:tools"');
      expect(challenge).toContain('error_description=');
    });

    it('leaves other failures unchanged', () => {
      const forbidden = new Error('GitLab API error: 403 Forbidden');
      expect(withReauthChallenge(errorResult, forbidden)).toBe(errorResult);
    });

    it('leaves results unchanged outside OAuth mode', () => {
      // A static token cannot be reconnected by the host.
      mockLoadOAuthConfig.mockReturnValue(null);
      expect(withReauthChallenge(errorResult, unauthorized)).toBe(errorResult);
    });
  });
});
