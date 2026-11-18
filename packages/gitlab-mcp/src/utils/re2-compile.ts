import { RE2JS, RE2Set } from 're2js';
import {
  MAX_PATTERN_LENGTH,
  MAX_PATTERN_PROGRAM_SIZE,
  MAX_PATTERNS,
  PatternError,
} from './re2-pattern';

/**
 * Matches UTF-8 input against compiled patterns. Matched indexes come in ascending order in
 * a fresh array the caller may keep; no match returns a shared empty array.
 */
export interface PatternMatcher {
  match(input: Uint8Array): readonly number[];
}

const NO_MATCH: readonly number[] = Object.freeze([]);

function checkCallerPattern(pattern: string, index: number): void {
  if (pattern.length === 0) throw new PatternError(index, 'pattern is empty');
  if (pattern.length > MAX_PATTERN_LENGTH)
    throw new PatternError(index, `pattern exceeds ${MAX_PATTERN_LENGTH} characters`);
  let compiled: RE2JS;
  try {
    compiled = RE2JS.compile(pattern);
  } catch (error) {
    throw new PatternError(index, error instanceof Error ? error.message : String(error));
  }
  if (compiled.programSize() > MAX_PATTERN_PROGRAM_SIZE)
    throw new PatternError(
      index,
      `pattern compiles to more than ${MAX_PATTERN_PROGRAM_SIZE} instructions; use smaller repetitions`,
    );
}

/**
 * Compile bounded caller patterns, then trusted server patterns. Match index i is
 * patterns[i], then trusted[i - patterns.length].
 *
 * One alternation of every pattern gates each input: re2js rejects most inputs by its
 * literal prefilter without running an automaton, and anything else costs one automaton
 * pass. Only inputs that do match pay for the set pass that names the matching patterns.
 * Compilation cost grows with the pattern, so callers run this off the request thread.
 */
export function compilePatterns(
  patterns: readonly string[],
  trusted: readonly string[] = [],
): PatternMatcher {
  if (patterns.length > MAX_PATTERNS)
    throw new PatternError(MAX_PATTERNS, `at most ${MAX_PATTERNS} patterns are accepted`);
  patterns.forEach(checkCallerPattern);
  const sources = patterns.concat(trusted);
  if (sources.length === 0) throw new Error('No patterns to compile');
  // A flag group such as (?i) inside (?:...) ends with that group, so parts stay independent.
  const gate = RE2JS.compile(sources.map((source) => `(?:${source})`).join('|'));
  if (sources.length === 1) return { match: (input) => (gate.test(input) ? [0] : NO_MATCH) };
  const set = new RE2Set();
  for (const source of sources) set.add(source);
  set.compile();
  return {
    match(input) {
      if (!gate.test(input)) return NO_MATCH;
      return set.match(input).sort((a, b) => a - b);
    },
  };
}
