/** Longest caller pattern accepted, in UTF-16 code units. */
export const MAX_PATTERN_LENGTH = 512;
/** Most compiled instructions accepted for one caller pattern. */
export const MAX_PATTERN_PROGRAM_SIZE = 2000;
/** Most caller patterns accepted by one call. */
export const MAX_PATTERNS = 8;

/** A caller pattern that cannot be used; `index` is its position in the request. */
export class PatternError extends Error {
  constructor(
    readonly index: number,
    message: string,
  ) {
    super(`Invalid RE2 pattern ${index}: ${message}`);
    this.name = 'PatternError';
  }
}
