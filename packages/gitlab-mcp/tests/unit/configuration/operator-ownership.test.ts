import { print } from 'graphql';
import {
  assertOperatorOwnership,
  type ReadOwnership,
} from '../../../src/configuration/operator-ownership';
import type { EffectivePolicy } from '../../../src/configuration/policy';
import { gitlab } from '../../../src/utils/gitlab-api';
import { installFetchMock, mockEnhancedFetch } from '../helpers/fetch-mock';

jest.mock('../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

const policy: EffectivePolicy = {
  readOnly: false,
  disabledGroups: new Set(),
  deniedActions: new Map(),
  operatorProjectIds: new Set(['71']),
};
const active = (): boolean => false;
const project = { id: 'gid://gitlab/Project/71' };
afterEach(() => jest.restoreAllMocks());

describe('operator ownership', () => {
  // Project-scoped listings and ordinary discussions have no global object to resolve.
  it.each([
    'browse_registry',
    'manage_registry',
    'browse_vulnerabilities',
    'manage_vulnerability',
    'manage_todos',
    'manage_mr_discussion',
    'browse_pipelines',
  ])('does not resolve absent global IDs for %s', async (tool) => {
    const read = jest.fn();
    await expect(
      assertOperatorOwnership(tool, { action: 'list' }, policy, active, read),
    ).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  // Oversized or malformed metadata must fail closed before a suggestion can be applied.
  it.each([
    { items: Array(21).fill({}), nextPage: null, reason: 'verifiable suggestion' },
    {
      items: [{ suggestions: Array(101).fill({ id: 19 }) }],
      nextPage: null,
      reason: 'Too many suggestions',
    },
    { items: [], nextPage: 1, reason: 'invalid suggestion ownership cursor' },
  ])('rejects invalid suggestion metadata $reason', async ({ items, nextPage, reason }) => {
    jest.spyOn(gitlab, 'getPage').mockResolvedValue({ items, nextPage });
    await expect(
      assertOperatorOwnership(
        'manage_mr_discussion',
        { action: 'apply_suggestion', project_id: '71', merge_request_iid: '3', suggestion_id: 19 },
        policy,
        active,
      ),
    ).rejects.toThrow(reason);
  });

  // A completed HTTP response cannot authorize execution after the tool deadline.
  it('rejects suggestion metadata arriving after expiry', async () => {
    let expired = false;
    jest.spyOn(gitlab, 'getPage').mockImplementation(async () => {
      expired = true;
      return { items: [{ suggestions: [{ id: 19 }] }], nextPage: null };
    });
    await expect(
      assertOperatorOwnership(
        'manage_mr_discussion',
        { action: 'apply_suggestion', project_id: '71', merge_request_iid: '3', suggestion_id: 19 },
        policy,
        () => expired,
      ),
    ).rejects.toThrow('expired');
  });

  // Ownership metadata cannot turn a non-scalar argument into an authorized resource ID.
  it.each([
    { tool: 'browse_registry', args: { repository_id: {} } },
    { tool: 'manage_vulnerability', args: { vulnerability_id: [] } },
    { tool: 'manage_todos', args: { id: null } },
  ])('rejects non-scalar IDs before metadata for $tool', async ({ tool, args }) => {
    const read = jest.fn().mockResolvedValue({
      containerRepository: { project },
      vulnerability: { project },
      todo: { project },
    });
    await expect(assertOperatorOwnership(tool, args, policy, active, read)).rejects.toThrow(
      TypeError,
    );
    expect(read).not.toHaveBeenCalled();
  });

  // Stop at the first denied owner instead of issuing requests for later relationship targets.
  it('stops sequential verification at the first denied owner', async () => {
    const read = jest.fn().mockResolvedValue({ workItem: null });
    await expect(
      assertOperatorOwnership('manage_work_item', { id: '1', targetId: '2' }, policy, active, read),
    ).rejects.toThrow('not owned');
    expect(read).toHaveBeenCalledTimes(1);
  });
  // GitLab filters notes after pagination, so even an empty page can have a successor.
  it.each([{ notes: [] }, { notes: [{}] }])(
    'follows pagination headers after a filtered notes page %j',
    async ({ notes }) => {
      mockEnhancedFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify(notes), { headers: { 'x-next-page': '2' } }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([{ suggestions: [{ id: 19 }] }]), {
            headers: { 'x-next-page': '' },
          }),
        );
      await expect(
        assertOperatorOwnership(
          'manage_mr_discussion',
          {
            action: 'apply_suggestion',
            project_id: 'team/app',
            merge_request_iid: '3',
            suggestion_id: 19,
          },
          policy,
          active,
        ),
      ).resolves.toBeUndefined();
      expect(mockEnhancedFetch).toHaveBeenCalledTimes(2);
      expect(mockEnhancedFetch.mock.calls[1][0]).toContain('page=2');
    },
  );
  // Without an operator restriction, existing calls must add no metadata requests.
  it('does no work without a mandatory project set', async () => {
    const read = jest.fn();
    await assertOperatorOwnership(
      'manage_work_item',
      { id: '99' },
      { ...policy, operatorProjectIds: undefined },
      active,
      read,
    );
    expect(read).not.toHaveBeenCalled();
  });

  // Global IDs cannot be authorized by an unrelated permitted project hint.
  it.each([
    ['browse_work_items', { action: 'get', id: '9', project_id: '71' }, 'workItem'],
    ['browse_registry', { action: 'get_repository', repository_id: '9' }, 'containerRepository'],
    ['manage_vulnerability', { action: 'resolve', vulnerability_id: '9' }, 'vulnerability'],
    ['manage_todos', { action: 'mark_done', id: '9' }, 'todo'],
  ])('checks the actual owner for %s', async (tool, args, field) => {
    const read = jest.fn().mockResolvedValue({ [field]: { project } });
    await expect(
      assertOperatorOwnership(tool, args, policy, active, read),
    ).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    expect(print(read.mock.calls[0][0])).toContain('project');
    for (const owner of [
      null,
      {},
      { project: null },
      { project: { id: 'gid://gitlab/Project/72' } },
    ]) {
      read.mockResolvedValue({ [field]: owner });
      await expect(assertOperatorOwnership(tool, args, policy, active, read)).rejects.toThrow(
        'not owned',
      );
    }
  });

  // Namespace/IID precedence matches the handler, while relationship targets still need proof.
  it('checks all distinct relationship targets with a fixed work ceiling', async () => {
    const read = jest.fn().mockResolvedValue({ workItem: { project } });
    await assertOperatorOwnership(
      'browse_work_items',
      { namespace: 'team/app', iid: '1', id: 'ignored' },
      policy,
      active,
      read,
    );
    expect(read).not.toHaveBeenCalled();
    await assertOperatorOwnership(
      'manage_work_item',
      { id: '1', targetId: '2', parentId: null, childrenIds: ['2', '3'] },
      policy,
      active,
      read,
    );
    expect(read.mock.calls.map((call) => call[1].id)).toEqual([
      'gid://gitlab/WorkItem/1',
      'gid://gitlab/WorkItem/2',
      'gid://gitlab/WorkItem/3',
    ]);
    await expect(
      assertOperatorOwnership(
        'manage_work_item',
        { childrenIds: Array.from({ length: 101 }, (_, i) => String(i + 1)) },
        policy,
        active,
        read,
      ),
    ).rejects.toThrow('Too many');
    await expect(
      assertOperatorOwnership('manage_work_item', { id: {} }, policy, active, read),
    ).rejects.toThrow('Invalid');
  });

  // Deleting a timelog uses its real project, not merely the caller's work item ID.
  it('paginates project-filtered timelogs before allowing deletion', async () => {
    const read = jest
      .fn()
      .mockResolvedValueOnce({ workItem: { project } })
      .mockResolvedValueOnce({
        timelogs: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'next' } },
      })
      .mockResolvedValueOnce({
        timelogs: { nodes: [{ id: 'gid://gitlab/Timelog/55' }], pageInfo: { hasNextPage: false } },
      });
    await assertOperatorOwnership(
      'manage_work_item',
      { action: 'delete_timelog', id: '1', timelogId: '55' },
      policy,
      active,
      read,
    );
    expect(read.mock.calls[2][1]).toEqual({ projectId: project.id, after: 'next' });
  });

  // Missing metadata, stuck cursors and excessive pagination cannot turn into authorization.
  it.each([
    { timelogs: null },
    { timelogs: { nodes: [], pageInfo: { hasNextPage: false } } },
    { timelogs: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } },
    { timelogs: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'same' } } },
  ])('refuses unverifiable timelog ownership', async (answer) => {
    const read = jest.fn().mockResolvedValue(answer);
    await expect(
      assertOperatorOwnership(
        'manage_work_item',
        { action: 'delete_timelog', timelogId: '55' },
        policy,
        active,
        read,
      ),
    ).rejects.toThrow();
    expect(read.mock.calls.length).toBeLessThanOrEqual(2);
  });

  // The request ceiling is enforced before dispatch, including changing cursors.
  it('bounds ownership pagination and checks deadlines around every read', async () => {
    let page = 0;
    const read: ReadOwnership = jest.fn(async () => ({
      timelogs: { nodes: [], pageInfo: { hasNextPage: true, endCursor: String(++page) } },
    }));
    await expect(
      assertOperatorOwnership(
        'manage_work_item',
        { action: 'delete_timelog', timelogId: '55' },
        policy,
        active,
        read,
      ),
    ).rejects.toThrow('request limit');
    expect(page).toBe(100);
    const never = jest.fn();
    await expect(
      assertOperatorOwnership('manage_todos', { id: '1' }, policy, () => true, never),
    ).rejects.toThrow('expired');
    expect(never).not.toHaveBeenCalled();
    let expired = false;
    await expect(
      assertOperatorOwnership(
        'manage_todos',
        { id: '1' },
        policy,
        () => expired,
        async () => {
          expired = true;
          return { todo: { project } };
        },
      ),
    ).rejects.toThrow('expired');
  });

  // Suggestion IDs are global: the MR hint alone must not authorize another MR's suggestion.
  it('requires every suggestion in the permitted merge request metadata', async () => {
    const read = jest
      .spyOn(gitlab, 'getPage')
      .mockResolvedValue({ items: [{ suggestions: [{ id: 19 }] }], nextPage: null });
    const args = {
      action: 'apply_suggestions',
      project_id: 'team/app',
      merge_request_iid: '3',
      suggestion_ids: [19],
    };
    await expect(
      assertOperatorOwnership('manage_mr_discussion', args, policy, active),
    ).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledWith('projects/team%2Fapp/merge_requests/3/notes', {
      query: { per_page: 20, page: 1 },
    });
    await expect(
      assertOperatorOwnership(
        'manage_mr_discussion',
        { ...args, suggestion_ids: [19, 20] },
        policy,
        active,
      ),
    ).rejects.toThrow('every suggestion');
    read.mockResolvedValue({ items: [{}], nextPage: null });
    await expect(
      assertOperatorOwnership('manage_mr_discussion', args, policy, active),
    ).rejects.toThrow('every suggestion');
    read.mockClear();
    await expect(
      assertOperatorOwnership(
        'manage_mr_discussion',
        { ...args, suggestion_ids: Array(101).fill(19) },
        policy,
        active,
      ),
    ).rejects.toThrow('Too many');
    expect(read).not.toHaveBeenCalled();
  });
});
