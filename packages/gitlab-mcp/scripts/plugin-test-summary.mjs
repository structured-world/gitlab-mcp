import { writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { spec } from 'node:test/reporters';

/** Keep human output and completion evidence on one reporter pipeline. */
export default async function* summary(source) {
  const destination = process.env.PLUGIN_TEST_SUMMARY;
  if (!destination) throw new Error('The qualification runner must supply its summary path.');
  async function* observe() {
    for await (const event of source) {
      if (event.type === 'test:summary' && event.data.file === undefined)
        writeFileSync(
          destination,
          JSON.stringify({ success: event.data.success, counts: event.data.counts }),
        );
      yield event;
    }
  }
  yield* Readable.from(observe()).pipe(new spec());
}
