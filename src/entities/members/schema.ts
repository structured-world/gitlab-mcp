import { z } from "zod";
import { requiredId } from "../utils";

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
// Manage Member Actions (Command)
// =============================================================================

/**
 * Add member to project
 */
const AddProjectMemberSchema = z.object({
  action: z.literal("add_to_project").describe("Add a user as member to a project"),
  project_id: requiredId.describe("Project ID or URL-encoded path"),
  user_id: requiredId.describe("User ID to add"),
  access_level: AccessLevelSchema,
  expires_at: z
    .string()
    .optional()
    .describe("Membership expiration date in ISO 8601 format (YYYY-MM-DD)"),
});

/**
 * Add member to group
 */
const AddGroupMemberSchema = z.object({
  action: z.literal("add_to_group").describe("Add a user as member to a group"),
  group_id: requiredId.describe("Group ID or URL-encoded path"),
  user_id: requiredId.describe("User ID to add"),
  access_level: AccessLevelSchema,
  expires_at: z
    .string()
    .optional()
    .describe("Membership expiration date in ISO 8601 format (YYYY-MM-DD)"),
});

/**
 * Remove member from project
 */
const RemoveProjectMemberSchema = z.object({
  action: z.literal("remove_from_project").describe("Remove a member from a project"),
  project_id: requiredId.describe("Project ID or URL-encoded path"),
  user_id: requiredId.describe("User ID to remove"),
  skip_subresources: z.boolean().optional().describe("Skip removing from subprojects and forks"),
  unassign_issuables: z
    .boolean()
    .optional()
    .describe("Unassign member from issues and merge requests"),
});

/**
 * Remove member from group
 */
const RemoveGroupMemberSchema = z.object({
  action: z.literal("remove_from_group").describe("Remove a member from a group"),
  group_id: requiredId.describe("Group ID or URL-encoded path"),
  user_id: requiredId.describe("User ID to remove"),
  skip_subresources: z.boolean().optional().describe("Skip removing from subgroups and projects"),
  unassign_issuables: z
    .boolean()
    .optional()
    .describe("Unassign member from issues and merge requests"),
});

/**
 * Update project member access level
 */
const UpdateProjectMemberSchema = z.object({
  action: z.literal("update_project").describe("Update access level of a project member"),
  project_id: requiredId.describe("Project ID or URL-encoded path"),
  user_id: requiredId.describe("User ID to update"),
  access_level: AccessLevelSchema,
  expires_at: z
    .string()
    .optional()
    .describe("Membership expiration date in ISO 8601 format (YYYY-MM-DD)"),
});

/**
 * Update group member access level
 */
const UpdateGroupMemberSchema = z.object({
  action: z.literal("update_group").describe("Update access level of a group member"),
  group_id: requiredId.describe("Group ID or URL-encoded path"),
  user_id: requiredId.describe("User ID to update"),
  access_level: AccessLevelSchema,
  expires_at: z
    .string()
    .optional()
    .describe("Membership expiration date in ISO 8601 format (YYYY-MM-DD)"),
  member_role_id: z
    .number()
    .int()
    .optional()
    .describe("ID of a custom member role (Ultimate only)"),
});

// =============================================================================
// ManageMemberSchema - Discriminated Union
// =============================================================================

export const ManageMemberSchema = z.discriminatedUnion("action", [
  AddProjectMemberSchema,
  AddGroupMemberSchema,
  RemoveProjectMemberSchema,
  RemoveGroupMemberSchema,
  UpdateProjectMemberSchema,
  UpdateGroupMemberSchema,
]);

export type ManageMemberOptions = z.infer<typeof ManageMemberSchema>;
