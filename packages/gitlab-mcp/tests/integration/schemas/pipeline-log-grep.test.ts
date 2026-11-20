import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { getTestData } from '../../setup/testConfig';

const Pipeline = z.object({ id: z.coerce.string(), status: z.string() });
const PipelineGrep = z.object({
  pipeline_id: z.string(),
  jobs: z.array(
    z.object({
      job_id: z.string(),
      name: z.string(),
      status: z.string(),
      pipeline_id: z.string(),
      failure_reason: z.string().nullable(),
      match_count: z.number(),
      hunks: z.array(z.object({ lines: z.array(z.string()) })),
    }),
  ),
  jobs_skipped: z.array(z.object({ job_id: z.string(), reason: z.string() })),
  resume: z.null(),
});
// Counted from the start of the test, leaving room for the search and cleanup within
// the 10-minute test limit.
const PIPELINE_WAIT_MS = 6 * 60_000;

// Parent jobs run only for API pipelines, so creating the branch starts nothing; the
// trigger waits for its child, so the parent pipeline ends after the child's failure.
const PARENT_CI = `parent-fails:
  script:
    - echo "grep fixture parent failed"
    - exit 3
  rules:
    - if: '$CI_PIPELINE_SOURCE == "api"'
child:
  trigger:
    include: child.yml
    strategy: depend
  rules:
    - if: '$CI_PIPELINE_SOURCE == "api"'
`;
const CHILD_CI = `child-fails:
  script:
    - echo "grep fixture child failed"
    - exit 4
`;

// The suite works on its own branch of the test/ project and deletes it afterwards, so
// the main branch CI configuration other suites rely on stays untouched.
describe('pipeline log search - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let projectId: string;
  const branch = `log-grep-pipeline-${randomUUID()}`;

  beforeAll(async () => {
    const project = getTestData().project;
    if (!project?.path_with_namespace.startsWith('test/')) {
      throw new Error('Pipeline log search tests require a suite-owned project under test/');
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
      commit_message: 'Prepare pipeline log search fixture',
      overwrite: true,
      files: [
        { file_path: '.gitlab-ci.yml', content: PARENT_CI },
        { file_path: 'child.yml', content: CHILD_CI },
      ],
    });
  });

  afterAll(async () => {
    await helper.executeTool('manage_ref', {
      action: 'delete_branch',
      project_id: projectId,
      branch,
    });
  });

  // One call finds the failure of the pipeline's own job and of its child pipeline's job.
  it('returns failed jobs of the pipeline and of its child pipeline', async () => {
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
        if (['success', 'canceled', 'skipped'].includes(pipeline.status))
          throw new Error(`Pipeline fixture ended with status ${pipeline.status}`);
        finished = pipeline.status === 'failed';
        if (!finished) await delay(2000);
      }
      if (!finished)
        throw new Error(`Pipeline fixture did not finish within ${PIPELINE_WAIT_MS / 1000} s`);

      const result = PipelineGrep.parse(
        await helper.executeTool('browse_pipelines', {
          action: 'log_grep',
          project_id: projectId,
          pipeline_id: pipelineId,
          patterns: ['^grep fixture (parent|child) failed$'],
          before: 0,
          after: 0,
        }),
      );

      const byName = new Map(result.jobs.map((job) => [job.name, job]));
      expect([...byName.keys()].sort()).toEqual(['child-fails', 'parent-fails']);
      expect(byName.get('parent-fails')).toMatchObject({
        status: 'failed',
        failure_reason: 'script_failure',
        pipeline_id: pipelineId,
        match_count: 1,
      });
      const child = byName.get('child-fails')!;
      expect(child).toMatchObject({ status: 'failed', match_count: 1 });
      expect(child.pipeline_id).not.toBe(pipelineId);
      expect(child.hunks[0].lines).toEqual(['grep fixture child failed']);
      expect(result.jobs_skipped).toEqual([]);
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
