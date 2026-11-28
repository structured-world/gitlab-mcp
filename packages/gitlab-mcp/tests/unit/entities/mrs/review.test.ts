import { mrsToolRegistry } from '../../../../src/entities/mrs/registry';
import { gitlab, GitLabApiError } from '../../../../src/utils/gitlab-api';

jest.mock('../../../../src/utils/gitlab-api', () => ({
  ...jest.requireActual('../../../../src/utils/gitlab-api'),
  gitlab: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const mockGitlab = gitlab as jest.Mocked<typeof gitlab>;

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const START = 'c'.repeat(40);
const MR = 'projects/grp%2Fapp/merge_requests/7';

// a.ts: unchanged 1/1, removed old 2, added new 2, unchanged 3/3 and 4/4.
const MODIFIED = {
  old_path: 'a.ts',
  new_path: 'a.ts',
  diff: '@@ -1,4 +1,4 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n const c = 4;\n export {};\n',
};
const RENAMED = {
  old_path: 'old.ts',
  new_path: 'new.ts',
  renamed_file: true,
  diff: '@@ -1,2 +1,2 @@\n-x\n+y\n z\n',
};
const DELETED = {
  old_path: 'gone.ts',
  new_path: 'gone.ts',
  deleted_file: true,
  diff: '@@ -1,2 +0,0 @@\n-p\n-q\n',
};
// A new file at the path the rename left: "old.ts" names both files.
const READDED = {
  old_path: 'old.ts',
  new_path: 'old.ts',
  new_file: true,
  diff: '@@ -0,0 +1 @@\n+r\n',
};
const EMPTY = { old_path: 'big.bin', new_path: 'big.bin', diff: '' };

function serve(diffs: unknown[], head = HEAD): void {
  mockGitlab.get.mockImplementation(async (path: string) => {
    if (path === `${MR}/versions`) {
      return [{ id: 31, head_commit_sha: head, base_commit_sha: BASE, start_commit_sha: START }];
    }
    if (path === `${MR}/versions/31`) return { id: 31, diffs };
    throw new Error(`unexpected GET ${path}`);
  });
}

let created = 0;
function acceptWrites(): void {
  mockGitlab.post.mockImplementation(async (path: string) => {
    created++;
    if (path.endsWith('/discussions')) return { id: `d${created}`, notes: [{ id: 100 + created }] };
    return { id: 500 + created };
  });
}

function review(args: Record<string, unknown>) {
  return mrsToolRegistry.get('manage_mr_discussion')!.handler({
    action: 'review',
    project_id: 'grp/app',
    merge_request_iid: '7',
    head_sha: HEAD,
    ...args,
  });
}

/** The position fields a diff comment was posted with. */
function positionOf(call: number): Record<string, unknown> {
  const body = (mockGitlab.post.mock.calls[call][1] as { body: Record<string, unknown> }).body;
  return Object.fromEntries(
    Object.entries(body)
      .filter(([key]) => key.startsWith('position['))
      .map(([key, value]) => [key.slice('position['.length, -1), value]),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  created = 0;
});

describe('manage_mr_discussion review', () => {
  it('anchors added, removed and unchanged lines to the reviewed version, then posts the summary', async () => {
    serve([MODIFIED]);
    acceptWrites();

    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'Why 3?' },
        { path: 'a.ts', old_line: 2, body: 'Was fine' },
        // An unchanged line named by its new number takes both numbers, as GitLab requires.
        { path: 'a.ts', new_line: 3, body: 'Nit' },
      ],
      summary: 'Looks good overall',
    });

    expect(mockGitlab.get).toHaveBeenCalledWith(`${MR}/versions`, { query: { per_page: 1 } });
    const common = {
      position_type: 'text',
      base_sha: BASE,
      start_sha: START,
      head_sha: HEAD,
      old_path: 'a.ts',
      new_path: 'a.ts',
    };
    expect(positionOf(0)).toEqual({ ...common, new_line: 2 });
    expect(positionOf(1)).toEqual({ ...common, old_line: 2 });
    expect(positionOf(2)).toEqual({ ...common, old_line: 3, new_line: 3 });
    expect(mockGitlab.post.mock.calls.map(([path]) => path)).toEqual([
      `${MR}/discussions`,
      `${MR}/discussions`,
      `${MR}/discussions`,
      `${MR}/notes`,
    ]);
    expect(mockGitlab.post).toHaveBeenLastCalledWith(`${MR}/notes`, {
      body: { body: 'Looks good overall' },
      contentType: 'form',
    });
    expect(result).toEqual({
      merge_request_iid: '7',
      head_sha: HEAD,
      complete: true,
      comments: [
        {
          index: 0,
          status: 'posted',
          path: 'a.ts',
          old_line: null,
          new_line: 2,
          discussion_id: 'd1',
          note_id: 101,
        },
        {
          index: 1,
          status: 'posted',
          path: 'a.ts',
          old_line: 2,
          new_line: null,
          discussion_id: 'd2',
          note_id: 102,
        },
        {
          index: 2,
          status: 'posted',
          path: 'a.ts',
          old_line: 3,
          new_line: 3,
          discussion_id: 'd3',
          note_id: 103,
        },
      ],
      summary: { status: 'posted', note_id: 504 },
    });
  });

  // Drafts belong to the reviewer's own pending review; a batch must not publish or touch them.
  it('writes only its own discussions and notes, never the draft notes', async () => {
    serve([MODIFIED]);
    acceptWrites();

    await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'x' }], summary: 'y' });

    const touched = [...mockGitlab.get.mock.calls, ...mockGitlab.post.mock.calls].map(
      ([path]) => path,
    );
    expect(touched.some((path) => path.includes('draft_notes'))).toBe(false);
    expect(mockGitlab.put).not.toHaveBeenCalled();
    expect(mockGitlab.delete).not.toHaveBeenCalled();
  });

  it('refuses a review written against a head the merge request has moved past', async () => {
    serve([MODIFIED], 'd'.repeat(40));

    await expect(review({ comments: [{ path: 'a.ts', new_line: 2, body: 'x' }] })).rejects.toThrow(
      `the merge request head is now ${'d'.repeat(40)}, not ${HEAD}`,
    );
    expect(mockGitlab.post).not.toHaveBeenCalled();
  });

  it('matches the head SHA without regard to case', async () => {
    serve([MODIFIED]);
    acceptWrites();

    const result = (await review({
      head_sha: HEAD.toUpperCase(),
      comments: [{ path: 'a.ts', new_line: 2, body: 'x' }],
    })) as { complete: boolean };

    expect(result.complete).toBe(true);
  });

  it('refuses a merge request without a diff version', async () => {
    mockGitlab.get.mockResolvedValueOnce([]);

    await expect(review({ comments: [{ path: 'a.ts', new_line: 2, body: 'x' }] })).rejects.toThrow(
      'the merge request has no diff yet',
    );
    expect(mockGitlab.post).not.toHaveBeenCalled();
  });

  it('names every comment without a diff line and posts none of the batch', async () => {
    serve([MODIFIED, EMPTY]);

    const attempt = review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'valid' },
        { path: 'a.ts', new_line: 9, body: 'outside the hunks' },
        { path: 'missing.ts', new_line: 1, body: 'not in the diff' },
        { path: 'big.bin', new_line: 1, body: 'no diff text' },
        // Old line 2 is removed and new line 2 added: not one unchanged line.
        { path: 'a.ts', old_line: 2, new_line: 2, body: 'two lines' },
      ],
    });

    await expect(attempt).rejects.toThrow(
      [
        'Review not posted, nothing was written:',
        '- comments[1]: new_line 9 of a.ts is not a diff line',
        '- comments[2]: missing.ts is not in the merge request diff',
        '- comments[3]: GitLab shows no diff lines for big.bin (empty_diff)',
        '- comments[4]: old_line 2 and new_line 2 of a.ts is not a diff line',
      ].join('\n'),
    );
    expect(mockGitlab.post).not.toHaveBeenCalled();
  });

  it('anchors renamed and deleted files by either path with both paths of the file', async () => {
    serve([RENAMED, DELETED]);
    acceptWrites();

    await review({
      comments: [
        { path: 'new.ts', new_line: 1, body: 'renamed, new side' },
        { path: 'old.ts', old_line: 1, body: 'renamed, old side' },
        { path: 'gone.ts', old_line: 2, body: 'deleted' },
      ],
    });

    expect(positionOf(0)).toEqual(
      expect.objectContaining({ old_path: 'old.ts', new_path: 'new.ts', new_line: 1 }),
    );
    expect(positionOf(1)).toEqual(
      expect.objectContaining({ old_path: 'old.ts', new_path: 'new.ts', old_line: 1 }),
    );
    expect(positionOf(2)).toEqual(
      expect.objectContaining({ old_path: 'gone.ts', new_path: 'gone.ts', old_line: 2 }),
    );
  });

  it('tells two files sharing a path apart by the side the comment names', async () => {
    serve([RENAMED, READDED]);
    acceptWrites();

    await review({
      comments: [
        { path: 'old.ts', new_line: 1, body: 'the new file' },
        { path: 'old.ts', old_line: 1, body: 'the rename source' },
      ],
    });

    expect(positionOf(0)).toEqual(
      expect.objectContaining({ old_path: 'old.ts', new_path: 'old.ts', new_line: 1 }),
    );
    expect(positionOf(1)).toEqual(
      expect.objectContaining({ old_path: 'old.ts', new_path: 'new.ts', old_line: 1 }),
    );
  });

  it('refuses a path the side cannot tell apart', async () => {
    serve([RENAMED, READDED]);

    await expect(
      review({ comments: [{ path: 'old.ts', old_line: 1, new_line: 1, body: 'which one?' }] }),
    ).rejects.toThrow('comments[0]: old.ts names more than one file in the diff');
  });

  it('posts a suggestion in a fence its own backticks cannot close', async () => {
    serve([MODIFIED]);
    acceptWrites();

    await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'Use a template', suggestion: 'const b = ```x```;' },
      ],
    });

    const body = (mockGitlab.post.mock.calls[0][1] as { body: Record<string, unknown> }).body;
    expect(body.body).toBe('Use a template\n\n````suggestion:-0+0\nconst b = ```x```;\n````');
  });

  it('refuses a suggestion on a removed line', async () => {
    serve([MODIFIED]);

    await expect(
      review({ comments: [{ path: 'a.ts', old_line: 2, body: 'x', suggestion: 'y' }] }),
    ).rejects.toThrow(
      'comments[0]: a suggestion replaces a line of the new version, and this line is removed',
    );
  });

  // A line starting with "/" runs as a quick action (/approve, /merge): no verdict from prose.
  it('refuses quick actions in comments and the summary before reading GitLab', async () => {
    await expect(
      review({
        comments: [{ path: 'a.ts', new_line: 2, body: 'ok\n/approve' }],
        summary: '/merge',
      }),
    ).rejects.toThrow(
      'comments[0]: a line starting with "/" would run as a quick action\n- summary: a line starting with "/" would run as a quick action',
    );
    expect(mockGitlab.get).not.toHaveBeenCalled();
  });

  it('accepts a path in prose that GitLab does not run as a quick action', async () => {
    serve([MODIFIED]);
    acceptWrites();

    const result = (await review({
      comments: [{ path: 'a.ts', new_line: 2, body: 'See  /usr/lib and `/approve`' }],
    })) as { complete: boolean };

    expect(result.complete).toBe(true);
  });

  it('refuses a comment that names no line', async () => {
    await expect(review({ comments: [{ path: 'a.ts', body: 'x' }] })).rejects.toThrow(
      'comments[0]: give new_line, old_line or both',
    );
    expect(mockGitlab.get).not.toHaveBeenCalled();
  });

  it('stops at a refused write and reports what each write did', async () => {
    serve([MODIFIED]);
    mockGitlab.post
      .mockResolvedValueOnce({ id: 'd1', notes: [{ id: 101 }] })
      .mockRejectedValueOnce(
        new GitLabApiError(400, 'line_code invalid', 'GitLab API error: 400 Bad Request'),
      );

    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'one' },
        { path: 'a.ts', old_line: 2, body: 'two' },
        { path: 'a.ts', new_line: 3, body: 'three' },
      ],
      summary: 'summary',
    });

    expect(mockGitlab.post).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        complete: false,
        comments: [
          expect.objectContaining({
            index: 0,
            status: 'posted',
            discussion_id: 'd1',
            note_id: 101,
          }),
          expect.objectContaining({
            index: 1,
            status: 'failed',
            error: 'GitLab API error: 400 Bad Request',
          }),
          expect.objectContaining({ index: 2, status: 'not_attempted' }),
        ],
        summary: { status: 'not_attempted' },
        note: expect.stringContaining('nothing was rolled back'),
      }),
    );
  });

  // A permission refusal on the first write leaves nothing behind.
  it('reports a forbidden first write as failed with nothing posted', async () => {
    serve([MODIFIED]);
    mockGitlab.post.mockRejectedValueOnce(
      new GitLabApiError(403, 'Forbidden', 'GitLab API error: 403 Forbidden'),
    );

    const result = (await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'one' },
        { path: 'a.ts', new_line: 3, body: 'two' },
      ],
    })) as { comments: Array<{ status: string }> };

    expect(result.comments.map((comment) => comment.status)).toEqual(['failed', 'not_attempted']);
    expect(mockGitlab.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a timeout', new Error('GitLab API timeout after 20000ms')],
    ['a server error', new GitLabApiError(502, 'Bad Gateway', 'GitLab API error: 502 Bad Gateway')],
  ])('reports a write that ended in %s as unknown, not failed', async (_case, error) => {
    serve([MODIFIED]);
    mockGitlab.post.mockRejectedValueOnce(error);

    const result = (await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] })) as {
      complete: boolean;
      comments: Array<{ status: string }>;
      note: string;
    };

    expect(result.complete).toBe(false);
    expect(result.comments[0].status).toBe('unknown');
    expect(result.note).toContain('check the merge request discussions first');
  });

  it('reports a failed summary after all comments were posted', async () => {
    serve([MODIFIED]);
    mockGitlab.post
      .mockResolvedValueOnce({ id: 'd1', notes: [{ id: 101 }] })
      .mockRejectedValueOnce(new GitLabApiError(422, 'Note invalid', 'GitLab API error: 422'));

    const result = await review({
      comments: [{ path: 'a.ts', new_line: 2, body: 'one' }],
      summary: 'summary',
    });

    expect(result).toEqual(
      expect.objectContaining({
        complete: false,
        comments: [expect.objectContaining({ status: 'posted' })],
        summary: { status: 'failed', error: 'GitLab API error: 422' },
      }),
    );
  });

  it('counts a write as posted when GitLab answers without the usual identifiers', async () => {
    serve([MODIFIED]);
    mockGitlab.post.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

    const result = await review({
      comments: [{ path: 'a.ts', new_line: 2, body: 'one' }],
      summary: 's',
    });

    expect(result).toEqual(
      expect.objectContaining({
        complete: true,
        comments: [expect.not.objectContaining({ discussion_id: expect.anything() })],
        summary: { status: 'posted' },
      }),
    );
  });

  it('rejects an unexpected versions answer', async () => {
    mockGitlab.get.mockResolvedValueOnce({ message: 'nope' });

    await expect(review({ comments: [{ path: 'a.ts', new_line: 2, body: 'x' }] })).rejects.toThrow(
      'GitLab returned an unexpected merge request versions list',
    );
  });

  it('rejects an unexpected version answer', async () => {
    mockGitlab.get
      .mockResolvedValueOnce([
        { id: 31, head_commit_sha: HEAD, base_commit_sha: BASE, start_commit_sha: START },
      ])
      .mockResolvedValueOnce(null);

    await expect(review({ comments: [{ path: 'a.ts', new_line: 2, body: 'x' }] })).rejects.toThrow(
      'GitLab returned an unexpected merge request version',
    );
  });

  it.each([
    [
      'more comments than the limit',
      { comments: Array.from({ length: 21 }, () => ({ path: 'a.ts', new_line: 2, body: 'x' })) },
    ],
    ['no comments', { comments: [] }],
    [
      'an abbreviated head SHA',
      { head_sha: 'abc123', comments: [{ path: 'a.ts', new_line: 2, body: 'x' }] },
    ],
  ])('rejects %s before reading GitLab', async (_case, args) => {
    await expect(review(args)).rejects.toThrow();
    expect(mockGitlab.get).not.toHaveBeenCalled();
  });
});
