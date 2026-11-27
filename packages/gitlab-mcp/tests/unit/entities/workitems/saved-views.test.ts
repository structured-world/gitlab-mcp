/**
 * Saved work item views: listing a namespace's views and reading one with its items.
 * GitLab has no server-side result for a view, so its stored filters become
 * `workItems` arguments the way GitLab's list applies them. Whatever the instance
 * cannot apply is reported and the result is marked inexact, never passed off as the
 * view's own result.
 */

import { print } from 'graphql';
import { workitemsToolRegistry } from '../../../../src/entities/workitems/registry';
import { BrowseWorkItemsSchema } from '../../../../src/entities/workitems/schema-readonly';
import { planViewQuery, savedViewGid } from '../../../../src/entities/workitems/saved-views';
import {
  GET_FILTERABLE_WORK_ITEM_TYPES,
  getSavedViewQuery,
  listSavedViewsQuery,
  savedViewItemsQuery,
} from '../../../../src/graphql/savedViews';

/** Every newer view field confirmed, as on a current instance with a known schema. */
const ALL_EXTRAS = { isPrivate: true, updatedAt: true, author: true, filterableTypes: true };

const mockRequest = jest.fn();
jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: { getInstance: () => ({ getClient: () => ({ request: mockRequest }) }) },
}));

// Schema of the simulated instance: "Type.field" or "Type.field.arg" keys it lacks.
// For an input object the field is an input field, for an enum a value.
const missing = new Set<string>();
// Whether the schema is known at all; without it nothing can be confirmed.
let schemaKnown = true;
jest.mock('../../../../src/entities/instance-version', () => {
  const supports = (type: string, field?: string, arg?: string) =>
    !missing.has(type) &&
    !missing.has(`${type}.${field}`) &&
    !(arg && missing.has(`${type}.${field}.${arg}`));
  return {
    graphqlSupports: supports,
    graphqlConfirms: (type: string, field: string) => schemaKnown && supports(type, field),
  };
});

// The working scope and the operator's project list of the running call.
const reach = { descendants: true, outside: new Set<string>() };
jest.mock('../../../../src/configuration/call-scope', () => ({
  namespaceInCallScope: async (path: string) => !reach.outside.has(path),
  descendantsInCallScope: () => reach.descendants,
}));

const browse = () => workitemsToolRegistry.get('browse_work_items')!;

const VIEW_GID = 'gid://gitlab/WorkItems::SavedViews::SavedView/42';

const view = (overrides: Record<string, unknown> = {}) => ({
  id: VIEW_GID,
  name: 'Team bugs',
  description: 'Open bugs of the team',
  isPrivate: false,
  subscribed: true,
  sort: 'UPDATED_DESC',
  shareUrl: 'https://gitlab.example.com/grp/-/work_items/views/42',
  filters: { labelName: ['bug'] },
  filterWarnings: [],
  displaySettings: { viewMode: 'list' },
  ...overrides,
});

const itemsPage = (iids: string[], hasNextPage = false, endCursor: string | null = null) => ({
  namespace: {
    workItems: {
      nodes: iids.map((iid) => ({
        id: `gid://gitlab/WorkItem/${iid}`,
        iid,
        title: `item ${iid}`,
        state: 'OPEN',
        workItemType: { id: 'gid://gitlab/WorkItems::Type/1', name: 'Issue' },
      })),
      pageInfo: { hasNextPage, endCursor },
    },
  },
});

/** Every type filterable, so the list's default needs no type restriction. */
const allFilterable = [{ id: 'gid://gitlab/WorkItems::Type/1', isFilterableListView: true }];

/** GitLab's answer to the saved view query: the view and the namespace's types. */
const viewResponse = (
  read: Record<string, unknown> | null,
  types: Array<{ id: string; isFilterableListView?: boolean }> = allFilterable,
) => ({
  namespace: {
    __typename: 'Group',
    workItemTypes: { nodes: types },
    savedViews: { nodes: read ? [read] : [] },
  },
});

beforeEach(() => {
  mockRequest.mockReset();
  missing.clear();
  schemaKnown = true;
  reach.descendants = true;
  reach.outside.clear();
});

