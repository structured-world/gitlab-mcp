/**
 * Single-valued parameters of a form-encoded OAuth request
 */

/**
 * The named parameters of a request body, or the name of one that is not a single string.
 * RFC 6749 section 3.2: request parameters must not be included more than once; a repeated
 * one arrives as an array (or an object, with nested syntax) and must not reach a lookup.
 */
export function singleValuedParams<Name extends string>(
  body: unknown,
  names: readonly Name[],
): Partial<Record<Name, string>> | Name {
  const source = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const params: Partial<Record<Name, string>> = {};
  for (const name of names) {
    const value = source[name];
    if (value === undefined) continue;
    if (typeof value !== 'string') return name;
    params[name] = value;
  }
  return params;
}
