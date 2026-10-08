import { cleanWorkItemResponse } from '../../../src/utils/idConversion';

const mockGroup = {
  id: 91,
  path: 'lifecycle-test-1791488000000',
  full_path: 'test/lifecycle-test-1791488000000',
};
const mockIssue = cleanWorkItemResponse({
  id: 'gid://gitlab/WorkItem/7',
  iid: '7',
  title: 'Fixture issue',
  workItemType: { id: 'gid://gitlab/WorkItems::Type/1', name: 'Issue' },
});
const mockProject = {
  id: 92,
  path_with_namespace: `${mockGroup.full_path}/project`,
  web_url: 'https://gitlab.example/test/fixture/project',
};
const mockData = {
  group: mockGroup,
  project: mockProject,
  mergeRequests: [{ iid: 3, description: 'Original description' }],
  workItems: [mockIssue],
  groupWorkItems: [{ id: '8' }],
};
const mockExecute = jest.fn();
const mockList = jest.fn();
const mockTypes = jest.fn();

jest.mock('../../setup/testConfig', () => ({
  GITLAB_TOKEN: 'fixture-token',
  GITLAB_API_URL: 'https://gitlab.example',
  requireTestData: () => mockData,
  getTestData: () => mockData,
  getTestProject: () => mockProject,
}));
jest.mock('../../integration/helpers/registry-helper', () => ({
  IntegrationTestHelper: jest.fn().mockImplementation(() => ({
    initialize: async () => {},
    executeTool: mockExecute,
    listWorkItems: mockList,
  })),
}));
jest.mock('../../../src/utils/workItemTypes', () => ({
  getWorkItemTypes: (...args: unknown[]) => mockTypes(...args),
}));
jest.mock('../../../src/services/ConnectionManager', () => ({
  ConnectionManager: { getInstance: () => ({ initialize: async () => {}, getClient: () => ({}) }) },
}));
jest.mock('../../../src/graphql/client', () => ({ GraphQLClient: jest.fn() }));
jest.mock('../../setup/tierGate', () => ({
  itIfTier: (_tier: string, name: string, body: () => Promise<void>) => it(name, body),
  describeIfTier: (_tier: string, name: string, body: () => void) => describe(name, body),
}));

// Execute the actual integration callbacks against provider-shaped fixtures.
// This catches regressions in consumers without requiring a live GitLab instance.
function captureSuite(load: () => void) {
  const cases = new Map<string, () => Promise<void>>();
  const setup: Array<() => Promise<void>> = [];
  const spies = [
    jest.spyOn(global, 'describe').mockImplementation((_name, body) => body()),
    jest.spyOn(global, 'it').mockImplementation((name, body) => {
      cases.set(String(name), body as () => Promise<void>);
    }),
    jest.spyOn(global, 'beforeAll').mockImplementation((body) => {
      setup.push(body as () => Promise<void>);
    }),
  ];
  try {
    load();
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
  return { cases, setup };
}

describe('Lifecycle fixture consumers', () => {
  let mr: ReturnType<typeof captureSuite>;
  let lifecycle: ReturnType<typeof captureSuite>;
  let workItems: ReturnType<typeof captureSuite>;

  beforeAll(() => {
    mr = captureSuite(() => require('../../integration/schemas-dependent/merge-requests.test'));
    lifecycle = captureSuite(() => require('../../integration/data-lifecycle.test'));
    const previous = process.env.GITLAB_TOKEN;
    process.env.GITLAB_TOKEN = 'fixture-token';
    try {
      workItems = captureSuite(() => require('../../integration/workitems.test'));
    } finally {
      if (previous === undefined) delete process.env.GITLAB_TOKEN;
      else process.env.GITLAB_TOKEN = previous;
    }
  });

  beforeEach(() => {
    mockExecute.mockReset();
    mockList.mockReset();
    mockTypes.mockReset();
  });

  // manage_work_item normalizes the type to a string; the real MR test must
  // reach both provider pages and restore its description with that response.
  it('runs the closing-issues scenario with the normalized Issue response', async () => {
    mockExecute
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce([
        {
          iid: 7,
          title: mockIssue.title,
          state: 'opened',
          web_url: `${mockProject.web_url}/-/issues/7`,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({});
    await mr.setup[0]();
    await mr.cases.get(
      'reads native closing issues with one-page pagination without closing them',
    )!();
    expect(mockExecute.mock.calls.map((call) => call[1])).toEqual([
      {
        action: 'update',
        project_id: mockProject.path_with_namespace,
        merge_request_iid: '3',
        description: 'Closes #7',
      },
      {
        action: 'closing_issues',
        project_id: mockProject.path_with_namespace,
        merge_request_iid: '3',
        page: 1,
        per_page: 1,
      },
      {
        action: 'closing_issues',
        project_id: mockProject.path_with_namespace,
        merge_request_iid: '3',
        page: 2,
        per_page: 1,
      },
      {
        action: 'update',
        project_id: mockProject.path_with_namespace,
        merge_request_iid: '3',
        description: 'Original description',
      },
    ]);
  });

  // Nested groups require full_path. Run the real lifecycle listing callbacks
  // so selecting a nonexistent top-level namespace cannot pass unnoticed.
  it.each([
    'should test list_work_items with group namespace (Epics)',
    'should test list_work_items with type filtering',
  ])('uses the full namespace in lifecycle: %s', async (name) => {
    mockList.mockResolvedValue({
      items: [{ title: 'Epic', workItemType: 'Epic' }],
      hasMore: false,
      endCursor: null,
    });
    await lifecycle.setup[0]();
    if (name.includes('type filtering'))
      mockList
        .mockResolvedValueOnce({ items: [{ workItemType: 'Epic' }] })
        .mockResolvedValueOnce({ items: [{ workItemType: 'Issue' }] });
    await lifecycle.cases.get(name)!();
    expect(mockList.mock.calls[0][0].namespace).toBe(mockGroup.full_path);
  });

  // The dependent suite must also address the nested namespace rather than
  // its leaf name; execute the actual callback, not a copied selector.
  it('uses the full namespace in the dependent work-item suite', async () => {
    const previous = process.env.GITLAB_TOKEN;
    process.env.GITLAB_TOKEN = 'fixture-token';
    try {
      mockList.mockResolvedValue({ items: [] });
      await workItems.setup[0]();
      await workItems.cases.get(
        'should list GROUP-level work items (Epics) using list_work_items handler',
      )!();
      expect(mockList.mock.calls[0][0].namespace).toBe(mockGroup.full_path);
    } finally {
      if (previous === undefined) delete process.env.GITLAB_TOKEN;
      else process.env.GITLAB_TOKEN = previous;
    }
  });
});
