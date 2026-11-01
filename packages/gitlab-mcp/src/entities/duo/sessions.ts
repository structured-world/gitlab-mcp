import { graphqlSupports } from '../instance-version';
import type { EffectivePolicy } from '../../configuration/policy';
import { extractSimpleId } from '../../utils/idConversion';
import { ResponseLimitError } from '../../utils/bounded-json';
import {
  assertWorkflowProject,
  permitsDuoProject,
  readDuoProject,
  workflowProject,
  UnverifiableDuoProjectError,
  type DuoProject,
} from './access';
import { preview, isDuoChat } from './discovery';
import {
  DETAILS,
  HISTORY,
  readWorkflow,
  requestDuo,
  workflowGid,
  workflowPage,
  type Workflow,
  type Message,
} from './queries';
import type { BrowseDuoSessionsInput } from './schema';

export const WAITING = new Set([
  'input_required',
  'plan_approval_required',
  'tool_call_approval_required',
]);
const TERMINAL = new Set(['finished', 'failed', 'stopped']);

export function statusCode(row: Workflow): string | null {
  if (typeof row.statusName === 'string') return row.statusName;
  return typeof row.status === 'string' ? row.status.toLowerCase() : null;
}

export function sessionMetadata(row: Workflow): Record<string, unknown> {
  const status = statusCode(row);
  let pollAfter: number | null = null;
  if (status === 'created') pollAfter = 120;
  else if (status === 'running') pollAfter = 30;
  return {
    workflow_id: extractSimpleId(row.id),
    project_id: row.projectId === null ? null : extractSimpleId(row.projectId),
    status,
    status_label: row.humanStatus,
    flow: row.workflowDefinition ?? null,
    web_url: row.webUrl ?? null,
    created_at: row.createdAt,
    poll_after_seconds: pollAfter,
  };
}

function listedSession(
  row: Workflow,
  selected: DuoProject | null,
  policy: EffectivePolicy,
): boolean {
  if (isDuoChat(row.workflowDefinition)) return false;
  const id = row.projectId === null ? null : extractSimpleId(row.projectId);
  if (selected && id !== selected.id) return false;
  return !policy.operatorProjectIds || (id !== null && policy.operatorProjectIds.has(id));
}

async function listedProject(
  row: Workflow,
  projectReads: Map<string, Promise<DuoProject>>,
): Promise<DuoProject | null> {
  try {
    return await workflowProject(row, projectReads);
  } catch (error) {
    if (error instanceof UnverifiableDuoProjectError) return null;
    throw error;
  }
}

/** Bound simultaneous project responses, counting cache misses rather than session rows. */
async function listedProjects(
  rows: Workflow[],
  projectReads: Map<string, Promise<DuoProject>>,
): Promise<Array<DuoProject | null>> {
  const projects: Array<DuoProject | null> = [];
  const pending: Array<Promise<DuoProject | null>> = [];
  let started = projectReads.size;
  for (const row of rows) {
    pending.push(listedProject(row, projectReads));
    if (projectReads.size - started < 4) continue;
    projects.push(...(await Promise.all(pending)));
    pending.length = 0;
    started = projectReads.size;
  }
  projects.push(...(await Promise.all(pending)));
  return projects;
}

/** Metadata-only pagination: detailed messages from disallowed projects are never requested. */
export async function listDuoSessions(
  input: Extract<BrowseDuoSessionsInput, { action: 'list' }>,
  policy: EffectivePolicy,
): Promise<unknown> {
  const selected = input.project_id === undefined ? null : await readDuoProject(input.project_id);
  if (selected && !permitsDuoProject(selected, policy))
    throw new Error('Duo project is outside the working scope');
  const page = await workflowPage(input.first, input.after);
  const sessions: Record<string, unknown>[] = [];
  const result = {
    sessions,
    pageInfo: page.pageInfo,
    filtered: true,
    skipped_unverifiable_sessions: 0,
  };
  if (!policy.scopeEnforcer) {
    for (const row of page.nodes)
      if (listedSession(row, selected, policy)) sessions.push(sessionMetadata(row));
    return result;
  }
  const projectReads = new Map<string, Promise<DuoProject>>();
  if (selected) projectReads.set(selected.id, Promise.resolve(selected));
  const rows = page.nodes.filter((row) => listedSession(row, selected, policy));
  const projects = await listedProjects(rows, projectReads);
  for (let index = 0; index < rows.length; index++) {
    const project = projects[index];
    if (!project) {
      result.skipped_unverifiable_sessions++;
      continue;
    }
    if (permitsDuoProject(project, policy)) sessions.push(sessionMetadata(rows[index]));
  }
  return result;
}

