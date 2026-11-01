/** Local API doubles only: no Duo execution, settings changes, CI jobs or credits. */
import { getOperationAST, print } from 'graphql';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { ConnectionManager } from '../../src/services/ConnectionManager';
import { gitlab, GitLabApiError } from '../../src/utils/gitlab-api';
import { getGitLabBaseUrl } from '../../src/utils/gitlab-base-url';
import { graphqlSupports, instanceAtLeast } from '../../src/entities/instance-version';
import { duoToolRegistry } from '../../src/entities/duo/registry';
import { BrowseDuoSessionsSchema, ManageDuoSessionSchema } from '../../src/entities/duo/schema';
import { readConsumer, preview } from '../../src/entities/duo/discovery';
import { ScopeEnforcer } from '../../src/profiles/scope-enforcer';
import { PresetSchema } from '../../src/profiles/types';
import { RegistryManager } from '../../src/registry-manager';
import { ResponseLimitError } from '../../src/utils/bounded-json';
import { requestDuo, DETAILS } from '../../src/entities/duo/queries';
import type { EffectivePolicy } from '../../src/configuration/policy';
import { createTimeoutError } from '../../src/utils/error-handler';
import {
  forwardWithPolicy,
  DownstreamDisconnectedError,
  isReadCall,
} from '../../src/channel-gateway/forwarding';

jest.mock('../../src/services/ConnectionManager', () => ({
  ConnectionManager: { getInstance: jest.fn() },
}));
jest.mock('../../src/utils/gitlab-api', () => ({
  ...jest.requireActual('../../src/utils/gitlab-api'),
  gitlab: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('../../src/utils/gitlab-base-url', () => ({
  ...jest.requireActual('../../src/utils/gitlab-base-url'),
  getGitLabBaseUrl: jest.fn(),
}));
jest.mock('../../src/entities/instance-version', () => ({
  graphqlSupports: jest.fn(),
  instanceAtLeast: jest.fn(),
}));

const request = jest.fn();
const client = jest.fn(() => ({ request }));
const policy: EffectivePolicy = {
  readOnly: false,
  disabledGroups: new Set(),
  deniedActions: new Map(),
};
const project = {
  id: 41,
  path_with_namespace: 'test/project',
  name_with_namespace: 'Test / project',
};
const session = {
  id: 'gid://gitlab/Ai::DuoWorkflows::Workflow/73',
  projectId: 'gid://gitlab/Project/41',
  project: { id: 'gid://gitlab/Project/41', fullPath: 'test/project' },
  humanStatus: 'Running',
  statusName: 'running',
  createdAt: '2026-11-01T00:00:00Z',
  workflowDefinition: 'developer/v1',
};
const pageInfo = { hasNextPage: false, endCursor: null };
const consumer = {
  id: 'gid://gitlab/Ai::Catalog::ItemConsumer/91',
  enabled: true,
  project: { id: 'gid://gitlab/Project/41' },
  userPermissions: { executeAiCatalogItem: true },
  item: {
    id: 'gid://gitlab/Ai::Catalog::Item/8',
    itemType: 'FLOW',
    name: 'Fix',
    description: 'Repair code',
  },
};
const responses: Record<string, unknown> = {};
const browse = (args: unknown, executionPolicy: Partial<EffectivePolicy> = {}) =>
  duoToolRegistry.get('browse_duo_sessions')!.handler(args, { ...policy, ...executionPolicy });
const manage = (args: unknown, executionPolicy: Partial<EffectivePolicy> = {}) =>
  duoToolRegistry.get('manage_duo_session')!.handler(args, { ...policy, ...executionPolicy });

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(responses)) delete responses[key];
  (getGitLabBaseUrl as jest.Mock).mockReturnValue('https://gitlab.example/gitlab');
  (ConnectionManager.getInstance as jest.Mock).mockReturnValue({
    getClient: client,
    getCurrentInstanceUrl: () => 'https://gitlab.example/gitlab',
    getInstanceInfo: () => ({ tier: 'ultimate', version: '19.5.0' }),
    getAdminInfo: () => undefined,
    getTokenScopeInfo: () => undefined,
  });
  (graphqlSupports as jest.Mock).mockReturnValue(true);
  (instanceAtLeast as jest.Mock).mockReturnValue(true);
  (gitlab.get as jest.Mock).mockReset().mockResolvedValue(project);
  (gitlab.post as jest.Mock).mockReset().mockResolvedValue({ id: 73, status: 'created' });
  responses.DuoConfiguredConsumer = { aiCatalogItemConsumer: consumer };
  responses.DuoProjectEnablement = {
    project: {
      duoWorkflowStatusCheck: {
        enabled: true,
        createDuoWorkflowForCiAllowed: true,
        enabledFoundationalFlows: ['developer/v1', 'code_review/v1', 'fix_pipeline/v1'],
      },
    },
  };
  responses.DuoCatalog = { aiCatalogConfiguredItems: { nodes: [consumer], pageInfo } };
  responses.DuoFoundationalAgents = {
    aiFoundationalChatAgents: {
      nodes: [
        {
          id: 'planner',
          name: 'Planner',
          description: 'Plan',
          referenceWithVersion: 'duo_planner/v1',
        },
      ],
    },
  };
  responses.DuoSessionMetadata = { duoWorkflowWorkflows: { nodes: [session], pageInfo } };
  responses.DuoSessionMetadataById = responses.DuoSessionMetadata;
  responses.DuoSessionDetails = { duoWorkflowWorkflows: { nodes: [session] } };
  responses.DuoResumeState = {
    duoWorkflowWorkflows: {
      nodes: [
        { ...session, statusName: 'input_required', userPermissions: { resumeDuoWorkflow: true } },
      ],
    },
  };
  request.mockReset().mockImplementation(async (document) => {
    const name = getOperationAST(document)?.name?.value;
    if (!name || !(name in responses)) throw new Error(`Unexpected local query: ${name}`);
    const result = responses[name];
    if (result instanceof Error) throw result;
    return result;
  });
});

