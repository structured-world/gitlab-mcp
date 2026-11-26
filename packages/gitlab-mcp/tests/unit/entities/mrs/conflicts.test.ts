import { mrsToolRegistry } from '../../../../src/entities/mrs/registry';
import { BrowseMergeRequestsSchema } from '../../../../src/entities/mrs/schema-readonly';
import { CONFLICT_MAX_LINE, CONFLICT_OUTPUT_BUDGET } from '../../../../src/entities/mrs/conflicts';
import { MERGE_REQUEST_CONFLICTS } from '../../../../src/graphql/mergeRequestConflicts';

const mockClient = { request: jest.fn() };
const mockGitlab = { get: jest.fn() };
const mockGraphqlSupports = jest.fn((..._args: unknown[]) => true);
const mockInScope = jest.fn((..._args: unknown[]) => Promise.resolve(true));
const mockTargetPaths = jest.fn((args: Record<string, unknown>) => Promise.resolve(args));

jest.mock('../../../../src/services/ConnectionManager', () => ({
  ConnectionManager: {
    getInstance: jest.fn(() => ({ getClient: jest.fn(() => mockClient) })),
  },
}));
jest.mock('../../../../src/utils/gitlab-api', () => ({
  ...jest.requireActual('../../../../src/utils/gitlab-api'),
  gitlab: { get: (...args: unknown[]) => mockGitlab.get(...args) },
}));
jest.mock('../../../../src/entities/instance-version', () => ({
  ...jest.requireActual('../../../../src/entities/instance-version'),
  graphqlSupports: (...args: unknown[]) => mockGraphqlSupports(...args),
}));
jest.mock('../../../../src/configuration/call-scope', () => ({
  projectInCallScope: (...args: unknown[]) => mockInScope(...args),
}));
jest.mock('../../../../src/configuration/scope-ids', () => ({
  withTargetPaths: (args: Record<string, unknown>) => mockTargetPaths(args),
}));

const tool = mrsToolRegistry.get('browse_merge_requests')!;
const call = (extra: Record<string, unknown> = {}): Promise<unknown> =>
  tool.handler({
    action: 'conflicts',
    project_id: 'group/app',
    merge_request_iid: '7',
    ...extra,
  });

/** A merge request as the conflicts query returns it, same-project unless overridden. */
function mr(overrides: Record<string, unknown> = {}): unknown {
  return {
    project: {
      mergeRequest: {
        iid: '7',
        state: 'opened',
        webUrl: 'https://gitlab.example.com/group/app/-/merge_requests/7',
        sourceBranch: 'feature',
        targetBranch: 'main',
        sourceProjectId: 1,
        targetProjectId: 1,
        conflicts: true,
        conflictStatus: 'HAS_CONFLICTS',
        conflictFiles: [],
        ...overrides,
      },
    },
  };
}

const conflicted = (
  ours: string,
  theirs: string,
  middle: string[] = ['ours', '=======', 'theirs'],
) => [`<<<<<<< ${ours}`, ...middle, `>>>>>>> ${theirs}`];

beforeEach(() => {
  mockClient.request.mockReset();
  mockGitlab.get.mockReset();
  mockGraphqlSupports.mockReset().mockReturnValue(true);
  mockInScope.mockReset().mockResolvedValue(true);
  mockTargetPaths.mockReset().mockImplementation((args) => Promise.resolve(args));
});

describe('conflicts action schema', () => {
  it('accepts a file filter and a context width', () => {
    expect(
      BrowseMergeRequestsSchema.safeParse({
        action: 'conflicts',
        project_id: 'g/p',
        merge_request_iid: '1',
        file_path: 'a.txt',
        context_lines: 0,
      }).success,
    ).toBe(true);
  });

  // A filter meant for conflicts must not be silently ignored by another action.
  it.each([
    ['file_path', 'a.txt'],
    ['context_lines', 2],
  ])('refuses %s on diffs', (field, value) => {
    const result = BrowseMergeRequestsSchema.safeParse({
      action: 'diffs',
      project_id: 'g/p',
      merge_request_iid: '1',
      [field]: value,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: [field],
      message: `'${field}' is only valid for 'conflicts' action`,
    });
  });

  it.each([-1, 21, 1.5])('refuses %p context lines', (context_lines) => {
    expect(
      BrowseMergeRequestsSchema.safeParse({
        action: 'conflicts',
        project_id: 'g/p',
        merge_request_iid: '1',
        context_lines,
      }).success,
    ).toBe(false);
  });

  it('refuses a branch name: conflicts addresses one MR by IID', () => {
    const result = BrowseMergeRequestsSchema.safeParse({
      action: 'conflicts',
      project_id: 'g/p',
      merge_request_iid: '1',
      branch_name: 'feature',
    });
    expect(result.success).toBe(false);
  });

  // The catalog hides the action on releases whose schema lacks the fields.
  it('is declared available from GitLab 19.4', () => {
    expect(tool.requirements?.actions?.conflicts).toMatchObject({
      tier: 'free',
      minVersion: '19.4',
    });
  });
});