describe('planViewQuery', () => {
  it('sends stored enum values under the names GitLab accepts', () => {
    // GitLab stores internal values; sending `issue` or `on_track` as an enum variable
    // would fail the whole query.
    const plan = planViewQuery(
      'grp',
      {
        types: ['issue', 'key_result'],
        in: ['title'],
        subscribed: 'explicitly_subscribed',
        healthStatusFilter: 'needs_attention',
        state: 'opened',
        assigneeWildcardId: 'NONE',
      },
      null,
    );

    expect(plan.args).toMatchObject({
      types: ['ISSUE', 'KEY_RESULT'],
      in: ['TITLE'],
      subscribed: 'EXPLICITLY_SUBSCRIBED',
      healthStatusFilter: 'needsAttention',
      state: 'opened',
      assigneeWildcardId: 'NONE',
    });
    expect(plan.unapplied).toEqual([]);
  });

  it('keeps the NONE and ANY health statuses as they are named', () => {
    expect(planViewQuery('grp', { healthStatusFilter: 'none' }, null).args.healthStatusFilter).toBe(
      'NONE',
    );
  });

  it('checks a negated enum filter against the enum of the negated input', () => {
    // Negated milestone wildcards have their own enum without NONE; validating
    // against the positive enum would send a value GitLab rejects.
    missing.add('NegatedMilestoneWildcardId.NONE');
    const plan = planViewQuery(
      'grp',
      {
        milestoneWildcardId: 'NONE',
        not: { milestoneWildcardId: 'NONE', healthStatusFilter: ['at_risk'], labelName: ['wip'] },
      },
      null,
    );

    expect(plan.args.milestoneWildcardId).toBe('NONE');
    expect(plan.args.not).toEqual({ healthStatusFilter: ['atRisk'], labelName: ['wip'] });
    expect(plan.unapplied).toEqual(['not.milestoneWildcardId']);
  });

  it('includes descendant groups and projects, and every state, by default', () => {
    // GitLab's list shows a group's whole tree and all states unless the view narrows it.
    const plan = planViewQuery('grp', { labelName: ['bug'] }, null);

    expect(plan.namespacePath).toBe('grp');
    expect(plan.args).toEqual({ includeDescendants: true, labelName: ['bug'] });
  });

  it("lists only a scoped group's own items when the view has a group filter", () => {
    const plan = planViewQuery('grp', { fullPath: 'grp/sub', labelName: ['bug'] }, null);

    expect(plan.namespacePath).toBe('grp/sub');
    expect(plan.args).toEqual({
      includeDescendants: false,
      excludeProjects: true,
      labelName: ['bug'],
    });
  });

  it("lets the view's own hierarchy settings win over the defaults", () => {
    const plan = planViewQuery('grp', { includeDescendants: false }, null);
    expect(plan.args.includeDescendants).toBe(false);
  });

  it('reports filters the instance lacks instead of sending them', () => {
    // An unknown argument or input field fails the whole query; leaving it out
    // broadens the result, so it must be named.
    missing.add('Namespace.workItems.status');
    missing.add('NegatedWorkItemFilterInput.types');
    const plan = planViewQuery(
      'grp',
      { status: { name: 'In progress' }, not: { types: ['task'], labelName: ['wip'] } },
      null,
    );

    expect(plan.args.status).toBeUndefined();
    expect(plan.args.not).toEqual({ labelName: ['wip'] });
    expect(plan.unapplied).toEqual(['status', 'not.types']);
  });

  it('names a whole input filter once when none of its fields can be sent', () => {
    missing.add('HierarchyFilterInput.parentWildcardId');
    const plan = planViewQuery('grp', { hierarchyFilters: { parentWildcardId: 'NONE' } }, null);

    expect(plan.args.hierarchyFilters).toBeUndefined();
    expect(plan.unapplied).toEqual(['hierarchyFilters.parentWildcardId']);
  });

  it('reports a filter it does not know rather than guessing its type', () => {
    const plan = planViewQuery('grp', { someFutureFilter: 'x' }, null);
    expect(plan.unapplied).toEqual(['someFutureFilter']);
    expect(plan.args.someFutureFilter).toBeUndefined();
  });

  it('reports an enum value the instance does not have', () => {
    missing.add('IssueType.KEY_RESULT');
    const plan = planViewQuery('grp', { types: ['issue', 'key_result'] }, null);

    expect(plan.args.types).toBeUndefined();
    expect(plan.unapplied).toEqual(['types']);
  });

  it('does not report a default the instance cannot take', () => {
    // includeDescendants is not a filter of the view, so its absence is not a gap.
    missing.add('Namespace.workItems.includeDescendants');
    const plan = planViewQuery('grp', {}, null);

    expect(plan.args).toEqual({});
    expect(plan.unapplied).toEqual([]);
  });

  it('sends a lone stored author as the single username the argument takes', () => {
    expect(planViewQuery('grp', { authorUsername: ['alice'] }, null).args.authorUsername).toBe(
      'alice',
    );

    // Several authors cannot be expressed by a single-username argument.
    const plan = planViewQuery('grp', { authorUsername: ['alice', 'bob'] }, null);
    expect(plan.args.authorUsername).toBeUndefined();
    expect(plan.unapplied).toEqual(['authorUsername']);
  });

  it('skips empty and null stored filters', () => {
    const plan = planViewQuery('grp', { not: {}, search: null, labelName: ['bug'] }, null);
    expect(plan.args).toEqual({ includeDescendants: true, labelName: ['bug'] });
    expect(plan.unapplied).toEqual([]);
  });

  it("applies the view's sort, and reports one the instance cannot use", () => {
    expect(planViewQuery('grp', {}, 'TITLE_ASC').args.sort).toBe('TITLE_ASC');

    missing.add('WorkItemSort.STATUS_ASC');
    const plan = planViewQuery('grp', {}, 'STATUS_ASC');
    expect(plan.args.sort).toBeUndefined();
    expect(plan.unapplied).toEqual(['sort']);
  });
});

