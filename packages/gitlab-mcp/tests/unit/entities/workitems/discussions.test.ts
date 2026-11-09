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
