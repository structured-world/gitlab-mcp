import { gql } from 'graphql-tag';
import { graphqlSupports } from '../instance-version';
import { extractSimpleId } from '../../utils/idConversion';
import { requestDuo, type PageInfo } from './queries';
import type { DuoProject } from './access';

export interface Consumer {
  id: string;
  enabled: boolean | null;
  project?: { id: string } | null;
  serviceAccount?: { id: string } | null;
  parentItemConsumer?: { serviceAccount?: { id: string } | null } | null;
  userPermissions: { executeAiCatalogItem?: boolean } | null;
  item: {
    id: string;
    name: string;
    description: string;
    itemType: string;
    foundational?: boolean;
    foundationalFlowReference?: string | null;
  } | null;
}
interface Agent {
  id: string;
  name: string;
  description: string;
  referenceWithVersion: string | null;
}
export interface Enablement {
  enabled: boolean;
  runnerAvailable?: boolean | null;
  createDuoWorkflowForCiAllowed?: boolean;
  remoteFlowsEnabled?: boolean;
  enabledFoundationalFlows?: string[] | null;
  checks?: Array<{ name: string; value: boolean; message: string | null }>;
}

const CONSUMER_FIELDS = `
  id enabled project { id }
  serviceAccount @optional { id }
  parentItemConsumer @optional { serviceAccount @optional { id } }
  userPermissions { executeAiCatalogItem @optional }
  item { id name description itemType foundational @optional foundationalFlowReference @optional }
`;
const catalogQuery = (foundational: boolean) => gql`
  query DuoCatalog($projectId: ProjectID!, $first: Int!, $after: String) {
    aiCatalogConfiguredItems(projectId: $projectId, first: $first, after: $after ${foundational ? ', includeFoundationalConsumers: true' : ''}) {
      nodes { ${CONSUMER_FIELDS} } pageInfo { hasNextPage endCursor }
    }
  }
`;
const CATALOG = catalogQuery(false);
const CATALOG_FOUNDATIONAL = catalogQuery(true);
const CONSUMER = gql`
  query DuoConfiguredConsumer($id: AiCatalogItemConsumerID!) {
    aiCatalogItemConsumer(id: $id) { ${CONSUMER_FIELDS} }
  }
`;
const AGENTS = gql`
  query DuoFoundationalAgents($projectId: ProjectID!) {
    aiFoundationalChatAgents(projectId: $projectId) {
      nodes {
        id
        name
        description
        referenceWithVersion
      }
    }
  }
`;
const ENABLEMENT = gql`
  query DuoProjectEnablement($path: ID!) {
    project(fullPath: $path) {
      duoWorkflowRunnerAvailable @optional
      duoWorkflowStatusCheck @optional {
        enabled
        createDuoWorkflowForCiAllowed @optional
        remoteFlowsEnabled @optional
        enabledFoundationalFlows @optional
        checks {
          name
          value
          message
        }
      }
    }
  }
`;

export const isDuoChat = (reference: string | null | undefined): boolean =>
  reference === 'chat' || reference === 'agentic_chat/v1';

export function executionUnavailable(checks: Enablement | null): boolean {
  return (
    checks?.enabled === false ||
    checks?.createDuoWorkflowForCiAllowed === false ||
    checks?.runnerAvailable === false
  );
}

export function preview(
  value: string | null | undefined,
  limit: number,
): { text: string | null; truncated: boolean } {
  if (value === undefined || value === null) return { text: null, truncated: false };
  let end = 0;
  for (let characters = 0; characters < limit && end < value.length; characters++) {
    // The loop condition keeps the offset within the string.
    const codePoint = value.codePointAt(end) as number;
    end += codePoint > 0xffff ? 2 : 1;
  }
  return { text: value.slice(0, end), truncated: end < value.length };
}

