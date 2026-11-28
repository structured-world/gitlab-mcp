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

type Fail = (method: string, path: string) => unknown;

/** A stand-in for the GitLab endpoints a review uses; `fail` makes one call throw. */
class FakeGitLab {
  head = HEAD;
  diffs: unknown[] = [MODIFIED];
  threads: Array<Record<string, unknown>> = [];
  notes: Array<Record<string, unknown>> = [];
  fail: Fail = () => undefined;

  install(): void {
    mockGitlab.get.mockImplementation(async (path: string) => {
      this.check('GET', path);
      if (path === `${MR}/versions`) {
        return [
          { id: 31, head_commit_sha: this.head, base_commit_sha: BASE, start_commit_sha: START },
        ];
      }
      if (path === `${MR}/versions/31`) return { id: 31, diffs: this.diffs };
      throw new Error(`unexpected GET ${path}`);
    });
    mockGitlab.post.mockImplementation(async (path: string, options?: unknown) => {
      this.check('POST', path);
      const body = (options as { body?: Record<string, unknown> } | undefined)?.body ?? {};
      if (path === `${MR}/discussions`) {
        this.threads.push(body);
        return { id: `d${this.threads.length}`, notes: [{ id: 100 + this.threads.length }] };
      }
      if (path === `${MR}/notes`) {
        this.notes.push(body);
        return { id: 500 + this.notes.length };
      }
      throw new Error(`unexpected POST ${path}`);
    });
  }

  private check(method: string, path: string): void {
    const error = this.fail(method, path);
    if (error !== undefined) throw error;
  }
}

let gl: FakeGitLab;

function review(args: Record<string, unknown>) {
  return mrsToolRegistry.get('manage_mr_discussion')!.handler({
    action: 'review',
    project_id: 'grp/app',
    merge_request_iid: '7',
    head_sha: HEAD,
    ...args,
  }) as Promise<Record<string, unknown>>;
}

/** The position fields of a form body. */
function positionIn(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body)
      .filter(([key]) => key.startsWith('position['))
      .map(([key, value]) => [key.slice('position['.length, -1), value]),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  gl = new FakeGitLab();
  gl.install();
});

