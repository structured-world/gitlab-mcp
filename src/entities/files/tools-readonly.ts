import { zodToJsonSchema } from 'zod-to-json-schema';
import { GetRepositoryTreeSchema, GetFileContentsSchema } from './schema-readonly';
import { ToolDefinition } from '../../types';

export const filesReadOnlyToolsArray: ToolDefinition[] = [
  {
    name: 'get_repository_tree',
    description: 'Get the repository tree for a GitLab project (list files and directories)',
    inputSchema: zodToJsonSchema(GetRepositoryTreeSchema),
  },
  {
    name: 'get_file_contents',
    description: 'Get the contents of a file or directory from a GitLab project',
    inputSchema: zodToJsonSchema(GetFileContentsSchema),
  },
];

// Define which file tools are read-only (list of tool names)
export const filesReadOnlyTools = ['get_repository_tree', 'get_file_contents'];
