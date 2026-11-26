import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { reportBytes } from '../../../../src/entities/pipelines/artifact-report';

/** A source that hands out the given chunks one read at a time and records its cancellation. */
function source(chunks: (Uint8Array | Error)[]): {
  body: ReadableStream<Uint8Array>;
  cancelled: () => unknown;
} {
  let index = 0;
  let reason: unknown;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const next = chunks[index++];
        if (next === undefined) controller.close();
        else if (next instanceof Error) controller.error(next);
        else controller.enqueue(next);
      },
      cancel(why) {
        reason = why ?? 'cancelled';
      },
    },
    { highWaterMark: 0 },
  );
  return { body, cancelled: () => reason };
}

async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return Buffer.from(await new Response(stream).arrayBuffer()).toString();
}

const bytes = (value: string): Uint8Array => Buffer.from(value);

describe('reportBytes', () => {
  // An uncompressed report arrives in as many chunks as the transport makes; none may be lost.
  it('passes an uncompressed report through chunk by chunk', async () => {
    const { body } = source([bytes('{"a":'), bytes('1,"b"'), bytes(':2}')]);
    expect(await text(await reportBytes(body))).toBe('{"a":1,"b":2}');
  });

  it('reads an empty download as an empty report', async () => {
    const { body } = source([]);
    expect(await text(await reportBytes(body))).toBe('');
  });

  // The two signature bytes can land in different chunks; reading only the first chunk would
  // return the compressed bytes as if they were the report.
  it('recognises gzip when its signature is split across chunks', async () => {
    const stored = gzipSync(Buffer.from('<testsuite/>\n'));
    const { body } = source([stored.subarray(0, 1), stored.subarray(1, 3), stored.subarray(3)]);
    expect(await text(await reportBytes(body))).toBe('<testsuite/>\n');
  });

  // Zero-length chunks carry no signature bytes and must not end the detection early.
  it('skips empty chunks while looking for the signature', async () => {
    const stored = gzipSync(Buffer.from('report'));
    const { body } = source([new Uint8Array(0), stored.subarray(0, 2), stored.subarray(2)]);
    expect(await text(await reportBytes(body))).toBe('report');
  });

  // The archive's signature may be split too, and the download is abandoned once it is seen.
  it('refuses a zip whose signature is split across chunks and stops the download', async () => {
    const { body, cancelled } = source([
      Buffer.from([0x50, 0x4b]),
      Buffer.from([0x03, 0x04, 1, 2, 3]),
      bytes('never read'),
    ]);
    await expect(reportBytes(body)).rejects.toMatchObject({
      name: 'ArtifactReadError',
      reason: 'report_type_unsupported',
    });
    expect(cancelled()).toBe('cancelled');
  });

  // A short text that merely starts like a zip signature is still text.
  it('does not take a shorter prefix for a zip', async () => {
    const { body } = source([Buffer.from([0x50, 0x4b, 0x03])]);
    expect(Buffer.from(await new Response(await reportBytes(body)).arrayBuffer())).toEqual(
      Buffer.from([0x50, 0x4b, 0x03]),
    );
  });

  // A caller that stops reading stops the transfer of an uncompressed report.
  it('cancels the download when an uncompressed report is abandoned', async () => {
    const { body, cancelled } = source([bytes('first'), bytes('second')]);
    const reader = (await reportBytes(body)).getReader();
    await reader.read();
    await reader.cancel('enough');
    expect(cancelled()).toBe('enough');
  });

  // The same for a compressed report: abandoning it must not leave the download running.
  it('cancels the download when a compressed report is abandoned', async () => {
    // Random text barely compresses, so the stored file is far larger than any read-ahead
    // and the download is still open when the reader stops.
    const report = randomBytes(1024 * 1024).toString('base64');
    const stored = gzipSync(Buffer.from(report));
    const pieces: Uint8Array[] = [];
    for (let offset = 0; offset < stored.length; offset += 1024)
      pieces.push(stored.subarray(offset, offset + 1024));
    const { body, cancelled } = source(pieces);
    const reader = (await reportBytes(body)).getReader();
    const { value } = await reader.read();
    expect(Buffer.from(value!).toString()).toBe(report.slice(0, value!.byteLength));
    await reader.cancel('enough');
    expect(cancelled()).toBe('enough');
  });

  // A transport failure in the middle of a compressed report is not a compression fault:
  // it keeps its own error instead of being reported as damaged gzip.
  it('keeps a transport error raised while inflating', async () => {
    const stored = gzipSync(Buffer.alloc(256 * 1024, 65));
    const failure = Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' });
    const { body } = source([stored.subarray(0, 64), failure]);
    await expect(text(await reportBytes(body))).rejects.toMatchObject({ code: 'UND_ERR_SOCKET' });
  });

  // A failure that carries no error code, or is not an object at all, is not taken for a
  // compression fault either.
  it.each([new Error('plain failure'), 'aborted'])(
    'keeps the failure %p raised while inflating',
    async (failure) => {
      const stored = gzipSync(Buffer.alloc(256 * 1024, 65));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(stored.subarray(0, 64));
        },
        pull(controller) {
          controller.error(failure);
        },
      });
      const outcome = await text(await reportBytes(body)).catch((error: unknown) => error);
      expect(outcome).toBe(failure);
    },
  );

  // Truncated gzip is a compression fault and is named as one.
  it('reports truncated gzip as invalid compression', async () => {
    const stored = gzipSync(Buffer.alloc(256 * 1024, 65));
    const { body } = source([stored.subarray(0, 64)]);
    await expect(text(await reportBytes(body))).rejects.toMatchObject({
      reason: 'invalid_compression',
    });
  });
});
