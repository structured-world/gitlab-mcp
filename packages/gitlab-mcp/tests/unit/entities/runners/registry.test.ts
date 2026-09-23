import {
  runnersToolRegistry,
  getRunnersReadOnlyToolNames,
} from '../../../../src/entities/runners/registry';
import {
  LIST_RUNNERS,
  LIST_OWNED_RUNNERS,
  LIST_GROUP_RUNNERS,
  LIST_PROJECT_RUNNERS,
  GET_RUNNER,
  LIST_RUNNER_JOBS,
  RESOLVE_GROUP_ID,
  RESOLVE_PROJECT_ID,
  RUNNER_CREATE,
  RUNNER_UPDATE,
  RUNNER_DELETE,
} from '../../../../src/graphql/runners';

const mockClient = { request: jest.fn() };
const mockGitlab = { post: jest.fn(), get: jest.fn() };
const mockGraphqlSupports = jest.fn(() => true);

jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: jest.fn(() => ({ getClient: jest.fn(() => mockClient) })),
  },
}));
jest.mock('../../../../src/utils/gitlab-api', () => ({
  ...jest.requireActual('../../../../src/utils/gitlab-api'),
  gitlab: {
    post: (...args: unknown[]) => mockGitlab.post(...args),
    get: (...args: unknown[]) => mockGitlab.get(...args),
  },
}));
jest.mock('../../../../src/entities/instance-version', () => ({
  graphqlSupports: (...args: unknown[]) => mockGraphqlSupports(...(args as [])),
}));

const browse = () => runnersToolRegistry.get('browse_runners')!;
const manage = () => runnersToolRegistry.get('manage_runner')!;
const RUNNER_GID = 'gid://gitlab/Ci::Runner/7';

beforeEach(() => {
  mockClient.request.mockReset();
  mockGitlab.post.mockReset();
  mockGitlab.get.mockReset();
  mockGraphqlSupports.mockReturnValue(true);
});

