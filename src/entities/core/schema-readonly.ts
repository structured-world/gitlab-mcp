import { z } from "zod";
import { flexibleBoolean, requiredId, paginationFields } from "../utils";

// ============================================================================
// READ-ONLY RESPONSE SCHEMAS
// ============================================================================

export const GitLabSearchResponseSchema = z.object({
  data: z.array(z.unknown()),
  total_count: z.number(),
});

export const GitLabReferenceSchema = z.object({
  type: z.string(),
  name: z.string(),
  path: z.string(),
  location: z.string(),
});

export const GitLabCompareResultSchema = z.object({
  commit: z.object({
    id: z.string(),
    short_id: z.string(),
    title: z.string(),
    author_name: z.string(),
    author_email: z.string(),
    authored_date: z.string(),
    committer_name: z.string(),
    committer_email: z.string(),
    committed_date: z.string(),
    message: z.string(),
  }),
  commits: z.array(z.unknown()),
  diffs: z.array(z.unknown()),
});

// ============================================================================
// CONSOLIDATED CQRS SCHEMAS - Discriminated union schema pattern
// Uses z.discriminatedUnion() for type-safe action handling.
// ============================================================================

// --- Shared fields for browse_projects ---
const projectVisibilityField = z
  .enum(["public", "internal", "private"])
  .optional()
  .describe("Filter by visibility: public, internal, or private.");
const projectArchivedField = flexibleBoolean
  .optional()
  .describe("Filter by archive status. true=archived only, false=active only.");
const projectOrderByField = z
  .enum(["id", "name", "path", "created_at", "updated_at", "last_activity_at", "similarity"])
  .optional()
  .describe("Sort field for results.");
const projectSortField = z
  .enum(["asc", "desc"])
  .optional()
  .describe("Sort direction: asc or desc.");
const projectProgrammingLangField = z
  .string()
  .optional()
  .describe('Filter by programming language (e.g., "javascript", "python").');

// --- Action: search ---
const SearchProjectsSchema = z.object({
  action: z.literal("search").describe("Find projects by criteria using global search API"),
  q: z
    .string()
    .optional()
    .describe("Global search query. Searches project names, paths, descriptions."),
  visibility: projectVisibilityField,
  archived: projectArchivedField,
  order_by: projectOrderByField,
  sort: projectSortField,
  with_programming_language: projectProgrammingLangField,
  ...paginationFields(),
});

// --- Action: list ---
const ListProjectsSchema = z.object({
  action: z.literal("list").describe("Browse accessible projects with optional group scope"),
  group_id: z.coerce
    .string()
    .optional()
    .describe("Group ID to list projects within. If omitted, lists YOUR accessible projects."),
  search: z
    .string()
    .optional()
    .describe("Text filter for list action (filters results by name/description)."),
  owned: flexibleBoolean.optional().describe("Show only projects you own (not just member of)."),
  starred: flexibleBoolean.optional().describe("Show only starred/favorited projects."),
  membership: flexibleBoolean.optional().describe("Show only projects where you have membership."),
  simple: flexibleBoolean
    .optional()
    .default(true)
    .describe("Return minimal fields for faster response. Default: true."),
  include_subgroups: flexibleBoolean
    .optional()
    .describe("Include projects from subgroups (requires group_id)."),
  with_shared: flexibleBoolean.optional().describe("Include shared projects (requires group_id)."),
  visibility: projectVisibilityField,
  archived: projectArchivedField,
  order_by: projectOrderByField,
  sort: projectSortField,
  with_programming_language: projectProgrammingLangField,
  ...paginationFields(),
});

// --- Action: get ---
const GetProjectSchema = z.object({
  action: z.literal("get").describe("Retrieve specific project details"),
  project_id: requiredId.describe(
    'Project identifier. Numeric ID or URL-encoded path (e.g., "42" or "gitlab-org%2Fgitlab").'
  ),
  statistics: flexibleBoolean.optional().describe("Include repository statistics."),
  license: flexibleBoolean.optional().describe("Include license information."),
});

// --- Discriminated union combining all actions ---
export const BrowseProjectsSchema = z.discriminatedUnion("action", [
  SearchProjectsSchema,
  ListProjectsSchema,
  GetProjectSchema,
]);

// browse_namespaces: discriminated union schema for list/get/verify actions

// --- Shared fields for browse_namespaces ---
const namespaceIdField = requiredId.describe("Namespace ID or path.");

