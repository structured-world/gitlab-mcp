import { readArtifactWindow } from '../../../../src/entities/pipelines/artifact-window';

// Continuations must reconstruct the source, never replace or drop a split UTF-8 character.
it('reconstructs multibyte text across small byte windows', async () => {
  const original = 'A\u20ac\ud83d\ude00B\n';
  let offset = 0;
  let text = '';
  for (;;) {
    const page = await readArtifactWindow(new Response(original), offset, 4);
    text += page.text;
    expect(page.byte_end - page.byte_start).toBe(Buffer.byteLength(page.text));
    if (page.next_byte_offset === null) break;
    expect(page.next_byte_offset).toBeGreaterThan(offset);
    offset = page.next_byte_offset;
  }
  expect(text).toBe(original);
});

// EOF of an HTTP partial response does not prove EOF of a file whose size is unknown.
it('keeps a continuation when Content-Range has an unknown total', async () => {
  const page = await readArtifactWindow(
    new Response('abc', {
      status: 206,
      headers: { 'Content-Range': 'bytes 8-10/*' },
    }),
    8,
    4,
  );
  expect(page).toEqual({
    text: 'abc',
    byte_start: 8,
    byte_end: 11,
    next_byte_offset: 11,
    total_bytes: null,
    complete: false,
    truncated: true,
  });
});

// An uncooperative 200 response is scanned incrementally and cancelled near the requested window.
it('bounds reads and cancels a huge chunked body without Content-Length', async () => {
  let pulled = 0;
  const cancel = jest.fn();
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024).fill(65));
      },
      cancel,
    }),
  );
  const page = await readArtifactWindow(response, 128 * 1024, 200);
  expect(page.text).toBe('A'.repeat(200));
  expect(page.total_bytes).toBeNull();
  expect(page.complete).toBe(false);
  expect(pulled).toBeLessThanOrEqual(256 * 1024);
  expect(cancel).toHaveBeenCalledTimes(1);
});

// The source can be empty or exactly end at the requested window.
it.each(['', 'abc'])('recognizes complete content %j', async (text) => {
  const page = await readArtifactWindow(new Response(text), 0, 4);
  expect(page).toEqual({
    text,
    byte_start: 0,
    byte_end: text.length,
    next_byte_offset: null,
    total_bytes: text.length,
    complete: true,
    truncated: false,
  });
});

// Malformed ranges must not attach a requested offset to bytes from another interval.
it.each(['bytes 0-2/20', 'bytes 8-15/10', 'bytes 8-99/100', 'garbage', null])(
  'rejects Content-Range %j',
  async (header) => {
    const headers = new Headers();
    if (header !== null) headers.set('Content-Range', header);
    await expect(
      readArtifactWindow(new Response('abc', { status: 206, headers }), 8, 4),
    ).rejects.toThrow('Content-Range');
  },
);

// A valid range must match its body length, including premature EOF and surplus bytes.
it.each(['ab', 'abcd'])('rejects a lying ranged body %j', async (text) => {
  await expect(
    readArtifactWindow(
      new Response(text, {
        status: 206,
        headers: { 'Content-Range': 'bytes 8-10/11' },
      }),
      8,
      4,
    ),
  ).rejects.toThrow('Content-Range');
});

// A UTF-8 boundary cannot be silently repaired by skipping or replacing source bytes.
it.each([
  ['\u20ac', 1, 4, 'byte_offset'],
  ['\ud83d\ude00', 0, 1, 'byte_limit'],
  ['abc', 4, 4, 'beyond'],
])('rejects invalid offset/window for %j', async (text, offset, limit, message) => {
  await expect(readArtifactWindow(new Response(text), offset, limit)).rejects.toThrow(message);
});

// Binary and invalid UTF-8 bytes must not become replacement characters in apparent text.
it.each([Buffer.from([0, 1, 2]), Buffer.from([0xff]), Buffer.from([0xe2, 0x82])])(
  'rejects non-text bytes %j',
  async (bytes) => {
    await expect(readArtifactWindow(new Response(bytes), 0, 8)).rejects.toThrow(/binary|UTF-8/);
  },
);

// HTTP content coding is refused before reading bytes because the transport never inflates it.
it('rejects unexpected gzip encoding', async () => {
  await expect(
    readArtifactWindow(
      new Response('compressed', {
        headers: { 'Content-Encoding': 'gzip' },
      }),
      0,
      8,
    ),
  ).rejects.toThrow('encoding');
});

// A known binary media type needs no body scan or buffer allocation to refuse text decoding.
it('refuses a known binary MIME type before reading its body', async () => {
  const pull = jest.fn((controller) => controller.enqueue(new Uint8Array(64 * 1024).fill(65)));
  const response = new Response(new ReadableStream({ pull }, { highWaterMark: 0 }), {
    headers: { 'Content-Type': 'image/png' },
  });
  await expect(readArtifactWindow(response, 0, 8)).rejects.toMatchObject({ reason: 'not_text' });
  expect(pull).not.toHaveBeenCalled();
});

// A broken transfer cannot return a successful partial document or replace the source error.
it('propagates a stream failure and releases its reader', async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('fixture transfer failed'));
      },
    }),
  );
  await expect(readArtifactWindow(response, 0, 8)).rejects.toThrow('fixture transfer failed');
  expect(response.body?.locked).toBe(false);
});

// Content-Length is never used as proof of EOF, whether it understates or overstates the body.
it.each(['1', '999999999'])('does not trust Content-Length %s', async (length) => {
  const page = await readArtifactWindow(
    new Response('complete text', {
      headers: { 'Content-Length': length },
    }),
    0,
    20,
  );
  expect(page).toMatchObject({ text: 'complete text', total_bytes: 13, complete: true });
});

// A truncated result cannot advertise a continuation that the schema will refuse.
it('explicitly reports the end of the supported continuation range', async () => {
  const offset = 20 * 1024 * 1024;
  const page = await readArtifactWindow(
    new Response('abcdefgh', {
      status: 206,
      headers: { 'Content-Range': `bytes ${offset}-${offset + 7}/${offset + 100}` },
    }),
    offset,
    4,
  );
  expect(page).toMatchObject({
    text: 'abcd',
    complete: false,
    truncated: true,
    next_byte_offset: null,
    continuation_limit: { reason: 'byte_offset_limit', max_byte_offset: offset },
  });
});

// HTTP range-unit tokens are case-insensitive, unlike filenames and archive paths.
it('accepts a case-insensitive bytes range unit', async () => {
  expect(
    await readArtifactWindow(
      new Response('abc', {
        status: 206,
        headers: { 'Content-Range': 'Bytes 0-2/3' },
      }),
      0,
      4,
    ),
  ).toMatchObject({ text: 'abc', total_bytes: 3, complete: true });
});

// An unsatisfied range cannot claim EOF without a safe size equal to the requested offset.
it.each([
  ['garbage', 3, 'invalid_range'],
  ['bytes */4', 3, 'invalid_range'],
  ['bytes */3', 4, 'invalid_offset'],
  ['bytes */999999999999999999', 0, 'invalid_range'],
])('rejects unsatisfied range %s at %i', async (header, offset, reason) => {
  await expect(
    readArtifactWindow(
      new Response('', {
        status: 416,
        headers: { 'Content-Range': header },
      }),
      offset,
      4,
    ),
  ).rejects.toMatchObject({ reason });
});