describe('Duo schemas and discovery', () => {
  // Calling a handler without authenticated policy must not bypass the central restrictions.
  it('requires the authenticated execution policy', async () => {
    await expect(
      duoToolRegistry.get('browse_duo_sessions')!.handler({ action: 'list' }),
    ).rejects.toThrow('authenticated call execution policy');
    expect(request).not.toHaveBeenCalled();
  });

  // Older schemas and nullable catalog permissions must not invent execution eligibility.
  it('uses the older catalog query and preserves unknown permissions', async () => {
    (graphqlSupports as jest.Mock).mockReturnValue(false);
    responses.DuoCatalog = {
      aiCatalogConfiguredItems: {
        nodes: [
          { ...consumer, userPermissions: null },
          { ...consumer, item: { ...consumer.item, itemType: 'AGENT', foundational: true } },
        ],
        pageInfo,
      },
    };
    expect(await browse({ action: 'agents_and_flows', project_id: '41' })).toMatchObject({
      items: [{ can_start_session: null, can_execute_catalog_item: null }],
    });
    const document = request.mock.calls.find(
      ([doc]) => getOperationAST(doc)?.name?.value === 'DuoCatalog',
    )![0];
    expect(print(document)).not.toContain('includeFoundationalConsumers');
    expect(
      request.mock.calls.some(
        ([doc]) => getOperationAST(doc)?.name?.value === 'DuoFoundationalAgents',
      ),
    ).toBe(false);
  });

  // Missing native entities remain errors; an empty agent catalog remains an empty catalog.
  it('handles unavailable discovery entities without claiming startability', async () => {
    responses.DuoProjectEnablement = { project: null };
    await expect(browse({ action: 'agents_and_flows', project_id: '41' })).rejects.toThrow(
      'project is unavailable',
    );
    responses.DuoConfiguredConsumer = { aiCatalogItemConsumer: null };
    await expect(readConsumer('91')).rejects.toThrow('consumer is unavailable');
    responses.DuoProjectEnablement = { project: { duoWorkflowStatusCheck: null } };
    responses.DuoFoundationalAgents = { aiFoundationalChatAgents: null };
    expect(await browse({ action: 'agents_and_flows', project_id: '41' })).toMatchObject({
      items: [{ kind: 'flow', can_start_session: null }],
    });
  });

  // Native availability does not prove credits or runner execution eligibility.
  it('keeps visible foundational agents startability unknown', async () => {
    expect(
      await browse({ action: 'agents_and_flows', project_id: '41', item_type: 'agent' }),
    ).toMatchObject({ items: [{ kind: 'foundational_agent', can_start_session: null }] });
  });

  // Native execution denial is distinct from unknown prerequisites in discovery.
  it('reports a catalog flow that GitLab refuses to execute', async () => {
    responses.DuoCatalog = {
      aiCatalogConfiguredItems: {
        nodes: [{ ...consumer, userPermissions: { executeAiCatalogItem: false } }],
        pageInfo,
      },
    };
    expect(
      await browse({ action: 'agents_and_flows', project_id: '41', item_type: 'flow' }),
    ).toMatchObject({ items: [{ can_start_session: false, can_execute_catalog_item: false }] });
  });
  // New tools must not affect a GitLab 16 catalog or expose unsupported operations there.
  it('hides Duo on GitLab 16 while retaining ordinary project browsing', () => {
    const connection = ConnectionManager.getInstance();
    (ConnectionManager.getInstance as jest.Mock).mockReturnValue({
      ...connection,
      getInstanceInfo: () => ({ tier: 'ultimate', version: '16.0.0' }),
    });
    const registry = RegistryManager.getInstance();
    registry.refreshCache('https://old.example');
    const names = registry.getAvailableToolNames('https://old.example');
    expect(names).not.toContain('browse_duo_sessions');
    expect(names).not.toContain('manage_duo_session');
    expect(names).toContain('browse_projects');
  });
  // Release manifests and generated references use the unfiltered registry path.
  it('exports both Duo tools to generated metadata', () => {
    const names = RegistryManager.getInstance()
      .getAllToolDefinitionsUnfiltered()
      .map((tool) => tool.name);
    expect(names).toContain('browse_duo_sessions');
    expect(names).toContain('manage_duo_session');
    expect(RegistryManager.getInstance().isReadOnlyTool('browse_duo_sessions')).toBe(true);
    expect(RegistryManager.getInstance().isReadOnlyTool('manage_duo_session')).toBe(false);
  });
  // Preset parsing must retain the domain switch used by effective call policy.
  it('retains an explicit Duo preset restriction', () => {
    expect(
      PresetSchema.parse({ description: 'No Duo', features: { duo: false } }).features,
    ).toEqual({ duo: false });
  });
  // Preview limits must never split a Unicode scalar into an invalid surrogate.
  it('previews complete Unicode characters', () => {
    expect(preview('😀😀', 1)).toEqual({ text: '😀', truncated: true });
  });
  // Reject unsafe or ambiguous selectors before any API request.
  it.each([
    { action: 'start', project_id: '41', goal: 'work' },
    { action: 'start', project_id: '41', goal: 'work', flow: 'developer/v1', consumer_id: '91' },
    { action: 'send_input', workflow_id: '73', human_approval: true, human_message: 'yes' },
    { action: 'send_input', workflow_id: '../73', human_approval: false },
    { action: 'send_input', workflow_id: '73', human_message: 'answer' },
  ])('rejects invalid command %j', (input) =>
    expect(ManageDuoSessionSchema.safeParse(input).success).toBe(false),
  );

  // GitLab counts Unicode characters, not UTF-16 code units.
  it('accepts 2000 supplementary characters but rejects 2001', () => {
    const input = { action: 'send_input', workflow_id: '73', human_approval: false };
    expect(
      ManageDuoSessionSchema.safeParse({ ...input, human_message: '😀'.repeat(2000) }).success,
    ).toBe(true);
    expect(
      ManageDuoSessionSchema.safeParse({ ...input, human_message: '😀'.repeat(2001) }).success,
    ).toBe(false);
    expect(BrowseDuoSessionsSchema.parse({ action: 'list' })).toEqual({
      action: 'list',
      first: 20,
    });
  });

  // GraphQL IDs use the model namespace, not its GraphQL type name.
  it('looks up configured consumers with their canonical GID', async () => {
    await readConsumer('91');
    expect(request).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'gid://gitlab/Ai::Catalog::ItemConsumer/91' },
      undefined,
      4 * 1024 * 1024,
    );
  });

  // A filtered empty page is not end-of-list.
  it('preserves continuation when disabled entries fill a page', async () => {
    const continuation = { hasNextPage: true, endCursor: 'opaque-next' };
    responses.DuoCatalog = {
      aiCatalogConfiguredItems: {
        nodes: [{ ...consumer, enabled: false }],
        pageInfo: continuation,
      },
    };
    expect(
      await browse({
        action: 'agents_and_flows',
        project_id: '41',
        after: 'opaque',
        item_type: 'flow',
      }),
    ).toMatchObject({ items: [], pageInfo: continuation });
  });

  // Known runner failure is a concrete refusal even when an agent is visible.
  it('reports known runner unavailability for foundational agents', async () => {
    responses.DuoProjectEnablement = {
      project: {
        duoWorkflowRunnerAvailable: false,
        duoWorkflowStatusCheck: { enabled: true, createDuoWorkflowForCiAllowed: true },
      },
    };
    expect(
      await browse({ action: 'agents_and_flows', project_id: '41', item_type: 'agent' }),
    ).toMatchObject({ items: [{ agent: 'duo_planner/v1', can_start_session: false }] });
  });

  // Incomplete enablement must not be reported as a known refusal.
  it('reports unknown startability honestly', async () => {
    responses.DuoProjectEnablement = { project: { duoWorkflowStatusCheck: null } };
    expect(
      await browse({ action: 'agents_and_flows', project_id: '41', item_type: 'flow' }),
    ).toMatchObject({
      items: [{ consumer_id: '91', catalog_item_id: '8', can_start_session: null }],
    });
  });

  // No client or credential selection is cached in the Duo domain.
  it('selects the caller instance independently for each request', async () => {
    await requestDuo(DETAILS);
    (getGitLabBaseUrl as jest.Mock).mockReturnValue('https://other.example');
    await requestDuo(DETAILS);
    expect(client.mock.calls).toEqual([
      ['https://gitlab.example/gitlab'],
      ['https://other.example'],
    ]);
  });
});

