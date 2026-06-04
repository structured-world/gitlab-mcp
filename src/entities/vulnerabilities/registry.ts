import * as z from 'zod';
import { BrowseVulnerabilitiesSchema } from './schema-readonly';
import { ManageVulnerabilitySchema } from './schema';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { assertActionAllowed } from '../utils';
import { ConnectionManager } from '../../services/ConnectionManager';
import { cleanGidsFromObject } from '../../utils/idConversion';
import {
  LIST_PROJECT_VULNS,
  LIST_GROUP_VULNS,
  LIST_INSTANCE_VULNS,
  GET_VULN,
  DISMISS_VULN,
  CONFIRM_VULN,
  RESOLVE_VULN,
  REVERT_VULN,
  type VulnListVars,
} from '../../graphql/vulnerabilities';

// Vulnerability Management is Ultimate-tier; the capability gate hides the tool on
// lower tiers. The GraphQL surface stabilised around 13.x; the floor is declared
// here and the tier gate does the rest.
const ULTIMATE_REQ = {
  tier: 'ultimate',
  minVersion: '13.0',
  notes: 'Vulnerability Management',
} as const;

const vulnerabilityGid = (id: number): string => `gid://gitlab/Vulnerability/${id}`;

/** Build the shared GraphQL list filter variables from the parsed input. */
function listVars(input: {
  state?: string[];
  severity?: string[];
  report_type?: string[];
  sort?: string;
  first?: number;
  after?: string;
}): VulnListVars {
  return {
    state: input.state ?? null,
    severity: input.severity ?? null,
    reportType: input.report_type ?? null,
    sort: input.sort ?? null,
    first: input.first ?? 20,
    after: input.after ?? null,
  };
}

/** Throw on a non-empty GraphQL mutation `errors` array. */
function assertNoErrors(errors: string[] | undefined): void {
  if (errors && errors.length > 0) {
    throw new Error(`GitLab API error: ${errors.join(', ')}`);
  }
}

/**
 * Vulnerabilities tools registry - 2 CQRS tools.
 *
 * browse_vulnerabilities (Query): list (project/group/instance), get
 * manage_vulnerability (Command): dismiss, confirm, resolve, revert
 *
 * Backed by the GitLab GraphQL Vulnerability API (richer than REST). list scopes
 * by project_id / group_id, or neither for an instance-wide view. State changes
 * map to the vulnerability* mutations. Gated behind USE_VULNERABILITIES. Ultimate
 * tier - the capability gate returns a clear error on Free/Premium.
 */
export const vulnerabilitiesToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_vulnerabilities - CQRS Query Tool
  // ============================================================================
  [
    'browse_vulnerabilities',
    {
      name: 'browse_vulnerabilities',
      description:
        'Inspect security vulnerabilities (Ultimate). Actions: list (a project, a group, or the whole instance when neither id is given; filter by state, severity, report_type), get (a single vulnerability by ID with full detail). Related: manage_vulnerability to dismiss, confirm, resolve, or revert findings.',
      inputSchema: z.toJSONSchema(BrowseVulnerabilitiesSchema),
      requirements: { default: ULTIMATE_REQ },
      gate: { envVar: 'USE_VULNERABILITIES', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseVulnerabilitiesSchema.parse(args);
        assertActionAllowed('browse_vulnerabilities', input.action);

        const client = ConnectionManager.getInstance().getClient();

        switch (input.action) {
          case 'list': {
            if (input.project_id) {
              const res = await client.request(LIST_PROJECT_VULNS, {
                fullPath: input.project_id,
                ...listVars(input),
              });
              if (!res.project) {
                throw new Error(`Project "${input.project_id}" not found or not accessible`);
              }
              return cleanGidsFromObject(res.project.vulnerabilities ?? { nodes: [] });
            }

            if (input.group_id) {
              const res = await client.request(LIST_GROUP_VULNS, {
                fullPath: input.group_id,
                ...listVars(input),
              });
              if (!res.group) {
                throw new Error(`Group "${input.group_id}" not found or not accessible`);
              }
              return cleanGidsFromObject(res.group.vulnerabilities ?? { nodes: [] });
            }

            const res = await client.request(LIST_INSTANCE_VULNS, {
              projectId: null,
              ...listVars(input),
            });
            return cleanGidsFromObject(res.vulnerabilities ?? { nodes: [] });
          }

          case 'get': {
            const res = await client.request(GET_VULN, {
              id: vulnerabilityGid(input.vulnerability_id),
            });
            if (!res.vulnerability) {
              throw new Error(`Vulnerability ${input.vulnerability_id} not found`);
            }
            return cleanGidsFromObject(res.vulnerability);
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_vulnerability - CQRS Command Tool
  // ============================================================================
  [
    'manage_vulnerability',
    {
      name: 'manage_vulnerability',
      description:
        'Drive the vulnerability state machine (Ultimate). Actions: dismiss (with optional dismissal_reason + comment), confirm (genuine finding), resolve (fixed), revert (back to detected). Related: browse_vulnerabilities to discover vulnerability IDs.',
      inputSchema: z.toJSONSchema(ManageVulnerabilitySchema),
      requirements: { default: ULTIMATE_REQ },
      gate: { envVar: 'USE_VULNERABILITIES', defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageVulnerabilitySchema.parse(args);
        assertActionAllowed('manage_vulnerability', input.action);

        const client = ConnectionManager.getInstance().getClient();
        const id = vulnerabilityGid(input.vulnerability_id);

        switch (input.action) {
          case 'dismiss': {
            const res = await client.request(DISMISS_VULN, {
              id,
              comment: input.comment ?? null,
              dismissalReason: input.dismissal_reason ?? null,
            });
            assertNoErrors(res.vulnerabilityDismiss?.errors);
            return cleanGidsFromObject(res.vulnerabilityDismiss?.vulnerability);
          }

          case 'confirm': {
            const res = await client.request(CONFIRM_VULN, { id });
            assertNoErrors(res.vulnerabilityConfirm?.errors);
            return cleanGidsFromObject(res.vulnerabilityConfirm?.vulnerability);
          }

          case 'resolve': {
            const res = await client.request(RESOLVE_VULN, { id });
            assertNoErrors(res.vulnerabilityResolve?.errors);
            return cleanGidsFromObject(res.vulnerabilityResolve?.vulnerability);
          }

          case 'revert': {
            const res = await client.request(REVERT_VULN, { id });
            assertNoErrors(res.vulnerabilityRevertToDetected?.errors);
            return cleanGidsFromObject(res.vulnerabilityRevertToDetected?.vulnerability);
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],
]);

/** Read-only tool names from the registry (for read-only mode filtering). */
export function getVulnerabilitiesReadOnlyToolNames(): string[] {
  return ['browse_vulnerabilities'];
}