// --- Action: list ---
const ListNamespacesSchema = z.object({
  action: z.literal("list").describe("Browse namespaces with optional filtering"),
  search: z.string().optional().describe("Search namespaces by name/path."),
  owned_only: flexibleBoolean.optional().describe("Show only namespaces you own."),
  top_level_only: flexibleBoolean.optional().describe("Show only root-level namespaces."),
  with_statistics: flexibleBoolean.optional().describe("Include storage/count statistics."),
  min_access_level: z
    .number()
    .optional()
    .describe(
      "Minimum access level: 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner."
    ),
  ...paginationFields(),
});

// --- Action: get ---
const GetNamespaceSchema = z.object({
  action: z.literal("get").describe("Retrieve namespace details"),
  namespace_id: namespaceIdField,
});

// --- Action: verify ---
const VerifyNamespaceSchema = z.object({
  action: z.literal("verify").describe("Check if namespace exists"),
  namespace_id: namespaceIdField,
});

// --- Discriminated union combining all actions ---
export const BrowseNamespacesSchema = z.discriminatedUnion("action", [
  ListNamespacesSchema,
  GetNamespaceSchema,
  VerifyNamespaceSchema,
]);

// browse_commits: discriminated union schema for list/get/diff actions

// --- Shared fields for browse_commits ---
const commitProjectIdField = requiredId.describe("Project ID or URL-encoded path.");
const commitShaField = requiredId.describe("Commit SHA. Can be full SHA, short hash, or ref name.");

// --- Action: list ---
const ListCommitsSchema = z.object({
  action: z.literal("list").describe("Browse commit history"),
  project_id: commitProjectIdField,
  ref_name: z.string().optional().describe("Branch/tag name. Defaults to default branch."),
  since: z.string().optional().describe("Start date filter (ISO 8601 format)."),
  until: z.string().optional().describe("End date filter (ISO 8601 format)."),
  path: z.string().optional().describe("Filter commits affecting this file/directory path."),
  author: z.string().optional().describe("Filter by author name or email."),
  all: flexibleBoolean.optional().describe("Include commits from all branches."),
  first_parent: flexibleBoolean.optional().describe("Follow only first parent (linear history)."),
  order: z.enum(["default", "topo"]).optional().describe("Commit ordering: default or topo."),
  with_stats: flexibleBoolean.optional().describe("Include stats for each commit."),
  trailers: flexibleBoolean.optional().describe("Include Git trailers (Signed-off-by, etc.)."),
  ...paginationFields(),
});

// --- Action: get ---
const GetCommitSchema = z.object({
  action: z.literal("get").describe("Retrieve commit details"),
  project_id: commitProjectIdField,
  sha: commitShaField,
  stats: flexibleBoolean.optional().describe("Include file change statistics."),
});

// --- Action: diff ---
const GetCommitDiffSchema = z.object({
  action: z.literal("diff").describe("Get code changes in a commit"),
  project_id: commitProjectIdField,
  sha: commitShaField,
  unidiff: flexibleBoolean.optional().describe("Return unified diff format."),
  ...paginationFields(),
});

// --- Discriminated union combining all actions ---
export const BrowseCommitsSchema = z.discriminatedUnion("action", [
  ListCommitsSchema,
  GetCommitSchema,
  GetCommitDiffSchema,
]);

// browse_events: discriminated union schema for user/project scopes

// --- Shared fields for browse_events ---
const eventTargetTypeField = z
  .enum(["issue", "milestone", "merge_request", "note", "project", "snippet", "user"])
  .optional()
  .describe("Filter by target type.");
const eventActionField = z
  .enum([
    "created",
    "updated",
    "closed",
    "reopened",
    "pushed",
    "commented",
    "merged",
    "joined",
    "left",
    "destroyed",
    "expired",
  ])
  .optional()
  .describe("Filter by event action.");
const eventBeforeField = z
  .string()
  .optional()
  .describe("Show events before this date (YYYY-MM-DD).");
const eventAfterField = z.string().optional().describe("Show events after this date (YYYY-MM-DD).");
const eventSortField = z
  .enum(["asc", "desc"])
  .optional()
  .describe("Sort order: asc=oldest first, desc=newest first.");

// --- Action: user ---
const UserEventsSchema = z.object({
  action: z.literal("user").describe("Show your activity across all projects"),
  target_type: eventTargetTypeField,
  event_action: eventActionField,
  before: eventBeforeField,
  after: eventAfterField,
  sort: eventSortField,
  ...paginationFields(),
});

// --- Action: project ---
const ProjectEventsSchema = z.object({
  action: z.literal("project").describe("Show specific project activity"),
  project_id: requiredId.describe("Project ID."),
  target_type: eventTargetTypeField,
  event_action: eventActionField,
  before: eventBeforeField,
  after: eventAfterField,
  sort: eventSortField,
  ...paginationFields(),
});