describe('manage_mr_discussion review: checks before any write', () => {
  it('refuses a review written against a head the merge request has moved past', async () => {
    gl.head = 'd'.repeat(40);

    await expect(review({ comments: [{ path: 'a.ts', new_line: 2, body: 'x' }] })).rejects.toThrow(
      `the merge request head is now ${'d'.repeat(40)}, not ${HEAD}`,
    );
    expect(mockGitlab.post).not.toHaveBeenCalled();
  });

  it('matches the head SHA without regard to case', async () => {
    const result = await review({
      head_sha: HEAD.toUpperCase(),
      comments: [{ path: 'a.ts', new_line: 2, body: 'x' }],
    });

    expect(result.complete).toBe(true);
  });

  it('refuses a merge request without a diff version', async () => {
    mockGitlab.get.mockResolvedValueOnce([]);

    await expect(review({ comments: [{ path: 'a.ts', new_line: 2, body: 'x' }] })).rejects.toThrow(
      'the merge request has no diff yet',
    );
    expect(mockGitlab.post).not.toHaveBeenCalled();
  });

  it('names every comment without a diff line and writes none of the batch', async () => {
    gl.diffs = [MODIFIED, EMPTY];

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
        'Review not posted, nothing was published:',
        '- comments[1]: new_line 9 of a.ts is not a diff line',
        '- comments[2]: missing.ts is not in the merge request diff',
        '- comments[3]: GitLab shows no diff lines for big.bin (empty_diff)',
        '- comments[4]: old_line 2 and new_line 2 of a.ts is not a diff line',
      ].join('\n'),
    );
    expect(mockGitlab.post).not.toHaveBeenCalled();
  });

  it('refuses lines of a file whose change has no text lines', async () => {
    // From GitLab 18.4 an empty diff with its flags is a change without lines, e.g. a rename.
    gl.diffs = [{ ...RENAMED, diff: '', collapsed: false, too_large: false }];

    await expect(
      review({ comments: [{ path: 'new.ts', old_line: 9, body: 'x' }] }),
    ).rejects.toThrow('comments[0]: old_line 9 of new.ts is not a diff line');
  });

  it('refuses a path the side cannot tell apart', async () => {
    gl.diffs = [RENAMED, READDED];

    await expect(
      review({ comments: [{ path: 'old.ts', old_line: 1, new_line: 1, body: 'which one?' }] }),
    ).rejects.toThrow('comments[0]: old.ts names more than one file in the diff');
  });

  it('refuses a suggestion on a removed line', async () => {
    await expect(
      review({ comments: [{ path: 'a.ts', old_line: 2, body: 'x', suggestion: 'y' }] }),
    ).rejects.toThrow(
      'comments[0]: a suggestion replaces a line of the new version, and this line is removed',
    );
  });

  it('refuses a comment that names no line', async () => {
    await expect(review({ comments: [{ path: 'a.ts', body: 'x' }] })).rejects.toThrow(
      'comments[0]: give new_line, old_line or both',
    );
    expect(mockGitlab.get).not.toHaveBeenCalled();
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

// GitLab runs a line starting with "/" outside code as a quick action (/approve, /merge):
// review text must never carry a verdict, on any supported GitLab.
describe('manage_mr_discussion review: quick actions', () => {
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

  it.each([
    // GitLab deletes carriage returns before looking for commands: "/\rclose" is "/close".
    ['a command split by a carriage return', 'Review\n/\rclose'],
    // Newer GitLab reads paragraphs: a command between HTML parts still runs.
    ['a command between HTML parts', '<!-- this is a comment -->\n\n/approve\n\n<p>\n</p>'],
    // GitLab 16.x does not skip tilde fences.
    ['a command in a tilde fence', 'Example:\n~~~\n/approve\n~~~'],
    // An unclosed fence is no code block for either reader.
    ['a command after an unclosed fence', 'Example:\n```\n/approve'],
    // A Markdown reader ends the fence at ````, GitLab 16.x does not skip it at all.
    ['a command after a fence closed by four backticks', '```\nx\n````\n/approve\n```'],
    // GitLab 16.x pairs the stray backtick with the fence, which then no longer opens a block.
    ['a command in a fence after a stray backtick', 'a `x\n```\n/approve\n```'],
    ['a command in a fence after an HTML line', '<div>\nfoo\n```\n</div>\n/approve\n```'],
    ['a command in a fence after a >>> quote', '>>>\n```\n>>>\n/approve\n```'],
    // Inside an outer tilde fence the backtick line is content, so /approve is outside code.
    ['a command in a fence inside a tilde fence', '~~~\n```\n~~~\n/approve\n```'],
    ['a command in a fence after an indented tilde fence', '  ~~~\n```\n  ~~~\n/approve\n```'],
    ['a command in a fence after a blockquote', '> quoted\n```\n/approve\n```'],
  ])('refuses %s in a comment and in the summary', async (_case, text) => {
    await expect(review({ comments: [{ path: 'a.ts', new_line: 2, body: text }] })).rejects.toThrow(
      'comments[0]: a line starting with "/" would run as a quick action',
    );
    await expect(
      review({ comments: [{ path: 'a.ts', new_line: 2, body: 'ok' }], summary: text }),
    ).rejects.toThrow('summary: a line starting with "/" would run as a quick action');
    expect(mockGitlab.get).not.toHaveBeenCalled();
  });

  // Without carriage returns the suggestion's backticks close the fence and free "/close".
  it('refuses a suggestion whose backticks break out of its fence', async () => {
    await expect(
      review({
        comments: [{ path: 'a.ts', new_line: 2, body: 'x', suggestion: '``\r`\n/close\n``\r`' }],
      }),
    ).rejects.toThrow('comments[0]: a line starting with "/" would run as a quick action');
    expect(mockGitlab.get).not.toHaveBeenCalled();
  });

  it('accepts slashes no GitLab runs: indented, mid-line, fenced code and suggestions', async () => {
    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'See  /usr/lib and `/approve`\n  /merge indented' },
        { path: 'a.ts', new_line: 3, body: 'Example:\n```sh\n/merge\n```\n\nAfter /close.' },
        { path: 'a.ts', new_line: 4, body: 'Path', suggestion: '/close the gate' },
      ],
    });

    expect(result.complete).toBe(true);
  });

  it('posts a suggestion in a fence its own backticks cannot close', async () => {
    await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'Use a template', suggestion: 'const b = ```x```;' },
      ],
    });

    expect(gl.threads[0].body).toBe(
      'Use a template\n\n````suggestion:-0+0\nconst b = ```x```;\n````',
    );
  });
});

