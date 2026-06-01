import {
  jobTokenScopeToolRegistry,
  getJobTokenScopeReadOnlyToolNames,
  getJobTokenScopeToolDefinitions,
  getFilteredJobTokenScopeTools,
} from '../../../../src/entities/job-token-scope/registry';
import { enhancedFetch } from '../../../../src/utils/fetch';

jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

const mockEnhancedFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;

const originalEnv = process.env;

beforeAll(() => {
  process.env = {
    ...originalEnv,
    GITLAB_API_URL: 'https://gitlab.example.com',
    GITLAB_TOKEN: 'test-token-12345',
  };
});

afterAll(() => {
  process.env = originalEnv;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetAllMocks();
  mockEnhancedFetch.mockReset();
});

/** Resolve enhancedFetch into an ok JSON response. */
function mockOk(payload: unknown): void {
  mockEnhancedFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response);
}

/** Resolve enhancedFetch into a 204 No Content response (delete). */
function mockNoContent(): void {
  mockEnhancedFetch.mockResolvedValueOnce({
    ok: true,
    status: 204,
    statusText: 'No Content',
  } as unknown as Response);
}

const browse = () => jobTokenScopeToolRegistry.get('browse_job_token_scope')!;
const manage = () => jobTokenScopeToolRegistry.get('manage_job_token_scope')!;

/** Last enhancedFetch call: [url, init?]. */
function lastCall(): [string, RequestInit | undefined] {
  const call = mockEnhancedFetch.mock.calls.at(-1)!;
  return [call[0], call[1]];
}

describe('Job Token Scope Registry', () => {
  describe('Registry Structure', () => {
    it('contains exactly the two CQRS tools', () => {
      const names = Array.from(jobTokenScopeToolRegistry.keys());
      expect(names).toContain('browse_job_token_scope');
      expect(names).toContain('manage_job_token_scope');
      expect(names).toHaveLength(2);
    });

    it('exposes only the browse tool as read-only', () => {
      expect(getJobTokenScopeReadOnlyToolNames()).toEqual(['browse_job_token_scope']);
      expect(getFilteredJobTokenScopeTools(true).map((t) => t.name)).toEqual([
        'browse_job_token_scope',
      ]);
      expect(getFilteredJobTokenScopeTools(false)).toHaveLength(2);
      // Default (no arg) is non-read-only: both tools.
      expect(getFilteredJobTokenScopeTools()).toHaveLength(2);
      expect(getJobTokenScopeToolDefinitions()).toHaveLength(2);
    });

    it('declares free-tier requirements with allowlist minVersions', () => {
      expect(browse().requirements?.default).toEqual({ tier: 'free', minVersion: '15.9' });
      expect(browse().requirements?.actions?.list_groups?.minVersion).toBe('16.0');
      expect(manage().requirements?.actions?.add_group?.minVersion).toBe('16.0');
    });

    it('is gated by the shared USE_CI_TOKENS umbrella flag', () => {
      expect(browse().gate?.envVar).toBe('USE_CI_TOKENS');
      expect(manage().gate?.envVar).toBe('USE_CI_TOKENS');
    });
  });

  describe('browse_job_token_scope', () => {
    it('get reads the scope settings endpoint (numeric id, no lookup)', async () => {
      mockOk({ inbound_enabled: true, outbound_enabled: false });
      const result = await browse().handler({ action: 'get', project_id: '123' });

      expect(mockEnhancedFetch).toHaveBeenCalledTimes(1);
      const [url] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/job_token_scope');
      expect(result).toEqual({ inbound_enabled: true, outbound_enabled: false });
    });

    it('resolves a project path to a numeric id before the scope call', async () => {
      mockOk({ id: 123 }); // GET /projects/:path → numeric id
      mockOk({ inbound_enabled: false, outbound_enabled: false });
      await browse().handler({ action: 'get', project_id: 'group/project' });

      expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
      expect(mockEnhancedFetch.mock.calls[0][0]).toBe(
        'https://gitlab.example.com/api/v4/projects/group%2Fproject',
      );
      const [url] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/job_token_scope');
    });

    it('list_projects reads the inbound project allowlist', async () => {
      mockOk([{ id: 7, name: 'allowed' }]);
      await browse().handler({ action: 'list_projects', project_id: '123' });

      const [url] = lastCall();
      expect(url).toContain('/projects/123/job_token_scope/allowlist');
    });

    it('list_groups reads the inbound group allowlist', async () => {
      mockOk([{ id: 9, name: 'allowed-group' }]);
      await browse().handler({ action: 'list_groups', project_id: '123' });

      const [url] = lastCall();
      expect(url).toContain('/projects/123/job_token_scope/groups_allowlist');
    });
  });

  describe('manage_job_token_scope', () => {
    it('set_enabled PATCHes the scope with the enabled flag', async () => {
      mockOk({ inbound_enabled: true });
      await manage().handler({ action: 'set_enabled', project_id: '123', enabled: true });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/job_token_scope');
      expect(init?.method).toBe('PATCH');
      expect(JSON.parse(init?.body as string)).toEqual({ enabled: true });
    });

    it('add_project POSTs the numeric target to the allowlist', async () => {
      mockOk({ target_project_id: 42 });
      await manage().handler({ action: 'add_project', project_id: '123', target_project_id: 42 });

      const [url, init] = lastCall();
      expect(url).toContain('/projects/123/job_token_scope/allowlist');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({ target_project_id: 42 });
    });

    it('coerces a string target_project_id to a number', async () => {
      mockOk({ target_project_id: 42 });
      await manage().handler({
        action: 'add_project',
        project_id: '123',
        target_project_id: '42',
      });

      const [, init] = lastCall();
      expect(JSON.parse(init?.body as string)).toEqual({ target_project_id: 42 });
    });

    it('remove_project DELETEs by target id and echoes it', async () => {
      mockNoContent();
      const result = await manage().handler({
        action: 'remove_project',
        project_id: '123',
        target_project_id: 42,
      });

      const [url, init] = lastCall();
      expect(url).toContain('/projects/123/job_token_scope/allowlist/42');
      expect(init?.method).toBe('DELETE');
      expect(result).toEqual({ removed: true, target_project_id: 42 });
    });

    it('add_group POSTs to the groups allowlist', async () => {
      mockOk({ target_group_id: 5 });
      await manage().handler({ action: 'add_group', project_id: '123', target_group_id: 5 });

      const [url, init] = lastCall();
      expect(url).toContain('/projects/123/job_token_scope/groups_allowlist');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({ target_group_id: 5 });
    });

    it('remove_group DELETEs by target group id', async () => {
      mockNoContent();
      const result = await manage().handler({
        action: 'remove_group',
        project_id: '123',
        target_group_id: 5,
      });

      const [url, init] = lastCall();
      expect(url).toContain('/projects/123/job_token_scope/groups_allowlist/5');
      expect(init?.method).toBe('DELETE');
      expect(result).toEqual({ removed: true, target_group_id: 5 });
    });

    it('rejects an invalid (non-positive) target id at schema parse', async () => {
      await expect(
        manage().handler({ action: 'add_project', project_id: '123', target_project_id: 0 }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });
  });
});
