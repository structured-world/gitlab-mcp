/**
 * Pure adapters between MCP tool results and the watch core (issue #483):
 * unwrap an MCP `CallToolResult` ({content:[{text}]}) into its JSON payload,
 * parse a `browse_pipelines`/`jobs` result into `JobState[]`, and render a
 * `WatchEvent` into a channel message (content + meta). No I/O.
 */
import * as z from 'zod';
import type { JobState, WatchEvent } from './watch';

const JobSchema = z.object({
  id: z.number(),
  name: z.string(),
  stage: z.string(),
  status: z.string(),
});

const DeploymentSchema = z.object({
  id: z.number(),
  status: z.string(),
  environment: z.object({ name: z.string() }).optional(),
});

/** MCP tool results wrap JSON in a text content block; unwrap it, else pass through. */
export function parseToolResult(result: unknown): unknown {
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
    const text = Array.isArray(content) ? content.find((c) => c.type === 'text')?.text : undefined;
    if (typeof text === 'string') {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }
  }
  return result;
}

/** Parse a jobs result into JobState[], silently dropping malformed entries. */
export function parseJobs(result: unknown): JobState[] {
  const data = parseToolResult(result);
  if (!Array.isArray(data)) return [];
  const out: JobState[] = [];
  for (const item of data) {
    const parsed = JobSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Parse a deployments list into pseudo-jobs the watch core can treat uniformly:
 * one JobState per deployment, named by its environment. Lets a deployment be
 * watched with the same aggregate/diff/terminal machinery as a pipeline.
 */
export function parseDeployments(result: unknown): JobState[] {
  const data = parseToolResult(result);
  if (!Array.isArray(data)) return [];
  const out: JobState[] = [];
  for (const item of data) {
    const parsed = DeploymentSchema.safeParse(item);
    if (parsed.success) {
      out.push({
        id: parsed.data.id,
        name: parsed.data.environment?.name ?? `deployment-${parsed.data.id}`,
        stage: 'deploy',
        status: parsed.data.status,
      });
    }
  }
  return out;
}

/**
 * Render a watch event into a channel message. `content` is the human-readable
 * body the agent sees; `meta` keys are identifiers ([a-z0-9_]) per the channel
 * protocol (hyphens in keys would be dropped, so only stable keys are used).
 */
export function formatEvent(event: WatchEvent): { content: string; meta: Record<string, string> } {
  const { target, pipelineState, jobs, transitions, terminal } = event;
  const jobsLine = jobs.map((j) => `${j.name}:${j.status}`).join(' ');
  // A deployment is watched through the same job machinery, but the channel
  // message and meta key must name it for what it is, not as a pipeline.
  const label = target.kind === 'deployment' ? 'Deployment' : 'Pipeline';
  const idKey = target.kind === 'deployment' ? 'deployment_id' : 'pipeline_id';
  const content = terminal
    ? `${label} #${target.id} (project ${target.projectId}) finished: ${pipelineState}. Jobs: ${jobsLine}`
    : `${label} #${target.id} (project ${target.projectId}) ${transitions
        .map((t) => `${t.name} ${t.from ?? 'new'}->${t.to}`)
        .join(', ')}. Now: ${jobsLine}`;
  const meta: Record<string, string> = {
    [idKey]: String(target.id),
    project_id: target.projectId,
    kind: target.kind,
    state: pipelineState,
    terminal: String(terminal),
  };
  return { content, meta };
}
