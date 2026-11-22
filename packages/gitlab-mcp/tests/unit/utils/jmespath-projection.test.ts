import { MessageChannel } from 'node:worker_threads';
import {
  checkProjection,
  compileProjection,
  evaluateProjection,
  JMESPATH_MAX_LENGTH,
  JMESPATH_MAX_OUTPUT_CHARS,
  JmespathExpressionSchema,
  ProjectionError,
  serveProjection,
  type ProjectionReply,
} from '../../../src/utils/jmespath-projection';
import {
  applyProjection,
  closeProjectionWorkers,
} from '../../../src/utils/jmespath-projection-worker';

const project = (expression: string, result: unknown) =>
  applyProjection(compileProjection(expression), result);

afterAll(() => closeProjectionWorkers());

const jobs = [
  { id: 1, name: 'lint', stage: 'test', status: 'success' },
  { id: 2, name: 'unit', stage: 'test', status: 'failed' },
  { id: 3, name: 'deploy', stage: 'deploy', status: 'failed' },
];

describe('JmespathExpressionSchema', () => {
  it('refuses a non-string, an empty and an over-long expression with their messages', () => {
    const issue = (value: unknown) => {
      const parsed = JmespathExpressionSchema.safeParse(value);
      return parsed.success ? undefined : parsed.error.issues[0].message;
    };
    expect(issue(5)).toBe("'jmespath' must be a string expression.");
    expect(issue('   ')).toBe('Invalid jmespath expression: expression is empty');
    expect(issue(`a${'.a'.repeat(JMESPATH_MAX_LENGTH)}`)).toBe(
      `Invalid jmespath expression: expression exceeds ${JMESPATH_MAX_LENGTH} characters`,
    );
    expect(issue('[].id')).toBeUndefined();
  });
});

describe('checkProjection', () => {
  it('compiles a valid argument and names the refusal of an invalid one', () => {
    expect(checkProjection('[].id')).toMatchObject({ expression: '[].id' });
    expect(checkProjection(5)).toEqual({ refusal: "'jmespath' must be a string expression." });
    expect(checkProjection('[?a==')).toEqual({
      refusal: expect.stringMatching(/^Invalid jmespath expression: Syntax error/),
    });
    expect(checkProjection('nope(@)')).toEqual({
      refusal: 'Invalid jmespath expression: unknown function nope()',
    });
  });
});

