import { ConnectionManager } from '../../services/ConnectionManager';
import { ListWorkItemsSchema, GetWorkItemSchema, GetWorkItemTypesSchema } from './schema-readonly';
import { CreateWorkItemSchema, UpdateWorkItemSchema, DeleteWorkItemSchema } from './schema';
import {
  GET_WORK_ITEMS,
  GET_WORK_ITEM,
  GET_WORK_ITEM_TYPES,
  CREATE_WORK_ITEM,
  UPDATE_WORK_ITEM,
  DELETE_WORK_ITEM,
} from '../../graphql/workItems';

/**
 * Handler for list_work_items tool - REAL GraphQL API call
 */
export async function handleListWorkItems(args: unknown): Promise<unknown> {
  const options = ListWorkItemsSchema.parse(args);
  const connectionManager = ConnectionManager.getInstance();
  const client = connectionManager.getClient();

  const variables = {
    groupPath: options.groupPath,
    first: options.first || 20,
    after: options.after,
    types: options.types,
  };

  const result = await client.request(GET_WORK_ITEMS, variables);
  return result;
}

/**
 * Handler for get_work_item tool - REAL GraphQL API call
 */
export async function handleGetWorkItem(args: unknown): Promise<unknown> {
  const options = GetWorkItemSchema.parse(args);
  const connectionManager = ConnectionManager.getInstance();
  const client = connectionManager.getClient();

  const variables = {
    id: options.id,
  };

  const result = await client.request(GET_WORK_ITEM, variables);
  return result;
}

/**
 * Handler for get_work_item_types tool - REAL GraphQL API call
 */
export async function handleGetWorkItemTypes(args: unknown): Promise<unknown> {
  const options = GetWorkItemTypesSchema.parse(args);
  const connectionManager = ConnectionManager.getInstance();
  const client = connectionManager.getClient();

  const variables = {
    namespacePath: options.groupPath,
  };

  const result = await client.request(GET_WORK_ITEM_TYPES, variables);
  return result;
}

/**
 * Handler for create_work_item tool - REAL GraphQL API call
 */
export async function handleCreateWorkItem(args: unknown): Promise<unknown> {
  const options = CreateWorkItemSchema.parse(args);
  const connectionManager = ConnectionManager.getInstance();
  const client = connectionManager.getClient();

  const variables = {
    namespacePath: options.groupPath,
    workItemTypeId: options.workItemType, // Note: Schema uses workItemType, GraphQL might use workItemTypeId
    title: options.title,
    description: options.description,
    assigneeIds: options.assigneeIds,
    labelIds: options.labelIds,
    milestoneId: options.milestoneId,
  };

  const result = await client.request(CREATE_WORK_ITEM, variables);
  return result;
}

/**
 * Handler for update_work_item tool - REAL GraphQL API call
 */
export async function handleUpdateWorkItem(args: unknown): Promise<unknown> {
  const options = UpdateWorkItemSchema.parse(args);
  const connectionManager = ConnectionManager.getInstance();
  const client = connectionManager.getClient();

  const variables = {
    id: options.id,
    title: options.title,
    state: options.state,
    description: options.description,
    assigneeIds: options.assigneeIds,
    labelIds: options.labelIds,
    milestoneId: options.milestoneId,
  };

  const result = await client.request(UPDATE_WORK_ITEM, variables);
  return result;
}

/**
 * Handler for delete_work_item tool - REAL GraphQL API call
 */
export async function handleDeleteWorkItem(args: unknown): Promise<unknown> {
  const options = DeleteWorkItemSchema.parse(args);
  const connectionManager = ConnectionManager.getInstance();
  const client = connectionManager.getClient();

  const variables = {
    id: options.id,
  };

  const result = await client.request(DELETE_WORK_ITEM, variables);
  return result;
}
