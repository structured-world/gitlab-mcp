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
  GET_GROUP_PROJECTS,
  GET_NAMESPACE_TYPE,
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
        'COMPREHENSIVE: List ALL work items from namespace. For GROUP: Returns EPICS from group + ALL ISSUES/TASKS/BUGS from ALL projects recursively. For PROJECT: Returns ISSUES/TASKS/BUGS from that project. BEST PRACTICE: Use group path "ps/recipes" to get ALL tasks from entire group hierarchy. Automatically detects namespace type and fetches appropriately. Set includeSubgroups=false to limit scope.',
      inputSchema: zodToJsonSchema(ListWorkItemsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        console.log('🚀 list_work_items called with args:', JSON.stringify(args, null, 2));
        const options = ListWorkItemsSchema.parse(args);
        const { namespacePath, types, includeSubgroups, first, after } = options;
        console.log('📋 Parsed options:', { namespacePath, types, includeSubgroups, first, after });

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // Determine namespace type (Group or Project)
        console.log('🔍 Determining namespace type for:', namespacePath);
        let namespaceType = 'Group'; // default assumption
        try {
          console.log('⏳ Making GraphQL request for namespace type...');
          const nsResponse = await client.request(GET_NAMESPACE_TYPE, { namespacePath });
          console.log('✅ Got namespace response:', nsResponse);
          namespaceType = nsResponse.namespace?.__typename || 'Group';
        } catch (e) {
          // If namespace query fails, try to determine from context
          console.log('❌ Could not determine namespace type, assuming Group. Error:', e);
        }

        console.log('🎯 Namespace type determined as:', namespaceType);

        const allWorkItems: unknown[] = [];

        if (namespaceType === 'Group' || namespaceType === 'Namespace') {
          // Get Epics from the group (if requested)
          if (!types || types.includes('EPIC')) {
            try {
              console.log('📋 Fetching EPICs from group:', namespacePath);
              const epicResponse = await client.request(GET_WORK_ITEMS, {
                groupPath: namespacePath,
                types: ['EPIC'], // Use string type instead of GID
                first: first || 20,
                after: after,
              });
              console.log('📋 Epic response:', JSON.stringify(epicResponse, null, 2));
              const epics = epicResponse.group?.workItems?.nodes || [];
              console.log('📋 Found epics count:', epics.length);
              allWorkItems.push(...epics);
            } catch (e) {
              console.log('❌ Could not fetch epics from group:', e);
            }
          }

          // Get projects in the group (with optional subgroups)
          if (
            !types ||
            types.some((t) => ['ISSUE', 'TASK', 'INCIDENT', 'TEST_CASE', 'REQUIREMENT'].includes(t))
          ) {
            try {
              const projectsResponse = await client.request(GET_GROUP_PROJECTS, {
                groupPath: namespacePath,
                includeSubgroups: includeSubgroups !== false, // default true
              });
              const projects = projectsResponse.group?.projects?.nodes || [];

              // Fetch work items from each project in parallel
              const projectWorkItemPromises = projects.map(async (project) => {
                try {
                  const projectTypes = types?.filter((t) => t !== 'EPIC') ?? [
                    'ISSUE',
                    'TASK',
                    'INCIDENT',
                  ];
                  const projectResponse = await client.request(GET_PROJECT_WORK_ITEMS, {
                    projectPath: project.fullPath,
                    types: projectTypes,
                    first: Math.floor((first || 20) / Math.max(projects.length, 1)), // Distribute limit
                    after: after,
                  });
                  return projectResponse.project?.workItems?.nodes || [];
                } catch (e) {
                  console.log(`Could not fetch work items from project ${project.fullPath}:`, e);
                  return [];
                }
              });

              const projectWorkItems = await Promise.all(projectWorkItemPromises);
              projectWorkItems.forEach((items) => allWorkItems.push(...items));
            } catch (e) {
              console.log('Could not fetch projects from group:', e);
            }
          }
        } else if (namespaceType === 'Project') {
          // For project namespace, just get work items from that project
          const projectTypes = types?.filter((t) => t !== 'EPIC') ?? ['ISSUE', 'TASK', 'INCIDENT'];
          try {
            const response = await client.request(GET_PROJECT_WORK_ITEMS, {
              projectPath: namespacePath,
              types: projectTypes,
              first: first || 20,
              after: after,
            });
            allWorkItems.push(...(response.project?.workItems?.nodes || []));
          } catch (e) {
            console.log('Could not fetch work items from project:', e);
          }
        }

        console.log('🎯 Final result - total work items found:', allWorkItems.length);
        return allWorkItems;
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
