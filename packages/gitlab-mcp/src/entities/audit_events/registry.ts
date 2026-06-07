import * as z from 'zod';
import { BrowseAuditEventsSchema } from './schema-readonly';
import { gitlab, toQuery } from '../../utils/gitlab-api';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { assertActionAllowed } from '../utils';

// Audit events are a Premium/Ultimate feature; the tier gate hides the tool on
// lower-tier instances. Instance audit events landed in 12.4, group/project in
// 12.5/13.1 - the lowest floor is declared here and the tier gate does the rest.
const PREMIUM_REQ = { tier: 'premium', minVersion: '12.4', notes: 'Audit Events' } as const;

/**
 * Resolve the REST collection path for a single audit event (get action).
 * An event belongs to exactly one scope: project, group, or the instance.
 */
function auditBasePath(input: { project_id?: string; group_id?: string }): string {
  if (input.project_id) {
    return `projects/${encodeURIComponent(input.project_id)}/audit_events`;
  }
  if (input.group_id) {
    return `groups/${encodeURIComponent(input.group_id)}/audit_events`;
  }
  return 'audit_events';
}

/**
 * Audit events tools registry - 1 read-only CQRS tool.
 *
 * browse_audit_events (Query): list_instance, list_group, list_project, get
 *
 * Backed by the GitLab REST audit-event endpoints. There is no manage_* tool:
 * audit events are immutable by design. The instance/group/project scopes fold in
 * as actions; get infers the scope from project_id / group_id. Gated behind
 * USE_AUDIT_EVENTS. Premium/Ultimate tier; list_instance additionally needs admin.
 */
export const auditEventsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  [
    'browse_audit_events',
    {
      name: 'browse_audit_events',
      description:
        'Inspect audit events: the immutable record of who did what, when. Actions: list_instance (instance-wide, admin-only), list_group / list_project (a group or project audit trail), get (a single event by ID - pass project_id or group_id for group/project events, neither for an instance event). Premium/Ultimate feature; there is no write counterpart because audit events cannot be modified.',
      inputSchema: z.toJSONSchema(BrowseAuditEventsSchema),
      requirements: { default: PREMIUM_REQ },
      gate: { envVar: 'USE_AUDIT_EVENTS', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseAuditEventsSchema.parse(args);
        assertActionAllowed('browse_audit_events', input.action);

        switch (input.action) {
          case 'list_instance': {
            const { action: _action, ...query } = input;
            return gitlab.get('audit_events', { query: toQuery(query, []) });
          }

          case 'list_group': {
            const { action: _action, group_id, ...query } = input;
            return gitlab.get(`groups/${encodeURIComponent(group_id)}/audit_events`, {
              query: toQuery(query, []),
            });
          }

          case 'list_project': {
            const { action: _action, project_id, ...query } = input;
            return gitlab.get(`projects/${encodeURIComponent(project_id)}/audit_events`, {
              query: toQuery(query, []),
            });
          }

          case 'get':
            return gitlab.get(`${auditBasePath(input)}/${input.audit_event_id}`);

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],
]);

/** Read-only tool names from the registry (for read-only mode filtering). */
export function getAuditEventsReadOnlyToolNames(): string[] {
  return ['browse_audit_events'];
}
