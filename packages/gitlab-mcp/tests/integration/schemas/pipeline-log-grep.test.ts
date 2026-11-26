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
// Counted from the start of the test. A shared runner under load can take many minutes
// to pick up and finish the three jobs, so the test's own limit leaves room after the
// wait for the search and the cancel.
const PIPELINE_WAIT_MS = 15 * 60_000;
const TEST_TIMEOUT_MS = PIPELINE_WAIT_MS + 5 * 60_000;

// Parent jobs run only for API pipelines, so creating the branch starts nothing. The
// depend trigger waits for its child, so the parent pipeline ends after that failure; the
// default-strategy trigger succeeds once its child exists, however the child ends.
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
default-child:
  trigger:
    include: default-child.yml
  rules:
    - if: '$CI_PIPELINE_SOURCE == "api"'
`;
const CHILD_CI = `child-fails:
  script:
    - echo "grep fixture child failed"
    - exit 4
`;
const DEFAULT_CHILD_CI = `default-child-fails:
  script:
    - echo "grep fixture default child failed"
    - exit 5
`;
const FIXTURE_JOBS = ['child-fails', 'default-child-fails', 'parent-fails'];

// The suite works on its own branch of the test/ project and deletes it afterwards, so
// the main branch CI configuration other suites rely on stays untouched.
describe('pipeline log search - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let projectId: string;
  const branch = `log-grep-pipeline-${randomUUID()}`;
  // Set once the branch exists, so a setup that failed earlier leaves nothing to delete.
  let branchCreated = false;

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
    branchCreated = true;
    await helper.executeTool('manage_files', {
      action: 'batch',
      project_id: projectId,
      branch,
      commit_message: 'Prepare pipeline log search fixture',
      overwrite: true,
      files: [
        { file_path: '.gitlab-ci.yml', content: PARENT_CI },
        { file_path: 'child.yml', content: CHILD_CI },
        { file_path: 'default-child.yml', content: DEFAULT_CHILD_CI },
      ],
    });
  });

  afterAll(async () => {
    if (!branchCreated) return;
    await helper.executeTool('manage_ref', {
      action: 'delete_branch',
      project_id: projectId,
      branch,
    });
  });

  // One call finds the failure of the pipeline's own job and of its child pipelines' jobs,
  // including the child of a trigger job that succeeded.
  it(
    'returns failed jobs of the pipeline and of its child pipelines',
    async () => {
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

        // The default-strategy child may still be running when the parent pipeline ends.
        const search = async () =>
          PipelineGrep.parse(
            await helper.executeTool('browse_pipelines', {
              action: 'log_grep',
              project_id: projectId,
              pipeline_id: pipelineId,
              patterns: ['^grep fixture (parent|child|default child) failed$'],
              before: 0,
              after: 0,
            }),
          );
        let result = await search();
        while (result.jobs.length < FIXTURE_JOBS.length && Date.now() < deadline) {
          await delay(2000);
          result = await search();
        }

        const byName = new Map(result.jobs.map((job) => [job.name, job]));
        expect([...byName.keys()].sort()).toEqual(FIXTURE_JOBS);
        const defaultChild = byName.get('default-child-fails')!;
        expect(defaultChild).toMatchObject({ status: 'failed', match_count: 1 });
        expect(defaultChild.pipeline_id).not.toBe(pipelineId);
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
    },
    TEST_TIMEOUT_MS,
  );
});
