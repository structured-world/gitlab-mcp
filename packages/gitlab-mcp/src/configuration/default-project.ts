import { gitlab } from '../utils/gitlab-api';
import { normalizeProjectId } from '../utils/projectIdentifier';
import { hasExplicitScopeTarget } from '../profiles/scope-enforcer';
import { readAllowedProject } from './operator-projects';
import type { ReadResource } from './scope-ids';

type Args = Record<string, unknown>;
interface DefaultedProject {
  args: Args;
  read: ReadResource;
}

function projectField(declared: ReadonlySet<string>): string | undefined {
  if (declared.has('project_id')) return 'project_id';
  if (declared.has('projectId')) return 'projectId';
  return undefined;
}

function numericDefault(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new TypeError('Default project ID must be a positive safe integer');
  return id;
}

/** Fill only an omitted project, preserving the tool's declared numeric or path contract. */
export async function withDefaultProject(
  tool: string,
  args: Args,
  declared: ReadonlySet<string> | undefined,
  defaultProject: string | undefined,
  expired: () => boolean,
  read: ReadResource = (path) => gitlab.get(path),
): Promise<DefaultedProject> {
  if (
    !defaultProject ||
    args.scope === 'group' ||
    !declared ||
    hasExplicitScopeTarget(args, declared)
  )
    return { args, read };
  const field = projectField(declared);
  if (!field) return { args, read };
  if (tool !== 'browse_todos') return { args: { ...args, [field]: defaultProject }, read };
  if (/^\d+$/.test(defaultProject))
    return { args: { ...args, [field]: numericDefault(defaultProject) }, read };
  if (expired()) throw new Error('Tool call expired during default project verification');
  const project = await readAllowedProject(defaultProject, read);
  if (expired()) throw new Error('Tool call expired during default project verification');
  if (!project) throw new Error('Default project not found or not accessible');
  const id = numericDefault(project.id);
  const identity = { id, path_with_namespace: project.path, name_with_namespace: project.name };
  const requested = `projects/${normalizeProjectId(defaultProject)}`;
  const canonical = `projects/${normalizeProjectId(project.path)}`;
  const numeric = `projects/${id}`;
  // Reuse this call's verified identity when its allowlist or working scope names an alias.
  const withIdentity: ReadResource = (path) =>
    path === requested || path === canonical || path === numeric
      ? Promise.resolve(identity)
      : read(path);
  return { args: { ...args, [field]: id }, read: withIdentity };
}
