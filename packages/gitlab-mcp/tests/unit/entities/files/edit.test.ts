import { applyEdits, EditError, isLfsPointer } from '../../../../src/entities/files/edit';

/**
 * Apply a unified diff to a text, independently of the code under test: each hunk's context
 * and removed lines must match the original at the hunk's position.
 */
function applyUnifiedDiff(before: string, diff: string): string {
  const lines = before.length === 0 ? [] : before.match(/[^\n]*\n|[^\n]+$/g)!;
  const out: string[] = [];
  let cursor = 0;
  const body = diff.split('\n').slice(2, -1);
  for (let i = 0; i < body.length;) {
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(body[i]);
    if (!header) throw new Error(`bad hunk header: ${body[i]}`);
    const oldStart = Number(header[2]) === 0 ? Number(header[1]) : Number(header[1]) - 1;
    while (cursor < oldStart) out.push(lines[cursor++]);
    i++;
    while (i < body.length && !body[i].startsWith('@@')) {
      const line = body[i];
      const noNewline = body[i + 1] === '\\ No newline at end of file';
      const text = line.slice(1) + (noNewline ? '' : '\n');
      if (line.startsWith(' ') || line.startsWith('-')) {
        if (lines[cursor] !== text) throw new Error(`context mismatch at line ${cursor + 1}`);
        cursor++;
      }
      if (line.startsWith(' ') || line.startsWith('+')) out.push(text);
      i += noNewline ? 2 : 1;
    }
  }
  while (cursor < lines.length) out.push(lines[cursor++]);
  return out.join('');
}

