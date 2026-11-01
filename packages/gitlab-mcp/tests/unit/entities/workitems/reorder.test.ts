import { workitemsToolRegistry } from '../../../../src/entities/workitems/registry';
import { ManageWorkItemSchema } from '../../../../src/entities/workitems/schema';
import { print } from 'graphql';

const mockRequest = jest.fn();
const mockGetClient = jest.fn(() => ({ request: mockRequest }));
jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: { getInstance: () => ({ getClient: mockGetClient }) },
}));
let mockInstance = 'https://gitlab.example.com';
jest.mock('../../../../src/oauth/token-context', () => ({
  getGitLabApiUrlFromContext: () => mockInstance,
}));

const tool = workitemsToolRegistry.get('manage_work_item')!;
const moved = { id: 'gid://gitlab/Issue/10', iid: '7', title: 'Card', relativePosition: 100 };
function project(
  path = 'test/project',
  boards: Array<{ id: string }> = [{ id: 'gid://gitlab/Board/9' }],
) {
  return {
    id: 'gid://gitlab/Project/1',
    fullPath: path,
    boards: { nodes: boards },
    group: { fullPath: path.slice(0, path.lastIndexOf('/')) },
  };
}
function item(id = '10', path = 'test/project') {
  return { id: `gid://gitlab/WorkItem/${id}`, iid: '7', project: project(path) };
}
beforeEach(() => {
  mockRequest.mockReset();
  mockGetClient.mockClear();
  mockRequest.mockResolvedValueOnce({ target: item(), before: item('20'), after: item('30') });
  mockRequest.mockResolvedValue({ issueMoveList: { issue: moved, errors: [] } });
});

