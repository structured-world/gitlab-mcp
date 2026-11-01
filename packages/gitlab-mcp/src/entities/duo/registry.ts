import { z } from 'zod';
import type { EnhancedToolDefinition, ToolRegistry } from '../../types';
import { assertActionAllowed } from '../utils';
import { BrowseDuoSessionsSchema, ManageDuoSessionSchema } from './schema';
import { duoPolicy, readDuoProject, assertDuoProject } from './access';
import { discoverDuo } from './discovery';
import { getDuoSession, listDuoSessions } from './sessions';
import { startDuoSession, sendDuoInput } from './commands';

export const duoToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  [
    'browse_duo_sessions',
    {
      name: 'browse_duo_sessions',
      description:
        'Discover and inspect GitLab Duo sessions. Actions: agents_and_flows (project catalog and foundational agents; keep paging even after an empty filtered page), list (your sessions, optionally in a project), get (progress, pending input, latest answer and created objects). Reads do not start Duo or consume execution credits. Related: manage_duo_session.',
      inputSchema: z.toJSONSchema(BrowseDuoSessionsSchema),
      requirements: {
        default: { tier: 'free', minVersion: '17.3' },
        actions: { agents_and_flows: { tier: 'free', minVersion: '18.5' } },
      },
      gate: { envVar: 'USE_DUO', defaultValue: true },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async (args, executionPolicy) => {
        const input = BrowseDuoSessionsSchema.parse(args);
        assertActionAllowed('browse_duo_sessions', input.action);
        const policy = duoPolicy('browse_duo_sessions', input, executionPolicy);
        switch (input.action) {
          case 'agents_and_flows': {
            const project = await readDuoProject(input.project_id);
            assertDuoProject(project, policy);
            return discoverDuo(project, input.first, input.after, input.item_type);
          }
          case 'list':
            return listDuoSessions(input, policy);
          case 'get':
            return getDuoSession(input.workflow_id, policy);
        }
      },
    },
  ],
  [
    'manage_duo_session',
    {
      name: 'manage_duo_session',
      description:
        'Run GitLab Duo asynchronously in CI. Actions: start (select an enabled flow, configured consumer or foundational agent discovered in the project), send_input (answer, approve or reject a waiting session after its CI job finishes). Both actions can change repositories, create objects and consume credits. Execute only when the user requested the operation. Never automatically replay a timed-out or disconnected command; inspect sessions first.',
      inputSchema: z.toJSONSchema(ManageDuoSessionSchema),
      requirements: {
        default: { tier: 'free', minVersion: '18.7' },
        actions: { send_input: { tier: 'free', minVersion: '19.4' } },
        parameters: { agent: { tier: 'free', minVersion: '19.5' } },
      },
      gate: { envVar: 'USE_DUO', defaultValue: true },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: async (args, executionPolicy) => {
        const input = ManageDuoSessionSchema.parse(args);
        assertActionAllowed('manage_duo_session', input.action);
        const policy = duoPolicy('manage_duo_session', input, executionPolicy);
        return input.action === 'start'
          ? startDuoSession(input, policy)
          : sendDuoInput(input, policy);
      },
    },
  ],
]);

export function getDuoReadOnlyToolNames(): string[] {
  return ['browse_duo_sessions'];
}
