import type { EffectivePolicy } from '../../configuration/policy';
import { callRestriction, withoutScope } from '../../configuration/policy';
import { readAllowedProject } from '../../configuration/operator-projects';
import { gitlab } from '../../utils/gitlab-api';
import { extractSimpleId } from '../../utils/idConversion';
import { canonicalProjectPath } from '../../utils/api-path';
import { DUO_RESPONSE_BYTES, type Workflow } from './queries';

export interface DuoProject {
  id: string;
  path: string;
}

/** The MCP invocation supplies its already combined operator, account and chat policy. */
export function duoPolicy(
  tool: string,
  args: Record<string, unknown>,
  policy?: EffectivePolicy,
): EffectivePolicy {
  if (!policy) throw new Error('Duo tools require the authenticated call execution policy');
  const reason = callRestriction(
    withoutScope(policy),
    { name: tool, group: 'duo', readOnly: tool === 'browse_duo_sessions' },
    args,
  );
  if (reason) throw new Error(`Duo operation is not allowed: ${reason}`);
  return policy;
}

export async function readDuoProject(id: string): Promise<DuoProject> {
  const project = await readAllowedProject(id, (path) =>
    gitlab.get(path, {
      responseByteLimit: DUO_RESPONSE_BYTES,
      rawResponse: true,
    }),
  );
  if (!project) throw new Error('Duo project is unavailable');
  return project;
}

export function permitsDuoProject(project: DuoProject, policy: EffectivePolicy): boolean {
  if (policy.operatorProjectIds && !policy.operatorProjectIds.has(project.id)) return false;
  return (
    !policy.scopeEnforcer ||
    policy.scopeEnforcer.listsId(project.id, 'project') ||
    policy.scopeEnforcer.isAllowed(project.path)
  );
}

export function assertDuoProject(project: DuoProject, policy: EffectivePolicy): void {
  if (!permitsDuoProject(project, policy))
    throw new Error('Duo session project is outside the permitted projects or working scope');
}

/** Resolve provenance from GitLab, never from a caller's project hint. */
export async function workflowProject(workflow: Workflow): Promise<DuoProject | null> {
  if (workflow.projectId === null) return null;
  const id = extractSimpleId(workflow.projectId);
  if (!/^[1-9]\d*$/.test(id)) throw new Error('GitLab returned an invalid Duo project identity');
  if (workflow.project && extractSimpleId(workflow.project.id) === id)
    return { id, path: canonicalProjectPath(workflow.project.fullPath) };
  return readDuoProject(id);
}

export async function assertWorkflowProject(
  workflow: Workflow,
  policy: EffectivePolicy,
): Promise<DuoProject | null> {
  const project = await workflowProject(workflow);
  if (project) assertDuoProject(project, policy);
  else if (policy.scopeEnforcer || policy.operatorProjectIds)
    throw new Error('GitLab did not expose a verifiable project for this Duo session');
  return project;
}