describe('manage_mr_discussion review: anchoring', () => {
  it('anchors added, removed and unchanged lines to the reviewed version', async () => {
    await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'Why 3?' },
        { path: 'a.ts', old_line: 2, body: 'Was fine' },
        // An unchanged line named by its new number takes both numbers, as GitLab requires.
        { path: 'a.ts', new_line: 3, body: 'Nit' },
      ],
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
    expect(gl.threads.map(positionIn)).toEqual([
      { ...common, new_line: 2 },
      { ...common, old_line: 2 },
      { ...common, old_line: 3, new_line: 3 },
    ]);
  });

  it('accepts an unchanged line named by both its numbers', async () => {
    const result = await review({
      comments: [{ path: 'a.ts', old_line: 3, new_line: 3, body: 'unchanged' }],
    });

    expect(result.comments).toEqual([
      expect.objectContaining({ old_line: 3, new_line: 3, status: 'published' }),
    ]);
  });

  it('anchors renamed and deleted files by either path with both paths of the file', async () => {
    gl.diffs = [RENAMED, DELETED];

    await review({
      comments: [
        { path: 'new.ts', new_line: 1, body: 'renamed, new side' },
        { path: 'old.ts', old_line: 1, body: 'renamed, old side' },
        { path: 'gone.ts', old_line: 2, body: 'deleted' },
      ],
    });

    expect(gl.threads.map(positionIn)).toEqual([
      expect.objectContaining({ old_path: 'old.ts', new_path: 'new.ts', new_line: 1 }),
      expect.objectContaining({ old_path: 'old.ts', new_path: 'new.ts', old_line: 1 }),
      expect.objectContaining({ old_path: 'gone.ts', new_path: 'gone.ts', old_line: 2 }),
    ]);
  });

  it('tells two files sharing a path apart by the side the comment names', async () => {
    gl.diffs = [RENAMED, READDED];

    await review({
      comments: [
        { path: 'old.ts', new_line: 1, body: 'the new file' },
        { path: 'old.ts', old_line: 1, body: 'the rename source' },
      ],
    });

    expect(gl.threads.map(positionIn)).toEqual([
      expect.objectContaining({ old_path: 'old.ts', new_path: 'old.ts', new_line: 1 }),
      expect.objectContaining({ old_path: 'old.ts', new_path: 'new.ts', old_line: 1 }),
    ]);
  });
});