describe('issue card reorder', () => {
  // User-facing placement names reverse GitLab's neighbour-oriented API parameter names.
  it.each([
    [{ beforeId: '20' }, { moveAfterId: '20' }],
    [{ afterId: '30' }, { moveBeforeId: '30' }],
    [
      { beforeId: '20', afterId: '30' },
      { moveAfterId: '20', moveBeforeId: '30' },
    ],
  ])('maps placement %j without changing labels or lists', async (placement, expected) => {
    const result = await tool.handler({ action: 'reorder', id: '10', ...placement });
    expect(result).toEqual({ ...moved, id: '10' });
    expect(mockRequest.mock.calls[1][1]).toEqual({
      input: {
        boardId: 'gid://gitlab/Board/9',
        projectPath: 'test/project',
        iid: '7',
        ...expected,
      },
    });
    expect(print(mockRequest.mock.calls[1][0])).toContain('issueMoveList');
  });

  // All IDs are validated before a query, including equivalent numeric and GID self-references.
  it.each([
    { id: '10' },
    { id: '10', beforeId: '10' },
    { id: '10', afterId: 'gid://gitlab/WorkItem/10' },
    { id: '10', beforeId: '20', afterId: 'gid://gitlab/WorkItem/20' },
    { id: 'bad', beforeId: '20' },
    { id: '10', beforeId: '0' },
    { id: '10', beforeId: 'gid://gitlab/Project/20' },
  ])('rejects invalid placement %j before reading GitLab', async (placement) => {
    await expect(tool.handler({ action: 'reorder', ...placement })).rejects.toThrow();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  // GIDs from work-item discovery must not be mistaken for project-local IIDs.
  it('resolves GIDs while using the current selected instance', async () => {
    for (mockInstance of ['https://a.example.com', 'https://b.example.com']) {
      mockRequest.mockReset();
      mockRequest.mockResolvedValueOnce({ target: item(), before: item('20') });
      mockRequest.mockResolvedValueOnce({ issueMoveList: { issue: moved, errors: [] } });
      await tool.handler({ action: 'reorder', id: 'gid://gitlab/WorkItem/10', beforeId: '20' });
      expect(mockGetClient).toHaveBeenLastCalledWith(mockInstance);
      expect(mockRequest.mock.calls[0][1]).toEqual({
        id: 'gid://gitlab/WorkItem/10',
        beforeId: 'gid://gitlab/WorkItem/20',
      });
    }
  });

  // Missing or unreadable references cannot be silently dropped from a between placement.
  it.each([
    { target: null, before: item('20') },
    { target: { ...item(), project: null }, before: item('20') },
    { target: item(), before: null },
    { target: item(), before: item('20', 'other/project') },
  ])('rejects an unavailable or incompatible ordering reference', async (context) => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValue(context);
    await expect(tool.handler({ action: 'reorder', id: '10', beforeId: '20' })).rejects.toThrow();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  // Other projects within the same root group share GitLab's relative-ordering domain.
  it('allows a neighbour in another project of the same root group', async () => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce({ target: item(), before: item('20', 'test/sub/other') });
    mockRequest.mockResolvedValueOnce({ issueMoveList: { issue: moved, errors: [] } });
    await expect(
      tool.handler({ action: 'reorder', id: '10', beforeId: '20' }),
    ).resolves.toMatchObject({ id: '10' });
  });

  // Personal projects do not share manual order, even under the same user's namespace.
  it.each([true, false])('checks personal-project ownership (same project: %s)', async (same) => {
    mockRequest.mockReset();
    const personal = { ...project('person/project'), group: null };
    mockRequest.mockResolvedValueOnce({
      target: { ...item(), project: personal },
      before: {
        ...item('20'),
        project: same
          ? personal
          : { ...personal, id: 'gid://gitlab/Project/2', fullPath: 'person/other' },
      },
    });
    mockRequest.mockResolvedValueOnce({ issueMoveList: { issue: moved, errors: [] } });
    const call = tool.handler({ action: 'reorder', id: '10', beforeId: '20' });
    if (same) await expect(call).resolves.toMatchObject({ id: '10' });
    else await expect(call).rejects.toThrow('manual-ordering namespace');
    expect(mockRequest).toHaveBeenCalledTimes(same ? 2 : 1);
  });

  // A group board is valid context when the issue's project has no board.
  it('discovers a board in an ancestor group without a caller-supplied board ID', async () => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce({
      target: { ...item(), project: project('test/sub/project', []) },
      after: item('30'),
    });
    mockRequest.mockResolvedValueOnce({
      group: { boards: { nodes: [] }, parent: { fullPath: 'test' } },
    });
    mockRequest.mockResolvedValueOnce({
      group: { boards: { nodes: [{ id: 'gid://gitlab/Board/88' }] }, parent: null },
    });
    mockRequest.mockResolvedValueOnce({ issueMoveList: { issue: moved, errors: [] } });
    await tool.handler({ action: 'reorder', id: '10', afterId: '30' });
    expect(mockRequest.mock.calls[1][1]).toEqual({ path: 'test/sub' });
    expect(mockRequest.mock.calls[2][1]).toEqual({ path: 'test' });
    expect(mockRequest.mock.calls[3][1].input.boardId).toBe('gid://gitlab/Board/88');
  });

  // Discovery never creates a board or executes a mutation when none is accessible.
  it.each([null, { boards: { nodes: [] }, parent: null }])(
    'fails when no related board is accessible',
    async (group) => {
      mockRequest.mockReset();
      mockRequest.mockResolvedValueOnce({
        target: { ...item(), project: project('test/project', []) },
        before: item('20'),
      });
      mockRequest.mockResolvedValue({ group });
      await expect(tool.handler({ action: 'reorder', id: '10', beforeId: '20' })).rejects.toThrow();
      expect(mockRequest).toHaveBeenCalledTimes(2);
    },
  );

  // A broken upstream parent chain must terminate without a mutation.
  it('bounds cyclic board discovery', async () => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce({
      target: { ...item(), project: project('test/project', []) },
      before: item('20'),
    });
    mockRequest.mockResolvedValue({
      group: { boards: { nodes: [] }, parent: { fullPath: 'test' } },
    });
    await expect(tool.handler({ action: 'reorder', id: '10', beforeId: '20' })).rejects.toThrow(
      'discovery limit',
    );
    expect(mockRequest).toHaveBeenCalledTimes(101);
  });

  // Permission and state failures must never be reported as a successful move.
  it.each([
    { issueMoveList: { issue: moved, errors: ['Not authorized'] } },
    { issueMoveList: { issue: null, errors: [] } },
    { issueMoveList: null },
  ])('surfaces GitLab mutation failures', async (response) => {
    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce({ target: item(), before: item('20') });
    mockRequest.mockResolvedValueOnce(response);
    await expect(tool.handler({ action: 'reorder', id: '10', beforeId: '20' })).rejects.toThrow();
  });

  // Reorder remains a write action inside the existing discriminated schema.
  it('includes the new action in JSON schema generation', () => {
    expect(ManageWorkItemSchema.parse({ action: 'reorder', id: '10', beforeId: '20' }).action).toBe(
      'reorder',
    );
  });
});