// The evaluator runs in a worker in production; here it runs in the test's own thread, so
// its behaviour is exercised directly as well as through the worker below.
describe('evaluateProjection', () => {
  it('evaluates with the RE2 functions', () => {
    const rows = [{ title: 'Fix flaky test' }, { title: 'Add feature' }];
    expect(evaluateProjection("[?re_test(title, '(?i)flaky')].title", rows)).toEqual([
      'Fix flaky test',
    ]);
    expect(evaluateProjection("[].re_find(title, '[A-Z]+')", rows)).toEqual(['F', 'A']);
    expect(evaluateProjection("re_find(t, '[0-9]+')", { t: 'none' })).toBeNull();
    expect(
      evaluateProjection("re_replace(r, '^refs/heads/(.+)$', '$1')", { r: 'refs/heads/x' }),
    ).toBe('x');
  });

  it('serves repeated and evicted patterns from its cache correctly', () => {
    for (let index = 0; index < 80; index++)
      expect(evaluateProjection(`re_test(n, 'n${index}$')`, { n: `n${index}` })).toBe(true);
    // n0 was evicted by the later patterns and is compiled again; n79 is still cached.
    expect(evaluateProjection("re_test(n, 'n0$')", { n: 'n0' })).toBe(true);
    expect(evaluateProjection("re_test(n, 'n79$')", { n: 'n79' })).toBe(true);
  });

  it('refuses an exploding result before it is serialized, counting shared values', () => {
    const started = Date.now();
    expect(() => evaluateProjection(`'x'${' | [@,@]'.repeat(30)}`, {})).toThrow(
      `the result exceeds ${JMESPATH_MAX_OUTPUT_CHARS} characters`,
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('measures objects, numbers and literals toward the result size', () => {
    const wide = { key: 'v'.repeat(1000), n: 12345, flag: true, empty: null };
    expect(evaluateProjection('@', wide)).toEqual(wide);
    const repeated = `{a: @, b: @}${' | {a: @, b: @}'.repeat(20)}`;
    expect(() => evaluateProjection(repeated, wide)).toThrow(ProjectionError);
  });

  it('turns an evaluation error into a projection error with its detail', () => {
    expect(() => evaluateProjection('abs(name)', { name: 'x' })).toThrow(ProjectionError);
    try {
      evaluateProjection('abs(name)', { name: 'x' });
    } catch (error) {
      expect((error as ProjectionError).detail).toMatch(/abs\(\) expected argument 1/);
    }
  });
});

describe('serveProjection', () => {
  it('announces itself, answers requests and reports failures by their detail', async () => {
    const { port1, port2 } = new MessageChannel();
    const replies: ProjectionReply[] = [];
    const next = () => new Promise<ProjectionReply>((resolve) => port1.once('message', resolve));
    try {
      const ready = next();
      serveProjection(port2);
      replies.push(await ready);
      let answer = next();
      port1.postMessage({ expression: '[].id', input: jobs });
      replies.push(await answer);
      answer = next();
      port1.postMessage({ expression: 'abs(name)', input: { name: 'x' } });
      replies.push(await answer);
    } finally {
      port1.close();
    }
    expect(replies[0]).toEqual({ ok: true, data: null });
    expect(replies[1]).toEqual({ ok: true, data: [1, 2, 3] });
    expect(replies[2]).toEqual({
      ok: false,
      detail: expect.stringMatching(/abs\(\) expected argument 1/),
    });
  });
});

describe('compileProjection', () => {
  it('refuses a syntax error with the parser message before anything runs', () => {
    expect(() => compileProjection("[?status=='failed'")).toThrow(ProjectionError);
    expect(() => compileProjection("[?status=='failed'")).toThrow(
      /^Invalid jmespath expression: Syntax error/,
    );
  });

  it('refuses an unknown function at compile time, which the evaluator only finds on a row', () => {
    expect(() => compileProjection('[?no_such_fn(name)]')).toThrow(
      'Invalid jmespath expression: unknown function no_such_fn()',
    );
  });

  it('does not take a JSON literal shaped like a call for an unknown function', () => {
    expect(() => compileProjection('`{"type": "Function", "name": "no_such_fn"}`')).not.toThrow();
  });

  it('refuses an expression nested deeper than the compile bound', () => {
    expect(() => compileProjection(`${'('.repeat(100)}a${')'.repeat(100)}`)).toThrow(
      ProjectionError,
    );
  });
});

describe('applyProjection', () => {
  it('filters and reshapes an array result and counts input and output rows', async () => {
    const result = await project("[?status=='failed'].{id: id, name: name, stage: stage}", jobs);
    expect(result).toEqual({
      data: [
        { id: 2, name: 'unit', stage: 'test' },
        { id: 3, name: 'deploy', stage: 'deploy' },
      ],
      jmespath: {
        expression: "[?status=='failed'].{id: id, name: name, stage: stage}",
        input_items: 3,
        output_items: 2,
      },
    });
  });

  it('aggregates with community extensions such as group_by and let', async () => {
    expect((await project('keys(group_by(@, &stage))', jobs)).data).toEqual(['test', 'deploy']);
    expect((await project("let $s = 'deploy' in [?stage==$s].id", jobs)).data).toEqual([3]);
  });

  it('reports that nothing matched out of the input rows for an empty or null projection', async () => {
    expect((await project("[?status=='canceled']", jobs)).jmespath).toEqual({
      expression: "[?status=='canceled']",
      input_items: 3,
      output_items: 0,
      note: 'Nothing matched out of 3 input items.',
    });
    expect((await project('missing', jobs)).jmespath.note).toBe(
      'Nothing matched out of 3 input items.',
    );
  });

  it('counts the rows of an object result from its row field', async () => {
    const page = { items: jobs, hasMore: true, endCursor: 'abc' };
    const result = await project("items[?status=='failed'].id", page);
    expect(result.data).toEqual([2, 3]);
    expect(result.jmespath.input_items).toBe(3);
    expect(result.jmespath.output_items).toBe(2);
  });

  it('counts the rows of user searches, work item discussions and Duo sessions', async () => {
    // A row field the counter does not know made every such result count as one row.
    const rows = [{ id: 1 }, { id: 2 }];
    expect((await project('users[].id', { users: rows })).jmespath.input_items).toBe(2);
    expect((await project('discussions[].id', { discussions: rows })).jmespath.input_items).toBe(2);
    expect((await project('sessions[].id', { sessions: rows })).jmespath.input_items).toBe(2);
  });

  it('keeps a cursor continuation the expression did not select', async () => {
    const page = { items: jobs, hasMore: true, endCursor: 'abc' };
    expect((await project('items[].id', page)).next_page).toEqual({
      hasMore: true,
      endCursor: 'abc',
    });
    const connection = { nodes: jobs, pageInfo: { hasNextPage: true, endCursor: 'xyz' } };
    expect((await project('nodes[].id', connection)).next_page).toEqual({
      pageInfo: { hasNextPage: true, endCursor: 'xyz' },
    });
  });

  it('keeps the incompleteness of a partial page and a truncated diff beside the data', async () => {
    const partial = { items: jobs, partial: true, message: 'Read the first 1000 rows.' };
    const projected = await project('items[].id', partial);
    expect(projected.partial).toBe(true);
    expect(projected.message).toBe('Read the first 1000 rows.');
    const diffs = { changes: [], overflow: true, truncated: false };
    expect(await project('changes', diffs)).toMatchObject({ overflow: true, truncated: false });
  });

  it('keeps the files a diff line search could not scan and its filter summary', async () => {
    // Otherwise an empty projection reads as "nothing matched" though files went unsearched.
    const search = {
      diffs: [],
      not_scanned: [{ old_path: 'big.bin', new_path: 'big.bin', reason: 'too_large' }],
      _filtered: { files_scanned: 0, match_count: 0, truncated: true },
    };
    const projected = await project('diffs[].matches[]', search);
    expect(projected.not_scanned).toEqual(search.not_scanned);
    expect(projected._filtered).toEqual(search._filtered);
  });

  it('keeps the warnings of a user search and the sessions a Duo listing skipped', async () => {
    const plain = { users: [{ id: 1 }], _warning: 'Filter applied to the first page only' };
    expect((await project('users[].id', plain))._warning).toBe(plain._warning);
    const smart = { users: [], searchMetadata: { warning: 'partial' } };
    expect((await project('users', smart)).searchMetadata).toEqual({ warning: 'partial' });
    const duo = {
      sessions: [],
      pageInfo: { hasNextPage: false, endCursor: null },
      skipped_unverifiable_sessions: 2,
    };
    const listed = await project('sessions', duo);
    expect(listed.skipped_unverifiable_sessions).toBe(2);
    expect(listed.next_page).toEqual({ pageInfo: duo.pageInfo });
  });

  it('does not lift an ordinary message field of a complete result', async () => {
    const result = await project('title', { title: 'x', message: 'commit message' });
    expect(result).not.toHaveProperty('message');
  });

  it('adds nothing beside the data for an array result', async () => {
    const result = await project('[].id', jobs);
    expect(Object.keys(result).sort()).toEqual(['data', 'jmespath']);
  });

  it('turns an evaluation type error into a projection error', async () => {
    await expect(project('abs(name)', { name: 'x' })).rejects.toThrow(
      /^Invalid jmespath expression:/,
    );
  });
});

describe('bounded evaluation', () => {
  // Each `[@,@]` doubles the expanded result while sharing one value; serializing 2^30
  // leaves would hold the thread and fail at the engine's string limit.
  const doubling = (stages: number, tail = '') => `'x'${' | [@,@]'.repeat(stages)}${tail}`;

  it(`refuses a result larger than ${JMESPATH_MAX_OUTPUT_CHARS} characters once expanded`, async () => {
    const started = Date.now();
    await expect(project(doubling(30), {})).rejects.toThrow(
      `Invalid jmespath expression: the result exceeds ${JMESPATH_MAX_OUTPUT_CHARS} characters; select fewer fields or rows`,
    );
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('stops a function that serializes an exploding value within the time limit', async () => {
    const started = Date.now();
    await expect(project(doubling(28, ' | to_string(@)'), {})).rejects.toThrow(
      /^Invalid jmespath expression: evaluation exceeded its (time|memory) limit/,
    );
    expect(Date.now() - started).toBeLessThan(8000);
  }, 20_000);

  it('fails a result that cannot be handed to the worker without losing the worker pool', async () => {
    await expect(project('@', { run: () => 1 })).rejects.toThrow(/could not be cloned/);
    expect((await project('[].id', jobs)).data).toEqual([1, 2, 3]);
  }, 20_000);

  it('stops a function that allocates a huge string', async () => {
    await expect(project("pad_left('x', `1000000000`)", {})).rejects.toThrow(
      /^Invalid jmespath expression: /,
    );
  }, 20_000);

  it('keeps answering after a worker was stopped', async () => {
    await expect(project(doubling(28, ' | to_string(@)'), {})).rejects.toThrow(ProjectionError);
    expect((await project('[].id', jobs)).data).toEqual([1, 2, 3]);
  }, 20_000);
});

describe('expressions shown in the skills', () => {
  it('keeps unarchived projects with the fields the discovery skill names', async () => {
    const projects = [
      { path_with_namespace: 'g/a', archived: false, last_activity_at: 't1', id: 1 },
      { path_with_namespace: 'g/b', archived: true, last_activity_at: 't2', id: 2 },
    ];
    expect(
      (
        await project(
          '[?!archived].{path: path_with_namespace, activity: last_activity_at}',
          projects,
        )
      ).data,
    ).toEqual([{ path: 'g/a', activity: 't1' }]);
  });

  it('lists the failed jobs the CI skill asks for', async () => {
    const rows = jobs.map((job) => ({ ...job, failure_reason: 'script_failure' }));
    expect(
      (
        await project(
          "[?status=='failed'].{id: id, name: name, stage: stage, reason: failure_reason}",
          rows,
        )
      ).data,
    ).toEqual([
      { id: 2, name: 'unit', stage: 'test', reason: 'script_failure' },
      { id: 3, name: 'deploy', stage: 'deploy', reason: 'script_failure' },
    ]);
  });

  it('lists only open threads as the review skill shows', async () => {
    const discussions = [
      {
        id: 'a',
        notes: [{ resolvable: true, resolved: false, body: 'fix', position: { new_path: 'x.ts' } }],
      },
      {
        id: 'b',
        notes: [{ resolvable: true, resolved: true, body: 'done', position: { new_path: 'y.ts' } }],
      },
      { id: 'c', notes: [{ resolvable: false, body: 'note' }] },
    ];
    expect(
      (
        await project(
          // `!` binds tighter than indexing: `!notes[0].resolved` would read `(!notes)[0]`.
          '[?notes[0].resolvable && !(notes[0].resolved)].{id: id, file: notes[0].position.new_path, body: notes[0].body}',
          discussions,
        )
      ).data,
    ).toEqual([{ id: 'a', file: 'x.ts', body: 'fix' }]);
  });

  it('finds flaky merge requests with their author as the review skill shows', async () => {
    const mrs = [
      { iid: 1, title: 'Fix Flaky spec', author: { username: 'ann' } },
      { iid: 2, title: 'Feature', author: { username: 'bob' } },
    ];
    expect(
      (
        await project(
          "[?re_test(title, '(?i)flaky')].{iid: iid, title: title, author: author.username}",
          mrs,
        )
      ).data,
    ).toEqual([{ iid: 1, title: 'Fix Flaky spec', author: 'ann' }]);
  });
});

describe('RE2 functions', () => {
  const titles = [{ title: 'Fix flaky test' }, { title: 'Add feature' }, { title: 'FLAKY retry' }];

  it('re_test filters rows with an RE2 pattern', async () => {
    expect((await project("[?re_test(title, '(?i)flaky')].title", titles)).data).toEqual([
      'Fix flaky test',
      'FLAKY retry',
    ]);
  });

  it('re_find returns the first match or null', async () => {
    expect((await project("[].re_find(title, '[A-Z]+')", titles)).data).toEqual([
      'F',
      'A',
      'FLAKY',
    ]);
    expect((await project("re_find(title, '[0-9]+')", { title: 'none' })).data).toBeNull();
  });

  it('re_replace replaces every match with group references', async () => {
    expect(
      (
        await project("re_replace(ref, '^refs/heads/(.+)$', 'branch:$1')", {
          ref: 'refs/heads/main',
        })
      ).data,
    ).toBe('branch:main');
  });

  it('refuses an invalid pattern with the RE2 contract message', async () => {
    await expect(project("[?re_test(title, '(')]", titles)).rejects.toThrow(
      /^Invalid jmespath expression: Invalid RE2 pattern 0:/,
    );
    await expect(project(`[?re_test(title, '${'a'.repeat(513)}')]`, titles)).rejects.toThrow(
      /pattern exceeds 512 characters/,
    );
  });

  it('refuses a non-string argument with a JMESPath type error', async () => {
    await expect(project("[?re_test(id, 'x')]", [{ id: 1 }])).rejects.toThrow(
      /re_test\(\) expected argument 1 to be type \(string\)/,
    );
  });

  it('keeps answering correctly once more patterns are used than the cache holds', async () => {
    for (let index = 0; index < 80; index++) {
      expect((await project(`re_test(name, 'n${index}$')`, { name: `n${index}` })).data).toBe(true);
    }
    expect((await project("re_test(name, 'n0$')", { name: 'n0' })).data).toBe(true);
  });
});
