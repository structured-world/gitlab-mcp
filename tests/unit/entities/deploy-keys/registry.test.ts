import {
  deployKeysToolRegistry,
  getDeployKeysReadOnlyToolNames,
  getDeployKeysToolDefinitions,
} from '../../../../src/entities/deploy-keys/registry';
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

function mockOk(payload: unknown): void {
  mockEnhancedFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response);
}

function mockNoContent(): void {
  mockEnhancedFetch.mockResolvedValueOnce({
    ok: true,
    status: 204,
    statusText: 'No Content',
  } as unknown as Response);
}

const browse = () => deployKeysToolRegistry.get('browse_deploy_keys')!;
const manage = () => deployKeysToolRegistry.get('manage_deploy_key')!;

function lastCall(): [string, RequestInit | undefined] {
  const call = mockEnhancedFetch.mock.calls.at(-1)!;
  return [call[0], call[1]];
}

describe('Deploy Keys Registry', () => {
  describe('Registry Structure', () => {
    it('contains exactly the two CQRS tools', () => {
      const names = Array.from(deployKeysToolRegistry.keys());
      expect(names).toEqual(['browse_deploy_keys', 'manage_deploy_key']);
    });

    it('exposes only the browse tool as read-only', () => {
      expect(getDeployKeysReadOnlyToolNames()).toEqual(['browse_deploy_keys']);
      expect(getDeployKeysToolDefinitions()).toHaveLength(2);
    });

    it('declares the Free-tier requirement on both tools', () => {
      expect(browse().requirements?.default).toEqual({ tier: 'free', minVersion: '8.0' });
      expect(manage().requirements?.default).toEqual({ tier: 'free', minVersion: '8.0' });
    });

    it('is gated by the shared USE_CI_TOKENS umbrella flag', () => {
      expect(browse().gate?.envVar).toBe('USE_CI_TOKENS');
      expect(manage().gate?.envVar).toBe('USE_CI_TOKENS');
    });
  });

  describe('browse_deploy_keys', () => {
    it('list with project_id reads the project deploy keys', async () => {
      mockOk([{ id: 1, title: 'ci' }]);
      await browse().handler({ action: 'list', project_id: 'group/project' });

      const [url] = lastCall();
      expect(url).toContain('/projects/group%2Fproject/deploy_keys');
    });

    it('list without project_id reads the instance deploy keys', async () => {
      mockOk([{ id: 1 }]);
      await browse().handler({ action: 'list', public: true });

      const [url] = lastCall();
      expect(url).toContain('https://gitlab.example.com/api/v4/deploy_keys?');
      expect(url).toContain('public=true');
      expect(url).not.toContain('/projects/');
    });

    it('get reads a single key by id', async () => {
      mockOk({ id: 7 });
      await browse().handler({ action: 'get', project_id: '123', key_id: 7 });

      const [url] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/deploy_keys/7');
    });
  });

  describe('manage_deploy_key', () => {
    it('add POSTs the key payload', async () => {
      mockOk({ id: 9 });
      await manage().handler({
        action: 'add',
        project_id: '123',
        title: 'ci',
        key: 'ssh-ed25519 AAAA',
        can_push: true,
      });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/deploy_keys');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({
        title: 'ci',
        key: 'ssh-ed25519 AAAA',
        can_push: true,
      });
    });

    it('enable POSTs to the enable sub-resource', async () => {
      mockOk({ id: 9 });
      await manage().handler({ action: 'enable', project_id: '123', key_id: 9 });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/deploy_keys/9/enable');
      expect(init?.method).toBe('POST');
    });

    it('update PUTs title/can_push without the ids in the body', async () => {
      mockOk({ id: 9, can_push: false });
      await manage().handler({
        action: 'update',
        project_id: '123',
        key_id: 9,
        title: 'renamed',
        can_push: false,
      });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/deploy_keys/9');
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(init?.body as string)).toEqual({ title: 'renamed', can_push: false });
    });

    it('coerces a string key_id to a number', async () => {
      mockNoContent();
      const result = await manage().handler({ action: 'delete', project_id: '123', key_id: '9' });

      const [url, init] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/deploy_keys/9');
      expect(init?.method).toBe('DELETE');
      expect(result).toEqual({ deleted: true, key_id: 9 });
    });

    it('rejects a non-positive key_id at schema parse', async () => {
      await expect(
        manage().handler({ action: 'delete', project_id: '123', key_id: 0 }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });
  });
});
