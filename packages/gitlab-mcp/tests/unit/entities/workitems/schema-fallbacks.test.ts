/**
 * Work item tools on instances whose GraphQL schema predates the namespace-level
 * queries and the richer create input. Instead of hiding the actions, the tools
 * fall back to project/group queries and apply widgets the create input lacks
 * through a follow-up update; only what GitLab cannot do at all is refused.
 */

import { workitemsToolRegistry } from '../../../../src/entities/workitems/registry';
import {
  GET_GROUP_WORK_ITEM_BY_IID,
  GET_NAMESPACE_WORK_ITEMS,
  GET_PROJECT_WORK_ITEM_BY_IID,
  LIST_GROUP_WORK_ITEMS,
  LIST_PROJECT_WORK_ITEMS,
  UPDATE_WORK_ITEM,
} from '../../../../src/graphql/workItems';

const mockRequest = jest.fn();
jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: { getInstance: () => ({ getClient: () => ({ request: mockRequest }) }) },
}));

// Schema capabilities of the simulated instance: "Type.field" keys it lacks.
const missing = new Set<string>();
jest.mock('../../../../src/entities/instance-version', () => ({
  graphqlSupports: (type: string, field?: string) => !missing.has(`${type}.${field}`),
}));

jest.mock('../../../../src/utils/workItemTypes', () => ({
  getWorkItemTypes: () =>
    Promise.resolve([{ id: 'gid://gitlab/WorkItems::Type/2', name: 'Issue' }]),
}));

jest.mock('../../../../src/services/WidgetAvailability', () => ({
  WidgetAvailability: { validateWidgetParams: () => null },
}));

const browse = () => workitemsToolRegistry.get('browse_work_items')!;
const manage = () => workitemsToolRegistry.get('manage_work_item')!;
const item = (iid: string) => ({
  id: `gid://gitlab/WorkItem/${iid}`,
  iid,
  title: 't',
  state: 'OPEN',
});
const connection = (...iids: string[]) => ({
  nodes: iids.map(item),
  pageInfo: { hasNextPage: false, endCursor: null },
});

beforeEach(() => {
  mockRequest.mockReset();
  missing.clear();
});

describe('browse_work_items list', () => {
  it('uses the namespace query when the instance has it', async () => {
    mockRequest.mockResolvedValueOnce({ namespace: { workItems: connection('1') } });
    await browse().handler({ action: 'list', namespace: 'grp/proj' });
    expect(mockRequest.mock.calls[0][0]).toBe(GET_NAMESPACE_WORK_ITEMS);
  });

  it('falls back to the project listing without Namespace.workItems', async () => {
    missing.add('Namespace.workItems');
    mockRequest.mockResolvedValueOnce({ project: { workItems: connection('7') } });

    const result = (await browse().handler({ action: 'list', namespace: 'grp/proj' })) as {
      items: Array<{ iid: string }>;
    };

    expect(mockRequest.mock.calls[0][0]).toBe(LIST_PROJECT_WORK_ITEMS);
    expect(result.items.map((i) => i.iid)).toEqual(['7']);
  });

  it('falls back to the group listing when the path is not a project', async () => {
    missing.add('Namespace.workItems');
    mockRequest
      .mockResolvedValueOnce({ project: null })
      .mockResolvedValueOnce({ group: { workItems: connection('3') } });

    await browse().handler({ action: 'list', namespace: 'grp' });

    expect(mockRequest.mock.calls.map((c) => c[0])).toEqual([
      LIST_PROJECT_WORK_ITEMS,
      LIST_GROUP_WORK_ITEMS,
    ]);
  });

  it('explains when group work items cannot be listed on the instance', async () => {
    missing.add('Namespace.workItems');
    missing.add('Group.workItems');
    mockRequest.mockResolvedValueOnce({ project: null });

    await expect(browse().handler({ action: 'list', namespace: 'grp' })).rejects.toThrow(
      'cannot list group-level work items',
    );
  });
});

