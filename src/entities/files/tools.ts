import { zodToJsonSchema } from 'zod-to-json-schema';
import { CreateOrUpdateFileSchema, PushFilesSchema, MarkdownUploadSchema } from './schema';
import { ToolDefinition } from '../../types';

export const filesWriteTools: ToolDefinition[] = [
  {
    name: 'create_or_update_file',
    description: 'Create or update a single file in a GitLab project',
    inputSchema: zodToJsonSchema(CreateOrUpdateFileSchema),
  },
  {
    name: 'push_files',
    description: 'Push multiple files to a GitLab project in a single commit',
    inputSchema: zodToJsonSchema(PushFilesSchema),
  },
  {
    name: 'upload_markdown',
    description: 'Upload a file to a GitLab project for use in markdown content',
    inputSchema: zodToJsonSchema(MarkdownUploadSchema),
  },
];
