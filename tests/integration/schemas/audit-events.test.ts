/**
 * Audit Events Schema Integration Tests
 *
 * Backed by the GitLab REST audit-event endpoints (Premium/Ultimate). Schema
 * validation always runs. The end-to-end list checks are tier-gated via
 * describeIfTier('premium', ...) and run against a test/ group or project when
 * available; list_instance needs admin, so it is exercised tolerantly.
 */

import { BrowseAuditEventsSchema } from '../../../src/entities/audit_events/schema-readonly';
import { IntegrationTestHelper } from '../helpers/registry-helper';
import { describeIfTier } from '../../setup/tierGate';

interface AuditEvent {
  id: number;
}

describe('Audit Events Schema - GitLab Integration', () => {
  describe('schema validation', () => {
    it('validates browse_audit_events actions', () => {
      for (const params of [
        { action: 'list_instance', entity_type: 'User', entity_id: 1, created_after: '2026-01-01' },
        { action: 'list_group', group_id: 'g' },
        { action: 'list_project', project_id: 'g/p' },
        { action: 'get', audit_event_id: 1 },
        { action: 'get', audit_event_id: 1, group_id: 'g' },
      ]) {
        expect(BrowseAuditEventsSchema.safeParse(params).success).toBe(true);
      }
    });

    it('rejects a malformed created_before date', () => {
      const result = BrowseAuditEventsSchema.safeParse({
        action: 'list_group',
        group_id: 'g',
        created_before: '01-01-2026',
      });
      expect(result.success).toBe(false);
    });

    it('rejects get with both project_id and group_id', () => {
      const result = BrowseAuditEventsSchema.safeParse({
        action: 'get',
        audit_event_id: 1,
        project_id: 'g/p',
        group_id: 'g',
      });
      expect(result.success).toBe(false);
    });
  });

  describeIfTier('premium', 'audit events (end-to-end, Premium+)', () => {
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

    it('lists a project audit trail when a test project is available', async () => {
      if (!testProjectPath) {
        console.log('No test/ project available; skipping project audit trail');
        return;
      }

      const result = (await helper.executeTool('browse_audit_events', {
        action: 'list_project',
        project_id: testProjectPath,
        per_page: 5,
      })) as AuditEvent[];

      expect(Array.isArray(result)).toBe(true);
      console.log(`  ${testProjectPath} returned ${result.length} audit events`);
    }, 15000);

    it('lists instance audit events or reports lack of admin access', async () => {
      try {
        const result = (await helper.executeTool('browse_audit_events', {
          action: 'list_instance',
          per_page: 5,
        })) as AuditEvent[];
        expect(Array.isArray(result)).toBe(true);
        console.log(`  instance-wide audit events returned ${result.length} rows`);
      } catch (error) {
        // Non-admin tokens cannot read instance audit events; expected.
        console.log(`  list_instance not available for this token: ${(error as Error).message}`);
      }
    }, 15000);
  });
});
