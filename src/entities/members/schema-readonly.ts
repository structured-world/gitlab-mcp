import { z } from "zod";
import { requiredId } from "../utils";
import { PaginationOptionsSchema } from "../shared";

/**
 * Access levels for GitLab members
 * - 10: Guest (view only)
 * - 20: Reporter (view + comment)
 * - 30: Developer (push code)
 * - 40: Maintainer (manage settings)
 * - 50: Owner (full control)
 */
const AccessLevelSchema = z
  .number()
  .int()
  .refine(val => [0, 5, 10, 20, 30, 40, 50].includes(val), {
    message:
      "Access level must be 0 (No access), 5 (Minimal), 10 (Guest), 20 (Reporter), 30 (Developer), 40 (Maintainer), or 50 (Owner)",
  })
  .describe("Access level: 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner");

// =============================================================================
// Browse Members Actions (Query)
// =============================================================================

/**
 * List project members
 */
const ListProjectMembersSchema = z
  .object({
    action: z.literal("list_project").describe("List all members of a project"),
    project_id: requiredId.describe("Project ID or URL-encoded path"),
    query: z.string().optional().describe("Search members by name or username"),
    user_ids: z.array(z.coerce.string()).optional().describe("Filter to specific user IDs"),
  })
  .merge(PaginationOptionsSchema);

/**
 * List group members
 */
const ListGroupMembersSchema = z
  .object({
    action: z.literal("list_group").describe("List all members of a group"),
    group_id: requiredId.describe("Group ID or URL-encoded path"),
    query: z.string().optional().describe("Search members by name or username"),
    user_ids: z.array(z.coerce.string()).optional().describe("Filter to specific user IDs"),
  })
  .merge(PaginationOptionsSchema);

/**
 * Get specific member from project
 */
const GetProjectMemberSchema = z.object({
  action: z.literal("get_project").describe("Get a specific member of a project"),
  project_id: requiredId.describe("Project ID or URL-encoded path"),
  user_id: requiredId.describe("User ID of the member"),
  include_inherited: z
    .boolean()
    .optional()
    .describe("Include members inherited from parent groups"),
});

/**
 * Get specific member from group
 */
const GetGroupMemberSchema = z.object({
  action: z.literal("get_group").describe("Get a specific member of a group"),
  group_id: requiredId.describe("Group ID or URL-encoded path"),
  user_id: requiredId.describe("User ID of the member"),
  include_inherited: z
    .boolean()
    .optional()
    .describe("Include members inherited from parent groups"),
});

/**
 * List all members including inherited (project)
 */
const ListAllProjectMembersSchema = z
  .object({
    action: z
      .literal("list_all_project")
      .describe("List all project members including inherited from parent groups"),
    project_id: requiredId.describe("Project ID or URL-encoded path"),
    query: z.string().optional().describe("Search members by name or username"),
    user_ids: z.array(z.coerce.string()).optional().describe("Filter to specific user IDs"),
    state: z.enum(["active", "awaiting", "blocked"]).optional().describe("Filter by member state"),
  })
  .merge(PaginationOptionsSchema);

/**
 * List all members including inherited (group)
 */
const ListAllGroupMembersSchema = z
  .object({
    action: z
      .literal("list_all_group")
      .describe("List all group members including inherited from parent groups"),
    group_id: requiredId.describe("Group ID or URL-encoded path"),
    query: z.string().optional().describe("Search members by name or username"),
    user_ids: z.array(z.coerce.string()).optional().describe("Filter to specific user IDs"),
    state: z.enum(["active", "awaiting", "blocked"]).optional().describe("Filter by member state"),
  })
  .merge(PaginationOptionsSchema);

// =============================================================================
// BrowseMembersSchema - Discriminated Union
// =============================================================================

export const BrowseMembersSchema = z.discriminatedUnion("action", [
  ListProjectMembersSchema,
  ListGroupMembersSchema,
  GetProjectMemberSchema,
  GetGroupMemberSchema,
  ListAllProjectMembersSchema,
  ListAllGroupMembersSchema,
]);

export type BrowseMembersOptions = z.infer<typeof BrowseMembersSchema>;

// Export AccessLevelSchema for reuse in manage schema
export { AccessLevelSchema };
