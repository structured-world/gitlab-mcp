import { isUtf8 } from 'node:buffer';

/** A streamed source is binary or not UTF-8, so it cannot be searched as text. */
export class NotTextError extends Error {
  readonly reason = 'not_text';
  constructor(message: string) {
    super(message);
    this.name = 'NotTextError';
  }
}

function utf8Width(byte: number): number {
  if (byte >= 0xc2 && byte <= 0xdf) return 2;
  if (byte >= 0xe0 && byte <= 0xef) return 3;
  if (byte >= 0xf0 && byte <= 0xf4) return 4;
  return 1;
}

/**
 * Where a UTF-8 character cut off by the end of `bytes` starts, or `bytes.length` when the
 * chunk ends on a character boundary. A malformed tail is left in place for validation.
 */
function incompleteTail(bytes: Buffer, from: number): number {
  const end = bytes.length;
  let lead = end - 1;
  while (lead > from && end - lead < 4 && (bytes[lead] & 0xc0) === 0x80) lead--;
  if (lead < from) return end;
  return utf8Width(bytes[lead]) > end - lead ? lead : end;
}

/**
 * Applies artifact_file's text rule to a byte stream: control bytes other than tab, LF, FF,
 * CR and ESC make it binary, and the bytes must be valid UTF-8. A character split across
 * chunks is held back (at most four bytes) and checked once complete.
 */
export class TextValidator {
  private readonly pending = Buffer.alloc(4);
  private pendingLength = 0;
  private pendingWidth = 0;

  push(bytes: Buffer): void {
    for (let index = 0; index < bytes.length; index++) {
      const byte = bytes[index];
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13 && byte !== 27)
        throw new NotTextError('Artifact is binary and cannot be searched as text');
    }
    let from = 0;
    if (this.pendingLength > 0) {
      from = Math.min(this.pendingWidth - this.pendingLength, bytes.length);
      bytes.copy(this.pending, this.pendingLength, 0, from);
      this.pendingLength += from;
      if (this.pendingLength < this.pendingWidth) return;
      this.check(this.pending.subarray(0, this.pendingWidth));
      this.pendingLength = 0;
    }
    const tail = incompleteTail(bytes, from);
    this.check(bytes.subarray(from, tail));
    if (tail < bytes.length) {
      this.pendingWidth = utf8Width(bytes[tail]);
      this.pendingLength = bytes.copy(this.pending, 0, tail);
    }
  }

  /** The source ended: a character still incomplete is invalid. */
  end(): void {
    if (this.pendingLength > 0) this.fail();
  }

  private check(bytes: Buffer): void {
    if (!isUtf8(bytes)) this.fail();
  }

  private fail(): never {
    throw new NotTextError('Artifact is not valid UTF-8 text');
  }
}
