/**
 * Server-side filters of browse_work_items list and the list_types discovery action.
 * Filters reach GitLab inside the query where its schema has them, so they apply before
 * pagination. A filter the schema lacks is applied to the listed widgets when it can be,
 * and otherwise refuses the call: dropping it would return items meant to be excluded.
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

  it('refuses a missing filter it cannot evaluate locally, without listing anything', async () => {
    // Search needs GitLab's text index; the label filter alone would be emulated.
    missing.add('Namespace.workItems.search');
    missing.add('Namespace.workItems.labelName');

    await expect(
      browse().handler({ action: 'list', namespace: 'grp', label_names: ['bug'], search: 'x' }),
    ).rejects.toThrow('This GitLab instance cannot filter work items by search');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('filters the project fallback when the instance lacks Namespace.workItems', async () => {
    missing.add('Namespace.workItems');
    mockRequest.mockResolvedValueOnce({ project: { workItems: page(['7']) } });

    await browse().handler({ action: 'list', namespace: 'grp/proj', author_username: 'alice' });

    expect(mockRequest.mock.calls[0][0]).toBe(workItemListQuery('project', ['authorUsername']));
    expect(mockRequest.mock.calls[0][1].authorUsername).toBe('alice');
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

/**
 * Instances whose workItems field lacks the assignee, label, milestone or parent
 * argument (before 17.2 / 18.1): the listing reads upstream pages in order and keeps
 * the items whose widgets match, so these filters stay available instead of refused.
 */
