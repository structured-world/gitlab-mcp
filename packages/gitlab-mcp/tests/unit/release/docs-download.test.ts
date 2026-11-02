import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

// An unrelated later publishing failure must not suppress already-uploaded downloads.
test('MCPB publication triggers docs before subsequent publishing steps', () => {
  const workflow = parse(
    readFileSync(join(__dirname, '../../../../../.github/workflows/docs.yml'), 'utf8'),
  );
  const release = parse(
    readFileSync(join(__dirname, '../../../../../.github/workflows/release-please.yml'), 'utf8'),
  );
  const steps = release.jobs['post-release'].steps;
  const upload = steps.findIndex((step: { name: string }) =>
    step.name === 'Upload MCPB bundles to GitHub Release',
  );
  const notification = steps.findIndex((step: { run?: string }) =>
    step.run?.includes('event_type=mcpb-published'),
  );
  const docker = steps.findIndex((step: { name: string }) => step.name === 'Set up Docker Buildx');
  expect(upload).toBeGreaterThanOrEqual(0);
  expect(notification).toBeGreaterThan(upload);
  expect(notification).toBeLessThan(docker);
  expect(steps[notification].if).toBeUndefined();
  expect(steps[notification]['continue-on-error']).toBeUndefined();
  expect(workflow.on.repository_dispatch.types).toEqual(['mcpb-published']);
  expect(workflow.on.workflow_run).toBeUndefined();
  expect(workflow.jobs.build.if).toBeUndefined();
});
