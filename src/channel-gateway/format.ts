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

/** MCP tool results wrap JSON in a text content block; unwrap it, else pass through. */
export function parseToolResult(result: unknown): unknown {
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
    const text = content?.find((c) => c.type === 'text')?.text;
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
 * Render a watch event into a channel message. `content` is the human-readable
 * body the agent sees; `meta` keys are identifiers ([a-z0-9_]) per the channel
 * protocol (hyphens in keys would be dropped, so only stable keys are used).
 */
export function formatEvent(event: WatchEvent): { content: string; meta: Record<string, string> } {
  const { target, pipelineState, jobs, transitions, terminal } = event;
  const jobsLine = jobs.map((j) => `${j.name}:${j.status}`).join(' ');
  const content = terminal
    ? `Pipeline #${target.id} (project ${target.projectId}) finished: ${pipelineState}. Jobs: ${jobsLine}`
    : `Pipeline #${target.id} (project ${target.projectId}) ${transitions
        .map((t) => `${t.name} ${t.from ?? 'new'}->${t.to}`)
        .join(', ')}. Now: ${jobsLine}`;
  const meta: Record<string, string> = {
    pipeline_id: String(target.id),
    project_id: target.projectId,
    state: pipelineState,
    terminal: String(terminal),
  };
  return { content, meta };
}
