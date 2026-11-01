/** Synthetic streams only: enforce response budgets before copying excess bytes. */
import { readBoundedJson, readBoundedText, ResponseLimitError } from '../../src/utils/bounded-json';

it('decodes JSON across UTF-8 chunk boundaries at the exact byte limit', async () => {
  const bytes = new TextEncoder().encode('{"text":"😀"}');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  expect(await readBoundedJson(new Response(stream), bytes.length)).toEqual({ text: '😀' });
});

it('cancels before copying a chunk that exceeds the response budget', async () => {
  const cancel = jest.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(33));
    },
    cancel,
  });
  await expect(readBoundedText(new Response(stream), 32)).rejects.toBeInstanceOf(
    ResponseLimitError,
  );
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(stream.locked).toBe(false);
});

// A failed provider stream must retain its error and release the exclusive reader.
it('releases the stream reader after a provider read failure', async () => {
  const failure = new Error('Provider stream failed');
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(failure);
    },
  });
  await expect(readBoundedText(new Response(stream), 32)).rejects.toBe(failure);
  expect(stream.locked).toBe(false);
});

it('rejects malformed UTF-8 rather than silently replacing answer text', async () => {
  await expect(readBoundedText(new Response(Uint8Array.of(0xff)), 32)).rejects.toThrow();
});

it('rejects malformed JSON without treating it as an empty successful response', async () => {
  await expect(readBoundedJson(new Response('{'), 32)).rejects.toThrow(SyntaxError);
});

it('grows a response buffer without losing preceding chunks', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('a'.repeat(16000)));
      controller.enqueue(new TextEncoder().encode('b'.repeat(16000)));
      controller.close();
    },
  });
  expect(await readBoundedText(new Response(stream), 32000)).toBe(
    'a'.repeat(16000) + 'b'.repeat(16000),
  );
});

it('rejects invalid limits and absent response bodies', async () => {
  await expect(readBoundedText(new Response(''), 0)).rejects.toThrow();
  await expect(readBoundedText(new Response(null), 32)).rejects.toThrow();
});
