import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CreatePipelineSchema,
  RetryPipelineSchema,
  CancelPipelineSchema,
  PlayPipelineJobSchema,
  RetryPipelineJobSchema,
  CancelPipelineJobSchema,
} from './schema';
import { ToolDefinition } from '../../types';

export const pipelineWriteTools: ToolDefinition[] = [
  {
    name: 'create_pipeline',
    description: 'Create a new pipeline for a branch or tag',
    inputSchema: zodToJsonSchema(CreatePipelineSchema),
  },
  {
    name: 'retry_pipeline',
    description: 'Retry a failed or canceled pipeline',
    inputSchema: zodToJsonSchema(RetryPipelineSchema),
  },
  {
    name: 'cancel_pipeline',
    description: 'Cancel a running pipeline',
    inputSchema: zodToJsonSchema(CancelPipelineSchema),
  },
  {
    name: 'play_pipeline_job',
    description: 'Run a manual pipeline job',
    inputSchema: zodToJsonSchema(PlayPipelineJobSchema),
  },
  {
    name: 'retry_pipeline_job',
    description: 'Retry a failed or canceled pipeline job',
    inputSchema: zodToJsonSchema(RetryPipelineJobSchema),
  },
  {
    name: 'cancel_pipeline_job',
    description: 'Cancel a running pipeline job',
    inputSchema: zodToJsonSchema(CancelPipelineJobSchema),
  },
];
