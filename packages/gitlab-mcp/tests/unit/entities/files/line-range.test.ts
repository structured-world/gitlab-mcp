import {
  NotTextError,
  RANGE_MAX_BYTES,
  RANGE_MAX_LINES,
  selectLines,
} from '../../../../src/entities/files/line-range';

const text = (value: string) => Buffer.from(value, 'utf8');

describe('selectLines', () => {
  // Lines end after \n as Git stores them; the selection is the exact stored text.
  it('selects an inclusive range with each line ending', () => {
    expect(selectLines(text('a\nb\nc\nd\n'), 2, 3)).toEqual({
      content: 'b\nc\n',
      start_line: 2,
      end_line: 3,
      total_lines: 4,
      next_line: 4,
    });
  });

  // CRLF stays in the text, and a lone CR is part of its line, not a line break.
  it('keeps CRLF endings and does not split on a lone CR', () => {
    expect(selectLines(text('a\r\nb\rc\r\nd'), 2, 2)).toEqual({
      content: 'b\rc\r\n',
      start_line: 2,
      end_line: 2,
      total_lines: 3,
      next_line: 3,
    });
  });

  // A missing final newline is not invented, and the last line ends the file.
  it('returns the last line without a newline and no next line', () => {
    expect(selectLines(text('a\nb'), 2, 5)).toEqual({
      content: 'b',
      start_line: 2,
      end_line: 2,
      total_lines: 2,
      next_line: null,
    });
  });

  // A trailing newline ends the last line; it does not start an empty extra line.
  it('does not count an empty line after the final newline', () => {
    expect(selectLines(text('a\nb\n'), 1).total_lines).toBe(2);
    expect(selectLines(text('a\n\n'), 1).total_lines).toBe(2);
  });

  // Without an end, the range runs to the end of the file.
  it('reads to the end of the file when end is omitted', () => {
    expect(selectLines(text('a\nb\nc'), 2)).toMatchObject({
      content: 'b\nc',
      end_line: 3,
      next_line: null,
    });
    expect(selectLines(text('a\nb\nc'), 2).truncated).toBeUndefined();
  });

  // An empty file has no lines; reading it selects nothing without an error.
  it('selects nothing from an empty file', () => {
    expect(selectLines(Buffer.alloc(0), 1, 10)).toEqual({
      content: '',
      start_line: 1,
      end_line: null,
      total_lines: 0,
      next_line: null,
    });
  });

  // A range past the end is an empty selection with the file's line count, not an error.
  it('selects nothing past the end of the file', () => {
    expect(selectLines(text('a\nb\n'), 3, 9)).toEqual({
      content: '',
      start_line: 3,
      end_line: null,
      total_lines: 2,
      next_line: null,
    });
  });

  // Bytes that are not UTF-8 have no lines; a base64 slice would cut characters.
  it.each([
    ['PDF bytes', Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x0a, 0x80])],
    ['truncated sequence', Buffer.from([0x61, 0x0a, 0xe2, 0x82])],
  ])('refuses %s', (_name, bytes) => {
    expect(() => selectLines(bytes, 1, 1)).toThrow(NotTextError);
  });

  // Multibyte characters are kept whole, and a byte order mark is dropped from line 1 only,
  // as a whole read drops it.
  it('keeps multibyte text and drops a leading byte order mark from line 1', () => {
    const bytes = text('﻿café\n﻿\u{1f680}\n');
    expect(selectLines(bytes, 1, 1).content).toBe('café\n');
    expect(selectLines(bytes, 2, 2).content).toBe('﻿\u{1f680}\n');
  });

  // A range longer than the line cap is cut there and says where to continue.
  it('cuts a range at the line cap', () => {
    const bytes = text('x\n'.repeat(RANGE_MAX_LINES + 5));
    const selection = selectLines(bytes, 3);
    expect(selection).toMatchObject({
      start_line: 3,
      end_line: RANGE_MAX_LINES + 2,
      total_lines: RANGE_MAX_LINES + 5,
      next_line: RANGE_MAX_LINES + 3,
      truncated: true,
    });
    expect(selection.content).toBe('x\n'.repeat(RANGE_MAX_LINES));
  });

  // A range ending exactly at the cap is complete, not truncated.
  it('does not mark a range that fits the line cap as truncated', () => {
    const bytes = text('x\n'.repeat(RANGE_MAX_LINES + 5));
    const selection = selectLines(bytes, 1, RANGE_MAX_LINES);
    expect(selection.truncated).toBeUndefined();
    expect(selection.next_line).toBe(RANGE_MAX_LINES + 1);
  });

  // The byte cap stops before the line that would pass it, never inside a line.
  it('cuts a range at the byte cap on a line boundary', () => {
    const line = 'y'.repeat(999) + '\n';
    const bytes = text(line.repeat(100));
    const fit = Math.floor(RANGE_MAX_BYTES / line.length);
    const selection = selectLines(bytes, 1, 100);
    expect(selection).toMatchObject({ end_line: fit, next_line: fit + 1, truncated: true });
    expect(selection.content).toBe(line.repeat(fit));
  });

  // A single line over the byte cap is cut to it on a character boundary, and says so.
  it('cuts one line longer than the byte cap without splitting a character', () => {
    // The cap falls on the second byte of an 'é' after the leading 'x'.
    const bytes = text('a\nx' + 'é'.repeat(RANGE_MAX_BYTES) + '\nb\n');
    const selection = selectLines(bytes, 2, 3);
    expect(selection).toMatchObject({
      start_line: 2,
      end_line: 2,
      total_lines: 3,
      next_line: 3,
      truncated: true,
      line_cut: true,
    });
    expect(selection.content).toBe('x' + 'é'.repeat(RANGE_MAX_BYTES / 2 - 1));
  });
});