describe('browse_work_items list filters applied locally', () => {
  type Widgets = {
    assignees?: string[];
    labels?: string[];
    milestone?: string;
    parent?: string;
  };
  const item = (iid: string, w: Widgets = {}) => ({
    id: `gid://gitlab/WorkItem/${iid}`,
    iid,
    title: 't',
    state: 'OPEN',
    widgets: [
      {
        type: 'ASSIGNEES',
        assignees: { nodes: (w.assignees ?? []).map((username) => ({ username })) },
      },
      { type: 'LABELS', labels: { nodes: (w.labels ?? []).map((title) => ({ title })) } },
      { type: 'MILESTONE', milestone: w.milestone ? { title: w.milestone } : null },
      { type: 'HIERARCHY', parent: w.parent ? { id: `gid://gitlab/WorkItem/${w.parent}` } : null },
    ],
  });
  const upstream = (
    nodes: ReturnType<typeof item>[],
    hasNextPage = false,
    endCursor: string | null = null,
  ) => ({ namespace: { workItems: { nodes, pageInfo: { hasNextPage, endCursor } } } });
  type ListResult = {
    items: Array<{ iid: string }>;
    hasMore: boolean;
    endCursor: string | null;
    note?: string;
  };
  const list = async (args: Record<string, unknown>) =>
    (await browse().handler({ action: 'list', namespace: 'grp/proj', ...args })) as ListResult;
  const filler = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) => item(String(from + i)));

  it('keeps native filters in the query and applies the missing ones to the widgets', async () => {
    missing.add('Namespace.workItems.labelName');
    mockRequest.mockResolvedValueOnce(
      upstream([item('1', { labels: ['bug'] }), item('2'), item('3', { labels: ['bug', 'ui'] })]),
    );

    const result = await list({ label_names: ['bug'], search: 'x' });

    const [document, variables] = mockRequest.mock.calls[0];
    // The query the schema would reject for labelName is never sent.
    expect(document).toBe(workItemListQuery('namespace', ['search']));
    expect(variables).toMatchObject({ search: 'x', first: 100 });
    expect(result.items.map((i) => i.iid)).toEqual(['1', '3']);
    expect(result).toMatchObject({ hasMore: false, endCursor: null });
    expect(result.note).toBeUndefined();
  });

  it('finds a match beyond the first upstream page', async () => {
    missing.add('Namespace.workItems.milestoneTitle');
    mockRequest
      .mockResolvedValueOnce(upstream(filler(1, 100), true, 'c1'))
      .mockResolvedValueOnce(upstream([item('101', { milestone: 'v1' })]));

    const result = await list({ milestone_titles: ['v1', 'v2'] });

    expect(mockRequest.mock.calls[1][1].after).toBe('c1');
    expect(result.items.map((i) => i.iid)).toEqual(['101']);
    expect(result.hasMore).toBe(false);
  });

  it('continues inside an upstream page from the returned cursor without repeating items', async () => {
    missing.add('Namespace.workItems.parentIds');
    const nodes = [
      item('1', { parent: '9' }),
      item('2', { parent: '9' }),
      item('3', { parent: '9' }),
    ];
    mockRequest
      .mockResolvedValueOnce(upstream(nodes, true, 'c1'))
      .mockResolvedValueOnce(upstream(nodes, true, 'c1'))
      .mockResolvedValueOnce(upstream([item('4', { parent: '9' })]));

    const first = await list({ parent_ids: ['9'], first: 2, after: 'start' });
    expect(first.items.map((i) => i.iid)).toEqual(['1', '2']);
    expect(first.hasMore).toBe(true);

    const second = await list({ parent_ids: ['9'], first: 2, after: first.endCursor });
    // The same upstream page is re-read from its own cursor and its first two items skipped.
    expect(mockRequest.mock.calls[1][1].after).toBe('start');
    expect(mockRequest.mock.calls[2][1].after).toBe('c1');
    expect(second.items.map((i) => i.iid)).toEqual(['3', '4']);
    expect(second.hasMore).toBe(false);
  });

  it('stops after a bounded read and says the short page is not the end', async () => {
    missing.add('Namespace.workItems.assigneeUsernames');
    for (let p = 0; p < 10; p++) {
      mockRequest.mockResolvedValueOnce(upstream(filler(p * 100, 100), true, `c${p + 1}`));
    }

    const result = await list({ assignee_usernames: ['nobody'] });

    expect(mockRequest).toHaveBeenCalledTimes(10);
    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(true);
    expect(result.note).toContain('1000 work items were checked');

    mockRequest.mockResolvedValueOnce(upstream([item('x', { assignees: ['nobody'] })]));
    const next = await list({ assignee_usernames: ['nobody'], after: result.endCursor });
    expect(mockRequest.mock.calls[10][1].after).toBe('c10');
    expect(next.items.map((i) => i.iid)).toEqual(['x']);
  });

  it('applies GitLab semantics: all assignees and labels, any milestone or parent', async () => {
    missing.add('Namespace.workItems.assigneeUsernames');
    missing.add('Namespace.workItems.labelName');
    missing.add('Namespace.workItems.milestoneTitle');
    missing.add('Namespace.workItems.parentIds');
    const all = {
      assignees: ['Bob', 'carol'],
      labels: ['bug', 'ui'],
      milestone: 'v2',
      parent: '8',
    };
    mockRequest.mockResolvedValueOnce(
      upstream([
        item('match', all),
        item('one-assignee', { ...all, assignees: ['bob'] }),
        item('one-label', { ...all, labels: ['bug'] }),
        item('other-milestone', { ...all, milestone: 'v3' }),
        item('no-milestone', { ...all, milestone: undefined }),
        item('other-parent', { ...all, parent: '7' }),
        item('no-parent', { ...all, parent: undefined }),
      ]),
    );

    const result = await list({
      assignee_usernames: ['bob', 'Carol'],
      label_names: ['bug', 'ui'],
      milestone_titles: ['v1', 'v2'],
      parent_ids: ['8', '9'],
    });

    expect(mockRequest.mock.calls[0][0]).toBe(workItemListQuery('namespace', []));
    expect(result.items.map((i) => i.iid)).toEqual(['match']);
  });

  it('applies missing filters on the project and group fallbacks', async () => {
    missing.add('Namespace.workItems');
    missing.add('Project.workItems.labelName');
    missing.add('Group.workItems.labelName');
    mockRequest.mockResolvedValueOnce({ project: null }).mockResolvedValueOnce({
      group: {
        workItems: {
          nodes: [item('5', { labels: ['bug'] }), item('6')],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    const result = await list({ namespace: 'grp', label_names: ['bug'] });

    expect(mockRequest.mock.calls[0][0]).toBe(workItemListQuery('project', []));
    expect(mockRequest.mock.calls[1][0]).toBe(workItemListQuery('group', []));
    expect(result.items.map((i) => i.iid)).toEqual(['5']);
  });

  const scanCursor = (payload: unknown) =>
    `scan:${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;

  // A forged or corrupted cursor must not turn into an arbitrary upstream position.
  it.each([
    ['not JSON', 'scan:not-json'],
    ['not an object', scanCursor(5)],
    ['a skip past the page', scanCursor({ after: 'c1', skip: 100 })],
    ['a negative skip', scanCursor({ skip: -1 })],
    ['a non-string upstream cursor', scanCursor({ after: 7, skip: 0 })],
  ])('rejects a cursor that is %s', async (_label, after) => {
    missing.add('Namespace.workItems.labelName');
    await expect(list({ label_names: ['bug'], after })).rejects.toThrow('Invalid "after" cursor');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('ends the listing when the page fills on the last upstream item', async () => {
    missing.add('Namespace.workItems.labelName');
    mockRequest.mockResolvedValueOnce(upstream([item('1'), item('2', { labels: ['bug'] })]));

    const result = await list({ label_names: ['bug'], first: 1 });

    expect(result).toMatchObject({ items: [{ iid: '2' }], hasMore: false, endCursor: null });
  });

  it('continues from the upstream cursor when the page fills on an upstream page end', async () => {
    missing.add('Namespace.workItems.labelName');
    mockRequest.mockResolvedValueOnce(
      upstream([item('1'), item('2', { labels: ['bug'] })], true, 'c1'),
    );

    const result = await list({ label_names: ['bug'], first: 1 });

    // A plain GitLab cursor: the next call starts at the following upstream page.
    expect(result).toMatchObject({ items: [{ iid: '2' }], hasMore: true, endCursor: 'c1' });
  });

  it('stops with what it found when the namespace disappears between pages', async () => {
    missing.add('Namespace.workItems.labelName');
    mockRequest
      .mockResolvedValueOnce(upstream([item('1', { labels: ['bug'] })], true, 'c1'))
      .mockResolvedValueOnce({ namespace: null });

    const result = await list({ label_names: ['bug'] });

    expect(result).toMatchObject({ items: [{ iid: '1' }], hasMore: false, endCursor: null });
  });

  it('treats a namespace without a readable work item connection as empty', async () => {
    missing.add('Namespace.workItems.labelName');
    mockRequest.mockResolvedValueOnce({ namespace: { workItems: null } });

    const result = await list({ label_names: ['bug'] });

    expect(result).toMatchObject({ items: [], hasMore: false, endCursor: null });
  });

  it('keeps the filters visible to every supported GitLab version', () => {
    expect(browse().requirements?.parameters).toBeUndefined();
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
