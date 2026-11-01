/** Uses the shared lifecycle's test project; integration suites run sequentially. */
import { randomUUID } from 'node:crypto';
import { gql } from 'graphql-tag';
import { ConnectionManager } from '../../src/services/ConnectionManager';
import { IntegrationTestHelper } from './helpers/registry-helper';
import { requireTestData } from '../setup/testConfig';
import { extractSimpleId, toGid, type GitLabWorkItem } from '../../src/utils/idConversion';

const READ = gql`
  query VerifyManualIssueOrder($path: ID!, $iids: [String!]) {
    project(fullPath: $path) {
      issues(iids: $iids, sort: RELATIVE_POSITION_ASC, first: 10) {
        nodes {
          iid
          relativePosition
        }
      }
    }
  }
`;

const STATE = gql`
  query VerifyReorderState($id: WorkItemID!) {
    workItem(id: $id) {
      title
      widgets {
        type
        ... on WorkItemWidgetDescription {
          description
        }
        ... on WorkItemWidgetLabels {
          labels(first: 10) {
            nodes {
              id
            }
          }
        }
        ... on WorkItemWidgetHierarchy {
          parent {
            id
          }
          children(first: 10) {
            nodes {
              id
            }
          }
        }
      }
    }
  }
`;
interface ItemState {
  title: string;
  widgets: Array<{
    type: string;
    description?: string;
    labels?: { nodes: Array<{ id: string }> };
    children?: { nodes: Array<{ id: string }> };
    parent?: { id: string } | null;
  }>;
}

describe('issue card reorder integration', () => {
  const helper = new IntegrationTestHelper();
  const issues: GitLabWorkItem[] = [];
  let namespace: string;
  let createdBoard: string | undefined;
  let labelId: string | undefined;
  let child: GitLabWorkItem | undefined;

  beforeAll(async () => {
    const data = requireTestData();
    namespace = String(data.project.path_with_namespace);
    if (!namespace.startsWith('test/'))
      throw new Error('Reorder fixtures require the test namespace');
    await helper.initialize();
    const client = ConnectionManager.getInstance().getClient();
    const boards = await client.request<{ project: { boards: { nodes: Array<{ id: string }> } } }>(
      gql`
        query ReorderFixtureBoards($path: ID!) {
          project(fullPath: $path) {
            boards(first: 1) {
              nodes {
                id
              }
            }
          }
        }
      `,
      { path: namespace },
    );
    if (boards.project.boards.nodes.length === 0) {
      const response = await client.request<{
        createBoard: { board: { id: string } | null; errors: string[] };
      }>(
        gql`
          mutation CreateReorderFixtureBoard($input: CreateBoardInput!) {
            createBoard(input: $input) {
              board {
                id
              }
              errors
            }
          }
        `,
        { input: { projectPath: namespace, name: `Reorder ${randomUUID()}` } },
      );
      expect(response.createBoard.errors).toEqual([]);
      expect(response.createBoard.board).not.toBeNull();
      createdBoard = response.createBoard.board!.id;
    }
    const label = (await helper.executeTool('manage_label', {
      action: 'create',
      namespace,
      name: `Reorder ${randomUUID()}`,
      color: '#128A38',
    })) as { id: number };
    expect(label.id).toBeDefined();
    labelId = String(label.id);
    for (const name of ['A', 'B', 'C']) {
      const issue = (await helper.createWorkItem({
        namespace,
        title: `Reorder ${name} ${randomUUID()}`,
        workItemType: 'ISSUE',
        description: 'Disposable manual-ordering integration fixture',
        labelIds: name === 'B' ? [labelId] : undefined,
      })) as GitLabWorkItem;
      expect(issue.id).toBeDefined();
      expect(issue.iid).toBeDefined();
      issues.push(issue);
    }
    child = (await helper.createWorkItem({
      namespace,
      title: `Reorder child ${randomUUID()}`,
      workItemType: 'TASK',
    })) as GitLabWorkItem;
    await helper.executeTool('manage_work_item', {
      action: 'update',
      id: child.id,
      parentId: issues[1].id,
    });
  }, 60000);

  afterAll(async () => {
    if (child !== undefined) await helper.deleteWorkItem({ id: child.id });
    for (const issue of [...issues].reverse()) await helper.deleteWorkItem({ id: issue.id });
    if (labelId !== undefined)
      await helper.executeTool('manage_label', { action: 'delete', namespace, label_id: labelId });
    if (createdBoard !== undefined) {
      const response = await ConnectionManager.getInstance()
        .getClient()
        .request<{ destroyBoard: { errors: string[] } }>(
          gql`
            mutation DeleteReorderFixtureBoard($input: DestroyBoardInput!) {
              destroyBoard(input: $input) {
                errors
              }
            }
          `,
          { input: { id: createdBoard } },
        );
      expect(response.destroyBoard.errors).toEqual([]);
    }
  });

  // Query GitLab's persisted manual order, rather than trusting the mutation's success flag.
  async function expectOrder(order: GitLabWorkItem[]): Promise<void> {
    const response = await ConnectionManager.getInstance()
      .getClient()
      .request<{
        project: { issues: { nodes: Array<{ iid: string; relativePosition: number | null }> } };
      }>(READ, { path: namespace, iids: issues.map((issue) => String(issue.iid)) });
    expect(response.project.issues.nodes.map((issue) => String(issue.iid))).toEqual(
      order.map((issue) => String(issue.iid)),
    );
    for (const issue of response.project.issues.nodes)
      expect(typeof issue.relativePosition).toBe('number');
  }

  // Before, after, between and repeated moves must preserve content, labels and hierarchy.
  it('persists first, last, between and repeated placements without requiring a board ID', async () => {
    const [a, b, c] = issues;
    // Read nested state directly: the compact MCP read projection does not select child IDs.
    const state = () =>
      ConnectionManager.getInstance()
        .getClient()
        .request<{ workItem: ItemState }>(STATE, { id: toGid(b.id, 'WorkItem') });
    const before = (await state()).workItem;
    expect(
      before.widgets
        .find((widget) => widget.type === 'LABELS')
        ?.labels?.nodes.map((label) => extractSimpleId(label.id)),
    ).toEqual([labelId]);
    expect(
      before.widgets
        .find((widget) => widget.type === 'HIERARCHY')
        ?.children?.nodes.map((item) => extractSimpleId(item.id)),
    ).toEqual([child!.id]);
    expect(before.widgets.find((widget) => widget.type === 'DESCRIPTION')?.description).toBe(
      'Disposable manual-ordering integration fixture',
    );
    const move = (id: string, placement: { beforeId?: string; afterId?: string }) =>
      helper.executeTool('manage_work_item', { action: 'reorder', id, ...placement });
    await move(b.id, { afterId: a.id });
    await move(c.id, { afterId: b.id });
    await expectOrder([a, b, c]);
    await move(c.id, { beforeId: a.id });
    await expectOrder([c, a, b]);
    await move(c.id, { afterId: b.id });
    await expectOrder([a, b, c]);
    await move(b.id, { afterId: a.id, beforeId: c.id });
    await move(b.id, { afterId: a.id, beforeId: c.id });
    await expectOrder([a, b, c]);
    expect((await state()).workItem).toEqual(before);
  }, 60000);
});
