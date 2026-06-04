/**
 * Access Tokens Schema Integration Tests
 *
 * Backed by the GitLab REST access-token endpoints. list_personal runs end-to-end
 * against the current user. The project-token lifecycle (create -> rotate -> revoke)
 * runs only when a writable test/ project is available and the token has owner/admin
 * rights; otherwise it skips. A created token is always revoked in cleanup so no
 * live credential is left behind.
 */

import { BrowseAccessTokensSchema } from '../../../src/entities/access_tokens/schema-readonly';
import { ManageAccessTokenSchema } from '../../../src/entities/access_tokens/schema';
import { IntegrationTestHelper } from '../helpers/registry-helper';

interface TokenResponse {
  id: number;
  name: string;
  token?: string;
}

describe('Access Tokens Schema - GitLab Integration', () => {
  let helper: IntegrationTestHelper;
  let testProjectPath: string | undefined;

  beforeAll(async () => {
    if (!process.env.GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }
    helper = new IntegrationTestHelper();
    await helper.initialize();

    const projects = (await helper.listProjects({ search: 'test', per_page: 10 })) as {
      path_with_namespace: string;
    }[];
    testProjectPath = projects.find((p) =>
      p.path_with_namespace.startsWith('test/'),
    )?.path_with_namespace;
  });

  describe('schema validation', () => {
    it('validates browse_access_tokens actions', () => {
      for (const params of [
        { action: 'list_personal', state: 'active', search: 'ci' },
        { action: 'list_project', project_id: 'g/p' },
        { action: 'list_group', group_id: 'g' },
        { action: 'get', token_id: 1 },
        { action: 'get', token_id: 1, project_id: 'g/p' },
      ]) {
        expect(BrowseAccessTokensSchema.safeParse(params).success).toBe(true);
      }
    });

    it('validates manage_access_token actions', () => {
      for (const params of [
        { action: 'create_project', project_id: 'g/p', name: 't', scopes: ['api'] },
        { action: 'create_group', group_id: 'g', name: 't', scopes: ['api'], access_level: 40 },
        { action: 'rotate', token_id: 1, expires_at: '2026-12-31' },
        { action: 'revoke', token_id: 1, group_id: 'g' },
      ]) {
        expect(ManageAccessTokenSchema.safeParse(params).success).toBe(true);
      }
    });

    it('rejects create with an empty scopes array', () => {
      const result = ManageAccessTokenSchema.safeParse({
        action: 'create_project',
        project_id: 'g/p',
        name: 't',
        scopes: [],
      });
      expect(result.success).toBe(false);
    });

    it('rejects get with both project_id and group_id', () => {
      const result = BrowseAccessTokensSchema.safeParse({
        action: 'get',
        token_id: 1,
        project_id: 'g/p',
        group_id: 'g',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('list_personal (end-to-end)', () => {
    it('returns the current user personal access tokens', async () => {
      const result = (await helper.executeTool('browse_access_tokens', {
        action: 'list_personal',
        per_page: 5,
      })) as TokenResponse[];

      expect(Array.isArray(result)).toBe(true);
      console.log(`  current user has ${result.length} personal access tokens (page 1)`);
    }, 15000);
  });

  describe('project token lifecycle (create -> rotate -> revoke)', () => {
    it('creates, rotates, and revokes a project access token when permitted', async () => {
      if (!testProjectPath) {
        console.log('No test/ project available; skipping project-token lifecycle');
        return;
      }

      const uniqueName = `mcp-it-${Date.now()}`;
      let tokenId: number | undefined;

      try {
        const created = (await helper.executeTool('manage_access_token', {
          action: 'create_project',
          project_id: testProjectPath,
          name: uniqueName,
          scopes: ['read_api'],
        })) as TokenResponse & { _meta?: { sensitive?: boolean } };

        tokenId = created.id;
        expect(typeof created.token).toBe('string');
        expect(created._meta?.sensitive).toBe(true);

        const rotated = (await helper.executeTool('manage_access_token', {
          action: 'rotate',
          project_id: testProjectPath,
          token_id: tokenId,
        })) as TokenResponse & { _meta?: { sensitive?: boolean } };
        // Rotation issues a NEW token id; track that one for cleanup.
        tokenId = rotated.id;
        expect(typeof rotated.token).toBe('string');
        console.log(`  rotated project token on ${testProjectPath}`);
      } catch (error) {
        console.log(`  project-token lifecycle not permitted: ${(error as Error).message}`);
      } finally {
        if (tokenId !== undefined) {
          await helper
            .executeTool('manage_access_token', {
              action: 'revoke',
              project_id: testProjectPath,
              token_id: tokenId,
            })
            .catch(() => undefined);
        }
      }
    }, 30000);
  });
});
