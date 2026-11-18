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

function checkCallerPattern(pattern: string, index: number): RE2JS {
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
  return compiled;
}

/** The alternation of every source, or null when joined sources are no longer valid RE2. */
function compileGate(sources: readonly string[]): RE2JS | null {
  // Patterns valid alone can conflict once joined: a group name used twice, or a trailing
  // \Q that quotes the wrapper's closing parenthesis. The set then matches unaided.
  try {
    return RE2JS.compile(sources.map((source) => `(?:${source})`).join('|'));
  } catch {
    return null;
  }
}

/**
 * Compile bounded caller patterns, then trusted server patterns. Match index i is
 * patterns[i], then trusted[i - patterns.length].
 *
 * A single pattern is tested as compiled. Several share one alternation that gates each
 * input: re2js rejects most inputs by its literal prefilter without running an automaton,
 * and anything else costs one automaton pass; only inputs that do match pay for the set
 * pass that names the matching patterns. When the joined sources are not valid RE2, the
 * set matches every input itself. Compilation cost grows with the pattern, so callers run
 * this off the request thread.
 */
export function compilePatterns(
  patterns: readonly string[],
  trusted: readonly string[] = [],
): PatternMatcher {
  if (patterns.length > MAX_PATTERNS)
    throw new PatternError(MAX_PATTERNS, `at most ${MAX_PATTERNS} patterns are accepted`);
  const compiled = patterns.map((pattern, index) => checkCallerPattern(pattern, index));
  const sources = patterns.concat(trusted);
  if (sources.length === 0) throw new Error('No patterns to compile');
  if (sources.length === 1) {
    const only = compiled[0] ?? RE2JS.compile(sources[0]);
    return { match: (input) => (only.test(input) ? [0] : NO_MATCH) };
  }
  const set = new RE2Set();
  for (const source of sources) set.add(source);
  set.compile();
  const gate = compileGate(sources);
  return {
    match(input) {
      if (gate !== null && !gate.test(input)) return NO_MATCH;
      const found = set.match(input);
      return found.length === 0 ? NO_MATCH : found.sort((a, b) => a - b);
    },
  };
}
