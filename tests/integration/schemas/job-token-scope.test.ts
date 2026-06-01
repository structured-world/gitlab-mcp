/**
 * Job Token Scope Schema Integration Tests
 * Exercises the inbound allowlist lifecycle against a real GitLab API:
 * add a target project to the host project's allowlist, verify it is listed,
 * remove it, verify it is gone.
 */

import { BrowseJobTokenScopeSchema } from '../../../src/entities/job-token-scope/schema-readonly';
import { ManageJobTokenScopeSchema } from '../../../src/entities/job-token-scope/schema';
import { IntegrationTestHelper } from '../helpers/registry-helper';

interface AllowlistProject {
  id: number;
}

describe('Job Token Scope Schema - GitLab Integration', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    if (!process.env.GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }
    helper = new IntegrationTestHelper();
    await helper.initialize();
  });

  it('reads the inbound scope settings for a project', async () => {
    const projects = (await helper.listProjects({ per_page: 1 })) as {
      path_with_namespace: string;
      id: number;
    }[];
    if (projects.length === 0) {
      console.log('No projects available — skipping job token scope read');
      return;
    }

    const params = BrowseJobTokenScopeSchema.parse({
      action: 'get',
      project_id: projects[0].path_with_namespace,
    });
    const scope = (await helper.executeTool('browse_job_token_scope', params)) as {
      inbound_enabled: boolean;
      outbound_enabled: boolean;
    };

    expect(typeof scope.inbound_enabled).toBe('boolean');
    expect(typeof scope.outbound_enabled).toBe('boolean');
  });

  it('adds, lists, and removes a project on the inbound allowlist', async () => {
    const projects = (await helper.listProjects({ per_page: 2 })) as {
      path_with_namespace: string;
      id: number;
    }[];
    if (projects.length < 2) {
      console.log('Need two projects for allowlist lifecycle — skipping');
      return;
    }

    const host = projects[0];
    const target = projects[1];

    // Add target to host's inbound allowlist.
    const addParams = ManageJobTokenScopeSchema.parse({
      action: 'add_project',
      project_id: host.path_with_namespace,
      target_project_id: target.id,
    });
    await helper.executeTool('manage_job_token_scope', addParams);

    try {
      // Verify target appears in the allowlist.
      const listParams = BrowseJobTokenScopeSchema.parse({
        action: 'list_projects',
        project_id: host.path_with_namespace,
      });
      const allowlist = (await helper.executeTool(
        'browse_job_token_scope',
        listParams,
      )) as AllowlistProject[];
      expect(allowlist.some((p) => p.id === target.id)).toBe(true);
    } finally {
      // Remove target from the allowlist (cleanup + the remove assertion).
      const removeParams = ManageJobTokenScopeSchema.parse({
        action: 'remove_project',
        project_id: host.path_with_namespace,
        target_project_id: target.id,
      });
      const removed = (await helper.executeTool('manage_job_token_scope', removeParams)) as {
        removed: boolean;
      };
      expect(removed.removed).toBe(true);
    }

    // Verify target is gone from the allowlist.
    const afterList = (await helper.executeTool('browse_job_token_scope', {
      action: 'list_projects',
      project_id: host.path_with_namespace,
    })) as AllowlistProject[];
    expect(afterList.some((p) => p.id === target.id)).toBe(false);
  });
});
