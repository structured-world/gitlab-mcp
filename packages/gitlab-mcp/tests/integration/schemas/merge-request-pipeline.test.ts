import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { getTestData } from '../../setup/testConfig';

const Pipeline = z.object({
  id: z.coerce.string(),
  status: z.string(),
  ref: z.string(),
  source: z.string(),
  web_url: z.string().url(),
});
const Jobs = z.array(z.object({ name: z.string() }));
const MergeRequest = z.object({ iid: z.coerce.string() });

// One job per pipeline source, so the job list alone tells a merge request pipeline from a
// branch pipeline. Both are manual: nothing reaches a runner and nothing needs cancelling.
const CI = `mr-only-job:
  script:
    - echo "merge request pipeline"
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      when: manual
branch-only-job:
  script:
    - echo "branch pipeline"
  rules:
    - if: '$CI_PIPELINE_SOURCE == "api"'
      when: manual
`;

// The suite owns a branch and a merge request in the test/ project and removes both.
describe('manage_pipeline create for a merge request - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let projectId: string;
  let mergeRequestIid: string;
  const branch = `mr-pipeline-${randomUUID()}`;

  const jobNames = async (pipelineId: string): Promise<string[]> =>
    Jobs.parse(
      await helper.executeTool('browse_pipelines', {
        action: 'jobs',
        project_id: projectId,
        pipeline_id: pipelineId,
      }),
    ).map((job) => job.name);

  beforeAll(async () => {
    const project = getTestData().project;
    if (!project?.path_with_namespace.startsWith('test/')) {
      throw new Error('Merge request pipeline tests require a suite-owned project under test/');
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
      commit_message: 'Prepare merge request pipeline fixture',
      overwrite: true,
      files: [{ file_path: '.gitlab-ci.yml', content: CI }],
    });
    mergeRequestIid = MergeRequest.parse(
      await helper.executeTool('manage_merge_request', {
        action: 'create',
        project_id: projectId,
        source_branch: branch,
        target_branch: 'main',
        title: `Merge request pipeline fixture ${branch}`,
      }),
    ).iid;
  });

  afterAll(async () => {
    if (mergeRequestIid !== undefined) {
      await helper.executeTool('manage_merge_request', {
        action: 'update',
        project_id: projectId,
        merge_request_iid: mergeRequestIid,
        state_event: 'close',
      });
    }
    await helper.executeTool('manage_ref', {
      action: 'delete_branch',
      project_id: projectId,
      branch,
    });
  });

  // The same branch gives two different pipelines depending on the target: only the merge
  // request target runs merge_request_event rules, on the merge request ref.
  it('runs a merge request pipeline that a branch pipeline of the same branch does not', async () => {
    const mrPipeline = Pipeline.parse(
      await helper.executeTool('manage_pipeline', {
        action: 'create',
        project_id: projectId,
        merge_request_iid: mergeRequestIid,
      }),
    );
    expect(mrPipeline.source).toBe('merge_request_event');
    expect(mrPipeline.ref).toBe(`refs/merge-requests/${mergeRequestIid}/head`);
    expect(mrPipeline.web_url).toContain(`/-/pipelines/${mrPipeline.id}`);
    expect(await jobNames(mrPipeline.id)).toEqual(['mr-only-job']);

    const branchPipeline = Pipeline.parse(
      await helper.executeTool('manage_pipeline', {
        action: 'create',
        project_id: projectId,
        ref: branch,
      }),
    );
    expect(branchPipeline.source).toBe('api');
    expect(branchPipeline.ref).toBe(branch);
    expect(branchPipeline.id).not.toBe(mrPipeline.id);
    expect(await jobNames(branchPipeline.id)).toEqual(['branch-only-job']);
  });

  // Each call starts its own pipeline: the endpoint is not idempotent, which is why the
  // handler never repeats it.
  it('starts a new pipeline on every call', async () => {
    const create = async (): Promise<string> =>
      Pipeline.parse(
        await helper.executeTool('manage_pipeline', {
          action: 'create',
          project_id: projectId,
          merge_request_iid: mergeRequestIid,
        }),
      ).id;
    expect(await create()).not.toBe(await create());
  });

  // A merge request that does not exist is GitLab's 404, not a branch pipeline.
  it('fails for an unknown merge request without falling back to a branch pipeline', async () => {
    await expect(
      helper.executeTool('manage_pipeline', {
        action: 'create',
        project_id: projectId,
        merge_request_iid: '2147483647',
      }),
    ).rejects.toThrow(/404/);
  });

  // Mixed targets are refused before GitLab sees them.
  it('refuses ref together with merge_request_iid', async () => {
    await expect(
      helper.executeTool('manage_pipeline', {
        action: 'create',
        project_id: projectId,
        ref: branch,
        merge_request_iid: mergeRequestIid,
      }),
    ).rejects.toThrow(/ref cannot be combined with merge_request_iid/);
  });
});
