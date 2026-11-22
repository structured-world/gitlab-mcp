/** Largest file an edit reads and writes, in bytes. */
export const EDIT_MAX_FILE_BYTES = 1024 * 1024;
/** Most edits one call applies. */
export const EDIT_MAX_EDITS = 50;
/** Unchanged lines shown around each change in the diff. */
const DIFF_CONTEXT_LINES = 3;
/** Most characters of diff returned; hunks past it are dropped and the diff marked truncated. */
const DIFF_MAX_CHARS = 64 * 1024;

/** One requested replacement. */
export interface TextEdit {
  old_text: string;
  new_text: string;
  replace_all?: boolean;
}

/** An edit that cannot be applied; `index` is its position in the request. */
export class EditError extends Error {
  constructor(
    readonly index: number,
    reason: string,
  ) {
    super(`edit ${index}: ${reason}`);
    this.name = 'EditError';
  }
}

/** One located occurrence of an edit's old text in the original file. */
interface Match {
  index: number;
  start: number;
  end: number;
  replacement: string;
}

/** The edited text, the replacements each edit made and the diff from the original. */
export interface EditResult {
  text: string;
  replacements: number[];
  diff: string;
  diff_truncated: boolean;
}

/** Every occurrence of `needle` in `text`, without overlapping occurrences. */
function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length))
    found.push(at);
  return found;
}

/**
 * Locate every edit in the original text. An old text must occur exactly once unless the
 * edit replaces all of its occurrences; an edit that changes nothing, a missing or
 * ambiguous match and two edits touching the same text are refused with the edit's index.
 */
function locate(text: string, edits: readonly TextEdit[]): Match[] {
  const matches: Match[] = [];
  edits.forEach((edit, index) => {
    if (edit.old_text.length === 0) throw new EditError(index, 'old_text is empty');
    if (edit.old_text === edit.new_text)
      throw new EditError(index, 'new_text equals old_text, so the edit changes nothing');
    const found = occurrences(text, edit.old_text);
    if (found.length === 0) throw new EditError(index, 'old_text was not found in the file');
    if (found.length > 1 && !edit.replace_all)
      throw new EditError(
        index,
        `old_text occurs ${found.length} times; add surrounding text to make it unique, or set replace_all`,
      );
    for (const start of found)
      matches.push({ index, start, end: start + edit.old_text.length, replacement: edit.new_text });
  });
  matches.sort((a, b) => a.start - b.start);
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].start < matches[i - 1].end)
      throw new EditError(
        matches[i].index,
        `old_text overlaps the text edit ${matches[i - 1].index} replaces`,
      );
  }
  return matches;
}

/** Offsets where each line of `text` starts; the last entry is the text's length. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  if (starts[starts.length - 1] !== text.length) starts.push(text.length);
  return starts;
}

/** Index of the line holding the character at `offset` (the last line for the text's end). */
function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The line starting at `offset`, which a change boundary always is; the line count at the end. */
function lineAt(starts: readonly number[], offset: number, length: number): number {
  return offset >= length ? starts.length - 1 : lineOf(starts, offset);
}

/** A run of changed lines: old lines [oldFrom, oldTo) became new lines [newFrom, newTo). */
interface Change {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
}

/** The lines `from` to `to` (exclusive) of a text, each prefixed, with the EOF marker. */
function diffLines(
  text: string,
  starts: readonly number[],
  from: number,
  to: number,
  prefix: string,
): string[] {
  const lines: string[] = [];
  for (let line = from; line < to; line++) {
    const raw = text.slice(starts[line], starts[line + 1]);
    if (raw.endsWith('\n')) lines.push(prefix + raw.slice(0, -1));
    else lines.push(prefix + raw, '\\ No newline at end of file');
  }
  return lines;
}

/** Unified diff hunk header; an empty range starts at the line before it (`-0,0` at the top). */
function range(from: number, count: number): string {
  return `${count === 0 ? from : from + 1},${count}`;
}

/**
 * A unified diff of the change, built from where the edits fell rather than by comparing
 * the whole files, so it costs the size of the changed region. Changes closer than twice
 * the context share a hunk.
 */
