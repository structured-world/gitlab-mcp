import {
  auditEventsToolRegistry,
  getAuditEventsReadOnlyToolNames,
} from '../../../../src/entities/audit_events/registry';
import {
  installFetchMock,
  mockOk,
  lastFetchCall as lastCall,
  mockEnhancedFetch,
} from '../../helpers/fetch-mock';

jest.mock('../../../../src/utils/fetch', () => ({
  enhancedFetch: jest.fn(),
}));

installFetchMock();

const browse = () => auditEventsToolRegistry.get('browse_audit_events')!;

describe('Audit Events Registry', () => {
  describe('Registry Structure', () => {
    it('contains exactly the one read-only CQRS tool', () => {
      expect(Array.from(auditEventsToolRegistry.keys())).toEqual(['browse_audit_events']);
    });

    it('exposes the browse tool as read-only with no manage counterpart', () => {
      expect(getAuditEventsReadOnlyToolNames()).toEqual(['browse_audit_events']);
      expect(auditEventsToolRegistry.size).toBe(1);
    });

    it('declares the Premium-tier requirement and USE_AUDIT_EVENTS gate', () => {
      expect(browse().requirements?.default).toMatchObject({ tier: 'premium' });
      expect(browse().gate).toEqual({ envVar: 'USE_AUDIT_EVENTS', defaultValue: true });
    });
  });

  describe('browse_audit_events', () => {
    it('list_instance reads the instance audit_events with filters', async () => {
      mockOk([{ id: 1 }]);
      await browse().handler({
        action: 'list_instance',
        entity_type: 'User',
        entity_id: 42,
        created_after: '2026-01-01',
      });

      const [url] = lastCall();
      expect(url).toContain('https://gitlab.example.com/api/v4/audit_events?');
      expect(url).toContain('entity_type=User');
      expect(url).toContain('entity_id=42');
      expect(url).toContain('created_after=2026-01-01');
      expect(url).not.toContain('/projects/');
      expect(url).not.toContain('/groups/');
    });

    it('list_group reads the group audit_events collection', async () => {
      mockOk([{ id: 1 }]);
      await browse().handler({ action: 'list_group', group_id: 'my-group' });

      const [url] = lastCall();
      expect(url).toContain('/groups/my-group/audit_events');
    });

    it('list_project reads the project audit_events collection', async () => {
      mockOk([{ id: 1 }]);
      await browse().handler({ action: 'list_project', project_id: 'group/project' });

      const [url] = lastCall();
      expect(url).toContain('/projects/group%2Fproject/audit_events');
    });

    it('get without a scope reads an instance audit event by id', async () => {
      mockOk({ id: 7 });
      await browse().handler({ action: 'get', audit_event_id: 7 });

      const [url] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/audit_events/7');
    });

    it('get with group_id reads a group audit event by id', async () => {
      mockOk({ id: 7 });
      await browse().handler({ action: 'get', audit_event_id: 7, group_id: 'g' });

      const [url] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/groups/g/audit_events/7');
    });

    it('get with project_id reads a project audit event by id', async () => {
      mockOk({ id: 7 });
      await browse().handler({ action: 'get', audit_event_id: 7, project_id: '123' });

      const [url] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/projects/123/audit_events/7');
    });

    it('coerces a string audit_event_id to a number', async () => {
      mockOk({ id: 7 });
      await browse().handler({ action: 'get', audit_event_id: '7' });

      const [url] = lastCall();
      expect(url).toBe('https://gitlab.example.com/api/v4/audit_events/7');
    });

    it('rejects get with both project_id and group_id', async () => {
      await expect(
        browse().handler({ action: 'get', audit_event_id: 7, project_id: '1', group_id: 'g' }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });

    it('rejects a malformed created_after that is not YYYY-MM-DD', async () => {
      await expect(
        browse().handler({ action: 'list_instance', created_after: '2026/01/01' }),
      ).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    });
  });
});
