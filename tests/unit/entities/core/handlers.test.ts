/**
 * Unit tests for core entity handlers
 * Tests all handler functions in src/entities/core/handlers.ts
 */

// Mock enhancedFetch at the module level
jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
  DEFAULT_HEADERS: {
    'User-Agent': 'GitLab MCP Server',
    'Accept': 'application/json'
  },
  createFetchOptions: jest.fn()
}));

// Mock environment variables
const mockEnv = {
  GITLAB_API_URL: 'https://gitlab.example.com',
  GITLAB_TOKEN: 'test-token'
};

// Set up environment
Object.assign(process.env, mockEnv);

import { enhancedFetch } from '../../../../src/utils/fetch';
import {
  handleListProjects,
  handleSearchRepositories,
  handleGetUsers,
  handleGetProject,
  handleListNamespaces,
  handleGetNamespace,
  handleVerifyNamespace,
  handleListProjectMembers,
  handleListGroupProjects,
  handleListCommits,
  handleGetCommit,
  handleGetCommitDiff,
  handleListGroupIterations,
  handleDownloadAttachment,
  handleListEvents,
  handleGetProjectEvents,
  handleCreateRepository,
  handleForkRepository,
  handleCreateBranch
} from '../../../../src/entities/core/handlers';

const mockEnhancedFetch = enhancedFetch as jest.MockedFunction<typeof enhancedFetch>;

// Mock data
const mockProject = {
  id: 123,
  name: 'test-project',
  web_url: 'https://gitlab.example.com/test-group/test-project'
};

const mockUser = {
  id: 456,
  username: 'testuser',
  name: 'Test User'
};

const mockCommit = {
  id: 'abc123',
  title: 'Test commit',
  author_name: 'Test Author'
};

const mockNamespace = {
  id: 789,
  name: 'test-namespace',
  full_path: 'test-namespace'
};