export async function projectEnablement(project: DuoProject): Promise<Enablement | null> {
  const result = await requestDuo<{
    project: {
      duoWorkflowStatusCheck?: Enablement | null;
      duoWorkflowRunnerAvailable?: boolean | null;
    } | null;
  }>(ENABLEMENT, { path: project.path });
  if (!result.project) throw new Error('Duo project is unavailable');
  const checks = result.project.duoWorkflowStatusCheck;
  return checks
    ? { ...checks, runnerAvailable: result.project.duoWorkflowRunnerAvailable ?? null }
    : null;
}

export async function foundationalAgents(project: DuoProject): Promise<Agent[]> {
  if (!graphqlSupports('Query', 'aiFoundationalChatAgents')) return [];
  const result = await requestDuo<{ aiFoundationalChatAgents: { nodes: Agent[] } | null }>(AGENTS, {
    projectId: `gid://gitlab/Project/${project.id}`,
  });
  return result.aiFoundationalChatAgents?.nodes ?? [];
}

export async function readConsumer(id: string): Promise<Consumer> {
  const result = await requestDuo<{ aiCatalogItemConsumer: Consumer | null }>(CONSUMER, {
    id: `gid://gitlab/Ai::Catalog::ItemConsumer/${id}`,
  });
  if (!result.aiCatalogItemConsumer) throw new Error('Configured Duo consumer is unavailable');
  return result.aiCatalogItemConsumer;
}

function catalogItem(
  consumer: Consumer,
  item: NonNullable<Consumer['item']>,
  enablement: Enablement | null,
): Record<string, unknown> {
  const permitted = consumer.userPermissions?.executeAiCatalogItem;
  const refused =
    item.itemType !== 'FLOW' || permitted === false || executionUnavailable(enablement);
  // Execution permission alone does not prove runner, billing and composite-identity readiness.
  return {
    kind: item.itemType.toLowerCase(),
    catalog_item_id: extractSimpleId(item.id),
    consumer_id: extractSimpleId(consumer.id),
    name: item.name,
    description: preview(item.description, 200),
    flow: item.foundationalFlowReference ?? null,
    can_start_session: refused ? false : null,
    can_execute_catalog_item: permitted ?? null,
    service_account_configured: !!(
      consumer.serviceAccount ?? consumer.parentItemConsumer?.serviceAccount
    ),
  };
}

export async function discoverDuo(
  project: DuoProject,
  first: number,
  after: string | undefined,
  itemType?: string,
): Promise<unknown> {
  const document = graphqlSupports(
    'Query',
    'aiCatalogConfiguredItems',
    'includeFoundationalConsumers',
  )
    ? CATALOG_FOUNDATIONAL
    : CATALOG;
  const result = await requestDuo<{
    aiCatalogConfiguredItems: { nodes: Consumer[]; pageInfo: PageInfo };
  }>(document, {
    projectId: `gid://gitlab/Project/${project.id}`,
    first,
    after,
  });
  const enablement = await projectEnablement(project);
  const items: Record<string, unknown>[] = [];
  for (const consumer of result.aiCatalogConfiguredItems.nodes) {
    const item = consumer.item;
    if (!consumer.enabled || !item || (item.itemType === 'AGENT' && item.foundational)) continue;
    if (itemType !== undefined && item.itemType.toLowerCase() !== itemType) continue;
    items.push(catalogItem(consumer, item, enablement));
  }
  if (after === undefined && (itemType === undefined || itemType === 'agent')) {
    for (const agent of await foundationalAgents(project)) {
      items.push({
        kind: 'foundational_agent',
        agent: agent.referenceWithVersion,
        name: agent.name,
        description: preview(agent.description, 200),
        // Visibility alone does not establish the agent's execution or billing eligibility.
        can_start_session:
          isDuoChat(agent.referenceWithVersion) || executionUnavailable(enablement) ? false : null,
      });
    }
  }
  return {
    project_id: project.id,
    items,
    pageInfo: result.aiCatalogConfiguredItems.pageInfo,
    enablement,
  };
}