describe('conflicts action availability', () => {
  // The fields are experiments; an instance without them is refused before any request.
  it.each([
    ['conflictStatus', 'conflictFiles'],
    ['conflictFiles', 'conflictStatus'],
  ])('refuses when the schema lacks %s', async (missing) => {
    mockGraphqlSupports.mockImplementation((_type, field) => field !== missing);
    await expect(call()).rejects.toThrow('Reading merge request conflicts requires GitLab 19.4+');
    expect(mockClient.request).not.toHaveBeenCalled();
    expect(mockGitlab.get).not.toHaveBeenCalled();
  });
});

describe('conflicts action project and merge request', () => {
  it('queries by the project path', async () => {
    mockClient.request.mockResolvedValue(mr({ conflictStatus: 'NO_CONFLICTS', conflicts: false }));
    await call({ project_id: 'group%2Fapp' });
    expect(mockClient.request).toHaveBeenCalledWith(MERGE_REQUEST_CONFLICTS, {
      fullPath: 'group/app',
      iid: '7',
    });
    expect(mockTargetPaths).not.toHaveBeenCalled();
  });

  // GraphQL addresses projects only by path: a numeric ID is resolved first.
  it('resolves a numeric project ID to its path', async () => {
    mockTargetPaths.mockResolvedValue({ project_id: 'group/app' });
    mockClient.request.mockResolvedValue(mr({ conflictStatus: 'NO_CONFLICTS', conflicts: false }));
    await call({ project_id: '42' });
    expect(mockTargetPaths).toHaveBeenCalledWith({ project_id: '42' });
    expect(mockClient.request.mock.calls[0][1]).toEqual({ fullPath: 'group/app', iid: '7' });
  });

  it('fails when a numeric project ID resolves to no path', async () => {
    await expect(call({ project_id: '42' })).rejects.toThrow(
      'Project "42" not found or not accessible',
    );
    expect(mockClient.request).not.toHaveBeenCalled();
  });

  it.each([{ project: null }, { project: { mergeRequest: null } }])(
    'fails for a merge request GitLab does not show: %p',
    async (response) => {
      mockClient.request.mockResolvedValue(response);
      await expect(call()).rejects.toThrow(
        'Merge request !7 not found or not accessible in project "group/app"',
      );
    },
  );
});

describe('conflicts action statuses', () => {
  // Each server status is reported as itself, never as a clean MR or as files.
  it.each([
    ['NO_CONFLICTS', false, 'no_conflicts'],
    ['BRANCH_MISSING', true, 'branch_missing'],
    ['NO_PUSH_ACCESS', true, 'no_push_access'],
  ])('reports %s as %s without files', async (conflictStatus, conflicts, status) => {
    mockClient.request.mockResolvedValue(mr({ conflictStatus, conflicts, conflictFiles: null }));
    const result = (await call()) as Record<string, unknown>;
    expect(result).toMatchObject({
      merge_request_iid: '7',
      source_branch: 'feature',
      target_branch: 'main',
      has_conflicts: conflicts,
      status,
    });
    expect(typeof result.reason).toBe('string');
    expect(result).not.toHaveProperty('files');
    expect(mockGitlab.get).not.toHaveBeenCalled();
  });

  // GraphQL never starts the mergeability check; the REST read does, once.
  it('requests a mergeability check when GitLab has not run one', async () => {
    mockClient.request.mockResolvedValue(
      mr({ conflictStatus: 'UNCHECKED', conflicts: false, conflictFiles: null }),
    );
    mockGitlab.get.mockResolvedValue({});
    const result = await call();
    expect(result).toMatchObject({ status: 'unchecked', has_conflicts: false });
    expect(mockGitlab.get).toHaveBeenCalledTimes(1);
    expect(mockGitlab.get).toHaveBeenCalledWith('projects/group%2Fapp/merge_requests/7');
  });

  it('reports a null status as unchecked', async () => {
    mockClient.request.mockResolvedValue(mr({ conflictStatus: null, conflictFiles: null }));
    mockGitlab.get.mockResolvedValue({});
    await expect(call()).resolves.toMatchObject({ status: 'unchecked' });
  });

  // Conflicts without files (binary, a missing side) are not a clean MR and not an empty list.
  it('reports conflicts whose files GitLab could not return', async () => {
    mockClient.request.mockResolvedValue(mr({ conflictFiles: null }));
    const result = await call();
    expect(result).toMatchObject({ status: 'files_unavailable', has_conflicts: true });
    expect(result).not.toHaveProperty('files');
  });
});

