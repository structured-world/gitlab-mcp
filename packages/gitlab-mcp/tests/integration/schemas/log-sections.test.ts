import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { getTestData } from '../../setup/testConfig';

const Pipeline = z.object({ id: z.coerce.string(), status: z.string() });
const Jobs = z.array(z.object({ id: z.coerce.string(), name: z.string() }));
const Section = z.object({
  name: z.string(),
  depth: z.number(),
  start_line: z.number(),
  end_line: z.number(),
  line_count: z.number(),
  terminated: z.boolean(),
});
const Sections = z.object({ sections: z.array(Section), complete: z.boolean() });
const Grep = z.object({
  hunks: z.array(z.object({ lines: z.array(z.string()) })),
  match_count: z.number(),
  section: z.object({ start_line: z.number(), end_line: z.number() }),
});
const Page = z.object({ trace: z.string(), startLine: z.number(), totalLines: z.number() });
// Leaves room for the searches and cleanup within the 10-minute test limit.
const PIPELINE_WAIT_MS = 6 * 60_000;

// The job writes a custom collapsible section with the markers GitLab documents; the
// runner wraps the script in its own step_script section.
const CI = `section-job:
  script:
    - |
      printf '\\033[0Ksection_start:%s:custom_check\\r\\033[0KCustom check\\n' "$(date +%s)"
      echo "inside custom section"
      printf '\\033[0Ksection_end:%s:custom_check\\r\\033[0K\\n' "$(date +%s)"
      echo "after custom section"
  rules:
    - if: '$CI_PIPELINE_SOURCE == "api"'
`;

// The suite works on its own branch of the test/ project and deletes it afterwards.
describe('job log sections - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let projectId: string;
  const branch = `log-sections-${randomUUID()}`;

  beforeAll(async () => {
    const project = getTestData().project;
    if (!project?.path_with_namespace.startsWith('test/')) {
      throw new Error('Log section tests require a suite-owned project under test/');
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
      commit_message: 'Prepare log section fixture',
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

  it('lists a custom section and reads and searches only inside it', async () => {
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
          throw new Error(`Section fixture ended with status ${pipeline.status}`);
        finished = pipeline.status === 'success';
        if (!finished) await delay(2000);
      }
      if (!finished)
        throw new Error(`Section fixture did not finish within ${PIPELINE_WAIT_MS / 1000} s`);

      const [job] = Jobs.parse(
        await helper.executeTool('browse_pipelines', {
          action: 'jobs',
          project_id: projectId,
          pipeline_id: pipelineId,
        }),
      );
      const jobArgs = { project_id: projectId, job_id: job.id };

      const listing = Sections.parse(
        await helper.executeTool('browse_pipelines', { action: 'log_sections', ...jobArgs }),
      );
      expect(listing.complete).toBe(true);
      const byName = new Map(listing.sections.map((section) => [section.name, section]));
      const script = byName.get('step_script')!;
      const custom = byName.get('custom_check')!;
      expect(script).toMatchObject({ depth: 0, terminated: true });
      // The custom section lies inside the script step, one level down.
      expect(custom).toMatchObject({ depth: 1, terminated: true });
      expect(custom.start_line).toBeGreaterThan(script.start_line);
      expect(custom.end_line).toBeLessThan(script.end_line);

      const inside = Grep.parse(
        await helper.executeTool('browse_pipelines', {
          action: 'log_grep',
          ...jobArgs,
          patterns: ['^(inside|after) custom section$'],
          before: 0,
          after: 0,
          section: 'custom_check',
        }),
      );
      // The line printed after the section's end is outside it, so only one line matches.
      expect(inside.match_count).toBe(1);
      expect(inside.hunks.map((hunk) => hunk.lines)).toEqual([['inside custom section']]);
      expect(inside.section).toEqual({
        start_line: custom.start_line,
        end_line: custom.end_line,
      });

      const page = Page.parse(
        await helper.executeTool('browse_pipelines', {
          action: 'logs',
          ...jobArgs,
          section: 'custom_check',
        }),
      );
      expect(page.startLine).toBe(custom.start_line);
      expect(page.totalLines).toBe(custom.line_count);
      expect(page.trace).toContain('inside custom section');
      expect(page.trace).not.toContain('after custom section');

      await expect(
        helper.executeTool('browse_pipelines', {
          action: 'log_grep',
          ...jobArgs,
          patterns: ['x'],
          section: 'no_such_section',
        }),
      ).rejects.toThrow(/custom_check/);
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
