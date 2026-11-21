import { grepStream } from './line-grep-worker';
import type { LineGrepOptions } from './line-grep';
import type { LogSection, SectionBounds, SectionTarget } from './log-sections';
import { LOG_GREP_BUDGET_MS } from './pipeline-grep';
import { readTracePage, TRACE_PAGE_BYTES, type TracePage } from './trace';
import { openTrace } from './trace-open';
import type { BrowsePipelinesInput } from './schema-readonly';

type LogsInput = Extract<BrowsePipelinesInput, { action: 'logs' }>;
type SectionsInput = Extract<BrowsePipelinesInput, { action: 'log_sections' }>;

const DEFAULT_LOG_LINES = 200;

/** A scan that only follows section markers: nothing is matched or reported. */
const markerScan = (extra: Partial<LineGrepOptions>): LineGrepOptions => ({
  patterns: [],
  before: 0,
  after: 0,
  maxMatches: 1,
  invert: false,
  startLine: 0,
  normalize: true,
  budgetMs: LOG_GREP_BUDGET_MS,
  outputBytes: TRACE_PAGE_BYTES,
  ...extra,
});

export interface LogSectionsResult {
  sections: LogSection[];
  /** True when the log has more than the listed sections. */
  sections_truncated: boolean;
  /** First line with section markers the scan could not read; ranges from it on may be wrong. */
  sections_unread_from_line: number | null;
  /** Null when the processing budget stopped the scan; sections still open then have no end. */
  total_lines: number | null;
  complete: boolean;
}

/** The sections of a job log in order, with line ranges and durations. */
export async function listLogSections(input: SectionsInput): Promise<LogSectionsResult> {
  const result = await grepStream(markerScan({ listSections: true }), () =>
    openTrace(input.project_id, input.job_id),
  );
  const listing = result.sections ?? { sections: [], truncated: false, unread_from_line: null };
  return {
    sections: listing.sections,
    sections_truncated: listing.truncated,
    sections_unread_from_line: listing.unread_from_line,
    total_lines: result.total_lines,
    complete: result.truncated === null,
  };
}

type KnownBounds = SectionBounds & { end_line: number; line_count: number };

/** Lines of one section; reading stops at its end. Fails when the log lacks the section. */
export async function locateSection(
  projectId: string,
  jobId: string,
  target: SectionTarget,
): Promise<KnownBounds> {
  const result = await grepStream(markerScan({ section: target }), () =>
    openTrace(projectId, jobId),
  );
  const bounds = result.section;
  // end_line and line_count are set together, once the section's end is known.
  if (typeof bounds?.end_line !== 'number')
    throw new Error(
      `Section '${target.name}' could not be located within the processing budget; read the log with start instead`,
    );
  return bounds as KnownBounds;
}

export interface SectionLogsPage {
  trace: string;
  section: SectionBounds;
  /** Lines of the section. */
  totalLines: number;
  shownLines: number;
  /** Absolute line number of the first line shown. */
  startLine: number;
  hasMore: boolean;
  /** Section-relative `start` of the next page. */
  nextStart: number | null;
  truncation?: TracePage['truncation'];
}

/**
 * A page of `logs` inside one section: `start`, `per_page` and `nextStart` count lines from
 * the section's first line, a negative `start` from its end; `startLine` stays absolute.
 */
export async function readSectionLogs(
  input: LogsInput & { section: string },
): Promise<SectionLogsPage> {
  const { project_id, job_id, per_page, start } = input;
  const bounds = await locateSection(project_id, job_id, {
    name: input.section,
    index: input.section_index ?? 0,
  });
  const count = bounds.line_count;
  const perPage = per_page ?? DEFAULT_LOG_LINES;
  const fromStart = start !== undefined && start >= 0;
  const wanted = fromStart || start === undefined ? perPage : Math.min(perPage, -start);
  const offset = fromStart ? start : Math.max(0, count - wanted);
  const shown = Math.max(0, Math.min(wanted, count - offset));
  const first = bounds.start_line + offset;

  let page: TracePage | null = null;
  if (shown > 0)
    page = await readTracePage(await openTrace(project_id, job_id), shown, first, first + shown);
  const lines = page?.lines ?? [];
  const notes: string[] = [];
  if (page?.truncation)
    notes.push(
      `[LOG CONTENT TRUNCATED: ${page.truncation.lines.length} source lines are incomplete due to byte limits. See truncation.lines; line pagination cannot recover omitted bytes.]`,
    );
  if (shown === 0)
    notes.push(
      `[OUT OF BOUNDS: Start position ${offset} exceeds the ${count} lines of section '${bounds.name}'. Available range: 0-${count - 1}]`,
    );
  else
    notes.push(
      `[SECTION ${bounds.name}: lines ${first}-${first + lines.length - 1} of the log, ${offset}-${offset + lines.length - 1} of the section's ${count}]`,
    );
  const hasMore = offset + lines.length < count;
  return {
    trace: [...notes, ...lines].join('\n'),
    section: bounds,
    totalLines: count,
    shownLines: lines.length,
    startLine: first,
    hasMore,
    nextStart: hasMore ? offset + lines.length : null,
    ...(page?.truncation ? { truncation: page.truncation } : {}),
  };
}
