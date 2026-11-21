import {
  LineGrepScanner,
  type LineGrepOptions,
  type LineGrepResult,
} from '../../../../src/entities/pipelines/line-grep';
import {
  MAX_LOG_SECTIONS,
  SectionNotFoundError,
} from '../../../../src/entities/pipelines/log-sections';
import { MAX_LINE_MARKERS } from '../../../../src/entities/pipelines/section-markers';

const ESC = '\x1b';
const start = (stamp: number, name: string, options = '') =>
  `section_start:${stamp}:${name}${options}\r${ESC}[0K`;
const end = (stamp: number, name: string) => `section_end:${stamp}:${name}\r${ESC}[0K`;

const options = (overrides: Partial<LineGrepOptions> = {}): LineGrepOptions => ({
  patterns: [],
  before: 0,
  after: 0,
  maxMatches: 50,
  invert: false,
  startLine: 0,
  normalize: true,
  budgetMs: 60_000,
  outputBytes: 1 << 20,
  ...overrides,
});

/** Feed `source` in chunks and merge streamed hunks with the final report, as the pool does. */
function scan(
  source: string,
  overrides: Partial<LineGrepOptions> = {},
  chunkSize = 7,
): LineGrepResult {
  const scanner = new LineGrepScanner(options(overrides));
  const bytes = new TextEncoder().encode(source);
  const streamed = [];
  for (let offset = 0; offset < bytes.length && !scanner.exhausted; offset += chunkSize) {
    scanner.push(bytes.slice(offset, offset + chunkSize));
    streamed.push(...scanner.progress().hunks);
  }
  const result = scanner.finish();
  return { ...result, hunks: streamed.concat(result.hunks) };
}

const list = (source: string, chunkSize = 7) =>
  scan(source, { listSections: true }, chunkSize).sections;

// A runner log: a runner step, the script step with a custom section nested inside it.
const RUNNER_LOG = [
  `${start(100, 'prepare_executor')}Preparing the docker executor`,
  'Using docker image',
  end(103, 'prepare_executor'),
  `${start(103, 'step_script', '[collapsed=true]')}Executing "step_script" stage`,
  '$ make',
  `${start(104, 'build')}build output`,
  'error: boom',
  end(110, 'build'),
  'error: after build',
  end(120, 'step_script'),
  'error: outside every section',
  'Job failed',
].join('\n');

