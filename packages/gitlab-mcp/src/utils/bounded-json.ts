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
  const reader = response.body.getReader();
  let buffer = new Uint8Array(Math.min(16384, limit));
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > limit - length) {
        await reader.cancel();
        throw new ResponseLimitError(limit);
      }
      const required = length + chunk.value.byteLength;
      if (required > buffer.byteLength) {
        const grown = new Uint8Array(Math.max(required, Math.min(buffer.byteLength * 2, limit)));
        grown.set(buffer.subarray(0, length));
        buffer = grown;
      }
      buffer.set(chunk.value, length);
      length = required;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  return JSON.parse(await readBoundedText(response, limit)) as unknown;
}