describe('Duo project boundaries and progress', () => {
  // Unrestricted metadata reads need no project REST lookup, including absent provenance.
  it.each([
    ['CREATED', 'created', 120],
    ['STOPPED', 'stopped', null],
    [null, null, null],
  ])('preserves metadata with native status %s', async (native, status, delay) => {
    responses.DuoSessionMetadata = {
      duoWorkflowWorkflows: {
        nodes: [
          {
            ...session,
            projectId: null,
            project: null,
            statusName: undefined,
            status: native,
            workflowDefinition: undefined,
          },
        ],
        pageInfo,
      },
    };
    expect(await browse({ action: 'list' })).toMatchObject({
      sessions: [
        {
          project_id: null,
          flow: null,
          status,
          poll_after_seconds: delay,
        },
      ],
      skipped_unverifiable_sessions: 0,
    });
    expect(gitlab.get).not.toHaveBeenCalled();
  });

  // Missing workflow identities and deleted projects cannot authorize detailed reads.
  it('rejects absent sessions and deleted projects before details', async () => {
    responses.DuoSessionMetadataById = { duoWorkflowWorkflows: { nodes: [] } };
    const restriction = { operatorProjectIds: new Set(['41']) };
    await expect(browse({ action: 'get', workflow_id: '73' }, restriction)).rejects.toThrow(
      'unavailable',
    );
    responses.DuoSessionMetadataById = {
      duoWorkflowWorkflows: { nodes: [{ ...session, project: null }] },
    };
    (gitlab.get as jest.Mock).mockRejectedValue(
      new GitLabApiError(404, 'Deleted', 'GitLab API error: 404 - Deleted'),
    );
    await expect(browse({ action: 'get', workflow_id: '73' }, restriction)).rejects.toThrow(
      'project is unavailable',
    );
    expect(
      request.mock.calls.every(
        ([doc]) => getOperationAST(doc)?.name?.value === 'DuoSessionMetadataById',
      ),
    ).toBe(true);
  });

  // Optional results stay explicit without fabricating permissions or object links.
  it('reports unknown input permission and absent project provenance without restrictions', async () => {
    responses.DuoSessionDetails = {
      duoWorkflowWorkflows: {
        nodes: [
          {
            ...session,
            projectId: null,
            project: null,
            statusName: 'input_required',
            latestCheckpoint: { lastDuoMessage: { role: 'assistant', content: 'Waiting' } },
            mergeRequestLinks: {
              nodes: [null, { mergeRequest: null }],
              pageInfo: { hasNextPage: false },
            },
          },
        ],
      },
    };
    expect(await browse({ action: 'get', workflow_id: '73' })).toMatchObject({
      project_id: null,
      pending_input: { can_send: null },
      created_objects: { merge_requests: [] },
    });
  });

  // A history response cannot replace the session's verified project identity.
  it('withholds history whose project provenance changed', async () => {
    responses.DuoSessionDetails = {
      duoWorkflowWorkflows: { nodes: [{ ...session, statusName: 'finished' }] },
    };
    responses.DuoSessionLatestAnswer = {
      duoWorkflowWorkflows: {
        nodes: [
          {
            ...session,
            projectId: 'gid://gitlab/Project/99',
            latestCheckpoint: { duoMessages: [{ role: 'assistant', content: 'Foreign result' }] },
          },
        ],
      },
    };
    expect(await browse({ action: 'get', workflow_id: '73' })).toMatchObject({
      history: 'unreadable',
      answer: { text: null, truncated: false },
    });
  });

  // Resume failures retain the exact workflow recovery hint and never repeat the write.
  it('preserves resume HTTP failure and its recovery workflow', async () => {
    const error = new GitLabApiError(403, 'Unavailable', 'GitLab API error: 403 - Unavailable');
    (gitlab.post as jest.Mock).mockRejectedValue(error);
    await expect(
      manage({ action: 'send_input', workflow_id: '73', human_approval: true }),
    ).rejects.toThrow('workflow 73');
    expect(gitlab.post).toHaveBeenCalledTimes(1);
  });
  // Repeated session projects must cost one HTTP lookup per project and invocation.
  it('resolves repeated projects once per page', async () => {
    let bytes = 0;
    let requests = 0;
    const server = createServer((req, res) => {
      const id = Number(req.url!.split('/').at(-1));
      const body = JSON.stringify({
        id,
        path_with_namespace: `test/project-${id}`,
        name_with_namespace: `Test / project-${id}`,
      });
      requests++;
      bytes += Buffer.byteLength(body);
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing fixture address');
      (gitlab.get as jest.Mock).mockImplementation(async (path) =>
        fetch(`http://127.0.0.1:${address.port}/${path}`).then((result) => result.json()),
      );
      responses.DuoSessionMetadata = {
        duoWorkflowWorkflows: {
          nodes: Array.from({ length: 100 }, (_, index) => ({
            ...session,
            id: `gid://gitlab/Ai::DuoWorkflows::Workflow/${index + 1}`,
            projectId: `gid://gitlab/Project/${(index % 10) + 1}`,
            project: null,
          })),
          pageInfo,
        },
      };
      const started = performance.now();
      const result = await browse(
        { action: 'list', first: 100 },
        {
          scopeEnforcer: new ScopeEnforcer({ group: 'test' }),
        },
      );
      process.stdout.write(
        JSON.stringify({
          fixture: '100 sessions / 10 projects',
          requests,
          bytes,
          milliseconds: performance.now() - started,
        }) + '\n',
      );
      expect(result).toMatchObject({ sessions: expect.any(Array) });
      expect((result as { sessions: unknown[] }).sessions).toHaveLength(100);
      expect(requests).toBe(10);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  // Invalid identities and confirmed deletion cannot hide valid rows or pagination.
  it('counts unverifiable rows without swallowing provider failures', async () => {
    responses.DuoSessionMetadata = {
      duoWorkflowWorkflows: {
        nodes: [
          session,
          { ...session, projectId: 'invalid', project: null },
          { ...session, projectId: 'gid://gitlab/Project/99', project: null },
        ],
        pageInfo: { hasNextPage: true, endCursor: 'opaque' },
      },
    };
    (gitlab.get as jest.Mock).mockRejectedValue(
      new GitLabApiError(404, 'Not found', 'GitLab API error: 404 - Not found'),
    );
    expect(
      await browse(
        { action: 'list' },
        {
          scopeEnforcer: new ScopeEnforcer({ group: 'test' }),
        },
      ),
    ).toMatchObject({
      sessions: [{ workflow_id: '73' }],
      skipped_unverifiable_sessions: 2,
      pageInfo: { hasNextPage: true, endCursor: 'opaque' },
    });
  });

  // Authentication, throttling and transport failures remain actionable failures.
  it.each([401, 403, 429, 500, 'network'])(
    'preserves project lookup failure %s and stops later reads',
    async (status) => {
      const error =
        typeof status === 'number'
          ? new GitLabApiError(
              status,
              'Unavailable',
              `GitLab API error: ${status} - Unavailable`,
              30,
            )
          : new Error('Network unavailable');
      responses.DuoSessionMetadata = {
        duoWorkflowWorkflows: {
          nodes: [
            { ...session, project: null },
            { ...session, project: null, projectId: 'gid://gitlab/Project/99' },
          ],
          pageInfo,
        },
      };
      (gitlab.get as jest.Mock).mockRejectedValue(error);
      await expect(
        browse(
          { action: 'list' },
          {
            scopeEnforcer: new ScopeEnforcer({ group: 'test' }),
          },
        ),
      ).rejects.toBe(error);
      expect(gitlab.get).toHaveBeenCalledTimes(1);
    },
  );

  // A page-local cache cannot retain authorization across calls or override native metadata.
  it('rechecks each call and trusts each row native project over cached REST metadata', async () => {
    responses.DuoSessionMetadata = {
      duoWorkflowWorkflows: {
        nodes: [
          { ...session, project: null },
          { ...session, project: { ...session.project, fullPath: 'other/project' } },
        ],
        pageInfo,
      },
    };
    const restriction = { scopeEnforcer: new ScopeEnforcer({ group: 'test' }) };
    expect(await browse({ action: 'list' }, restriction)).toMatchObject({
      sessions: [{ workflow_id: '73' }],
    });
    (gitlab.get as jest.Mock).mockResolvedValue({
      ...project,
      path_with_namespace: 'other/project',
    });
    expect(await browse({ action: 'list' }, restriction)).toMatchObject({ sessions: [] });
    expect(gitlab.get).toHaveBeenCalledTimes(2);
  });

  // An explicit selected project outside scope must fail before fetching sessions.
  it('rejects a selected project outside the working scope', async () => {
    await expect(
      browse(
        { action: 'list', project_id: '41' },
        {
          scopeEnforcer: new ScopeEnforcer({ project: 'other/project' }),
        },
      ),
    ).rejects.toThrow('outside');
    expect(request).not.toHaveBeenCalled();
  });

  // Resolve absent nested project metadata, but reject provenance that cannot be verified.
  it.each(['missing', 'invalid', 'none'])(
    'verifies session project metadata (%s)',
    async (mode) => {
      responses.DuoSessionMetadataById = {
        duoWorkflowWorkflows: {
          nodes: [
            {
              ...session,
              project: null,
              projectId:
                mode === 'invalid' ? 'invalid' : mode === 'none' ? null : session.projectId,
            },
          ],
          pageInfo,
        },
      };
      const result = browse(
        { action: 'get', workflow_id: '73' },
        { operatorProjectIds: new Set(['41']) },
      );
      if (mode === 'missing') expect(await result).toMatchObject({ project_id: '41' });
      else
        await expect(result).rejects.toThrow(
          mode === 'invalid' ? 'invalid Duo project' : 'verifiable project',
        );
    },
  );
  // Older schemas can locate a session by bounded metadata pagination without reading history.
  it('keeps opaque cursors during legacy metadata lookup', async () => {
    (graphqlSupports as jest.Mock).mockImplementation(
      (_type, _field, argument) => argument !== 'workflowId',
    );
    request
      .mockResolvedValueOnce({
        duoWorkflowWorkflows: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'opaque' } },
      })
      .mockResolvedValueOnce({
        duoWorkflowWorkflows: {
          nodes: [{ ...session, statusName: undefined, status: 'RUNNING' }],
          pageInfo,
        },
      });
    expect(await browse({ action: 'get', workflow_id: '73' })).toMatchObject({
      status: 'running',
      history: 'unsupported',
      details_available: false,
    });
    expect(request.mock.calls[1][1]).toEqual({ first: 100, after: 'opaque' });
  });

  // A broken continuation must terminate rather than repeatedly request one page.
  it.each([false, true])(
    'stops legacy lookup when continuation cannot advance (%s)',
    async (hasNextPage) => {
      (graphqlSupports as jest.Mock).mockReturnValue(false);
      responses.DuoSessionMetadata = {
        duoWorkflowWorkflows: { nodes: [], pageInfo: { hasNextPage, endCursor: null } },
      };
      await expect(browse({ action: 'get', workflow_id: '73' })).rejects.toThrow(
        hasNextPage ? 'did not advance' : 'unavailable',
      );
    },
  );

  // Read budgets remain bounded even when an older server has many unrelated sessions.
  it('caps legacy metadata scanning', async () => {
    (graphqlSupports as jest.Mock).mockReturnValue(false);
    let cursor = 0;
    request.mockImplementation(async () => ({
      duoWorkflowWorkflows: {
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: String(++cursor) },
      },
    }));
    await expect(browse({ action: 'get', workflow_id: '73' })).rejects.toThrow('metadata limit');
    expect(request).toHaveBeenCalledTimes(10);
  });

  // Optional history failures preserve usable metadata and say what is unavailable.
  it.each([new ResponseLimitError(1024), new Error('Unavailable')])(
    'preserves metadata when details cannot be read (%s)',
    async (error) => {
      responses.DuoSessionDetails = error;
      expect(await browse({ action: 'get', workflow_id: '73' })).toMatchObject({
        details_available: false,
        history: error instanceof ResponseLimitError ? 'too_large' : 'unreadable',
      });
    },
  );

  // An inaccessible exact ID must not be replaced by another returned session.
  it('handles an empty details page explicitly', async () => {
    responses.DuoSessionDetails = { duoWorkflowWorkflows: { nodes: [] } };
    expect(await browse({ action: 'get', workflow_id: '73' })).toMatchObject({
      details_available: false,
      history: 'unreadable',
    });
  });

  // The last log entry may be a tool result rather than the agent's final response.
  it('finds the latest agent answer and bounds created-object previews', async () => {
    responses.DuoSessionDetails = {
      duoWorkflowWorkflows: {
        nodes: [
          {
            ...session,
            statusName: 'finished',
            workItemLinks: {
              nodes: [
                null,
                {
                  workItem: { id: 'item', title: 'Created', webUrl: 'https://gitlab.example/item' },
                },
              ],
              pageInfo: { hasNextPage: false },
            },
            noteLinks: {
              nodes: [
                null,
                { note: { id: 'note', url: 'https://gitlab.example/note', body: 'n'.repeat(161) } },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        ],
      },
    };
    responses.DuoSessionLatestAnswer = {
      duoWorkflowWorkflows: {
        nodes: [
          {
            ...session,
            latestCheckpoint: {
              duoMessages: [
                { content: 'Done', role: 'assistant' },
                { content: 'Tool result', role: 'tool' },
              ],
            },
          },
        ],
      },
    };
    expect(await browse({ action: 'get', workflow_id: '73' })).toMatchObject({
      history: 'available',
      answer: { text: 'Done', truncated: false },
      created_objects: {
        work_items: [{ id: 'item' }],
        notes: [{ body: { text: 'n'.repeat(160), truncated: true } }],
      },
    });
  });

  // Missing checkpoints and an empty history are different from a successful answer.
  it.each([null, { duoMessages: [] }])(
    'reports missing answers without inventing a result (%j)',
    async (checkpoint) => {
      responses.DuoSessionDetails = {
        duoWorkflowWorkflows: { nodes: [{ ...session, statusName: 'failed' }] },
      };
      responses.DuoSessionLatestAnswer = {
        duoWorkflowWorkflows: { nodes: [{ ...session, latestCheckpoint: checkpoint }] },
      };
      expect(await browse({ action: 'get', workflow_id: '73' })).toMatchObject({
        status: 'failed',
        history: checkpoint === null ? 'missing_checkpoint' : 'no_agent_answer',
      });
    },
  );

  // Unsupported history fields and oversized history stay explicit in otherwise usable results.
  it.each(['unsupported', 'too_large', 'unreadable'])('reports %s history', async (history) => {
    responses.DuoSessionDetails = {
      duoWorkflowWorkflows: { nodes: [{ ...session, statusName: 'finished' }] },
    };
    if (history === 'unsupported')
      (graphqlSupports as jest.Mock).mockImplementation((type) => type !== 'DuoWorkflowEvent');
    responses.DuoSessionLatestAnswer =
      history === 'too_large' ? new ResponseLimitError(1024) : new Error('Unreadable history');
    expect(await browse({ action: 'get', workflow_id: '73' })).toMatchObject({
      history,
      answer: { text: null, truncated: false },
    });
  });

  // Project provenance must remain stable across metadata and details requests.
  it('rejects project reassignment during lookup', async () => {
    responses.DuoSessionDetails = {
      duoWorkflowWorkflows: { nodes: [{ ...session, projectId: 'gid://gitlab/Project/99' }] },
    };
    await expect(
      browse({ action: 'get', workflow_id: '73' }, { operatorProjectIds: new Set(['41']) }),
    ).rejects.toThrow('project changed');
  });

  // General interactive chat is not a CI-session lifecycle.
  it('omits interactive chat and other projects from listings', async () => {
    responses.DuoSessionMetadata = {
      duoWorkflowWorkflows: {
        nodes: [
          { ...session, workflowDefinition: 'chat' },
          { ...session, projectId: null },
          session,
        ],
        pageInfo,
      },
    };
    expect(
      await browse(
        { action: 'list', project_id: '41' },
        { scopeEnforcer: new ScopeEnforcer({ project: 'test/project' }) },
      ),
    ).toMatchObject({ sessions: [{ project_id: '41' }] });
    responses.DuoSessionDetails = {
      duoWorkflowWorkflows: { nodes: [{ ...session, workflowDefinition: 'chat' }] },
    };
    await expect(browse({ action: 'get', workflow_id: '73' })).rejects.toThrow('General Duo Chat');
  });
  // Session-ID lookup cannot bypass a path-based working scope.
  it('rejects a foreign session working scope before details', async () => {
    await expect(
      browse(
        { action: 'get', workflow_id: '73' },
        { scopeEnforcer: new ScopeEnforcer({ project: 'test/other' }) },
      ),
    ).rejects.toThrow('outside');
    expect(request.mock.calls.map(([doc]) => getOperationAST(doc)?.name?.value)).toEqual([
      'DuoSessionMetadataById',
    ]);
  });
  // The real session project, rather than a project hint, owns authorization.
  it('rejects a foreign session before requesting details', async () => {
    await expect(
      browse({ action: 'get', workflow_id: '73' }, { operatorProjectIds: new Set(['99']) }),
    ).rejects.toThrow('outside');
    expect(request.mock.calls.map(([doc]) => getOperationAST(doc)?.name?.value)).toEqual([
      'DuoSessionMetadataById',
    ]);
  });

  // Filtering must neither leak foreign sessions nor destroy opaque cursors.
  it('filters metadata against the operator list', async () => {
    const next = { hasNextPage: true, endCursor: 'another' };
    responses.DuoSessionMetadata = { duoWorkflowWorkflows: { nodes: [session], pageInfo: next } };
    expect(await browse({ action: 'list' }, { operatorProjectIds: new Set(['99']) })).toEqual({
      sessions: [],
      pageInfo: next,
      filtered: true,
      skipped_unverifiable_sessions: 0,
    });
  });

  // Unsupported and future states remain visible without being mistaken for completion.
  it('preserves future statuses and bounds latest answers', async () => {
    responses.DuoSessionDetails = {
      duoWorkflowWorkflows: {
        nodes: [
          {
            ...session,
            statusName: 'future_status',
            summary: 's'.repeat(1001),
            latestCheckpoint: {
              lastDuoMessage: {
                content: 'a'.repeat(4001),
                role: 'assistant',
                messageType: 'agent',
              },
            },
          },
        ],
      },
    };
    expect(await browse({ action: 'get', workflow_id: '73' })).toMatchObject({
      status: 'future_status',
      summary: { text: 's'.repeat(1000), truncated: true },
      answer: { text: 'a'.repeat(4000), truncated: true },
      history: 'available',
    });
  });

  // A human checkpoint is not evidence that its CI job is already finished.
  it('does not send input when GitLab refuses resume', async () => {
    responses.DuoResumeState = {
      duoWorkflowWorkflows: {
        nodes: [
          {
            ...session,
            statusName: 'input_required',
            userPermissions: { resumeDuoWorkflow: false },
          },
        ],
      },
    };
    await expect(
      manage({
        action: 'send_input',
        workflow_id: '73',
        human_approval: false,
        human_message: 'answer',
      }),
    ).rejects.toThrow('preceding CI job');
    expect(gitlab.post).not.toHaveBeenCalled();
  });
});

describe('Duo command construction with local doubles', () => {
  // Target validation covers origin, resource syntax, project identity and native context support.
  it.each(['origin', 'resource', 'project', 'version'])(
    'rejects an invalid targeted flow (%s)',
    async (condition) => {
      let goal = 'https://gitlab.example/gitlab/test/project/-/merge_requests/12';
      if (condition === 'origin') goal = 'https://other.example/test/project/-/merge_requests/12';
      if (condition === 'resource') goal += '/extra';
      (gitlab.get as jest.Mock)
        .mockResolvedValueOnce(project)
        .mockResolvedValueOnce({ project_id: condition === 'project' ? 99 : project.id });
      if (condition === 'version') (instanceAtLeast as jest.Mock).mockReturnValue(false);
      await expect(
        manage({ action: 'start', project_id: '41', flow: 'code_review/v1', goal }),
      ).rejects.toThrow();
      expect(gitlab.post).not.toHaveBeenCalled();
    },
  );

  // Older catalog resumes stay available without pretending foundational agents work there.
  it('resumes a catalog session on the older supported route', async () => {
    (instanceAtLeast as jest.Mock).mockReturnValue(false);
    responses.DuoResumeState = {
      duoWorkflowWorkflows: {
        nodes: [
          {
            ...session,
            statusName: 'input_required',
            userPermissions: { resumeDuoWorkflow: true },
            aiCatalogItemVersionId: 'catalog-version',
          },
        ],
      },
    };
    await manage({ action: 'send_input', workflow_id: '73', human_approval: false });
    expect(gitlab.post).toHaveBeenCalledTimes(1);
  });

  // Return the native receipt immediately, including links and workload identity when present.
  it('returns available start receipt details without waiting for completion', async () => {
    const receipt = {
      id: 73,
      status: 'created',
      web_url: 'https://gitlab.example/session',
      workload: { id: 'workload' },
    };
    (gitlab.post as jest.Mock).mockResolvedValueOnce(receipt);
    expect(
      await manage({ action: 'start', project_id: '41', goal: 'Inspect', consumer_id: '91' }),
    ).toMatchObject({
      workflow_id: String(receipt.id),
      status: receipt.status,
      web_url: receipt.web_url,
      workload_id: receipt.workload.id,
    });
  });
  // Different documented selectors map to native workflow definitions without fabricated identities.
  it.each([{ flow: 'developer/v1' }, { agent: 'duo_planner/v1' }])(
    'constructs a foundational start %j',
    async (selection) => {
      await manage({ action: 'start', project_id: '41', goal: 'Inspect', ...selection });
      expect(gitlab.post).toHaveBeenCalledWith(
        'ai/duo_workflows/workflows',
        expect.objectContaining({
          body: {
            project_id: '41',
            start_workflow: true,
            environment: 'ambient',
            workflow_definition: 'flow' in selection ? selection.flow : selection.agent,
            goal: 'Inspect',
          },
        }),
      );
    },
  );

  // Preserve the exact target URL for GitLab's native branch/context resolution.
  it.each(['code_review/v1', 'fix_pipeline/v1'])(
    'validates a same-project resource for %s',
    async (flow) => {
      (gitlab.get as jest.Mock)
        .mockResolvedValueOnce(project)
        .mockResolvedValueOnce({ project_id: project.id });
      const goal = `https://gitlab.example/gitlab/test/project/-/${flow === 'code_review/v1' ? 'merge_requests' : 'pipelines'}/12`;
      await manage({ action: 'start', project_id: '41', flow, goal });
      expect(gitlab.post).toHaveBeenCalledWith(
        'ai/duo_workflows/workflows',
        expect.objectContaining({
          body: expect.objectContaining({ goal, workflow_definition: flow }),
        }),
      );
    },
  );

  // Prerequisite and selector refusals occur before any native mutation.
  it.each([
    'runner',
    'consumer_disabled',
    'consumer_forbidden',
    'unknown_agent',
    'old_agent',
    'unknown_flow',
  ])('refuses %s before starting', async (condition) => {
    let selection: Record<string, string> = { consumer_id: '91' };
    if (condition === 'runner')
      responses.DuoProjectEnablement = { project: { duoWorkflowStatusCheck: { enabled: false } } };
    if (condition === 'consumer_disabled')
      responses.DuoConfiguredConsumer = { aiCatalogItemConsumer: { ...consumer, enabled: false } };
    if (condition === 'consumer_forbidden')
      responses.DuoConfiguredConsumer = {
        aiCatalogItemConsumer: { ...consumer, userPermissions: { executeAiCatalogItem: false } },
      };
    if (condition === 'unknown_agent') selection = { agent: 'unknown/v1' };
    if (condition === 'old_agent') {
      selection = { agent: 'duo_planner/v1' };
      (instanceAtLeast as jest.Mock).mockReturnValue(false);
    }
    if (condition === 'unknown_flow') selection = { flow: 'unknown/v1' };
    await expect(
      manage({ action: 'start', project_id: '41', goal: 'Inspect', ...selection }),
    ).rejects.toThrow();
    expect(gitlab.post).not.toHaveBeenCalled();
  });

  // Do not report success when a provider loses or omits the mutation receipt.
  it.each([
    {},
    { id: null, status: 'created' },
    { id: [], status: 'created' },
    { id: Number.MAX_SAFE_INTEGER + 1, status: 'created' },
  ])('treats an unusable start receipt as an unknown outcome (%j)', async (receipt) => {
    (gitlab.post as jest.Mock).mockResolvedValueOnce(receipt);
    await expect(
      manage({ action: 'start', project_id: '41', goal: 'Repair', consumer_id: '91' }),
    ).rejects.toThrow('outcome is unknown');
    expect(gitlab.post).toHaveBeenCalledTimes(1);
  });

  // A session's project and older resume capabilities must be checked again before input.
  it.each(['project', 'old_foundational'])(
    'rejects changed resume context (%s)',
    async (condition) => {
      if (condition === 'project')
        responses.DuoResumeState = { duoWorkflowWorkflows: { nodes: [] } };
      else (instanceAtLeast as jest.Mock).mockReturnValue(false);
      await expect(
        manage({ action: 'send_input', workflow_id: '73', human_approval: true }),
      ).rejects.toThrow();
      expect(gitlab.post).not.toHaveBeenCalled();
    },
  );
  // Exercise the lifecycle entirely through local doubles, including a replaced connection.
  it('discovers, starts, inspects, answers checkpoints and returns created objects', async () => {
    expect(
      await browse({ action: 'agents_and_flows', project_id: '41', item_type: 'flow' }),
    ).toMatchObject({ items: [{ consumer_id: '91', catalog_item_id: '8' }] });
    const started = (await manage({
      action: 'start',
      project_id: '41',
      consumer_id: '91',
      goal: 'Repair',
    })) as { workflow_id: string };
    const replacement = jest.fn(() => ({ request }));
    (ConnectionManager.getInstance as jest.Mock).mockReturnValue({ getClient: replacement });
    for (const [state, answer] of [
      ['input_required', { human_approval: false, human_message: 'Use the current branch' }],
      ['plan_approval_required', { human_approval: true }],
      ['tool_call_approval_required', { human_approval: false }],
    ] as const) {
      const pending = {
        ...session,
        statusName: state,
        userPermissions: { resumeDuoWorkflow: true },
        latestCheckpoint: {
          lastDuoMessage: { content: 'May I continue?', role: 'assistant', messageType: 'agent' },
        },
      };
      responses.DuoSessionDetails = { duoWorkflowWorkflows: { nodes: [pending] } };
      responses.DuoResumeState = { duoWorkflowWorkflows: { nodes: [pending] } };
      expect(await browse({ action: 'get', workflow_id: started.workflow_id })).toMatchObject({
        pending_input: { state, can_send: true },
        poll_after_seconds: null,
      });
      await manage({ action: 'send_input', workflow_id: started.workflow_id, ...answer });
    }
    const created = {
      id: 'gid://gitlab/MergeRequest/81',
      title: 'Repair',
      webUrl: 'https://gitlab.example/gitlab/test/project/-/merge_requests/81',
    };
    responses.DuoSessionDetails = {
      duoWorkflowWorkflows: {
        nodes: [
          {
            ...session,
            statusName: 'finished',
            latestCheckpoint: {
              lastDuoMessage: { content: 'Repair ready', role: 'assistant', messageType: 'agent' },
            },
            mergeRequestLinks: {
              nodes: [{ mergeRequest: created }],
              pageInfo: { hasNextPage: true },
            },
          },
        ],
      },
    };
    expect(await browse({ action: 'get', workflow_id: started.workflow_id })).toMatchObject({
      status: 'finished',
      pending_input: null,
      answer: { text: 'Repair ready', truncated: false },
      created_objects: { merge_requests: [created], truncated: true },
    });
    responses.DuoResumeState = {
      duoWorkflowWorkflows: { nodes: [{ ...session, statusName: 'finished' }] },
    };
    await expect(
      manage({ action: 'send_input', workflow_id: started.workflow_id, human_approval: true }),
    ).rejects.toThrow('not in a supported waiting state');
    expect(gitlab.post).toHaveBeenCalledTimes(4);
    expect(replacement).toHaveBeenCalled();
  });

  // Outer MCP deadlines also need an explicit instruction to inspect, not replay.
  it('carries write uncertainty through the tool timeout response', () => {
    const error = createTimeoutError('manage_duo_session', 'start', 1000);
    expect(error.retryable).toBe(false);
    expect(error.suggested_fix).toContain('browse_duo_sessions');
  });

  // The gateway may lose its link after the downstream server committed the write.
  it('carries write uncertainty through gateway disconnection without replay', async () => {
    const call = jest.fn().mockRejectedValue(new DownstreamDisconnectedError(new Error('closed')));
    await expect(
      forwardWithPolicy(
        { isRead: isReadCall, isConnected: () => true, waitForConnection: jest.fn(), call },
        'manage_duo_session',
        {},
      ),
    ).rejects.toThrow('browse_duo_sessions');
    expect(call).toHaveBeenCalledTimes(1);
  });

  // Both controls stop writes before even looking up project/session metadata.
  it.each([
    { readOnly: true },
    { disabledGroups: new Set(['duo']) },
    { deniedActions: new Map([['manage_duo_session', new Set(['start'])]]) },
  ])('honors call policy %j', async (restriction) => {
    await expect(
      manage(
        { action: 'start', project_id: '41', goal: 'Repair code', consumer_id: '91' },
        restriction,
      ),
    ).rejects.toThrow();
    expect(gitlab.get).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(gitlab.post).not.toHaveBeenCalled();
  });

  // Native CI execution and the configured consumer identity are mandatory.
  it('constructs one bounded native start request', async () => {
    await manage({ action: 'start', project_id: '41', goal: 'Repair code', consumer_id: '91' });
    expect(gitlab.post).toHaveBeenCalledTimes(1);
    expect(gitlab.post).toHaveBeenCalledWith('ai/duo_workflows/workflows', {
      body: {
        project_id: '41',
        start_workflow: true,
        environment: 'ambient',
        ai_catalog_item_consumer_id: '91',
        goal: 'Repair code',
      },
      contentType: 'json',
      rawResponse: true,
      responseByteLimit: 4 * 1024 * 1024,
      redirect: 'error',
    });
  });

  // Never trust a globally valid configured consumer from a different project.
  it('rejects a consumer owned by another project', async () => {
    responses.DuoConfiguredConsumer = {
      aiCatalogItemConsumer: { ...consumer, project: { id: 'gid://gitlab/Project/99' } },
    };
    await expect(
      manage({ action: 'start', project_id: '41', goal: 'Repair', consumer_id: '91' }),
    ).rejects.toThrow('does not belong');
    expect(gitlab.post).not.toHaveBeenCalled();
  });

  // Targeted flows cannot be used to smuggle another project's resource URL.
  it('rejects a target URL outside the selected project', async () => {
    await expect(
      manage({
        action: 'start',
        project_id: '41',
        flow: 'code_review/v1',
        goal: 'https://gitlab.example/gitlab/test/other/-/merge_requests/12',
      }),
    ).rejects.toThrow('selected project');
    expect(gitlab.post).not.toHaveBeenCalled();
  });

  // Answer, approval and rejection remain explicit inputs to the documented resume route.
  it.each([
    { human_approval: true },
    { human_approval: false, human_message: 'Use a smaller change' },
    { human_approval: false },
  ])('constructs resume input %j', async (answer) => {
    await manage({ action: 'send_input', workflow_id: '73', ...answer });
    expect(gitlab.post).toHaveBeenCalledWith(
      'ai/duo_workflows/workflows/73/resume',
      expect.objectContaining({ body: answer, redirect: 'error' }),
    );
  });

  // A lost response is not permission to repeat a non-idempotent write.
  it.each([429, 409])(
    'preserves HTTP %s state and rate-limit failures without replay',
    async (status) => {
      const failure = new GitLabApiError(
        status,
        'Request rejected',
        `GitLab API error: ${status}`,
        status === 429 ? 30 : undefined,
      );
      (gitlab.post as jest.Mock).mockRejectedValueOnce(failure);
      await expect(
        manage({ action: 'start', project_id: '41', goal: 'Repair', consumer_id: '91' }),
      ).rejects.toBe(failure);
      expect(failure.retryAfterSeconds).toBe(status === 429 ? 30 : undefined);
      expect(failure.message).toContain('browse_duo_sessions');
      expect(gitlab.post).toHaveBeenCalledTimes(1);
    },
  );

  // A lost response is not permission to repeat a non-idempotent write.
  it('reports ambiguous mutation failure without replay', async () => {
    (gitlab.post as jest.Mock).mockRejectedValueOnce(new Error('connection closed'));
    await expect(
      manage({ action: 'start', project_id: '41', goal: 'Repair', consumer_id: '91' }),
    ).rejects.toThrow('outcome is unknown');
    expect(gitlab.post).toHaveBeenCalledTimes(1);
  });
});