describe('log section listing', () => {
  // The listing is the map an agent reads before choosing what to search or read.
  it('lists runner and nested custom sections with ranges, depth and duration', () => {
    expect(list(RUNNER_LOG)).toEqual({
      truncated: false,
      unread_from_line: null,
      sections: [
        {
          name: 'prepare_executor',
          occurrence: 0,
          depth: 0,
          start_line: 0,
          end_line: 2,
          line_count: 3,
          duration_seconds: 3,
          collapsed: false,
          terminated: true,
        },
        {
          name: 'step_script',
          occurrence: 0,
          depth: 0,
          start_line: 3,
          end_line: 9,
          line_count: 7,
          duration_seconds: 17,
          collapsed: true,
          terminated: true,
        },
        {
          name: 'build',
          occurrence: 0,
          depth: 1,
          start_line: 5,
          end_line: 7,
          line_count: 3,
          duration_seconds: 6,
          collapsed: false,
          terminated: true,
        },
      ],
    });
  });

  // Markers arrive in arbitrary network chunks; their ranges must not depend on the cut.
  it.each([1, 3, 64, 4096])('gives the same listing in chunks of %i bytes', (chunkSize) => {
    expect(list(RUNNER_LOG, chunkSize)).toEqual(list(RUNNER_LOG));
  });

  it('lists nothing for a log without sections', () => {
    expect(list('one\ntwo\n')).toEqual({ truncated: false, unread_from_line: null, sections: [] });
  });

  // Section identity is the whole name: names sharing a long prefix are separate sections.
  it('tells apart names that differ only after a long common prefix', () => {
    const first = `${'a'.repeat(300)}x`;
    const second = `${'a'.repeat(300)}y`;
    const log = [start(1, first), start(2, second), end(3, first), end(4, second)].join('\n');
    expect(list(log, 4096)?.sections.map((s) => [s.name, s.start_line, s.end_line])).toEqual([
      [first, 0, 2],
      [second, 1, 3],
    ]);
  });

  // A name repeated in one log is told apart by its occurrence, which section_index takes.
  it('numbers repeated names by occurrence', () => {
    const log = [start(1, 'test'), 'a', end(2, 'test'), start(3, 'test'), 'b', end(5, 'test')];
    const sections = list(log.join('\n'))?.sections ?? [];
    expect(sections.map((s) => [s.name, s.occurrence, s.start_line, s.end_line])).toEqual([
      ['test', 0, 0, 2],
      ['test', 1, 3, 5],
    ]);
  });

  // A job that failed inside a section never writes its end marker.
  it('ends a section left open at EOF on the last line, unterminated', () => {
    const [section] = list(`${start(1, 'deploy')}x\ny`)?.sections ?? [];
    expect(section).toMatchObject({
      start_line: 0,
      end_line: 1,
      line_count: 2,
      duration_seconds: null,
      terminated: false,
    });
  });

  // GitLab (Ansi2json::State#open_section) keys open sections by name: a second start of an
  // open name restarts it rather than nesting a second copy.
  it('closes a section restarted under the same name', () => {
    const log = [start(1, 'a'), 'x', start(5, 'a'), end(9, 'a')].join('\n');
    const sections = list(log)?.sections ?? [];
    expect(sections.map((s) => [s.occurrence, s.depth, s.end_line, s.terminated])).toEqual([
      [0, 0, 1, false],
      [1, 0, 3, true],
    ]);
    expect(sections[1].duration_seconds).toBe(4);
  });

  // GitLab compares sanitized names (lowercase, other bytes as '-') and ignores an end of a
  // section that is not open.
  it('closes by sanitized name and ignores ends of sections never opened', () => {
    const log = [start(1, 'Step_Script'), end(2, 'unknown'), end(3, 'step-script')].join('\n');
    expect(list(log)?.sections).toEqual([
      expect.objectContaining({ name: 'Step_Script', end_line: 2, duration_seconds: 2 }),
    ]);
  });

  // GitLab scans an escape before trying a marker after it: '\e[s' is a sequence ending at
  // the 's', so what follows is text, not a section.
  it('does not read a marker inside an escape sequence', () => {
    expect(list(`${ESC}[${start(1, 'hidden')}text`)?.sections).toEqual([]);
  });

  // Runner timestamps split long output into fragments that GitLab joins before parsing, so a
  // marker cut by the split still counts, on the physical line where it starts.
  it('finds markers split across or starting in a continuation fragment', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const log = [
      `${stamp} 00O section_st`,
      `${stamp} 00O+art:1:split\r${ESC}[0Kheader`,
      `${stamp} 00O before `,
      `${stamp} 00O+${start(2, 'mid')}x`,
      `${stamp} 00O ${end(3, 'mid')}`,
      `${stamp} 00O ${end(4, 'split')}`,
    ].join('\n');
    expect(list(log)?.sections.map((s) => [s.name, s.depth, s.start_line, s.end_line])).toEqual([
      ['split', 0, 0, 5],
      ['mid', 1, 3, 4],
    ]);
  });

  // GitLab applies markers wherever they are on a line; the scan keeps only 16 KiB of each
  // line, and markers past that must still close and open sections.
  describe('markers past the 16 KiB a line keeps', () => {
    const LONG = 'a'.repeat(17_000);

    it.each([7, 4096, 65_536])('reads an end marker in the dropped tail (chunks of %i)', (size) => {
      const log = [`${start(1, 's')}x`, `${LONG}${end(2, 's')}`, 'after'].join('\n');
      expect(list(log, size)).toMatchObject({
        unread_from_line: null,
        sections: [{ name: 's', start_line: 0, end_line: 1, terminated: true }],
      });
    });

    it.each([7, 4096])('reads a marker cut by the 16 KiB limit (chunks of %i)', (size) => {
      const log = [`${start(1, 's')}x`, `${'a'.repeat(16_384 - 5)}${end(2, 's')}`, 'after'];
      expect(list(log.join('\n'), size)?.sections).toEqual([
        expect.objectContaining({ end_line: 1, terminated: true }),
      ]);
    });

    // The tail's markers come after the kept part's: a start then an end on one line.
    it('applies kept and dropped markers of one line in order', () => {
      const log = [`${start(2, 't')}${LONG}${end(5, 't')}`, 'after'].join('\n');
      expect(list(log)?.sections).toEqual([
        expect.objectContaining({ name: 't', start_line: 0, end_line: 0, duration_seconds: 3 }),
      ]);
    });

    // An escape cut by the limit still swallows the marker's 's', as GitLab's view does.
    it('does not read a marker an escape cut by the limit swallows', () => {
      const log = `${'a'.repeat(16_382)}${ESC}[${start(1, 'hidden')}text`;
      expect(list(log, 4096)?.sections).toEqual([]);
    });

    // A marker longer than the scan can hold is reported, never silently skipped.
    it('reports markers it cannot read instead of trusting later bounds', () => {
      const huge = 'n'.repeat(20_000);
      const log = [`${start(1, 's')}x`, `${LONG}${end(2, huge)}`, 'error after'].join('\n');
      expect(list(log, 4096)?.unread_from_line).toBe(1);
      expect(() =>
        scan(log, { patterns: ['error'], section: { name: 's', index: 0 } }, 4096),
      ).toThrow(
        "Section 's' cannot be located: line 1 holds section markers the scan could not read",
      );
    });

    // A long line ending in text that only looks like the start of a marker ends there: a real
    // line boundary means no marker, so nothing is unread.
    it.each(['s', 'sect', 'section_end:2:'])(
      'drops a cut-off marker prefix %p at a real line end',
      (suffix) => {
        const log = [`${start(1, 's')}x`, `${LONG}${suffix}`, 'error inside', end(3, 's')];
        expect(list(log.join('\n'), 4096)).toMatchObject({
          unread_from_line: null,
          sections: [{ name: 's', end_line: 3, terminated: true }],
        });
        const result = scan(
          log.join('\n'),
          { patterns: ['error'], section: { name: 's', index: 0 } },
          4096,
        );
        expect(result.match_count).toBe(1);
      },
    );

    // A marker cut by the end of a clipped fragment continues in the next fragment GitLab joins.
    it.each([7, 4096, 65_536])(
      'completes a cut-off tail marker in the continuation (chunks of %i)',
      (size) => {
        const stamp = '2026-11-18T10:00:00.123456Z';
        const log = [
          `${stamp} 00O ${start(1, 'a')}x`,
          `${stamp} 00O ${LONG}section_e`,
          `${stamp} 00O+nd:2:a\r${ESC}[0Kafter`,
          `${stamp} 00O later`,
        ].join('\n');
        expect(list(log, size)).toMatchObject({
          unread_from_line: null,
          sections: [{ name: 'a', start_line: 0, end_line: 1, terminated: true }],
        });
      },
    );

    // In a joined timestamped line, a clipped fragment's tail lies before the next fragment:
    // its end marker closes the section before the next fragment restarts it.
    it('applies a fragment tail before the markers of the next fragment', () => {
      const stamp = '2026-11-18T10:00:00.123456Z';
      const log = [
        `${stamp} 00O ${start(1, 'a')}${LONG}${end(2, 'a')}`,
        `${stamp} 00O+${start(3, 'a')}x`,
        `${stamp} 00O tail`,
      ].join('\n');
      expect(
        list(log, 4096)?.sections.map((s) => [s.start_line, s.end_line, s.terminated]),
      ).toEqual([
        [0, 0, true],
        [1, 2, false],
      ]);
    });

    // Escape state carries across chunk boundaries inside a dropped tail.
    it.each([1, 3])('tokenizes escapes split by chunks in a tail (chunks of %i)', (size) => {
      const log = [
        `${start(1, 'a')}${start(1, 'b')}x`,
        `${LONG}${ESC}[${end(2, 'a')}${ESC}1${end(3, 'b')}`,
      ].join('\n');
      // '\e[' swallows the 's' of the first marker; an ESC before '1' starts no sequence.
      expect(list(log, size)?.sections.map((s) => [s.name, s.terminated])).toEqual([
        ['a', false],
        ['b', true],
      ]);
    });

    // A held "section_" that turns out to be no marker is text, and what follows is scanned.
    it('rescans after a cut-off candidate that is no marker', () => {
      const log = [`${start(1, 's')}x`, `${LONG}section_bogus ${end(2, 's')}`].join('\n');
      expect(list(log, 7)?.sections).toEqual([
        expect.objectContaining({ end_line: 1, terminated: true }),
      ]);
    });

    it('reads options of a start marker in a tail', () => {
      const log = `${LONG}${start(1, 't', '[collapsed=true]')}x`;
      expect(list(log, 4096)?.sections).toEqual([
        expect.objectContaining({ name: 't', collapsed: true }),
      ]);
    });

    // The markers queued for one logical line are bounded; the overflow is reported.
    it('reports a line with more markers than one line may queue', () => {
      const many = Array.from({ length: MAX_LINE_MARKERS + 1 }, (_, i) => end(i, `m${i}`));
      expect(list(`x\n${LONG}${many.join('')}`, 65_536)?.unread_from_line).toBe(1);
    });

    // The bound counts each logical line on its own: the markers of the line before do not
    // use up the next line's allowance.
    it('gives each line its own marker allowance', () => {
      const half = (line: number) =>
        Array.from({ length: MAX_LINE_MARKERS - 10 }, (_, i) => end(i, `l${line}m${i}`)).join('');
      const log = [`${start(1, 's')}x`, `${LONG}${half(1)}`, `${LONG}${half(2)}${end(9, 's')}`];
      expect(list(log.join('\n'), 65_536)).toMatchObject({
        unread_from_line: null,
        sections: [{ name: 's', end_line: 2, terminated: true }],
      });
    });

    // Raw scans find markers without reading escapes, on both sides of the 16 KiB limit.
    it('finds a raw marker after an escape in the dropped tail', () => {
      const log = [start(1, 's'), `${LONG}${ESC}[${end(2, 's')}`, 'error after'].join('\n');
      const result = scan(
        log,
        { patterns: ['error'], normalize: false, section: { name: 's', index: 0 } },
        4096,
      );
      expect(result.match_count).toBe(0);
      expect(result.section).toMatchObject({ end_line: 1, terminated: true });
    });

    const stamp = '2026-11-18T10:00:00.123456Z';

    // A marker begun in an unclipped fragment and finished past the next fragment's limit is
    // one marker, as GitLab joins the fragments before reading it.
    it('reads a marker that crosses a join and then a clip', () => {
      const name = 'n'.repeat(16_384 - 32);
      const log = [
        `${stamp} 00O ${start(1, name)}x`,
        `${stamp} 00O section_end:2:`,
        `${stamp} 00O+${name}\r${ESC}[0K`,
        `${stamp} 00O after`,
      ].join('\n');
      expect(list(log, 4096)).toMatchObject({
        unread_from_line: null,
        sections: [{ start_line: 0, end_line: 1, terminated: true }],
      });
    });

    // The CR inside a marker finished in a continuation is part of the marker: it does not
    // clear the text before it.
    it('keeps text a marker across a clip and a join would otherwise clear', () => {
      const log = [
        `${stamp} 00O ${start(1, 's')}x`,
        `${stamp} 00O needle ${'a'.repeat(17_000)}section_e`,
        `${stamp} 00O+nd:2:s\r${ESC}[0Ktail`,
        `${stamp} 00O later`,
      ].join('\n');
      const result = scan(log, { patterns: ['needle'], section: { name: 's', index: 0 } }, 4096);
      expect(result.hunks.map((hunk) => hunk.matches.map((match) => match.line))).toEqual([[1]]);
      expect(result.section).toMatchObject({ end_line: 1, terminated: true });
    });

    // A rejected candidate is read again from its second byte, also across a join.
    it('finds a marker inside a rejected candidate that continues in the next fragment', () => {
      const log = [
        `${stamp} 00O ${start(1, 's')}x`,
        `${stamp} 00O ${LONG}section_start:1:section_e`,
        `${stamp} 00O+nd:2:s\r${ESC}[0K`,
        `${stamp} 00O later`,
      ].join('\n');
      expect(list(log, 4096)).toMatchObject({
        unread_from_line: null,
        sections: [{ name: 's', end_line: 1, terminated: true }],
      });
    });
  });

  it('reads collapsed only from its own option', () => {
    const log = [start(1, 'a', '[hidden=true]'), start(2, 'b', '[x=1, collapsed=false]')];
    expect(list(log.join('\n'))?.sections.map((s) => s.collapsed)).toEqual([false, false]);
  });

  // The listing stays bounded however many sections a log opens.
  it('lists at most the first sections and flags the rest', () => {
    const log = Array.from({ length: MAX_LOG_SECTIONS + 1 }, (_, i) => start(i, `s${i}`)).join(
      '\n',
    );
    const listing = list(log, 4096);
    expect(listing?.sections).toHaveLength(MAX_LOG_SECTIONS);
    expect(listing?.truncated).toBe(true);
  });
});

