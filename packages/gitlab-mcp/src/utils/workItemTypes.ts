import { ConnectionManager } from '../services/ConnectionManager';
import { getGitLabApiUrlFromContext } from '../oauth/token-context';
import {
  GET_PROJECT_OR_GROUP_WORK_ITEM_TYPES,
  GET_WORK_ITEM_TYPES,
  type WorkItemTypeNode,
} from '../graphql/workItems';
import { graphqlSupports } from '../entities/instance-version';

/**
 * Work item types of a namespace, or null when the namespace does not exist or is not
 * accessible. `withWidgets` also reads the widgets each type supports there.
 */
export async function getWorkItemTypes(
  namespace: string,
  { withWidgets = false }: { withWidgets?: boolean } = {},
): Promise<WorkItemTypeNode[] | null> {
  const client = ConnectionManager.getInstance().getClient(getGitLabApiUrlFromContext());
  const vars = { namespacePath: namespace, withWidgets };

  if (graphqlSupports('Namespace', 'workItemTypes')) {
    const { namespace: found } = await client.request(GET_WORK_ITEM_TYPES, vars);
    return found ? (found.workItemTypes?.nodes ?? []) : null;
  }

  // Older instances expose work item types on the project or group only.
  const response = await client.request(GET_PROJECT_OR_GROUP_WORK_ITEM_TYPES, vars);
  const found = response.project ?? response.group;
  return found ? (found.workItemTypes?.nodes ?? []) : null;
}
