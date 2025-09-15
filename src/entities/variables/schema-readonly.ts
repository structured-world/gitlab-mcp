import { z } from 'zod';
import { PaginationOptionsSchema } from '../shared';

// READ-ONLY OPERATION SCHEMAS for GitLab CI/CD Variables

// List project/group variables schema (read-only)
export const ListVariablesSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
  })
  .merge(PaginationOptionsSchema)
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

// Get single variable schema (read-only)
export const GetVariableSchema = z
  .object({
    project_id: z.coerce.string().optional().describe('Project ID or URL-encoded path'),
    group_id: z.coerce.string().optional().describe('Group ID or URL-encoded path'),
    key: z
      .string()
      .describe(
        'The key of the CI/CD variable. Maximum 255 characters, alphanumeric and underscore only',
      ),
    filter: z
      .object({
        environment_scope: z
          .string()
          .optional()
          .describe(
            'The environment scope filter for the variable. Use "*" for all environments or specific environment name',
          ),
      })
      .optional()
      .describe('Filter parameters for the variable lookup'),
  })
  .refine((data) => Boolean(data.project_id) !== Boolean(data.group_id), {
    message: 'Exactly one of project_id or group_id must be provided',
  });

// Export type definitions
export type ListVariablesOptions = z.infer<typeof ListVariablesSchema>;
export type GetVariableOptions = z.infer<typeof GetVariableSchema>;
