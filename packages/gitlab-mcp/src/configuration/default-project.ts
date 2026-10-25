import { gitlab } from '../utils/gitlab-api';
import { normalizeProjectId } from '../utils/projectIdentifier';
import { hasExplicitScopeTarget } from '../profiles/scope-enforcer';
import { readAllowedProject } from './operator-projects';
import type { ReadResource } from './scope-ids';
import { canonicalProjectPath } from '../utils/api-path';

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

function projectFormat(tool: string, args: Args): 'identifier' | 'number' | 'path' {
  if (tool === 'browse_todos') return 'number';
  // These handlers pass their project target to GraphQL project(fullPath:).
  if (tool === 'browse_vulnerabilities' || tool === 'browse_registry' || tool === 'browse_runners')
    return 'path';
  if (tool === 'manage_runner' && args.runner_type === 'PROJECT_TYPE') return 'path';
  return 'identifier';
}

function omissionSelectsResourceScope(tool: string, args: Args): boolean {
  // For these actions an omitted owner selects the resource scope, not a default project.
  switch (tool) {
    case 'browse_audit_events':
    case 'browse_access_tokens':
      return args.action === 'get';
    case 'manage_access_token':
      return args.action === 'rotate' || args.action === 'revoke';
    case 'browse_snippets':
      return args.action === 'get' || args.scope !== 'project';
    case 'manage_snippet':
      return true;
    default:
      return false;
  }
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
    omissionSelectsResourceScope(tool, args) ||
    hasExplicitScopeTarget(args, declared)
  )
    return { args, read };
  const field = projectField(declared);
  if (!field) return { args, read };
  const format = projectFormat(tool, args);
  if (format === 'identifier') return { args: { ...args, [field]: defaultProject }, read };
  const numeric = /^\d+$/.test(defaultProject);
  if (format === 'number' && numeric)
    return { args: { ...args, [field]: numericDefault(defaultProject) }, read };
  if (format === 'path' && !numeric)
    return { args: { ...args, [field]: canonicalProjectPath(defaultProject) }, read };
  if (expired()) throw new Error('Tool call expired during default project verification');
  const project = await readAllowedProject(defaultProject, read);
  if (expired()) throw new Error('Tool call expired during default project verification');
  if (!project) throw new Error('Default project not found or not accessible');
  const id = numericDefault(project.id);
  const identity = { id, path_with_namespace: project.path, name_with_namespace: project.name };
  const requested = `projects/${normalizeProjectId(defaultProject)}`;
  const canonical = `projects/${normalizeProjectId(project.path)}`;
  const numericPath = `projects/${id}`;
  // Reuse this call's verified identity when its allowlist or working scope names an alias.
  const withIdentity: ReadResource = (path) =>
    path === requested || path === canonical || path === numericPath
      ? Promise.resolve(identity)
      : read(path);
  return { args: { ...args, [field]: format === 'path' ? project.path : id }, read: withIdentity };
}
