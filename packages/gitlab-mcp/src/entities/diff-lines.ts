import { z } from 'zod';
import { compilePatterns, type PatternMatcher } from '../utils/re2-compile';
import { DIFF_DEFAULT_CONTEXT, DIFF_DEFAULT_MATCHES } from './line-patterns';

export type DiffSide = 'added' | 'removed' | 'any';
type LineType = 'added' | 'removed' | 'unchanged';

/**
 * A file entry of GitLab's diff responses (API::Entities::Diff). `collapsed` and
 * `too_large` exist from GitLab 18.4; their presence tells why an empty diff is empty.
 */
const DiffFileSchema = z.looseObject({
  diff: z.string(),
  old_path: z.string(),
  new_path: z.string(),
  new_file: z.boolean().optional(),
  renamed_file: z.boolean().optional(),
  deleted_file: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  too_large: z.boolean().optional(),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;
const DiffFilesSchema = z.array(DiffFileSchema);

/** The file entries of a GitLab diff response, refused when they are not that shape. */
export function parseDiffFiles(value: unknown): DiffFile[] {
  const parsed = DiffFilesSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `GitLab API error: unexpected diff response (${issue.path.join('.') || 'body'}: ${issue.message})`,
    );
  }
  return parsed.data;
}

/** One diff line with the numbers a positioned MR comment takes: old_line, new_line or both. */
export interface DiffLine {
  type: LineType;
  old_line: number | null;
  new_line: number | null;
  text: string;
}

export interface DiffLineMatch {
  side: 'added' | 'removed';
  old_line: number | null;
  new_line: number | null;
  text: string;
  /** Indexes of the line_patterns the line matched. */
  patterns: readonly number[];
  context: { before: DiffLine[]; after: DiffLine[] };
}

export interface DiffFileMatches {
  old_path: string;
  new_path: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  matches: DiffLineMatch[];
}

/**
 * Why a file's lines could not be searched: GitLab sent no diff text for it (`collapsed`,
 * `too_large`, or `empty_diff` from an instance that does not say which), or it is binary.
 */
export type NotScannedReason = 'collapsed' | 'too_large' | 'empty_diff' | 'binary';

export interface DiffLineSearch {
  files: DiffFileMatches[];
  not_scanned: Array<{ old_path: string; new_path: string; reason: NotScannedReason }>;
  summary: {
    line_patterns: readonly string[];
    side: DiffSide;
    files_scanned: number;
    files_matched: number;
    match_count: number;
    truncated: boolean;
  };
}

export interface DiffLineFilter {
  patterns: readonly string[];
  matcher: PatternMatcher;
  side: DiffSide;
  context: number;
  maxMatches: number;
}

interface DiffLineFilterInput {
  line_patterns?: readonly string[];
  side?: DiffSide;
  context?: number;
  max_matches?: number;
}

/**
 * The line search a diff request asks for, or null for a plain diff read. Options that only
 * shape a line search are refused without patterns, since they would be silently ignored.
 */
export function diffLineFilter(input: DiffLineFilterInput): DiffLineFilter | null {
  const { line_patterns, side, context, max_matches } = input;
  if (line_patterns === undefined) {
    const orphan = [
      ['side', side],
      ['context', context],
      ['max_matches', max_matches],
    ].find(([, value]) => value !== undefined);
    if (orphan) throw new Error(`'${String(orphan[0])}' needs line_patterns`);
    return null;
  }
  return {
    patterns: line_patterns,
    matcher: compilePatterns(line_patterns),
    side: side ?? 'added',
    context: context ?? DIFF_DEFAULT_CONTEXT,
    maxMatches: max_matches ?? DIFF_DEFAULT_MATCHES,
  };
}

const ADDED = 1;
const REMOVED = 2;
const UNCHANGED = 3;
const TYPE_NAMES: readonly LineType[] = ['unchanged', 'added', 'removed', 'unchanged'];
const NEWLINE = 0x0a;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * The changed and context lines of one file's hunks, as byte ranges into its diff. Columns
 * are typed arrays reused across files, so a parse allocates nothing per line.
 */
class LineTable {
  size = 0;
  type = new Uint8Array(256);
  hunk = new Int32Array(256);
  oldLine = new Int32Array(256);
  newLine = new Int32Array(256);
  start = new Int32Array(256);
  end = new Int32Array(256);

  push(
    type: number,
    hunk: number,
    oldLine: number,
    newLine: number,
    start: number,
    end: number,
  ): void {
    if (this.size === this.type.length) this.grow();
    const i = this.size++;
    this.type[i] = type;
    this.hunk[i] = hunk;
    this.oldLine[i] = oldLine;
    this.newLine[i] = newLine;
    this.start[i] = start;
    this.end[i] = end;
  }

  private grow(): void {
    const size = this.type.length * 2;
    const copy = <T extends Uint8Array | Int32Array>(from: T, to: T): T => {
      to.set(from);
      return to;
    };
    this.type = copy(this.type, new Uint8Array(size));
    this.hunk = copy(this.hunk, new Int32Array(size));
    this.oldLine = copy(this.oldLine, new Int32Array(size));
    this.newLine = copy(this.newLine, new Int32Array(size));
    this.start = copy(this.start, new Int32Array(size));
    this.end = copy(this.end, new Int32Array(size));
  }
}

/**
 * Reads the hunks of one file's unified diff into `table`. File headers (`---`/`+++`, as
 * `unidiff` adds) precede the first hunk and are skipped; inside a hunk the header counts
 * say where it ends, so a removed line reading `--- x` stays a line. `\ No newline at end
 * of file` is a marker, not a line.
 */
