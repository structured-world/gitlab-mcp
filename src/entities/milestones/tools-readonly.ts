import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  ListProjectMilestonesSchema,
  GetProjectMilestoneSchema,
  GetMilestoneIssuesSchema,
  GetMilestoneMergeRequestsSchema,
  GetMilestoneBurndownEventsSchema,
} from './schema-readonly';
import { ToolDefinition } from '../../types';

export const milestoneReadOnlyToolsArray: ToolDefinition[] = [
  {
    name: 'list_milestones',
    description: 'List milestones in a GitLab project or group with filtering options',
    inputSchema: zodToJsonSchema(ListProjectMilestonesSchema),
  },
  {
    name: 'get_milestone',
    description: 'Get details of a specific project or group milestone',
    inputSchema: zodToJsonSchema(GetProjectMilestoneSchema),
  },
  {
    name: 'get_milestone_issue',
    description: 'Get issues associated with a specific project or group milestone',
    inputSchema: zodToJsonSchema(GetMilestoneIssuesSchema),
  },
  {
    name: 'get_milestone_merge_requests',
    description: 'Get merge requests associated with a specific project or group milestone',
    inputSchema: zodToJsonSchema(GetMilestoneMergeRequestsSchema),
  },
  {
    name: 'get_milestone_burndown_events',
    description: 'Get burndown events for a specific project or group milestone',
    inputSchema: zodToJsonSchema(GetMilestoneBurndownEventsSchema),
  },
];

export const milestoneReadOnlyTools = [
  'list_milestones',
  'get_milestone',
  'get_milestone_issue',
  'get_milestone_merge_requests',
  'get_milestone_burndown_events',
];
