/**
 * Tool groups an account can switch off. A group's id is the preset `features` key of the
 * same tools, so a preset and the account settings name groups the same way. Core and
 * context tools belong to no group: they are always available.
 */

export interface ToolGroup {
  id: string;
  title: string;
  /** Registry keys of the group's tools (see RegistryManager). */
  registries: readonly string[];
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  { id: 'mrs', title: 'Merge requests', registries: ['mrs'] },
  { id: 'workitems', title: 'Issues and work items', registries: ['workitems'] },
  { id: 'pipelines', title: 'Pipelines and jobs', registries: ['pipelines'] },
  { id: 'files', title: 'Repository files', registries: ['files'] },
  { id: 'refs', title: 'Branches and tags', registries: ['refs'] },
  { id: 'releases', title: 'Releases', registries: ['releases'] },
  { id: 'labels', title: 'Labels', registries: ['labels'] },
  { id: 'milestones', title: 'Milestones', registries: ['milestones'] },
  { id: 'iterations', title: 'Iterations', registries: ['iterations'] },
  { id: 'wiki', title: 'Wiki', registries: ['wiki'] },
  { id: 'snippets', title: 'Snippets', registries: ['snippets'] },
  { id: 'search', title: 'Search', registries: ['search'] },
  { id: 'members', title: 'Members', registries: ['members'] },
  { id: 'variables', title: 'CI/CD variables', registries: ['variables'] },
  { id: 'environments', title: 'Environments', registries: ['environments'] },
  { id: 'runners', title: 'Runners', registries: ['runners'] },
  { id: 'registry', title: 'Container registry', registries: ['registry'] },
  {
    id: 'ci_tokens',
    title: 'CI job tokens and deploy keys',
    registries: ['job-token-scope', 'deploy-keys'],
  },
  { id: 'access_tokens', title: 'Access tokens', registries: ['access_tokens'] },
  { id: 'webhooks', title: 'Webhooks', registries: ['webhooks'] },
  { id: 'integrations', title: 'Integrations', registries: ['integrations'] },
  { id: 'audit_events', title: 'Audit events', registries: ['audit_events'] },
  { id: 'vulnerabilities', title: 'Vulnerabilities', registries: ['vulnerabilities'] },
];

const GROUP_OF_REGISTRY = new Map(
  TOOL_GROUPS.flatMap((group) => group.registries.map((key) => [key, group.id] as const)),
);

export const TOOL_GROUP_IDS: ReadonlySet<string> = new Set(TOOL_GROUPS.map((g) => g.id));

/** Group of the tools of a registry; undefined for core and context tools. */
export function groupOfRegistry(registryKey: string | undefined): string | undefined {
  return registryKey === undefined ? undefined : GROUP_OF_REGISTRY.get(registryKey);
}