describe('manage_mr_discussion review: publication', () => {
  it('posts each comment as a diff thread, then the summary, with their IDs', async () => {
    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'one' },
        { path: 'a.ts', old_line: 2, body: 'two' },
      ],
      summary: 'Looks good overall',
    });

    expect(mockGitlab.post.mock.calls.map(([path]) => path)).toEqual([
      `${MR}/discussions`,
      `${MR}/discussions`,
      `${MR}/notes`,
    ]);
    expect(gl.notes).toEqual([{ body: 'Looks good overall' }]);
    expect(result).toEqual({
      merge_request_iid: '7',
      head_sha: HEAD,
      complete: true,
      comments: [
        {
          index: 0,
          path: 'a.ts',
          old_line: null,
          new_line: 2,
          status: 'published',
          discussion_id: 'd1',
          note_id: 101,
        },
        {
          index: 1,
          path: 'a.ts',
          old_line: 2,
          new_line: null,
          status: 'published',
          discussion_id: 'd2',
          note_id: 102,
        },
      ],
      summary: { status: 'published', note_id: 501 },
    });
  });

  // Drafts belong to the reviewer's own pending review; a batch must not publish or touch them.
  it('never touches the draft notes of the reviewer', async () => {
    await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'x' }], summary: 'y' });

    const touched = [...mockGitlab.get.mock.calls, ...mockGitlab.post.mock.calls].map(
      ([path]) => path,
    );
    expect(touched.some((path) => path.includes('draft_notes'))).toBe(false);
    expect(mockGitlab.put).not.toHaveBeenCalled();
    expect(mockGitlab.delete).not.toHaveBeenCalled();
  });

  it('stops at a refused write and reports what each write did', async () => {
    gl.fail = (method, path) =>
      path.endsWith('/discussions') && gl.threads.length === 1
        ? new GitLabApiError(400, 'line_code invalid', 'GitLab API error: 400 Bad Request')
        : undefined;

    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'one' },
        { path: 'a.ts', old_line: 2, body: 'two' },
        { path: 'a.ts', new_line: 3, body: 'three' },
      ],
      summary: 'summary',
    });

    expect(result).toEqual(
      expect.objectContaining({
        complete: false,
        comments: [
          expect.objectContaining({ index: 0, status: 'published', discussion_id: 'd1' }),
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
    gl.fail = (method, path) =>
      path.endsWith('/discussions')
        ? new GitLabApiError(403, 'Forbidden', 'GitLab API error: 403 Forbidden')
        : undefined;

    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'one' },
        { path: 'a.ts', new_line: 3, body: 'two' },
      ],
    });

    expect(result.comments).toEqual([
      expect.objectContaining({ status: 'failed' }),
      expect.objectContaining({ status: 'not_attempted' }),
    ]);
    expect(mockGitlab.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a timeout', new Error('GitLab API timeout after 20000ms')],
    ['a server error', new GitLabApiError(502, 'Bad Gateway', 'GitLab API error: 502 Bad Gateway')],
    ['a failure that is not an Error', 'socket hang up'],
  ])('reports a write that ended in %s as unknown, not failed', async (_case, error) => {
    gl.fail = (method, path) => (path.endsWith('/discussions') ? error : undefined);

    const result = await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] });

    expect(result.comments).toEqual([
      expect.objectContaining({
        status: 'unknown',
        error: String((error as Error).message ?? error),
      }),
    ]);
    expect(result.note).toEqual(expect.stringContaining('check the merge request discussions'));
  });

  it('reports a failed summary after all comments were posted', async () => {
    gl.fail = (method, path) =>
      path.endsWith('/notes')
        ? new GitLabApiError(422, 'Note invalid', 'GitLab API error: 422')
        : undefined;

    const result = await review({
      comments: [{ path: 'a.ts', new_line: 2, body: 'one' }],
      summary: 'summary',
    });

    expect(result.summary).toEqual({ status: 'failed', error: 'GitLab API error: 422' });
    expect(result.complete).toBe(false);
  });

  it('counts a thread as published when GitLab answers without a discussion', async () => {
    mockGitlab.post.mockResolvedValueOnce(undefined);

    const result = await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] });

    expect(result.comments).toEqual([
      expect.not.objectContaining({ discussion_id: expect.anything() }),
    ]);
    expect(result.complete).toBe(true);
  });

  it('counts a write as published when GitLab answers without the usual identifiers', async () => {
    mockGitlab.post.mockResolvedValueOnce({ id: 'd1' }).mockResolvedValueOnce(undefined);

    const result = await review({
      comments: [{ path: 'a.ts', new_line: 2, body: 'one' }],
      summary: 's',
    });

    expect(result.comments).toEqual([
      expect.objectContaining({ status: 'published', discussion_id: 'd1' }),
    ]);
    expect(result.comments).toEqual([expect.not.objectContaining({ note_id: expect.anything() })]);
    expect(result.summary).toEqual({ status: 'published' });
  });
});
