import { gql } from 'graphql-tag';
import { gitlab } from '../../utils/gitlab-api';
import { normalizeProjectId } from '../../utils/projectIdentifier';
import { encodeApiSegment } from '../../utils/api-path';
import { extractSimpleId } from '../../utils/idConversion';
import { DUO_RESPONSE_BYTES, requestDuo } from './queries';
import type { DuoProject } from './access';

interface Target {
  ref?: string;
  source_branch?: string;
  source?: string;
  sha?: string;
}
interface MergeRequest {
  id: number;
  iid: number;
  project_id: number;
  source_project_id: number;
  source_branch: string;
  state: string;
  web_url: string;
  author: { id: number };
}
interface AttachedMergeRequest {
  sourceBranch: string;
  state: string;
  webUrl: string;
  author: { id: string };
}
const PIPELINE = gql`
  query DuoPipelineContext($path: ID!, $id: CiPipelineID!) {
    project(fullPath: $path) {
      id
      pipeline(id: $id) {
        id
        mergeRequest {
          sourceBranch
          state
          webUrl
          author {
            id
          }
        }
      }
    }
  }
`;

/** Share a ten-request ceiling across candidate and commit pagination before any write. */
function contextReader() {
  let requests = 0;
  return async function read<T>(
    path: string,
    query: Record<string, string | number>,
  ): Promise<T[]> {
    const items: T[] = [];
    async function page(number: number): Promise<void> {
      if (requests === 10)
        throw new Error('Pipeline context lookup limit reached; no session was started');
      requests++;
      const rows = await gitlab.get<T[]>(path, {
        query: { ...query, per_page: 100, page: number },
        rawResponse: true,
        responseByteLimit: DUO_RESPONSE_BYTES,
      });
      if (!Array.isArray(rows) || rows.length > 100)
        throw new Error('Invalid pipeline context page');
      items.push(...rows);
      if (rows.length === 100) await page(number + 1);
    }
    await page(1);
    return items;
  };
}

async function associatedMergeRequest(
  project: DuoProject,
  branch: string,
  sha: string,
): Promise<MergeRequest | null> {
  const read = contextReader();
  const rows = await read<MergeRequest>('merge_requests', {
    scope: 'all',
    state: 'opened',
    source_project_id: project.id,
    source_branch: branch,
  });
  const candidates = rows.filter(
    (mr) =>
      String(mr.source_project_id) === project.id &&
      mr.source_branch === branch &&
      mr.state === 'opened',
  );
  if (candidates.some((mr) => !Number.isSafeInteger(mr.id)))
    throw new Error('Invalid associated merge request identity');
  candidates.sort((left, right) => right.id - left.id);
  // GitLab selects the newest open MR containing this commit, including fork targets.
  async function matching(index: number): Promise<MergeRequest | null> {
    if (index === candidates.length) return null;
    const mr = candidates[index];
    const commits = await read<{ id: string }>(
      `projects/${normalizeProjectId(String(mr.project_id))}/merge_requests/${encodeApiSegment(mr.iid)}/commits`,
      {},
    );
    if (commits.some((commit) => commit.id === sha)) return mr;
    return matching(index + 1);
  }
  return matching(0);
}

function branchValue(value: string | undefined): string {
  if (!value)
    throw new Error('GitLab did not expose the target source branch; no session was started');
  return value;
}

async function attachedMergeRequest(
  project: DuoProject,
  id: string,
): Promise<AttachedMergeRequest> {
  const result = await requestDuo<{
    project: {
      id: string;
      pipeline: { id: string; mergeRequest: AttachedMergeRequest | null } | null;
    } | null;
  }>(PIPELINE, {
    path: project.path,
    id: `gid://gitlab/Ci::Pipeline/${id}`,
  });
  const pipeline = result.project?.pipeline;
  const mr = pipeline?.mergeRequest;
  if (
    !result.project ||
    extractSimpleId(result.project.id) !== project.id ||
    !pipeline ||
    extractSimpleId(pipeline.id) !== id ||
    !mr
  )
    throw new Error(
      'GitLab did not expose the pipeline source merge request; no session was started',
    );
  return mr;
}

export async function legacyGoalContext(
  project: DuoProject,
  flow: string,
  target: Target,
  goal: string,
  id: string,
): Promise<Record<string, unknown>> {
  if (flow === 'code_review/v1') return { goal, source_branch: branchValue(target.source_branch) };
  let branch: string;
  let mergeRequest: { url: string; author_id: string } | null = null;
  if (target.source === 'merge_request_event') {
    const mr = await attachedMergeRequest(project, id);
    branch = branchValue(mr.sourceBranch);
    if (mr.state === 'opened')
      mergeRequest = { url: mr.webUrl, author_id: extractSimpleId(mr.author.id) };
  } else {
    branch = branchValue(target.ref);
    if (!target.sha)
      throw new Error('GitLab did not expose the pipeline commit; no session was started');
    const mr = await associatedMergeRequest(project, branch, target.sha);
    if (mr) mergeRequest = { url: mr.web_url, author_id: String(mr.author.id) };
  }
  if (!target.source)
    throw new Error('GitLab did not expose the pipeline source; no session was started');
  // Match GitLab's PipelineContextBuilder, including its explicit no-MR marker.
  // https://gitlab.com/gitlab-org/gitlab/-/blob/v19.5.0-ee/ee/app/services/ai/duo_workflows/additional_context/pipeline_context_builder.rb
  return {
    goal,
    source_branch: branch,
    additional_context: [
      {
        Category: 'merge_request',
        Content: JSON.stringify(mergeRequest ?? { url: '' }),
        metadata: { version: '1.0.0' },
      },
      {
        Category: 'pipeline',
        Content: JSON.stringify({ source_branch: branch, source: target.source }),
        metadata: { version: '1.0.0' },
      },
    ],
  };
}
