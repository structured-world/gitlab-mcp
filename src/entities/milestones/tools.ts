import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CreateProjectMilestoneSchema,
  EditProjectMilestoneSchema,
  DeleteProjectMilestoneSchema,
  PromoteProjectMilestoneSchema,
} from './schema';
import { ToolDefinition } from '../../types';

export const milestoneWriteTools: ToolDefinition[] = [
  {
    name: 'create_milestone',
    description: 'Create a new milestone in a GitLab project or group',
    inputSchema: zodToJsonSchema(CreateProjectMilestoneSchema),
  },
  {
    name: 'edit_milestone',
    description: 'Edit an existing milestone in a GitLab project or group',
    inputSchema: zodToJsonSchema(EditProjectMilestoneSchema),
  },
  {
    name: 'delete_milestone',
    description: 'Delete a milestone from a GitLab project or group',
    inputSchema: zodToJsonSchema(DeleteProjectMilestoneSchema),
  },
  {
    name: 'promote_milestone',
    description: 'Promote a project milestone to a group milestone',
    inputSchema: zodToJsonSchema(PromoteProjectMilestoneSchema),
  },
];
