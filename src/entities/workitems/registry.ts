import { zodToJsonSchema } from 'zod-to-json-schema';
import { ListWorkItemsSchema, GetWorkItemSchema } from './schema-readonly';
import { CreateWorkItemSchema, UpdateWorkItemSchema, DeleteWorkItemSchema } from './schema';
import { ToolRegistry, EnhancedToolDefinition } from '../../types';
import { ConnectionManager } from '../../services/ConnectionManager';
import { getWorkItemTypes } from '../../utils/workItemTypes';
import {
  cleanWorkItemResponse,
  toGid,
  toGids,
  type GitLabWorkItem,
} from '../../utils/idConversion';

// Define interface for work item type objects
interface WorkItemType {
  id: string;
  name: string;
}
import {
  CREATE_WORK_ITEM,
  CREATE_WORK_ITEM_WITH_DESCRIPTION,
  GET_NAMESPACE_WORK_ITEMS,
  GET_WORK_ITEM,
  UPDATE_WORK_ITEM,
  DELETE_WORK_ITEM,
  WorkItemUpdateInput,
  WorkItem as GraphQLWorkItem,
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
        'List work items from a namespace. Returns open work items by default. Supports filtering by type and state, with pagination for large result sets.',
      inputSchema: zodToJsonSchema(ListWorkItemsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        console.log('list_work_items called with args:', JSON.stringify(args, null, 2));
        const options = ListWorkItemsSchema.parse(args);
        const { namespacePath, types, state, first, after, simple, active } = options;
        console.log('Parsed options:', {
          namespacePath,
          types,
          state,
          first,
          after,
          simple,
          active,
        });

        // Types for work item structure - flexible widget interface for runtime processing
        interface FlexibleWorkItemWidget {
          type: string;
          assignees?: {
            nodes?: Array<{
              id: string;
              username: string;
              name: string;
            }>;
          };
          labels?: {
            nodes?: Array<{
              id: string;
              title: string;
              color: string;
            }>;
          };
          milestone?: {
            id: string;
            title: string;
            state: string;
          };
          parent?: {
            id: string;
            iid: string;
            title: string;
            workItemType: string;
          };
          hasChildren?: boolean;
        }

        interface SimplifiedWorkItem {
          id: string;
          iid: string;
          title: string;
          state: string;
          workItemType: string;
          webUrl: string;
          createdAt: string;
          updatedAt: string;
          description?: string;
          widgets?: Array<{
            type: string;
            assignees?: Array<{
              id: string;
              username: string;
              name: string;
            }>;
            labels?: Array<{
              id: string;
              title: string;
              color: string;
            }>;
            milestone?: {
              id: string;
              title: string;
              state: string;
            };
            parent?: {
              id: string;
              iid: string;
              title: string;
              workItemType: string;
            } | null;
            hasChildren?: boolean;
          }>;
        }

        // Function to simplify work item structure for agent consumption
        const simplifyWorkItem = (
          workItem: GraphQLWorkItem,
        ): GraphQLWorkItem | SimplifiedWorkItem => {
          if (!simple) return workItem;

          const simplified: SimplifiedWorkItem = {
            id: workItem.id,
            iid: workItem.iid,
            title: workItem.title,
            state: workItem.state,
            workItemType:
              typeof workItem.workItemType === 'string'
                ? workItem.workItemType
                : workItem.workItemType?.name || 'Unknown',
            webUrl: workItem.webUrl,
            createdAt: workItem.createdAt,
            updatedAt: workItem.updatedAt,
          };

          // Add description if it exists and is not too long
          if (workItem.description && typeof workItem.description === 'string') {
            simplified.description =
              workItem.description.length > 200
                ? workItem.description.substring(0, 200) + '...'
                : workItem.description;
          }

          // Extract essential widgets only
          if (workItem.widgets && Array.isArray(workItem.widgets)) {
            const essentialWidgets: SimplifiedWorkItem['widgets'] = [];

            for (const widget of workItem.widgets) {
              // Use type assertion to access widget properties dynamically
              const flexWidget = widget as unknown as FlexibleWorkItemWidget;

              switch (flexWidget.type) {
                case 'ASSIGNEES':
                  if (flexWidget.assignees?.nodes && flexWidget.assignees.nodes.length > 0) {
                    essentialWidgets.push({
                      type: 'ASSIGNEES',
                      assignees: flexWidget.assignees.nodes.map((assignee) => ({
                        id: assignee.id,
                        username: assignee.username,
                        name: assignee.name,
                      })),
                    });
                  }
                  break;
                case 'LABELS':
                  if (flexWidget.labels?.nodes && flexWidget.labels.nodes.length > 0) {
                    essentialWidgets.push({
                      type: 'LABELS',
                      labels: flexWidget.labels.nodes.map((label) => ({
                        id: label.id,
                        title: label.title,
                        color: label.color,
                      })),
                    });
                  }
                  break;
                case 'MILESTONE':
                  if (flexWidget.milestone) {
                    essentialWidgets.push({
                      type: 'MILESTONE',
                      milestone: {
                        id: flexWidget.milestone.id,
                        title: flexWidget.milestone.title,
                        state: flexWidget.milestone.state,
                      },
                    });
                  }
                  break;
                case 'HIERARCHY':
                  if (flexWidget.parent || flexWidget.hasChildren) {
                    essentialWidgets.push({
                      type: 'HIERARCHY',
                      parent: flexWidget.parent
                        ? {
                            id: flexWidget.parent.id,
                            iid: flexWidget.parent.iid,
                            title: flexWidget.parent.title,
                            workItemType: flexWidget.parent.workItemType,
                          }
                        : null,
                      hasChildren: flexWidget.hasChildren,
                    });
                  }
                  break;
              }
            }

            if (essentialWidgets && essentialWidgets.length > 0) {
              simplified.widgets = essentialWidgets;
            }
          }

          return simplified;
        };

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        console.log('Querying namespace:', namespacePath);

        // For list_work_items GraphQL query, use type names as-is (GraphQL expects enum values)
        // No conversion needed - the GraphQL API expects EPIC, ISSUE, TASK enum values, not GIDs
        let resolvedTypes: string[] | undefined = types;

        // Query the namespace (works for both groups and projects)
        const workItemsResponse = await client.request(GET_NAMESPACE_WORK_ITEMS, {
          namespacePath: namespacePath,
          types: resolvedTypes,
          first: first || 20,
          after: after,
        });

        // Extract work items and pagination info from namespace response
        const workItemsData = workItemsResponse.namespace?.workItems;
        const allItems = workItemsData?.nodes ?? [];
        const pageInfo = {
          hasNextPage: workItemsData?.pageInfo?.hasNextPage ?? false,
          endCursor: workItemsData?.pageInfo?.endCursor ?? null,
        };
        const namespaceType = workItemsResponse.namespace?.__typename ?? 'Unknown';

        console.log(`Found ${allItems.length} work items from ${namespaceType} query`);

        // Apply state filtering (client-side since GitLab API doesn't support it reliably)
        const filteredItems = allItems.filter((item: GraphQLWorkItem) => {
          return state.includes(item.state as 'OPEN' | 'CLOSED');
        });

        console.log(
          `State filtering: ${allItems.length} → ${filteredItems.length} items (keeping: ${state.join(', ')})`,
        );

        // Apply simplification if requested and clean GIDs
        const finalResults = filteredItems.map((item: GraphQLWorkItem) => {
          const cleanedItem = cleanWorkItemResponse(item as unknown as GitLabWorkItem);
          return simplifyWorkItem(cleanedItem as GraphQLWorkItem);
        });

        console.log('Final result - total work items found:', finalResults.length);
        if (simple) {
          console.log('Using simplified structure for agent consumption');
        }

        // Return object with items and server-side pagination info
        return {
          items: finalResults,
          hasMore: pageInfo.hasNextPage ?? false,
          endCursor: pageInfo.endCursor ?? null,
        };
      },
    },
  ],
  [
    'get_work_item',
    {
      name: 'get_work_item',
      description:
        'Get detailed information about a specific work item by ID. Returns complete work item data including assignees, labels, milestones, and other metadata.',
      inputSchema: zodToJsonSchema(GetWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = GetWorkItemSchema.parse(args);
        const { id } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // Convert simple ID to GID for API call
        const workItemGid = toGid(id, 'WorkItem');

        // Use GraphQL query for getting work item details
        const response = await client.request(GET_WORK_ITEM, { id: workItemGid });

        if (!response.workItem) {
          throw new Error(`Work item with ID "${id}" not found`);
        }

        return cleanWorkItemResponse(response.workItem as unknown as GitLabWorkItem);
      },
    },
  ],
  // Write tools
  [
    'create_work_item',
    {
      name: 'create_work_item',
      description:
        'Create a new work item in the specified namespace. Automatically resolves work item type ID from the provided type name. Supports creating epics, issues, tasks, and other work item types.',
      inputSchema: zodToJsonSchema(CreateWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = CreateWorkItemSchema.parse(args);
        const { namespacePath, title, workItemType, description } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // Convert simple type name to work item type GID
        const workItemTypes = await getWorkItemTypes(namespacePath);
        const workItemTypeObj = workItemTypes.find(
          (t: WorkItemType) => t.name.toUpperCase() === workItemType.toUpperCase(),
        );

        if (!workItemTypeObj) {
          throw new Error(
            `Work item type "${workItemType}" not found in namespace "${namespacePath}". Available types: ${workItemTypes.map((t) => t.name).join(', ')}`,
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

        return cleanWorkItemResponse(response.workItemCreate.workItem as unknown as GitLabWorkItem);
      },
    },
  ],
  [
    'update_work_item',
    {
      name: 'update_work_item',
      description:
        'Update properties of an existing work item. Supports modifying title, description, assignees, labels, milestones, and state. Only specified fields will be changed.',
      inputSchema: zodToJsonSchema(UpdateWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = UpdateWorkItemSchema.parse(args);
        const { id, title, description, state, assigneeIds, labelIds, milestoneId } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // Convert simple ID to GID for API call
        const workItemGid = toGid(id, 'WorkItem');

        // Build dynamic input object based on provided values
        const input: WorkItemUpdateInput = { id: workItemGid };

        // Add basic properties if provided
        if (title !== undefined) input.title = title;
        if (state !== undefined) input.stateEvent = state;

        // Add widget objects only if data is provided
        if (description !== undefined) {
          input.descriptionWidget = { description };
        }

        if (assigneeIds !== undefined && assigneeIds.length > 0) {
          // Convert assignee IDs to GIDs
          input.assigneesWidget = { assigneeIds: toGids(assigneeIds, 'User') };
        }

        if (labelIds !== undefined && labelIds.length > 0) {
          // Convert label IDs to GIDs
          input.labelsWidget = { addLabelIds: toGids(labelIds, 'Label') };
        }

        if (milestoneId !== undefined) {
          // Convert milestone ID to GID
          input.milestoneWidget = { milestoneId: toGid(milestoneId, 'Milestone') };
        }

        // Use single GraphQL mutation with dynamic input
        const response = await client.request(UPDATE_WORK_ITEM, { input });

        if (response.workItemUpdate?.errors?.length && response.workItemUpdate.errors.length > 0) {
          throw new Error(`GitLab GraphQL errors: ${response.workItemUpdate.errors.join(', ')}`);
        }

        if (!response.workItemUpdate?.workItem) {
          throw new Error('Work item update failed - no work item returned');
        }

        return cleanWorkItemResponse(response.workItemUpdate.workItem as unknown as GitLabWorkItem);
      },
    },
  ],
  [
    'delete_work_item',
    {
      name: 'delete_work_item',
      description:
        'Permanently delete a work item. This action cannot be undone and will remove all associated data and references.',
      inputSchema: zodToJsonSchema(DeleteWorkItemSchema),
      handler: async (args: unknown): Promise<unknown> => {
        const options = DeleteWorkItemSchema.parse(args);
        const { id } = options;

        // Get GraphQL client from ConnectionManager
        const connectionManager = ConnectionManager.getInstance();
        const client = connectionManager.getClient();

        // Convert simple ID to GID for API call
        const workItemGid = toGid(id, 'WorkItem');

        // Use GraphQL mutation for deleting work item
        const response = await client.request(DELETE_WORK_ITEM, { id: workItemGid });

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
  return ['list_work_items', 'get_work_item'];
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
