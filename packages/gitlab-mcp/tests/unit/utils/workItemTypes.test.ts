import { getWorkItemTypes } from '../../../src/utils/workItemTypes';
import { ConnectionManager } from '../../../src/services/ConnectionManager';

// Mock ConnectionManager and GraphQL client
jest.mock('../../../src/services/ConnectionManager');
jest.mock('../../../src/graphql/workItems', () => ({
  GET_WORK_ITEM_TYPES: 'GET_WORK_ITEM_TYPES_QUERY',
  GET_PROJECT_OR_GROUP_WORK_ITEM_TYPES: 'GET_PROJECT_OR_GROUP_WORK_ITEM_TYPES_QUERY',
}));

// Whether the simulated schema has Namespace.workItemTypes. A plain variable so
// resetAllMocks below cannot clear it.
let namespaceWorkItemTypes = true;
jest.mock('../../../src/entities/instance-version', () => ({
  graphqlSupports: () => namespaceWorkItemTypes,
}));

const mockClient = {
  request: jest.fn(),
};

// Mock ConnectionManager.getInstance directly
const mockGetInstance = jest.fn();
ConnectionManager.getInstance = mockGetInstance;

describe('workItemTypes utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();

    // Mock ConnectionManager.getInstance()
    mockGetInstance.mockReturnValue({
      getClient: () => mockClient,
    });
    namespaceWorkItemTypes = true;
  });

  describe('getWorkItemTypes on instances without Namespace.workItemTypes', () => {
    const types = [{ id: 'gid://gitlab/WorkItems::Type/2', name: 'Issue' }];

    beforeEach(() => {
      namespaceWorkItemTypes = false;
    });

    it('reads the types from the project', async () => {
      mockClient.request.mockResolvedValue({ project: { workItemTypes: { nodes: types } } });

      const result = await getWorkItemTypes('grp/proj');

      expect(mockClient.request).toHaveBeenCalledWith(
        'GET_PROJECT_OR_GROUP_WORK_ITEM_TYPES_QUERY',
        { namespacePath: 'grp/proj' },
      );
      expect(result).toEqual(types);
    });

    it('reads the types from the group when the path is not a project', async () => {
      mockClient.request.mockResolvedValue({
        project: null,
        group: { workItemTypes: { nodes: types } },
      });
      expect(await getWorkItemTypes('grp')).toEqual(types);
    });

    it('returns no types when the path is neither', async () => {
      mockClient.request.mockResolvedValue({ project: null, group: null });
      expect(await getWorkItemTypes('missing')).toEqual([]);
    });
  });

  describe('getWorkItemTypes', () => {
    it('should return work item types from GraphQL response', async () => {
      const mockWorkItemTypes = [
        { id: 'gid://gitlab/WorkItems::Type/1', name: 'Epic' },
        { id: 'gid://gitlab/WorkItems::Type/2', name: 'Issue' },
        { id: 'gid://gitlab/WorkItems::Type/3', name: 'Task' },
      ];

      mockClient.request.mockResolvedValue({
        namespace: {
          workItemTypes: {
            nodes: mockWorkItemTypes,
          },
        },
      });

      const result = await getWorkItemTypes('test-namespace');

      expect(mockClient.request).toHaveBeenCalledWith('GET_WORK_ITEM_TYPES_QUERY', {
        namespacePath: 'test-namespace',
      });
      expect(result).toEqual(mockWorkItemTypes);
    });

    it('should return empty array when namespace is null', async () => {
      mockClient.request.mockResolvedValue({
        namespace: null,
      });

      const result = await getWorkItemTypes('non-existent-namespace');

      expect(result).toEqual([]);
    });

    it('should return empty array when workItemTypes is null', async () => {
      mockClient.request.mockResolvedValue({
        namespace: {
          workItemTypes: null,
        },
      });

      const result = await getWorkItemTypes('test-namespace');

      expect(result).toEqual([]);
    });

    it('should return empty array when nodes is null', async () => {
      mockClient.request.mockResolvedValue({
        namespace: {
          workItemTypes: {
            nodes: null,
          },
        },
      });

      const result = await getWorkItemTypes('test-namespace');

      expect(result).toEqual([]);
    });

    it('should handle GraphQL client errors', async () => {
      const error = new Error('GraphQL request failed');
      mockClient.request.mockRejectedValue(error);

      await expect(getWorkItemTypes('test-namespace')).rejects.toThrow('GraphQL request failed');
    });
  });
});
