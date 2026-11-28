import { mrsToolRegistry } from '../../../../src/entities/mrs/registry';
import { instanceAtLeast } from '../../../../src/entities/instance-version';
import { gitlab, GitLabApiError } from '../../../../src/utils/gitlab-api';

jest.mock('../../../../src/utils/gitlab-api', () => ({
  ...jest.requireActual('../../../../src/utils/gitlab-api'),
  gitlab: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../../src/entities/instance-version', () => ({
  ...jest.requireActual('../../../../src/entities/instance-version'),
  instanceAtLeast: jest.fn(),
}));

const mockGitlab = gitlab as jest.Mocked<typeof gitlab>;
const mockInstanceAtLeast = instanceAtLeast as jest.MockedFunction<typeof instanceAtLeast>;

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

/**
 * A stateful stand-in for the GitLab endpoints a review uses: the MR version, the
 * reviewer's pending drafts and what got published. `fail` makes one call throw.
 */
class FakeGitLab {
  head = HEAD;
  diffs: unknown[] = [MODIFIED];
  pending = new Map<number, Record<string, unknown>>();
  published: number[] = [];
  threads: Array<Record<string, unknown>> = [];
  notes: Array<Record<string, unknown>> = [];
  dropPosition = false;
  failListing = false;
  fail: Fail = () => undefined;
  private nextId = 1;

  install(): void {
    mockGitlab.get.mockImplementation(async (path: string) => {
      this.check('GET', path);
      if (path === `${MR}/versions`) {
        return [
          { id: 31, head_commit_sha: this.head, base_commit_sha: BASE, start_commit_sha: START },
        ];
      }
      if (path === `${MR}/versions/31`) return { id: 31, diffs: this.diffs };
      if (path === `${MR}/draft_notes`) {
        if (this.failListing) throw new Error('listing timed out');
        return [...this.pending.keys()].map((id) => ({ id }));
      }
      throw new Error(`unexpected GET ${path}`);
    });
    mockGitlab.post.mockImplementation(async (path: string, options?: unknown) => {
      this.check('POST', path);
      const body = (options as { body?: Record<string, unknown> } | undefined)?.body ?? {};
      if (path === `${MR}/draft_notes`) {
        const id = this.foreign();
        this.pending.set(id, body);
        const position = this.dropPosition
          ? null
          : { head_sha: body['position[head_sha]'] ?? null };
        return { id, note: body.note, position };
      }
      if (path === `${MR}/draft_notes/bulk_publish`) {
        this.published.push(...this.pending.keys());
        this.pending.clear();
        return undefined;
      }
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
    mockGitlab.put.mockImplementation(async (path: string) => {
      this.check('PUT', path);
      const id = Number(/draft_notes\/(\d+)\/publish$/.exec(path)?.[1]);
      if (!this.pending.has(id))
        throw new GitLabApiError(404, 'Not found', 'GitLab API error: 404');
      this.pending.delete(id);
      this.published.push(id);
      return undefined;
    });
    mockGitlab.delete.mockImplementation(async (path: string) => {
      this.check('DELETE', path);
      this.pending.delete(Number(/draft_notes\/(\d+)$/.exec(path)?.[1]));
      return undefined;
    });
  }

  /** A new ID, also used for drafts the reviewer had before the review. */
  foreign(): number {
    return this.nextId++;
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

/** The bodies of the drafts the review created, in order. */
function draftBodies(): Array<Record<string, unknown>> {
  return mockGitlab.post.mock.calls
    .filter(([path]) => path === `${MR}/draft_notes`)
    .map(([, options]) => (options as { body: Record<string, unknown> }).body);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInstanceAtLeast.mockReturnValue(true);
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

  it('accepts an unchanged line named by both its numbers', async () => {
    const result = await review({
      comments: [{ path: 'a.ts', old_line: 3, new_line: 3, body: 'unchanged' }],
    });

    expect(result.comments).toEqual([
      expect.objectContaining({ old_line: 3, new_line: 3, status: 'published' }),
    ]);
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
// review text must never carry a verdict.
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

  // GitLab deletes carriage returns before looking for commands: "/\rclose" is "/close".
  it.each([
    ['a comment', { comments: [{ path: 'a.ts', new_line: 2, body: 'Review\n/\rclose' }] }],
    [
      'the summary',
      { comments: [{ path: 'a.ts', new_line: 2, body: 'ok' }], summary: 'Done\n/\rmerge' },
    ],
  ])('refuses a command split by a carriage return in %s', async (_case, args) => {
    await expect(review(args)).rejects.toThrow('would run as a quick action');
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

  it('accepts slashes GitLab skips: inline code, code blocks, suggestions and prose', async () => {
    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'See  /usr/lib and `/approve`' },
        { path: 'a.ts', new_line: 3, body: 'Example:\n```\n/merge\n```' },
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

    expect(draftBodies()[0].note).toBe(
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
    expect(draftBodies().map(positionIn)).toEqual([
      { ...common, new_line: 2 },
      { ...common, old_line: 2 },
      { ...common, old_line: 3, new_line: 3 },
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

    expect(draftBodies().map(positionIn)).toEqual([
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

    expect(draftBodies().map(positionIn)).toEqual([
      expect.objectContaining({ old_path: 'old.ts', new_path: 'old.ts', new_line: 1 }),
      expect.objectContaining({ old_path: 'old.ts', new_path: 'new.ts', old_line: 1 }),
    ]);
  });
});

describe('manage_mr_discussion review: published through drafts', () => {
  it('submits the comments and the summary as one review when no other draft is pending', async () => {
    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'one' },
        { path: 'a.ts', old_line: 2, body: 'two' },
      ],
      summary: 'Looks good overall',
    });

    expect(draftBodies().map((body) => body.note)).toEqual(['one', 'two', 'Looks good overall']);
    expect(positionIn(draftBodies()[2])).toEqual({});
    expect(mockGitlab.post).toHaveBeenCalledWith(`${MR}/draft_notes/bulk_publish`);
    expect(mockGitlab.put).not.toHaveBeenCalled();
    expect(gl.threads).toEqual([]);
    expect(gl.published).toEqual([1, 2, 3]);
    expect(result).toEqual({
      merge_request_iid: '7',
      head_sha: HEAD,
      published_as: 'review',
      complete: true,
      comments: [
        { index: 0, path: 'a.ts', old_line: null, new_line: 2, status: 'published' },
        { index: 1, path: 'a.ts', old_line: 2, new_line: null, status: 'published' },
      ],
      summary: { status: 'published' },
    });
  });

  // A submitted review publishes every pending draft of the reviewer; theirs must stay pending.
  it('publishes its drafts one by one and leaves the other drafts of the reviewer pending', async () => {
    const own = gl.foreign();
    gl.pending.set(own, { note: 'mine, unrelated' });

    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'one' },
        { path: 'a.ts', new_line: 3, body: 'two' },
      ],
      summary: 's',
    });

    expect(mockGitlab.post).not.toHaveBeenCalledWith(`${MR}/draft_notes/bulk_publish`);
    expect(gl.published).toEqual([2, 3, 4]);
    expect([...gl.pending.keys()]).toEqual([own]);
    expect(mockGitlab.delete).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ published_as: 'separate', complete: true }));
  });

  it('publishes one by one when GitLab lists the pending drafts in an unexpected shape', async () => {
    const serve = mockGitlab.get.getMockImplementation()!;
    mockGitlab.get.mockImplementation(async (path: string, options?: unknown) =>
      path === `${MR}/draft_notes` ? { drafts: [] } : serve(path, options as never),
    );

    const result = await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] });

