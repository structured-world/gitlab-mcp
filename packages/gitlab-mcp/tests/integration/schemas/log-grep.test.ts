import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { buildCiConfigBase64, getTestData } from '../../setup/testConfig';

const Pipeline = z.object({ id: z.coerce.string() });
const Jobs = z.array(z.object({ id: z.coerce.string(), name: z.string(), status: z.string() }));
const Grep = z.object({
  hunks: z.array(
    z.object({
      start_line: z.number(),
      lines: z.array(z.string()),
      matches: z.array(z.object({ line: z.number(), patterns: z.array(z.number()) })),
    }),
  ),
  match_count: z.number(),
  total_lines: z.number().nullable(),
  truncated: z.string().nullable(),
});
const Logs = z.object({ trace: z.string(), startLine: z.number() });
// Counted from the start of the test: with one more jobs request (up to the 120 s request
// timeout of the test env) and the searches after it, the test ends within its 10-minute
// limit, so a stuck job is still cancelled in finally.
const JOB_WAIT_MS = 6 * 60_000;

// The lifecycle owns this test/ project; the suite creates and cancels only its own pipeline.
describe('job log search - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let projectId: string;
  beforeAll(async () => {
    const project = getTestData().project;
    if (!project?.path_with_namespace.startsWith('test/')) {
      throw new Error('Log search tests require a suite-owned project under test/');
    }
    projectId = project.path_with_namespace;
    helper = new IntegrationTestHelper();
    await helper.initialize();
    await helper.executeTool('manage_files', {
      action: 'single',
      project_id: projectId,
      file_path: '.gitlab-ci.yml',
      branch: 'main',
      content: buildCiConfigBase64(`log search fixture ${randomUUID()}`),
      encoding: 'base64',
      commit_message: 'Prepare job log search fixture',
      overwrite: true,
    });
  });

  // A real runner trace carries colors and section markers; matches use the rendered text.
  it('finds rendered script output and points logs at the same line', async () => {
    const deadline = Date.now() + JOB_WAIT_MS;
    let pipelineId: string | undefined;
    let jobComplete = false;
    try {
      pipelineId = Pipeline.parse(
        await helper.executeTool('manage_pipeline', {
          action: 'create',
          project_id: projectId,
          ref: 'main',
        }),
      ).id;
      let jobId: string | undefined;
      while (Date.now() < deadline && !jobId) {
        const jobs = Jobs.parse(
          await helper.executeTool('browse_pipelines', {
            action: 'jobs',
            project_id: projectId,
            pipeline_id: pipelineId,
          }),
        );
        const job = jobs.find((item) => item.name === 'test-job');
        if (job && ['failed', 'canceled', 'skipped'].includes(job.status))
          throw new Error(`Log search fixture job ended with status ${job.status}`);
        if (job?.status === 'success') jobId = job.id;
        else await delay(1000);
      }
      if (!jobId)
        throw new Error(`Log search fixture job did not complete within ${JOB_WAIT_MS / 1000} s`);
      jobComplete = true;

      // The echo output line, not the colored "$ echo ..." command line, matches the anchor.
      const result = Grep.parse(
        await helper.executeTool('browse_pipelines', {
          action: 'log_grep',
          project_id: projectId,
          job_id: jobId,
          patterns: ['^Environment is test$'],
          before: 1,
          after: 0,
        }),
      );
      expect(result).toMatchObject({ match_count: 1, truncated: null });
      const match = result.hunks[0].matches[0];
      const hunk = result.hunks[0];
      expect(hunk.lines.at(-1)).toBe('Environment is test');
      expect(hunk.lines.join('\n')).not.toContain('\u001b');
      expect(result.total_lines).toBeGreaterThan(match.line);

      const page = Logs.parse(
        await helper.executeTool('browse_pipelines', {
          action: 'logs',
          project_id: projectId,
          job_id: jobId,
          start: match.line,
          per_page: 1,
        }),
      );
      expect(page.startLine).toBe(match.line);
      expect(page.trace).toContain('Environment is test');

      await expect(
        helper.executeTool('browse_pipelines', {
          action: 'log_grep',
          project_id: projectId,
          job_id: jobId,
          patterns: ['(unclosed'],
        }),
      ).rejects.toThrow('Invalid RE2 pattern 0');
    } finally {
      if (pipelineId !== undefined && !jobComplete) {
        await helper.executeTool('manage_pipeline', {
          action: 'cancel',
          project_id: projectId,
          pipeline_id: pipelineId,
        });
      }
    }
  });
});
