/**
 * Releases Schema Integration Tests
 * Tests schemas using handler functions with real GitLab API
 */

import { z } from 'zod';
import { BrowseReleasesSchema } from '../../../src/entities/releases/schema-readonly';
import { ManageReleaseSchema } from '../../../src/entities/releases/schema';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { getTestData } from '../../setup/testConfig';

// Validate the project payloads we depend on instead of casting raw JSON, so a
// malformed shape fails loudly here rather than surfacing as a confusing error later.
const SeededProjectSchema = z.object({
  id: z.number(),
  default_branch: z.string().nullable().optional(),
});
const DiscoveredProjectSchema = z.object({
  id: z.number(),
  path_with_namespace: z.string(),
  name: z.string(),
  default_branch: z.string().nullable(),
});

describe('Releases Schema - GitLab Integration', () => {
  let helper: IntegrationTestHelper;
  let testProjectId: string;
  // Real branch to tag the release against. Hardcoding 'main' fails with
  // "Target main is invalid" on projects whose default branch differs or whose
  // repository is empty, so we seed this from the chosen project's default_branch.
  let testProjectRef: string;

  beforeAll(async () => {
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
    if (!GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }

    helper = new IntegrationTestHelper();
    await helper.initialize();
    console.log('Integration test helper initialized for releases testing');

    // Prefer the project seeded by the data-lifecycle suite: it has a known
    // commit on `main`, so a release can be tagged against it deterministically.
    // Picking an arbitrary "test" project is unreliable - many are empty repos
    // whose `main` ref does not exist, producing "Target main is invalid".
    const seeded = SeededProjectSchema.safeParse(getTestData().project);
    if (seeded.success) {
      testProjectId = seeded.data.id.toString();
      // The project record is captured at creation time (empty repo), so
      // default_branch is usually null; the lifecycle suite commits to `main`.
      testProjectRef = seeded.data.default_branch || 'main';
      console.log(
        `Using seeded project ${testProjectId} (ref: ${testProjectRef}) for releases testing`,
      );
      return;
    }

    // Fallback: discover a test project that reports a default branch (non-empty
    // repository). simple=false surfaces default_branch, which is null for empty
    // repos; a release can only be tagged against an existing ref.
    const projects = z
      .array(DiscoveredProjectSchema)
      .parse(await helper.listProjects({ search: 'test', per_page: 20, simple: false }));

    const usable = projects.filter((p) => Boolean(p.default_branch));
    const selectedProject =
      usable.find((p) => p.path_with_namespace.startsWith('test/')) ?? usable[0];

    if (!selectedProject) {
      console.log('No test project with a default branch available for releases testing');
      return;
    }

    testProjectId = selectedProject.id.toString();
    testProjectRef = selectedProject.default_branch || 'main';
    console.log(
      `Using project: ${selectedProject.path_with_namespace} (ID: ${testProjectId}, ref: ${testProjectRef}) for releases testing`,
    );
  });

  describe('BrowseReleasesSchema', () => {
    it('should validate and list releases with real project data', async () => {
      if (!testProjectId) {
        console.log('Skipping: no test project available');
        return;
      }

      const validParams = {
        action: 'list' as const,
        project_id: testProjectId,
        per_page: 20,
      };

      // Validate schema
      const result = BrowseReleasesSchema.safeParse(validParams);
      expect(result.success).toBe(true);

      if (result.success) {
        // Test actual handler function
        const releases = (await helper.executeTool('browse_releases', result.data)) as {
          tag_name: string;
          name: string;
          description: string;
          created_at: string;
          released_at: string;
        }[];
        expect(Array.isArray(releases)).toBe(true);
        console.log(`Retrieved ${releases.length} releases via handler`);

        // Validate structure if we have releases
        if (releases.length > 0) {
          const release = releases[0];
          expect(release).toHaveProperty('tag_name');
          expect(release).toHaveProperty('created_at');
          console.log(`Validated release structure: ${release.name ?? release.tag_name}`);
        }
      }
    });

    it('should validate list action with sorting options', async () => {
      if (!testProjectId) {
        console.log('Skipping: no test project available');
        return;
      }

      const params = {
        action: 'list' as const,
        project_id: testProjectId,
        order_by: 'created_at' as const,
        sort: 'asc' as const,
        per_page: 10,
      };

      const result = BrowseReleasesSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'list') {
        expect(result.data.order_by).toBe('created_at');
        expect(result.data.sort).toBe('asc');
      }
    });

    it('should reject invalid parameters', async () => {
      const invalidParams = {
        action: 'list',
        project_id: '123',
        per_page: 150, // Exceeds max of 100
      };

      const result = BrowseReleasesSchema.safeParse(invalidParams);
      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }

      console.log('BrowseReleasesSchema correctly rejects invalid parameters');
    });
  });

  describe('BrowseReleasesSchema - get action', () => {
    it('should validate get release parameters', async () => {
      const params = {
        action: 'get' as const,
        project_id: '123',
        tag_name: 'v1.0.0',
      };

      const result = BrowseReleasesSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'get') {
        expect(result.data.tag_name).toBe('v1.0.0');
      }
    });

    it('should accept include_html_description option', async () => {
      const params = {
        action: 'get' as const,
        project_id: '123',
        tag_name: 'v1.0.0',
        include_html_description: true,
      };

      const result = BrowseReleasesSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'get') {
        expect(result.data.include_html_description).toBe(true);
      }
    });
  });

  describe('BrowseReleasesSchema - assets action', () => {
    it('should validate assets action parameters', async () => {
      const params = {
        action: 'assets' as const,
        project_id: '123',
        tag_name: 'v1.0.0',
        per_page: 50,
      };

      const result = BrowseReleasesSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'assets') {
        expect(result.data.tag_name).toBe('v1.0.0');
        expect(result.data.per_page).toBe(50);
      }
    });
  });

  describe('ManageReleaseSchema - action validation', () => {
    it('should validate create release parameters', async () => {
      const params = {
        action: 'create' as const,
        project_id: '123',
        tag_name: 'v2.0.0',
        name: 'Version 2.0.0',
        description: 'Major release with new features',
      };

      const result = ManageReleaseSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'create') {
        expect(result.data.tag_name).toBe('v2.0.0');
        expect(result.data.name).toBe('Version 2.0.0');
      }
    });

    it('should validate create with ref for new tag', async () => {
      const params = {
        action: 'create' as const,
        project_id: '123',
        tag_name: 'v2.0.0',
        ref: 'main',
        tag_message: 'Annotated tag for v2.0.0',
      };

      const result = ManageReleaseSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'create') {
        expect(result.data.ref).toBe('main');
        expect(result.data.tag_message).toBe('Annotated tag for v2.0.0');
      }
    });

    it('should validate create with milestones', async () => {
      const params = {
        action: 'create' as const,
        project_id: '123',
        tag_name: 'v2.0.0',
        milestones: ['Q1 2024', 'Sprint 5'],
      };

      const result = ManageReleaseSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'create') {
        expect(result.data.milestones).toEqual(['Q1 2024', 'Sprint 5']);
      }
    });

    it('should validate create with assets', async () => {
      const params = {
        action: 'create' as const,
        project_id: '123',
        tag_name: 'v2.0.0',
        assets: {
          links: [
            {
              name: 'Linux Binary',
              url: 'https://example.com/binaries/linux-amd64',
              direct_asset_path: '/binaries/linux-amd64',
              link_type: 'package' as const,
            },
            {
              name: 'Documentation',
              url: 'https://docs.example.com/v2.0.0',
              link_type: 'runbook' as const,
            },
          ],
        },
      };

      const result = ManageReleaseSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'create') {
        expect(result.data.assets?.links).toHaveLength(2);
      }
    });

    it('should validate update release parameters', async () => {
      const params = {
        action: 'update' as const,
        project_id: '123',
        tag_name: 'v1.0.0',
        name: 'Updated Release Name',
        description: 'Updated description',
      };

      const result = ManageReleaseSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'update') {
        expect(result.data.name).toBe('Updated Release Name');
      }
    });

    it('should validate delete release parameters', async () => {
      const params = {
        action: 'delete' as const,
        project_id: '123',
        tag_name: 'v1.0.0',
      };

      const result = ManageReleaseSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.action).toBe('delete');
      }
    });

    it('should validate create_link parameters', async () => {
      const params = {
        action: 'create_link' as const,
        project_id: '123',
        tag_name: 'v1.0.0',
        name: 'Windows Installer',
        url: 'https://example.com/installer.exe',
        link_type: 'package' as const,
      };

      const result = ManageReleaseSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'create_link') {
        expect(result.data.name).toBe('Windows Installer');
        expect(result.data.link_type).toBe('package');
      }
    });

    it('should validate delete_link parameters', async () => {
      const params = {
        action: 'delete_link' as const,
        project_id: '123',
        tag_name: 'v1.0.0',
        link_id: '456',
      };

      const result = ManageReleaseSchema.safeParse(params);
      expect(result.success).toBe(true);

      if (result.success && result.data.action === 'delete_link') {
        expect(result.data.link_id).toBe('456');
      }
    });

    it('should reject invalid asset link URL', async () => {
      const params = {
        action: 'create' as const,
        project_id: '123',
        tag_name: 'v1.0.0',
        assets: {
          links: [
            {
              name: 'Invalid',
              url: 'not-a-valid-url',
            },
          ],
        },
      };

      const result = ManageReleaseSchema.safeParse(params);
      expect(result.success).toBe(false);
    });

    it('should reject invalid link_type', async () => {
      const params = {
        action: 'create_link' as const,
        project_id: '123',
        tag_name: 'v1.0.0',
        name: 'Test',
        url: 'https://example.com',
        link_type: 'invalid' as const,
      };

      const result = ManageReleaseSchema.safeParse(params);
      expect(result.success).toBe(false);
    });
  });

  /**
   * Release Lifecycle Tests
   * Tests actual create/update/delete operations against real GitLab instance
   * Only runs if we can find a suitable test project in the 'test' group
   */
  describe('Release Lifecycle - Full CRUD', () => {
    const testTagName = `test-release-${Date.now()}`;
    let createdRelease: { tag_name: string; name: string } | null = null;
    let createdLinkId: string | null = null;

    it('should create a new release', async () => {
      if (!testProjectId) {
        console.log('Skipping: no test project available');
        return;
      }

      try {
        // Create a release on the default branch
        const result = (await helper.executeTool('manage_release', {
          action: 'create',
          project_id: testProjectId,
          tag_name: testTagName,
          name: `Test Release ${testTagName}`,
          description: 'Integration test release - will be deleted',
          ref: testProjectRef, // Create new tag from the project's real default branch
        })) as {
          tag_name: string;
          name: string;
          description: string;
        };

        expect(result).toBeDefined();
        expect(result.tag_name).toBe(testTagName);
        createdRelease = result;

        console.log(`Created test release: ${result.tag_name}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Skip ONLY the specific "Target <ref> is invalid" failure, which means the
        // chosen project's ref doesn't exist (empty repo / branch removed between
        // selection and create) - an environment precondition, not a code defect.
        // Any other error surfaces so real regressions aren't masked.
        if (/target\b.+\bis invalid/i.test(errorMsg)) {
          console.log(`Could not create release for ref "${testProjectRef}": ${errorMsg}`);
          return;
        }
        throw error;
      }
    });

    it('should get the created release', async () => {
      if (!createdRelease) {
        console.log('Skipping: no release was created');
        return;
      }

      const result = (await helper.executeTool('browse_releases', {
        action: 'get',
        project_id: testProjectId,
        tag_name: testTagName,
      })) as {
        tag_name: string;
        name: string;
        description: string;
      };

      expect(result).toBeDefined();
      expect(result.tag_name).toBe(testTagName);
      expect(result.description).toContain('Integration test release');

      console.log(`Retrieved release: ${result.tag_name}`);
    });

    it('should update the release', async () => {
      if (!createdRelease) {
        console.log('Skipping: no release was created');
        return;
      }

      const result = (await helper.executeTool('manage_release', {
        action: 'update',
        project_id: testProjectId,
        tag_name: testTagName,
        name: `Updated Test Release ${testTagName}`,
        description: 'Updated description for integration test',
      })) as {
        tag_name: string;
        name: string;
        description: string;
      };

      expect(result).toBeDefined();
      expect(result.name).toContain('Updated');
      expect(result.description).toContain('Updated description');

      console.log(`Updated release: ${result.name}`);
    });

    it('should create an asset link', async () => {
      if (!createdRelease) {
        console.log('Skipping: no release was created');
        return;
      }

      const result = (await helper.executeTool('manage_release', {
        action: 'create_link',
        project_id: testProjectId,
        tag_name: testTagName,
        name: 'Test Documentation',
        url: 'https://docs.example.com/test',
        link_type: 'runbook',
      })) as {
        id: number;
        name: string;
        url: string;
        link_type: string;
      };

      expect(result).toBeDefined();
      expect(result.name).toBe('Test Documentation');
      expect(result.url).toBe('https://docs.example.com/test');
      createdLinkId = result.id.toString();

      console.log(`Created asset link: ${result.name} (ID: ${result.id})`);
    });

    it('should list release assets', async () => {
      if (!createdRelease || !createdLinkId) {
        console.log('Skipping: no release or link was created');
        return;
      }

      const result = (await helper.executeTool('browse_releases', {
        action: 'assets',
        project_id: testProjectId,
        tag_name: testTagName,
      })) as {
        id: number;
        name: string;
        url: string;
      }[];

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      const testLink = result.find((link) => link.name === 'Test Documentation');
      expect(testLink).toBeDefined();

      console.log(`Listed ${result.length} asset links`);
    });

    it('should delete the asset link', async () => {
      if (!createdRelease || !createdLinkId) {
        console.log('Skipping: no release or link was created');
        return;
      }

      const result = (await helper.executeTool('manage_release', {
        action: 'delete_link',
        project_id: testProjectId,
        tag_name: testTagName,
        link_id: createdLinkId,
      })) as {
        deleted: boolean;
        tag_name: string;
        link_id: string;
      };

      expect(result).toBeDefined();
      expect(result.deleted).toBe(true);

      console.log(`Deleted asset link: ${createdLinkId}`);
    });

    it('should delete the release', async () => {
      if (!createdRelease) {
        console.log('Skipping: no release was created');
        return;
      }

      const result = (await helper.executeTool('manage_release', {
        action: 'delete',
        project_id: testProjectId,
        tag_name: testTagName,
      })) as {
        deleted: boolean;
        tag_name: string;
      };

      expect(result).toBeDefined();
      expect(result.deleted).toBe(true);

      console.log(`Deleted release: ${testTagName}`);
    });

    it('should verify release is deleted', async () => {
      if (!createdRelease) {
        console.log('Skipping: no release was created');
        return;
      }

      try {
        await helper.executeTool('browse_releases', {
          action: 'get',
          project_id: testProjectId,
          tag_name: testTagName,
        });
        // If we get here, the release still exists - fail
        throw new Error('Expected release to be deleted but it still exists');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Check if it's our thrown error (meaning release still exists)
        if (errorMsg.includes('Expected release to be deleted')) {
          throw error;
        }
        // 404 is expected - release was deleted
        expect(errorMsg).toMatch(/404|not found/i);
        console.log('Verified: release was successfully deleted');
      }
    });
  });
});