    expect(result).toEqual(expect.objectContaining({ published_as: 'separate', complete: true }));
  });

  it('publishes one by one when GitLab does not list the pending drafts', async () => {
    gl.failListing = true;

    const result = await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] });

    expect(mockGitlab.post).not.toHaveBeenCalledWith(`${MR}/draft_notes/bulk_publish`);
    expect(result).toEqual(expect.objectContaining({ published_as: 'separate', complete: true }));
  });

  it('reports drafts still pending after a submitted review failed', async () => {
    gl.fail = (method, path) =>
      path.endsWith('bulk_publish')
        ? new GitLabApiError(500, 'boom', 'GitLab API error: 500')
        : undefined;

    const result = await review({
      comments: [{ path: 'a.ts', new_line: 2, body: 'one' }],
      summary: 's',
    });

    expect(result).toEqual(
      expect.objectContaining({
        published_as: 'review',
        complete: false,
        comments: [
          expect.objectContaining({
            status: 'draft',
            draft_note_id: 1,
            error: 'GitLab API error: 500',
          }),
        ],
        summary: { status: 'draft', draft_note_id: 2, error: 'GitLab API error: 500' },
        note: expect.stringContaining('nothing was rolled back'),
      }),
    );
  });

  it('reports unknown when neither the review nor the pending drafts can be read', async () => {
    gl.fail = (method, path) => (path.endsWith('bulk_publish') ? new Error('timeout') : undefined);
    let listings = 0;
    const listPending = mockGitlab.get.getMockImplementation()!;
    mockGitlab.get.mockImplementation(async (path: string, options?: unknown) => {
      if (path === `${MR}/draft_notes` && ++listings > 1) throw new Error('timeout');
      return listPending(path, options as never);
    });

    const result = await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] });

    expect(result.comments).toEqual([
      expect.objectContaining({ status: 'unknown', draft_note_id: 1, error: 'timeout' }),
    ]);
  });

  it('reports which drafts a failed one-by-one publication left pending', async () => {
    gl.pending.set(gl.foreign(), { note: 'unrelated' });
    gl.fail = (method, path) =>
      method === 'PUT' && path.includes('/draft_notes/3/')
        ? new GitLabApiError(500, 'boom', 'GitLab API error: 500')
        : undefined;

    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'one' },
        { path: 'a.ts', new_line: 3, body: 'two' },
        { path: 'a.ts', new_line: 4, body: 'three' },
      ],
    });

    expect(result.comments).toEqual([
      expect.objectContaining({ index: 0, status: 'published' }),
      expect.objectContaining({
        index: 1,
        status: 'draft',
        draft_note_id: 3,
        error: 'GitLab API error: 500',
      }),
      expect.objectContaining({ index: 2, status: 'draft', draft_note_id: 4 }),
    ]);
    expect(result.complete).toBe(false);
  });

  it('withdraws its drafts and publishes nothing when one cannot be created', async () => {
    gl.fail = (method, path) =>
      method === 'POST' && path.endsWith('/draft_notes') && gl.pending.size === 1
        ? new GitLabApiError(400, 'bad', 'GitLab API error: 400 Bad Request')
        : undefined;

    const attempt = review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'one' },
        { path: 'a.ts', new_line: 3, body: 'two' },
      ],
    });

    await expect(attempt).rejects.toThrow(
      'Review not posted, nothing was published:\n- comments[1]: GitLab API error: 400 Bad Request',
    );
    expect(mockGitlab.delete).toHaveBeenCalledWith(`${MR}/draft_notes/1`);
    expect(gl.pending.size).toBe(0);
    expect(gl.published).toEqual([]);
  });

  it('names the drafts it could not withdraw and the one that may exist', async () => {
    gl.fail = (method, path) => {
      if (method === 'DELETE') return new Error('delete timed out');
      if (method === 'POST' && path.endsWith('/draft_notes') && gl.pending.size === 1) {
        return new Error('create timed out');
      }
      return undefined;
    };

    const attempt = review({
      comments: [{ path: 'a.ts', new_line: 2, body: 'one' }],
      summary: 'summary',
    });

    await expect(attempt).rejects.toThrow(
      [
        '- summary: create timed out',
        '- a draft for summary may exist; check your drafts',
        '- drafts left unpublished: 1',
      ].join('\n'),
    );
    expect(gl.published).toEqual([]);
  });

  it('refuses an unexpected draft answer', async () => {
    mockGitlab.post.mockResolvedValueOnce({ unexpected: true });

    await expect(
      review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] }),
    ).rejects.toThrow('comments[0]: GitLab returned an unexpected draft note');
  });

  // An instance that ignores the draft position would publish general comments instead.
  it('posts threads instead when GitLab drops the position of a draft', async () => {
    gl.dropPosition = true;

    const result = await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] });

    expect(mockGitlab.delete).toHaveBeenCalledWith(`${MR}/draft_notes/1`);
    expect(gl.published).toEqual([]);
    expect(gl.threads).toHaveLength(1);
    expect(result.published_as).toBe('threads');
  });

  it('refuses when GitLab drops the position and the draft cannot be withdrawn', async () => {
    gl.dropPosition = true;
    gl.fail = (method) => (method === 'DELETE' ? new Error('delete timed out') : undefined);

    await expect(
      review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] }),
    ).rejects.toThrow('GitLab dropped the diff position of a draft; drafts left unpublished: 1');
    expect(gl.threads).toEqual([]);
  });
});