describe('conflicts action fork scope', () => {
  const files = [
    { ourPath: 'a.txt', theirPath: 'a.txt', content: conflicted('a.txt', 'a.txt').join('\n') },
  ];

  // A fork's file contents belong to the fork, which the call's scope must allow as well.
  it('withholds the files of a fork outside the allowed scope', async () => {
    mockClient.request.mockResolvedValue(mr({ sourceProjectId: 9, conflictFiles: files }));
    mockInScope.mockResolvedValue(false);
    const result = await call();
    expect(mockInScope).toHaveBeenCalledWith('9');
    expect(result).toMatchObject({ status: 'source_outside_scope', has_conflicts: true });
    expect(result).not.toHaveProperty('files');
    expect(JSON.stringify(result)).not.toContain('a.txt');
  });

  it('returns the files of a fork inside the scope', async () => {
    mockClient.request.mockResolvedValue(mr({ sourceProjectId: 9, conflictFiles: files }));
    const result = await call();
    expect(result).toMatchObject({ status: 'has_conflicts', files_total: 1 });
  });

  // Without a source project the files cannot be attributed, so they are not returned.
  it('withholds files whose source project is unknown', async () => {
    mockClient.request.mockResolvedValue(mr({ sourceProjectId: null, conflictFiles: files }));
    await expect(call()).resolves.toMatchObject({ status: 'source_outside_scope' });
    expect(mockInScope).not.toHaveBeenCalled();
  });

  it('does not check the scope again for a same-project MR', async () => {
    mockClient.request.mockResolvedValue(mr({ conflictFiles: files }));
    await call();
    expect(mockInScope).not.toHaveBeenCalled();
  });
});

