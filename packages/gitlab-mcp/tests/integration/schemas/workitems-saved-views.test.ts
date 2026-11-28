/**
 * Saved work item views against a real GitLab: listing a namespace's views and reading
 * one with its items. The views are created here through GitLab's own mutation, since
 * the tools only read them. GitLab stores enum filters by internal value (`issue`), so
 * reading a view with a type filter also proves they are sent under their names.
 */

import { gql } from 'graphql-tag';
import { ConnectionManager } from '../../../src/services/ConnectionManager';
import { getTestData } from '../../setup/testConfig';
import { IntegrationTestHelper } from '../helpers/registry-helper';

interface ListedItem {
  id: string;
  iid: string;
  title: string;
}

interface ViewSummary {
  id: string;
  name: string;
  isPrivate: boolean;
  sort: string | null;
}

interface ViewRead {
  view: ViewSummary & { filters: Record<string, unknown> };
  items: ListedItem[];
  hasMore: boolean;
  endCursor: string | null;
  exact: boolean;
  unappliedFilters?: string[];
  note?: string;
}

const CREATE_VIEW = gql`
  mutation CreateSavedView($input: WorkItemSavedViewCreateInput!) {
    workItemSavedViewCreate(input: $input) {
      savedView {
        id
      }
      errors
    }
  }
`;

const DELETE_VIEW = gql`
  mutation DeleteSavedView($input: WorkItemSavedViewDeleteInput!) {
    workItemSavedViewDelete(input: $input) {
      errors
    }
  }
`;