function parseHunks(bytes: Buffer, table: LineTable): void {
  table.size = 0;
  let hunk = -1;
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let offset = 0;
  while (offset < bytes.length) {
    let end = bytes.indexOf(NEWLINE, offset);
    if (end === -1) end = bytes.length;
    const start = offset;
    offset = end + 1;
    // No hunk line starts with @: one that does opens the next hunk, whatever the counts say.
    if (bytes[start] === 0x40 && bytes[start + 1] === 0x40) {
      const header = HUNK_HEADER.exec(bytes.toString('utf8', start, Math.min(end, start + 120)));
      if (header !== null) {
        hunk++;
        oldLine = Number(header[1]);
        oldLeft = header[2] === undefined ? 1 : Number(header[2]);
        newLine = Number(header[3]);
        newLeft = header[4] === undefined ? 1 : Number(header[4]);
        continue;
      }
    }
    if (oldLeft === 0 && newLeft === 0) continue;
    const marker = bytes[start];
    if (marker === 0x5c) continue;
    // A context line keeps its leading space; one stripped down to nothing is still context.
    if (marker === 0x2b && newLeft > 0) {
      table.push(ADDED, hunk, 0, newLine++, start + 1, end);
      newLeft--;
    } else if (marker === 0x2d && oldLeft > 0) {
      table.push(REMOVED, hunk, oldLine++, 0, start + 1, end);
      oldLeft--;
    } else {
      table.push(UNCHANGED, hunk, oldLine++, newLine++, start === end ? end : start + 1, end);
      if (oldLeft > 0) oldLeft--;
      if (newLeft > 0) newLeft--;
    }
  }
}

function lineAt(bytes: Buffer, table: LineTable, i: number): DiffLine {
  const type = table.type[i];
  return {
    type: TYPE_NAMES[type],
    old_line: type === ADDED ? null : table.oldLine[i],
    new_line: type === REMOVED ? null : table.newLine[i],
    text: bytes.toString('utf8', table.start[i], table.end[i]),
  };
}

function contextLines(bytes: Buffer, table: LineTable, i: number, count: number) {
  const before: DiffLine[] = [];
  const after: DiffLine[] = [];
  const hunk = table.hunk[i];
  for (let j = Math.max(0, i - count); j < i; j++)
    if (table.hunk[j] === hunk) before.push(lineAt(bytes, table, j));
  for (let j = i + 1; j <= i + count && j < table.size && table.hunk[j] === hunk; j++)
    after.push(lineAt(bytes, table, j));
  return { before, after };
}

/** Why GitLab's entry carries no searchable text, or null when its diff can be searched. */
function unsearchable(file: DiffFile): NotScannedReason | 'empty' | null {
  if (file.too_large === true) return 'too_large';
  if (file.collapsed === true) return 'collapsed';
  if (file.diff.length === 0) {
    // From 18.4 the flags say why text is missing; an empty diff without them is a change
    // with no text lines (rename, mode change, empty file), searched with nothing to match.
    return file.collapsed !== undefined || file.too_large !== undefined ? 'empty' : 'empty_diff';
  }
  if (file.diff.startsWith('Binary files ')) return 'binary';
  return null;
}

/**
 * Searches the changed lines of GitLab diff entries. Every match is counted; the first
 * `maxMatches` are returned with their line numbers and context, in file order.
 */
export function searchDiffLines(
  entries: readonly DiffFile[],
  filter: DiffLineFilter,
): DiffLineSearch {
  const result: DiffLineSearch = {
    files: [],
    not_scanned: [],
    summary: {
      line_patterns: filter.patterns,
      side: filter.side,
      files_scanned: 0,
      files_matched: 0,
      match_count: 0,
      truncated: false,
    },
  };
  const table = new LineTable();
  const wantAdded = filter.side !== 'removed';
  const wantRemoved = filter.side !== 'added';
  let returned = 0;
  for (const file of entries) {
    const { diff, old_path, new_path } = file;
    const reason = unsearchable(file);
    if (reason !== null && reason !== 'empty') {
      result.not_scanned.push({ old_path, new_path, reason });
      continue;
    }
    result.summary.files_scanned++;
    if (reason === 'empty') continue;
    const bytes = Buffer.from(diff, 'utf8');
    parseHunks(bytes, table);
    let found: DiffFileMatches | null = null;
    let fileMatched = false;
    for (let i = 0; i < table.size; i++) {
      const type = table.type[i];
      if (type === UNCHANGED || (type === ADDED ? !wantAdded : !wantRemoved)) continue;
      const hits = filter.matcher.match(bytes.subarray(table.start[i], table.end[i]));
      if (hits.length === 0) continue;
      result.summary.match_count++;
      fileMatched = true;
      if (returned === filter.maxMatches) continue;
      returned++;
      const line = lineAt(bytes, table, i);
      found ??= {
        old_path,
        new_path,
        new_file: file.new_file === true,
        renamed_file: file.renamed_file === true,
        deleted_file: file.deleted_file === true,
        matches: [],
      };
      found.matches.push({
        side: type === ADDED ? 'added' : 'removed',
        old_line: line.old_line,
        new_line: line.new_line,
        text: line.text,
        patterns: hits,
        context: contextLines(bytes, table, i, filter.context),
      });
    }
    if (fileMatched) result.summary.files_matched++;
    if (found !== null) result.files.push(found);
  }
  result.summary.truncated = result.summary.match_count > returned;
  return result;
}