describe('conflicts action file regions', () => {
  const read = async (
    conflictFiles: unknown[],
    extra: Record<string, unknown> = {},
  ): Promise<{
    files: Record<string, unknown>[];
    files_total: number;
    truncated: boolean;
  }> => {
    mockClient.request.mockResolvedValue(mr({ conflictFiles }));
    return (await call(extra)) as never;
  };

  it('returns each conflict region with its context and first line number', async () => {
    const content = [
      'l1',
      'l2',
      'l3',
      ...conflicted('a.txt', 'a.txt'),
      'l9',
      'l10',
      'l11',
      'l12',
      'l13',
      'l14',
      'l15',
      ...conflicted('a.txt', 'a.txt', ['x', '=======', 'y']),
      'l21',
      '',
    ].join('\n');
    const result = await read([{ ourPath: 'a.txt', theirPath: 'a.txt', content }], {
      context_lines: 1,
    });
    expect(result.files).toEqual([
      {
        our_path: 'a.txt',
        their_path: 'a.txt',
        conflict_count: 2,
        hunks: [
          {
            start_line: 3,
            lines: ['l3', '<<<<<<< a.txt', 'ours', '=======', 'theirs', '>>>>>>> a.txt', 'l9'],
          },
          {
            start_line: 15,
            lines: ['l15', '<<<<<<< a.txt', 'x', '=======', 'y', '>>>>>>> a.txt', 'l21'],
          },
        ],
        hunks_omitted: 0,
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  // Regions whose context meets are one region, so no line is returned twice.
  it('joins regions whose context touches', async () => {
    const content = [...conflicted('a', 'b'), 'mid', ...conflicted('a', 'b')].join('\n');
    const result = await read([{ ourPath: 'a', theirPath: 'b', content }], { context_lines: 1 });
    expect(result.files[0]).toMatchObject({
      conflict_count: 2,
      hunks: [{ start_line: 1, lines: content.split('\n') }],
    });
  });

  // The markers carry the two paths; a path-less side is matched by the marker alone.
  it('matches the markers of a renamed file and of a side without a path', async () => {
    const renamed = conflicted('new.txt', 'old.txt').join('\n');
    const pathless = ['<<<<<<< ', 'ours', '=======', '>>>>>>> gone.txt'].join('\n');
    const result = await read([
      { ourPath: 'new.txt', theirPath: 'old.txt', content: renamed },
      { ourPath: null, theirPath: 'gone.txt', content: pathless },
    ]);
    expect(result.files.map((file) => file.conflict_count)).toEqual([1, 1]);
  });

  // A marker naming another path is file content, not a conflict boundary.
  it('does not take a marker with another path for a conflict', async () => {
    const content = ['<<<<<<< other.txt', 'text', '>>>>>>> other.txt'].join('\n');
    const result = await read([{ ourPath: 'a.txt', theirPath: 'a.txt', content }]);
    expect(result.files[0]).toMatchObject({ conflict_count: 0 });
  });

  // A CRLF file has CRLF markers; a carriage return left on a line would hide every marker,
  // and the file would be shown from its start instead of at its conflicts.
  it('finds the regions of a file with CRLF and mixed line endings', async () => {
    const content = ['l1', 'l2', ...conflicted('a.txt', 'a.txt'), 'l8', ''].join('\r\n');
    const mixed = `${conflicted('b.txt', 'b.txt').join('\r\n')}\ntail\n`;
    const result = await read(
      [
        { ourPath: 'a.txt', theirPath: 'a.txt', content },
        { ourPath: 'b.txt', theirPath: 'b.txt', content: mixed },
      ],
      { context_lines: 0 },
    );
    expect(result.files.map((file) => file.hunks)).toEqual([
      [{ start_line: 3, lines: conflicted('a.txt', 'a.txt') }],
      [{ start_line: 1, lines: conflicted('b.txt', 'b.txt') }],
    ]);
    expect(result.files.map((file) => file.conflict_count)).toEqual([1, 1]);
  });

  it('runs an unterminated region to the end of the file', async () => {
    const content = ['a', '<<<<<<< f', 'ours', '=======', 'theirs', 'tail'].join('\n');
    const result = await read([{ ourPath: 'f', theirPath: 'f', content }], { context_lines: 0 });
    expect(result.files[0]).toMatchObject({
      conflict_count: 1,
      hunks: [{ start_line: 2, lines: ['<<<<<<< f', 'ours', '=======', 'theirs', 'tail'] }],
    });
  });

  // A tree conflict has no markers; its content is shown from the start instead of nothing.
  it('shows a file without markers from its first line', async () => {
    const result = await read([{ ourPath: 'f', theirPath: 'f', content: 'one\ntwo\n' }]);
    expect(result.files[0]).toMatchObject({
      conflict_count: 0,
      hunks: [{ start_line: 1, lines: ['one', 'two'] }],
    });
  });

  it('returns no region for an empty file', async () => {
    const result = await read([{ ourPath: 'f', theirPath: 'f', content: '' }]);
    expect(result.files[0]).toMatchObject({ conflict_count: 0, hunks: [], hunks_omitted: 0 });
  });

  it('marks a file GitLab returned without text', async () => {
    const result = await read([{ ourPath: 'img.png', theirPath: 'img.png', content: null }]);
    expect(result.files[0]).toEqual({
      our_path: 'img.png',
      their_path: 'img.png',
      conflict_count: 0,
      hunks: [],
      hunks_omitted: 0,
      content_unavailable: true,
    });
  });

  it('cuts an overlong line and counts it', async () => {
    const long = 'x'.repeat(CONFLICT_MAX_LINE + 50);
    const content = conflicted('f', 'f', [long, '=======', 'short']).join('\n');
    const result = await read([{ ourPath: 'f', theirPath: 'f', content }]);
    const hunk = (result.files[0].hunks as { lines: string[] }[])[0];
    expect(hunk.lines[1]).toBe('x'.repeat(CONFLICT_MAX_LINE));
    expect(result.files[0].long_lines_cut).toBe(1);
  });

  // Paths are always listed; regions past the budget are counted, never silently dropped.
  it('reports regions and files left out at the output budget', async () => {
    const line = 'y'.repeat(CONFLICT_MAX_LINE - 1);
    const big = conflicted('big', 'big', [...Array(40).fill(line), '=======', 'z']).join('\n');
    const small = conflicted('small', 'small').join('\n');
    const result = await read([
      { ourPath: 'big', theirPath: 'big', content: big },
      { ourPath: 'small', theirPath: 'small', content: small },
    ]);
    const [first, second] = result.files as {
      hunks: { lines: string[]; truncated?: true }[];
      hunks_omitted: number;
      our_path: string;
    }[];
    expect(result.truncated).toBe(true);
    expect(first.hunks[0].truncated).toBe(true);
    const spent = first.hunks[0].lines.reduce((sum, text) => sum + text.length + 1, 0);
    expect(spent).toBeLessThanOrEqual(CONFLICT_OUTPUT_BUDGET);
    expect(second).toMatchObject({ our_path: 'small', hunks: [], hunks_omitted: 1 });
  });

  it('returns only the file named by file_path and counts all files', async () => {
    const result = await read(
      [
        { ourPath: 'a', theirPath: 'a', content: conflicted('a', 'a').join('\n') },
        { ourPath: 'b', theirPath: 'old-b', content: conflicted('b', 'old-b').join('\n') },
      ],
      { file_path: 'old-b' },
    );
    expect(result.files_total).toBe(2);
    expect(result.files.map((file) => file.our_path)).toEqual(['b']);
  });
});
