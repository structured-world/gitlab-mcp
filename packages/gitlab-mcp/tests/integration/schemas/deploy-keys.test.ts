/**
 * Deploy Keys Schema Integration Tests
 * Exercises the deploy key lifecycle against a real GitLab API: add a freshly
 * generated SSH key to a project, read it back, update it, enable it on a second
 * project, and delete it everywhere.
 */

import { generateKeyPairSync } from 'crypto';
import { BrowseDeployKeysSchema } from '../../../src/entities/deploy-keys/schema-readonly';
import { ManageDeployKeySchema } from '../../../src/entities/deploy-keys/schema';
import { IntegrationTestHelper } from '../helpers/registry-helper';

/** Build a unique OpenSSH-format ed25519 public key string. */
function generateOpenSshEd25519PublicKey(): string {
  const { publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const raw = Buffer.from(jwk.x, 'base64url'); // 32-byte ed25519 public key

  const withLength = (buf: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(buf.length);
    return Buffer.concat([len, buf]);
  };
  const wire = Buffer.concat([withLength(Buffer.from('ssh-ed25519')), withLength(raw)]);
  return `ssh-ed25519 ${wire.toString('base64')} integration-test`;
}

interface DeployKey {
  id: number;
  title: string;
  can_push: boolean;
}

describe('Deploy Keys Schema - GitLab Integration', () => {
  let helper: IntegrationTestHelper;

  beforeAll(async () => {
    if (!process.env.GITLAB_TOKEN) {
      throw new Error('GITLAB_TOKEN environment variable is required');
    }
    helper = new IntegrationTestHelper();
    await helper.initialize();
  });

  /** Find up to `count` projects in the mandated `test` root group. */
  async function testProjects(
    count: number,
  ): Promise<{ path_with_namespace: string; id: number }[]> {
    const all = (await helper.listProjects({ per_page: 50 })) as {
      path_with_namespace: string;
      id: number;
    }[];
    return all.filter((p) => p.path_with_namespace.startsWith('test/')).slice(0, count);
  }

  it('adds, reads, updates, and deletes a project deploy key', async () => {
    const projects = await testProjects(1);
    if (projects.length === 0) {
      console.log('No test/ project available — skipping deploy key lifecycle');
      return;
    }
    const project = projects[0];
    const key = generateOpenSshEd25519PublicKey();

    const added = (await helper.executeTool(
      'manage_deploy_key',
      ManageDeployKeySchema.parse({
        action: 'add',
        project_id: project.path_with_namespace,
        title: `it-${Date.now()}`,
        key,
        can_push: false,
      }),
    )) as DeployKey;
    expect(added.id).toBeGreaterThan(0);

    try {
      const fetched = (await helper.executeTool(
        'browse_deploy_keys',
        BrowseDeployKeysSchema.parse({
          action: 'get',
          project_id: project.path_with_namespace,
          key_id: added.id,
        }),
      )) as DeployKey;
      expect(fetched.id).toBe(added.id);

      const updated = (await helper.executeTool(
        'manage_deploy_key',
        ManageDeployKeySchema.parse({
          action: 'update',
          project_id: project.path_with_namespace,
          key_id: added.id,
          can_push: true,
        }),
      )) as DeployKey;
      expect(updated.can_push).toBe(true);
    } finally {
      await helper.executeTool(
        'manage_deploy_key',
        ManageDeployKeySchema.parse({
          action: 'delete',
          project_id: project.path_with_namespace,
          key_id: added.id,
        }),
      );
    }
  });

  it('enables an existing key on a second project', async () => {
    const projects = await testProjects(2);
    if (projects.length < 2) {
      console.log('Need two test/ projects — skipping deploy key enable');
      return;
    }
    const [a, b] = projects;
    const added = (await helper.executeTool(
      'manage_deploy_key',
      ManageDeployKeySchema.parse({
        action: 'add',
        project_id: a.path_with_namespace,
        title: `it-enable-${Date.now()}`,
        key: generateOpenSshEd25519PublicKey(),
      }),
    )) as DeployKey;

    try {
      const enabled = (await helper.executeTool(
        'manage_deploy_key',
        ManageDeployKeySchema.parse({
          action: 'enable',
          project_id: b.path_with_namespace,
          key_id: added.id,
        }),
      )) as DeployKey;
      expect(enabled.id).toBe(added.id);
    } finally {
      // Remove from both projects (best-effort cleanup).
      for (const p of [a, b]) {
        try {
          await helper.executeTool(
            'manage_deploy_key',
            ManageDeployKeySchema.parse({
              action: 'delete',
              project_id: p.path_with_namespace,
              key_id: added.id,
            }),
          );
        } catch {
          // already gone for this project
        }
      }
    }
  });
});
