import { gql } from 'graphql-tag';
import type { EffectivePolicy } from '../../configuration/policy';
import { gitlab, GitLabApiError } from '../../utils/gitlab-api';
import { getGitLabBaseUrl } from '../../utils/gitlab-base-url';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';
import { extractSimpleId } from '../../utils/idConversion';
import { instanceAtLeast } from '../instance-version';
import { readDuoProject, assertDuoProject, assertWorkflowProject, type DuoProject } from './access';
import {
  readConsumer,
  foundationalAgents,
  projectEnablement,
  isDuoChat,
  executionUnavailable,
  type Consumer,
} from './discovery';
import {
  DUO_RESPONSE_BYTES,
  requestDuo,
  readWorkflow,
  workflowGid,
  type Workflow,
} from './queries';
import { WAITING, statusCode } from './sessions';
import type { ManageDuoSessionInput } from './schema';

const INPUT_STATE = gql`
  query DuoResumeState($id: AiDuoWorkflowsWorkflowID!) {
    duoWorkflowWorkflows(workflowId: $id, first: 1) {
      nodes {
        id
        projectId
        humanStatus
        createdAt
        statusName @optional
        status @optional
        workflowDefinition @optional
        aiCatalogItemVersionId @optional
        project @optional {
          id
          fullPath
        }
        userPermissions {
          resumeDuoWorkflow
        }
      }
    }
  }
`;

interface MutationResult {
  id: string | number;
  status: string;
  web_url?: string | null;
  workload?: { id?: string | null } | null;
}

/** Never replay an HTTP write, including redirects and ambiguous transport failures. */
async function mutate(
  path: string,
  body: Record<string, unknown>,
  workflowId?: string,
): Promise<unknown> {
  try {
    const result = await gitlab.post<MutationResult>(path, {
      body,
      contentType: 'json',
      rawResponse: true,
      responseByteLimit: DUO_RESPONSE_BYTES,
      redirect: 'error',
    });
    const id = result?.id;
    if (
      (typeof id !== 'string' && typeof id !== 'number') ||
      (typeof id === 'number' && !Number.isSafeInteger(id)) ||
      !/^[1-9]\d*$/.test(String(id)) ||
      typeof result.status !== 'string'
    )
      throw new Error('GitLab did not return a usable Duo session identity');
    return {
      workflow_id: String(result.id),
      status: result.status,
      web_url: result.web_url ?? null,
      workload_id: result.workload?.id ?? null,
      poll_after_seconds: 120,
    };
  } catch (error) {
    const guidance =
      workflowId === undefined
        ? 'Inspect browse_duo_sessions list before trying to start another session.'
        : `Inspect browse_duo_sessions get for workflow ${workflowId} before trying again.`;
    if (error instanceof GitLabApiError) {
      error.message += ` ${guidance} Do not automatically replay this command.`;
      throw error;
    }
    throw new Error(
      `Duo mutation outcome is unknown. ${guidance} Do not automatically replay this command.`,
      { cause: error },
    );
  }
}

/** These documented flows use a target URL, not a prose goal or the default branch. */
async function goalContext(
  project: DuoProject,
  flow: string | null | undefined,
  goal: string,
): Promise<Record<string, unknown>> {
  if (flow !== 'fix_pipeline/v1' && flow !== 'code_review/v1') return { goal };
  const target = new URL(goal);
  const base = new URL(getGitLabBaseUrl());
  if (target.origin !== base.origin || target.username || target.password)
    throw new Error('Duo target URL must belong to the selected GitLab instance');
  const kind = flow === 'fix_pipeline/v1' ? 'pipelines' : 'merge_requests';
  const prefix = `${base.pathname.replace(/\/$/, '')}/${project.path}/-/${kind}/`;
  const pathname = decodeURIComponent(target.pathname);
  if (!pathname.startsWith(prefix))
    throw new Error('Duo target URL must belong to the selected project');
  const id = pathname.slice(prefix.length);
  if (!/^[1-9]\d*$/.test(id))
    throw new Error('Duo target URL must identify one pipeline or merge request');
  const object = await gitlab.get<{ project_id: number; ref?: string; source_branch?: string }>(
    `projects/${normalizeProjectId(project.id)}/${encodeApiSegment(kind)}/${encodeApiSegment(id)}`,
    { responseByteLimit: DUO_RESPONSE_BYTES, rawResponse: true },
  );
  if (String(object.project_id) !== project.id)
    throw new Error('Duo goal target belongs to another project');
  // GitLab 19.5 resolves the validated URL to its branch and additional context itself.
  if (!instanceAtLeast('19.5'))
    throw new Error(
      'URL-targeted Duo flows require GitLab 19.5 to preserve target branch and context',
    );
  return { goal: target.href };
}

