import { randomUUID } from 'node:crypto';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { getTestData } from '../../setup/testConfig';

// The lifecycle suite owns the project; these tests run serially and remove their own rules.
describe('Ref protection - GitLab integration', () => {
  let helper: IntegrationTestHelper;
  let projectId: string;

  beforeAll(async () => {
    const project = getTestData().project;
    if (!project?.path_with_namespace.startsWith('test/')) {
      throw new Error('Protection tests require a suite-owned project under test/');
    }
    projectId = project.path_with_namespace;
    helper = new IntegrationTestHelper();
    await helper.initialize();
  });

  // Tag protection uses the all-tier scalar API and requires no actual repository tag.
  it('protects, lists and unprotects a tag pattern', async () => {
    const name = `protection-${randomUUID()}-*`;
    let protectedTag = false;
    try {
      const created = await helper.executeTool('manage_ref', {
        action: 'protect_tag',
        project_id: projectId,
        name,
        create_access_level: 0,
      });
      protectedTag = true;
      expect(created).toMatchObject({ name, create_access_levels: [{ access_level: 0 }] });
      expect(created).not.toHaveProperty('not_applied');
      const listed = await helper.executeTool('browse_refs', {
        action: 'list_protected_tags',
        project_id: projectId,
        per_page: 100,
      });
      expect(listed).toContainEqual(expect.objectContaining({ name }));
    } finally {
      if (protectedTag) {
        expect(
          await helper.executeTool('manage_ref', {
            action: 'unprotect_tag',
            project_id: projectId,
            name,
          }),
        ).toEqual({ unprotected: true, name });
      }
    }
  });

  // Role-list settings must be either reflected by GitLab or explicitly named as unapplied.
  it('checks applied role-based branch protection after create and update', async () => {
    const name = `protection-${randomUUID()}-*`;
    let protectedBranch = false;
    try {
      const created = await helper.executeTool('manage_ref', {
        action: 'protect_branch',
        project_id: projectId,
        name,
        push_access_level: 0,
        merge_access_level: 40,
      });
      protectedBranch = true;
      expect(created).toMatchObject({ name, push_access_levels: [{ access_level: 0 }] });
      const updated = (await helper.executeTool('manage_ref', {
        action: 'update_branch_protection',
        project_id: projectId,
        name,
        allowed_to_push: [{ access_level: 30 }],
      })) as {
        push_access_levels: { access_level: number }[];
        not_applied?: { setting: string }[];
      };
      if (updated.not_applied) {
        expect(updated.not_applied).toEqual([
          expect.objectContaining({ setting: 'allowed_to_push[0]' }),
        ]);
        expect(updated.push_access_levels).not.toContainEqual(
          expect.objectContaining({ access_level: 30 }),
        );
      } else {
        expect(updated.push_access_levels).toContainEqual(
          expect.objectContaining({ access_level: 30 }),
        );
      }
    } finally {
      if (protectedBranch) {
        expect(
          await helper.executeTool('manage_ref', {
            action: 'unprotect_branch',
            project_id: projectId,
            name,
          }),
        ).toEqual({ unprotected: true, name });
      }
    }
  });
});
