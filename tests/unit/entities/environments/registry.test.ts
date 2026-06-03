import {
  environmentsToolRegistry,
  getEnvironmentsReadOnlyToolNames,
} from '../../../../src/entities/environments/registry';
import {
  installFetchMock,
  mockOk,
  mockNoContent,
  lastFetchCall as lastCall,
  mockEnhancedFetch,
} from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

installFetchMock();

const browse = () => environmentsToolRegistry.get('browse_environments')!;
const manage = () => environmentsToolRegistry.get('manage_environment')!;

const BASE = 'https://gitlab.example.com/api/v4';

describe('Environments Registry', () => {
  describe('Registry Structure', () => {
    it('contains exactly the two CQRS tools', () => {
      expect(Array.from(environmentsToolRegistry.keys())).toEqual([
        'browse_environments',
        'manage_environment',
      ]);
    });

    it('exposes only the browse tool as read-only', () => {
      expect(getEnvironmentsReadOnlyToolNames()).toEqual(['browse_environments']);
    });

    it('declares the Free-tier requirement on both tools', () => {
      expect(browse().requirements?.default).toEqual({ tier: 'free', minVersion: '8.0' });
      expect(manage().requirements?.default).toEqual({ tier: 'free', minVersion: '8.0' });
    });

    it('is gated by USE_ENVIRONMENTS', () => {
      expect(browse().gate?.envVar).toBe('USE_ENVIRONMENTS');
      expect(manage().gate?.envVar).toBe('USE_ENVIRONMENTS');
    });
  });

  describe('browse_environments', () => {
    it('list reads the project environments with state/search filters', async () => {
      mockOk([{ id: 1, name: 'production' }]);
      await browse().handler({
        action: 'list',
        project_id: 'group/project',
        states: 'available',
        search: 'prod',
      });

      const [url] = lastCall();
      expect(url).toContain(`${BASE}/projects/group%2Fproject/environments?`);
      expect(url).toContain('states=available');
      expect(url).toContain('search=prod');
      // action/project_id must not leak into the query string
      expect(url).not.toContain('action=');
      expect(url).not.toContain('project_id=');
    });

    it('get reads a single environment by numeric id', async () => {
      mockOk({ id: 5, name: 'staging' });
      await browse().handler({ action: 'get', project_id: '123', environment_id: 5 });

      const [url] = lastCall();
      expect(url).toBe(`${BASE}/projects/123/environments/5`);
    });

    it('coerces a string environment_id to a number in the path', async () => {
      mockOk({ id: 5 });
      await browse().handler({ action: 'get', project_id: '123', environment_id: '5' });

      const [url] = lastCall();
      expect(url).toBe(`${BASE}/projects/123/environments/5`);
    });

    it('list_deployments reads project deployments filtered by environment and status', async () => {
      mockOk([{ id: 10, status: 'success' }]);
      await browse().handler({
        action: 'list_deployments',
        project_id: '123',
        environment: 'production',
        status: 'success',
      });

      const [url] = lastCall();
      expect(url).toContain(`${BASE}/projects/123/deployments?`);
      expect(url).toContain('environment=production');
      expect(url).toContain('status=success');
    });

    it('rejects an environment_id of zero at schema parse', async () => {
      await expect(
        browse().handler({ action: 'get', project_id: '123', environment_id: 0 }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });
  });

  describe('manage_environment', () => {
    it('create POSTs the environment payload', async () => {
      mockOk({ id: 7, name: 'staging' });
      await manage().handler({
        action: 'create',
        project_id: '123',
        name: 'staging',
        external_url: 'https://staging.example.com',
        tier: 'staging',
      });

      const [url, init] = lastCall();
      expect(url).toBe(`${BASE}/projects/123/environments`);
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({
        name: 'staging',
        external_url: 'https://staging.example.com',
        tier: 'staging',
      });
    });

    it('create omits optional fields that were not provided', async () => {
      mockOk({ id: 8, name: 'minimal' });
      await manage().handler({ action: 'create', project_id: '123', name: 'minimal' });

      const [, init] = lastCall();
      expect(JSON.parse(init?.body as string)).toEqual({ name: 'minimal' });
    });

    it('update PUTs only the provided fields, without ids in the body', async () => {
      mockOk({ id: 5 });
      await manage().handler({
        action: 'update',
        project_id: '123',
        environment_id: 5,
        description: 'now with a description',
      });

      const [url, init] = lastCall();
      expect(url).toBe(`${BASE}/projects/123/environments/5`);
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(init?.body as string)).toEqual({ description: 'now with a description' });
    });

    it('update PUTs external_url and tier when provided', async () => {
      mockOk({ id: 5 });
      await manage().handler({
        action: 'update',
        project_id: '123',
        environment_id: 5,
        external_url: 'https://new.example.com',
        tier: 'production',
      });

      const [, init] = lastCall();
      expect(JSON.parse(init?.body as string)).toEqual({
        external_url: 'https://new.example.com',
        tier: 'production',
      });
    });

    it('stop POSTs to the stop sub-resource with a coerced force flag', async () => {
      mockOk({ id: 5, state: 'stopped' });
      await manage().handler({
        action: 'stop',
        project_id: '123',
        environment_id: 5,
        force: 'true',
      });

      const [url, init] = lastCall();
      expect(url).toBe(`${BASE}/projects/123/environments/5/stop`);
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({ force: true });
    });

    it('delete removes the environment and echoes the id', async () => {
      mockNoContent();
      const result = await manage().handler({
        action: 'delete',
        project_id: '123',
        environment_id: '5',
      });

      const [url, init] = lastCall();
      expect(url).toBe(`${BASE}/projects/123/environments/5`);
      expect(init?.method).toBe('DELETE');
      expect(result).toEqual({ deleted: true, environment_id: 5 });
    });

    it('update_deployment_status PUTs the status to the deployment endpoint', async () => {
      mockOk({ id: 9, status: 'success' });
      await manage().handler({
        action: 'update_deployment_status',
        project_id: '123',
        deployment_id: 9,
        status: 'success',
      });

      const [url, init] = lastCall();
      expect(url).toBe(`${BASE}/projects/123/deployments/9`);
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(init?.body as string)).toEqual({ status: 'success' });
    });

    it('rejects an unknown deployment status at schema parse', async () => {
      await expect(
        manage().handler({
          action: 'update_deployment_status',
          project_id: '123',
          deployment_id: 9,
          status: 'skipped',
        }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });

    it('rejects create without a name at schema parse', async () => {
      await expect(manage().handler({ action: 'create', project_id: '123' })).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });
  });
});
