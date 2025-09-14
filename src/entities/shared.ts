import { z } from "zod";
import { flexibleBoolean, flexibleBooleanNullable } from "./utils.js";

// Shared schemas that are used across multiple entities
export const PaginationOptionsSchema = z.object({
  page: z.number().int().min(1).optional().describe("Page number"),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Number of items per page (max 100)"),
});

// Basic milestone schema to avoid circular dependencies
export const GitLabMilestoneSchema = z.object({
  id: z.coerce.string(),
  iid: z.coerce.string(),
  title: z.string(),
  description: z.string().nullable().default(""),
  state: z.string(),
  web_url: z.string(),
});

// Base schemas for common types (used by both read and write operations)
export const GitLabAuthorSchema = z.object({
  name: z.string(),
  email: z.string(),
  date: z.string(),
});

export const GitLabUserSchema = z.object({
  id: z.coerce.string(),
  username: z.string(),
  name: z.string(),
  avatar_url: z.string().nullable().optional(),
});

export const GitLabNamespaceSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  path: z.string(),
  kind: z.string(),
  full_path: z.string(),
  parent_id: z.coerce.string().nullable(),
  avatar_url: z.string().nullable().optional(),
  web_url: z.string(),
});

export const ProjectParamsSchema = z.object({
  project_id: z.coerce.string().describe("Project ID or URL-encoded path"),
});

// Label schema (shared for both read and write)
export const GitLabLabelSchema = z.object({
  id: z.coerce.string(),
  name: z.string(),
  color: z.string(),
  text_color: z.string().optional(),
  description: z.string().nullable(),
  description_html: z.string().nullable().optional(),
  open_issues_count: z.number().nullable().optional(),
  closed_issues_count: z.number().nullable().optional(),
  open_merge_requests_count: z.number().nullable().optional(),
  subscribed: flexibleBoolean.nullable().optional(),
  priority: z.number().nullable().optional(),
  is_project_label: flexibleBoolean.optional(),
});

// Issue schema (shared response structure)
export const GitLabIssueSchema = z.object({
  id: z.coerce.string(),
  iid: z.coerce.string(),
  project_id: z.coerce.string(),
  title: z.string(),
  description: z.string().nullable().default(""),
  state: z.string(),
  author: GitLabUserSchema,
  assignees: z.array(GitLabUserSchema),
  labels: z.array(z.string()),
  milestone: GitLabMilestoneSchema.nullable(),
  type: z.enum(["ISSUE", "INCIDENT", "TEST_CASE", "TASK"]).optional(),
  user_notes_count: z.number().optional(),
  merge_requests_count: z.number().optional(),
  upvotes: z.number().optional(),
  downvotes: z.number().optional(),
  due_date: z.string().nullable().optional(),
  confidential: flexibleBoolean.optional(),
  discussion_locked: flexibleBooleanNullable.optional(),
  issue_type: z.string().optional(),
  web_url: z.string(),
  time_stats: z
    .object({
      time_estimate: z.number(),
      total_time_spent: z.number(),
      human_time_estimate: z.string().nullable(),
      human_total_time_spent: z.string().nullable(),
    })
    .optional(),
  task_completion_status: z
    .object({
      count: z.number(),
      completed_count: z.number(),
    })
    .optional(),
  blocking_issues_count: z.number().optional(),
  has_tasks: flexibleBoolean.optional(),
  task_status: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable(),
  closed_by: GitLabUserSchema.nullable().optional(),
  service_desk_reply_to: z.string().nullable().optional(),
});
