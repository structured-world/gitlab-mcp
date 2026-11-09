import { print } from 'graphql';
import { workitemsToolRegistry } from '../../../../src/entities/workitems/registry';

const mockRequest = jest.fn();
const mockUnsupported = new Set<string>();
jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: { getInstance: () => ({ getClient: () => ({ request: mockRequest }) }) },
}));
jest.mock('../../../../src/entities/instance-version', () => ({
  graphqlSupports: (type: string, field?: string) => !mockUnsupported.has(`${type}.${field}`),
}));

const browse = workitemsToolRegistry.get('browse_work_items')!.handler;
const lookup = { action: 'list_discussions', namespace: 'test/project', iid: '7' };
const discussionId = 'gid://gitlab/Discussion/abc';
const comment = { id: 'gid://gitlab/Note/3', body: 'First comment', system: false };
const reply = { id: 'gid://gitlab/Note/4', body: 'Reply', system: false };
const event = { id: 'gid://gitlab/SyntheticNote/3', body: 'Changed label', system: true };
const notes = (nodes: unknown[], endCursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
});
const page = {
  nodes: [
    { id: discussionId, notes: notes([comment, reply], 'reply-cursor') },
    { id: 'gid://gitlab/Discussion/event', notes: notes([event]) },
  ],
  pageInfo: { hasNextPage: true, endCursor: 'discussion-cursor' },
};
const item = (discussions: unknown = page) => ({
  id: 'gid://gitlab/WorkItem/19',
  widgets: [{ type: 'NOTES', discussions }],
});

beforeEach(() => {
  mockRequest.mockReset();
  mockUnsupported.clear();
});

// User notes, replies and synthetic activity retain their identities and pagination.
it('reads a page of work item discussions and system notes by namespace and IID', async () => {
  mockRequest.mockResolvedValueOnce({ container: { item: item() } });
  await expect(browse({ ...lookup, first: 2, after: 'previous-page' })).resolves.toEqual({
    workItemId: '19',
    discussions: page.nodes,
    hasMore: true,
    endCursor: 'discussion-cursor',
  });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  const [document, variables] = mockRequest.mock.calls[0];
  expect(print(document)).toContain('filter: ALL_NOTES');
  expect(variables).toMatchObject({
    namespacePath: 'test/project',
    iid: '7',
    first: 2,
    after: 'previous-page',
  });
});

// A reply cursor belongs to a single discussion, even when the outer page changes.
it('continues replies in one verified discussion by work item ID', async () => {
  mockRequest.mockResolvedValueOnce({ item: item({ ...page, nodes: [page.nodes[0]] }) });
  await expect(
    browse({
      action: 'list_discussions',
      id: '19',
      first: 1,
      notes_after: 'reply-cursor',
      discussion_id: discussionId,
    }),
  ).resolves.toMatchObject({ discussions: [page.nodes[0]] });
  expect(mockRequest.mock.calls[0][1]).toMatchObject({
    id: 'gid://gitlab/WorkItem/19',
    first: 1,
    notesAfter: 'reply-cursor',
  });
});

// The same discussion selection works on GitLab schemas before Namespace.workItem.
it.each(['project', 'group'])(
  'looks up discussions through the %s collection on older GitLab',
  async (kind) => {
    mockUnsupported.add('Namespace.workItem');
    if (kind === 'group') mockRequest.mockResolvedValueOnce({ container: null });
    mockRequest.mockResolvedValueOnce({ container: { items: { nodes: [item()] } } });
    await expect(browse(lookup)).resolves.toMatchObject({ discussions: page.nodes });
    const [document] = mockRequest.mock.calls.at(-1)!;
    expect(print(document)).toContain(`container: ${kind}(fullPath: $namespacePath)`);
    expect(print(document)).toContain('workItems(iid: $iid, first: 1)');
    expect(mockRequest).toHaveBeenCalledTimes(kind === 'project' ? 1 : 2);
  },
);

// GitLab can redact all results on a page while still advertising a continuation.
it('preserves GitLab pagination for a page with no visible discussions', async () => {
  mockRequest.mockResolvedValueOnce({ container: { item: item({ ...page, nodes: [] }) } });
  await expect(browse(lookup)).resolves.toEqual({
    workItemId: '19',
    discussions: [],
    hasMore: true,
    endCursor: 'discussion-cursor',
  });
});

// A missing item or unavailable widget is distinguishable from an empty page.
it.each([
  [null, 'not found or not accessible'],
  [{ id: item().id, widgets: [] }, 'does not have a notes widget'],
  [item(null), 'did not return discussions'],
])('reports unavailable discussions instead of an empty page (%j)', async (result, error) => {
  mockRequest.mockResolvedValueOnce({ container: { item: result } });
  await expect(browse(lookup)).rejects.toThrow(error);
});

it('refuses the action when the schema lacks the discussions field', async () => {
  mockUnsupported.add('WorkItemWidgetNotes.discussions');
  await expect(browse(lookup)).rejects.toThrow('does not expose work item discussions');
  expect(mockRequest).not.toHaveBeenCalled();
});

it('rejects a reply page whose discussion no longer matches the requested ID', async () => {
  mockRequest.mockResolvedValueOnce({
    container: { item: item({ ...page, nodes: [page.nodes[1]] }) },
  });
  await expect(
    browse({
      ...lookup,
      first: 1,
      notes_after: 'reply-cursor',
      discussion_id: discussionId,
    }),
  ).rejects.toThrow('The discussion page changed');
});

// Refuse unbounded page sizes and cursors that would be applied to multiple threads.
it.each([
  { first: 0 },
  { first: 21 },
  { notes_first: 21 },
  { notes_after: 'reply-cursor', discussion_id: discussionId, first: 2 },
  { notes_after: 'reply-cursor', first: 1 },
  { discussion_id: discussionId, first: 1 },
])('rejects invalid pagination %j before GitLab I/O', async (invalid) => {
  await expect(browse({ ...lookup, ...invalid })).rejects.toThrow();
  expect(mockRequest).not.toHaveBeenCalled();
});