describe('browse_work_items get by IID', () => {
  it('falls back to the project listing filtered by IID', async () => {
    missing.add('Namespace.workItem');
    mockRequest.mockResolvedValueOnce({ project: { workItems: connection('5') } });

    const result = (await browse().handler({
      action: 'get',
      namespace: 'grp/proj',
      iid: '5',
    })) as { iid: string };

    expect(mockRequest.mock.calls[0][0]).toBe(GET_PROJECT_WORK_ITEM_BY_IID);
    expect(result.iid).toBe('5');
  });

  it('tries the group when the path is not a project, and reports not found', async () => {
    missing.add('Namespace.workItem');
    mockRequest
      .mockResolvedValueOnce({ project: null })
      .mockResolvedValueOnce({ group: { workItems: { nodes: [] } } });

    await expect(browse().handler({ action: 'get', namespace: 'grp', iid: '9' })).rejects.toThrow(
      'Work item with IID "9" not found in namespace "grp"',
    );
    expect(mockRequest.mock.calls[1][0]).toBe(GET_GROUP_WORK_ITEM_BY_IID);
  });
});

describe('manage_work_item create on an older create input', () => {
  it('applies widgets the create input lacks through one follow-up update', async () => {
    missing.add('WorkItemCreateInput.assigneesWidget');
    missing.add('WorkItemCreateInput.labelsWidget');
    mockRequest
      .mockResolvedValueOnce({ workItemCreate: { workItem: item('1'), errors: [] } })
      .mockResolvedValueOnce({ workItemUpdate: { workItem: item('1'), errors: [] } });

    await manage().handler({
      action: 'create',
      namespace: 'grp/proj',
      title: 't',
      workItemType: 'Issue',
      assigneeIds: ['4'],
      labelIds: ['8'],
      milestoneId: '2',
    });

    const createInput = mockRequest.mock.calls[0][1].input;
    expect(createInput.assigneesWidget).toBeUndefined();
    expect(createInput.labelsWidget).toBeUndefined();
    // Accepted on create: stays in the create call.
    expect(createInput.milestoneWidget).toBeDefined();

    expect(mockRequest.mock.calls[1][0]).toBe(UPDATE_WORK_ITEM);
    expect(mockRequest.mock.calls[1][1].input).toEqual({
      id: 'gid://gitlab/WorkItem/1',
      assigneesWidget: { assigneeIds: ['gid://gitlab/User/4'] },
      // Same label GIDs create would have sent, as an add on the fresh item.
      labelsWidget: { addLabelIds: ['gid://gitlab/ProjectLabel/8'] },
    });
  });

  it('keeps the created item and names the deferred properties when the update fails', async () => {
    missing.add('WorkItemCreateInput.assigneesWidget');
    mockRequest
      .mockResolvedValueOnce({ workItemCreate: { workItem: item('1'), errors: [] } })
      .mockResolvedValueOnce({ workItemUpdate: { workItem: null, errors: ['denied'] } });

    const result = (await manage().handler({
      action: 'create',
      namespace: 'grp/proj',
      title: 't',
      workItemType: 'Issue',
      assigneeIds: ['4'],
    })) as { _warning: { failedProperties: Record<string, { error: string }> } };

    expect(result._warning.failedProperties.assigneeIds.error).toBe('denied');
  });

  it('sends a single create when the instance accepts every widget', async () => {
    mockRequest.mockResolvedValueOnce({ workItemCreate: { workItem: item('1'), errors: [] } });

    await manage().handler({
      action: 'create',
      namespace: 'grp/proj',
      title: 't',
      workItemType: 'Issue',
      assigneeIds: ['4'],
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

describe('manage_work_item update on an older update input', () => {
  it('names the widget the instance cannot update instead of sending the mutation', async () => {
    missing.add('WorkItemUpdateInput.colorWidget');

    await expect(manage().handler({ action: 'update', id: '1', color: '#ff0000' })).rejects.toThrow(
      'This GitLab instance cannot update color on work items',
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
