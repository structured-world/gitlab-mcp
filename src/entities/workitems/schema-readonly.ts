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
  groupPath: z.string().describe('Group path for listing work items'),
  types: z.array(WorkItemTypeEnumSchema).optional().describe('Filter by work item types'),
  first: z.number().optional().default(20).describe('Number of items to fetch'),
  after: z.string().optional().describe('Cursor for pagination'),
});

export const GetWorkItemSchema = z.object({
  id: WorkItemIdSchema,
});

export const GetWorkItemTypesSchema = z.object({
  groupPath: z.string().describe('Group path to get work item types for'),
});

// Type exports
export type ListWorkItemsOptions = z.infer<typeof ListWorkItemsSchema>;
export type GetWorkItemOptions = z.infer<typeof GetWorkItemSchema>;
export type GetWorkItemTypesOptions = z.infer<typeof GetWorkItemTypesSchema>;
export type WorkItemTypeEnum = z.infer<typeof WorkItemTypeEnumSchema>;
export type WorkItemState = z.infer<typeof WorkItemStateSchema>;
