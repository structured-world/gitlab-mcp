import { pipelinesToolRegistry } from '../../../src/entities/pipelines/registry';
import { mrsToolRegistry } from '../../../src/entities/mrs/registry';
import { filesToolRegistry } from '../../../src/entities/files/registry';
import { ScopeEnforcer } from '../../../src/profiles/scope-enforcer';
import { normalizeProjectId } from '../../../src/utils/projectIdentifier';
import { gitlab } from '../../../src/utils/gitlab-api';
import { installFetchMock, mockEnhancedFetch, mockOk } from '../helpers/fetch-mock';

jest.mock('../../../src/utils/fetch', () => ({ enhancedFetch: jest.fn() }));
installFetchMock();

describe('REST path security', () => {
  const traversal = '../../../projects/other/variables';
  const cases = [
    [
      pipelinesToolRegistry.get('browse_pipelines')!,
      { action: 'job', project_id: '123', job_id: traversal },
    ],
    [
      mrsToolRegistry.get('browse_merge_requests')!,
      { action: 'get', project_id: '123', merge_request_iid: traversal },
    ],
    [
      mrsToolRegistry.get('manage_mr_discussion')!,
      {
        action: 'reply',
        project_id: '123',
        merge_request_iid: '1',
        discussion_id: traversal,
        body: 'Reply',
      },
    ],
    [
      filesToolRegistry.get('browse_files')!,
      { action: 'download_attachment', project_id: '123', secret: traversal, filename: 'file.txt' },
    ],
    [
      filesToolRegistry.get('browse_files')!,
      { action: 'download_attachment', project_id: '123', secret: 'secret', filename: traversal },
    ],
  ] as const;

  // Tool arguments must fail before any request can use the operator's GitLab token.
  it.each(cases)('refuses traversal in $0.name arguments', async (tool, args) => {
    mockOk({});
    await expect(tool.handler(args)).rejects.toThrow();
    expect(mockEnhancedFetch).not.toHaveBeenCalled();
  });

  // Mixed encoded separators previously passed the group prefix check and escaped in the URL.
  it.each([
    'team-a%2Fapp/../../projects/other-team%2Fsecret',
    'team-a/app/%2e%2e/other',
    'team-a/app/..',
    'team-a/app/./other',
  ])('refuses noncanonical project identifier %s', (input) => {
    expect(() => normalizeProjectId(input)).toThrow();
    expect(new ScopeEnforcer({ group: 'team-a' }).isAllowed(input)).toBe(false);
  });

  // The client must also reject unsafe paths constructed outside the normal tool schemas.
  it.each(['projects/123/jobs/../../../user', 'projects/123?search=other', 'projects/123#other'])(
    'refuses raw REST path %s',
    async (path) => {
      mockOk({});
      await expect(gitlab.get(path)).rejects.toThrow();
      expect(mockEnhancedFetch).not.toHaveBeenCalled();
    },
  );
});
