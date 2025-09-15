/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ListPipelinesSchema,
  GetPipelineSchema,
  ListPipelineJobsSchema,
  ListPipelineTriggerJobsSchema,
  GetPipelineJobOutputSchema,
} from './schema-readonly';
import {
  CreatePipelineSchema,
  RetryPipelineSchema,
  CancelPipelineSchema,
  PlayPipelineJobSchema,
  RetryPipelineJobSchema,
  CancelPipelineJobSchema,
} from './schema';
import { enhancedFetch } from '../../utils/fetch';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';

/**
 * Pipelines tools registry - unified registry containing all pipeline operation tools with their handlers
 */
export const pipelinesToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'list_pipelines',
    {
      name: 'list_pipelines',
      description: 'List pipelines in a GitLab project with filtering options',
      inputSchema: zodToJsonSchema(ListPipelinesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListPipelinesSchema.parse(args);

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null && key !== 'project_id') {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/pipelines?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const pipelines = await response.json();
        return pipelines;
      },
    },
  ],
  [
    'get_pipeline',
    {
      name: 'get_pipeline',
      description: 'Get details of a specific pipeline in a GitLab project',
      inputSchema: zodToJsonSchema(GetPipelineSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetPipelineSchema.parse(args);
        const { project_id, pipeline_id } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/pipelines/${pipeline_id}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const pipeline = await response.json();
        return pipeline;
      },
    },
  ],
  [
    'list_pipeline_jobs',
    {
      name: 'list_pipeline_jobs',
      description: 'List all jobs in a specific pipeline',
      inputSchema: zodToJsonSchema(ListPipelineJobsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListPipelineJobsSchema.parse(args);
        const { project_id, pipeline_id } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (
            value !== undefined &&
            value !== null &&
            key !== 'project_id' &&
            key !== 'pipeline_id'
          ) {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/pipelines/${pipeline_id}/jobs?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const jobs = await response.json();
        return jobs;
      },
    },
  ],
  [
    'list_pipeline_trigger_jobs',
    {
      name: 'list_pipeline_trigger_jobs',
      description:
        'List all trigger jobs (bridges) in a specific pipeline that trigger downstream pipelines',
      inputSchema: zodToJsonSchema(ListPipelineTriggerJobsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListPipelineTriggerJobsSchema.parse(args);
        const { project_id, pipeline_id } = options;

        const queryParams = new URLSearchParams();
        Object.entries(options).forEach(([key, value]) => {
          if (
            value !== undefined &&
            value !== null &&
            key !== 'project_id' &&
            key !== 'pipeline_id'
          ) {
            queryParams.set(key, String(value));
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/pipelines/${pipeline_id}/bridges?${queryParams}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const bridges = await response.json();
        return bridges;
      },
    },
  ],
  [
    'get_pipeline_job',
    {
      name: 'get_pipeline_job',
      description: 'Get details of a GitLab pipeline job number',
      inputSchema: zodToJsonSchema(GetPipelineJobOutputSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetPipelineJobOutputSchema.parse(args);
        const { project_id, job_id } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/jobs/${job_id}`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const job = await response.json();
        return job;
      },
    },
  ],
  [
    'get_pipeline_job_output',
    {
      name: 'get_pipeline_job_output',
      description:
        'Get the output/trace of a GitLab pipeline job with optional pagination to limit context window usage',
      inputSchema: zodToJsonSchema(GetPipelineJobOutputSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetPipelineJobOutputSchema.parse(args);
        const { project_id, job_id, limit } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/jobs/${job_id}/trace`;
        const response = await enhancedFetch(apiUrl, {
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        let trace = await response.text();

        // Apply output limiting if requested
        if (limit && trace.length > limit) {
          const lines = trace.split('\n');
          const totalLines = lines.length;
          const maxLines = Math.floor(limit / 50); // Roughly 50 chars per line

          if (totalLines > maxLines) {
            const keepLines = Math.floor(maxLines / 2);
            const startLines = lines.slice(0, keepLines);
            const endLines = lines.slice(-keepLines);
            trace = [
              ...startLines,
              `... [${totalLines - maxLines} lines truncated] ...`,
              ...endLines,
            ].join('\n');
          }
        }

        return { trace };
      },
    },
  ],
  // Write tools
  [
    'create_pipeline',
    {
      name: 'create_pipeline',
      description: 'Create a new pipeline for a branch or tag',
      inputSchema: zodToJsonSchema(CreatePipelineSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreatePipelineSchema.parse(args);
        const { project_id } = options;

        const body: Record<string, unknown> = {};
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null && key !== 'project_id') {
            body[key] = value;
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/pipeline`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const pipeline = await response.json();
        return pipeline;
      },
    },
  ],
  [
    'retry_pipeline',
    {
      name: 'retry_pipeline',
      description: 'Retry a failed or canceled pipeline',
      inputSchema: zodToJsonSchema(RetryPipelineSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = RetryPipelineSchema.parse(args);
        const { project_id, pipeline_id } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/pipelines/${pipeline_id}/retry`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const pipeline = await response.json();
        return pipeline;
      },
    },
  ],
  [
    'cancel_pipeline',
    {
      name: 'cancel_pipeline',
      description: 'Cancel a running pipeline',
      inputSchema: zodToJsonSchema(CancelPipelineSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CancelPipelineSchema.parse(args);
        const { project_id, pipeline_id } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/pipelines/${pipeline_id}/cancel`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const pipeline = await response.json();
        return pipeline;
      },
    },
  ],
  [
    'play_pipeline_job',
    {
      name: 'play_pipeline_job',
      description: 'Run a manual pipeline job',
      inputSchema: zodToJsonSchema(PlayPipelineJobSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = PlayPipelineJobSchema.parse(args);
        const { project_id, job_id } = options;

        const body: Record<string, unknown> = {};
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null && key !== 'project_id' && key !== 'job_id') {
            body[key] = value;
          }
        });

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/jobs/${job_id}/play`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const job = await response.json();
        return job;
      },
    },
  ],
  [
    'retry_pipeline_job',
    {
      name: 'retry_pipeline_job',
      description: 'Retry a failed or canceled pipeline job',
      inputSchema: zodToJsonSchema(RetryPipelineJobSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = RetryPipelineJobSchema.parse(args);
        const { project_id, job_id } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/jobs/${job_id}/retry`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const job = await response.json();
        return job;
      },
    },
  ],
  [
    'cancel_pipeline_job',
    {
      name: 'cancel_pipeline_job',
      description: 'Cancel a running pipeline job',
      inputSchema: zodToJsonSchema(CancelPipelineJobSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CancelPipelineJobSchema.parse(args);
        const { project_id, job_id } = options;

        const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(project_id)}/jobs/${job_id}/cancel`;
        const response = await enhancedFetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
          },
        });

        if (!response.ok) {
          throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
        }

        const job = await response.json();
        return job;
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getPipelinesReadOnlyToolNames(): string[] {
  return [
    'list_pipelines',
    'get_pipeline',
    'list_pipeline_jobs',
    'list_pipeline_trigger_jobs',
    'get_pipeline_job',
    'get_pipeline_job_output',
  ];
}

/**
 * Get all tool definitions from the registry (for backward compatibility)
 */
export function getPipelinesToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(pipelinesToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredPipelinesTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getPipelinesReadOnlyToolNames();
    return Array.from(pipelinesToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getPipelinesToolDefinitions();
}