async function checkedConsumer(
  id: string,
  project: DuoProject,
): Promise<NonNullable<Consumer['item']>> {
  const consumer = await readConsumer(id);
  if (!consumer.project || extractSimpleId(consumer.project.id) !== project.id)
    throw new Error('Configured Duo consumer does not belong to the selected project');
  if (!consumer.enabled || consumer.item?.itemType !== 'FLOW')
    throw new Error('Configured Duo consumer is not an enabled flow');
  if (consumer.userPermissions?.executeAiCatalogItem === false)
    throw new Error('GitLab does not permit executing this Duo flow');
  return consumer.item;
}

async function startSelection(
  input: Extract<ManageDuoSessionInput, { action: 'start' }>,
  project: DuoProject,
  enabledFlows: string[] | null | undefined,
): Promise<{ body: Record<string, unknown>; flow: string | null | undefined }> {
  const body: Record<string, unknown> = {};
  let flow: string | null | undefined = input.flow;
  if (input.consumer_id !== undefined) {
    const item = await checkedConsumer(input.consumer_id, project);
    flow = item.foundationalFlowReference;
    body.ai_catalog_item_consumer_id = input.consumer_id;
  } else if (input.agent !== undefined) {
    if (!instanceAtLeast('19.5'))
      throw new Error('Foundational agent CI sessions require GitLab 19.5');
    const available = (await foundationalAgents(project)).some(
      (entry) => entry.referenceWithVersion === input.agent,
    );
    if (!available || isDuoChat(input.agent))
      throw new Error('Select a startable foundational agent from project discovery');
    body.workflow_definition = input.agent;
  } else {
    if (input.flow === undefined || !enabledFlows?.includes(input.flow))
      throw new Error(
        'The foundational flow is not enabled in this project; select a configured consumer from discovery',
      );
    body.workflow_definition = input.flow;
  }
  return { body, flow };
}

export async function startDuoSession(
  input: Extract<ManageDuoSessionInput, { action: 'start' }>,
  policy: EffectivePolicy,
): Promise<unknown> {
  const project = await readDuoProject(input.project_id);
  assertDuoProject(project, policy);
  const enablement = await projectEnablement(project);
  if (executionUnavailable(enablement))
    throw new Error(
      'GitLab Duo CI execution is unavailable; inspect agents_and_flows prerequisites',
    );
  const { body, flow } = await startSelection(input, project, enablement?.enabledFoundationalFlows);
  Object.assign(body, { project_id: project.id, start_workflow: true, environment: 'ambient' });
  Object.assign(body, await goalContext(project, flow, input.goal));
  return mutate('ai/duo_workflows/workflows', body);
}

export async function sendDuoInput(
  input: Extract<ManageDuoSessionInput, { action: 'send_input' }>,
  policy: EffectivePolicy,
): Promise<unknown> {
  const before = await readWorkflow(input.workflow_id);
  await assertWorkflowProject(before, policy);
  const result = await requestDuo<{
    duoWorkflowWorkflows: { nodes: Array<Workflow & { aiCatalogItemVersionId?: string | null }> };
  }>(INPUT_STATE, { id: workflowGid(input.workflow_id) });
  const row = result.duoWorkflowWorkflows.nodes.find(
    (entry) => extractSimpleId(entry.id) === extractSimpleId(input.workflow_id),
  );
  if (row?.projectId !== before.projectId)
    throw new Error('Duo session project changed or is unavailable');
  const status = statusCode(row);
  if (status === null || !WAITING.has(status))
    throw new Error('Duo session is not in a supported waiting state');
  if (row.userPermissions?.resumeDuoWorkflow !== true)
    throw new Error(
      'GitLab does not currently allow resuming: the preceding CI job may still be running, or access is restricted',
    );
  if (!instanceAtLeast('19.5') && !row.aiCatalogItemVersionId)
    throw new Error(
      'This GitLab version can resume catalog flows only; foundational agents require GitLab 19.5',
    );
  const body: Record<string, unknown> = { human_approval: input.human_approval };
  if (input.human_message !== undefined) body.human_message = input.human_message;
  return mutate(
    `ai/duo_workflows/workflows/${extractSimpleId(input.workflow_id)}/resume`,
    body,
    extractSimpleId(input.workflow_id),
  );
}
