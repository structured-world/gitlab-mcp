import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { getTestData } from '../../setup/testConfig';

const Pipeline = z.object({ id: z.coerce.string(), status: z.string() });
const Jobs = z.array(z.object({ id: z.coerce.string(), name: z.string() }));
const Window = z.object({
  text: z.string(),
  byte_start: z.number(),
  byte_end: z.number(),
  next_byte_offset: z.number().nullable(),
  total_bytes: z.number().nullable(),
  complete: z.boolean(),
});
const Grep = z.object({
  match_count: z.number(),
  hunks: z.array(z.object({ byte_offset: z.number(), lines: z.array(z.string()) })),
});
// Leaves room for the reads and cleanup within the 10-minute test limit.
const PIPELINE_WAIT_MS = 6 * 60_000;

// The JUnit file is collected only as a report: no artifacts:paths, so no archive entry.
const REPORT =
  '<testsuite name="report only A€">\n<testcase name="passes"/>\n<testcase name="fails"><failure>boom</failure></testcase>\n</testsuite>\n';
const CI = String.raw`junit-job:
  script:
    - printf '<testsuite name="report only A\342\202\254">\n<testcase name="passes"/>\n<testcase name="fails"><failure>boom</failure></testcase>\n</testsuite>\n' > junit.xml
  artifacts:
    reports:
      junit: junit.xml
  rules:
    - if: '$CI_PIPELINE_SOURCE == "api"'
`;

// The suite works on its own branch of the test/ project and deletes it afterwards.
describe('report artifacts by type - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let projectId: string;
  const branch = `artifact-report-${randomUUID()}`;

  beforeAll(async () => {
    const project = getTestData().project;
    if (!project?.path_with_namespace.startsWith('test/')) {
      throw new Error('Report artifact tests require a suite-owned project under test/');
    }
    projectId = project.path_with_namespace;
    helper = new IntegrationTestHelper();
    await helper.initialize();
    await helper.executeTool('manage_ref', {
      action: 'create_branch',
      project_id: projectId,
      branch,
      ref: 'main',
    });
    await helper.executeTool('manage_files', {
      action: 'batch',
      project_id: projectId,
      branch,
      commit_message: 'Prepare report artifact fixture',
      overwrite: true,
      files: [{ file_path: '.gitlab-ci.yml', content: CI }],
    });
  });

  afterAll(async () => {
    await helper.executeTool('manage_ref', {
      action: 'delete_branch',
      project_id: projectId,
      branch,
    });
  });

  it('reads and searches a JUnit report that has no archive entry', async () => {
    const deadline = Date.now() + PIPELINE_WAIT_MS;
    let pipelineId: string | undefined;
    let finished = false;
    try {
      pipelineId = Pipeline.parse(
        await helper.executeTool('manage_pipeline', {
          action: 'create',
          project_id: projectId,
          ref: branch,
        }),
      ).id;
      while (Date.now() < deadline && !finished) {
        const pipeline = Pipeline.parse(
          await helper.executeTool('browse_pipelines', {
            action: 'get',
            project_id: projectId,
            pipeline_id: pipelineId,
          }),
        );
        if (['failed', 'canceled', 'skipped'].includes(pipeline.status))
          throw new Error(`Report fixture ended with status ${pipeline.status}`);
        finished = pipeline.status === 'success';
        if (!finished) await delay(2000);
      }
      if (!finished)
        throw new Error(`Report fixture did not finish within ${PIPELINE_WAIT_MS / 1000} s`);

      const [job] = Jobs.parse(
        await helper.executeTool('browse_pipelines', {
          action: 'jobs',
          project_id: projectId,
          pipeline_id: pipelineId,
        }),
      );
      const read = (selector: Record<string, unknown>, extra = {}): Promise<unknown> =>
        helper.executeTool('browse_pipelines', {
          action: 'artifact_file',
          project_id: projectId,
          job_id: job.id,
          ...selector,
          ...extra,
        });

      // The report GitLab stores compressed comes back as its own text.
      const whole = Window.parse(await read({ report_type: 'junit' }));
      expect(whole).toMatchObject({
        text: REPORT,
        byte_start: 0,
        byte_end: Buffer.byteLength(REPORT),
        total_bytes: Buffer.byteLength(REPORT),
        next_byte_offset: null,
        complete: true,
      });

      // Offsets count the report's bytes: small windows rebuild it, multi-byte characters intact.
      let offset: number | null = 0;
      let text = '';
      while (offset !== null) {
        const page = Window.parse(
          await read({ report_type: 'junit' }, { byte_offset: offset, byte_limit: 16 }),
        );
        expect(page.byte_start).toBe(offset);
        text += page.text;
        offset = page.next_byte_offset;
      }
      expect(text).toBe(REPORT);

      // The same file is not an archive entry: the path selector cannot reach it.
      await expect(read({ artifact_path: 'junit.xml' })).rejects.toMatchObject({ status: 404 });

      // A report type the job did not upload is an error that names it, not an empty report.
      const absent = read({ report_type: 'sast' });
      await expect(absent).rejects.toMatchObject({ status: 404 });
      await expect(absent).rejects.toThrow(/no sast report artifact/);

      const found = Grep.parse(
        await helper.executeTool('browse_pipelines', {
          action: 'artifact_grep',
          project_id: projectId,
          job_id: job.id,
          report_type: 'junit',
          patterns: ['<failure>'],
          before: 0,
          after: 0,
        }),
      );
      expect(found.match_count).toBe(1);
      expect(found.hunks[0].lines).toEqual([
        '<testcase name="fails"><failure>boom</failure></testcase>',
      ]);
      // The hunk's byte offset reads the same line back with artifact_file.
      const back = Window.parse(
        await read({ report_type: 'junit' }, { byte_offset: found.hunks[0].byte_offset }),
      );
      expect(back.text.startsWith(found.hunks[0].lines[0])).toBe(true);

      await expect(
        helper.executeTool('browse_pipelines', {
          action: 'artifact_grep',
          project_id: projectId,
          job_id: job.id,
          report_type: 'sast',
          patterns: ['x'],
        }),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      if (pipelineId !== undefined && !finished) {
        await helper.executeTool('manage_pipeline', {
          action: 'cancel',
          project_id: projectId,
          pipeline_id: pipelineId,
        });
      }
    }
  });
});