// --- Discriminated union combining all actions ---
export const BrowseEventsSchema = z.discriminatedUnion("action", [
  UserEventsSchema,
  ProjectEventsSchema,
]);

// ============================================================================
// CONSOLIDATED CQRS SCHEMAS - browse_users, browse_todos
// ============================================================================

// --- Shared fields for browse_users ---
const userSearchFields = {
  active: flexibleBoolean
    .optional()
    .describe("Filter for active (true) or inactive (false) users."),
  external: flexibleBoolean.optional().describe("Filter for external users with limited access."),
  blocked: flexibleBoolean.optional().describe("Filter for blocked users."),
  humans: flexibleBoolean.optional().describe("Filter for human users only (exclude bots)."),
  created_after: z.string().optional().describe("Filter users created after this date (ISO 8601)."),
  created_before: z
    .string()
    .optional()
    .describe("Filter users created before this date (ISO 8601)."),
  exclude_active: flexibleBoolean.optional().describe("Exclude active users."),
  exclude_external: flexibleBoolean.optional().describe("Exclude external users."),
  exclude_humans: flexibleBoolean.optional().describe("Exclude human users."),
  exclude_internal: flexibleBoolean.optional().describe("Exclude internal system users."),
  without_project_bots: flexibleBoolean.optional().describe("Exclude project bot users."),
};

// --- Action: search ---
const SearchUsersSchema = z.object({
  action: z.literal("search").describe("Search users with smart pattern detection"),
  username: z.string().optional().describe("Exact username to search for. Case-sensitive."),
  public_email: z.string().optional().describe("Find user by exact public email address."),
  search: z.string().optional().describe("Partial text search across name, username, and email."),
  smart_search: flexibleBoolean
    .optional()
    .describe(
      "Enable smart search with auto-detection and transliteration. Auto-enabled for search parameter."
    ),
  ...userSearchFields,
  ...paginationFields(),
});

// --- Action: get ---
const GetUserSchema = z.object({
  action: z.literal("get").describe("Get a specific user by ID"),
  user_id: requiredId.describe("User ID to retrieve."),
});

// --- Discriminated union combining all actions ---
export const BrowseUsersSchema = z.discriminatedUnion("action", [SearchUsersSchema, GetUserSchema]);

// browse_todos: discriminated union schema for list action

// --- Action: list ---
const ListTodosActionSchema = z.object({
  action: z.literal("list").describe("List your pending and completed todos"),
  state: z
    .enum(["pending", "done"])
    .optional()
    .describe("Filter todos by state: pending=active, done=completed."),
  // Named "todo_action" instead of "action" to avoid collision with the
  // discriminated union's `action` field. The handler maps this back to
  // the GitLab API's `action` query parameter.
  todo_action: z
    .enum([
      "assigned",
      "mentioned",
      "build_failed",
      "marked",
      "approval_required",
      "unmergeable",
      "directly_addressed",
      "merge_train_removed",
      "review_requested",
      "member_access_requested",
      "review_submitted",
    ])
    .optional()
    .describe("Filter by action type."),
  type: z
    .enum([
      "Issue",
      "MergeRequest",
      "Commit",
      "Epic",
      "DesignManagement::Design",
      "AlertManagement::Alert",
    ])
    .optional()
    .describe("Filter by target type."),
  project_id: z.number().optional().describe("Filter by project ID."),
  group_id: z.number().optional().describe("Filter by group ID."),
  author_id: z.number().optional().describe("Filter by author ID."),
  ...paginationFields(),
});

// --- Discriminated union combining all actions ---
export const BrowseTodosSchema = z.discriminatedUnion("action", [ListTodosActionSchema]);

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type GitLabSearchResponse = z.infer<typeof GitLabSearchResponseSchema>;
export type GitLabReference = z.infer<typeof GitLabReferenceSchema>;
export type GitLabCompareResult = z.infer<typeof GitLabCompareResultSchema>;

// Consolidated types
export type BrowseProjectsOptions = z.infer<typeof BrowseProjectsSchema>;
export type BrowseNamespacesOptions = z.infer<typeof BrowseNamespacesSchema>;
export type BrowseCommitsOptions = z.infer<typeof BrowseCommitsSchema>;
export type BrowseEventsOptions = z.infer<typeof BrowseEventsSchema>;
export type BrowseUsersOptions = z.infer<typeof BrowseUsersSchema>;
export type BrowseTodosOptions = z.infer<typeof BrowseTodosSchema>;
