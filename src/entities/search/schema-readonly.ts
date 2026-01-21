import { z } from "zod";
import { PaginationOptionsSchema } from "../shared";
import { requiredId } from "../utils";

// ============================================================================
// Search scope enum - GitLab API search scopes
// ============================================================================

export const SearchScopeSchema = z
  .enum([
    "projects",
    "issues",
    "merge_requests",
    "milestones",
    "snippet_titles",
    "users",
    "groups",
    "blobs",
    "commits",
    "wiki_blobs",
    "notes",
  ])
  .describe("Search scope determining what type of resources to search");

// ============================================================================
// Base search parameters shared across all scopes
// ============================================================================

const BaseSearchParams = z.object({
  search: z.string().min(1).describe("Search query string (minimum 1 character)"),
  state: z
    .enum(["opened", "closed", "merged", "all"])
    .optional()
    .describe("Filter by state (for issues and merge_requests scopes)"),
  confidential: z
    .boolean()
    .optional()
    .describe("Filter by confidentiality (for issues scope, Premium only)"),
  order_by: z.enum(["created_at", "updated_at"]).optional().describe("Sort results by field"),
  sort: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
});

// ============================================================================
// browse_search - CQRS Query Tool (discriminated union schema)
// Actions: global, project, group
// Uses z.discriminatedUnion() for type-safe action handling.
// ============================================================================

// --- Action: global ---
const GlobalSearchSchema = z
  .object({
    action: z.literal("global").describe("Search across entire GitLab instance"),
    scope: SearchScopeSchema,
  })
  .merge(BaseSearchParams)
  .merge(PaginationOptionsSchema);

// --- Action: project ---
const ProjectSearchSchema = z
  .object({
    action: z.literal("project").describe("Search within a specific project"),
    project_id: requiredId.describe(
      "Project ID or URL-encoded path (e.g., 'group/project' or '123')"
    ),
    scope: SearchScopeSchema,
    ref: z.string().optional().describe("Branch/tag reference for code search (blobs, commits)"),
  })
  .merge(BaseSearchParams)
  .merge(PaginationOptionsSchema);

// --- Action: group ---
const GroupSearchSchema = z
  .object({
    action: z.literal("group").describe("Search within a specific group and its subgroups"),
    group_id: requiredId.describe("Group ID or URL-encoded path (e.g., 'my-group' or '123')"),
    scope: SearchScopeSchema,
  })
  .merge(BaseSearchParams)
  .merge(PaginationOptionsSchema);

// --- Discriminated union combining all actions ---
export const BrowseSearchSchema = z.discriminatedUnion("action", [
  GlobalSearchSchema,
  ProjectSearchSchema,
  GroupSearchSchema,
]);

// ============================================================================
// Type exports
// ============================================================================

export type SearchScope = z.infer<typeof SearchScopeSchema>;
export type BrowseSearchInput = z.infer<typeof BrowseSearchSchema>;
export type GlobalSearchInput = z.infer<typeof GlobalSearchSchema>;
export type ProjectSearchInput = z.infer<typeof ProjectSearchSchema>;
export type GroupSearchInput = z.infer<typeof GroupSearchSchema>;
