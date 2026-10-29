import { parseAllDocuments } from 'yaml';
import { buildCiConfigBase64 } from '../../setup/testConfig';

// A # inside a shell filename must survive YAML parsing rather than start a YAML comment.
it('preserves the artifact fixture commands and upload paths in CI YAML', () => {
  const documents = parseAllDocuments(Buffer.from(buildCiConfigBase64(), 'base64').toString());
  expect(documents).toHaveLength(2);
  expect(documents.flatMap((document) => document.errors)).toEqual([]);
  const job = documents[1].toJS()['test-job'];
  expect(job.artifacts.paths).toEqual(['reports/']);
  const copy = job.script.find((command: string) => command.startsWith('cp '));
  expect(copy).toContain('"reports/nested/a #?.txt"');
  expect(job.script).toContain(
    String.raw`printf 'Artifact report A\342\202\254\360\237\230\200\n' > reports/nested/result.txt`,
  );
  expect(job.script).toContain(String.raw`printf '\000\377' > reports/binary.bin`);
});