describe('runners registry', () => {
  it('registers the CQRS pair with browse_runners read-only', () => {
    expect(runnersToolRegistry.has('browse_runners')).toBe(true);
    expect(runnersToolRegistry.has('manage_runner')).toBe(true);
    expect(getRunnersReadOnlyToolNames()).toEqual(['browse_runners']);
    expect(browse().gate).toEqual({ envVar: 'USE_RUNNERS', defaultValue: true });
    expect(manage().gate).toEqual({ envVar: 'USE_RUNNERS', defaultValue: true });
  });

  describe('browse_runners', () => {
    it('list_all queries the instance-wide runners with filters', async () => {
      mockClient.request.mockResolvedValueOnce({ runners: { nodes: [], pageInfo: {} } });
      await browse().handler({ action: 'list_all', status: 'ONLINE', type: 'INSTANCE_TYPE' });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(LIST_RUNNERS);
      expect(vars).toMatchObject({ status: 'ONLINE', type: 'INSTANCE_TYPE', first: 20 });
    });

    it('list_owned queries the current user runners', async () => {
      mockClient.request.mockResolvedValueOnce({ currentUser: { runners: { nodes: [] } } });
      await browse().handler({ action: 'list_owned' });
      expect(mockClient.request.mock.calls[0][0]).toBe(LIST_OWNED_RUNNERS);
    });

    it('list_owned tolerates a null currentUser', async () => {
      mockClient.request.mockResolvedValueOnce({ currentUser: null });
      const res = (await browse().handler({ action: 'list_owned' })) as { nodes: unknown[] };
      expect(res.nodes).toEqual([]);
    });

    describe('list_owned without currentUser.runners (before GitLab 18.3)', () => {
      beforeEach(() => mockGraphqlSupports.mockReturnValue(false));

      it('reads the REST owned-runners list, shaped like the GraphQL connection', async () => {
        mockGitlab.get.mockResolvedValueOnce([
          {
            id: 7,
            description: 'ci-a',
            runner_type: 'project_type',
            status: 'online',
            paused: false,
          },
          {
            id: 8,
            description: 'ci-b',
            runner_type: 'group_type',
            status: 'offline',
            paused: true,
          },
        ]);

        const res = (await browse().handler({
          action: 'list_owned',
          status: 'ONLINE',
          type: 'PROJECT_TYPE',
          first: 2,
        })) as { nodes: Array<Record<string, unknown>>; pageInfo: Record<string, unknown> };

        expect(mockClient.request).not.toHaveBeenCalled();
        const [path, opts] = mockGitlab.get.mock.calls[0];
        expect(path).toBe('runners');
        // REST expects lowercase enum values and page-number pagination.
        expect(opts.query).toMatchObject({
          status: 'online',
          type: 'project_type',
          per_page: 2,
          page: 1,
        });
        expect(res.nodes[0]).toMatchObject({
          id: 7,
          runnerType: 'PROJECT_TYPE',
          status: 'ONLINE',
          paused: false,
        });
        // A full page means there may be more; the cursor is the next page.
        expect(res.pageInfo).toEqual({ hasNextPage: true, endCursor: '2' });
      });

      it('rejects a malformed runners response with a clear error', async () => {
        mockGitlab.get.mockResolvedValueOnce([{ id: 7, description: 'x', paused: false }]);

        await expect(browse().handler({ action: 'list_owned' })).rejects.toThrow(
          'GitLab API error: unexpected runners response',
        );
      });

      it('searches before paginating, walking REST pages past non-matching ones', async () => {
        // A full first REST page without a match must not hide a match on the
        // next one; the cursor then counts pages of matches, not REST pages.
        const unrelated = Array.from({ length: 100 }, (_, i) => ({
          id: 100 + i,
          description: 'build',
          runner_type: 'project_type',
          status: 'online',
          paused: false,
        }));
        const deploy = (id: number) => ({
          id,
          description: `Deploy ${id}`,
          runner_type: 'project_type',
          status: 'online',
          paused: false,
        });
        mockGitlab.get.mockResolvedValueOnce(unrelated);
        mockGitlab.get.mockResolvedValueOnce([deploy(1), deploy(2), deploy(3)]);

        const res = (await browse().handler({
          action: 'list_owned',
          search: 'deploy',
          first: 2,
        })) as { nodes: Array<{ id: number }>; pageInfo: Record<string, unknown> };

        expect(mockGitlab.get.mock.calls.map((c) => c[1].query.page)).toEqual([1, 2]);
        expect(res.nodes.map((n) => n.id)).toEqual([1, 2]);
        expect(res.pageInfo).toEqual({ hasNextPage: true, endCursor: '2' });
      });

      it('returns a later page of matches and ends pagination when matches run out', async () => {
        mockGitlab.get.mockResolvedValueOnce([
          {
            id: 7,
            description: 'Deploy runner',
            runner_type: 'project_type',
            status: 'online',
            paused: false,
          },
          {
            id: 8,
            description: 'build',
            runner_type: 'project_type',
            status: 'online',
            paused: false,
          },
          // A runner without a description never matches a search.
          {
            id: 9,
            description: null,
            runner_type: 'project_type',
            status: null,
            paused: false,
          },
        ]);

        const first = (await browse().handler({
          action: 'list_owned',
          search: 'deploy',
        })) as { nodes: Array<{ id: number }>; pageInfo: Record<string, unknown> };

        // The REST listing has no search parameter; it is matched here.
        expect(mockGitlab.get.mock.calls[0][1].query).toMatchObject({ page: 1 });
        expect(mockGitlab.get.mock.calls[0][1].query).not.toHaveProperty('search');
        expect(first.nodes.map((n) => n.id)).toEqual([7]);
        expect(first.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
      });
    });

    it('list_project queries by full path', async () => {
      mockClient.request.mockResolvedValueOnce({ project: { runners: { nodes: [] } } });
      await browse().handler({ action: 'list_project', project_id: 'g/p' });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(LIST_PROJECT_RUNNERS);
      expect(vars).toMatchObject({ fullPath: 'g/p' });
    });

    it('list_project throws when the project is missing', async () => {
      mockClient.request.mockResolvedValueOnce({ project: null });
      await expect(
        browse().handler({ action: 'list_project', project_id: 'missing' }),
      ).rejects.toThrow('not found or not accessible');
    });

    it('list_group queries by full path', async () => {
      mockClient.request.mockResolvedValueOnce({ group: { runners: { nodes: [] } } });
      await browse().handler({ action: 'list_group', group_id: 'g' });
      expect(mockClient.request.mock.calls[0][0]).toBe(LIST_GROUP_RUNNERS);
    });

    it('list_group throws when the group is missing', async () => {
      mockClient.request.mockResolvedValueOnce({ group: null });
      await expect(browse().handler({ action: 'list_group', group_id: 'missing' })).rejects.toThrow(
        'not found or not accessible',
      );
    });

    it('get expands the numeric id to a global ID', async () => {
      mockClient.request.mockResolvedValueOnce({ runner: { id: RUNNER_GID } });
      await browse().handler({ action: 'get', runner_id: 7 });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(GET_RUNNER);
      expect(vars).toEqual({ id: RUNNER_GID });
    });

    it('get throws when the runner is missing', async () => {
      mockClient.request.mockResolvedValueOnce({ runner: null });
      await expect(browse().handler({ action: 'get', runner_id: 7 })).rejects.toThrow(
        'Runner 7 not found',
      );
    });

    it('list_jobs queries the runner jobs connection', async () => {
      mockClient.request.mockResolvedValueOnce({ runner: { id: RUNNER_GID, jobs: { nodes: [] } } });
      await browse().handler({
        action: 'list_jobs',
        runner_id: 7,
        statuses: ['FAILED', 'CANCELED'],
      });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(LIST_RUNNER_JOBS);
      // GitLab's jobs(statuses:) argument is [CiJobStatus!]; the schema takes a
      // list so callers can filter by several statuses at once. Declaring the
      // variable as a bare enum made GitLab reject the query with
      // "List dimension mismatch on variable $statuses".
      expect(vars).toMatchObject({ id: RUNNER_GID, statuses: ['FAILED', 'CANCELED'] });
    });

    it('list_jobs throws when the runner is missing', async () => {
      mockClient.request.mockResolvedValueOnce({ runner: null });
      await expect(browse().handler({ action: 'list_jobs', runner_id: 7 })).rejects.toThrow(
        'Runner 7 not found',
      );
    });
  });

  describe('manage_runner', () => {
    it('create INSTANCE_TYPE runs runnerCreate without a namespace', async () => {
      mockClient.request.mockResolvedValueOnce({
        runnerCreate: {
          runner: { id: RUNNER_GID, ephemeralAuthenticationToken: 'glrt-x' },
          errors: [],
        },
      });

      await manage().handler({
        action: 'create_authentication_token',
        runner_type: 'INSTANCE_TYPE',
        description: 'ci-box',
        tag_list: ['linux'],
      });

      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(RUNNER_CREATE);
      expect(vars).toEqual({
        input: { runnerType: 'INSTANCE_TYPE', description: 'ci-box', tagList: ['linux'] },
      });
    });

    it('create GROUP_TYPE resolves the group path to a global ID', async () => {
      mockClient.request
        .mockResolvedValueOnce({ group: { id: 'gid://gitlab/Group/3' } })
        .mockResolvedValueOnce({ runnerCreate: { runner: { id: RUNNER_GID }, errors: [] } });

      await manage().handler({
        action: 'create_authentication_token',
        runner_type: 'GROUP_TYPE',
        group_id: 'my-group',
      });

      expect(mockClient.request.mock.calls[0][0]).toBe(RESOLVE_GROUP_ID);
      expect(mockClient.request.mock.calls[1][0]).toBe(RUNNER_CREATE);
      expect(mockClient.request.mock.calls[1][1]).toEqual({
        input: { runnerType: 'GROUP_TYPE', groupId: 'gid://gitlab/Group/3' },
      });
    });

    it('create PROJECT_TYPE resolves the project path to a global ID', async () => {
      mockClient.request
        .mockResolvedValueOnce({ project: { id: 'gid://gitlab/Project/9' } })
        .mockResolvedValueOnce({ runnerCreate: { runner: { id: RUNNER_GID }, errors: [] } });

      await manage().handler({
        action: 'create_authentication_token',
        runner_type: 'PROJECT_TYPE',
        project_id: 'g/p',
      });

      expect(mockClient.request.mock.calls[0][0]).toBe(RESOLVE_PROJECT_ID);
      expect(mockClient.request.mock.calls[1][1]).toEqual({
        input: { runnerType: 'PROJECT_TYPE', projectId: 'gid://gitlab/Project/9' },
      });
    });

    it('create GROUP_TYPE requires group_id', async () => {
      await expect(
        manage().handler({ action: 'create_authentication_token', runner_type: 'GROUP_TYPE' }),
      ).rejects.toThrow('group_id is required');
    });

    it('create PROJECT_TYPE requires project_id', async () => {
      await expect(
        manage().handler({ action: 'create_authentication_token', runner_type: 'PROJECT_TYPE' }),
      ).rejects.toThrow('project_id is required');
    });

    it('create surfaces GraphQL payload errors', async () => {
      mockClient.request.mockResolvedValueOnce({
        runnerCreate: { runner: null, errors: ['not allowed'] },
      });
      await expect(
        manage().handler({ action: 'create_authentication_token', runner_type: 'INSTANCE_TYPE' }),
      ).rejects.toThrow('GitLab API error: not allowed');
    });

    it('update maps settings to the runnerUpdate input', async () => {
      mockClient.request.mockResolvedValueOnce({
        runnerUpdate: { runner: { id: RUNNER_GID }, errors: [] },
      });
      await manage().handler({
        action: 'update',
        runner_id: 7,
        description: 'new',
        run_untagged: false,
        maximum_timeout: 600,
      });
      const [doc, vars] = mockClient.request.mock.calls[0];
      expect(doc).toBe(RUNNER_UPDATE);
      expect(vars).toEqual({
        input: { id: RUNNER_GID, description: 'new', runUntagged: false, maximumTimeout: 600 },
      });
    });

    it('pause sets paused=true via runnerUpdate', async () => {
      mockClient.request.mockResolvedValueOnce({ runnerUpdate: { runner: {}, errors: [] } });
      await manage().handler({ action: 'pause', runner_id: 7 });
      expect(mockClient.request.mock.calls[0][1]).toEqual({
        input: { id: RUNNER_GID, paused: true },
      });
    });

    it('resume sets paused=false via runnerUpdate', async () => {
      mockClient.request.mockResolvedValueOnce({ runnerUpdate: { runner: {}, errors: [] } });
      await manage().handler({ action: 'resume', runner_id: 7 });
      expect(mockClient.request.mock.calls[0][1]).toEqual({
        input: { id: RUNNER_GID, paused: false },
      });
    });

    it('delete runs runnerDelete and returns a confirmation', async () => {
      mockClient.request.mockResolvedValueOnce({ runnerDelete: { errors: [] } });
      const res = (await manage().handler({ action: 'delete', runner_id: 7 })) as {
        deleted: boolean;
        runner_id: number;
      };
      expect(mockClient.request.mock.calls[0][0]).toBe(RUNNER_DELETE);
      expect(res).toEqual({ deleted: true, runner_id: 7 });
    });

    it('delete surfaces GraphQL payload errors', async () => {
      mockClient.request.mockResolvedValueOnce({ runnerDelete: { errors: ['in use'] } });
      await expect(manage().handler({ action: 'delete', runner_id: 7 })).rejects.toThrow(
        'GitLab API error: in use',
      );
    });

    it('reset_authentication_token uses the REST endpoint', async () => {
      mockGitlab.post.mockResolvedValueOnce({ token: 'glrt-new', token_expires_at: null });
      const res = (await manage().handler({
        action: 'reset_authentication_token',
        runner_id: 7,
      })) as { token: string };
      expect(mockGitlab.post).toHaveBeenCalledWith('runners/7/reset_authentication_token', {
        contentType: 'json',
      });
      expect(res.token).toBe('glrt-new');
      expect(mockClient.request).not.toHaveBeenCalled();
    });
  });
});
