import { GITLAB_ALLOWED_PROJECT_IDS } from '../config';
import { extractProjectsFromArgs, ScopeEnforcer } from '../profiles/scope-enforcer';
import { canonicalProjectPath } from '../utils/api-path';
import { normalizeProjectId } from '../utils/projectIdentifier';
import { gitlab } from '../utils/gitlab-api';
import { mapBounded } from '../utils/bounded-map';
import { parseGitLabApiError } from '../utils/error-handler';
import { withScopePaths, type ReadResource } from './scope-ids';
import type { EffectivePolicy } from './policy';

interface AllowedProject {
  id: string;
  path: string;
  name: string;
}

/** A project identity from GitLab, using one canonical form for IDs, paths and the picker. */
export async function readAllowedProject(
  input: string,
  read: ReadResource,
): Promise<AllowedProject | undefined> {
  let result: unknown;
  try {
    result = await read(`projects/${normalizeProjectId(input)}`);
  } catch (error: unknown) {
    if (error instanceof Error && parseGitLabApiError(error.message)?.status === 404)
      return undefined;
    throw error;
  }
  const project = result as
    { id?: unknown; path_with_namespace?: unknown; name_with_namespace?: unknown } | undefined;
  if (
    (typeof project?.id !== 'number' && typeof project?.id !== 'string') ||
    typeof project.path_with_namespace !== 'string' ||
    typeof project.name_with_namespace !== 'string'
  ) {
    throw new TypeError('GitLab did not return a verifiable allowed project identity');
  }
  const id = String(project.id);
  if (
    !/^[1-9]\d*$/.test(id) ||
    (typeof project.id === 'number' && !Number.isSafeInteger(project.id))
  ) {
    throw new Error('GitLab returned an invalid allowed project ID');
  }
  return {
    id,
    path: canonicalProjectPath(project.path_with_namespace),
    name: project.name_with_namespace,
  };
}

/** The settings picker may leave the working scope, but never the operator's project list. */
export async function findOperatorProjectTargets(
  query: string,
  read: ReadResource = (path) => gitlab.get(path),
): Promise<Array<{ type: 'project'; path: string; name: string }>> {
  const projects = await mapBounded([...new Set(GITLAB_ALLOWED_PROJECT_IDS)], 5, (input) =>
    readAllowedProject(input, read),
  );
  const search = query.toLowerCase();
  return projects
    .filter(
      (project): project is AllowedProject =>
        project !== undefined &&
        (project.path.toLowerCase().includes(search) ||
          project.name.toLowerCase().includes(search)),
    )
    .map((project) => ({ type: 'project', path: project.path, name: project.name }));
}

/** Refuse a numeric project outside a numeric allowlist without any GitLab lookup. */
export function operatorProjectRejection(args: Record<string, unknown>): string | null {
  if (GITLAB_ALLOWED_PROJECT_IDS.length === 0) return null;
  const allowed = GITLAB_ALLOWED_PROJECT_IDS.map(canonicalProjectPath);
  if (!allowed.every((id) => /^\d+$/.test(id))) return null;
  for (const target of extractProjectsFromArgs(args)) {
    const project = canonicalProjectPath(target);
    if (/^\d+$/.test(project) && !allowed.includes(project)) {
      return `Project ${project} is not allowed by GITLAB_ALLOWED_PROJECT_IDS`;
    }
  }
  return null;
}

/**
 * A per-call intersection: operator projects cannot be widened by account or chat settings.
 * Identity lookups use the caller's token and instance, never a process-wide identity cache.
 */
export async function withOperatorProjects(
  configured: EffectivePolicy,
  read: ReadResource = (path) => gitlab.get(path),
  expired?: () => boolean,
  requestedTargets?: readonly string[],
): Promise<EffectivePolicy> {
  if (GITLAB_ALLOWED_PROJECT_IDS.length === 0) return configured;
  const reads = new Map<string, Promise<unknown>>();
  const once: ReadResource = (path) => {
    if (expired?.()) throw new Error('Tool call expired during operator project verification');
    let pending = reads.get(path);
    if (!pending) {
      pending = read(path).then((result) => {
        if (expired?.()) throw new Error('Tool call expired during operator project verification');
        return result;
      });
      reads.set(path, pending);
    }
    return pending;
  };
  const policy = await withScopePaths(configured, once);
  // A numeric operator list already supplies the complete ID set. An explicit call
  // needs metadata only for its targets; targetless feeds still need all project paths.
  const numericAllowed = GITLAB_ALLOWED_PROJECT_IDS.every((id) => /^[1-9]\d*$/.test(id))
    ? new Set(GITLAB_ALLOWED_PROJECT_IDS)
    : undefined;
  const inputs =
    numericAllowed && requestedTargets?.length ? requestedTargets : GITLAB_ALLOWED_PROJECT_IDS;
  const projects = await mapBounded([...new Set(inputs)], 5, async (input) => {
    const project = await readAllowedProject(input, once);
    if (project && numericAllowed && !numericAllowed.has(project.id)) return undefined;
    if (
      project &&
      policy.scopeEnforcer &&
      !policy.scopeEnforcer.listsId(project.id, 'project') &&
      !policy.scopeEnforcer.isAllowed(project.path)
    )
      return undefined;
    return project;
  });
  const selected: AllowedProject[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    selected.push(project);
  }
  const scope = { projects: selected.map((project) => project.path) };
  return {
    ...policy,
    scope,
    scopeEnforcer: new ScopeEnforcer({
      projects: selected.flatMap((project) => [project.id, project.path]),
    }),
    operatorProjectIds: new Set(selected.map((project) => project.id)),
  };
}
