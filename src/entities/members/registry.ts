import * as z from "zod";
import { BrowseMembersSchema } from "./schema-readonly";
import { ManageMemberSchema } from "./schema";
import { gitlab, toQuery } from "../../utils/gitlab-api";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
import { isActionDenied } from "../../config";

/**
 * Members tools registry - 2 CQRS tools
 *
 * browse_members (Query): list_project, list_group, get_project, get_group,
 *                         list_all_project, list_all_group
 * manage_member (Command): add_to_project, add_to_group, remove_from_project,
 *                          remove_from_group, update_project, update_group
 */
export const membersToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_members - CQRS Query Tool (discriminated union schema)
  // ============================================================================
  [
    "browse_members",
    {
      name: "browse_members",
      description:
        'BROWSE team members in projects and groups. Actions: "list_project" lists project members, "list_group" lists group members, "get_project" gets project member details, "get_group" gets group member details, "list_all_project" includes inherited members, "list_all_group" includes inherited members. Access levels: 0=No access, 5=Minimal, 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner.',
      inputSchema: z.toJSONSchema(BrowseMembersSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseMembersSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_members", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_members tool`);
        }

        switch (input.action) {
          case "list_project": {
            const { action: _action, project_id, ...queryOptions } = input;
            const encodedProjectId = encodeURIComponent(project_id);
            return gitlab.get(`projects/${encodedProjectId}/members`, {
              query: toQuery(queryOptions, []),
            });
          }

          case "list_group": {
            const { action: _action, group_id, ...queryOptions } = input;
            const encodedGroupId = encodeURIComponent(group_id);
            return gitlab.get(`groups/${encodedGroupId}/members`, {
              query: toQuery(queryOptions, []),
            });
          }

          case "get_project": {
            const { project_id, user_id, include_inherited } = input;
            const encodedProjectId = encodeURIComponent(project_id);
            const encodedUserId = encodeURIComponent(user_id);
            const endpoint = include_inherited
              ? `projects/${encodedProjectId}/members/all/${encodedUserId}`
              : `projects/${encodedProjectId}/members/${encodedUserId}`;
            return gitlab.get(endpoint);
          }

          case "get_group": {
            const { group_id, user_id, include_inherited } = input;
            const encodedGroupId = encodeURIComponent(group_id);
            const encodedUserId = encodeURIComponent(user_id);
            const endpoint = include_inherited
              ? `groups/${encodedGroupId}/members/all/${encodedUserId}`
              : `groups/${encodedGroupId}/members/${encodedUserId}`;
            return gitlab.get(endpoint);
          }

          case "list_all_project": {
            const { action: _action, project_id, ...queryOptions } = input;
            const encodedProjectId = encodeURIComponent(project_id);
            return gitlab.get(`projects/${encodedProjectId}/members/all`, {
              query: toQuery(queryOptions, []),
            });
          }

          case "list_all_group": {
            const { action: _action, group_id, ...queryOptions } = input;
            const encodedGroupId = encodeURIComponent(group_id);
            return gitlab.get(`groups/${encodedGroupId}/members/all`, {
              query: toQuery(queryOptions, []),
            });
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_member - CQRS Command Tool (discriminated union schema)
  // ============================================================================
  [
    "manage_member",
    {
      name: "manage_member",
      description:
        'MANAGE team members in projects and groups. Actions: "add_to_project" adds member to project, "add_to_group" adds member to group, "remove_from_project" removes from project, "remove_from_group" removes from group, "update_project" changes project member access level, "update_group" changes group member access level. Access levels: 0=No access, 5=Minimal, 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner.',
      inputSchema: z.toJSONSchema(ManageMemberSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageMemberSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_member", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_member tool`);
        }

        switch (input.action) {
          case "add_to_project": {
            const { project_id, user_id, access_level, expires_at } = input;
            const encodedProjectId = encodeURIComponent(project_id);

            const body: Record<string, unknown> = {
              user_id,
              access_level,
            };
            if (expires_at !== undefined) body.expires_at = expires_at;

            return gitlab.post(`projects/${encodedProjectId}/members`, {
              body,
              contentType: "json",
            });
          }

          case "add_to_group": {
            const { group_id, user_id, access_level, expires_at } = input;
            const encodedGroupId = encodeURIComponent(group_id);

            const body: Record<string, unknown> = {
              user_id,
              access_level,
            };
            if (expires_at !== undefined) body.expires_at = expires_at;

            return gitlab.post(`groups/${encodedGroupId}/members`, {
              body,
              contentType: "json",
            });
          }

          case "remove_from_project": {
            const { project_id, user_id, skip_subresources, unassign_issuables } = input;
            const encodedProjectId = encodeURIComponent(project_id);
            const encodedUserId = encodeURIComponent(user_id);

            const query: Record<string, boolean | undefined> = {};
            if (skip_subresources !== undefined) query.skip_subresources = skip_subresources;
            if (unassign_issuables !== undefined) query.unassign_issuables = unassign_issuables;

            await gitlab.delete(`projects/${encodedProjectId}/members/${encodedUserId}`, {
              query,
            });
            return { removed: true, project_id, user_id };
          }

          case "remove_from_group": {
            const { group_id, user_id, skip_subresources, unassign_issuables } = input;
            const encodedGroupId = encodeURIComponent(group_id);
            const encodedUserId = encodeURIComponent(user_id);

            const query: Record<string, boolean | undefined> = {};
            if (skip_subresources !== undefined) query.skip_subresources = skip_subresources;
            if (unassign_issuables !== undefined) query.unassign_issuables = unassign_issuables;

            await gitlab.delete(`groups/${encodedGroupId}/members/${encodedUserId}`, {
              query,
            });
            return { removed: true, group_id, user_id };
          }

          case "update_project": {
            const { project_id, user_id, access_level, expires_at } = input;
            const encodedProjectId = encodeURIComponent(project_id);
            const encodedUserId = encodeURIComponent(user_id);

            const body: Record<string, unknown> = { access_level };
            if (expires_at !== undefined) body.expires_at = expires_at;

            return gitlab.put(`projects/${encodedProjectId}/members/${encodedUserId}`, {
              body,
              contentType: "json",
            });
          }

          case "update_group": {
            const { group_id, user_id, access_level, expires_at, member_role_id } = input;
            const encodedGroupId = encodeURIComponent(group_id);
            const encodedUserId = encodeURIComponent(user_id);

            const body: Record<string, unknown> = { access_level };
            if (expires_at !== undefined) body.expires_at = expires_at;
            if (member_role_id !== undefined) body.member_role_id = member_role_id;

            return gitlab.put(`groups/${encodedGroupId}/members/${encodedUserId}`, {
              body,
              contentType: "json",
            });
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getMembersReadOnlyToolNames(): string[] {
  return ["browse_members"];
}

/**
 * Get all tool definitions from the registry
 */
export function getMembersToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(membersToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredMembersTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getMembersReadOnlyToolNames();
    return Array.from(membersToolRegistry.values()).filter(tool =>
      readOnlyNames.includes(tool.name)
    );
  }
  return getMembersToolDefinitions();
}