interface LinkConnection<T> {
  nodes: Array<T | null>;
  pageInfo: { hasNextPage: boolean };
}
interface ObjectLink {
  id: string;
  title: string;
  webUrl: string;
}
interface Details extends Workflow {
  latestCheckpoint?: { lastDuoMessage?: Message | null } | null;
  mergeRequestLinks?: LinkConnection<{ mergeRequest: ObjectLink | null }> | null;
  workItemLinks?: LinkConnection<{ workItem: ObjectLink | null }> | null;
  noteLinks?: LinkConnection<{ note: { id: string; url: string; body: string } | null }> | null;
}
interface History extends Workflow {
  latestCheckpoint: { duoMessages: Message[] } | null;
}

function agentMessage(
  message: Message | null | undefined,
): message is Message & { content: string } {
  return !!message?.content && (message.role === 'assistant' || message.messageType === 'agent');
}

function createdObjects(row: Details): Record<string, unknown> {
  const connections = [row.mergeRequestLinks, row.workItemLinks, row.noteLinks];
  return {
    merge_requests:
      row.mergeRequestLinks?.nodes.flatMap((link) =>
        link?.mergeRequest ? [link.mergeRequest] : [],
      ) ?? null,
    work_items:
      row.workItemLinks?.nodes.flatMap((link) => (link?.workItem ? [link.workItem] : [])) ?? null,
    notes:
      row.noteLinks?.nodes.flatMap((link) =>
        link?.note
          ? [{ id: link.note.id, url: link.note.url, body: preview(link.note.body, 160) }]
          : [],
      ) ?? null,
    limit: 20,
    truncated: connections.some((connection) => connection?.pageInfo.hasNextPage),
  };
}

async function latestAnswer(
  row: Details,
): Promise<{ answer: ReturnType<typeof preview>; history: string }> {
  const last = row.latestCheckpoint?.lastDuoMessage;
  if (agentMessage(last)) return { answer: preview(last.content, 4000), history: 'available' };
  const status = statusCode(row);
  if (status === null || (!WAITING.has(status) && !TERMINAL.has(status)))
    return { answer: preview(null, 4000), history: 'not_requested' };
  if (!graphqlSupports('DuoWorkflowEvent', 'duoMessages'))
    return { answer: preview(null, 4000), history: 'unsupported' };
  try {
    const result = await requestDuo<{ duoWorkflowWorkflows: { nodes: History[] } }>(HISTORY, {
      id: workflowGid(row.id),
    });
    const workflow = result.duoWorkflowWorkflows.nodes.find((entry) => entry.id === row.id);
    if (workflow?.projectId !== row.projectId) throw new Error('Duo provenance changed');
    const messages = workflow.latestCheckpoint?.duoMessages;
    if (!messages) return { answer: preview(null, 4000), history: 'missing_checkpoint' };
    for (let index = messages.length - 1; index >= 0; index--)
      if (agentMessage(messages[index]))
        return { answer: preview(messages[index].content, 4000), history: 'available' };
    return { answer: preview(null, 4000), history: 'no_agent_answer' };
  } catch (error) {
    return {
      answer: preview(null, 4000),
      history: error instanceof ResponseLimitError ? 'too_large' : 'unreadable',
    };
  }
}

export async function getDuoSession(id: string, policy: EffectivePolicy): Promise<unknown> {
  const restricted = !!(policy.scopeEnforcer ?? policy.operatorProjectIds);
  const targeted = graphqlSupports('Query', 'duoWorkflowWorkflows', 'workflowId');
  const initial = restricted || !targeted ? await readWorkflow(id) : null;
  if (initial) await assertWorkflowProject(initial, policy);
  if (!targeted && initial !== null)
    return { ...sessionMetadata(initial), details_available: false, history: 'unsupported' };
  let row: Details;
  try {
    const result = await requestDuo<{ duoWorkflowWorkflows: { nodes: Details[] } }>(DETAILS, {
      id: workflowGid(id),
    });
    const found = result.duoWorkflowWorkflows.nodes.find(
      (entry) => extractSimpleId(entry.id) === extractSimpleId(id),
    );
    if (!found) throw new Error('Duo session is unavailable');
    row = found;
  } catch (error) {
    const metadata = initial ?? (await readWorkflow(id));
    await assertWorkflowProject(metadata, policy);
    return {
      ...sessionMetadata(metadata),
      details_available: false,
      history: error instanceof ResponseLimitError ? 'too_large' : 'unreadable',
    };
  }
  if (initial && initial.projectId !== row.projectId)
    throw new Error('Duo session project changed during lookup');
  await assertWorkflowProject(row, policy);
  if (isDuoChat(row.workflowDefinition))
    throw new Error('General Duo Chat is outside Duo session tools');
  const answer = await latestAnswer(row);
  const status = statusCode(row);
  return {
    ...sessionMetadata(row),
    details_available: true,
    summary: preview(row.summary, 1000),
    ...answer,
    created_objects: createdObjects(row),
    pending_input:
      status !== null && WAITING.has(status)
        ? {
            state: status,
            can_send: row.userPermissions?.resumeDuoWorkflow ?? null,
            guidance:
              'Send input only after the preceding CI job finishes. GitLab remains authoritative for authorization and concurrent state changes.',
          }
        : null,
  };
}
