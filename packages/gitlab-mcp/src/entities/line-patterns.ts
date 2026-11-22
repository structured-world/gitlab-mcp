import { z } from 'zod';
import { MAX_PATTERN_LENGTH, MAX_PATTERNS } from '../utils/re2-pattern';

/** Caller RE2 patterns shared by the log, artifact and diff searches. */
export const patternList = z
  .array(z.string().min(1).max(MAX_PATTERN_LENGTH))
  .min(1)
  .max(MAX_PATTERNS);

export const PATTERNS_DESCRIPTION = `RE2 patterns (up to ${MAX_PATTERNS}, ${MAX_PATTERN_LENGTH} chars each); inline flags such as (?i). A line matches when any pattern does`;

export const DIFF_MAX_CONTEXT = 5;
export const DIFF_DEFAULT_CONTEXT = 1;
export const DIFF_MAX_MATCHES = 1000;
export const DIFF_DEFAULT_MATCHES = 200;

/** Fields that turn a diff read into a search of its changed lines. */
export const diffLineFilterFields = {
  line_patterns: patternList
    .optional()
    .describe(
      `${PATTERNS_DESCRIPTION}. Returns only the matching diff lines per file, with old_line/new_line for a positioned MR comment, instead of the full diffs`,
    ),
  side: z
    .enum(['added', 'removed', 'any'])
    .optional()
    .describe('Changed lines to match with line_patterns (default: added)'),
  context: z
    .number()
    .int()
    .min(0)
    .max(DIFF_MAX_CONTEXT)
    .optional()
    .describe(
      `Diff lines before and after each match, within its hunk (default: ${DIFF_DEFAULT_CONTEXT}, max: ${DIFF_MAX_CONTEXT}); needs line_patterns`,
    ),
  max_matches: z
    .number()
    .int()
    .min(1)
    .max(DIFF_MAX_MATCHES)
    .optional()
    .describe(
      `Matches to return (default: ${DIFF_DEFAULT_MATCHES}, max: ${DIFF_MAX_MATCHES}); match_count still counts all. Needs line_patterns`,
    ),
};