describe('Core Entity Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnhancedFetch.mockClear();
    // Reset to throw error by default - individual tests will override
    mockEnhancedFetch.mockRejectedValue(new Error('No mock set up'));
  });

  // Helper function to create mock response
  function createMockResponse(data: any, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: jest.fn().mockResolvedValue(data),
      text: jest.fn().mockResolvedValue(JSON.stringify(data)),
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
      headers: new Headers({ 'content-type': 'application/json' })
    } as any;
  }

  describe('handleListProjects', () => {
    it('should call API with correct URL and headers', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse([mockProject]));

      const params = { owned: true, per_page: 20 };
      await handleListProjects(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects?owned=true&per_page=20',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should return projects data', async () => {
      const projects = [mockProject];
      mockEnhancedFetch.mockResolvedValue(createMockResponse(projects));

      const result = await handleListProjects({});

      expect(result).toEqual(projects);
    });

    it('should handle API errors', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(null, 404));

      await expect(handleListProjects({})).rejects.toThrow('GitLab API error: 404 Error');
    });

    it('should validate parameters', async () => {
      await expect(handleListProjects({ per_page: 'invalid' })).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });
  });

  describe('handleSearchRepositories', () => {
    it('should call API with search query', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse([mockProject]));

      const params = { q: 'test-project', per_page: 20 };
      await handleSearchRepositories(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects?q=test-project&per_page=20',
        expect.any(Object)
      );
    });

    it('should return search results', async () => {
      const projects = [mockProject];
      mockEnhancedFetch.mockResolvedValue(createMockResponse(projects));

      const result = await handleSearchRepositories({ q: 'test' });

      expect(result).toEqual(projects);
    });
  });

  describe('handleGetUsers', () => {
    it('should call API with username parameter', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse([mockUser]));

      const params = { username: 'testuser' };
      await handleGetUsers(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/users?username=testuser',
        expect.any(Object)
      );
    });

    it('should return users data', async () => {
      const users = [mockUser];
      mockEnhancedFetch.mockResolvedValue(createMockResponse(users));

      const result = await handleGetUsers({ username: 'testuser' });

      expect(result).toEqual(users);
    });
  });

  describe('handleGetProject', () => {
    it('should call API with project ID', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockProject));

      const params = { project_id: '123' };
      await handleGetProject(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123?',
        expect.any(Object)
      );
    });

    it('should return project data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockProject));

      const result = await handleGetProject({ project_id: '123' });

      expect(result).toEqual(mockProject);
    });

    it('should handle missing project_id by using undefined', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockProject, 404));

      await expect(handleGetProject({})).rejects.toThrow('GitLab API error: 404');

      // Verify it calls API with undefined project_id (which gets converted to "undefined")
      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/undefined?',
        expect.any(Object)
      );
    });
  });

  describe('handleListNamespaces', () => {
    it('should call namespaces API', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse([mockNamespace]));

      await handleListNamespaces({ per_page: 20 });

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/namespaces?per_page=20',
        expect.any(Object)
      );
    });

    it('should return namespaces data', async () => {
      const namespaces = [mockNamespace];
      mockEnhancedFetch.mockResolvedValue(createMockResponse(namespaces));

      const result = await handleListNamespaces({});

      expect(result).toEqual(namespaces);
    });
  });

  describe('handleGetNamespace', () => {
    it('should call API with namespace ID', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockNamespace));

      const params = { namespace_id: '789' };
      await handleGetNamespace(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/namespaces/789',
        expect.any(Object)
      );
    });

    it('should return namespace data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockNamespace));

      const result = await handleGetNamespace({ namespace_id: '789' });

      expect(result).toEqual(mockNamespace);
    });
  });

  describe('handleVerifyNamespace', () => {
    it('should call API with namespace path', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockNamespace));

      const params = { namespace: 'test-namespace' };
      await handleVerifyNamespace(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/namespaces/test-namespace',
        expect.any(Object)
      );
    });

    it('should return verification result for existing namespace', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockNamespace));

      const result = await handleVerifyNamespace({ namespace: 'test-namespace' });

      expect(result).toEqual({
        exists: true,
        namespace: 'test-namespace',
        status: 200
      });
    });

    it('should return verification result for non-existing namespace', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(null, 404));

      const result = await handleVerifyNamespace({ namespace: 'missing-namespace' });

      expect(result).toEqual({
        exists: false,
        namespace: 'missing-namespace',
        status: 404
      });
    });
  });

  describe('handleListCommits', () => {
    it('should call API with project ID and ref', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse([mockCommit]));

      const params = { project_id: '123', ref_name: 'main' };
      await handleListCommits(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/repository/commits?ref_name=main',
        expect.any(Object)
      );
    });

    it('should return commits data', async () => {
      const commits = [mockCommit];
      mockEnhancedFetch.mockResolvedValue(createMockResponse(commits));

      const result = await handleListCommits({ project_id: '123' });

      expect(result).toEqual(commits);
    });
  });

  describe('handleGetCommit', () => {
    it('should call API with project ID and commit SHA', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockCommit));

      const params = { project_id: '123', commit_sha: 'abc123' };
      await handleGetCommit(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/repository/commits/abc123?',
        expect.any(Object)
      );
    });

    it('should return commit data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockCommit));

      const result = await handleGetCommit({ project_id: '123', commit_sha: 'abc123' });

      expect(result).toEqual(mockCommit);
    });
  });

  describe('handleCreateRepository', () => {
    it('should call API with POST method', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockProject));

      const params = { name: 'new-project', description: 'Test project' };
      await handleCreateRepository(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        })
      );
    });

    it('should return created project data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockProject));

      const result = await handleCreateRepository({ name: 'test-project' });

      expect(result).toEqual(mockProject);
    });
  });

  describe('handleForkRepository', () => {
    it('should call fork API with POST method', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockProject));

      const params = { project_id: '123', namespace: 'target-namespace' };
      await handleForkRepository(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/fork',
        expect.objectContaining({
          method: 'POST'
        })
      );
    });

    it('should return forked project data', async () => {
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockProject));

      const result = await handleForkRepository({ project_id: '123' });

      expect(result).toEqual(mockProject);
    });
  });

  describe('handleCreateBranch', () => {
    it('should call branch creation API with POST method', async () => {
      const mockBranch = {
        name: 'feature-branch',
        commit: mockCommit,
        protected: false
      };
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockBranch));

      const params = { project_id: '123', branch: 'feature-branch', ref: 'main' };
      await handleCreateBranch(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/repository/branches',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded'
          })
        })
      );
    });

    it('should return created branch data', async () => {
      const mockBranch = { name: 'feature-branch', commit: mockCommit };
      mockEnhancedFetch.mockResolvedValue(createMockResponse(mockBranch));

      const result = await handleCreateBranch({ project_id: '123', branch: 'feature-branch', ref: 'main' });

      expect(result).toEqual(mockBranch);
    });
  });

  describe('handleDownloadAttachment', () => {
    it('should call download API and return attachment data', async () => {
      const mockBlob = new ArrayBuffer(1024);
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: jest.fn().mockResolvedValue(mockBlob),
        headers: new Headers({ 'content-type': 'image/png' })
      };
      mockEnhancedFetch.mockResolvedValue(mockResponse as any);

      const params = { project_id: '123', secret: 'secret123', filename: 'image.png' };
      const result = await handleDownloadAttachment(params);

      expect(mockEnhancedFetch).toHaveBeenCalledWith(
        'https://gitlab.example.com/api/v4/projects/123/uploads/secret123/image.png',
        expect.any(Object)
      );
      expect(result).toBeDefined();
    });
  });
});