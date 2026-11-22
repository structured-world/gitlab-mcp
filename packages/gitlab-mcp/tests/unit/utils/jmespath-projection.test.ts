import {
  applyProjection,
  compileProjection,
  JMESPATH_MAX_LENGTH,
  ProjectionError,
} from '../../../src/utils/jmespath-projection';

const project = (expression: string, result: unknown) =>
  applyProjection(compileProjection(expression), result);

const jobs = [
  { id: 1, name: 'lint', stage: 'test', status: 'success' },
  { id: 2, name: 'unit', stage: 'test', status: 'failed' },
  { id: 3, name: 'deploy', stage: 'deploy', status: 'failed' },
];

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

  it('refuses an empty expression and one over the length limit', () => {
    expect(() => compileProjection('   ')).toThrow('expression is empty');
    expect(() => compileProjection(`a${'.a'.repeat(JMESPATH_MAX_LENGTH)}`)).toThrow(
      `expression exceeds ${JMESPATH_MAX_LENGTH} characters`,
    );
  });

  it('refuses an expression nested deeper than the compile bound', () => {
    expect(() => compileProjection(`${'('.repeat(100)}a${')'.repeat(100)}`)).toThrow(
      ProjectionError,
    );
  });
});

describe('applyProjection', () => {
  it('filters and reshapes an array result and counts input and output rows', () => {
    const result = project("[?status=='failed'].{id: id, name: name, stage: stage}", jobs);
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

  it('aggregates with community extensions such as group_by and let', () => {
    expect(project('keys(group_by(@, &stage))', jobs).data).toEqual(['test', 'deploy']);
    expect(project("let $s = 'deploy' in [?stage==$s].id", jobs).data).toEqual([3]);
  });

  it('reports that nothing matched out of the input rows for an empty or null projection', () => {
    expect(project("[?status=='canceled']", jobs).jmespath).toEqual({
      expression: "[?status=='canceled']",
      input_items: 3,
      output_items: 0,
      note: 'Nothing matched out of 3 input items.',
    });
    expect(project('missing', jobs).jmespath.note).toBe('Nothing matched out of 3 input items.');
  });

  it('counts the rows of an object result from its row field', () => {
    const page = { items: jobs, hasMore: true, endCursor: 'abc' };
    const result = project("items[?status=='failed'].id", page);
    expect(result.data).toEqual([2, 3]);
    expect(result.jmespath.input_items).toBe(3);
    expect(result.jmespath.output_items).toBe(2);
  });

  it('keeps a cursor continuation the expression did not select', () => {
    const page = { items: jobs, hasMore: true, endCursor: 'abc' };
    expect(project('items[].id', page).next_page).toEqual({ hasMore: true, endCursor: 'abc' });
    const connection = { nodes: jobs, pageInfo: { hasNextPage: true, endCursor: 'xyz' } };
    expect(project('nodes[].id', connection).next_page).toEqual({
      pageInfo: { hasNextPage: true, endCursor: 'xyz' },
    });
  });

  it('keeps the incompleteness of a partial page and a truncated diff beside the data', () => {
    const partial = { items: jobs, partial: true, message: 'Read the first 1000 rows.' };
    const projected = project('items[].id', partial);
    expect(projected.partial).toBe(true);
    expect(projected.message).toBe('Read the first 1000 rows.');
    const diffs = { changes: [], overflow: true, truncated: false };
    expect(project('changes', diffs)).toMatchObject({ overflow: true, truncated: false });
  });

  it('does not lift an ordinary message field of a complete result', () => {
    const result = project('title', { title: 'x', message: 'commit message' });
    expect(result).not.toHaveProperty('message');
  });

  it('adds nothing beside the data for an array result', () => {
    const result = project('[].id', jobs);
    expect(Object.keys(result).sort()).toEqual(['data', 'jmespath']);
  });

  it('turns an evaluation type error into a projection error', () => {
    expect(() => project('abs(name)', { name: 'x' })).toThrow(/^Invalid jmespath expression:/);
  });
});

describe('expressions shown in the skills', () => {
  it('keeps unarchived projects with the fields the discovery skill names', () => {
    const projects = [
      { path_with_namespace: 'g/a', archived: false, last_activity_at: 't1', id: 1 },
      { path_with_namespace: 'g/b', archived: true, last_activity_at: 't2', id: 2 },
    ];
    expect(
      project('[?!archived].{path: path_with_namespace, activity: last_activity_at}', projects)
        .data,
    ).toEqual([{ path: 'g/a', activity: 't1' }]);
  });

  it('lists the failed jobs the CI skill asks for', () => {
    const rows = jobs.map((job) => ({ ...job, failure_reason: 'script_failure' }));
    expect(
      project(
        "[?status=='failed'].{id: id, name: name, stage: stage, reason: failure_reason}",
        rows,
      ).data,
    ).toEqual([
      { id: 2, name: 'unit', stage: 'test', reason: 'script_failure' },
      { id: 3, name: 'deploy', stage: 'deploy', reason: 'script_failure' },
    ]);
  });

  it('lists only open threads as the review skill shows', () => {
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
      project(
        // `!` binds tighter than indexing: `!notes[0].resolved` would read `(!notes)[0]`.
        '[?notes[0].resolvable && !(notes[0].resolved)].{id: id, file: notes[0].position.new_path, body: notes[0].body}',
        discussions,
      ).data,
    ).toEqual([{ id: 'a', file: 'x.ts', body: 'fix' }]);
  });

  it('finds flaky merge requests with their author as the review skill shows', () => {
    const mrs = [
      { iid: 1, title: 'Fix Flaky spec', author: { username: 'ann' } },
      { iid: 2, title: 'Feature', author: { username: 'bob' } },
    ];
    expect(
      project(
        "[?re_test(title, '(?i)flaky')].{iid: iid, title: title, author: author.username}",
        mrs,
      ).data,
    ).toEqual([{ iid: 1, title: 'Fix Flaky spec', author: 'ann' }]);
  });
});

describe('RE2 functions', () => {
  const titles = [{ title: 'Fix flaky test' }, { title: 'Add feature' }, { title: 'FLAKY retry' }];

  it('re_test filters rows with an RE2 pattern', () => {
    expect(project("[?re_test(title, '(?i)flaky')].title", titles).data).toEqual([
      'Fix flaky test',
      'FLAKY retry',
    ]);
  });

  it('re_find returns the first match or null', () => {
    expect(project("[].re_find(title, '[A-Z]+')", titles).data).toEqual(['F', 'A', 'FLAKY']);
    expect(project("re_find(title, '[0-9]+')", { title: 'none' }).data).toBeNull();
  });

  it('re_replace replaces every match with group references', () => {
    expect(
      project("re_replace(ref, '^refs/heads/(.+)$', 'branch:$1')", { ref: 'refs/heads/main' }).data,
    ).toBe('branch:main');
  });

  it('refuses an invalid pattern with the RE2 contract message', () => {
    expect(() => project("[?re_test(title, '(')]", titles)).toThrow(
      /^Invalid jmespath expression: Invalid RE2 pattern 0:/,
    );
    expect(() => project(`[?re_test(title, '${'a'.repeat(513)}')]`, titles)).toThrow(
      /pattern exceeds 512 characters/,
    );
  });

  it('refuses a non-string argument with a JMESPath type error', () => {
    expect(() => project("[?re_test(id, 'x')]", [{ id: 1 }])).toThrow(
      /re_test\(\) expected argument 1 to be type \(string\)/,
    );
  });

  it('keeps answering correctly once more patterns are used than the cache holds', () => {
    for (let index = 0; index < 80; index++) {
      expect(project(`re_test(name, 'n${index}$')`, { name: `n${index}` }).data).toBe(true);
    }
    expect(project("re_test(name, 'n0$')", { name: 'n0' }).data).toBe(true);
  });
});