describe('savedViewGid', () => {
  it('builds the global ID from a numeric ID and keeps a saved view global ID', () => {
    expect(savedViewGid('42')).toBe(VIEW_GID);
    expect(savedViewGid(VIEW_GID)).toBe(VIEW_GID);
  });

  it('refuses another global ID or a malformed one', () => {
    // A work item ID passed by mistake must not be read as a view ID.
    expect(() => savedViewGid('gid://gitlab/WorkItem/42')).toThrow('is not a saved view ID');
    expect(() => savedViewGid('42a')).toThrow('is not a saved view ID');
  });
});

describe('browse_work_items list_saved_views', () => {
  it("lists the namespace's views with GitLab's paging", async () => {
    mockRequest.mockResolvedValueOnce({
      namespace: {
        savedViews: {
          nodes: [
            view(),
            // Before 18.10 visibility is only under `private`.
            {
              ...view({ id: 'gid://gitlab/WorkItems::SavedViews::SavedView/7' }),
              isPrivate: undefined,
              private: true,
            },
          ],
          pageInfo: { hasNextPage: true, endCursor: 'views-next' },
        },
      },
    });

    const result = (await browse().handler({
      action: 'list_saved_views',
      namespace: 'grp',
      search: 'bugs',
      subscribed_only: true,
      first: 2,
      after: 'views-prev',
    })) as {
      views: Array<{ id: string; isPrivate: boolean; name: string }>;
      hasMore: boolean;
      endCursor: string | null;
    };

    const [document, variables] = mockRequest.mock.calls[0];
    expect(document).toBe(listSavedViewsQuery(ALL_EXTRAS));
    expect(variables).toEqual({
      namespacePath: 'grp',
      search: 'bugs',
      subscribedOnly: true,
      first: 2,
      after: 'views-prev',
    });
    expect(result.views.map((v) => [v.id, v.isPrivate])).toEqual([
      ['42', false],
      ['7', true],
    ]);
    expect(result.hasMore).toBe(true);
    expect(result.endCursor).toBe('views-next');
  });

  it('reports a namespace it cannot find instead of an empty list', async () => {
    mockRequest.mockResolvedValueOnce({ namespace: null });

    await expect(
      browse().handler({ action: 'list_saved_views', namespace: 'grp/missing' }),
    ).rejects.toThrow('Namespace "grp/missing" was not found or is not accessible');
  });

  it('returns an empty list for a namespace without views', async () => {
    mockRequest.mockResolvedValueOnce({
      namespace: { savedViews: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    });

    const result = await browse().handler({ action: 'list_saved_views', namespace: 'grp' });
    expect(result).toEqual({ namespace: 'grp', views: [], hasMore: false, endCursor: null });
  });

  it('says so when the instance has no saved views at all', async () => {
    missing.add('Namespace.savedViews');

    await expect(
      browse().handler({ action: 'list_saved_views', namespace: 'grp' }),
    ).rejects.toThrow('This GitLab instance has no saved work item views');
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('browse_work_items get_saved_view', () => {
  it("reads the view, then its items with the view's filters and sort", async () => {
    mockRequest
      .mockResolvedValueOnce(viewResponse(view()))
      .mockResolvedValueOnce(itemsPage(['5', '6'], true, 'items-next'));

    const result = (await browse().handler({
      action: 'get_saved_view',
      namespace: 'grp',
      view_id: '42',
      first: 2,
      after: 'items-prev',
    })) as Record<string, unknown> & {
      view: Record<string, unknown>;
      items: Array<{ id: string; workItemType: string }>;
    };

    expect(mockRequest.mock.calls[0]).toEqual([
      getSavedViewQuery(ALL_EXTRAS),
      { namespacePath: 'grp', id: VIEW_GID },
    ]);
    // The namespace's types came with the view, so no request is spent on them.
    expect(mockRequest).toHaveBeenCalledTimes(2);
    const [document, variables] = mockRequest.mock.calls[1];
    expect(document).toBe(savedViewItemsQuery(['includeDescendants', 'labelName', 'sort']));
    expect(variables).toEqual({
      namespacePath: 'grp',
      first: 2,
      after: 'items-prev',
      includeDescendants: true,
      labelName: ['bug'],
      sort: 'UPDATED_DESC',
    });

    expect(result.view).toMatchObject({
      id: '42',
      name: 'Team bugs',
      sort: 'UPDATED_DESC',
      filters: { labelName: ['bug'] },
      displaySettings: { viewMode: 'list' },
    });
    expect(result.items.map((i) => [i.id, i.workItemType])).toEqual([
      ['5', 'Issue'],
      ['6', 'Issue'],
    ]);
    expect(result).toMatchObject({ hasMore: true, endCursor: 'items-next', exact: true });
    expect(result.note).toBeUndefined();
  });

  it("restricts to the types GitLab's list offers when the view names none", async () => {
    mockRequest
      .mockResolvedValueOnce(
        viewResponse(view(), [
          { id: 'gid://gitlab/WorkItems::Type/1', isFilterableListView: true },
          { id: 'gid://gitlab/WorkItems::Type/9', isFilterableListView: false },
        ]),
      )
      .mockResolvedValueOnce(itemsPage([]));

    await browse().handler({ action: 'get_saved_view', namespace: 'grp', view_id: '42' });

    expect(mockRequest.mock.calls[1][1]).toMatchObject({
      workItemTypeIds: ['gid://gitlab/WorkItems::Type/1'],
    });
  });

  it('keeps the types the view names and does not look up the default', async () => {
    mockRequest
      .mockResolvedValueOnce(
        viewResponse(view({ filters: { types: ['task'] } }), [
          { id: 'gid://gitlab/WorkItems::Type/9', isFilterableListView: false },
        ]),
      )
      .mockResolvedValueOnce(itemsPage([]));

    await browse().handler({ action: 'get_saved_view', namespace: 'grp', view_id: '42' });

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[1][1]).toMatchObject({ types: ['TASK'] });
    expect(mockRequest.mock.calls[1][1]).not.toHaveProperty('workItemTypeIds');
  });

  it('marks the result inexact when the default types cannot be known', async () => {
    // Before 18.10 the schema has no isFilterableListView and the query drops it.
    missing.add('WorkItemType.isFilterableListView');
    mockRequest
      .mockResolvedValueOnce(viewResponse(view(), [{ id: 'gid://gitlab/WorkItems::Type/1' }]))
      .mockResolvedValueOnce(itemsPage(['5']));

    const result = (await browse().handler({
      action: 'get_saved_view',
      namespace: 'grp',
      view_id: '42',
    })) as { exact: boolean; note: string };

    expect(result.exact).toBe(false);
    expect(result.note).toContain('items of every type are included');
    expect(mockRequest.mock.calls[1][1]).not.toHaveProperty('workItemTypeIds');
  });

  it('marks the result inexact and names filters the instance cannot apply', async () => {
    missing.add('Namespace.workItems.status');
    mockRequest
      .mockResolvedValueOnce(
        viewResponse(view({ filters: { labelName: ['bug'], status: { name: 'Done' } } })),
      )
      .mockResolvedValueOnce(itemsPage(['5']));

    const result = (await browse().handler({
      action: 'get_saved_view',
      namespace: 'grp',
      view_id: '42',
    })) as { exact: boolean; unappliedFilters: string[]; note: string };

    expect(result.exact).toBe(false);
    expect(result.unappliedFilters).toEqual(['status']);
    expect(result.note).toContain('cannot apply status');
    expect(mockRequest.mock.calls[1][1]).not.toHaveProperty('status');
  });

  it("passes on GitLab's warnings about filter values it dropped", async () => {
    // A deleted label leaves the view broader than saved; GitLab says so in filterWarnings.
    const warnings = [{ field: 'label_name', message: '1 label(s) not found' }];
    mockRequest
      .mockResolvedValueOnce(viewResponse(view({ filterWarnings: warnings })))
      .mockResolvedValueOnce(itemsPage(['5']));

    const result = (await browse().handler({
      action: 'get_saved_view',
      namespace: 'grp',
      view_id: '42',
    })) as { exact: boolean; filterWarnings: unknown };

    expect(result.exact).toBe(false);
    expect(result.filterWarnings).toEqual(warnings);
  });

  it("says the order is GitLab's default, not the view's, when the view has no sort", async () => {
    mockRequest
      .mockResolvedValueOnce(viewResponse(view({ sort: null })))
      .mockResolvedValueOnce(itemsPage(['5']));

    const result = (await browse().handler({
      action: 'get_saved_view',
      namespace: 'grp',
      view_id: '42',
    })) as { exact: boolean; note: string };

    expect(mockRequest.mock.calls[1][1]).not.toHaveProperty('sort');
    expect(result.exact).toBe(false);
    expect(result.note).toContain('your sort preference');
  });

  it('lists the scoped group of a view with a group filter, with that group types', async () => {
    // The types read with the view belong to the view's namespace, not the scoped group.
    mockRequest
      .mockResolvedValueOnce(viewResponse(view({ filters: { fullPath: 'grp/sub' } })))
      .mockResolvedValueOnce({
        namespace: {
          workItemTypes: {
            nodes: [
              { id: 'gid://gitlab/WorkItems::Type/8', isFilterableListView: true },
              { id: 'gid://gitlab/WorkItems::Type/9', isFilterableListView: false },
            ],
          },
        },
      })
      .mockResolvedValueOnce(itemsPage([]));

    const result = (await browse().handler({
      action: 'get_saved_view',
      namespace: 'grp',
      view_id: '42',
    })) as { namespace: string };

    expect(mockRequest.mock.calls[1]).toEqual([
      GET_FILTERABLE_WORK_ITEM_TYPES,
      { namespacePath: 'grp/sub' },
    ]);
    expect(mockRequest.mock.calls[2][1]).toMatchObject({
      namespacePath: 'grp/sub',
      workItemTypeIds: ['gid://gitlab/WorkItems::Type/8'],
    });
    expect(result.namespace).toBe('grp/sub');
  });

  it('reports a view that is missing or not visible without guessing which', async () => {
    mockRequest.mockResolvedValueOnce(viewResponse(null));

    await expect(
      browse().handler({ action: 'get_saved_view', namespace: 'grp', view_id: '42' }),
    ).rejects.toThrow('Saved view 42 was not found in "grp" or is not visible to you');
  });

  it('reports a namespace it cannot find', async () => {
    mockRequest.mockResolvedValueOnce({ namespace: null });

    await expect(
      browse().handler({ action: 'get_saved_view', namespace: 'grp/missing', view_id: '42' }),
    ).rejects.toThrow('Namespace "grp/missing" was not found or is not accessible');
  });

  it('refuses an ID that is not a saved view before asking GitLab', async () => {
    await expect(
      browse().handler({
        action: 'get_saved_view',
        namespace: 'grp',
        view_id: 'gid://gitlab/WorkItem/42',
      }),
    ).rejects.toThrow('is not a saved view ID');
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('saved view results that must not pass for the view', () => {
  const read = (overrides: Record<string, unknown> = {}) =>
    browse().handler({ action: 'get_saved_view', namespace: 'grp', view_id: '42', ...overrides });

  it('sends relative date units under their enum names and reports a unit it cannot send', () => {
    // A nested enum sent as stored would fail the whole query.
    missing.add('WorkItemRelativeDateUnit.FORTNIGHT');
    const plan = planViewQuery(
      'grp',
      {
        relativeDateFilters: {
          createdAfter: { amount: -7, unit: 'day' },
          updatedAfter: { amount: -1, unit: 'fortnight' },
        },
      },
      null,
    );

    expect(plan.args.relativeDateFilters).toEqual({ createdAfter: { amount: -7, unit: 'DAY' } });
    expect(plan.unapplied).toEqual(['relativeDateFilters.updatedAfter']);
  });

  it('does not take a missing type list for every type being offered', async () => {
    // No list from GitLab says nothing about its defaults, so the result cannot be exact.
    mockRequest
      .mockResolvedValueOnce({
        namespace: { __typename: 'Group', workItemTypes: null, savedViews: { nodes: [view()] } },
      })
      .mockResolvedValueOnce(itemsPage(['5']));

    const result = (await read()) as { exact: boolean; note: string };

    expect(result.exact).toBe(false);
    expect(result.note).toContain('items of every type are included');
  });

  it('reports a scoped namespace whose items the reader cannot see', async () => {
    // A shared view may filter on a project its reader has no access to; an empty page
    // would read as "no matches".
    mockRequest
      .mockResolvedValueOnce(viewResponse(view({ filters: { fullPath: 'grp/private' } })))
      .mockResolvedValueOnce({ namespace: { workItemTypes: { nodes: allFilterable } } })
      .mockResolvedValueOnce({ namespace: null });

    await expect(read()).rejects.toThrow(
      'Saved view 42 lists work items of "grp/private", which was not found or is not accessible',
    );
  });

  it('keeps an empty page of a reachable namespace as an empty result', async () => {
    mockRequest.mockResolvedValueOnce(viewResponse(view())).mockResolvedValueOnce(itemsPage([]));

    const result = (await read()) as { items: unknown[]; exact: boolean };
    expect(result.items).toEqual([]);
    expect(result.exact).toBe(true);
  });

  it('marks the result inexact when the view has no sort', async () => {
    // GitLab's list would use the reader's sort preference, which may differ.
    mockRequest
      .mockResolvedValueOnce(viewResponse(view({ sort: null })))
      .mockResolvedValueOnce(itemsPage(['5']));

    expect(((await read()) as { exact: boolean }).exact).toBe(false);
  });

  it('selects only the view fields GitLab 18.9 has when the schema is unknown', async () => {
    // Without introspection nothing can be dropped, so a newer field would fail the query.
    schemaKnown = false;
    mockRequest
      .mockResolvedValueOnce({
        namespace: { savedViews: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
      })
      .mockResolvedValueOnce(viewResponse(view()))
      .mockResolvedValueOnce(itemsPage([]));

    await browse().handler({ action: 'list_saved_views', namespace: 'grp' });
    await read();

    for (const call of mockRequest.mock.calls.slice(0, 2)) {
      const printed = print(call[0] as Parameters<typeof print>[0]);
      expect(printed).toContain('private');
      expect(printed).not.toMatch(/isPrivate|updatedAt|author/);
    }
  });

  it('selects the newer view fields when the schema confirms them', async () => {
    mockRequest.mockResolvedValueOnce({
      namespace: { savedViews: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    });

    await browse().handler({ action: 'list_saved_views', namespace: 'grp' });

    const printed = print(mockRequest.mock.calls[0][0] as Parameters<typeof print>[0]);
    expect(printed).toMatch(/isPrivate[\s\S]*updatedAt[\s\S]*author/);
  });

  it('refuses a view that lists a namespace outside the call scope', async () => {
    // The call named "grp"; the view's group filter reaches "elsewhere", which the working
    // scope or the operator's project list does not cover.
    reach.outside.add('elsewhere');
    mockRequest.mockResolvedValueOnce(viewResponse(view({ filters: { fullPath: 'elsewhere' } })));

    await expect(read()).rejects.toThrow(
      'Saved view 42 lists work items of "elsewhere", outside the projects and groups this call may read',
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('keeps to the group itself when its descendants are outside the call scope', async () => {
    // A group scope without its subgroups: the view's default descendant expansion would
    // list items of subgroup projects.
    reach.descendants = false;
    mockRequest.mockResolvedValueOnce(viewResponse(view())).mockResolvedValueOnce(itemsPage(['5']));

    const result = (await read()) as { exact: boolean; note: string };

    expect(mockRequest.mock.calls[1][1]).toMatchObject({ includeDescendants: false });
    expect(result.exact).toBe(false);
    expect(result.note).toContain('outside the working scope');
  });
});

describe('saved view edge cases', () => {
  const read = (overrides: Record<string, unknown> = {}) =>
    browse().handler({ action: 'get_saved_view', namespace: 'grp', view_id: '42', ...overrides });

  it('checks each entry of a list of input filters on its own', () => {
    // A custom field filter is a list of inputs; a field one entry lacks is named by index.
    missing.add('WorkItemWidgetCustomFieldFilterInputType.textValue');
    const plan = planViewQuery(
      'grp',
      {
        customField: [
          { customFieldId: 'gid://gitlab/Issuables::CustomField/1', selectedOptionIds: ['o1'] },
          { customFieldId: 'gid://gitlab/Issuables::CustomField/2', textValue: 'x' },
        ],
      },
      null,
    );

    expect(plan.args.customField).toEqual([
      { customFieldId: 'gid://gitlab/Issuables::CustomField/1', selectedOptionIds: ['o1'] },
      { customFieldId: 'gid://gitlab/Issuables::CustomField/2' },
    ]);
    expect(plan.unapplied).toEqual(['customField[1].textValue']);
  });

  it('says the default order is used when the instance cannot sort as the view does', async () => {
    missing.add('WorkItemSort.STATUS_ASC');
    mockRequest
      .mockResolvedValueOnce(viewResponse(view({ sort: 'STATUS_ASC' })))
      .mockResolvedValueOnce(itemsPage(['5']));

    const result = (await read()) as { exact: boolean; note: string; unappliedFilters: string[] };

    expect(result.exact).toBe(false);
    expect(result.unappliedFilters).toEqual(['sort']);
    expect(result.note).toContain('cannot sort by STATUS_ASC');
    expect(result.note).not.toContain('cannot apply');
  });

  it('does not narrow a project, which has no descendants to keep out', async () => {
    // GitLab ignores includeDescendants for a project, so a scope without subgroups
    // changes nothing and the result stays exact.
    reach.descendants = false;
    mockRequest
      .mockResolvedValueOnce({
        namespace: {
          __typename: 'Project',
          workItemTypes: { nodes: allFilterable },
          savedViews: { nodes: [view()] },
        },
      })
      .mockResolvedValueOnce(itemsPage(['5']));

    const result = (await read({ namespace: 'grp/app' })) as { exact: boolean };

    expect(mockRequest.mock.calls[1][1]).toMatchObject({ includeDescendants: true });
    expect(result.exact).toBe(true);
  });

  it('reads a view without filters, warnings or author', async () => {
    mockRequest
      .mockResolvedValueOnce(
        viewResponse(
          view({ filters: null, filterWarnings: null, author: null, updatedAt: '2026-11-27' }),
        ),
      )
      .mockResolvedValueOnce(itemsPage([]));

    const result = (await read()) as {
      view: { filters: unknown; author: unknown; updatedAt: string };
      exact: boolean;
    };

    expect(result.view).toMatchObject({ filters: {}, author: null, updatedAt: '2026-11-27' });
    expect(result.exact).toBe(true);
  });
});

describe('savedViewItemsQuery', () => {
  it('declares only the arguments it passes, with their GitLab types', () => {
    // An undeclared or unused variable fails the query; an argument the instance lacks
    // must not appear at all.
    const printed = print(savedViewItemsQuery(['types', 'not']));
    expect(printed).toContain('$types: [IssueType!]');
    expect(printed).toContain('$not: NegatedWorkItemFilterInput');
    expect(printed).toContain('types: $types');
    expect(printed).not.toContain('labelName');
  });

  it('returns the same document for the same arguments in any order', () => {
    expect(savedViewItemsQuery(['sort', 'types'])).toBe(savedViewItemsQuery(['types', 'sort']));
  });
});

describe('saved view action schemas', () => {
  it('requires a view ID and bounds the page size', () => {
    expect(
      BrowseWorkItemsSchema.safeParse({ action: 'get_saved_view', namespace: 'grp' }).success,
    ).toBe(false);
    expect(
      BrowseWorkItemsSchema.safeParse({
        action: 'list_saved_views',
        namespace: 'grp',
        first: 101,
      }).success,
    ).toBe(false);
  });
});
