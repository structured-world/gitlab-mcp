import { zodToJsonSchema } from 'zod-to-json-schema';
import { CreateRepositorySchema, ForkRepositorySchema, CreateBranchSchema } from './schema';
import { ToolDefinition } from '../../types';

export const coreWriteTools: ToolDefinition[] = [
  {
    name: 'create_repository',
    description: 'Create a new GitLab project',
    inputSchema: zodToJsonSchema(CreateRepositorySchema),
  },
  {
    name: 'fork_repository',
    description: 'Fork a GitLab project to your account or specified namespace',
    inputSchema: zodToJsonSchema(ForkRepositorySchema),
  },
  {
    name: 'create_branch',
    description: 'Create a new branch in a GitLab project',
    inputSchema: zodToJsonSchema(CreateBranchSchema),
  },
];
