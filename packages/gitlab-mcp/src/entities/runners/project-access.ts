import { GITLAB_ALLOWED_PROJECT_IDS } from '../../config';
import type { GraphQLClient } from '../../graphql/client';
import {
  RUNNER_PROJECT_ACCESS,
  RUNNERS_PER_ACCESS_QUERY,
  runnerAccessBatch,
  type RunnerProject,
  type RunnerProvenance,
} from '../../graphql/runners';
import { extractSimpleId } from '../../utils/idConversion';
import { mapBounded } from '../../utils/bounded-map';
import { canonicalProjectPath } from '../../utils/api-path';

export function runnerProjectsRestricted(): boolean {
  return GITLAB_ALLOWED_PROJECT_IDS.length > 0;
}

export function runnerProjectAllowed(project: RunnerProject): boolean {
  const id = extractSimpleId(project.id);
  const path = canonicalProjectPath(project.fullPath).toLowerCase();
  return GITLAB_ALLOWED_PROJECT_IDS.some((value) => {
    const configured = canonicalProjectPath(value);
    return configured === id || configured.toLowerCase() === path;
  });
}

export function assertRunnerProjectAllowed(fullPath: string, id: string): void {
  if (runnerProjectsRestricted() && !runnerProjectAllowed({ id, fullPath })) {
    throw new Error(`Project ${fullPath} is not allowed by GITLAB_ALLOWED_PROJECT_IDS`);
  }
}

/** Whether a runner's projects confine it to the allowlist. */
function provenanceAllowed(runner: RunnerProvenance | null | undefined): boolean {
  const projects = runner?.projects;
  // Never infer ownership from a truncated or permission-filtered project list.
  // Shared group/instance runners cannot be confined to a project allowlist.
  return (
    runner?.runnerType === 'PROJECT_TYPE' &&
    typeof runner.projectCount === 'number' &&
    runner.projectCount > 0 &&
    projects?.pageInfo?.hasNextPage === false &&
    Array.isArray(projects.nodes) &&
    projects.nodes.length === runner.projectCount &&
    projects.nodes.every(runnerProjectAllowed)
  );
}

const runnerGid = (id: string | number): string =>
  `gid://gitlab/Ci::Runner/${extractSimpleId(String(id))}`;

export async function assertRunnerAllowed(client: GraphQLClient, id: number): Promise<void> {
  if (!runnerProjectsRestricted()) return;
  const result = await client.request(RUNNER_PROJECT_ACCESS, { id: runnerGid(id) });
  if (!provenanceAllowed(result.runner)) {
    throw new Error(`Runner ${id} is not allowed by GITLAB_ALLOWED_PROJECT_IDS`);
  }
}

/**
 * A runner listing that read each runner's projects (its `restricted` variable), kept to the
 * runners the allowlist confines, without those fields. Its cursor stays the one GitLab gave,
 * so filtering does not make later pages unreachable.
 */
export function keepAllowedRunners<T extends RunnerProvenance, C extends { nodes: T[] }>(
  connection: C | null,
): C | null {
  if (!runnerProjectsRestricted() || !connection) return connection;
  const nodes = connection.nodes
    .filter(provenanceAllowed)
    .map(({ projectCount: _count, projects: _projects, ...node }) => node);
  return { ...connection, nodes };
}

/**
 * A runner page that carries no projects (the REST listing), kept to the runners the
 * allowlist confines: their projects are read RUNNERS_PER_ACCESS_QUERY runners per query.
 */
export async function filterAllowedRunners<
  T extends { id: string | number },
  C extends { nodes: T[] },
>(client: GraphQLClient, connection: C | null): Promise<C | null> {
  if (!runnerProjectsRestricted() || !connection) return connection;
  const batches: T[][] = [];
  for (let start = 0; start < connection.nodes.length; start += RUNNERS_PER_ACCESS_QUERY)
    batches.push(connection.nodes.slice(start, start + RUNNERS_PER_ACCESS_QUERY));
  // A page of at most 100 runners is at most ten batches, a few in flight at a time.
  const checked = await mapBounded(batches, 5, async (batch) => {
    const result = await client.request(
      runnerAccessBatch(batch.length),
      Object.fromEntries(batch.map((node, index) => [`id${index}`, runnerGid(node.id)])),
    );
    return batch.filter((_node, index) => provenanceAllowed(result[`r${index}`]));
  });
  return { ...connection, nodes: checked.flat() };
}