describe('applyEdits', () => {
  const values = 'replicas: 2\nresources:\n  cpu: 500m\n  memory: 1Gi\nsuspend: false\n';

  it('changes only the matched fragment and leaves every other byte as it was', () => {
    const result = applyEdits('values.yaml', values, [
      { old_text: 'cpu: 500m', new_text: 'cpu: 750m' },
    ]);
    expect(result.text).toBe(values.replace('cpu: 500m', 'cpu: 750m'));
    expect(result.replacements).toEqual([1]);
    expect(result.diff).toBe(
      [
        '--- a/values.yaml',
        '+++ b/values.yaml',
        '@@ -1,5 +1,5 @@',
        ' replicas: 2',
        ' resources:',
        '-  cpu: 500m',
        '+  cpu: 750m',
        '   memory: 1Gi',
        ' suspend: false',
        '',
      ].join('\n'),
    );
    expect(result.diff_truncated).toBe(false);
  });

  it('keeps CRLF line endings, a byte order mark and a missing final newline', () => {
    const text = '﻿a: 1\r\nb: 2\r\nc: 3';
    const result = applyEdits('f.txt', text, [{ old_text: 'b: 2', new_text: 'b: 20' }]);
    expect(result.text).toBe('﻿a: 1\r\nb: 20\r\nc: 3');
    expect(applyUnifiedDiff(text, result.diff)).toBe(result.text);
  });

  it('marks the last line without a newline in the diff', () => {
    const result = applyEdits('f.txt', 'x\ny', [{ old_text: 'y', new_text: 'z' }]);
    expect(result.diff).toContain(
      '-y\n\\ No newline at end of file\n+z\n\\ No newline at end of file',
    );
  });

  it('replaces every occurrence with replace_all and counts them', () => {
    const result = applyEdits('f.txt', 'a\nb\na\n', [
      { old_text: 'a', new_text: 'c', replace_all: true },
    ]);
    expect(result.text).toBe('c\nb\nc\n');
    expect(result.replacements).toEqual([2]);
  });

  it('applies several edits, each located in the original text', () => {
    // The second edit's old text appears only after the first is applied; it must not match.
    expect(() =>
      applyEdits('f.txt', 'one\n', [
        { old_text: 'one', new_text: 'two' },
        { old_text: 'two', new_text: 'three' },
      ]),
    ).toThrow('edit 1: old_text was not found in the file');
    const result = applyEdits('f.txt', 'one\ntwo\n', [
      { old_text: 'two', new_text: '2' },
      { old_text: 'one', new_text: '1' },
    ]);
    expect(result.text).toBe('1\n2\n');
    expect(result.replacements).toEqual([1, 1]);
  });

  it('refuses a missing, ambiguous, overlapping or no-op edit with its index', () => {
    const text = 'alpha beta\nalpha\n';
    const refused = (edits: Parameters<typeof applyEdits>[2]) => {
      try {
        applyEdits('f.txt', text, edits);
      } catch (error) {
        expect(error).toBeInstanceOf(EditError);
        return [(error as EditError).index, (error as Error).message];
      }
      throw new Error('edit was not refused');
    };
    expect(refused([{ old_text: 'gamma', new_text: 'x' }])).toEqual([
      0,
      'edit 0: old_text was not found in the file',
    ]);
    expect(
      refused([
        { old_text: 'beta', new_text: 'b' },
        { old_text: 'alpha', new_text: 'a' },
      ]),
    ).toEqual([
      1,
      'edit 1: old_text occurs 2 times; add surrounding text to make it unique, or set replace_all',
    ]);
    expect(
      refused([
        { old_text: 'alpha beta', new_text: 'x' },
        { old_text: 'beta\n', new_text: 'y' },
      ]),
    ).toEqual([1, 'edit 1: old_text overlaps the text edit 0 replaces']);
    expect(refused([{ old_text: 'beta', new_text: 'beta' }])).toEqual([
      0,
      'edit 0: new_text equals old_text, so the edit changes nothing',
    ]);
    expect(refused([{ old_text: '', new_text: 'x' }])).toEqual([0, 'edit 0: old_text is empty']);
  });

  it('describes a replacement that joins or splits lines correctly', () => {
    for (const [text, oldText, newText] of [
      ['a\nb\nc\n', 'a\n', 'x'],
      ['a\nb\nc\n', 'b', 'b1\nb2\nb3'],
      ['a\nb\nc\n', 'a\nb\n', ''],
      ['a\nb\nc', 'b\nc', 'z'],
      ['a\nb\nc\n', 'c\n', 'c\nd'],
      ['only', 'only', ''],
    ]) {
      const result = applyEdits('f.txt', text, [{ old_text: oldText, new_text: newText }]);
      expect(applyUnifiedDiff(text, result.diff)).toBe(result.text);
    }
  });

  it('places a change that empties the last line at the end of the new file', () => {
    // Deleting every "b" removes the whole last line; the change starts past the new text.
    const text = 'b\r\n  #x\r\nbb';
    const result = applyEdits('f.txt', text, [{ old_text: 'b', new_text: '', replace_all: true }]);
    expect(result.text).toBe('\r\n  #x\r\n');
    expect(applyUnifiedDiff(text, result.diff)).toBe(result.text);
  });

  it('keeps distant changes in separate hunks and close ones in one', () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const far = applyEdits('f.txt', text, [
      { old_text: 'line 2\n', new_text: 'line two\n' },
      { old_text: 'line 30\n', new_text: 'line thirty\n' },
    ]);
    expect(far.diff.match(/^@@/gm)).toHaveLength(2);
    const near = applyEdits('f.txt', text, [
      { old_text: 'line 2\n', new_text: 'line two\n' },
      { old_text: 'line 6\n', new_text: 'line six\n' },
    ]);
    expect(near.diff.match(/^@@/gm)).toHaveLength(1);
    expect(applyUnifiedDiff(text, far.diff)).toBe(far.text);
    expect(applyUnifiedDiff(text, near.diff)).toBe(near.text);
  });

  it('bounds the diff and says so when hunks were dropped', () => {
    const text = Array.from({ length: 3000 }, (_, i) => `entry ${i} ${'x'.repeat(40)}`).join('\n');
    const result = applyEdits('big.txt', text, [
      { old_text: 'x'.repeat(40), new_text: 'y'.repeat(40), replace_all: true },
    ]);
    expect(result.replacements).toEqual([3000]);
    expect(result.diff_truncated).toBe(true);
    expect(result.diff.length).toBeLessThanOrEqual(64 * 1024 + 1);
    expect(result.text).not.toContain('x'.repeat(40));
  });

  it('produces a diff that turns the original into the result for random edits', () => {
    // A seeded generator keeps failures reproducible.
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pieces = ['a', 'b', 'key: v', '\n', '\r\n', '  ', '#', 'é', '\u{1F600}'];
    const piece = () => pieces[random(pieces.length)];
    let checked = 0;
    for (let run = 0; run < 2000; run++) {
      const text = Array.from({ length: 5 + random(60) }, piece).join('');
      const start = random(text.length);
      const oldText = text.slice(start, start + 1 + random(8));
      const newText = Array.from({ length: random(6) }, piece).join('');
      if (oldText.length === 0 || newText === oldText) continue;
      // A repeated fragment is replaced everywhere, so several changes share the diff.
      const replaceAll = text.indexOf(oldText) !== text.lastIndexOf(oldText);
      const result = applyEdits('r.txt', text, [
        { old_text: oldText, new_text: newText, replace_all: replaceAll },
      ]);
      expect(result.text).toBe(text.split(oldText).join(newText));
      // The inputs ride along so a failure shows what to reproduce.
      expect({ run, text, oldText, newText, patched: applyUnifiedDiff(text, result.diff) }).toEqual(
        { run, text, oldText, newText, patched: result.text },
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(1500);
  });
});

describe('isLfsPointer', () => {
  it('recognizes a Git LFS pointer and not ordinary text that mentions one', () => {
    const pointer =
      'version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 12345\n';
    expect(isLfsPointer(pointer)).toBe(true);
    expect(isLfsPointer('# docs\nversion https://git-lfs.github.com/spec/v1\n')).toBe(false);
    expect(isLfsPointer(`${pointer}${'x'.repeat(2000)}`)).toBe(false);
  });
});
