/**
 * Server-side filters of browse_work_items list and the list_types discovery action.
 * Filters must reach GitLab inside the query, so they apply before pagination; a
 * filter the instance's schema lacks must refuse the call rather than be dropped,
 * which would return items the caller meant to exclude.
 */

import { print } from 'graphql';
import { prepareDocument } from '../../../../src/graphql/prepare-document';
import type { IndexedField, SchemaFieldIndex } from '../../../../src/services/SchemaIntrospector';
import { workitemsToolRegistry } from '../../../../src/entities/workitems/registry';
import { BrowseWorkItemsSchema } from '../../../../src/entities/workitems/schema-readonly';
import {
  GET_PROJECT_OR_GROUP_WORK_ITEM_TYPES,
  GET_WORK_ITEM_TYPES,
  workItemListQuery,
} from '../../../../src/graphql/workItems';

const GET_NAMESPACE_WORK_ITEMS = workItemListQuery('namespace', []);

const mockRequest = jest.fn();
jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: { getInstance: () => ({ getClient: () => ({ request: mockRequest }) }) },
}));

// Schema of the simulated instance: "Type.field" or "Type.field.arg" keys it lacks.
const missing = new Set<string>();
jest.mock('../../../../src/entities/instance-version', () => ({
  graphqlSupports: (type: string, field?: string, arg?: string) =>
    !missing.has(`${type}.${field}`) && !(arg && missing.has(`${type}.${field}.${arg}`)),
}));

const browse = () => workitemsToolRegistry.get('browse_work_items')!;
const page = (iids: string[], hasNextPage = false, endCursor: string | null = null) => ({
  nodes: iids.map((iid) => ({
    id: `gid://gitlab/WorkItem/${iid}`,
    iid,
    title: 't',
    state: 'OPEN',
  })),
  pageInfo: { hasNextPage, endCursor },
});

/** Arguments the query passes to `workItems`, as printed. */
const workItemsArgs = (document: unknown): string =>
  /workItems\(([^)]*)\)/.exec(print(document as Parameters<typeof print>[0]))![1];

beforeEach(() => {
  mockRequest.mockReset();
  missing.clear();
});

describe('workItemListQuery', () => {
  it('carries only the requested filter arguments', () => {
    const args = workItemsArgs(workItemListQuery('project', ['labelName', 'search']));
    expect(args).toContain('search: $search');
    expect(args).toContain('labelName: $labelName');
    // An argument an older schema lacks would fail the whole query even when unset.
    expect(args).not.toContain('assigneeUsernames');
    expect(args).not.toContain('parentIds');
  });

  it('keeps the unfiltered listing free of filter arguments', () => {
    expect(workItemsArgs(GET_NAMESPACE_WORK_ITEMS)).toBe(
      'types: $types, state: $state, first: $first, after: $after',
    );
  });

  it('returns the same document for the same filters in any order', () => {
    // The schema adaptation is cached per document, so a combination reuses it.
    expect(workItemListQuery('group', ['sort', 'search'])).toBe(
      workItemListQuery('group', ['search', 'sort']),
    );
    expect(workItemListQuery('group', [])).toBe(workItemListQuery('group', []));
  });
});

