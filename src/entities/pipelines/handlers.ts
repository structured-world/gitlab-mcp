/* eslint-disable @typescript-eslint/no-unsafe-assignment */
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
  PipelineJobControlSchema,
  RetryPipelineJobSchema,
  CancelPipelineJobSchema,
} from './schema';
import { enhancedFetch } from '../../utils/fetch';

/**
 * Handler for list_pipelines tool - REAL GitLab API call
 */
export async function handleListPipelines(args: unknown): Promise<unknown> {
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
}

/**
 * Handler for get_pipeline tool - REAL GitLab API call
 */
export async function handleGetPipeline(args: unknown): Promise<unknown> {
  const options = GetPipelineSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/pipelines/${options.pipeline_id}`;
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
}

/**
 * Handler for list_pipeline_jobs tool - REAL GitLab API call
 */
export async function handleListPipelineJobs(args: unknown): Promise<unknown> {
  const options = ListPipelineJobsSchema.parse(args);

  const queryParams = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null && key !== 'project_id' && key !== 'pipeline_id') {
      queryParams.set(key, String(value));
    }
  });

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/pipelines/${options.pipeline_id}/jobs?${queryParams}`;
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
}

/**
 * Handler for list_pipeline_trigger_jobs tool - REAL GitLab API call
 */
export async function handleListPipelineTriggerJobs(args: unknown): Promise<unknown> {
  const options = ListPipelineTriggerJobsSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/pipelines/${options.pipeline_id}/bridges`;
  const response = await enhancedFetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const triggerJobs = await response.json();
  return triggerJobs;
}

/**
 * Handler for get_pipeline_job tool - REAL GitLab API call
 */
export async function handleGetPipelineJob(args: unknown): Promise<unknown> {
  const options = PipelineJobControlSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/jobs/${options.job_id}`;
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
}

/**
 * Handler for get_pipeline_job_output tool - REAL GitLab API call
 */
export async function handleGetPipelineJobOutput(args: unknown): Promise<unknown> {
  const options = GetPipelineJobOutputSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/jobs/${options.job_id}/trace`;
  const response = await enhancedFetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const output = await response.text();

  // Handle pagination if specified
  if (options.limit && output.length > options.limit) {
    return {
      output: output.substring(0, options.limit),
      truncated: true,
      total_length: output.length,
    };
  }

  return {
    output,
    truncated: false,
    total_length: output.length,
  };
}

/**
 * Handler for create_pipeline tool - REAL GitLab API call
 */
export async function handleCreatePipeline(args: unknown): Promise<unknown> {
  const options = CreatePipelineSchema.parse(args);

  const body = new URLSearchParams();
  body.set('ref', options.ref);
  if (options.variables) {
    options.variables.forEach((variable, index) => {
      body.set(`variables[${index}][key]`, variable.key);
      body.set(`variables[${index}][value]`, variable.value);
    });
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/pipeline`;
  const response = await enhancedFetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const pipeline = await response.json();
  return pipeline;
}

/**
 * Handler for retry_pipeline tool - REAL GitLab API call
 */
export async function handleRetryPipeline(args: unknown): Promise<unknown> {
  const options = RetryPipelineSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/pipelines/${options.pipeline_id}/retry`;
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
}

/**
 * Handler for cancel_pipeline tool - REAL GitLab API call
 */
export async function handleCancelPipeline(args: unknown): Promise<unknown> {
  const options = CancelPipelineSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/pipelines/${options.pipeline_id}/cancel`;
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
}

/**
 * Handler for play_pipeline_job tool - REAL GitLab API call
 */
export async function handlePlayPipelineJob(args: unknown): Promise<unknown> {
  const options = PlayPipelineJobSchema.parse(args);

  const body = new URLSearchParams();
  if (options.job_variables_attributes) {
    options.job_variables_attributes.forEach((variable, index) => {
      body.set(`job_variables_attributes[${index}][key]`, variable.key);
      body.set(`job_variables_attributes[${index}][value]`, variable.value);
    });
  }

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/jobs/${options.job_id}/play`;
  const response = await enhancedFetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITLAB_TOKEN}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const job = await response.json();
  return job;
}

/**
 * Handler for retry_pipeline_job tool - REAL GitLab API call
 */
export async function handleRetryPipelineJob(args: unknown): Promise<unknown> {
  const options = RetryPipelineJobSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/jobs/${options.job_id}/retry`;
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
}

/**
 * Handler for cancel_pipeline_job tool - REAL GitLab API call
 */
export async function handleCancelPipelineJob(args: unknown): Promise<unknown> {
  const options = CancelPipelineJobSchema.parse(args);

  const apiUrl = `${process.env.GITLAB_API_URL}/api/v4/projects/${encodeURIComponent(options.project_id)}/jobs/${options.job_id}/cancel`;
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
}