function unifiedDiff(
  path: string,
  before: string,
  after: string,
  changes: readonly Change[],
): { diff: string; truncated: boolean } {
  const oldStarts = lineStarts(before);
  const newStarts = lineStarts(after);
  const oldCount = oldStarts.length - 1;
  const parts = [`--- a/${path}`, `+++ b/${path}`];
  let size = parts.join('\n').length;
  let truncated = false;
  for (let first = 0; first < changes.length;) {
    let last = first;
    while (
      last + 1 < changes.length &&
      changes[last + 1].oldFrom - changes[last].oldTo <= 2 * DIFF_CONTEXT_LINES
    )
      last++;
    const head = Math.min(DIFF_CONTEXT_LINES, changes[first].oldFrom);
    const tail = Math.min(DIFF_CONTEXT_LINES, oldCount - changes[last].oldTo);
    const oldFrom = changes[first].oldFrom - head;
    const newFrom = changes[first].newFrom - head;
    const lines = diffLines(before, oldStarts, oldFrom, changes[first].oldFrom, ' ');
    for (let i = first; i <= last; i++) {
      const change = changes[i];
      lines.push(...diffLines(before, oldStarts, change.oldFrom, change.oldTo, '-'));
      lines.push(...diffLines(after, newStarts, change.newFrom, change.newTo, '+'));
      const next = i < last ? changes[i + 1].oldFrom : change.oldTo + tail;
      lines.push(...diffLines(before, oldStarts, change.oldTo, next, ' '));
    }
    const oldLength = changes[last].oldTo + tail - oldFrom;
    const newLength = changes[last].newTo + tail - newFrom;
    const hunk = [`@@ -${range(oldFrom, oldLength)} +${range(newFrom, newLength)} @@`, ...lines];
    const hunkSize = hunk.join('\n').length + 1;
    if (size + hunkSize > DIFF_MAX_CHARS) {
      truncated = true;
      break;
    }
    parts.push(...hunk);
    size += hunkSize;
    first = last + 1;
  }
  return { diff: `${parts.join('\n')}\n`, truncated };
}

/**
 * Apply edits to a file's text. Every edit is located in the original text; the text
 * between matches is copied as it is, so line endings, indentation and the final newline
 * stay byte for byte.
 */
export function applyEdits(path: string, text: string, edits: readonly TextEdit[]): EditResult {
  const matches = locate(text, edits);
  const replacements = edits.map(() => 0);
  const oldStarts = lineStarts(text);
  const pieces: string[] = [];
  const spans: Array<{ fromLine: number; toLine: number; delta: number }> = [];
  let cursor = 0;
  let delta = 0;
  for (const match of matches) {
    pieces.push(text.slice(cursor, match.start), match.replacement);
    cursor = match.end;
    replacements[match.index]++;
    // The whole lines the match touches; matches sharing a line become one change.
    const fromLine = lineOf(oldStarts, match.start);
    const toLine = lineOf(oldStarts, match.end - 1) + 1;
    const previous = spans.at(-1);
    if (previous && fromLine < previous.toLine) previous.toLine = Math.max(previous.toLine, toLine);
    else spans.push({ fromLine, toLine, delta });
    delta += match.replacement.length - (match.end - match.start);
    spans[spans.length - 1].delta = delta;
  }
  pieces.push(text.slice(cursor));
  const after = pieces.join('');
  const newStarts = lineStarts(after);
  // Map each change's old line range to the new text through the character shift before
  // and after it; the lines outside the matches are unchanged.
  const changes: Change[] = [];
  let shiftBefore = 0;
  for (let i = 0; i < spans.length; i++) {
    const fromLine = spans[i].fromLine;
    let toLine = spans[i].toLine;
    let shiftAfter = spans[i].delta;
    // A replacement that drops a match's final newline joins the next old line onto its
    // own: the change then takes that line too, and any later change starting on it.
    for (;;) {
      const newEnd = oldStarts[toLine] + shiftAfter;
      if (newEnd >= after.length || after[newEnd - 1] === '\n') break;
      toLine++;
      while (i + 1 < spans.length && spans[i + 1].fromLine < toLine) {
        i++;
        toLine = Math.max(toLine, spans[i].toLine);
        shiftAfter = spans[i].delta;
      }
    }
    changes.push({
      oldFrom: fromLine,
      oldTo: toLine,
      newFrom: lineAt(newStarts, oldStarts[fromLine] + shiftBefore, after.length),
      newTo: lineAt(newStarts, oldStarts[toLine] + shiftAfter, after.length),
    });
    shiftBefore = shiftAfter;
  }
  const { diff, truncated } = unifiedDiff(path, text, after, changes);
  return { text: after, replacements, diff, diff_truncated: truncated };
}

/** Git LFS pointer files start with this line (Git LFS specification, v1). */
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1\n';

/** Whether a file's content is a Git LFS pointer rather than the file itself. */
export function isLfsPointer(text: string): boolean {
  return text.length < 1024 && text.startsWith(LFS_POINTER_PREFIX) && /\noid sha256:/.test(text);
}
