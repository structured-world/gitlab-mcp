/**
 * Server-side filters of browse_work_items list and the list_types action, against a
 * real GitLab. A filter must be applied by GitLab before paginating: an item that falls
 * off the unfiltered first page has to come back on the first filtered page, and the
 * cursor of a filtered page has to continue within the same filter.
 */

import { getTestData } from '../../setup/testConfig';
import { IntegrationTestHelper } from '../helpers/registry-helper';

interface ListedItem {
  id: string;
  iid: string;
  title: string;
}

interface ListResult {
  items: ListedItem[];
  hasMore: boolean;
  endCursor: string | null;
}

interface TypesResult {
  namespace: string;
  types: Array<{ id: string; name: string; widgets?: string[] }>;
}

describe('browse_work_items server-side list filters', () => {
  let helper: IntegrationTestHelper;
  // Unique per run, so only this run's items match the text filter.
  const token = `wifilter${Date.now()}`;
  const created: string[] = [];
  let projectPath: string;
  let groupPath: string;
  let firstMatch: ListedItem;
  let secondMatch: ListedItem;
  let child: ListedItem;
  let labelName: string | undefined;
  let username: string;

  const list = (args: Record<string, unknown>) =>
    helper.executeTool('browse_work_items', { action: 'list', ...args }) as Promise<ListResult>;

  const create = async (args: Record<string, unknown>): Promise<ListedItem> => {
    const item = (await helper.executeTool('manage_work_item', {
      action: 'create',
      ...args,
    })) as ListedItem;
    created.push(item.id);
    return item;
  };

  beforeAll(async () => {
    helper = new IntegrationTestHelper();
    await helper.initialize();

    const testData = getTestData();
    projectPath = testData.project!.path_with_namespace;
    groupPath = testData.group!.full_path;
    username = testData.user!.username;
    labelName = testData.labels?.[0]?.name;
    const labelId = testData.labels?.[0]?.id?.toString();

    // Oldest first: the first match is created before two items that do not match,
    // so newest-first it is not on an unfiltered page of two.
    firstMatch = await create({
      namespace: projectPath,
      title: `${token} alpha`,
      workItemType: 'ISSUE',
      assigneeIds: [String(testData.user!.id)],
      ...(labelId && { labelIds: [labelId] }),
    });
    for (const name of ['noise one', 'noise two']) {
      await create({ namespace: projectPath, title: `unrelated ${name}`, workItemType: 'ISSUE' });
    }
    secondMatch = await create({
      namespace: projectPath,
      title: `${token} beta`,
      workItemType: 'ISSUE',
    });
    child = await create({
      namespace: projectPath,
      title: `child of ${secondMatch.iid}`,
      workItemType: 'TASK',
      parentId: secondMatch.id,
    });
  });

  afterAll(async () => {
    for (const id of created.reverse()) {
      await helper.executeTool('manage_work_item', { action: 'delete', id }).catch(() => undefined);
    }
  });

  it('finds an item that falls off the unfiltered first page', async () => {
    const unfiltered = await list({ namespace: projectPath, first: 2, sort: 'CREATED_DESC' });
    expect(unfiltered.items.map((i) => i.id)).not.toContain(firstMatch.id);

    const filtered = await list({ namespace: projectPath, search: token, first: 2 });
    expect(filtered.items.map((i) => i.id).sort()).toEqual([firstMatch.id, secondMatch.id].sort());
    expect(filtered.hasMore).toBe(false);
  });

  it('continues a filtered listing from its cursor within the same filter', async () => {
    const first = await list({
      namespace: projectPath,
      search: token,
      sort: 'TITLE_ASC',
      first: 1,
    });
    expect(first.items.map((i) => i.id)).toEqual([firstMatch.id]);
    expect(first.hasMore).toBe(true);

    const next = await list({
      namespace: projectPath,
      search: token,
      sort: 'TITLE_ASC',
      first: 1,
      after: first.endCursor,
    });
    expect(next.items.map((i) => i.id)).toEqual([secondMatch.id]);
    expect(next.hasMore).toBe(false);
  });

  it('filters by assignee and author', async () => {
    const assigned = await list({
      namespace: projectPath,
      search: token,
      assignee_usernames: [username],
    });
    expect(assigned.items.map((i) => i.id)).toEqual([firstMatch.id]);

    const authored = await list({
      namespace: projectPath,
      search: token,
      author_username: username,
    });
    expect(authored.items).toHaveLength(2);

    const nobody = await list({
      namespace: projectPath,
      search: token,
      author_username: `${token}-nobody`,
    });
    expect(nobody.items).toEqual([]);
  });

  it('filters by label', async () => {
    if (!labelName) {
      console.log('  Skipping: the test project has no label');
      return;
    }
    const labelled = await list({
      namespace: projectPath,
      search: token,
      label_names: [labelName],
    });
    expect(labelled.items.map((i) => i.id)).toEqual([firstMatch.id]);
  });

  it('lists only the direct children of a parent', async () => {
    const children = await list({ namespace: projectPath, parent_ids: [secondMatch.id] });
    expect(children.items.map((i) => i.id)).toEqual([child.id]);
  });

  it('filters group-level work items in a group', async () => {
    const epic = await create({
      namespace: groupPath,
      title: `${token} epic`,
      workItemType: 'EPIC',
    });

    const result = await list({ namespace: groupPath, search: token });

    // A group lists its own work items, not those of its projects.
    expect(result.items.map((i) => i.id)).toEqual([epic.id]);
  });

  it('returns an empty page for a namespace the user cannot see', async () => {
    const result = await list({ namespace: `${groupPath}/${token}-missing`, search: token });
    expect(result).toEqual({ items: [], hasMore: false, endCursor: null });
  });

  describe('list_types', () => {
    it('lists the project work item types with their widgets', async () => {
      const result = (await helper.executeTool('browse_work_items', {
        action: 'list_types',
        namespace: projectPath,
      })) as TypesResult;

      const issue = result.types.find((t) => t.name === 'Issue');
      expect(issue).toBeDefined();
      expect(issue!.id).toMatch(/^\d+$/);
      expect(issue!.widgets).toEqual(expect.arrayContaining(['ASSIGNEES', 'LABELS']));
    });

    it('lists the group work item types', async () => {
      const result = (await helper.executeTool('browse_work_items', {
        action: 'list_types',
        namespace: groupPath,
      })) as TypesResult;

      expect(result.namespace).toBe(groupPath);
      expect(result.types.map((t) => t.name)).toContain('Epic');
    });

    it('reports a namespace it cannot find', async () => {
      await expect(
        helper.executeTool('browse_work_items', {
          action: 'list_types',
          namespace: `${groupPath}/${token}-missing`,
        }),
      ).rejects.toThrow('was not found or is not accessible');
    });
  });
});
