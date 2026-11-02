import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

// Refresh downloads after the release workflow has finished uploading its assets.
test('docs rebuild after release publication completes', () => {
  const workflow = parse(
    readFileSync(join(__dirname, '../../../../../.github/workflows/docs.yml'), 'utf8'),
  );
  expect(workflow.on.workflow_run.workflows).toContain('Release');
});
