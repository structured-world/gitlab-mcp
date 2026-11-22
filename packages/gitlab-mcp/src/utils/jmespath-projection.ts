import {
  compile,
  isRegistered,
  registerFunction,
  TreeInterpreter,
  TYPE_STRING,
  type ExpressionNode,
  type JSONValue,
} from '@jmespath-community/jmespath';
import type { RE2JS } from 're2js';
import { compileCallerPattern } from './re2-compile';

/** Longest projection expression accepted, in UTF-16 code units. */
export const JMESPATH_MAX_LENGTH = 2048;
/** The argument a read action takes its projection from. */
export const JMESPATH_ARGUMENT = 'jmespath';
/** One-line description shown on every action that accepts a projection. */
export const JMESPATH_DESCRIPTION =
  "JMESPath to filter or reshape the JSON result, e.g. [?status=='failed'].id; " +
  'adds re_test/re_find/re_replace (RE2).';

/** Bounds on one expression; the result it runs on is already a bounded tool result. */
const COMPILE_LIMITS = { maxDepth: 64, maxNodes: 512 } as const;
/** Evaluation runs in the request thread, so it is stopped on time and output size. */
const EVALUATION_LIMITS = { ...COMPILE_LIMITS, timeoutMs: 1000, maxOutputSize: 10_000 } as const;
/** Compiled RE2 patterns kept for repeated function calls across rows and requests. */
const PATTERN_CACHE_SIZE = 64;

/** Top-level fields that say where the next page starts; kept beside the projected data. */
const CONTINUATION_FIELDS = ['pageInfo', 'hasMore', 'endCursor'] as const;
/** Top-level fields that say the result is incomplete; kept beside the projected data. */
const COMPLETENESS_FIELDS = ['partial', 'truncated', 'overflow', 'compare_timeout'];
/** Fields of an object result that hold its rows, in the order they are looked for. */
const ROW_FIELDS = ['items', 'nodes', 'results', 'changes', 'diffs', 'files'];

/** A projection the caller asked for that cannot be compiled or evaluated. */
export class ProjectionError extends Error {
  constructor(message: string) {
    super(`Invalid jmespath expression: ${message}`);
    this.name = 'ProjectionError';
  }
}

/** A compiled projection and the expression it came from. */
export interface Projection {
  readonly expression: string;
  readonly ast: ExpressionNode;
}

/** The projected result as the tool returns it. */
export interface ProjectedResult {
  data: JSONValue;
  jmespath: {
    expression: string;
    input_items: number;
    output_items: number;
    note?: string;
  };
  next_page?: Record<string, unknown>;
  [completeness: string]: unknown;
}

const patterns = new Map<string, RE2JS>();

/** A caller pattern under the RE2 contract, cached least recently used first out. */
function pattern(source: string): RE2JS {
  const cached = patterns.get(source);
  if (cached) {
    // Re-inserting moves the entry to the end, so eviction takes the least recent.
    patterns.delete(source);
    patterns.set(source, cached);
    return cached;
  }
  const compiled = compileCallerPattern(source, 0);
  if (patterns.size === PATTERN_CACHE_SIZE) {
    const oldest = patterns.keys().next().value;
    if (oldest !== undefined) patterns.delete(oldest);
  }
  patterns.set(source, compiled);
  return compiled;
}

const STRING_ARGUMENT = { types: [TYPE_STRING] };
const RE2_FUNCTIONS: Record<string, { arity: number; run: (args: string[]) => JSONValue }> = {
  re_test: { arity: 2, run: ([text, source]) => pattern(source).test(text) },
  re_find: {
    arity: 2,
    run: ([text, source]) => {
      const matcher = pattern(source).matcher(text);
      return matcher.find() ? matcher.group() : null;
    },
  },
  re_replace: {
    arity: 3,
    // JS replacement syntax: $1 and $<name> refer to groups, $$ is a literal dollar.
    run: ([text, source, replacement]) => pattern(source).matcher(text).replaceAll(replacement),
  },
};

for (const [name, { arity, run }] of Object.entries(RE2_FUNCTIONS)) {
  // The function table is process-wide; a second import of this module must not fail.
  if (isRegistered(name)) continue;
  registerFunction(
    name,
    (args) => run(args as string[]),
    Array.from({ length: arity }, () => STRING_ARGUMENT),
  );
}

/** Names of the functions an expression calls, in the order they appear. */
function calledFunctions(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) calledFunctions(child, found);
    return found;
  }
  if (node === null || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  // A literal's value is data, not syntax: a JSON literal shaped like a node is not a call.
  if (record.type === 'Literal') return found;
  if (record.type === 'Function' && typeof record.name === 'string') found.push(record.name);
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'type' && key !== 'name') calledFunctions(value, found);
  }
  return found;
}

/**
 * Compile a projection before anything is fetched: syntax errors and unknown functions are
 * refused here, as the evaluator would only find an unknown function on the first row.
 */
export function compileProjection(expression: string): Projection {
  if (expression.trim().length === 0) throw new ProjectionError('expression is empty');
  if (expression.length > JMESPATH_MAX_LENGTH)
    throw new ProjectionError(`expression exceeds ${JMESPATH_MAX_LENGTH} characters`);
  let ast: ExpressionNode;
  try {
    ast = compile(expression, COMPILE_LIMITS);
  } catch (error) {
    throw new ProjectionError(error instanceof Error ? error.message : String(error));
  }
  const unknown = calledFunctions(ast).find((name) => !isRegistered(name));
  if (unknown !== undefined) throw new ProjectionError(`unknown function ${unknown}()`);
  return { expression, ast };
}

/** The rows a result holds: an array's elements, an object's row field, or the object. */
function rowCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value === null || value === undefined) return 0;
  if (typeof value !== 'object') return 1;
  const record = value as Record<string, unknown>;
  for (const field of ROW_FIELDS) {
    const rows = record[field];
    if (Array.isArray(rows)) return rows.length;
  }
  return 1;
}

function isEmpty(value: JSONValue): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'object' && Object.keys(value).length === 0;
}

/**
 * Apply a projection to a tool result. Where the next page starts and whether the result is
 * incomplete are kept beside the data, so the expression cannot drop them.
 */
export function applyProjection(projection: Projection, result: unknown): ProjectedResult {
  let data: JSONValue;
  try {
    data = TreeInterpreter.search(projection.ast, result as JSONValue, EVALUATION_LIMITS);
  } catch (error) {
    throw new ProjectionError(error instanceof Error ? error.message : String(error));
  }
  const inputItems = rowCount(result);
  const outputItems = isEmpty(data) ? 0 : rowCount(data);
  const projected: ProjectedResult = {
    data,
    jmespath: {
      expression: projection.expression,
      input_items: inputItems,
      output_items: outputItems,
      ...(outputItems === 0 && { note: `Nothing matched out of ${inputItems} input items.` }),
    },
  };
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return projected;
  const record = result as Record<string, unknown>;
  const continuation: Record<string, unknown> = {};
  for (const field of CONTINUATION_FIELDS)
    if (record[field] !== undefined) continuation[field] = record[field];
  if (Object.keys(continuation).length > 0) projected.next_page = continuation;
  for (const field of COMPLETENESS_FIELDS)
    if (record[field] !== undefined) projected[field] = record[field];
  // A partial page says why in its message; elsewhere a message is ordinary data.
  if (record.partial === true && record.message !== undefined) projected.message = record.message;
  return projected;
}
