import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListWorkItemsSchema, GetWorkItemSchema, GetWorkItemTypesSchema } from './schema-readonly';
import { CreateWorkItemSchema, UpdateWorkItemSchema, DeleteWorkItemSchema } from './schema';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { ConnectionManager } from '../../services/ConnectionManager';
import {
  CREATE_WORK_ITEM,
  CREATE_WORK_ITEM_WITH_DESCRIPTION,
  GET_WORK_ITEMS,
  GET_PROJECT_WORK_ITEMS,
  GET_WORK_ITEM,
  UPDATE_WORK_ITEM,
  DELETE_WORK_ITEM,
  GET_WORK_ITEM_TYPES,
  WorkItemUpdateInput,
} from '../../graphql/workItems';

/**
 * Work items tools registry - unified registry containing all work item operation tools with their handlers
 */
export const workitemsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // Read-only tools
  [
    'list_work_items',
    {
      name: 'list_work_items',
      description:
        'HIERARCHY-AWARE: List work items from correct namespace level. CRITICAL: Use groupPath for EPICS ONLY (group-level), projectPath for ISSUES/TASKS/BUGS ONLY (project-level). Wrong level = empty results. EPICS exist ONLY at GROUP level. ISSUES/TASKS/BUGS exist ONLY at PROJECT level. Returns work items with widgets. INHERITANCE: Group labels/milestones cascade to project items.',
      inputSchema: zodToJsonSchema(ListWorkItemsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = ListWorkItemsSchema.parse(args);
        const { groupPath, projectPath, types, first, after } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // Determine which query to use based on input
        const isProject = !!projectPath;
        const path = isProject ? projectPath : groupPath;

        if (isProject) {
          // Use project query for Issues/Tasks/Bugs
          const response = await client.request(GET_PROJECT_WORK_ITEMS, {
            projectPath: path as string,
            types: types,
            first: first || 20,
            after: after,
          });
          return response.project?.workItems?.nodes || [];
        } else {
          // Use group query for Epics
          const response = await client.request(GET_WORK_ITEMS, {
            groupPath: path as string,
            types: types,
            first: first || 20,
            after: after,
          });
          return response.group?.workItems?.nodes || [];
        }
      },
    },
  ],
  [
    'get_work_item',
    {
      name: 'get_work_item',
      description:
        'GET BY ID: Retrieve complete work item details using GraphQL global ID. Use when: Getting full work item data, Checking widgets (assignees/labels/milestones), Works for ANY type (Epic/Issue/Task/Bug). Requires GraphQL ID format: "gid://gitlab/WorkItem/123". Get ID from list_work_items or create_work_item response.',
      inputSchema: zodToJsonSchema(GetWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetWorkItemSchema.parse(args);
        const { id } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // Use GraphQL query for getting work item details
        const response = await client.request(GET_WORK_ITEM, { id });

        if (!response.workItem) {
          throw new Error(`Work item with ID "${id}" not found`);
        }

        return response.workItem;
      },
    },
  ],
  [
    'get_work_item_types',
    {
      name: 'get_work_item_types',
      description:
        'PREREQUISITE: Discover available work item types - RUN THIS FIRST! CRITICAL: Type IDs are DYNAMIC per GitLab instance - NEVER hardcode! GROUP path shows: Epic types ONLY. PROJECT path shows: Issue/Task/Bug types ONLY. Returns: type names, IDs, supported widgets. ALWAYS query types before create_work_item to get correct type ID. Custom types supported.',
      inputSchema: zodToJsonSchema(GetWorkItemTypesSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetWorkItemTypesSchema.parse(args);
        const { namespacePath } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // Use GraphQL query for getting work item types
        const response = await client.request(GET_WORK_ITEM_TYPES, {
          namespacePath: namespacePath,
        });

        // Return the work item types in the expected format
        return response.namespace?.workItemTypes?.nodes || [];
      },
    },
  ],
  // Write tools
  [
    'create_work_item',
    {
      name: 'create_work_item',
      description:
        'CREATE: Add new work item at CORRECT hierarchy level. CRITICAL RULES: For EPIC: namespacePath=GROUP ("my-group"), For ISSUE/TASK/BUG: namespacePath=PROJECT ("my-group/my-project"). Wrong level = ERROR! Auto-discovers type ID from name. RUN get_work_item_types FIRST to see valid types! LABELS WARNING: Use list_labels FIRST to discover existing taxonomy - label widget auto-creates labels that don\'t exist, potentially creating unwanted duplicates!',
      inputSchema: zodToJsonSchema(CreateWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateWorkItemSchema.parse(args);
        const { namespacePath, title, workItemType, description } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // First, get work item types for this namespace to get the correct type ID
        const workItemTypesResponse = await client.request(GET_WORK_ITEM_TYPES, {
          namespacePath,
        });

        const workItemTypes = workItemTypesResponse.namespace.workItemTypes.nodes;
        const workItemTypeObj = workItemTypes.find((t) => t.name.toUpperCase() === workItemType);

        if (!workItemTypeObj) {
          throw new Error(
            `Work item type "${workItemType}" not found in namespace "${namespacePath}"`,
          );
        }

        // Use appropriate mutation based on whether description is provided
        const response = description
          ? await client.request(CREATE_WORK_ITEM_WITH_DESCRIPTION, {
              namespacePath,
              title,
              workItemTypeId: workItemTypeObj.id,
              description,
            })
          : await client.request(CREATE_WORK_ITEM, {
              namespacePath,
              title,
              workItemTypeId: workItemTypeObj.id,
            });

        if (response.workItemCreate?.errors?.length && response.workItemCreate.errors.length > 0) {
          throw new Error(`GitLab GraphQL errors: ${response.workItemCreate.errors.join(', ')}`);
        }

        if (!response.workItemCreate?.workItem) {
          throw new Error('Work item creation failed - no work item returned');
        }

        return response.workItemCreate.workItem;
      },
    },
  ],
  [
    'update_work_item',
    {
      name: 'update_work_item',
      description:
        'UPDATE: Modify existing work item properties. Use when: Changing title/description, Updating assignees/labels/milestone, Closing/reopening items. For labels: Use list_labels FIRST to discover existing project/group taxonomy before adding label IDs. Supports PARTIAL updates - only send fields to change. State events: "CLOSE" to close, "REOPEN" to open. Requires GraphQL ID (gid://...). Widgets auto-included when data provided.',
      inputSchema: zodToJsonSchema(UpdateWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = UpdateWorkItemSchema.parse(args);
        const { id, title, description, state, assigneeIds, labelIds, milestoneId } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // Build dynamic input object based on provided values
        const input: WorkItemUpdateInput = { id };

        // Add basic properties if provided
        if (title !== undefined) input.title = title;
        if (state !== undefined) input.stateEvent = state;

        // Add widget objects only if data is provided
        if (description !== undefined) {
          input.descriptionWidget = { description };
        }

        if (assigneeIds !== undefined && assigneeIds.length > 0) {
          input.assigneesWidget = { assigneeIds };
        }

        if (labelIds !== undefined && labelIds.length > 0) {
          input.labelsWidget = { addLabelIds: labelIds };
        }

        if (milestoneId !== undefined) {
          input.milestoneWidget = { milestoneId };
        }

        // Use single GraphQL mutation with dynamic input
        const response = await client.request(UPDATE_WORK_ITEM, { input });

        if (response.workItemUpdate?.errors?.length && response.workItemUpdate.errors.length > 0) {
          throw new Error(`GitLab GraphQL errors: ${response.workItemUpdate.errors.join(', ')}`);
        }

        if (!response.workItemUpdate?.workItem) {
          throw new Error('Work item update failed - no work item returned');
        }

        return response.workItemUpdate.workItem;
      },
    },
  ],
  [
    'delete_work_item',
    {
      name: 'delete_work_item',
      description:
        'DELETE: Permanently remove work item - CANNOT BE UNDONE! Use when: Removing obsolete items, Cleaning up test data. CAUTION: Deletes ALL associated data, removes from epics/milestones, breaks all references. Requires GraphQL ID (gid://...). Needs Maintainer+ permissions. Works for ANY type (Epic/Issue/Task/Bug).',
      inputSchema: zodToJsonSchema(DeleteWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = DeleteWorkItemSchema.parse(args);
        const { id } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // Use GraphQL mutation for deleting work item
        const response = await client.request(DELETE_WORK_ITEM, { id });

        if (response.workItemDelete?.errors?.length && response.workItemDelete.errors.length > 0) {
          throw new Error(`GitLab GraphQL errors: ${response.workItemDelete.errors.join(', ')}`);
        }

        // Return success indicator for deletion
        return { deleted: true };
      },
    },
  ],
]);

/**
 * Get read-only tool names from the registry
 */
export function getWorkitemsReadOnlyToolNames(): string[] {
  return ['list_work_items', 'get_work_item', 'get_work_item_types'];
}

/**
 * Get all tool definitions from the registry (for backward compatibility)
 */
export function getWorkitemsToolDefinitions(): EnhancedToolDefinition[] {
  return Array.from(workitemsToolRegistry.values());
}

/**
 * Get filtered tools based on read-only mode
 */
export function getFilteredWorkitemsTools(readOnlyMode: boolean = false): EnhancedToolDefinition[] {
  if (readOnlyMode) {
    const readOnlyNames = getWorkitemsReadOnlyToolNames();
    return Array.from(workitemsToolRegistry.values()).filter((tool) =>
      readOnlyNames.includes(tool.name),
    );
  }
  return getWorkitemsToolDefinitions();
}
