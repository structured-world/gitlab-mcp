import * as z from "zod";
import { BrowseWorkItemsSchema } from "./schema-readonly";
import { ManageWorkItemSchema } from "./schema";
import { ToolRegistry, EnhancedToolDefinition } from "../../types";
import { ConnectionManager } from "../../services/ConnectionManager";
import { isActionDenied } from "../../config";
import { getWorkItemTypes } from "../../utils/workItemTypes";
import {
  cleanWorkItemResponse,
  toGid,
  toGids,
  type GitLabWorkItem,
} from "../../utils/idConversion";
import { WidgetAvailability } from "../../services/WidgetAvailability";
import {
  createVersionRestrictedError,
  normalizeTier,
  StructuredToolError,
} from "../../utils/error-handler";

// Define interface for work item type objects
interface WorkItemType {
  id: string;
  name: string;
}

import {
  CREATE_WORK_ITEM_WITH_WIDGETS,
  WorkItemCreateInput,
  GET_NAMESPACE_WORK_ITEMS,
  GET_WORK_ITEM,
  GET_WORK_ITEM_BY_IID,
  UPDATE_WORK_ITEM,
  DELETE_WORK_ITEM,
  TIMELOG_DELETE,
  WORK_ITEM_ADD_LINKED_ITEMS,
  WORK_ITEM_REMOVE_LINKED_ITEMS,
  WorkItemUpdateInput,
  WorkItem as GraphQLWorkItem,
} from "../../graphql/workItems";

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
  timeEstimate?: number;
  totalTimeSpent?: number;
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
    timeEstimate?: number;
    totalTimeSpent?: number;
  }>;
}

