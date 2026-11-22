import {
  compile,
  isRegistered,
  registerFunction,
  TreeInterpreter,
  TYPE_STRING,
  type ExpressionNode,
  type JSONValue,
} from '@jmespath-community/jmespath';
import type { MessagePort } from 'node:worker_threads';
import type { RE2JS } from 're2js';
import * as z from 'zod';
import { compileCallerPattern } from './re2-compile';

// Worker threads load this module with Node type stripping, so it uses only erasable syntax.

/** Longest projection expression accepted, in UTF-16 code units. */
export const JMESPATH_MAX_LENGTH = 2048;
/** Most characters a projected result may serialize to, counted before it is serialized. */
export const JMESPATH_MAX_OUTPUT_CHARS = 4 * 1024 * 1024;
/** The argument a read action takes its projection from. */
export const JMESPATH_ARGUMENT = 'jmespath';
/** One-line description shown on every action that accepts a projection. */
export const JMESPATH_DESCRIPTION =
  "JMESPath to filter or reshape the JSON result, e.g. [?status=='failed'].id; " +
  'adds re_test/re_find/re_replace (RE2).';

const INVALID = 'Invalid jmespath expression: ';

/** The `jmespath` argument as a call may send it. */
export const JmespathExpressionSchema = z
  .string({ error: `'${JMESPATH_ARGUMENT}' must be a string expression.` })
  .refine((expression) => expression.trim().length > 0, {
    error: `${INVALID}expression is empty`,
  })
  .refine((expression) => expression.length <= JMESPATH_MAX_LENGTH, {
    error: `${INVALID}expression exceeds ${JMESPATH_MAX_LENGTH} characters`,
  });

/** Bounds on one expression; the result it runs on is already a bounded tool result. */
const COMPILE_LIMITS = { maxDepth: 64, maxNodes: 512 } as const;
/**
 * The evaluator's own deadline (the worker running it is stopped if a single step outlasts
 * it) and its cap on one string, list or object along the way, set to the result budget so
 * no single value the result could hold is refused early; the result itself is measured
 * as serialized.
 */
const EVALUATION_LIMITS = {
  ...COMPILE_LIMITS,
  timeoutMs: 1000,
  maxOutputSize: JMESPATH_MAX_OUTPUT_CHARS,
} as const;
/** Compiled RE2 patterns kept for repeated function calls across rows and requests. */
const PATTERN_CACHE_SIZE = 64;

/** Top-level fields that say where the next page starts; kept beside the projected data. */
const CONTINUATION_FIELDS = ['pageInfo', 'hasMore', 'endCursor'] as const;
/**
 * Top-level fields of the results of projectable actions that say the result is incomplete
 * or filtered, kept beside the projected data so an expression cannot drop them: scoped and
 * diff results, diff line search (`not_scanned`, `_filtered`), user search (`_warning`,
 * `searchMetadata`) and Duo session listings.
 */
const COMPLETENESS_FIELDS = [
  'partial',
  'truncated',
  'overflow',
  'compare_timeout',
  'not_scanned',
  '_filtered',
  '_warning',
  'searchMetadata',
  'skipped_unverifiable_sessions',
] as const;
/** Fields of an object result that hold its rows, in the order they are looked for. */
const ROW_FIELDS = [
  'items',
  'nodes',
  'results',
  'changes',
  'diffs',
  'files',
  'users',
  'discussions',
  'sessions',
];

/** A projection the caller asked for that cannot be compiled or evaluated. */
export class ProjectionError extends Error {
  readonly detail: string;

