import { ConnectionManager } from '../services/ConnectionManager';
import { GET_PROJECT_OR_GROUP_WORK_ITEM_TYPES, GET_WORK_ITEM_TYPES } from '../graphql/workItems';
import { graphqlSupports } from '../entities/instance-version';

// Define interface for work item type objects
interface WorkItemType {
  id: string;
  name: string;
}

/**
 * Internal utility function to get work item types for a namespace
 * This is NOT exposed as a tool - it's for internal use only
 */
export async function getWorkItemTypes(namespace: string): Promise<WorkItemType[]> {
  // Get GraphQL client from ConnectionManager
  const connectionManager = ConnectionManager.getInstance();
  const client = connectionManager.getClient();

  if (graphqlSupports('Namespace', 'workItemTypes')) {
    const response = await client.request(GET_WORK_ITEM_TYPES, { namespacePath: namespace });
    return response.namespace?.workItemTypes?.nodes ?? [];
  }

  // Older instances expose work item types on the project or group only.
  const response = await client.request(GET_PROJECT_OR_GROUP_WORK_ITEM_TYPES, {
    namespacePath: namespace,
  });
  return (response.project ?? response.group)?.workItemTypes?.nodes ?? [];
}