// Function to simplify work item structure for agent consumption
const simplifyWorkItem = (
  workItem: GraphQLWorkItem,
  simple: boolean
): GraphQLWorkItem | SimplifiedWorkItem => {
  if (!simple) return workItem;

  const simplified: SimplifiedWorkItem = {
    id: workItem.id,
    iid: workItem.iid,
    title: workItem.title,
    state: workItem.state,
    workItemType:
      typeof workItem.workItemType === "string"
        ? workItem.workItemType
        : workItem.workItemType?.name || "Unknown",
    webUrl: workItem.webUrl,
    createdAt: workItem.createdAt,
    updatedAt: workItem.updatedAt,
  };

  // Add description if it exists and is not too long
  if (workItem.description && typeof workItem.description === "string") {
    simplified.description =
      workItem.description.length > 200
        ? workItem.description.substring(0, 200) + "..."
        : workItem.description;
  }

  // Extract essential widgets only
  if (workItem.widgets && Array.isArray(workItem.widgets)) {
    const essentialWidgets: SimplifiedWorkItem["widgets"] = [];

    for (const widget of workItem.widgets) {
      // Use type assertion to access widget properties dynamically
      const flexWidget = widget as unknown as FlexibleWorkItemWidget;

      switch (flexWidget.type) {
        case "ASSIGNEES":
          if (flexWidget.assignees?.nodes && flexWidget.assignees.nodes.length > 0) {
            essentialWidgets.push({
              type: "ASSIGNEES",
              assignees: flexWidget.assignees.nodes.map(assignee => ({
                id: assignee.id,
                username: assignee.username,
                name: assignee.name,
              })),
            });
          }
          break;
        case "LABELS":
          if (flexWidget.labels?.nodes && flexWidget.labels.nodes.length > 0) {
            essentialWidgets.push({
              type: "LABELS",
              labels: flexWidget.labels.nodes.map(label => ({
                id: label.id,
                title: label.title,
                color: label.color,
              })),
            });
          }
          break;
        case "MILESTONE":
          if (flexWidget.milestone) {
            essentialWidgets.push({
              type: "MILESTONE",
              milestone: {
                id: flexWidget.milestone.id,
                title: flexWidget.milestone.title,
                state: flexWidget.milestone.state,
              },
            });
          }
          break;
        case "HIERARCHY":
          if (flexWidget.parent || flexWidget.hasChildren) {
            essentialWidgets.push({
              type: "HIERARCHY",
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
        case "TIME_TRACKING":
          if (flexWidget.timeEstimate !== undefined || flexWidget.totalTimeSpent !== undefined) {
            essentialWidgets.push({
              type: "TIME_TRACKING",
              timeEstimate: flexWidget.timeEstimate,
              totalTimeSpent: flexWidget.totalTimeSpent,
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

/**
 * Work items tools registry - 2 CQRS tools replacing 5 individual tools
 *
 * browse_work_items (Query): list, get
 * manage_work_item (Command): create, update, delete, delete_timelog, add_link, remove_link
 */
export const workitemsToolRegistry: ToolRegistry = new Map<string, EnhancedToolDefinition>([
  // ============================================================================
  // browse_work_items - CQRS Query Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "browse_work_items",
    {
      name: "browse_work_items",
      description:
        "Find and inspect issues, epics, tasks, and other work items. Actions: list (groups return epics, projects return issues/tasks, filter by type/state/labels), get (by numeric ID or namespace+iid from URL path). Related: manage_work_item to create/update/delete.",
      inputSchema: z.toJSONSchema(BrowseWorkItemsSchema),
      gate: { envVar: "USE_WORKITEMS", defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = BrowseWorkItemsSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("browse_work_items", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for browse_work_items tool`);
        }

        switch (input.action) {
          case "list": {
            // TypeScript knows: input has namespace (required), types, state, first, after, simple (optional)
            const { namespace, types, state, first, after, simple } = input;
            const namespacePath = namespace;

            // Get GraphQL client from ConnectionManager
            const connectionManager = ConnectionManager.getInstance();
            const client = connectionManager.getClient();

            // For the work items GraphQL query, use type names as-is (GraphQL expects enum values)
            const resolvedTypes: string[] | undefined = types;

            // Query the namespace (works for both groups and projects)
            const workItemsResponse = await client.request(GET_NAMESPACE_WORK_ITEMS, {
              namespacePath,
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
            const namespaceType = workItemsResponse.namespace?.__typename ?? "Unknown";

            // Apply state filtering (client-side since GitLab API doesn't support it reliably)
            const filteredItems = allItems.filter((item: GraphQLWorkItem) => {
              return state.includes(item.state as "OPEN" | "CLOSED");
            });

            // Apply simplification if requested and clean GIDs
            const finalResults = filteredItems.map((item: GraphQLWorkItem) => {
              const cleanedItem = cleanWorkItemResponse(item as unknown as GitLabWorkItem);
              return simplifyWorkItem(cleanedItem as GraphQLWorkItem, simple);
            });

            // Return object with items and server-side pagination info
            return {
              items: finalResults,
              hasMore: pageInfo.hasNextPage ?? false,
              endCursor: pageInfo.endCursor ?? null,
            };
          }

          case "get": {
            // TypeScript knows: input has either (namespace + iid) or (id)
            const { namespace, iid, id } = input;

            // Get GraphQL client from ConnectionManager
            const connectionManager = ConnectionManager.getInstance();
            const client = connectionManager.getClient();

            // Route to appropriate query based on input
            if (namespace !== undefined && iid !== undefined) {
              // Lookup by namespace + IID (preferred for URL-based requests)
              const response = await client.request(GET_WORK_ITEM_BY_IID, {
                namespacePath: namespace,
                iid: iid,
              });

              if (!response.namespace?.workItem) {
                throw new Error(
                  `Work item with IID "${iid}" not found in namespace "${namespace}"`
                );
              }

              return cleanWorkItemResponse(
                response.namespace.workItem as unknown as GitLabWorkItem
              );
            } else if (id !== undefined) {
              // Lookup by global ID (backward compatible)
              // Convert simple ID to GID for API call
              const workItemGid = toGid(id, "WorkItem");

              // Use GraphQL query for getting work item details
              const response = await client.request(GET_WORK_ITEM, { id: workItemGid });

              if (!response.workItem) {
                throw new Error(`Work item with ID "${id}" not found`);
              }

              return cleanWorkItemResponse(response.workItem as unknown as GitLabWorkItem);
            } else {
              // This should never happen due to schema validation
              throw new Error(
                "Either 'id' (global ID) or both 'namespace' and 'iid' (from URL) must be provided"
              );
            }
          }

          /* istanbul ignore next -- unreachable with Zod discriminatedUnion */
          default:
            throw new Error(`Unknown action: ${(input as { action: string }).action}`);
        }
      },
    },
  ],

  // ============================================================================
  // manage_work_item - CQRS Command Tool (discriminated union schema)
  // TypeScript automatically narrows types in each switch case
  // ============================================================================
  [
    "manage_work_item",
    {
      name: "manage_work_item",
      description:
        "Create, update, delete, or link work items (issues, epics, tasks). Actions: create (epics need GROUP namespace, issues/tasks need PROJECT), update (widgets: dates, time tracking, weight, iterations, health, progress, hierarchy), delete (permanent), delete_timelog (remove a time tracking entry by its global ID), add_link/remove_link (BLOCKS/BLOCKED_BY/RELATED). Related: browse_work_items for discovery.",
      inputSchema: z.toJSONSchema(ManageWorkItemSchema),
      gate: { envVar: "USE_WORKITEMS", defaultValue: true },
      handler: async (args: unknown): Promise<unknown> => {
        const input = ManageWorkItemSchema.parse(args);

        // Runtime validation: reject denied actions even if they bypass schema filtering
        if (isActionDenied("manage_work_item", input.action)) {
          throw new Error(`Action '${input.action}' is not allowed for manage_work_item tool`);
        }

        switch (input.action) {
          case "create": {
            const {
              namespace,
              title,
              workItemType,
              description,
              assigneeIds,
              labelIds,
              milestoneId,
              startDate,
              dueDate,
              parentId,
              childrenIds,
              timeEstimate,
              isFixed,
              weight,
              iterationId,
              progressCurrentValue,
              healthStatus,
              color,
            } = input;
            const namespacePath = namespace;
            const workItemTitle = title;
            const workItemTypeName = workItemType;

            // Validate widget parameters against instance version/tier.
            const widgetParams: Record<string, unknown> = {
              description,
              milestoneId,
              startDate,
              dueDate,
              parentId,
              childrenIds,
              timeEstimate,
              isFixed,
              weight,
              iterationId,
              progressCurrentValue,
              healthStatus,
              color,
            };
            if (assigneeIds && assigneeIds.length > 0) {
              widgetParams.assigneeIds = assigneeIds;
            }
            if (labelIds && labelIds.length > 0) {
              widgetParams.labelIds = labelIds;
            }
            const validationFailure = WidgetAvailability.validateWidgetParams(widgetParams);
            if (validationFailure) {
              throw new StructuredToolError(
                createVersionRestrictedError(
                  "manage_work_item",
                  "create",
                  validationFailure.widget,
                  validationFailure.parameter,
                  validationFailure.requiredVersion,
                  validationFailure.detectedVersion,
                  normalizeTier(validationFailure.requiredTier),
                  normalizeTier(validationFailure.currentTier)
                )
              );
            }

            // Get GraphQL client from ConnectionManager
            const connectionManager = ConnectionManager.getInstance();
            const client = connectionManager.getClient();

            // Convert simple type name to work item type GID
            const workItemTypes = await getWorkItemTypes(namespacePath);
            const workItemTypeObj = workItemTypes.find(
              (t: WorkItemType) =>
                t.name.toUpperCase().replace(/\s+/g, "_") ===
                workItemTypeName.toUpperCase().replace(/\s+/g, "_")
            );

            if (!workItemTypeObj) {
              throw new Error(
                `Work item type "${workItemTypeName}" not found in namespace "${namespacePath}". Available types: ${workItemTypes.map(t => t.name).join(", ")}`
              );
            }

            // Build input with widgets support for GitLab 18.3 API
            const createInput: WorkItemCreateInput = {
              namespacePath,
              title: workItemTitle,
              workItemTypeId: workItemTypeObj.id,
            };

            // Add optional description
            if (description !== undefined) {
              createInput.description = description;
            }

            // Add widgets only if data is provided
            if (assigneeIds !== undefined && assigneeIds.length > 0) {
              createInput.assigneesWidget = { assigneeIds: toGids(assigneeIds, "User") };
            }

            if (labelIds !== undefined && labelIds.length > 0) {
              createInput.labelsWidget = { labelIds: toGids(labelIds, "Label") };
            }

            if (milestoneId !== undefined) {
              createInput.milestoneWidget = { milestoneId: toGid(milestoneId, "Milestone") };
            }

            // Start and due date widget
            if (startDate !== undefined || dueDate !== undefined || isFixed !== undefined) {
              createInput.startAndDueDateWidget = {};
              if (startDate !== undefined) createInput.startAndDueDateWidget.startDate = startDate;
              if (dueDate !== undefined) createInput.startAndDueDateWidget.dueDate = dueDate;
              if (isFixed !== undefined) createInput.startAndDueDateWidget.isFixed = isFixed;
            }

            // Hierarchy widget
            if (parentId !== undefined || (childrenIds !== undefined && childrenIds.length > 0)) {
              createInput.hierarchyWidget = {};
              if (parentId !== undefined) {
                createInput.hierarchyWidget.parentId = toGid(parentId, "WorkItem");
              }
              if (childrenIds !== undefined && childrenIds.length > 0) {
                createInput.hierarchyWidget.childrenIds = toGids(childrenIds, "WorkItem");
              }
            }

            // NOTE: timeTrackingWidget is NOT supported on WorkItemCreateInput by GitLab API
            // Time estimate will be applied via a follow-up update call after creation
            // See: https://gitlab.com/gitlab-org/gitlab/-/merge_requests/143507

            // Weight widget (Premium)
            if (weight !== undefined) {
              createInput.weightWidget = { weight };
            }

            // Iteration widget (Premium)
            if (iterationId !== undefined) {
              createInput.iterationWidget = {
                iterationId: toGid(iterationId, "Iteration"),
              };
            }

            // Health status widget (Ultimate)
            if (healthStatus !== undefined) {
              createInput.healthStatusWidget = { healthStatus };
            }

            // Progress widget (Premium, OKR)
            if (progressCurrentValue !== undefined) {
              createInput.progressWidget = { currentValue: progressCurrentValue };
            }

            // Color widget (Ultimate, epics)
            if (color !== undefined) {
              createInput.colorWidget = { color };
            }

            // Use comprehensive mutation with widgets support
            const response = await client.request(CREATE_WORK_ITEM_WITH_WIDGETS, {
              input: createInput,
            });

            if (
              response.workItemCreate?.errors?.length &&
              response.workItemCreate.errors.length > 0
            ) {
              throw new Error(
                `GitLab GraphQL errors: ${response.workItemCreate.errors.join(", ")}`
              );
            }

            if (!response.workItemCreate?.workItem) {
              throw new Error("Work item creation failed - no work item returned");
            }

            const createdWorkItem = response.workItemCreate.workItem;

            // Step 2: Apply timeEstimate via update if requested
            // GitLab API does NOT support timeTrackingWidget on WorkItemCreateInput
            // so we must apply it via a follow-up update call
            if (timeEstimate !== undefined) {
              try {
                const updateInput: WorkItemUpdateInput = {
                  id: createdWorkItem.id,
                  timeTrackingWidget: { timeEstimate },
                };

                const updateResponse = await client.request(UPDATE_WORK_ITEM, {
                  input: updateInput,
                });

                if (
                  updateResponse.workItemUpdate?.errors?.length &&
                  updateResponse.workItemUpdate.errors.length > 0
                ) {
                  // Update failed - return create result with warning
                  const cleanedResult = cleanWorkItemResponse(
                    createdWorkItem as unknown as GitLabWorkItem
                  );
                  return {
                    ...cleanedResult,
                    _warning: {
                      message:
                        "Work item created successfully, but some properties could not be applied",
                      failedProperties: {
                        timeEstimate: {
                          requestedValue: timeEstimate,
                          error: updateResponse.workItemUpdate.errors.join(", "),
                        },
                      },
                    },
                  };
                }

                if (updateResponse.workItemUpdate?.workItem) {
                  // Return updated work item with time estimate applied
                  return cleanWorkItemResponse(
                    updateResponse.workItemUpdate.workItem as unknown as GitLabWorkItem
                  );
                }

                // Update returned no work item but also no errors - return create result with warning
                const cleanedResult = cleanWorkItemResponse(
                  createdWorkItem as unknown as GitLabWorkItem
                );
                return {
                  ...cleanedResult,
                  _warning: {
                    message:
                      "Work item created successfully, but some properties could not be applied",
                    failedProperties: {
                      timeEstimate: {
                        requestedValue: timeEstimate,
                        error: "Time estimate update returned no work item",
                      },
                    },
                  },
                };
              } catch (updateError) {
                // Update failed with exception - return create result with warning
                const cleanedResult = cleanWorkItemResponse(
                  createdWorkItem as unknown as GitLabWorkItem
                );
                return {
                  ...cleanedResult,
                  _warning: {
                    message:
                      "Work item created successfully, but some properties could not be applied",
                    failedProperties: {
                      timeEstimate: {
                        requestedValue: timeEstimate,
                        error:
                          updateError instanceof Error
                            ? updateError.message
                            : "Unknown error applying time estimate",
                      },
                    },
                  },
                };
              }
            }

            return cleanWorkItemResponse(createdWorkItem as unknown as GitLabWorkItem);
          }

          case "update": {
            const {
              id,
              title,
              description,
              state,
              assigneeIds,
              labelIds,
              addLabelIds,
              removeLabelIds,
              milestoneId,
              startDate,
              dueDate,
              parentId,
              childrenIds,
              timeEstimate,
              timeSpent,
              timeSpentAt,
              timeSpentSummary,
              isFixed,
              weight,
              iterationId,
              progressCurrentValue,
              healthStatus,
              color,
              linkType,
              targetId,
            } = input;
            const workItemId = id;

            // Validate linked items params: both must be provided together
            if ((linkType !== undefined) !== (targetId !== undefined)) {
              throw new Error(
                "Both linkType and targetId must be provided together to create a linked item relationship"
              );
            }

            // Validate label params: labelIds cannot be used with addLabelIds/removeLabelIds
            if (
              labelIds !== undefined &&
              (addLabelIds !== undefined || removeLabelIds !== undefined)
            ) {
              throw new Error(
                "labelIds (replace all) cannot be used together with addLabelIds or removeLabelIds. " +
                  "Use labelIds to set exact labels, or use addLabelIds/removeLabelIds for incremental changes."
              );
            }

            // Validate widget parameters against instance version/tier.
            // For labels, any of labelIds/addLabelIds/removeLabelIds triggers LABELS widget validation
            const widgetParams: Record<string, unknown> = {
              description,
              assigneeIds,
              labelIds,
              addLabelIds,
              removeLabelIds,
              milestoneId,
              startDate,
              dueDate,
              parentId,
              childrenIds,
              timeEstimate,
              timeSpent,
              isFixed,
              weight,
              iterationId,
              progressCurrentValue,
              healthStatus,
              color,
              linkType,
              targetId,
            };
            const validationFailure = WidgetAvailability.validateWidgetParams(widgetParams);
            if (validationFailure) {
              throw new StructuredToolError(
                createVersionRestrictedError(
                  "manage_work_item",
                  "update",
                  validationFailure.widget,
                  validationFailure.parameter,
                  validationFailure.requiredVersion,
                  validationFailure.detectedVersion,
                  normalizeTier(validationFailure.requiredTier),
                  normalizeTier(validationFailure.currentTier)
                )
              );
            }

            // Get GraphQL client from ConnectionManager
            const connectionManager = ConnectionManager.getInstance();
            const client = connectionManager.getClient();

            // Convert simple ID to GID for API call
            const workItemGid = toGid(workItemId, "WorkItem");

            // Build dynamic input object based on provided values
            const updateInput: WorkItemUpdateInput = { id: workItemGid };

            // Add basic properties if provided
            if (title !== undefined) updateInput.title = title;
            if (state !== undefined) updateInput.stateEvent = state;

            // Add widget objects only if data is provided
            if (description !== undefined) {
              updateInput.descriptionWidget = { description };
            }

            if (assigneeIds !== undefined) {
              updateInput.assigneesWidget = { assigneeIds: toGids(assigneeIds, "User") };
            }

            // Labels widget: labelIds replaces all, addLabelIds/removeLabelIds are incremental
            // Note: labelIds and addLabelIds/removeLabelIds are mutually exclusive (validated above)
            // GitLab API does NOT support labelIds directly - only addLabelIds/removeLabelIds
            // For replace mode, we calculate diff to avoid conflicts
            if (labelIds !== undefined) {
              // Replace mode: calculate diff between current and desired state
              // First, fetch current labels from the work item
              const currentWorkItem = await client.request(GET_WORK_ITEM, { id: workItemGid });
              const currentLabels =
                (
                  (currentWorkItem.workItem?.widgets as Array<{
                    type: string;
                    labels?: { nodes?: Array<{ id: string }> };
                  }>) || []
                )
                  .find(w => w.type === "LABELS")
                  ?.labels?.nodes?.map(l => l.id) ?? [];

              const newLabelGids = toGids(labelIds, "Label");

              // Calculate diff: remove only labels NOT in new set, add only labels NOT in current set
              // This ensures no label appears in both removeLabelIds and addLabelIds
              const labelsToRemove = currentLabels.filter(id => !newLabelGids.includes(id));
              const labelsToAdd = newLabelGids.filter(id => !currentLabels.includes(id));

              // Build labelsWidget with calculated diff only if changes are needed
              if (labelsToRemove.length > 0 || labelsToAdd.length > 0) {
                updateInput.labelsWidget = {};
                if (labelsToRemove.length > 0) {
                  updateInput.labelsWidget.removeLabelIds = labelsToRemove;
                }
                if (labelsToAdd.length > 0) {
                  updateInput.labelsWidget.addLabelIds = labelsToAdd;
                }
              }
            } else if (addLabelIds !== undefined || removeLabelIds !== undefined) {
              // Incremental mode: add and/or remove labels
              updateInput.labelsWidget = {};
              if (addLabelIds !== undefined && addLabelIds.length > 0) {
                updateInput.labelsWidget.addLabelIds = toGids(addLabelIds, "Label");
              }
              if (removeLabelIds !== undefined && removeLabelIds.length > 0) {
                updateInput.labelsWidget.removeLabelIds = toGids(removeLabelIds, "Label");
              }
            }

            // VALIDATION: Ensure no label appears in both add and remove lists
            // This catches both user errors (incremental mode) and logic bugs (replace mode)
            if (updateInput.labelsWidget?.addLabelIds && updateInput.labelsWidget?.removeLabelIds) {
              const addSet = new Set(updateInput.labelsWidget.addLabelIds);
              const removeSet = new Set(updateInput.labelsWidget.removeLabelIds);
              const intersection = [...addSet].filter(id => removeSet.has(id));

              if (intersection.length > 0) {
                throw new Error(
                  `Invalid label operation: cannot add and remove the same labels simultaneously: ${intersection.join(", ")}`
                );
              }
            }

            if (milestoneId !== undefined) {
              updateInput.milestoneWidget = { milestoneId: toGid(milestoneId, "Milestone") };
            }

            // Start and due date widget
            if (startDate !== undefined || dueDate !== undefined || isFixed !== undefined) {
              updateInput.startAndDueDateWidget = {};
              if (startDate !== undefined) updateInput.startAndDueDateWidget.startDate = startDate;
              if (dueDate !== undefined) updateInput.startAndDueDateWidget.dueDate = dueDate;
              if (isFixed !== undefined) updateInput.startAndDueDateWidget.isFixed = isFixed;
            }

            // Hierarchy widget
            if (parentId !== undefined || (childrenIds !== undefined && childrenIds.length > 0)) {
              updateInput.hierarchyWidget = {};
              if (parentId !== undefined) {
                // null means unlink parent, string means set parent
                updateInput.hierarchyWidget.parentId =
                  parentId === null ? null : toGid(parentId, "WorkItem");
              }
              if (childrenIds !== undefined && childrenIds.length > 0) {
                updateInput.hierarchyWidget.childrenIds = toGids(childrenIds, "WorkItem");
              }
            }

            // Validate timelog-related params require timeSpent
            if (
              (timeSpentAt !== undefined || timeSpentSummary !== undefined) &&
              timeSpent === undefined
            ) {
              throw new Error(
                "timeSpentAt and timeSpentSummary require timeSpent to be specified (they are timelog entry properties)"
              );
            }

            // Time tracking widget
            if (timeEstimate !== undefined || timeSpent !== undefined) {
              updateInput.timeTrackingWidget = {};
              if (timeEstimate !== undefined) {
                updateInput.timeTrackingWidget.timeEstimate = timeEstimate;
              }
              if (timeSpent !== undefined) {
                updateInput.timeTrackingWidget.timelog = {
                  timeSpent,
                  ...(timeSpentAt !== undefined && { spentAt: timeSpentAt }),
                  ...(timeSpentSummary !== undefined && { summary: timeSpentSummary }),
                };
              }
            }

            // Weight widget (Premium)
            if (weight !== undefined) {
              updateInput.weightWidget = { weight };
            }

            // Iteration widget (Premium)
            if (iterationId !== undefined) {
              updateInput.iterationWidget = {
                iterationId: iterationId === null ? null : toGid(iterationId, "Iteration"),
              };
            }

            // Health status widget (Ultimate)
            if (healthStatus !== undefined) {
              updateInput.healthStatusWidget = { healthStatus };
            }

            // Progress widget (Premium, OKR)
            if (progressCurrentValue !== undefined) {
              updateInput.progressWidget = { currentValue: progressCurrentValue };
            }

            // Color widget (Ultimate, epics)
            if (color !== undefined) {
              updateInput.colorWidget = { color };
            }

            // Use single GraphQL mutation with dynamic input
            const response = await client.request(UPDATE_WORK_ITEM, { input: updateInput });

            if (
              response.workItemUpdate?.errors?.length &&
              response.workItemUpdate.errors.length > 0
            ) {
              throw new Error(
                `GitLab GraphQL errors: ${response.workItemUpdate.errors.join(", ")}`
              );
            }

            if (!response.workItemUpdate?.workItem) {
              throw new Error("Work item update failed - no work item returned");
            }

            const updatedWorkItem = response.workItemUpdate.workItem;

            // Step 2: Apply linked items via follow-up mutation if requested
            // GitLab API does NOT support linkedItemsWidget on WorkItemUpdateInput
            // so we must apply it via a separate workItemAddLinkedItems mutation
            if (linkType !== undefined && targetId !== undefined) {
              try {
                const linkResponse = await client.request(WORK_ITEM_ADD_LINKED_ITEMS, {
                  input: {
                    id: workItemGid,
                    workItemsIds: [toGid(targetId, "WorkItem")],
                    linkType,
                  },
                });

                if (
                  linkResponse.workItemAddLinkedItems?.errors?.length &&
                  linkResponse.workItemAddLinkedItems.errors.length > 0
                ) {
                  // Link failed - return update result with warning
                  const cleanedResult = cleanWorkItemResponse(
                    updatedWorkItem as unknown as GitLabWorkItem
                  );
                  return {
                    ...cleanedResult,
                    _warning: {
                      message: "Work item updated successfully, but linked item could not be added",
                      failedProperties: {
                        linkedItem: {
                          targetId,
                          linkType,
                          error: linkResponse.workItemAddLinkedItems.errors.join(", "),
                        },
                      },
                    },
                  };
                }

                if (linkResponse.workItemAddLinkedItems?.workItem) {
                  // Return work item with linked items applied
                  return cleanWorkItemResponse(
                    linkResponse.workItemAddLinkedItems.workItem as unknown as GitLabWorkItem
                  );
                }

                // Link returned no work item but also no errors - return update result with warning
                const cleanedResult = cleanWorkItemResponse(
                  updatedWorkItem as unknown as GitLabWorkItem
                );
                return {
                  ...cleanedResult,
                  _warning: {
                    message: "Work item updated successfully, but linked item could not be added",
                    failedProperties: {
                      linkedItem: {
                        targetId,
                        linkType,
                        error: "Add linked item returned no work item",
                      },
                    },
                  },
                };
              } catch (linkError) {
                // Link failed with exception - return update result with warning
                const cleanedResult = cleanWorkItemResponse(
                  updatedWorkItem as unknown as GitLabWorkItem
                );
                return {
                  ...cleanedResult,
                  _warning: {
                    message: "Work item updated successfully, but linked item could not be added",
                    failedProperties: {
                      linkedItem: {
                        targetId,
                        linkType,
                        error:
                          linkError instanceof Error
                            ? linkError.message
                            : "Unknown error adding linked item",
                      },
                    },
                  },
                };
              }
            }

            return cleanWorkItemResponse(updatedWorkItem as unknown as GitLabWorkItem);
          }

          case "delete": {
            const workItemId = input.id;

            // Get GraphQL client from ConnectionManager
            const connectionManager = ConnectionManager.getInstance();
            const client = connectionManager.getClient();

            // Convert simple ID to GID for API call
            const workItemGid = toGid(workItemId, "WorkItem");

            // Use GraphQL mutation for deleting work item
            const response = await client.request(DELETE_WORK_ITEM, { id: workItemGid });

            if (
              response.workItemDelete?.errors?.length &&
              response.workItemDelete.errors.length > 0
            ) {
              throw new Error(
                `GitLab GraphQL errors: ${response.workItemDelete.errors.join(", ")}`
              );
            }

            // Return success indicator for deletion
            return { deleted: true };
          }

          case "delete_timelog": {
            const { timelogId } = input;

            const connectionManager = ConnectionManager.getInstance();
            const client = connectionManager.getClient();

            // Ensure the timelog ID is a valid GID
            const timelogGid = toGid(timelogId, "Timelog");

            const response = await client.request(TIMELOG_DELETE, { id: timelogGid });

            if (
              response.timelogDelete?.errors?.length &&
              response.timelogDelete.errors.length > 0
            ) {
              throw new Error(`GitLab GraphQL errors: ${response.timelogDelete.errors.join(", ")}`);
            }

            return {
              deleted: true,
              timelog: response.timelogDelete?.timelog ?? null,
            };
          }

          case "add_link": {
            const { id, targetId, linkType } = input;

            const connectionManager = ConnectionManager.getInstance();
            const client = connectionManager.getClient();

            const response = await client.request(WORK_ITEM_ADD_LINKED_ITEMS, {
              input: {
                id: toGid(id, "WorkItem"),
                workItemsIds: [toGid(targetId, "WorkItem")],
                linkType,
              },
            });

            if (
              response.workItemAddLinkedItems?.errors?.length &&
              response.workItemAddLinkedItems.errors.length > 0
            ) {
              throw new Error(
                `GitLab GraphQL errors: ${response.workItemAddLinkedItems.errors.join(", ")}`
              );
            }

            if (!response.workItemAddLinkedItems?.workItem) {
              throw new Error("Add linked item failed - no work item returned");
            }

            return cleanWorkItemResponse(
              response.workItemAddLinkedItems.workItem as unknown as GitLabWorkItem
            );
          }

          case "remove_link": {
            const { id, targetId } = input;

            const connectionManager = ConnectionManager.getInstance();
            const client = connectionManager.getClient();

            // Note: GitLab API does NOT accept linkType for remove operation
            // Links are identified by source+target IDs only
            const response = await client.request(WORK_ITEM_REMOVE_LINKED_ITEMS, {
              input: {
                id: toGid(id, "WorkItem"),
                workItemsIds: [toGid(targetId, "WorkItem")],
              },
            });

            if (
              response.workItemRemoveLinkedItems?.errors?.length &&
              response.workItemRemoveLinkedItems.errors.length > 0
            ) {
              throw new Error(
                `GitLab GraphQL errors: ${response.workItemRemoveLinkedItems.errors.join(", ")}`
              );
            }

            if (!response.workItemRemoveLinkedItems?.workItem) {
              throw new Error("Remove linked item failed - no work item returned");
            }

            return cleanWorkItemResponse(
              response.workItemRemoveLinkedItems.workItem as unknown as GitLabWorkItem
            );
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
export function getWorkitemsReadOnlyToolNames(): string[] {
  return ["browse_work_items"];
}

/**
 * Get all tool definitions from the registry
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
    return Array.from(workitemsToolRegistry.values()).filter(tool =>
      readOnlyNames.includes(tool.name)
    );
  }
  return getWorkitemsToolDefinitions();
}