describe('manage_mr_discussion review: published as threads', () => {
  beforeEach(() => mockInstanceAtLeast.mockReturnValue(false));

  it('posts each comment as a diff thread, then the summary, before GitLab 16.3', async () => {
    const result = await review({
      comments: [
        { path: 'a.ts', new_line: 2, body: 'one' },
        { path: 'a.ts', old_line: 2, body: 'two' },
      ],
      summary: 'Looks good overall',
    });

    expect(mockInstanceAtLeast).toHaveBeenCalledWith('16.3');
    expect(mockGitlab.post.mock.calls.map(([path]) => path)).toEqual([
      `${MR}/discussions`,
      `${MR}/discussions`,
      `${MR}/notes`,
    ]);
    expect(positionIn(gl.threads[1])).toEqual(expect.objectContaining({ old_line: 2 }));
    expect(gl.notes).toEqual([{ body: 'Looks good overall' }]);
    expect(result).toEqual({
      merge_request_iid: '7',
      head_sha: HEAD,
      published_as: 'threads',
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
      }),
    );
  });

  it.each([
    ['a timeout', new Error('GitLab API timeout after 20000ms')],
    ['a server error', new GitLabApiError(502, 'Bad Gateway', 'GitLab API error: 502 Bad Gateway')],
  ])('reports a write that ended in %s as unknown, not failed', async (_case, error) => {
    gl.fail = (method, path) => (path.endsWith('/discussions') ? error : undefined);

    const result = await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] });

    expect(result.comments).toEqual([expect.objectContaining({ status: 'unknown' })]);
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

  it('reports a failure that is not an Error by its text', async () => {
    gl.fail = (method, path) => (path.endsWith('/discussions') ? 'socket hang up' : undefined);

    const result = await review({ comments: [{ path: 'a.ts', new_line: 2, body: 'one' }] });

    expect(result.comments).toEqual([
      expect.objectContaining({ status: 'unknown', error: 'socket hang up' }),
    ]);
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
