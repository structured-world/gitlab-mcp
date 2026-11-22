import { diffLineFilter, searchDiffLines, type DiffFile } from '../../../src/entities/diff-lines';

const filter = (overrides: Parameters<typeof diffLineFilter>[0] = {}) =>
  diffLineFilter({ line_patterns: ['console\\.log'], ...overrides })!;

const file = (diff: string, extra: Partial<DiffFile> = {}): DiffFile => ({
  diff,
  old_path: 'src/app.ts',
  new_path: 'src/app.ts',
  new_file: false,
  renamed_file: false,
  deleted_file: false,
  ...extra,
});

// One hunk: two context lines, a removed and two added lines, then context.
const HUNK = [
  '@@ -10,4 +10,5 @@ function run() {',
  ' const a = 1;',
  ' const b = 2;',
  '-console.log(a);',
  '+console.log(a, b);',
  '+debug(b);',
  ' return a;',
  '',
].join('\n');

describe('searchDiffLines', () => {
  // The default side is added; numbers are those a positioned MR comment takes: only
  // new_line for an added line, both for context.
  it('returns an added match with its new line number and context', () => {
    const result = searchDiffLines([file(HUNK)], filter());
    expect(result.files).toEqual([
      {
        old_path: 'src/app.ts',
        new_path: 'src/app.ts',
        new_file: false,
        renamed_file: false,
        deleted_file: false,
        matches: [
          {
            side: 'added',
            old_line: null,
            new_line: 12,
            text: 'console.log(a, b);',
            patterns: [0],
            context: {
              before: [{ type: 'removed', old_line: 12, new_line: null, text: 'console.log(a);' }],
              after: [{ type: 'added', old_line: null, new_line: 13, text: 'debug(b);' }],
            },
          },
        ],
      },
    ]);
    expect(result.summary).toEqual({
      line_patterns: ['console\\.log'],
      side: 'added',
      files_scanned: 1,
      files_matched: 1,
      match_count: 1,
      truncated: false,
    });
  });

  // A removed line carries only old_line, the number GitLab positions it by.
  it('matches removed lines with side removed', () => {
    const result = searchDiffLines([file(HUNK)], filter({ side: 'removed', context: 0 }));
    expect(result.files[0].matches).toEqual([
      {
        side: 'removed',
        old_line: 12,
        new_line: null,
        text: 'console.log(a);',
        patterns: [0],
        context: { before: [], after: [] },
      },
    ]);
  });

  it('matches both sides with side any, in diff order', () => {
    const result = searchDiffLines([file(HUNK)], filter({ side: 'any', context: 0 }));
    expect(result.files[0].matches.map((m) => [m.side, m.old_line, m.new_line])).toEqual([
      ['removed', 12, null],
      ['added', null, 12],
    ]);
  });

  // Unchanged lines are context, never matches, whatever the side.
  it('never matches an unchanged line', () => {
    const result = searchDiffLines(
      [file(HUNK)],
      filter({ line_patterns: ['const b'], side: 'any' }),
    );
    expect(result.summary.match_count).toBe(0);
    expect(result.files).toEqual([]);
  });

  // Each hunk restarts its numbers from its header, and context stops at the hunk edge.
  it('numbers lines per hunk and keeps context inside the hunk', () => {
    const diff = [
      '@@ -1,1 +1,2 @@',
      ' keep',
      '+TODO first',
      '@@ -40,2 +41,2 @@',
      '+TODO second',
      ' tail',
      '',
    ].join('\n');
    const result = searchDiffLines([file(diff)], filter({ line_patterns: ['TODO'], context: 5 }));
    const [first, second] = result.files[0].matches;
    expect(first).toMatchObject({ new_line: 2, context: { after: [] } });
    expect(first.context.before).toEqual([
      { type: 'unchanged', old_line: 1, new_line: 1, text: 'keep' },
    ]);
    expect(second).toMatchObject({ new_line: 41, context: { before: [] } });
    expect(second.context.after).toEqual([
      { type: 'unchanged', old_line: 40, new_line: 42, text: 'tail' },
    ]);
  });

  // A hunk line never starts with @, so a header opens its hunk even when the previous
  // header announced more lines than came.
  it('starts a new hunk at a header that comes early', () => {
    const diff = ['@@ -1,5 +1,5 @@', '+TODO a', '@@ -30,1 +30,1 @@', '+TODO b', ''].join('\n');
    const result = searchDiffLines([file(diff)], filter({ line_patterns: ['TODO'], context: 0 }));
    expect(result.files[0].matches.map((m) => m.new_line)).toEqual([1, 30]);
  });

  // The line table starts at 256 rows and grows; rows written before growing keep their
  // numbers and text, and later rows land after them.
  it('keeps every line of a diff longer than the initial table', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `+line ${i + 1}`);
    const diff = `@@ -0,0 +1,300 @@\n${lines.join('\n')}\n`;
    const result = searchDiffLines(
      [file(diff)],
      filter({ line_patterns: ['^line (1|256|257|300)$'], context: 1 }),
    );
    expect(result.files[0].matches.map((m) => [m.new_line, m.text])).toEqual([
      [1, 'line 1'],
      [256, 'line 256'],
      [257, 'line 257'],
      [300, 'line 300'],
    ]);
    expect(result.files[0].matches[1].context.after).toEqual([
      { type: 'added', old_line: null, new_line: 257, text: 'line 257' },
    ]);
  });

  // A count of one may be left out of a header (`@@ -5 +5 @@`).
  it('reads a header without counts as one line per side', () => {
    const result = searchDiffLines(
      [file('@@ -5 +5 @@\n-TODO old\n+TODO new\n+TODO past the hunk\n')],
      filter({ line_patterns: ['TODO'], side: 'any', context: 0 }),
    );
    expect(result.files[0].matches.map((m) => [m.side, m.old_line, m.new_line])).toEqual([
      ['removed', 5, null],
      ['added', null, 5],
    ]);
  });

  // Some tools strip the space of a blank context line; it is still context and still counts.
  it('treats an empty line inside a hunk as context', () => {
    const result = searchDiffLines(
      [file('@@ -1,2 +1,3 @@\n a\n\n+TODO\n')],
      filter({ line_patterns: ['TODO'], context: 1 }),
    );
    expect(result.files[0].matches[0]).toMatchObject({
      new_line: 3,
      context: { before: [{ type: 'unchanged', old_line: 2, new_line: 2, text: '' }] },
    });
  });

  // Only a well-formed header opens a hunk; other text before the first one is not a line.
  it('ignores an @@ line that is not a hunk header', () => {
    const result = searchDiffLines(
      [file('@@ not a header\n+TODO outside\n@@ -0,0 +1,1 @@\n+TODO inside\n')],
      filter({ line_patterns: ['TODO'], context: 0 }),
    );
    expect(result.files[0].matches.map((m) => m.text)).toEqual(['TODO inside']);
  });

  // GitLab's diff text may end without a newline; its last line is still read.
  it('reads a last line without a trailing newline', () => {
    const result = searchDiffLines(
      [file('@@ -0,0 +1,1 @@\n+TODO last')],
      filter({ line_patterns: ['TODO'] }),
    );
    expect(result.files[0].matches[0]).toMatchObject({ new_line: 1, text: 'TODO last' });
  });

  // A context line past one side's count consumes only the other side, never a negative count.
  it('keeps counting a hunk whose context outruns one side', () => {
    const result = searchDiffLines(
      [file('@@ -1,0 +1,2 @@\n ctx\n+TODO\n')],
      filter({ line_patterns: ['TODO'], context: 0 }),
    );
    expect(result.files[0].matches[0]).toMatchObject({ new_line: 2 });
  });

  // An entry missing its fields is reported, not thrown on.
  it('lists an entry without diff text or paths as not scanned', () => {
    const result = searchDiffLines([{ diff: null, old_path: 1 }], filter());
    expect(result.not_scanned).toEqual([{ old_path: '', new_path: '', reason: 'empty_diff' }]);
  });

  // The marker is not a line: it neither matches nor shifts the numbers after it.
  it('skips the no-newline marker', () => {
    const diff = [
      '@@ -1,1 +1,2 @@',
      '-old end',
      '\\ No newline at end of file',
      '+new end',
      '+No newline here too',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const result = searchDiffLines(
      [file(diff)],
      filter({ line_patterns: ['[Nn]o newline'], context: 0 }),
    );
    expect(result.files[0].matches).toEqual([
      expect.objectContaining({ text: 'No newline here too', new_line: 2 }),
    ]);
  });

  // Headers added by unidiff precede the first hunk; inside a hunk the header counts decide,
  // so removed text starting with dashes is still a removed line.
  it('skips file headers and keeps dash lines inside a hunk', () => {
    const diff = [
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -3,1 +3,1 @@',
      '--- marker',
      '++++ marker',
      '',
    ].join('\n');
    const result = searchDiffLines(
      [file(diff)],
      filter({ line_patterns: ['marker|app'], side: 'any', context: 0 }),
    );
    expect(result.files[0].matches.map((m) => [m.side, m.text, m.old_line, m.new_line])).toEqual([
      ['removed', '-- marker', 3, null],
      ['added', '+++ marker', null, 3],
    ]);
  });

  // Renamed and deleted files keep their paths and flags; a deleted file has only removed lines.
  it('reports renamed and deleted files with their flags', () => {
    const renamed = file('@@ -1,1 +1,1 @@\n-console.log(1)\n+console.log(2)\n', {
      old_path: 'old.ts',
      new_path: 'new.ts',
      renamed_file: true,
    });
    const deleted = file('@@ -1,2 +0,0 @@\n-console.log(3)\n-x\n', {
      old_path: 'gone.ts',
      new_path: 'gone.ts',
      deleted_file: true,
    });
    const result = searchDiffLines([renamed, deleted], filter({ side: 'any', context: 0 }));
    expect(
      result.files.map((f) => [f.old_path, f.new_path, f.renamed_file, f.deleted_file]),
    ).toEqual([
      ['old.ts', 'new.ts', true, false],
      ['gone.ts', 'gone.ts', false, true],
    ]);
    expect(result.files[1].matches).toEqual([
      expect.objectContaining({ side: 'removed', old_line: 1 }),
    ]);
  });

  // A file without searchable text is listed with the reason, never dropped silently.
  it.each([
    ['collapsed', file('', { collapsed: true, too_large: false }), 'collapsed'],
    ['too large', file('', { collapsed: false, too_large: true }), 'too_large'],
    ['empty without the 18.4 flags', file(''), 'empty_diff'],
    ['binary', file('Binary files a/x.png and b/x.png differ\n'), 'binary'],
  ])('lists a %s file as not scanned', (_name, entry, reason) => {
    const result = searchDiffLines([entry], filter());
    expect(result.not_scanned).toEqual([
      { old_path: 'src/app.ts', new_path: 'src/app.ts', reason },
    ]);
    expect(result.summary.files_scanned).toBe(0);
  });

  // With the flags present and false, an empty diff is a change without text lines.
  it('scans an empty diff that the flags say is complete', () => {
    const result = searchDiffLines([file('', { collapsed: false, too_large: false })], filter());
    expect(result.not_scanned).toEqual([]);
    expect(result.summary.files_scanned).toBe(1);
  });

  // Every match is counted; only max_matches are returned, and files_matched includes files
  // whose matches fell past the limit.
  it('counts matches past max_matches and reports truncation', () => {
    const many = '@@ -0,0 +1,3 @@\n+console.log(1)\n+console.log(2)\n+console.log(3)\n';
    const result = searchDiffLines(
      [file(many), file(many, { new_path: 'b.ts', old_path: 'b.ts' })],
      filter({ max_matches: 2, context: 0 }),
    );
    expect(result.files).toHaveLength(1);
    expect(result.files[0].matches).toHaveLength(2);
    expect(result.summary).toMatchObject({ match_count: 6, files_matched: 2, truncated: true });
  });

  it('reports which patterns a line matched', () => {
    const result = searchDiffLines(
      [file(HUNK)],
      filter({ line_patterns: ['debug', 'b\\)'], context: 0 }),
    );
    expect(result.files[0].matches.map((m) => [m.text, m.patterns])).toEqual([
      ['console.log(a, b);', [1]],
      ['debug(b);', [0, 1]],
    ]);
  });

  // Matching runs on UTF-8 bytes; returned text and later numbers stay intact.
  it('handles multibyte text', () => {
    const euro = String.fromCodePoint(0x20ac);
    const diff = `@@ -0,0 +1,2 @@\n+price ${euro}5\n+TODO ${euro}\n`;
    const result = searchDiffLines(
      [file(diff)],
      filter({ line_patterns: [`TODO ${euro}`], context: 1 }),
    );
    expect(result.files[0].matches[0]).toMatchObject({
      new_line: 2,
      text: `TODO ${euro}`,
      context: { before: [{ text: `price ${euro}5` }] },
    });
  });
});

describe('diffLineFilter', () => {
  it('returns null for a plain diff read', () => {
    expect(diffLineFilter({})).toBeNull();
  });

  it('applies the defaults', () => {
    expect(filter()).toMatchObject({ side: 'added', context: 1, maxMatches: 200 });
  });

  // Options that only shape a line search would be ignored without patterns.
  it.each([
    ['side', { side: 'any' as const }],
    ['context', { context: 2 }],
    ['max_matches', { max_matches: 5 }],
  ])('refuses %s without line_patterns', (name, input) => {
    expect(() => diffLineFilter(input)).toThrow(`'${name}' needs line_patterns`);
  });

  it('reports an invalid pattern with its index', () => {
    expect(() => diffLineFilter({ line_patterns: ['ok', '(unclosed'] })).toThrow(
      'Invalid RE2 pattern 1',
    );
  });
});
