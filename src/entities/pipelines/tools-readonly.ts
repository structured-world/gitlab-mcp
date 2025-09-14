import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ListPipelinesSchema,
  GetPipelineSchema,
  ListPipelineJobsSchema,
  ListPipelineTriggerJobsSchema,
  GetPipelineJobOutputSchema,
} from "./schema-readonly";
import { ToolDefinition } from "../../types";

export const pipelineReadOnlyToolsArray: ToolDefinition[] = [
  {
    name: "list_pipelines",
    description: "List pipelines in a GitLab project with filtering options",
    inputSchema: zodToJsonSchema(ListPipelinesSchema),
  },
  {
    name: "get_pipeline",
    description: "Get details of a specific pipeline in a GitLab project",
    inputSchema: zodToJsonSchema(GetPipelineSchema),
  },
  {
    name: "list_pipeline_jobs",
    description: "List all jobs in a specific pipeline",
    inputSchema: zodToJsonSchema(ListPipelineJobsSchema),
  },
  {
    name: "list_pipeline_trigger_jobs",
    description:
      "List all trigger jobs (bridges) in a specific pipeline that trigger downstream pipelines",
    inputSchema: zodToJsonSchema(ListPipelineTriggerJobsSchema),
  },
  {
    name: "get_pipeline_job",
    description: "Get details of a GitLab pipeline job number",
    inputSchema: zodToJsonSchema(GetPipelineJobOutputSchema),
  },
  {
    name: "get_pipeline_job_output",
    description:
      "Get the output/trace of a GitLab pipeline job with optional pagination to limit context window usage",
    inputSchema: zodToJsonSchema(GetPipelineJobOutputSchema),
  },
];

export const pipelineReadOnlyTools = [
  "get_pipeline",
  "list_pipelines",
  "list_pipeline_jobs",
  "list_pipeline_trigger_jobs",
  "get_pipeline_job",
  "get_pipeline_job_output",
];
