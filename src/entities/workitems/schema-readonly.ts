import { z } from 'zod';

// Base schemas for work items
export const WorkItemIdSchema = z.string().min(1).describe('Work item ID');

export const WorkItemTypeEnumSchema = z
  .enum([
    'EPIC',
    'ISSUE',
    'TASK',
    'INCIDENT',
    'TEST_CASE',
    'REQUIREMENT',
    'OBJECTIVE',
    'KEY_RESULT',
  ])
  .describe('Type of work item');

export const WorkItemStateSchema = z.enum(['OPEN', 'CLOSED']).describe('State of work item');

export const WorkItemStateEventSchema = z
  .enum(['CLOSE', 'REOPEN'])
  .describe('State event for updating work item');

// Read-only schemas
export const ListWorkItemsSchema = z.object({
  namespacePath: z
    .string()
    .describe(
      'Namespace path (group or project) to list work items from. Use group path to get ALL work items recursively',
    ),
  types: z.array(WorkItemTypeEnumSchema).optional().describe('Filter by work item types'),
  includeSubgroups: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Include work items from subgroups and their projects (only applies to group namespaces)',
    ),
  first: z.number().optional().default(20).describe('Number of items to fetch'),
  after: z.string().optional().describe('Cursor for pagination'),
  simple: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Return simplified structure with essential fields only (id, title, state, type, assignees, labels). Set false for full details.',
    ),
  active: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Include only active projects and work items (excludes archived and deletion_scheduled projects). Set false to include all.',
    ),
});

export const GetWorkItemSchema = z.object({
  id: WorkItemIdSchema,
});

export const GetWorkItemTypesSchema = z.object({
  namespacePath: z
    .string()
    .describe('Namespace path (group or project) to get work item types for'),
});

// Type exports
export type ListWorkItemsOptions = z.infer<typeof ListWorkItemsSchema>;
export type GetWorkItemOptions = z.infer<typeof GetWorkItemSchema>;
export type GetWorkItemTypesOptions = z.infer<typeof GetWorkItemTypesSchema>;
export type WorkItemTypeEnum = z.infer<typeof WorkItemTypeEnumSchema>;
export type WorkItemState = z.infer<typeof WorkItemStateSchema>;
