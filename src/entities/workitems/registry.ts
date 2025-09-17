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
        'List all work items (epics, issues, tasks) from a GitLab namespace. Use with group path to get all work items across the entire group hierarchy, or project path to get project-specific items. Supports filtering by work item types and pagination. Perfect for getting comprehensive overview of all work across teams and projects.',
      inputSchema: zodToJsonSchema(ListWorkItemsSchema),
      handler: async (args: unknown): Promise<unknown> => {
        console.log('🚀 list_work_items called with args:', JSON.stringify(args, null, 2));
        const options = ListWorkItemsSchema.parse(args);
        const { namespacePath, types, includeSubgroups, first, after, simple, active } = options;
        console.log('📋 Parsed options:', {
          namespacePath,
          types,
          includeSubgroups,
          first,
          after,
          simple,
          active,
        });

        // Types for work item structure
        interface WorkItemWidget {
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

        interface WorkItem {
          id: string;
          iid: string;
          title: string;
          state: string;
          workItemType: string;
          webUrl: string;
          createdAt: string;
          updatedAt: string;
          description?: string;
          widgets?: WorkItemWidget[];
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
        const simplifyWorkItem = (workItem: WorkItem): WorkItem | SimplifiedWorkItem => {
          if (!simple) return workItem;

          const simplified: SimplifiedWorkItem = {
            id: workItem.id,
            iid: workItem.iid,
            title: workItem.title,
            state: workItem.state,
            workItemType: workItem.workItemType,
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
              switch (widget.type) {
                case 'ASSIGNEES':
                  if (widget.assignees?.nodes && widget.assignees.nodes.length > 0) {
                    essentialWidgets.push({
                      type: 'ASSIGNEES',
                      assignees: widget.assignees.nodes.map((assignee) => ({
                        id: assignee.id,
                        username: assignee.username,
                        name: assignee.name,
                      })),
                    });
                  }
                  break;
                case 'LABELS':
                  if (widget.labels?.nodes && widget.labels.nodes.length > 0) {
                    essentialWidgets.push({
                      type: 'LABELS',
                      labels: widget.labels.nodes.map((label) => ({
                        id: label.id,
                        title: label.title,
                        color: label.color,
                      })),
                    });
                  }
                  break;
                case 'MILESTONE':
                  if (widget.milestone) {
                    essentialWidgets.push({
                      type: 'MILESTONE',
                      milestone: {
                        id: widget.milestone.id,
                        title: widget.milestone.title,
                        state: widget.milestone.state,
                      },
                    });
                  }
                  break;
                case 'HIERARCHY':
                  if (widget.parent || widget.hasChildren) {
                    essentialWidgets.push({
                      type: 'HIERARCHY',
                      parent: widget.parent
                        ? {
                            id: widget.parent.id,
                            iid: widget.parent.iid,
                            title: widget.parent.title,
                            workItemType: widget.parent.workItemType,
                          }
                        : null,
                      hasChildren: widget.hasChildren,
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

        const allWorkItems: unknown[] = [];

        // Strategy: Run GROUP and PROJECT queries in parallel for better performance
        // This is simpler and more reliable than trying to determine namespace type
        console.log('📋 Using unified strategy: try both group and project queries');

        // Define query functions for parallel execution
        const groupQuery = async () => {
          console.log('📋 Starting GROUP query for:', namespacePath);
          const groupWorkItems: unknown[] = [];

          // Get epics from group (if requested)
          if (!types || types.includes('EPIC')) {
            try {
              const epicResponse = await client.request(GET_WORK_ITEMS, {
                groupPath: namespacePath,
                types: ['EPIC'],
                first: first || 20,
                after: after,
              });
              const epics = epicResponse.group?.workItems?.nodes || [];
              console.log('📋 GROUP epics found:', epics.length);
              groupWorkItems.push(...epics);
            } catch (e) {
              console.log(
                '📋 GROUP epics query failed:',
                e instanceof Error ? e.message : String(e),
              );
            }
          }

          // Get projects in the group and fetch their work items
          if (
            !types ||
            types.some((t) => ['ISSUE', 'TASK', 'INCIDENT', 'TEST_CASE', 'REQUIREMENT'].includes(t))
          ) {
            try {
              const projectsResponse = await client.request(GET_GROUP_PROJECTS, {
                groupPath: namespacePath,
                includeSubgroups: includeSubgroups !== false,
              });
              const allProjects = projectsResponse.group?.projects?.nodes || [];
              // Filter out archived and deletion_scheduled projects if active=true
              const projects = active
                ? allProjects.filter(
                    (project) =>
                      !project.archived && !project.fullPath.includes('deletion_scheduled'),
                  )
                : allProjects;

              if (active) {
                console.log(
                  `📋 GROUP projects found: ${projects.length} active (${allProjects.length} total)`,
                );
              } else {
                console.log(`📋 GROUP projects found: ${projects.length} total`);
              }

              if (projects.length > 0) {
                const projectTypes = types?.filter((t) => t !== 'EPIC') ?? [
                  'ISSUE',
                  'TASK',
                  'INCIDENT',
                ];
                const projectLimit = first || 20;
                console.log(
                  `📋 Fetching from ${projects.length} projects with up to ${projectLimit} items each`,
                );

                const projectWorkItemPromises = projects.map(async (project, index) => {
                  try {
                    const projectResponse = await client.request(GET_PROJECT_WORK_ITEMS, {
                      projectPath: project.fullPath,
                      types: projectTypes,
                      first: projectLimit,
                      after: after,
                    });
                    const items = projectResponse.project?.workItems?.nodes || [];
                    if (index < 5 || items.length > 0) {
                      // Log first 5 projects or any with items
                      console.log(`📋 Project ${project.fullPath}: ${items.length} items`);
                    }
                    return items;
                  } catch (e) {
                    console.log(
                      `📋 Could not fetch work items from project ${project.fullPath}:`,
                      e instanceof Error ? e.message : String(e),
                    );
                    return [];
                  }
                });

                const projectWorkItems = await Promise.all(projectWorkItemPromises);
                const flattenedItems = projectWorkItems.flat();
                console.log('📋 GROUP recursive project items found:', flattenedItems.length);
                groupWorkItems.push(...flattenedItems);
              }
            } catch (e) {
              console.log(
                '📋 GROUP projects query failed:',
                e instanceof Error ? e.message : String(e),
              );
            }
          }

          return groupWorkItems;
        };

        const projectQuery = async () => {
          console.log('📋 Starting PROJECT query for:', namespacePath);
          try {
            const projectTypes = types?.filter((t) => t !== 'EPIC') ?? [
              'ISSUE',
              'TASK',
              'INCIDENT',
            ];
            const response = await client.request(GET_PROJECT_WORK_ITEMS, {
              projectPath: namespacePath,
              types: projectTypes,
              first: first || 20,
              after: after,
            });
            const projectWorkItems = response.project?.workItems?.nodes || [];
            console.log('📋 PROJECT items found:', projectWorkItems.length);
            return projectWorkItems;
          } catch (e) {
            console.log(
              "📋 PROJECT query failed (this is normal if it's a group):",
              e instanceof Error ? e.message : String(e),
            );
            return [];
          }
        };

        // Execute both queries in parallel
        const [groupWorkItems, projectWorkItems] = await Promise.all([
          groupQuery(),
          projectQuery(),
        ]);

        // Combine results
        allWorkItems.push(...groupWorkItems, ...projectWorkItems);

        // Apply simplification if requested - cast to WorkItem interface for type safety
        const finalResults = allWorkItems.map((item) => simplifyWorkItem(item as WorkItem));

        console.log('🎯 Final result - total work items found:', finalResults.length);
        if (simple) {
          console.log('📋 Using simplified structure for agent consumption');
        }
        return finalResults;
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