  constructor(detail: string) {
    super(`${INVALID}${detail}`);
    this.name = 'ProjectionError';
    this.detail = detail;
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
 * refused here, as the evaluator would only find an unknown function on the first row. The
 * expression is one `JmespathExpressionSchema` accepted.
 */
export function compileProjection(expression: string): Projection {
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

/**
 * The `jmespath` argument of a call compiled, or why it is refused: validated by
 * `JmespathExpressionSchema`, then compiled before anything is fetched.
 */
export function checkProjection(expression: unknown): Projection | { refusal: string } {
  const parsed = JmespathExpressionSchema.safeParse(expression);
  if (!parsed.success) return { refusal: parsed.error.issues[0].message };
  try {
    return compileProjection(parsed.data);
  } catch (error) {
    // compileProjection reports every failure as a ProjectionError.
    return { refusal: (error as ProjectionError).message };
  }
}

/**
 * Characters a string takes in JSON, quotes included, counted until `limit` is passed.
 * ECMA-262 JSON.stringify (QuoteJSONString): `"` and `\` and the short-escaped controls
 * take two characters, other controls and lone surrogates six (`\uXXXX`).
 */
function quotedLength(text: string, limit: number): number {
  let length = 2;
  for (let index = 0; index < text.length && length <= limit; index++) {
    const code = text.charCodeAt(index);
    if (code === 34 || code === 92) length += 2;
    else if (code < 0x20)
      length += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
    else if (code >= 0xd800 && code <= 0xdfff) {
      const next = text.charCodeAt(index + 1);
      const paired = code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
      length += paired ? 2 : 6;
      if (paired) index++;
    } else length++;
  }
  return length;
}

/** Depth of the projected data inside the tool result object it is returned in. */
const DATA_DEPTH = 1;

/**
 * Whether a value written as the tool result writes it (JSON with two-space indentation,
 * at its depth in the result object) takes more than `budget` characters. A value an
 * expression repeats is counted at every occurrence, as serialization writes it each time,
 * and the walk stops once the budget is passed, so a result sharing one value 2^30 times
 * costs no more than the budget to reject.
 */
function exceedsSerializedSize(value: unknown, budget: number): boolean {
  let size = 0;
  const stack: Array<{ item: unknown; depth: number }> = [{ item: value, depth: DATA_DEPTH }];
  while (stack.length > 0 && size <= budget) {
    const { item, depth } = stack.pop() as { item: unknown; depth: number };
    if (typeof item === 'string') size += quotedLength(item, budget - size);
    else if (typeof item === 'number') size += Number.isFinite(item) ? String(item).length : 4;
    else if (item === null || typeof item !== 'object') size += String(item).length;
    else {
      const entries: Array<[string | null, unknown]> = Array.isArray(item)
        ? item.map((element): [null, unknown] => [null, element])
        : Object.entries(item);
      // Brackets, plus the closing bracket's own line and indentation when not empty.
      size += entries.length === 0 ? 2 : 3 + 2 * depth;
      for (const [key, element] of entries) {
        // Each member on its own line, indented one level deeper, with its separator.
        size += 2 * (depth + 1) + 2;
        if (key !== null) size += quotedLength(key, budget - size) + 2;
        stack.push({ item: element, depth: depth + 1 });
        if (size > budget) break;
      }
    }
  }
  return size > budget;
}

/** Evaluate a projection and refuse a result too large to return. */
export function evaluateProjection(expression: string, input: unknown): JSONValue {
  const { ast } = compileProjection(expression);
  let data: JSONValue;
  try {
    data = TreeInterpreter.search(ast, input as JSONValue, EVALUATION_LIMITS);
  } catch (error) {
    throw new ProjectionError(error instanceof Error ? error.message : String(error));
  }
  if (exceedsSerializedSize(data, JMESPATH_MAX_OUTPUT_CHARS))
    throw new ProjectionError(
      `the result exceeds ${JMESPATH_MAX_OUTPUT_CHARS} characters; select fewer fields or rows`,
    );
  return data;
}

/** One evaluation request sent to a projection worker. */
export interface ProjectionRequest {
  expression: string;
  input: unknown;
}

/** A projection worker's answer. */
export type ProjectionReply = { ok: true; data: JSONValue } | { ok: false; detail: string };

/** Serve evaluation requests in a worker thread; the parent stops it if one runs too long. */
export function serveProjection(port: MessagePort): void {
  port.on('message', (request: ProjectionRequest) => {
    let reply: ProjectionReply;
    try {
      reply = { ok: true, data: evaluateProjection(request.expression, request.input) };
    } catch (error) {
      reply = {
        ok: false,
        detail:
          error instanceof ProjectionError
            ? error.detail
            : error instanceof Error
              ? error.message
              : String(error),
      };
    }
    port.postMessage(reply);
  });
  port.postMessage({ ok: true, data: null } satisfies ProjectionReply);
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
 * The projected result as returned: where the next page starts and whether the result is
 * incomplete are kept beside the data, so the expression cannot drop them.
 */
export function projectionEnvelope(
  expression: string,
  result: unknown,
  data: JSONValue,
): ProjectedResult {
  const inputItems = rowCount(result);
  const outputItems = isEmpty(data) ? 0 : rowCount(data);
  const projected: ProjectedResult = {
    data,
    jmespath: {
      expression,
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
