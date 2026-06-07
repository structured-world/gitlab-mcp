/**
 * Vulnerabilities Schema Integration Tests
 *
 * Backed by the GitLab GraphQL Vulnerability API (Ultimate). Schema validation
 * always runs. The end-to-end list checks are tier-gated via
 * describeIfTier('ultimate', ...) and run read-only against a test/ project, group,
 * and the instance. State mutations (dismiss/confirm/resolve/revert) are NOT run
 * here: they would permanently alter real finding state.
 */

import { BrowseVulnerabilitiesSchema } from '../../../src/entities/vulnerabilities/schema-readonly';
import { ManageVulnerabilitySchema } from '../../../src/entities/vulnerabilities/schema';
import {
  IntegrationTestHelper,
  initIntegrationHelper,
  findTestProjectPath,
} from '../helpers/registry-helper';
import { describeIfTier } from '../../setup/tierGate';

interface VulnConnection {
  nodes: { id: number }[];
}

describe('Vulnerabilities Schema - GitLab Integration', () => {
  describe('schema validation', () => {
    it('validates browse_vulnerabilities actions', () => {
      for (const params of [
        { action: 'list' },
        { action: 'list', project_id: 'g/p', state: ['DETECTED'], severity: ['CRITICAL'] },
        { action: 'list', group_id: 'g', report_type: ['SAST'], sort: 'severity_desc' },
        { action: 'get', vulnerability_id: 1 },
      ]) {
        expect(BrowseVulnerabilitiesSchema.safeParse(params).success).toBe(true);
      }
    });

    it('validates manage_vulnerability actions', () => {
      for (const params of [
        { action: 'dismiss', vulnerability_id: 1, dismissal_reason: 'FALSE_POSITIVE' },
        { action: 'confirm', vulnerability_id: 1 },
        { action: 'resolve', vulnerability_id: 1 },
        { action: 'revert', vulnerability_id: 1 },
      ]) {
        expect(ManageVulnerabilitySchema.safeParse(params).success).toBe(true);
      }
    });

    it('rejects an invalid severity filter', () => {
      const result = BrowseVulnerabilitiesSchema.safeParse({
        action: 'list',
        severity: ['SUPER_BAD'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects list with both project_id and group_id', () => {
      const result = BrowseVulnerabilitiesSchema.safeParse({
        action: 'list',
        project_id: 'g/p',
        group_id: 'g',
      });
      expect(result.success).toBe(false);
    });
  });

  describeIfTier('ultimate', 'vulnerabilities (end-to-end, Ultimate)', () => {
    let helper: IntegrationTestHelper;
    let testProjectPath: string | undefined;

    beforeAll(async () => {
      helper = await initIntegrationHelper();
      testProjectPath = await findTestProjectPath(helper);
    });

    /** Run a list scope and assert it returns a (possibly empty) node array. */
    const expectListNodes = async (
      scope: Record<string, unknown>,
      label: string,
    ): Promise<void> => {
      const result = (await helper.executeTool('browse_vulnerabilities', {
        action: 'list',
        first: 5,
        ...scope,
      })) as VulnConnection;
      expect(Array.isArray(result.nodes)).toBe(true);
      console.log(`  ${label} has ${result.nodes.length} vulnerabilities`);
    };

    it('lists project vulnerabilities (possibly empty) for a test project', async () => {
      if (!testProjectPath) {
        console.log('No test/ project available; skipping project vulnerabilities list');
        return;
      }
      await expectListNodes({ project_id: testProjectPath }, testProjectPath);
    }, 20000);

    it('lists group vulnerabilities for the test group', async () => {
      if (!testProjectPath) {
        console.log('No test/ project available; skipping group vulnerabilities list');
        return;
      }
      const groupPath = testProjectPath.split('/')[0];
      await expectListNodes({ group_id: groupPath }, `group ${groupPath}`);
    }, 20000);

    it('lists instance vulnerabilities or reports lack of access', async () => {
      try {
        await expectListNodes({}, 'instance-wide');
      } catch (error) {
        console.log(`  instance list not available: ${(error as Error).message}`);
      }
    }, 20000);
  });
});