describe('browse_work_items list filters', () => {
  it('sends every filter to GitLab with the page request', async () => {
    mockRequest.mockResolvedValueOnce({ namespace: { workItems: page(['1']) } });

    await browse().handler({
      action: 'list',
      namespace: 'grp/proj',
      search: 'flaky',
      author_username: 'alice',
      assignee_usernames: ['bob', 'carol'],
      label_names: ['bug'],
      milestone_titles: ['v1'],
      parent_ids: ['42', 'gid://gitlab/WorkItem/43'],
      sort: 'UPDATED_ASC',
    });

    const [document, variables] = mockRequest.mock.calls[0];
    expect(document).toBe(
      workItemListQuery('namespace', [
        'search',
        'authorUsername',
        'assigneeUsernames',
        'labelName',
        'milestoneTitle',
        'parentIds',
        'sort',
      ]),
    );
    expect(variables).toMatchObject({
      namespacePath: 'grp/proj',
      search: 'flaky',
      authorUsername: 'alice',
      assigneeUsernames: ['bob', 'carol'],
      labelName: ['bug'],
      milestoneTitle: ['v1'],
      parentIds: ['gid://gitlab/WorkItem/42', 'gid://gitlab/WorkItem/43'],
      sort: 'UPDATED_ASC',
    });
  });

  it('continues a filtered listing from the cursor with GitLab paging info', async () => {
    mockRequest.mockResolvedValueOnce({
      namespace: { workItems: page(['9'], true, 'next-cursor') },
    });

    const result = (await browse().handler({
      action: 'list',
      namespace: 'grp/proj',
      search: 'flaky',
      first: 1,
      after: 'prev-cursor',
    })) as { items: Array<{ iid: string }>; hasMore: boolean; endCursor: string | null };

    expect(mockRequest.mock.calls[0][1]).toMatchObject({
      search: 'flaky',
      first: 1,
      after: 'prev-cursor',
    });
    expect(result.items.map((i) => i.iid)).toEqual(['9']);
    expect(result.hasMore).toBe(true);
    expect(result.endCursor).toBe('next-cursor');
  });

  it('sends no filter variables when none is given', async () => {
    mockRequest.mockResolvedValueOnce({ namespace: { workItems: page([]) } });
    await browse().handler({ action: 'list', namespace: 'grp/proj' });

    const [document, variables] = mockRequest.mock.calls[0];
    expect(document).toBe(GET_NAMESPACE_WORK_ITEMS);
    expect(
      Object.keys(variables)
        .filter((k) => variables[k] !== undefined)
        .sort(),
    ).toEqual(['first', 'namespacePath', 'state']);
  });

  it('refuses a filter the namespace field lacks without listing anything', async () => {
    missing.add('Namespace.workItems.parentIds');
    missing.add('Namespace.workItems.labelName');

    await expect(
      browse().handler({
        action: 'list',
        namespace: 'grp',
        label_names: ['bug'],
        parent_ids: ['1'],
        search: 'x',
      }),
    ).rejects.toThrow('This GitLab instance cannot filter work items by label_names, parent_ids');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('filters the project fallback when the instance lacks Namespace.workItems', async () => {
    missing.add('Namespace.workItems');
    mockRequest.mockResolvedValueOnce({ project: { workItems: page(['7']) } });

    await browse().handler({ action: 'list', namespace: 'grp/proj', author_username: 'alice' });

    expect(mockRequest.mock.calls[0][0]).toBe(workItemListQuery('project', ['authorUsername']));
    expect(mockRequest.mock.calls[0][1].authorUsername).toBe('alice');
  });

  it('refuses on the project fallback before sending a query the schema would reject', async () => {
    missing.add('Namespace.workItems');
    missing.add('Project.workItems.assigneeUsernames');

    await expect(
      browse().handler({ action: 'list', namespace: 'grp/proj', assignee_usernames: ['bob'] }),
    ).rejects.toThrow('This GitLab instance cannot filter work items by assignee_usernames');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('filters the group fallback when the path is not a project', async () => {
    missing.add('Namespace.workItems');
    mockRequest
      .mockResolvedValueOnce({ project: null })
      .mockResolvedValueOnce({ group: { workItems: page(['3']) } });

    const result = (await browse().handler({
      action: 'list',
      namespace: 'grp',
      milestone_titles: ['v1'],
    })) as { items: Array<{ iid: string }> };

    expect(mockRequest.mock.calls[1][0]).toBe(workItemListQuery('group', ['milestoneTitle']));
    expect(mockRequest.mock.calls[1][1].milestoneTitle).toEqual(['v1']);
    expect(result.items.map((i) => i.iid)).toEqual(['3']);
  });

  it('refuses a filter the group field lacks after finding no project', async () => {
    missing.add('Namespace.workItems');
    missing.add('Group.workItems.sort');
    mockRequest.mockResolvedValueOnce({ project: null });

    await expect(
      browse().handler({ action: 'list', namespace: 'grp', sort: 'TITLE_ASC' }),
    ).rejects.toThrow('This GitLab instance cannot filter group work items by sort');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('returns an empty page for an inaccessible namespace', async () => {
    mockRequest.mockResolvedValueOnce({ namespace: null });
    const result = await browse().handler({ action: 'list', namespace: 'secret', search: 'x' });
    expect(result).toEqual({ items: [], hasMore: false, endCursor: null });
  });
});

describe('browse_work_items list filter validation', () => {
  const parse = (extra: Record<string, unknown>) =>
    BrowseWorkItemsSchema.safeParse({ action: 'list', namespace: 'grp', ...extra });

  it.each([
    ['an empty label list', { label_names: [] }],
    ['an empty assignee list', { assignee_usernames: [] }],
    ['an empty search', { search: '' }],
    ['an empty username in a list', { assignee_usernames: [''] }],
    ['more than 100 labels', { label_names: Array.from({ length: 101 }, (_, i) => `l${i}`) }],
    ['an unknown sort', { sort: 'PRIORITY_ASC' }],
  ])('rejects %s', (_label, extra) => {
    expect(parse(extra).success).toBe(false);
  });

  it('accepts 100 values in a list filter', () => {
    expect(
      parse({ milestone_titles: Array.from({ length: 100 }, (_, i) => `m${i}`) }).success,
    ).toBe(true);
  });
});

describe('browse_work_items list_types', () => {
  it('returns each type with the widgets it supports in the namespace', async () => {
    mockRequest.mockResolvedValueOnce({
      namespace: {
        workItemTypes: {
          nodes: [
            {
              id: 'gid://gitlab/WorkItems::Type/1',
              name: 'Issue',
              widgetDefinitions: [{ type: 'ASSIGNEES' }, { type: 'LABELS' }],
            },
          ],
        },
      },
    });

    const result = await browse().handler({ action: 'list_types', namespace: 'grp/proj' });

    expect(mockRequest).toHaveBeenCalledWith(GET_WORK_ITEM_TYPES, {
      namespacePath: 'grp/proj',
      withWidgets: true,
    });
    expect(result).toEqual({
      namespace: 'grp/proj',
      types: [{ id: '1', name: 'Issue', widgets: ['ASSIGNEES', 'LABELS'] }],
    });
  });

  it('omits widgets when the instance cannot list them', async () => {
    // GitLab before 16.7 has no widgetDefinitions; the field is dropped from the query.
    mockRequest.mockResolvedValueOnce({
      namespace: {
        workItemTypes: { nodes: [{ id: 'gid://gitlab/WorkItems::Type/2', name: 'Task' }] },
      },
    });

    const result = await browse().handler({ action: 'list_types', namespace: 'grp/proj' });

    expect(result).toEqual({ namespace: 'grp/proj', types: [{ id: '2', name: 'Task' }] });
  });

  it('reads the types from the project or group without Namespace.workItemTypes', async () => {
    missing.add('Namespace.workItemTypes');
    mockRequest.mockResolvedValueOnce({
      project: null,
      group: { workItemTypes: { nodes: [{ id: 'gid://gitlab/WorkItems::Type/8', name: 'Epic' }] } },
    });

    const result = await browse().handler({ action: 'list_types', namespace: 'grp' });

    expect(mockRequest.mock.calls[0][0]).toBe(GET_PROJECT_OR_GROUP_WORK_ITEM_TYPES);
    expect(result).toEqual({ namespace: 'grp', types: [{ id: '8', name: 'Epic' }] });
  });

  it('reports a namespace it cannot find instead of an empty type list', async () => {
    mockRequest.mockResolvedValueOnce({ namespace: null });

    await expect(browse().handler({ action: 'list_types', namespace: 'secret' })).rejects.toThrow(
      'Namespace "secret" was not found or is not accessible',
    );
  });

  it('requires a namespace', () => {
    expect(BrowseWorkItemsSchema.safeParse({ action: 'list_types' }).success).toBe(false);
  });
});

describe('work item types query on schemas with and without widget definitions', () => {
  const field = (type: string, args: string[] = []): IndexedField => ({
    type,
    args: new Set(args),
  });
  const schema = (typeFields: string[]): SchemaFieldIndex =>
    new Map([
      ['Query', new Map([['namespace', field('Namespace', ['fullPath'])]])],
      ['Namespace', new Map([['workItemTypes', field('WorkItemTypeConnection')]])],
      ['WorkItemTypeConnection', new Map([['nodes', field('WorkItemType')]])],
      ['WorkItemType', new Map(typeFields.map((name) => [name, field('String')]))],
    ]);

  it('drops the widget list and its switch on GitLab before 16.7', () => {
    // A declared but unused variable would make GitLab reject the query.
    const prepared = prepareDocument(GET_WORK_ITEM_TYPES, schema(['id', 'name']));
    const printed = print(prepared.document);
    expect(printed).not.toContain('widgetDefinitions');
    expect(printed).not.toContain('withWidgets');
    expect(prepared.variableNames.has('withWidgets')).toBe(false);
  });

  it('keeps the widget list behind its switch where the schema has it', () => {
    const prepared = prepareDocument(
      GET_WORK_ITEM_TYPES,
      schema(['id', 'name', 'widgetDefinitions']),
    );
    expect(print(prepared.document)).toContain('widgetDefinitions @include(if: $withWidgets)');
    expect(prepared.variableNames.has('withWidgets')).toBe(true);
  });
});
