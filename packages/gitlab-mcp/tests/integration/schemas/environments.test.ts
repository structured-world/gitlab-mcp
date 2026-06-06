/**
 * Environments Schema Integration Tests
 * Exercises the environment lifecycle against a real GitLab API: create an
 * environment, read it back, list it, update it, then create a manual deployment
 * and drive its status through the update_deployment_status action before stopping
 * and deleting the environment.
 */

import { BrowseEnvironmentsSchema } from '../../../src/entities/environments/schema-readonly';
import { ManageEnvironmentSchema } from '../../../src/entities/environments/schema';
import { gitlab } from '../../../src/utils/gitlab-api';
import { IntegrationTestHelper } from '../helpers/registry-helper';

interface Environment {
  id: number;
  name: string;
  state: string;
  external_url?: string;
  description?: string;
}

interface Deployment {
  id: number;
  status: string;
}

describe('Environments Schema - GitLab Integration', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    if (!process.env.GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }
    helper = new IntegrationTestHelper();
    await helper.initialize();
  });

  /** First project in the mandated `test` root group, or null when none exist. */
  async function firstTestProject(): Promise<{ path_with_namespace: string; id: number } | null> {
    const all = (await helper.listProjects({ per_page: 50 })) as {
      path_with_namespace: string;
      id: number;
    }[];
    return all.find((p) => p.path_with_namespace.startsWith('test/')) ?? null;
  }

  it('creates, reads, lists, updates, and deletes an environment', async () => {
    const project = await firstTestProject();
    if (!project) {
      console.log('No test/ project available - skipping environment lifecycle');
      return;
    }
    const name = `it-env-${Date.now()}`;

    const created = (await helper.executeTool(
      'manage_environment',
      ManageEnvironmentSchema.parse({
        action: 'create',
        project_id: project.path_with_namespace,
        name,
        external_url: 'https://it.example.com',
        tier: 'testing',
      }),
    )) as Environment;
    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe(name);

    try {
      const fetched = (await helper.executeTool(
        'browse_environments',
        BrowseEnvironmentsSchema.parse({
          action: 'get',
          project_id: project.path_with_namespace,
          environment_id: created.id,
        }),
      )) as Environment;
      expect(fetched.id).toBe(created.id);

      const listed = (await helper.executeTool(
        'browse_environments',
        BrowseEnvironmentsSchema.parse({
          action: 'list',
          project_id: project.path_with_namespace,
          name,
        }),
      )) as Environment[];
      expect(listed.some((e) => e.id === created.id)).toBe(true);

      const updated = (await helper.executeTool(
        'manage_environment',
        ManageEnvironmentSchema.parse({
          action: 'update',
          project_id: project.path_with_namespace,
          environment_id: created.id,
          description: 'updated by integration test',
        }),
      )) as Environment;
      expect(updated.description).toBe('updated by integration test');
    } finally {
      // An environment must be stopped before it can be deleted.
      await helper.executeTool(
        'manage_environment',
        ManageEnvironmentSchema.parse({
          action: 'stop',
          project_id: project.path_with_namespace,
          environment_id: created.id,
        }),
      );
      await helper.executeTool(
        'manage_environment',
        ManageEnvironmentSchema.parse({
          action: 'delete',
          project_id: project.path_with_namespace,
          environment_id: created.id,
        }),
      );
    }
  });

  it('updates the status of a manually created deployment', async () => {
    const project = await firstTestProject();
    if (!project) {
      console.log('No test/ project available - skipping deployment status update');
      return;
    }
    const encodedId = encodeURIComponent(project.path_with_namespace);

    // A manual deployment needs a real commit; skip if the repository is empty.
    const commits = await gitlab.get<{ id: string }[]>(`projects/${encodedId}/repository/commits`, {
      query: { per_page: 1 },
    });
    if (!Array.isArray(commits) || commits.length === 0) {
      console.log('test/ project has no commits - skipping deployment status update');
      return;
    }
    const sha = commits[0].id;
    const details = await gitlab.get<{ default_branch?: string }>(`projects/${encodedId}`);
    const ref = details.default_branch ?? 'main';
    const envName = `it-deploy-env-${Date.now()}`;

    // Create the deployment (and its environment) directly: deployment creation is
    // not exposed as a tool action; update_deployment_status is the tool under test.
    const deployment = await gitlab.post<Deployment>(`projects/${encodedId}/deployments`, {
      body: { environment: envName, sha, ref, tag: false, status: 'running' },
      contentType: 'json',
    });
    expect(deployment.id).toBeGreaterThan(0);

    let environmentId: number | undefined;
    try {
      const updated = (await helper.executeTool(
        'manage_environment',
        ManageEnvironmentSchema.parse({
          action: 'update_deployment_status',
          project_id: project.path_with_namespace,
          deployment_id: deployment.id,
          status: 'success',
        }),
      )) as Deployment;
      expect(updated.status).toBe('success');

      const deployments = (await helper.executeTool(
        'browse_environments',
        BrowseEnvironmentsSchema.parse({
          action: 'list_deployments',
          project_id: project.path_with_namespace,
          environment: envName,
        }),
      )) as Deployment[];
      expect(deployments.some((d) => d.id === deployment.id)).toBe(true);

      const envs = (await helper.executeTool(
        'browse_environments',
        BrowseEnvironmentsSchema.parse({
          action: 'list',
          project_id: project.path_with_namespace,
          name: envName,
        }),
      )) as Environment[];
      environmentId = envs.find((e) => e.name === envName)?.id;
    } finally {
      // Best-effort cleanup of the auto-created environment.
      if (environmentId !== undefined) {
        try {
          await helper.executeTool(
            'manage_environment',
            ManageEnvironmentSchema.parse({
              action: 'stop',
              project_id: project.path_with_namespace,
              environment_id: environmentId,
            }),
          );
          await helper.executeTool(
            'manage_environment',
            ManageEnvironmentSchema.parse({
              action: 'delete',
              project_id: project.path_with_namespace,
              environment_id: environmentId,
            }),
          );
        } catch {
          // environment may not be stoppable/deletable - leave it for manual cleanup
        }
      }
    }
  });
});
