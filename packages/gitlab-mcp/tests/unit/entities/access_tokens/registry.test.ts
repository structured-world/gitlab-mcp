import {
  accessTokensToolRegistry,
  getAccessTokensReadOnlyToolNames,
} from '../../../../src/entities/access_tokens/registry';
import {
  installFetchMock,
  mockOk,
  mockNoContent,
  lastFetchCall as lastCall,
  mockEnhancedFetch,
} from '../../helpers/fetch-mock';
import { ConnectionManager } from '../../../../src/services/ConnectionManager';
import type { GitLabInstanceInfo } from '../../../../src/services/GitLabVersionDetector';

jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

installFetchMock();

const browse = () => accessTokensToolRegistry.get('browse_access_tokens')!;
const manage = () => accessTokensToolRegistry.get('manage_access_token')!;

describe('Access Tokens Registry', () => {
  describe('Registry Structure', () => {
    it('contains exactly the two CQRS tools', () => {
      expect(Array.from(accessTokensToolRegistry.keys())).toEqual([
        'browse_access_tokens',
        'manage_access_token',
      ]);
    });

    it('exposes only the browse tool as read-only', () => {
      expect(getAccessTokensReadOnlyToolNames()).toEqual(['browse_access_tokens']);
      expect(accessTokensToolRegistry.size).toBe(2);
    });

    it('declares the Free-tier requirement and USE_ACCESS_TOKENS gate on both tools', () => {
      expect(browse().requirements?.default).toEqual({ tier: 'free' });
      expect(manage().requirements?.default).toEqual({ tier: 'free' });
      expect(browse().gate).toEqual({ envVar: 'USE_ACCESS_TOKENS', defaultValue: true });
      expect(manage().gate).toEqual({ envVar: 'USE_ACCESS_TOKENS', defaultValue: true });
    });
  });

  describe('browse_access_tokens', () => {
    it('list_personal reads the personal_access_tokens collection with filters', async () => {
      mockOk([{ id: 1 }]);
      await browse().handler({ action: 'list_personal', state: 'active', search: 'ci' });

      const [url] = lastCall();
      expect(url).toContain('https://gitlab.example.com/api/v4/personal_access_tokens?');
      expect(url).toContain('state=active');
      expect(url).toContain('search=ci');
      expect(url).not.toContain('/projects/');
    });

    it('list_personal forwards an admin user_id filter', async () => {
      mockOk([{ id: 1 }]);
      await browse().handler({ action: 'list_personal', user_id: 42 });

      const [url] = lastCall();
      expect(url).toContain('user_id=42');
    });

    it('list_project reads the project access_tokens collection', async () => {
      mockOk([{ id: 1 }]);
      await browse().handler({ action: 'list_project', project_id: 'group/project' });

      const [url] = lastCall();
      expect(url).toContain('/projects/group%2Fproject/access_tokens');
    });

    it('list_group reads the group access_tokens collection', async () => {
      mockOk([{ id: 1 }]);
      await browse().handler({ action: 'list_group', group_id: 'my-group' });

      const [url] = lastCall();
      expect(url).toContain('/groups/my-group/access_tokens');
    });

    describe('state filter on project/group token lists (server-side from GitLab 17.2)', () => {
      // Older instances ignore `state` and return every token; the tool must
      // apply the filter itself there rather than return an unfiltered list.
      const atVersion = (version: string) =>
        jest
          .spyOn(ConnectionManager.getInstance(), 'getInstanceInfo')
          .mockReturnValue({ version, tier: 'free' } as GitLabInstanceInfo);

      afterEach(() => jest.restoreAllMocks());

      const tokens = [
        { id: 1, active: true },
        { id: 2, active: false },
      ];

      it('filters active project tokens client-side before 17.2', async () => {
        atVersion('17.1.0');
        mockOk(tokens);
        const result = await browse().handler({
          action: 'list_project',
          project_id: 'p',
          state: 'active',
        });
        expect(result).toEqual([{ id: 1, active: true }]);
        // The ignored parameter is not sent.
        expect(lastCall()[0]).not.toContain('state=');
      });

      it('filters inactive group tokens client-side before 17.2', async () => {
        atVersion('17.1.0');
        mockOk(tokens);
        const result = await browse().handler({
          action: 'list_group',
          group_id: 'g',
          state: 'inactive',
        });
        expect(result).toEqual([{ id: 2, active: false }]);
      });

      it('filters before paginating, walking GitLab pages past non-matching ones', async () => {
        // A full first page of inactive tokens must not hide an active one on
        // the next page, and the requested page is cut from the filtered list.
        atVersion('17.1.0');
        const inactive = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, active: false }));
        mockOk(inactive);
        mockOk([
          { id: 101, active: true },
          { id: 102, active: true },
          { id: 103, active: true },
        ]);

        const result = await browse().handler({
          action: 'list_project',
          project_id: 'p',
          state: 'active',
          per_page: 2,
          page: 2,
        });

        expect(result).toEqual([{ id: 103, active: true }]);
        const sent = mockEnhancedFetch.mock.calls.map(([url]) => new URL(String(url)).searchParams);
        expect(sent.map((q) => [q.get('page'), q.get('per_page')])).toEqual([
          ['1', '100'],
          ['2', '100'],
        ]);
      });

      it('rejects a malformed token page when filtering client-side', async () => {
        // Without an `active` flag every token would silently fail the filter.
        atVersion('17.1.0');
        mockOk([{ id: 1 }]);
        await expect(
          browse().handler({ action: 'list_project', project_id: 'p', state: 'active' }),
        ).rejects.toThrow('GitLab API error: unexpected access tokens response');
      });

      it('sends the state filter from 17.2', async () => {
        atVersion('17.2.0');
        mockOk([]);
        await browse().handler({ action: 'list_project', project_id: 'p', state: 'active' });
        expect(lastCall()[0]).toContain('state=active');
      });

      it('lists without a state filter on older instances', async () => {
        atVersion('16.0.0');
        mockOk([]);
        await browse().handler({ action: 'list_group', group_id: 'g' });
        expect(lastCall()[0]).toContain('/groups/g/access_tokens');
      });
    });

    it('get without a scope reads a personal token by id', async () => {
      mockOk({ id: 7 });
      await browse().handler({ action: 'get', token_id: 7 });

      const [url] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/personal_access_tokens/7');
    });

    it('get with project_id reads a project token by id', async () => {
      mockOk({ id: 7 });
      await browse().handler({ action: 'get', token_id: 7, project_id: '123' });

      const [url] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/access_tokens/7');
    });

    it('get with group_id reads a group token by id', async () => {
      mockOk({ id: 7 });
      await browse().handler({ action: 'get', token_id: 7, group_id: 'g' });

      const [url] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/groups/g/access_tokens/7');
    });

    it('rejects get with both project_id and group_id', async () => {
      await expect(
        browse().handler({ action: 'get', token_id: 7, project_id: '1', group_id: 'g' }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });
  });

  describe('manage_access_token', () => {
    it('create_project POSTs the token payload and flags the response sensitive', async () => {
      mockOk({ id: 9, token: 'glpat-secret' });
      const result = (await manage().handler({
        action: 'create_project',
        project_id: '123',
        name: 'ci-token',
        scopes: ['api', 'read_repository'],
        access_level: 30,
        expires_at: '2026-12-31',
      })) as { token: string; _meta: { sensitive: boolean } };

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/access_tokens');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({
        name: 'ci-token',
        scopes: ['api', 'read_repository'],
        access_level: 30,
        expires_at: '2026-12-31',
      });
      expect(result.token).toBe('glpat-secret');
      expect(result._meta.sensitive).toBe(true);
    });

    it('create_group POSTs to the group collection', async () => {
      mockOk({ id: 9, token: 'glpat-g' });
      await manage().handler({
        action: 'create_group',
        group_id: 'my-group',
        name: 'grp-token',
        scopes: ['api'],
      });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/groups/my-group/access_tokens');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({ name: 'grp-token', scopes: ['api'] });
    });

    it('rejects create_project with an empty scopes array', async () => {
      await expect(
        manage().handler({ action: 'create_project', project_id: '1', name: 'x', scopes: [] }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });

    it('rotate (personal) POSTs to the self rotate sub-resource and flags sensitive', async () => {
      mockOk({ id: 7, token: 'glpat-new' });
      const result = (await manage().handler({
        action: 'rotate',
        token_id: 7,
        expires_at: '2026-09-01',
      })) as { token: string; _meta: { sensitive: boolean } };

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/personal_access_tokens/7/rotate');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({ expires_at: '2026-09-01' });
      expect(result.token).toBe('glpat-new');
      expect(result._meta.sensitive).toBe(true);
    });

    it('rotate (project) routes to the project rotate sub-resource', async () => {
      mockOk({ id: 7, token: 'glpat-new' });
      await manage().handler({ action: 'rotate', token_id: 7, project_id: '123' });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/access_tokens/7/rotate');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({});
    });

    it('rotate (group) routes to the group rotate sub-resource', async () => {
      mockOk({ id: 7, token: 'glpat-new' });
      await manage().handler({ action: 'rotate', token_id: 7, group_id: 'g' });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/groups/g/access_tokens/7/rotate');
      expect(init?.method).toBe('POST');
    });

    it('revoke (project) DELETEs the project token', async () => {
      mockNoContent();
      const result = await manage().handler({ action: 'revoke', token_id: 7, project_id: '123' });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/access_tokens/7');
      expect(init?.method).toBe('DELETE');
      expect(result).toEqual({ revoked: true, token_id: 7 });
    });

    it('rejects a scopes entry that is empty or whitespace-only', async () => {
      await expect(
        manage().handler({
          action: 'create_project',
          project_id: '1',
          name: 'x',
          scopes: ['api', '  '],
        }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });

    it('rejects a malformed expires_at that is not YYYY-MM-DD', async () => {
      await expect(
        manage().handler({
          action: 'create_project',
          project_id: '1',
          name: 'x',
          scopes: ['api'],
          expires_at: '2026/12/31',
        }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });

    it('revoke (group) DELETEs the group token and returns a confirmation', async () => {
      mockNoContent();
      const result = await manage().handler({ action: 'revoke', token_id: 7, group_id: 'g' });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/groups/g/access_tokens/7');
      expect(init?.method).toBe('DELETE');
      expect(result).toEqual({ revoked: true, token_id: 7 });
    });

    it('revoke (personal) DELETEs the personal token by id', async () => {
      mockNoContent();
      await manage().handler({ action: 'revoke', token_id: 7 });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/personal_access_tokens/7');
      expect(init?.method).toBe('DELETE');
    });

    it('coerces a string token_id to a number', async () => {
      mockNoContent();
      const result = await manage().handler({ action: 'revoke', token_id: '7' });
      expect(result).toEqual({ revoked: true, token_id: 7 });
    });

    it('rejects rotate with both project_id and group_id', async () => {
      await expect(
        manage().handler({ action: 'rotate', token_id: 7, project_id: '1', group_id: 'g' }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });
  });
});
