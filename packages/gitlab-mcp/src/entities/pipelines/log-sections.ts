// Longest section name the scan can read: the marker stream holds a marker of at most the
// bytes a line keeps. GitLab's grammar sets no limit; names are ASCII.
export { TRACE_LINE_BYTES as MAX_SECTION_NAME } from './trace';

/** Sections a listing reports; later sections only set `truncated`. */
export const MAX_LOG_SECTIONS = 500;

export interface LogSection {
  name: string;
  /** Earlier sections with the same name, counted from 0; pass it as `section_index`. */
  occurrence: number;
  /** Sections open when this one started. */
  depth: number;
  start_line: number;
  /** Line of the end marker, the last line for a section open at EOF, null when the scan stopped first. */
  end_line: number | null;
  line_count: number | null;
  duration_seconds: number | null;
  collapsed: boolean;
  /** Whether an end marker closed the section. */
  terminated: boolean;
}

export interface SectionListing {
  sections: LogSection[];
  truncated: boolean;
  /** First line with section markers the scan could not read; ranges from it on may be wrong. */
  unread_from_line: number | null;
}

/** One occurrence of a named section, chosen by its 0-based index among sections of that name. */
export interface SectionTarget {
  name: string;
  index: number;
}

export interface SectionBounds {
  name: string;
  index: number;
  start_line: number;
  /** Null when the scan stopped before the section ended. */
  end_line: number | null;
  line_count: number | null;
  terminated: boolean;
}

/** A requested section the whole log does not contain. */
export class SectionNotFoundError extends Error {}

// GitLab keys open sections by this form (Ansi2json::Converter#sanitize_section_name), so
// an end marker closes a start whose name differs only in case or punctuation.
const sanitize = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '-');

function collapsedOption(options: string | null): boolean {
  if (options === null) return false;
  // `[key=value, key=value]`; the grammar allows one space after a comma.
  for (const option of options.slice(1, -1).split(',')) {
    const [key, value] = option.trim().split('=');
    if (key === 'collapsed') return value === 'true';
  }
  return false;
}

interface Tracked {
  key: string;
  startStamp: number;
  section: LogSection;
}

/**
 * Follows section markers as GitLab's log view does (Ansi2json::State): sections are open by
 * name, not nested on a stack; a start of an open name restarts it; an end of a name that is
 * not open is ignored. Lines are physical lines, as `logs` counts them.
 */
export class SectionTracker {
  private readonly listed: Tracked[] = [];
  private readonly open = new Map<string, Tracked>();
  private readonly occurrences = new Map<string, number>();
  private truncated = false;
  private readonly targetKey: string | null;
  private targetSeen = 0;
  private target: Tracked | null = null;
  private targetDone = false;
  private unreadFrom: number | null = null;
  // Markers went unread while the requested section was not yet over.
  private targetUnread = false;
  // A plain field: the worker loads this module with Node's type stripping, which rejects
  // parameter properties.
  private readonly wanted: SectionTarget | undefined;

  constructor(wanted?: SectionTarget) {
    this.wanted = wanted;
    this.targetKey = wanted ? sanitize(wanted.name) : null;
  }

  start(line: number, stamp: number, name: string, options: string | null): void {
    const key = sanitize(name);
    const restarted = this.open.get(key);
    if (restarted) {
      this.close(restarted, Math.max(restarted.section.start_line, line - 1), null);
      this.open.delete(key);
    }
    if (this.target && !this.targetDone && this.targetKey === key) {
      this.close(this.target, Math.max(this.target.section.start_line, line - 1), null);
      this.targetDone = true;
    }
    const occurrence = this.occurrences.get(name) ?? 0;
    const tracked: Tracked = {
      key,
      startStamp: stamp,
      section: {
        name,
        occurrence,
        depth: this.open.size,
        start_line: line,
        end_line: null,
        line_count: null,
        duration_seconds: null,
        collapsed: collapsedOption(options),
        terminated: false,
      },
    };
    if (name === this.wanted?.name && this.targetSeen++ === this.wanted.index)
      this.target = tracked;
    if (this.listed.length < MAX_LOG_SECTIONS) {
      this.listed.push(tracked);
      this.open.set(key, tracked);
      this.occurrences.set(name, occurrence + 1);
    } else {
      this.truncated = true;
    }
  }

  end(line: number, stamp: number, name: string): void {
    const key = sanitize(name);
    const tracked = this.open.get(key);
    if (tracked) {
      this.close(tracked, line, stamp);
      this.open.delete(key);
    }
    if (this.target && !this.targetDone && this.targetKey === key) {
      this.close(this.target, line, stamp);
      this.targetDone = true;
    }
  }

  /** Records that markers on `line` could not be read, so later bounds may be wrong. */
  unread(line: number): void {
    this.unreadFrom ??= line;
    if (this.wanted && !this.targetDone) this.targetUnread = true;
  }

  /** Whether the requested section's bounds can no longer be trusted. */
  get unresolved(): boolean {
    return this.targetUnread;
  }

  private close(tracked: Tracked, line: number, stamp: number | null): void {
    const section = tracked.section;
    if (section.end_line !== null) return;
    section.end_line = line;
    section.line_count = line - section.start_line + 1;
    section.terminated = stamp !== null;
    section.duration_seconds = stamp === null ? null : stamp - tracked.startStamp;
  }

  /** Last line of the requested section once it has ended, otherwise null. */
  get targetEnd(): number | null {
    return this.targetDone ? (this.target as Tracked).section.end_line : null;
  }

  /** First line of the requested section once it has started, otherwise null. */
  get targetStart(): number | null {
    return this.target?.section.start_line ?? null;
  }

  /**
   * Ends what is still open: at `lastLine` when the log was read to its end, or as unknown
   * when the scan stopped first. A requested section the whole log lacks is an error.
   */
  finish(lastLine: number | null): void {
    if (this.targetUnread)
      throw new Error(
        `Section '${(this.wanted as SectionTarget).name}' cannot be located: line ${this.unreadFrom} holds section markers the scan could not read`,
      );
    if (lastLine === null) return;
    for (const tracked of this.open.values()) this.close(tracked, lastLine, null);
    this.open.clear();
    if (this.target && !this.targetDone) {
      this.close(this.target, lastLine, null);
      this.targetDone = true;
    }
    if (this.wanted && !this.target) throw new SectionNotFoundError(this.missing(this.wanted));
  }

  private missing(wanted: SectionTarget): string {
    if (this.targetSeen > 0)
      return `Section '${wanted.name}' occurs ${this.targetSeen} time(s); section_index counts from 0`;
    if (this.listed.length === 0)
      return `Section '${wanted.name}' not found: the log has no sections`;
    const names = [...this.occurrences].map(([name, count]) =>
      count > 1 ? `${name} (${count})` : name,
    );
    const more = this.truncated ? `, and sections past the first ${MAX_LOG_SECTIONS}` : '';
    return `Section '${wanted.name}' not found; sections: ${names.join(', ')}${more}`;
  }

  listing(): SectionListing {
    return {
      sections: this.listed.map((tracked) => tracked.section),
      truncated: this.truncated,
      unread_from_line: this.unreadFrom,
    };
  }

  bounds(): SectionBounds | null {
    if (!this.wanted || !this.target) return null;
    const section = this.target.section;
    return {
      name: section.name,
      index: this.wanted.index,
      start_line: section.start_line,
      end_line: section.end_line,
      line_count: section.line_count,
      terminated: section.terminated,
    };
  }
}