describe('log search within a section', () => {
  // Matches, before- and after-context all stay inside the section; numbers stay absolute.
  it('reports only lines of the section with absolute numbers', () => {
    const result = scan(RUNNER_LOG, {
      patterns: ['error'],
      before: 5,
      after: 5,
      section: { name: 'step_script', index: 0 },
    });
    expect(result.hunks).toEqual([
      {
        start_line: 3,
        lines: [
          'Executing "step_script" stage',
          '$ make',
          'build output',
          'error: boom',
          '',
          'error: after build',
          '',
        ],
        matches: [
          { line: 6, patterns: [0] },
          { line: 8, patterns: [0] },
        ],
      },
    ]);
    expect(result).toMatchObject({
      match_count: 2,
      match_count_complete: true,
      total_lines: null,
      truncated: null,
      resume_from: null,
      section: {
        name: 'step_script',
        index: 0,
        start_line: 3,
        end_line: 9,
        line_count: 7,
        terminated: true,
      },
    });
  });

  // Once the section has ended nothing later can be reported, so the trace is not read on.
  it('stops reading at the end of the section', () => {
    const tail = Array.from({ length: 1000 }, () => 'error: later').join('\n');
    const result = scan(`${RUNNER_LOG}\n${tail}`, {
      patterns: ['error'],
      section: { name: 'build', index: 0 },
    });
    expect(result.match_count).toBe(1);
    expect(result.scanned_lines).toBeLessThan(20);
  });

  it('searches the occurrence chosen by its index', () => {
    const log = [start(1, 't'), 'error one', end(2, 't'), start(3, 't'), 'error two', end(4, 't')];
    const result = scan(log.join('\n'), {
      patterns: ['error'],
      section: { name: 't', index: 1 },
    });
    expect(result.hunks.map((hunk) => hunk.lines)).toEqual([['error two']]);
    expect(result.section).toMatchObject({ index: 1, start_line: 3, end_line: 5 });
  });

  // A resumed search starts past the section's first line; the section is still known.
  it('continues from a start line inside the section', () => {
    const result = scan(RUNNER_LOG, {
      patterns: ['error'],
      startLine: 7,
      section: { name: 'step_script', index: 0 },
    });
    expect(result.hunks.flatMap((hunk) => hunk.matches.map((match) => match.line))).toEqual([8]);
  });

  // raw:true keeps the stored bytes; markers are still found line by line.
  it('limits a raw search to the section as well', () => {
    const result = scan(RUNNER_LOG, {
      patterns: ['error'],
      normalize: false,
      section: { name: 'step_script', index: 0 },
    });
    expect(result.hunks.flatMap((hunk) => hunk.matches.map((match) => match.line))).toEqual([6, 8]);
  });

  // A timestamped logical line can cross a section boundary; only the fragments inside the
  // section are searched, and a match is reported on the first of them.
  describe('a logical line crossing the section boundary', () => {
    const stamp = '2026-11-18T10:00:00.123456Z';
    const opening = [
      `${stamp} 00O error outside `,
      `${stamp} 00O+${start(1, 's')}error inside`,
      `${stamp} 00O ${end(2, 's')}`,
    ].join('\n');

    it('finds a match in a section that starts in a continuation', () => {
      const result = scan(opening, { patterns: ['inside'], section: { name: 's', index: 0 } });
      expect(result.hunks).toEqual([
        {
          start_line: 1,
          lines: ['error inside'],
          matches: [{ line: 1, patterns: [0] }],
          timestamps: [stamp],
        },
      ]);
    });

    // A page starting at the section's first line owns the match on it, though the logical
    // line began on an earlier page.
    it('matches on the section start when the search starts there', () => {
      const result = scan(opening, {
        patterns: ['inside'],
        startLine: 1,
        section: { name: 's', index: 0 },
      });
      expect(result.hunks.map((hunk) => hunk.matches.map((match) => match.line))).toEqual([[1]]);
      expect(result.match_count_complete).toBe(true);
    });

    it('does not match the fragment before the section start', () => {
      const result = scan(opening, { patterns: ['outside'], section: { name: 's', index: 0 } });
      expect(result.match_count).toBe(0);
    });

    it('does not match a continuation after the section end', () => {
      const log = [
        `${stamp} 00O ${start(1, 's')}in`,
        `${stamp} 00O ${end(2, 's')}`,
        `${stamp} 00O+error after`,
      ].join('\n');
      const result = scan(log, { patterns: ['error'], section: { name: 's', index: 0 } });
      expect(result.match_count).toBe(0);
      expect(result.section).toMatchObject({ start_line: 0, end_line: 1 });
    });
  });

  // A restart of the searched name ends it on the line before, like any restarted section.
  it('ends a searched section where its name restarts', () => {
    const log = [start(1, 'a'), 'error one', start(5, 'a'), 'error two', end(9, 'a')];
    const result = scan(log.join('\n'), { patterns: ['error'], section: { name: 'a', index: 0 } });
    expect(result.hunks.map((hunk) => hunk.lines)).toEqual([['error one']]);
    expect(result.section).toMatchObject({ start_line: 0, end_line: 1, terminated: false });
  });

  // A section left open at EOF lasts to the last line.
  it('searches an unterminated section to the end of the log', () => {
    const result = scan(`${start(1, 'deploy')}x\nerror: crash`, {
      patterns: ['error'],
      section: { name: 'deploy', index: 0 },
    });
    expect(result.match_count).toBe(1);
    expect(result.section).toMatchObject({ end_line: 1, terminated: false });
  });

  // An unknown name must not look like a clean search with no matches.
  it('names the available sections when the log lacks the requested one', () => {
    expect(() =>
      scan(RUNNER_LOG, { patterns: ['x'], section: { name: 'step_scripts', index: 0 } }),
    ).toThrow(
      new SectionNotFoundError(
        "Section 'step_scripts' not found; sections: prepare_executor, step_script, build",
      ),
    );
  });

  it('explains an index past the last occurrence', () => {
    expect(() =>
      scan(RUNNER_LOG, { patterns: ['x'], section: { name: 'build', index: 1 } }),
    ).toThrow("Section 'build' occurs 1 time(s); section_index counts from 0");
  });

  it('says when the log has no sections at all', () => {
    expect(() => scan('plain\n', { patterns: ['x'], section: { name: 'a', index: 0 } })).toThrow(
      "Section 'a' not found: the log has no sections",
    );
  });

  // A budget stop before the section is reached leaves its existence open: no error, resumable.
  it('does not call a section missing when the budget stopped the scan first', () => {
    const lead = Array.from({ length: 600 }, () => 'plain').join('\n');
    const result = scan(`${lead}\n${start(1, 'late')}error`, {
      patterns: ['error'],
      budgetMs: 0,
      section: { name: 'late', index: 0 },
    });
    expect(result).toMatchObject({ truncated: 'budget', section: null, match_count: 0 });
    expect(result.resume_from).not.toBeNull();
  });
});
