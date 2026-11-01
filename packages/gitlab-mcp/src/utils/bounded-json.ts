/** A response exceeded its caller's byte budget before parsing or copying it. */
export class ResponseLimitError extends Error {
  constructor(readonly limit: number) {
    super(
      `GitLab response exceeds the ${limit}-byte limit; narrow the request or use GitLab directly`,
    );
  }
}

/** Grow geometrically within a fixed ceiling, without retaining every network chunk. */
export async function readBoundedText(response: Response, limit: number): Promise<string> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError('Invalid response byte limit');
  if (!response.body) throw new Error('GitLab returned an empty response body');
  let buffer = new Uint8Array(Math.min(16384, limit));
  let length = 0;
  for await (const chunk of response.body) {
    if (chunk.byteLength > limit - length) {
      throw new ResponseLimitError(limit);
    }
    const required = length + chunk.byteLength;
    if (required > buffer.byteLength) {
      const grown = new Uint8Array(Math.max(required, Math.min(buffer.byteLength * 2, limit)));
      grown.set(buffer.subarray(0, length));
      buffer = grown;
    }
    buffer.set(chunk, length);
    length = required;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
}

export async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  return JSON.parse(await readBoundedText(response, limit)) as unknown;
}