describe('browse_work_items saved views', () => {
  let helper: IntegrationTestHelper;
  // Unique per run, so only this run's items and views match.
  const token = `wiview${Date.now()}`;
  const createdItems: string[] = [];
  const createdViews: string[] = [];
  let projectPath: string;
  let groupPath: string;
  let labelName: string | undefined;
  let alpha: ListedItem;
  let beta: ListedItem;
  let labelledViewId: string | undefined;
  let typedViewId: string;
  let privateViewId: string;

  const browse = (args: Record<string, unknown>) => helper.executeTool('browse_work_items', args);

  const createItem = async (args: Record<string, unknown>): Promise<ListedItem> => {
    const item = (await helper.executeTool('manage_work_item', {
      action: 'create',
      ...args,
    })) as ListedItem;
    createdItems.push(item.id);
    return item;
  };

  const createView = async (input: Record<string, unknown>): Promise<string> => {
    const client = ConnectionManager.getInstance().getClient();
    const result = await client.request<{
      workItemSavedViewCreate: { savedView: { id: string } | null; errors: string[] };
    }>(CREATE_VIEW, { input: { displaySettings: {}, ...input } });
    const created = result.workItemSavedViewCreate;
    if (!created.savedView) throw new Error(`Saved view not created: ${created.errors.join(', ')}`);
    createdViews.push(created.savedView.id);
    return created.savedView.id.split('/').pop()!;
  };

  beforeAll(async () => {
    helper = new IntegrationTestHelper();
    await helper.initialize();

    const testData = getTestData();
    projectPath = testData.project!.path_with_namespace;
    groupPath = testData.group!.full_path;
    labelName = testData.labels?.[0]?.name;
    const labelId = testData.labels?.[0]?.id?.toString();

    alpha = await createItem({
      namespace: projectPath,
      title: `${token} alpha`,
      workItemType: 'ISSUE',
      ...(labelId && { labelIds: [labelId] }),
    });
    beta = await createItem({
      namespace: projectPath,
      title: `${token} beta`,
      workItemType: 'ISSUE',
    });

    if (labelName) {
      labelledViewId = await createView({
        namespacePath: projectPath,
        name: `${token} labelled`,
        filters: { search: token, labelName: [labelName] },
        sort: 'TITLE_ASC',
        isPrivate: false,
      });
    }
    typedViewId = await createView({
      namespacePath: projectPath,
      name: `${token} typed`,
      description: 'Issues of this run',
      filters: { search: token, types: ['ISSUE'] },
      sort: 'TITLE_ASC',
      isPrivate: false,
    });
    privateViewId = await createView({
      namespacePath: projectPath,
      name: `${token} private`,
      filters: { search: token },
      sort: 'CREATED_DESC',
      isPrivate: true,
    });
  });

  afterAll(async () => {
    const client = ConnectionManager.getInstance().getClient();
    for (const id of createdViews) {
      await client.request(DELETE_VIEW, { input: { id } }).catch(() => undefined);
    }
    for (const id of createdItems.reverse()) {
      await helper.executeTool('manage_work_item', { action: 'delete', id }).catch(() => undefined);
    }
  });

  describe('list_saved_views', () => {
    it("lists this run's views with their visibility", async () => {
      const result = (await browse({
        action: 'list_saved_views',
        namespace: projectPath,
        search: token,
      })) as { views: ViewSummary[]; hasMore: boolean };

      const byId = new Map(result.views.map((v) => [v.id, v]));
      expect(byId.get(typedViewId)).toMatchObject({ isPrivate: false, sort: 'TITLE_ASC' });
      // The author sees their own private view.
      expect(byId.get(privateViewId)).toMatchObject({ isPrivate: true });
      expect(result.views.every((v) => v.name.startsWith(token))).toBe(true);
    });

    it('pages through views with the cursor GitLab returns', async () => {
      const first = (await browse({
        action: 'list_saved_views',
        namespace: projectPath,
        search: token,
        first: 1,
      })) as { views: ViewSummary[]; hasMore: boolean; endCursor: string | null };
      expect(first.views).toHaveLength(1);
      expect(first.hasMore).toBe(true);

      const next = (await browse({
        action: 'list_saved_views',
        namespace: projectPath,
        search: token,
        first: 1,
        after: first.endCursor,
      })) as { views: ViewSummary[] };
      expect(next.views).toHaveLength(1);
      expect(next.views[0].id).not.toBe(first.views[0].id);
    });

    it('reports a namespace it cannot find', async () => {
      await expect(
        browse({ action: 'list_saved_views', namespace: `${groupPath}/${token}-missing` }),
      ).rejects.toThrow('was not found or is not accessible');
    });
  });

  describe('get_saved_view', () => {
    it("lists only the items the view's filters select", async () => {
      if (!labelledViewId) {
        console.log('  Skipping: the test project has no label');
        return;
      }
      const result = (await browse({
        action: 'get_saved_view',
        namespace: projectPath,
        view_id: labelledViewId,
      })) as ViewRead;

      expect(result.view.sort).toBe('TITLE_ASC');
      expect(result.items.map((i) => i.id)).toEqual([alpha.id]);
      expect(result.exact).toBe(true);
    });

    it('sends a stored type filter under the name GitLab accepts, in the view order', async () => {
      // GitLab returns this filter as `issue`; sent as is, the query would be rejected.
      const result = (await browse({
        action: 'get_saved_view',
        namespace: projectPath,
        view_id: typedViewId,
      })) as ViewRead;

      expect(result.view.filters).toMatchObject({ types: ['issue'] });
      expect(result.items.map((i) => i.id)).toEqual([alpha.id, beta.id]);
      expect(result.unappliedFilters).toBeUndefined();
    });

    it("continues a view's items from the cursor in the view order", async () => {
      const first = (await browse({
        action: 'get_saved_view',
        namespace: projectPath,
        view_id: typedViewId,
        first: 1,
      })) as ViewRead;
      expect(first.items.map((i) => i.id)).toEqual([alpha.id]);
      expect(first.hasMore).toBe(true);

      const next = (await browse({
        action: 'get_saved_view',
        namespace: projectPath,
        view_id: typedViewId,
        first: 1,
        after: first.endCursor,
      })) as ViewRead;
      expect(next.items.map((i) => i.id)).toEqual([beta.id]);
      expect(next.hasMore).toBe(false);
    });

    it('reports a view ID that does not exist', async () => {
      await expect(
        browse({ action: 'get_saved_view', namespace: projectPath, view_id: '999999999' }),
      ).rejects.toThrow('was not found in');
    });

    it('does not find a view under another namespace', async () => {
      // A view belongs to its namespace; another path must not resolve it by ID.
      await expect(
        browse({ action: 'get_saved_view', namespace: groupPath, view_id: typedViewId }),
      ).rejects.toThrow('was not found in');
    });

    it('refuses an ID that is not a saved view', async () => {
      await expect(
        browse({
          action: 'get_saved_view',
          namespace: projectPath,
          view_id: `gid://gitlab/WorkItem/${alpha.id}`,
        }),
      ).rejects.toThrow('is not a saved view ID');
    });
  });
});
