import * as z from "zod";
import { BrowsePipelinesSchema } from "./schema-readonly";
import { ManagePipelineSchema, ManagePipelineJobSchema } from "./schema";
import { gitlab, toQuery } from "../../utils/gitlab-api";
import { normalizeProjectId } from "../../utils/projectIdentifier";
import { enhancedFetch } from "../../utils/fetch";
import { logError } from "../../logger";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
import { isActionDenied } from "../../config";

/**
 * Pipelines tools registry - 3 CQRS tools replacing 12 individual tools
 *
 * browse_pipelines (Query): list, get, jobs, triggers, job, logs
 * manage_pipeline (Command): create, retry, cancel
 * manage_pipeline_job (Command): play, retry, cancel
 */
export const pipelinesToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_pipelines - CQRS Query Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "browse_pipelines",
    {
      name: "browse_pipelines",
      description:
        "Monitor CI/CD pipelines and read job logs. Actions: list (filter by status/ref/source/username), get (pipeline details), jobs (list pipeline jobs), triggers (bridge/trigger jobs), job (single job details), logs (job console output). Related: manage_pipeline to trigger/retry/cancel, manage_pipeline_job for individual jobs.",
      inputSchema: z.toJSONSchema(BrowsePipelinesSchema),
      gate: { envVar: "USE_PIPELINE", defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowsePipelinesSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_pipelines", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_pipelines tool`);
        }

        switch (input.action) {
          case "list": {
            // TypeScript knows: input has scope, status, source, ref, sha, etc. (optional)
            const { project_id, action: _action, ...queryOptions } = input;
            return gitlab.get(`projects/${normalizeProjectId(project_id)}/pipelines`, {
              query: toQuery(queryOptions, []),
            });
          }

          case "get": {
            // TypeScript knows: input has pipeline_id (required)
            const { project_id, pipeline_id } = input;
            return gitlab.get(
              `projects/${normalizeProjectId(project_id)}/pipelines/${pipeline_id}`
            );
          }

          case "jobs": {
            // TypeScript knows: input has pipeline_id (required), job_scope, include_retried, etc. (optional)
            const { project_id, pipeline_id, job_scope, include_retried, per_page, page } = input;
            // Map job_scope to scope for GitLab API
            const queryOptions: Record<string, unknown> = {};
            if (job_scope) queryOptions.scope = job_scope;
            if (include_retried !== undefined) queryOptions.include_retried = include_retried;
            if (per_page !== undefined) queryOptions.per_page = per_page;
            if (page !== undefined) queryOptions.page = page;
            return gitlab.get(
              `projects/${normalizeProjectId(project_id)}/pipelines/${pipeline_id}/jobs`,
              { query: toQuery(queryOptions, []) }
            );
          }

          case "triggers": {
            // TypeScript knows: input has pipeline_id (required), trigger_scope, include_retried, etc. (optional)
            const { project_id, pipeline_id, trigger_scope, include_retried, per_page, page } =
              input;
            // Map trigger_scope to scope for GitLab API
            const queryOptions: Record<string, unknown> = {};
            if (trigger_scope) queryOptions.scope = trigger_scope;
            if (include_retried !== undefined) queryOptions.include_retried = include_retried;
            if (per_page !== undefined) queryOptions.per_page = per_page;
            if (page !== undefined) queryOptions.page = page;
            return gitlab.get(
              `projects/${normalizeProjectId(project_id)}/pipelines/${pipeline_id}/bridges`,
              { query: toQuery(queryOptions, []) }
            );
          }

          case "job": {
            // TypeScript knows: input has job_id (required)
            const { project_id, job_id } = input;
            return gitlab.get(`projects/${normalizeProjectId(project_id)}/jobs/${job_id}`);
          }

          case "logs": {
            // TypeScript knows: input has job_id (required), per_page, start (optional)
            const { project_id, job_id, per_page, start } = input;

            // Custom handling - trace endpoint returns text, needs line processing
            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${normalizeProjectId(project_id)}/jobs/${job_id}/trace`;
            const response = await enhancedFetch(apiUrl);

            if (!response.ok) {
              throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
            }

            let trace = await response.text();
            const lines = trace.split("\n");
            const totalLines = lines.length;

            const defaultMaxLines = 200;
            let processedLines: string[] = [];

            const maxLinesToShow = per_page ?? defaultMaxLines;

            let outOfBoundsMessage = "";
            // Track the effective start position for pagination metadata
            let effectiveStart: number;

            if (start !== undefined && start < 0) {
              // Negative start: take from end of log
              effectiveStart = Math.max(0, totalLines + start);
              processedLines = lines.slice(start);
              if (processedLines.length > maxLinesToShow) {
                effectiveStart = totalLines - maxLinesToShow;
                processedLines = processedLines.slice(-maxLinesToShow);
              }
            } else if (start !== undefined && start >= 0) {
              effectiveStart = start;
              if (start >= totalLines) {
                processedLines = [];
                outOfBoundsMessage = `[OUT OF BOUNDS: Start position ${start} exceeds total lines ${totalLines}. Available range: 0-${totalLines - 1}]`;
              } else {
                processedLines = lines.slice(start, start + maxLinesToShow);
                if (start + maxLinesToShow > totalLines) {
                  const availableFromStart = totalLines - start;
                  outOfBoundsMessage = `[PARTIAL REQUEST: Requested ${maxLinesToShow} lines from position ${start}, but only ${availableFromStart} lines available]`;
                }
              }
            } else {
              // No start specified: take last N lines (default behavior)
              effectiveStart = Math.max(0, totalLines - maxLinesToShow);
              processedLines = lines.slice(-maxLinesToShow);
            }

            const actualDataLines = processedLines.length;

            if (outOfBoundsMessage) {
              processedLines.unshift(outOfBoundsMessage);
            }

            // Position-aware truncation message
            if (actualDataLines < totalLines && !outOfBoundsMessage) {
              const endLine = effectiveStart + actualDataLines - 1;
              let truncationMessage: string;
              if (start === undefined || start < 0) {
                // Default or negative start: showing tail of log
                truncationMessage = `[LOG TRUNCATED: Showing last ${actualDataLines} of ${totalLines} lines (lines ${effectiveStart}-${endLine})]`;
              } else {
                // Positive start: showing specific range from beginning/middle
                truncationMessage = `[LOG TRUNCATED: Showing lines ${effectiveStart}-${endLine} of ${totalLines}]`;
              }
              processedLines.unshift(truncationMessage);
            }

            trace = processedLines.join("\n");

            const hasMore = effectiveStart + actualDataLines < totalLines;
            const nextStart = hasMore ? effectiveStart + actualDataLines : null;

            return {
              trace,
              totalLines,
              shownLines: actualDataLines,
              startLine: effectiveStart,
              hasMore,
              nextStart,
            };
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_pipeline - CQRS Command Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "manage_pipeline",
    {
      name: "manage_pipeline",
      description:
        "Trigger, retry, or cancel CI/CD pipelines. Actions: create (run pipeline on ref with variables or typed inputs), retry (re-run failed jobs), cancel (stop running pipeline). Related: browse_pipelines for monitoring.",
      inputSchema: z.toJSONSchema(ManagePipelineSchema),
      gate: { envVar: "USE_PIPELINE", defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManagePipelineSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_pipeline", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_pipeline tool`);
        }

        switch (input.action) {
          case "create": {
            // TypeScript knows: input has ref (required), variables (optional), inputs (optional)
            const { project_id, ref, variables, inputs } = input;

            // Custom handling - ref in query, variables/inputs in body with detailed error handling
            const queryParams = new URLSearchParams();
            queryParams.set("ref", ref);

            const body: Record<string, unknown> = {};

            // Legacy variables (array of {key, value, variable_type})
            if (variables && variables.length > 0) {
              body.variables = variables;
            }

            // Modern inputs (object with input_name: value) - GitLab 15.5+
            if (inputs && Object.keys(inputs).length > 0) {
              body.inputs = inputs;
            }

            const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${normalizeProjectId(project_id)}/pipeline?${queryParams}`;

            const response = await enhancedFetch(apiUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });

            if (!response.ok) {
              let errorMessage = `GitLab API error: ${response.status} ${response.statusText}`;
              try {
                const errorBody = (await response.json()) as Record<string, unknown>;

                if (errorBody.message) {
                  if (typeof errorBody.message === "string") {
                    errorMessage += ` - ${errorBody.message}`;
                  } else if (typeof errorBody.message === "object" && errorBody.message !== null) {
                    const errorDetails: string[] = [];
                    const messageObj = errorBody.message as Record<string, unknown>;

                    Object.keys(messageObj).forEach(key => {
                      const value = messageObj[key];
                      if (Array.isArray(value)) {
                        errorDetails.push(`${key}: ${value.join(", ")}`);
                      } else {
                        errorDetails.push(`${key}: ${String(value)}`);
                      }
                    });

                    if (errorDetails.length > 0) {
                      errorMessage += ` - ${errorDetails.join("; ")}`;
                    }
                  }
                }
                if (typeof errorBody.error === "string") {
                  errorMessage += ` - ${errorBody.error}`;
                }
                if (Array.isArray(errorBody.errors)) {
                  errorMessage += ` - ${errorBody.errors.map(e => String(e)).join(", ")}`;
                }

                logError("manage_pipeline create failed", {
                  status: response.status,
                  errorBody,
                  url: apiUrl,
                });
              } catch {
                logError("manage_pipeline create failed (could not parse error)", {
                  status: response.status,
                  url: apiUrl,
                });
              }
              throw new Error(errorMessage);
            }

            const pipeline = (await response.json()) as Record<string, unknown>;
            return pipeline;
          }

          case "retry": {
            // TypeScript knows: input has pipeline_id (required)
            const { project_id, pipeline_id } = input;

            return gitlab.post(
              `projects/${normalizeProjectId(project_id)}/pipelines/${pipeline_id}/retry`
            );
          }

          case "cancel": {
            // TypeScript knows: input has pipeline_id (required)
            const { project_id, pipeline_id } = input;

            return gitlab.post(
              `projects/${normalizeProjectId(project_id)}/pipelines/${pipeline_id}/cancel`
            );
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_pipeline_job - CQRS Command Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "manage_pipeline_job",
    {
      name: "manage_pipeline_job",
      description:
        "Control individual CI/CD jobs within a pipeline. Actions: play (trigger manual/delayed job with variables), retry (re-run single job), cancel (stop running job). Related: browse_pipelines actions 'job'/'logs' for job details.",
      inputSchema: z.toJSONSchema(ManagePipelineJobSchema),
      gate: { envVar: "USE_PIPELINE", defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManagePipelineJobSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_pipeline_job", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_pipeline_job tool`);
        }

        switch (input.action) {
          case "play": {
            // TypeScript knows: input has job_id (required), job_variables_attributes (optional)
            const { project_id, job_id, job_variables_attributes } = input;
            const body: Record<string, unknown> = {};
            if (job_variables_attributes) {
              body.job_variables_attributes = job_variables_attributes;
            }
            return gitlab.post(`projects/${normalizeProjectId(project_id)}/jobs/${job_id}/play`, {
              body,
              contentType: "json",
            });
          }

          case "retry": {
            // TypeScript knows: input has job_id (required)
            const { project_id, job_id } = input;
            return gitlab.post(`projects/${normalizeProjectId(project_id)}/jobs/${job_id}/retry`);
          }

          case "cancel": {
            // TypeScript knows: input has job_id (required), force (optional)
            const { project_id, job_id, force } = input;
            const query = force ? { force: "true" } : undefined;
            return gitlab.post(`projects/${normalizeProjectId(project_id)}/jobs/${job_id}/cancel`, {
              query,
            });
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],
]);

export function getPipelinesReadOnlyToolNames(): string[] {
  return ["browse_pipelines"];
}

export function getPipelinesToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(pipelinesToolRegistry.values());
}

export function getFilteredPipelinesTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getPipelinesReadOnlyToolNames();
    return Array.from(pipelinesToolRegistry.values()).filter(tool =>
      readOnlyNames.includes(tool.name)
    );
  }
  return getPipelinesToolDefinitions();
}
